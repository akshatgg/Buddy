import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import { EFFECTS, particlesFor } from '../src/renderer/buddy/symbols.js';

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

// symbols.css: what the page cannot test in Node, read from the stylesheet itself.
const css = fs
  .readFileSync(new URL('../src/renderer/buddy/symbols.css', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

/** The body of every `@keyframes name { … }`, by name. */
function keyframes(text) {
  const blocks = {};
  for (const m of text.matchAll(/@keyframes\s+([\w-]+)\s*\{/g)) {
    let depth = 1;
    let i = m.index + m[0].length;
    while (depth > 0 && i < text.length) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') depth--;
      i++;
    }
    blocks[m[1]] = text.slice(m.index + m[0].length, i - 1);
  }
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

test('every kind has its look, nothing takes the pointer, and reduced motion only fades', () => {
  for (const kind of KINDS) rule(`.buddy-symbol--${kind}`);
  assert.match(rule('.buddy-symbols'), /pointer-events:\s*none/);
  assert.match(rule('.buddy-symbol'), /pointer-events:\s*none/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
});

test('the z letters and the stars loop; the rest play once, and are over before their feeling ends', () => {
  const seconds = (kind) => {
    const m = rule(`.buddy-symbol--${kind}`).match(/animation-duration:\s*([\d.]+)s/);
    assert.ok(m, `${kind} has a duration`);
    return Number(m[1]);
  };
  for (const kind of ['z', 'star']) assert.match(rule(`.buddy-symbol--${kind}`), /animation-iteration-count:\s*infinite/);
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
