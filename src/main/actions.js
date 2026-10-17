'use strict';

/**
 * The panel's chat, in the order the system needs: grab the person's selection before the panel takes the screen,
 * send each message to the AI with what it needs (the chat so far, what Buddy knows about them), and do what the
 * answer says -- read their text box or look at their screen and ask again, put the text in the app they came from
 * (or on the clipboard when that is not possible), remember something about them, or offer to send. The panel holds
 * the keyboard focus while it is open, so it steps aside whenever the helper has to read from or type into that app.
 * When the person hides the panel while Buddy is thinking, Buddy does nothing in their app: the answer waits in the
 * chat.
 *
 * The chat lives here, not in the page: after every change the whole panel state goes to the page (ui.panelState),
 * which only draws it and sends back what the person types and the buttons they press. The state and its items are
 * the shape in docs/superpowers/plans/2026-10-08-buddy-chat-panel.md (C4), with `voice` from
 * docs/superpowers/plans/2026-10-08-buddy-voice.md (V2): whether the page may listen. The page records and works out
 * when the person has finished; Buddy's server writes the recording down (transcribe()), and the page sends the words
 * as a message of its own.
 */

const { BuddyError } = require('../../shared/errors');
const { LIMITS, MESSAGE_ELSEWHERE, ELSEWHERE } = require('../../shared/prompts');
const { pickChat, pickLine, sameName } = require('../../shared/message-pick');
const { appLine } = require('../../shared/pick-lines');
const { AI_TIMEOUT_MS } = require('./ai');
const { TRANSCRIBE_TIMEOUT_MS } = require('./cloud');
const platform = require('./platform');
const { ERRORS: CLAUDE_ERRORS } = require('./claude/job');
const {
  spokenQuestion, spokenLines, bubbleLine, bubbleText, asksBack, unlockLine, callingLine, VOICE_LINES, UNLOCK_WAIT_MS, MAX_FOLLOW_UPS,
} = require('../../shared/voice-words');

const COPIED = `Copied — press ${platform.pasteKeys}`;
const READY = 'Your answer is ready. Open me to see it.';
// A panel that only hid (a click somewhere else, or Buddy put text in the app) opens on the same chat for this long,
// from the same app. Closing it (✕, Esc, the shortcut, a click on the buddy) ends the chat.
const RESUME_MS = 5 * 60_000;
// How many of the chat's messages go along with each request, so that "make it shorter" knows what "it" is.
const HISTORY = 6;
const UNREADABLE = "I couldn't read your selection — select it again or paste it here.";
// Reasons the selection was not read whose own words tell the person what is going on: a password field, and on
// Windows an app run as administrator or keys still held down.
const EXPLAINED = new Set(['secure_field', 'elevated', 'keys_held']);
// How the microphone can stand (Electron's systemPreferences.getMediaAccessStatus); 'unknown' where the system does
// not ask per app (Windows).
const MIC = ['granted', 'denied', 'not-determined', 'restricted', 'unknown'];
const NOT_RECORDED = "That recording didn't come through. Try again.";
// The server's answers to a recording that mean voice is off for this person now: no Groq key, or they are blocked.
const VOICE_TURNED_OFF = ['voice_off', 'blocked'];

// Errors whose fix is in Settings, which come with an "Open Settings" button: no key yet, a key that was refused, an
// account out of credit, a model that cannot be used (not there for this key, or it cannot read screenshots), today's
// free requests used up with own keys allowed but none saved, and free mode turned off (all in the AI section); signed
// out and a copy of Buddy that cannot sign in (Settings' start); and a permission the Mac has not given Buddy.
const AI_ERRORS = ['no_key', 'bad_key', 'no_credit', 'bad_model', 'no_vision', 'need_key', 'free_off'];
AI_ERRORS.push('no_claude', 'claude_signed_out', 'claude_limit'); // Claude Code as the brain (claude/run.js): fixed in Settings → AI too
const ACCOUNT_ERRORS = ['signed_out', 'not_set_up'];
const PERMISSION_ERRORS = ['no_accessibility', 'no_screen_recording'];
// A Claude Code job (src/main/claude/job.js) in the chat: how many of its live lines are kept, and the lines the chat
// shows for a question it answered itself, a question that is over, and no project folder yet.
const LIVE_LINES = 6;
const NO_ANSWER = 'No answer for 10 minutes, so I said no.';
const QUESTION_OVER = 'Not needed any more.';
const NO_PROJECT = 'Add a project folder in Settings → Claude Code first.';
// A message on WhatsApp (shared/prompts.js parseChat's "message"): where it cannot be sent from, a send that WhatsApp
// left in its box, and a send whose end Buddy never heard (the helper took too long, or stopped): Buddy cannot tell
// whether it went, so it never sends it again by itself.
const MESSAGE_WAITS = "It's in WhatsApp, ready for you to send.";
const MESSAGE_UNSURE = "I'm not sure it went. Check WhatsApp.";
// A WhatsApp call from the Mac whose start Buddy could not see, or whose end it never heard: it never calls again by
// itself.
const CALL_UNSURE = "I'm not sure the call started. Check WhatsApp.";
// A "message" answer to a second step: who and what may be someone else's words, read in their box or on the screen.
const MESSAGE_ASK = "Tell me who to message and what, and I'll do it.";
// A call, an app to open, their calls or notifications, answered from a second step.
const SECOND_ASK = "Ask me that on its own, and I'll do it.";
const UNKNOWN_END = ['timeout', 'helper_exit'];

/** The Settings section where the fix for an error is, or undefined for Settings' start. */
function sectionFor(code) {
  if (AI_ERRORS.includes(code)) return 'ai';
  if (code === 'no_project') return 'claude';
  if (PERMISSION_ERRORS.includes(code)) return 'permissions';
  return undefined;
}
const SETTINGS_ERRORS = new Set([...AI_ERRORS, ...ACCOUNT_ERRORS, ...PERMISSION_ERRORS]);

// What the page gets of each kind of item. The items here also carry what only this file needs: how a buddy's text
// goes in the app (`mode`), the fact a "Remembered" line can forget, the message an error can try again, and who a
// WhatsApp card sends to and what (`message`), and who a WhatsApp call card calls and how (`call`): the page shows only
// the card's line.
const SHOWN = {
  you: ['text'],
  buddy: ['say', 'text', 'notes', 'buttons'],
  event: ['text', 'buttons'],
  error: ['text', 'code', 'buttons'],
  question: ['text', 'buttons'],
  job: ['project', 'lines', 'done', 'text', 'buttons'],
};

/**
 * `memory` is memory.js's store of facts about the person; `sendKeyFor` and `undoKey` are send-keys.js's. `userName()`
 * gives the signed-in person's first name, or ''. `helperMovesFocus`, `newline` and `system` are the system's
 * (platform.js, process.platform); tests pass either system's. Besides showing and hiding the panel, `ui` has
 * panelState(state), which hands the page a changed state; panelHiddenAt(), when the panel last hid (for the 5-minute
 * resume); openSettings(section); bubble(text); mood(name); and on Windows panelWindowHandle(): the panel window's
 * handle, for the helper to bring it forward. `cloud` is Buddy's server (cloud.js), which writes down what was said
 * and has this person's settings, and `signedIn()` whether someone is. `voice()` gives { on, auto, mic }: voice is on for this person, the panel
 * listens as it opens, and how the microphone stands.
 * `jobs` runs Claude Code in the person's project folders (claude/job.js createJobs); none means no jobs.
 * `apps` is apps.js's list of this Mac's apps and the way to open one; none on Windows. `talkBack` (talk-back.js) is Buddy's
 * voice: a chat started by voice is answered out loud, and a spoken yes presses the card asked about, through the same
 * act() as the button; none on Windows. `lock` says whether the screen is locked, and waits for the unlock.
 */
function createActions({
  helper,
  ai,
  clipboard,
  store,
  ui,
  memory,
  sendKeyFor,
  undoKey,
  cloud,
  signedIn = () => false,
  voice = () => ({}),
  jobs = null,
  apps = null,
  talkBack = null,
  lock = { locked: () => false, unlocked: async () => true },
  userName = () => '',
  now = Date.now,
  helperMovesFocus = platform.helperMovesFocus,
  newline = platform.newline,
  system = process.platform,
}) {
  // Every mood goes through here, so a job's live lines can tell whether the buddy already thinks: thinking sent again
  // would restart its animation on every line, and the buddy would jerk.
  let lastMood = null;
  const shown = ui;
  ui = {
    ...shown,
    mood(name) {
      lastMood = name;
      return shown.mood(name);
    },
  };
  let chat = newChat();
  let opening = null; // the open() in progress, if any
  let openingQuiet = false; // that open does not show the panel (a hands-free request's)
  let aside = 0; // how many of Buddy's steps in the app are under way with the panel hidden on purpose for them
  let lane = Promise.resolve(); // Buddy's work in the app, one step after the other (inApp)
  let working = 0; // how many steps in the app are under way or waiting their turn
  let job = null; // the Claude Code job under way, if any: { handle, project, item, chat }

  /**
   * A chat: the app it is about, its items, the selection the next message uses, the notice about that selection (and
   * `noticeFix`, the error code whose fix is a click away, when it has one), and whether the buddy is waiting for the AI (`busy`, which the page shows). `talking` counts its messages still being
   * worked on (until what each answer says is done), and `lastPut` is the buddy item Buddy last put in the app, which a
   * new version of it replaces. `live` once the panel has opened on it; `resumed` when an opening came back to it. `quiet` while it is a
   * hands-free chat the panel has not shown (sayToBuddy), as recent as `quietAt`.
   */
  function newChat(app = null) {
    return {
      app, items: [], nextId: 1, selection: '', notice: '', noticeFix: '', busy: false, talking: 0, lastPut: null, resumed: false, live: false,
      quiet: false, quietAt: 0, spoken: false, asking: null, followUps: 0, run: 0, speaking: false, listening: false, cancelWait: null, waitingFor: null, saying: 0, epoch: 0,
    };
  }

  /**
   * A new chat in place of the one on screen. The old one's answer, if it is still on its way, will be dropped: the
   * buddy stops thinking about it now, since that answer leaves the mood alone (talk()).
   */
  function replaceChat(next) {
    hush(chat);
    chat.epoch += 1;
    if (chat.cancelWait) chat.cancelWait(); // a wait for the unlock is given up
    if (chat.talking > 0) ui.mood('idle');
    chat = next;
  }

  /**
   * Whatever Buddy says, asks or listens for in this chat ends: nothing it hears afterwards counts (the run number moves
   * on, so a late answer finds its question gone).
   */
  function hush(c) {
    c.run += 1;
    if (c.asking !== null || c.speaking || c.listening || c.saying > 0) talkBack?.stop();
    c.asking = null;
  }

  /** A hands-free chat the panel has not shown: what Buddy says goes in the speech bubble (ui.speech). */
  const quietly = (c) => c.quiet && c === chat;

  /**
   * Said out loud, only in a spoken chat. Never rejects: a voice that fails leaves the chat as it is. In a quiet chat the
   * speech bubble shows `shown` (null: what it shows already) while the line is said, and goes a few seconds after.
   */
  function speak(c, text, shown = text) {
    if (!c.spoken || !talkBack || !text) return Promise.resolve();
    const bubbled = quietly(c);
    if (bubbled) ui.speech?.(shown === null ? null : bubbleLine(shown));
    c.saying += 1; // hush() stops whatever line is being said
    return Promise.resolve().then(() => talkBack.say(text)).catch((err) => console.warn('[buddy] could not speak:', err.message))
      .finally(() => {
        c.saying -= 1;
        if (bubbled) ui.speechDone?.();
      });
  }

  /** Text as it goes on the clipboard, with the system's line breaks. */
  const forClipboard = (text) => (newline === '\n' ? text : text.replace(/\r?\n/g, newline));
  const firstName = () => String(userName() || '').trim();
  const appName = (c) => c.app?.name || 'your app';

  /**
   * Whether the page may listen (V2), asked anew for each state: the microphone allowed a moment ago shows in the next
   * one. Anything but true is off, and a microphone the system does not describe is unknown.
   */
  function voiceState() {
    const v = voice() || {};
    return { on: v.on === true, auto: v.auto === true, mic: MIC.includes(v.mic) ? v.mic : 'unknown', system };
  }

  /** The panel's state, as the page draws it (C4, and V2's `voice`). */
  function stateOf(c) {
    const name = firstName();
    return {
      buddyName: store.get('buddyName') || 'Buddy',
      appName: c.app?.name || '',
      greeting: name ? `Hi ${name}! What should we do?` : 'Hi! What should we do?',
      notice: c.notice,
      noticeFix: c.noticeFix,
      selection: c.selection,
      busy: c.busy,
      resumed: c.resumed,
      chat: c.items.map((item) => {
        const shown = { id: item.id, type: item.type };
        for (const key of SHOWN[item.type]) shown[key] = Array.isArray(item[key]) ? [...item[key]] : item[key];
        return shown;
      }),
      voice: voiceState(),
      exampleProject: exampleProject(),
    };
  }

  /** After every change the page gets the whole state: only for the chat on screen (a closed one is gone). */
  function push(c) {
    if (c === chat) ui.panelState(stateOf(c));
  }

  function add(c, item) {
    const added = { id: c.nextId++, ...item };
    c.items.push(added);
    return added;
  }

  /** A buddy's text that is no longer Buddy's last change in the app: ⌘Z there would undo something else. */
  function dropUndo(item) {
    item.buttons = item.buttons.filter((button) => button !== 'undo');
  }

  /** An item that becomes another one in its place ("Send it?" becomes "✅ Sent"), keeping its id. */
  function swap(c, item, fields) {
    c.items[c.items.indexOf(item)] = { id: item.id, ...fields };
  }

  /**
   * `show: false` (a hands-free request with the panel hidden): the chat is made ready but not shown; it is quiet until
   * the panel shows it.
   */
  async function openPanel({ show = true } = {}) {
    const app = helper.lastApp;
    let selection = '';
    let notice = '';
    let noticeFix = '';
    if (app) {
      try {
        const r = await helper.call('captureSelection', { pid: app.pid, selectAll: false });
        selection = r.text || '';
      } catch (err) {
        if (EXPLAINED.has(err.code)) {
          notice = err.message;
        } else if (err.code === 'no_accessibility') {
          notice = 'Allow Accessibility in Settings so I can read and paste your text.';
          noticeFix = 'no_accessibility'; // its Allow button opens macOS's Accessibility page
        } else {
          console.warn('[buddy] could not read the selection:', err.code);
          notice = UNREADABLE;
        }
      }
    }
    // The same chat comes back when the panel only hid, from the same app, a short while ago; the selection is read
    // again all the same, since the person may have selected something else meanwhile. A quiet chat is as recent as its
    // last request, and the panel opened on it shows it whatever the app is now: its words were in the speech bubble.
    const sameApp = (app?.pid ?? null) === (chat.app?.pid ?? null);
    const seen = chat.quiet ? chat.quietAt : ui.panelHiddenAt();
    const resumed = chat.live && now() - seen < RESUME_MS && (sameApp || (show && chat.quiet));
    if (!resumed) replaceChat(newChat(app));
    Object.assign(chat, { app, selection, notice, noticeFix, resumed, live: true, quiet: !show, quietAt: show ? 0 : now() });
    if (show) await showPanel(stateOf(chat));
  }

  /**
   * Show the panel. On Windows it may open without the keyboard, which then stays in the person's app, where their
   * text is still selected: the helper, which Windows lets bring a window to the front, brings the panel forward.
   */
  async function showPanel(state) {
    await ui.showPanel(state);
    if (!helperMovesFocus) return;
    const hwnd = ui.panelWindowHandle();
    if (hwnd === null) return;
    try {
      await helper.call('focusWindow', { hwnd });
    } catch (err) {
      console.warn('[buddy] could not bring the panel forward:', err.code);
    }
  }

  /**
   * Close the panel: Esc, its close button, the shortcut, or a click on the buddy. The chat ends with it, and an
   * answer still on its way is dropped. macOS gives the keyboard back to the app below by itself; Windows leaves it
   * with the hidden panel, so there the helper brings that app back.
   */
  async function dismiss() {
    const { app } = chat;
    replaceChat(newChat());
    ui.hidePanel();
    if (!helperMovesFocus || !app) return;
    try {
      await helper.call('activate', { pid: app.pid });
    } catch (err) {
      console.warn('[buddy] could not switch back to the app:', err.code);
    }
  }

  /** One opening at a time: asking again while the selection is still being read joins the one in progress. */
  function open(options) {
    if (opening && (options?.show === false || !openingQuiet)) return opening;
    if (opening) { // a show asked while a quiet open runs: the panel is shown once that one is done
      return opening.then(() => (ui.isPanelVisible() ? undefined : open(options)));
    }
    openingQuiet = options?.show === false;
    opening = openPanel(options).finally(() => {
      opening = null;
    });
    return opening;
  }

  async function toggle() {
    if (aside > 0) return; // the panel is hidden on purpose while the helper works in the app
    // On the Mac a click on the buddy takes the panel's focus first, which hides it, and only then arrives here: that
    // click closed the panel, so it ends the chat as closing does, and must not open it again.
    if (ui.isPanelVisible() || ui.panelJustClosed()) {
      await dismiss();
      return;
    }
    await open();
  }

  /**
   * The panel has the keyboard focus, so the helper's keys (⌘A and ⌘C to read the box, ⌘V to paste, ⌘Z, a send key)
   * would land in the panel itself, and bringing the app forward would blur it: it is hidden while the helper works.
   * Until that is over, toggle() does nothing: a click on the buddy would open a second panel. A count, not a flag: the
   * end of one step must not let the panel open in the middle of another.
   */
  async function stepAside(work) {
    aside += 1;
    ui.hidePanel();
    try {
      return await work();
    } finally {
      aside -= 1;
    }
  }

  /**
   * Whether Buddy may still work in the app for chat `c`: it is the chat on screen, and the panel is open or Buddy
   * itself put it aside for a step there. A panel the person hid while Buddy was thinking (a click somewhere else)
   * means they have moved on: Buddy does not read their box, look at their app or type into it behind their back.
   */
  function present(c) {
    return c === chat && (aside > 0 || ui.isPanelVisible() || c.quiet);
  }

  /** Buddy stopped short of reading the box or looking at the app (present()): the chat says what to do then. */
  function askAgain(c) {
    add(c, { type: 'buddy', say: `Open me again and ask once more, so I can look at ${appName(c)}.`, text: '', notes: [], buttons: [] });
  }

  /**
   * Show the panel again on the same chat, after it stepped aside: unless the chat was closed meanwhile. Buddy brings
   * it back, not the person, so it does not listen by itself (`voice.auto` is false in this state only).
   */
  async function comeBack(c) {
    if (c !== chat || c.quiet) return; // a quiet chat stays in the speech bubble
    c.resumed = true;
    const state = stateOf(c);
    await showPanel({ ...state, voice: { ...state.voice, auto: false } });
  }

  /** The chat so far for the AI: the last messages before `you`, the buddy's as its line and its text together. */
  function historyBefore(c, you) {
    return c.items.slice(0, c.items.indexOf(you))
      .filter((item) => item.type === 'you' || item.type === 'buddy')
      .map((item) => ({ from: item.type, text: item.type === 'you' ? item.text : [item.say, item.text].filter(Boolean).join('\n\n') }))
      .filter((message) => message.text)
      .slice(-HISTORY);
  }

  /** One `chat` request, given AI_TIMEOUT_MS. An answer that comes without its reading is shown as a written one. */
  async function ask(input) {
    const out = await ai.ask('chat', input, { signal: AbortSignal.timeout(AI_TIMEOUT_MS) });
    return out.chat || { kind: 'write', say: '', text: out.text || '', notes: [], doIt: false, send: false, remember: [] };
  }

  /** Save what the AI learned about the person. Each fact the memory takes shows in the chat, with Undo. */
  function remember(c, facts) {
    for (const fact of facts) {
      const saved = memory.add(fact);
      if (saved) add(c, { type: 'event', text: `📝 Remembered: ${saved.text}`, buttons: ['undo'], fact: saved.id });
    }
  }

  /** The chat says why Buddy stopped short, in a red line with no buttons: there is nothing to try again. */
  function stop(c, code, text) {
    add(c, { type: 'error', text, code, buttons: [] });
    return false;
  }

  /**
   * Something that failed shows in the chat: with Try again when it was a message (and trying it again could help),
   * and with Open Settings when the fix is there. Only a BuddyError's words are the person's to read: anything else is
   * a bug or a system failure, which is logged.
   */
  function failed(c, err, you = null) {
    const known = err instanceof BuddyError;
    if (!known) console.error('[buddy] unexpected error:', err);
    const code = known ? err.code : 'failed';
    const buttons = [];
    if (you && code !== 'bad_request') buttons.push('retry');
    if (SETTINGS_ERRORS.has(code)) buttons.push('settings');
    add(c, { type: 'error', text: known ? err.message : 'Something went wrong. Try again.', code, buttons, you: you?.id });
  }

  /**
   * Ask the AI about the message `you` and do what its answer says. At most one second step: the text in the person's
   * box, or a picture of their app, when the first answer asks for it. Answers true when the buddy answered, false
   * when it stopped short (the reason is in the chat) or the chat was closed meanwhile.
   */
  async function answer(c, you) {
    const asked = { message: you.text, history: historyBefore(c, you), facts: memory.facts(), appName: c.app?.name || '', userName: firstName() };
    if (jobs?.projects().length) asked.projects = jobs.projects().map((p) => p.name); // only when there are any
    if (system === 'darwin') asked.canMessage = true; // the Mac can message on WhatsApp; Windows cannot (yet)
    if (system === 'darwin') asked.canOpen = true; // the Mac opens apps
    if (system === 'darwin') asked.canCall = true; // the Mac makes WhatsApp calls (a phone call says it can't)
    const sent = c.selection;
    const selection = sent ? { selection: sent } : {};
    let from = sent ? 'selection' : null; // where the text the answer works on came from
    let second = false; // whether the answer is to a second step
    let reply = await ask({ ...asked, ...selection, step: 1 });
    if (c !== chat) return false; // closed meanwhile: this answer belongs to a chat that is over
    // Facts come from this first answer only: the second one has read the person's box or screen, whose text (a mail
    // someone sent them, a web page) could tell the AI to "remember" anything.
    remember(c, reply.remember);

    if (reply.kind === 'box') {
      if (!c.app) return stop(c, 'no_app', 'Click in the box you are writing in, then open me again.');
      const box = await inApp(() => readBox(c, you), { wait: true }); // in its turn, after any other step in the app
      if (box === null || c !== chat) return false;
      reply = await ask({ ...asked, box, step: 2 }); // the box takes the place of the selection
      if (c !== chat) return false;
      from = 'box';
      second = true;
    } else if (reply.kind === 'screen') {
      if (!c.app) return stop(c, 'no_app', 'Open me from the app you want me to check.');
      if (!present(c)) {
        askAgain(c);
        return false;
      }
      let image;
      try {
        ({ image } = await helper.call('screenshot', { pid: c.app.pid }));
      } catch (err) {
        failed(c, err, you);
        return false;
      }
      if (c !== chat) return false;
      add(c, { type: 'event', text: `👀 Looked at ${appName(c)}`, buttons: [] });
      push(c);
      reply = await ask({ ...asked, ...selection, image, step: 2 });
      if (c !== chat) return false;
      second = true;
    }
    c.busy = false; // the answer is in: what is left is Buddy's own work
    if (reply.kind === 'box' || reply.kind === 'screen') return stop(c, 'not_found', "I couldn't find it. Select the text and ask me again.");
    // The selection went with this message: the next one goes without it, unless the person selects something again
    // (an opening meanwhile may have read a new one, which stays).
    if (c.selection === sent) c.selection = '';
    // A message only from a first answer: a second one has read their box or their screen, whose words (a mail someone
    // sent them, a web page) could say who to message and what. Nothing is searched in WhatsApp; Buddy asks them.
    if (second && reply.kind === 'message') {
      add(c, { type: 'buddy', say: MESSAGE_ASK, text: '', notes: [], buttons: [] });
      return true;
    }
    // The same for a call, an app to open, their calls or notifications: Buddy does these by itself, so only from
    // their own words.
    if (second && ['call', 'open', 'calls', 'notifs'].includes(reply.kind)) {
      add(c, { type: 'buddy', say: SECOND_ASK, text: '', notes: [], buttons: [] });
      return true;
    }
    return finish(c, reply, from);
  }

  /** The buttons of a buddy's text that can go in the app: Insert at the cursor, Replace over a selection or the box. */
  const putButtons = (mode) => [mode === 'insert' ? 'insert' : 'replace', 'copy'];

  /**
   * Read the whole text box the person is writing in: the panel steps aside for it and comes back on the same chat.
   * Answers the text, or null when Buddy stopped short (the reason is in the chat).
   */
  async function readBox(c, you) {
    if (!present(c)) {
      askAgain(c);
      return null;
    }
    let box;
    try {
      box = (await stepAside(() => helper.call('captureSelection', { pid: c.app.pid, selectAll: true }))).text || '';
    } catch (err) {
      failed(c, err, you);
      await comeBack(c);
      return null;
    }
    if (c !== chat) return null;
    if (!box) {
      stop(c, 'empty_box', 'That box looks empty.');
      await comeBack(c);
      return null;
    }
    add(c, { type: 'event', text: `📖 Read your text in ${appName(c)}`, buttons: [] });
    await comeBack(c);
    return box;
  }

  /** The final answer: what it shows, and what Buddy does in the app. */
  async function finish(c, reply, from) {
    if (reply.kind === 'message') return startMessage(c, reply);
    if (['call', 'open', 'calls', 'notifs'].includes(reply.kind)
      && (system === 'win32' || reply.kind === 'calls' || reply.kind === 'notifs' || (reply.kind === 'call' && reply.how === 'phone'))) {
      return elsewhere(c, reply);
    }
    if (reply.kind === 'open') return startOpen(c, reply);
    if (reply.kind === 'call') return startCall(c, reply); // a phone call took the elsewhere line above
    if (reply.kind === 'code') return startCode(c, reply);
    if (reply.kind === 'send') {
      add(c, { type: 'question', text: 'Send it?', buttons: ['send', 'not-now'] });
      return true;
    }
    // Text read from the box goes back over the whole box; a fix of the selection over the selection; the rest at
    // the cursor.
    let mode = 'insert';
    if (from === 'box') mode = 'replaceAll';
    else if (from === 'selection' && reply.kind === 'fix') mode = 'replace';
    let buttons = [];
    if (reply.text) buttons = reply.kind === 'answer' ? ['copy'] : putButtons(mode);
    const item = add(c, { type: 'buddy', say: reply.say, text: reply.text, notes: reply.notes, buttons, mode });
    if (reply.kind !== 'answer' && reply.doIt && reply.text) {
      // In its turn, after any other step in the app; and only while the person is still with Buddy. When they hid the
      // panel meanwhile, the answer waits in the chat, with Insert (or Replace) and Copy, and the bubble says so.
      await inApp(async () => {
        if (!present(c)) {
          if (c === chat) ui.bubble(READY);
          return;
        }
        // A new version of the text Buddy put in the app ("make it shorter") takes that text's place, the same way it
        // went in, while it can still be undone there. (A chat is about one app, so that text is in this one.)
        const last = c.lastPut;
        const over = reply.again === true && last?.buttons.includes('undo') ? last : null;
        if (over) {
          item.mode = over.mode;
          item.buttons = putButtons(over.mode);
        }
        await put(c, item, { over, askToSend: reply.send });
      }, { wait: true });
    }
    return true;
  }

  /**
   * One message through to its answer, the buddy thinking meanwhile; what goes wrong becomes a line in the chat. The
   * mood after it is only for the chat on screen: a closed chat's late answer must not make the buddy of a new chat
   * happy, idle or sad. An answer whose text went into the app was celebrated as it went in (put()): happy now would cut
   * that short.
   */
  async function talk(c, you) {
    const firstNew = c.nextId; // what the answer to this message adds to the chat has ids from here on
    ui.mood('thinking');
    c.busy = true;
    c.talking += 1;
    push(c);
    try {
      const jobBefore = job; // a "code" answer may start a Claude Code job
      const answered = await answer(c, you);
      const celebrated = (c.lastPut?.id ?? 0) >= firstNew; // a text of this answer's is in the app
      if (c === chat && !celebrated) ui.mood(answered ? 'happy' : 'idle');
      if (c === chat && job && job !== jobBefore) ui.mood('thinking'); // the job it started: thinking until it ends
    } catch (err) {
      if (c !== chat) {
        // Closed meanwhile: the buddy stopped thinking about it then (replaceChat).
      } else {
        ui.mood('sad'); // no internet, the AI failed, the limit is reached, …: sad ends by itself
      }
      failed(c, err, you);
    } finally {
      c.busy = false;
      c.talking -= 1;
      push(c);
    }
  }

  /** The person's message. An empty one with text selected means "fix this". One at a time: the next waits. */
  async function send(message, { spoken = false, followUp = false } = {}) {
    const c = chat;
    if (c.busy) throw new BuddyError('bad_request', 'Wait for my answer first.');
    let text = String(message ?? '').trim();
    if (!text && c.selection) text = 'Fix this.';
    if (!text) {
      stop(c, 'bad_request', 'Tell me what to do first.');
      push(c);
      return {};
    }
    // The AI's limits, checked before the message joins the chat: refused here, the page gives the person their words
    // back to make shorter, instead of a message in the chat that can never be answered.
    if (text.length > LIMITS.instruction) {
      throw new BuddyError('bad_request', `That message is too long (over ${LIMITS.instruction} characters). Try a shorter one.`);
    }
    if (c.selection.trim().length > LIMITS.text) {
      throw new BuddyError('bad_request', `Your selection is too long (over ${LIMITS.text} characters). Select less, or press ✕ to leave it out.`);
    }
    hush(c);
    c.epoch += 1; // a new message ends a wait for the unlock
    if (c.cancelWait) c.cancelWait();
    c.spoken = spoken && Boolean(talkBack);
    c.followUps = followUp ? c.followUps + 1 : 0;
    const run = c.run;
    const you = add(c, { type: 'you', text });
    await talk(c, you);
    // Out loud after the answer is shown; the page's send has its answer meanwhile.
    if (c.spoken && c === chat) speakAnswer(c, you, run).catch((err) => console.warn('[buddy] voice:', err.message));
    return {};
  }

  /** Reads the answer to a spoken message aloud: its lines, then the card's question, or one more request to listen for. */
  async function speakAnswer(c, you, run) {
    const live = () => c === chat && c.run === run;
    const added = c.items.slice(c.items.indexOf(you) + 1);
    const card = [...added].reverse().find((i) => ((i.message || i.call) || plainSend(i)) && i.buttons?.length);
    const lines = spokenLines(added.filter((i) => i !== card));
    const shown = bubbleText(added.filter((i) => i !== card)); // the answer in the speech bubble (quiet chat)
    if (!lines.length && shown && quietly(c)) { // a long text, only shown
      ui.speech?.(shown);
      ui.speechDone?.();
    }
    c.speaking = true;
    try {
      for (const [n, line] of lines.entries()) {
        await speak(c, line, n === 0 ? shown || line : null); // the bubble shows the answer, held through its lines
        if (!live()) return;
      }
    } finally {
      c.speaking = false;
    }
    if (card) return askAloud(c, card, run);
    const last = lines.at(-1);
    if (!last || !asksBack(last) || c.followUps >= MAX_FOLLOW_UPS) return;
    c.listening = true;
    let words;
    try {
      words = await talkBack.listen();
    } finally {
      c.listening = false;
    }
    if (words && live() && !c.busy) await send(words, { spoken: true, followUp: true });
  }

  /** The plain "Send it?" question: Buddy pasted text in another app, or the reply was "send it". */
  function plainSend(i) {
    return i.type === 'question' && !i.message && !i.call && i.buttons?.join() === 'send,not-now';
  }

  /**
   * Asks the card's own text out loud and listens. A yes presses the card's button through act(), the same way as the
   * person's press (so only while the card still shows it, in this chat, and once); no, nothing, or an error is Not now.
   */
  async function askAloud(c, card, run) {
    const live = () => c === chat && c.run === run && c.asking === card.id;
    const verb = card.call ? 'call' : 'send';
    const plain = plainSend(card);
    const question = plain ? 'Send it?'
      : card.call
        ? spokenQuestion({ kind: 'call', name: card.call.name, how: card.call.video ? 'whatsapp_video' : 'whatsapp' })
        : spokenQuestion({ kind: 'message', name: card.message.name, text: card.message.text });
    c.asking = card.id;
    // The plain Send acts in the front app, so there is no unlock to wait for: a locked Mac is a no.
    if (plain && lock.locked()) {
      c.asking = null;
      await act(card.id, 'not-now', { spoken: true });
      await speak(c, VOICE_LINES.notSent);
      return;
    }
    await speak(c, question);
    if (!live()) return;
    let heard;
    ui.listening?.(true, 'ear'); // the buddy's listening face; 'ear': not the panel's own 🎤
    try {
      heard = await talkBack.hear(verb);
    } catch {
      heard = 'no';
    } finally {
      ui.listening?.(false, 'ear');
    }
    if (!live()) return;
    c.asking = null;
    if (heard === 'yes') {
      await act(card.id, plain ? 'send' : verb === 'call' ? 'call' : 'send-message', { spoken: true });
    } else {
      await act(card.id, 'not-now', { spoken: true });
      await speak(c, verb === 'call' ? VOICE_LINES.notNow : VOICE_LINES.notSent);
    }
  }

  /** A locked Mac: Buddy asks for the unlock and waits up to a minute; still locked, the card goes and says so. */
  async function unlockedFor(c, item, kind, name) {
    if (!lock.locked()) return true;
    const ask = unlockLine('Mac', kind, name);
    const epoch = c.epoch;
    let cancel;
    const cancelled = new Promise((resolve) => { cancel = () => resolve('cancelled'); });
    c.cancelWait = cancel; // before the line is spoken, so that anything new meanwhile ends the wait
    c.waitingFor = item.id;
    ui.bubble(ask);
    let ok;
    try {
      ok = await Promise.race([speak(c, ask).then(() => 'spoken'), cancelled]);
      if (ok !== 'cancelled') ok = await Promise.race([lock.unlocked(UNLOCK_WAIT_MS), cancelled]);
    } finally {
      if (c.cancelWait === cancel) { c.cancelWait = null; c.waitingFor = null; }
    }
    // Not now, a new message, closing or a new chat meanwhile: the card is not pressed.
    if (ok === 'cancelled' || c.epoch !== epoch || c !== chat || !c.items.includes(item) || !item.buttons?.length) return false;
    if (ok) return true;
    const gave = kind === 'call' ? VOICE_LINES.didntCall : VOICE_LINES.didntSend;
    swap(c, item, { type: 'event', text: gave, buttons: [] });
    push(c);
    await speak(c, gave);
    return false;
  }

  /**
   * Put a buddy's text in the app the panel was opened from: at the cursor, over the selection, or over the whole box,
   * as the item's mode says. The panel steps aside for it and stays hidden: the bubble says what happened. When the
   * text cannot go in (no app, a password field, a terminal, an app run as administrator), it goes on the clipboard
   * instead. Answers whether it went in. `over`: the earlier text of Buddy's in the app that this one replaces.
   * `askToSend`: the message asked to send it too, so once it is in, the panel comes back with "Send it?" (Buddy never
   * sends by itself).
   */
  async function put(c, item, { over = null, askToSend = false } = {}) {
    const { app } = c;
    return stepAside(async () => {
      let pasted = false;
      if (app) {
        try {
          // A whole box is simply pasted over again. Anything else is undone first, which brings back what was there
          // before it: the selection it replaced (the paste goes over it again), or the cursor where it went in.
          if (over && over.mode !== 'replaceAll') {
            await helper.call('press', { pid: app.pid, ...undoKey(system) });
            dropUndo(over);
          }
          await helper.call('paste', { pid: app.pid, text: item.text, selectAll: item.mode === 'replaceAll' });
          pasted = true;
        } catch (err) {
          // Could not paste: fall back to the clipboard below.
          console.warn('[buddy] paste failed, copied instead:', err.code);
        }
      }
      if (pasted) {
        if (over) dropUndo(over); // its text is not in the app any more
        item.buttons = ['undo', 'copy'];
        c.lastPut = item;
        add(c, { type: 'event', text: `✅ Put it in ${appName(c)}`, buttons: [] });
        ui.bubble(`Done! It's in ${appName(c)} ✅`);
        if (c === chat) ui.mood('celebrate'); // not for a chat closed meanwhile (Buddy turned off), as in talk()
      } else {
        // Electron's clipboard writes are asynchronous: say "copied" only once the text is there.
        await clipboard.writeText(forClipboard(item.text));
        add(c, { type: 'event', text: COPIED, buttons: [] });
        ui.bubble(COPIED);
      }
      push(c);
      if (pasted && askToSend) {
        add(c, { type: 'question', text: 'Send it?', buttons: ['send', 'not-now'] });
        // Still stepped aside for this paste: the panel is Buddy's to show again, unless the chat was closed meanwhile.
        if (present(c)) await comeBack(c);
      }
      return pasted;
    });
  }

  /** Undo on text Buddy put in the app: the app comes forward and gets ⌘Z (Ctrl+Z on Windows), once. */
  async function undo(c, item) {
    try {
      await stepAside(() => helper.call('press', { pid: c.app.pid, ...undoKey(system) }));
    } catch (err) {
      failed(c, err);
      await comeBack(c);
      return;
    }
    dropUndo(item);
    ui.bubble('Undone');
    push(c);
  }

  /** The title of the app's front window, which tells a browser's Gmail from its WhatsApp; '' when it cannot be read. */
  async function windowTitle(app) {
    try {
      return (await helper.call('windowTitle', { pid: app.pid })).title || '';
    } catch (err) {
      console.warn('[buddy] could not read the window title:', err.code);
      return '';
    }
  }

  /** Send on "Send it?": the app's own send key, pressed in the app. Where Buddy does not know it, the person sends. */
  async function sendIt(c, item) {
    const { app } = c;
    const key = app ? sendKeyFor({ ...app, title: await windowTitle(app) }, system) : null;
    if (c !== chat) return;
    if (!key) {
      const where = app?.name ? `in ${app.name}` : 'here';
      swap(c, item, { type: 'buddy', say: `I don't know how to send ${where}. Press Send yourself.`, text: '', notes: [], buttons: [] });
      push(c);
      return;
    }
    try {
      await stepAside(() => helper.call('press', { pid: app.pid, ...key }));
    } catch (err) {
      failed(c, err); // the question stays, to try again
      await comeBack(c);
      return;
    }
    swap(c, item, { type: 'event', text: '✅ Sent', buttons: [] });
    // What Buddy put in the app has gone with it: none of it can be undone any more.
    for (const i of c.items) if (i.type === 'buddy') dropUndo(i);
    ui.bubble('Sent ✅');
    if (c === chat) ui.mood('celebrate'); // not for a chat closed meanwhile (Buddy turned off), as in talk()
    push(c);
  }

  /**
   * A call, an app to open, or their phone's calls or notifications, where this computer cannot do it: one line that
   * says where it can. The AI's own `say` is left out, as it may promise what this line says cannot be done here.
   */
  function elsewhere(c, reply) {
    let text = ELSEWHERE.open;
    if (reply.kind === 'calls') text = ELSEWHERE.calls;
    else if (reply.kind === 'notifs') text = ELSEWHERE.notifs;
    else if (reply.kind === 'call') text = reply.how === 'phone' ? ELSEWHERE.phoneCall : ELSEWHERE.whatsAppCall;
    add(c, { type: 'buddy', say: '', text, notes: [], buttons: [] });
    return true;
  }

  /** "Open Safari": opened at once, no question; the chat says it was, or which one, or why not. */
  async function startOpen(c, reply) {
    if (reply.say) add(c, { type: 'buddy', say: reply.say, text: '', notes: [], buttons: [] });
    const found = apps.list();
    const pick = pickChat(reply.app, found.map((app) => app.name));
    const line = appLine(reply.app, pick, 'Mac');
    if (line) {
      add(c, { type: 'buddy', say: '', text: line, notes: [], buttons: [] });
      return true;
    }
    const app = found.find((a) => a.name === pick.name);
    const problem = await apps.open(app.path);
    if (problem) add(c, { type: 'buddy', say: '', text: `I couldn't open ${app.name}.`, notes: [], buttons: [] });
    else add(c, { type: 'event', text: `✅ Opened ${app.name}`, buttons: [] });
    return true;
  }

  /**
   * "Message Priya on WhatsApp …": Buddy looks Priya up in WhatsApp's search (WhatsApp comes to the front for it, so
   * only while the person is still with Buddy), comes back, and asks "To Priya Sharma: …" with Send and Not now.
   * Nothing goes into WhatsApp before Send. One name found twice is two chats Buddy cannot tell apart: no card then.
   * Answers true when the buddy answered, false when it stopped short (the reason is in the chat).
   */
  async function startMessage(c, reply) {
    if (reply.say) add(c, { type: 'buddy', say: reply.say, text: '', notes: [], buttons: [] });
    if (system === 'win32') {
      add(c, { type: 'buddy', say: '', text: MESSAGE_ELSEWHERE, notes: [], buttons: [] });
      return true;
    }
    const found = await findWhatsAppChat(c, reply.to);
    if (!found.answered) return false;
    if (found.name) add(c, { type: 'question', text: `To ${found.name}: ${reply.text}`, buttons: ['send-message', 'not-now'], message: { name: found.name, text: reply.text } });
    await comeBack(c);
    return true;
  }

  /**
   * Who `to` is in WhatsApp's search, for a message or a call. WhatsApp comes to the front for it, so only while the
   * person is still with Buddy. `answered` false: Buddy stopped short (the reason is in the chat). Otherwise `name` is
   * the one chat, or missing when the chat says which one or why not. The panel is still aside when it answers true.
   */
  async function findWhatsAppChat(c, to) {
    let found;
    try {
      found = await inApp(async () => {
        if (!present(c)) return null;
        return (await stepAside(() => helper.call('waFind', { name: to }))) || {};
      }, { wait: true });
    } catch (err) {
      failed(c, err);
      await comeBack(c);
      return { answered: false };
    }
    if (found === null) {
      // The person hid the panel meanwhile: WhatsApp is left alone, and the bubble says there is something to read.
      if (c === chat) ui.bubble(READY);
      add(c, { type: 'buddy', say: 'Open me again and ask once more, so I can look in WhatsApp.', text: '', notes: [], buttons: [] });
      return { answered: false };
    }
    const names = (list) => (Array.isArray(list) ? list.filter((name) => typeof name === 'string') : null);
    const chats = names(found.chats) || [];
    // WhatsApp's search also lists a message found in a chat under that chat's name: only the rows that are chats or
    // contacts (`exact`) can be two chats with one name. A helper from before `exact`, or an `exact` with no row of
    // the picked name, counts every row.
    const exact = names(found.exact) || chats;
    const pick = pickChat(to, chats);
    const rows = pick && exact.some((name) => sameName(name, pick.name)) ? exact : chats;
    const line = pickLine(to, pick);
    if (line) {
      add(c, { type: 'buddy', say: '', text: line, notes: [], buttons: [] });
      return { answered: true };
    }
    if (rows.filter((name) => sameName(name, pick.name)).length > 1) {
      const text = `You have more than one chat called ${pick.name}. Rename one in WhatsApp, then ask me again.`;
      add(c, { type: 'buddy', say: '', text, notes: [], buttons: [] });
      return { answered: true };
    }
    return { answered: true, name: pick.name };
  }

  /** "WhatsApp call Prince": found as for a message, then "WhatsApp call Prince Sharma?" with Call and Not now. */
  async function startCall(c, reply) {
    if (reply.say) add(c, { type: 'buddy', say: reply.say, text: '', notes: [], buttons: [] });
    const found = await findWhatsAppChat(c, reply.to);
    if (!found.answered) return false;
    if (found.name) {
      const video = reply.how === 'whatsapp_video';
      add(c, { type: 'question', text: `WhatsApp ${video ? 'video call' : 'call'} ${found.name}?`, buttons: ['call', 'not-now'], call: { name: found.name, video } });
    }
    await comeBack(c);
    return true;
  }

  /**
   * Send on a WhatsApp card: the helper opens that chat, checks its name, puts the card's text in and sends it, only
   * that text to that chat. `sending` keeps Not now off the card meanwhile. A send that did not happen leaves the card,
   * to try again; one WhatsApp left in its box, or whose end Buddy never heard, takes the card away: no second send.
   */
  async function sendMessage(c, item) {
    if (!(await unlockedFor(c, item, 'message', item.message.name))) return;
    item.sending = true;
    try {
      await stepAside(() => helper.call('waSend', { name: item.message.name, text: item.message.text }));
    } catch (err) {
      const code = err instanceof BuddyError ? err.code : '';
      if (code === 'not_sent') {
        swap(c, item, { type: 'event', text: MESSAGE_WAITS, buttons: [] });
        failed(c, err);
        await speak(c, MESSAGE_WAITS);
      } else if (UNKNOWN_END.includes(code)) {
        swap(c, item, { type: 'event', text: MESSAGE_UNSURE, buttons: [] });
        ui.bubble(MESSAGE_UNSURE);
        await speak(c, MESSAGE_UNSURE);
      } else {
        failed(c, err); // the card stays, to try again
        await speak(c, spokenLines([c.items.at(-1)])[0]);
      }
      await comeBack(c);
      return;
    } finally {
      item.sending = false;
    }
    swap(c, item, { type: 'event', text: `✅ Sent to ${item.message.name}`, buttons: [] });
    ui.bubble('Sent ✅');
    if (c === chat) ui.mood('celebrate'); // not for a chat closed meanwhile (Buddy turned off), as in talk()
    push(c);
    await speak(c, VOICE_LINES.sent);
  }

  /**
   * Call on a WhatsApp call card: the helper opens that chat, checks it and presses its call button, once. `calling`
   * keeps Not now off the card meanwhile. A call that did not happen leaves the card, to try again; one Buddy cannot be
   * sure of (the helper could not see it start, or never answered) takes the card away: no second call.
   */
  async function placeCall(c, item) {
    if (!(await unlockedFor(c, item, 'call', item.call.name))) return;
    item.calling = true;
    try {
      await stepAside(() => helper.call('waCall', { name: item.call.name, video: item.call.video }));
    } catch (err) {
      const code = err instanceof BuddyError ? err.code : '';
      if (code === 'call_unsure' || UNKNOWN_END.includes(code)) {
        swap(c, item, { type: 'event', text: CALL_UNSURE, buttons: [] });
        ui.bubble(CALL_UNSURE);
        await speak(c, CALL_UNSURE);
      } else {
        failed(c, err); // the card stays, to try again
        await speak(c, spokenLines([c.items.at(-1)])[0]);
      }
      await comeBack(c);
      return;
    } finally {
      item.calling = false;
    }
    swap(c, item, { type: 'event', text: `${item.call.video ? '📹 Video calling' : '📞 Calling'} ${item.call.name} on WhatsApp`, buttons: [] });
    if (c === chat) ui.mood('celebrate'); // not for a chat closed meanwhile, as for a message
    push(c);
    await speak(c, callingLine(item.call.name));
  }

  /**
   * Work in the app, one step at a time: each one waits for the one before it, so that no step's panel comes back, or
   * its keys land, in the middle of another. Buddy's own steps (reading the box, "do it") wait their turn; a button
   * pressed while a step is under way or waiting is refused instead (a quick second press of Send must not send twice).
   */
  function inApp(work, { wait = false } = {}) {
    if (working > 0 && !wait) return Promise.reject(new BuddyError('bad_request', "Wait a moment, I'm still on it."));
    working += 1;
    const step = lane.then(work);
    lane = step.catch(() => {}); // the next step goes whether or not this one worked
    return step.finally(() => {
      working -= 1;
    });
  }

  /** A button on an item in the chat. Only the buttons the item shows can be pressed. */
  async function act(id, button, { spoken = false } = {}) {
    const c = chat;
    if (!spoken) hush(c); // a person's press ends any question Buddy is asking out loud; a spoken yes or no does not
    if (button === 'not-now' && c.cancelWait && c.waitingFor === id) c.cancelWait(); // Not now on the card Buddy waits to send
    const item = c.items.find((i) => i.id === id);
    if (!item?.buttons?.includes(button)) throw new BuddyError('bad_request', "That isn't there any more.");
    if (button === 'copy') {
      await clipboard.writeText(forClipboard(item.text));
      ui.bubble('Copied');
    } else if (button === 'insert' || button === 'replace') {
      await inApp(() => put(c, item));
    } else if (button === 'undo' && item.type === 'event') {
      // A fact Buddy remembered, forgotten again.
      memory.remove(item.fact);
      swap(c, item, { type: 'event', text: 'Okay, I forgot that.', buttons: [] });
      push(c);
    } else if (button === 'undo') {
      await inApp(() => undo(c, item));
    } else if (button === 'send') {
      await inApp(() => sendIt(c, item));
    } else if (button === 'send-message') {
      await inApp(() => sendMessage(c, item));
    } else if (button === 'call') {
      await inApp(() => placeCall(c, item));
    } else if (button === 'not-now' && (item.sending || item.calling)) {
      // Not now on a WhatsApp card whose Send or Call is under way: too late to take it back.
      throw new BuddyError('bad_request', "Wait a moment, I'm still on it.");
    } else if (button === 'stop') {
      // The job's item has Stop, and so has "Stop it first" for that job. The process is told; the item ends when it
      // has gone (the `stopped` event).
      item.buttons = [];
      if (job && (job.item === item || item.stopsJob === job.item)) job.handle.stop();
      push(c);
    } else if (button === 'allow' || button === 'deny') {
      const taken = Boolean(job && job.handle.answer(item.requestId, button === 'allow'));
      const said = button === 'allow' ? `✅ Allowed: ${item.what}` : `🚫 Said no to: ${item.what}`;
      swap(c, item, { type: 'event', text: taken ? said : QUESTION_OVER, buttons: [] });
      push(c);
    } else if (button === 'open-folder') {
      await ui.openFolder(item.path);
    } else if (button.startsWith('project:')) {
      // The pick on "Which project?": the folder must still be there, and no other job under way.
      if (job) throw new BuddyError('bad_request', `I'm still working in ${job.project.name}. Stop it first.`);
      const project = jobs.projects().find((p) => `project:${p.path}` === button);
      if (!project) {
        swap(c, item, { type: 'error', text: "That folder isn't there any more.", code: 'no_project', buttons: ['settings'] });
      } else {
        swap(c, item, { type: 'event', text: `📁 ${project.name}`, buttons: [] });
        runJob(c, project, item.task);
      }
      push(c);
    } else if (button === 'not-now' && item.call) {
      swap(c, item, { type: 'event', text: 'Okay, not now.', buttons: [] });
      push(c);
    } else if (button === 'not-now' && item.task !== undefined) {
      swap(c, item, { type: 'event', text: 'Okay, not now.', buttons: [] });
      push(c);
    } else if (button === 'retry' && item.task !== undefined) {
      // The same job again, in place of the red line, in the same folder if it is still there.
      if (job) throw new BuddyError('bad_request', `I'm still working in ${job.project.name}. Stop it first.`);
      const project = jobs.projects().find((p) => p.path === item.path);
      c.items.splice(c.items.indexOf(item), 1);
      if (project) runJob(c, project, item.task);
      else add(c, { type: 'error', text: "That folder isn't there any more.", code: 'no_project', buttons: ['settings'] });
      push(c);
    } else if (button === 'not-now') {
      swap(c, item, { type: 'event', text: 'Okay, not sent.', buttons: [] });
      push(c);
    } else if (button === 'retry') {
      // The same message again, in place of the error: with the selection as it is now.
      if (c.busy) throw new BuddyError('bad_request', 'Wait for my answer first.');
      c.items.splice(c.items.indexOf(item), 1);
      await talk(c, c.items.find((i) => i.id === item.you));
    } else if (button === 'settings') {
      // The same way to Settings as the gear: the panel steps aside (the chat is kept), then Settings opens.
      ui.hidePanel();
      ui.openSettings(sectionFor(item.code));
    }
    return {};
  }

  /** ✕ on the selection card: the next message goes without it. */
  function dropSelection() {
    chat.selection = '';
    push(chat);
    return {};
  }

  /**
   * What the person said into the panel, written down by Buddy's server: { text }, '' when it heard no words. `audio`
   * is the recording as base64 and `mime` its kind. The chat and the buddy are left alone: the page puts the words in
   * the box and sends them. The deadline is longer than the server's own wait for Groq, so that the server's answer
   * ("I couldn't write down what you said") comes first. When the server says voice is off, or that the person is
   * blocked, their settings are fetched again first, so that the next state turns voice off; the page still hears why.
   */
  async function transcribe(audio, mime) {
    if (!signedIn()) throw new BuddyError('signed_out', 'Sign in to use Buddy.');
    if (typeof audio !== 'string' || !audio || typeof mime !== 'string') throw new BuddyError('bad_request', NOT_RECORDED);
    try {
      const text = await cloud.transcribe({ audio, mime }, { signal: AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS) });
      return { text };
    } catch (err) {
      if (VOICE_TURNED_OFF.includes(err.code)) {
        await cloud.settings({ force: true }).catch((e) => console.warn('[buddy] could not fetch the free settings:', e.code || e.name));
      }
      throw err;
    }
  }

  // ---- Claude Code jobs ----

  /** The name for the empty chat's example line: the last project, else the first, else none. */
  function exampleProject() {
    if (!jobs) return '';
    const project = jobs.lastProject() || jobs.projects()[0];
    return project ? project.name : '';
  }

  /** The person's last message in the chat, for the project named in it. */
  const lastYou = (c) => c.items.findLast((i) => i.type === 'you')?.text || '';

  /** The chat says why the job cannot start, in a red line whose fix is in Settings. */
  function inSettings(c, code, text) {
    add(c, { type: 'error', text, code, buttons: ['settings'] });
    return false;
  }

  /**
   * Which project a job goes to: the only one; the one named in the message (any case, the longest name when two
   * match); the last pick; or null, and then the chat asks.
   */
  function pickProject(projects, c) {
    if (projects.length === 1) return projects[0];
    const message = lastYou(c).toLowerCase();
    const named = projects.filter((p) => message.includes(p.name.toLowerCase())).sort((a, b) => b.name.length - a.name.length);
    return named[0] || jobs.lastProject();
  }

  /**
   * A "code" answer: the job goes to Claude Code in one of the person's project folders, once it is clear which. Claude
   * Code must be there and signed in, whichever brain answered the chat: it is the one with the tools. One job at a time.
   */
  async function startCode(c, reply) {
    if (job) {
      // With Stop, which stops that job: its own item may be in a chat closed by now. `stopsJob` (that job's item, not
      // its id: ids start again in each chat) stays on this side.
      add(c, { type: 'buddy', say: `I'm still working in ${job.project.name}. Stop it first.`, text: '', notes: [], buttons: ['stop'], stopsJob: job.item });
      return true;
    }
    if (reply.say) add(c, { type: 'buddy', say: reply.say, text: '', notes: [], buttons: [] });
    if (!jobs) return inSettings(c, 'no_project', NO_PROJECT);
    const status = await jobs.status();
    if (c !== chat) return false;
    if (!status.installed) return inSettings(c, 'no_claude', CLAUDE_ERRORS.no_claude);
    if (!status.loggedIn) return inSettings(c, 'claude_signed_out', CLAUDE_ERRORS.claude_signed_out);
    const projects = jobs.projects();
    if (!projects.length) return inSettings(c, 'no_project', NO_PROJECT);
    const task = reply.text || lastYou(c);
    const project = pickProject(projects, c);
    if (!project) {
      add(c, { type: 'question', text: 'Which project?', buttons: [...projects.map((p) => `project:${p.path}`), 'not-now'], task });
      return true;
    }
    runJob(c, project, task);
    return true;
  }

  /** A job that failed: the buddy is sad, which ends by itself. */
  function sadForAWhile() {
    ui.mood('sad');
  }

  /**
   * Start the job in `project`: "Started", the job's item (with Stop), the buddy thinking until it ends. The item keeps
   * the task and the folder, so that Try again on a failure can run the same job again.
   */
  function runJob(c, project, task) {
    jobs.setLastProject(project.path);
    add(c, { type: 'event', text: `🔧 Started in ${project.name}`, buttons: [] });
    const item = add(c, { type: 'job', project: project.name, lines: [], done: false, text: '', buttons: ['stop'], task, path: project.path });
    let handle;
    try {
      handle = jobs.start({
        project, task, person: firstName(), model: store.get('models')?.['claude-code'],
        onEvent: (event) => onJobEvent(c, item, project, task, event),
      });
    } catch (err) {
      c.items.splice(c.items.indexOf(item), 1);
      failed(c, err);
      push(c);
      return;
    }
    job = { handle, project, item, chat: c };
    c.talking += 1;
    ui.mood('thinking');
    push(c);
  }

  /**
   * What the job reports (claude/job.js, J4) becomes the chat: live lines on its item, questions as question items,
   * and the end as the summary with Open folder and Copy, "Stopped", or a red line. The job goes on when the panel
   * hides or the chat is closed: its end then shows in the bubble, and a closed chat's end leaves the mood alone.
   */
  function onJobEvent(c, item, project, task, event) {
    const hidden = !ui.isPanelVisible() || c !== chat; // the panel is hidden, or shows another chat by now
    if (event.type === 'line') {
      item.lines = [...item.lines, event.text].slice(-LIVE_LINES);
      // An answer meanwhile may have left the buddy happy or idle: think again, but only then.
      if (c === chat && lastMood !== 'thinking') ui.mood('thinking');
      push(c);
      return;
    }
    if (event.type === 'ask') {
      add(c, { type: 'question', text: event.text, buttons: ['allow', 'deny'], requestId: event.requestId, what: event.what });
      if (hidden && c === chat) ui.bubble(`${event.text} Open me to answer.`); // a closed chat cannot be opened again
      push(c);
      return;
    }
    if (event.type === 'expired') {
      const question = c.items.find((i) => i.type === 'question' && i.requestId === event.requestId);
      if (question) swap(c, question, { type: 'event', text: NO_ANSWER, buttons: [] });
      push(c);
      return;
    }
    // The end: done, failed or stopped. A question still open is over with it.
    job = null;
    c.talking -= 1;
    item.done = true;
    for (const i of c.items) if (i.type === 'question' && i.requestId) swap(c, i, { type: 'event', text: QUESTION_OVER, buttons: [] });
    if (event.type === 'done') {
      item.text = event.text;
      item.buttons = ['open-folder', 'copy'];
      add(c, { type: 'event', text: `✅ Done in ${project.name}`, buttons: [] });
      if (hidden) ui.bubble(`Done in ${project.name} ✅`);
      if (c === chat) ui.mood('celebrate');
    } else if (event.type === 'stopped') {
      item.text = 'Stopped.';
      item.buttons = [];
      add(c, { type: 'event', text: '⏹ Stopped', buttons: [] });
      if (c === chat) ui.mood('idle');
    } else {
      item.buttons = [];
      // Try again for a run that just failed; Settings for the limit and signed out; nothing for "too long".
      const buttons = event.code === 'claude_failed' ? ['retry'] : event.code === 'too_long' ? [] : ['settings'];
      add(c, { type: 'error', text: event.message, code: event.code, buttons, task, path: project.path });
      if (hidden) ui.bubble(event.message);
      if (c === chat) sadForAWhile();
    }
    push(c);
  }

  /**
   * Words said after "Hey <name>": the same path as the panel's 🎤, which sends what was said as a spoken message. The
   * With the panel hidden the chat is made ready but not shown (a quiet chat): Buddy answers out loud and in the
   * speech bubble, and opening the panel shows it. A chat that is still answering is not interrupted: the words are not sent, and
   * `{ busy: true }` says so, so that Buddy can tell the person (wake.js).
   */
  async function sayToBuddy(words) {
    if (!ui.isPanelVisible()) await open({ show: false }); // not shown: the answer goes in the speech bubble
    if (chat.busy) return { busy: true };
    return send(words, { spoken: true });
  }

  /**
   * The person starts the panel's 🎤 or types in its box: whatever Buddy is asking, saying or listening for stops first, and an
   * answer that comes late presses nothing.
   */
  function hushVoice() {
    hush(chat);
  }

  return { open, mood: (name) => ui.mood(name), toggle, dismiss, send, voice: sayToBuddy, act, dropSelection, transcribe, hushVoice, state: () => stateOf(chat) };
}

module.exports = { createActions, sectionFor, COPIED };
