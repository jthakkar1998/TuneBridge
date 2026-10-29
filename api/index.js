'use strict';
// All TuneBridge API routes are handled by one Vercel Function.
// The vercel.json rewrite passes the original API path in ?route=...
// while preserving the original request method and query parameters.
module.exports = require('../server').handler;
