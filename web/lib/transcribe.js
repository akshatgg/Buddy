'use strict';

/**
 * Writing down what was said: one recording from a Buddy app, sent to Whisper on Groq with the server's Groq key, and
 * the words that come back. The recording passes through and is forgotten: nothing here keeps it or logs it.
 *
 * A failure of Groq's is an Error whose `code` says its kind, and nothing else (Groq's answers and the fetch's own
 * errors can quote what it was sent), so the handler can log it:
 *   rate_limited   Groq's limit for the key was reached (its 429)
 *   http_<status>  any other answer that is not a success
 *   bad_answer     a success with no text in it
 *   timeout        no answer within TIMEOUT_MS
 *   network        Groq could not be reached
 */

const { BuddyError } = require('../shared/errors');

const GROQ_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const MODEL = 'whisper-large-v3-turbo';
const TIMEOUT_MS = 30_000;
// Whisper reads its prompt as words said just before the recording. A line in Hinglish and English helps it write
// Hinglish back in English letters, the way people type it, rather than in Devanagari. It has no language setting:
// Hindi, English and Hinglish are recognised by themselves.
const PROMPT = 'Namaste. Kal mujhe chutti chahiye. Please write a mail to my boss.';
// About 2 MB of recording, as base64 (the app stops recording at 2 MB).
const AUDIO_MAX_CHARS = 2_800_000;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
// The kinds of recording the apps send, by their base type, with the file name Groq tells each one by.
const FILE_NAMES = { 'audio/webm': 'speech.webm', 'audio/ogg': 'speech.ogg', 'audio/mp4': 'speech.mp4', 'audio/wav': 'speech.wav' };
const AUDIO_TYPES = ['audio/webm', 'audio/webm;codecs=opus', 'audio/ogg', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/wav'];

const failure = (code) => Object.assign(new Error(`Groq could not write it down: ${code}`), { code });
const baseType = (mime) => mime.split(';')[0];

/**
 * The recording in a request body: { audio: bytes, mime }. One that is missing, too long, not base64, empty, or of a
 * kind Groq does not take is refused in plain words.
 */
function readRecording(body) {
  const { audio, mime } = body;
  const fine = typeof audio === 'string' && audio.length <= AUDIO_MAX_CHARS && BASE64.test(audio) && AUDIO_TYPES.includes(mime);
  const bytes = fine ? Buffer.from(audio, 'base64') : null;
  if (!bytes?.length) throw new BuddyError('bad_request', "That recording didn't come through. Try again.");
  return { audio: bytes, mime };
}

/** What was said in `audio` (bytes of kind `mime`), trimmed: '' when Whisper heard no words. */
async function transcribeWithGroq({ apiKey, audio, mime, fetchImpl = fetch, signal = AbortSignal.timeout(TIMEOUT_MS) }) {
  const type = baseType(mime);
  const form = new FormData();
  form.append('file', new Blob([audio], { type }), FILE_NAMES[type]);
  form.append('model', MODEL);
  form.append('response_format', 'json');
  form.append('temperature', '0');
  form.append('prompt', PROMPT);
  let res;
  try {
    // No content type here: fetch writes the form's own, with the boundary between its fields.
    res = await fetchImpl(GROQ_URL, { method: 'POST', headers: { authorization: `Bearer ${apiKey}` }, body: form, signal });
  } catch (err) {
    throw failure(err?.name === 'TimeoutError' ? 'timeout' : 'network');
  }
  if (res.status === 429) throw failure('rate_limited');
  if (!res.ok) throw failure(`http_${res.status}`);
  let j;
  try {
    j = await res.json(); // the deadline covers reading the answer too
  } catch (err) {
    throw failure(err?.name === 'TimeoutError' ? 'timeout' : 'bad_answer');
  }
  if (typeof j?.text !== 'string') throw failure('bad_answer');
  return j.text.trim();
}

module.exports = { transcribeWithGroq, readRecording, GROQ_URL, PROMPT, TIMEOUT_MS, AUDIO_MAX_CHARS };
