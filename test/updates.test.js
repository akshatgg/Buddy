'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const {
  RELEASES_API, parseVersion, compareVersions, fetchLatestRelease,
  parseLatestYml, formatLatestYml, downloadVerifiedInstaller, installKind, installerArgs,
  shouldAutoCheck, firstLaunchOfNewVersion, createUpdater, replaceableBundle, updateAsset, MAC_SWAP_SCRIPT, BUNDLE_ID,
  installTarget
} = require('../src/main/updates');
const { EventEmitter } = require('node:events');
const { writeLatestYml } = require('../tools/latest-yml');
const { DEFAULTS } = require('../src/main/store');

const made = [];
const tmpDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-updates-'));
  made.push(dir);
  return dir;
};
test.after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
const sha512 = (buf) => crypto.createHash('sha512').update(buf).digest('base64');

// A fake of the fetch API: a map of URL -> body (object = JSON, string or
// Buffer = bytes, number = an HTTP error status). Records every request.
function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url, opts });
    if (!(url in routes)) throw new TypeError('fetch failed');
    const body = routes[url];
    if (typeof body === 'number') return new Response('nope', { status: body });
    if (Buffer.isBuffer(body) || typeof body === 'string') return new Response(body);
    return Response.json(body);
  };
  fn.calls = calls;
  return fn;
}

const EXE_URL = 'https://github.com/akshatgg/Buddy/releases/download/v0.3.0/Buddy-Setup-x64.exe';
const YML_URL = 'https://github.com/akshatgg/Buddy/releases/download/v0.3.0/latest.yml';
const DMG_URL = 'https://github.com/akshatgg/Buddy/releases/download/v0.3.0/Buddy-arm64.dmg';
const MAC_YML_URL = 'https://github.com/akshatgg/Buddy/releases/download/v0.3.0/latest-mac.yml';

function release(version = '0.3.0', extra = {}) {
  return {
    tag_name: `v${version}`,
    name: `Buddy ${version}`,
    body: 'New things',
    html_url: `https://github.com/akshatgg/Buddy/releases/tag/v${version}`,
    published_at: '2026-10-07T10:00:00Z',
    assets: [
      { name: 'Buddy-arm64.dmg', browser_download_url: DMG_URL, size: 1 },
      { name: 'latest-mac.yml', browser_download_url: MAC_YML_URL, size: 1 },
      { name: 'Buddy-Setup-x64.exe', browser_download_url: EXE_URL, size: 10 },
      { name: 'latest.yml', browser_download_url: YML_URL, size: 1 }
    ],
    ...extra
  };
}

test('versions compare the way semver says', () => {
  assert.deepStrictEqual(parseVersion('v1.2.3-beta.1'), { major: 1, minor: 2, patch: 3, pre: ['beta', '1'] });
  assert.strictEqual(parseVersion('1.2'), null);
  assert.strictEqual(parseVersion(null), null);
  const ordered = ['0.1.0', '0.1.1', '0.2.0-alpha', '0.2.0-alpha.1', '0.2.0-alpha.beta', '0.2.0-beta',
    '0.2.0-beta.2', '0.2.0-beta.11', '0.2.0-rc.1', '0.2.0', '0.10.0', '1.0.0'];
  for (let i = 0; i < ordered.length; i++) {
    for (let j = 0; j < ordered.length; j++) {
      assert.strictEqual(compareVersions(ordered[i], ordered[j]), Math.sign(i - j), `${ordered[i]} vs ${ordered[j]}`);
    }
  }
  assert.strictEqual(compareVersions('v1.0.0', '1.0.0+build.5'), 0);
  assert.throws(() => compareVersions('one', '1.0.0'));
});

test('the latest release is read from the GitHub API', async () => {
  const fetchImpl = fakeFetch({ [RELEASES_API]: release() });
  const r = await fetchLatestRelease(fetchImpl);
  assert.strictEqual(RELEASES_API, 'https://api.github.com/repos/akshatgg/Buddy/releases/latest');
  assert.strictEqual(r.version, '0.3.0');
  assert.strictEqual(r.url, 'https://github.com/akshatgg/Buddy/releases/tag/v0.3.0');
  assert.strictEqual(r.assets.length, 4);
  assert.strictEqual(fetchImpl.calls[0].opts.headers['User-Agent'], 'Buddy');
});

test('a release page link that isn\'t this repository is not followed', async () => {
  const r = await fetchLatestRelease(fakeFetch({ [RELEASES_API]: release('0.3.0', { html_url: 'https://evil.example/' }) }));
  assert.strictEqual(r.url, 'https://github.com/akshatgg/Buddy/releases/latest');
});

test('GitHub errors and odd answers are reported, not crashed on', async () => {
  await assert.rejects(fetchLatestRelease(fakeFetch({ [RELEASES_API]: 403 })), /403/);
  await assert.rejects(fetchLatestRelease(fakeFetch({ [RELEASES_API]: { tag_name: 'nightly' } })), /no version/);
});

test('latest.yml: what the release script writes, the app reads back', () => {
  const text = formatLatestYml({ version: '0.3.0', file: 'Buddy-Setup-x64.exe', sha512: 'abc+/=', size: 42, releaseDate: '2026-10-07T00:00:00.000Z' });
  assert.deepStrictEqual(parseLatestYml(text), {
    version: '0.3.0',
    files: [{ url: 'Buddy-Setup-x64.exe', sha512: 'abc+/=', size: 42 }],
    path: 'Buddy-Setup-x64.exe',
    sha512: 'abc+/=',
    releaseDate: '2026-10-07T00:00:00.000Z'
  });
});

test('latest.yml as electron-builder itself writes it also parses', () => {
  const text = [
    'version: 1.4.2',
    'files:',
    '  - url: Buddy-Setup-x64.exe',
    '    sha512: Zm9v',
    '    size: 91234567',
    'path: Buddy-Setup-x64.exe',
    'sha512: Zm9v',
    "releaseDate: '2026-01-02T03:04:05.678Z'",
    ''
  ].join('\r\n');
  const m = parseLatestYml(text);
  assert.strictEqual(m.version, '1.4.2');
  assert.deepStrictEqual(m.files, [{ url: 'Buddy-Setup-x64.exe', sha512: 'Zm9v', size: 91234567 }]);
});

test('tools/latest-yml.js hashes the real installer file', async () => {
  const dir = tmpDir();
  const installer = path.join(dir, 'Buddy-Setup-x64.exe');
  const bytes = crypto.randomBytes(200000);
  fs.writeFileSync(installer, bytes);
  const out = await writeLatestYml({ version: '0.3.0', installer, now: new Date('2026-10-07T00:00:00Z') });
  assert.strictEqual(out, path.join(dir, 'latest.yml'));
  const m = parseLatestYml(fs.readFileSync(out, 'utf8'));
  assert.strictEqual(m.files[0].sha512, sha512(bytes));
  assert.strictEqual(m.files[0].size, bytes.length);
  assert.strictEqual(m.releaseDate, '2026-10-07T00:00:00.000Z');
  await assert.rejects(writeLatestYml({ version: 'v-next', installer }), /Not a version/);
  await assert.rejects(writeLatestYml({ version: '0.3.0', installer: [] }), /No --installer/);
});

test('tools/latest-yml.js writes the Mac DMG into latest-mac.yml', async () => {
  const dir = tmpDir();
  const dmg = path.join(dir, 'Buddy-arm64.dmg');
  fs.writeFileSync(dmg, 'arm bytes');
  const out = await writeLatestYml({ version: '0.3.0', installer: [dmg], out: path.join(dir, 'latest-mac.yml') });
  assert.strictEqual(out, path.join(dir, 'latest-mac.yml'));
  const m = parseLatestYml(fs.readFileSync(out, 'utf8'));
  assert.strictEqual(m.version, '0.3.0');
  assert.deepStrictEqual(m.files.map((f) => [f.url, f.sha512, f.size]), [['Buddy-arm64.dmg', sha512(Buffer.from('arm bytes')), 9]]);
  assert.strictEqual(m.path, 'Buddy-arm64.dmg');
});

test('downloading a new installer removes older ones, and nothing else in the folder', async () => {
  const dir = tmpDir();
  const exe = crypto.randomBytes(1000);
  const good = formatLatestYml({ version: '0.3.0', file: 'Buddy-Setup-x64.exe', sha512: sha512(exe), size: exe.length, releaseDate: 'x' });
  const rel = await fetchLatestRelease(fakeFetch({ [RELEASES_API]: release() }));
  fs.writeFileSync(path.join(dir, 'Buddy-Setup-0.2.0-x64.exe'), 'old');
  fs.writeFileSync(path.join(dir, 'Buddy-Setup-0.2.1-x64.exe.partial'), 'cut short');
  fs.writeFileSync(path.join(dir, 'something-else.txt'), 'not ours');
  await downloadVerifiedInstaller({ release: rel, fetchImpl: fakeFetch({ [YML_URL]: good, [EXE_URL]: exe }), dir });
  assert.deepStrictEqual(fs.readdirSync(dir).sort(), ['Buddy-Setup-0.3.0-x64.exe', 'something-else.txt']);
});

test('the Windows installer is kept only when its sha512 matches latest.yml', async () => {
  const dir = tmpDir();
  const exe = crypto.randomBytes(300000);
  const good = formatLatestYml({ version: '0.3.0', file: 'Buddy-Setup-x64.exe', sha512: sha512(exe), size: exe.length, releaseDate: 'x' });
  const rel = await fetchLatestRelease(fakeFetch({ [RELEASES_API]: release() }));

  const file = await downloadVerifiedInstaller({ release: rel, fetchImpl: fakeFetch({ [YML_URL]: good, [EXE_URL]: exe }), dir });
  assert.strictEqual(file, path.join(dir, 'Buddy-Setup-0.3.0-x64.exe'));
  assert.ok(fs.readFileSync(file).equals(exe));

  // Already there and still valid: not downloaded again.
  const again = fakeFetch({ [YML_URL]: good, [EXE_URL]: exe });
  await downloadVerifiedInstaller({ release: rel, fetchImpl: again, dir });
  assert.deepStrictEqual(again.calls.map((c) => c.url), [YML_URL]);

  // A tampered download is thrown away.
  fs.rmSync(file);
  const tampered = Buffer.from(exe);
  tampered[1000] ^= 0xff;
  await assert.rejects(
    downloadVerifiedInstaller({ release: rel, fetchImpl: fakeFetch({ [YML_URL]: good, [EXE_URL]: tampered }), dir }),
    /did not match its checksum/);
  assert.deepStrictEqual(fs.readdirSync(dir), []);

  // A manifest for a different version is refused before downloading.
  const other = good.replace('version: 0.3.0', 'version: 0.2.9');
  const f = fakeFetch({ [YML_URL]: other, [EXE_URL]: exe });
  await assert.rejects(downloadVerifiedInstaller({ release: rel, fetchImpl: f, dir }), /not 0.3.0/);
  assert.ok(!f.calls.some((c) => c.url === EXE_URL));

  // No manifest in the release at all.
  const bare = { ...rel, assets: rel.assets.filter((a) => a.name !== 'latest.yml') };
  await assert.rejects(downloadVerifiedInstaller({ release: bare, fetchImpl: fakeFetch({}), dir }), /no Buddy-Setup-x64\.exe/);
});

test('install kind: installer on Windows, the app itself on a Mac where it can be replaced', () => {
  assert.strictEqual(installKind('win32'), 'installer');
  assert.strictEqual(installKind('darwin', { bundle: '/Applications/Buddy.app' }), 'bundle');
  // A read-only copy falls back to telling the user where to get it.
  assert.strictEqual(installKind('darwin', { bundle: null }), 'download');
  assert.strictEqual(installKind('linux'), 'download');
  assert.deepStrictEqual(updateAsset('win32', 'x64'), { manifest: 'latest.yml', file: 'Buddy-Setup-x64.exe' });
  assert.deepStrictEqual(updateAsset('darwin', 'arm64'), { manifest: 'latest-mac.yml', file: 'Buddy-arm64.dmg' });
  // Buddy is Apple Silicon only; anything else still names the one DMG there is.
  assert.deepStrictEqual(updateAsset('darwin', 'x64'), { manifest: 'latest-mac.yml', file: 'Buddy-arm64.dmg' });
  assert.deepStrictEqual(installerArgs({ relaunch: true }), ['/S', '--updated', '--force-run']);
  assert.deepStrictEqual(installerArgs({ relaunch: false }), ['/S', '--updated']);
  assert.strictEqual(BUNDLE_ID, 'com.akshatgg.buddy');
});

test('the Mac app is replaceable only where Buddy can move it', () => {
  const exec = '/Applications/Buddy.app/Contents/MacOS/Buddy';
  assert.strictEqual(replaceableBundle(exec, { access: () => {} }), '/Applications/Buddy.app');
  assert.strictEqual(replaceableBundle(exec, { access: () => { throw new Error('EACCES'); } }), null);
  assert.strictEqual(replaceableBundle('/private/var/folders/x/AppTranslocation/y/d/Buddy.app/Contents/MacOS/Buddy', { access: () => {} }), null);
  // Run from source: Electron's own binary, not a Buddy.app.
  assert.strictEqual(replaceableBundle('/repo/node_modules/electron/dist/electron', { access: () => {} }), null);
});

test('automatic checks: whenever the setting is on -- each launch, not once a day', () => {
  assert.strictEqual(DEFAULTS.checkForUpdates, true, 'on unless the person turns it off');
  assert.strictEqual(shouldAutoCheck({ checkForUpdates: true, lastUpdateCheck: 0 }), true);
  assert.strictEqual(shouldAutoCheck({ checkForUpdates: true, lastUpdateCheck: Date.now() - 60_000 }), true);
  assert.strictEqual(shouldAutoCheck({ checkForUpdates: false, lastUpdateCheck: 0 }), false);
});

test('the first launch after an update is told apart from a fresh install and from every other launch', () => {
  const memory = (data) => ({ get: (k) => data[k], set: (p) => Object.assign(data, p), data });
  const fresh = memory({ lastRunVersion: DEFAULTS.lastRunVersion });
  assert.strictEqual(firstLaunchOfNewVersion(fresh, '0.2.0'), false, 'a fresh install goes through onboarding instead');
  assert.strictEqual(fresh.data.lastRunVersion, '0.2.0');
  assert.strictEqual(firstLaunchOfNewVersion(fresh, '0.2.0'), false, 'the same version again');
  assert.strictEqual(firstLaunchOfNewVersion(fresh, '0.3.0'), true, 'just updated');
  assert.strictEqual(fresh.data.lastRunVersion, '0.3.0');
  assert.strictEqual(firstLaunchOfNewVersion(fresh, '0.3.0'), false, 'only the first launch of it');
});

function harness({ platform = 'darwin', arch = 'arm64', bundle = null, runCommand, routes, settings = {}, version = '0.2.0', patchSettings, spawn, exists }) {
  let s = { ...structuredClone(DEFAULTS), ...settings };
  const states = [];
  const spawned = [];
  const fetchImpl = fakeFetch(routes);
  const updater = createUpdater({
    currentVersion: version, platform, arch, bundle, runCommand, pid: 4242, fetchImpl, downloadDir: tmpDir(),
    getSettings: () => s,
    patchSettings: patchSettings || ((p) => { s = { ...s, ...p }; }),
    now: () => 1_800_000_000_000,
    spawn: spawn || ((file, args, opts) => { spawned.push({ file, args, opts }); return { unref() {} }; }),
    ...(exists ? { exists } : {}),
    onChange: (st) => { if (states.at(-1) !== st.status) states.push(st.status); }
  });
  return { updater, states, spawned, fetchImpl, settings: () => s };
}

test('macOS, a copy Buddy can\'t replace: a newer release is "available", to download by hand', async () => {
  const h = harness({ bundle: null, routes: { [RELEASES_API]: release() } });
  const st = await h.updater.check();
  assert.strictEqual(st.status, 'available');
  assert.strictEqual(st.kind, 'download');
  assert.strictEqual(st.latest.version, '0.3.0');
  assert.strictEqual(st.latest.url, 'https://github.com/akshatgg/Buddy/releases/tag/v0.3.0');
  assert.ok(!('assets' in st.latest));
  assert.deepStrictEqual(h.states, ['checking', 'available']);
  assert.strictEqual(h.settings().lastUpdateCheck, 1_800_000_000_000);
  assert.strictEqual(h.updater.installsItself(), false);
  assert.strictEqual(h.updater.requestInstall(), false);
  assert.strictEqual(h.updater.install({ relaunch: true }), false);
  assert.strictEqual(h.spawned.length, 0);
});

test('up to date, and a failed check, are both plain states', async () => {
  const current = harness({ routes: { [RELEASES_API]: release('0.2.0') } });
  assert.strictEqual((await current.updater.check()).status, 'current');

  const offline = harness({ routes: {} });
  const st = await offline.updater.check();
  assert.strictEqual(st.status, 'error');
  assert.match(st.error, /internet connection/);
  // A failed check isn't recorded as a check.
  assert.strictEqual(offline.settings().lastUpdateCheck, 0);
});

test('autoCheck respects the setting; concurrent checks share one request', async () => {
  const off = harness({ routes: { [RELEASES_API]: release() }, settings: { checkForUpdates: false } });
  assert.strictEqual(await off.updater.autoCheck(), null);
  assert.strictEqual(off.fetchImpl.calls.length, 0);

  // Checked a minute ago, in an earlier launch: opening Buddy checks again.
  const recent = harness({ routes: { [RELEASES_API]: release() }, settings: { lastUpdateCheck: 1_800_000_000_000 - 60_000 } });
  assert.strictEqual((await recent.updater.autoCheck()).status, 'available');

  const h = harness({ routes: { [RELEASES_API]: release() } });
  const [a, b] = await Promise.all([h.updater.check(), h.updater.check()]);
  assert.strictEqual(a, b);
  assert.strictEqual(h.fetchImpl.calls.length, 1);
});

test('Windows: downloads, verifies, and "Update now" runs the installer silently', async () => {
  const exe = crypto.randomBytes(50000);
  const yml = formatLatestYml({ version: '0.3.0', file: 'Buddy-Setup-x64.exe', sha512: sha512(exe), size: exe.length, releaseDate: 'x' });
  const h = harness({ platform: 'win32', arch: 'x64', routes: { [RELEASES_API]: release(), [YML_URL]: yml, [EXE_URL]: exe } });
  const st = await h.updater.check();
  assert.deepStrictEqual(h.states, ['checking', 'downloading', 'ready']);
  assert.strictEqual(st.kind, 'installer');
  assert.strictEqual(h.updater.install({ relaunch: true }), true);
  assert.strictEqual(h.spawned.length, 1);
  assert.match(h.spawned[0].file, /Buddy-Setup-0\.3\.0-x64\.exe$/);
  assert.deepStrictEqual(h.spawned[0].args, ['/S', '--updated', '--force-run']);
  assert.strictEqual(h.spawned[0].opts.detached, true);
  // The quit-time install doesn't run it a second time.
  assert.strictEqual(h.updater.install({ relaunch: false }), false);
  assert.strictEqual(h.spawned.length, 1);
});

test('Windows: a checksum mismatch ends in an error and nothing to install', async () => {
  const exe = crypto.randomBytes(50000);
  const yml = formatLatestYml({ version: '0.3.0', file: 'Buddy-Setup-x64.exe', sha512: sha512(Buffer.from('other')), size: 5, releaseDate: 'x' });
  const h = harness({ platform: 'win32', arch: 'x64', routes: { [RELEASES_API]: release(), [YML_URL]: yml, [EXE_URL]: exe } });
  const st = await h.updater.check();
  assert.strictEqual(st.status, 'error');
  assert.match(st.error, /checksum/);
  assert.strictEqual(h.updater.install({ relaunch: false }), false);
  assert.strictEqual(h.spawned.length, 0);
});

// ---- hangs and unfriendly errors ---------------------------------------------

// A fetch that never answers unless aborted, like a network that drops packets.
const hangingFetch = () => (_url, opts) => new Promise((_resolve, reject) => {
  opts?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
});

test('a check that gets no answer ends in an error instead of spinning forever', async () => {
  const states = [];
  const updater = createUpdater({
    currentVersion: '0.2.0', platform: 'darwin',
    fetchImpl: hangingFetch(), getSettings: () => ({ ...DEFAULTS }), patchSettings: () => {},
    onChange: (s) => states.push(s.status), timeoutMs: 50
  });
  const state = await updater.check();
  assert.strictEqual(state.status, 'error');
  assert.match(state.error, /took too long/);
  assert.deepStrictEqual(states, ['checking', 'error']);
  // Check now works again afterwards.
  assert.strictEqual((await updater.check()).status, 'error');
});

test('a fetch that ignores the abort signal still times out', async () => {
  const neverFetch = () => new Promise(() => {});
  await assert.rejects(fetchLatestRelease(neverFetch, { timeoutMs: 30 }), /timed out/);
});

test('GitHub rate limits and outages read as plain sentences', async () => {
  for (const [status, text] of [[403, /too many requests/], [429, /too many requests/], [404, /No released version of Buddy/], [502, /isn’t answering/]]) {
    const updater = createUpdater({
      currentVersion: '0.2.0', platform: 'darwin',
      fetchImpl: fakeFetch({ [RELEASES_API]: status }), getSettings: () => ({ ...DEFAULTS }), patchSettings: () => {}
    });
    const state = await updater.check();
    assert.strictEqual(state.status, 'error');
    assert.match(state.error, text);
  }
});

test('Windows: an installer download that stalls is discarded', async () => {
  const dir = tmpDir();
  const yml = formatLatestYml({ version: '0.3.0', file: 'Buddy-Setup-x64.exe', sha512: sha512(Buffer.from('x')), size: 1, releaseDate: 'now' });
  const fetchImpl = async (url) => {
    if (url === YML_URL) return new Response(yml);
    // Sends one chunk, then nothing.
    const body = new ReadableStream({ start(c) { c.enqueue(new Uint8Array([1, 2, 3])); } });
    return new Response(body);
  };
  await assert.rejects(
    downloadVerifiedInstaller({ release: { ...release(), version: '0.3.0', assets: release().assets.map((a) => ({ name: a.name, url: a.browser_download_url })) }, fetchImpl, dir, stallMs: 50 }),
    /stopped/
  );
  assert.deepStrictEqual(fs.readdirSync(dir), []);
});

// ---- macOS: the app replaces itself -------------------------------------------

// Stands in for hdiutil, ditto, codesign and plutil: "mounting" the DMG
// exposes a Buddy.app whose Info.plist says `appVersion`.
function fakeMacTools({ appVersion = '0.3.0', codesignFails = false } = {}) {
  const calls = [];
  const runCommand = async (file, args) => {
    calls.push([path.basename(file), ...args]);
    if (file.endsWith('ditto')) {
      fs.mkdirSync(path.join(args[1], 'Contents'), { recursive: true });
      fs.writeFileSync(path.join(args[1], 'Contents', 'Info.plist'), 'plist');
    }
    if (file.endsWith('codesign') && codesignFails) throw new Error('a sealed resource is missing or invalid');
    if (file.endsWith('plutil')) return { stdout: `${appVersion}\n` };
    return { stdout: '' };
  };
  runCommand.calls = calls;
  return runCommand;
}

function macRoutes(dmg) {
  const yml = formatLatestYml({
    version: '0.3.0', releaseDate: 'x',
    files: [{ file: 'Buddy-arm64.dmg', sha512: sha512(dmg), size: dmg.length }]
  });
  return { [RELEASES_API]: release(), [MAC_YML_URL]: yml, [DMG_URL]: dmg };
}

test('macOS: downloads the DMG, verifies it, stages its app, and Update now swaps it in', async () => {
  const dmg = crypto.randomBytes(40000);
  const runCommand = fakeMacTools();
  const h = harness({ bundle: '/Applications/Buddy.app', runCommand, routes: macRoutes(dmg) });
  const st = await h.updater.check();
  assert.strictEqual(st.kind, 'bundle');
  assert.strictEqual(st.status, 'ready');
  assert.deepStrictEqual(h.states, ['checking', 'downloading', 'ready']);
  assert.strictEqual(st.progress, null);

  const tools = runCommand.calls.map((c) => c[0]);
  assert.deepStrictEqual(tools, ['hdiutil', 'ditto', 'hdiutil', 'codesign', 'plutil']);
  assert.match(runCommand.calls[0][2], /Buddy-0\.3\.0-arm64\.dmg$/);
  assert.ok(runCommand.calls[0].includes('-readonly'));
  assert.match(runCommand.calls[1][1], /Buddy\.app$/);
  assert.strictEqual(runCommand.calls[2][1], 'detach');

  assert.strictEqual(h.updater.install({ relaunch: true }), true);
  assert.strictEqual(h.spawned.length, 1);
  const { file, args, opts } = h.spawned[0];
  assert.strictEqual(file, '/bin/sh');
  assert.deepStrictEqual(args.slice(0, 3), ['-c', MAC_SWAP_SCRIPT, 'buddy-update']);
  assert.strictEqual(args[3], '4242');
  assert.match(args[4], /Buddy\.app$/);
  assert.deepStrictEqual(args.slice(5), ['/Applications/Buddy.app', '1', BUNDLE_ID]);
  assert.strictEqual(opts.detached, true);
  // Only once.
  assert.strictEqual(h.updater.install({ relaunch: false }), false);
});

test('macOS: an app that fails its signature or version check is never installed', async () => {
  const dmg = crypto.randomBytes(1000);
  for (const [tools, text] of [
    [fakeMacTools({ codesignFails: true }), /sealed resource/],
    [fakeMacTools({ appVersion: '0.2.9' }), /version 0\.2\.9, not 0\.3\.0/]
  ]) {
    const h = harness({ bundle: '/Applications/Buddy.app', runCommand: tools, routes: macRoutes(dmg) });
    const st = await h.updater.check();
    assert.strictEqual(st.status, 'error');
    assert.match(st.error, text);
    assert.strictEqual(h.updater.install({ relaunch: true }), false);
  }
});

test('macOS: a release without latest-mac.yml ends in an error that names what is missing', async () => {
  const bare = release();
  bare.assets = bare.assets.filter((a) => a.name !== 'latest-mac.yml');
  const h = harness({ bundle: '/Applications/Buddy.app', runCommand: fakeMacTools(), routes: { [RELEASES_API]: bare } });
  const st = await h.updater.check();
  assert.strictEqual(st.status, 'error');
  assert.strictEqual(st.latest.version, '0.3.0');
  assert.match(st.error, /no Buddy-arm64\.dmg/);
});

test('download progress is reported while the update downloads', async () => {
  const dmg = crypto.randomBytes(300000);
  const seen = [];
  const updater = createUpdater({
    currentVersion: '0.2.0', platform: 'darwin', arch: 'arm64', bundle: '/Applications/Buddy.app',
    runCommand: fakeMacTools(), fetchImpl: fakeFetch(macRoutes(dmg)), downloadDir: tmpDir(),
    getSettings: () => ({ ...DEFAULTS }), patchSettings: () => {}, spawn: () => ({}),
    onChange: (s) => { if (s.status === 'downloading') seen.push(s.progress); }
  });
  await updater.check();
  assert.strictEqual(seen[0], 0);
  assert.strictEqual(seen.at(-1), 1);
  assert.ok(seen.every((p, i) => i === 0 || p >= seen[i - 1]));
});

test('Update now while it is still downloading is remembered', async () => {
  const dmg = crypto.randomBytes(1000);
  const h = harness({ bundle: '/Applications/Buddy.app', runCommand: fakeMacTools(), routes: macRoutes(dmg) });
  const checking = h.updater.check();
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(h.updater.requestInstall(), true);
  assert.strictEqual(h.updater.state().pending, true);
  assert.strictEqual((await checking).status, 'ready');
  assert.strictEqual(h.updater.state().pending, true);
});

// The real script, on real folders: a process that has already exited, an
// "installed" app and a staged one. codesign finds no ad-hoc signature on
// these, so no permissions are reset; relaunch 0, so nothing is opened.
test('the Mac swap script replaces the app, and puts the old one back if it can\'t', { skip: process.platform === 'win32' }, () => {
  const dir = tmpDir();
  const app = path.join(dir, 'Buddy.app');
  const staged = path.join(dir, 'stage', 'Buddy.app');
  fs.mkdirSync(app, { recursive: true });
  fs.writeFileSync(path.join(app, 'which'), 'old');
  fs.mkdirSync(staged, { recursive: true });
  fs.writeFileSync(path.join(staged, 'which'), 'new');
  const gone = spawnSync(process.execPath, ['-e', '0']).pid;

  let r = spawnSync('/bin/sh', ['-c', MAC_SWAP_SCRIPT, 'buddy-update', String(gone), staged, app, '0', 'test.invalid']);
  assert.strictEqual(r.status, 0, String(r.stderr));
  assert.strictEqual(fs.readFileSync(path.join(app, 'which'), 'utf8'), 'new');
  assert.ok(!fs.existsSync(staged));
  assert.ok(!fs.existsSync(path.join(dir, '.Buddy-old.app')));

  // The staged copy is missing: the installed app stays as it was.
  r = spawnSync('/bin/sh', ['-c', MAC_SWAP_SCRIPT, 'buddy-update', String(gone), staged, app, '0', 'test.invalid']);
  assert.strictEqual(r.status, 0);
  assert.strictEqual(fs.readFileSync(path.join(app, 'which'), 'utf8'), 'new');
});

test('Update now after Buddy last found nothing new checks again, then installs what it finds', async () => {
  const dmg = crypto.randomBytes(2000);
  const routes = { ...macRoutes(dmg), [RELEASES_API]: release('0.2.0') };
  const h = harness({ bundle: '/Applications/Buddy.app', runCommand: fakeMacTools(), routes });
  assert.strictEqual((await h.updater.check()).status, 'current');

  // A release comes out while Buddy is open.
  routes[RELEASES_API] = release('0.3.0');
  assert.strictEqual(h.updater.requestInstall(), true);
  const st = await h.updater.check(); // shares the check Update now started
  assert.strictEqual(st.status, 'ready');
  assert.strictEqual(st.latest.version, '0.3.0');
  assert.strictEqual(st.pending, true, 'it installs as soon as it is ready');
  assert.strictEqual(h.fetchImpl.calls.filter((c) => c.url === RELEASES_API).length, 2);
});

test('Update now with nothing newer out ends as up to date, not waiting forever', async () => {
  const h = harness({ bundle: '/Applications/Buddy.app', runCommand: fakeMacTools(), routes: { [RELEASES_API]: release('0.2.0') } });
  await h.updater.check();
  h.updater.requestInstall();
  const st = await h.updater.check();
  assert.strictEqual(st.status, 'current');
  assert.strictEqual(st.pending, false);
});

test('an update that already downloaded stays ready when a later check fails', async () => {
  const dmg = crypto.randomBytes(1000);
  const routes = macRoutes(dmg);
  const h = harness({ bundle: '/Applications/Buddy.app', runCommand: fakeMacTools(), routes });
  assert.strictEqual((await h.updater.check()).status, 'ready');
  delete routes[RELEASES_API];
  const st = await h.updater.check();
  assert.strictEqual(st.status, 'ready');
  assert.strictEqual(h.updater.install({ relaunch: false }), true);
});

// ---- what a run may update ---------------------------------------------------

test('only an installed Buddy updates itself: a development run, a trial run and a loose copy never do', () => {
  const none = () => false;
  const writable = () => {};
  // Not packaged (electron .), or a trial run with BUDDY_USER_DATA: never installs, and the caller never checks by itself.
  assert.deepStrictEqual(installTarget({ platform: 'darwin', packaged: false, execPath: '/Applications/Buddy.app/Contents/MacOS/Buddy', access: writable }),
    { platform: 'development', bundle: null });
  assert.deepStrictEqual(installTarget({ platform: 'win32', packaged: true, trial: true, execPath: 'C:\\x\\Buddy.exe', exists: () => true }),
    { platform: 'development', bundle: null });
  // Windows: only the copy the installer put there (its uninstaller sits next to it). release\win-unpacked is not one.
  const installed = 'C:\\Users\\a\\AppData\\Local\\Programs\\buddy\\Buddy.exe';
  const seen = [];
  assert.deepStrictEqual(installTarget({ platform: 'win32', packaged: true, execPath: installed, exists: (f) => { seen.push(f); return true; } }),
    { platform: 'win32', bundle: null });
  assert.match(seen[0], /Uninstall Buddy\.exe$/);
  assert.deepStrictEqual(installTarget({ platform: 'win32', packaged: true, execPath: 'C:\\src\\release\\win-unpacked\\Buddy.exe', exists: none }),
    { platform: 'development', bundle: null });
  // Mac: only an app in an Applications folder is replaced; a build in release/mac-arm64 only offers the download.
  assert.deepStrictEqual(installTarget({ platform: 'darwin', packaged: true, execPath: '/Applications/Buddy.app/Contents/MacOS/Buddy', access: writable }),
    { platform: 'darwin', bundle: '/Applications/Buddy.app' });
  assert.deepStrictEqual(installTarget({ platform: 'darwin', packaged: true, execPath: '/Users/a/Applications/Buddy.app/Contents/MacOS/Buddy', access: writable, homedir: '/Users/a' }),
    { platform: 'darwin', bundle: '/Users/a/Applications/Buddy.app' });
  assert.deepStrictEqual(installTarget({ platform: 'darwin', packaged: true, execPath: '/Users/a/src/buddy/release/mac-arm64/Buddy.app/Contents/MacOS/Buddy', access: writable, homedir: '/Users/a' }),
    { platform: 'darwin', bundle: null });
});

test('an installer that disappeared before Buddy quit is not run, and says so', async () => {
  const exe = crypto.randomBytes(5000);
  const yml = formatLatestYml({ version: '0.3.0', file: 'Buddy-Setup-x64.exe', sha512: sha512(exe), size: exe.length, releaseDate: 'x' });
  const h = harness({ platform: 'win32', arch: 'x64', routes: { [RELEASES_API]: release(), [YML_URL]: yml, [EXE_URL]: exe }, exists: () => false });
  await h.updater.check();
  assert.strictEqual(h.updater.install({ relaunch: true }), false);
  assert.strictEqual(h.spawned.length, 0);
  assert.strictEqual(h.updater.state().status, 'error');
  assert.match(h.updater.state().error, /downloads it again/);
});

test('an installer that fails to start is logged, not thrown at quit', async () => {
  const exe = crypto.randomBytes(5000);
  const yml = formatLatestYml({ version: '0.3.0', file: 'Buddy-Setup-x64.exe', sha512: sha512(exe), size: exe.length, releaseDate: 'x' });
  const child = new EventEmitter();
  child.unref = () => {};
  const h = harness({ platform: 'win32', arch: 'x64', routes: { [RELEASES_API]: release(), [YML_URL]: yml, [EXE_URL]: exe }, spawn: () => child });
  await h.updater.check();
  assert.strictEqual(h.updater.install({ relaunch: false }), true);
  const logged = [];
  const original = console.error;
  console.error = (...args) => logged.push(args.join(' '));
  try {
    child.emit('error', Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' })); // would throw with no listener
  } finally {
    console.error = original;
  }
  assert.match(logged.join('\n'), /could not start the update/);
});

test('a ready update still installs on quit while the hourly check is running', async () => {
  const exe = crypto.randomBytes(5000);
  const yml = formatLatestYml({ version: '0.3.0', file: 'Buddy-Setup-x64.exe', sha512: sha512(exe), size: exe.length, releaseDate: 'x' });
  let answer = null; // while null, GitHub answers with the release
  const routes = { [YML_URL]: yml, [EXE_URL]: exe };
  const fetchImpl = async (url) => {
    if (url === RELEASES_API) return answer ? answer : Response.json(release());
    return Buffer.isBuffer(routes[url]) || typeof routes[url] === 'string' ? new Response(routes[url]) : Response.json(routes[url]);
  };
  const spawned = [];
  const updater = createUpdater({
    currentVersion: '0.2.0', platform: 'win32', arch: 'x64', fetchImpl, downloadDir: tmpDir(),
    getSettings: () => ({ checkForUpdates: true }), patchSettings: () => {},
    spawn: (file) => { spawned.push(file); return { unref() {} }; },
  });
  await updater.check();
  assert.strictEqual(updater.state().status, 'ready');
  answer = new Promise(() => {}); // the next check never answers, as if the network hangs
  updater.check();
  assert.strictEqual(updater.state().status, 'checking');
  assert.strictEqual(updater.install({ relaunch: false }), true);
  assert.strictEqual(spawned.length, 1);
});

test('a settings file that cannot be written does not leave the check spinning', async () => {
  const h = harness({ bundle: null, routes: { [RELEASES_API]: release() }, patchSettings: () => { throw new Error('EPERM'); } });
  const st = await h.updater.check();
  assert.strictEqual(st.status, 'available');
});

test('the Mac swap script is not stopped by the signals a shutdown or log out sends', () => {
  assert.match(MAC_SWAP_SCRIPT.split('\n')[0], /^trap '' TERM INT HUP$/);
});

