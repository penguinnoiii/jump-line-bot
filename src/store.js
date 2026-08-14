// Cloud persistence for completed student profiles, so a guidance teacher
// can look up a room's students even after this server restarts.
//
// Provider: Upstash Redis (https://upstash.com) — REST API, no persistent
// connection needed (fits a stateless Node server), generous free tier.
// No UPSTASH_REDIS_REST_URL/TOKEN set → falls back to an in-memory store so
// the app still works for a demo; teacher lookups just reset on restart in
// that mode (clearly logged, same honest-mock pattern as the rest of the app).

const REST_URL = process.env.UPSTASH_REDIS_REST_URL || '';
const REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';

export function cloudConfigured() {
  return Boolean(REST_URL && REST_TOKEN);
}

// --- In-memory fallback -------------------------------------------------------
const memProfiles = new Map(); // userId -> profile object
const memRooms = new Map(); // room -> Set(userId)

// --- Upstash REST pipeline ----------------------------------------------------
// Exported so other modules needing durable KV storage (e.g. dashboard-auth.js's
// session tokens) can share this one REST client instead of duplicating it.
export async function pipeline(commands) {
  const res = await fetch(`${REST_URL}/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${REST_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(commands),
  });
  if (!res.ok) throw new Error(`Upstash ${res.status}`);
  return res.json(); // array of { result } | { error }
}

/** Normalize free-text "grade" answers (e.g. "ม.6/3", " ม.6 / 3 ") into a stable room key. */
export function normalizeRoom(grade) {
  return String(grade || 'ไม่ระบุห้อง')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Persist a completed (non-anonymous) student profile, indexed by room.
 * Re-saving the same userId overwrites their previous record (no history).
 * If their room/grade changed since the last save, removes them from the
 * OLD room's index so they don't show up twice on the teacher dashboard.
 */
export async function persistProfile(userId, profile) {
  const room = normalizeRoom(profile.grade);
  // userId is embedded so findStudentProfileByPhone() can look records up by
  // phone and still know which record to edit. It's never rendered by
  // public/teacher.html — that page only reads the named fields it lists.
  const record = { ...profile, userId, room, savedAt: Date.now() };

  if (!cloudConfigured()) {
    const prev = memProfiles.get(userId);
    if (prev && prev.room && prev.room !== room) {
      memRooms.get(prev.room)?.delete(userId);
    }
    memProfiles.set(userId, record);
    if (!memRooms.has(room)) memRooms.set(room, new Set());
    memRooms.get(room).add(userId);
    console.log(`[store] MOCK persisted profile for ${userId} in room "${room}"`);
    return { mock: true };
  }

  // Read the previous room (if any) so a changed grade moves the student
  // instead of leaving a stale duplicate behind.
  const prevRoom = await getStudentProfile(userId).then((p) => p?.room);
  const commands = [
    ['SET', `jump:profile:${userId}`, JSON.stringify(record)],
    ['SADD', `jump:room:${room}`, userId],
    ['SADD', 'jump:rooms', room],
  ];
  if (prevRoom && prevRoom !== room) {
    commands.push(['SREM', `jump:room:${prevRoom}`, userId]);
  }
  await pipeline(commands);

  // If that emptied the old room, drop it from the room list too.
  if (prevRoom && prevRoom !== room) {
    const [{ result: remaining }] = await pipeline([['SCARD', `jump:room:${prevRoom}`]]);
    if (!remaining) await pipeline([['SREM', 'jump:rooms', prevRoom]]);
  }

  return { mock: false };
}

/** @returns {Promise<{room: string, count: number}[]>} */
export async function listRooms() {
  if (!cloudConfigured()) {
    return [...memRooms.entries()]
      .map(([room, set]) => ({ room, count: set.size }))
      .sort((a, b) => a.room.localeCompare(b.room));
  }
  const [{ result: rooms }] = await pipeline([['SMEMBERS', 'jump:rooms']]);
  if (!rooms || rooms.length === 0) return [];
  const counts = await pipeline(rooms.map((r) => ['SCARD', `jump:room:${r}`]));
  return rooms
    .map((room, i) => ({ room, count: counts[i]?.result ?? 0 }))
    .sort((a, b) => a.room.localeCompare(b.room));
}

/** @returns {Promise<object[]>} profiles of students in a room, newest first. */
export async function listStudentsInRoom(room) {
  let records;
  if (!cloudConfigured()) {
    const set = memRooms.get(room);
    records = set ? [...set].map((uid) => memProfiles.get(uid)).filter(Boolean) : [];
  } else {
    const [{ result: userIds }] = await pipeline([['SMEMBERS', `jump:room:${room}`]]);
    if (!userIds || userIds.length === 0) return [];
    const results = await pipeline(userIds.map((uid) => ['GET', `jump:profile:${uid}`]));
    records = results.map((r) => (r.result ? JSON.parse(r.result) : null)).filter(Boolean);
  }
  return records.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
}

/** Direct lookup by LINE userId — used by the student dashboard to fetch/edit
 * a single record without scanning rooms. */
export async function getStudentProfile(userId) {
  if (!cloudConfigured()) return memProfiles.get(userId) || null;
  const [{ result }] = await pipeline([['GET', `jump:profile:${userId}`]]);
  return result ? JSON.parse(result) : null;
}

/**
 * Find a completed profile by its verified phone (E.164). Used to log a
 * student into the self-service dashboard after they verify the same phone
 * via OTP — deliberately NOT name/student-ID lookup, which a classmate could
 * guess; this ties dashboard access to the same AIS verification already
 * trusted everywhere else in the app.
 */
export async function findStudentProfileByPhone(phone) {
  const rooms = await listRooms();
  for (const { room } of rooms) {
    const students = await listStudentsInRoom(room);
    const match = students.find((s) => s.phone === phone);
    if (match) return match;
  }
  return null;
}
