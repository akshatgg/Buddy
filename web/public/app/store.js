// What the phone keeps for itself, in the browser's localStorage: the buddy picked, the facts Buddy knows (memory.js)
// and a switch or two. `storage` is anything with get(key) and set(key, text), so the tests pass a fake; in the page it
// is localStorageOf(window), which never throws: where the browser keeps nothing, the app forgets it when it closes.

const PREFIX = 'buddy.';

/** The page's localStorage as get and set, which answer null and do nothing when the browser does not allow it. */
export function localStorageOf(win) {
  return {
    get(key) {
      try {
        return win.localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        win.localStorage.setItem(key, value);
      } catch {
        // Nothing is kept: the app works on, and forgets it when closed.
      }
    },
  };
}

/** Values kept as JSON under "buddy.<key>". read() answers `fallback` when nothing is kept, or what is kept is broken. */
export function createStore(storage) {
  return {
    read(key, fallback) {
      const text = storage.get(PREFIX + key);
      if (typeof text !== 'string') return fallback;
      try {
        return JSON.parse(text);
      } catch {
        return fallback;
      }
    },
    write(key, value) {
      storage.set(PREFIX + key, JSON.stringify(value));
    },
  };
}
