'use strict';

// GET /api/admin/users: the users list. POST: block or unblock one (web/lib/handlers.js).
const { toVercel } = require('../../lib/vercel');
const { adminUsers } = require('../../lib/handlers');

module.exports = toVercel(adminUsers);
