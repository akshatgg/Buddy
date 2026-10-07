'use strict';
/* global ChatView, VoiceTiming */

/*
 * The panel is a chat. The main process keeps the chat and sends all of it after every change (src/main/actions.js);
 * this page only draws it, and sends what the person types and the buttons they click. What to draw for each item
 * comes from chat-view.js. Every word from the chat is put in as text, never as HTML.
 *
 * The list is drawn anew on every change, so it is not a live region (a screen reader would read the whole chat out
 * again each time): what is new in it is read out through #announce instead.
 *
 * The panel also listens (the end of this file): it records what is said, works out when the person has finished
 * (voice-timing.js), has it written down through Buddy's server, and sends the words as if they had been typed.
 */

const $ = (id) => document.getElementById(id);
const { canSend, itemParts, selectionPreview, speaker, spokenLine, thinkingLine } = ChatView;
const { createVoiceTiming, levelOf, recordingMime, listensOnOpen } = VoiceTiming;

let state = null; // the chat as the main process sent it last
let sending = false; // a message is on its way: the next one waits until its answer is in
let generation = 0; // counts how often the panel has been opened; an answer to a request from an earlier opening is stale
let newest = null; // the last item and whether the buddy was thinking, as last drawn: something new there scrolls to it
let heard = null; // what a screen reader was told of each item, by id; null until the chat is first drawn
const acting = new Set(); // the items whose button was clicked and is still being done, so that a second click waits
let fixIn = ''; // where Open Settings on the line under the box goes ('' when the line has no such button)
let voice = 'idle'; // the listening: 'idle', 'starting' (opening the microphone), 'listening' or 'writing' (writing it down)
let listen = null; // what a listening holds while it records: the microphone, the recorder, the meter, the timing
let voiceTurn = 0; // counts the listenings; what comes back for one that was stopped meanwhile is dropped

function show(el, visible) {
  el.hidden = !visible;
}

function make(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text) el.textContent = text;
  return el;
}

/**
 * A line under the box for a message, a click or a recording that did not go through. With `settingsCode`, it has an
 * Open Settings button that opens Settings where the fix is (the microphone: 'no_microphone').
 */
function showSendError(message, settingsCode = '') {
  fixIn = message ? settingsCode : '';
  $('send-error-text').textContent = message || '';
  show($('send-error-settings'), Boolean(fixIn));
  show($('send-error'), Boolean(message));
}

function drawButtons(parts) {
  const row = make('div', 'actions');
  for (const { button, label, primary } of parts.buttons) {
    let look = primary ? 'btn small primary' : 'btn small';
    if (parts.kind === 'event') look = 'btn small quiet'; // a small line's Undo reads like a link
    const b = make('button', look, label);
    b.type = 'button';
    b.disabled = acting.has(parts.id);
    b.addEventListener('click', () => act(parts.id, button, row));
    row.append(b);
  }
  return row;
}

/**
 * One item of the chat: yours on the right, the buddy's on the left, what happened as a small line in the middle. A
 * message starts with who it is from ("You:", "Aarav:"), for screen readers only: the side it is on says it to the eye.
 */
function drawItem(parts, buddyName) {
  const li = make('li', `item ${parts.kind}`);
  if (parts.kind === 'event') {
    li.append(make('p', 'text', parts.text));
    if (parts.buttons.length) li.append(drawButtons(parts));
    return li;
  }
  const bubble = make('div', 'bubble');
  bubble.append(make('span', 'visually-hidden', `${speaker(parts.kind, buddyName)} `));
  if (parts.say) bubble.append(make('p', 'say', parts.say));
  if (parts.text) bubble.append(make('p', 'text', parts.text));
  if (parts.notes.length) {
    const notes = make('ul', 'notes');
    notes.append(...parts.notes.map((note) => make('li', '', note)));
    bubble.append(notes);
  }
  if (parts.buttons.length) bubble.append(drawButtons(parts));
  li.append(bubble);
  return li;
}

/**
 * Reads out to a screen reader the items that are new in the chat, or that changed (an Undo that was used), and not
 * the person's own messages: they wrote them. What was there when the chat was first drawn is not read out.
 */
function announce(parts, buddyName) {
  const now = new Map(parts.map((p) => [p.id, spokenLine(p, buddyName)]));
  const lines = heard ? parts.filter((p) => p.kind !== 'you' && heard.get(p.id) !== now.get(p.id)).map((p) => now.get(p.id)) : [];
  heard = now;
  // New lines each time, so that the same words twice (two answers alike) are read out twice too.
  if (lines.length) $('announce').replaceChildren(...lines.map((line) => make('p', '', line)));
}

/**
 * The list is drawn anew on every change, which takes the keyboard focus with it when it was on one of its buttons:
 * then it goes back to the box, so that the person can type on. Not when they put it somewhere else, or are selecting
 * words in the chat to copy them.
 */
function focusBoxIfLost() {
  const at = document.activeElement;
  if (at && at !== document.body && at.isConnected) return;
  const selection = document.getSelection();
  if (selection && !selection.isCollapsed) return;
  $('box').focus();
}

function updateSend() {
  const ready = Boolean(state) && voice !== 'writing' && canSend({ busy: state.busy || sending, text: $('box').value, selection: state.selection });
  $('send').disabled = !ready;
}

/** Shows the newest item: its end, or its start when it is taller than the list (a long mail is read from the top). */
function scrollToNewest() {
  const chat = $('chat');
  const last = $('items').lastElementChild;
  if (last && !state.busy && last.offsetHeight > chat.clientHeight) {
    chat.scrollTop = last.offsetTop - 8; // the list is the item's offset parent (panel.css)
  } else {
    chat.scrollTop = chat.scrollHeight;
  }
}

function render({ scroll = false } = {}) {
  const s = state;
  $('who').textContent = s.buddyName || 'Buddy';
  $('where').textContent = s.appName ? `· ${s.appName}` : '';
  $('greeting').textContent = s.greeting || 'Hi! What should we do?';

  const parts = (Array.isArray(s.chat) ? s.chat : []).map(itemParts).filter(Boolean);
  const focusInList = $('items').contains(document.activeElement);
  $('items').replaceChildren(...parts.map((p) => drawItem(p, s.buddyName)));
  if (focusInList) focusBoxIfLost();
  announce(parts, s.buddyName);
  show($('empty'), parts.length === 0);
  // Written only when it changes: the line is read out whenever its words are written.
  const thinking = thinkingLine(s.buddyName);
  if ($('thinking').textContent !== thinking) $('thinking').textContent = thinking;
  show($('thinking'), Boolean(s.busy));

  $('notice').textContent = s.notice || '';
  show($('notice'), Boolean(s.notice));
  $('selection-text').textContent = s.selection ? `“${selectionPreview(s.selection)}”` : '';
  show($('selection'), Boolean(s.selection));
  updateSend();

  // Scrolled when something new came in at the bottom, not when an older item changed (its Undo used, say), so
  // that the list stays where the person is reading.
  const now = { id: parts.length ? parts[parts.length - 1].id : null, busy: Boolean(s.busy) };
  if (scroll || !newest || now.id !== newest.id || (now.busy && !newest.busy)) scrollToNewest();
  newest = now;
}

async function send() {
  cancelListening(); // ↩ or the send button while listening: what was typed goes, and nothing of the listening
  if (!state || !canSend({ busy: state.busy || sending, text: $('box').value, selection: state.selection })) return;
  const mine = generation;
  const message = $('box').value.trim();
  $('box').value = '';
  showSendError('');
  sending = true;
  updateSend();
  let r;
  try {
    r = await window.buddy.send(message); // an empty message with a selection fixes the selection
  } finally {
    if (mine === generation) {
      sending = false;
      updateSend();
    }
  }
  if (mine !== generation || r.ok) return; // the answer (or what went wrong) is in the chat by now
  if (!$('box').value) $('box').value = message; // it did not go: the words are given back, to send again
  showSendError(r.error.message);
  updateSend();
}

async function act(id, button, row) {
  if (acting.has(id)) return;
  const mine = generation;
  acting.add(id);
  for (const b of row.querySelectorAll('button')) b.disabled = true;
  showSendError('');
  let r;
  try {
    r = await window.buddy.act(id, button);
  } finally {
    if (mine === generation) {
      acting.delete(id);
      render();
      // Still this opening of the panel. Where it stayed open (Copy, Not now, Try again, Undo on "Remembered"), the
      // button that was clicked went with the list drawn again: the keyboard goes back to the box.
      focusBoxIfLost();
    }
  }
  if (mine === generation && !r.ok) showSendError(r.error.message);
}

const box = $('box');
box.addEventListener('input', () => {
  cancelListening(); // typing stops listening, and nothing of it is sent
  updateSend();
});
box.addEventListener('keydown', (e) => {
  // ↩ sends and ⇧↩ starts a new line. While an input method is composing (Hindi, Devanagari), ↩ belongs to it.
  if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
  e.preventDefault();
  send();
});
$('send').addEventListener('click', () => {
  send();
  box.focus();
});
$('drop-selection').addEventListener('click', async () => {
  const r = await window.buddy.dropSelection();
  if (!r.ok) showSendError(r.error.message);
  box.focus();
});
$('close').addEventListener('click', closePanel);
$('settings').addEventListener('click', () => {
  cancelListening();
  window.buddy.openSettings();
});
$('send-error-settings').addEventListener('click', () => {
  if (fixIn) window.buddy.openSettings(fixIn);
});

/** ✕ and Esc: the panel closes, and a listening ends with it (nothing of it is sent). */
function closePanel() {
  cancelListening();
  window.buddy.close();
}

document.addEventListener('keydown', (e) => {
  if (e.isComposing) return; // Esc belongs to the input method while it is composing
  if (e.key === 'Escape') closePanel();
});

window.buddy.onOpen((s) => {
  generation += 1;
  cancelListening(); // a listening from before this opening ends here, and nothing of it is sent
  sending = false;
  acting.clear();
  heard = null; // what is in the chat as it opens is not read out: only what comes after
  showSendError('');
  if (!s.resumed) box.value = ''; // a new chat starts with an empty box; a resumed one keeps what was typed
  state = s;
  render({ scroll: true });
  box.focus();
  if (listensOnOpen(s.voice, { busy: s.busy })) startListening({ byItself: true });
});

window.buddy.onState((s) => {
  state = s;
  render();
});

/* ---- Voice: the panel listens, and what was said is written down and sent ---- */

const LEVEL_EVERY_MS = 100; // how often the loudness is looked at, and sent to main: at most 10 times a second
const SLICE_MS = 250; // the recorder hands over what it has this often, so the recording's size is known as it grows
const MAX_RECORDING_BYTES = 2_000_000; // about 2 MB: the most Buddy's server takes
const RECORDING_TYPE = 'audio/webm;codecs=opus';
const FULL_BARS_LEVEL = 0.25; // the bars stand at their full height at this loudness (a voice is mostly under it)
const MIC_SETTINGS = 'no_microphone'; // Open Settings for the microphone: Permissions on the Mac, Windows' own Settings
// How long the page waits, once the system says it is hidden, before it stops listening: a late "hidden" for a hide
// that is already over is followed by "shown" well within this.
const HIDDEN_SETTLE_MS = 300;
const PLACEHOLDERS = {
  idle: 'Tell me what to do…',
  starting: 'Tell me what to do…',
  listening: 'Listening… speak now',
  writing: 'Writing down what you said…',
};
// What 🎤 does now, on its tooltip: while what was said is written down, it drops that.
const MIC_TITLES = { idle: 'Talk', starting: 'Stop listening', listening: 'Stop listening', writing: 'Stop writing it down' };
const VOICE_WORDS = {
  off: "Voice isn't set up yet.",
  notCaught: "I didn't catch that. Try again, or type.",
  allowMac: 'Allow the microphone in Settings.',
  allowWindows: 'Turn on the microphone in Windows Settings → Privacy & security → Microphone.',
  noMic: "I can't find a microphone.",
  micFailed: "I couldn't use the microphone. Try again.",
  notWritten: "I couldn't write down what you said. Try again.",
  wait: 'Wait for my answer first.',
};

/**
 * Draws the listening: 🎤 glows while it listens, the bars follow the voice, the box says what is going on. The box can
 * still be typed in while what was said is written down: typing stops that.
 */
function setVoice(next) {
  voice = next;
  const on = next === 'starting' || next === 'listening';
  $('box-frame').classList.toggle('listening', next === 'listening');
  $('box-frame').classList.toggle('writing', next === 'writing');
  $('box').placeholder = PLACEHOLDERS[next];
  $('mic').setAttribute('aria-pressed', String(on));
  $('mic').title = MIC_TITLES[next];
  show($('voice-bars'), next === 'listening' || next === 'writing');
  if (next !== 'listening') drawBars([0, 0, 0]);
  // What the box says, for a screen reader too (its placeholder is not read out as it changes).
  if (next === 'listening' || next === 'writing') $('announce').replaceChildren(make('p', '', PLACEHOLDERS[next]));
  updateSend();
}

/** Listening ends with something to tell the person, on the line under the box. */
function voiceProblem(message, settingsCode = '') {
  setVoice('idle');
  showSendError(message, settingsCode);
}

/** What to say when the microphone could not be opened, and whether Settings has the fix. */
function micProblem(err, system) {
  if (system === 'win32') return { message: VOICE_WORDS.allowWindows, settings: true }; // Windows blocks it in its own Settings
  const name = err?.name;
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return { message: VOICE_WORDS.noMic, settings: false };
  if (system === 'darwin' && (name === 'NotAllowedError' || name === 'SecurityError')) return { message: VOICE_WORDS.allowMac, settings: true };
  return { message: VOICE_WORDS.micFailed, settings: false };
}

/**
 * Starts listening: as the panel opens (`byItself`, when the person wants that) or on 🎤. Main says first whether
 * the microphone may be used (on the Mac, macOS asks the person the first time); then it is opened and recorded.
 */
async function startListening({ byItself = false } = {}) {
  if (voice !== 'idle' || !state) return;
  if (state.voice?.on !== true) {
    if (!byItself) showSendError(VOICE_WORDS.off);
    return;
  }
  const system = state.voice.system;
  const turn = ++voiceTurn;
  const stillMine = () => turn === voiceTurn; // not stopped meanwhile (typing, 🎤, Esc, the panel hidden or opened again)
  // Listening by itself, a microphone that cannot be used says nothing: the person did not ask for it, and would see
  // the same red line at every opening. On 🎤 it says what to do.
  const problem = (message, settingsCode = '') => (byItself ? setVoice('idle') : voiceProblem(message, settingsCode));
  const micFix = (err) => {
    const fix = micProblem(err, system);
    return problem(fix.message, fix.settings ? MIC_SETTINGS : '');
  };
  showSendError('');
  setVoice('starting');

  let access;
  try {
    access = await window.buddy.micAccess();
  } catch {
    access = { ok: false, error: { message: VOICE_WORDS.micFailed } };
  }
  if (!stillMine()) return;
  if (!access.ok) return problem(access.error.message);
  // Refused by the system (macOS, or Windows' privacy switch): said as a refused recording would be.
  if (['denied', 'restricted', 'not-determined'].includes(access.mic)) return micFix({ name: 'NotAllowedError' });

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch (err) {
    if (!stillMine()) return;
    return micFix(err);
  }
  if (!stillMine()) {
    for (const track of stream.getTracks()) track.stop(); // it came too late: let go of it at once
    return;
  }
  try {
    listen = record(stream);
  } catch {
    return problem(VOICE_WORDS.micFailed);
  }
  setVoice('listening');
  window.buddy.listening(true);
}

/**
 * Records the microphone's stream (WebM/Opus where the browser has it) and measures how loud it is (an AnalyserNode),
 * looked at every 100 ms. Throws, with the microphone let go of, when either cannot be set up.
 */
function record(stream) {
  const rec = { stream, chunks: [], bytes: 0, timing: createVoiceTiming(), startedAt: performance.now(), recent: [0, 0] };
  try {
    rec.context = new AudioContext();
    rec.analyser = rec.context.createAnalyser();
    rec.analyser.fftSize = 2048;
    rec.samples = new Float32Array(rec.analyser.fftSize);
    rec.context.createMediaStreamSource(stream).connect(rec.analyser);
    const type = MediaRecorder.isTypeSupported(RECORDING_TYPE) ? { mimeType: RECORDING_TYPE } : {};
    rec.recorder = new MediaRecorder(stream, type);
    rec.recorder.addEventListener('dataavailable', (e) => {
      if (!e.data.size) return;
      rec.chunks.push(e.data);
      rec.bytes += e.data.size;
    });
    rec.stopped = new Promise((resolve) => rec.recorder.addEventListener('stop', resolve, { once: true }));
    rec.recorder.addEventListener('error', () => {
      if (listen !== rec) return;
      cancelListening();
      showSendError(VOICE_WORDS.micFailed);
    });
    rec.recorder.start(SLICE_MS);
  } catch (err) {
    release(rec);
    throw err;
  }
  // The microphone went away (unplugged): what was said so far is sent, as when they stop talking.
  for (const track of stream.getAudioTracks()) {
    track.addEventListener('ended', () => {
      if (listen === rec) finishListening(rec.timing.heardVoice());
    });
  }
  rec.timer = setTimeout(() => look(rec), LEVEL_EVERY_MS);
  return rec;
}

/** Every 100 ms while listening: how loud it is, for the timing, the bars and main; and whether it has ended. */
function look(rec) {
  if (listen !== rec) return;
  rec.analyser.getFloatTimeDomainData(rec.samples);
  const level = levelOf(rec.samples);
  window.buddy.voiceLevel(level);
  drawBars([rec.recent[0] * 0.8, level, rec.recent[1] * 0.65]); // the newest in the middle, so that they ripple
  rec.recent = [level, rec.recent[0]];
  let end = rec.timing.feed(level, performance.now() - rec.startedAt);
  if (end === 'listen' && rec.bytes >= MAX_RECORDING_BYTES) end = 'too-long';
  // The next look is set once this one is done, so the level goes to main at most 10 times a second.
  if (end === 'listen') rec.timer = setTimeout(() => look(rec), LEVEL_EVERY_MS);
  else finishListening(end !== 'nothing' && rec.timing.heardVoice()); // nothing said, or noise alone: it ends quietly
}

/** The three bars' heights, from a dot (0.2) to full (1); the square root lets a quiet voice move them too. */
function drawBars(levels) {
  const bars = $('voice-bars').children;
  levels.forEach((level, i) => {
    const height = Math.min(1, Math.max(0.2, Math.sqrt(level / FULL_BARS_LEVEL)));
    bars[i].style.setProperty('--level', height.toFixed(2));
  });
}

/** Lets go of the microphone: the timer and the recording stop, every track is stopped, the AudioContext closed. */
function release(rec) {
  clearTimeout(rec.timer);
  if (rec.recorder && rec.recorder.state !== 'inactive') rec.recorder.stop();
  for (const track of rec.stream.getTracks()) track.stop();
  if (rec.context && rec.context.state !== 'closed') rec.context.close().catch(() => {});
}

/** The recording as plain base64 (no "data:…;base64," in front); '' when there is none or it cannot be read. */
function base64Of(blob) {
  return new Promise((resolve) => {
    if (!blob.size) return resolve('');
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      const comma = url.indexOf(',');
      resolve(comma < 0 ? '' : url.slice(comma + 1));
    };
    reader.onerror = () => resolve('');
    reader.readAsDataURL(blob);
  });
}

/**
 * Listening has ended by itself (they stopped talking, 60 s, 2 MB, the microphone went away). The microphone is let
 * go of at once. With `heardVoice`, what was said is written down, put in the box and sent as if ↩ had been pressed.
 */
async function finishListening(heardVoice) {
  const rec = listen;
  const turn = voiceTurn;
  listen = null;
  release(rec);
  window.buddy.listening(false);
  if (!heardVoice) return setVoice('idle');

  setVoice('writing');
  await rec.stopped; // the recorder has handed over the last of the recording
  const mime = recordingMime(rec.recorder.mimeType);
  const audio = await base64Of(new Blob(rec.chunks, { type: mime }));
  if (turn !== voiceTurn) return; // stopped meanwhile: nothing is sent
  let r = { ok: true, text: '' }; // no recording came of it: nothing was caught
  if (audio) {
    try {
      r = await window.buddy.transcribe(audio, mime);
    } catch {
      r = { ok: false, error: { message: VOICE_WORDS.notWritten } };
    }
    if (turn !== voiceTurn) return; // stopped while it was being written down: nothing is sent
  }
  if (document.hidden) return cancelListening(); // hidden meanwhile, and not stopped yet (see the end): nothing is sent
  setVoice('idle');
  if (!r.ok) return showSendError(r.error.message); // the server's own words (voice is busy, not set up, …)
  const words = typeof r.text === 'string' ? r.text.trim() : '';
  if (!words) return showSendError(VOICE_WORDS.notCaught);
  const typed = $('box').value.trimEnd();
  $('box').value = typed ? `${typed} ${words}` : words;
  // One message at a time: while the buddy is still answering, the words wait in the box, to send once it has.
  if (state.busy || sending) {
    updateSend();
    return showSendError(VOICE_WORDS.wait);
  }
  send();
}

/**
 * Stops listening, or writing down what was said, and nothing of it is sent: 🎤, typing, ↩, Esc, ✕, the panel hidden
 * or opened again. The microphone is let go of.
 */
function cancelListening() {
  if (voice === 'idle') return;
  voiceTurn += 1;
  const rec = listen;
  listen = null;
  if (rec) {
    release(rec);
    window.buddy.listening(false);
  }
  setVoice('idle');
}

// 🎤 starts listening, and stops it. While what was said is being written down, it drops that (and does not listen).
$('mic').addEventListener('click', () => {
  if (voice !== 'idle') return cancelListening();
  startListening();
});
// Hidden by main (a click somewhere else, Buddy putting text in the app, the shortcut): listening stops, and nothing of
// it is sent. The system can say so late, though: macOS may tell the page about a brief hide of Buddy's own only once
// main has shown the panel again, with "shown" just after. So listening stops only when the page is still hidden a
// moment later, and one that began after such a hide goes on. (Shown again, the panel always comes with a new opening,
// which ends a listening from before it by itself.)
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) return;
  setTimeout(() => {
    if (document.hidden) cancelListening();
  }, HIDDEN_SETTLE_MS);
});
// The page going away.
window.addEventListener('pagehide', cancelListening);
