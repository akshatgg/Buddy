import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import {
  EFFECTS, RING, Z_LETTER, Z_CYCLE, Z_BURST, Z_REST, Z_FOR, particlesFor, createSymbols,
} from '../src/renderer/buddy/symbols.js';

const KINDS = ['z', 'heart', 'star', 'sparkle', 'note', 'drop'];
const all = () => EFFECTS.flatMap((effect) => particlesFor(effect).map((p) => ({ effect, ...p })));

test('six effects: z, hearts, stars, sparkles, notes and a drop', () => {
  assert.deepStrictEqual(EFFECTS, ['z', 'hearts', 'stars', 'sparkles', 'notes', 'drop']);
});

test('each effect has its own particles: how many, and what they are', () => {
  const expected = { z: ['z', 3], hearts: ['heart', 3], stars: ['star', 3], notes: ['note', 2], drop: ['drop', 1] };
  for (const [effect, [kind, count]] of Object.entries(expected)) {
    const particles = particlesFor(effect);
    assert.strictEqual(particles.length, count, effect);
    for (const p of particles) assert.strictEqual(p.kind, kind, effect);
  }
  const sparkles = particlesFor('sparkles');
  assert.ok(sparkles.length === 5 || sparkles.length === 6, `${sparkles.length} sparkles`);
  for (const p of sparkles) assert.strictEqual(p.kind, 'sparkle');
});

test('a particle is { kind, delay, x, y, scale }, all numbers but the kind', () => {
  for (const p of all()) {
    const { effect, ...particle } = p;
    assert.deepStrictEqual(Object.keys(particle).sort(), ['delay', 'kind', 'scale', 'x', 'y'], effect);
    assert.ok(KINDS.includes(p.kind), p.kind);
    for (const n of [p.delay, p.x, p.y, p.scale]) assert.ok(Number.isFinite(n), `${effect}: ${n}`);
    assert.ok(p.scale >= 0.6 && p.scale <= 1.5, `${effect}: scale ${p.scale} is about the base size`);
  }
});

test('the z letters rise one after another', () => {
  const delays = particlesFor('z').map((p) => p.delay);
  assert.strictEqual(delays[0], 0);
  for (let i = 1; i < delays.length; i++) assert.ok(delays[i] > delays[i - 1], `z ${i} starts after z ${i - 1}`);
});

test('the z letters climb up and to the right, each a little bigger', () => {
  const [a, b, c] = particlesFor('z');
  assert.ok(a.y < 0, 'the first starts above the head');
  assert.ok(a.x < b.x && b.x < c.x, 'to the right');
  assert.ok(a.y > b.y && b.y > c.y, 'and up');
  assert.ok(a.scale < b.scale && b.scale < c.scale, 'growing');
});

test('the stars start spread around a flat ring just above the head', () => {
  const stars = particlesFor('stars');
  const xs = stars.map((p) => p.x);
  const ys = stars.map((p) => p.y);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  assert.ok(width > 3 * height, `a flat ring: ${width} wide, ${height} tall`);
  for (const y of ys) assert.ok(y > -0.35 && y < 0.1, `just above the head: ${y}`);
  assert.strictEqual(new Set(stars.map((p) => p.delay)).size, 3, 'each at its own place in the loop');
});

test('hearts and sparkles show on both sides of the head', () => {
  for (const effect of ['hearts', 'sparkles']) {
    const xs = particlesFor(effect).map((p) => p.x);
    assert.ok(xs.some((x) => x < -0.2) && xs.some((x) => x > 0.2), effect);
  }
});

test('the notes and the drop are beside the head, not over the face', () => {
  for (const p of [...particlesFor('notes'), ...particlesFor('drop')]) {
    assert.ok(Math.abs(p.x) >= 0.3, `${p.kind} at x ${p.x}`);
  }
});

test('an unknown effect has no particles', () => {
  for (const effect of ['', 'Z', 'heart', 'sleepy', 'nope', null, undefined, 42, 'constructor', '__proto__', 'toString']) {
    assert.deepStrictEqual(particlesFor(effect), [], String(effect));
  }
});

test('every particle starts within about one head width of the head', () => {
  for (const p of all()) assert.ok(Math.hypot(p.x, p.y) <= 1, `${p.effect}: (${p.x}, ${p.y})`);
});

test('every particle starts well inside the buddy window', () => {
  // The window is 1.5 × the buddy's size wide (the head, about the size wide, in the middle), and grows upward by
  // 0.6 × the size, which leaves about 0.8 head widths above the head. Starting well inside leaves room for the
  // symbol itself and for how far it drifts.
  for (const p of all()) {
    assert.ok(Math.abs(p.x) <= 0.6, `${p.effect}: x ${p.x}`);
    assert.ok(p.y >= -0.6, `${p.effect}: y ${p.y}`);
  }
});

test('each call gives fresh particles, so changing them changes nothing', () => {
  const first = particlesFor('hearts');
  first[0].x = 99;
  first.push({ kind: 'heart' });
  const again = particlesFor('hearts');
  assert.strictEqual(again.length, 3);
  assert.notStrictEqual(again[0].x, 99);
});

test('the z letters come in bursts with a long rest, so a sleeping buddy has nothing to draw most of the time', () => {
  // A letter starts at its delay and takes Z_LETTER; the burst is over when the last one is.
  const lastStart = Math.max(...particlesFor('z').map((p) => p.delay));
  assert.strictEqual(Z_BURST, lastStart + Z_LETTER);
  assert.strictEqual(Z_REST, Z_CYCLE - Z_BURST);
  assert.ok(Z_REST >= 7, `the rest is at least 7 s: ${Z_REST}`);
});

// createSymbols on a page made just big enough for it: elements that keep what they are given, and a window
// whose timers the test runs by hand.
function fakePage() {
  const timers = new Map();
  let lastId = 0;
  const view = {
    setTimeout: (fn, ms) => {
      timers.set(++lastId, { fn, ms });
      return lastId;
    },
    clearTimeout: (id) => {
      timers.delete(id);
    },
  };
  const create = () => {
    const el = {
      children: [],
      parent: null,
      ended: [],
      style: { setProperty() {} },
      classList: { add() {} },
      setAttribute() {},
      addEventListener: (type, fn) => {
        if (type === 'animationend') el.ended.push(fn);
      },
      append(...nodes) {
        for (const node of nodes) {
          node.parent = el;
          el.children.push(node);
        }
      },
      remove() {
        if (el.parent) el.parent.children = el.parent.children.filter((child) => child !== el);
        el.parent = null;
      },
    };
    return el;
  };
  const root = create();
  root.ownerDocument = { defaultView: view, createElement: create, createElementNS: create };
  return {
    root,
    timers,
    /** The timer that is waiting runs, as when its time comes. */
    elapse() {
      assert.strictEqual(timers.size, 1, 'one timer is waiting');
      const [[id, { fn }]] = timers;
      timers.delete(id);
      fn();
    },
    /** These elements' animations end. */
    end(...elements) {
      for (const el of elements) for (const fn of el.ended) fn({ target: el });
    },
  };
}

test('the sleeping z comes in bursts: three letters, a rest with nothing on the page, three letters again', () => {
  const page = fakePage();
  const symbols = createSymbols(page.root, { color: '#ffb54c' });
  symbols.play('z');
  assert.strictEqual(page.root.children.length, 3, 'the burst');
  assert.deepStrictEqual([...page.timers.values()].map((t) => t.ms), [Z_CYCLE * 1000], 'one timer, for the next burst');
  page.end(...page.root.children);
  assert.strictEqual(page.root.children.length, 0, 'the letters ended and took themselves away: nothing is animating');
  assert.strictEqual(page.timers.size, 1, 'only the timer is waiting');
  page.elapse();
  assert.strictEqual(page.root.children.length, 3, 'the next burst');
  assert.strictEqual(page.timers.size, 1, 'and the timer for the one after');
});

test('a new burst replaces letters that never ended, as on a hidden page, instead of piling up', () => {
  const page = fakePage();
  createSymbols(page.root).play('z');
  const first = [...page.root.children];
  page.elapse();
  page.elapse();
  assert.strictEqual(page.root.children.length, 3);
  for (const el of first) assert.ok(!page.root.children.includes(el), 'the old letters are gone');
});

test('stop() and play() leave no timer and no burst behind', () => {
  const page = fakePage();
  const symbols = createSymbols(page.root);
  symbols.play('z');
  symbols.stop();
  assert.strictEqual(page.timers.size, 0, 'stop clears the timer');
  assert.strictEqual(page.root.children.length, 0, 'and the letters');
  symbols.play('z');
  symbols.play('z');
  assert.strictEqual(page.timers.size, 1, 'z again replaces the timer, not adds one');
  assert.strictEqual(page.root.children.length, 3, 'and the letters');
  symbols.play('hearts');
  assert.strictEqual(page.timers.size, 0, 'another effect clears it');
  symbols.play('z');
  symbols.play(null);
  assert.strictEqual(page.timers.size, 0, 'so does nothing');
  assert.strictEqual(page.root.children.length, 0);
});

/** Play "z" from `since` seconds into a sleep and let every burst come: the second each burst starts at, until none is due. */
function burstStarts(since = 0) {
  const page = fakePage();
  const symbols = createSymbols(page.root);
  const starts = [];
  symbols.play('z', { since });
  while (true) {
    if (page.root.children.length > 0) starts.push(since + starts.length * Z_CYCLE);
    page.end(...page.root.children);
    if (page.timers.size === 0) break;
    assert.deepStrictEqual([...page.timers.values()].map((t) => t.ms), [Z_CYCLE * 1000], 'one timer, for the next burst');
    page.elapse();
    assert.ok(starts.length < 1000, 'the bursts stop coming');
  }
  return { starts, page };
}

test('the z letters stop coming back after Z_FOR (5 minutes), and the last burst starts before it', () => {
  assert.strictEqual(Z_FOR, 300);
  const { starts, page } = burstStarts();
  assert.strictEqual(starts[0], 0);
  assert.ok(starts.length > 1, 'it does come back for a while');
  assert.ok(starts.at(-1) < Z_FOR, `the last burst starts at ${starts.at(-1)} s, before ${Z_FOR} s`);
  assert.ok(starts.at(-1) + Z_CYCLE >= Z_FOR, 'and the next one would not have started before it');
  assert.strictEqual(page.timers.size, 0, 'no timer is waiting after the last burst');
  assert.strictEqual(page.root.children.length, 0, 'and nothing is on the page: it sleeps quietly');
});

test('the last burst starts before Z_FOR whether Z_FOR is a whole number of cycles or not', () => {
  // From any point of the sleep: the bursts come every cycle from there, the last one starts before Z_FOR, and the
  // next would have started at Z_FOR or later. (From 0, 300 s is a whole number of 12 s cycles: a burst at exactly 300
  // would be the first of the quiet. From 5, the bursts come at 5, 17, ... and the last is at 293, not 305.)
  for (const since of [0, 1, 5, 11.5, 100, 179, 288, 299]) {
    const { starts } = burstStarts(since);
    assert.strictEqual(starts[0], since, `${since}: a burst at once`);
    assert.ok(starts.at(-1) < Z_FOR, `${since}: the last burst starts at ${starts.at(-1)} s, before ${Z_FOR} s`);
    assert.ok(starts.at(-1) + Z_CYCLE >= Z_FOR, `${since}: and the next would not have started before it`);
  }
  assert.strictEqual(burstStarts(0).starts.at(-1), 288);
  assert.strictEqual(burstStarts(5).starts.at(-1), 293);
});

test('a "z" played when the sleep is already Z_FOR old or more shows nothing, and waits for nothing', () => {
  for (const since of [Z_FOR, Z_FOR + 1, 3600, Infinity]) {
    const page = fakePage();
    const symbols = createSymbols(page.root);
    symbols.play('z', { since });
    assert.strictEqual(page.root.children.length, 0, `no letters at ${since} s`);
    assert.strictEqual(page.timers.size, 0, `and no timer at ${since} s`);
  }
  // It also takes away what was showing, as a play of no effect does.
  const page = fakePage();
  const symbols = createSymbols(page.root);
  symbols.play('z');
  assert.strictEqual(page.root.children.length, 3);
  symbols.play('z', { since: Z_FOR + 60 });
  assert.strictEqual(page.root.children.length, 0, 'the letters of the sleep before are gone');
  assert.strictEqual(page.timers.size, 0, 'and so is the timer');
});

test('a "z" played 3 minutes into a sleep keeps bursting until 5 minutes, then stops', () => {
  const { starts } = burstStarts(180);
  assert.strictEqual(starts[0], 180, 'a burst at once');
  assert.strictEqual(starts.length, (Z_FOR - 180) / Z_CYCLE, 'and one every cycle until 5 minutes');
  assert.ok(starts.at(-1) < Z_FOR);
  // Just under 5 minutes it is a last burst; the timer that would follow it is not set.
  const page = fakePage();
  createSymbols(page.root).play('z', { since: Z_FOR - 1 });
  assert.strictEqual(page.root.children.length, 3, 'a burst a second before 5 minutes');
  assert.strictEqual(page.timers.size, 0, 'and none after it');
});

test('a "z" played with no since is the start of a sleep, as before', () => {
  const page = fakePage();
  const symbols = createSymbols(page.root);
  symbols.play('z');
  assert.strictEqual(page.root.children.length, 3);
  assert.deepStrictEqual([...page.timers.values()].map((t) => t.ms), [Z_CYCLE * 1000]);
  symbols.play('z', {});
  assert.strictEqual(page.root.children.length, 3);
  assert.strictEqual(page.timers.size, 1);
});

test('the others do not care how long their mood has been showing: stars, hearts, sparkles, notes and the drop', () => {
  for (const effect of EFFECTS.filter((e) => e !== 'z')) {
    const fresh = fakePage();
    createSymbols(fresh.root).play(effect);
    const old = fakePage();
    createSymbols(old.root).play(effect, { since: 100000 });
    assert.strictEqual(old.root.children.length, fresh.root.children.length, `${effect} shows its particles`);
    assert.ok(old.root.children.length > 0, effect);
    assert.strictEqual(old.timers.size, 0, `${effect} still has no timer`);
  }
});

test('no other effect uses a timer: the stars loop in CSS and the rest play once', () => {
  for (const effect of EFFECTS.filter((e) => e !== 'z')) {
    const page = fakePage();
    createSymbols(page.root).play(effect);
    assert.strictEqual(page.timers.size, 0, effect);
    assert.ok(page.root.children.length > 0, `${effect} shows its particles`);
  }
});

// symbols.css: what the page cannot test in Node, read from the stylesheet itself.
const css = fs
  .readFileSync(new URL('../src/renderer/buddy/symbols.css', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

/** The text inside the braces opened just before `from`, up to the one that closes them. */
function braced(text, from) {
  let depth = 1;
  let i = from;
  while (depth > 0 && i < text.length) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') depth--;
    i++;
  }
  return text.slice(from, i - 1);
}

/** The body of every `@keyframes name { … }`, by name. */
function keyframes(text) {
  const blocks = {};
  for (const m of text.matchAll(/@keyframes\s+([\w-]+)\s*\{/g)) blocks[m[1]] = braced(text, m.index + m[0].length);
  return blocks;
}

/** The declarations of the first rule for exactly this selector (not one in a list). */
function rule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp(`(?:^|[}\\s])${escaped}\\s*\\{([^}]*)\\}`));
  assert.ok(m, `a rule for ${selector}`);
  return m[1];
}

test('the symbols move with transform and opacity only', () => {
  const blocks = keyframes(css);
  assert.ok(Object.keys(blocks).length >= 6, 'keyframes for every kind');
  for (const [name, body] of Object.entries(blocks)) {
    for (const [, property] of body.matchAll(/([a-z-]+)\s*:/g)) {
      assert.ok(['transform', 'opacity', 'animation-timing-function'].includes(property), `${name}: ${property}`);
    }
  }
});

test('every kind has its look, and nothing takes the pointer', () => {
  for (const kind of KINDS) rule(`.buddy-symbol--${kind}`);
  assert.match(rule('.buddy-symbols'), /pointer-events:\s*none/);
  assert.match(rule('.buddy-symbol'), /pointer-events:\s*none/);
});

test('with reduced motion the symbols only fade: every animation it names animates opacity and nothing else', () => {
  const start = css.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{/);
  assert.ok(start, 'a reduced-motion block');
  const block = braced(css, start.index + start[0].length);
  for (const kind of KINDS) assert.ok(block.includes(`.buddy-symbol--${kind}`), `${kind} is in the block`);
  assert.doesNotMatch(block, /animation\s*:/, 'it names keyframes with animation-name, which is what this test reads');
  assert.doesNotMatch(block, /animation-(duration|delay|iteration-count)/, 'it changes what moves, not how long or how often');
  const blocks = keyframes(css);
  const names = [...block.matchAll(/animation-name:\s*([\w-]+)/g)].map((m) => m[1]);
  assert.ok(names.length > 0, 'it names some keyframes');
  for (const name of names) {
    assert.ok(blocks[name], `${name} has keyframes`);
    for (const [, property] of blocks[name].matchAll(/([a-z-]+)\s*:/g)) {
      assert.ok(['opacity', 'animation-timing-function'].includes(property), `${name} animates ${property}`);
    }
  }
});

test('only the stars loop; the z letters play one burst, and the rest play once, over before their feeling ends', () => {
  const seconds = (kind) => {
    const m = rule(`.buddy-symbol--${kind}`).match(/animation-duration:\s*([\d.]+)s/);
    assert.ok(m, `${kind} has a duration`);
    return Number(m[1]);
  };
  assert.match(rule('.buddy-symbol--star'), /animation-iteration-count:\s*infinite/);
  assert.doesNotMatch(rule('.buddy-symbol--z'), /infinite/, 'a loop would never let the page rest');
  // How long each feeling lasts (moods.js): the page stops its symbols when it ends.
  const feeling = { hearts: 2, sparkles: 1.6, notes: 2, drop: 2.5 };
  for (const [effect, length] of Object.entries(feeling)) {
    for (const p of particlesFor(effect)) {
      assert.doesNotMatch(rule(`.buddy-symbol--${p.kind}`), /infinite/, effect);
      assert.ok(p.delay >= 0, `${effect} starts at once or later`);
      assert.ok(p.delay + seconds(p.kind) <= length, `${effect}: over by ${p.delay + seconds(p.kind)} s of ${length}`);
    }
  }
});

test('a z letter takes as long in the stylesheet as symbols.js counts on for the burst and the rest', () => {
  const m = rule('.buddy-symbol--z').match(/animation-duration:\s*([\d.]+)s/);
  assert.ok(m, 'z has a duration');
  assert.strictEqual(Number(m[1]), Z_LETTER);
});

test('the stars circle the ring in symbols.js: the stylesheet traces its points, in its time', () => {
  const star = rule('.buddy-symbol--star');
  assert.match(star, /animation-name:\s*buddy-symbol-orbit\b/, 'the keyframes read here are the ones the stars use');
  const duration = star.match(/animation-duration:\s*([\d.]+)s/);
  assert.ok(duration, 'the stars have a duration');
  assert.strictEqual(Number(duration[1]), RING.turn, 'one turn takes as long');
  // Each step moves the star to the ring's point at that part of a turn, from where it was put: a translate of
  // calc((x - var(--x)) * var(--head-w)), calc((y - var(--y)) * var(--head-w)).
  const POINT = /translate\(\s*calc\(\(\s*(-?[\d.]+)\s*-\s*var\(--x\)\)\s*\*\s*var\(--head-w\)\)\s*,\s*calc\(\(\s*(-?[\d.]+)\s*-\s*var\(--y\)\)\s*\*\s*var\(--head-w\)\)\s*\)/;
  const steps = [...keyframes(css)['buddy-symbol-orbit'].matchAll(/([\d.]+)%\s*\{([^}]*)\}/g)].map(([, percent, body]) => {
    const point = body.match(POINT);
    assert.ok(point, `${percent}%: a translate to a point on the ring`);
    return { turn: Number(percent) / 100, x: Number(point[1]), y: Number(point[2]) };
  });
  assert.strictEqual(steps.length, 13, 'twelve steps round the ring');
  steps.forEach(({ turn, x, y }, i) => {
    assert.ok(Math.abs(turn - i / 12) < 0.001, `step ${i} is at ${i}/12 of a turn: ${turn}`);
    const angle = (2 * Math.PI * i) / 12;
    assert.ok(Math.abs(x - RING.a * Math.cos(angle)) <= 0.0006, `step ${i}: x ${x}`);
    assert.ok(Math.abs(y - (RING.y + RING.b * Math.sin(angle))) <= 0.0006, `step ${i}: y ${y}`);
  });
  // Each star is put on the step its negative delay starts it at, so it does not jump when its animation begins.
  for (const p of particlesFor('stars')) {
    const turn = -p.delay / RING.turn;
    const step = steps.find((s) => Math.abs(s.turn - turn) < 0.001);
    assert.ok(step, `a step at ${turn} of a turn`);
    assert.ok(Math.abs(step.x - p.x) <= 0.0011 && Math.abs(step.y - p.y) <= 0.0011, `(${p.x}, ${p.y}) is not (${step.x}, ${step.y})`);
  }
});
