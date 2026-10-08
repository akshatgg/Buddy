'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { transcribe, handle } = require('../web/lib/handlers');
const { transcribeWithGroq, readRecording, GROQ_URL, PROMPT, TIMEOUT_MS, AUDIO_MAX_CHARS } = require('../web/lib/transcribe');
const { fakeDb } = require('./helpers/fake-db');

const NOW = new Date('2026-10-07T06:30:00Z');
const TODAY = '2026-10-07';
const RAHUL = { email: 'rahul@gmail.com', name: 'Rahul' };
const TOKENS = {
  user: { uid: 'u1', ...RAHUL, emailVerified: true },
  unverified: { uid: 'u2', email: 'x@gmail.com', name: 'X', emailVerified: false },
};
const refusal = (status, code, message) => ({ status, body: { error: { code, message } } });
const userDoc = (extra = {}) => ({ ...RAHUL, joined: NOW, lastActive: null, blocked: false, usedDay: '', usedCount: 0, ...extra });
const freeDaily = (n) => ({ enabled: true, limitMode: 'daily', dailyRequests: n, allowOwnKey: false, provider: 'anthropic', model: 'claude-x' });

// A few bytes standing in for a WebM recording, and how the app sends them.
const SOUND = Buffer.from('a webm recording, as bytes \u0000ÿ');
const AUDIO = SOUND.toString('base64');
const NOT_THROUGH = refusal(400, 'bad_request', "That recording didn't come through. Try again.");
const BUSY = refusal(429, 'voice_busy', 'Voice is busy right now. Type, or try again in a minute.');
const COULD_NOT = refusal(502, 'upstream', "I couldn't write down what you said. Try again.");

/** What a mocked console method was called with, one string per call. */
const logged = (mock) => mock.mock.calls.map((c) => c.arguments.join(' '));

/**
 * A fetch standing in for Groq's: records each call and answers with `status` and `body` (text, or JSON for anything
 * else); an Error in `fails` is thrown instead, as Node's fetch throws when there is no network.
 */
function fakeGroq({ status = 200, body = { text: ' Kal mujhe chutti chahiye. ' }, fails = null } = {}) {
  const calls = [];
  async function fetchImpl(url, init) {
    calls.push({ url, init });
    if (fails) throw fails;
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  }
  fetchImpl.calls = calls;
  return fetchImpl;
}

/** The form a call to Groq carried, field by field, with the file read back into bytes. */
async function formOf(call) {
  const form = call.init.body;
  assert.ok(form instanceof FormData, 'a multipart form');
  const file = form.get('file');
  return {
    fields: [...form.keys()],
    model: form.get('model'),
    responseFormat: form.get('response_format'),
    temperature: form.get('temperature'),
    prompt: form.get('prompt'),
    file: { name: file.name, type: file.type, bytes: Buffer.from(await file.arrayBuffer()) },
  };
}

/**
 * The transcribe handler with fakes: an in-memory database, the server's keys in `keys` (a Groq key unless told
 * otherwise), Groq as fakeGroq(groq), and ID tokens by name ('user', 'unverified'; any other is forged).
 * `run({ token, method, body })`.
 */
function setup({ stored = null, users = {}, keys = { groq: 'gsk-server-key' }, groq = {} } = {}) {
  const db = fakeDb({ config: stored, users });
  const fetchImpl = fakeGroq(groq);
  const deps = {
    async verifyToken(token) {
      if (!Object.hasOwn(TOKENS, token)) throw Object.assign(new Error('Decoding Firebase ID token failed'), { code: 'auth/argument-error' });
      return TOKENS[token];
    },
    db,
    providers: { getProvider: () => { throw new Error('voice asks no AI provider'); } },
    adminKeys: keys,
    adminEmail: 'akshatg9636@gmail.com',
    now: () => NOW,
    fetchImpl,
  };
  const run = ({ token = 'user', method = 'POST', body = { audio: AUDIO, mime: 'audio/webm;codecs=opus' } } = {}) => handle(transcribe, {
    method,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body,
  }, deps);
  return { db, groq: fetchImpl, run };
}

// ---- the call to Groq (web/lib/transcribe.js) ----

test("Groq gets the recording as a multipart form: the file, Whisper turbo, JSON, temperature 0 and the prompt, with the server's key", async () => {
  const fetchImpl = fakeGroq();
  const text = await transcribeWithGroq({ apiKey: 'gsk-key', audio: SOUND, mime: 'audio/webm;codecs=opus', fetchImpl });
  assert.strictEqual(text, 'Kal mujhe chutti chahiye.', 'trimmed');
  const [call] = fetchImpl.calls;
  assert.strictEqual(call.url, 'https://api.groq.com/openai/v1/audio/transcriptions');
  assert.strictEqual(GROQ_URL, call.url);
  assert.strictEqual(call.init.method, 'POST');
  // Only the key: fetch writes the form's content type itself, with the boundary between the fields.
  assert.deepStrictEqual(call.init.headers, { authorization: 'Bearer gsk-key' });
  assert.deepStrictEqual(await formOf(call), {
    fields: ['file', 'model', 'response_format', 'temperature', 'prompt'],
    model: 'whisper-large-v3-turbo',
    responseFormat: 'json',
    temperature: '0',
    prompt: PROMPT,
    file: { name: 'speech.webm', type: 'audio/webm', bytes: SOUND },
  });
});

test('the prompt is a short line in Hinglish and English, so that Hinglish comes back in English letters', () => {
  assert.strictEqual(PROMPT, 'Namaste. Kal mujhe chutti chahiye. Please write a mail to my boss.');
});

test("Node's own FormData and Blob make the multipart body Groq reads, as they will on Vercel's Node", async () => {
  const fetchImpl = fakeGroq();
  await transcribeWithGroq({ apiKey: 'gsk-key', audio: SOUND, mime: 'audio/webm', fetchImpl });
  const { url, init } = fetchImpl.calls[0];
  const request = new Request(url, init); // what Node's fetch would send
  assert.match(request.headers.get('content-type'), /^multipart\/form-data; boundary=\S+$/);
  const body = Buffer.from(await request.arrayBuffer());
  const text = body.toString('latin1');
  assert.match(text, /Content-Disposition: form-data; name="file"; filename="speech\.webm"\r\nContent-Type: audio\/webm\r\n\r\n/);
  assert.ok(body.includes(SOUND), 'the bytes of the recording, untouched');
  for (const [name, value] of [['model', 'whisper-large-v3-turbo'], ['response_format', 'json'], ['temperature', '0'], ['prompt', PROMPT]]) {
    assert.ok(text.includes(`Content-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`), name);
  }
});

test('each kind of recording goes with the file name Groq tells it by', async () => {
  const names = {
    'audio/webm': ['speech.webm', 'audio/webm'],
    'audio/webm;codecs=opus': ['speech.webm', 'audio/webm'],
    'audio/ogg': ['speech.ogg', 'audio/ogg'],
    'audio/ogg;codecs=opus': ['speech.ogg', 'audio/ogg'],
    'audio/mp4': ['speech.mp4', 'audio/mp4'],
    'audio/wav': ['speech.wav', 'audio/wav'],
  };
  for (const [mime, expected] of Object.entries(names)) {
    const fetchImpl = fakeGroq();
    await transcribeWithGroq({ apiKey: 'k', audio: SOUND, mime, fetchImpl });
    const { file } = await formOf(fetchImpl.calls[0]);
    assert.deepStrictEqual([file.name, file.type], expected, mime);
  }
});

test('Groq has 30 seconds', async (t) => {
  const timeout = t.mock.method(AbortSignal, 'timeout');
  const fetchImpl = fakeGroq();
  await transcribeWithGroq({ apiKey: 'k', audio: SOUND, mime: 'audio/webm', fetchImpl });
  assert.deepStrictEqual(timeout.mock.calls.map((c) => c.arguments[0]), [30_000]);
  assert.strictEqual(fetchImpl.calls[0].init.signal, timeout.mock.calls[0].result);
  assert.strictEqual(TIMEOUT_MS, 30_000);
});

test("a failure of Groq's is an error whose code says its kind, and nothing else", async () => {
  // Groq's answers and the fetch's errors can quote what it was sent: none of that may reach the code.
  const cases = [
    [{ status: 429, body: { error: { message: 'Rate limit reached: secret words' } } }, 'rate_limited'],
    [{ status: 500, body: 'secret words' }, 'http_500'],
    [{ status: 401, body: { error: { message: 'Invalid API Key' } } }, 'http_401'],
    [{ status: 400, body: { error: { message: 'could not process file: secret words' } } }, 'http_400'],
    [{ body: { nothing: 'secret words' } }, 'bad_answer'],
    [{ body: { text: 7 } }, 'bad_answer'],
    [{ body: 'not JSON: secret words' }, 'bad_answer'],
    [{ fails: new TypeError('fetch failed: secret words') }, 'network'],
    [{ fails: new DOMException('The operation was aborted due to timeout: secret words', 'TimeoutError') }, 'timeout'],
  ];
  for (const [groq, code] of cases) {
    const failure = await transcribeWithGroq({ apiKey: 'k', audio: SOUND, mime: 'audio/webm', fetchImpl: fakeGroq(groq) })
      .then(() => assert.fail('it should fail'), (err) => err);
    assert.strictEqual(failure.code, code, JSON.stringify(groq));
    assert.doesNotMatch(`${failure.message} ${failure.name}`, /secret/, code);
  }
});

test('a recording is read from the request: base64 of up to 2,800,000 characters, of a kind Groq takes', () => {
  assert.strictEqual(AUDIO_MAX_CHARS, 2_800_000);
  assert.deepStrictEqual(readRecording({ audio: AUDIO, mime: 'audio/ogg' }), { audio: SOUND, mime: 'audio/ogg' });
  const longest = 'A'.repeat(AUDIO_MAX_CHARS);
  assert.strictEqual(readRecording({ audio: longest, mime: 'audio/wav' }).audio.length, AUDIO_MAX_CHARS / 4 * 3);
});

// ---- POST /api/transcribe ----

test('transcribe: wants a valid ID token for a verified email, and a POST', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const s = setup();
  assert.deepStrictEqual(await s.run({ token: null }), refusal(401, 'unauthenticated', 'Sign in to use Buddy.'));
  assert.deepStrictEqual(await s.run({ token: 'forged' }), refusal(401, 'unauthenticated', "Buddy couldn't check your sign-in. Sign in again."));
  assert.deepStrictEqual(await s.run({ token: 'unverified' }),
    refusal(401, 'unauthenticated', 'Sign in with a Google account whose email is verified.'));
  assert.deepStrictEqual(await s.run({ method: 'GET' }), refusal(405, 'method_not_allowed', 'Not allowed.'));
  assert.deepStrictEqual([s.db.state.calls, s.groq.calls], [[], []], 'nothing was read, and Groq was not asked');
});

test("transcribe: Groq writes down the recording with the server's Groq key, and the words come back trimmed", async () => {
  const s = setup();
  assert.deepStrictEqual(await s.run(), { status: 200, body: { text: 'Kal mujhe chutti chahiye.' } });
  const [call] = s.groq.calls;
  assert.deepStrictEqual(call.init.headers, { authorization: 'Bearer gsk-server-key' });
  assert.deepStrictEqual((await formOf(call)).file, { name: 'speech.webm', type: 'audio/webm', bytes: SOUND });
  assert.ok(call.init.signal instanceof AbortSignal, 'Groq gets a deadline');
});

test('transcribe: every kind of recording the app may send is taken', async () => {
  for (const mime of ['audio/webm', 'audio/webm;codecs=opus', 'audio/ogg', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/wav']) {
    assert.strictEqual((await setup().run({ body: { audio: AUDIO, mime } })).status, 200, mime);
  }
});

test('transcribe: no words back is an empty text', async () => {
  for (const text of ['', '   \n']) {
    assert.deepStrictEqual(await setup({ groq: { body: { text } } }).run(), { status: 200, body: { text: '' } }, JSON.stringify(text));
  }
});

test('transcribe: not counted as a free request, past the daily limit or with free mode off; a first-time user is added', async () => {
  const atLimit = setup({ stored: freeDaily(1), users: { u1: userDoc({ usedDay: TODAY, usedCount: 1, lastActive: NOW }) } });
  assert.strictEqual((await atLimit.run()).status, 200);
  assert.deepStrictEqual(atLimit.db.state.users.u1, userDoc({ usedDay: TODAY, usedCount: 1, lastActive: NOW }), 'nothing changed');

  const freeOff = setup();
  assert.strictEqual((await freeOff.run()).status, 200);
  assert.deepStrictEqual(freeOff.db.state.users.u1, userDoc(), 'added, as /api/config adds them');
  for (const s of [atLimit, freeOff]) {
    assert.deepStrictEqual(s.db.state.calls, ['ensureUser'], 'only who they are was read: nothing counted, nothing given back');
  }
});

test('transcribe: a blocked person is refused, and Groq is not asked', async () => {
  const s = setup({ users: { u1: userDoc({ blocked: true }) } });
  assert.deepStrictEqual(await s.run(), refusal(403, 'blocked', 'Your free access is paused.'));
  assert.deepStrictEqual(s.groq.calls, []);
});

test('transcribe: with no Groq key on the server, voice is off, and nothing is read', async () => {
  for (const keys of [{ anthropic: 'k' }, { groq: '' }, {}, null]) {
    const s = setup({ keys });
    assert.deepStrictEqual(await s.run(), refusal(503, 'voice_off', "Voice isn't set up yet."), JSON.stringify(keys));
    assert.deepStrictEqual([s.db.state.calls, s.groq.calls], [[], []]);
  }
});

test('transcribe: a recording that did not come through is refused in plain words, before anything is read', async () => {
  const bodies = [
    null, 'not an object', [AUDIO], {},
    { mime: 'audio/webm' },
    { audio: '', mime: 'audio/webm' },
    { audio: 'A', mime: 'audio/webm' }, // base64 for no bytes at all
    { audio: 7, mime: 'audio/webm' },
    { audio: [AUDIO], mime: 'audio/webm' },
    { audio: 'A'.repeat(AUDIO_MAX_CHARS + 4), mime: 'audio/webm' },
    { audio: 'not base64!', mime: 'audio/webm' },
    { audio: `data:audio/webm;base64,${AUDIO}`, mime: 'audio/webm' },
    { audio: AUDIO },
    { audio: AUDIO, mime: '' },
    { audio: AUDIO, mime: 'audio/mpeg' },
    { audio: AUDIO, mime: 'AUDIO/WEBM' },
    { audio: AUDIO, mime: 'text/plain' },
    { audio: AUDIO, mime: ['audio/webm'] },
  ];
  const s = setup();
  for (const body of bodies) {
    const shown = JSON.stringify(body)?.slice(0, 60);
    assert.deepStrictEqual(await s.run({ body }), NOT_THROUGH, shown);
  }
  assert.deepStrictEqual([s.db.state.calls, s.groq.calls], [[], []]);
});

test("transcribe: Groq's limit is voice_busy; any other failure is upstream; only the kind is logged", async (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const error = t.mock.method(console, 'error', () => {});
  const cases = [
    [{ status: 429, body: { error: { message: 'Rate limit reached: secret words' } } }, BUSY, 'rate_limited'],
    [{ status: 500, body: 'secret words' }, COULD_NOT, 'http_500'],
    [{ status: 401, body: { error: { message: 'Invalid API Key' } } }, COULD_NOT, 'http_401'],
    [{ body: { nothing: 'secret words' } }, COULD_NOT, 'bad_answer'],
    [{ fails: new TypeError('fetch failed: secret words') }, COULD_NOT, 'network'],
    [{ fails: new DOMException('timed out: secret words', 'TimeoutError') }, COULD_NOT, 'timeout'],
  ];
  for (const [groq, expected] of cases) {
    const s = setup({ groq });
    assert.deepStrictEqual(await s.run(), expected, JSON.stringify(groq));
    assert.deepStrictEqual(s.db.state.calls, ['ensureUser'], 'nothing counted, nothing given back');
  }
  assert.deepStrictEqual(logged(warn), cases.map(([, , kind]) => `[transcribe] groq failed: ${kind}`));
  assert.strictEqual(error.mock.callCount(), 0);
});

test('transcribe: no recording and no words are kept or logged', async (t) => {
  const consoles = ['log', 'info', 'warn', 'error'].map((name) => t.mock.method(console, name, () => {}));
  const s = setup();
  await s.run();
  await setup({ groq: { status: 503 } }).run();
  await setup({ groq: { fails: new TypeError(`fetch failed: ${AUDIO}`) } }).run();
  const all = consoles.flatMap(logged).join('\n');
  assert.ok(!all.includes(AUDIO) && !all.includes('chutti'), 'not in the log');
  assert.ok(!JSON.stringify(s.db.state).includes(AUDIO) && !JSON.stringify(s.db.state).includes('chutti'), 'not in the database');
});

// ---- the Vercel function ----

test('POST /api/transcribe is a Vercel function with time for Groq', () => {
  assert.strictEqual(typeof require('../web/api/transcribe'), 'function');
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'web', 'vercel.json'), 'utf8'));
  assert.ok(config.functions['api/transcribe.js'].maxDuration > TIMEOUT_MS / 1000, 'longer than Groq is given');
});
