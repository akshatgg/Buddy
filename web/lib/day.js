'use strict';

/** The day a free request counts towards: the date in India (Asia/Kolkata), so "resets at midnight" is IST midnight. */

const FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
});

// Put together from the date's parts, not read off the formatter's text: the order and the separators a locale
// writes a date with are its own business (en-CA happens to give YYYY-MM-DD), while the parts are always these three.
function dayKey(date) {
  const parts = Object.fromEntries(FORMAT.formatToParts(date).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

module.exports = { dayKey };
