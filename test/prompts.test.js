'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { ACTIONS, buildPrompt, parseCheck, parseChat, LIMITS } = require('../shared/prompts');

test('write: uses the instruction as the user turn and the chosen tone', () => {
  const p = buildPrompt('write', { instruction: '  boss ko mail likho kal chutti chahiye ', tone: 'friendly' });
  assert.strictEqual(p.user, 'boss ko mail likho kal chutti chahiye');
  assert.match(p.system, /warm and friendly/);
  assert.match(p.system, /Hinglish/);
  assert.match(p.system, /Return ONLY the finished text/);
  assert.match(p.system, /\[Name\]/);
  assert.strictEqual(p.image, null);
});

test('write: an unknown tone falls back to formal', () => {
  assert.match(buildPrompt('write', { instruction: 'hi', tone: 'pirate' }).system, /formal and polite/);
});

test('write: a name every object has (constructor, __proto__, toString) is not a tone either', () => {
  const formal = buildPrompt('write', { instruction: 'hi' }).system;
  assert.match(formal, /Tone: formal and polite\./);
  for (const tone of ['constructor', '__proto__', 'toString']) {
    assert.strictEqual(buildPrompt('write', { instruction: 'hi', tone }).system, formal, tone);
  }
});

test('write: an empty instruction is refused with a message for the user', () => {
  assert.throws(() => buildPrompt('write', { instruction: '   ' }), {
    code: 'bad_request',
    message: 'Tell me what to write first.',
  });
});

test('fix: passes the text through and asks for only the corrected text', () => {
  const p = buildPrompt('fix', { text: 'i am go to office' });
  assert.strictEqual(p.user, 'i am go to office');
  assert.match(p.system, /Return ONLY the corrected text/);
});

test('fix: text over the limit is refused', () => {
  assert.throws(() => buildPrompt('fix', { text: 'a'.repeat(LIMITS.text + 1) }), { code: 'bad_request' });
});

test('check: needs a screenshot, and carries it with the optional question', () => {
  assert.throws(() => buildPrompt('check', {}), { code: 'bad_request', message: 'Take a screenshot first.' });
  const p = buildPrompt('check', { image: 'AAAA', instruction: 'is this mail ok?' });
  assert.strictEqual(p.image, 'AAAA');
  assert.strictEqual(p.user, 'The user asks: is this mail ok?');
  assert.match(p.system, /JSON only/);
  assert.strictEqual(buildPrompt('check', { image: 'AAAA' }).user, 'Is my text okay?');
});

test('check: a screenshot over the limit is refused', () => {
  assert.throws(() => buildPrompt('check', { image: 'a'.repeat(LIMITS.imageChars + 1) }), { code: 'bad_request' });
});

test('an unknown action is refused', () => {
  assert.throws(() => buildPrompt('dance', {}), { code: 'bad_request' });
});

test('parseCheck reads the JSON answer, with or without code fences', () => {
  const answer = '```json\n{"verdict":"problems","problems":["Spelling: recieve"],"corrected":"I will receive it."}\n```';
  assert.deepStrictEqual(parseCheck(answer), {
    verdict: 'problems',
    problems: ['Spelling: recieve'],
    corrected: 'I will receive it.',
  });
});

test('parseCheck keeps at most 5 problems and turns a blank correction into null', () => {
  const r = parseCheck(JSON.stringify({ verdict: 'problems', problems: ['1', '2', '3', '4', '5', '6'], corrected: '  ' }));
  assert.strictEqual(r.problems.length, 5);
  assert.strictEqual(r.corrected, null);
});

test('parseCheck falls back to the raw text', () => {
  assert.deepStrictEqual(parseCheck('Looks fine to me!'), { raw: 'Looks fine to me!' });
  assert.deepStrictEqual(parseCheck('{"verdict":"maybe"}'), { raw: '{"verdict":"maybe"}' });
});

test('answers are capped at 1024 tokens, on the own-key route and the free one alike', () => {
  assert.strictEqual(require('../shared/prompts').MAX_TOKENS, 1024);
});

// ---- chat: the panel's one request ----

test('chat is one of the actions, and the old ones stay', () => {
  assert.deepStrictEqual(ACTIONS, ['write', 'fix', 'check', 'chat']);
});

test('chat: the message is the user turn, trimmed, with no image unless one is given', () => {
  const p = buildPrompt('chat', { message: '  boss ko mail, kal chutti chahiye  ' });
  assert.match(p.user, /Their message:\n"""\nboss ko mail, kal chutti chahiye\n"""/);
  assert.strictEqual(p.image, null);
  for (const label of ['Selected text:', 'Their text box:', 'Chat so far:', 'What you know about them:', 'The app they are in:',
    'Their first name:', 'second step']) {
    assert.ok(!p.user.includes(label), `nothing about ${label} when it was not given`);
  }
});

test('chat: a message is needed, and at most 1000 characters of it', () => {
  for (const message of [undefined, '', '   ', 42]) {
    assert.throws(() => buildPrompt('chat', { message }), { code: 'bad_request', message: 'Tell me what to do first.' }, String(message));
  }
  assert.ok(buildPrompt('chat', { message: 'a'.repeat(1000) }));
  assert.throws(() => buildPrompt('chat', { message: 'a'.repeat(1001) }),
    { code: 'bad_request', message: 'That is too long (over 1000 characters). Try a shorter one.' });
});

test('chat: everything it is given reaches the user prompt, each under its own label', () => {
  const p = buildPrompt('chat', {
    message: 'fix this',
    selection: '  i am go to office  ',
    box: 'Dear sir, i will not come tomorow.',
    history: [{ from: 'you', text: 'hi' }, { from: 'buddy', text: 'Hi Akshat! What should we do?' }],
    facts: ['Your boss is Mr. Sharma.', 'You work at Infosys.'],
    appName: 'Gmail',
    userName: 'Akshat',
    step: 2,
  });
  assert.match(p.user, /Selected text:\n"""\ni am go to office\n"""/);
  assert.match(p.user, /Their text box:\n"""\nDear sir, i will not come tomorow\.\n"""/);
  assert.match(p.user, /Chat so far \(oldest first\):\nThem: hi\nBuddy: Hi Akshat! What should we do\?/);
  assert.match(p.user, /What you know about them:\n- Your boss is Mr\. Sharma\.\n- You work at Infosys\./);
  assert.match(p.user, /The app they are in: Gmail/);
  assert.match(p.user, /Their first name: Akshat/);
  assert.match(p.user, /This is the second step/);
  assert.match(p.user, /do not answer "box" or "screen"/);
  // The message comes last, so it is what the AI reads just before it answers.
  assert.ok(p.user.endsWith('Their message:\n"""\nfix this\n"""'));
});

test('chat: the screenshot goes along as the image, and the prompt says so', () => {
  const p = buildPrompt('chat', { message: 'what does this mean?', image: 'IMG', appName: 'Chrome', step: 2 });
  assert.strictEqual(p.image, 'IMG');
  assert.match(p.user, /screenshot/i);
  assert.match(p.user, /This is the second step/);
  assert.throws(() => buildPrompt('chat', { message: 'hi', image: 'a'.repeat(LIMITS.imageChars + 1), step: 2 }),
    { code: 'bad_request', message: 'That screenshot is too big.' });
  assert.strictEqual(buildPrompt('chat', { message: 'hi', image: 7 }).image, null, 'an image that is not text is left out');
});

test('chat: a selection or a box over 8000 characters is refused; blank ones are left out', () => {
  const tooLong = { code: 'bad_request', message: 'That is too long (over 8000 characters). Try a shorter one.' };
  assert.ok(buildPrompt('chat', { message: 'fix', selection: 'a'.repeat(8000), box: 'b'.repeat(8000), step: 2 }));
  assert.throws(() => buildPrompt('chat', { message: 'fix', selection: 'a'.repeat(8001) }), tooLong);
  assert.throws(() => buildPrompt('chat', { message: 'fix', box: 'a'.repeat(8001), step: 2 }), tooLong);
  const p = buildPrompt('chat', { message: 'fix', selection: '   ', box: 42 });
  assert.ok(!p.user.includes('Selected text:'));
  assert.ok(!p.user.includes('Their text box:'));
});

test('chat: the last 6 good chat messages are kept, each cut to 2000 characters; bad ones are skipped', () => {
  const history = [
    { from: 'you', text: 'one' },
    { from: 'buddy', text: 'two' },
    null,
    'three',
    { from: 'someone', text: 'four' },
    { from: 'you', text: 42 },
    { from: 'you', text: '   ' },
    { from: 'buddy', text: 'five' },
    { from: 'you', text: 'six' },
    { from: 'buddy', text: 'seven' },
    { from: 'you', text: 'eight' },
    { from: 'buddy', text: `nine ${'x'.repeat(3000)}` },
  ];
  const { user } = buildPrompt('chat', { message: 'hi', history });
  const lines = user.split('Chat so far (oldest first):\n')[1].split('\n\n')[0].split('\n');
  assert.deepStrictEqual(lines.slice(0, 5), ['Buddy: two', 'Buddy: five', 'Them: six', 'Buddy: seven', 'Them: eight']);
  assert.strictEqual(lines[5], `Buddy: nine ${'x'.repeat(2000 - 'nine '.length)}`, 'cut to 2000 characters');
  assert.strictEqual(lines.length, 6);
  assert.ok(!buildPrompt('chat', { message: 'hi', history: 'not a list' }).user.includes('Chat so far'));
  assert.ok(!buildPrompt('chat', { message: 'hi', history: [null, { from: 'x', text: 'y' }] }).user.includes('Chat so far'));
});

test('chat: at most 50 facts, the newest, each on one line and cut to 200 characters; anything not text is skipped', () => {
  const facts = Array.from({ length: 60 }, (_, i) => `Fact ${i}.`);
  const { user } = buildPrompt('chat', { message: 'hi', facts: [7, null, ...facts, '  ', `Long\n${'y'.repeat(300)}`] });
  const known = user.split('What you know about them:\n')[1].split('\n\n')[0].split('\n');
  assert.strictEqual(known.length, 50);
  assert.strictEqual(known[0], '- Fact 11.');
  assert.strictEqual(known.at(-2), '- Fact 59.');
  assert.strictEqual(known.at(-1), `- Long ${'y'.repeat(195)}`, 'one line, cut to 200 characters');
  assert.ok(!buildPrompt('chat', { message: 'hi', facts: 'not a list' }).user.includes('What you know'));
});

test('chat: the app and the name are cut to 100 characters, on one line', () => {
  const { user } = buildPrompt('chat', { message: 'hi', appName: `Google\nChrome ${'c'.repeat(200)}`, userName: ` ${'n'.repeat(150)} ` });
  assert.match(user, new RegExp(`The app they are in: Google Chrome c{86}\\n`));
  assert.match(user, new RegExp(`Their first name: n{100}\\n`));
  const none = buildPrompt('chat', { message: 'hi', appName: '  ', userName: 5 }).user;
  assert.ok(!none.includes('The app they are in') && !none.includes('Their first name'));
});

test('chat: a text box or a screenshot only comes with the second step', () => {
  // The app reads them only for a second step, which is never given back: a first step, which may be, is text only.
  const refused = { code: 'bad_request', message: 'That can only come with the second step.' };
  for (const step of [undefined, 1, '2', 3, true]) {
    assert.throws(() => buildPrompt('chat', { message: 'fix my English', box: 'i am go', step }), refused, `box, step ${step}`);
    assert.throws(() => buildPrompt('chat', { message: 'what is this?', image: 'IMG', step }), refused, `image, step ${step}`);
  }
  // A box or an image that is not there, blank or not text, is nothing, and is not refused.
  for (const nothing of [{ box: '   ' }, { box: 42 }, { image: '' }, { image: 7 }, { box: null, image: null }]) {
    assert.ok(buildPrompt('chat', { message: 'hi', step: 1, ...nothing }), JSON.stringify(nothing));
  }
  assert.ok(buildPrompt('chat', { message: 'fix my English', box: 'i am go', step: 2 }));
  assert.ok(buildPrompt('chat', { message: 'what is this?', image: 'IMG', step: 2 }));
});

test('chat: only step 2 is a second step', () => {
  for (const step of [undefined, 1, '2', 3, true]) {
    assert.ok(!buildPrompt('chat', { message: 'hi', step }).user.includes('second step'), String(step));
  }
});

test('chat: the system prompt asks for the JSON and gives every rule', () => {
  const { system } = buildPrompt('chat', { message: 'hi' });
  assert.match(system, /You are Buddy/);
  assert.match(system, /JSON only/);
  assert.match(system, /"kind"/);
  for (const kind of ['write', 'fix', 'answer', 'box', 'screen', 'send', 'code']) assert.match(system, new RegExp(`"${kind}"`), kind);
  for (const field of ['say', 'text', 'notes', 'doIt', 'send', 'remember', 'again']) assert.match(system, new RegExp(`"${field}"`), field);
  assert.match(system, /all eight fields/);
  assert.match(system, /"again": true or false/, 'the JSON shape has it');
  assert.match(system, /- "again": true when "text" is a new version of the last text you wrote or fixed in this chat/);
  assert.match(system, /Hinglish/);
  assert.match(system, /language and script/);
  assert.match(system, /\[Name\]/);
  assert.match(system, /\[Date\]/);
  assert.match(system, /second step/);
  assert.match(system, /passwords/i);
  assert.match(system, /PINs/);
  assert.match(system, /OTPs/);
  assert.match(system, /at most 5/);
  assert.match(system, /two short sentences/);
});

// ---- parseChat ----

const answerOf = (fields) => JSON.stringify({
  kind: 'write', say: '', text: '', notes: [], doIt: false, send: false, remember: [], again: false, ...fields,
});

test('parseChat reads each kind', () => {
  for (const kind of ['write', 'fix', 'answer', 'box', 'screen', 'send', 'code']) {
    const text = kind === 'answer' ? 'It means "soon".' : 'Some text';
    assert.deepStrictEqual(parseChat(answerOf({ kind, say: 'Here you go.', text })), {
      kind, say: 'Here you go.', text, notes: [], doIt: false, send: false, remember: [], again: false,
    }, kind);
  }
});

test('parseChat reads a full answer, with or without code fences', () => {
  const answer = {
    kind: 'fix', say: 'Theek kar diya!', text: 'I am going to the office.', notes: ['"go" should be "going".'],
    doIt: true, send: true, remember: ['You work in an office.'], again: true,
  };
  assert.deepStrictEqual(parseChat(JSON.stringify(answer)), answer);
  assert.deepStrictEqual(parseChat(`\`\`\`json\n${JSON.stringify(answer)}\n\`\`\``), answer);
  assert.deepStrictEqual(parseChat(`\`\`\`\n${JSON.stringify(answer)}\n\`\`\``), answer);
});

test('parseChat: an answer that is not JSON, or of a kind it does not know, is a written answer with the raw text', () => {
  const written = (raw) => ({ kind: 'write', say: '', text: raw, notes: [], doIt: false, send: false, remember: [], again: false });
  assert.deepStrictEqual(parseChat('  Dear Sir,\nI will be on leave tomorrow.  '), written('Dear Sir,\nI will be on leave tomorrow.'));
  const odd = answerOf({ kind: 'dance', text: 'x' });
  assert.deepStrictEqual(parseChat(odd), written(odd));
  for (const raw of ['[1, 2]', '"just a string"', '42', 'null', '{"say": "no kind"}', '{"kind": "toString"}']) {
    assert.deepStrictEqual(parseChat(raw), written(raw), raw);
  }
  assert.deepStrictEqual(parseChat(''), written(''));
  assert.deepStrictEqual(parseChat(undefined), written(''));
  assert.deepStrictEqual(parseChat(null), written(''));
});

test('parseChat: JSON with words around it, or line breaks inside its strings, is still read', () => {
  const answer = { kind: 'write', say: 'Ye lo.', text: 'Dear Sir,\nI need leave tomorrow.', notes: [], doIt: true, send: false, remember: [], again: false };
  // Some models write the line breaks of a text as they are, which JSON does not allow inside a string.
  const rawBreaks = JSON.stringify(answer).replace('\\n', '\n');
  assert.deepStrictEqual(parseChat(rawBreaks), answer);
  assert.deepStrictEqual(parseChat(`Here is my answer:\n${JSON.stringify(answer)}\nHope it helps!`), answer);
});

test('parseChat: an answer with only `say` takes it as its text', () => {
  const r = parseChat(JSON.stringify({ kind: 'answer', say: 'Kal ka matlab tomorrow hai.' }));
  assert.deepStrictEqual(r, { kind: 'answer', say: '', text: 'Kal ka matlab tomorrow hai.', notes: [], doIt: false, send: false, remember: [], again: false });
  // Only for an answer: a written text with no text stays as it is.
  assert.deepStrictEqual(parseChat(JSON.stringify({ kind: 'write', say: 'Hmm.' })),
    { kind: 'write', say: 'Hmm.', text: '', notes: [], doIt: false, send: false, remember: [], again: false });
});

test('parseChat: missing or odd fields read as empty or false, and the lists are capped', () => {
  assert.deepStrictEqual(parseChat('{"kind": "box"}'), {
    kind: 'box', say: '', text: '', notes: [], doIt: false, send: false, remember: [], again: false,
  });
  const r = parseChat(JSON.stringify({
    kind: 'fix', say: 7, text: ['no'], notes: ['1', 2, '  ', '3', '4', '5', '6', '7'], doIt: 'yes', send: 1,
    remember: ['A', null, 'B', 'C', 'D', 'E', 'F', 'z'.repeat(201), ' '], again: 'yes',
  }));
  assert.deepStrictEqual(r, {
    kind: 'fix', say: '', text: '', notes: ['1', '3', '4', '5', '6'], doIt: false, send: false, remember: ['A', 'B', 'C', 'D', 'E'],
    again: false,
  });
  const long = parseChat(JSON.stringify({ kind: 'write', remember: ['z'.repeat(201), 'z'.repeat(200)] }));
  assert.deepStrictEqual(long.remember, ['z'.repeat(200)], 'a fact over 200 characters is left out, not cut');
  assert.deepStrictEqual(parseChat('{"kind": "send", "notes": "not a list", "remember": {"a": 1}}').notes, []);
});

test('parseChat: `again` is true only for a new version of written or fixed text, and only when it says true', () => {
  for (const kind of ['write', 'fix']) {
    assert.strictEqual(parseChat(answerOf({ kind, text: 'Shorter.', again: true })).again, true, kind);
    assert.strictEqual(parseChat(answerOf({ kind, text: 'Shorter.', again: false })).again, false, kind);
  }
  for (const kind of ['answer', 'box', 'screen', 'send']) {
    assert.strictEqual(parseChat(answerOf({ kind, text: 'x', again: true })).again, false, kind);
  }
  for (const again of ['true', 1, 'yes', null, {}, [true]]) {
    assert.strictEqual(parseChat(answerOf({ kind: 'write', text: 'x', again })).again, false, JSON.stringify(again));
  }
  assert.strictEqual(parseChat('{"kind": "write", "text": "x"}').again, false, 'a missing `again` is false');
});

test('parseChat never throws', () => {
  for (const odd of [{}, [], 42, true, '{', '```', '{"kind": "write", "text": "\\u12"}', '{"kind":"write"} {"kind":"fix"}']) {
    assert.doesNotThrow(() => parseChat(odd), String(odd));
    assert.ok(parseChat(odd).kind);
  }
});

test('chat: their project names reach the user prompt on one line, at most 20, each cut to 100 characters', () => {
  const p = buildPrompt('chat', { message: 'fix the bug in my-app', projects: ['my-app', 'site', '', 42, null, `${'x'.repeat(120)}`] });
  assert.match(p.user, new RegExp(`Their projects on this computer: my-app, site, ${'x'.repeat(100)}\\n`));
  const many = buildPrompt('chat', { message: 'hi', projects: Array.from({ length: 25 }, (_, i) => `p${i}`) });
  assert.ok(many.user.includes('p19') && !many.user.includes('p20'), 'the first 20');
  assert.ok(!buildPrompt('chat', { message: 'hi' }).user.includes('Their projects'), 'nothing when there are none');
  assert.ok(!buildPrompt('chat', { message: 'hi', projects: 'my-app' }).user.includes('Their projects'), 'not a list: skipped');
});

test('chat: the projects come after what Buddy knows and before the chat so far', () => {
  const p = buildPrompt('chat', { message: 'go', facts: ['You work at Infosys.'], projects: ['my-app'], history: [{ from: 'you', text: 'hi' }] });
  assert.ok(p.user.indexOf('What you know about them') < p.user.indexOf('Their projects on this computer'));
  assert.ok(p.user.indexOf('Their projects on this computer') < p.user.indexOf('Chat so far'));
});

test('chat: the system prompt has the "code" kind and its rule', () => {
  const { system } = buildPrompt('chat', { message: 'hi' });
  assert.match(system, /"code"/);
  assert.match(system, /or "send" or "code"/, 'the JSON shape has it');
  assert.match(system, /- "code": a job in one of their own software projects on this computer/);
  assert.match(system, /Never "code" when no projects are listed/);
  assert.match(system, /one or two clear English sentences for a programmer/);
});

test('parseChat reads "code" with its task as the text, and never with doIt, send, notes or again', () => {
  const r = parseChat(answerOf({ kind: 'code', say: 'On it!', text: 'Fix the login bug in src/login.js.', doIt: true, send: true, notes: ['x'], again: true }));
  assert.deepStrictEqual(r, { kind: 'code', say: 'On it!', text: 'Fix the login bug in src/login.js.', notes: [], doIt: false, send: false, remember: [], again: false });
});
