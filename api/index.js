const db = require('../db');
const app = require('../server');

// Vercel serverless: garante schema+seed antes de atender
module.exports = async (req, res) => {
  await db.ready;
  return app(req, res);
};
