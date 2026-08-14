// Typhoon-powered guidance generation (SCB 10X Thai LLM, OpenAI-compatible API).
// Keeps a small in-memory conversation history per LINE user so the demo feels
// like a real multi-turn chat. History resets on restart — fine for a demo;
// swap for a store (Redis/DB) for production.

import OpenAI from 'openai';
import { SYSTEM_PROMPT } from './prompts.js';

const client = new OpenAI({
  apiKey: process.env.TYPHOON_API_KEY,
  baseURL: process.env.TYPHOON_BASE_URL || 'https://api.opentyphoon.ai/v1',
});

const MODEL = process.env.TYPHOON_MODEL || 'typhoon-v2.5-30b-a3b-instruct';

const histories = new Map(); // userId -> [{ role, content }, ...] (no system msg)
const MAX_TURNS = 8; // keep the last 8 exchanges (16 messages)

const FALLBACK_REPLY =
  'ขออภัยค่ะ ระบบมีปัญหาชั่วคราว ลองใหม่อีกครั้งนะคะ 🙏';

/**
 * Generate a guidance reply for a user's message.
 * @param {string} userId  LINE user id (keys the conversation history)
 * @param {string} userText  the user's message text
 * @returns {Promise<string>} reply text to send back over LINE
 */
export async function generateGuidance(userId, userText) {
  const history = histories.get(userId) || [];
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history,
    { role: 'user', content: userText },
  ];

  const completion = await client.chat.completions.create({
    model: MODEL,
    max_tokens: 1024,
    temperature: 0.4,
    messages,
  });

  const text = completion.choices?.[0]?.message?.content?.trim() || FALLBACK_REPLY;

  // Persist trimmed history (without the system message — it's re-added each turn).
  const updated = [
    ...history,
    { role: 'user', content: userText },
    { role: 'assistant', content: text },
  ].slice(-MAX_TURNS * 2);
  histories.set(userId, updated);

  return text;
}
