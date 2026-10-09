'use strict';

// POST /api/push: notifications on the person's phone, switched on or off (web/lib/handlers.js).
const { toVercel } = require('../lib/vercel');
const { pushRoute } = require('../lib/handlers');

module.exports = toVercel(pushRoute);
