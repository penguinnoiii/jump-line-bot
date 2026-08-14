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

const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

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
      // Gemini 2.5's "thinking" is on by default and spends maxOutputTokens
      // on invisible reasoning tokens before the visible reply — testing
      // showed this can silently eat the whole budget and return an EMPTY
      // reply for short, non-technical chat questions that don't need deep
      // reasoning. Disabled for fast, reliable, short chat-style replies.
      thinkingConfig: { thinkingBudget: 0 },
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
