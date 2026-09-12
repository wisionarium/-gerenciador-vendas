const express = require('express');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const QRCode = require('qrcode');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'troque-este-segredo-em-producao';
const JWT_EXPIRES = '7d';

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// embrulha handlers async p/ o Express 4 encaminhar erros ao middleware
const ah = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// ---------- helpers ----------
const todayISO = () => new Date().toISOString().slice(0, 10);
const isValidDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !isNaN(Date.parse(s));
const toPublicUser = (u) => ({
  id: u.id, name: u.name, email: u.email, role: u.role, sector: u.sector || 'online',
  store_id: u.store_id || null, store_name: u.store_name || (u.role === 'admin' ? 'Todas' : 'Sede'),
  active: !!u.active, created_at: u.created_at, avatar_url: u.avatar_url || null,
});
const validSector = (s) => ['online', 'presencial'].includes(s);
const CHANNELS = ['WhatsApp', 'CRM', 'Presencial'];

// gerente: admin da própria loja (não vê outras lojas, não gerencia usuários)
function requireManager(req, res, next) {
  if (req.user.role !== 'admin' && req.user.role !== 'manager')
    return res.status(403).json({ error: 'Acesso restrito ao administrador.' });
  next();
}
// loja do gerente (admin = todas = null). Retorna 403 se tentar outra loja.
function managerStoreId(req) {
  if (req.user.role === 'manager') {
    if (!req.user.store_id) return { error: 'Gerente sem loja vinculada.' };
    return { storeId: Number(req.user.store_id) };
  }
  return { storeId: null };
}
function scopedStoreId(req, param) {
  const m = managerStoreId(req);
  if (m.error) return m;
  if (m.storeId != null) {
    if (param != null && param !== '' && Number(param) !== m.storeId)
      return { error: 'Acesso restrito à sua loja.' };
    return { storeId: m.storeId };
  }
  if (param != null && param !== '') return { storeId: Number(param) };
  return { storeId: null };
}
async function getStore(id) {
  if (id == null) return null;
  try { return await db.get('SELECT * FROM stores WHERE id=?', Number(id)); }
  catch { return null; }
}
async function sedeId() {
  try {
    const s = await db.get("SELECT id FROM stores WHERE name='Sede' LIMIT 1");
    if (s) return s.id;
    const f = await db.all('SELECT id FROM stores ORDER BY id LIMIT 1');
    return f.length ? f[0].id : null;
  } catch { return null; }
}

// bônus de modelo especial: body {is_bonus, bonus_value em R$} → centavos ou null.
// Retorna {isBonus, bonusCents} ou {error}.
function parseBonus(body) {
  const flag = body && (body.is_bonus === true || body.is_bonus === 1 || body.is_bonus === '1');
  if (!flag) return { isBonus: false, bonusCents: null };
  const v = Math.round(Number(String(body.bonus_value ?? '').replace(',', '.')) * 100);
  if (!Number.isFinite(v) || v <= 0 || v > 100000)
    return { error: 'Informe o valor do bônus (R$ 0,01 a R$ 1.000,00).' };
  return { isBonus: true, bonusCents: v };
}
// setores das participantes a partir das linhas de users
const sectorsOf = (sellers, pids) => pids.map((id) => {
  const s = sellers.find((x) => Number(x.id) === Number(id));
  return (s && s.sector) || 'online';
});

function signToken(user) {
  return jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

async function requireAuth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Não autenticado.' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = await db.get('SELECT u.*, s.name AS store_name FROM users u LEFT JOIN stores s ON s.id=u.store_id WHERE u.id = ?', payload.id);
    if (!user || !user.active) return res.status(401).json({ error: 'Usuário inválido ou desativado.' });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: 'Sessão expirada. Faça login novamente.' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Acesso restrito ao administrador.' });
  next();
}

// ---------- AUTH ----------
app.post('/api/auth/login', ah(async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Informe e-mail e senha.' });
  const user = await db.get('SELECT * FROM users WHERE lower(email) = lower(?)', String(email).trim());
  if (!user) return res.status(401).json({ error: 'Credenciais inválidas.' });
  if (!user.active) return res.status(403).json({ error: 'Usuária desativada. Fale com o administrador.' });
  const ok = bcrypt.compareSync(String(password), user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Credenciais inválidas.' });
  return res.json({ token: signToken(user), user: toPublicUser(user) });
}));

app.get('/api/me', requireAuth, ah(async (req, res) => {
  res.json({ user: toPublicUser(req.user) });
}));

// foto de perfil (data URL pequena, redimensionada no app)
app.put('/api/me/avatar', requireAuth, ah(async (req, res) => {
  const { avatar, seller_id } = req.body || {};
  let sid = req.user.id;
  if (seller_id && req.user.role === 'admin') sid = Number(seller_id);
  else if (req.user.role !== 'seller') return res.status(403).json({ error: 'Sem permissão.' });
  if (avatar) {
    if (typeof avatar !== 'string' || !avatar.startsWith('data:image/') || avatar.length > 200000)
      return res.status(400).json({ error: 'Imagem inválida. Use uma foto JPG/PNG comum.' });
  }
  await db.run('UPDATE users SET avatar_url=? WHERE id=?', avatar || null, sid);
  const u = await db.get('SELECT u.*, s.name AS store_name FROM users u LEFT JOIN stores s ON s.id=u.store_id WHERE u.id=?', sid);
  if (!u) return res.status(404).json({ error: 'Usuária não encontrada.' });
  res.json({ user: toPublicUser(u) });
}));

// ---------- SELLERS / USERS ----------
app.get('/api/sellers', requireAuth, ah(async (req, res) => {
  const { sector } = req.query;
  const sectorFilter = validSector(sector) ? ' AND COALESCE(sector,\'online\')=?' : '';
  const sectorParam = validSector(sector) ? [sector] : [];
  const sel = 'SELECT u.*, s.name AS store_name FROM users u LEFT JOIN stores s ON s.id=u.store_id';
  if (req.user.role === 'admin' || req.user.role === 'manager') {
    const rows = await db.all(`${sel} WHERE u.role='seller'${sectorFilter} ORDER BY u.name`, ...sectorParam);
    return res.json({ sellers: rows.map(toPublicUser) });
  }
  const rows = await db.all(`${sel} WHERE u.role='seller' AND u.active=1${sectorFilter} ORDER BY u.name`, ...sectorParam);
  return res.json({ sellers: rows.map(toPublicUser) });
}));

// ---------- LOJAS ----------
app.get('/api/stores', requireAuth, ah(async (req, res) => {
  let rows = [];
  try { rows = await db.all('SELECT * FROM stores WHERE active=1 ORDER BY id'); }
  catch { return res.json({ stores: [] }); }
  if (req.user.role === 'manager') rows = rows.filter((s) => Number(s.id) === Number(req.user.store_id));
  if (req.user.role === 'seller') rows = rows.filter((s) => Number(s.id) === Number(req.user.store_id));
  res.json({ stores: rows });
}));

app.put('/api/stores/:id', requireAuth, requireManager, ah(async (req, res) => {
  const store = await getStore(req.params.id);
  if (!store) return res.status(404).json({ error: 'Loja não encontrada.' });
  if (req.user.role === 'manager' && Number(store.id) !== Number(req.user.store_id))
    return res.status(403).json({ error: 'Acesso restrito à sua loja.' });
  const { name, lat, lng, radius_m } = req.body || {};
  const nLat = lat === null || lat === undefined || lat === '' ? null : Number(lat);
  const nLng = lng === null || lng === undefined || lng === '' ? null : Number(lng);
  const nRad = Number(radius_m ?? store.radius_m);
  if (nLat != null && (!Number.isFinite(nLat) || nLat < -90 || nLat > 90)) return res.status(400).json({ error: 'Latitude inválida.' });
  if (nLng != null && (!Number.isFinite(nLng) || nLng < -180 || nLng > 180)) return res.status(400).json({ error: 'Longitude inválida.' });
  if (!Number.isFinite(nRad) || nRad < 30 || nRad > 2000) return res.status(400).json({ error: 'Raio deve ser entre 30 e 2000 metros.' });
  // gerente ajusta localização/raio da própria loja; só admin renomeia
  const newName = req.user.role === 'admin' ? String(name || store.name).slice(0, 60) : store.name;
  await db.run('UPDATE stores SET name=?, lat=?, lng=?, radius_m=? WHERE id=?',
    newName, nLat, nLng, Math.round(nRad), store.id);
  res.json({ store: await getStore(store.id) });
}));

app.get('/api/users', requireAuth, requireAdmin, ah(async (req, res) => {
  const rows = await db.all(
    'SELECT u.*, s.name AS store_name FROM users u LEFT JOIN stores s ON s.id=u.store_id ORDER BY u.role DESC, u.name'
  );
  res.json({ users: rows.map(toPublicUser) });
}));

app.post('/api/users', requireAuth, requireAdmin, ah(async (req, res) => {
  const { name, email, password, role, sector, store_id } = req.body || {};
  if (!name?.trim() || !email?.trim() || !password) return res.status(400).json({ error: 'Nome, e-mail e senha são obrigatórios.' });
  if (!['admin', 'manager', 'seller'].includes(role)) return res.status(400).json({ error: 'Perfil inválido.' });
  if (sector != null && sector !== '' && !validSector(sector)) return res.status(400).json({ error: 'Setor inválido (online ou presencial).' });
  let storeId = null;
  if (role !== 'admin') {
    if (store_id != null && store_id !== '') {
      const st = await getStore(store_id);
      if (!st || !st.active) return res.status(400).json({ error: 'Loja inválida.' });
      storeId = st.id;
    } else if (role === 'manager') {
      return res.status(400).json({ error: 'Gerente precisa de uma loja vinculada.' });
    } else {
      storeId = await sedeId();
    }
  }
  if (String(password).length < 4) return res.status(400).json({ error: 'Senha deve ter ao menos 4 caracteres.' });
  try {
    const r = await db.run('INSERT INTO users (name, email, password_hash, role, sector, store_id, active) VALUES (?,?,?,?,?,?,1)',
      name.trim(), email.trim().toLowerCase(), bcrypt.hashSync(String(password), 10), role, validSector(sector) ? sector : 'online', storeId);
    const u = await db.get('SELECT u.*, s.name AS store_name FROM users u LEFT JOIN stores s ON s.id=u.store_id WHERE u.id=?', r.lastInsertRowid);
    res.status(201).json({ user: toPublicUser(u) });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'E-mail já cadastrado.' });
    throw e;
  }
}));

app.put('/api/users/:id', requireAuth, requireAdmin, ah(async (req, res) => {
  const { name, email, password, role, sector, store_id } = req.body || {};
  const target = await db.get('SELECT * FROM users WHERE id=?', req.params.id);
  if (!target) return res.status(404).json({ error: 'Usuária não encontrada.' });
  if (!name?.trim() || !email?.trim()) return res.status(400).json({ error: 'Nome e e-mail são obrigatórios.' });
  if (role && !['admin', 'manager', 'seller'].includes(role)) return res.status(400).json({ error: 'Perfil inválido.' });
  if (sector != null && sector !== '' && !validSector(sector)) return res.status(400).json({ error: 'Setor inválido (online ou presencial).' });
  const newRole = role || target.role;
  let storeId = target.store_id;
  if (store_id !== undefined) {
    if (store_id === null || store_id === '') {
      if (newRole === 'manager') return res.status(400).json({ error: 'Gerente precisa de uma loja vinculada.' });
      storeId = newRole === 'admin' ? null : await sedeId();
    } else {
      const st = await getStore(store_id);
      if (!st || !st.active) return res.status(400).json({ error: 'Loja inválida.' });
      storeId = st.id;
    }
  } else if (newRole === 'manager' && !storeId) {
    return res.status(400).json({ error: 'Gerente precisa de uma loja vinculada.' });
  } else if (newRole === 'admin') {
    storeId = null;
  }
  try {
    await db.run('UPDATE users SET name=?, email=?, role=?, sector=?, store_id=? WHERE id=?',
      name.trim(), email.trim().toLowerCase(), newRole, validSector(sector) ? sector : (target.sector || 'online'), storeId, target.id);
    if (password) {
      if (String(password).length < 4) return res.status(400).json({ error: 'Senha deve ter ao menos 4 caracteres.' });
      await db.run('UPDATE users SET password_hash=? WHERE id=?', bcrypt.hashSync(String(password), 10), target.id);
    }
    const u = await db.get('SELECT u.*, s.name AS store_name FROM users u LEFT JOIN stores s ON s.id=u.store_id WHERE u.id=?', target.id);
    res.json({ user: toPublicUser(u) });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'E-mail já cadastrado.' });
    throw e;
  }
}));

app.patch('/api/users/:id/status', requireAuth, requireAdmin, ah(async (req, res) => {
  const target = await db.get('SELECT * FROM users WHERE id=?', req.params.id);
  if (!target) return res.status(404).json({ error: 'Usuária não encontrada.' });
  if (target.id === req.user.id) return res.status(400).json({ error: 'Você não pode desativar a si mesma.' });
  const { active } = req.body || {};
  await db.run('UPDATE users SET active=? WHERE id=?', active ? 1 : 0, target.id);
  const u = await db.get('SELECT u.*, s.name AS store_name FROM users u LEFT JOIN stores s ON s.id=u.store_id WHERE u.id=?', target.id);
  res.json({ user: toPublicUser(u) });
}));

// ---------- GOALS (meta mensal da vendedora) ----------
const monthKey = (d = new Date()) => d.toISOString().slice(0, 7);

app.get('/api/goals/me', requireAuth, ah(async (req, res) => {
  if (req.user.role !== 'seller') return res.status(403).json({ error: 'Recurso da vendedora.' });
  const month = req.query.month || monthKey();
  const g = await db.get('SELECT * FROM seller_goals WHERE seller_id=? AND month=?', req.user.id, month);
  res.json({ month, target: g ? Number(g.target) : null });
}));

app.put('/api/goals', requireAuth, ah(async (req, res) => {
  let { month, target, seller_id } = req.body || {};
  month = month || monthKey();
  target = Number(target);
  if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'Mês inválido.' });
  if (!Number.isFinite(target) || target < 0 || target > 100000)
    return res.status(400).json({ error: 'Meta deve ser entre 0 e 100000.' });
  let sid = req.user.id;
  if (req.user.role === 'admin') {
    if (!seller_id) return res.status(400).json({ error: 'Selecione a vendedora.' });
    sid = Number(seller_id);
  } else if (req.user.role !== 'seller') {
    return res.status(403).json({ error: 'Sem permissão.' });
  }
  await db.run(
    'INSERT INTO seller_goals (seller_id, month, target) VALUES (?,?,?) ON CONFLICT(seller_id, month) DO UPDATE SET target=excluded.target',
    sid, month, target
  );
  res.json({ month, target, seller_id: sid });
}));

// ---------- THEME (fundo sempre branco; escuras p/ texto branco, claras p/ texto escuro) ----------
const THEME_DARKS = {
  verde:    { name: 'Verde',    brand: '#0b3b2c', brand2: '#12503c' },
  rosa:     { name: 'Rosa',     brand: '#8a1145', brand2: '#ad1c52' },
  roxo:     { name: 'Roxo',     brand: '#4c1d95', brand2: '#5f27b8' },
  caramelo: { name: 'Caramelo', brand: '#6f4a1f', brand2: '#8a5f28' },
  azul:     { name: 'Azul',     brand: '#1e3a8a', brand2: '#2b4fa3' },
  preta:    { name: 'Preta',    brand: '#000000', brand2: '#1c1c1c' },
};
const THEME_LIGHTS = {
  classico: { name: 'Clássico', accent: '#1e6b4e', soft: '#e7f0e8', weak: '#e2efe5', onAccent: '#ffffff', lime: '#cdf14d' },
  menta:    { name: 'Menta',    accent: '#7cc4a3', soft: '#e9f4ec', weak: '#e2f1e6', onAccent: '#0f1f17', lime: '#34d399' },
  rosa:     { name: 'Rosa',     accent: '#f2a4c4', soft: '#fdeef4', weak: '#fce7f0', onAccent: '#0f1f17', lime: '#f472b6' },
  lavanda:  { name: 'Lavanda',  accent: '#b9a5f0', soft: '#efe9fd', weak: '#e8e0fb', onAccent: '#0f1f17', lime: '#a78bfa' },
  bege:     { name: 'Bege',     accent: '#d9c193', soft: '#faf5e9', weak: '#f4ecda', onAccent: '#0f1f17', lime: '#eab308' },
  pessego:  { name: 'Pêssego',  accent: '#f2b28c', soft: '#fdf0e4', weak: '#fbe9d7', onAccent: '#0f1f17', lime: '#fb923c' },
  amarelo:  { name: 'Amarelo',  accent: '#eed36a', soft: '#fbf3da', weak: '#f8eed2', onAccent: '#0f1f17', lime: '#facc15' },
  cinza:    { name: 'Cinza',    accent: '#c9ced5', soft: '#f5f6f8', weak: '#eceef1', onAccent: '#0f1f17', lime: '#9aa0a8' },
};
function mergedTheme(darkId, lightId) {
  const d = THEME_DARKS[darkId] || THEME_DARKS.verde;
  const l = THEME_LIGHTS[lightId] || THEME_LIGHTS.classico;
  return { brand: d.brand, brand2: d.brand2, accent: l.accent, soft: l.soft, weak: l.weak, onAccent: l.onAccent, lime: l.lime };
}

app.get('/api/settings/theme', requireAuth, ah(async (req, res) => {
  if (req.user.role !== 'seller') return res.status(403).json({ error: 'Recurso da vendedora.' });
  const row = await db.get('SELECT * FROM seller_settings WHERE seller_id=?', req.user.id);
  const dark = (row && (row.theme_dark || (row.preset ? 'verde' : null))) || 'verde';
  const light = (row && (row.theme_light || (row.preset ? 'classico' : null))) || 'classico';
  res.json({ darks: THEME_DARKS, lights: THEME_LIGHTS, dark, light, theme: mergedTheme(dark, light) });
}));

app.put('/api/settings/theme', requireAuth, ah(async (req, res) => {
  if (req.user.role !== 'seller') return res.status(403).json({ error: 'Recurso da vendedora.' });
  const { dark, light } = req.body || {};
  if (!THEME_DARKS[dark]) return res.status(400).json({ error: 'Cor escura inválida.' });
  if (!THEME_LIGHTS[light]) return res.status(400).json({ error: 'Cor clara inválida.' });
  await db.run(
    'INSERT INTO seller_settings (seller_id, theme_dark, theme_light) VALUES (?,?,?) ON CONFLICT(seller_id) DO UPDATE SET theme_dark=excluded.theme_dark, theme_light=excluded.theme_light',
    req.user.id, dark, light
  );
  res.json({ dark, light, theme: mergedTheme(dark, light) });
}));

// rodízio diário: vendedora do dia = rotação entre as ativas
async function drawnSeller(dateISO) {
  const sellers = await db.all("SELECT * FROM users WHERE role='seller' AND active=1 ORDER BY id");
  if (!sellers.length) return null;
  const [y, mo, dd] = dateISO.split('-').map(Number);
  const n = Math.floor(Date.UTC(y, mo - 1, dd) / 86400000);
  return sellers[n % sellers.length];
}

function bankPhrase(list, dateISO) {
  const [y, mo, dd] = dateISO.split('-').map(Number);
  const n = Math.floor(Date.UTC(y, mo - 1, dd) / 86400000);
  return list[n % list.length].text;
}

// ---------- PHRASES (frase do dia) ----------
app.get('/api/phrases/today', requireAuth, ah(async (req, res) => {
  const today = todayISO();
  const drawn = await drawnSeller(today);
  const dp = await db.get(
    'SELECT dp.*, u.name AS author_name FROM daily_phrases dp JOIN users u ON u.id=dp.seller_id WHERE dp.date=?', today
  );
  if (dp) {
    return res.json({
      text: dp.text, author: dp.author_name, authorId: dp.seller_id, date: today,
      drawnSellerId: drawn ? drawn.id : null, drawnSellerName: drawn ? drawn.name : null,
      canWrite: drawn ? (req.user.id === drawn.id || req.user.role === 'admin') : false,
    });
  }
  // só vale a frase escrita pela vendedora (sem frase padrão/banco)
  res.json({
    text: '', author: null, authorId: null, date: today,
    drawnSellerId: drawn ? drawn.id : null, drawnSellerName: drawn ? drawn.name : null,
    canWrite: drawn ? (req.user.id === drawn.id || req.user.role === 'admin') : false,
  });
}));

// frase do dia escrita pela sorteada (máx. 140 caracteres)
app.post('/api/phrases/daily', requireAuth, ah(async (req, res) => {
  const today = todayISO();
  const drawn = await drawnSeller(today);
  if (!drawn) return res.status(400).json({ error: 'Nenhuma vendedora ativa.' });
  if (req.user.id !== drawn.id && req.user.role !== 'admin')
    return res.status(403).json({ error: `Hoje é o dia de ${drawn.name} escrever a frase.` });
  const { text } = req.body || {};
  const clean = String(text || '').trim();
  if (!clean) return res.status(400).json({ error: 'Escreva a frase.' });
  if (clean.length > 140) return res.status(400).json({ error: `Máximo de 140 caracteres (tem ${clean.length}).` });
  await db.run(
    'INSERT INTO daily_phrases (date, seller_id, text) VALUES (?,?,?) ON CONFLICT(date) DO UPDATE SET text=excluded.text, seller_id=excluded.seller_id',
    today, req.user.id, clean
  );
  res.status(201).json({ ok: true });
}));

app.get('/api/phrases', requireAuth, requireAdmin, ah(async (req, res) => {
  res.json({ phrases: await db.all('SELECT * FROM phrases ORDER BY id') });
}));

app.post('/api/phrases', requireAuth, requireAdmin, ah(async (req, res) => {
  const { text } = req.body || {};
  if (!text?.trim()) return res.status(400).json({ error: 'Texto obrigatório.' });
  const r = await db.run('INSERT INTO phrases (text, active) VALUES (?,1)', text.trim());
  res.status(201).json({ phrase: await db.get('SELECT * FROM phrases WHERE id=?', r.lastInsertRowid) });
}));

app.patch('/api/phrases/:id', requireAuth, requireAdmin, ah(async (req, res) => {
  const row = await db.get('SELECT * FROM phrases WHERE id=?', req.params.id);
  if (!row) return res.status(404).json({ error: 'Frase não encontrada.' });
  const { text, active } = req.body || {};
  if (text != null) {
    if (!String(text).trim()) return res.status(400).json({ error: 'Texto obrigatório.' });
    await db.run('UPDATE phrases SET text=? WHERE id=?', String(text).trim(), row.id);
  }
  if (active != null) await db.run('UPDATE phrases SET active=? WHERE id=?', active ? 1 : 0, row.id);
  res.json({ phrase: await db.get('SELECT * FROM phrases WHERE id=?', row.id) });
}));

app.delete('/api/phrases/:id', requireAuth, requireAdmin, ah(async (req, res) => {
  await db.run('DELETE FROM phrases WHERE id=?', req.params.id);
  res.json({ ok: true });
}));

// ---------- CALLS ----------
app.get('/api/calls', requireAuth, ah(async (req, res) => {
  const { from, to, seller_id } = req.query;
  let where = '1=1';
  const params = [];
  if (req.user.role !== 'admin' && req.user.role !== 'manager') {
    where += ' AND c.seller_id = ?';
    params.push(req.user.id);
  } else if (seller_id) {
    where += ' AND c.seller_id = ?';
    params.push(seller_id);
  } else if (req.user.role === 'manager') {
    where += ' AND c.seller_id IN (SELECT id FROM users WHERE store_id = ?)';
    params.push(req.user.store_id);
  }
  if (from && isValidDate(from)) { where += ' AND c.date >= ?'; params.push(from); }
  if (to && isValidDate(to)) { where += ' AND c.date <= ?'; params.push(to); }
  const rows = await db.all(
    `SELECT c.*, u.name AS seller_name FROM call_records c JOIN users u ON u.id=c.seller_id WHERE ${where} ORDER BY c.date DESC, c.id DESC LIMIT 500`,
    ...params
  );
  res.json({ calls: rows });
}));

app.post('/api/calls', requireAuth, requireManager, ah(async (req, res) => {
  let { date, quantity, seller_id } = req.body || {};
  date = date || todayISO();
  quantity = Number(quantity);
  if (!isValidDate(date)) return res.status(400).json({ error: 'Data inválida.' });
  if (!Number.isInteger(quantity) || quantity <= 0 || quantity > 2000)
    return res.status(400).json({ error: 'Quantidade deve ser entre 1 e 2000.' });

  if (!seller_id) return res.status(400).json({ error: 'Selecione a vendedora.' });
  const s = await db.get("SELECT * FROM users WHERE id=? AND role='seller' AND active=1", seller_id);
  if (!s) return res.status(400).json({ error: 'Vendedora inválida.' });
  if (req.user.role === 'manager' && Number(s.store_id) !== Number(req.user.store_id))
    return res.status(403).json({ error: 'Você só registra chamadas da sua loja.' });

  const r = await db.run('INSERT INTO call_records (seller_id, date, quantity) VALUES (?,?,?)', s.id, date, quantity);
  const row = await db.get('SELECT * FROM call_records WHERE id=?', r.lastInsertRowid);
  res.status(201).json({ call: row });
}));

app.delete('/api/calls/:id', requireAuth, requireManager, ah(async (req, res) => {
  const row = await db.get(
    'SELECT c.*, u.store_id AS seller_store FROM call_records c JOIN users u ON u.id=c.seller_id WHERE c.id=?', req.params.id
  );
  if (!row) return res.status(404).json({ error: 'Registro não encontrado.' });
  if (req.user.role === 'manager' && Number(row.seller_store) !== Number(req.user.store_id))
    return res.status(403).json({ error: 'Acesso restrito à sua loja.' });
  await db.run('DELETE FROM call_records WHERE id=?', row.id);
  res.json({ ok: true });
}));

// ---------- SALES ----------
async function saleWithParticipants(sale) {
  const parts = await db.all(
    'SELECT sp.*, u.name AS seller_name FROM sale_participants sp JOIN users u ON u.id=sp.seller_id WHERE sp.sale_id=?',
    sale.id
  );
  let store_name = sale.store_name || null;
  if (!store_name && sale.store_id) {
    const st = await getStore(sale.store_id);
    store_name = st ? st.name : null;
  }
  return { ...sale, store_name: store_name || 'Sede', participants: parts };
}

app.get('/api/sales', requireAuth, ah(async (req, res) => {
  const { from, to, seller_id, channel, product, q, store_id } = req.query;
  const scope = scopedStoreId(req, store_id);
  if (scope.error) return res.status(403).json({ error: scope.error });
  const conds = [];
  const params = [];
  if (from && isValidDate(from)) { conds.push('s.sale_date >= ?'); params.push(from); }
  if (to && isValidDate(to)) { conds.push('s.sale_date <= ?'); params.push(to); }
  if (channel && CHANNELS.includes(channel)) { conds.push('s.channel = ?'); params.push(channel); }
  if (product) { conds.push('s.product LIKE ?'); params.push(`%${product}%`); }
  if (q) { conds.push('(s.customer_name LIKE ? OR s.product LIKE ? OR s.color LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (scope.storeId != null) { conds.push('s.store_id = ?'); params.push(scope.storeId); }

  let joinParticipant = '';
  if (seller_id) {
    joinParticipant = 'JOIN sale_participants spf ON spf.sale_id = s.id AND spf.seller_id = ?';
    params.unshift(Number(seller_id));
  } else if (req.user.role !== 'admin' && req.user.role !== 'manager') {
    joinParticipant = 'JOIN sale_participants spf ON spf.sale_id = s.id AND spf.seller_id = ?';
    params.unshift(req.user.id);
  }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  const rows = await db.all(
    `SELECT s.*, cu.name AS creator_name FROM sales s LEFT JOIN users cu ON cu.id=s.created_by ${joinParticipant} ${where} ORDER BY s.sale_date DESC, s.id DESC LIMIT 500`,
    ...params
  );
  res.json({ sales: await Promise.all(rows.map(saleWithParticipants)) });
}));

app.post('/api/sales', requireAuth, requireManager, ah(async (req, res) => {
  const { customer_name, product, color, channel, sale_date, participant_ids, store_id } = req.body || {};
  const date = sale_date || todayISO();
  if (!customer_name?.trim()) return res.status(400).json({ error: 'Nome do cliente é obrigatório.' });
  if (!product?.trim()) return res.status(400).json({ error: 'Produto é obrigatório.' });
  if (!color?.trim()) return res.status(400).json({ error: 'Cor é obrigatória.' });
  if (!CHANNELS.includes(channel)) return res.status(400).json({ error: 'Canal deve ser WhatsApp, CRM ou Presencial.' });
  if (!isValidDate(date)) return res.status(400).json({ error: 'Data inválida.' });
  const pids = [...new Set((participant_ids || []).map(Number).filter(Boolean))];
  if (pids.length < 1) return res.status(400).json({ error: 'Selecione ao menos 1 participante.' });
  if (pids.length > 3) return res.status(400).json({ error: 'Máximo de 3 participantes.' });

  // loja da venda (gerente fica travado na dele; admin usa a informada ou a Sede)
  const scope = scopedStoreId(req, store_id);
  if (scope.error) return res.status(403).json({ error: scope.error });
  let store = scope.storeId != null ? await getStore(scope.storeId) : null;
  if (!store) {
    const sid = await sedeId();
    store = sid ? await getStore(sid) : null;
  }
  if (!store || !store.active) return res.status(400).json({ error: 'Loja inválida.' });

  const placeholders = pids.map(() => '?').join(',');
  const sellers = await db.all(`SELECT * FROM users WHERE id IN (${placeholders}) AND role='seller' AND active=1`, ...pids);
  if (sellers.length !== pids.length) return res.status(400).json({ error: 'Participante inválida ou desativada.' });

  const bonus = parseBonus(req.body);
  if (bonus.error) return res.status(400).json({ error: bonus.error });

  // trava anti-duplicada: mesma data + mesmo cliente/produto/cor + mesmas participantes
  // 1 cadastro com 2 participantes já aparece no histórico das duas (0,5 cada / 1 no geral),
  // então o 2º cadastro da mesma venda deve ser bloqueado.
  const norm = (s) => String(s || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
  const nCustomer = norm(customer_name);
  const nProduct = norm(product);
  const nColor = norm(color);
  const sortedPids = [...pids].sort((a, b) => a - b).join(',');
  const candidates = await db.all(
    'SELECT s.*, cu.name AS creator_name FROM sales s LEFT JOIN users cu ON cu.id=s.created_by WHERE s.sale_date=? LIMIT 500',
    date
  );
  for (const c of candidates) {
    if (norm(c.customer_name) !== nCustomer) continue;
    if (norm(c.product) !== nProduct) continue;
    if (norm(c.color) !== nColor) continue;
    const cParts = await db.all('SELECT seller_id FROM sale_participants WHERE sale_id=?', c.id);
    const cSorted = cParts.map((p) => Number(p.seller_id)).sort((a, b) => a - b).join(',');
    if (cSorted !== sortedPids) continue;
    const who = c.creator_name || 'alguém da equipe';
    const isAdmin = c.created_by !== null && !(await db.get("SELECT id FROM users WHERE id=? AND role='seller'", c.created_by));
    const origem = isAdmin ? 'o admin' : 'sua colega de venda';
    return res.status(409).json({ error: `Essa venda já foi cadastrada por ${who} (${origem}). Não cadastre novamente — ela já aparece no seu histórico.` });
  }

  let credit, perSellerCents;
  try {
    credit = db.creditForParticipants(pids.length);
    perSellerCents = db.commissionCents(sectorsOf(sellers, pids), pids.length, bonus.bonusCents, store.name);
  }
  catch (e) { return res.status(400).json({ error: e.message }); }

  const r = await db.run(
    'INSERT INTO sales (customer_name, product, color, channel, created_by, sale_date, store_id, is_bonus, bonus_cents) VALUES (?,?,?,?,?,?,?,?,?)',
    customer_name.trim(), product.trim(), color.trim(), channel, req.user.id, date, store.id,
    bonus.isBonus ? 1 : 0, bonus.isBonus ? bonus.bonusCents : null
  );
  const saleId = r.lastInsertRowid;
  for (const sid of pids) await db.run('INSERT INTO sale_participants (sale_id, seller_id, credit) VALUES (?,?,?)', saleId, sid, credit);
  await syncCommissions(saleId, pids.map((sid) => ({ seller_id: sid, amount_cents: perSellerCents })), date.slice(0, 7));
  const sale = await db.get('SELECT * FROM sales WHERE id=?', saleId);
  res.status(201).json({ sale: await saleWithParticipants(sale) });
}));

app.put('/api/sales/:id', requireAuth, requireManager, ah(async (req, res) => {
  const sale = await db.get('SELECT * FROM sales WHERE id=?', req.params.id);
  if (!sale) return res.status(404).json({ error: 'Venda não encontrada.' });
  const scope = scopedStoreId(req, sale.store_id);
  if (scope.error) return res.status(403).json({ error: scope.error });
  const { customer_name, product, color, channel, sale_date, participant_ids, store_id } = req.body || {};
  const date = sale_date || sale.sale_date;
  if (!customer_name?.trim()) return res.status(400).json({ error: 'Nome do cliente é obrigatório.' });
  if (!product?.trim()) return res.status(400).json({ error: 'Produto é obrigatório.' });
  if (!color?.trim()) return res.status(400).json({ error: 'Cor é obrigatória.' });
  if (!CHANNELS.includes(channel)) return res.status(400).json({ error: 'Canal deve ser WhatsApp, CRM ou Presencial.' });
  if (!isValidDate(date)) return res.status(400).json({ error: 'Data inválida.' });
  const pids = [...new Set((participant_ids || []).map(Number).filter(Boolean))];
  if (pids.length < 1) return res.status(400).json({ error: 'Selecione ao menos 1 participante.' });
  if (pids.length > 3) return res.status(400).json({ error: 'Máximo de 3 participantes.' });
  const placeholders = pids.map(() => '?').join(',');
  const sellers = await db.all(`SELECT * FROM users WHERE id IN (${placeholders}) AND role='seller' AND active=1`, ...pids);
  if (sellers.length !== pids.length) return res.status(400).json({ error: 'Participante inválida ou desativada.' });

  // loja: gerente não move venda para fora da dele
  let store = await getStore(sale.store_id);
  if (store_id != null && store_id !== '') {
    const sc2 = scopedStoreId(req, store_id);
    if (sc2.error) return res.status(403).json({ error: sc2.error });
    const st2 = await getStore(store_id);
    if (!st2 || !st2.active) return res.status(400).json({ error: 'Loja inválida.' });
    store = st2;
  }
  if (!store) {
    const sid = await sedeId();
    store = sid ? await getStore(sid) : null;
  }
  if (!store) return res.status(400).json({ error: 'Loja inválida.' });

  const bonus = parseBonus(req.body);
  if (bonus.error) return res.status(400).json({ error: bonus.error });
  let credit, perSellerCents;
  try {
    credit = db.creditForParticipants(pids.length);
    perSellerCents = db.commissionCents(sectorsOf(sellers, pids), pids.length, bonus.bonusCents, store.name);
  }
  catch (e) { return res.status(400).json({ error: e.message }); }

  await db.run(
    'UPDATE sales SET customer_name=?, product=?, color=?, channel=?, sale_date=?, store_id=?, is_bonus=?, bonus_cents=?, updated_at=datetime(\'now\') WHERE id=?',
    customer_name.trim(), product.trim(), color.trim(), channel, date, store.id,
    bonus.isBonus ? 1 : 0, bonus.isBonus ? bonus.bonusCents : null, sale.id
  );
  await db.run('DELETE FROM sale_participants WHERE sale_id=?', sale.id);
  for (const sid of pids) await db.run('INSERT INTO sale_participants (sale_id, seller_id, credit) VALUES (?,?,?)', sale.id, sid, credit);
  await syncCommissions(sale.id, pids.map((sid) => ({ seller_id: sid, amount_cents: perSellerCents })), date.slice(0, 7));
  const updated = await db.get('SELECT * FROM sales WHERE id=?', sale.id);
  res.json({ sale: await saleWithParticipants(updated) });
}));

app.delete('/api/sales/:id', requireAuth, requireManager, ah(async (req, res) => {
  const sale = await db.get('SELECT * FROM sales WHERE id=?', req.params.id);
  if (!sale) return res.status(404).json({ error: 'Venda não encontrada.' });
  const scope = scopedStoreId(req, sale.store_id);
  if (scope.error) return res.status(403).json({ error: scope.error });
  // limpa dependências de forma explícita (não depende de FK CASCADE,
  // que não é garantido no modo remoto) e de forma resiliente a
  // bancos criados antes da tabela commissions existir.
  try { await db.run('DELETE FROM commissions WHERE sale_id=?', sale.id); }
  catch (e) { if (!/no such table/i.test(String(e.message))) throw e; }
  await db.run('DELETE FROM sale_participants WHERE sale_id=?', sale.id);
  await db.run('DELETE FROM sales WHERE id=?', sale.id);
  res.json({ ok: true });
}));

// cancelar venda (admin): registra o motivo em canceled_sales e remove a
// venda das listas/totais (vendedoras, ranking, relatório, comissões).
// reason: 'desistencia' | 'outros'. note: observação opcional (máx. 140).
app.post('/api/sales/:id/cancel', requireAuth, requireManager, ah(async (req, res) => {
  const sale = await db.get('SELECT * FROM sales WHERE id=?', req.params.id);
  if (!sale) return res.status(404).json({ error: 'Venda não encontrada.' });
  const scope = scopedStoreId(req, sale.store_id);
  if (scope.error) return res.status(403).json({ error: scope.error });
  const { reason, note } = req.body || {};
  if (!['desistencia', 'outros'].includes(reason))
    return res.status(400).json({ error: 'Escolha o motivo: desistência ou outros.' });
  const cleanNote = String(note || '').trim().slice(0, 140);
  const full = await saleWithParticipants(sale);
  const parts = (full.participants || []).map((p) => ({ seller_id: p.seller_id, seller_name: p.seller_name, credit: Number(p.credit) }));
  await db.run(
    'INSERT INTO canceled_sales (sale_id, customer_name, product, color, channel, sale_date, participants, reason, note, is_bonus, bonus_cents, canceled_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
    sale.id, sale.customer_name, sale.product, sale.color, sale.channel, sale.sale_date,
    JSON.stringify(parts), reason, cleanNote, sale.is_bonus ? 1 : 0, sale.bonus_cents || null, req.user.id
  );
  try { await db.run('DELETE FROM commissions WHERE sale_id=?', sale.id); }
  catch (e) { if (!/no such table/i.test(String(e.message))) throw e; }
  await db.run('DELETE FROM sale_participants WHERE sale_id=?', sale.id);
  await db.run('DELETE FROM sales WHERE id=?', sale.id);
  res.json({ ok: true });
}));

// histórico de vendas canceladas (admin, auditoria)
app.get('/api/sales/canceled', requireAuth, requireAdmin, ah(async (req, res) => {
  const rows = await db.all(
    `SELECT c.*, u.name AS canceled_by_name FROM canceled_sales c
     LEFT JOIN users u ON u.id=c.canceled_by ORDER BY c.id DESC LIMIT 200`
  );
  res.json({ canceled: rows.map((r) => ({ ...r, participants: JSON.parse(r.participants || '[]') })) });
}));

// ---------- MANUTENÇÃO: arquivo 90+ dias (manual, só admin) ----------
// Arquiva (não apaga): vendas, chamadas e canceladas somem das listas/totais
// mas ficam consultáveis. Pagamentos (payouts) nunca são tocados.
const ARCHIVE_DAYS = 90;
const archiveCutoff = () => new Date(Date.now() - ARCHIVE_DAYS * 864e5).toISOString().slice(0, 10);

app.get('/api/maintenance/status', requireAuth, requireAdmin, ah(async (req, res) => {
  const cutoff = archiveCutoff();
  const s = await db.get('SELECT COUNT(*) AS c FROM sales WHERE sale_date < ?', cutoff);
  const c = await db.get('SELECT COUNT(*) AS c FROM call_records WHERE date < ?', cutoff);
  const x = await db.get('SELECT COUNT(*) AS c FROM canceled_sales WHERE sale_date < ?', cutoff);
  const a = await db.get('SELECT COUNT(*) AS c FROM archived_sales');
  res.json({
    cutoff, days: ARCHIVE_DAYS,
    sales: Number(s.c), calls: Number(c.c), canceled: Number(x.c),
    archived_sales: Number(a.c),
  });
}));

app.post('/api/maintenance/archive', requireAuth, requireAdmin, ah(async (req, res) => {
  const cutoff = archiveCutoff();
  const BATCH = 2000;
  let nSales = 0, nCalls = 0, nCanceled = 0;
  const oldSales = await db.all('SELECT * FROM sales WHERE sale_date < ? ORDER BY sale_date LIMIT ?', cutoff, BATCH);
  for (const sale of oldSales) {
    const full = await saleWithParticipants(sale);
    const parts = (full.participants || []).map((p) => ({ seller_id: p.seller_id, seller_name: p.seller_name, credit: Number(p.credit) }));
    const comms = await db.all('SELECT seller_id, month, amount_cents FROM commissions WHERE sale_id=?', sale.id);
    await db.run(
      'INSERT INTO archived_sales (sale_id, customer_name, product, color, channel, sale_date, is_bonus, bonus_cents, participants, commissions, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      sale.id, sale.customer_name, sale.product, sale.color, sale.channel, sale.sale_date,
      sale.is_bonus ? 1 : 0, sale.bonus_cents || null, JSON.stringify(parts), JSON.stringify(comms.map((c) => ({ ...c, amount_cents: Number(c.amount_cents) }))),
      sale.created_by, sale.created_at
    );
    try { await db.run('DELETE FROM commissions WHERE sale_id=?', sale.id); }
    catch (e) { if (!/no such table/i.test(String(e.message))) throw e; }
    await db.run('DELETE FROM sale_participants WHERE sale_id=?', sale.id);
    await db.run('DELETE FROM sales WHERE id=?', sale.id);
    nSales++;
  }
  const oldCalls = await db.all(
    'SELECT cr.*, u.name AS seller_name FROM call_records cr LEFT JOIN users u ON u.id=cr.seller_id WHERE cr.date < ? LIMIT ?', cutoff, BATCH
  );
  for (const c of oldCalls) {
    await db.run('INSERT INTO archived_calls (call_id, seller_id, seller_name, date, quantity) VALUES (?,?,?,?,?)',
      c.id, c.seller_id, c.seller_name || '', c.date, c.quantity);
    await db.run('DELETE FROM call_records WHERE id=?', c.id);
    nCalls++;
  }
  const oldCanc = await db.all('SELECT * FROM canceled_sales WHERE sale_date < ? LIMIT ?', cutoff, BATCH);
  for (const x of oldCanc) {
    await db.run(
      'INSERT INTO archived_canceled (sale_id, customer_name, product, color, channel, sale_date, participants, reason, note, is_bonus, bonus_cents, canceled_by, canceled_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
      x.sale_id, x.customer_name, x.product, x.color, x.channel, x.sale_date, x.participants || '[]',
      x.reason || 'outros', x.note || '', x.is_bonus ? 1 : 0, x.bonus_cents || null, x.canceled_by || null, x.canceled_at || null
    );
    await db.run('DELETE FROM canceled_sales WHERE id=?', x.id);
    nCanceled++;
  }
  res.json({ ok: true, cutoff, truncated: oldSales.length >= BATCH || oldCalls.length >= BATCH, archived: { sales: nSales, calls: nCalls, canceled: nCanceled } });
}));

// saúde do banco (admin, só leitura): tabelas, colunas, checks e ledger de migrações.
// Serve para inspecionar o banco de produção pelo navegador, sem adivinhar.
app.get('/api/maintenance/db-health', requireAuth, requireAdmin, ah(async (req, res) => {
  const tables = ['users', 'stores', 'sales', 'sale_participants', 'commissions', 'payouts',
    'seller_goals', 'phrases', 'seller_settings', 'daily_phrases', 'ponto_config', 'holidays',
    'punches', 'canceled_sales', 'archived_sales', 'archived_calls', 'archived_canceled',
    'holiday_skips', 'migrations'];
  const health = {};
  for (const t of tables) {
    try {
      const cols = await db.all(`SELECT name FROM pragma_table_info('${t}')`);
      const row = await db.get("SELECT sql FROM sqlite_master WHERE type='table' AND name=?", t);
      health[t] = { columns: cols.map((c) => c.name), has_manager_role: t === 'users' ? !!(row && row.sql && row.sql.includes('manager')) : undefined };
    } catch (e) { health[t] = { error: String(e.message).slice(0, 200) }; }
  }
  let ledger = [];
  try { ledger = await db.all('SELECT * FROM migrations ORDER BY name'); } catch {}
  const counts = {};
  for (const [k, sql] of [
    ['users', 'SELECT COUNT(*) AS c FROM users'],
    ['sales', 'SELECT COUNT(*) AS c FROM sales'],
    ['sale_participants', 'SELECT COUNT(*) AS c FROM sale_participants'],
    ['commissions', 'SELECT COUNT(*) AS c FROM commissions'],
    ['punches', 'SELECT COUNT(*) AS c FROM punches'],
  ]) {
    try { counts[k] = Number((await db.get(sql)).c); }
    catch (e) { counts[k] = 'erro: ' + String(e.message).slice(0, 120); }
  }
  res.json({ health, migrations: ledger, counts });
}));

// verificação retroativa (admin, só leitura): recalcula a comissão de cada venda
// ativa pela regra atual (loja+setor+bônus) e compara com o gravado.
// Não altera nada — só relata divergências, se houver.
app.get('/api/maintenance/verify-commissions', requireAuth, requireAdmin, ah(async (req, res) => {
  const sales = await db.all('SELECT * FROM sales ORDER BY id LIMIT 2000');
  const diffs = [];
  let checked = 0;
  for (const sale of sales) {
    const parts = await db.all(
      'SELECT sp.*, u.sector FROM sale_participants sp JOIN users u ON u.id=sp.seller_id WHERE sp.sale_id=?', sale.id
    );
    if (!parts.length) continue;
    const store = sale.store_id ? await getStore(sale.store_id) : null;
    const storeName = store ? store.name : 'Sede';
    let expected;
    try {
      expected = db.commissionCents(
        parts.map((p) => p.sector || 'online'), parts.length,
        sale.is_bonus ? sale.bonus_cents : null, storeName
      );
    } catch { continue; }
    const actual = await db.all('SELECT * FROM commissions WHERE sale_id=?', sale.id);
    const bySeller = Object.fromEntries(actual.map((c) => [c.seller_id, Number(c.amount_cents)]));
    for (const p of parts) {
      checked++;
      if (bySeller[p.seller_id] == null || bySeller[p.seller_id] !== expected) {
        diffs.push({ sale_id: sale.id, sale_date: sale.sale_date, customer: sale.customer_name, store: storeName, seller_id: p.seller_id, expected_cents: expected, actual_cents: bySeller[p.seller_id] ?? null });
      }
    }
    if (diffs.length >= 100) break;
  }
  res.json({ checked, diffs: diffs.slice(0, 100), ok: diffs.length === 0 });
}));

// consulta ao arquivo (admin, só leitura)
app.get('/api/maintenance/archive', requireAuth, requireAdmin, ah(async (req, res) => {
  const { q, from, to } = req.query;
  const conds = [];
  const params = [];
  if (q) { conds.push('(customer_name LIKE ? OR product LIKE ?)'); params.push(`%${q}%`, `%${q}%`); }
  if (from) { conds.push('sale_date >= ?'); params.push(from); }
  if (to) { conds.push('sale_date <= ?'); params.push(to); }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  const rows = await db.all(`SELECT * FROM archived_sales ${where} ORDER BY sale_date DESC, id DESC LIMIT 200`, ...params);
  res.json({ sales: rows.map((r) => ({ ...r, participants: JSON.parse(r.participants || '[]'), commissions: JSON.parse(r.commissions || '[]') })) });
}));

// ---------- COMISSÕES (online 25/12,50 • presencial 35/17,50 • bônus = valor exclusivo) ----------
// parts: [{seller_id, amount_cents}]
async function syncCommissions(saleId, parts, month) {
  await db.run('DELETE FROM commissions WHERE sale_id=?', saleId);
  for (const p of parts) {
    const cents = Math.round(Number(p.amount_cents));
    if (!Number.isFinite(cents) || cents <= 0) throw new Error('Comissão inválida.');
    await db.run('INSERT INTO commissions (sale_id, seller_id, month, amount_cents) VALUES (?,?,?,?) ON CONFLICT(sale_id, seller_id) DO UPDATE SET month=excluded.month, amount_cents=excluded.amount_cents',
      saleId, p.seller_id, month, cents);
  }
}
async function pendingCents(sellerId) {
  const c = await db.get('SELECT COALESCE(SUM(amount_cents),0) AS t FROM commissions WHERE seller_id=?', sellerId);
  const p = await db.get('SELECT COALESCE(SUM(amount_cents),0) AS t FROM payouts WHERE seller_id=?', sellerId);
  return Number(c.t) - Number(p.t);
}

// saldo da vendedora logada
app.get('/api/commissions/me', requireAuth, ah(async (req, res) => {
  if (req.user.role !== 'seller') return res.status(403).json({ error: 'Recurso da vendedora.' });
  const month = (req.query.month && /^\d{4}-\d{2}$/.test(req.query.month)) ? req.query.month : todayISO().slice(0, 7);
  const m = await db.get('SELECT COALESCE(SUM(amount_cents),0) AS t FROM commissions WHERE seller_id=? AND month=?', req.user.id, month);
  res.json({ month, month_cents: Number(m.t), pending_cents: await pendingCents(req.user.id) });
}));

// resumo por vendedora (admin)
app.get('/api/commissions/summary', requireAuth, requireManager, ah(async (req, res) => {
  const month = (req.query.month && /^\d{4}-\d{2}$/.test(req.query.month)) ? req.query.month : todayISO().slice(0, 7);
  const { sector, store_id } = req.query;
  const scope = scopedStoreId(req, store_id);
  if (scope.error) return res.status(403).json({ error: scope.error });
  const sectorFilter = validSector(sector) ? ' AND COALESCE(u.sector,\'online\')=?' : '';
  const storeFilter = scope.storeId != null ? ' AND u.store_id=?' : '';
  const sellers = await db.all(
    `SELECT u.*, s.name AS store_name FROM users u LEFT JOIN stores s ON s.id=u.store_id WHERE u.role='seller'${sectorFilter}${storeFilter} ORDER BY u.name`,
    ...(validSector(sector) ? [sector] : []), ...(scope.storeId != null ? [scope.storeId] : [])
  );
  const rows = await Promise.all(sellers.map(async (s) => {
    const m = await db.get('SELECT COALESCE(SUM(amount_cents),0) AS t FROM commissions WHERE seller_id=? AND month=?', s.id, month);
    const pm = await db.get('SELECT COALESCE(SUM(amount_cents),0) AS t FROM payouts WHERE seller_id=? AND month=?', s.id, month);
    return {
      seller_id: s.id, name: s.name, sector: s.sector || 'online', store_id: s.store_id, store_name: s.store_name || 'Sede',
      active: !!s.active, avatar_url: s.avatar_url || null,
      month_cents: Number(m.t), paid_month_cents: Number(pm.t),
      pending_cents: await pendingCents(s.id),
    };
  }));
  const tot = (k) => rows.reduce((a, r) => a + r[k], 0);
  res.json({ month, sector: validSector(sector) ? sector : 'all', rows, total_month_cents: tot('month_cents'), total_pending_cents: tot('pending_cents') });
}));

// histórico de pagamentos (admin)
app.get('/api/commissions/payouts', requireAuth, requireManager, ah(async (req, res) => {
  const { month, seller_id } = req.query;
  const conds = [];
  const params = [];
  if (month && /^\d{4}-\d{2}$/.test(month)) { conds.push('p.month=?'); params.push(month); }
  if (seller_id) { conds.push('p.seller_id=?'); params.push(Number(seller_id)); }
  else if (req.user.role === 'manager') { conds.push('p.seller_id IN (SELECT id FROM users WHERE store_id=?)'); params.push(req.user.store_id); }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  const rows = await db.all(
    `SELECT p.*, u.name AS seller_name, a.name AS by_name FROM payouts p
     JOIN users u ON u.id=p.seller_id LEFT JOIN users a ON a.id=p.created_by ${where}
     ORDER BY p.id DESC LIMIT 200`, ...params
  );
  res.json({ payouts: rows });
}));

// registrar pagamento (admin)
app.post('/api/commissions/payouts', requireAuth, requireManager, ah(async (req, res) => {
  const { seller_id, amount_cents, month } = req.body || {};
  const seller = await db.get("SELECT * FROM users WHERE id=? AND role='seller'", Number(seller_id));
  if (!seller) return res.status(400).json({ error: 'Vendedora inválida.' });
  if (req.user.role === 'manager' && Number(seller.store_id) !== Number(req.user.store_id))
    return res.status(403).json({ error: 'Acesso restrito à sua loja.' });
  const cents = Math.round(Number(amount_cents));
  if (!Number.isFinite(cents) || cents <= 0) return res.status(400).json({ error: 'Valor inválido.' });
  const m = (month && /^\d{4}-\d{2}$/.test(month)) ? month : todayISO().slice(0, 7);
  const pend = await pendingCents(seller.id);
  if (cents > pend) return res.status(400).json({ error: `Valor maior que o pendente (${(pend / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}).` });
  const r = await db.run('INSERT INTO payouts (seller_id, month, amount_cents, created_by) VALUES (?,?,?,?)',
    seller.id, m, cents, req.user.id);
  res.status(201).json({ payout: await db.get('SELECT * FROM payouts WHERE id=?', r.lastInsertRowid), pending_cents: pend - cents });
}));

// ---------- PONTO (QR + localização) ----------
// Padrão do dia em minutos: seg–sex 600 (8–18), sáb 540 (8–17), dom 240 (8–12), feriado 300 (8–13)
function stdMinutesFor(dateISO, isHoliday) {
  if (isHoliday) return 300;
  const dow = new Date(dateISO + 'T12:00:00Z').getUTCDay();
  if (dow === 0) return 240;
  if (dow === 6) return 540;
  return 600;
}
const fmtDur = (min) => `${Math.floor(min / 60)}h ${min % 60}min`;
// minutos do dia em São Paulo (UTC-3) a partir de ISO
function spMinOfISO(iso) {
  const ms = Date.parse(iso);
  if (isNaN(ms)) return null;
  return Math.floor(ms / 60000 - 180) % 1440;
}
function hhmmFromISO(iso) {
  const m = spMinOfISO(iso);
  if (m == null) return '—';
  const hh = String(Math.floor(m / 60)).padStart(2, '0');
  const mm = String(m % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}
function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
function punchCalc(p, isHoliday) {
  const std = stdMinutesFor(p.date, isHoliday);
  let worked = null;
  let extra = 0;
  if (p.check_in_at && p.check_out_at) {
    worked = Math.max(0, Math.round((Date.parse(p.check_out_at) - Date.parse(p.check_in_at)) / 60000));
    extra = Math.max(0, worked - std);
  }
  return {
    ...p,
    in_hhmm: p.check_in_at ? hhmmFromISO(p.check_in_at) : null,
    out_hhmm: p.check_out_at ? hhmmFromISO(p.check_out_at) : null,
    std_min: std,
    std_label: fmtDur(std),
    worked_min: worked,
    worked_label: worked == null ? null : fmtDur(worked),
    extra_min: extra,
    extra_label: fmtDur(extra),
  };
}
async function getPontoConfig() {
  let cfg = await db.get('SELECT * FROM ponto_config WHERE id=1');
  if (!cfg) {
    await db.run("INSERT INTO ponto_config (id, store_name, radius_m, qr_code) VALUES (1,'Loja',150,'PONTO-LOJA-01') ON CONFLICT(id) DO NOTHING");
    cfg = await db.get('SELECT * FROM ponto_config WHERE id=1');
  }
  return cfg;
}

// config da loja (admin)
app.get('/api/ponto/config', requireAuth, requireAdmin, ah(async (req, res) => {
  res.json({ config: await getPontoConfig() });
}));
app.put('/api/ponto/config', requireAuth, requireAdmin, ah(async (req, res) => {
  const { store_name, lat, lng, radius_m } = req.body || {};
  const cfg = await getPontoConfig();
  const nLat = lat === null || lat === undefined || lat === '' ? null : Number(lat);
  const nLng = lng === null || lng === undefined || lng === '' ? null : Number(lng);
  const nRad = Number(radius_m);
  if (nLat != null && (!Number.isFinite(nLat) || nLat < -90 || nLat > 90)) return res.status(400).json({ error: 'Latitude inválida.' });
  if (nLng != null && (!Number.isFinite(nLng) || nLng < -180 || nLng > 180)) return res.status(400).json({ error: 'Longitude inválida.' });
  if (!Number.isFinite(nRad) || nRad < 30 || nRad > 2000) return res.status(400).json({ error: 'Raio deve ser entre 30 e 2000 metros.' });
  await db.run('UPDATE ponto_config SET store_name=?, lat=?, lng=?, radius_m=?, updated_at=datetime(\'now\') WHERE id=1',
    String(store_name || cfg.store_name || 'Loja').slice(0, 80), nLat, nLng, Math.round(nRad));
  res.json({ config: await getPontoConfig() });
}));

// QR para impressão (admin) — imagem + código manual
app.get('/api/ponto/qr', requireAuth, requireAdmin, ah(async (req, res) => {
  const cfg = await getPontoConfig();
  const qrImage = await QRCode.toDataURL(String(cfg.qr_code), { width: 600, margin: 2 });
  res.json({ qr_code: cfg.qr_code, qrImage, store_name: cfg.store_name });
}));

// QRs de todas as lojas p/ impressão (admin vê todas; gerente só a dele)
app.get('/api/stores/qr', requireAuth, requireManager, ah(async (req, res) => {
  let rows = [];
  try { rows = await db.all('SELECT * FROM stores WHERE active=1 ORDER BY id'); }
  catch { return res.json({ stores: [] }); }
  if (req.user.role === 'manager') rows = rows.filter((s) => Number(s.id) === Number(req.user.store_id));
  const out = await Promise.all(rows.map(async (s) => ({
    id: s.id, name: s.name, short: s.short, qr_code: s.qr_code,
    lat: s.lat, lng: s.lng, radius_m: s.radius_m,
    qrImage: await QRCode.toDataURL(String(s.qr_code), { width: 600, margin: 2 }),
  })));
  res.json({ stores: out });
}));

// bater ponto (vendedora): QR da loja + GPS; tipo automático (entrada → saída)
app.post('/api/ponto/bater', requireAuth, ah(async (req, res) => {
  if (req.user.role !== 'seller') return res.status(403).json({ error: 'Recurso da vendedora.' });
  const { qr_code, lat, lng, accuracy } = req.body || {};
  const code = String(qr_code || '').trim().toUpperCase();
  // QR identifica a loja (Sede, Magé, Guapimirim)
  let stores = [];
  try { stores = await db.all('SELECT * FROM stores WHERE active=1'); } catch {}
  let store = stores.find((s) => String(s.qr_code).trim().toUpperCase() === code) || null;
  if (!store) {
    // compatibilidade: QR legado da sede
    try {
      const cfg = await getPontoConfig();
      if (code === String(cfg.qr_code).trim().toUpperCase())
        store = { id: await sedeId(), name: cfg.store_name || 'Sede', lat: cfg.lat, lng: cfg.lng, radius_m: cfg.radius_m || 150 };
    } catch {}
  }
  if (!store) return res.status(400).json({ error: 'QR inválido. Escaneie o QR da loja.' });
  const nLat = Number(lat);
  const nLng = Number(lng);
  if (!Number.isFinite(nLat) || !Number.isFinite(nLng)) return res.status(400).json({ error: 'Ative a localização para bater o ponto.' });
  if (store.lat == null || store.lng == null) return res.status(500).json({ error: `Loja ${store.name} sem localização cadastrada. Fale com o admin.` });
  const acc = accuracy == null || accuracy === '' ? null : Number(accuracy);
  if (acc != null && Number.isFinite(acc) && acc > 200)
    return res.status(400).json({ error: 'Sinal de GPS fraco. Aproxime-se da entrada e tente de novo.' });
  const dist = haversineM(nLat, nLng, Number(store.lat), Number(store.lng));
  if (dist > Number(store.radius_m || 150))
    return res.status(403).json({ error: `Você está a ${Math.round(dist)}m da loja ${store.name} (raio ${store.radius_m}m). Aproxime-se para bater o ponto.` });
  const today = todayISO();
  const now = new Date().toISOString();
  let p = await db.get('SELECT * FROM punches WHERE seller_id=? AND date=?', req.user.id, today);
  if (!p) {
    await db.run('INSERT INTO punches (seller_id, store_id, date, check_in_at, check_in_lat, check_in_lng, check_in_acc) VALUES (?,?,?,?,?,?,?)',
      req.user.id, store.id, today, now, nLat, nLng, acc);
    p = await db.get('SELECT * FROM punches WHERE seller_id=? AND date=?', req.user.id, today);
    const hol = await db.get('SELECT * FROM holidays WHERE date=?', today);
    return res.status(201).json({ type: 'in', store: store.name, punch: punchCalc(p, !!hol), distance_m: Math.round(dist) });
  }
  if (p.check_in_at && !p.check_out_at) {
    if (Date.parse(now) - Date.parse(p.check_in_at) < 3 * 60000)
      return res.status(409).json({ error: 'Entrada registrada agora mesmo. Aguarde alguns minutos antes da saída.' });
    await db.run('UPDATE punches SET check_out_at=?, check_out_lat=?, check_out_lng=?, check_out_acc=?, updated_at=datetime(\'now\') WHERE id=?',
      now, nLat, nLng, acc, p.id);
    p = await db.get('SELECT * FROM punches WHERE id=?', p.id);
    const hol = await db.get('SELECT * FROM holidays WHERE date=?', today);
    return res.json({ type: 'out', punch: punchCalc(p, !!hol), distance_m: Math.round(dist) });
  }
  return res.status(409).json({ error: 'Dia já encerrado (entrada e saída registradas).' });
}));

// ponto de hoje (vendedora)
app.get('/api/ponto/hoje', requireAuth, ah(async (req, res) => {
  if (req.user.role !== 'seller') return res.status(403).json({ error: 'Recurso da vendedora.' });
  const today = todayISO();
  const p = await db.get('SELECT * FROM punches WHERE seller_id=? AND date=?', req.user.id, today);
  const hol = await db.get('SELECT * FROM holidays WHERE date=?', today);
  res.json({ date: today, punch: p ? punchCalc(p, !!hol) : null, is_holiday: !!hol });
}));

// relatório do dia (admin/gerente) + feriado automático
app.get('/api/ponto/dia', requireAuth, requireManager, ah(async (req, res) => {
  const date = req.query.date || todayISO();
  const { store_id } = req.query;
  if (!isValidDate(date)) return res.status(400).json({ error: 'Data inválida.' });
  const scope = scopedStoreId(req, store_id);
  if (scope.error) return res.status(403).json({ error: scope.error });
  let hol = await db.get('SELECT * FROM holidays WHERE date=?', date);
  const sellers = await db.all(
    `SELECT u.*, s.name AS store_name FROM users u LEFT JOIN stores s ON s.id=u.store_id WHERE u.role='seller' AND u.active=1${scope.storeId != null ? ' AND u.store_id=?' : ''} ORDER BY u.name`,
    ...(scope.storeId != null ? [scope.storeId] : [])
  );
  const storeNames = {};
  const punchStore = async (p) => {
    if (!p || !p.store_id) return 'Sede';
    if (!storeNames[p.store_id]) {
      const st = await getStore(p.store_id);
      storeNames[p.store_id] = st ? st.name : 'Sede';
    }
    return storeNames[p.store_id];
  };
  const buildRows = async (isHol) => Promise.all(sellers.map(async (s) => {
    const p = await db.get('SELECT * FROM punches WHERE seller_id=? AND date=?', s.id, date);
    return {
      seller_id: s.id, name: s.name, sector: s.sector || 'online',
      store_id: s.store_id, store_name: s.store_name || 'Sede', avatar_url: s.avatar_url || null,
      punch: p ? { ...punchCalc(p, isHol), punch_store: await punchStore(p) } : null,
    };
  }));
  let rows = await buildRows(!!hol);
  // feriado automático: seg–sáb (ainda não marcado, sem veto do admin) com
  // maioria saindo 12:30–13:30 → marca sozinho (idempotente).
  let auto_holiday = false;
  const dow = new Date(date + 'T12:00:00Z').getUTCDay();
  const skipped = await db.get('SELECT 1 AS x FROM holiday_skips WHERE date=?', date).catch(() => null);
  if (!hol && dow !== 0 && !skipped) {
    const outs = rows.map((r) => r.punch?.check_out_at).filter(Boolean).map(spMinOfISO).filter((m) => m != null);
    const inWindow = outs.filter((m) => m >= 750 && m <= 810).length; // 12:30–13:30 SP
    const base = rows.filter((r) => r.punch).length;
    if ((inWindow >= 3 || (base >= 3 && inWindow / base >= 0.6))) {
      await db.run('INSERT INTO holidays (date, label) VALUES (?,?) ON CONFLICT(date) DO NOTHING', date, 'Feriado (auto)');
      hol = await db.get('SELECT * FROM holidays WHERE date=?', date);
      auto_holiday = true;
      rows = await buildRows(true);
    }
  }
  const present = rows.filter((r) => r.punch).length;
  const absent = rows.length - present;
  res.json({ date, is_holiday: !!hol, holiday: hol || null, auto_holiday, present, absent, rows });
}));

// feriados (admin)
app.get('/api/ponto/feriados', requireAuth, requireAdmin, ah(async (req, res) => {
  const { month } = req.query;
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    return res.json({ holidays: await db.all('SELECT * FROM holidays WHERE date LIKE ? ORDER BY date', `${month}%`) });
  }
  res.json({ holidays: await db.all('SELECT * FROM holidays ORDER BY date DESC LIMIT 100') });
}));
app.post('/api/ponto/feriados', requireAuth, requireAdmin, ah(async (req, res) => {
  const { date, label } = req.body || {};
  if (!isValidDate(date)) return res.status(400).json({ error: 'Data inválida.' });
  await db.run('INSERT INTO holidays (date, label) VALUES (?,?) ON CONFLICT(date) DO UPDATE SET label=excluded.label',
    date, String(label || 'Feriado').slice(0, 80));
  try { await db.run('DELETE FROM holiday_skips WHERE date=?', date); } catch {}
  res.status(201).json({ holiday: await db.get('SELECT * FROM holidays WHERE date=?', date) });
}));
app.delete('/api/ponto/feriados/:date', requireAuth, requireAdmin, ah(async (req, res) => {
  await db.run('DELETE FROM holidays WHERE date=?', req.params.date);
  // veta a detecção automática de remarcar sozinha (admin mandou não ser feriado)
  try { await db.run('INSERT INTO holiday_skips (date) VALUES (?) ON CONFLICT(date) DO NOTHING', req.params.date); } catch {}
  res.json({ ok: true });
}));

// resumo mensal de extras (admin/gerente)
app.get('/api/ponto/resumo', requireAuth, requireManager, ah(async (req, res) => {
  const month = req.query.month || todayISO().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'Mês inválido.' });
  const scope = scopedStoreId(req, req.query.store_id);
  if (scope.error) return res.status(403).json({ error: scope.error });
  const sellers = await db.all(
    `SELECT * FROM users WHERE role='seller' AND active=1${scope.storeId != null ? ' AND store_id=?' : ''} ORDER BY name`,
    ...(scope.storeId != null ? [scope.storeId] : [])
  );
  const hols = await db.all('SELECT date FROM holidays WHERE date LIKE ?', `${month}%`);
  const holSet = new Set(hols.map((h) => h.date));
  const rows = await Promise.all(sellers.map(async (s) => {
    const ps = await db.all('SELECT * FROM punches WHERE seller_id=? AND date LIKE ? ORDER BY date', s.id, `${month}%`);
    let extra = 0, worked = 0, days = 0;
    for (const p of ps) {
      const c = punchCalc(p, holSet.has(p.date));
      if (c.worked_min != null) { worked += c.worked_min; extra += c.extra_min; days += 1; }
    }
    return {
      seller_id: s.id, name: s.name, sector: s.sector || 'online', avatar_url: s.avatar_url || null,
      days, worked_min: worked, worked_label: fmtDur(worked),
      extra_min: extra, extra_label: fmtDur(extra),
    };
  }));
  rows.sort((a, b) => b.extra_min - a.extra_min);
  res.json({ month, rows, total_extra_min: rows.reduce((a, r) => a + r.extra_min, 0), total_extra_label: fmtDur(rows.reduce((a, r) => a + r.extra_min, 0)) });
}));

// correção manual (admin/gerente): HH:MM no horário de SP
app.put('/api/ponto/:id', requireAuth, requireManager, ah(async (req, res) => {
  const p = await db.get(
    'SELECT pu.*, u.store_id AS seller_store FROM punches pu JOIN users u ON u.id=pu.seller_id WHERE pu.id=?', req.params.id
  );
  if (!p) return res.status(404).json({ error: 'Registro não encontrado.' });
  if (req.user.role === 'manager' && Number(p.seller_store) !== Number(req.user.store_id))
    return res.status(403).json({ error: 'Acesso restrito à sua loja.' });
  const { check_in_hhmm, check_out_hhmm } = req.body || {};
  const okHHMM = (s) => s === '' || s == null || /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
  if (!okHHMM(check_in_hhmm) || !okHHMM(check_out_hhmm)) return res.status(400).json({ error: 'Horário inválido (use HH:MM).' });
  if (!check_in_hhmm) return res.status(400).json({ error: 'Entrada é obrigatória.' });
  const toISO = (hhmm) => new Date(`${p.date}T${hhmm}:00-03:00`).toISOString();
  const inISO = toISO(check_in_hhmm);
  const outISO = check_out_hhmm ? toISO(check_out_hhmm) : null;
  if (outISO && Date.parse(outISO) <= Date.parse(inISO)) return res.status(400).json({ error: 'Saída deve ser depois da entrada.' });
  await db.run('UPDATE punches SET check_in_at=?, check_out_at=?, updated_at=datetime(\'now\') WHERE id=?', inISO, outISO, p.id);
  const hol = await db.get('SELECT * FROM holidays WHERE date=?', p.date);
  res.json({ punch: punchCalc(await db.get('SELECT * FROM punches WHERE id=?', p.id), !!hol) });
}));

// lançamento manual / contingência (admin/gerente): cria ou ajusta o dia sem QR/GPS
app.post('/api/ponto/manual', requireAuth, requireManager, ah(async (req, res) => {
  const { seller_id, date, check_in_hhmm, check_out_hhmm, store_id } = req.body || {};
  const seller = await db.get("SELECT * FROM users WHERE id=? AND role='seller'", Number(seller_id));
  if (!seller) return res.status(400).json({ error: 'Vendedora inválida.' });
  if (req.user.role === 'manager' && Number(seller.store_id) !== Number(req.user.store_id))
    return res.status(403).json({ error: 'Acesso restrito à sua loja.' });
  const scope = scopedStoreId(req, store_id);
  if (scope.error) return res.status(403).json({ error: scope.error });
  const punchStoreId = scope.storeId != null ? scope.storeId : (seller.store_id || await sedeId());
  const d = date || todayISO();
  if (!isValidDate(d)) return res.status(400).json({ error: 'Data inválida.' });
  const okHHMM = (s) => s === '' || s == null || /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
  if (!okHHMM(check_in_hhmm) || !okHHMM(check_out_hhmm)) return res.status(400).json({ error: 'Horário inválido (use HH:MM).' });
  if (!check_in_hhmm) return res.status(400).json({ error: 'Entrada é obrigatória.' });
  const toISO = (hhmm) => new Date(`${d}T${hhmm}:00-03:00`).toISOString();
  const inISO = toISO(check_in_hhmm);
  const outISO = check_out_hhmm ? toISO(check_out_hhmm) : null;
  if (outISO && Date.parse(outISO) <= Date.parse(inISO)) return res.status(400).json({ error: 'Saída deve ser depois da entrada.' });
  await db.run(
    `INSERT INTO punches (seller_id, store_id, date, check_in_at, check_out_at) VALUES (?,?,?,?,?)
     ON CONFLICT(seller_id, date) DO UPDATE SET store_id=excluded.store_id, check_in_at=excluded.check_in_at, check_out_at=excluded.check_out_at, updated_at=datetime('now')`,
    seller.id, punchStoreId, d, inISO, outISO
  );
  const hol = await db.get('SELECT * FROM holidays WHERE date=?', d);
  res.status(201).json({ punch: punchCalc(await db.get('SELECT * FROM punches WHERE seller_id=? AND date=?', seller.id, d), !!hol) });
}));

// ---------- STATS ----------
async function summarize(from, to, sellerId, storeId) {
  const p = [];
  let callWhere = '1=1';
  if (from) { callWhere += ' AND date >= ?'; p.push(from); }
  if (to) { callWhere += ' AND date <= ?'; p.push(to); }
  let calls = 0;
  if (sellerId) {
    const r = await db.get(`SELECT COALESCE(SUM(quantity),0) AS t FROM call_records WHERE seller_id=? AND ${callWhere}`, sellerId, ...p);
    calls = Number(r.t);
  } else if (storeId != null) {
    const r = await db.get(`SELECT COALESCE(SUM(quantity),0) AS t FROM call_records WHERE seller_id IN (SELECT id FROM users WHERE store_id=?) AND ${callWhere}`, storeId, ...p);
    calls = Number(r.t);
  } else {
    const r = await db.get(`SELECT COALESCE(SUM(quantity),0) AS t FROM call_records WHERE ${callWhere}`, ...p);
    calls = Number(r.t);
  }

  const sp = [];
  let saleWhere = '1=1';
  if (from) { saleWhere += ' AND s.sale_date >= ?'; sp.push(from); }
  if (to) { saleWhere += ' AND s.sale_date <= ?'; sp.push(to); }
  if (storeId != null) { saleWhere += ' AND s.store_id = ?'; sp.push(storeId); }
  const creditSel = 'SELECT COALESCE(SUM(sp.credit),0) AS t FROM sale_participants sp JOIN sales s ON s.id=sp.sale_id WHERE ' + saleWhere;
  const creditParams = [...sp];
  if (sellerId) { creditParams.push(sellerId); }
  const withSeller = (sel) => sellerId ? sel + ' AND sp.seller_id=?' : sel;

  const credit = Number((await db.get(withSeller(creditSel), ...creditParams)).t);
  const waSel = withSeller(creditSel.replace('sp.credit', "CASE WHEN s.channel='WhatsApp' THEN sp.credit ELSE 0 END"));
  const crmSel = withSeller(creditSel.replace('sp.credit', "CASE WHEN s.channel='CRM' THEN sp.credit ELSE 0 END"));
  const presSel = withSeller(creditSel.replace('sp.credit', "CASE WHEN s.channel='Presencial' THEN sp.credit ELSE 0 END"));
  const wa = Number((await db.get(waSel, ...creditParams)).t);
  const crm = Number((await db.get(crmSel, ...creditParams)).t);
  const presencial = Number((await db.get(presSel, ...creditParams)).t);

  let countSel;
  let countParams;
  if (sellerId) {
    countSel = 'SELECT COUNT(DISTINCT s.id) AS t FROM sales s JOIN sale_participants sp ON sp.sale_id=s.id AND sp.seller_id=? WHERE ' + saleWhere;
    countParams = [sellerId, ...sp];
  } else {
    countSel = 'SELECT COUNT(DISTINCT s.id) AS t FROM sales s WHERE ' + saleWhere;
    countParams = [...sp];
  }
  const records = Number((await db.get(countSel, ...countParams)).t);

  // vendas inteiras por canal (no geral, venda dividida conta como 1 — o 0,5 é só crédito da vendedora)
  const chanCount = async (ch) => {
    if (sellerId) {
      const r = await db.get(
        `SELECT COUNT(DISTINCT s.id) AS t FROM sales s JOIN sale_participants sp ON sp.sale_id=s.id AND sp.seller_id=? WHERE ${saleWhere} AND s.channel=?`,
        sellerId, ...sp, ch
      );
      return Number(r.t);
    }
    const r = await db.get(`SELECT COUNT(DISTINCT s.id) AS t FROM sales s WHERE ${saleWhere} AND s.channel=?`, ...sp, ch);
    return Number(r.t);
  };
  const waRecords = await chanCount('WhatsApp');
  const crmRecords = await chanCount('CRM');
  const presRecords = await chanCount('Presencial');

  const conversion = calls > 0 ? (credit / calls) * 100 : null;
  return { calls, salesCredit: credit, whatsapp: wa, crm: crm, presencial, records, waRecords, crmRecords, presRecords, conversion };
}

app.get('/api/stats/summary', requireAuth, ah(async (req, res) => {
  const { from, to, seller_id, sector, store_id } = req.query;
  const scope = scopedStoreId(req, store_id);
  if (scope.error) return res.status(403).json({ error: scope.error });
  const storeId = scope.storeId;
  let sid = null;
  if (req.user.role === 'seller') sid = req.user.id;
  else if (seller_id) {
    sid = Number(seller_id);
    if (req.user.role === 'manager') {
      const t = await db.get("SELECT * FROM users WHERE id=? AND role='seller'", sid);
      if (!t || Number(t.store_id) !== Number(req.user.store_id))
        return res.status(403).json({ error: 'Acesso restrito à sua loja.' });
    }
  }
  if ((req.user.role === 'admin' || req.user.role === 'manager') && !sid && validSector(sector)) {
    // agregado do setor (+ loja): vendas contam inteiras e uma única vez
    // (mesmo divididas entre 2 vendedoras do setor ou com outro setor).
    const sellers = await db.all(
      `SELECT * FROM users WHERE role='seller' AND active=1 AND COALESCE(sector,'online')=?${storeId != null ? ' AND store_id=?' : ''}`,
      sector, ...(storeId != null ? [storeId] : [])
    );
    const sids = sellers.map((s) => s.id);
    if (!sids.length) {
      return res.json({ calls: 0, salesCredit: 0, whatsapp: 0, crm: 0, presencial: 0, records: 0, waRecords: 0, crmRecords: 0, presRecords: 0, conversion: null });
    }
    const ph = sids.map(() => '?').join(',');
    const inSector = `s.id IN (SELECT DISTINCT sp2.sale_id FROM sale_participants sp2 WHERE sp2.seller_id IN (${ph}))`;
    const dp = [];
    let dw = inSector;
    if (from) { dw += ' AND s.sale_date >= ?'; dp.push(from); }
    if (to) { dw += ' AND s.sale_date <= ?'; dp.push(to); }
    if (storeId != null) { dw += ' AND s.store_id = ?'; dp.push(storeId); }
    const cnt = async (ch) => {
      const r = await db.get(
        `SELECT COUNT(DISTINCT s.id) AS t FROM sales s WHERE ${dw}${ch ? ' AND s.channel=?' : ''}`,
        ...sids, ...dp, ...(ch ? [ch] : [])
      );
      return Number(r.t);
    };
    const cp = [];
    let cw = '1=1';
    if (from) { cw += ' AND date >= ?'; cp.push(from); }
    if (to) { cw += ' AND date <= ?'; cp.push(to); }
    const callsRow = await db.get(`SELECT COALESCE(SUM(quantity),0) AS t FROM call_records WHERE seller_id IN (${ph}) AND ${cw}`, ...sids, ...cp);
    const calls = Number(callsRow.t);
    const credSum = async (ch) => {
      const r = await db.get(
        `SELECT COALESCE(SUM(sp.credit),0) AS t FROM sale_participants sp JOIN sales s ON s.id=sp.sale_id WHERE sp.seller_id IN (${ph})${from ? ' AND s.sale_date >= ?' : ''}${to ? ' AND s.sale_date <= ?' : ''}${storeId != null ? ' AND s.store_id = ?' : ''}${ch ? ' AND s.channel=?' : ''}`,
        ...sids, ...dp, ...(ch ? [ch] : [])
      );
      return Number(r.t);
    };
    const salesCredit = await credSum(null);
    const records = await cnt(null);
    return res.json({
      calls, salesCredit,
      whatsapp: await credSum('WhatsApp'), crm: await credSum('CRM'), presencial: await credSum('Presencial'),
      records,
      waRecords: await cnt('WhatsApp'), crmRecords: await cnt('CRM'), presRecords: await cnt('Presencial'),
      conversion: calls > 0 ? (records / calls) * 100 : null,
    });
  }
  res.json(await summarize(from || null, to || null, sid, storeId));
}));

app.get('/api/stats/ranking', requireAuth, requireManager, ah(async (req, res) => {
  const { from, to, sector, store_id } = req.query;
  const scope = scopedStoreId(req, store_id);
  if (scope.error) return res.status(403).json({ error: scope.error });
  const sectorFilter = validSector(sector) ? ' AND COALESCE(u.sector,\'online\')=?' : '';
  const storeFilter = scope.storeId != null ? ' AND u.store_id=?' : '';
  const sellers = await db.all(
    `SELECT u.*, s.name AS store_name FROM users u LEFT JOIN stores s ON s.id=u.store_id WHERE u.role='seller' AND u.active=1${sectorFilter}${storeFilter} ORDER BY u.name`,
    ...(validSector(sector) ? [sector] : []), ...(scope.storeId != null ? [scope.storeId] : [])
  );
  const rows = await Promise.all(sellers.map(async (s) => {
    const st = await summarize(from || null, to || null, s.id, scope.storeId);
    return { seller_id: s.id, name: s.name, sector: s.sector || 'online', store_id: s.store_id, store_name: s.store_name || 'Sede', avatar_url: s.avatar_url || null, calls: st.calls, sales: st.salesCredit, whatsapp: st.whatsapp, crm: st.crm, presencial: st.presencial, conversion: st.conversion };
  }));
  rows.sort((a, b) => b.sales - a.sales || b.calls - a.calls);
  res.json({ ranking: rows });
}));

app.get('/api/stats/seller/:id', requireAuth, ah(async (req, res) => {
  const targetId = Number(req.params.id);
  if (req.user.role !== 'admin' && req.user.role !== 'manager' && targetId !== req.user.id)
    return res.status(403).json({ error: 'Sem permissão.' });
  if (req.user.role === 'manager') {
    const t = await db.get("SELECT * FROM users WHERE id=? AND role='seller'", targetId);
    if (!t || Number(t.store_id) !== Number(req.user.store_id))
      return res.status(403).json({ error: 'Acesso restrito à sua loja.' });
  }
  const { from, to, cfrom, cto } = req.query;
  const current = await summarize(from || null, to || null, targetId);
  const compare = (cfrom || cto) ? await summarize(cfrom || null, cto || null, targetId) : null;
  const pct = (cur, prev) => {
    if (prev == null || prev === 0) return null;
    if (cur == null) return null;
    return ((cur - prev) / Math.abs(prev)) * 100;
  };
  const p = [targetId];
  let dw = 'sp.seller_id=?';
  if (from) { dw += ' AND s.sale_date >= ?'; p.push(from); }
  if (to) { dw += ' AND s.sale_date <= ?'; p.push(to); }
  const daily = await db.all(
    `SELECT s.sale_date AS date, SUM(sp.credit) AS sales, COUNT(DISTINCT s.id) AS records FROM sale_participants sp JOIN sales s ON s.id=sp.sale_id WHERE ${dw} GROUP BY s.sale_date ORDER BY s.sale_date`,
    ...p
  );
  const p2 = [targetId];
  let cw = 'seller_id=?';
  if (from) { cw += ' AND date >= ?'; p2.push(from); }
  if (to) { cw += ' AND date <= ?'; p2.push(to); }
  const dailyCalls = await db.all(`SELECT date, SUM(quantity) AS calls FROM call_records WHERE ${cw} GROUP BY date ORDER BY date`, ...p2);
  const seller = await db.get('SELECT * FROM users WHERE id=?', targetId);
  if (!seller) return res.status(404).json({ error: 'Vendedora não encontrada.' });
  res.json({
    seller: toPublicUser(seller),
    current,
    compare,
    deltas: compare ? {
      sales: pct(current.salesCredit, compare.salesCredit),
      calls: pct(current.calls, compare.calls),
      conversion: pct(current.conversion, compare.conversion),
      whatsapp: pct(current.whatsapp, compare.whatsapp),
      crm: pct(current.crm, compare.crm),
      presencial: pct(current.presencial, compare.presencial),
    } : null,
    daily, dailyCalls,
  });
}));

app.get('/api/report/daily', requireAuth, requireManager, ah(async (req, res) => {
  const date = req.query.date || todayISO();
  const { sector, store_id } = req.query;
  if (!isValidDate(date)) return res.status(400).json({ error: 'Data inválida.' });
  const scope = scopedStoreId(req, store_id);
  if (scope.error) return res.status(403).json({ error: scope.error });
  const sectorFilter = validSector(sector) ? ' AND COALESCE(u.sector,\'online\')=?' : '';
  const storeFilter = scope.storeId != null ? ' AND u.store_id=?' : '';
  const extraParams = [...(validSector(sector) ? [sector] : []), ...(scope.storeId != null ? [scope.storeId] : [])];
  const sellers = await db.all(
    `SELECT u.*, s.name AS store_name FROM users u LEFT JOIN stores s ON s.id=u.store_id WHERE u.role='seller' AND u.active=1${sectorFilter}${storeFilter} ORDER BY u.name`,
    ...extraParams
  );
  const allRows = await Promise.all(sellers.map(async (s) => {
    const st = await summarize(date, date, s.id, scope.storeId);
    return { seller_id: s.id, name: s.name, sector: s.sector || 'online', store_name: s.store_name || 'Sede', calls: st.calls, sales: st.salesCredit };
  }));
  const summary = {
    calls: allRows.reduce((a, r) => a + r.calls, 0),
    salesCredit: allRows.reduce((a, r) => a + r.sales, 0),
    records: 0,
  };
  if (!validSector(sector)) {
    const full = await summarize(date, date, null, scope.storeId);
    summary.records = full.records;
    summary.waRecords = full.waRecords;
    summary.crmRecords = full.crmRecords;
    summary.presRecords = full.presRecords;
  } else {
    const sids = sellers.map((s) => s.id);
    if (sids.length) {
      const ph = sids.map(() => '?').join(',');
      const c = await db.get(
        `SELECT COUNT(DISTINCT s.id) AS t FROM sales s JOIN sale_participants sp ON sp.sale_id=s.id WHERE s.sale_date=? AND sp.seller_id IN (${ph})${scope.storeId != null ? ' AND s.store_id=?' : ''}`,
        date, ...sids, ...(scope.storeId != null ? [scope.storeId] : [])
      );
      summary.records = Number(c.t);
    }
  }
  const ranking = allRows.filter((r) => r.sales > 0 || r.calls > 0).sort((a, b) => b.sales - a.sales);
  // detalhamento alfabético por vendedora (relatório WhatsApp) — inclui todas, mesmo zeradas
  const roster = sellers;
  const details = await Promise.all(roster.map(async (s) => {
    const st = await summarize(date, date, s.id, scope.storeId);
    const rows = await db.all(
      `SELECT s.* FROM sales s JOIN sale_participants spf ON spf.sale_id=s.id AND spf.seller_id=? WHERE s.sale_date=?${scope.storeId != null ? ' AND s.store_id=?' : ''} ORDER BY s.id`,
      s.id, date, ...(scope.storeId != null ? [scope.storeId] : [])
    );
    const sales = await Promise.all(rows.map(async (sale) => {
      const full = await saleWithParticipants(sale);
      const me = full.participants.find((p) => p.seller_id === s.id);
      const partners = full.participants.filter((p) => p.seller_id !== s.id).map((p) => p.seller_name);
      return { product: sale.product, channel: sale.channel, store_name: full.store_name, credit: Number(me ? me.credit : 0), partners };
    }));
    return { seller_id: s.id, name: s.name, sector: s.sector || 'online', store_name: s.store_name || 'Sede', active: !!s.active, calls: st.calls, credit: st.salesCredit, records: sales.length, sales };
  }));
  const storeName = scope.storeId != null ? ((await getStore(scope.storeId)) || {}).name || '' : '';
  res.json({ date, sector: validSector(sector) ? sector : 'all', store: storeName, summary, ranking, details });
}));

// SPA fallback
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Rota não encontrada.' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// erro global -> sempre JSON
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[api]', err);
  res.status(500).json({ error: 'Erro interno. Tente novamente.' });
});

module.exports = app;

// só escuta quando executado diretamente (node server.js). Na Vercel, o api/index.js importa o app.
if (require.main === module) {
  db.ready.then(() => {
    app.listen(PORT, () => {
      console.log(`[app] Rodando em http://localhost:${PORT}`);
      console.log('[app] Login admin: admin@equipe.com / admin123');
    });
  }).catch((e) => {
    console.error('[db] Falha ao inicializar:', e);
    process.exit(1);
  });
}
