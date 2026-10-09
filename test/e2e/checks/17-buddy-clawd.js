'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Clawd with the buddy (src/renderer/buddy/clawd.js): while a Claude Code session works, Claude Code's little orange
// critter walks on the floating buddy's head (or, as the admin picks, along its face screen) and the buddy watches it;
// needing the person it waves; done, it is happy for a moment and goes. Claude Code's status reaches the buddy as watch.js sends it (home.status).
module.exports = async function buddyClawdCheck(ctx, { waitFor }) {
  const win = () => ctx.home.window();
  const page = (script) => win().webContents.executeJavaScript(script);
  const clawd = () => page('window.__buddyClawd ?? null');
  /** With BUDDY_E2E_SHOTS set to a folder, a picture of the buddy there, to look at by eye. */
  const shot = async (name) => {
    if (!process.env.BUDDY_E2E_SHOTS) return;
    await new Promise((r) => setTimeout(r, 300));
    fs.writeFileSync(path.join(process.env.BUDDY_E2E_SHOTS, `buddy-${name}.png`), (await win().webContents.capturePage()).toPNG());
  };
  try {
    await waitFor(() => page('window.__buddyReady === true'), 'the buddy');
    ctx.home.status({ kind: 'working', text: 'Claude · editing code', session: null });
    await waitFor(async () => ['walkA', 'walkB'].includes(await clawd()), 'Clawd walking');
    await shot('clawd-head-working'); // the admin's choice when nothing is saved: on the head
    ctx.home.clawdLook('face'); // the other: along the face screen, under the eyes
    await shot('clawd-face-working');
    ctx.home.clawdLook('head');
    ctx.home.status({ kind: 'needsYou', text: 'Claude needs you', session: null });
    await waitFor(async () => (await clawd()) === 'wave', 'Clawd waving');
    ctx.home.status({ kind: 'done', text: '', session: null });
    await waitFor(async () => (await clawd()) === 'stand', 'Clawd happy, done');
    await shot('clawd-done');
    await waitFor(async () => (await clawd()) === null, 'Clawd gone after a moment', 6000);
    await shot('clawd-gone');
  } finally {
    ctx.home.clawdLook('head');
    ctx.home.status(null);
  }
};
