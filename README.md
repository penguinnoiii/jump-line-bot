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

## Rich menu (tappable buttons)

The OA has a 3-button rich menu — **ยืนยันตัวตน / ค้นหาโรงเรียน / แนะแนว** — so you can demo by tapping instead of typing. Each button sends a message the bot already handles (identity verify, school comparison, guidance).

- Image generator: `scripts/richmenu-image.js` (renders Thai via `@napi-rs/canvas`).
- Setup/refresh: `npm run richmenu` (creates the menu, uploads the image, sets it as default; clears old menus first). Re-run after changing labels or button actions.

Requires `@napi-rs/canvas` (a devDependency) and Windows Thai fonts; it's a one-time local setup, not needed at runtime, so it's excluded from the production/Docker build.

---

## Alternative hosting — AIS Enterprise Cloud

Render is used above for speed, but the app is a plain containerised Node service, so it runs on **AIS Enterprise Cloud** (VMware-based VMs / container hosts) — making the "AIS Cloud" compute layer of the architecture real. A `Dockerfile` is included.

**Option 1 — Docker (any AIS container host / VM with Docker):**
```bash
docker build -t jump-line-bot .
docker run -d -p 3000:3000 --env-file .env --name jump-bot jump-line-bot
```

**Option 2 — plain AIS Cloud VM (Ubuntu):**
```bash
# on the VM
sudo apt-get update && sudo apt-get install -y nodejs npm git
git clone https://github.com/penguinnoiii/jump-line-bot.git && cd jump-line-bot
npm ci --omit=dev
cp .env.example .env && nano .env      # fill in the secrets
npm install -g pm2
pm2 start server.js --name jump-bot && pm2 save
```

**Make it HTTPS (LINE requires it):** LINE's webhook must be `https://`. On the AIS VM, put the app behind TLS with a domain — e.g. Caddy (auto-HTTPS):
```
# /etc/caddy/Caddyfile
your-domain.example.com {
    reverse_proxy localhost:3000
}
```
Then set the LINE Webhook URL to `https://your-domain.example.com/webhook`. (Or use an AIS Cloud load balancer / managed TLS if available.)

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
- `src/ais.js` — **AIS Open API** identity services for the *"ยืนยันตัวตน"* step:
  - **Number Verification** (GSMA/CAMARA) — confirm a phone number silently on the AIS network.
  - **OTP API** — send a one-time password by SMS and verify it (2-step).
  Both are fully env-var configurable and run in **mock mode** until AIS credentials are set (get them from `jumpthailand@ais.co.th`), so the demo works today and goes live the moment keys are added.

**Try the AIS step in LINE:**
- Number Verification: send a Thai mobile number (`0812345678`) or *"ยืนยันเบอร์ 0812345678"*.
- OTP: send *"ขอ OTP 0812345678"* → the bot "sends" a code (shown in demo mode) → reply with the 6-digit code to verify.

To go live, set the `AIS_*` vars from `.env.example`.

**Swapping the model:** Typhoon uses an OpenAI-compatible API, so any other OpenAI-compatible provider (Gemini via its compat endpoint, Groq, OpenRouter, or self-hosted OpenThaiGPT) works by changing `TYPHOON_BASE_URL`, `TYPHOON_API_KEY`, and `TYPHOON_MODEL` — no code change.

**Honest scope for judges:** this proves the LINE OA → AI → student loop end to end, running on a **Thai LLM** (nice "sovereign AI" story). The AI currently answers from general knowledge with "verify at the source" disclaimers; wiring the **Central Education Database** (the architecture layer) is the next step, not the chatbot itself.
