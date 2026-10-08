'use strict';

// POST /api/transcribe: what was said in a recording, written down by Whisper on Groq (web/lib/handlers.js).
const { toVercel } = require('../lib/vercel');
const { transcribe } = require('../lib/handlers');

module.exports = toVercel(transcribe);
