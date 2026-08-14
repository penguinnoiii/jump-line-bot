// AIS Open API — identity services for the Jump Thailand user flow.
//
//   • Number Verification — confirm a phone number silently on the AIS network
//     (the "ยืนยันตัวตน / ยืนยันเบอร์" step). GSMA/CAMARA standard.
//   • OTP API — send a one-time password by SMS and verify it (2-step).
//
// The Jump Thailand AIS page lists both services but not the endpoint/auth
// details — those are issued by AIS (jumpthailand@ais.co.th). So EVERYTHING
// here is overridable by env var, and if no credentials are configured the
// module runs in MOCK mode so the demo still works end to end.
//
// To go live, set (from AIS) any of the AIS_* vars documented in .env.example.

// --- Number Verification config ---
const NV_BASE = process.env.AIS_NUMVERIFY_BASE_URL || '';
const NV_PATH =
  process.env.AIS_NUMVERIFY_VERIFY_PATH || '/number-verification/v0/verify';

// --- OTP config (falls back to the Number Verification base + token) ---
const OTP_BASE =
  process.env.AIS_OTP_BASE_URL || process.env.AIS_NUMVERIFY_BASE_URL || '';
const OTP_REQUEST_PATH = process.env.AIS_OTP_REQUEST_PATH || '/otp/v1/request';
const OTP_VERIFY_PATH = process.env.AIS_OTP_VERIFY_PATH || '/otp/v1/verify';
const OTP_TTL_MS = 5 * 60 * 1000;

const hasOAuthCreds = () =>
  process.env.AIS_CLIENT_ID &&
  process.env.AIS_CLIENT_SECRET &&
  process.env.AIS_TOKEN_URL;

export const numVerifyConfigured = () =>
  Boolean(NV_BASE && (process.env.AIS_NUMVERIFY_TOKEN || hasOAuthCreds()));

export const otpConfigured = () =>
  Boolean(
    OTP_BASE &&
      (process.env.AIS_OTP_TOKEN ||
        process.env.AIS_NUMVERIFY_TOKEN ||
        hasOAuthCreds()),
  );

// In-memory pending OTPs: userId -> { phone, ref, code, expiresAt }.
// Resets on restart — fine for a demo; use a store for production.
const pendingOtp = new Map();
export const hasPendingOtp = (userId) => pendingOtp.has(userId);

/** Normalise a Thai mobile number in free text to E.164 (+66…), or null. */
export function extractThaiMobile(text) {
  const digits = String(text).replace(/[^\d+]/g, '');
  let m;
  if ((m = digits.match(/^0(\d{9})$/))) return '+66' + m[1];
  if ((m = digits.match(/^\+?66(\d{9})$/))) return '+66' + m[1];
  return null;
}

const maskPhone = (p) => p.replace(/(\+66\d{2})\d{5}(\d{2})/, '$1xxxxx$2');

async function getAccessToken(directToken) {
  if (directToken) return directToken;
  const body = new URLSearchParams({ grant_type: 'client_credentials' });
  if (process.env.AIS_SCOPE) body.set('scope', process.env.AIS_SCOPE);
  const basic = Buffer.from(
    `${process.env.AIS_CLIENT_ID}:${process.env.AIS_CLIENT_SECRET}`,
  ).toString('base64');
  const res = await fetch(process.env.AIS_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  if (!res.ok) throw new Error(`AIS token endpoint ${res.status}`);
  return (await res.json()).access_token;
}

// --- Number Verification -----------------------------------------------------

/** @returns {Promise<{verified:boolean, mock:boolean, error?:string}>} */
export async function verifyPhoneNumber(phoneNumber) {
  if (!numVerifyConfigured()) {
    console.log(`[AIS] MOCK number-verify ${phoneNumber}`);
    return { verified: true, mock: true };
  }
  try {
    const token = await getAccessToken(process.env.AIS_NUMVERIFY_TOKEN);
    const res = await fetch(NV_BASE.replace(/\/$/, '') + NV_PATH, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ phoneNumber }),
    });
    if (!res.ok) return { verified: false, mock: false, error: `AIS ${res.status}` };
    const json = await res.json();
    const verified = Boolean(
      json.devicePhoneNumberVerified ?? json.verified ?? json.verificationResult,
    );
    return { verified, mock: false };
  } catch (err) {
    console.error('[AIS] number-verify error:', err);
    return { verified: false, mock: false, error: String(err.message || err) };
  }
}

// --- OTP ---------------------------------------------------------------------

/** Request an OTP for a phone number. @returns {Promise<{mock:boolean, code?:string, error?:string}>} */
export async function requestOtp(userId, phone) {
  const expiresAt = Date.now() + OTP_TTL_MS;
  if (!otpConfigured()) {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    pendingOtp.set(userId, { phone, ref: 'mock', code, expiresAt });
    console.log(`[AIS] MOCK OTP for ${phone}: ${code}`);
    return { mock: true, code };
  }
  try {
    const token = await getAccessToken(
      process.env.AIS_OTP_TOKEN || process.env.AIS_NUMVERIFY_TOKEN,
    );
    const res = await fetch(OTP_BASE.replace(/\/$/, '') + OTP_REQUEST_PATH, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ phoneNumber: phone }),
    });
    if (!res.ok) return { error: `AIS OTP ${res.status}` };
    const json = await res.json();
    const ref = json.reference ?? json.ref ?? json.token ?? json.requestId ?? '';
    pendingOtp.set(userId, { phone, ref, code: null, expiresAt });
    return { mock: false };
  } catch (err) {
    console.error('[AIS] otp request error:', err);
    return { error: String(err.message || err) };
  }
}

/** Verify a submitted OTP code. @returns {Promise<{verified:boolean, mock:boolean, phone?:string, reason?:string, error?:string}>} */
export async function verifyOtp(userId, inputCode) {
  const pending = pendingOtp.get(userId);
  if (!pending) return { verified: false, mock: false, reason: 'no_pending' };
  if (Date.now() > pending.expiresAt) {
    pendingOtp.delete(userId);
    return { verified: false, mock: false, reason: 'expired' };
  }
  if (!otpConfigured()) {
    const ok = inputCode === pending.code;
    if (ok) pendingOtp.delete(userId);
    return { verified: ok, mock: true, phone: pending.phone };
  }
  try {
    const token = await getAccessToken(
      process.env.AIS_OTP_TOKEN || process.env.AIS_NUMVERIFY_TOKEN,
    );
    const res = await fetch(OTP_BASE.replace(/\/$/, '') + OTP_VERIFY_PATH, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        reference: pending.ref,
        otp: inputCode,
        phoneNumber: pending.phone,
      }),
    });
    if (!res.ok)
      return { verified: false, mock: false, error: `AIS OTP ${res.status}` };
    const json = await res.json();
    const verified = Boolean(json.verified ?? json.valid ?? json.success);
    if (verified) pendingOtp.delete(userId);
    return { verified, mock: false, phone: pending.phone };
  } catch (err) {
    console.error('[AIS] otp verify error:', err);
    return { verified: false, mock: false, error: String(err.message || err) };
  }
}

// --- Dispatcher --------------------------------------------------------------

const OTP_KEYWORD = /\botp\b|โอทีพี|ขอรหัส|ขอ\s*otp|รหัสผ่านครั้งเดียว/i;
const VERIFY_KEYWORD = /ยืนยัน|verify|ตัวตน/i;

const CONTINUE =
  'ต่อไปเล่าให้ฟังได้เลยว่าตอนนี้เรียนอยู่ชั้นไหน สนใจอะไร อยากให้ช่วยแนะแนวเรื่องใด 😊';

/**
 * Route an incoming message through the AIS identity services if it is one of:
 * an OTP code (when one is pending), an OTP request, or a number-verification
 * request. Returns a reply string, or null to let the guidance LLM handle it.
 */
export async function handleIdentityMessage(userId, text) {
  const t = String(text).trim();

  // 1) A pending OTP + a bare 6-digit code → verify the OTP.
  const codeMatch = t.match(/^\s*(\d{6})\s*$/);
  if (hasPendingOtp(userId) && codeMatch) {
    const r = await verifyOtp(userId, codeMatch[1]);
    if (r.verified) {
      return (
        `✅ ยืนยัน OTP สำเร็จ เบอร์ ${maskPhone(r.phone)} ได้รับการยืนยันแล้วค่ะ\n` +
        CONTINUE +
        (r.mock ? '\n\n(โหมดสาธิต — ยังไม่ได้ต่อ AIS จริง)' : '')
      );
    }
    if (r.reason === 'expired')
      return '⏰ รหัส OTP หมดอายุแล้วค่ะ พิมพ์ "ขอ OTP <เบอร์>" เพื่อขอรหัสใหม่';
    return '❌ รหัส OTP ไม่ถูกต้องค่ะ ลองพิมพ์รหัส 6 หลักอีกครั้งนะคะ';
  }

  const phone = extractThaiMobile(t);
  if (!phone) return null;

  const cleaned = t.replace(/[\s-]/g, '');
  const isExactPhone = /^(?:\+?66\d{9}|0\d{9})$/.test(cleaned);

  // 2) OTP request: an explicit OTP keyword + a phone number.
  if (OTP_KEYWORD.test(t)) {
    const r = await requestOtp(userId, phone);
    if (r.error)
      return `⚠️ ขอ OTP ไม่สำเร็จค่ะ (${r.error}) ลองใหม่อีกครั้งนะคะ`;
    const base = `📩 ส่งรหัส OTP ไปที่เบอร์ ${maskPhone(phone)} แล้วค่ะ กรุณาพิมพ์รหัส 6 หลักที่ได้รับเพื่อยืนยัน`;
    return r.mock
      ? `${base}\n\n(โหมดสาธิต — รหัสคือ ${r.code})`
      : base;
  }

  // 3) Silent Number Verification: a bare phone number, or a "ยืนยัน" phrase.
  if (isExactPhone || VERIFY_KEYWORD.test(t)) {
    const r = await verifyPhoneNumber(phone);
    if (r.verified) {
      return (
        `✅ ยืนยันเบอร์ ${maskPhone(phone)} เรียบร้อยผ่านเครือข่าย AIS แล้วค่ะ\n` +
        CONTINUE +
        (r.mock ? '\n\n(โหมดสาธิต — ยังไม่ได้ต่อ AIS จริง)' : '')
      );
    }
    return (
      `⚠️ ยืนยันเบอร์ ${maskPhone(phone)} ไม่สำเร็จค่ะ` +
      (r.error ? ` (${r.error})` : '') +
      '\nลองใหม่ หรือถามเรื่องการเรียนต่อได้เลยนะคะ'
    );
  }

  return null;
}
