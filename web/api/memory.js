'use strict';

// POST /api/memory: what Buddy knows about the person, the same on all their devices (web/lib/handlers.js).
const { toVercel } = require('../lib/vercel');
const { memoryRoute } = require('../lib/handlers');

module.exports = toVercel(memoryRoute);
