'use strict';
/* global Vosk, VoiceTiming, EarCore, Wav */

/*
 * Buddy's ear page: hidden, it speaks (speechSynthesis), opens the microphone only while a command runs, and
 * recognises a short yes or no on the device with vosk-browser.
 *
 * What the spike (Task A8, Step 1) found: vosk-browser 0.0.8 runs in Electron 44.5.1 on macOS, in a hidden
 * BrowserWindow (show: false, backgroundThrottling: false, sandbox: true, contextIsolation: true) loaded with
 * loadFile. With the grammar ["yes","no","send","[unk]"] and the model vosk-model-small-en-in-0.4.tar.gz given as a
 * Blob URL it heard "yes" as "yes", "no" as "no" and "send it" as "send"; speechSynthesis.speak fires `end` with no
 * error (the sound itself was not checked); getUserMedia was not tried (the owner's check).
 *  - The CSP the plan expected FAILS: vosk's worker and wasm glue evals (EvalError: unsafe-eval not allowed). The
 *    smallest that works is: default-src 'self'; script-src 'self' 'unsafe-eval'; worker-src blob:; connect-src blob:;
 *    style-src 'self'. ('wasm-unsafe-eval' is not needed when 'unsafe-eval' is there.) That is why this page must stay
 *    local-only: no remote content, no remote script.
 *  - The API: `Vosk.createModel(blobUrl)` -> Promise<Model>; `new model.KaldiRecognizer(16000, jsonGrammar)`;
 *    `rec.setWords(true)`; `rec.acceptWaveformFloat(Float32Array, 16000)`; `rec.retrieveFinalResult()`;
 *    `rec.on('result', e => e.result.text)` (the final result from retrieveFinalResult arrives there too);
 *    `'partialresult'`; `rec.remove()`. The global is `Vosk`, with `Model` and `createModel`.
 *  - The model's ~37 MB reach the page through IPC (`ear:model`, an ArrayBuffer), then
 *    `URL.createObjectURL(new Blob([bytes]))`. No Electron flags are needed. Chunks of 4096 samples were fine.
 *  - The result needs a little trailing quiet (about 0.5 s) or a call to retrieveFinalResult() to arrive.
 * Whether the microphone opens in the hidden window is the owner's check.
 *
 * The rules this page keeps: the microphone is opened only inside a command and let go of at its end and on a stop;
 * listening for the answer starts 300 ms after the question has been spoken (the command `hear` is only sent after
 * `say` is done); 8 s without a decisive answer is a no; any error is an empty answer, which is a no; the recording
 * is only offered for the server when a voice was heard. This page never decides yes or no, main does.
 */

const RATE = 16000;
const SAY_MAX_MS = 20000;
const AFTER_SPEAKING_MS = 300; // quiet after the question, so its tail is never heard as an answer
const ANSWER_MS = 8000; // as voice-words.js ANSWER_MS: nothing decisive heard this long after the question: no
const FINAL_WAIT_MS = 600; // how long to wait for the recogniser's last word at the deadline
const ANSWER_KEEP_S = 10;
const MODEL_WAIT_MS = 3000; // a model not ready in 3 s is not waited for: the answer is recorded and the server hears it

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let mic = null; // { ctx, stream, source, processor } while the microphone is open
let onChunk = null; // where each buffer of microphone samples goes
let modelPromise = null; // the recogniser's model, loaded once per window
let current = null; // the command running: { finish(result) }, so a stop can end it
let queue = Promise.resolve();
let stopped = 0; // counts stops: a command queued before one never opens the microphone

async function openMic() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  const ctx = new AudioContext({ sampleRate: RATE });
  const source = ctx.createMediaStreamSource(stream);
  const processor = ctx.createScriptProcessor(2048, 1, 1);
  processor.onaudioprocess = (e) => {
    if (onChunk) onChunk(new Float32Array(e.inputBuffer.getChannelData(0)));
  };
  source.connect(processor);
  processor.connect(ctx.destination); // silent: its output buffer is left empty; the node only runs when connected
  mic = { ctx, stream, source, processor };
}

function closeMic() {
  onChunk = null;
  const m = mic;
  mic = null;
  if (!m) return;
  try { m.processor.onaudioprocess = null; m.source.disconnect(); m.processor.disconnect(); } catch { /* already apart */ }
  try { m.stream.getTracks().forEach((t) => t.stop()); } catch { /* already stopped */ }
  try { m.ctx.close(); } catch { /* already closed */ }
}

function loadModel() {
  if (!modelPromise) {
    modelPromise = (async () => {
      const r = await window.ear.model();
      if (!r || !r.bytes) return null;
      return Vosk.createModel(URL.createObjectURL(new Blob([r.bytes])));
    })().catch(() => null);
    modelPromise.then((m) => { if (!m) modelPromise = null; }); // try again next time
  }
  return modelPromise;
}

/** Runs `body(finish, over)` as the current command; it ends when finish(result) is first called, or by a stop. */
function command(body) {
  return new Promise((resolve) => {
    let over = false;
    const finish = (result) => {
      if (over) return;
      over = true;
      current = null;
      resolve(result);
    };
    current = { finish };
    Promise.resolve().then(() => body(finish, () => over)).catch(() => finish({}));
  });
}

function say({ text }) {
  loadModel(); // the ears load while the question is spoken
  return command((finish) => {
    const u = new SpeechSynthesisUtterance(String(text || ''));
    const timer = setTimeout(() => { speechSynthesis.cancel(); finish({}); }, SAY_MAX_MS);
    const end = () => { clearTimeout(timer); finish({}); };
    u.addEventListener('end', end);
    u.addEventListener('error', end);
    speechSynthesis.speak(u);
  });
}

function hear({ grammar, needsServer, decisive }) {
  let rec = null;
  let deadlineTimer = null;
  return command(async (finish, over) => {
    const keeper = new EarCore.PcmKeeper(ANSWER_KEEP_S * RATE);
    const timing = VoiceTiming.createVoiceTiming({ quietMs: 1500, nothingMs: ANSWER_MS, maxMs: 10000 });
    let samples = 0;
    let lastFinal = '';
    let resultWaiter = null;
    try {
      // The model first, while the microphone is still shut: it was started when the window loaded and again at `say`,
      // so it is usually there. Waiting for it with the microphone open would lose the start of the answer.
      const model = grammar ? await Promise.race([loadModel(), pause(MODEL_WAIT_MS).then(() => null)]) : null;
      if (over()) return;
      await openMic(); // opened only now
      if (over()) { closeMic(); return; } // stopped while the microphone was being asked for: let go of at once
      await pause(AFTER_SPEAKING_MS); // nothing is listened to for 300 ms, so the question's tail is never an answer
      if (over()) return;
      // No recogniser (no model yet, or it would not load): the server must hear the answer, whatever main said.
      const turn = EarCore.createAnswerTurn({ decisive, needsServer: Boolean(needsServer) || !model, timing });
      const decided = (d) => {
        clearTimeout(deadlineTimer);
        finish(d.audio ? { audio: Wav.base64(keeper.all()) } : { text: d.text });
      };
      if (model) {
        rec = new model.KaldiRecognizer(RATE, JSON.stringify(grammar));
        rec.setWords(true);
        rec.on('result', (e) => {
          const text = (e && e.result && e.result.text) || '';
          if (text) lastFinal = text;
          if (resultWaiter) resultWaiter();
          const d = turn.result(text);
          if (d && !over()) decided(d);
        });
      }
      // The answer is over: the recogniser's last word is taken, then the words if decisive, else the recording when the
      // server must hear it and a voice was heard, else nothing. Once, whether it is the quiet or the deadline that comes first.
      let ending = false;
      const endAnswer = async () => {
        if (over() || ending) return;
        ending = true;
        if (rec) {
          const gotIt = new Promise((resolve) => { resultWaiter = resolve; setTimeout(resolve, FINAL_WAIT_MS); });
          try { rec.retrieveFinalResult(); } catch { /* the recogniser is gone */ }
          await gotIt;
        }
        if (!over()) decided(turn.timeUp(lastFinal));
      };
      deadlineTimer = setTimeout(endAnswer, ANSWER_MS);
      onChunk = (chunk) => {
        if (over() || ending) return;
        samples += chunk.length;
        const level = VoiceTiming.levelOf(chunk);
        keeper.add(EarCore.toPcm16(chunk));
        if (rec) {
          try { rec.acceptWaveformFloat(chunk, RATE); } catch { /* the recogniser is gone */ }
        }
        // Quiet after the voice ends an undecided answer; so does 8 s without any voice, which is a no with no server call.
        if (turn.feed(level, samples / 16) !== 'listen') endAnswer();
      };
    } catch {
      finish({ text: '' }); // any error is a no
    }
  }).then((result) => {
    // The microphone and the recogniser are let go of at the end of every command.
    clearTimeout(deadlineTimer);
    closeMic();
    if (rec) { try { rec.remove(); } catch { /* gone */ } }
    return result;
  });
}

function listen({ quietMs, nothingMs, maxMs }) {
  return command(async (finish, over) => {
    const timing = VoiceTiming.createVoiceTiming({ quietMs, nothingMs, maxMs });
    const keeper = new EarCore.PcmKeeper(Math.ceil((maxMs / 1000 + 1) * RATE));
    let samples = 0;
    try {
      await openMic();
      if (over()) { closeMic(); return; }
      onChunk = (chunk) => {
        if (over()) return;
        samples += chunk.length;
        keeper.add(EarCore.toPcm16(chunk));
        if (timing.feed(VoiceTiming.levelOf(chunk), samples / 16) === 'listen') return;
        finish(timing.heardVoice() ? { audio: Wav.base64(keeper.all()) } : {});
      };
    } catch {
      finish({});
    }
  }).then((result) => {
    closeMic();
    return result;
  });
}

const COMMANDS = { say, hear, listen };

window.ear.onDo(({ id, cmd, args }) => {
  // One command at a time, in the order sent.
  const stopsBefore = stopped;
  queue = queue.then(async () => {
    let result;
    try {
      result = stopsBefore !== stopped ? { gone: true } : COMMANDS[cmd] ? await COMMANDS[cmd](args || {}) : {};
    } catch {
      result = {};
    }
    window.ear.done(id, result);
  });
});

loadModel(); // and once when the window loads

window.ear.onStop(() => {
  stopped += 1; // commands still queued behind the running one are flushed
  speechSynthesis.cancel();
  if (current) current.finish({ stopped: true });
  closeMic();
});
