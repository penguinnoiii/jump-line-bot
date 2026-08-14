// AIS Open API — Number Verification integration.
//
// Maps to the "ยืนยันตัวตน / ยืนยันเบอร์" step in the Jump Thailand user flow:
// confirm that a phone number belongs to the person on the AIS network,
// without asking them to type an OTP.
//
// AIS follows the GSMA / CAMARA "Number Verification" standard. The Jump
// Thailand AIS page lists the service but not the endpoint/auth details —
// those are issued by AIS (email jumpthailand@ais.co.th). So EVERYTHING here
// is overridable by env var, and if no credentials are configured the module
// runs in MOCK mode so the demo still works end to end.
//
// To go live, set (from AIS):
//   AIS_NUMVERIFY_BASE_URL   e.g. https://api.ais.th
//   AIS_NUMVERIFY_VERIFY_PATH default: /number-verification/v0/verify
//   and ONE of:
//     AIS_NUMVERIFY_TOKEN    a ready bearer access token, OR
//     AIS_CLIENT_ID + AIS_CLIENT_SECRET + AIS_TOKEN_URL (+ optional AIS_SCOPE)
//                            for an OAuth2 client-credentials grant.
// Confirm the exact path, field names, and auth flow against AIS's docs.

const BASE_URL = process.env.AIS_NUMVERIFY_BASE_URL || '';
const VERIFY_PATH =
  process.env.AIS_NUMVERIFY_VERIFY_PATH || '/number-verification/v0/verify';

/** Is a real AIS integration configured, or are we in mock mode? */
export function aisConfigured() {
  return Boolean(
    BASE_URL &&
      (process.env.AIS_NUMVERIFY_TOKEN ||
        (process.env.AIS_CLIENT_ID &&
          process.env.AIS_CLIENT_SECRET &&
          process.env.AIS_TOKEN_URL)),
  );
}

/**
 * Normalise a Thai mobile number found in free text to E.164 (+66…).
 * Accepts 0812345678, 081-234-5678, +66812345678, 66812345678.
 * @returns {string|null} E.164 string, or null if no valid mobile found.
 */
export function extractThaiMobile(text) {
  const digits = String(text).replace(/[^\d+]/g, '');
  let m;
  if ((m = digits.match(/^0(\d{9})$/))) return '+66' + m[1];
  if ((m = digits.match(/^\+?66(\d{9})$/))) return '+66' + m[1];
  return null;
}

/**
 * Detect whether a message is asking to verify a phone number, and extract it.
 * @returns {string|null} E.164 number to verify, or null if not a verify intent.
 */
export function parseVerifyIntent(text) {
  const t = String(text).trim();
  const phone = extractThaiMobile(t);
  if (!phone) return null;
  const hasKeyword = /ยืนยัน|เบอร์|verify|ตัวตน/i.test(t);
  const isBarePhone = extractThaiMobile(t) && t.replace(/[^\d+\s-]/g, '').trim().length >= t.trim().length - 2;
  return hasKeyword || isBarePhone ? phone : null;
}

async function getAccessToken() {
  if (process.env.AIS_NUMVERIFY_TOKEN) return process.env.AIS_NUMVERIFY_TOKEN;

  // OAuth2 client-credentials grant.
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
  const json = await res.json();
  return json.access_token;
}

/**
 * Verify a phone number against the AIS network.
 * @param {string} phoneNumber  E.164, e.g. "+66812345678"
 * @returns {Promise<{verified: boolean, mock: boolean, error?: string}>}
 */
export async function verifyPhoneNumber(phoneNumber) {
  if (!aisConfigured()) {
    // Mock mode — no AIS credentials configured. Simulate a positive result
    // so the demo flow works; clearly flagged so it is never mistaken for real.
    console.log(`[AIS] MOCK verify ${phoneNumber} (no credentials configured)`);
    return { verified: true, mock: true };
  }

  try {
    const token = await getAccessToken();
    const res = await fetch(BASE_URL.replace(/\/$/, '') + VERIFY_PATH, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ phoneNumber }), // CAMARA field name
    });
    if (!res.ok) {
      return { verified: false, mock: false, error: `AIS API ${res.status}` };
    }
    const json = await res.json();
    // Be lenient about the exact result field name across AIS/CAMARA versions.
    const verified = Boolean(
      json.devicePhoneNumberVerified ?? json.verified ?? json.verificationResult,
    );
    return { verified, mock: false };
  } catch (err) {
    console.error('[AIS] verify error:', err);
    return { verified: false, mock: false, error: String(err.message || err) };
  }
}
