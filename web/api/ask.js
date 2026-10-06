'use strict';

// POST /api/ask: one free answer with the admin's key (web/lib/handlers.js).
const { toVercel } = require('../lib/vercel');
const { ask } = require('../lib/handlers');

module.exports = toVercel(ask);
