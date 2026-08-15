// Password-gated access for the guidance-teacher dashboard.
//
// This is demo-grade auth: one shared password, opaque bearer tokens held
// in memory (reset on restart, expire after 1 hour). Good enough to gate a
// hackathon demo behind HTTPS; a real deployment would want per-teacher
// accounts, a hashed password, and rate limiting.
//
// Set TEACHER_PASSWORD in the environment before sharing this publicly —
// without it, a documented default is used so the demo still works out of
// the box.

import crypto from 'crypto';

const DEFAULT_PASSWORD = 'jump-demo-2026';
const PASSWORD = process.env.TEACHER_PASSWORD || DEFAULT_PASSWORD;

if (!process.env.TEACHER_PASSWORD) {
  console.warn(
    `[teacher-auth] TEACHER_PASSWORD not set — using the default demo password "${DEFAULT_PASSWORD}". ` +
      'Set TEACHER_PASSWORD before sharing this URL publicly.',
  );
}

const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
const tokens = new Map(); // token -> expiresAt

/** @returns {string|null} a bearer token on success, or null on wrong password. */
export function login(password) {
  if (password !== PASSWORD) return null;
  const token = crypto.randomBytes(24).toString('hex');
  tokens.set(token, Date.now() + TOKEN_TTL_MS);
  return token;
}

/** The active password, but ONLY when it's the public default (no real
 * TEACHER_PASSWORD configured) — safe to print on the public demo page so
 * visitors can try the teacher login themselves. Returns null once a real
 * secret is set, so that value is never exposed over HTTP. */
export function demoPasswordHint() {
  return process.env.TEACHER_PASSWORD ? null : DEFAULT_PASSWORD;
}

export function verifyToken(token) {
  const exp = tokens.get(token);
  if (!exp) return false;
  if (Date.now() > exp) {
    tokens.delete(token);
    return false;
  }
  return true;
}
