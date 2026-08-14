// Typhoon-powered guidance generation (SCB 10X Thai LLM, OpenAI-compatible API).
// Grounds answers in live web search results when the question needs current
// facts (see src/search.js), and keeps a small in-memory conversation history
// per LINE user. History resets on restart — fine for a demo; swap for a
// store (Redis/DB) for production.

import OpenAI from 'openai';
import { SYSTEM_PROMPT } from './prompts.js';
import { needsWebSearch, webSearch } from './search.js';

const client = new OpenAI({
  apiKey: process.env.TYPHOON_API_KEY,
  baseURL: process.env.TYPHOON_BASE_URL || 'https://api.opentyphoon.ai/v1',
});

const MODEL = process.env.TYPHOON_MODEL || 'typhoon-v2.5-30b-a3b-instruct';

const histories = new Map(); // userId -> [{ role, content }, ...] (no system msg)
const MAX_TURNS = 8; // keep the last 8 exchanges (16 messages)

const FALLBACK_REPLY = 'ขออภัยค่ะ ระบบมีปัญหาชั่วคราว ลองใหม่อีกครั้งนะคะ 🙏';

/**
 * Generate a guidance reply for a user's message.
 * @param {string} userId  LINE user id (keys the conversation history)
 * @param {string} userText  the user's message text
 * @returns {Promise<{text: string, sources: {title:string,url:string}[]}>}
 */
export async function generateGuidance(userId, userText) {
  const history = histories.get(userId) || [];
  const messages = [{ role: 'system', content: SYSTEM_PROMPT }, ...history];

  let sources = [];
  if (needsWebSearch(userText)) {
    const { results } = await webSearch(userText);
    if (results.length) {
      sources = results;
      const context = results
        .map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.snippet}`)
        .join('\n\n');
      messages.push({
        role: 'system',
        content:
          'ผลการค้นเว็บล่าสุด (ใหม่กว่าความรู้ภายในของคุณ) ใช้ประกอบคำตอบและอ้างอิงด้วยหมายเลข ' +
          '[1] [2] ... ตามแหล่งที่มา หากข้อมูลด้านล่างไม่ครอบคลุมคำถาม ให้บอกตามตรงและแนะนำให้ตรวจสอบจากลิงก์:\n\n' +
          context,
      });
    }
  }

  messages.push({ role: 'user', content: userText });

  const completion = await client.chat.completions.create({
    model: MODEL,
    max_tokens: 1024,
    temperature: 0.4,
    messages,
  });

  let text = completion.choices?.[0]?.message?.content?.trim() || FALLBACK_REPLY;

  // Safety net: the model occasionally emits a bare [1]-style citation marker
  // even when told not to. If no real search happened, there is nothing for
  // it to reference — strip it deterministically rather than rely on the
  // prompt alone (the prompt already forbids fabricated URLs/domains, which
  // testing showed it reliably follows; this covers the remaining case).
  if (sources.length === 0) {
    text = text.replace(/\s*\[\d+\]/g, '').trim();
  }

  // Persist trimmed history — user/assistant turns only. The search-context
  // block is NOT stored, so every turn searches fresh instead of relying on
  // results that may already be stale by the next question.
  const updated = [
    ...history,
    { role: 'user', content: userText },
    { role: 'assistant', content: text },
  ].slice(-MAX_TURNS * 2);
  histories.set(userId, updated);

  return { text, sources };
}
