/* SellDay PWA — SPA vanilla */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const store = {
  get token() { return localStorage.getItem('ec_token'); },
  set token(v) { v ? localStorage.setItem('ec_token', v) : localStorage.removeItem('ec_token'); },
  get user() { try { return JSON.parse(localStorage.getItem('ec_user')); } catch { return null; } },
  set user(v) { v ? localStorage.setItem('ec_user', JSON.stringify(v)) : localStorage.removeItem('ec_user'); },
};

async function api(path, opts = {}) {
  let res;
  try {
    res = await fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(store.token ? { Authorization: 'Bearer ' + store.token } : {}),     ...(opts.headers || {}) },
    });
  } catch {
    throw new Error('Sem conexão com o servidor. Deixe a janela do servidor aberta e recarregue a página (Ctrl+F5).');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Erro inesperado.');
  return data;
}

// ---------- utils ----------
const todayISO = () => { const d = new Date(); return d.toISOString().slice(0, 10); };
const fmtV = (n) => (Number(n) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
const fmtInt = (n) => (Number(n) || 0).toLocaleString('pt-BR');
const fmtPct = (n) => (n == null || isNaN(n) ? '—' : Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%');
const fmtDateBR = (iso) => { if (!iso) return '—'; const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function monthRange(offset = 0) {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const from = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  const to = `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`;
  return { from, to };
}
function weekRange() {
  const n = new Date();
  const day = (n.getDay() + 6) % 7; // segunda=0
  const mon = new Date(n); mon.setDate(n.getDate() - day);
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  const f = (d) => d.toISOString().slice(0, 10);
  return { from: f(mon), to: f(sun) };
}
const PERIODS = {
  hoje: () => { const t = todayISO(); return { from: t, to: t, label: 'Hoje' }; },
  ontem: () => { const d = new Date(); d.setDate(d.getDate() - 1); const t = d.toISOString().slice(0, 10); return { from: t, to: t, label: 'Ontem' }; },
  semana: () => ({ ...weekRange(), label: 'Esta semana' }),
  mes: () => ({ ...monthRange(0), label: 'Este mês' }),
  mespassado: () => ({ ...monthRange(-1), label: 'Mês passado' }),
};

let adminPeriod = { key: 'hoje', ...PERIODS.hoje() };
let adminChannel = '';
let adminSeller = '';

function toast(msg, type = 'ok') {
  const box = $('#alertBox');
  box.innerHTML = `<div class="alert ${type === 'ok' ? 'alert-ok' : 'alert-err'}">${esc(msg)}</div>`;
  setTimeout(() => { box.innerHTML = ''; }, 4000);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ---------- shell / nav ----------
const ICONS = {
  home: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5 2 11h3v9h5v-6h4v6h5v-9h3z"/></svg>',
  tag: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 2h12v20l-3-2-3 2-3-2-3 2z"/></svg>',
  doc: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6v20h12V8l-4-6zm0 6V3.5L18.5 8H14z"/></svg>',
  chart: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 21V10h4v11zm7 0V3h4v18zm7 0v-7h4v7z"/></svg>',
  team: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 11a4 4 0 1 0-4-4 4 4 0 0 0 4 4zm0 2c-4 0-8 2-8 5v2h16v-2c0-3-4-5-8-5z"/></svg>',
};
function setNav() {
  const u = store.user;
  const nav = $('#bottomNav');
  const badge = $('#userBadge');
  const logout = $('#logoutBtn');
  if (!u) { nav.style.display = 'none'; badge.textContent = ''; logout.style.display = 'none'; return; }
  badge.textContent = `${u.name} • ${u.role === 'admin' ? 'Admin' : 'Vendedora'}`;
  logout.style.display = '';
  nav.style.display = '';
  const fab = `<button class="fab" id="fabSale" aria-label="Nova venda">+</button>`;
  if (u.role === 'admin') {
    nav.innerHTML = `
      <a href="#/admin" title="Início">${ICONS.home}</a>
      <a href="#/admin/vendas" title="Vendas">${ICONS.tag}</a>
      ${fab}
      <a href="#/admin/relatorio" title="Relatório">${ICONS.chart}</a>
      <a href="#/admin/vendedoras" title="Equipe">${ICONS.team}</a>`;
  } else {
    nav.innerHTML = `
      <a href="#/vendedora" title="Início">${ICONS.home}</a>
      ${fab}
      <a href="#/vendedora/historico" title="Histórico">${ICONS.doc}</a>`;
  }
  const fabBtn = $('#fabSale');
  if (fabBtn) fabBtn.onclick = () => modalEscolhaRegistro();
  const h = location.hash;
  const mark = (sel) => $$(sel).forEach((a) => {
    const href = a.getAttribute('href');
    if (!href) return;
    a.classList.toggle('active', href === '#/admin' || href === '#/vendedora' ? h === href : h.startsWith(href));
  });
  mark('#bottomNav a');
}
$('#logoutBtn').onclick = () => { store.token = null; store.user = null; location.hash = '#/login'; };

// ---------- router ----------
window.addEventListener('hashchange', route);
async function route() {
  setNav();
  const h = location.hash || '#/login';
  document.body.classList.toggle('seller-home', h === '#/vendedora');
  const app = $('#app');
  const u = store.user;
  if (!u && h !== '#/login') { location.hash = '#/login'; return; }
  if (u && h === '#/login') { location.hash = u.role === 'admin' ? '#/admin' : '#/vendedora'; return; }

  try {
    if (h === '#/login' || h === '') return viewLogin(app);
    if (h.startsWith('#/vendedora')) {
      if (u.role !== 'seller' && u.role !== 'admin') throw new Error('Sem permissão.');
      if (h === '#/vendedora/config') {
        if (u.role !== 'seller') { location.hash = '#/admin'; return; }
        return viewConfig(app);
      }
      if (h === '#/vendedora/historico' || h === '#/vendedora/vendas') return viewHistory(app);
      return viewSeller(app);
    }
    if (h.startsWith('#/admin')) {
      if (u.role !== 'admin') { location.hash = '#/vendedora'; return; }
      if (h === '#/admin/vendas') return viewAllSales(app);
      if (h === '#/admin/relatorio') return viewReport(app);
      if (h === '#/admin/vendedoras') return viewTeam(app);
      if (h.startsWith('#/admin/vendedora/')) return viewSellerDetail(app, h.split('/').pop());
      return viewAdmin(app);
    }
    return viewLogin(app);
  } catch (e) {
    app.innerHTML = `<div class="card"><h3>Erro ao carregar</h3><p class="muted">${esc(e.message)}</p></div>`;
  }
}

// ---------- LOGIN ----------
function viewLogin(app) {
  setNav();
  app.innerHTML = `
    <div class="login-wrap">
      <div class="card">
        <h2 style="margin:0">Entrar</h2>
        <p class="muted" style="margin:6px 0 0">Acesse com seu e-mail e senha.</p>
        <form id="loginForm">
          <label>E-mail</label>
          <input id="email" type="email" autocomplete="username" placeholder="voce@equipe.com" required>
          <label>Senha</label>
          <div style="position:relative">
            <input id="pass" type="password" autocomplete="current-password" placeholder="••••••" required style="padding-right:52px">
            <button type="button" id="showPass" title="Mostrar senha" style="position:absolute;right:6px;top:50%;transform:translateY(-50%);border:none;background:transparent;font-size:18px;cursor:pointer">👁️</button>
          </div>
          <div style="height:14px"></div>
          <button class="btn btn-primary btn-big" type="submit">Entrar</button>
        </form>
        <p class="muted" style="font-size:12px;margin-top:14px">Acesso demo — admin: <b>admin@equipe.com / admin123</b><br>Vendedora: <b>ana@equipe.com / ana123</b></p>
      </div>
    </div>`;
  $('#showPass').onclick = () => {
    const p = $('#pass');
    p.type = p.type === 'password' ? 'text' : 'password';
  };
  $('#loginForm').onsubmit = async (e) => {
    e.preventDefault();
    try {
      const { token, user } = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: $('#email').value.trim(), password: $('#pass').value }),
      });
      store.token = token; store.user = user;
      location.hash = user.role === 'admin' ? '#/admin' : '#/vendedora';
    } catch (err) { toast(err.message, 'err'); }
  };
}

// ---------- shared widgets ----------
function kpiCards(s, prefix = '') {
  return `
  <div class="grid-kpi">
    <div class="card kpi"><div class="label">📞 Chamadas ${prefix}</div><div class="value mono">${fmtInt(s.calls)}</div></div>
    <div class="card kpi"><div class="label">🛵 Vendas ${prefix}</div><div class="value mono">${fmtV(s.salesCredit)}</div><div class="sub">${fmtInt(s.records)} registro(s)</div></div>
    <div class="card kpi"><div class="label">💬 WhatsApp</div><div class="value mono">${fmtV(s.whatsapp)}</div></div>
    <div class="card kpi"><div class="label">🖥️ CRM</div><div class="value mono">${fmtV(s.crm)}</div><div class="sub">Conversão: ${fmtPct(s.conversion)}</div></div>
  </div>`;
}

// KPIs da vendedora: só Chamadas + Vendas (sem WhatsApp/CRM)
function kpiCardsSeller(s) {
  return `
  <div class="grid-kpi two">
    <div class="card kpi"><div class="label">📞 Chamadas</div><div class="value mono">${fmtInt(s.calls)}</div></div>
    <div class="card kpi"><div class="label">🛵 Vendas</div><div class="value mono">${fmtV(s.salesCredit)}</div><div class="sub">${fmtInt(s.records)} registro(s) • Conversão: ${fmtPct(s.conversion)}</div></div>
  </div>`;
}

function periodPills(currentKey, onPick) {
  const keys = [['hoje', 'Hoje'], ['ontem', 'Ontem'], ['semana', 'Semana'], ['mes', 'Mês'], ['custom', 'Personalizado']];
  return `<div class="pill-filter" id="periodPills">${keys.map(([k, l]) => `<button data-k="${k}" class="${currentKey === k ? 'active' : ''}">${l}</button>`).join('')}</div>`;
}

function bindPeriodPills(cb) {
  $('#periodPills')?.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const k = b.dataset.k;
    if (k === 'custom') { cb({ key: 'custom' }); return; }
    cb({ key: k, ...PERIODS[k]() });
  });
}

function saleCard(s) {
  const parts = (s.participants || []).map((p) => `${esc(p.seller_name)} → ${fmtV(p.credit)}`).join(' · ');
  return `
  <div class="sale-card">
    <div class="row" style="justify-content:space-between;align-items:center">
      <b>${esc(s.customer_name)}</b>
      <span class="chip ${s.channel === 'WhatsApp' ? 'wa' : 'crm'}">${esc(s.channel)}</span>
    </div>
    <div class="muted" style="font-size:13px;margin-top:4px">${esc(s.product)} • ${esc(s.color)} • ${fmtDateBR(s.sale_date)}</div>
    <div style="font-size:13px;margin-top:6px">👥 ${parts}</div>
  </div>`;
}

// linha estilo "transação" p/ últimas vendas da vendedora
function txRow(s, meId) {
  const mine = (s.participants || []).filter((p) => p.seller_id === meId).reduce((a, p) => a + Number(p.credit), 0);
  const ch = s.channel === 'WhatsApp' ? 'wa' : 'crm';
  return `
  <div class="tx">
    <div class="tx-ico ${ch}">${s.channel === 'WhatsApp' ? '💬' : '🖥️'}</div>
    <div class="tx-mid"><b>${esc(s.customer_name)}</b><span>${esc(s.product)} • ${esc(s.color)} • ${fmtDateBR(s.sale_date)}</span></div>
    <div class="tx-amt">+${fmtV(mine)}<small>${esc(s.channel)}</small></div>
  </div>`;
}

// linha estilo Canva p/ lista da vendedora (com nomes das participantes)
function sliRow(s, meId, i = -1) {
  const names = (s.participants || []).map((p) => p.seller_name).join(', ');
  const mine = (s.participants || []).filter((p) => p.seller_id === meId).reduce((a, p) => a + Number(p.credit), 0);
  const delay = i >= 0 ? ` style="animation-delay:${Math.min(i, 9) * 70}ms"` : '';
  return `
  <div class="sli"${delay}>
    <div class="sli-mid"><b>${esc(s.customer_name)}</b><span>${esc(s.product)} - ${esc(s.color)} - ${fmtDateBR(s.sale_date)}</span></div>
    <div class="sli-side"><div class="sli-credit">+${fmtV(mine)}</div><div class="sli-parts">${esc(names)}</div></div>
  </div>`;
}

function rangeFor(k) {
  const t = todayISO();
  if (k === 'hoje') return { from: t, to: t, label: 'Hoje' };
  if (k === 'ontem') {
    const d = new Date(); d.setDate(d.getDate() - 1);
    const y = d.toISOString().slice(0, 10);
    return { from: y, to: y, label: 'Ontem' };
  }
  return { ...weekRange(), label: 'Semana' };
}

function motivFor(sales, target) {
  if (target == null || target <= 0) return 'Defina sua meta do mês! 🎯';
  const p = sales / target;
  if (p >= 1) return 'Meta batida! 🎉';
  if (p >= 0.7) return 'Estamos quase lá!';
  if (p > 0) return 'Bom começo, vamos subir! 🚀';
  return 'Um novo dia, novas vendas! 💪';
}

// contagem 0 → valor (sensação de progresso)
function countUp(el, target, dur = 1300) {
  if (!el) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { el.textContent = fmtV(target); return; }
  const t0 = performance.now();
  const step = (now) => {
    const p = Math.min(1, (now - t0) / dur);
    const e = 1 - Math.pow(1 - p, 3);
    el.textContent = fmtV(target * e);
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function modalGoal(current, month) {
  $('#modalRoot').innerHTML = `
  <div class="modal-bg" id="mbg"><div class="modal">
    <h3 style="margin:0">Minha meta de ${month.slice(5, 7)}/${month.slice(0, 4)}</h3>
    <p class="muted" style="font-size:13px">Quantas vendas você quer fazer neste mês?</p>
    <form id="fGoal">
      <label>Meta (vendas)</label>
      <input id="gVal" type="number" min="0" max="100000" step="0.5" value="${current ?? ''}" placeholder="Ex: 50" required>
      <div style="height:12px"></div>
      <button class="btn btn-primary btn-big" type="submit">Salvar meta</button>
      <button class="btn btn-ghost btn-big" type="button" id="cancel">Cancelar</button>
    </form>
  </div></div>`;
  $('#cancel').onclick = closeModal;
  $('#mbg').onclick = (e) => { if (e.target.id === 'mbg') closeModal(); };
  $('#fGoal').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('/api/goals', { method: 'PUT', body: JSON.stringify({ month, target: Number($('#gVal').value) }) });
      closeModal(); toast('Meta salva!'); route();
    } catch (err) { toast(err.message, 'err'); }
  };
}

// ---------- SELLER HOME (layout Canva) ----------
async function viewSeller(app) {
  const me = store.user;
  const t = todayISO();
  const m = monthRange(0);
  const mk = t.slice(0, 7);
  app.innerHTML = `<div class="card"><p class="muted">Carregando…</p></div>`;
  // cada bloco tem fallback: a home nunca trava por causa de um widget
  const [monthSum, goalRes, phraseRes] = await Promise.all([
    api(`/api/stats/summary?from=${m.from}&to=${m.to}`).catch(() => ({ salesCredit: 0, calls: 0, conversion: null, records: 0, whatsapp: 0, crm: 0 })),
    api(`/api/goals/me?month=${mk}`).catch(() => ({ target: null })),
    api('/api/phrases/today').catch(() => ({ text: '' })),
  ]);
  const target = goalRes.target;
  app.innerHTML = `
    <div class="seller-head">
      <div class="seller-top">
        <div class="ava-wrap">
          <div class="ava">${me.avatar_url ? `<img src="${me.avatar_url}" alt="Foto de perfil">` : esc((me.name || '?')[0].toUpperCase())}</div>
          <button class="ava-cam" id="avaCam" title="Trocar foto">📷</button>
          <input type="file" id="avaInput" accept="image/*" style="display:none">
        </div>
        <div class="seller-hi" style="flex:1">Olá, ${esc(me.name.split(' ')[0])}</div>
        <a class="seller-gear" href="#/vendedora/config" title="Configurações">⚙️</a>
      </div>
      <div class="seller-motiv">${motivFor(monthSum.salesCredit, target)}</div>
      <div class="goal-pill">
        <div class="goal-left"><div class="goal-lab">Vendas deste mês:</div><div class="goal-num mono" id="goalMonth">0</div></div>
        <div class="goal-div"></div>
        <button class="goal-right" id="goalEdit" title="Definir minha meta">
          <div class="goal-lab">Meta</div>
          <div class="goal-num mono">${target == null ? '—' : fmtV(target)}</div>
        </button>
      </div>
    </div>
    <div class="phrase"><div class="phrase-title">Frase do dia:</div><div class="phrase-text">“${esc(phraseRes.text || 'Boas vendas!') }”</div>
      ${phraseRes.author ? `<div class="phrase-author">— ${esc(phraseRes.author)}</div>` : ''}
      ${!phraseRes.author && phraseRes.canWrite ? `<button class="btn btn-accent" id="writePhrase">✍️ Hoje é seu dia! Escrever a frase</button>` : ''}
      ${!phraseRes.author && !phraseRes.canWrite && phraseRes.drawnSellerName ? `<div class="muted" style="font-size:12px;margin-top:8px">Aguardando ${esc(phraseRes.drawnSellerName.split(' ')[0])} escrever…</div>` : ''}
    </div>
    <div class="mini-pills" id="homePills">
      <button data-k="hoje" class="on">Hoje</button>
      <button data-k="ontem">Ontem</button>
      <button data-k="semana">Semana</button>
    </div>
    <div id="homeList"><div class="card empty">Carregando…</div></div>
    <div class="foot">Desenvolvido pela Wisionarium</div>
  `;
  $('#goalEdit').onclick = () => modalGoal(target, mk);
  countUp($('#goalMonth'), monthSum.salesCredit);
  bindAvatar();
  const wp = $('#writePhrase');
  if (wp) wp.onclick = () => modalPhrase();
  const loadList = async (k) => {
    const r = rangeFor(k);
    try {
      const { sales } = await api(`/api/sales?from=${r.from}&to=${r.to}`);
      $('#homeList').innerHTML = sales.length
        ? sales.slice(0, 20).map((s, idx) => sliRow(s, me.id, idx)).join('')
        : '<div class="card empty">Nenhuma venda neste período.</div>';
    } catch (e) {
      $('#homeList').innerHTML = `<div class="card empty">${esc(e.message)}</div>`;
    }
  };
  $('#homePills').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    $$('#homePills button').forEach((x) => x.classList.toggle('on', x === b));
    loadList(b.dataset.k);
  };
  loadList('hoje');
}

// ---------- TEMA da vendedora (só verdes, fundo sempre branco) ----------
function applyThemeVars(t) {
  if (!t) return;
  const r = document.documentElement.style;
  r.setProperty('--brand', t.brand);
  r.setProperty('--brand-2', t.brand2);
  r.setProperty('--accent', t.accent);
  r.setProperty('--brand-soft', t.soft);
  r.setProperty('--accent-weak', t.weak);
}
try {
  const su = store.user;
  if (su && su.role === 'seller') {
    const cached = JSON.parse(localStorage.getItem('ec_theme_' + su.id) || 'null');
    if (cached) applyThemeVars(cached);
  }
} catch { /* sem tema em cache */ }
async function refreshTheme() {
  try {
    if (store.user?.role !== 'seller') return;
    const { presets, preset } = await api('/api/settings/theme');
    if (presets[preset]) {
      applyThemeVars(presets[preset]);
      localStorage.setItem('ec_theme_' + store.user.id, JSON.stringify(presets[preset]));
    }
  } catch { /* mantém padrão */ }
}

// upload da foto de perfil (redimensiona no celular antes de enviar)
function processAvatar(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) return reject(new Error('Escolha um arquivo de imagem.'));
    const img = new Image();
    img.onload = () => {
      try {
        const S = 160, c = document.createElement('canvas');
        c.width = c.height = S;
        const ctx = c.getContext('2d');
        const sc = Math.max(S / img.width, S / img.height);
        const w = img.width * sc, hh = img.height * sc;
        ctx.fillStyle = '#0b3b2c'; ctx.fillRect(0, 0, S, S);
        ctx.drawImage(img, (S - w) / 2, (S - hh) / 2, w, hh);
        resolve(c.toDataURL('image/jpeg', 0.82));
      } catch { reject(new Error('Não foi possível ler a imagem.')); }
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => reject(new Error('Não foi possível ler a imagem.'));
    img.src = URL.createObjectURL(file);
  });
}
function bindAvatar() {
  const inp = $('#avaInput');
  if (!inp) return;
  $('#avaCam').onclick = () => inp.click();
  inp.onchange = () => {
    const f = inp.files[0]; if (!f) return;
    processAvatar(f)
      .then((url) => api('/api/me/avatar', { method: 'PUT', body: JSON.stringify({ avatar: url }) }))
      .then(({ user }) => { store.user = user; toast('Foto atualizada!'); route(); })
      .catch((e) => toast(e.message, 'err'));
  };
}

function modalPhrase() {
  $('#modalRoot').innerHTML = `
  <div class="modal-bg anim-up" id="mbg"><div class="modal">
    <h3 style="margin:0">Frase de hoje ✍️</h3>
    <p class="muted" style="font-size:13px">Você foi sorteada! Escreva algo para inspirar a equipe (máx. 140 caracteres).</p>
    <form id="fPhrase">
      <label>Sua frase</label>
      <textarea id="phText" rows="3" maxlength="140" placeholder="Ex: Hoje é dia de recorde!" style="width:100%;padding:13px 14px;border:1px solid var(--line);border-radius:14px;font-size:15px;font-family:inherit" required></textarea>
      <div class="muted" style="font-size:12px;text-align:right"><span id="phCount">0</span>/140</div>
      <div style="height:8px"></div>
      <button class="btn btn-primary btn-big" type="submit">Publicar frase</button>
      <button class="btn btn-ghost btn-big" type="button" id="cancel">Cancelar</button>
    </form>
  </div></div>`;
  $('#cancel').onclick = closeModal;
  $('#mbg').onclick = (e) => { if (e.target.id === 'mbg') closeModal(); };
  $('#phText').oninput = (e) => { $('#phCount').textContent = e.target.value.length; };
  $('#fPhrase').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('/api/phrases/daily', { method: 'POST', body: JSON.stringify({ text: $('#phText').value }) });
      closeModal(); toast('Frase publicada! 💚'); route();
    } catch (err) { toast(err.message, 'err'); }
  };
}

// ---------- CONFIGURAÇÕES da vendedora ----------
async function viewConfig(app) {
  const me = store.user;
  app.innerHTML = `
    <a href="#/vendedora" class="muted" style="font-size:13px">← Voltar</a>
    <h2 style="margin:6px 0">Configurações</h2>
    <div class="card">
      <div class="row" style="align-items:center;flex-wrap:nowrap">
        <div class="ava-wrap">
          <div class="ava" style="width:64px;height:64px;font-size:26px">${me.avatar_url ? `<img src="${me.avatar_url}" alt="Foto de perfil">` : esc((me.name || '?')[0].toUpperCase())}</div>
        </div>
        <div style="flex:1"><b>${esc(me.name)}</b><br><span class="muted" style="font-size:12px">${esc(me.email)}</span></div>
      </div>
      <div style="height:10px"></div>
      <button class="btn btn-big" id="cfgPhoto">📷 Trocar foto de perfil</button>
      <input type="file" id="cfgAvaInput" accept="image/*" style="display:none">
    </div>
    <h3 class="section-title">Tema do app</h3>
    <div class="card">
      <div class="check-list" id="themeGrid"><p class="muted">Carregando…</p></div>
      <p class="muted" style="font-size:12px">Só tons de verde. O fundo fica sempre branco e os textos sempre legíveis.</p>
    </div>
    <div style="height:14px"></div>
    <button class="btn btn-big" id="cfgLogout">Sair da conta</button>
    <div class="foot">Desenvolvido pela Wisionarium</div>
  `;
  $('#cfgPhoto').onclick = () => $('#cfgAvaInput').click();
  $('#cfgAvaInput').onchange = () => {
    const f = $('#cfgAvaInput').files[0]; if (!f) return;
    processAvatar(f)
      .then((url) => api('/api/me/avatar', { method: 'PUT', body: JSON.stringify({ avatar: url }) }))
      .then(({ user }) => { store.user = user; toast('Foto atualizada!'); route(); })
      .catch((e) => toast(e.message, 'err'));
  };
  $('#cfgLogout').onclick = () => { store.token = null; store.user = null; location.hash = '#/login'; };
  try {
    const { presets, preset } = await api('/api/settings/theme');
    $('#themeGrid').innerHTML = Object.entries(presets).map(([id, t]) => `
      <div class="check ${id === preset ? 'on' : ''}" data-theme="${id}">
        <span class="swdot" style="background:linear-gradient(135deg, ${t.brand} 50%, ${t.accent} 50%)"></span>${esc(t.name)}
      </div>`).join('');
    $('#themeGrid').onclick = async (e) => {
      const c = e.target.closest('[data-theme]'); if (!c) return;
      try {
        const { theme } = await api('/api/settings/theme', { method: 'PUT', body: JSON.stringify({ preset: c.dataset.theme }) });
        applyThemeVars(theme);
        localStorage.setItem('ec_theme_' + me.id, JSON.stringify(theme));
        $$('#themeGrid .check').forEach((x) => x.classList.toggle('on', x === c));
        toast('Tema aplicado! 💚');
      } catch (err) { toast(err.message, 'err'); }
    };
  } catch (e) {
    $('#themeGrid').innerHTML = `<div class="empty">${esc(e.message)}</div>`;
  }
}

// ---------- HISTÓRICO da vendedora (ícone papel) ----------
async function viewHistory(app) {
  const me = store.user;
  app.innerHTML = `
    <h2 style="margin:4px 0">Meu histórico</h2>
    <div class="hist-filters">
      <div class="mini-pills" id="hPills">
        <button data-k="hoje" class="on">Hoje</button>
        <button data-k="ontem">Ontem</button>
        <button data-k="semana">Semana</button>
        <button data-k="mes">Mês</button>
      </div>
      <div class="search-row">
        <select id="hChannel"><option value="">Todos os canais</option><option>WhatsApp</option><option>CRM</option></select>
        <input id="hQ" placeholder="Buscar cliente, produto…">
      </div>
    </div>
    <div id="hList"><div class="card empty">Carregando…</div></div>
    <div class="foot">Desenvolvido pela Wisionarium</div>
  `;
  let key = 'hoje';
  const load = async () => {
    const r = key === 'mes' ? { ...monthRange(0), label: 'Mês' } : rangeFor(key);
    const qs = new URLSearchParams({ from: r.from, to: r.to });
    if ($('#hChannel').value) qs.set('channel', $('#hChannel').value);
    if ($('#hQ').value.trim()) qs.set('q', $('#hQ').value.trim());
    try {
      const { sales } = await api(`/api/sales?${qs}`);
      const mine = sales.reduce((a, s) => a + s.participants.filter((p) => p.seller_id === me.id).reduce((x, p) => x + Number(p.credit), 0), 0);
      $('#hList').innerHTML = `
        <p class="muted" style="margin:4px 0 10px">${r.label} • ${sales.length} registro(s) • <b class="mono">${fmtV(mine)} vendas</b></p>
        ${sales.length ? sales.map((s) => sliRow(s, me.id)).join('') : '<div class="card empty">Nenhuma venda neste período.</div>'}`;
    } catch (e) {
      $('#hList').innerHTML = `<div class="card empty">${esc(e.message)}</div>`;
    }
  };
  $('#hPills').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    $$('#hPills button').forEach((x) => x.classList.toggle('on', x === b));
    key = b.dataset.k; load();
  };
  $('#hChannel').onchange = load;
  let deb = null;
  $('#hQ').oninput = () => { clearTimeout(deb); deb = setTimeout(load, 400); };
  load();
}

async function viewMySales(app) {
  app.innerHTML = `<h2 style="margin:4px 0">Minhas vendas</h2><div class="card"><p class="muted">Carregando…</p></div>`;
  const m = monthRange(0);
  const { sales } = await api(`/api/sales?from=${m.from}&to=${m.to}`);
  app.innerHTML = `
    <h2 style="margin:4px 0">Minhas vendas</h2>
    <p class="muted">Este mês • ${sales.length} registro(s)</p>
    ${sales.length ? sales.map(saleCard).join('') : '<div class="card empty">Não há vendas registradas neste período.</div>'}
    <button class="btn btn-accent btn-big" id="btnSale2">+ Registrar venda</button>`;
  $('#btnSale2').onclick = async () => {
    const { sellers } = await api('/api/sellers');
    modalSale(sellers);
  };
}

// ---------- modals ----------
function closeModal() { $('#modalRoot').innerHTML = ''; }

function modalCalls() {
  $('#modalRoot').innerHTML = `
  <div class="modal-bg" id="mbg"><div class="modal">
    <h3 style="margin:0">Registrar chamadas</h3>
    <form id="fCalls">
      <label>Data</label><input type="date" id="cDate" value="${todayISO()}" max="${todayISO()}" required>
      <label>Quantidade de chamadas</label><input type="number" id="cQty" min="1" max="2000" placeholder="Ex: 30" required>
      <div style="height:12px"></div>
      <button class="btn btn-primary btn-big" type="submit">Registrar chamadas</button>
      <button class="btn btn-ghost btn-big" type="button" id="cancel">Cancelar</button>
    </form>
  </div></div>`;
  $('#cancel').onclick = closeModal;
  $('#mbg').onclick = (e) => { if (e.target.id === 'mbg') closeModal(); };
  $('#fCalls').onsubmit = async (e) => {
    e.preventDefault();
    try {
      const body = { date: $('#cDate').value, quantity: Number($('#cQty').value) };
      if (store.user.role === 'admin') {
        const { sellers } = await api('/api/sellers');
        // admin escolhe: usa prompt simples via select injetado? simplifica: primeira ativa
        body.seller_id = sellers[0]?.id;
      }
      await api('/api/calls', { method: 'POST', body: JSON.stringify(body) });
      closeModal(); toast('Chamadas registradas!'); route();
    } catch (err) { toast(err.message, 'err'); }
  };
}

function modalSale(sellers) {
  const me = store.user;
  const preselected = me.role === 'seller' ? [me.id] : [];
  $('#modalRoot').innerHTML = `
  <div class="modal-bg" id="mbg"><div class="modal">
    <h3 style="margin:0">Nova venda</h3>
    <p class="muted" style="font-size:13px">Individual = 1,0 • Compartilhada (2–3) = 0,5 cada.</p>
    <form id="fSale">
      <label>Cliente *</label><input id="sClient" required placeholder="Nome do cliente">
      <label>Produto *</label><input id="sProduct" required placeholder="Ex: Scooter X">
      <label>Cor *</label><input id="sColor" required placeholder="Ex: Preta">
      <label>Canal *</label>
      <select id="sChannel"><option>WhatsApp</option><option>CRM</option></select>
      <label>Data</label><input type="date" id="sDate" value="${todayISO()}" max="${todayISO()}">
      <label>Participantes (1 a 3) *</label>
      <div class="check-list" id="plist">
        ${sellers.filter((s) => s.active !== false).map((s) => `<div class="check ${preselected.includes(s.id) ? 'on' : ''}" data-id="${s.id}">${esc(s.name)}</div>`).join('')}
      </div>
      <div style="height:12px"></div>
      <button class="btn btn-accent btn-big" type="submit">Registrar venda</button>
      <button class="btn btn-ghost btn-big" type="button" id="cancel">Cancelar</button>
    </form>
  </div></div>`;
  $('#cancel').onclick = closeModal;
  $('#mbg').onclick = (e) => { if (e.target.id === 'mbg') closeModal(); };
  $('#plist').onclick = (e) => {
    const c = e.target.closest('.check'); if (!c) return;
    c.classList.toggle('on');
    if ($$('#plist .check.on').length > 3) { c.classList.remove('on'); toast('Máximo de 3 participantes.', 'err'); }
  };
  $('#fSale').onsubmit = async (e) => {
    e.preventDefault();
    const pids = $$('#plist .check.on').map((c) => Number(c.dataset.id));
    if (!pids.length) return toast('Selecione ao menos 1 participante.', 'err');
    try {
      await api('/api/sales', {
        method: 'POST',
        body: JSON.stringify({
          customer_name: $('#sClient').value.trim(),
          product: $('#sProduct').value.trim(),
          color: $('#sColor').value.trim(),
          channel: $('#sChannel').value,
          sale_date: $('#sDate').value || todayISO(),
          participant_ids: pids,
        }),
      });
      closeModal(); toast('Venda registrada!'); route();
    } catch (err) { toast(err.message, 'err'); }
  };
}

// ---------- ADMIN ----------
async function viewAdmin(app) {
  app.innerHTML = `
    <h2 style="margin:4px 0">Visão geral</h2>
    ${periodPills(adminPeriod.key)}
    <div id="customRow" style="display:${adminPeriod.key === 'custom' ? 'block' : 'none'}" class="card">
      <div class="row"><div style="flex:1"><label>De</label><input type="date" id="fFrom" value="${adminPeriod.from || ''}"></div>
      <div style="flex:1"><label>Até</label><input type="date" id="fTo" value="${adminPeriod.to || ''}"></div></div>
      <div style="height:10px"></div><button class="btn btn-primary" id="applyCustom">Aplicar</button>
    </div>
    <div class="row" style="margin:10px 0">
      <select id="fSeller" style="flex:1;max-width:240px"><option value="">Todas as vendedoras</option></select>
      <select id="fChannel" style="flex:1;max-width:200px"><option value="">Todos os canais</option><option ${adminChannel === 'WhatsApp' ? 'selected' : ''}>WhatsApp</option><option ${adminChannel === 'CRM' ? 'selected' : ''}>CRM</option></select>
    </div>
    <div id="adminBody"><div class="card"><p class="muted">Carregando…</p></div></div>`;
  bindPeriodPills((p) => {
    if (p.key === 'custom') { adminPeriod = { key: 'custom', from: adminPeriod.from, to: adminPeriod.to }; route(); return; }
    adminPeriod = p; route();
  });
  $('#applyCustom')?.addEventListener('click', () => {
    adminPeriod = { key: 'custom', from: $('#fFrom').value, to: $('#fTo').value, label: 'Personalizado' };
    loadAdminBody();
  });

  const { sellers } = await api('/api/sellers');
  const sel = $('#fSeller');
  sel.innerHTML = `<option value="">Todas as vendedoras</option>` + sellers.map((s) => `<option value="${s.id}" ${String(adminSeller) === String(s.id) ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
  sel.onchange = () => { adminSeller = sel.value; loadAdminBody(); };
  $('#fChannel').onchange = (e) => { adminChannel = e.target.value; loadAdminBody(); };
  await loadAdminBody();

  async function loadAdminBody() {
    const { from, to } = adminPeriod;
    const qs = new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}) });
    const body = $('#adminBody');
    const [summary, ranking] = await Promise.all([
      api(`/api/stats/summary?${qs}${adminSeller ? `&seller_id=${adminSeller}` : ''}`),
      api(`/api/stats/ranking?${qs}`),
    ]);
    const filtered = adminSeller ? ranking.ranking.filter((r) => String(r.seller_id) === String(adminSeller)) : ranking.ranking;
    const withChannel = adminChannel
      ? filtered.map((r) => ({ ...r, sales: adminChannel === 'WhatsApp' ? r.whatsapp : r.crm }))
      : filtered;
    body.innerHTML = `
      <p class="muted" style="margin:12px 0">${esc(adminPeriod.label || '')} • ${from ? fmtDateBR(from) : '…'} a ${to ? fmtDateBR(to) : '…'}</p>
      ${kpiCards(summary)}
      <h3 class="section-title">Ranking</h3>
      ${withChannel.length ? `
      <div class="card" style="padding:0;overflow:hidden">
        <table><thead><tr><th>#</th><th>Vendedora</th><th>Chamadas</th><th>Vendas</th><th>Conv.</th></tr></thead>
        <tbody>${withChannel.map((r, i) => `<tr>
          <td>${i + 1}</td>
          <td><a href="#/admin/vendedora/${r.seller_id}"><b>${esc(r.name)}</b></a></td>
          <td class="mono">${fmtInt(r.calls)}</td><td class="mono"><b>${fmtV(r.sales)}</b></td><td class="mono">${fmtPct(r.conversion)}</td>
        </tr>`).join('')}</tbody></table>
      </div>` : '<div class="card empty">Não há dados neste período.</div>'}
    `;
  }
}

// menu do botão central: escolher o que registrar
function modalEscolhaRegistro() {
  $('#modalRoot').innerHTML = `
  <div class="modal-bg anim-up" id="mbg"><div class="modal">
    <h3 style="margin:0">O que deseja registrar?</h3>
    <p class="muted" style="font-size:13px">Escolha uma opção abaixo.</p>
    <button class="btn btn-accent btn-big" id="chSale">🛵 Registrar venda</button>
    <div style="height:10px"></div>
    <button class="btn btn-primary btn-big" id="chCalls">📞 Registrar chamadas</button>
    <button class="btn btn-ghost btn-big" id="cancel">Cancelar</button>
  </div></div>`;
  $('#cancel').onclick = closeModal;
  $('#mbg').onclick = (e) => { if (e.target.id === 'mbg') closeModal(); };
  $('#chSale').onclick = async () => {
    try {
      const { sellers } = await api('/api/sellers');
      modalSale(sellers);
    } catch (e) { toast(e.message, 'err'); }
  };
  $('#chCalls').onclick = () => {
    if (store.user.role === 'admin') modalCallsAdmin();
    else modalCalls();
  };
}

function modalCallsAdmin() {
  api('/api/sellers').then(({ sellers }) => {
    $('#modalRoot').innerHTML = `
    <div class="modal-bg" id="mbg"><div class="modal">
      <h3 style="margin:0">Registrar chamadas</h3>
      <form id="fCallsA">
        <label>Vendedora</label><select id="cSeller">${sellers.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select>
        <label>Data</label><input type="date" id="cDate" value="${todayISO()}" max="${todayISO()}">
        <label>Quantidade</label><input type="number" id="cQty" min="1" max="2000" required>
        <div style="height:12px"></div>
        <button class="btn btn-primary btn-big" type="submit">Registrar</button>
        <button class="btn btn-ghost btn-big" type="button" id="cancel">Cancelar</button>
      </form>
    </div></div>`;
    $('#cancel').onclick = closeModal;
    $('#fCallsA').onsubmit = async (e) => {
      e.preventDefault();
      try {
        await api('/api/calls', { method: 'POST', body: JSON.stringify({ seller_id: Number($('#cSeller').value), date: $('#cDate').value, quantity: Number($('#cQty').value) }) });
        closeModal(); toast('Chamadas registradas!'); route();
      } catch (err) { toast(err.message, 'err'); }
    };
  });
}

async function viewAllSales(app) {
  const { from, to } = adminPeriod;
  app.innerHTML = `<h2 style="margin:4px 0">Vendas</h2>
    <div class="card"><label>Buscar</label><input id="q" placeholder="Cliente, produto, cor…">
    <div class="row" style="margin-top:8px">
      <select id="ch" style="flex:1"><option value="">Todos os canais</option><option>WhatsApp</option><option>CRM</option></select>
      <button class="btn btn-primary" id="go">Filtrar</button>
    </div></div>
    <div id="list" style="margin-top:12px"><div class="card"><p class="muted">Carregando…</p></div></div>`;
  const load = async () => {
    const qs = new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}), ...(adminSeller ? { seller_id: adminSeller } : {}), ...($('#ch').value ? { channel: $('#ch').value } : {}), ...($('#q').value ? { q: $('#q').value } : {}) });
    const { sales } = await api(`/api/sales?${qs}`);
    $('#list').innerHTML = sales.length
      ? sales.map((s) => saleCard(s) + (store.user.role === 'admin' ? `<button class="btn btn-ghost" data-del="${s.id}" style="font-size:12px">Excluir #${s.id}</button>` : '')).join('')
      : '<div class="card empty">Não há vendas registradas neste período.</div>';
    $$('#list [data-del]').forEach((b) => (b.onclick = async () => {
      if (!confirm('Excluir esta venda?')) return;
      await api(`/api/sales/${b.dataset.del}`, { method: 'DELETE' });
      toast('Venda excluída.'); load();
    }));
  };
  $('#go').onclick = load;
  await load();
}

async function viewSellerDetail(app, id) {
  const m = monthRange(0), pm = monthRange(-1);
  app.innerHTML = `<div class="card"><p class="muted">Carregando…</p></div>`;
  const d = await api(`/api/stats/seller/${id}?from=${m.from}&to=${m.to}&cfrom=${pm.from}&cto=${pm.to}`);
  const max = Math.max(0.1, ...d.daily.map((x) => x.sales));
  app.innerHTML = `
    <a href="#/admin" class="muted" style="font-size:13px">← Voltar</a>
    <h2 style="margin:6px 0">${esc(d.seller.name)}</h2>
    ${kpiCards(d.current, '• mês')}
    <div class="card" style="margin-top:12px">
      <b>Comparação com mês anterior</b>
      <table><thead><tr><th></th><th>Atual</th><th>Anterior</th><th>Δ</th></tr></thead><tbody>
        <tr><td>Vendas</td><td class="mono">${fmtV(d.current.salesCredit)}</td><td class="mono">${fmtV(d.compare.salesCredit)}</td><td class="${(d.deltas.sales ?? 0) >= 0 ? 'delta-up' : 'delta-down'}">${d.deltas.sales == null ? '—' : (d.deltas.sales >= 0 ? '↑ ' : '↓ ') + fmtPct(Math.abs(d.deltas.sales)).replace('%', '') + '%'}</td></tr>
        <tr><td>Chamadas</td><td class="mono">${fmtInt(d.current.calls)}</td><td class="mono">${fmtInt(d.compare.calls)}</td><td>${d.deltas.calls == null ? '—' : fmtPct(d.deltas.calls)}</td></tr>
        <tr><td>Conversão</td><td class="mono">${fmtPct(d.current.conversion)}</td><td class="mono">${fmtPct(d.compare.conversion)}</td><td>${d.deltas.conversion == null ? '—' : fmtPct(d.deltas.conversion)}</td></tr>
        <tr><td>WhatsApp</td><td class="mono">${fmtV(d.current.whatsapp)}</td><td class="mono">${fmtV(d.compare.whatsapp)}</td><td>${d.deltas.whatsapp == null ? '—' : fmtPct(d.deltas.whatsapp)}</td></tr>
        <tr><td>CRM</td><td class="mono">${fmtV(d.current.crm)}</td><td class="mono">${fmtV(d.compare.crm)}</td><td>${d.deltas.crm == null ? '—' : fmtPct(d.deltas.crm)}</td></tr>
      </tbody></table>
    </div>
    <h3 class="section-title">Evolução diária (vendas)</h3>
    <div class="card">${d.daily.length ? d.daily.map((x) => `<div class="bar-row"><span>${fmtDateBR(x.date).slice(0, 5)}</span><div class="bar"><div style="width:${(x.sales / max) * 100}%"></div></div><b class="mono">${fmtV(x.sales)}</b></div>`).join('') : '<div class="empty">Sem vendas no período.</div>'}</div>
  `;
}

async function viewReport(app) {
  const t = todayISO();
  app.innerHTML = `<h2 style="margin:4px 0">Relatório do dia</h2><div class="card"><label>Data</label><input type="date" id="rDate" value="${t}" max="${t}"><div style="height:10px"></div><button class="btn btn-primary" id="rGo">Gerar</button></div><div id="rBody" style="margin-top:12px"></div>`;
  const load = async () => {
    const date = $('#rDate').value || t;
    const { summary, ranking } = await api(`/api/report/daily?date=${date}`);
    const medals = ['🥇', '🥈', '🥉'];
    const msg =
      `📊 *RELATÓRIO COMERCIAL — ${fmtDateBR(date)}*\n\n📞 Chamadas: ${fmtInt(summary.calls)}\n🛵 Vendas: ${fmtV(summary.salesCredit)}\n\n💬 WhatsApp: ${fmtV(summary.whatsapp)}\n🖥️ CRM: ${fmtV(summary.crm)}\n\n🏆 *DESTAQUES DO DIA*\n\n` +
      (ranking.slice(0, 5).map((r, i) => `${medals[i] || '•'} ${r.name} — ${fmtV(r.sales)} vendas`).join('\n') || 'Sem vendas no dia.') +
      `\n\n📈 Conversão: ${fmtPct(summary.conversion)}\n\nExcelente trabalho, equipe! 🚀`;
    const waLink = (phone) => `https://wa.me/${phone ? phone.replace(/\D/g, '') : ''}?text=${encodeURIComponent(msg)}`;
    $('#rBody').innerHTML = `
      <div class="card">
        <h3 style="margin:0">📊 RELATÓRIO COMERCIAL</h3>
        <p class="muted">Data: ${fmtDateBR(date)}</p>
        ${kpiCards(summary)}
        <h4>🏆 Ranking do dia</h4>
        ${ranking.length ? ranking.map((r, i) => `<div>${medals[i] || '•'} <b>${esc(r.name)}</b> — ${fmtV(r.sales)} vendas <span class="muted">(${fmtInt(r.calls)} chamadas)</span></div>`).join('') : '<div class="empty">Sem vendas neste dia.</div>'}
        <label style="margin-top:14px">Número de destino (opcional, com DDI+DDD)</label>
        <input id="waPhone" inputmode="tel" placeholder="Ex: 5511999999999">
        <div style="height:10px"></div>
        <a class="btn btn-green btn-big" id="waBtn" href="${waLink('')}" target="_blank" rel="noopener" style="display:block;text-align:center;text-decoration:none">📲 Enviar relatório no WhatsApp</a>
        <button class="btn btn-big" id="copyBtn" style="margin-top:8px">Copiar mensagem</button>
      </div>`;
    $('#waPhone').oninput = (e) => { $('#waBtn').href = waLink(e.target.value); };
    $('#copyBtn').onclick = async () => { await navigator.clipboard.writeText(msg).catch(() => {}); toast('Mensagem copiada!'); };
  };
  $('#rGo').onclick = load;
  await load();
}

async function viewTeam(app) {
  app.innerHTML = `<div class="row" style="justify-content:space-between;align-items:center"><h2>Equipe</h2><button class="btn btn-primary" id="add">+ Nova vendedora</button></div><div id="teamBody"><div class="card"><p class="muted">Carregando…</p></div></div>`;
  const load = async () => {
    try {
      const { users } = await api('/api/users');
    const sellers = users.filter((u) => u.role === 'seller');
    $('#teamBody').innerHTML = sellers.length ? `<div class="card" style="padding:0;overflow:hidden"><table>
      <thead><tr><th>Nome</th><th>Status</th><th>Ações</th></tr></thead><tbody>
      ${sellers.map((s) => `<tr><td><div class="row" style="align-items:center;gap:8px;flex-wrap:nowrap"><span class="ava sm">${s.avatar_url ? `<img src="${s.avatar_url}" alt="">` : esc((s.name || '?')[0].toUpperCase())}</span><span><b>${esc(s.name)}</b><br><span class="muted" style="font-size:12px">${esc(s.email)}</span></span></div></td>
      <td>${s.active ? '✅ Ativa' : '⏸️ Inativa'}</td>
      <td><button class="btn" data-edit="${s.id}">Editar</button> <button class="btn" data-toggle="${s.id}">${s.active ? 'Desativar' : 'Ativar'}</button></td></tr>`).join('')}
      </tbody></table></div>` : '<div class="card empty">Nenhuma vendedora cadastrada.</div>';
    $$('#teamBody [data-toggle]').forEach((b) => (b.onclick = async () => {
      const id = b.dataset.toggle;
      const current = users.find((u) => String(u.id) === String(id));
      await api(`/api/users/${id}/status`, { method: 'PATCH', body: JSON.stringify({ active: !current.active }) });
      toast('Status atualizado!'); load();
    }));
    $$('#teamBody [data-edit]').forEach((b) => (b.onclick = () => modalUser(users.find((u) => String(u.id) === String(b.dataset.edit)), load)));
    } catch (e) {
      $('#teamBody').innerHTML = `<div class="card"><p><b>Não foi possível carregar a equipe.</b></p><p class="muted">${esc(e.message)}</p><button class="btn btn-primary" id="retry">Tentar novamente</button></div>`;
      $('#retry').onclick = load;
    }
  };
  $('#add').onclick = () => modalUser(null, load);
  await load();
  await loadPhrases();
}

async function loadPhrases() {
  const app = $('#app');
  const box = document.createElement('div');
  box.id = 'phrasesBox';
  box.innerHTML = `<h3 class="section-title">Frases motivacionais</h3><div class="card"><p class="muted">Carregando…</p></div>`;
  app.appendChild(box);
  const render = async () => {
    try {
      const { phrases } = await api('/api/phrases');
      $('#phrasesBox').innerHTML = `
        <h3 class="section-title">Frases motivacionais</h3>
        <div class="card">
          <form id="fPhrase" class="row" style="flex-wrap:nowrap">
            <input id="pText" placeholder="Nova frase do dia…" style="flex:1">
            <button class="btn btn-primary" type="submit">Adicionar</button>
          </form>
          <div style="margin-top:10px">${phrases.length ? phrases.map((p) => `
            <div class="row" style="align-items:center;justify-content:space-between;border-top:1px solid var(--line);padding:10px 0">
              <div style="flex:1;font-size:14px;${p.active ? '' : 'opacity:.5;text-decoration:line-through'}">${esc(p.text)}</div>
              <button class="btn" data-ptoggle="${p.id}">${p.active ? 'Pausar' : 'Ativar'}</button>
              <button class="btn btn-ghost" data-pdel="${p.id}">🗑️</button>
            </div>`).join('') : '<div class="empty">Nenhuma frase cadastrada.</div>'}</div>
          <p class="muted" style="font-size:12px">Uma frase ativa é sorteada por dia para as vendedoras.</p>
        </div>`;
      $('#fPhrase').onsubmit = async (e) => {
        e.preventDefault();
        try {
          await api('/api/phrases', { method: 'POST', body: JSON.stringify({ text: $('#pText').value }) });
          toast('Frase adicionada!'); render();
        } catch (err) { toast(err.message, 'err'); }
      };
      $$('#phrasesBox [data-ptoggle]').forEach((b) => (b.onclick = async () => {
        const cur = phrases.find((x) => String(x.id) === String(b.dataset.ptoggle));
        await api(`/api/phrases/${cur.id}`, { method: 'PATCH', body: JSON.stringify({ active: !cur.active }) });
        render();
      }));
      $$('#phrasesBox [data-pdel]').forEach((b) => (b.onclick = async () => {
        if (!confirm('Excluir esta frase?')) return;
        await api(`/api/phrases/${b.dataset.pdel}`, { method: 'DELETE' });
        render();
      }));
    } catch (e) {
      $('#phrasesBox').innerHTML = `<h3 class="section-title">Frases motivacionais</h3><div class="card empty">${esc(e.message)}</div>`;
    }
  };
  render();
}

function modalUser(u, reload) {
  $('#modalRoot').innerHTML = `
  <div class="modal-bg" id="mbg"><div class="modal">
    <h3 style="margin:0">${u ? 'Editar vendedora' : 'Nova vendedora'}</h3>
    <form id="fUser">
      <label>Nome *</label><input id="uName" required value="${esc(u?.name || '')}">
      <label>E-mail *</label><input id="uEmail" type="email" required value="${esc(u?.email || '')}">
      <label>${u ? 'Nova senha (opcional)' : 'Senha *'}</label><input id="uPass" type="password" ${u ? '' : 'required'} placeholder="mín. 4 caracteres">
      <div style="height:12px"></div>
      <button class="btn btn-primary btn-big" type="submit">Salvar</button>
      <button class="btn btn-ghost btn-big" type="button" id="cancel">Cancelar</button>
    </form>
  </div></div>`;
  $('#cancel').onclick = closeModal;
  $('#fUser').onsubmit = async (e) => {
    e.preventDefault();
    try {
      const payload = { name: $('#uName').value.trim(), email: $('#uEmail').value.trim(), role: 'seller', ...( $('#uPass').value ? { password: $('#uPass').value } : {}) };
      if (u) await api(`/api/users/${u.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      else await api('/api/users', { method: 'POST', body: JSON.stringify({ ...payload, password: $('#uPass').value }) });
      closeModal(); toast('Salvo com sucesso!'); reload();
    } catch (err) { toast(err.message, 'err'); }
  };
}

// ---------- SPLASH (só na abertura do app) ----------
(function splash() {
  const el = document.getElementById('splash');
  if (!el) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const exit = () => {
    if (reduce) { el.remove(); return; }
    el.classList.add('leaving');
    setTimeout(() => el.classList.add('expand'), 320);
    setTimeout(() => el.classList.add('done'), 1150);
    setTimeout(() => el.remove(), 1600);
  };
  setTimeout(exit, 3000);
})();

// ---------- PWA ----------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
// ---------- boot ----------
(async function boot() {
  if (store.token) {
    try {
      const { user } = await api('/api/me');
      store.user = user;
    } catch { store.token = null; store.user = null; }
  }
  refreshTheme();
  if (!location.hash) location.hash = store.user ? (store.user.role === 'admin' ? '#/admin' : '#/vendedora') : '#/login';
  route();
})();
