// Jump Thailand — LINE OA education-guidance chatbot.
// Express webhook that verifies LINE signatures, hands each text message to
// Claude, and replies over the Messaging API.

import express from 'express';
import { middleware, messagingApi } from '@line/bot-sdk';
import { generateGuidance } from './src/llm.js';
import { handleIdentityMessage } from './src/ais.js';

const { MessagingApiClient } = messagingApi;

const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const channelSecret = process.env.LINE_CHANNEL_SECRET;

if (!channelAccessToken || !channelSecret) {
  console.error(
    'Missing LINE credentials. Set LINE_CHANNEL_ACCESS_TOKEN and LINE_CHANNEL_SECRET.',
  );
  process.exit(1);
}
if (!process.env.TYPHOON_API_KEY) {
  console.error('Missing TYPHOON_API_KEY.');
  process.exit(1);
}

const client = new MessagingApiClient({ channelAccessToken });
const app = express();

// Health check (also lets you confirm the deploy is live in a browser).
app.get('/', (_req, res) => res.send('Jump Thailand LINE bot is running ✅'));

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
    // AIS identity step: OTP flow or Number Verification, handled via AIS Open
    // API before falling through to the guidance LLM. Returns null for normal
    // messages.
    const identityReply = await handleIdentityMessage(userId, userText);
    if (identityReply) {
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: identityReply }],
      });
      return;
    }

    const reply = await generateGuidance(userId, userText);
    await client.replyMessage({
      replyToken: event.replyToken,
      messages: [{ type: 'text', text: reply }],
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
