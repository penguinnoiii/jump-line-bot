# Jump Thailand — LINE OA Guidance Chatbot (Demo)

A live LINE Official Account chatbot that gives Thai students personalized education guidance, powered by **Typhoon** (SCB 10X's Thai LLM). This is the working demo behind the Jump Thailand tech pitch.

**Stack:** Node.js + Express + `@line/bot-sdk` (Messaging API) + `openai` SDK pointed at Typhoon's OpenAI-compatible API. Deployed on Render.

```
Student in LINE app  →  LINE Platform  →  /webhook (this server)  →  Typhoon (Thai LLM)  →  reply
```

---

## Part A — Create the LINE Official Account (you must do this; it needs an interactive login)

1. Go to the **LINE Developers Console**: https://developers.line.biz/console/ and log in with a LINE account.
2. **Create a Provider** (e.g. "Jump Thailand") if you don't have one.
3. Inside the provider, **Create a new channel → Messaging API**. Fill in name (e.g. "Jump แนะแนว"), category, etc. This automatically creates a linked LINE Official Account.
4. Open the channel → **Messaging API** tab:
   - **Channel access token (long-lived):** click **Issue** → copy it → this is `LINE_CHANNEL_ACCESS_TOKEN`.
5. Open the channel → **Basic settings** tab:
   - **Channel secret:** copy it → this is `LINE_CHANNEL_SECRET`.
6. Turn off the canned auto-replies so only your bot responds. In the **Messaging API** tab click **Edit** next to *"LINE Official Account features"* (opens the OA Manager) → **Response settings**:
   - **Chat / Auto-reply messages:** OFF
   - **Greeting messages:** optional (OFF is cleanest for the demo)
   - **Webhooks:** ON

Keep the two values handy for Part C.

---

## Part B — Get a Typhoon API key (free)

1. https://opentyphoon.ai → sign up → **API Keys** / dashboard → generate a key → this is `TYPHOON_API_KEY`.
2. The free tier is rate-limited but fine for a demo. Chat model used: `typhoon-v2.5-30b-a3b-instruct`.

---

## Part C — Deploy to Render

1. Push this folder to a GitHub repo (see "Push to GitHub" below).
2. https://render.com → **New → Blueprint** → connect the repo. Render reads `render.yaml`.
   - (Or **New → Web Service** manually: Build `npm install`, Start `npm start`.)
3. In the service's **Environment** settings, set the three secrets:
   - `LINE_CHANNEL_ACCESS_TOKEN`
   - `LINE_CHANNEL_SECRET`
   - `TYPHOON_API_KEY`
   - (`TYPHOON_MODEL` defaults to `typhoon-v2.5-30b-a3b-instruct`.)
4. Deploy. When it's live, note the URL, e.g. `https://jump-line-bot.onrender.com`.
   Open it in a browser — you should see "Jump Thailand LINE bot is running ✅".

> **Free-tier note:** Render's free web service sleeps after ~15 min idle, so the *first* message after a nap takes ~30–60s to wake. For a live demo, hit the URL once to warm it up right before, or use a paid instance.

---

## Part D — Connect the webhook and test

1. Back in the **LINE Developers Console → Messaging API tab → Webhook settings**:
   - **Webhook URL:** `https://<your-render-url>/webhook`  (note the `/webhook` path)
   - Click **Verify** → should say Success.
   - **Use webhook:** ON.
2. In the same tab, find the **QR code** / add-friend link for the OA. Scan it in the LINE app on your phone.
3. Send a message, e.g. *"อยากเข้าสายวิทย์-คณิต ต้องเตรียมตัวยังไงบ้าง"* — the bot replies with guidance.

---

## Local development (optional, with ngrok)

You chose Render for the live demo, but to iterate locally:

1. `npm install`
2. Copy `.env.example` → `.env` and fill in the three values.
3. `npm run dev` (starts on port 3000).
4. In another terminal expose it: `ngrok http 3000` → copy the `https://…ngrok…` URL.
5. Set the LINE Webhook URL to `https://<ngrok>.ngrok-free.app/webhook` and Verify.
   (The free ngrok URL changes on every restart — re-paste it each time.)

---

## Push to GitHub

```bash
cd jump-line-bot
git init
git add .
git commit -m "Jump Thailand LINE guidance bot"
# create an empty repo on github.com first, then:
git remote add origin https://github.com/<you>/jump-line-bot.git
git push -u origin main
```

`.gitignore` already excludes `node_modules/` and `.env`, so secrets never get committed.

---

## How it works / what to say in the demo

- `server.js` — verifies the LINE signature, acks fast, routes text messages to the LLM, replies.
- `src/prompts.js` — the system prompt encoding the **advisor role and ethics guardrails** from the brief: AI can search/summarize/compare, but is a *decision-support tool, not the decider of a child's future*; Human-in-the-loop for "เหมาะ/ไม่เหมาะ" calls; PDPA-aware; honest that this demo has no live central database yet.
- `src/llm.js` — calls **Typhoon** (Thai LLM) via the OpenAI-compatible API and keeps a short in-memory chat history per user.

**Swapping the model:** Typhoon uses an OpenAI-compatible API, so any other OpenAI-compatible provider (Gemini via its compat endpoint, Groq, OpenRouter, or self-hosted OpenThaiGPT) works by changing `TYPHOON_BASE_URL`, `TYPHOON_API_KEY`, and `TYPHOON_MODEL` — no code change.

**Honest scope for judges:** this proves the LINE OA → AI → student loop end to end, running on a **Thai LLM** (nice "sovereign AI" story). The AI currently answers from general knowledge with "verify at the source" disclaimers; wiring the **Central Education Database** (the architecture layer) is the next step, not the chatbot itself.
