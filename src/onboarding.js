// Student "log in" gate: consent, then 5 general-info questions, before the
// student can chat with the guidance LLM.
//   ชื่อ-นามสกุล (full name → addressed by first name) · โรงเรียน · รหัสนักเรียน ·
//   ชั้น/ห้อง (also used to group students by room for the teacher dashboard) ·
//   ความสนใจ/เป้าหมาย
//
// The live state machine below stays in-memory (fast, synchronous, per-turn).
// A completed (non-anonymous) profile is also persisted to the cloud store
// (src/store.js) so a guidance teacher can look it up later, grouped by room.
//
// AIS phone verification (src/ais.js) is a separate, standalone flow — a
// student can verify before, during, or after logging in. Whenever either
// side changes, syncVerifiedPhone() links the two: the verified number gets
// attached to the student's profile and re-persisted, so the teacher
// dashboard shows verification status without a dedicated login question.

import { persistProfile } from './store.js';
import { getVerifiedPhone, maskPhone } from './ais.js';

const profiles = new Map(); // userId -> { stage, ...fields, nickname, anonymous, consentAt, completedAt }

const RESET_KEYWORD =
  /แก้ไขข้อมูล|เริ่มใหม่|เริ่มต้นใหม่|^reset$|ล้างข้อมูล|เข้าสู่ระบบ|log ?in|sign ?in/i;
const SKIP_KEYWORD = /^ข้าม$|^skip$|ไม่มี|ไม่ระบุ|ยังไม่แน่ใจ/i;
// Check "no" before "yes" — "ไม่ยินยอม" contains the substring "ยินยอม".
const CONSENT_NO = /ไม่ยินยอม|ไม่ตกลง|ไม่ยอมรับ|ไม่ok|ไม่โอเค|\bno\b/i;
const CONSENT_YES = /ยินยอม|ตกลง|ยอมรับ|โอเค|\bok\b|\byes\b|ได้เลย|ได้ค่ะ|ได้ครับ/i;

/** First token of a full name — used to address the student, Thai given-name convention. */
function extractFirstName(fullName) {
  const first = String(fullName).trim().split(/\s+/)[0];
  return first || 'นักเรียน';
}

// The 5-question login profile, in collection order. `question` may be a
// string or a function of the profile-so-far (for fields that reference
// earlier answers, e.g. the student's first name).
const FIELDS = [
  {
    key: 'fullName',
    label: 'ชื่อ-นามสกุล',
    max: 80,
    question: 'เริ่มจากชื่อ-นามสกุลเต็มของน้องก่อนนะคะ (เช่น สมชาย ใจดี)',
  },
  {
    key: 'school',
    label: 'โรงเรียน',
    max: 100,
    question: (p) => `ยินดีที่ได้รู้จัก${p.nickname}ค่ะ 😊 ตอนนี้เรียนอยู่โรงเรียนอะไรคะ?`,
  },
  {
    key: 'studentId',
    label: 'รหัสนักเรียน',
    max: 40,
    question: 'รหัสนักเรียนของน้องคืออะไรคะ?',
  },
  {
    key: 'grade',
    label: 'ชั้น/ห้อง',
    max: 40,
    question: 'เรียนอยู่ชั้น/ห้องอะไรคะ? (เช่น ม.6/3, ม.3/1, ปวช.ปี 2/2)',
  },
  {
    key: 'interest',
    label: 'ความสนใจ/เป้าหมาย',
    max: 200,
    question:
      'สุดท้าย สนใจเรียนต่อสายไหน หรือมีเป้าหมายอะไรเป็นพิเศษไหมคะ? (พิมพ์ "ข้าม" ได้ถ้ายังไม่แน่ใจ)',
  },
];

const WELCOME_MSG =
  'สวัสดีค่ะ 👋 นี่คือ "Jump" ผู้ช่วยแนะแนวการศึกษา ทำอะไรได้บ้าง:\n' +
  '🔎 ค้นหา/เปรียบเทียบโรงเรียน สายการเรียน ทุนการศึกษา\n' +
  '🎯 แนะแนวเฉพาะบุคคล ตามข้อมูลของน้อง\n' +
  '🔐 ยืนยันตัวตนผ่านเครือข่าย AIS (เบอร์โทร/OTP)\n' +
  '💬 ถามได้ทุกเรื่องเกี่ยวกับการเรียนต่อ ตลอด 24 ชม.\n\n' +
  'ก่อนเริ่ม ขอเข้าสู่ระบบด้วยคำถามทั่วไปสั้น ๆ 5 ข้อ (ชื่อ-นามสกุล, โรงเรียน, รหัสนักเรียน, ' +
  'ชั้น/ห้อง, ความสนใจ) เพื่อให้คำแนะนำตรงจุดขึ้นค่ะ ใช้เฉพาะในการสนทนานี้เท่านั้น ' +
  'ข้อไหนไม่สะดวกตอบพิมพ์ "ข้าม" ได้\n' +
  '(ถ้าอายุต่ำกว่า 18 ปี แนะนำให้แจ้งผู้ปกครองให้ทราบด้วยนะคะ)\n\n' +
  'พิมพ์ "ยินยอม" เพื่อเข้าสู่ระบบ หรือ "ไม่ยินยอม" ถ้าไม่สะดวกให้ข้อมูล (ยังคุยกับบอทได้ แต่คำแนะนำจะเป็นแบบทั่วไป)';

const CONSENT_RETRY_MSG = 'รบกวนพิมพ์ "ยินยอม" หรือ "ไม่ยินยอม" ค่ะ 🙏';

const ANON_MODE_MSG =
  'รับทราบค่ะ 🙏 จะไม่เก็บข้อมูลส่วนตัวไว้นะคะ คุยกับ Jump ได้เลย แต่คำแนะนำอาจเป็นแบบทั่วไป ' +
  'เพราะยังไม่รู้ข้อมูลของน้อง ✨\n(พิมพ์ "เข้าสู่ระบบ" ได้ทุกเมื่อถ้าอยากกรอกข้อมูลภายหลัง)';

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
  const verifyLine = p.phoneVerified
    ? `• เบอร์ที่ยืนยันแล้ว: ${maskPhone(p.phone)} ✅ (ผ่าน AIS)`
    : '• ยืนยันตัวตน: ยังไม่ได้ยืนยันเบอร์ (พิมพ์เบอร์โทร หรือ "ขอ OTP <เบอร์>" ได้ทุกเมื่อ)';
  return (
    `เรียบร้อยค่ะ ✅\n\n📋 ข้อมูลของ${p.nickname}\n${lines}\n${verifyLine}\n\n` +
    'ตอนนี้คุยกับ Jump ได้เลยค่ะ ลองถามอะไรก็ได้เกี่ยวกับการเรียนต่อ ✨\n' +
    '(พิมพ์ "เข้าสู่ระบบ" ได้ทุกเมื่อถ้าต้องการเริ่มกรอกใหม่)'
  );
}

/**
 * Attach a verified phone (from src/ais.js) onto a completed profile, and
 * re-persist to the cloud store if it changed anything. Works regardless of
 * whether verification happened before or after login. No-op for a profile
 * that opted out of data collection (anonymous).
 */
function syncVerifiedPhone(userId, p) {
  if (!p || p.stage !== 'done' || p.anonymous) return;
  const v = getVerifiedPhone(userId);
  if (!v || p.phone === v.phone) return;
  p.phone = v.phone;
  p.phoneVerified = true;
  p.phoneVerifiedAt = v.verifiedAt;
  persistProfile(userId, p).catch((err) =>
    console.error('[onboarding] re-persist after phone link failed:', err),
  );
}

/** Call right after a successful AIS verification, so an already-logged-in
 * student's record (and the teacher dashboard) updates immediately instead
 * of waiting for their next message. */
export function syncPhoneIfOnboarded(userId) {
  syncVerifiedPhone(userId, profiles.get(userId));
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
  if (!p || p.stage !== 'done') return null;
  syncVerifiedPhone(userId, p);
  return p;
}

/** Thai-language summary of a profile's fields, for feeding to the LLM. */
export function profileSummaryForLLM(profile) {
  if (!profile || profile.anonymous) return null;
  const parts = [`ชื่อที่ควรเรียก (ชื่อจริง): ${profile.nickname}`];
  FIELDS.forEach((f) => {
    if (profile[f.key]) parts.push(`${f.label}: ${profile[f.key]}`);
  });
  parts.push(
    `สถานะยืนยันตัวตน: ${profile.phoneVerified ? 'ยืนยันเบอร์แล้วผ่าน AIS' : 'ยังไม่ได้ยืนยันเบอร์'}`,
  );
  return parts.join(' | ');
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
    // Link an AIS-verified phone if the student already verified before
    // finishing login (see syncVerifiedPhone for the reverse order).
    const verifiedPhone = getVerifiedPhone(userId);
    if (verifiedPhone) {
      p.phone = verifiedPhone.phone;
      p.phoneVerified = true;
      p.phoneVerifiedAt = verifiedPhone.verifiedAt;
    }
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
