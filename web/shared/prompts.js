'use strict';

/**
 * The prompts behind Buddy's three actions. Both routes use this module: the
 * app when it calls a provider with the user's own key, and (Phase 2) the
 * server when it calls with the owner's key. So both answer the same way, and
 * the server never has to accept a raw prompt from the app.
 */

const { BuddyError } = require('./errors');

const ACTIONS = ['write', 'fix', 'check'];
const TONES = {
  formal: 'formal and polite',
  friendly: 'warm and friendly',
  short: 'short and to the point',
};
const LIMITS = { instruction: 1000, text: 8000, imageChars: 2_800_000 };
// The longest answer either route asks for (the app with the user's key, the server with the admin's).
const MAX_TOKENS = 1024;

const BASE = [
  'You are Buddy, a writing helper for people whose English is not strong.',
  'The user may write in Hindi, Hinglish (Hindi typed in English letters), or broken English.',
  'Understand what they mean, and always answer in clear, natural English.',
].join(' ');

const SYSTEM = {
  write: (tone) => [
    BASE,
    `Write the text the user asks for (an email, a message, a reply). Tone: ${TONES[tone]}.`,
    'Return ONLY the finished text, ready to paste: no preamble such as "Here is your email", no notes, no quotation marks around it.',
    'Do not add a subject line unless the user asks for one.',
    'Never invent facts such as names, dates or numbers; write placeholders like [Name] or [Date] instead.',
  ].join('\n'),
  fix: () => [
    BASE,
    "Fix the user's text: correct grammar, spelling and word choice so it reads naturally.",
    "Keep the meaning and the person's own voice, and do not make it longer than it needs to be.",
    'If the text is in Hindi or Hinglish, translate it into natural English.',
    'Return ONLY the corrected text: no explanations, no quotation marks.',
  ].join('\n'),
  check: () => [
    BASE,
    "You are looking at a screenshot of the user's screen. Find the text the user is writing (an email, a message, a document)",
    'and check it for mistakes in grammar, spelling, tone and clarity.',
    'Reply with JSON only, no code fences, in exactly this shape:',
    '{"verdict": "good" or "problems", "problems": ["short plain description", ...], "corrected": "the full corrected text, or null if nothing needs changing"}',
    'List at most 5 problems. If nobody is writing anything in the screenshot, reply {"verdict": "good", "problems": [], "corrected": null}.',
  ].join('\n'),
};

function requireText(value, max, emptyMessage) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new BuddyError('bad_request', emptyMessage);
  if (text.length > max) {
    throw new BuddyError('bad_request', `That is too long (over ${max} characters). Try a shorter one.`);
  }
  return text;
}

/**
 * Turn an action and what the user typed into { system, user, image }.
 * Throws BuddyError('bad_request') with a message for the user when the input
 * is missing or too long.
 */
function buildPrompt(action, input = {}) {
  if (!ACTIONS.includes(action)) throw new BuddyError('bad_request', `Unknown action: ${action}`);

  if (action === 'write') {
    const instruction = requireText(input.instruction, LIMITS.instruction, 'Tell me what to write first.');
    const tone = TONES[input.tone] ? input.tone : 'formal';
    return { system: SYSTEM.write(tone), user: instruction, image: null };
  }

  if (action === 'fix') {
    const text = requireText(input.text, LIMITS.text, 'Select or paste the text to fix first.');
    return { system: SYSTEM.fix(), user: text, image: null };
  }

  const image = typeof input.image === 'string' ? input.image : '';
  if (!image) throw new BuddyError('bad_request', 'Take a screenshot first.');
  if (image.length > LIMITS.imageChars) throw new BuddyError('bad_request', 'That screenshot is too big.');
  const question = typeof input.instruction === 'string'
    ? input.instruction.trim().slice(0, LIMITS.instruction)
    : '';
  return {
    system: SYSTEM.check(),
    user: question ? `The user asks: ${question}` : 'Is my text okay?',
    image,
  };
}

/**
 * Read the Check-screen answer. Returns { verdict, problems, corrected }, or
 * { raw } with the model's text when it did not answer in the JSON shape.
 */
function parseCheck(text) {
  const raw = String(text || '').trim();
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    const j = JSON.parse(cleaned);
    if ((j.verdict === 'good' || j.verdict === 'problems') && Array.isArray(j.problems)) {
      return {
        verdict: j.verdict,
        problems: j.problems.filter((p) => typeof p === 'string').slice(0, 5),
        corrected: typeof j.corrected === 'string' && j.corrected.trim() ? j.corrected : null,
      };
    }
  } catch {
    // Not JSON: fall through to the raw text.
  }
  return { raw };
}

module.exports = { ACTIONS, TONES, LIMITS, MAX_TOKENS, buildPrompt, parseCheck };
