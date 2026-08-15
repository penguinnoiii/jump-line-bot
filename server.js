// Jump Thailand — LINE OA education-guidance chatbot.
// Express webhook that verifies LINE signatures, gates each student through
// onboarding, routes AIS identity requests and guidance questions to the
// right handler, and replies over the Messaging API.

import express from 'express';
import { middleware, messagingApi } from '@line/bot-sdk';
import { generateGuidance, resetHistory, summarizeConversation } from './src/llm.js';
import { buildGuidanceFlexMessage, parseGuidanceStructure } from './src/richMessage.js';
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
  isProfileInfoRequest,
  profileCardMessage,
  needsRoleQuickReply,
  updateConversationSummary,
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

// Static images referenced by public pages (e.g. the rich-menu preview on
// the demo site) — everything in here is public, non-sensitive artwork.
app.use('/assets', express.static('public/assets'));

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
  const {
    fullName, nickname, school, studentId, grade, interest, phone, phoneVerified,
    conversationSummary,
  } = p;
  return {
    fullName, nickname, school, studentId, grade, interest, phoneVerified, conversationSummary,
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

// --- Hackathon demo site (public/demo.html) ----------------------------------
// A public, non-LINE chat surface that exercises the SAME onboarding +
// guidance logic as the real bot (handleOnboarding / generateGuidance), keyed
// by a random per-browser session id instead of a LINE userId. Two things
// keep this safe to expose publicly on the pitch/demo page:
//   - AIS runs in mock mode without real credentials (src/ais.js) — no real
//     SMS ever goes out; the OTP code is just handed back in the response.
//   - Every demo session is created with demo=true, which skips ALL cloud
//     persistence (src/onboarding.js) — a visitor's fake data can never show
//     up in a real teacher's room dashboard.
app.get('/demo', (_req, res) => res.sendFile('demo.html', { root: 'public' }));

const demoJson = express.json();
const DEMO_PREFIX = 'demo:';
const DEMO_MSG_CAP = 60; // guard against a runaway client loop burning API quota
const demoMessageCounts = new Map(); // sessionId -> count

function isDemoSession(id) {
  return typeof id === 'string' && id.startsWith(DEMO_PREFIX) && id.length < 80;
}

app.post('/demo/api/chat', demoJson, async (req, res) => {
  try {
    const { sessionId, text } = req.body || {};
    if (!isDemoSession(sessionId)) return res.status(400).json({ error: 'invalid_session' });
    // Empty text is valid — it's how the client kicks off a brand-new session
    // to get the same greeting a real LINE 'follow' event would trigger.
    const userText = String(text ?? '').trim();

    const count = (demoMessageCounts.get(sessionId) || 0) + 1;
    demoMessageCounts.set(sessionId, count);
    if (count > DEMO_MSG_CAP) {
      return res.json({
        reply: 'ครบจำนวนข้อความสาธิตของรอบนี้แล้วค่ะ 🙏 กดปุ่ม "เริ่มเดโมใหม่" เพื่อเล่นอีกรอบนะคะ',
        quickReplies: [],
      });
    }

    if (!isOnboarded(sessionId) || isResetCommand(userText)) {
      if (isResetCommand(userText)) resetHistory(sessionId);
      const reply = await handleOnboarding(sessionId, userText, true);
      return res.json({
        reply,
        quickReplies: needsRoleQuickReply(sessionId) ? ['นักเรียน', 'คุณครู'] : [],
      });
    }

    // The client also sends this empty "__init__" ping on every page load to
    // fetch a greeting for a brand-new session (handled above). For a
    // session that's already onboarded — e.g. the page was reloaded — there
    // is no real question here, so answer with the profile card instead of
    // forwarding an empty message to the guidance LLM (Gemini rejects a
    // request whose last turn resolves to empty content).
    if (!userText) {
      return res.json({ reply: profileCardMessage(getProfile(sessionId)), quickReplies: [] });
    }

    if (isProfileInfoRequest(userText)) {
      return res.json({ reply: profileCardMessage(getProfile(sessionId)), quickReplies: [] });
    }

    const identityReply = await handleIdentityMessage(sessionId, userText);
    if (identityReply) {
      syncPhoneIfOnboarded(sessionId);
      return res.json({ reply: identityReply, quickReplies: [] });
    }

    const { text: reply, sources } = await generateGuidance(
      sessionId,
      userText,
      getProfile(sessionId),
    );
    // `card` mirrors what the real LINE bot renders as a Flex Message
    // (see src/richMessage.js) — lets the demo site show the same
    // headline+bullets card instead of a plain text bubble. Null when the
    // reply didn't parse cleanly, same fallback the real bot uses.
    const structure = parseGuidanceStructure(reply);
    const card = structure ? { ...structure, sources: sources.slice(0, 3) } : null;
    const sourceBlock = !card && sources.length
      ? '\n\n📎 แหล่งข้อมูล:\n' +
        sources.map((s, i) => `${i + 1}. ${s.title}\n${s.url}`).join('\n')
      : '';
    res.json({ reply: reply + sourceBlock, quickReplies: [], card });

    // Fire-and-forget, same as the real LINE flow — updateConversationSummary
    // keeps this in-memory only for demo sessions (see its own doc comment),
    // never touching the real cloud store.
    const profileForSummary = getProfile(sessionId);
    if (profileForSummary) {
      summarizeConversation(sessionId, profileForSummary.conversationSummary)
        .then((summary) => updateConversationSummary(sessionId, summary))
        .catch((err) => console.error('[demo] conversation summary error:', err));
    }
  } catch (err) {
    console.error('demo chat error:', err);
    res.status(500).json({ error: 'internal_error' });
  }
});

// Lets the demo site show a live "dashboard preview" of the session's own
// profile + rolling summary — reads the SAME in-memory profile the chat
// endpoint above uses, so it reflects the conversation as it updates.
app.get('/demo/api/profile', (req, res) => {
  const sessionId = req.query?.sessionId;
  if (!isDemoSession(sessionId)) return res.status(400).json({ error: 'invalid_session' });
  const profile = getProfile(sessionId);
  if (!profile) return res.status(404).json({ error: 'not_found' });
  const { fullName, nickname, school, studentId, grade, interest, conversationSummary } = profile;
  res.json({ profile: { fullName, nickname, school, studentId, grade, interest, conversationSummary } });
});

// LINE webhook. `middleware` reads the raw body and verifies the signature —
// do NOT put express.json() in front of it on this route.
app.post('/webhook', middleware({ channelSecret }), async (req, res) => {
  // Acknowledge fast so LINE doesn't retry; process events afterwards.
  res.status(200).end();
  const events = req.body?.events ?? [];
  await Promise.all(events.map(handleEvent));
});

// Quick-reply buttons offered alongside the role question ("นักเรียน" /
// "คุณครู"), so most people can tap instead of typing.
function roleQuickReply() {
  return {
    items: [
      { type: 'action', action: { type: 'message', label: 'นักเรียน', text: 'นักเรียน' } },
      { type: 'action', action: { type: 'message', label: 'คุณครู', text: 'คุณครู' } },
    ],
  };
}

function onboardingMessages(userId, text) {
  const message = { type: 'text', text };
  if (needsRoleQuickReply(userId)) message.quickReply = roleQuickReply();
  return [message];
}

async function handleEvent(event) {
  // A user adding the OA as a friend (or unblocking it) — greet immediately
  // with a short self-intro and ask whether they're a student or a teacher,
  // rather than waiting for their first message.
  if (event.type === 'follow') {
    const userId = event.source?.userId;
    if (!userId) return;
    try {
      const introReply = await handleOnboarding(userId, '');
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: onboardingMessages(userId, introReply),
      });
    } catch (err) {
      console.error('follow event error:', err);
    }
    return;
  }

  if (event.type !== 'message' || event.message.type !== 'text') return;

  const userId = event.source?.userId ?? 'anon';
  const userText = event.message.text.trim();
  if (!userText) return;

  try {
    // Onboarding gate ("log in"): role (student/teacher) → consent → phone
    // verification (AIS OTP, required) → 4 general-info questions. Students
    // can't reach the guidance LLM until this completes; teachers never go
    // through it at all (see the 'teacher' stage in src/onboarding.js). A
    // reset command works even for an already-onboarded student.
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
        messages: onboardingMessages(userId, onboardingReply),
      });
      return;
    }

    // Student asking to see their own info mid-conversation (e.g. "ข้อมูลของฉัน")
    // — answer with a guaranteed-accurate, consistently-formatted card plus a
    // dashboard link, instead of routing it to the guidance LLM.
    if (isProfileInfoRequest(userText)) {
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: profileCardMessage(getProfile(userId)) }],
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
    // Rich Message card (headline + bullets) when the reply parses cleanly;
    // falls back to plain text (with the old inline source list) whenever
    // it doesn't — a formatting slip from the model should never break the
    // reply.
    const flexMessage = buildGuidanceFlexMessage(text, sources);
    const message = flexMessage || {
      type: 'text',
      text:
        text +
        (sources.length
          ? '\n\n📎 แหล่งข้อมูล:\n' + sources.map((s, i) => `${i + 1}. ${s.title}\n${s.url}`).join('\n')
          : ''),
    };
    await client.replyMessage({
      replyToken: event.replyToken,
      messages: [message],
    });

    // Fire-and-forget: fold this exchange into the student's rolling
    // conversation summary and persist it, so the next login — even after
    // this server restarts — still has continuity, and the summary shows
    // up on their dashboard/PDF for a teacher or parent to read. Never
    // blocks or fails the reply above.
    const profileForSummary = getProfile(userId);
    if (profileForSummary) {
      summarizeConversation(userId, profileForSummary.conversationSummary)
        .then((summary) => updateConversationSummary(userId, summary))
        .catch((err) => console.error('[server] conversation summary error:', err));
    }
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
