'use strict';

// GET and PUT /api/admin/settings: the admin's switches (web/lib/handlers.js).
const { toVercel } = require('../../lib/vercel');
const { adminSettings } = require('../../lib/handlers');

module.exports = toVercel(adminSettings);
