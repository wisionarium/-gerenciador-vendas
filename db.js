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
    role TEXT NOT NULL CHECK (role IN ('admin','manager','seller')) DEFAULT 'seller',
    sector TEXT NOT NULL DEFAULT 'online' CHECK (sector IN ('online','presencial')),
    store_id INTEGER,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  // lojas: sede + filiais (QR, geolocalização e raio próprios)
  `CREATE TABLE IF NOT EXISTS stores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    short TEXT NOT NULL DEFAULT '',
    qr_code TEXT NOT NULL UNIQUE,
    lat REAL,
    lng REAL,
    radius_m INTEGER NOT NULL DEFAULT 150,
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
    channel TEXT NOT NULL CHECK (channel IN ('WhatsApp','CRM','Presencial')),
    created_by INTEGER NOT NULL REFERENCES users(id),
    sale_date TEXT NOT NULL,
    store_id INTEGER,
    is_bonus INTEGER NOT NULL DEFAULT 0,
    bonus_cents INTEGER,
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
    store_id INTEGER,
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
  // comissões em centavos: online 2500/1250, presencial 3500/1750, modelo especial (bônus) = valor livre > 0
  `CREATE TABLE IF NOT EXISTS commissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_id INTEGER NOT NULL,
    seller_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    month TEXT NOT NULL,
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (sale_id, seller_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_comm_seller_month ON commissions(seller_id, month)`,
  // baixas de pagamento feitas pelo admin
  `CREATE TABLE IF NOT EXISTS payouts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    seller_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    month TEXT NOT NULL,
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_payout_seller ON payouts(seller_id)`,
  // auditoria de vendas canceladas (a venda sai das listas/totais, o motivo fica registrado)
  `CREATE TABLE IF NOT EXISTS canceled_sales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_id INTEGER NOT NULL,
    customer_name TEXT NOT NULL,
    product TEXT NOT NULL,
    color TEXT NOT NULL,
    channel TEXT NOT NULL,
    sale_date TEXT NOT NULL,
    participants TEXT NOT NULL DEFAULT '[]',
    reason TEXT NOT NULL CHECK (reason IN ('desistencia','outros')),
    note TEXT NOT NULL DEFAULT '',
    is_bonus INTEGER NOT NULL DEFAULT 0,
    bonus_cents INTEGER,
    canceled_by INTEGER REFERENCES users(id),
    canceled_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_canceled_date ON canceled_sales(sale_date)`,
  // arquivo 90+ dias (consulta só-leitura; payouts nunca são arquivados)
  `CREATE TABLE IF NOT EXISTS archived_sales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_id INTEGER NOT NULL,
    customer_name TEXT NOT NULL,
    product TEXT NOT NULL,
    color TEXT NOT NULL,
    channel TEXT NOT NULL,
    sale_date TEXT NOT NULL,
    is_bonus INTEGER NOT NULL DEFAULT 0,
    bonus_cents INTEGER,
    participants TEXT NOT NULL DEFAULT '[]',
    commissions TEXT NOT NULL DEFAULT '[]',
    created_by INTEGER,
    created_at TEXT,
    archived_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_arch_sales_date ON archived_sales(sale_date)`,
  `CREATE TABLE IF NOT EXISTS archived_calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    call_id INTEGER NOT NULL,
    seller_id INTEGER NOT NULL,
    seller_name TEXT,
    date TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    archived_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_arch_calls_date ON archived_calls(date)`,
  `CREATE TABLE IF NOT EXISTS archived_canceled (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_id INTEGER NOT NULL,
    customer_name TEXT NOT NULL,
    product TEXT NOT NULL,
    color TEXT NOT NULL,
    channel TEXT NOT NULL,
    sale_date TEXT NOT NULL,
    participants TEXT NOT NULL DEFAULT '[]',
    reason TEXT NOT NULL DEFAULT 'outros',
    note TEXT NOT NULL DEFAULT '',
    is_bonus INTEGER NOT NULL DEFAULT 0,
    bonus_cents INTEGER,
    canceled_by INTEGER,
    canceled_at TEXT,
    archived_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_arch_canceled_date ON archived_canceled(sale_date)`,
  // datas que o admin mandou NÃO tratar como feriado (veta a detecção automática)
  `CREATE TABLE IF NOT EXISTS holiday_skips (
    date TEXT PRIMARY KEY,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
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

  // Vercel ↔ Turso às vezes derruba a conexão (ECONNRESET/TLS/timeout).
  // Retenta só falha de TRANSPORTE (3 tentativas, backoff 200/500ms).
  // Erro de lógica SQL (ex: CONSTRAINT) falha rápido, sem retry.
  const isTransportError = (e) => {
    const msg = String((e && e.message) || e || '') + ' ' + String((e && e.cause && e.cause.message) || '');
    return /fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|socket hang up|socket disconnected|TLS|network|terminated|timeout|input error/i.test(msg)
      && !/SQLITE_CONSTRAINT|UNIQUE|CHECK constraint|no such (table|column)/i.test(msg);
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const execTurso = async (sql, params, attempt = 1) => {
    try {
      return await client.execute({ sql, args: params });
    } catch (e) {
      if (attempt < 3 && isTransportError(e)) {
        console.log(`[db] retry Turso (tentativa ${attempt + 1}/3): ${String(e.message || e).slice(0, 100)}`);
        await sleep(attempt === 1 ? 200 : 500);
        return execTurso(sql, params, attempt + 1);
      }
      throw e;
    }
  };

  all = async (sql, ...params) => toObjects(await execTurso(sql, params));
  get = async (sql, ...params) => (await all(sql, ...params))[0];
  run = async (sql, ...params) => {
    const rs = await execTurso(sql, params);
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

// ---- Comissão por loja + setor + bônus de modelo especial ----
// storeName: 'Sede' | filial (Magé/Guapimirim) | null (antigas = Sede)
// bonusCents: base exclusiva em centavos (modelo especial) ou null
// - filial → base 2500 (qualquer setor)
// - Sede: todos presencial → 3500; se há qualquer online → 2500
// - individual recebe a base cheia; dividida (2–3) recebe metade
function commissionBaseCents(sectors, bonusCents, storeName) {
  if (bonusCents != null) return Math.round(Number(bonusCents));
  if (storeName && storeName !== 'Sede') return 2500;
  const allPres = Array.isArray(sectors) && sectors.length > 0 && sectors.every((s) => s === 'presencial');
  return allPres ? 3500 : 2500;
}
function commissionCents(sectors, count, bonusCents, storeName) {
  if (count !== 1 && count !== 2 && count !== 3) throw new Error('Venda deve ter de 1 a 3 participantes.');
  let bonus = null;
  if (bonusCents != null && bonusCents !== '') {
    bonus = Math.round(Number(bonusCents));
    if (!Number.isFinite(bonus) || bonus <= 0 || bonus > 100000)
      throw new Error('Bônus deve ser entre R$ 0,01 e R$ 1.000,00.');
  }
  const base = commissionBaseCents(sectors, bonus, storeName);
  return count === 1 ? base : Math.round(base / 2);
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
  // comissões: backfill idempotente das vendas antigas (1,0 → 2500 / 0,5 → 1250)
  try {
    await run(`INSERT INTO commissions (sale_id, seller_id, month, amount_cents)
      SELECT sp.sale_id, sp.seller_id, substr(s.sale_date,1,7),
        CASE WHEN sp.credit >= 1 THEN 2500 ELSE 1250 END
      FROM sale_participants sp JOIN sales s ON s.id=sp.sale_id
      WHERE NOT EXISTS (SELECT 1 FROM commissions c WHERE c.sale_id=sp.sale_id AND c.seller_id=sp.seller_id)`);
  } catch {}
  // setor: vendedoras antigas viram 'online'
  try { await run("ALTER TABLE users ADD COLUMN sector TEXT NOT NULL DEFAULT 'online' CHECK (sector IN ('online','presencial'))"); } catch {}
  try { await run("UPDATE users SET sector='online' WHERE sector IS NULL OR sector NOT IN ('online','presencial')"); } catch {}
  // loja do usuário/venda/ponto
  try { await run('ALTER TABLE users ADD COLUMN store_id INTEGER'); } catch {}
  try { await run('ALTER TABLE sales ADD COLUMN store_id INTEGER'); } catch {}
  try { await run('ALTER TABLE punches ADD COLUMN store_id INTEGER'); } catch {}
  // bônus na venda + auditoria de canceladas (ANTES dos rebuilds, que copiam essas colunas)
  try { await run('ALTER TABLE sales ADD COLUMN is_bonus INTEGER NOT NULL DEFAULT 0'); } catch {}
  try { await run('ALTER TABLE sales ADD COLUMN bonus_cents INTEGER'); } catch {}
  try { await run('ALTER TABLE canceled_sales ADD COLUMN is_bonus INTEGER NOT NULL DEFAULT 0'); } catch {}
  try { await run('ALTER TABLE canceled_sales ADD COLUMN bonus_cents INTEGER'); } catch {}
  await migrateTableChecks();
  await seedStores();
  try {
    const sede = await get("SELECT id FROM stores WHERE name='Sede' LIMIT 1");
    if (sede) {
      await run('UPDATE users SET store_id=? WHERE store_id IS NULL', sede.id);
      await run('UPDATE sales SET store_id=? WHERE store_id IS NULL', sede.id);
    }
  } catch {}
  await autoArchive();
})();

// Arquivamento automático 90+ dias (sem confirmação): move vendas, chamadas
// e canceladas antigas para o arquivo (somem das listas/totais, continuam
// consultáveis). Pagamentos (payouts) nunca são tocados.
const ARCHIVE_DAYS = 90;
async function autoArchive() {
  const cutoff = new Date(Date.now() - ARCHIVE_DAYS * 864e5).toISOString().slice(0, 10);
  let nSales = 0, nCalls = 0, nCanceled = 0;
  try {
    const oldSales = await all('SELECT * FROM sales WHERE sale_date < ? ORDER BY sale_date LIMIT 2000', cutoff);
    for (const sale of oldSales) {
      const parts = await all(
        'SELECT sp.*, u.name AS seller_name FROM sale_participants sp JOIN users u ON u.id=sp.seller_id WHERE sp.sale_id=?',
        sale.id
      );
      let comms = [];
      try { comms = await all('SELECT seller_id, month, amount_cents FROM commissions WHERE sale_id=?', sale.id); } catch {}
      await run(
        'INSERT INTO archived_sales (sale_id, customer_name, product, color, channel, sale_date, is_bonus, bonus_cents, participants, commissions, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
        sale.id, sale.customer_name, sale.product, sale.color, sale.channel, sale.sale_date,
        sale.is_bonus ? 1 : 0, sale.bonus_cents || null,
        JSON.stringify(parts.map((p) => ({ seller_id: p.seller_id, seller_name: p.seller_name, credit: Number(p.credit) }))),
        JSON.stringify(comms.map((c) => ({ seller_id: c.seller_id, month: c.month, amount_cents: Number(c.amount_cents) }))),
        sale.created_by, sale.created_at
      );
      try { await run('DELETE FROM commissions WHERE sale_id=?', sale.id); }
      catch (e) { if (!/no such table/i.test(String(e.message))) throw e; }
      await run('DELETE FROM sale_participants WHERE sale_id=?', sale.id);
      await run('DELETE FROM sales WHERE id=?', sale.id);
      nSales++;
    }
    const oldCalls = await all(
      'SELECT cr.*, u.name AS seller_name FROM call_records cr LEFT JOIN users u ON u.id=cr.seller_id WHERE cr.date < ? LIMIT 2000', cutoff
    );
    for (const c of oldCalls) {
      await run('INSERT INTO archived_calls (call_id, seller_id, seller_name, date, quantity) VALUES (?,?,?,?,?)',
        c.id, c.seller_id, c.seller_name || '', c.date, c.quantity);
      await run('DELETE FROM call_records WHERE id=?', c.id);
      nCalls++;
    }
    const oldCanc = await all('SELECT * FROM canceled_sales WHERE sale_date < ? LIMIT 2000', cutoff);
    for (const x of oldCanc) {
      await run(
        'INSERT INTO archived_canceled (sale_id, customer_name, product, color, channel, sale_date, participants, reason, note, is_bonus, bonus_cents, canceled_by, canceled_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
        x.sale_id, x.customer_name, x.product, x.color, x.channel, x.sale_date, x.participants || '[]',
        x.reason || 'outros', x.note || '', x.is_bonus ? 1 : 0, x.bonus_cents || null, x.canceled_by || null, x.canceled_at || null
      );
      await run('DELETE FROM canceled_sales WHERE id=?', x.id);
      nCanceled++;
    }
  } catch (e) { console.log('[db] Arquivo automático pulado:', e.message); return; }
  if (nSales || nCalls || nCanceled)
    console.log(`[db] Arquivo automático: ${nSales} venda(s), ${nCalls} chamada(s), ${nCanceled} cancelada(s) (antes de ${cutoff}).`);
}

// Migrações com ledger: cada uma roda UMA única vez (registrada em `migrations`).
// À prova de serverless: passos ordenados + temporário com DROP IF EXISTS — se duas
// instâncias coincidirem, uma completa e a outra aborta sem corromper (retry OK).
// Funciona no SQLite local e no Turso (só DDL/DML padrão).
async function ensureLedger() {
  try { await run('CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime(\'now\')))'); } catch {}
}
async function migrationDone(name) {
  try { const r = await get('SELECT name FROM migrations WHERE name=?', name); return !!r; }
  catch { return false; }
}
async function markMigration(name) {
  try { await run('INSERT INTO migrations (name) VALUES (?) ON CONFLICT(name) DO NOTHING', name); } catch {}
}
async function once(name, neededFn, fn) {
  await ensureLedger();
  if (await migrationDone(name)) return 'skipped';
  let needed = true;
  try { needed = await neededFn(); } catch { needed = true; }
  if (!needed) { await markMigration(name); return 'skipped'; }
  await fn();
  await markMigration(name);
  return 'applied';
}
async function migrateTableChecks() {
  const tableSQL = async (name) => {
    try { const r = await get("SELECT sql FROM sqlite_master WHERE type='table' AND name=?", name); return r ? r.sql : ''; }
    catch { return ''; }
  };
  const noFK = async (fn) => {
    // vale também no remoto (Turso): o client HTTP mantém sessão e o PRAGMA persiste.
    // Sem isso, DROP TABLE de tabela referenciada (users) aborta com SQLITE_CONSTRAINT.
    try { await run('PRAGMA foreign_keys=OFF'); } catch {}
    try { return await fn(); }
    finally { if (!isRemote) { try { await run('PRAGMA foreign_keys=ON'); } catch {} } }
  };
  // users: perfis 'manager' e 'staff' (rebuild preservando dados)
  const rebuildUsersTable = async () => {
    // saneamento prévio: NULLs que violariam o NOT NULL da tabela nova
    try { await run('UPDATE users SET active=1 WHERE active IS NULL'); } catch {}
    try { await run("UPDATE users SET role='seller' WHERE role IS NULL OR role NOT IN ('admin','seller','manager','staff')"); } catch {}
    await noFK(async () => {
      try { await run('DROP TABLE IF EXISTS users_new'); } catch {}
      await run(`CREATE TABLE users_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin','manager','seller','staff')) DEFAULT 'seller',
      sector TEXT NOT NULL DEFAULT 'online' CHECK (sector IN ('online','presencial')),
      store_id INTEGER,
      avatar_url TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    await run(`INSERT INTO users_new (id, name, email, password_hash, role, sector, store_id, avatar_url, active, created_at)
      SELECT id, name, email, password_hash, role, COALESCE(sector,'online'), store_id, avatar_url, active, created_at FROM users`);
      await run('DROP TABLE users');
      await run('ALTER TABLE users_new RENAME TO users');
      try { await run("UPDATE sqlite_sequence SET name='users' WHERE name='users_new'"); } catch {}
    });
  };
  try {
    const st = await once('users-manager-role',
      async () => !(await tableSQL('users')).includes('manager'),
      rebuildUsersTable
    );
    if (st === 'applied') console.log('[db] Migração: perfil gerente aplicada.');
  } catch (e) { console.log('[db] Migração gerente pulada:', e.message); }
  try {
    const st = await once('users-staff-role',
      async () => !(await tableSQL('users')).includes('staff'),
      rebuildUsersTable
    );
    if (st === 'applied') console.log('[db] Migração: perfil funcionário aplicada.');
  } catch (e) { console.log('[db] Migração funcionário pulada:', e.message); }
  // sales: aceita canal 'Presencial'
  try {
    const st = await once('sales-presencial-channel',
      async () => !(await tableSQL('sales')).includes('Presencial'),
      async () => {
        await noFK(async () => {
          try { await run('DROP TABLE IF EXISTS sales_new'); } catch {}
          await run(`CREATE TABLE sales_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          customer_name TEXT NOT NULL,
          product TEXT NOT NULL,
          color TEXT NOT NULL,
          channel TEXT NOT NULL CHECK (channel IN ('WhatsApp','CRM','Presencial')),
          created_by INTEGER NOT NULL REFERENCES users(id),
          sale_date TEXT NOT NULL,
          store_id INTEGER,
          is_bonus INTEGER NOT NULL DEFAULT 0,
          bonus_cents INTEGER,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )`);
        await run(`INSERT INTO sales_new (id, customer_name, product, color, channel, created_by, sale_date, store_id, is_bonus, bonus_cents, created_at, updated_at)
          SELECT id, customer_name, product, color, channel, created_by, sale_date, store_id, COALESCE(is_bonus,0), bonus_cents, created_at, updated_at FROM sales`);
          await run('DROP TABLE sales');
          await run('ALTER TABLE sales_new RENAME TO sales');
          await run('CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(sale_date)');
          try { await run("UPDATE sqlite_sequence SET name='sales' WHERE name='sales_new'"); } catch {}
        });
      }
    );
    if (st === 'applied') console.log('[db] Migração: canal Presencial aplicada.');
  } catch (e) { console.log('[db] Migração canal pulada:', e.message); }
  // commissions: CHECK flexível (qualquer valor > 0: 3500/1750 e bônus)
  try {
    const st = await once('commissions-flex-check',
      async () => !(await tableSQL('commissions')).includes('amount_cents > 0'),
      async () => {
        await noFK(async () => {
          try { await run('DROP TABLE IF EXISTS commissions_new'); } catch {}
          await run(`CREATE TABLE commissions_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          sale_id INTEGER NOT NULL,
          seller_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          month TEXT NOT NULL,
          amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE (sale_id, seller_id)
        )`);
        await run(`INSERT INTO commissions_new (id, sale_id, seller_id, month, amount_cents, created_at)
          SELECT id, sale_id, seller_id, month, amount_cents, created_at FROM commissions`);
          await run('DROP TABLE commissions');
          await run('ALTER TABLE commissions_new RENAME TO commissions');
          await run('CREATE INDEX IF NOT EXISTS idx_comm_seller_month ON commissions(seller_id, month)');
        });
      }
    );
    if (st === 'applied') console.log('[db] Migração: comissões flexíveis aplicada.');
  } catch (e) { console.log('[db] Migração comissões pulada:', e.message); }
}

// Lojas: Sede herda QR/localização/raio atuais (nada muda para quem já usa);
// Magé e Guapimirim nascem com QR próprio e raio 150m (admin ajusta local no painel).
async function seedStores() {
  try {
    const cfg = await get('SELECT * FROM ponto_config WHERE id=1');
    await run('INSERT INTO stores (name, short, qr_code, lat, lng, radius_m) VALUES (?,?,?,?,?,?) ON CONFLICT(name) DO NOTHING',
      'Sede', 'SEDE', (cfg && cfg.qr_code) || 'PONTO-LOJA-01', cfg ? cfg.lat : null, cfg ? cfg.lng : null, (cfg && cfg.radius_m) || 150);
    await run("INSERT INTO stores (name, short, qr_code, lat, lng, radius_m) VALUES ('Magé','MAGE','PONTO-MAGE-01',NULL,NULL,150) ON CONFLICT(name) DO NOTHING");
    await run("INSERT INTO stores (name, short, qr_code, lat, lng, radius_m) VALUES ('Guapimirim','GUAPI','PONTO-GUAPI-01',NULL,NULL,150) ON CONFLICT(name) DO NOTHING");
  } catch (e) { console.log('[db] Seed lojas pulado:', e.message); }
}

module.exports = { all, get, run, ready, creditForParticipants, commissionCents, commissionBaseCents, isRemote, ARCHIVE_DAYS: 90 };
