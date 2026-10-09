'use strict';

/**
 * Buddy where you type: the person writes in any app and ends with a tag, "@buddy" (or their buddy's own name, "@aarav")
 * and what to do: "@buddy fix", "@buddy formal", "@buddy translate to Hindi", or the tag alone (fix). Buddy then puts
 * the finished text in place of what they wrote. These are the plain rules, the same on the Mac, on Windows (the app
 * reads the paragraph the tag is in) and on Android (its Kotlin port reads the whole field).
 *
 * findTag(text, names) finds the last tag. splitAtTag(text, names) cuts the text around it: `target` is what gets
 * rewritten (the paragraph the tag ends, or with "all" everything before it), `prefix` and `suffix` are left as they
 * are, and `instruction` is what came after the tag on its line ('' for none).
 */

const INSTRUCTION_MAX = 200;
const DEFAULT_NAMES = ['buddy'];

/** The tag's names, as the person may type them: "buddy", and their buddy's name if it is one word of letters. */
function tagNames(buddyName) {
  const name = typeof buddyName === 'string' ? buddyName.trim().toLowerCase() : '';
  return /^[\p{L}\p{N}_]{2,24}$/u.test(name) && name !== 'buddy' ? ['buddy', name] : DEFAULT_NAMES;
}

const escape = (word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The last tag in `text`: { start, end, instruction }, where end is the end of its line; null when there is none. */
function findTag(text, names = DEFAULT_NAMES) {
  if (typeof text !== 'string' || !text) return null;
  const pattern = new RegExp(`(^|[^\\p{L}\\p{N}_@])@(${names.map(escape).join('|')})(?![\\p{L}\\p{N}_])[ \\t]*([^\\n]*)`, 'giu');
  let found = null;
  for (const m of text.matchAll(pattern)) found = m;
  if (!found) return null;
  const start = found.index + found[1].length;
  return { start, end: found.index + found[0].length, instruction: found[3].trim().slice(0, INSTRUCTION_MAX) };
}

/**
 * The text cut around its last tag: { prefix, target, instruction, suffix }, so that prefix + the new text + suffix is
 * what goes back. null when there is no tag, or nothing before it to rewrite.
 */
function splitAtTag(text, names = DEFAULT_NAMES) {
  const tag = findTag(text, names);
  if (!tag) return null;
  const before = text.slice(0, tag.start);
  const all = /^all\b/i.test(tag.instruction);
  const from = all ? 0 : before.lastIndexOf('\n') + 1;
  const target = before.slice(from).trimEnd();
  if (!target.trim()) return null;
  const instruction = all ? tag.instruction.replace(/^all\b[\s,:-]*/i, '') : tag.instruction;
  // What came after the tag's line stays; the space the tag left at the end of the paragraph goes.
  return { prefix: text.slice(0, from), target, instruction, suffix: text.slice(tag.end) };
}

/** The AI's answer as the text that goes back: trimmed, without a code fence or quotes around the whole of it. */
function cleanAnswer(answer) {
  let text = typeof answer === 'string' ? answer.trim() : '';
  const fenced = /^```[^\n]*\n([\s\S]*?)\n```$/.exec(text);
  if (fenced) text = fenced[1].trim();
  if (text.length > 1 && /^["“]/.test(text) && /["”]$/.test(text) && !/["“”]/.test(text.slice(1, -1))) text = text.slice(1, -1).trim();
  return text;
}

module.exports = { INSTRUCTION_MAX, tagNames, findTag, splitAtTag, cleanAnswer };
