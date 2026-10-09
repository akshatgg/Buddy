'use strict';

// GET and POST /api/remote/phone: the phone watches a Claude Code session on the person's computer, and sends it words.
const { toVercel } = require('../../lib/vercel');
const { remotePhone } = require('../../lib/handlers');

module.exports = toVercel(remotePhone);
