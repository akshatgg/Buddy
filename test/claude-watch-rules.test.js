'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  MOODS, FORGET_AFTER_MS, QUIET_MS, folderName, parseEvent, newState, apply, forget, doingOf,
} = require('../src/main/claude/watch');

/** An event as parseEvent gives it, for session `session` in my-app. */
const ev = (name, session = 's1', extra = {}) => ({ name, sessionId: session, folder: 'my-app', matcher: '', error: '', ...extra });

/** Run events through apply from a fresh state; `out` has one { mood, bubble } per event (null for none). */
function run(events, now = () => 1000) {
  let state = newState();
  const out = [];
  for (const e of events) {
    const r = apply(state, e, now());
    state = r.state;
    out.push({ mood: r.mood ?? null, bubble: r.bubble ?? null });
  }
  return { state, out };
}
const none = { mood: null, bubble: null };

test('the moods of this piece, in one table', () => {
  assert.deepStrictEqual(MOODS, { working: 'thinking', done: 'celebrate', needsYou: 'wave', failed: 'sad', idle: 'idle' });
  assert.strictEqual(FORGET_AFTER_MS, 30 * 60 * 1000);
});

test('a session is named after the last part of its folder, on the Mac and on Windows', () => {
  assert.strictEqual(folderName('/Users/someone/code/my-app'), 'my-app');
  assert.strictEqual(folderName('/Users/someone/code/my-app/'), 'my-app');
  assert.strictEqual(folderName('C:\\Users\\someone\\code\\my-app'), 'my-app');
  assert.strictEqual(folderName(''), 'your project');
});

test('parseEvent reads what the hook sends, and refuses what is not an event', () => {
  const text = JSON.stringify({
    hook_event_name: 'StopFailure', session_id: 'abc', cwd: '/x/my-app', matcher: 'rate_limit', error: 'Rate limit reached', transcript_path: '/h/.claude/projects/p/abc.jsonl',
  });
  assert.deepStrictEqual(parseEvent(text), {
    name: 'StopFailure', sessionId: 'abc', folder: 'my-app', matcher: 'rate_limit', error: 'Rate limit reached', cwd: '/x/my-app', transcript: '/h/.claude/projects/p/abc.jsonl', tool: '',
  });
  assert.strictEqual(parseEvent(JSON.stringify({ hook_event_name: 'PreToolUse', session_id: 'abc', tool_name: 'Edit' })).tool, 'Edit');
  assert.deepStrictEqual(parseEvent(JSON.stringify({ hook_event_name: 'Stop', session_id: 'abc', transcript_path: 7 })),
    { name: 'Stop', sessionId: 'abc', folder: 'your project', matcher: '', error: '', cwd: '', transcript: '', tool: '' });
  assert.strictEqual(parseEvent('not json'), null);
  assert.strictEqual(parseEvent('[]'), null);
  assert.strictEqual(parseEvent(JSON.stringify({ hook_event_name: 'SubagentStop', session_id: 'abc' })), null);
  assert.strictEqual(parseEvent(JSON.stringify({ hook_event_name: 'Stop' })), null);
  assert.strictEqual(parseEvent(JSON.stringify({ hook_event_name: 'Stop', session_id: 7 })), null);
});

test('working: thinking once when the first session starts, not on every tool', () => {
  const { state, out } = run([ev('UserPromptSubmit'), ev('PreToolUse'), ev('PreToolUse')]);
  assert.deepStrictEqual(out, [{ mood: 'thinking', bubble: null }, none, none]);
  assert.strictEqual(state.overall, 'working');
  assert.strictEqual(state.sessions.s1.working, true);
  assert.strictEqual(state.sessions.s1.name, 'my-app');
});

test('done: happy and the bubble when nothing else is working', () => {
  const { state, out } = run([ev('UserPromptSubmit'), ev('Stop')]);
  assert.deepStrictEqual(out[1], { mood: 'celebrate', bubble: 'Claude Code is done in my-app' });
  assert.strictEqual(state.overall, 'done');
  assert.strictEqual(state.sessions.s1.working, false);
});

test('needs you: wave and the bubble once per need, again only after the session worked again', () => {
  const { out } = run([
    ev('UserPromptSubmit'), ev('PermissionRequest'), ev('Notification'), ev('PreToolUse'), ev('PermissionRequest'),
  ]);
  assert.deepStrictEqual(out[1], { mood: 'wave', bubble: 'Claude Code needs you in my-app' });
  assert.deepStrictEqual(out[2], none, 'a second ask for the same need says nothing');
  assert.deepStrictEqual(out[3], { mood: 'thinking', bubble: null }, 'the permission was given: working again');
  assert.deepStrictEqual(out[4], { mood: 'wave', bubble: 'Claude Code needs you in my-app' });
});

test('a need before any work is still a wave', () => {
  const { out } = run([ev('Notification')]);
  assert.deepStrictEqual(out[0], { mood: 'wave', bubble: 'Claude Code needs you in my-app' });
});

test('failed: sleepy and the bubble; the limit has its own words', () => {
  const { out } = run([ev('UserPromptSubmit'), ev('StopFailure', 's1', { error: 'Something broke' })]);
  assert.deepStrictEqual(out[1], { mood: 'sad', bubble: 'Claude Code hit a problem in my-app' });
  const limit = run([ev('UserPromptSubmit'), ev('StopFailure', 's1', { matcher: 'rate_limit' })]);
  assert.deepStrictEqual(limit.out[1], { mood: 'sad', bubble: "Claude Code's limit is reached" });
  const byError = run([ev('UserPromptSubmit'), ev('StopFailure', 's1', { error: 'rate_limit' })]);
  assert.strictEqual(byError.out[1].bubble, "Claude Code's limit is reached");
});

test('several sessions: the count in the bubble, and thinking stays while one still works', () => {
  const { state, out } = run([
    ev('UserPromptSubmit', 'a'), ev('UserPromptSubmit', 'b'), ev('PreToolUse', 'b'), ev('Stop', 'a'), ev('Stop', 'b'),
  ]);
  assert.deepStrictEqual(out[0], { mood: 'thinking', bubble: null });
  assert.deepStrictEqual(out[1], { mood: null, bubble: '2 sessions working' });
  assert.deepStrictEqual(out[2], none, 'a tool in a session already working says nothing');
  assert.deepStrictEqual(out[3], { mood: null, bubble: 'Claude Code is done in my-app (1 still working)' });
  assert.deepStrictEqual(out[4], { mood: 'celebrate', bubble: 'Claude Code is done in my-app' });
  assert.strictEqual(state.overall, 'done');
});

test('a need in one session while another works says how many still work', () => {
  const { out } = run([ev('UserPromptSubmit', 'a'), ev('UserPromptSubmit', 'b'), ev('PermissionRequest', 'a')]);
  assert.deepStrictEqual(out[2], { mood: 'wave', bubble: 'Claude Code needs you in my-app (1 still working)' });
  const failed = run([ev('UserPromptSubmit', 'a'), ev('UserPromptSubmit', 'b'), ev('StopFailure', 'a')]);
  assert.deepStrictEqual(failed.out[2], { mood: 'sad', bubble: 'Claude Code hit a problem in my-app (1 still working)' });
});

test('the mood follows the whole picture: a need beats work, and work comes back when nobody needs you', () => {
  const { out } = run([ev('UserPromptSubmit', 'a'), ev('PermissionRequest', 'b'), ev('PreToolUse', 'b'), ev('PermissionRequest', 'b'), ev('UserPromptSubmit', 'c')]);
  assert.deepStrictEqual(out[0], { mood: 'thinking', bubble: null });
  assert.deepStrictEqual(out[1], { mood: 'wave', bubble: 'Claude Code needs you in my-app (1 still working)' });
  assert.deepStrictEqual(out[2], { mood: 'thinking', bubble: '2 sessions working' }, 'b was allowed: a and b work, nobody needs you');
  assert.deepStrictEqual(out[3].mood, 'wave');
  assert.deepStrictEqual(out[4], { mood: null, bubble: '2 sessions working' }, 'c starts while b needs you: the wave stays');
});

test('after a failure or a done while others work, the next work shows thinking again', () => {
  const failed = run([ev('UserPromptSubmit', 'a'), ev('UserPromptSubmit', 'b'), ev('StopFailure', 'a'), ev('PreToolUse', 'b'), ev('PreToolUse', 'b')]);
  assert.strictEqual(failed.out[2].mood, 'sad');
  assert.deepStrictEqual(failed.out[3], { mood: 'thinking', bubble: null }, 'b still works: not stuck on sleepy');
  assert.deepStrictEqual(failed.out[4], none, 'and not again on every tool');
  const done = run([ev('UserPromptSubmit', 'a'), ev('Stop', 'a'), ev('UserPromptSubmit', 'b')]);
  assert.deepStrictEqual(done.out.map((o) => o.mood), ['thinking', 'celebrate', 'thinking']);
});

test('a session done while another needs you: the words, and the wave stays', () => {
  const { state, out } = run([ev('UserPromptSubmit', 'a'), ev('PermissionRequest', 'b'), ev('Stop', 'a')]);
  assert.deepStrictEqual(out[2], { mood: null, bubble: 'Claude Code is done in my-app' });
  assert.strictEqual(state.overall, 'needsYou');
});

test('a session that ends is forgotten; the buddy goes idle when nothing is left to wait for', () => {
  const waved = run([ev('UserPromptSubmit'), ev('PermissionRequest'), ev('SessionEnd')]);
  assert.deepStrictEqual(waved.out[2], { mood: 'idle', bubble: null });
  assert.deepStrictEqual(waved.state.sessions, {});
  const done = run([ev('UserPromptSubmit'), ev('Stop'), ev('SessionEnd')]);
  assert.deepStrictEqual(done.out[2], none, 'after happy, nothing more: happy stays');
  const two = run([ev('UserPromptSubmit', 'a'), ev('UserPromptSubmit', 'b'), ev('SessionEnd', 'a')]);
  assert.deepStrictEqual(two.out[2], none, 'b still works: thinking stays');
});

test('an unknown session ending is nothing', () => {
  const { state, out } = run([ev('SessionEnd', 'ghost')]);
  assert.deepStrictEqual(out[0], none);
  assert.deepStrictEqual(state, newState());
});

test('a session quiet for 30 minutes is forgotten, and the buddy goes idle if it was waiting on it', () => {
  // Both wait for the person (the 5-minute quiet time does not end a wait): old's last event at 120 000, new's at 240 000.
  let clock = 0;
  const { state } = run([
    ev('UserPromptSubmit', 'old'), ev('PermissionRequest', 'old'), ev('UserPromptSubmit', 'new'), ev('PermissionRequest', 'new'),
  ], () => (clock += 60_000));
  const kept = forget(state, 120_000 + FORGET_AFTER_MS - 1);
  assert.deepStrictEqual(Object.keys(kept.state.sessions), ['old', 'new']);
  assert.strictEqual(kept.mood, undefined);
  const older = forget(state, 120_000 + FORGET_AFTER_MS);
  assert.deepStrictEqual(Object.keys(older.state.sessions), ['new'], 'the older one is gone, the newer stays');
  assert.strictEqual(older.mood, undefined, 'new still needs you: the wave stays');
  const all = forget(state, 240_000 + FORGET_AFTER_MS);
  assert.deepStrictEqual(all.state.sessions, {});
  assert.strictEqual(all.mood, 'idle');
  assert.strictEqual(all.state.overall, 'idle');
});

test('apply and forget never change the state they are given', () => {
  const state = run([ev('UserPromptSubmit')]).state;
  const copy = structuredClone(state);
  apply(state, ev('Stop'), 5000);
  forget(state, 10 ** 9);
  assert.deepStrictEqual(state, copy);
});

test('a working session quiet for 5 minutes stops counting as working (Esc sends no hook), and is kept', () => {
  assert.strictEqual(QUIET_MS, 5 * 60 * 1000);
  let clock = 0;
  const { state } = run([ev('UserPromptSubmit', 'a')], () => (clock += 1000));
  const still = forget(state, 1000 + QUIET_MS - 1);
  assert.strictEqual(still.mood, undefined, 'under 5 minutes: thinking stays');
  const quiet = forget(state, 1000 + QUIET_MS);
  assert.strictEqual(quiet.mood, 'idle');
  assert.strictEqual(quiet.state.sessions.a.working, false);
  assert.deepStrictEqual(Object.keys(quiet.state.sessions), ['a'], 'kept until the 30 minutes');
  const back = apply(quiet.state, ev('UserPromptSubmit', 'a'), 1000 + QUIET_MS + 1);
  assert.strictEqual(back.mood, 'thinking', 'the next prompt thinks again');
});

test('a tool that finishes (PostToolUse) counts as work, so a long run keeps the buddy thinking', () => {
  let clock = 0;
  const { state, out } = run([ev('UserPromptSubmit', 'a'), ev('PostToolUse', 'a')], () => (clock += 4 * 60 * 1000));
  assert.deepStrictEqual(out[1], none, 'no new mood: it was thinking already');
  assert.strictEqual(forget(state, clock + QUIET_MS - 1).mood, undefined);
});

test('a session waiting for the person is not ended by the quiet time', () => {
  const { state } = run([ev('UserPromptSubmit', 'a'), ev('PermissionRequest', 'a')]);
  const later = forget(state, 1000 + QUIET_MS + 1);
  assert.strictEqual(later.mood, undefined);
  assert.strictEqual(later.state.overall, 'needsYou');
});

/** The notch status after each event, from a fresh state. */
function statuses(events) {
  let state = newState();
  return events.map((e) => {
    const r = apply(state, e, 1000);
    state = r.state;
    return r.status;
  });
}

test('the words for a tool: what Claude Code does, in plain words', () => {
  assert.strictEqual(doingOf('Edit'), 'editing code');
  assert.strictEqual(doingOf('Bash'), 'running a command');
  assert.strictEqual(doingOf('mcp__github__create_pr'), 'using tools');
  assert.strictEqual(doingOf('SomethingNew'), 'working');
  assert.strictEqual(doingOf(), 'working');
  assert.strictEqual(doingOf('toString'), 'working', 'not a property of every object');
});

test('the notch status: what the one session does, kept between tools, then done', () => {
  const tool = (name, t) => ev(name, 's1', { tool: t });
  assert.deepStrictEqual(statuses([
    ev('UserPromptSubmit'), tool('PreToolUse', 'Read'), tool('PostToolUse', 'Read'), tool('PreToolUse', 'Edit'), ev('Stop'), ev('SessionEnd'),
  ]), [
    { kind: 'working', text: 'Claude · thinking' },
    { kind: 'working', text: 'Claude · reading code' },
    { kind: 'working', text: 'Claude · reading code' },
    { kind: 'working', text: 'Claude · editing code' },
    { kind: 'done', text: '' },
    { kind: 'done', text: '' },
  ]);
});

test('the notch status: a need beats work, several sessions are counted, a failure has no words', () => {
  assert.deepStrictEqual(statuses([ev('UserPromptSubmit', 'a'), ev('UserPromptSubmit', 'b'), ev('PermissionRequest', 'a'), ev('PreToolUse', 'a'), ev('StopFailure', 'a'), ev('StopFailure', 'b')]), [
    { kind: 'working', text: 'Claude · thinking' },
    { kind: 'working', text: '2 Claudes working' },
    { kind: 'needsYou', text: 'Claude needs you' },
    { kind: 'working', text: '2 Claudes working' },
    { kind: 'working', text: 'Claude · thinking' },
    { kind: 'failed', text: '' },
  ]);
  assert.strictEqual(statuses([ev('SessionEnd')])[0], null, 'nothing going on: no status');
});
