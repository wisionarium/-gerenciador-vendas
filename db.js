const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data.db');
const db = new DatabaseSync(DB_PATH);

db.exec(`
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','seller')) DEFAULT 'seller',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS call_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  seller_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0 AND quantity <= 2000),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_calls_seller_date ON call_records(seller_id, date);

CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_name TEXT NOT NULL,
  product TEXT NOT NULL,
  color TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('WhatsApp','CRM')),
  created_by INTEGER NOT NULL REFERENCES users(id),
  sale_date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(sale_date);

CREATE TABLE IF NOT EXISTS sale_participants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  seller_id INTEGER NOT NULL REFERENCES users(id),
  credit REAL NOT NULL CHECK (credit IN (0.5, 1.0)),
  UNIQUE (sale_id, seller_id)
);
CREATE INDEX IF NOT EXISTS idx_part_seller ON sale_participants(seller_id);
CREATE INDEX IF NOT EXISTS idx_part_sale ON sale_participants(sale_id);
`);

// ---- Regra central de crédito (FUNDAMENTAL) ----
function creditForParticipants(count) {
  if (count === 1) return 1.0;
  if (count === 2 || count === 3) return 0.5;
  throw new Error('Venda deve ter de 1 a 3 participantes.');
}

function seed() {
  const countRow = db.prepare('SELECT COUNT(*) AS c FROM users').get();
  if (countRow.c > 0) return;
  console.log('[db] Seed inicial...');
  const insert = db.prepare(
    "INSERT INTO users (name, email, password_hash, role, active) VALUES (?, ?, ?, ?, 1)"
  );
  const mk = (pw) => bcrypt.hashSync(pw, 10);
  insert.run('Administrador', 'admin@equipe.com', mk('admin123'), 'admin');
  insert.run('Ana', 'ana@equipe.com', mk('ana123'), 'seller');
  insert.run('Brenda', 'brenda@equipe.com', mk('brenda123'), 'seller');
  insert.run('Carla', 'carla@equipe.com', mk('carla123'), 'seller');
  console.log('[db] Usuários seed: admin@equipe.com/admin123, ana@equipe.com/ana123, brenda@equipe.com/brenda123, carla@equipe.com/carla123');
}
seed();

module.exports = { db, creditForParticipants };
