/* Buddy's site. Everything here is extra: without it the page reads and every download link works.
   It shows the newest release's version and size, turns the Windows tile into a download once a Windows
   installer is released, leads with the right button on Windows, and tells phone visitors where Buddy runs. */
(function (root) {
  'use strict';

  var MAC = 'Buddy-arm64.dmg';
  var WIN = 'Buddy-Setup-x64.exe';
  var RELEASES = 'https://github.com/akshatgg/Buddy/releases';
  var LATEST = 'https://api.github.com/repos/akshatgg/Buddy/releases/latest';

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

  /** A line for visitors whose device has no Buddy yet, or ''. Windows is told only when no installer exists. */
  function deviceNote(ua) {
    if (/iPhone|iPad|iPod|Android/i.test(ua)) return 'Buddy is for Mac right now. iPhone and Android are coming soon.';
    if (/Windows/i.test(ua)) return 'Buddy for Windows is coming soon. Right now it runs on Mac.';
    return '';
  }

  if (typeof module === 'object' && module.exports) {
    module.exports = { releaseFacts: releaseFacts, deviceNote: deviceNote, formatSize: formatSize };
    return;
  }

  var doc = root.document;
  var ua = (root.navigator && root.navigator.userAgent) || '';
  var onWindows = /Windows/i.test(ua) && !/Windows Phone/i.test(ua);

  function each(selector, fn) { Array.prototype.forEach.call(doc.querySelectorAll(selector), fn); }
  function note(text) {
    each('[data-device-note]', function (p) { p.textContent = text; p.hidden = !text; });
  }

  function offerWindows(size) {
    var url = RELEASES + '/latest/download/' + WIN;
    each('[data-win-tile]', function (tile) {
      var link = doc.createElement('a');
      link.className = 'btn btn--ink';
      link.href = url;
      link.textContent = 'Download for Windows';
      var tag = tile.querySelector('.tag');
      if (tag) tag.replaceWith(link); else tile.appendChild(link);
      var file = doc.createElement('small');
      file.textContent = WIN + (size ? ' · ' + size : '');
      tile.appendChild(file);
    });
    if (onWindows) {
      // The hero's main button leads with this computer's download.
      each('[data-hero-download]', function (a) {
        a.href = url;
        a.lastChild.textContent = 'Download for Windows';
      });
    }
  }

  // Phones can be told right away; Windows waits to hear whether a Windows installer exists.
  if (!onWindows) note(deviceNote(ua));

  if (!root.fetch) return;
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
      if (facts.win) offerWindows(facts.win.size);
      else if (onWindows) note(deviceNote(ua));
    })
    .catch(function () { /* offline or rate-limited: the plain links still work */ });
})(this);
