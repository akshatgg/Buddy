'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  heardWords, heardAnswer, wantsServer, answerGrammar, spokenQuestion, spokenLines, asksBack, unlockLine, callingLine, VOICE_LINES,
  wakePhrase, wakeMissing, wakePhrases, wakeNameHeard, wakeFrom, WAKE_FLOOR, REQUEST, WAKE_LINES,
} = require('../shared/voice-words');

test('a yes word, or the card\'s own verb, is yes; any no word wins; nothing decisive is no', () => {
  for (const said of ['yes', 'Yes!', 'yeah send it', 'Haan.', 'okay', 'OK', 'send']) assert.strictEqual(heardAnswer(said, 'send'), 'yes', said);
  for (const said of ['call', 'yes call']) assert.strictEqual(heardAnswer(said, 'call'), 'yes', said);
  for (const said of ['no', 'Nahi.', 'nahin', 'na', 'cancel', "don't", 'Don’t send it', 'stop', 'yes no', 'no, send it']) {
    assert.strictEqual(heardAnswer(said, 'send'), 'no', said);
  }
  for (const said of ['', '[unk]', 'maybe', 'what', 'call', 'later']) assert.strictEqual(heardAnswer(said, 'send'), 'no', said);
  assert.strictEqual(heardAnswer('send', 'call'), 'no', 'a message\'s verb is not a yes for a call');
  assert.strictEqual(heardAnswer('call', 'send'), 'no');
});

test('laughter is no: "ha" is not a yes word, "haan" still is', () => {
  for (const said of ['ha', 'ha ha', 'ha ha ha', 'ha send it']) assert.strictEqual(heardAnswer(said, 'send'), 'no', said);
  assert.strictEqual(heardAnswer('haan', 'send'), 'yes');
  assert.ok(!answerGrammar('send', null).grammar.includes('ha'));
});

test('a yes next to a word not made out, or any missing grammar word, goes to the server, never to a no on the device', () => {
  for (const [said, verb, missing, wants] of [
    ['yes [unk]', 'send', false, true], ['haan <unk>', 'send', false, true], ['[unk] send', 'send', false, true], ['[unk] call', 'call', false, true],
    ['[unk] call', 'send', false, false], ['no [unk]', 'send', true, false], ['yes no [unk]', 'send', false, false],
    ['[unk]', 'send', true, false], ['[unk] it', 'send', false, false], ['[unk] it', 'send', true, true], ['yes', 'send', true, false],
    ['', 'send', true, false], ['yes banana', 'send', false, false],
  ]) assert.strictEqual(wantsServer(said, verb, missing), wants, `${said} / ${verb} / missing ${missing}`);
});

test('a yes is only words that all mean yes: a negation or any other word is no', () => {
  for (const said of ['do not send it', 'do not call', 'Okay, not now', 'not okay', 'haan mat bhejo', 'nope, send', 'wait, send it',
    'never mind okay', 'yes no', 'not yet', 'haan nahi', 'no problem', 'okay don\'t', 'abhi nahi', 'maybe later', 'nah', 'nope',
    'mat bhejo', 'bhej mat', 'nahi bhejo', 'abhi mat bhejo']) {
    assert.strictEqual(heardAnswer(said, 'send'), 'no', said);
  }
  for (const said of ['yes', 'yes send it', 'haan', 'haan ji', 'okay send it please', 'yes send now',
    'haan bhej do', 'bhej do', 'haan ji bhejo', 'Bhejdo', 'bhejna', 'bhejiye', 'haan, bhej do.']) assert.strictEqual(heardAnswer(said, 'send'), 'yes', said);
  for (const said of ['haan bhej do', 'bhej do', 'haan ji bhejo', 'kar do', 'karo']) assert.strictEqual(heardAnswer(said, 'call'), 'no', said);
  for (const said of ['call karo', 'haan call kar do', 'haan kar do']) assert.strictEqual(heardAnswer(said, 'call'), 'yes', said);
  for (const said of ['call', 'yes call now', 'haan ji call kar do']) assert.strictEqual(heardAnswer(said, 'call'), 'yes', said);
  assert.strictEqual(heardWords('please', 'send'), null);
});

test('a word Buddy could not make out ([unk]) is never a yes', () => {
  for (const said of ['[unk] bhejo', '[unk] send it', 'yes [unk]', 'haan [unk]', '[unk]', '<unk> yes', 'YES [UNK]', 'unk bhej do', 'haan <unk> ji']) {
    assert.strictEqual(heardAnswer(said, 'send'), 'no', said);
  }
  assert.strictEqual(heardWords('yes [unk]', 'send'), 'no');
  for (const said of ['yes', 'haan', 'send it', 'bhej do']) assert.strictEqual(heardAnswer(said, 'send'), 'yes', said);
});

test('heardWords tells "nothing decisive yet" (null) from a no', () => {
  assert.strictEqual(heardWords('[unk] [unk]', 'send'), null);
  assert.strictEqual(heardWords('', 'call'), null);
  assert.strictEqual(heardWords('hmm', 'call'), 'no');
  assert.strictEqual(heardWords('nahi', 'call'), 'no');
  assert.strictEqual(heardWords('haan', 'call'), 'yes');
});

test('the grammar keeps the words the model knows, then [unk], and says which it lacks', () => {
  assert.deepStrictEqual(answerGrammar('send', null).grammar,
    ['yes', 'yeah', 'haan', 'okay', 'send', 'bhej', 'bhejo', 'bhejdo', 'bhejna', 'bhejiye', 'it', 'please', 'ji', 'de', 'no', 'nahi', 'na', 'cancel', "don't", 'stop', 'not', 'mat', 'nope', 'nah', 'wait', '[unk]']);
  const known = new Set(['yes', 'yeah', 'okay', 'call', 'no', 'cancel', "don't", 'stop']);
  assert.deepStrictEqual(answerGrammar('call', known), {
    grammar: ['yes', 'yeah', 'okay', 'call', 'no', 'cancel', "don't", 'stop', '[unk]'],
    missing: ['haan', 'it', 'please', 'ji', 'de', 'nahi', 'na', 'not', 'mat', 'nope', 'nah', 'wait'],
  });
});

test('the card is asked out loud as the spec says', () => {
  assert.strictEqual(spokenQuestion({ kind: 'message', name: 'Priya Sharma', text: "I'm running late" }), "To Priya Sharma: I'm running late. Send it?");
  assert.strictEqual(spokenQuestion({ kind: 'message', name: 'Priya Sharma', text: 'Where are you? ' }), 'To Priya Sharma: Where are you? Send it?');
  assert.strictEqual(spokenQuestion({ kind: 'message', name: 'Priya Sharma', text: '  ' }), 'To Priya Sharma. Send it?');
  assert.strictEqual(spokenQuestion({ kind: 'call', name: 'Prince Narasimhan', how: 'phone' }), 'Call Prince Narasimhan?');
  assert.strictEqual(spokenQuestion({ kind: 'call', name: 'Prince Sharma', how: 'whatsapp' }), 'WhatsApp call Prince Sharma?');
  assert.strictEqual(spokenQuestion({ kind: 'call', name: 'Prince Sharma', how: 'whatsapp_video' }), 'WhatsApp video call Prince Sharma?');
});

test('what is said around a card: say, a short line of Buddy\'s own, red lines, done lines', () => {
  const long = 'x'.repeat(241);
  assert.deepStrictEqual(spokenLines([
    { type: 'you', text: 'message priya' },
    { type: 'buddy', say: 'Okay!', text: long },
    { type: 'buddy', say: '', text: 'Which Priya: Priya Sharma or Priya Verma? Tell me the full name.' },
    { type: 'buddy', say: '', text: long },
    { type: 'event', text: '✅ Opened YouTube' },
    { type: 'event', text: '📖 Read your text' },
    { type: 'error', text: 'No internet.', code: 'network' },
    { type: 'error', text: 'Buddy took too long to answer. Try again.', code: 'timeout' },
    { type: 'error', text: 'Sign in to use Buddy.', code: 'signed_out' },
    { type: 'question', text: 'To Priya Sharma: hi' },
  ]), [
    'Okay!',
    'Which Priya: Priya Sharma or Priya Verma? Tell me the full name.',
    'Opened YouTube',
    VOICE_LINES.noInternet,
    VOICE_LINES.noInternet,
    'Sign in to use Buddy.',
  ]);
});

test('a line asks back when it has a question, or asks for the full name', () => {
  assert.strictEqual(asksBack('Who should I send it to?'), true);
  assert.strictEqual(asksBack('Which Priya: Priya Sharma or Priya Verma? Tell me the full name.'), true);
  assert.strictEqual(asksBack('I found lots of people called a. Tell me the full name.'), true);
  assert.strictEqual(asksBack("I couldn't find Zoya in your contacts."), false);
});

test('the locked lines', () => {
  assert.strictEqual(unlockLine('phone', 'message', 'Priya Sharma'), "Unlock your phone and I'll send it to Priya Sharma.");
  assert.strictEqual(unlockLine('Mac', 'message', 'Priya Sharma'), "Unlock your Mac and I'll send it.");
  assert.strictEqual(unlockLine('phone', 'call', 'Prince Sharma'), "Unlock your phone and I'll call Prince Sharma.");
  assert.strictEqual(unlockLine('Mac', 'call', 'Prince Sharma'), "Unlock your Mac and I'll call Prince Sharma.");
  assert.strictEqual(callingLine('Prince Sharma'), 'Calling Prince Sharma.');
});

test('the wake phrase is "hey" and the name, plain, at most three words', () => {
  assert.strictEqual(wakePhrase('Rahul'), 'hey rahul');
  assert.strictEqual(wakePhrase('  Mr.  Rahul  Kumar Singh '), 'hey mr rahul kumar');
  assert.strictEqual(wakePhrase('Zoë'), 'hey zoe');
  assert.strictEqual(wakePhrase('123'), null);
});

test('the name words the model can\'t hear', () => {
  const lacks = ['aarav', 'priya'];
  assert.deepStrictEqual(wakeMissing('Aarav', lacks), ['aarav']);
  assert.deepStrictEqual(wakeMissing('Anaya', lacks), []);
  assert.deepStrictEqual(wakeMissing('Rahul', lacks), []);
  assert.deepStrictEqual(wakeMissing('R2D2', lacks), ['r2d2']);
  assert.deepStrictEqual(wakeMissing('123', lacks), ['123']);
  assert.deepStrictEqual(wakeMissing('Aarav Priya', lacks), ['aarav', 'priya']);
  assert.deepStrictEqual(wakeMissing('Aarav'), ['aarav'], 'the shared list by default');
  assert.deepStrictEqual(wakeMissing('Rahul'), []);
});

test('the phrases that wake Buddy: "hey <name>" (when it can be heard), then "hey buddy"; never a bare name', () => {
  const lacks = ['aarav', 'priya'];
  assert.deepStrictEqual(wakePhrases('Rahul', lacks), ['hey rahul', 'hey buddy']);
  assert.deepStrictEqual(wakePhrases('Aarav', lacks), ['hey buddy']);
  assert.deepStrictEqual(wakePhrases('Aarav'), ['hey buddy'], 'the shared list by default');
  assert.deepStrictEqual(wakePhrases('Buddy', lacks), ['hey buddy']);
  assert.deepStrictEqual(wakePhrases('Max Power', lacks), ['hey max power', 'hey buddy']);
  assert.deepStrictEqual(wakePhrases('', lacks), ['hey buddy']);
  assert.deepStrictEqual(wakePhrases('Hey', lacks), ['hey buddy']);
  assert.deepStrictEqual(wakePhrases('Hey Buddy', lacks), ['hey buddy']);
  assert.deepStrictEqual(wakePhrases('Hey Rahul', lacks), ['hey rahul', 'hey buddy']);
  assert.strictEqual(wakeNameHeard('Hey Buddy', lacks), false);
  assert.strictEqual(WAKE_LINES.label('Hey Rahul', true), 'Listen for "Hey Buddy" or "Hey Rahul"');
  assert.deepStrictEqual(wakePhrases('123', lacks), ['hey buddy']);
  assert.strictEqual(wakeNameHeard('Rahul', lacks), true);
  assert.strictEqual(wakeNameHeard('Aarav', lacks), false);
  assert.strictEqual(wakeNameHeard('Buddy', lacks), false);
});

test('a wake is a phrase as the first words, each sure enough; what follows is the request', () => {
  const w = (word, conf, start, end) => ({ word, conf, start, end });
  const said = (...words) => ({ text: words.map((x) => x.word).join(' '), result: words });
  const P = ['hey rahul', 'hey buddy'];
  assert.deepStrictEqual(wakeFrom(said(w('hey', 0.9, 1, 1.2), w('rahul', 0.8, 1.2, 1.6)), P, 0.6), { endSec: 1.6, follows: false, phrase: 'hey rahul' });
  assert.deepStrictEqual(wakeFrom(said(w('hey', 0.9, 1, 1.2), w('rahul', 0.8, 1.2, 1.6), w('[unk]', 1, 1.7, 2.5)), 'hey rahul', 0.6), { endSec: 1.6, follows: true, phrase: 'hey rahul' }, 'one string still works');
  assert.deepStrictEqual(wakeFrom(said(w('hey', 0.9, 1, 1.2), w('rahul', 0.9, 1.2, 1.6), w('call', 0.9, 1.7, 2), w('mom', 0.9, 2, 2.3)), P, 0.6),
    { endSec: 1.6, follows: true, phrase: 'hey rahul' }, 'what follows "hey rahul" is the request');
  assert.deepStrictEqual(wakeFrom(said(w('hey', 0.9, 1, 1.2), w('buddy', 0.9, 1.2, 1.5), w('what', 0.9, 1.6, 1.8)), P, 0.6), { endSec: 1.5, follows: true, phrase: 'hey buddy' });
  assert.strictEqual(wakeFrom(said(w('buddy', 0.9, 0, 0.4)), P, 0.6), null, 'a bare "buddy" does not wake');
  assert.strictEqual(wakeFrom(said(w('rahul', 0.9, 0, 0.4), w('call', 0.9, 0.5, 0.8)), P, 0.6), null, 'a bare name does not wake');
  assert.deepStrictEqual(wakeFrom(said(w('hey', 0.9, 0, 0.2), w('rahul', 0.9, 0.2, 0.5), w('call', 0.9, 0.6, 0.8), w('mom', 0.9, 0.8, 1)), P, 0.6), { endSec: 0.5, follows: true, phrase: 'hey rahul' });
  assert.strictEqual(wakeFrom(said(w('[unk]', 1, 0, 1), w('hey', 0.9, 1, 1.2), w('rahul', 0.9, 1.2, 1.6)), P, 0.6), null, 'the name in the middle of talk');
  assert.strictEqual(wakeFrom(said(w('[unk]', 1, 0, 1), w('buddy', 0.9, 1, 1.4)), P, 0.6), null, 'must start with a phrase');
  assert.strictEqual(wakeFrom(said(w('rahul', 0.9, 0, 0.4)), ['hey rahul'], 0.6), null, '"Hey" is required by that phrase');
  assert.strictEqual(wakeFrom(said(w('hey', 0.5, 1, 1.2), w('rahul', 0.9, 1.2, 1.6)), P, 0.6), null, 'not sure enough');
  assert.strictEqual(wakeFrom(said(w('buddy', 0.5, 0, 0.4)), P, 0.6), null, 'a low-confidence word');
  assert.strictEqual(wakeFrom({ text: '', result: [] }, P, 0.6), null);
  assert.strictEqual(wakeFrom(null, P, 0.6), null);
});

test('the wake numbers and lines', () => {
  assert.strictEqual(WAKE_FLOOR, 0.6);
  assert.deepStrictEqual(REQUEST, { quietMs: 1200, nothingMs: 8000, maxMs: 20000 });
  assert.strictEqual(WAKE_LINES.cantListen('Aarav'), `Buddy can't hear 'Aarav'. Say "Hey Buddy" instead, or try another spelling.`);
  assert.strictEqual(WAKE_LINES.notCaught('Rahul', true), `I didn't catch that. Say 'Hey Buddy' or 'Hey Rahul' and try again.`);
  assert.strictEqual(WAKE_LINES.notCaught('Aarav', false), `I didn't catch that. Say 'Hey Buddy' and try again.`);
  assert.strictEqual(WAKE_LINES.sayNow('Rahul', true), 'Say "Hey Buddy" or "Hey Rahul" now.');
  assert.strictEqual(WAKE_LINES.sayNow('Aarav', false), 'Say "Hey Buddy" now.');
  assert.strictEqual(WAKE_LINES.heard, 'Heard you ✓');
  assert.strictEqual(WAKE_LINES.notHeard('Rahul', true), 'I didn\'t hear "Hey Buddy" or "Hey Rahul". Try again.');
  assert.strictEqual(WAKE_LINES.notHeard('Aarav', false), 'I didn\'t hear "Hey Buddy". Try again.');
  assert.strictEqual(WAKE_LINES.privacy('Rahul', true), "Your microphone stays on. Nothing leaves this device until you say 'Hey Buddy' or 'Hey Rahul'.");
  assert.strictEqual(WAKE_LINES.privacy('Aarav', false), "Your microphone stays on. Nothing leaves this device until you say 'Hey Buddy'.");
  assert.strictEqual(WAKE_LINES.label('Rahul', true), 'Listen for "Hey Buddy" or "Hey Rahul"');
  assert.strictEqual(WAKE_LINES.label('Buddy', false), 'Listen for "Hey Buddy"');
  assert.strictEqual(WAKE_LINES.tapToListen, 'Tap me to listen again');
  assert.strictEqual(WAKE_LINES.listening('Rahul', true), 'Listening for "Hey Buddy" or "Hey Rahul"');
  assert.strictEqual(WAKE_LINES.listening('Aarav', false), 'Listening for "Hey Buddy"');
  assert.strictEqual(WAKE_LINES.gettingEars, "Getting Buddy's ears ready (36 MB)…");
  assert.strictEqual(WAKE_LINES.earsFailed, "Couldn't get Buddy's ears ready. Check the internet and try again.");
  assert.strictEqual(WAKE_LINES.signIn, 'Sign in to talk to Buddy.');
});
