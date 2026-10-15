'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  heardWords, heardAnswer, answerGrammar, spokenQuestion, spokenLines, asksBack, unlockLine, callingLine, VOICE_LINES,
} = require('../shared/voice-words');

test('a yes word, or the card\'s own verb, is yes; any no word wins; nothing decisive is no', () => {
  for (const said of ['yes', 'Yes!', 'yeah send it', 'Haan.', 'ha', 'okay', 'OK', 'send']) assert.strictEqual(heardAnswer(said, 'send'), 'yes', said);
  for (const said of ['call', 'yes call']) assert.strictEqual(heardAnswer(said, 'call'), 'yes', said);
  for (const said of ['no', 'Nahi.', 'nahin', 'na', 'cancel', "don't", 'Don’t send it', 'stop', 'yes no', 'no, send it']) {
    assert.strictEqual(heardAnswer(said, 'send'), 'no', said);
  }
  for (const said of ['', '[unk]', 'maybe', 'what', 'call', 'later']) assert.strictEqual(heardAnswer(said, 'send'), 'no', said);
  assert.strictEqual(heardAnswer('send', 'call'), 'no', 'a message\'s verb is not a yes for a call');
  assert.strictEqual(heardAnswer('call', 'send'), 'no');
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
    ['yes', 'yeah', 'haan', 'ha', 'okay', 'send', 'bhej', 'bhejo', 'bhejdo', 'bhejna', 'bhejiye', 'no', 'nahi', 'na', 'cancel', "don't", 'stop', 'not', 'mat', 'nope', 'nah', 'wait', '[unk]']);
  const known = new Set(['yes', 'yeah', 'okay', 'call', 'no', 'cancel', "don't", 'stop']);
  assert.deepStrictEqual(answerGrammar('call', known), {
    grammar: ['yes', 'yeah', 'okay', 'call', 'no', 'cancel', "don't", 'stop', '[unk]'],
    missing: ['haan', 'ha', 'nahi', 'na', 'not', 'mat', 'nope', 'nah', 'wait'],
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
