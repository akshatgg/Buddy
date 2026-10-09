'use strict';

/**
 * Buddy where you type, on the Mac and on Windows. The person writes in any app and ends with "@buddy" (or their
 * buddy's name) and what to do: "@buddy", "@buddy formal", "@aarav translate to Hindi". The helper hears the tag typed
 * and a pause after it, and says which app (watchTyping, its "tag" event). Then this reads the paragraph the tag ends
 * (the helper selects from the cursor back to the paragraph's start and copies it), has the AI rewrite it
 * (shared/prompts.js 'tag', by whichever route the person's AI setting takes), and pastes the new text over that
 * selection, unless they kept typing meanwhile. "@buddy all …" takes the whole box instead. The rules for the tag are
 * shared/tag.js, the same as Android's.
 *
 * Settings → General → "Fix where I type" turns it off (`tagOn`). The helper is told to watch while Buddy is on and it
 * is wanted; one that cannot (no Accessibility yet) is asked again every 10 seconds.
 */

const { BuddyError } = require('../../shared/errors');
const { tagNames, findTag, splitAtTag, cleanAnswer } = require('../../shared/tag');
const { AI_TIMEOUT_MS } = require('./ai');

const RETRY_MS = 10_000;
const KEPT_TYPING = 'You kept typing, so I left it.';
const NOTHING = "I couldn't rewrite that. Try again.";

/**
 * `helper` is the native helper, `ai` ai.js's (ask), `ui` main.js's { mood, bubble }; `active()` says whether Buddy is
 * on. The timers are passed in by the unit tests.
 */
function createTagWatch({ helper, ai, store, ui, active = () => true, platform = process.platform, later = setTimeout, cancel = clearTimeout }) {
  const undoWords = platform === 'darwin' ? '⌘Z' : 'Ctrl+Z';
  let watching = null; // the names the helper watches for, as a string, or null when it does not watch
  let retry = null;
  let busy = false; // one at a time: a tag typed while Buddy still rewrites the last one waits for the next pause

  const wanted = () => active() && store.get('tagOn') !== false;
  const names = () => tagNames(store.get('buddyName'));

  function askAgainLater() {
    if (retry) return;
    retry = later(() => {
      retry = null;
      refresh();
    }, RETRY_MS);
    retry.unref?.();
  }

  /** Tell the helper to watch (for the buddy's names as they are now) or to stop, when that changed. */
  async function refresh() {
    const want = wanted() ? names().join(',') : null;
    if (want === watching) return;
    try {
      await helper.call('watchTyping', want ? { on: true, names: names() } : { on: false });
      watching = want;
    } catch (err) {
      watching = null;
      if (want) {
        if (err.code !== 'no_accessibility') console.warn('[buddy] could not watch for @buddy:', err.code || err.message);
        askAgainLater();
      }
    }
  }

  /** The text selected in the app (`select` as the helper takes it), or '' when nothing could be copied. */
  async function copy(pid, select) {
    const r = await helper.call('captureSelection', { pid, ...select });
    return typeof r?.text === 'string' ? r.text : '';
  }

  /** Give the person's selection back as a cursor, after Buddy selected a paragraph and then let it be. */
  const letGo = (pid) => helper.call('press', { pid, key: 'right' }).catch(() => {});

  /** A tag was typed in the app `pid` and the person paused: rewrite what it ends, in place. */
  async function onTag(pid) {
    if (busy || !wanted() || !Number.isInteger(pid)) return;
    busy = true;
    try {
      const tagNamesNow = names();
      let read = await copy(pid, { select: 'paragraph' });
      let whole = false;
      if (/^all\b/i.test(findTag(read, tagNamesNow)?.instruction ?? '')) {
        // "@buddy all …": the whole box, not just this paragraph.
        await letGo(pid);
        read = await copy(pid, { selectAll: true });
        whole = true;
      }
      const split = splitAtTag(read, tagNamesNow);
      if (!split) {
        if (!whole) await letGo(pid);
        return;
      }
      ui.mood('thinking');
      ui.bubble('Fixing it…');
      const out = await ai.ask('tag', { text: split.target, instruction: split.instruction }, { signal: AbortSignal.timeout(AI_TIMEOUT_MS) });
      const answer = cleanAnswer(out?.text);
      if (!answer) throw new BuddyError('upstream', NOTHING);
      // Still what was read? A paragraph stays selected while the AI answers: had they typed, it would be gone. The
      // whole box is read again.
      const now = await copy(pid, whole ? { selectAll: true } : {});
      if (now !== read) {
        ui.mood('idle');
        ui.bubble(KEPT_TYPING);
        return;
      }
      await helper.call('paste', { pid, text: split.prefix + answer + split.suffix, selectAll: whole });
      ui.mood('celebrate');
      ui.bubble(`Fixed ✅ ${undoWords} undoes it`);
    } catch (err) {
      ui.mood('sad');
      ui.bubble(err instanceof BuddyError ? err.message : NOTHING);
      if (!(err instanceof BuddyError)) console.warn('[buddy] @buddy failed:', err.name);
    } finally {
      busy = false;
    }
  }

  helper.on('tag', (event) => {
    onTag(event?.pid).catch(() => {});
  });
  // A helper that restarted watches nothing: it is told again.
  helper.on('started', () => {
    watching = null;
    refresh();
  });

  return {
    refresh,
    /** Buddy turned off, or quitting: the helper stops watching. */
    stop() {
      cancel(retry);
      retry = null;
      if (watching !== null) {
        watching = null;
        helper.call('watchTyping', { on: false }).catch(() => {});
      }
    },
    onTag,
  };
}

module.exports = { KEPT_TYPING, NOTHING, createTagWatch };
