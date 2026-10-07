// How the buddy is petted and shaken: detectors that the page feeds with each move of the pointer, with nothing of the
// page in them, so they can be tested in Node. Positions are screen points and times are milliseconds (from any clock:
// only the differences count). Both gestures are the pointer going back and forth, and are found the same way: by
// counting its turns.

/**
 * Finds the turns of a pointer along one axis. A turn is a change of direction after at least `step` points of travel
 * in the direction before it, and it is seen when the pointer has come back `step` points from the furthest it got.
 * Going back and forth by less than `step` is jitter (a trembling hand, a mouse at rest): not a turn, and not travel
 * either, so it never adds up to one.
 */
function createAxis(step) {
  let way = 0; // which way the pointer is going: 1 up the axis, -1 down it, 0 until it has travelled `step` one way
  let low = Infinity; // while way is 0: the lowest and the highest position since the start
  let high = -Infinity;
  let far = 0; // else: the furthest the pointer got that way: the highest going up, the lowest going down

  return {
    /** The pointer is at `position`: is this a turn? */
    feed(position) {
      if (way === 0) {
        low = Math.min(low, position);
        high = Math.max(high, position);
        if (position - low >= step) way = 1;
        else if (high - position >= step) way = -1;
        far = position;
        return false;
      }
      const back = (far - position) * way; // how far it has come back from the furthest point (below 0: it went further)
      if (back < 0) {
        far = position;
      } else if (back >= step) {
        way = -way;
        far = position;
        return true;
      }
      return false;
    },
    reset() {
      way = 0;
      low = Infinity;
      high = -Infinity;
    },
  };
}

/**
 * Counts turns as they happen. add(t) is true when this turn, at time t, is the last of `turns` turns that fall within
 * `withinMs` (from the first of them to the last); the count then starts afresh.
 */
function createTurnCount(turns, withinMs) {
  let times = []; // when the latest turns happened, the oldest first: no more than `turns` of them
  return {
    add(t) {
      times.push(t);
      if (times.length > turns) times.shift();
      if (times.length < turns || t - times[0] > withinMs) return false;
      times = [];
      return true;
    },
    reset() {
      times = [];
    },
  };
}

/**
 * Petting: the pointer rubbed back and forth over the buddy's head. feed(x, t) takes the pointer's screen x in points and
 * the time in ms, and answers true once, when `turns` turns fall within `withinMs` (from the first of them to the last;
 * a turn is dated by the move that shows it). Then it counts afresh. reset() forgets what it has seen, for when the
 * pointer leaves the head.
 */
export function createPetDetector({ turns = 3, withinMs = 1500, step = 6 } = {}) {
  const horizontal = createAxis(step);
  const count = createTurnCount(turns, withinMs);
  return {
    feed(x, t) {
      return Number.isFinite(x) && Number.isFinite(t) && horizontal.feed(x) && count.add(t);
    },
    reset() {
      horizontal.reset();
      count.reset();
    },
  };
}

/**
 * Shaking: the buddy dragged back and forth, on either axis. feed(x, y, t) takes the pointer's screen position in points
 * and the time in ms, and answers true once, when `turns` turns, on either axis and in any mix, fall within `withinMs`.
 * Then it counts afresh. reset() forgets what it has seen, for when a drag starts.
 */
export function createShakeDetector({ turns = 4, withinMs = 1000, step = 24 } = {}) {
  const horizontal = createAxis(step);
  const vertical = createAxis(step);
  const count = createTurnCount(turns, withinMs);
  return {
    feed(x, y, t) {
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(t)) return false;
      // Each axis sees every move, whether the other has just turned or not.
      let done = false;
      if (horizontal.feed(x) && count.add(t)) done = true;
      if (vertical.feed(y) && count.add(t)) done = true;
      return done;
    },
    reset() {
      horizontal.reset();
      vertical.reset();
      count.reset();
    },
  };
}
