'use strict';

/** A handler (web/lib/handlers.js) as a Vercel function: (req, res) with Vercel's helpers. */

const { handle } = require('./handlers');

const SERVER_PROBLEM = { error: { code: 'server', message: "Buddy's server had a problem. Try again." } };

function toVercel(handler, makeDeps = () => require('./deps').realDeps()) {
  return async function vercelFunction(req, res) {
    let body;
    try {
      body = req.body; // Vercel parses a JSON body when it is first read, and throws for JSON that is not valid
    } catch {
      body = undefined;
    }
    let out;
    try {
      out = await handle(handler, { method: req.method, headers: req.headers, body, query: req.query }, makeDeps());
    } catch (err) {
      console.error(`[api] could not start: ${err?.message}`);
      out = { status: 500, body: SERVER_PROBLEM };
    }
    res.setHeader('Cache-Control', 'no-store');
    res.status(out.status).json(out.body);
  };
}

module.exports = { toVercel };
