const express = require('express');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
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
const toPublicUser = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, active: !!u.active, created_at: u.created_at, avatar_url: u.avatar_url || null });

function signToken(user) {
  return jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

async function requireAuth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Não autenticado.' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = await db.get('SELECT * FROM users WHERE id = ?', payload.id);
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
  const u = await db.get('SELECT * FROM users WHERE id=?', sid);
  if (!u) return res.status(404).json({ error: 'Usuária não encontrada.' });
  res.json({ user: toPublicUser(u) });
}));

// ---------- SELLERS / USERS ----------
app.get('/api/sellers', requireAuth, ah(async (req, res) => {
  if (req.user.role === 'admin') {
    const rows = await db.all("SELECT * FROM users WHERE role='seller' ORDER BY name");
    return res.json({ sellers: rows.map(toPublicUser) });
  }
  const rows = await db.all("SELECT * FROM users WHERE role='seller' AND active=1 ORDER BY name");
  return res.json({ sellers: rows.map(toPublicUser) });
}));

app.get('/api/users', requireAuth, requireAdmin, ah(async (req, res) => {
  const rows = await db.all('SELECT * FROM users ORDER BY role DESC, name');
  res.json({ users: rows.map(toPublicUser) });
}));

app.post('/api/users', requireAuth, requireAdmin, ah(async (req, res) => {
  const { name, email, password, role } = req.body || {};
  if (!name?.trim() || !email?.trim() || !password) return res.status(400).json({ error: 'Nome, e-mail e senha são obrigatórios.' });
  if (!['admin', 'seller'].includes(role)) return res.status(400).json({ error: 'Perfil inválido.' });
  if (String(password).length < 4) return res.status(400).json({ error: 'Senha deve ter ao menos 4 caracteres.' });
  try {
    const r = await db.run('INSERT INTO users (name, email, password_hash, role, active) VALUES (?,?,?,?,1)',
      name.trim(), email.trim().toLowerCase(), bcrypt.hashSync(String(password), 10), role);
    const u = await db.get('SELECT * FROM users WHERE id=?', r.lastInsertRowid);
    res.status(201).json({ user: toPublicUser(u) });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'E-mail já cadastrado.' });
    throw e;
  }
}));

app.put('/api/users/:id', requireAuth, requireAdmin, ah(async (req, res) => {
  const { name, email, password, role } = req.body || {};
  const target = await db.get('SELECT * FROM users WHERE id=?', req.params.id);
  if (!target) return res.status(404).json({ error: 'Usuária não encontrada.' });
  if (!name?.trim() || !email?.trim()) return res.status(400).json({ error: 'Nome e e-mail são obrigatórios.' });
  if (role && !['admin', 'seller'].includes(role)) return res.status(400).json({ error: 'Perfil inválido.' });
  try {
    await db.run('UPDATE users SET name=?, email=?, role=? WHERE id=?',
      name.trim(), email.trim().toLowerCase(), role || target.role, target.id);
    if (password) {
      if (String(password).length < 4) return res.status(400).json({ error: 'Senha deve ter ao menos 4 caracteres.' });
      await db.run('UPDATE users SET password_hash=? WHERE id=?', bcrypt.hashSync(String(password), 10), target.id);
    }
    const u = await db.get('SELECT * FROM users WHERE id=?', target.id);
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
  const u = await db.get('SELECT * FROM users WHERE id=?', target.id);
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

// ---------- PHRASES (frase do dia) ----------
app.get('/api/phrases/today', requireAuth, ah(async (req, res) => {
  const list = await db.all('SELECT * FROM phrases WHERE active=1 ORDER BY id');
  if (!list.length) return res.json({ text: '' });
  const now = new Date();
  const day = Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86400000);
  res.json({ text: list[day % list.length].text });
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
  if (req.user.role !== 'admin') {
    where += ' AND c.seller_id = ?';
    params.push(req.user.id);
  } else if (seller_id) {
    where += ' AND c.seller_id = ?';
    params.push(seller_id);
  }
  if (from && isValidDate(from)) { where += ' AND c.date >= ?'; params.push(from); }
  if (to && isValidDate(to)) { where += ' AND c.date <= ?'; params.push(to); }
  const rows = await db.all(
    `SELECT c.*, u.name AS seller_name FROM call_records c JOIN users u ON u.id=c.seller_id WHERE ${where} ORDER BY c.date DESC, c.id DESC LIMIT 500`,
    ...params
  );
  res.json({ calls: rows });
}));

app.post('/api/calls', requireAuth, ah(async (req, res) => {
  let { date, quantity, seller_id } = req.body || {};
  date = date || todayISO();
  quantity = Number(quantity);
  if (!isValidDate(date)) return res.status(400).json({ error: 'Data inválida.' });
  if (!Number.isInteger(quantity) || quantity <= 0 || quantity > 2000)
    return res.status(400).json({ error: 'Quantidade deve ser entre 1 e 2000.' });

  let sellerId = req.user.id;
  if (req.user.role === 'admin') {
    if (seller_id) {
      const s = await db.get("SELECT * FROM users WHERE id=? AND role='seller' AND active=1", seller_id);
      if (!s) return res.status(400).json({ error: 'Vendedora inválida.' });
      sellerId = s.id;
    } else {
      return res.status(400).json({ error: 'Selecione a vendedora.' });
    }
  } else if (req.user.role !== 'seller') {
    return res.status(403).json({ error: 'Sem permissão.' });
  }

  const r = await db.run('INSERT INTO call_records (seller_id, date, quantity) VALUES (?,?,?)', sellerId, date, quantity);
  const row = await db.get('SELECT * FROM call_records WHERE id=?', r.lastInsertRowid);
  res.status(201).json({ call: row });
}));

app.delete('/api/calls/:id', requireAuth, ah(async (req, res) => {
  const row = await db.get('SELECT * FROM call_records WHERE id=?', req.params.id);
  if (!row) return res.status(404).json({ error: 'Registro não encontrado.' });
  if (req.user.role !== 'admin' && row.seller_id !== req.user.id)
    return res.status(403).json({ error: 'Você só pode excluir seus próprios registros.' });
  await db.run('DELETE FROM call_records WHERE id=?', row.id);
  res.json({ ok: true });
}));

// ---------- SALES ----------
async function saleWithParticipants(sale) {
  const parts = await db.all(
    'SELECT sp.*, u.name AS seller_name FROM sale_participants sp JOIN users u ON u.id=sp.seller_id WHERE sp.sale_id=?',
    sale.id
  );
  return { ...sale, participants: parts };
}

app.get('/api/sales', requireAuth, ah(async (req, res) => {
  const { from, to, seller_id, channel, product, q } = req.query;
  const conds = [];
  const params = [];
  if (from && isValidDate(from)) { conds.push('s.sale_date >= ?'); params.push(from); }
  if (to && isValidDate(to)) { conds.push('s.sale_date <= ?'); params.push(to); }
  if (channel && ['WhatsApp', 'CRM'].includes(channel)) { conds.push('s.channel = ?'); params.push(channel); }
  if (product) { conds.push('s.product LIKE ?'); params.push(`%${product}%`); }
  if (q) { conds.push('(s.customer_name LIKE ? OR s.product LIKE ? OR s.color LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }

  let joinParticipant = '';
  if (seller_id) {
    joinParticipant = 'JOIN sale_participants spf ON spf.sale_id = s.id AND spf.seller_id = ?';
    params.unshift(Number(seller_id));
  } else if (req.user.role !== 'admin') {
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

app.post('/api/sales', requireAuth, ah(async (req, res) => {
  const { customer_name, product, color, channel, sale_date, participant_ids } = req.body || {};
  const date = sale_date || todayISO();
  if (!customer_name?.trim()) return res.status(400).json({ error: 'Nome do cliente é obrigatório.' });
  if (!product?.trim()) return res.status(400).json({ error: 'Produto é obrigatório.' });
  if (!color?.trim()) return res.status(400).json({ error: 'Cor é obrigatória.' });
  if (!['WhatsApp', 'CRM'].includes(channel)) return res.status(400).json({ error: 'Canal deve ser WhatsApp ou CRM.' });
  if (!isValidDate(date)) return res.status(400).json({ error: 'Data inválida.' });
  const pids = [...new Set((participant_ids || []).map(Number).filter(Boolean))];
  if (pids.length < 1) return res.status(400).json({ error: 'Selecione ao menos 1 participante.' });
  if (pids.length > 3) return res.status(400).json({ error: 'Máximo de 3 participantes.' });

  const placeholders = pids.map(() => '?').join(',');
  const sellers = await db.all(`SELECT * FROM users WHERE id IN (${placeholders}) AND role='seller' AND active=1`, ...pids);
  if (sellers.length !== pids.length) return res.status(400).json({ error: 'Participante inválida ou desativada.' });

  if (req.user.role !== 'admin' && !pids.includes(req.user.id))
    return res.status(403).json({ error: 'Você precisa estar entre as participantes.' });

  let credit;
  try { credit = db.creditForParticipants(pids.length); }
  catch (e) { return res.status(400).json({ error: e.message }); }

  const r = await db.run(
    'INSERT INTO sales (customer_name, product, color, channel, created_by, sale_date) VALUES (?,?,?,?,?,?)',
    customer_name.trim(), product.trim(), color.trim(), channel, req.user.id, date
  );
  const saleId = r.lastInsertRowid;
  for (const sid of pids) await db.run('INSERT INTO sale_participants (sale_id, seller_id, credit) VALUES (?,?,?)', saleId, sid, credit);
  const sale = await db.get('SELECT * FROM sales WHERE id=?', saleId);
  res.status(201).json({ sale: await saleWithParticipants(sale) });
}));

app.delete('/api/sales/:id', requireAuth, ah(async (req, res) => {
  const sale = await db.get('SELECT * FROM sales WHERE id=?', req.params.id);
  if (!sale) return res.status(404).json({ error: 'Venda não encontrada.' });
  if (req.user.role !== 'admin' && sale.created_by !== req.user.id)
    return res.status(403).json({ error: 'Você só pode excluir vendas criadas por você.' });
  await db.run('DELETE FROM sales WHERE id=?', sale.id);
  res.json({ ok: true });
}));

// ---------- STATS ----------
async function summarize(from, to, sellerId) {
  const p = [];
  let callWhere = '1=1';
  if (from) { callWhere += ' AND date >= ?'; p.push(from); }
  if (to) { callWhere += ' AND date <= ?'; p.push(to); }
  let calls = 0;
  if (sellerId) {
    const r = await db.get(`SELECT COALESCE(SUM(quantity),0) AS t FROM call_records WHERE seller_id=? AND ${callWhere}`, sellerId, ...p);
    calls = Number(r.t);
  } else {
    const r = await db.get(`SELECT COALESCE(SUM(quantity),0) AS t FROM call_records WHERE ${callWhere}`, ...p);
    calls = Number(r.t);
  }

  const sp = [];
  let saleWhere = '1=1';
  if (from) { saleWhere += ' AND s.sale_date >= ?'; sp.push(from); }
  if (to) { saleWhere += ' AND s.sale_date <= ?'; sp.push(to); }
  const creditSel = 'SELECT COALESCE(SUM(sp.credit),0) AS t FROM sale_participants sp JOIN sales s ON s.id=sp.sale_id WHERE ' + saleWhere;
  const creditParams = [...sp];
  if (sellerId) { creditParams.push(sellerId); }
  const withSeller = (sel) => sellerId ? sel + ' AND sp.seller_id=?' : sel;

  const credit = Number((await db.get(withSeller(creditSel), ...creditParams)).t);
  const waSel = withSeller(creditSel.replace('sp.credit', "CASE WHEN s.channel='WhatsApp' THEN sp.credit ELSE 0 END"));
  const crmSel = withSeller(creditSel.replace('sp.credit', "CASE WHEN s.channel='CRM' THEN sp.credit ELSE 0 END"));
  const wa = Number((await db.get(waSel, ...creditParams)).t);
  const crm = Number((await db.get(crmSel, ...creditParams)).t);

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

  const conversion = calls > 0 ? (credit / calls) * 100 : null;
  return { calls, salesCredit: credit, whatsapp: wa, crm: crm, records, conversion };
}

app.get('/api/stats/summary', requireAuth, ah(async (req, res) => {
  const { from, to, seller_id } = req.query;
  const sid = req.user.role === 'admin' ? (seller_id ? Number(seller_id) : null) : req.user.id;
  res.json(await summarize(from || null, to || null, sid));
}));

app.get('/api/stats/ranking', requireAuth, requireAdmin, ah(async (req, res) => {
  const { from, to } = req.query;
  const sellers = await db.all("SELECT * FROM users WHERE role='seller' AND active=1 ORDER BY name");
  const rows = await Promise.all(sellers.map(async (s) => {
    const st = await summarize(from || null, to || null, s.id);
    return { seller_id: s.id, name: s.name, calls: st.calls, sales: st.salesCredit, whatsapp: st.whatsapp, crm: st.crm, conversion: st.conversion };
  }));
  rows.sort((a, b) => b.sales - a.sales || b.calls - a.calls);
  res.json({ ranking: rows });
}));

app.get('/api/stats/seller/:id', requireAuth, ah(async (req, res) => {
  const targetId = Number(req.params.id);
  if (req.user.role !== 'admin' && targetId !== req.user.id) return res.status(403).json({ error: 'Sem permissão.' });
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
    } : null,
    daily, dailyCalls,
  });
}));

app.get('/api/report/daily', requireAuth, requireAdmin, ah(async (req, res) => {
  const date = req.query.date || todayISO();
  if (!isValidDate(date)) return res.status(400).json({ error: 'Data inválida.' });
  const summary = await summarize(date, date, null);
  const sellers = await db.all("SELECT * FROM users WHERE role='seller' AND active=1 ORDER BY name");
  const allRows = await Promise.all(sellers.map(async (s) => {
    const st = await summarize(date, date, s.id);
    return { seller_id: s.id, name: s.name, calls: st.calls, sales: st.salesCredit };
  }));
  const ranking = allRows.filter((r) => r.sales > 0 || r.calls > 0).sort((a, b) => b.sales - a.sales);
  res.json({ date, summary, ranking });
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
