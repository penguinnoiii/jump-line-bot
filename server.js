// Jump Thailand — LINE OA education-guidance chatbot.
// Express webhook that verifies LINE signatures, gates each student through
// onboarding, routes AIS identity requests and guidance questions to the
// right handler, and replies over the Messaging API.

import express from 'express';
import { middleware, messagingApi } from '@line/bot-sdk';
import { generateGuidance, resetHistory } from './src/llm.js';
import {
  handleIdentityMessage,
  extractThaiMobile,
  requestOtp,
  verifyOtp,
  maskPhone,
} from './src/ais.js';
import {
  isOnboarded,
  isResetCommand,
  getProfile,
  handleOnboarding,
  syncPhoneIfOnboarded,
  updateProfileFields,
} from './src/onboarding.js';
import { login as teacherLogin, verifyToken } from './src/teacher-auth.js';
import {
  newOtpSessionId,
  issueStudentToken,
  verifyStudentToken,
} from './src/dashboard-auth.js';
import {
  listRooms,
  listStudentsInRoom,
  getStudentProfile,
  findStudentProfileByPhone,
} from './src/store.js';

const { MessagingApiClient } = messagingApi;

const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const channelSecret = process.env.LINE_CHANNEL_SECRET;

if (!channelAccessToken || !channelSecret) {
  console.error(
    'Missing LINE credentials. Set LINE_CHANNEL_ACCESS_TOKEN and LINE_CHANNEL_SECRET.',
  );
  process.exit(1);
}
if (!process.env.GEMINI_API_KEY) {
  console.error('Missing GEMINI_API_KEY.');
  process.exit(1);
}

const client = new MessagingApiClient({ channelAccessToken });
const app = express();

// Health check (also lets you confirm the deploy is live in a browser).
app.get('/', (_req, res) => res.send('Jump Thailand LINE bot is running ✅'));

// --- Teacher dashboard ("Teacher View") -------------------------------------
// Static page + a small password-gated JSON API. express.json() is scoped to
// these routes only — it must never run in front of /webhook, which needs
// the raw body for LINE's signature check.
app.get('/teacher', (_req, res) => res.sendFile('teacher.html', { root: 'public' }));
app.use('/teacher', express.static('public'));

const teacherJson = express.json();

app.post('/teacher/api/login', teacherJson, (req, res) => {
  const token = teacherLogin(req.body?.password ?? '');
  if (!token) return res.status(401).json({ error: 'invalid_password' });
  res.json({ token });
});

function requireTeacherAuth(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!verifyToken(token)) return res.status(401).json({ error: 'unauthorized' });
  next();
}

app.get('/teacher/api/rooms', requireTeacherAuth, async (_req, res) => {
  try {
    res.json({ rooms: await listRooms() });
  } catch (err) {
    console.error('listRooms error:', err);
    res.status(500).json({ error: 'internal_error' });
  }
});

app.get('/teacher/api/rooms/:room', requireTeacherAuth, async (req, res) => {
  try {
    res.json({ students: await listStudentsInRoom(req.params.room) });
  } catch (err) {
    console.error('listStudentsInRoom error:', err);
    res.status(500).json({ error: 'internal_error' });
  }
});

// --- Combined dashboard entry point (rich menu "แดชบอร์ด" button) -----------
// /dashboard is a role picker: teacher -> links to the page above; student ->
// a self-service view/edit of their own profile, gated by the SAME AIS OTP
// verification used everywhere else (not a name/ID lookup a classmate could
// spoof) so a student can only ever reach their own record.
app.get('/dashboard', (_req, res) => res.sendFile('dashboard.html', { root: 'public' }));

const dashboardJson = express.json();

function sanitizeStudentProfile(p) {
  if (!p) return null;
  const { fullName, nickname, school, studentId, grade, interest, phone, phoneVerified } = p;
  return {
    fullName, nickname, school, studentId, grade, interest, phoneVerified,
    phone: phoneVerified && phone ? maskPhone(phone) : null,
  };
}

app.post('/dashboard/api/student/request-otp', dashboardJson, async (req, res) => {
  const phone = extractThaiMobile(req.body?.phone ?? '');
  if (!phone) return res.status(400).json({ error: 'invalid_phone' });
  const sessionId = newOtpSessionId();
  const r = await requestOtp(sessionId, phone);
  if (r.error) return res.status(502).json({ error: r.error });
  res.json({ sessionId, mock: r.mock, code: r.mock ? r.code : undefined });
});

app.post('/dashboard/api/student/verify-otp', dashboardJson, async (req, res) => {
  const { sessionId, code } = req.body || {};
  if (!sessionId || !code) return res.status(400).json({ error: 'missing_fields' });
  const r = await verifyOtp(sessionId, code);
  if (!r.verified) {
    return res.status(401).json({ error: r.reason || 'invalid_code' });
  }
  const profile = await findStudentProfileByPhone(r.phone);
  if (!profile) {
    return res.status(404).json({
      error: 'not_found',
      message: 'ยังไม่พบข้อมูลนักเรียนที่ผูกกับเบอร์นี้ กรุณาเข้าสู่ระบบผ่านแชทกับ Jump ก่อนนะคะ',
    });
  }
  const token = await issueStudentToken(profile.userId);
  res.json({ token, profile: sanitizeStudentProfile(profile) });
});

async function requireStudentAuth(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const userId = await verifyStudentToken(token);
  if (!userId) return res.status(401).json({ error: 'unauthorized' });
  req.studentUserId = userId;
  next();
}

app.get('/dashboard/api/student/me', requireStudentAuth, async (req, res) => {
  try {
    const profile = await getStudentProfile(req.studentUserId);
    if (!profile) return res.status(404).json({ error: 'not_found' });
    res.json({ profile: sanitizeStudentProfile(profile) });
  } catch (err) {
    console.error('student profile fetch error:', err);
    res.status(500).json({ error: 'internal_error' });
  }
});

app.put('/dashboard/api/student/me', dashboardJson, requireStudentAuth, async (req, res) => {
  try {
    const updated = await updateProfileFields(req.studentUserId, req.body || {});
    if (!updated) return res.status(404).json({ error: 'not_found' });
    res.json({ profile: sanitizeStudentProfile(updated) });
  } catch (err) {
    console.error('student profile update error:', err);
    res.status(500).json({ error: 'internal_error' });
  }
});

// LINE webhook. `middleware` reads the raw body and verifies the signature —
// do NOT put express.json() in front of it on this route.
app.post('/webhook', middleware({ channelSecret }), async (req, res) => {
  // Acknowledge fast so LINE doesn't retry; process events afterwards.
  res.status(200).end();
  const events = req.body?.events ?? [];
  await Promise.all(events.map(handleEvent));
});

async function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') return;

  const userId = event.source?.userId ?? 'anon';
  const userText = event.message.text.trim();
  if (!userText) return;

  try {
    // Onboarding gate ("log in"): consent → phone verification (AIS OTP,
    // required) → 5 general-info questions. Students can't reach the
    // guidance LLM until this completes. A reset command works even for an
    // already-onboarded student.
    //
    // This MUST run before the standalone AIS dispatcher below — otherwise a
    // bare phone number typed at the in-flow 'phone' step gets intercepted
    // by the standalone silent-Number-Verification path instead of starting
    // the in-flow OTP request.
    if (!isOnboarded(userId) || isResetCommand(userText)) {
      if (isResetCommand(userText)) resetHistory(userId);
      const onboardingReply = await handleOnboarding(userId, userText);
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: onboardingReply }],
      });
      return;
    }

    // Standalone AIS identity step, for an already-logged-in student who
    // wants to (re-)verify a number — e.g. after "เปลี่ยนเบอร์" outside the
    // login flow. Returns null for normal messages.
    const identityReply = await handleIdentityMessage(userId, userText);
    if (identityReply) {
      // Link a newly-verified phone onto their record immediately, rather
      // than waiting for their next message.
      syncPhoneIfOnboarded(userId);
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: identityReply }],
      });
      return;
    }

    const { text, sources } = await generateGuidance(
      userId,
      userText,
      getProfile(userId),
    );
    const sourceBlock = sources.length
      ? '\n\n📎 แหล่งข้อมูล:\n' +
        sources.map((s, i) => `${i + 1}. ${s.title}\n${s.url}`).join('\n')
      : '';
    await client.replyMessage({
      replyToken: event.replyToken,
      messages: [{ type: 'text', text: text + sourceBlock }],
    });
  } catch (err) {
    console.error('handleEvent error:', err);
    try {
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [
          {
            type: 'text',
            text: 'ขออภัยค่ะ ระบบมีปัญหาชั่วคราว ลองใหม่อีกครั้งนะคะ 🙏',
          },
        ],
      });
    } catch (replyErr) {
      console.error('fallback reply failed:', replyErr);
    }
  }
}

// Surface signature-validation failures from the LINE middleware clearly.
app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).end();
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Jump Thailand LINE bot listening on :${port}`));
