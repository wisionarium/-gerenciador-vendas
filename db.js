/**
 * Camada de banco dual-mode:
 * - LOCAL (padrão): node:sqlite em ./data.db — ideal p/ rodar no PC.
 * - REMOTO (Vercel): Turso via @libsql/client quando TURSO_URL + TURSO_AUTH_TOKEN existirem.
 *
 * Interface única e assíncrona: all / get / run / ready / creditForParticipants
 */
const path = require('path');

const TURSO_URL = process.env.TURSO_URL || '';
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN || '';
const isRemote = !!(TURSO_URL && TURSO_TOKEN);

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin','seller')) DEFAULT 'seller',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS call_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    seller_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0 AND quantity <= 2000),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_calls_seller_date ON call_records(seller_id, date)`,
  `CREATE TABLE IF NOT EXISTS sales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_name TEXT NOT NULL,
    product TEXT NOT NULL,
    color TEXT NOT NULL,
    channel TEXT NOT NULL CHECK (channel IN ('WhatsApp','CRM')),
    created_by INTEGER NOT NULL REFERENCES users(id),
    sale_date TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(sale_date)`,
  `CREATE TABLE IF NOT EXISTS sale_participants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    seller_id INTEGER NOT NULL REFERENCES users(id),
    credit REAL NOT NULL CHECK (credit IN (0.5, 1.0)),
    UNIQUE (sale_id, seller_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_part_seller ON sale_participants(seller_id)`,
  `CREATE INDEX IF NOT EXISTS idx_part_sale ON sale_participants(sale_id)`,
];

let all;
let get;
let run;

if (isRemote) {
  // cliente HTTP puro (sem binário nativo): funciona no PC e na Vercel
  const { createClient } = require('@libsql/client/http');
  const httpUrl = TURSO_URL.replace(/^libsql:\/\//, 'https://');
  const client = createClient({ url: httpUrl, authToken: TURSO_TOKEN });

  const toObjects = (rs) => {
    if (!rs.rows.length) return [];
    if (!Array.isArray(rs.rows[0])) return rs.rows;
    const cols = rs.columns;
    return rs.rows.map((r) => Object.fromEntries(r.map((v, i) => [cols[i], v])));
  };

  all = async (sql, ...params) => toObjects(await client.execute({ sql, args: params }));
  get = async (sql, ...params) => (await all(sql, ...params))[0];
  run = async (sql, ...params) => {
    const rs = await client.execute({ sql, args: params });
    return { lastInsertRowid: Number(rs.lastInsertRowid ?? 0) };
  };
  console.log('[db] Modo remoto: Turso');
} else {
  const { DatabaseSync } = require('node:sqlite');
  const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data.db');
  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA foreign_keys = ON');

  all = async (sql, ...params) => db.prepare(sql).all(...params);
  get = async (sql, ...params) => db.prepare(sql).get(...params);
  run = async (sql, ...params) => {
    const r = db.prepare(sql).run(...params);
    return { lastInsertRowid: Number(r.lastInsertRowid) };
  };
  console.log('[db] Modo local: ' + DB_PATH);
}

// ---- Regra central de crédito (FUNDAMENTAL) ----
function creditForParticipants(count) {
  if (count === 1) return 1.0;
  if (count === 2 || count === 3) return 0.5;
  throw new Error('Venda deve ter de 1 a 3 participantes.');
}

const bcrypt = require('bcryptjs');

const ready = (async () => {
  for (const sql of SCHEMA) await run(sql);
  const row = await get('SELECT COUNT(*) AS c FROM users');
  if (Number(row.c) === 0) {
    console.log('[db] Seed inicial...');
    const mk = (pw) => bcrypt.hashSync(pw, 10);
    // ON CONFLICT: dois cold starts simultâneos na Vercel não geram erro 500
    await run('INSERT INTO users (name, email, password_hash, role, active) VALUES (?,?,?,?,1) ON CONFLICT(email) DO NOTHING',
      'Administrador', 'admin@equipe.com', mk('admin123'), 'admin');
    await run('INSERT INTO users (name, email, password_hash, role, active) VALUES (?,?,?,?,1) ON CONFLICT(email) DO NOTHING',
      'Ana', 'ana@equipe.com', mk('ana123'), 'seller');
    await run('INSERT INTO users (name, email, password_hash, role, active) VALUES (?,?,?,?,1) ON CONFLICT(email) DO NOTHING',
      'Brenda', 'brenda@equipe.com', mk('brenda123'), 'seller');
    await run('INSERT INTO users (name, email, password_hash, role, active) VALUES (?,?,?,?,1) ON CONFLICT(email) DO NOTHING',
      'Carla', 'carla@equipe.com', mk('carla123'), 'seller');
    console.log('[db] Seed concluído.');
  }
})();

module.exports = { all, get, run, ready, creditForParticipants, isRemote };
