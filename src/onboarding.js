// Student "log in" gate: consent → phone verification (AIS OTP, required) →
// 4 general-info questions → done. Students can't reach the guidance LLM
// until this completes. Single-school deployment — school name (SCHOOL_NAME)
// is stated in the welcome message and stamped onto every profile, not asked.
//   [AIS] เบอร์โทร + OTP  ·  ชื่อ-นามสกุล (→ addressed by first name) ·
//   รหัสนักเรียน · ชั้น/ห้อง (also used to group students by room for the
//   teacher dashboard) · ความสนใจ/เป้าหมาย
//
// The live state machine below stays in-memory (fast, synchronous per-turn,
// except the phone/OTP steps which call AIS and are awaited). A completed
// (non-anonymous) profile is also persisted to the cloud store (src/store.js)
// so a guidance teacher can look it up later, grouped by room.
//
// IMPORTANT — dispatch order in server.js: while a student is mid-login
// (not yet onboarded), ALL their messages must go through handleOnboarding()
// FIRST, not the standalone AIS dispatcher (src/ais.js handleIdentityMessage).
// Otherwise a bare phone number typed at the 'phone' stage gets intercepted
// by the standalone silent-Number-Verification path before the in-flow OTP
// logic ever sees it. The standalone dispatcher is still useful — but only
// for an already-logged-in student re-verifying a number later.

import { persistProfile, getStudentProfile } from './store.js';
import {
  getVerifiedPhone,
  maskPhone,
  extractThaiMobile,
  requestOtp,
  verifyOtp,
} from './ais.js';

const profiles = new Map(); // userId -> { stage, ...fields, nickname, anonymous, consentAt, completedAt }

// Single-school deployment — no longer asked in chat, just stated up front
// and stamped onto every profile.
const SCHOOL_NAME = 'โรงเรียนสาธิต';

const DASHBOARD_URL =
  (process.env.APP_BASE_URL || 'https://jump-line-bot.onrender.com') + '/dashboard';

const RESET_KEYWORD =
  /แก้ไขข้อมูล|เริ่มใหม่|เริ่มต้นใหม่|^reset$|ล้างข้อมูล|เข้าสู่ระบบ|log ?in|sign ?in/i;
const SKIP_KEYWORD = /^ข้าม$|^skip$|ไม่มี|ไม่ระบุ|ยังไม่แน่ใจ/i;
const RESEND_KEYWORD = /ส่งรหัสใหม่|ส่งใหม่|resend|ขอรหัสใหม่/i;
const CHANGE_PHONE_KEYWORD = /เปลี่ยนเบอร์|แก้เบอร์|เบอร์ผิด/i;
// Check "no" before "yes" — "ไม่ยินยอม" contains the substring "ยินยอม".
const CONSENT_NO = /ไม่ยินยอม|ไม่ตกลง|ไม่ยอมรับ|ไม่ok|ไม่โอเค|\bno\b/i;
const CONSENT_YES = /ยินยอม|ตกลง|ยอมรับ|โอเค|\bok\b|\byes\b|ได้เลย|ได้ค่ะ|ได้ครับ/i;

/** First token of a full name — used to address the student, Thai given-name convention. */
function extractFirstName(fullName) {
  const first = String(fullName).trim().split(/\s+/)[0];
  return first || 'นักเรียน';
}

// The 4 general-info questions asked AFTER phone verification, in order.
// `question` may be a string or a function of the profile-so-far.
const FIELDS = [
  {
    key: 'fullName',
    label: 'ชื่อ-นามสกุล',
    max: 80,
    question: 'ต่อไป ขอชื่อ-นามสกุลเต็มของน้องค่ะ (เช่น สมชาย ใจดี)',
  },
  {
    key: 'studentId',
    label: 'รหัสนักเรียน',
    max: 40,
    question: (p) => `ยินดีที่ได้รู้จัก${p.nickname}ค่ะ 😊 รหัสนักเรียนของน้องคืออะไรคะ?`,
  },
  {
    key: 'grade',
    label: 'ชั้น/ห้อง',
    max: 40,
    question: 'เรียนอยู่ชั้น/ห้องอะไรคะ? (เช่น ม.1/3, ม.2/5, ม.3/1)',
  },
  {
    key: 'interest',
    label: 'ความสนใจ/เป้าหมาย',
    max: 200,
    question:
      'สุดท้าย สนใจเรียนต่อสายไหน หรือมีเป้าหมายอะไรเป็นพิเศษไหมคะ? (พิมพ์ "ข้าม" ได้ถ้ายังไม่แน่ใจ)',
  },
];

// Shown the moment someone adds the OA as a friend (LINE 'follow' event),
// and as a fallback on their first text message if a 'follow' event was
// ever missed. Short on purpose — just enough to identify who's talking to
// Jump before deciding whether to run the student login flow at all.
const FOLLOW_INTRO_MSG =
  `สวัสดีค่ะ 👋 นี่คือ "Jump" ผู้ช่วยแนะแนวการศึกษาประจำ${SCHOOL_NAME} ค่ะ\n` +
  'ช่วยค้นหา/เปรียบเทียบสายการเรียน ทุนการศึกษา และให้คำแนะแนวเฉพาะบุคคลได้ตลอด 24 ชม. ✨\n\n' +
  'ก่อนเริ่ม ขอทราบก่อนนะคะ ว่าคุยด้วยในฐานะ "นักเรียน" หรือ "คุณครู" คะ?';

const ROLE_RETRY_MSG = 'รบกวนพิมพ์ หรือกดปุ่ม "นักเรียน" หรือ "คุณครู" ค่ะ 🙏';

const TEACHER_URL =
  (process.env.APP_BASE_URL || 'https://jump-line-bot.onrender.com') + '/teacher';

const TEACHER_INFO_MSG =
  'สวัสดีค่ะคุณครู 🙏 น้อง ๆ นักเรียนคุยกับ Jump ในแชทนี้ได้เลย ส่วนคุณครูดูสรุปข้อมูลนักเรียนแต่ละห้องได้ที่ ' +
  `"Teacher View" ค่ะ (ใส่รหัสผ่านที่ได้รับจากผู้ดูแลระบบ):\n${TEACHER_URL}`;

const ROLE_TEACHER_KEYWORD = /ครู|teacher/i;
const ROLE_STUDENT_KEYWORD = /นักเรียน|น้อง|student/i;

const CONSENT_ASK_MSG =
  'ก่อนเริ่ม ขอเข้าสู่ระบบด้วยการยืนยันเบอร์โทรผ่าน AIS ก่อน แล้วตามด้วยคำถามทั่วไปสั้น ๆ 4 ข้อ ' +
  '(ชื่อ-นามสกุล, รหัสนักเรียน, ชั้น/ห้อง, ความสนใจ) เพื่อให้คำแนะนำตรงจุดขึ้นค่ะ ' +
  'ใช้เฉพาะในการสนทนานี้เท่านั้น\n' +
  '(ถ้าอายุต่ำกว่า 18 ปี แนะนำให้แจ้งผู้ปกครองให้ทราบด้วยนะคะ)\n\n' +
  'พิมพ์ "ยินยอม" เพื่อเข้าสู่ระบบ หรือ "ไม่ยินยอม" ถ้าไม่สะดวกให้ข้อมูล (ยังคุยกับบอทได้ แต่คำแนะนำจะเป็นแบบทั่วไป)';

const CONSENT_RETRY_MSG = 'รบกวนพิมพ์ "ยินยอม" หรือ "ไม่ยินยอม" ค่ะ 🙏';

const ANON_MODE_MSG =
  'รับทราบค่ะ 🙏 จะไม่เก็บข้อมูลส่วนตัวไว้นะคะ คุยกับ Jump ได้เลย แต่คำแนะนำอาจเป็นแบบทั่วไป ' +
  'เพราะยังไม่รู้ข้อมูลของน้อง ✨\n(พิมพ์ "เข้าสู่ระบบ" ได้ทุกเมื่อถ้าอยากกรอกข้อมูลภายหลัง)';

const PHONE_QUESTION =
  '📱 ขอเบอร์โทรของน้องเพื่อยืนยันตัวตนผ่าน AIS ก่อนนะคะ (เช่น 0812345678)';

const PHONE_INVALID_MSG =
  'เบอร์ไม่ถูกต้องค่ะ กรุณาพิมพ์เบอร์มือถือ 10 หลัก (เช่น 0812345678) อีกครั้งนะคะ';

function fieldIndex(key) {
  return FIELDS.findIndex((f) => f.key === key);
}

function questionFor(fieldKey, profile) {
  const f = FIELDS[fieldIndex(fieldKey)];
  if (!f) return null;
  return typeof f.question === 'function' ? f.question(profile) : f.question;
}

/** Shared "📋 ข้อมูลของ..." block used by both the login summary and the
 * in-chat "my info" lookup — kept in one place so the two stay identical. */
function profileCardBody(p) {
  const lines = FIELDS.map(
    (f) => `• ${f.label}: ${p[f.key] || 'ไม่ระบุ'}`,
  ).join('\n');
  const verifyLine = p.phoneVerified
    ? `• เบอร์ที่ยืนยันแล้ว: ${maskPhone(p.phone)} ✅ (ผ่าน AIS)`
    : '• ยืนยันตัวตน: ยังไม่ได้ยืนยันเบอร์';
  return `📋 ข้อมูลของ${p.nickname} (${p.school || SCHOOL_NAME})\n${verifyLine}\n${lines}`;
}

function doneSummary(p) {
  return (
    `เรียบร้อยค่ะ ✅\n\n${profileCardBody(p)}\n\n` +
    'ตอนนี้คุยกับ Jump ได้เลยค่ะ ลองถามอะไรก็ได้เกี่ยวกับการเรียนต่อ ✨\n' +
    '(พิมพ์ "เข้าสู่ระบบ" ได้ทุกเมื่อถ้าต้องการเริ่มกรอกใหม่)'
  );
}

const INFO_REQUEST_KEYWORD =
  /ข้อมูลของฉัน|ข้อมูลฉัน|ข้อมูลของนักเรียน|ข้อมูลส่วนตัว|ดูข้อมูลของฉัน|ดูข้อมูลฉัน|เช็คข้อมูล|เช็กข้อมูล|ข้อมูลที่กรอก|ข้อมูลที่บันทึก|ข้อมูลของหนู/i;

/** True if a message (from an already-onboarded student) is asking to see
 * their own profile — handled separately from the guidance LLM so the
 * answer is a guaranteed-accurate, consistently-formatted card instead of
 * whatever the model chooses to say. */
export function isProfileInfoRequest(text) {
  return INFO_REQUEST_KEYWORD.test(String(text));
}

/** Reply for an in-chat "my info" request: the same card shown at login,
 * plus a dashboard link so the student can re-check (or share as PDF with a
 * parent) any time without scrolling back through the chat. */
export function profileCardMessage(p) {
  if (!p || p.anonymous) {
    return (
      'ตอนนี้ยังไม่ได้เก็บข้อมูลส่วนตัวไว้ค่ะ (โหมดไม่ระบุตัวตน) ' +
      'พิมพ์ "เข้าสู่ระบบ" ได้ทุกเมื่อถ้าอยากกรอกข้อมูลนะคะ'
    );
  }
  return (
    `${profileCardBody(p)}\n\n` +
    `ดูแบบเต็ม แก้ไข หรือแชร์เป็น PDF ให้ผู้ปกครองได้ที่แดชบอร์ดค่ะ:\n${DASHBOARD_URL}`
  );
}

function otpSentMsg(phone, r) {
  const base = `📩 ส่งรหัส OTP ไปที่เบอร์ ${maskPhone(phone)} แล้วค่ะ กรุณาพิมพ์รหัส 6 หลักที่ได้รับเพื่อยืนยันนะคะ`;
  return r.mock ? `${base}\n\n(โหมดสาธิต — รหัสคือ ${r.code})` : base;
}

/**
 * Attach a newly-verified phone (from the standalone AIS dispatcher, e.g. a
 * logged-in student re-verifying a different number) onto their profile, and
 * re-persist if it changed anything. The mandatory login-time verification
 * already sets this directly, so this only matters for re-verification.
 */
function syncVerifiedPhone(userId, p) {
  if (!p || p.stage !== 'done' || p.anonymous || p.demo) return;
  const v = getVerifiedPhone(userId);
  if (!v || p.phone === v.phone) return;
  p.phone = v.phone;
  p.phoneVerified = true;
  p.phoneVerifiedAt = v.verifiedAt;
  persistProfile(userId, p).catch((err) =>
    console.error('[onboarding] re-persist after phone link failed:', err),
  );
}

/** Call right after a successful standalone AIS verification, so an
 * already-logged-in student's record (and the teacher dashboard) updates
 * immediately instead of waiting for their next message. */
export function syncPhoneIfOnboarded(userId) {
  syncVerifiedPhone(userId, profiles.get(userId));
}

/** The student's current rolling conversation summary, if any — used to
 * seed src/llm.js's summarizeConversation() with what to build on. */
export function getConversationSummary(userId) {
  return profiles.get(userId)?.conversationSummary || null;
}

/**
 * Attach an updated conversation-interest summary onto a student's profile
 * and persist it, so it survives this server restarting and shows up on
 * their dashboard/PDF. Fire-and-forget from server.js after a guidance
 * reply — never on the reply's critical path. Demo sessions are skipped
 * (see the `demo` flag on handleOnboarding), same as all other persistence.
 */
export function updateConversationSummary(userId, summary) {
  const p = profiles.get(userId);
  if (!p || p.stage !== 'done' || p.anonymous || p.demo || !summary) return;
  p.conversationSummary = summary;
  p.conversationSummaryAt = Date.now();
  persistProfile(userId, p).catch((err) =>
    console.error('[onboarding] persist conversation summary failed:', err),
  );
}

export function isResetCommand(text) {
  return RESET_KEYWORD.test(String(text));
}

/** True if the user's next reply is expected to be their role (student vs.
 * teacher) — lets server.js attach quick-reply buttons to that message. */
export function needsRoleQuickReply(userId) {
  const p = profiles.get(userId);
  return Boolean(p && p.stage === 'role');
}

/** True once the student has completed onboarding (with or without consent). */
export function isOnboarded(userId) {
  const p = profiles.get(userId);
  return Boolean(p && p.stage === 'done');
}

/** @returns {object|null} the student's profile, or null if not onboarded. */
export function getProfile(userId) {
  const p = profiles.get(userId);
  if (!p || p.stage !== 'done') return null;
  syncVerifiedPhone(userId, p);
  return p;
}

/**
 * Apply edits from the student self-service dashboard (public/dashboard.html)
 * onto a student's own profile — the same general-info fields from login,
 * NOT phone (that stays tied to AIS OTP verification via chat). Rehydrates
 * from the cloud copy first if this server has no live in-memory session for
 * them (e.g. it restarted since they last chatted), so an edit still lands
 * correctly and — importantly — the NEXT chat turn's personalization reflects
 * it immediately, not just the teacher dashboard.
 * @returns {Promise<object|null>} the updated profile, or null if the
 *   student has no completed record at all (cloud or live).
 */
export async function updateProfileFields(userId, updates) {
  let p = profiles.get(userId);
  if (!p || p.stage !== 'done') {
    const cloud = await getStudentProfile(userId);
    if (!cloud || cloud.anonymous) return null;
    p = { ...cloud, stage: 'done' };
    if (!p.school) p.school = SCHOOL_NAME;
    profiles.set(userId, p);
  }

  for (const field of FIELDS) {
    const value = updates?.[field.key];
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    p[field.key] = trimmed.slice(0, field.max);
    if (field.key === 'fullName') p.nickname = extractFirstName(p[field.key]);
  }

  await persistProfile(userId, p);
  return p;
}

/** Thai-language summary of a profile's fields, for feeding to the LLM. */
export function profileSummaryForLLM(profile) {
  if (!profile || profile.anonymous) return null;
  const parts = [
    `ชื่อที่ควรเรียก (ชื่อจริง): ${profile.nickname}`,
    `โรงเรียน: ${profile.school || SCHOOL_NAME}`,
  ];
  FIELDS.forEach((f) => {
    if (profile[f.key]) parts.push(`${f.label}: ${profile[f.key]}`);
  });
  parts.push(
    `สถานะยืนยันตัวตน: ${profile.phoneVerified ? 'ยืนยันเบอร์แล้วผ่าน AIS' : 'ยังไม่ได้ยืนยันเบอร์'}`,
  );
  return parts.join(' | ');
}

/**
 * Advance a user through the login state machine by one message. Always
 * returns a reply string — call this whenever the user isn't onboarded yet,
 * or sends a reset command. Async: the phone/OTP steps call AIS.
 * @param {boolean} [demo] Marks the resulting profile as a demo/preview
 *   session (e.g. the hackathon demo site, public/demo.html) so it never
 *   gets written to the real cloud store — a visitor playing with the demo
 *   must never show up in an actual teacher's room dashboard. Caller should
 *   pass this consistently for every call on a given (demo-prefixed) userId.
 */
export async function handleOnboarding(userId, text, demo = false) {
  const t = String(text).trim();

  if (RESET_KEYWORD.test(t)) {
    profiles.set(userId, { stage: 'consent', demo });
    return CONSENT_ASK_MSG;
  }

  let p = profiles.get(userId);
  if (!p) {
    p = { stage: 'role', demo };
    profiles.set(userId, p);
    return FOLLOW_INTRO_MSG;
  }

  if (p.stage === 'role') {
    if (ROLE_TEACHER_KEYWORD.test(t)) {
      p.stage = 'teacher';
      return TEACHER_INFO_MSG;
    }
    if (ROLE_STUDENT_KEYWORD.test(t)) {
      p.stage = 'consent';
      return CONSENT_ASK_MSG;
    }
    return ROLE_RETRY_MSG;
  }

  // Terminal informational stage for teachers — they don't go through the
  // student login flow at all, just get pointed at Teacher View each time.
  if (p.stage === 'teacher') {
    return TEACHER_INFO_MSG;
  }

  if (p.stage === 'consent') {
    if (CONSENT_NO.test(t)) {
      p.stage = 'done';
      p.anonymous = true;
      p.completedAt = Date.now();
      return ANON_MODE_MSG;
    }
    if (CONSENT_YES.test(t)) {
      p.stage = 'phone';
      p.consentAt = Date.now();
      return PHONE_QUESTION;
    }
    return CONSENT_RETRY_MSG;
  }

  if (p.stage === 'phone') {
    const phone = extractThaiMobile(t);
    if (!phone) return PHONE_INVALID_MSG;
    const r = await requestOtp(userId, phone);
    if (r.error) return `⚠️ ขอ OTP ไม่สำเร็จค่ะ (${r.error}) ลองพิมพ์เบอร์อีกครั้งนะคะ`;
    p._pendingPhone = phone;
    p.stage = 'otp';
    return otpSentMsg(phone, r);
  }

  if (p.stage === 'otp') {
    if (CHANGE_PHONE_KEYWORD.test(t)) {
      p.stage = 'phone';
      return PHONE_QUESTION;
    }
    if (RESEND_KEYWORD.test(t)) {
      const r = await requestOtp(userId, p._pendingPhone);
      if (r.error) return `⚠️ ส่งรหัสใหม่ไม่สำเร็จค่ะ (${r.error}) ลองอีกครั้งนะคะ`;
      return otpSentMsg(p._pendingPhone, r);
    }
    const codeMatch = t.match(/^\s*(\d{6})\s*$/);
    if (!codeMatch) {
      return 'กรุณาพิมพ์รหัส OTP 6 หลักที่ได้รับค่ะ (หรือพิมพ์ "ส่งรหัสใหม่" / "เปลี่ยนเบอร์")';
    }
    const r = await verifyOtp(userId, codeMatch[1]);
    if (r.verified) {
      p.phone = r.phone;
      p.phoneVerified = true;
      p.phoneVerifiedAt = Date.now();
      p.school = SCHOOL_NAME;
      delete p._pendingPhone;
      p.stage = FIELDS[0].key;
      return `✅ ยืนยันเบอร์สำเร็จค่ะ${r.mock ? ' (โหมดสาธิต)' : ''}\n\n${questionFor(p.stage, p)}`;
    }
    if (r.reason === 'expired')
      return '⏰ รหัสหมดอายุแล้วค่ะ พิมพ์ "ส่งรหัสใหม่" เพื่อขอรหัสใหม่';
    return '❌ รหัสไม่ถูกต้องค่ะ ลองพิมพ์รหัส 6 หลักอีกครั้ง หรือพิมพ์ "ส่งรหัสใหม่"';
  }

  if (p.stage === 'done') {
    return doneSummary(p);
  }

  // p.stage is a field key — record the answer (or skip) and move to the next one.
  const idx = fieldIndex(p.stage);
  const field = FIELDS[idx];
  const value = SKIP_KEYWORD.test(t) ? 'ไม่ระบุ' : t.slice(0, field.max);
  p[field.key] = value;
  if (field.key === 'fullName') {
    // Derive the name we address them by — their actual first name, not a
    // separately-asked nickname.
    p.nickname = value === 'ไม่ระบุ' ? 'นักเรียน' : extractFirstName(value);
  }

  const next = FIELDS[idx + 1];
  if (!next) {
    p.stage = 'done';
    p.completedAt = Date.now();
    // Persist to the cloud store for teacher lookup. Fire-and-forget: don't
    // make the student wait on a network call to get their "done" reply.
    // Skipped for demo sessions — see the `demo` param doc above.
    if (!p.demo) {
      persistProfile(userId, p).catch((err) =>
        console.error('[onboarding] persistProfile failed:', err),
      );
    }
    return doneSummary(p);
  }
  p.stage = next.key;
  return questionFor(p.stage, p);
}
