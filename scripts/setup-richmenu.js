// One-time setup: create the LINE rich menu, upload its image, and set it as
// the default menu for the OA. Safe to re-run — it clears old menus first.
//
// Run locally:  node --env-file=.env scripts/setup-richmenu.js

import { messagingApi } from '@line/bot-sdk';
import { buildRichMenuPng, PANEL_BOUNDS, MENU_SIZE } from './richmenu-image.js';

const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
if (!channelAccessToken) {
  console.error('Missing LINE_CHANNEL_ACCESS_TOKEN (run with --env-file=.env).');
  process.exit(1);
}

const client = new messagingApi.MessagingApiClient({ channelAccessToken });
const blobClient = new messagingApi.MessagingApiBlobClient({ channelAccessToken });

const BASE_URL = process.env.APP_BASE_URL || 'https://jump-line-bot.onrender.com';

// Each panel taps to send a message the bot already understands, except the
// dashboard, which opens a web page. No dedicated "log in" panel — the login
// flow now starts on its own as soon as someone adds the OA as a friend (see
// the LINE 'follow' event handler in server.js), so a manual entry point
// would just be redundant.
const ACTIONS = [
  { type: 'message', text: 'ช่วยเปรียบเทียบโรงเรียนสายวิทย์-คณิตในกรุงเทพให้หน่อย' },
  { type: 'message', text: 'ผมอยู่ ม.3 สนใจสายวิทย์-คณิต ควรเตรียมตัวยังไง' },
  { type: 'uri', uri: `${BASE_URL}/dashboard` },
];

async function main() {
  // 1) Remove any existing menus so re-running stays clean.
  const existing = await client.getRichMenuList();
  for (const rm of existing.richmenus ?? []) {
    await client.deleteRichMenu(rm.richMenuId);
    console.log('deleted old rich menu', rm.richMenuId);
  }

  // 2) Create the rich menu definition.
  const { richMenuId } = await client.createRichMenu({
    size: MENU_SIZE,
    selected: true,
    name: 'Jump Thailand',
    chatBarText: 'เมนู Jump',
    areas: PANEL_BOUNDS.map((bounds, i) => ({ bounds, action: ACTIONS[i] })),
  });
  console.log('created rich menu', richMenuId);

  // 3) Upload the image.
  const png = buildRichMenuPng();
  await blobClient.setRichMenuImage(
    richMenuId,
    new Blob([png], { type: 'image/png' }),
  );
  console.log('uploaded image');

  // 4) Set as the default menu for all users.
  await client.setDefaultRichMenu(richMenuId);
  console.log('set as default ✅  Open the OA in LINE to see the menu.');
}

main().catch((err) => {
  console.error('setup failed:', err?.body ?? err);
  process.exit(1);
});
