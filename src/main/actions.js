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
 * the shape in docs/superpowers/plans/2026-10-08-buddy-chat-panel.md (C4).
 */

const { BuddyError } = require('../../shared/errors');
const { LIMITS } = require('../../shared/prompts');
const { AI_TIMEOUT_MS } = require('./ai');
const platform = require('./platform');

const COPIED = `Copied — press ${platform.pasteKeys}`;
const READY = 'Your answer is ready. Open me to see it.';
const SLEEPY_MS = 5000;
// A panel that only hid (a click somewhere else, or Buddy put text in the app) opens on the same chat for this long,
// from the same app. Closing it (✕, Esc, the shortcut, a click on the buddy) ends the chat.
const RESUME_MS = 5 * 60_000;
// How many of the chat's messages go along with each request, so that "make it shorter" knows what "it" is.
const HISTORY = 6;
const UNREADABLE = "I couldn't read your selection — select it again or paste it here.";
// Reasons the selection was not read whose own words tell the person what is going on: a password field, and on
// Windows an app run as administrator or keys still held down.
const EXPLAINED = new Set(['secure_field', 'elevated', 'keys_held']);

// Errors whose fix is in Settings, which come with an "Open Settings" button: no key yet, a key that was refused, an
// account out of credit, a model that cannot be used (not there for this key, or it cannot read screenshots), today's
// free requests used up with own keys allowed but none saved, and free mode turned off (all in the AI section); signed
// out and a copy of Buddy that cannot sign in (Settings' start); and a permission the Mac has not given Buddy.
const AI_ERRORS = ['no_key', 'bad_key', 'no_credit', 'bad_model', 'no_vision', 'need_key', 'free_off'];
const ACCOUNT_ERRORS = ['signed_out', 'not_set_up'];
const PERMISSION_ERRORS = ['no_accessibility', 'no_screen_recording'];

/** The Settings section where the fix for an error is, or undefined for Settings' start. */
function sectionFor(code) {
  if (AI_ERRORS.includes(code)) return 'ai';
  if (PERMISSION_ERRORS.includes(code)) return 'permissions';
  return undefined;
}
const SETTINGS_ERRORS = new Set([...AI_ERRORS, ...ACCOUNT_ERRORS, ...PERMISSION_ERRORS]);

// What the page gets of each kind of item. The items here also carry what only this file needs: how a buddy's text
// goes in the app (`mode`), the fact a "Remembered" line can forget, and the message an error can try again.
const SHOWN = {
  you: ['text'],
  buddy: ['say', 'text', 'notes', 'buttons'],
  event: ['text', 'buttons'],
  error: ['text', 'code', 'buttons'],
  question: ['text', 'buttons'],
};

/**
 * `memory` is memory.js's store of facts about the person; `sendKeyFor` and `undoKey` are send-keys.js's. `userName()`
 * gives the signed-in person's first name, or ''. `helperMovesFocus`, `newline` and `system` are the system's
 * (platform.js, process.platform); tests pass either system's. Besides showing and hiding the panel, `ui` has
 * panelState(state), which hands the page a changed state; panelHiddenAt(), when the panel last hid (for the 5-minute
 * resume); openSettings(section); bubble(text); mood(name); and on Windows panelWindowHandle(): the panel window's
 * handle, for the helper to bring it forward.
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
  userName = () => '',
  now = Date.now,
  later = setTimeout,
  cancelLater = clearTimeout,
  helperMovesFocus = platform.helperMovesFocus,
  newline = platform.newline,
  system = process.platform,
}) {
  let chat = newChat();
  let opening = null; // the open() in progress, if any
  let aside = 0; // how many of Buddy's steps in the app are under way with the panel hidden on purpose for them
  let lane = Promise.resolve(); // Buddy's work in the app, one step after the other (inApp)
  let working = 0; // how many steps in the app are under way or waiting their turn
  let sleepy = null; // the pending "back to idle" timer after a network error, if any

  /**
   * A chat: the app it is about, its items, the selection the next message uses, the notice about that selection, and
   * whether the buddy is waiting for the AI (`busy`, which the page shows). `talking` counts its messages still being
   * worked on (until what each answer says is done), and `lastPut` is the buddy item Buddy last put in the app, which a
   * new version of it replaces. `live` once the panel has opened on it; `resumed` when an opening came back to it.
   */
  function newChat(app = null) {
    return {
      app, items: [], nextId: 1, selection: '', notice: '', busy: false, talking: 0, lastPut: null, resumed: false, live: false,
    };
  }

  /**
   * A new chat in place of the one on screen. The old one's answer, if it is still on its way, will be dropped: the
   * buddy stops thinking about it now, since that answer leaves the mood alone (talk()).
   */
  function replaceChat(next) {
    if (chat.talking > 0) ui.mood('idle');
    chat = next;
  }

  /** Text as it goes on the clipboard, with the system's line breaks. */
  const forClipboard = (text) => (newline === '\n' ? text : text.replace(/\r?\n/g, newline));
  const firstName = () => String(userName() || '').trim();
  const appName = (c) => c.app?.name || 'your app';

  /** The panel's state, as the page draws it (C4). */
  function stateOf(c) {
    const name = firstName();
    return {
      buddyName: store.get('buddyName') || 'Buddy',
      appName: c.app?.name || '',
      greeting: name ? `Hi ${name}! What should we do?` : 'Hi! What should we do?',
      notice: c.notice,
      selection: c.selection,
      busy: c.busy,
      resumed: c.resumed,
      chat: c.items.map((item) => {
        const shown = { id: item.id, type: item.type };
        for (const key of SHOWN[item.type]) shown[key] = Array.isArray(item[key]) ? [...item[key]] : item[key];
        return shown;
      }),
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

  async function openPanel() {
    const app = helper.lastApp;
    let selection = '';
    let notice = '';
    if (app) {
      try {
        const r = await helper.call('captureSelection', { pid: app.pid, selectAll: false });
        selection = r.text || '';
      } catch (err) {
        if (EXPLAINED.has(err.code)) {
          notice = err.message;
        } else if (err.code === 'no_accessibility') {
          notice = 'Allow Accessibility in Settings so I can read and paste your text.';
        } else {
          console.warn('[buddy] could not read the selection:', err.code);
          notice = UNREADABLE;
        }
      }
    }
    // The same chat comes back when the panel only hid, from the same app, a short while ago; the selection is read
    // again all the same, since the person may have selected something else meanwhile.
    const sameApp = (app?.pid ?? null) === (chat.app?.pid ?? null);
    const resumed = chat.live && sameApp && now() - ui.panelHiddenAt() < RESUME_MS;
    if (!resumed) replaceChat(newChat(app));
    Object.assign(chat, { app, selection, notice, resumed, live: true });
    await showPanel(stateOf(chat));
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
  function open() {
    if (!opening) {
      opening = openPanel().finally(() => {
        opening = null;
      });
    }
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
    return c === chat && (aside > 0 || ui.isPanelVisible());
  }

  /** Buddy stopped short of reading the box or looking at the app (present()): the chat says what to do then. */
  function askAgain(c) {
    add(c, { type: 'buddy', say: `Open me again and ask once more, so I can look at ${appName(c)}.`, text: '', notes: [], buttons: [] });
  }

  /** Show the panel again on the same chat, after it stepped aside: unless the chat was closed meanwhile. */
  async function comeBack(c) {
    if (c !== chat) return;
    c.resumed = true;
    await showPanel(stateOf(c));
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
    const sent = c.selection;
    const selection = sent ? { selection: sent } : {};
    let from = sent ? 'selection' : null; // where the text the answer works on came from
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
    }
    c.busy = false; // the answer is in: what is left is Buddy's own work
    if (reply.kind === 'box' || reply.kind === 'screen') return stop(c, 'not_found', "I couldn't find it. Select the text and ask me again.");
    // The selection went with this message: the next one goes without it, unless the person selects something again
    // (an opening meanwhile may have read a new one, which stays).
    if (c.selection === sent) c.selection = '';
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
   * happy, idle or sleepy.
   */
  async function talk(c, you) {
    if (sleepy !== null) {
      cancelLater(sleepy); // it would flip a busy or happy buddy back to idle
      sleepy = null;
    }
    ui.mood('thinking');
    c.busy = true;
    c.talking += 1;
    push(c);
    try {
      const answered = await answer(c, you);
      if (c === chat) ui.mood(answered ? 'happy' : 'idle');
    } catch (err) {
      if (c !== chat) {
        // Closed meanwhile: the buddy stopped thinking about it then (replaceChat).
      } else if (err.code === 'network') {
        ui.mood('sleepy');
        sleepy = later(() => {
          sleepy = null;
          ui.mood('idle');
        }, SLEEPY_MS);
      } else {
        ui.mood('idle');
      }
      failed(c, err, you);
    } finally {
      c.busy = false;
      c.talking -= 1;
      push(c);
    }
  }

  /** The person's message. An empty one with text selected means "fix this". One at a time: the next waits. */
  async function send(message) {
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
    await talk(c, add(c, { type: 'you', text }));
    return {};
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
    if (c === chat) ui.mood('happy'); // not for a chat closed meanwhile (Buddy turned off), as in talk()
    push(c);
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
  async function act(id, button) {
    const c = chat;
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

  return { open, toggle, dismiss, send, act, dropSelection, state: () => stateOf(chat) };
}

module.exports = { createActions, sectionFor, COPIED, SLEEPY_MS };
