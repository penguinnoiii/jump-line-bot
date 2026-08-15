// Gemini-powered guidance generation (Google Gemini API via @google/genai).
// Grounds answers in live web search results when the question needs current
// facts (see src/search.js), and keeps a small in-memory conversation history
// per LINE user. History resets on restart — fine for a demo; swap for a
// store (Redis/DB) for production.

import { GoogleGenAI } from '@google/genai';
import { SYSTEM_PROMPT } from './prompts.js';
import { needsWebSearch, webSearch } from './search.js';
import { profileSummaryForLLM } from './onboarding.js';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// 'gemini-2.5-flash' (the previous default) was retired for new API keys.
// 'gemini-flash-latest' is current but was hitting repeated 503 "high
// demand" errors when tested — 'gemini-flash-lite-latest' verified reliable
// (multiple consecutive successful calls). Still an auto-updating alias, so
// it won't hit the same dated-version deprecation problem later.
const MODEL = process.env.GEMINI_MODEL || 'gemini-flash-lite-latest';

// Gemini's Content role must be exactly 'user' or 'model' (no 'system' or
// 'assistant') — history is stored in that shape directly so no per-call
// conversion is needed.
const histories = new Map(); // userId -> [{ role: 'user'|'model', parts: [{text}] }, ...]
const MAX_TURNS = 8; // keep the last 8 exchanges (16 messages)

const FALLBACK_REPLY = 'ขออภัยค่ะ ระบบมีปัญหาชั่วคราว ลองใหม่อีกครั้งนะคะ 🙏';

/** Clear a user's chat history (e.g. when they restart onboarding). */
export function resetHistory(userId) {
  histories.delete(userId);
}

/**
 * Generate a guidance reply for a user's message.
 * @param {string} userId  LINE user id (keys the conversation history)
 * @param {string} userText  the user's message text
 * @param {object|null} [profile]  onboarding profile (nickname/grade/interest),
 *   or null/anonymous for a student who declined consent
 * @returns {Promise<{text: string, sources: {title:string,url:string}[]}>}
 */
export async function generateGuidance(userId, userText, profile = null) {
  const history = histories.get(userId) || [];

  // Gemini takes exactly one systemInstruction (config-level, not a message
  // in `contents`) — profile context and search context are folded into it
  // the same way the old Typhoon single-system-message workaround did, since
  // that shape (one combined instruction block) is the reliable one anyway.
  let systemContent = SYSTEM_PROMPT;

  const profileSummary = profileSummaryForLLM(profile);
  if (profileSummary) {
    systemContent +=
      `\n\n---\nข้อมูลนักเรียนที่คุยด้วย (จากขั้นตอนกรอกข้อมูล): ${profileSummary}. ` +
      'ทุกคำตอบต้องผูกกับข้อมูลนี้อย่างชัดเจน โดยเฉพาะ "เป้าหมาย" และ "โรงเรียน/สายที่สนใจ" ของนักเรียน — ' +
      'ห้ามให้คำแนะนำแบบทั่วไปเฉย ๆ (เช่น checklist มาตรฐานที่ใช้ได้กับทุกคน) แต่ให้เริ่มคำตอบ 1-2 ประโยคแรก ' +
      'ด้วยการเชื่อมโยงกับเป้าหมาย/สายที่สนใจ/ความถนัดของนักเรียนคนนี้โดยเฉพาะ แล้วค่อยให้รายละเอียด ' +
      'เรียกนักเรียนด้วยชื่อจริง ("ชื่อที่ควรเรียก") ตามความเหมาะสม ไม่ใช่ชื่อเต็ม และไม่ต้องถามข้อมูลนี้ซ้ำ เว้นแต่จำเป็นจริง ๆ ' +
      '("ไม่ระบุ" แปลว่านักเรียนข้ามคำถามนั้น ไม่ต้องนำมาพูดถึง)';
  }

  // Rolling summary persisted across sessions (src/onboarding.js's
  // updateConversationSummary) — gives continuity even after this server
  // restarts and wipes the in-memory `histories` Map below, or when the
  // student logs back in on a new day with no in-memory history at all.
  if (profile?.conversationSummary) {
    systemContent +=
      `\n\n---\nสรุปสิ่งที่เคยคุยกับนักเรียนคนนี้จากครั้งก่อน ๆ: ${profile.conversationSummary}\n` +
      'ใช้เป็นบริบทเพื่อความต่อเนื่อง (เช่น ถ้าเคยคุยเรื่องเป้าหมายหรือคำถามค้างไว้ ให้ต่อยอดได้เลย) ' +
      'แต่ไม่ต้องพูดถึงว่า "จากที่เคยคุยกันไว้" ตรง ๆ เว้นแต่จะเกี่ยวข้องกับคำถามปัจจุบันจริง ๆ';
  }

  let sources = [];
  if (needsWebSearch(userText)) {
    const { results } = await webSearch(userText);
    if (results.length) {
      sources = results;
      const context = results
        .map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.snippet}`)
        .join('\n\n');
      systemContent +=
        '\n\n---\nผลการค้นเว็บล่าสุด (ใหม่กว่าความรู้ภายในของคุณ) ใช้ประกอบคำตอบและอ้างอิงด้วยหมายเลข ' +
        '[1] [2] ... ตามแหล่งที่มา หากข้อมูลด้านล่างไม่ครอบคลุมคำถาม ให้บอกตามตรงและแนะนำให้ตรวจสอบจากลิงก์:\n\n' +
        context;
    }
  }

  const contents = [
    ...history,
    { role: 'user', parts: [{ text: userText }] },
  ];

  const response = await ai.models.generateContent({
    model: MODEL,
    contents,
    config: {
      systemInstruction: systemContent,
      temperature: 0.4,
      maxOutputTokens: 700, // shorter, chat-style replies (see prompts.js)
      // NOTE: thinkingConfig (used to disable Gemini 2.5's default
      // "thinking" tokens) was removed — it made the *-lite models reject
      // the request outright with a 400 "invalid argument". Re-add it,
      // scoped to models that actually support it, if a future default
      // model needs the same fix.
    },
  });

  let text = response.text?.trim() || FALLBACK_REPLY;

  // Safety net: the model occasionally emits a bare [1]-style citation marker
  // even when told not to. If no real search happened, there is nothing for
  // it to reference — strip it deterministically rather than rely on the
  // prompt alone (the prompt already forbids fabricated URLs/domains, which
  // testing showed it reliably follows; this covers the remaining case).
  if (sources.length === 0) {
    text = text.replace(/\s*\[\d+\]/g, '').trim();
  }

  // Persist trimmed history — user/model turns only. The search-context
  // block is NOT stored, so every turn searches fresh instead of relying on
  // results that may already be stale by the next question.
  const updated = [
    ...history,
    { role: 'user', parts: [{ text: userText }] },
    { role: 'model', parts: [{ text }] },
  ].slice(-MAX_TURNS * 2);
  histories.set(userId, updated);

  return { text, sources };
}

/**
 * Fold the most recent exchange into a short rolling summary of what this
 * student is interested in / has been asking about — persisted onto their
 * profile (src/onboarding.js's updateConversationSummary) so it survives
 * server restarts and gives the dashboard/PDF something human-readable
 * without dumping the raw chat log. Call fire-and-forget after a guidance
 * reply; never lets a failure here affect the actual chat reply.
 * @param {string} userId
 * @param {string|null} [existingSummary] the profile's current summary, if any
 * @returns {Promise<string|null>} the updated summary, or null on failure/no history
 */
export async function summarizeConversation(userId, existingSummary = null) {
  const history = histories.get(userId) || [];
  if (history.length === 0) return null;

  const recent = history
    .slice(-6)
    .map((h) => `${h.role === 'user' ? 'นักเรียน' : 'Numpa'}: ${h.parts[0]?.text || ''}`)
    .join('\n');

  const prompt =
    'สรุปสั้น ๆ ไม่เกิน 3 ประโยค ว่านักเรียนคนนี้สนใจเรื่องอะไร มีเป้าหมายอะไร หรือถามอะไรไปบ้าง ' +
    'จากบทสนทนานี้ เพื่อให้ครูแนะแนวหรือผู้ปกครองอ่านแล้วเข้าใจได้เร็ว ตอบเป็นข้อความธรรมดา ไม่ต้องมี bullet' +
    (existingSummary ? `\n\nสรุปเดิมจากก่อนหน้านี้ (ต่อยอด/ปรับปรุงได้): ${existingSummary}` : '') +
    `\n\nบทสนทนาล่าสุด:\n${recent}`;

  try {
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: { temperature: 0.3, maxOutputTokens: 200 },
    });
    return response.text?.trim() || null;
  } catch (err) {
    console.error('[llm] summarizeConversation failed:', err);
    return null;
  }
}

/**
 * Cheap classifier for the demo site's "แจ้งเตือนตามความสนใจ" feature: decide
 * whether this one exchange reached a clear, confirmed conclusion about
 * something new the student likes — either the student stated it directly,
 * or Numpa asked whether they were interested and the student agreed. Vague
 * or unconfirmed mentions ("อาจจะชอบ...") must NOT count, by design — only a
 * clear yes, no matter how small the interest is (liking a game counts just
 * as much as naming a whole career track).
 * @param {string} userText  the student's latest message
 * @param {string} replyText  Numpa's reply to it
 * @param {string[]} [knownInterests]  already-recorded interests, so the
 *   model doesn't re-flag the same thing
 * @returns {Promise<string|null>} a short Thai interest tag, or null
 */
export async function extractConfirmedInterest(userText, replyText, knownInterests = []) {
  const prompt =
    'อ่านข้อความคู่นี้ระหว่างนักเรียนกับ Numpa (แชทบอทแนะแนวการศึกษา) แล้วตัดสินว่านักเรียน ' +
    '"ยืนยันความสนใจใหม่" อย่างชัดเจนหรือไม่ นับเป็นการยืนยันเฉพาะกรณี: ' +
    '(1) นักเรียนบอกเองตรง ๆ ว่าชอบ/สนใจอะไร หรือ ' +
    '(2) Numpa ถามว่าสนใจเรื่องนี้ไหม แล้วนักเรียนตอบรับชัดเจน ' +
    'ความสนใจเล็กน้อยแค่ไหนก็นับ (เช่น ชอบวาดรูป ชอบเกม ชอบสัตว์) ไม่ต้องเป็นสายเรียน/อาชีพใหญ่ ๆ เท่านั้น ' +
    'ถ้าเป็นแค่การถามข้อมูลทั่วไป หรือพูดคลุมเครือไม่ชัดเจน (เช่น "อาจจะ", "ไม่แน่ใจ") ห้ามนับ ให้ตอบคำเดียวว่า "ไม่มี"' +
    (knownInterests.length
      ? `\n\nความสนใจที่บันทึกไว้แล้ว: ${knownInterests.join(', ')} — ถ้าซ้ำกับเรื่องเดิม ให้ตอบ "ไม่มี"`
      : '') +
    `\n\nนักเรียน: ${userText}\nJump: ${replyText}\n\n` +
    'ถ้ามีการยืนยันความสนใจใหม่จริง ให้ตอบเป็นวลีสั้น ๆ ไม่เกิน 6 คำ (เช่น "ชอบวาดรูป", "สนใจหุ่นยนต์") ' +
    'ห้ามมีคำอธิบายอื่นนอกจากวลีนั้น หรือคำว่า "ไม่มี"';

  try {
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: { temperature: 0.1, maxOutputTokens: 30 },
    });
    const out = response.text?.trim() || '';
    if (!out || out === 'ไม่มี' || out.length > 40) return null;
    return out;
  } catch (err) {
    console.error('[llm] extractConfirmedInterest failed:', err);
    return null;
  }
}
