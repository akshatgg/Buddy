'use strict';

/**
 * Which voice Buddy speaks with. The ear page lists the voices macOS has ([{ name, lang }]); the best English one is
 * Buddy's "Automatic" voice. Pure: the ranking is all here, so it is tested without a window.
 */

// Novelty voices, never picked on their own (compared case-insensitively, by the part of the name before " (").
const NOVELTY = new Set([
  'albert', 'bad news', 'bahh', 'bells', 'boing', 'bubbles', 'cellos', 'good news', 'jester', 'organ', 'superstar', 'trinoids',
  'whisper', 'wobble', 'zarvox', 'fred', 'junior', 'ralph', 'kathy', 'grandma', 'grandpa', 'eddy', 'flo', 'reed', 'rocko',
  'sandy', 'shelley',
]);
const LANGUAGES = ['en-in', 'en-us', 'en-gb']; // in this order, then any other English
const REGIONS = { IN: 'India', US: 'US', GB: 'UK', AU: 'Australia', ZA: 'South Africa', IE: 'Ireland' };

const shortName = (name) => String(name).split(' (')[0].trim();
const tag = (lang) => String(lang || '').toLowerCase().replace(/_/g, '-');
const isEnglish = (voice) => /^en(-|$)/.test(tag(voice.lang));
const isNovelty = (voice) => NOVELTY.has(shortName(voice.name).toLowerCase());

function languageRank(voice) {
  const i = LANGUAGES.indexOf(tag(voice.lang));
  return i === -1 ? LANGUAGES.length : i;
}

function qualityRank(voice) {
  const name = String(voice.name).toLowerCase();
  if (name.includes('(premium)')) return 0;
  if (name.includes('(enhanced)')) return 1;
  return 2;
}

/** The English voices worth using, best first (language, then quality; the order given breaks a tie). */
function rankVoices(voices) {
  const seen = new Set();
  const usable = (Array.isArray(voices) ? voices : []).filter((voice) => {
    if (!voice || typeof voice.name !== 'string' || !voice.name || seen.has(voice.name)) return false;
    seen.add(voice.name);
    return isEnglish(voice) && !isNovelty(voice);
  });
  return usable
    .map((voice, i) => ({ voice, i }))
    .sort((a, b) => languageRank(a.voice) - languageRank(b.voice) || qualityRank(a.voice) - qualityRank(b.voice) || a.i - b.i)
    .map((x) => x.voice);
}

/** The name of the best voice, or null when there is none. */
function bestVoice(voices) {
  return rankVoices(voices)[0]?.name ?? null;
}

/** The voice to speak with: the one chosen if the device still has it, else the best. */
function chooseVoice(voices, chosen) {
  const ranked = rankVoices(voices);
  return ranked.find((voice) => voice.name === chosen)?.name ?? ranked[0]?.name ?? null;
}

/** "Rishi (India)", "Ava (Premium, US)". */
function voiceLabel(voice) {
  const quality = /\((premium|enhanced)\)/i.exec(voice.name);
  const code = tag(voice.lang).split('-')[1]?.toUpperCase();
  const region = code ? REGIONS[code] || code : '';
  const inside = [quality ? quality[1][0].toUpperCase() + quality[1].slice(1).toLowerCase() : '', region].filter(Boolean);
  return inside.length ? `${shortName(voice.name)} (${inside.join(', ')})` : shortName(voice.name);
}

module.exports = { rankVoices, bestVoice, chooseVoice, voiceLabel, shortName };
