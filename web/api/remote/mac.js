'use strict';

// POST /api/remote/mac: the person's computer shares its Claude Code sessions with their phone (web/lib/handlers.js).
const { toVercel } = require('../../lib/vercel');
const { remoteMac } = require('../../lib/handlers');

module.exports = toVercel(remoteMac);
