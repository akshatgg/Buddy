'use strict';

// GET /api/config: what free mode means for the signed-in person (web/lib/handlers.js).
const { toVercel } = require('../lib/vercel');
const { config } = require('../lib/handlers');

module.exports = toVercel(config);
