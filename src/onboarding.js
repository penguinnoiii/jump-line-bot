// Student "log in" gate: consent, then the full student profile from the
// brief's data spec, before the student can chat with the guidance LLM.
//   ข้อมูลพื้นฐาน (nickname, grade) · ความสนใจ · ความถนัด · ผลการเรียน · Skill ·
//   กิจกรรม · เป้าหมาย · โรงเรียน/สายที่สนใจ · ข้อจำกัดต่าง ๆ
//
// The live state machine below stays in-memory (fast, synchronous, per-turn).
// A completed (non-anonymous) profile is also persisted to the cloud store
// (src/store.js) so a guidance teacher can look it up later, grouped by room.

import { persistProfile } from './store.js';

const profiles = new Map(); // userId -> { stage, ...fields, anonymous, consentAt, completedAt }

const RESET_KEYWORD = /แก้ไขข้อมูล|เริ่มใหม่|เริ่มต้นใหม่|^reset$|ล้างข้อมูล/i;
const SKIP_KEYWORD = /^ข้าม$|^skip$|ไม่มี|ไม่ระบุ|ยังไม่แน่ใจ/i;
// Check "no" before "yes" — "ไม่ยินยอม" contains the substring "ยินยอม".
const CONSENT_NO = /ไม่ยินยอม|ไม่ตกลง|ไม่ยอมรับ|ไม่ok|ไม่โอเค|\bno\b/i;
const CONSENT_YES = /ยินยอม|ตกลง|ยอมรับ|โอเค|\bok\b|\byes\b|ได้เลย|ได้ค่ะ|ได้ครับ/i;

// The full student profile, in collection order. `question` may be a string
// or a function of the profile-so-far (for fields that reference earlier
// answers, e.g. the nickname).
const FIELDS = [
  {
    key: 'nickname',
    label: 'ชื่อเล่น',
    max: 40,
    question: 'เริ่มจากชื่อเล่นของน้องก่อนนะคะ (พิมพ์ชื่อเล่นได้เลย)',
  },
  {
    key: 'grade',
    label: 'ชั้น/ห้อง (ข้อมูลพื้นฐาน)',
    max: 40,
    question: (p) =>
      `ยินดีที่ได้รู้จักน้อง${p.nickname}ค่ะ 🎓 ตอนนี้เรียนอยู่ชั้น/ห้องอะไรคะ? (เช่น ม.6/3, ม.3/1, ปวช.ปี 2/2)`,
  },
  {
    key: 'interest',
    label: 'ความสนใจ',
    max: 200,
    question: 'น้องสนใจเรื่องหรือด้านไหนเป็นพิเศษคะ? (เช่น วิทยาศาสตร์, ศิลปะ, เทคโนโลยี, ธุรกิจ)',
  },
  {
    key: 'aptitude',
    label: 'ความถนัด',
    max: 200,
    question: 'แล้วคิดว่าตัวเองถนัดหรือทำได้ดีเรื่องอะไรบ้างคะ? (เช่น คำนวณเลข, เขียน, พูด, ลงมือทำ)',
  },
  {
    key: 'academicResults',
    label: 'ผลการเรียน',
    max: 200,
    question: 'ผลการเรียนตอนนี้เป็นยังไงบ้างคะ? (เช่น เกรดเฉลี่ยประมาณเท่าไหร่ หรือวิชาที่ทำได้ดี/ไม่ดี)',
  },
  {
    key: 'skills',
    label: 'Skill',
    max: 200,
    question: 'มีทักษะพิเศษอะไรที่ทำได้ไหมคะ? (เช่น ภาษาอังกฤษ, เขียนโปรแกรม, วาดรูป, เล่นดนตรี)',
  },
  {
    key: 'activities',
    label: 'กิจกรรม',
    max: 200,
    question: 'นอกเวลาเรียน ทำกิจกรรมอะไรบ้างคะ? (เช่น ชมรม, กีฬา, จิตอาสา, งานพาร์ทไทม์)',
  },
  {
    key: 'goals',
    label: 'เป้าหมาย',
    max: 200,
    question: 'เป้าหมายในอนาคตของน้องคืออะไรคะ? (เช่น อาชีพที่อยากทำ, มหาวิทยาลัยที่อยากเข้า)',
  },
  {
    key: 'schoolTrack',
    label: 'โรงเรียน/สายที่สนใจ',
    max: 200,
    question:
      'มีโรงเรียนหรือสายการเรียนที่สนใจเป็นพิเศษไหมคะ? (เช่น ชื่อโรงเรียน, สายวิทย์-คณิต, สายอาชีพ)',
  },
  {
    key: 'constraints',
    label: 'ข้อจำกัด',
    max: 200,
    question:
      'สุดท้าย มีข้อจำกัดอะไรที่อยากให้ Jump รู้ไว้ไหมคะ? (เช่น ค่าใช้จ่าย, ระยะทาง, สุขภาพ)',
  },
];

const WELCOME_MSG =
  'สวัสดีค่ะ 👋 ยินดีต้อนรับสู่ "Jump" ผู้ช่วยแนะแนวการศึกษา\n\n' +
  'ก่อนเริ่มใช้งาน ขอความยินยอมเก็บข้อมูลของน้อง (ข้อมูลพื้นฐาน ความสนใจ ความถนัด ผลการเรียน ' +
  'Skill กิจกรรม เป้าหมาย โรงเรียน/สายที่สนใจ และข้อจำกัดต่าง ๆ) ผ่านคำถามสั้น ๆ ประมาณ 10 ข้อ ' +
  'เพื่อให้คำแนะนำตรงกับตัวน้องมากที่สุด ใช้เฉพาะในการสนทนานี้เท่านั้น ข้อไหนไม่สะดวกตอบพิมพ์ "ข้าม" ได้ค่ะ\n' +
  '(ถ้าอายุต่ำกว่า 18 ปี แนะนำให้แจ้งผู้ปกครองให้ทราบด้วยนะคะ)\n\n' +
  'พิมพ์ "ยินยอม" เพื่อเริ่ม หรือ "ไม่ยินยอม" ถ้าไม่สะดวกให้ข้อมูล (ยังคุยกับบอทได้ แต่คำแนะนำจะเป็นแบบทั่วไป)';

const CONSENT_RETRY_MSG = 'รบกวนพิมพ์ "ยินยอม" หรือ "ไม่ยินยอม" ค่ะ 🙏';

const ANON_MODE_MSG =
  'รับทราบค่ะ 🙏 จะไม่เก็บข้อมูลส่วนตัวไว้นะคะ คุยกับ Jump ได้เลย แต่คำแนะนำอาจเป็นแบบทั่วไป ' +
  'เพราะยังไม่รู้ข้อมูลของน้อง ✨\n(พิมพ์ "แก้ไขข้อมูล" ได้ทุกเมื่อถ้าอยากกรอกข้อมูลภายหลัง)';

function fieldIndex(key) {
  return FIELDS.findIndex((f) => f.key === key);
}

function questionFor(fieldKey, profile) {
  const f = FIELDS[fieldIndex(fieldKey)];
  if (!f) return null;
  return typeof f.question === 'function' ? f.question(profile) : f.question;
}

function doneSummary(p) {
  const lines = FIELDS.map(
    (f) => `• ${f.label}: ${p[f.key] || 'ไม่ระบุ'}`,
  ).join('\n');
  return (
    `เรียบร้อยค่ะ ✅\n\n📋 ข้อมูลของน้อง${p.nickname}\n${lines}\n\n` +
    'ตอนนี้คุยกับ Jump ได้เลยค่ะ ลองถามอะไรก็ได้เกี่ยวกับการเรียนต่อ ✨\n' +
    '(พิมพ์ "แก้ไขข้อมูล" ได้ทุกเมื่อถ้าต้องการเริ่มกรอกใหม่)'
  );
}

export function isResetCommand(text) {
  return RESET_KEYWORD.test(String(text));
}

/** True once the student has completed onboarding (with or without consent). */
export function isOnboarded(userId) {
  const p = profiles.get(userId);
  return Boolean(p && p.stage === 'done');
}

/** @returns {object|null} the student's profile, or null if not onboarded. */
export function getProfile(userId) {
  const p = profiles.get(userId);
  return p && p.stage === 'done' ? p : null;
}

/** Thai-language summary of a profile's fields, for feeding to the LLM. */
export function profileSummaryForLLM(profile) {
  if (!profile || profile.anonymous) return null;
  return FIELDS.filter((f) => profile[f.key])
    .map((f) => `${f.label}: ${profile[f.key]}`)
    .join(' | ');
}

/**
 * Advance a user through the onboarding state machine by one message.
 * Always returns a reply string — call this whenever the user isn't
 * onboarded yet, or sends a reset command.
 */
export function handleOnboarding(userId, text) {
  const t = String(text).trim();

  if (RESET_KEYWORD.test(t)) {
    profiles.set(userId, { stage: 'consent' });
    return WELCOME_MSG;
  }

  let p = profiles.get(userId);
  if (!p) {
    p = { stage: 'consent' };
    profiles.set(userId, p);
    return WELCOME_MSG;
  }

  if (p.stage === 'consent') {
    if (CONSENT_NO.test(t)) {
      p.stage = 'done';
      p.anonymous = true;
      p.completedAt = Date.now();
      return ANON_MODE_MSG;
    }
    if (CONSENT_YES.test(t)) {
      p.stage = FIELDS[0].key;
      p.consentAt = Date.now();
      return questionFor(p.stage, p);
    }
    return CONSENT_RETRY_MSG;
  }

  if (p.stage === 'done') {
    return doneSummary(p);
  }

  // p.stage is a field key — record the answer (or skip) and move to the next one.
  const idx = fieldIndex(p.stage);
  const field = FIELDS[idx];
  p[field.key] = SKIP_KEYWORD.test(t) ? 'ไม่ระบุ' : t.slice(0, field.max);

  const next = FIELDS[idx + 1];
  if (!next) {
    p.stage = 'done';
    p.completedAt = Date.now();
    // Persist to the cloud store for teacher lookup. Fire-and-forget: don't
    // make the student wait on a network call to get their "done" reply.
    persistProfile(userId, p).catch((err) =>
      console.error('[onboarding] persistProfile failed:', err),
    );
    return doneSummary(p);
  }
  p.stage = next.key;
  return questionFor(p.stage, p);
}
