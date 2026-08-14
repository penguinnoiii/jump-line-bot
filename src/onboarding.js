// Student "log in" gate: consent → nickname → grade → interest, before the
// student can chat with the guidance LLM. Matches the brief's user flow
// ("นักเรียน + ผู้ปกครองเข้าสู่ระบบ > Consent > กรอกข้อมูล").
//
// In-memory per LINE user — resets on restart; fine for a demo, swap for a
// store (Redis/DB) for production.

const profiles = new Map(); // userId -> { stage, nickname, grade, interest, anonymous, consentAt, completedAt }

const RESET_KEYWORD = /แก้ไขข้อมูล|เริ่มใหม่|เริ่มต้นใหม่|^reset$|ล้างข้อมูล/i;
// Check "no" before "yes" — "ไม่ยินยอม" contains the substring "ยินยอม".
const CONSENT_NO = /ไม่ยินยอม|ไม่ตกลง|ไม่ยอมรับ|ไม่ok|ไม่โอเค|\bno\b/i;
const CONSENT_YES = /ยินยอม|ตกลง|ยอมรับ|โอเค|\bok\b|\byes\b|ได้เลย|ได้ค่ะ|ได้ครับ/i;

const WELCOME_MSG =
  'สวัสดีค่ะ 👋 ยินดีต้อนรับสู่ "Jump" ผู้ช่วยแนะแนวการศึกษา\n\n' +
  'ก่อนเริ่มใช้งาน ขอความยินยอมเก็บข้อมูลพื้นฐาน (ชื่อเล่น ระดับชั้น ความสนใจ) ' +
  'เพื่อให้คำแนะนำตรงกับตัวน้องมากขึ้นค่ะ ใช้เฉพาะในการสนทนานี้เท่านั้น\n' +
  '(ถ้าอายุต่ำกว่า 18 ปี แนะนำให้แจ้งผู้ปกครองให้ทราบด้วยนะคะ)\n\n' +
  'พิมพ์ "ยินยอม" เพื่อเริ่ม หรือ "ไม่ยินยอม" ถ้าไม่สะดวกให้ข้อมูล (ยังคุยกับบอทได้ แต่คำแนะนำจะเป็นแบบทั่วไป)';

const CONSENT_RETRY_MSG = 'รบกวนพิมพ์ "ยินยอม" หรือ "ไม่ยินยอม" ค่ะ 🙏';

const ASK_NICKNAME = 'ขอบคุณค่ะ 😊 เริ่มจากชื่อเล่นของน้องก่อนนะคะ (พิมพ์ชื่อเล่นได้เลย)';

const askGrade = (nickname) =>
  `ยินดีที่ได้รู้จักน้อง${nickname}ค่ะ 🎓 ตอนนี้เรียนอยู่ชั้นอะไรคะ? (เช่น ม.3, ม.6, ปวช.ปี 2)`;

const ASK_INTEREST =
  'แล้วน้องสนใจสายการเรียนหรือด้านไหนเป็นพิเศษคะ? (เช่น วิทย์-คณิต, ศิลป์-ภาษา, สายอาชีพ, หรือยังไม่แน่ใจก็บอกได้นะคะ)';

const doneSummary = (p) =>
  `เรียบร้อยค่ะ ✅\n\n📋 ข้อมูลของน้อง${p.nickname}\n• ระดับชั้น: ${p.grade}\n• สนใจ: ${p.interest}\n\n` +
  'ตอนนี้คุยกับ Jump ได้เลยค่ะ ลองถามอะไรก็ได้เกี่ยวกับการเรียนต่อ ✨\n' +
  '(พิมพ์ "แก้ไขข้อมูล" ได้ทุกเมื่อถ้าต้องการเริ่มกรอกใหม่)';

const ANON_MODE_MSG =
  'รับทราบค่ะ 🙏 จะไม่เก็บข้อมูลส่วนตัวไว้นะคะ คุยกับ Jump ได้เลย แต่คำแนะนำอาจเป็นแบบทั่วไป ' +
  'เพราะยังไม่รู้ข้อมูลของน้อง ✨\n(พิมพ์ "แก้ไขข้อมูล" ได้ทุกเมื่อถ้าอยากกรอกข้อมูลภายหลัง)';

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

  switch (p.stage) {
    case 'consent':
      if (CONSENT_NO.test(t)) {
        p.stage = 'done';
        p.anonymous = true;
        p.completedAt = Date.now();
        return ANON_MODE_MSG;
      }
      if (CONSENT_YES.test(t)) {
        p.stage = 'nickname';
        p.consentAt = Date.now();
        return ASK_NICKNAME;
      }
      return CONSENT_RETRY_MSG;

    case 'nickname':
      p.nickname = t.slice(0, 50) || 'นักเรียน';
      p.stage = 'grade';
      return askGrade(p.nickname);

    case 'grade':
      p.grade = t.slice(0, 50);
      p.stage = 'interest';
      return ASK_INTEREST;

    case 'interest':
      p.interest = t.slice(0, 100);
      p.stage = 'done';
      p.completedAt = Date.now();
      return doneSummary(p);

    default:
      // Already done — shouldn't normally be called in this state.
      return doneSummary(p);
  }
}
