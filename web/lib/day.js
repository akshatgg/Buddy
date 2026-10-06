'use strict';

/** The day a free request counts towards: the date in India (Asia/Kolkata), so "resets at midnight" is IST midnight. */

// en-CA writes dates as YYYY-MM-DD.
const FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
});

function dayKey(date) {
  return FORMAT.format(date);
}

module.exports = { dayKey };
