try { require('dotenv').config(); } catch {}
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

// ---------- PUSH (Web Push / VAPID) ----------
let webpush = null;
try { webpush = require('web-push'); } catch {}
const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_CONTACT = process.env.VAPID_CONTACT || 'mailto:admin@sellday.app';
const CRON_SECRET = process.env.CRON_SECRET || '';
if (webpush && VAPID_PUBLIC && VAPID_PRIVATE) {
  try { webpush.setVapidDetails(VAPID_CONTACT, VAPID_PUBLIC, VAPID_PRIVATE); }
  catch (e) { console.log('[push] VAPID inválido:', e.message); }
}
const pushReady = () => !!(webpush && VAPID_PUBLIC && VAPID_PRIVATE);

// Textos fixos aprovados (com {nome}). Variação por dia+vendedora, sem repetir.
const ENTRADA_TEMPLATES = [
  'Bom dia, {nome}! ☀️ São 08:10 e seu ponto ainda não apareceu. Bate lá no SellDay rapidinho?',
  '{nome}, o dia já começou e faltou você no ponto! Escaneie o QR da loja pra garantir sua presença.',
  'Ei, esqueceu? 😅 Ainda dá tempo de bater a entrada de hoje. Abre o SellDay > Bater ponto.',
  '08:10 e nada do seu ponto, {nome}. Não deixa pra depois, garante agora.',
  'O time já batendo ponto e você ainda não, {nome}! 30 segundinhos e resolve.',
  'Bom dia! 🌤️ Sem entrada registrada até agora. Bate o ponto pra não cair no relatório de atraso.',
  '{nome}, sua loja já abriu! Registre sua entrada no app pra valer o dia.',
  'Opa, faltou seu check-in! Bate o ponto agora e começa o dia 100%.',
];
const SAIDA_TEMPLATES = [
  '{nome}, faltam 10 min pra fechar! Não esquece de bater a saída no SellDay. 👋',
  'Quase lá! 🕒 Registre sua saída antes de ir embora, senão o dia fica incompleto.',
  'Ei, antes de sair: bate o ponto de saída? São 10 min pro fechamento.',
  'Não vai embora sem bater a saída, {nome}! Garanta suas horas de hoje.',
  'Fim de expediente chegando. 30 segundos pra registrar a saída e pronto. ✅',
  '{nome}, seu ponto tá só com entrada. Complete com a saída agora?',
  'Última chamada do ponto! 🛎️ Faltam 10 min — registre a saída no app.',
  'Fechando o dia? Passe no SellDay e bata a saída pra não esquecer amanhã.',
];
const firstName = (n) => String(n || 'você').trim().split(/\s+/)[0] || 'você';
const fillTpl = (tpl, user) => tpl.replace(/\{nome\}/g, firstName(user && user.name));
const fillFraseTpl = (tpl, user, frase) => tpl.replace(/\{nome\}/g, firstName(user && user.name)).replace(/\{frase\}/g, String(frase || ''));
const FRASE_SORTEADA_TEMPLATES = [
  'Bom dia, {nome}! ✨ Hoje é seu dia de escrever a frase do dia no SellDay. 💛',
  '{nome}, você foi sorteada! 🍀 Escreva a frase de hoje e inspire o time.',
  'É o seu dia, {nome}! ✍️ Deixe a frase do dia com a sua cara.',
  'Sorteio feito: hoje a frase é com você, {nome}! 💪 Manda aquela motivação.',
  'Bom dia! ☀️ {nome}, o time espera sua frase de hoje. Capricha! 💛',
  '{nome}, sua vez de brilhar! 🌟 Escreva a frase do dia no SellDay.',
  'O sorteio te escolheu, {nome}! 🎯 Qual vai ser a frase de hoje?',
  'Ei, {nome}! 😊 Hoje você inspira a equipe: escreva a frase do dia.',
];
const FRASE_ESCRITA_TEMPLATES = [
  '“{frase}” — {nome}',
  '{nome} escreveu: “{frase}”',
  'Frase de hoje por {nome}: “{frase}” 💛',
  '“{frase}” 💬 ({nome})',
  'Inspiração do dia de {nome}: “{frase}” ✨',
  '{nome} mandou: “{frase}” 🌟',
  'Acabou de sair: “{frase}” — {nome} 💛',
  'Olha a frase de hoje! “{frase}” — por {nome} 😊',
];
// índice determinístico: (dias desde epoch + userId) % len — não repete no dia seguinte
function pickTemplate(list, userId, dateISO) {
  const [y, m, d] = String(dateISO).split('-').map(Number);
  const days = Math.floor(Date.UTC(y, m - 1, d) / 86400000);
  return Number.isFinite(days) ? (days + Number(userId || 0)) % list.length : 0;
}
async function alreadyNotified(dateISO, type, userId) {
  try { return !!(await db.get('SELECT 1 AS x FROM notification_log WHERE date=? AND type=? AND user_id=?', dateISO, type, Number(userId))); }
  catch { return false; }
}
async function markNotified(dateISO, type, userId, idx) {
  try { await db.run('INSERT INTO notification_log (date, type, user_id, template_idx) VALUES (?,?,?,?) ON CONFLICT(date,type,user_id) DO NOTHING', dateISO, type, Number(userId), idx || 0); } catch {}
}
async function sendPushToUser(userId, payload) {
  if (!pushReady()) return { sent: 0, reason: 'push-nao-configurado' };
  let subs = [];
  try { subs = await db.all('SELECT * FROM push_subscriptions WHERE user_id=?', Number(userId)); } catch { return { sent: 0 }; }
  if (!subs.length) return { sent: 0, reason: 'sem-inscricao' };
  let sent = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload));
      sent++;
    } catch (e) {
      const code = e && (e.statusCode || e.status_code);
      if (code === 404 || code === 410) { try { await db.run('DELETE FROM push_subscriptions WHERE endpoint=?', s.endpoint); } catch {} }
    }
  }
  return { sent };
}
async function sendPushToUsers(userIds, payload) {
  let sent = 0;
  for (const id of [...new Set(userIds.map(Number).filter(Boolean))]) {
    try { sent += (await sendPushToUser(id, payload)).sent; } catch {}
  }
  return { sent };
}
// minutos de SP (0-1439) a partir de agora
const nowSPMinutes = () => {
  const ms = Date.parse(new Date().toISOString());
  return Math.floor(ms / 60000 - 180) % 1440;
};
// fim padrão do expediente em minutos SP: 8h + std (600→18h, 540→17h, 240→12h, feriado 300→13h)
const stdEndMinutes = (isHoliday, dateISO, sched) => {
  const std = stdMinutesFor(dateISO, isHoliday, sched);
  return 8 * 60 + std;
};

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// embrulha handlers async p/ o Express 4 encaminhar erros ao middleware
const ah = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// ---------- helpers ----------
const todayISO = () => new Date().toISOString().slice(0, 10);
// data de São Paulo (UTC-3): a frase do dia e o sorteio seguem o dia local,
// não o UTC do servidor (que vira o dia 3h antes, à meia-noite não — às 21h).
const todaySP = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
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
  const user = await db.get('SELECT u.*, s.name AS store_name FROM users u LEFT JOIN stores s ON s.id=u.store_id WHERE lower(u.email) = lower(?)', String(email).trim());
  if (!user) return res.status(401).json({ error: 'Credenciais inválidas.' });
  if (!user.active) return res.status(403).json({ error: 'Usuária desativada. Fale com o administrador.' });
  const ok = bcrypt.compareSync(String(password), user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Credenciais inválidas.' });
  return res.json({ token: signToken(user), user: toPublicUser(user) });
}));

app.get('/api/me', requireAuth, ah(async (req, res) => {
  res.json({ user: { ...toPublicUser(req.user), pix_key: req.user.pix_key || null } });
}));

// chave PIX da própria pessoa (vendedora e funcionário): texto livre até 120 caracteres; vazio remove
app.put('/api/me/pix', requireAuth, ah(async (req, res) => {
  if (req.user.role !== 'seller' && req.user.role !== 'staff') return res.status(403).json({ error: 'Recurso da equipe.' });
  const { pix_key } = req.body || {};
  const clean = String(pix_key ?? '').trim();
  if (clean.length > 120) return res.status(400).json({ error: 'Chave PIX muito longa (máx. 120 caracteres).' });
  await db.run('UPDATE users SET pix_key=? WHERE id=?', clean || null, req.user.id);
  const u = await db.get('SELECT u.*, s.name AS store_name FROM users u LEFT JOIN stores s ON s.id=u.store_id WHERE u.id=?', req.user.id);
  res.json({ user: { ...toPublicUser(u), pix_key: (u && u.pix_key) || null } });
}));

// foto de perfil (data URL pequena, redimensionada no app)
app.put('/api/me/avatar', requireAuth, ah(async (req, res) => {
  const { avatar, seller_id } = req.body || {};
  let sid = req.user.id;
  if (seller_id && req.user.role === 'admin') sid = Number(seller_id);
  else if (req.user.role !== 'seller' && req.user.role !== 'staff') return res.status(403).json({ error: 'Sem permissão.' });
  if (avatar) {
    if (typeof avatar !== 'string' || !avatar.startsWith('data:image/') || avatar.length > 200000)
      return res.status(400).json({ error: 'Imagem inválida. Use uma foto JPG/PNG comum.' });
  }
  await db.run('UPDATE users SET avatar_url=? WHERE id=?', avatar || null, sid);
  const u = await db.get('SELECT u.*, s.name AS store_name FROM users u LEFT JOIN stores s ON s.id=u.store_id WHERE u.id=?', sid);
  if (!u) return res.status(404).json({ error: 'Usuária não encontrada.' });
  res.json({ user: toPublicUser(u) });
}));

// ---------- PUSH (inscrição do aparelho + cron) ----------
app.get('/api/push/vapid-public', ah(async (req, res) => {
  if (!VAPID_PUBLIC) return res.status(503).json({ error: 'Push não configurado no servidor.' });
  res.json({ publicKey: VAPID_PUBLIC });
}));

app.post('/api/push/subscribe', requireAuth, ah(async (req, res) => {
  const { endpoint, keys, ua } = req.body || {};
  if (!endpoint || !keys || !keys.p256dh || !keys.auth)
    return res.status(400).json({ error: 'Inscrição inválida.' });
  if (String(endpoint).length > 2000 || String(keys.p256dh).length > 500 || String(keys.auth).length > 200)
    return res.status(400).json({ error: 'Inscrição inválida.' });
  await db.run('DELETE FROM push_subscriptions WHERE endpoint=?', String(endpoint));
  await db.run('INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, ua) VALUES (?,?,?,?,?)',
    req.user.id, String(endpoint), String(keys.p256dh), String(keys.auth), String(ua || '').slice(0, 200));
  // máximo 5 aparelhos por pessoa (remove os mais antigos)
  try {
    const rows = await db.all('SELECT id FROM push_subscriptions WHERE user_id=? ORDER BY id DESC', req.user.id);
    if (rows.length > 5) {
      const old = rows.slice(5).map((r) => r.id);
      await db.run(`DELETE FROM push_subscriptions WHERE id IN (${old.map(() => '?').join(',')})`, ...old);
    }
  } catch {}
  res.json({ ok: true });
}));

app.delete('/api/push/unsubscribe', requireAuth, ah(async (req, res) => {
  const { endpoint } = req.body || {};
  if (endpoint) await db.run('DELETE FROM push_subscriptions WHERE endpoint=? AND user_id=?', String(endpoint), req.user.id);
  else await db.run('DELETE FROM push_subscriptions WHERE user_id=?', req.user.id);
  res.json({ ok: true });
}));

app.get('/api/push/status', requireAuth, ah(async (req, res) => {
  let count = 0;
  try { count = Number((await db.get('SELECT COUNT(*) AS c FROM push_subscriptions WHERE user_id=?', req.user.id)).c) || 0; }
  catch {}
  res.json({ configured: pushReady(), devices: count });
}));

app.post('/api/push/test', requireAuth, requireAdmin, ah(async (req, res) => {
  if (!pushReady()) return res.status(503).json({ error: 'Configure VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY no servidor.' });
  const target = Number((req.body || {}).user_id) || req.user.id;
  const r = await sendPushToUser(target, { title: 'SellDay 🔔', body: 'Notificações ativadas! Você vai receber os avisos de ponto e frase por aqui.', url: '/', tag: 'sellday-test' });
  if (!r.sent) return res.status(404).json({ error: r.reason === 'sem-inscricao' ? 'Aparelho não inscrito. Ative as notificações no celular primeiro.' : 'Push indisponível agora.' });
  res.json({ ok: true, sent: r.sent });
}));

// cron de notificações: sorteada, 08:10 sem ponto, saída 10min antes.
// Vercel Cron não manda header custom por padrão → aceita Bearer, x-cron-secret ou ?secret=.
async function cronNotify(req, res) {
  if (CRON_SECRET) {
    const h = req.headers.authorization || '';
    const ok = h === 'Bearer ' + CRON_SECRET || req.headers['x-cron-secret'] === CRON_SECRET || req.query.secret === CRON_SECRET;
    if (!ok) return res.status(401).json({ error: 'Não autorizado.' });
  }
  const today = todaySP();
  const nowT = nowSPTime();
  const nowMin = nowSPMinutes();
  const morning = nowMin < 12 * 60; // avisos de entrada/frase só de manhã
  const out = { date: today, now: nowT, frase_sorteada: 0, ponto_entrada: 0, ponto_saida: 0, frase_escrita_broadcast: 0 };
  // 1) sorteada da frase (só se ainda não escreveu). Sem trava de horário:
  // o dedupe (1x/dia) já impede repetição, e assim cobre os dias em que o
  // sorteio trava tarde (time que bate ponto depois das 8h).
  try {
    const draw = await ensureDraw(today);
    if (draw && draw.seller && draw.locked) {
      const written = await db.get('SELECT 1 AS x FROM daily_phrases WHERE date=?', today).catch(() => null);
      if (!written && !(await alreadyNotified(today, 'frase_sorteada', draw.seller.id))) {
        const idx = pickTemplate(FRASE_SORTEADA_TEMPLATES, draw.seller.id, today);
        const r = await sendPushToUser(draw.seller.id, {
          title: 'Você foi sorteada! ✨',
          body: fillTpl(FRASE_SORTEADA_TEMPLATES[idx], draw.seller),
          url: '/', tag: `frase-${today}`,
        });
        if (r.sent) { await markNotified(today, 'frase_sorteada', draw.seller.id, idx); out.frase_sorteada = r.sent; }
      }
    }
  } catch (e) { console.log('[cron] frase_sorteada pulado:', e.message); }
  // 2) 08:10: quem não bateu entrada — só de manhã (à tarde seria spam p/ faltante)
  if (morning) try {
    if (nowT >= '08:10:00') {
      const team = await db.all("SELECT * FROM users WHERE role IN ('seller','staff') AND active=1").catch(() => []);
      for (const member of team) {
        if (await alreadyNotified(today, 'ponto_entrada', member.id)) continue;
        const p = await db.get('SELECT check_in_at FROM punches WHERE seller_id=? AND date=?', member.id, today).catch(() => null);
        if (p && p.check_in_at) continue;
        const idx = pickTemplate(ENTRADA_TEMPLATES, member.id, today);
        const r = await sendPushToUser(member.id, { title: 'Bater ponto 🕒', body: fillTpl(ENTRADA_TEMPLATES[idx], member), url: '/', tag: `entrada-${today}` });
        if (r.sent) { await markNotified(today, 'ponto_entrada', member.id, idx); out.ponto_entrada += r.sent; }
      }
    }
  } catch (e) { console.log('[cron] ponto_entrada pulado:', e.message); }
  // 3) saída: 10min antes do fim de CADA UM (carga especial incluída).
  // Roda em horários fixos (11:50 dom, 12:50 feriado, 16:50 p/ fim 17h,
  // 17:50 p/ fim 18h) e pega quem está na janela de 70min após o seu aviso.
  // Fora da janela não avisa (evita spam tardio). 1x por pessoa/dia.
  try {
    const team = await db.all("SELECT * FROM users WHERE role IN ('seller','staff') AND active=1").catch(() => []);
    const scheds = await schedulesMap(team.map((m) => m.id));
    for (const member of team) {
      if (await alreadyNotified(today, 'ponto_saida', member.id)) continue;
      const p = await db.get('SELECT * FROM punches WHERE seller_id=? AND date=?', member.id, today).catch(() => null);
      if (!p || !p.check_in_at || p.check_out_at) continue;
      const hol = await holidayFor(today, p.store_id ?? member.store_id).catch(() => null);
      const reminderMin = stdEndMinutes(!!hol, today, scheds[member.id]) - 10;
      if (nowMin < reminderMin || nowMin - reminderMin > 70) continue;
      const idx = pickTemplate(SAIDA_TEMPLATES, member.id, today);
      const r = await sendPushToUser(member.id, { title: 'Bater ponto 🕒', body: fillTpl(SAIDA_TEMPLATES[idx], member), url: '/', tag: `saida-${today}` });
      if (r.sent) { await markNotified(today, 'ponto_saida', member.id, idx); out.ponto_saida += r.sent; }
    }
  } catch (e) { console.log('[cron] ponto_saida pulado:', e.message); }
  res.json({ ok: true, ...out });
}
app.post('/api/cron/notify', ah(cronNotify));
app.get('/api/cron/notify', ah(cronNotify));

// cron de fechamento automático (nativo, 00:05 SP):
// fecha os pontos esquecidos da véspera no fim do expediente padrão.
// Mesmo auth do /api/cron/notify (?secret=, Bearer ou x-cron-secret).
async function cronFechar(req, res) {
  if (CRON_SECRET) {
    const h = req.headers.authorization || '';
    const ok = h === 'Bearer ' + CRON_SECRET || req.headers['x-cron-secret'] === CRON_SECRET || req.query.secret === CRON_SECRET;
    if (!ok) return res.status(401).json({ error: 'Não autorizado.' });
  }
  const r = await autoClosePunches();
  res.json({ ok: true, date: todaySP(), ...r });
}
app.post('/api/cron/fechar', ah(cronFechar));
app.get('/api/cron/fechar', ah(cronFechar));

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

// elegíveis p/ participar de venda na loja+data: nativas ativas + visitantes
// (vendedoras de outra loja com check-in na loja na data). Só vendedoras.
async function eligibleSellerIds(storeId, dateISO) {
  const natives = await db.all(
    "SELECT id FROM users WHERE role='seller' AND active=1 AND store_id=?", storeId
  ).catch(() => []);
  const ids = new Set(natives.map((r) => r.id));
  if (isValidDate(dateISO)) {
    const rows = await db.all(
      `SELECT DISTINCT p.seller_id AS id FROM punches p JOIN users u ON u.id=p.seller_id
       WHERE p.store_id=? AND p.date=? AND p.check_in_at IS NOT NULL AND u.role='seller' AND u.active=1`,
      storeId, dateISO
    ).catch(() => []);
    for (const r of rows) ids.add(r.id);
  }
  return ids;
}

// lista elegível p/ o seletor de participantes (gerente trava na própria loja)
app.get('/api/sellers/eligible', requireAuth, requireManager, ah(async (req, res) => {
  const { store_id, date } = req.query;
  const scope = scopedStoreId(req, store_id);
  if (scope.error) return res.status(403).json({ error: scope.error });
  const storeId = scope.storeId ?? await sedeId();
  const d = isValidDate(date) ? date : todayISO();
  const ids = await eligibleSellerIds(storeId, d);
  const homeIds = new Set((await db.all(
    "SELECT id FROM users WHERE role='seller' AND active=1 AND store_id=?", storeId
  ).catch(() => [])).map((r) => r.id));
  if (!ids.size) return res.json({ sellers: [], store_id: storeId, date: d });
  const ph = [...ids].map(() => '?').join(',');
  const rows = await db.all(
    `SELECT u.*, s.name AS store_name FROM users u LEFT JOIN stores s ON s.id=u.store_id WHERE u.id IN (${ph}) ORDER BY u.name`,
    [...ids]
  );
  res.json({ sellers: rows.map((u) => ({ ...toPublicUser(u), visitor: !homeIds.has(u.id) })), store_id: storeId, date: d });
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
  if (!['admin', 'manager', 'seller', 'staff'].includes(role)) return res.status(400).json({ error: 'Perfil inválido.' });
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
  if (role && !['admin', 'manager', 'seller', 'staff'].includes(role)) return res.status(400).json({ error: 'Perfil inválido.' });
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

// exclusão de pessoa (admin): conta duplicada sai direto; demitido com
// movimento pede confirmação (?force=1) e preserva as vendas do time
// (created_by vai para quem excluiu; participações/comissões/ponto da
// pessoa são removidos). Sem force + com movimento → 409 com contagens.
app.delete('/api/users/:id', requireAuth, requireAdmin, ah(async (req, res) => {
  const target = await db.get('SELECT * FROM users WHERE id=?', req.params.id);
  if (!target) return res.status(404).json({ error: 'Usuária não encontrada.' });
  if (Number(target.id) === Number(req.user.id)) return res.status(400).json({ error: 'Você não pode excluir a si mesma.' });
  if (target.role === 'admin') {
    const nAdmins = Number((await db.get("SELECT COUNT(*) AS c FROM users WHERE role='admin' AND active=1").catch(() => ({ c: 1 }))).c) || 0;
    if (nAdmins <= 1) return res.status(400).json({ error: 'Não é possível excluir o último administrador.' });
  }
  const count = async (sql, ...p) => {
    try { return Number((await db.get(sql, ...p)).c) || 0; } catch { return 0; }
  };
  const usage = {
    sales_created: await count('SELECT COUNT(*) AS c FROM sales WHERE created_by=?', target.id),
    participations: await count('SELECT COUNT(*) AS c FROM sale_participants WHERE seller_id=?', target.id),
    punches: await count('SELECT COUNT(*) AS c FROM punches WHERE seller_id=?', target.id),
    calls: await count('SELECT COUNT(*) AS c FROM call_records WHERE seller_id=?', target.id),
    commissions: await count('SELECT COUNT(*) AS c FROM commissions WHERE seller_id=?', target.id),
    payouts: await count('SELECT COUNT(*) AS c FROM payouts WHERE seller_id=?', target.id),
  };
  const total = Object.values(usage).reduce((a, b) => a + b, 0);
  const force = String((req.query || {}).force || '') === '1';
  if (total > 0 && !force) {
    const parts = [];
    if (usage.sales_created) parts.push(`${usage.sales_created} venda(s) criada(s)`);
    if (usage.participations) parts.push(`${usage.participations} participação(ões)`);
    if (usage.punches) parts.push(`${usage.punches} dia(s) de ponto`);
    if (usage.calls) parts.push(`${usage.calls} registro(s) de chamadas`);
    if (usage.commissions) parts.push(`${usage.commissions} comissão(ões)`);
    if (usage.payouts) parts.push(`${usage.payouts} pagamento(s)`);
    return res.status(409).json({
      error: `Esta pessoa tem histórico (${parts.join(', ')}). Desative para manter o histórico, ou confirme a exclusão definitiva.`,
      usage, total,
    });
  }
  if (total > 0) {
    // limpa vínculos da pessoa; vendas criadas por ela passam para quem excluiu
    try { await db.run('UPDATE sales SET created_by=? WHERE created_by=?', req.user.id, target.id); } catch {}
    try { await db.run('UPDATE canceled_sales SET canceled_by=? WHERE canceled_by=?', req.user.id, target.id); } catch {}
    try { await db.run('UPDATE extra_payouts SET created_by=? WHERE created_by=?', req.user.id, target.id); } catch {}
    try { await db.run('UPDATE payouts SET created_by=? WHERE created_by=?', req.user.id, target.id); } catch {}
    for (const sql of [
      'DELETE FROM push_subscriptions WHERE user_id=?',
      'DELETE FROM work_schedules WHERE user_id=?',
      'DELETE FROM seller_settings WHERE seller_id=?',
      'DELETE FROM seller_goals WHERE seller_id=?',
      'DELETE FROM call_records WHERE seller_id=?',
      'DELETE FROM commissions WHERE seller_id=?',
      'DELETE FROM extra_payouts WHERE seller_id=?',
      'DELETE FROM payouts WHERE seller_id=?',
      'DELETE FROM punches WHERE seller_id=?',
      'DELETE FROM sale_participants WHERE seller_id=?',
      'DELETE FROM notification_log WHERE user_id=?',
      'DELETE FROM daily_phrases WHERE seller_id=?',
    ]) { try { await db.run(sql, target.id); } catch {} }
    // sorteios travados de outros dias referenciam a pessoa: remove só os dela
    try { await db.run('DELETE FROM daily_draws WHERE seller_id=?', target.id); } catch {}
  }
  await db.run('DELETE FROM users WHERE id=?', target.id);
  res.json({ ok: true, removed: { id: target.id, name: target.name }, usage, total });
}));

// ---------- CARGA HORÁRIA ESPECIAL (por pessoa) ----------
// Ex: Juliana trabalha seg–sex 8h–17h (9h = 540min) em vez do padrão 10h.
// Vazio (null) = padrão global. Extra nunca é negativo (max(0, trabalhado − padrão)).
const SCHED_LABELS = { weekday_min: 'seg–sex', saturday_min: 'sábado', sunday_min: 'domingo', holiday_min: 'feriado' };
app.get('/api/users/:id/schedule', requireAuth, ah(async (req, res) => {
  const target = await db.get('SELECT * FROM users WHERE id=?', req.params.id);
  if (!target) return res.status(404).json({ error: 'Pessoa não encontrada.' });
  if (req.user.role === 'manager' && Number(target.store_id) !== Number(req.user.store_id))
    return res.status(403).json({ error: 'Acesso restrito à sua loja.' });
  if ((req.user.role === 'seller' || req.user.role === 'staff') && Number(target.id) !== Number(req.user.id))
    return res.status(403).json({ error: 'Sem permissão.' });
  res.json({ schedule: await scheduleFor(target.id), defaults: STD_DEFAULTS });
}));

app.put('/api/users/:id/schedule', requireAuth, requireManager, ah(async (req, res) => {
  const target = await db.get('SELECT * FROM users WHERE id=?', req.params.id);
  if (!target) return res.status(404).json({ error: 'Pessoa não encontrada.' });
  if (req.user.role === 'manager' && Number(target.store_id) !== Number(req.user.store_id))
    return res.status(403).json({ error: 'Acesso restrito à sua loja.' });
  const body = req.body || {};
  const parsed = {};
  for (const k of Object.keys(SCHED_LABELS)) {
    const v = parseStdMin(body[k]);
    if (v && v.error) return res.status(400).json({ error: `Carga de ${SCHED_LABELS[k]} deve ser entre 1h e 24h (vazio = padrão).` });
    parsed[k] = v;
  }
  await db.run(
    `INSERT INTO work_schedules (user_id, weekday_min, saturday_min, sunday_min, holiday_min, updated_at) VALUES (?,?,?,?,?,datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET weekday_min=excluded.weekday_min, saturday_min=excluded.saturday_min, sunday_min=excluded.sunday_min, holiday_min=excluded.holiday_min, updated_at=datetime('now')`,
    target.id, parsed.weekday_min, parsed.saturday_min, parsed.sunday_min, parsed.holiday_min
  );
  res.json({ schedule: await scheduleFor(target.id) });
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
  if (req.user.role !== 'seller' && req.user.role !== 'staff') return res.status(403).json({ error: 'Sem permissão.' });
  const row = await db.get('SELECT * FROM seller_settings WHERE seller_id=?', req.user.id);
  const dark = (row && (row.theme_dark || (row.preset ? 'verde' : null))) || 'verde';
  const light = (row && (row.theme_light || (row.preset ? 'classico' : null))) || 'classico';
  res.json({ darks: THEME_DARKS, lights: THEME_LIGHTS, dark, light, theme: mergedTheme(dark, light) });
}));

app.put('/api/settings/theme', requireAuth, ah(async (req, res) => {
  if (req.user.role !== 'seller' && req.user.role !== 'staff') return res.status(403).json({ error: 'Sem permissão.' });
  const { dark, light } = req.body || {};
  if (!THEME_DARKS[dark]) return res.status(400).json({ error: 'Cor escura inválida.' });
  if (!THEME_LIGHTS[light]) return res.status(400).json({ error: 'Cor clara inválida.' });
  await db.run(
    'INSERT INTO seller_settings (seller_id, theme_dark, theme_light) VALUES (?,?,?) ON CONFLICT(seller_id) DO UPDATE SET theme_dark=excluded.theme_dark, theme_light=excluded.theme_light',
    req.user.id, dark, light
  );
  res.json({ dark, light, theme: mergedTheme(dark, light) });
}));

// rodízio diário (prévia/fallback): rotação entre as vendedoras ativas
// (todos os setores e lojas — só role='seller')
async function drawnSeller(dateISO) {
  const sellers = await db.all("SELECT * FROM users WHERE role='seller' AND active=1 ORDER BY id");
  if (!sellers.length) return null;
  const [y, mo, dd] = dateISO.split('-').map(Number);
  const n = Math.floor(Date.UTC(y, mo - 1, dd) / 86400000);
  return sellers[n % sellers.length];
}

// hora atual em São Paulo (HH:MM:SS) — mesmo fuso fixo do todaySP (UTC-3, sem DST)
const nowSPTime = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(11, 19);
const DRAW_CUTOFF = '07:59:59'; // trava o sorteio: só quem já bateu ponto até aqui
const DRAW_FALLBACK = '08:00:00'; // vazio no corte? espera e sorteia entre presentes às 8h

// sorteio da frase travado por dia: só vendedoras presentes (ponto até o corte),
// em round-robin pelo histórico (menos recentemente sorteada primeiro; estreante na frente).
// Retorna { seller, locked, preCutoff?, waiting? }. Idempotente e seguro p/ concorrência
// (INSERT … ON CONFLICT DO NOTHING + releitura). Na Vercel o caminho preguiçoso
// (a cada request) cobre o agendamento; no servidor local um timer antecipa a trava.
async function ensureDraw(dateISO) {
  const won = await db.get(
    'SELECT u.* FROM daily_draws d JOIN users u ON u.id=d.seller_id WHERE d.date=?', dateISO
  ).catch(() => null);
  if (won) return { seller: won, locked: true };
  const sellers = await db.all("SELECT * FROM users WHERE role='seller' AND active=1 ORDER BY id");
  if (!sellers.length) return { seller: null, locked: false };
  const nowT = nowSPTime();
  if (nowT < DRAW_CUTOFF) {
    return { seller: await drawnSeller(dateISO), locked: false, preCutoff: true };
  }
  // corte vigente: 07:59:59, ou 08:00:00 quando passou das 8h sem ninguém no corte
  const cutoff = nowT < DRAW_FALLBACK ? DRAW_CUTOFF : DRAW_FALLBACK;
  const cutoffMs = Date.parse(`${dateISO}T${cutoff}-03:00`);
  const punches = await db.all(
    'SELECT seller_id, check_in_at FROM punches WHERE date=? AND check_in_at IS NOT NULL', dateISO
  ).catch(() => []);
  const presentIds = new Set(
    punches.filter((p) => Number.isFinite(Date.parse(p.check_in_at)) && Date.parse(p.check_in_at) <= cutoffMs)
      .map((p) => p.seller_id)
  );
  let pool = sellers.filter((s) => presentIds.has(s.id));
  if (!pool.length) {
    if (nowT < DRAW_FALLBACK) return { seller: null, locked: false, waiting: true };
    pool = sellers; // 8h e ninguém presente: rodízio geral p/ nunca ficar sem sorteada
  }
  const hist = await db.all('SELECT seller_id, MAX(date) AS last_date FROM daily_draws GROUP BY seller_id').catch(() => []);
  const lastBy = Object.fromEntries(hist.map((h) => [h.seller_id, h.last_date || '']));
  const ordered = [...pool].sort((a, b) => {
    const la = lastBy[a.id] || '', lb = lastBy[b.id] || '';
    return la < lb ? -1 : la > lb ? 1 : a.id - b.id;
  });
  const pick = ordered[0];
  try {
    await db.run('INSERT INTO daily_draws (date, seller_id, pool_size) VALUES (?,?,?) ON CONFLICT(date) DO NOTHING',
      dateISO, pick.id, pool.length);
  } catch {}
  const final = await db.get(
    'SELECT u.* FROM daily_draws d JOIN users u ON u.id=d.seller_id WHERE d.date=?', dateISO
  ).catch(() => null);
  return { seller: final || pick, locked: true };
}

function bankPhrase(list, dateISO) {
  const [y, mo, dd] = dateISO.split('-').map(Number);
  const n = Math.floor(Date.UTC(y, mo - 1, dd) / 86400000);
  return list[n % list.length].text;
}

// ---------- PHRASES (frase do dia: uma sorteada por dia, igual para todos) ----------
app.get('/api/phrases/today', requireAuth, ah(async (req, res) => {
  const today = todaySP();
  const draw = await ensureDraw(today);
  const drawn = draw.seller;
  const dp = await db.get(
    'SELECT dp.*, u.name AS author_name FROM daily_phrases dp JOIN users u ON u.id=dp.seller_id WHERE dp.date=?', today
  );
  if (dp) {
    return res.json({
      text: dp.text, author: dp.author_name, authorId: dp.seller_id, date: today,
      drawnSellerId: drawn ? drawn.id : null, drawnSellerName: drawn ? drawn.name : null,
      canWrite: drawn ? (req.user.id === drawn.id || req.user.role === 'admin') : false,
      locked: draw.locked,
    });
  }
  // só vale a frase escrita pela vendedora (sem frase padrão/banco)
  res.json({
    text: '', author: null, authorId: null, date: today,
    drawnSellerId: drawn ? drawn.id : null, drawnSellerName: drawn ? drawn.name : null,
    canWrite: drawn ? (req.user.id === drawn.id || req.user.role === 'admin') : false,
    locked: draw.locked, preCutoff: !!draw.preCutoff, waiting: !!draw.waiting,
  });
}));

// frase do dia escrita pela sorteada (máx. 140 caracteres)
app.post('/api/phrases/daily', requireAuth, ah(async (req, res) => {
  const today = todaySP();
  const { seller: drawn } = await ensureDraw(today);
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
  // broadcast (fire-and-forget, 1x/dia): todas sabem que a frase saiu
  (async () => {
    try {
      if (await alreadyNotified(today, 'frase_escrita', 0)) return;
      const team = await db.all("SELECT id FROM users WHERE role IN ('seller','staff','manager') AND active=1 AND id<>?", req.user.id).catch(() => []);
      const preview = clean.length > 90 ? clean.slice(0, 90) + '…' : clean;
      const idx = pickTemplate(FRASE_ESCRITA_TEMPLATES, req.user.id, today);
      await sendPushToUsers(team.map((t) => t.id), {
        title: 'Nova frase do dia 💛',
        body: fillFraseTpl(FRASE_ESCRITA_TEMPLATES[idx], req.user, preview),
        url: '/', tag: `frase-escrita-${today}`,
      });
      await markNotified(today, 'frase_escrita', 0, idx);
    } catch (e) { console.log('[push] broadcast frase pulado:', e.message); }
  })();
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
  if (req.user.role === 'manager') return res.status(403).json({ error: 'Acesso restrito ao ponto.' });
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

app.post('/api/calls', requireAuth, requireAdmin, ah(async (req, res) => {
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

app.delete('/api/calls/:id', requireAuth, requireAdmin, ah(async (req, res) => {
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
  // seller_id de outra pessoa: só admin/gerente. Vendedora/funcionária sempre vê só as próprias
  // (antes, o parâmetro era aceito de qualquer logada — brecha via Inspecionar).
  if (seller_id && (req.user.role === 'admin' || req.user.role === 'manager')) {
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
  if (pids.length > 4) return res.status(400).json({ error: 'Máximo de 4 participantes.' });

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
  // gerente: só nativas da loja ou visitantes com ponto lá na data da venda
  if (req.user.role !== 'admin') {
    const ok = await eligibleSellerIds(store.id, date);
    if (pids.some((id) => !ok.has(Number(id))))
      return res.status(403).json({ error: 'Participante não é da loja nem bateu ponto lá nesta data.' });
  }

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
  if (pids.length > 4) return res.status(400).json({ error: 'Máximo de 4 participantes.' });
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
  // gerente: só nativas da loja ou visitantes com ponto lá na data da venda
  if (req.user.role !== 'admin') {
    const ok = await eligibleSellerIds(store.id, date);
    if (pids.some((id) => !ok.has(Number(id))))
      return res.status(403).json({ error: 'Participante não é da loja nem bateu ponto lá nesta data.' });
  }

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
app.get('/api/commissions/summary', requireAuth, requireAdmin, ah(async (req, res) => {
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
      active: !!s.active, avatar_url: s.avatar_url || null, pix_key: s.pix_key || null,
      month_cents: Number(m.t), paid_month_cents: Number(pm.t),
      pending_cents: await pendingCents(s.id),
    };
  }));
  const tot = (k) => rows.reduce((a, r) => a + r[k], 0);
  res.json({ month, sector: validSector(sector) ? sector : 'all', rows, total_month_cents: tot('month_cents'), total_pending_cents: tot('pending_cents') });
}));

// histórico de pagamentos (admin)
app.get('/api/commissions/payouts', requireAuth, requireAdmin, ah(async (req, res) => {
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
app.post('/api/commissions/payouts', requireAuth, requireAdmin, ah(async (req, res) => {
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
// Padrão do dia em minutos: seg–sex 600 (8–18), sáb 540 (8–17), dom 240 (8–12), feriado 300 (8–13).
// `sched` = carga horária especial da pessoa (work_schedules; null = padrão global).
const STD_DEFAULTS = { weekday: 600, saturday: 540, sunday: 240, holiday: 300 };
function stdMinutesFor(dateISO, isHoliday, sched) {
  if (isHoliday) return Number(sched?.holiday_min) || STD_DEFAULTS.holiday;
  const dow = new Date(dateISO + 'T12:00:00Z').getUTCDay();
  if (dow === 0) return Number(sched?.sunday_min) || STD_DEFAULTS.sunday;
  if (dow === 6) return Number(sched?.saturday_min) || STD_DEFAULTS.saturday;
  return Number(sched?.weekday_min) || STD_DEFAULTS.weekday;
}
// carga horária especial (minutos ou null=padrão). Aceita 60–1440 (1h–24h).
function parseStdMin(v) {
  if (v == null || v === '') return null;
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < 60 || n > 1440) return { error: true };
  return n;
}
async function scheduleFor(userId) {
  try { return await db.get('SELECT * FROM work_schedules WHERE user_id=?', Number(userId)); }
  catch { return null; }
}
async function schedulesMap(ids) {
  const map = {};
  const list = [...new Set((ids || []).map(Number).filter(Boolean))];
  if (!list.length) return map;
  try {
    const rows = await db.all(`SELECT * FROM work_schedules WHERE user_id IN (${list.map(() => '?').join(',')})`, ...list);
    for (const r of rows) map[r.user_id] = r;
  } catch {}
  return map;
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
function punchCalc(p, isHoliday, sched) {
  const std = stdMinutesFor(p.date, isHoliday, sched);
  let worked = null;
  let extra = 0; // nunca negativo: saiu cedo => 0, não "hora negativa"
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
// ---------- Feriados por loja ----------
// store_id 0 = Todas as lojas. A específica da loja tem prioridade sobre a global.
async function holidayFor(dateISO, storeId) {
  const sid = Number(storeId) || 0;
  try {
    return await db.get(
      'SELECT h.*, s.name AS store_name FROM holidays h LEFT JOIN stores s ON s.id=h.store_id WHERE h.date=? AND (h.store_id=0 OR h.store_id=?) ORDER BY h.store_id DESC LIMIT 1',
      dateISO, sid
    ) || null;
  } catch { return null; }
}
// veto da detecção automática: (date,0) veta todas; (date,loja) veta só ela
async function holidaySkipped(dateISO, storeId) {
  const sid = Number(storeId) || 0;
  try {
    return !!(await db.get('SELECT 1 AS x FROM holiday_skips WHERE date=? AND (store_id=0 OR store_id=?) LIMIT 1', dateISO, sid));
  } catch { return false; }
}
// feriados de um mês indexados por data (lista: global + específicas), p/ cálculo por ponto
async function holidaysOfMonth(month) {
  try {
    return await db.all(
      'SELECT h.*, s.name AS store_name FROM holidays h LEFT JOIN stores s ON s.id=h.store_id WHERE h.date LIKE ? ORDER BY h.date, h.store_id DESC',
      `${month}%`
    );
  } catch { return []; }
}
// feriado aplicável a um ponto (loja onde bateu; cai p/ o global quando não há específico)
function holidayForPunch(monthHols, punch, fallbackStoreId) {
  const pst = Number((punch && punch.store_id) ?? fallbackStoreId) || 0;
  const list = monthHols.filter((h) => h.date === punch.date);
  return list.find((h) => Number(h.store_id) === pst && pst !== 0)
    || list.find((h) => Number(h.store_id) === 0)
    || null;
}
// regra do feriado automático: maioria saindo 12:30–13:30 (horário SP).
// Em times grandes exige maioria (>=60%); em times pequenos (<=4 presentes)
// 3 saídas nesse intervalo bastam. Evita que 3 saídas avulsas num time de
// 15 pessoas marquem feriado sozinho e inflem o extra de quem fez dia cheio
// (dia cheio 600min - padrão de feriado 300min = +5h fantasma).
function looksLikeHoliday(outsSPMin, base) {
  const inWindow = outsSPMin.filter((m) => m >= 750 && m <= 810).length;
  if (inWindow < 3) return false;
  if (base <= 4) return true;
  return inWindow / base >= 0.6;
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

// bater ponto (vendedora e funcionário): QR da loja + GPS; tipo automático (entrada → saída)
app.post('/api/ponto/bater', requireAuth, ah(async (req, res) => {
  if (req.user.role !== 'seller' && req.user.role !== 'staff') return res.status(403).json({ error: 'Recurso da equipe.' });
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
  const today = todaySP();
  const now = new Date().toISOString();
  const mySched = await scheduleFor(req.user.id);
  await autoClosePunches(); // rede de segurança: fecha esquecidos de dias passados
  let p = await db.get('SELECT * FROM punches WHERE seller_id=? AND date=?', req.user.id, today);
  if (!p) {
    // primeira batida: até 12:59 vira entrada; a partir de 13h vira saída
    // (esqueceu a entrada — o dia fica incompleto p/ o admin completar)
    if (firstPunchType(nowSPMinutes()) === 'out') {
      await db.run('INSERT INTO punches (seller_id, store_id, date, check_out_at, check_out_lat, check_out_lng, check_out_acc) VALUES (?,?,?,?,?,?,?)',
        req.user.id, store.id, today, now, nLat, nLng, acc);
      p = await db.get('SELECT * FROM punches WHERE seller_id=? AND date=?', req.user.id, today);
      const hol = await holidayFor(today, store.id);
      return res.status(201).json({ type: 'out', incomplete: true, store: store.name, punch: punchCalc(p, !!hol, mySched), distance_m: Math.round(dist) });
    }
    await db.run('INSERT INTO punches (seller_id, store_id, date, check_in_at, check_in_lat, check_in_lng, check_in_acc) VALUES (?,?,?,?,?,?,?)',
      req.user.id, store.id, today, now, nLat, nLng, acc);
    p = await db.get('SELECT * FROM punches WHERE seller_id=? AND date=?', req.user.id, today);
    const hol = await holidayFor(today, store.id);
    return res.status(201).json({ type: 'in', store: store.name, punch: punchCalc(p, !!hol, mySched), distance_m: Math.round(dist) });
  }
  if (!p.check_in_at && p.check_out_at)
    return res.status(409).json({ error: 'Saída já registrada (sem entrada hoje). Fale com o admin para completar sua entrada.' });
  if (p.check_in_at && !p.check_out_at) {
    if (Date.parse(now) - Date.parse(p.check_in_at) < 3 * 60000)
      return res.status(409).json({ error: 'Entrada registrada agora mesmo. Aguarde alguns minutos antes da saída.' });
    await db.run('UPDATE punches SET check_out_at=?, check_out_lat=?, check_out_lng=?, check_out_acc=?, updated_at=datetime(\'now\') WHERE id=?',
      now, nLat, nLng, acc, p.id);
    p = await db.get('SELECT * FROM punches WHERE id=?', p.id);
    const hol = await holidayFor(today, p.store_id ?? store.id);
    return res.json({ type: 'out', punch: punchCalc(p, !!hol, mySched), distance_m: Math.round(dist) });
  }
  return res.status(409).json({ error: 'Dia já encerrado (entrada e saída registradas).' });
}));

// ponto de hoje (vendedora e funcionário)
app.get('/api/ponto/hoje', requireAuth, ah(async (req, res) => {
  if (req.user.role !== 'seller' && req.user.role !== 'staff') return res.status(403).json({ error: 'Recurso da equipe.' });
  const today = todaySP();
  const p = await db.get('SELECT * FROM punches WHERE seller_id=? AND date=?', req.user.id, today);
  const hol = await holidayFor(today, (p && p.store_id) ?? req.user.store_id);
  res.json({ date: today, punch: p ? punchCalc(p, !!hol, await scheduleFor(req.user.id)) : null, is_holiday: !!hol });
}));

// meu mês de ponto (vendedora e funcionário): batidas dia a dia + extras
app.get('/api/ponto/eu', requireAuth, ah(async (req, res) => {
  if (req.user.role !== 'seller' && req.user.role !== 'staff') return res.status(403).json({ error: 'Recurso da equipe.' });
  const month = (req.query.month && /^\d{4}-\d{2}$/.test(req.query.month)) ? req.query.month : todaySP().slice(0, 7);
  const ps = await db.all('SELECT * FROM punches WHERE seller_id=? AND date LIKE ? ORDER BY date DESC', req.user.id, `${month}%`);
  const monthHols = await holidaysOfMonth(month);
  const mySched = await scheduleFor(req.user.id);
  await autoClosePunches(); // rede de segurança antes de listar o mês
  res.json({
    month,
    punches: ps.map((p) => {
      const hol = holidayForPunch(monthHols, p, req.user.store_id);
      const c = punchCalc(p, !!hol, mySched);
      return { date: p.date, in_hhmm: c.in_hhmm, out_hhmm: c.out_hhmm, worked_label: c.worked_label, extra_min: c.extra_min, extra_label: c.extra_label, is_holiday: !!hol, holiday_label: hol ? hol.label : null, auto_closed: !!p.auto_closed };
    }),
  });
}));

// relatório do dia (admin/gerente) + feriado automático
app.get('/api/ponto/dia', requireAuth, requireManager, ah(async (req, res) => {
  const date = req.query.date || todaySP();
  const { store_id, kind } = req.query;
  if (!isValidDate(date)) return res.status(400).json({ error: 'Data inválida.' });
  const scope = scopedStoreId(req, store_id);
  if (scope.error) return res.status(403).json({ error: scope.error });
  // kind: vendedoras (seller) | funcionários (staff) | todos
  const kindFilter = kind === 'staff' ? ` AND u.role='staff'` : kind === 'seller' ? ` AND u.role='seller'` : ` AND u.role IN ('seller','staff')`;
  let sellers = await db.all(
    `SELECT u.*, s.name AS store_name FROM users u LEFT JOIN stores s ON s.id=u.store_id WHERE u.active=1${kindFilter}${scope.storeId != null ? ' AND u.store_id=?' : ''} ORDER BY u.name`,
    ...(scope.storeId != null ? [scope.storeId] : [])
  );
  if (scope.storeId != null) {
    // visitantes: bateram o QR desta loja no dia mas são de outra loja
    const homeIds = new Set(sellers.map((s) => s.id));
    const visitors = await db.all(
      `SELECT DISTINCT u.*, s.name AS store_name FROM users u
       JOIN punches p ON p.seller_id=u.id AND p.date=? AND p.store_id=?
       LEFT JOIN stores s ON s.id=u.store_id
       WHERE u.active=1${kindFilter} ORDER BY u.name`,
      date, scope.storeId
    );
    for (const v of visitors) if (!homeIds.has(v.id)) { homeIds.add(v.id); sellers.push(v); }
    sellers.sort((a, b) => String(a.name).localeCompare(String(b.name), 'pt-BR'));
  }
  const storeNames = {};
  const punchStore = async (p) => {    if (!p || !p.store_id) return 'Sede';
    if (!storeNames[p.store_id]) {
      const st = await getStore(p.store_id);
      storeNames[p.store_id] = st ? st.name : 'Sede';
    }
    return storeNames[p.store_id];
  };
  // cada ponto usa o feriado da loja onde bateu (cai p/ o global "Todas" se não houver específico)
  // e a carga horária especial da pessoa (quando houver)
  const scheds = await schedulesMap(sellers.map((s) => s.id));
  const buildRows = async () => Promise.all(sellers.map(async (s) => {
    const p = await db.get('SELECT * FROM punches WHERE seller_id=? AND date=?', s.id, date);
    const holRow = p ? await holidayFor(date, p.store_id ?? s.store_id) : null;
    return {
      seller_id: s.id, name: s.name, role: s.role, sector: s.sector || 'online',
      store_id: s.store_id, store_name: s.store_name || 'Sede', avatar_url: s.avatar_url || null,
      custom_schedule: !!scheds[s.id],
      punch: p ? { ...punchCalc(p, !!holRow, scheds[s.id]), punch_store: await punchStore(p) } : null,
    };
  }));
  let rows = await buildRows();
  // feriado automático POR LOJA: seg–sáb (ainda não marcado na loja, sem veto do admin)
  // com maioria saindo 12:30–13:30 → marca sozinho (idempotente).
  // Ex: Sede+Magé saem às 13h (feriado municipal) e Guapimirim trabalha normal →
  // só Sede e Magé ganham o feriado automático.
  let auto_holiday = false;
  const dow = new Date(date + 'T12:00:00Z').getUTCDay();
  const autoDetect = async (storeId, punchRows) => {
    if (dow === 0) return false;
    if (await holidayFor(date, storeId)) return false;
    if (await holidaySkipped(date, storeId)) return false;
    const outs = punchRows.map((r) => r.punch?.check_out_at).filter(Boolean).map(spMinOfISO).filter((m) => m != null);
    const base = punchRows.filter((r) => r.punch).length;
    if (!looksLikeHoliday(outs, base)) return false;
    await db.run('INSERT INTO holidays (date, store_id, label) VALUES (?,?,?) ON CONFLICT(date, store_id) DO NOTHING',
      date, Number(storeId) || 0, 'Feriado (auto)');
    return true;
  };
  if (scope.storeId != null) {
    if (await autoDetect(scope.storeId, rows)) { auto_holiday = true; rows = await buildRows(); }
  } else {
    // visão "Todas": detecta loja a loja, pelos pontos batidos em cada uma
    const byStore = new Map();
    for (const r of rows) {
      if (!r.punch) continue;
      const key = Number(r.punch.store_id) || 0;
      if (!byStore.has(key)) byStore.set(key, []);
      byStore.get(key).push(r);
    }
    for (const [storeKey, group] of byStore) {
      if (storeKey === 0) continue; // sem loja identificada: não infere sozinho
      if (await autoDetect(storeKey, group)) auto_holiday = true;
    }
    if (auto_holiday) rows = await buildRows();
  }
  const dayHols = await db.all(
    'SELECT h.*, s.name AS store_name FROM holidays h LEFT JOIN stores s ON s.id=h.store_id WHERE h.date=? ORDER BY h.store_id', date
  ).catch(() => []);
  const scopedHol = scope.storeId != null ? await holidayFor(date, scope.storeId) : null;
  const holiday = scopedHol || dayHols[0] || null;
  const present = rows.filter((r) => r.punch).length;
  const absent = rows.length - present;
  res.json({ date, is_holiday: dayHols.length > 0 && (scope.storeId != null ? !!scopedHol : true), holiday: holiday || null, holidays: dayHols, auto_holiday, present, absent, rows });
}));

// total de extras de uma pessoa no mês (todas as lojas) + baixas pagas.
// Usado na validação da baixa de horas; o resumo mensal usa o mesmo cálculo
// com filtro de loja quando escopado.
async function monthExtra(sellerId, month) {
  const person = await db.get('SELECT * FROM users WHERE id=?', Number(sellerId));
  if (!person) return { extra: 0, paid: 0, pending: 0 };
  const sched = await scheduleFor(person.id);
  const ps = await db.all('SELECT * FROM punches WHERE seller_id=? AND date LIKE ?', person.id, `${month}%`);
  const monthHols = await holidaysOfMonth(month);
  let extra = 0;
  for (const p of ps) {
    const hol = holidayForPunch(monthHols, p, person.store_id);
    const c = punchCalc(p, !!hol, sched);
    if (c.worked_min != null) extra += c.extra_min;
  }
  let paid = 0;
  try { paid = Number((await db.get('SELECT COALESCE(SUM(minutes),0) AS t FROM extra_payouts WHERE seller_id=? AND month=?', person.id, month)).t) || 0; }
  catch {}
  return { extra, paid, pending: Math.max(0, extra - paid) };
}

// fechamento automático de pontos esquecidos (dias passados com entrada e sem
// saída): saída = fim do expediente padrão daquele dia (18h seg–sex, 17h sáb,
// 12h dom, 13h feriado, ou fim da carga especial). Teto punitivo: hora além do
// padrão é perdida. Marca auto_closed=1 (o admin pode corrigir depois).
// Roda no agendador da 00:05 + de segurança nas telas de ponto.
async function autoClosePunches() {
  const today = todaySP();
  let open = [];
  try { open = await db.all('SELECT * FROM punches WHERE date < ? AND check_in_at IS NOT NULL AND check_out_at IS NULL ORDER BY date', today); }
  catch (e) { console.log('[ponto] auto-close pulado:', e.message); return { closed: 0 }; }
  if (!open.length) return { closed: 0 };
  const ids = [...new Set(open.map((p) => p.seller_id))];
  const scheds = await schedulesMap(ids);
  const usersById = {};
  try {
    const us = await db.all(`SELECT * FROM users WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids);
    for (const u of us) usersById[u.id] = u;
  } catch {}
  const monthCache = {};
  const monthHols = async (month) => {
    if (!monthCache[month]) monthCache[month] = await holidaysOfMonth(month);
    return monthCache[month];
  };
  let closed = 0;
  for (const p of open) {
    try {
      const u = usersById[p.seller_id] || {};
      const hols = await monthHols(p.date.slice(0, 7));
      const hol = holidayForPunch(hols, p, u.store_id);
      const endMin = stdEndMinutes(!!hol, p.date, scheds[p.seller_id]);
      const hh = String(Math.floor(endMin / 60)).padStart(2, '0');
      const mm = String(endMin % 60).padStart(2, '0');
      let outISO = new Date(`${p.date}T${hh}:${mm}:00-03:00`).toISOString();
      if (p.check_in_at && Date.parse(outISO) <= Date.parse(p.check_in_at)) outISO = p.check_in_at;
      await db.run("UPDATE punches SET check_out_at=?, updated_at=datetime('now'), auto_closed=1 WHERE id=? AND check_out_at IS NULL", outISO, p.id);
      closed++;
    } catch (e) { console.log('[ponto] auto-close falhou p/', p.id, e.message); }
  }
  if (closed) console.log(`[ponto] auto-close: ${closed} ponto(s) fechado(s).`);
  return { closed };
}

// feriados (leitura p/ gerente — só a dele + globais; escrita só admin)
// store_id 0 = Todas as lojas. Filtro opcional ?store_id= e ?month=YYYY-MM.
app.get('/api/ponto/feriados', requireAuth, requireManager, ah(async (req, res) => {
  const { month, store_id } = req.query;
  const conds = [];
  const params = [];
  if (month && /^\d{4}-\d{2}$/.test(month)) { conds.push('h.date LIKE ?'); params.push(`${month}%`); }
  if (req.user.role === 'manager') {
    conds.push('(h.store_id=0 OR h.store_id=?)'); params.push(Number(req.user.store_id));
  } else if (store_id != null && store_id !== '') {
    conds.push('(h.store_id=0 OR h.store_id=?)'); params.push(Number(store_id));
  }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  res.json({ holidays: await db.all(
    `SELECT h.*, s.name AS store_name FROM holidays h LEFT JOIN stores s ON s.id=h.store_id ${where} ORDER BY h.date DESC LIMIT 200`,
    ...params
  ) });
}));
app.post('/api/ponto/feriados', requireAuth, requireAdmin, ah(async (req, res) => {
  const { date, label, store_id } = req.body || {};
  if (!isValidDate(date)) return res.status(400).json({ error: 'Data inválida.' });
  let sid = 0; // 0 = Todas as lojas
  if (store_id != null && store_id !== '' && Number(store_id) !== 0) {
    const st = await getStore(store_id);
    if (!st || !st.active) return res.status(400).json({ error: 'Loja inválida.' });
    sid = st.id;
  }
  await db.run('INSERT INTO holidays (date, store_id, label) VALUES (?,?,?) ON CONFLICT(date, store_id) DO UPDATE SET label=excluded.label',
    date, sid, String(label || 'Feriado').slice(0, 80));
  try { await db.run('DELETE FROM holiday_skips WHERE date=? AND store_id=?', date, sid); } catch {}
  res.status(201).json({ holiday: await db.get('SELECT h.*, s.name AS store_name FROM holidays h LEFT JOIN stores s ON s.id=h.store_id WHERE h.date=? AND h.store_id=?', date, sid) });
}));
app.delete('/api/ponto/feriados/:date', requireAuth, requireAdmin, ah(async (req, res) => {
  const date = req.params.date;
  const q = req.query.store_id;
  if (q != null && q !== '' && Number(q) !== 0) {
    const sid = Number(q);
    await db.run('DELETE FROM holidays WHERE date=? AND store_id=?', date, sid);
    // veta a detecção automática de remarcar sozinha SÓ nesta loja
    try { await db.run('INSERT INTO holiday_skips (date, store_id) VALUES (?,?) ON CONFLICT(date, store_id) DO NOTHING', date, sid); } catch {}
  } else {
    // global ("Todas"): remove o global e veta geral
    await db.run('DELETE FROM holidays WHERE date=? AND store_id=0', date);
    try { await db.run('INSERT INTO holiday_skips (date, store_id) VALUES (?,0) ON CONFLICT(date, store_id) DO NOTHING', date); } catch {}
  }
  res.json({ ok: true });
}));

// resumo mensal de extras (admin/gerente)
app.get('/api/ponto/resumo', requireAuth, requireManager, ah(async (req, res) => {
  const month = req.query.month || todaySP().slice(0, 7);
  const { kind } = req.query;
  if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'Mês inválido.' });
  const scope = scopedStoreId(req, req.query.store_id);
  if (scope.error) return res.status(403).json({ error: scope.error });
  const kindFilter = kind === 'staff' ? ` AND u.role='staff'` : kind === 'seller' ? ` AND u.role='seller'` : ` AND u.role IN ('seller','staff')`;
  let sellers = await db.all(
    `SELECT u.*, s.name AS store_name FROM users u LEFT JOIN stores s ON s.id=u.store_id WHERE u.active=1${kindFilter}${scope.storeId != null ? ' AND u.store_id=?' : ''} ORDER BY u.name`,
    ...(scope.storeId != null ? [scope.storeId] : [])
  );
  if (scope.storeId != null) {
    // visitantes com batidas nesta loja no mês
    const homeIds = new Set(sellers.map((s) => s.id));
    const visitors = await db.all(
      `SELECT DISTINCT u.*, st.name AS store_name FROM users u
       JOIN punches p ON p.seller_id=u.id AND p.date LIKE ? AND p.store_id=?
       LEFT JOIN stores st ON st.id=u.store_id
       WHERE u.active=1${kindFilter} ORDER BY u.name`,
      `${month}%`, scope.storeId
    );
    for (const v of visitors) if (!homeIds.has(v.id)) { homeIds.add(v.id); sellers.push(v); }
    sellers.sort((a, b) => String(a.name).localeCompare(String(b.name), 'pt-BR'));
  }
  await autoClosePunches(); // rede de segurança antes de somar o mês
  const monthHols = await holidaysOfMonth(month);
  // auditoria: ?seller_id= + ?detail=1 devolve o dia a dia que compõe o total
  // (data, entrada, saída, trabalhado, padrão do dia, extra e feriado aplicado).
  const onlySid = req.query.seller_id != null && req.query.seller_id !== '' ? Number(req.query.seller_id) : null;  if (onlySid != null) sellers = sellers.filter((s) => Number(s.id) === onlySid);
  const wantDetail = req.query.detail === '1' || req.query.detail === 'true';
  const schedsAll = await schedulesMap(sellers.map((s) => s.id));
  const storeNames = {};
  const punchStore = async (p) => {
    if (!p || !p.store_id) return 'Sede';
    if (!storeNames[p.store_id]) {
      const st = await getStore(p.store_id);
      storeNames[p.store_id] = st ? st.name : 'Sede';
    }
    return storeNames[p.store_id];
  };
  // feriado de um dia sem ponto: específica da loja da pessoa tem prioridade sobre a global
  const holidayForDay = (dateISO, fallbackStoreId) => {
    const pst = Number(fallbackStoreId) || 0;
    const list = (monthHols || []).filter((h) => h.date === dateISO);
    if (!list.length) return null;
    return list.find((h) => Number(h.store_id) === pst && pst !== 0)
      || list.find((h) => Number(h.store_id) === 0)
      || null;
  };
  const rows = await Promise.all(sellers.map(async (s) => {
    // extras contam onde bateu o ponto (filtro por loja quando escopado)
    const ps = await db.all(
      `SELECT * FROM punches WHERE seller_id=? AND date LIKE ?${scope.storeId != null ? ' AND store_id=?' : ''} ORDER BY date`,
      s.id, `${month}%`, ...(scope.storeId != null ? [scope.storeId] : [])
    );
    const sched = schedsAll[s.id] || null;
    let extra = 0, worked = 0, days = 0, paid = 0;
    let detail = null;
    let fullDays = null;
    let summary = null;
    if (wantDetail) { detail = []; fullDays = []; }
    const byDate = new Map(ps.map((p) => [p.date, p]));
    for (const p of ps) {
      const hol = holidayForPunch(monthHols, p, s.store_id);
      const c = punchCalc(p, !!hol, sched);
      if (c.worked_min != null) { worked += c.worked_min; extra += c.extra_min; days += 1; }
      if (wantDetail) {
        detail.push({
          date: p.date,
          in_hhmm: c.in_hhmm, out_hhmm: c.out_hhmm,
          worked_min: c.worked_min, worked_label: c.worked_label, std_min: c.std_min, std_label: c.std_label,
          extra_min: c.extra_min, extra_label: c.extra_label,
          is_holiday: !!hol, holiday_label: hol ? hol.label : null,
          auto_closed: !!p.auto_closed,
          incomplete: c.worked_min == null,
          punch_store: await punchStore(p),
        });
      }
    }
    if (wantDetail) {
      // calendário completo do mês: trabalhados, incompletos, folgas (dom),
      // feriados, faltas (dias passados sem ponto) e futuros — p/ o popup do nome.
      const [yy, mm] = month.split('-').map(Number);
      const lastDay = new Date(yy, mm, 0).getDate();
      const today = todaySP();
      const pad2 = (n) => String(n).padStart(2, '0');
      let nTrab = 0, nInc = 0, nFalta = 0, nFolga = 0, nFer = 0;
      for (let d = 1; d <= lastDay; d++) {
        const dateISO = `${month}-${pad2(d)}`;
        if (scope.storeId != null) {
          const pp = byDate.get(dateISO);
          if (pp && Number(pp.store_id) !== Number(scope.storeId)) {
            // ponto batido em outra loja: não conta neste escopo, mas aparece como info
          }
        }
        const p = byDate.get(dateISO);
        const inScope = !p || scope.storeId == null || Number(p.store_id) === Number(scope.storeId) || !scope.storeId;
        const hol = p ? holidayForPunch(monthHols, p, s.store_id) : holidayForDay(dateISO, s.store_id);
        const std = stdMinutesFor(dateISO, !!hol, sched);
        const dow = new Date(dateISO + 'T12:00:00Z').getUTCDay();
        const isFuture = dateISO > today;
        if (p && inScope) {
          const c = punchCalc(p, !!hol, sched);
          const incomplete = c.worked_min == null;
          let status = 'trabalhado';
          if (incomplete) status = 'incompleto';
          if (incomplete) nInc++; else nTrab++;
          if (hol) nFer++;
          fullDays.push({
            date: dateISO, dow, status,
            in_hhmm: c.in_hhmm, out_hhmm: c.out_hhmm,
            worked_min: c.worked_min, worked_label: c.worked_label,
            std_min: c.std_min, std_label: c.std_label,
            extra_min: c.extra_min, extra_label: c.extra_label,
            is_holiday: !!hol, holiday_label: hol ? hol.label : null,
            auto_closed: !!p.auto_closed, incomplete,
            punch_store: await punchStore(p),
          });
        } else if (p && !inScope) {
          // batida fora do escopo: mostra só como referência (não soma)
          const c = punchCalc(p, !!hol, sched);
          fullDays.push({
            date: dateISO, dow, status: 'outra-loja',
            in_hhmm: c.in_hhmm, out_hhmm: c.out_hhmm,
            worked_min: c.worked_min, worked_label: c.worked_label,
            std_min: c.std_min, std_label: c.std_label,
            extra_min: 0, extra_label: fmtDur(0),
            is_holiday: !!hol, holiday_label: hol ? hol.label : null,
            auto_closed: !!p.auto_closed, incomplete: c.worked_min == null,
            punch_store: await punchStore(p),
          });
        } else if (isFuture) {
          fullDays.push({ date: dateISO, dow, status: 'futuro', in_hhmm: null, out_hhmm: null, worked_min: null, worked_label: null, std_min: std, std_label: fmtDur(std), extra_min: 0, extra_label: fmtDur(0), is_holiday: !!hol, holiday_label: hol ? hol.label : null, auto_closed: false, incomplete: false, punch_store: null });
        } else if (hol) {
          nFer++;
          fullDays.push({ date: dateISO, dow, status: 'feriado', in_hhmm: null, out_hhmm: null, worked_min: null, worked_label: null, std_min: std, std_label: fmtDur(std), extra_min: 0, extra_label: fmtDur(0), is_holiday: true, holiday_label: hol.label, auto_closed: false, incomplete: false, punch_store: null });
        } else if (dow === 0) {
          nFolga++;
          fullDays.push({ date: dateISO, dow, status: 'folga', in_hhmm: null, out_hhmm: null, worked_min: null, worked_label: null, std_min: std, std_label: fmtDur(std), extra_min: 0, extra_label: fmtDur(0), is_holiday: false, holiday_label: null, auto_closed: false, incomplete: false, punch_store: null });
        } else {
          nFalta++;
          fullDays.push({ date: dateISO, dow, status: 'falta', in_hhmm: null, out_hhmm: null, worked_min: null, worked_label: null, std_min: std, std_label: fmtDur(std), extra_min: 0, extra_label: fmtDur(0), is_holiday: false, holiday_label: null, auto_closed: false, incomplete: false, punch_store: null });
        }
      }
      summary = { trabalhados: nTrab, incompletos: nInc, faltas: nFalta, folgas: nFolga, feriados: nFer };
    }
    try { paid = Number((await db.get('SELECT COALESCE(SUM(minutes),0) AS t FROM extra_payouts WHERE seller_id=? AND month=?', s.id, month)).t) || 0; }
    catch {}
    return {
      seller_id: s.id, name: s.name, role: s.role, sector: s.sector || 'online', store_name: s.store_name || 'Sede', avatar_url: s.avatar_url || null,
      custom_schedule: !!sched, pix_key: s.pix_key || null,
      days, worked_min: worked, worked_label: fmtDur(worked),
      extra_min: extra, extra_label: fmtDur(extra),
      paid_min: paid, paid_label: fmtDur(paid),
      pending_min: Math.max(0, extra - paid), pending_label: fmtDur(Math.max(0, extra - paid)),
      ...(wantDetail ? { punches: detail, days_list: fullDays, summary } : {}),
    };
  }));
  rows.sort((a, b) => b.extra_min - a.extra_min);
  res.json({ month, rows, total_extra_min: rows.reduce((a, r) => a + r.extra_min, 0), total_extra_label: fmtDur(rows.reduce((a, r) => a + r.extra_min, 0)) });
}));

// baixa de horas extras (admin/gerente): registra horas pagas/compensadas no mês (em minutos)
app.post('/api/ponto/extra-payouts', requireAuth, requireManager, ah(async (req, res) => {
  const { seller_id, month, minutes } = req.body || {};
  const person = await db.get("SELECT * FROM users WHERE id=? AND role IN ('seller','staff') AND active=1", Number(seller_id));
  if (!person) return res.status(400).json({ error: 'Pessoa inválida.' });
  if (req.user.role === 'manager' && Number(person.store_id) !== Number(req.user.store_id))
    return res.status(403).json({ error: 'Acesso restrito à sua loja.' });
  const m = (month && /^\d{4}-\d{2}$/.test(month)) ? month : null;
  if (!m) return res.status(400).json({ error: 'Mês inválido.' });
  const mins = Math.round(Number(minutes));
  if (!Number.isFinite(mins) || mins <= 0) return res.status(400).json({ error: 'Informe as horas pagas.' });
  const cur = await monthExtra(person.id, m);
  if (mins > cur.pending) return res.status(400).json({ error: `Valor maior que o restante (${fmtDur(cur.pending)}).` });
  const r = await db.run('INSERT INTO extra_payouts (seller_id, month, minutes, created_by) VALUES (?,?,?,?)',
    person.id, m, mins, req.user.id);
  const after = await monthExtra(person.id, m);
  res.status(201).json({ payout: await db.get('SELECT * FROM extra_payouts WHERE id=?', r.lastInsertRowid), pending_min: after.pending, pending_label: fmtDur(after.pending) });
}));

// regra 13h (igual ao lançamento manual e à correção): primeira batida do dia
// até 12:59 = entrada; a partir de 13h sem entrada = saída (a pessoa esqueceu
// a entrada). Evita que a saída das 17h/18h seja gravada como entrada.
function firstPunchType(spMinutes) {
  return spMinutes < 13 * 60 ? 'in' : 'out';
}
// normaliza horários manuais (igual ao app): entrada só até 12:59; horário
// >=13h sem saída vira saída (para registrar a saída de quem esqueceu a
// entrada). Retorna {inISO, outISO, moved} ou {error}.
function normalizePunchTimes(dateISO, check_in_hhmm, check_out_hhmm) {
  const okHHMM = (s) => s === '' || s == null || /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
  if (!okHHMM(check_in_hhmm) || !okHHMM(check_out_hhmm)) return { error: 'Horário inválido (use HH:MM).' };
  let ci = (check_in_hhmm || '').trim() || null;
  let co = (check_out_hhmm || '').trim() || null;
  if (!ci && !co) return { error: 'Informe ao menos a entrada ou a saída.' };
  const toMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
  let moved = false;
  if (ci && toMin(ci) >= 13 * 60 && !co) { co = ci; ci = null; moved = true; }
  if (ci && toMin(ci) >= 13 * 60) return { error: 'Entrada só até 12:59 — após 13h é saída.' };
  const toISO = (hhmm) => new Date(`${dateISO}T${hhmm}:00-03:00`).toISOString();
  const inISO = ci ? toISO(ci) : null;
  const outISO = co ? toISO(co) : null;
  if (inISO && outISO && Date.parse(outISO) <= Date.parse(inISO)) return { error: 'Saída deve ser depois da entrada.' };
  return { inISO, outISO, moved };
}

// correção manual (admin/gerente): HH:MM no horário de SP
app.put('/api/ponto/:id', requireAuth, requireManager, ah(async (req, res) => {
  const p = await db.get(
    'SELECT pu.*, u.store_id AS seller_store FROM punches pu JOIN users u ON u.id=pu.seller_id WHERE pu.id=?', req.params.id
  );
  if (!p) return res.status(404).json({ error: 'Registro não encontrado.' });
  if (req.user.role === 'manager' && Number(p.seller_store) !== Number(req.user.store_id))
    return res.status(403).json({ error: 'Acesso restrito à sua loja.' });
  const { check_in_hhmm, check_out_hhmm } = req.body || {};
  const t = normalizePunchTimes(p.date, check_in_hhmm, check_out_hhmm);
  if (t.error) return res.status(400).json({ error: t.error });
  await db.run('UPDATE punches SET check_in_at=?, check_out_at=?, auto_closed=0, updated_at=datetime(\'now\') WHERE id=?', t.inISO, t.outISO, p.id);
  const hol = await holidayFor(p.date, p.store_id ?? p.seller_store);
  res.json({ punch: punchCalc(await db.get('SELECT * FROM punches WHERE id=?', p.id), !!hol, await scheduleFor(p.seller_id)) });
}));

// zerar o dia (admin/gerente): exclui o punch — o dia volta para Ausentes.
// Mesma trava de loja da correção (PUT /api/ponto/:id).
app.delete('/api/ponto/:id', requireAuth, requireManager, ah(async (req, res) => {
  const p = await db.get(
    'SELECT pu.*, u.store_id AS seller_store, u.name AS seller_name FROM punches pu JOIN users u ON u.id=pu.seller_id WHERE pu.id=?', req.params.id
  );
  if (!p) return res.status(404).json({ error: 'Registro não encontrado.' });
  if (req.user.role === 'manager' && Number(p.seller_store) !== Number(req.user.store_id))
    return res.status(403).json({ error: 'Acesso restrito à sua loja.' });
  await db.run('DELETE FROM punches WHERE id=?', p.id);
  res.json({ ok: true, removed: { id: p.id, seller_id: p.seller_id, seller_name: p.seller_name || '', date: p.date } });
}));

// lançamento manual / contingência (admin/gerente): cria ou ajusta o dia sem QR/GPS
app.post('/api/ponto/manual', requireAuth, requireManager, ah(async (req, res) => {
  const { seller_id, date, check_in_hhmm, check_out_hhmm, store_id } = req.body || {};
  const seller = await db.get("SELECT * FROM users WHERE id=? AND role IN ('seller','staff')", Number(seller_id));
  if (!seller) return res.status(400).json({ error: 'Pessoa inválida.' });
  if (req.user.role === 'manager' && Number(seller.store_id) !== Number(req.user.store_id))
    return res.status(403).json({ error: 'Acesso restrito à sua loja.' });
  const scope = scopedStoreId(req, store_id);
  if (scope.error) return res.status(403).json({ error: scope.error });
  const punchStoreId = scope.storeId != null ? scope.storeId : (seller.store_id || await sedeId());
  const d = date || todaySP();
  if (!isValidDate(d)) return res.status(400).json({ error: 'Data inválida.' });
  const t = normalizePunchTimes(d, check_in_hhmm, check_out_hhmm);
  if (t.error) return res.status(400).json({ error: t.error });
  await db.run(
    `INSERT INTO punches (seller_id, store_id, date, check_in_at, check_out_at) VALUES (?,?,?,?,?)
     ON CONFLICT(seller_id, date) DO UPDATE SET store_id=excluded.store_id, check_in_at=excluded.check_in_at, check_out_at=excluded.check_out_at, auto_closed=0, updated_at=datetime('now')`,
    seller.id, punchStoreId, d, t.inISO, t.outISO
  );
  const hol = await holidayFor(d, punchStoreId);
  res.status(201).json({ punch: punchCalc(await db.get('SELECT * FROM punches WHERE seller_id=? AND date=?', seller.id, d), !!hol, await scheduleFor(seller.id)) });
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
  if (req.user.role === 'staff') return res.status(403).json({ error: 'Sem permissão.' });
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
  const sectorParam = validSector(sector) ? [sector] : [];
  let sellers;
  if (scope.storeId != null) {
    // elenco da loja = todo mundo que VENDEU nela no período (inclui visitantes de outra loja)
    const dateConds = [];
    const dateParams = [];
    if (from) { dateConds.push('sl.sale_date >= ?'); dateParams.push(from); }
    if (to) { dateConds.push('sl.sale_date <= ?'); dateParams.push(to); }
    sellers = await db.all(
      `SELECT DISTINCT u.*, s.name AS store_name FROM users u
       JOIN sale_participants sp ON sp.seller_id=u.id
       JOIN sales sl ON sl.id=sp.sale_id AND sl.store_id=?
       LEFT JOIN stores s ON s.id=u.store_id
       WHERE u.role='seller' AND u.active=1${sectorFilter}${dateConds.length ? ' AND ' + dateConds.join(' AND ') : ''} ORDER BY u.name`,
      scope.storeId, ...sectorParam, ...dateParams
    );
  } else {
    sellers = await db.all(
      `SELECT u.*, s.name AS store_name FROM users u LEFT JOIN stores s ON s.id=u.store_id WHERE u.role='seller' AND u.active=1${sectorFilter} ORDER BY u.name`,
      ...sectorParam
    );
  }
  const rows = await Promise.all(sellers.map(async (s) => {
    const st = await summarize(from || null, to || null, s.id, scope.storeId);
    return { seller_id: s.id, name: s.name, sector: s.sector || 'online', store_id: s.store_id, store_name: s.store_name || 'Sede', avatar_url: s.avatar_url || null, calls: st.calls, sales: st.salesCredit, whatsapp: st.whatsapp, crm: st.crm, presencial: st.presencial, conversion: st.conversion };
  }));
  rows.sort((a, b) => b.sales - a.sales || b.calls - a.calls);
  res.json({ ranking: rows });
}));

app.get('/api/stats/seller/:id', requireAuth, ah(async (req, res) => {
  const targetId = Number(req.params.id);
  if (req.user.role === 'staff') return res.status(403).json({ error: 'Sem permissão.' });
  if (req.user.role === 'manager') {
    const t = await db.get("SELECT * FROM users WHERE id=? AND role='seller'", targetId);
    if (!t || Number(t.store_id) !== Number(req.user.store_id))
      return res.status(403).json({ error: 'Acesso restrito à sua loja.' });
  } else if (req.user.role !== 'admin' && targetId !== req.user.id) {
    return res.status(403).json({ error: 'Sem permissão.' });
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
  const seller = await db.get('SELECT u.*, s.name AS store_name FROM users u LEFT JOIN stores s ON s.id=u.store_id WHERE u.id=?', targetId);
  if (!seller) return res.status(404).json({ error: 'Vendedora não encontrada.' });
  // por loja: onde vendeu no período (calculado, sem campo novo)
  let byStore = [];
  try {
    const stores = await db.all('SELECT * FROM stores WHERE active=1 ORDER BY id');
    byStore = (await Promise.all(stores.map(async (st) => {
      const stt = await summarize(from || null, to || null, targetId, st.id);
      return { store_id: st.id, store_name: st.name, sales: stt.salesCredit, records: stt.records };
    }))).filter((r) => r.records > 0);
  } catch {}
  res.json({
    seller: toPublicUser(seller),
    current,
    byStore,
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
  let sellers = await db.all(
    `SELECT u.*, s.name AS store_name FROM users u LEFT JOIN stores s ON s.id=u.store_id WHERE u.role='seller' AND u.active=1${sectorFilter}${storeFilter} ORDER BY u.name`,
    ...extraParams
  );
  if (scope.storeId != null) {
    // visitantes: venderam na loja no dia mas são de outra loja
    const homeIds = new Set(sellers.map((s) => s.id));
    const visitors = await db.all(
      `SELECT DISTINCT u.*, s.name AS store_name FROM users u
       JOIN sale_participants sp ON sp.seller_id=u.id
       JOIN sales sl ON sl.id=sp.sale_id AND sl.sale_date=? AND sl.store_id=?
       LEFT JOIN stores s ON s.id=u.store_id
       WHERE u.role='seller' AND u.active=1${sectorFilter} ORDER BY u.name`,
      date, scope.storeId, ...(validSector(sector) ? [sector] : [])
    );
    for (const v of visitors) if (!homeIds.has(v.id)) { homeIds.add(v.id); sellers.push(v); }
    sellers.sort((a, b) => String(a.name).localeCompare(String(b.name), 'pt-BR'));
  }
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

app.get('/api/report/monthly', requireAuth, requireManager, ah(async (req, res) => {
  const month = String(req.query.month || '');
  if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'Mês inválido. Use YYYY-MM.' });
  const [yy, mm] = month.split('-').map(Number);
  if (mm < 1 || mm > 12) return res.status(400).json({ error: 'Mês inválido.' });
  const from = `${month}-01`;
  const lastDay = new Date(yy, mm, 0).getDate();
  const to = `${month}-${String(lastDay).padStart(2, '0')}`;
  const { sector, store_id } = req.query;
  const scope = scopedStoreId(req, store_id);
  if (scope.error) return res.status(403).json({ error: scope.error });
  const sectorFilter = validSector(sector) ? ' AND COALESCE(u.sector,\'online\')=?' : '';
  const storeFilter = scope.storeId != null ? ' AND u.store_id=?' : '';
  const extraParams = [...(validSector(sector) ? [sector] : []), ...(scope.storeId != null ? [scope.storeId] : [])];
  let sellers = await db.all(
    `SELECT u.*, s.name AS store_name FROM users u LEFT JOIN stores s ON s.id=u.store_id WHERE u.role='seller' AND u.active=1${sectorFilter}${storeFilter} ORDER BY u.name`,
    ...extraParams
  );
  if (scope.storeId != null) {
    // visitantes: venderam na loja no mês mas são de outra loja
    const homeIds = new Set(sellers.map((s) => s.id));
    const visitors = await db.all(
      `SELECT DISTINCT u.*, s.name AS store_name FROM users u
       JOIN sale_participants sp ON sp.seller_id=u.id
       JOIN sales sl ON sl.id=sp.sale_id AND sl.sale_date>=? AND sl.sale_date<=? AND sl.store_id=?
       LEFT JOIN stores s ON s.id=u.store_id
       WHERE u.role='seller' AND u.active=1${sectorFilter} ORDER BY u.name`,
      from, to, scope.storeId, ...(validSector(sector) ? [sector] : [])
    );
    for (const v of visitors) if (!homeIds.has(v.id)) { homeIds.add(v.id); sellers.push(v); }
    sellers.sort((a, b) => String(a.name).localeCompare(String(b.name), 'pt-BR'));
  }
  const allRows = await Promise.all(sellers.map(async (s) => {
    const st = await summarize(from, to, s.id, scope.storeId);
    return { seller_id: s.id, name: s.name, sector: s.sector || 'online', store_name: s.store_name || 'Sede', calls: st.calls, sales: st.salesCredit };
  }));
  const summary = {
    calls: allRows.reduce((a, r) => a + r.calls, 0),
    salesCredit: allRows.reduce((a, r) => a + r.sales, 0),
    records: 0,
  };
  if (!validSector(sector)) {
    const full = await summarize(from, to, null, scope.storeId);
    summary.records = full.records;
    summary.waRecords = full.waRecords;
    summary.crmRecords = full.crmRecords;
    summary.presRecords = full.presRecords;
  } else {
    const sids = sellers.map((s) => s.id);
    if (sids.length) {
      const ph = sids.map(() => '?').join(',');
      const c = await db.get(
        `SELECT COUNT(DISTINCT s.id) AS t FROM sales s JOIN sale_participants sp ON sp.sale_id=s.id WHERE s.sale_date>=? AND s.sale_date<=? AND sp.seller_id IN (${ph})${scope.storeId != null ? ' AND s.store_id=?' : ''}`,
        from, to, ...sids, ...(scope.storeId != null ? [scope.storeId] : [])
      );
      summary.records = Number(c.t);
    }
  }
  const ranking = allRows.filter((r) => r.sales > 0 || r.calls > 0).sort((a, b) => b.sales - a.sales);
  // detalhamento alfabético por vendedora (relatório WhatsApp mensal) — inclui todas, mesmo zeradas
  const roster = sellers;
  const details = await Promise.all(roster.map(async (s) => {
    const st = await summarize(from, to, s.id, scope.storeId);
    const rows = await db.all(
      `SELECT s.* FROM sales s JOIN sale_participants spf ON spf.sale_id=s.id AND spf.seller_id=? WHERE s.sale_date>=? AND s.sale_date<=?${scope.storeId != null ? ' AND s.store_id=?' : ''} ORDER BY s.sale_date, s.id`,
      s.id, from, to, ...(scope.storeId != null ? [scope.storeId] : [])
    );
    const sales = await Promise.all(rows.map(async (sale) => {
      const full = await saleWithParticipants(sale);
      const me = full.participants.find((p) => p.seller_id === s.id);
      const partners = full.participants.filter((p) => p.seller_id !== s.id).map((p) => p.seller_name);
      return { product: sale.product, channel: sale.channel, store_name: full.store_name, credit: Number(me ? me.credit : 0), partners };
    }));
    return { seller_id: s.id, name: s.name, sector: s.sector || 'online', store_name: s.store_name || 'Sede', active: !!s.active, calls: st.calls, credit: st.salesCredit, records: sales.length, sales };
  }));
  const storeName2 = scope.storeId != null ? ((await getStore(scope.storeId)) || {}).name || '' : '';
  res.json({ month, from, to, sector: validSector(sector) ? sector : 'all', store: storeName2, summary, ranking, details });
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
    // antecipa a trava do sorteio da frase (7:59:59 e 8h SP). Best-effort:
    // o caminho preguiçoso em ensureDraw cobre reinícios e a Vercel.
    const scheduleDraw = () => {
      try {
        const nowMs = Date.now();
        const spNow = new Date(nowMs - 3 * 3600e3);
        const midnightUTC = Date.UTC(spNow.getUTCFullYear(), spNow.getUTCMonth(), spNow.getUTCDate());
        const targets = [midnightUTC + (7 * 3600 + 59 * 60 + 59) * 1000, midnightUTC + 8 * 3600 * 1000]
          .map((t) => t + 3 * 3600e3); // de volta p/ relógio do servidor
        const next = targets.find((t) => t > nowMs) ?? targets[0] + 86400000;
        setTimeout(async () => {
          try { await ensureDraw(todaySP()); } catch (e) { console.log('[draw] agendamento pulado:', e.message); }
          scheduleDraw();
        }, Math.max(1000, next - nowMs));
      } catch {}
    };
    scheduleDraw();
    // push local: verifica as janelas de notificação a cada 1min (na Vercel, o Cron faz esse papel)
    setInterval(async () => {
      try {
        await fetch(`http://localhost:${PORT}/api/cron/notify`, {
          method: 'POST',
          headers: CRON_SECRET ? { Authorization: 'Bearer ' + CRON_SECRET } : {},
        }).catch(() => {});
      } catch {}
    }, 60 * 1000);
  }).catch((e) => {
    console.error('[db] Falha ao inicializar:', e);
    process.exit(1);
  });
}
