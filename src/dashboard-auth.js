// Session tokens for the student self-service dashboard
// (public/dashboard.html — the student half of /dashboard).
//
// A student verifies their phone via the SAME AIS OTP flow used everywhere
// else in the app (src/ais.js requestOtp/verifyOtp), keyed by a throwaway
// random session id rather than their LINE userId (the dashboard doesn't
// know who they are yet at that point — that's the whole point of the OTP
// step). On success, the token below is scoped to exactly the LINE userId
// whose stored profile has that verified phone — never another student's.

import crypto from 'crypto';

const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
const tokens = new Map(); // token -> { userId, expiresAt }

/** A random key to pass as the "userId" to ais.js's OTP functions before we
 * know which real student is verifying. */
export function newOtpSessionId() {
  return 'dash_' + crypto.randomBytes(12).toString('hex');
}

export function issueStudentToken(userId) {
  const token = crypto.randomBytes(24).toString('hex');
  tokens.set(token, { userId, expiresAt: Date.now() + TOKEN_TTL_MS });
  return token;
}

/** @returns {string|null} the LINE userId this token is scoped to, or null if invalid/expired. */
export function verifyStudentToken(token) {
  const entry = tokens.get(token);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    tokens.delete(token);
    return null;
  }
  return entry.userId;
}
