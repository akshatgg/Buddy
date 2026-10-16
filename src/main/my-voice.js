'use strict';

/**
 * "Only my voice" on the Mac (docs/superpowers/specs/2026-10-16-only-my-voice-design.md): learns the owner's voice from
 * five takes of the wake phrase, and says whether the phrase clip of a wake is the owner's. The rules (the numbers, the
 * setup's steps, the profile file, the copy) are shared/my-voice.js; this is the file, the model, the check process and
 * the wake loop put together.
 *
 * Privacy: the profile lives only in `file` (<userData>/my-voice.json, mode 0600) -- never in the settings store, never
 * synced, never logged. Clips and take embeddings are kept in memory only while they are used. The log says only
 * "voice check: <code>". Anything that goes wrong in a check (no clip, a short clip, no model, no profile, a crashed or
 * slow worker) means "not the owner".
 */

const fs = require('node:fs');
const {
  MY_VOICE, MY_VOICE_LINES, createSetup, isMe, profileJson, readProfile,
} = require('../../shared/my-voice');

const SAMPLES_MIN = MY_VOICE.minPhraseMs * 16;
const SAMPLES_MAX = MY_VOICE.maxPhraseMs * 16;

/** The clip's samples (base64 PCM16), or null when it is not a string. */
function decode(b64) {
  if (typeof b64 !== 'string' || !b64) return null;
  const bytes = Buffer.from(b64, 'base64');
  const out = new Int16Array(bytes.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = bytes.readInt16LE(i * 2);
  return out;
}

const phraseOk = (pcm) => Boolean(pcm) && pcm.length >= SAMPLES_MIN && pcm.length <= SAMPLES_MAX;

/**
 * `model` is createSpeakerModel(...), `check` createVoiceCheck(...), and `wake.clips(phrase, onClip) -> stop()` the wake
 * loop listening for one phrase in setup mode. `onChange(state)` hears every change of state().
 */
function createMyVoice({
  store, file, fsImpl = fs, model, check, wake, setupMs = MY_VOICE.setupMs, onChange = null,
}) {
  let cached; // undefined: not read yet; null: no usable profile; else the profile
  let run = null; // the setup running: { promise, cancel, line, tone, percent }

  const on = () => store.get('myVoiceOn') === true;
  const changed = () => { onChange?.(stateOf()); };
  const log = (code) => console.warn('[buddy] voice check:', code);

  function profile() {
    if (cached !== undefined) return cached;
    try {
      cached = readProfile(JSON.parse(fsImpl.readFileSync(file, 'utf8')));
    } catch {
      cached = null;
    }
    return cached;
  }

  async function allows(phraseB64) {
    if (!on()) return true;
    try {
      const p = profile();
      if (!p) { log('no_profile'); return false; }
      const pcm = decode(phraseB64);
      if (!phraseOk(pcm)) { log('short'); return false; }
      const embedding = await check.embed(pcm);
      if (!embedding) { log('no_embedding'); return false; }
      return isMe(p, embedding);
    } catch {
      log('error');
      return false;
    }
  }

  function save(profileVector) {
    const tmp = `${file}.tmp`;
    fsImpl.writeFileSync(tmp, JSON.stringify(profileJson(profileVector)), { mode: 0o600 });
    fsImpl.chmodSync(tmp, 0o600);
    fsImpl.renameSync(tmp, file);
    cached = undefined;
  }

  function setup({ name, phrase, onLine }) {
    if (run) return run.promise;
    const r = { line: null, tone: null, percent: undefined, stopClips: null, timer: null, finish: null, over: false };
    const say = (line, tone) => {
      r.line = line;
      r.tone = tone;
      onLine?.(line, tone);
      changed();
    };
    r.promise = new Promise((resolve) => {
      r.finish = (result) => {
        if (r.over) return;
        r.over = true;
        clearTimeout(r.timer);
        try { r.stopClips?.(); } catch { /* the loop is gone */ }
        run = null;
        resolve(result);
        changed();
      };
    });
    run = r;
    r.cancel = () => r.finish({ ok: false, line: '' });
    const end = (line, tone, ok = false) => { say(line, tone); r.finish({ ok, line }); };

    (async () => {
      if (!model.ready()) {
        say(MY_VOICE_LINES.gettingModel, null);
        try {
          await model.ensure({ onProgress: (p) => { r.percent = p; changed(); } });
        } catch {
          if (!r.over) end(MY_VOICE_LINES.modelFailed, 'error');
          return;
        }
        r.percent = undefined;
      }
      if (r.over) return;
      check.warm();
      const steps = createSetup();
      say(MY_VOICE_LINES.start(name), null);
      let chain = Promise.resolve();
      const onClip = (b64) => {
        chain = chain.then(async () => {
          if (r.over) return;
          const pcm = decode(b64);
          const embedding = phraseOk(pcm) ? await check.embed(pcm) : null;
          if (r.over) return;
          const s = steps.add(embedding);
          if (s.step === 'more') say(MY_VOICE_LINES.got(s.count), 'good');
          else if (s.step === 'again') say(MY_VOICE_LINES.again(name), 'error');
          else if (s.step === 'odd') say(MY_VOICE_LINES.odd(name), 'error');
          else if (s.step === 'failed') end(MY_VOICE_LINES.failed, 'error');
          else if (s.step === 'done') {
            save(s.profile);
            store.set({ myVoiceOn: true });
            end(MY_VOICE_LINES.done, 'good', true);
          }
        }).catch(() => { if (!r.over) end(MY_VOICE_LINES.failed, 'error'); });
        return chain; // (the wake loop ignores it; a test waits on it)
      };
      r.timer = setTimeout(() => { if (!r.over) end(MY_VOICE_LINES.timedOut, 'error'); }, setupMs);
      r.stopClips = wake.clips(phrase, onClip);
      if (r.over) { try { r.stopClips?.(); } catch { /* gone */ } }
    })().catch(() => { if (!r.over) end(MY_VOICE_LINES.failed, 'error'); });
    return r.promise;
  }

  const cancel = () => { run?.cancel(); };

  function off() {
    cancel();
    store.set({ myVoiceOn: false });
    try { fsImpl.rmSync(file, { force: true }); } catch { /* already gone */ }
    cached = undefined;
    check.close();
    changed();
  }

  function stateOf() {
    const setting = Boolean(run);
    if (setting) {
      const s = { on: on(), line: run.line, tone: run.tone, setting: true };
      return run.percent === undefined ? s : { ...s, percent: run.percent };
    }
    if (!on()) return { on: false, line: null, tone: null, setting: false };
    const usable = profile() !== null && model.ready();
    return usable
      ? { on: true, line: MY_VOICE_LINES.on, tone: null, setting: false }
      : { on: true, line: MY_VOICE_LINES.setUpAgain, tone: 'error', setting: false };
  }

  return {
    on, allows, setup, cancel, off, state: stateOf,
    /** Starts the check process ahead of the first check (the wake loop calls it when it begins to listen). */
    warm() { if (on()) check.warm(); },
    /** The profile file changed outside this object (a test, or a restore): read it again next time. */
    changed() { cached = undefined; },
  };
}

module.exports = { createMyVoice };
