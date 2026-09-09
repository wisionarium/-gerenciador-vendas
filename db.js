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
  // meta mensal definida pela própria vendedora
  `CREATE TABLE IF NOT EXISTS seller_goals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    seller_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    month TEXT NOT NULL,
    target REAL NOT NULL CHECK (target >= 0 AND target <= 100000),
    UNIQUE (seller_id, month)
  )`,
  // frases motivacionais (uma sorteada por dia)
  `CREATE TABLE IF NOT EXISTS phrases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  // tema da vendedora (só tons de verde, fundo sempre branco)
  `CREATE TABLE IF NOT EXISTS seller_settings (
    seller_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    preset TEXT NOT NULL DEFAULT 'padrao'
  )`,
  // frase do dia escrita em rodízio pelas vendedoras
  `CREATE TABLE IF NOT EXISTS daily_phrases (
    date TEXT PRIMARY KEY,
    seller_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  // ponto: config da loja (linha única id=1) + feriados + batidas
  `CREATE TABLE IF NOT EXISTS ponto_config (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    store_name TEXT NOT NULL DEFAULT 'Loja',
    lat REAL,
    lng REAL,
    radius_m INTEGER NOT NULL DEFAULT 150,
    qr_code TEXT NOT NULL DEFAULT 'PONTO-LOJA-01',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS holidays (
    date TEXT PRIMARY KEY,
    label TEXT NOT NULL DEFAULT 'Feriado',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS punches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    seller_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    check_in_at TEXT,
    check_in_lat REAL,
    check_in_lng REAL,
    check_in_acc REAL,
    check_out_at TEXT,
    check_out_lat REAL,
    check_out_lng REAL,
    check_out_acc REAL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (seller_id, date)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_punches_date ON punches(date)`,
  `CREATE INDEX IF NOT EXISTS idx_punches_seller_date ON punches(seller_id, date)`,
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
  // migração leve: foto de perfil (ignora se a coluna já existir)
  try { await run('ALTER TABLE users ADD COLUMN avatar_url TEXT'); } catch {}
  // migração leve: tema em duas cores (ignora se já existir)
  try { await run('ALTER TABLE seller_settings ADD COLUMN theme_dark TEXT'); } catch {}
  try { await run('ALTER TABLE seller_settings ADD COLUMN theme_light TEXT'); } catch {}
  await run("UPDATE seller_settings SET theme_dark='verde', theme_light='classico' WHERE theme_dark IS NULL OR theme_light IS NULL");
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
  // frases padrão removidas: agora só vale a frase escrita pela vendedora (daily_phrases).
  // limpa qualquer frase padrão que já exista no banco.
  try { await run('DELETE FROM phrases'); } catch {}
  // ponto: garante linha única de config da loja
  try { await run("INSERT INTO ponto_config (id, store_name, radius_m, qr_code) VALUES (1,'Loja',150,'PONTO-LOJA-01') ON CONFLICT(id) DO NOTHING"); } catch {}
})();

module.exports = { all, get, run, ready, creditForParticipants, isRemote };
