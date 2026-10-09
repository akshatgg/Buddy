'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { syncWebApp, buildApp, listMade, TO } = require('../tools/sync-web-app');

test('web/public/app has exactly what it reuses, as it is now (run `npm run sync:web-app` after changing it)', () => {
  const files = buildApp();
  assert.ok(files['shared/memory-rules.js'] && files['vendor/three/build/three.module.js'] && files['buddies/buddies.json'], 'the plan finds its files');
  assert.deepStrictEqual(listMade(TO), Object.keys(files).sort(), 'the same files');
  for (const [file, bytes] of Object.entries(files)) {
    assert.ok(fs.readFileSync(path.join(TO, file)).equals(bytes), `${file} is the same`);
  }
});

test('the Node modules made into ES modules answer as they do in Node', async () => {
  const url = (file) => pathToFileURL(path.join(TO, 'shared', file)).href;
  const rules = await import(url('memory-rules.js'));
  const node = require('../shared/memory-rules');
  for (const fact of ['  Your boss is\nMr. Sharma. ', 'My password is x', 'PIN code 411001', '4111 1111 1111 1111']) {
    assert.strictEqual(rules.cleanFact(fact), node.cleanFact(fact), fact);
  }
  assert.strictEqual(rules.MAX_FACTS, node.MAX_FACTS);
  const prompts = await import(url('prompts.js'));
  assert.deepStrictEqual(prompts.LIMITS, require('../shared/prompts').LIMITS);
  assert.throws(() => prompts.buildPrompt('chat', {}), (err) => err.name === 'BuddyError' && err.code === 'bad_request');
  const sleep = await import(url('sleep.js'));
  assert.deepStrictEqual([sleep.DROWSY_MS, sleep.ASLEEP_MS], [60_000, 120_000]);
  const { default: VoiceTiming } = await import(url('voice-timing.js'));
  assert.strictEqual(VoiceTiming.recordingMime('audio/mp4;codecs=mp4a.40.2'), 'audio/mp4');
  const { buddyLevel } = await import(url('feelings.js'));
  assert.strictEqual(buddyLevel(0.1), 0.5);
  const { aiSection } = await import(url('free-state.js'));
  const free = { freeOn: true, limitMode: 'daily', limit: 30, usedToday: 4, allowOwnKey: true, blocked: false };
  assert.deepStrictEqual(aiSection(free), require('../src/main/free-state').aiSection(free));
});

test('the AI providers, made into ES modules, are the same four, and talk to the provider as in Node', async () => {
  const providers = await import(pathToFileURL(path.join(TO, 'shared', 'providers', 'index.js')).href);
  const node = require('../shared/providers');
  assert.deepStrictEqual(providers.PROVIDER_IDS, node.PROVIDER_IDS);
  const facts = (p) => ({ label: p.label, keyUrl: p.keyUrl, keyPrefixes: p.keyPrefixes, fallbackModels: p.fallbackModels });
  for (const id of node.PROVIDER_IDS) assert.deepStrictEqual(facts(providers.getProvider(id)), facts(node.PROVIDERS[id]), id);
  assert.strictEqual(providers.providerForKey('sk-ant-x'), 'anthropic');
  assert.strictEqual(providers.providerForKey('gsk_x'), 'groq');
  assert.throws(() => providers.getProvider('constructor'), (err) => err.name === 'BuddyError' && err.code === 'bad_request');
  // A refused key is the shared errors' BuddyError, in the shared words (http.js, through '../errors').
  const fetchImpl = async () => ({ ok: false, status: 401, text: async () => '{}' });
  const warn = console.warn;
  console.warn = () => {};
  try {
    await assert.rejects(
      providers.getProvider('groq').complete({ apiKey: 'k', model: 'm', system: 's', user: 'u', maxTokens: 10, fetchImpl }),
      (err) => err.name === 'BuddyError' && err.code === 'bad_key' && err.message === 'Your Groq key was rejected. Check it in Settings.',
    );
  } finally {
    console.warn = warn;
  }
});

test('the sync makes only its own folders: stale files in them go, the hand-written files stay', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-app-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'shared'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'shared', 'stale.js'), 'old');
  fs.writeFileSync(path.join(dir, 'app.js'), 'mine');
  syncWebApp({ to: dir });
  assert.ok(!fs.existsSync(path.join(dir, 'shared', 'stale.js')));
  assert.strictEqual(fs.readFileSync(path.join(dir, 'app.js'), 'utf8'), 'mine');
  assert.deepStrictEqual(listMade(dir), Object.keys(buildApp()).sort());
});
