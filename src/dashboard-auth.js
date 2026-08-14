// Session tokens for the student self-service dashboard
// (public/dashboard.html — the student half of /dashboard).
//
// A student verifies their phone via the SAME AIS OTP flow used everywhere
// else in the app (src/ais.js requestOtp/verifyOtp), keyed by a throwaway
// random session id rather than their LINE userId (the dashboard doesn't
// know who they are yet at that point — that's the whole point of the OTP
// step). On success, the token below is scoped to exactly the LINE userId
// whose stored profile has that verified phone — never another student's.
//
// Tokens are persisted to Upstash (same store as student profiles) with a
// matching TTL, not kept only in process memory: Render's free tier restarts
// or spins the server down between requests, and a purely in-memory token
// map would silently invalidate a student's login mid-edit — they'd see
// their save fail with 401 for no reason they could tell. Falls back to an
// in-memory Map when Upstash isn't configured (same honest-mock pattern as
// store.js), where that restart caveat still applies.

import crypto from 'crypto';
import { cloudConfigured, pipeline } from './store.js';

const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
const TOKEN_TTL_SEC = 60 * 60;
const tokens = new Map(); // token -> { userId, expiresAt } (in-memory fallback only)

/** A random key to pass as the "userId" to ais.js's OTP functions before we
 * know which real student is verifying. */
export function newOtpSessionId() {
  return 'dash_' + crypto.randomBytes(12).toString('hex');
}

export async function issueStudentToken(userId) {
  const token = crypto.randomBytes(24).toString('hex');
  if (cloudConfigured()) {
    await pipeline([['SET', `jump:dashtoken:${token}`, userId, 'EX', String(TOKEN_TTL_SEC)]]);
  } else {
    tokens.set(token, { userId, expiresAt: Date.now() + TOKEN_TTL_MS });
  }
  return token;
}

/** @returns {Promise<string|null>} the LINE userId this token is scoped to, or null if invalid/expired. */
export async function verifyStudentToken(token) {
  if (!token) return null;
  if (cloudConfigured()) {
    const [{ result }] = await pipeline([['GET', `jump:dashtoken:${token}`]]);
    return result || null;
  }
  const entry = tokens.get(token);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    tokens.delete(token);
    return null;
  }
  return entry.userId;
}
