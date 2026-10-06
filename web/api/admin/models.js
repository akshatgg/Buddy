'use strict';

// GET /api/admin/models?provider=: the models the server's key can use (web/lib/handlers.js).
const { toVercel } = require('../../lib/vercel');
const { adminModels } = require('../../lib/handlers');

module.exports = toVercel(adminModels);
