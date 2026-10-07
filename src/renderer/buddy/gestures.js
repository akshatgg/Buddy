// How the buddy is petted and shaken: detectors that the page feeds with each move of the pointer, with nothing of the
// page in them, so they can be tested in Node. Positions are screen points and times are milliseconds (from any clock:
// only the differences count). Both gestures are the pointer going back and forth, and are found the same way: by
// counting its turns. Petting is a rub from side to side, so it counts the turns of x; a shake can go any way (across,
// up and down, on a diagonal, round and round), so it counts the turns of the pointer's stroke wherever it goes.

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
 * Finds the turns of a pointer going anywhere on the screen. It travels in strokes. A stroke starts where the pointer
 * last turned (or was first seen) and goes on while the pointer gets further from there: the furthest it got is the
 * stroke's tip, and the stroke's direction is from its start to its tip. A turn is the pointer coming back from the tip
 * by `step` points along that direction; the next stroke then starts at the old tip. Along one axis it finds what
 * `createAxis` finds; on a diagonal it counts one turn for each reversal, and round a circle two for each time round. Less
 * than that is not a turn: going back and forth by under `step` is jitter, and a corner, where the pointer goes off to the
 * side, is not a reversal (the stroke goes on round it).
 */
function createStrokes(step) {
  let start = null; // {x, y}: where the stroke began; the first position seen, until the pointer has travelled `step` from it
  let tip = null; // {x, y}: the furthest from the start the pointer got in this stroke; null until there is a first stroke
  let far = 0; // how far the tip is from the start

  return {
    /** The pointer is at (x, y): is this a turn? */
    feed(x, y) {
      if (!start) {
        start = { x, y };
        return false;
      }
      const distance = Math.hypot(x - start.x, y - start.y);
      if (!tip) {
        if (distance >= step) {
          tip = { x, y };
          far = distance;
        }
        return false;
      }
      if (distance > far) {
        // Further from the start: the stroke goes on, and its tip and direction with it.
        tip = { x, y };
        far = distance;
        return false;
      }
      // How far the pointer has come back from the tip, along the stroke's direction.
      const back = ((tip.x - x) * (tip.x - start.x) + (tip.y - y) * (tip.y - start.y)) / far;
      if (back >= step) {
        start = tip;
        tip = { x, y };
        far = Math.hypot(x - start.x, y - start.y);
        return true;
      }
      return false;
    },
    reset() {
      start = null;
      tip = null;
      far = 0;
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
 * Shaking: the buddy dragged back and forth, along a line at any angle, or round and round. feed(x, y, t) takes the
 * pointer's screen position in points and the time in ms, and answers true once, when `turns` turns fall within
 * `withinMs` (from the first of them to the last; a turn is dated by the move that shows it). A turn is the pointer
 * reversing its stroke, wherever the stroke goes, and it is one turn however it shows on x and y: a diagonal shake needs
 * as many reversals as a straight one, and a circle gives two turns for each time round. Then it counts afresh. reset()
 * forgets what it has seen, for when a drag starts.
 */
export function createShakeDetector({ turns = 4, withinMs = 1000, step = 24 } = {}) {
  const strokes = createStrokes(step);
  const count = createTurnCount(turns, withinMs);
  return {
    feed(x, y, t) {
      return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(t) && strokes.feed(x, y) && count.add(t);
    },
    reset() {
      strokes.reset();
      count.reset();
    },
  };
}
