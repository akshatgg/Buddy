/* Buddy's site. Everything here is extra: without it the page reads and every download link works.
   It shows the newest release's version and size, points the Android button at the newest Android
   release, leads with the right button on Windows and Android, and tells iPhone visitors where Buddy runs. */
(function (root) {
  'use strict';

  var MAC = 'Buddy-arm64.dmg';
  var WIN = 'Buddy-Setup-x64.exe';
  var APK = 'Buddy-Android.apk';
  var RELEASES = 'https://github.com/akshatgg/Buddy/releases';
  var LATEST = 'https://api.github.com/repos/akshatgg/Buddy/releases/latest';
  // Android is released on its own, tagged android-v<version>, and never marked latest, so it is found in the list.
  var ALL = 'https://api.github.com/repos/akshatgg/Buddy/releases?per_page=100';

  function formatSize(bytes) {
    return bytes > 0 ? Math.round(bytes / 1048576) + ' MB' : '';
  }

  /** What the newest release offers: { version, mac: { size } | null, win: { size } | null }, or null. */
  function releaseFacts(release) {
    if (!release || !Array.isArray(release.assets)) return null;
    function find(name) {
      var asset = release.assets.find(function (a) { return a && a.name === name; });
      return asset ? { size: formatSize(asset.size) } : null;
    }
    return { version: String(release.tag_name || '').replace(/^v/, ''), mac: find(MAC), win: find(WIN) };
  }

  /** The newest published Android release: { version, url, size }, or null. */
  function androidFacts(releases) {
    if (!Array.isArray(releases)) return null;
    var best = null;
    releases.forEach(function (release) {
      if (!release || release.draft || release.prerelease || !Array.isArray(release.assets)) return;
      var m = /^android-v(\d+)\.(\d+)\.(\d+)$/.exec(String(release.tag_name || ''));
      var asset = m && release.assets.find(function (a) { return a && a.name === APK; });
      if (!asset) return;
      var parts = [+m[1], +m[2], +m[3]];
      if (!best || (parts[0] - best.parts[0] || parts[1] - best.parts[1] || parts[2] - best.parts[2]) > 0) {
        best = { parts: parts, tag: m[0], size: formatSize(asset.size) };
      }
    });
    if (!best) return null;
    return { version: best.parts.join('.'), url: RELEASES + '/download/' + best.tag + '/' + APK, size: best.size };
  }

  /** A line for visitors whose device has no Buddy yet, or ''. */
  function deviceNote(ua) {
    if (/iPhone|iPad|iPod/i.test(ua)) return 'Buddy for iPhone is coming soon. Right now it runs on Mac, Windows and Android.';
    return '';
  }

  if (typeof module === 'object' && module.exports) {
    module.exports = { releaseFacts: releaseFacts, androidFacts: androidFacts, deviceNote: deviceNote, formatSize: formatSize };
    return;
  }

  var doc = root.document;
  var ua = (root.navigator && root.navigator.userAgent) || '';
  var onWindows = /Windows/i.test(ua) && !/Windows Phone/i.test(ua);
  var onAndroid = /Android/i.test(ua);

  function each(selector, fn) { Array.prototype.forEach.call(doc.querySelectorAll(selector), fn); }
  function note(text) {
    each('[data-device-note]', function (p) { p.textContent = text; p.hidden = !text; });
  }

  // The hero's main button leads with this device's download, and is then updated (or pointed at the
  // releases page) with that platform's other buttons: kind is "win" or "android".
  function leadWith(kind, url, label, fine) {
    each('[data-hero-download]', function (a) {
      a.removeAttribute('data-mac-download');
      a.setAttribute('data-' + kind + '-download', '');
      a.href = url;
      a.lastChild.textContent = label;
    });
    each('[data-hero-fine]', function (p) { p.textContent = fine; });
  }
  if (onWindows) leadWith('win', RELEASES + '/latest/download/' + WIN, 'Download for Windows', 'For Windows 10 or 11, 64-bit.');
  if (onAndroid) {
    // The Android release the page names, until the newest is found.
    var apk = doc.querySelector('[data-android-download]');
    if (apk) leadWith('android', apk.href, 'Download for Android', 'For phones on Android 8.0 or newer.');
  }
  note(deviceNote(ua));

  if (!root.fetch) return;
  root.fetch(ALL, { headers: { Accept: 'application/vnd.github+json' } })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (releases) {
      var android = androidFacts(releases);
      if (!android) return;
      each('[data-android-download]', function (a) { a.href = android.url; });
      each('[data-android-meta]', function (el) { el.textContent = '· Version ' + android.version + (android.size ? ' · ' + android.size : ''); });
    })
    .catch(function () { /* offline or rate-limited: the link in the page still works */ });
  root.fetch(LATEST, { headers: { Accept: 'application/vnd.github+json' } })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (release) {
      var facts = releaseFacts(release);
      if (!facts) return;
      if (facts.mac) {
        each('[data-mac-meta]', function (el) { el.textContent = '· Version ' + facts.version + (facts.mac.size ? ' · ' + facts.mac.size : ''); });
      } else {
        each('[data-mac-download]', function (a) { a.href = RELEASES; });
      }
      if (facts.win) {
        each('[data-win-meta]', function (el) { el.textContent = facts.win.size ? '· ' + facts.win.size : ''; });
      } else {
        each('[data-win-download]', function (a) { a.href = RELEASES; });
      }
    })
    .catch(function () { /* offline or rate-limited: the plain links still work */ });
})(this);
