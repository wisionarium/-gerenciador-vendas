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
const fmtBRL = (cents) => ((Number(cents) || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
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

let adminPeriod = { key: 'mes', ...PERIODS.mes() };
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
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11.5 12 4l8 7.5V20a1.5 1.5 0 0 1-1.5 1.5H14v-6h-4v6H5.5A1.5 1.5 0 0 1 4 20z"/></svg>',
  tag: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 2h12v20l-3-2-3 2-3-2-3 2z"/></svg>',
  doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3.5h7l5 5V20.5H7z"/><path d="M14 3.5V9h5"/></svg>',
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
$('#logoutBtn').onclick = () => { store.token = null; store.user = null; go('#/login'); };

// navegação sem empilhar histórico: o gesto de "voltar" do iPhone não tem para onde ir,
// a navbar (e os links internos) é o único jeito de trocar de tela
function go(h) {
  if (location.hash === h) return;
  location.replace(h);
}
document.addEventListener('click', (e) => {
  const a = e.target.closest && e.target.closest('a[href^="#/"]');
  if (!a) return;
  e.preventDefault();
  go(a.getAttribute('href'));
});

// ---------- router ----------
window.addEventListener('hashchange', route);
async function route() {
  setNav();
  const h = location.hash || '#/login';
  document.body.classList.toggle('seller-home', h === '#/vendedora');
  document.body.classList.toggle('history-top', h === '#/vendedora/historico' || h === '#/vendedora/vendas' || h === '#/vendedora/config');
  const app = $('#app');
  const u = store.user;
  if (!u && h !== '#/login') { go('#/login'); return; }
  if (u && h === '#/login') { go(u.role === 'admin' ? '#/admin' : '#/vendedora'); return; }

  try {
    if (h === '#/login' || h === '') return viewLogin(app);
    if (h.startsWith('#/vendedora')) {
      if (u.role !== 'seller' && u.role !== 'admin') throw new Error('Sem permissão.');
      if (h === '#/vendedora/config') {
        if (u.role !== 'seller') { go('#/admin'); return; }
        return viewConfig(app);
      }
      if (h === '#/vendedora/historico' || h === '#/vendedora/vendas') return viewHistory(app);
      return viewSeller(app);
    }
    if (h.startsWith('#/admin')) {
      if (u.role !== 'admin') { go('#/vendedora'); return; }
      if (h === '#/admin/vendas') return viewAllSales(app);
      if (h === '#/admin/ponto') return viewPonto(app);
      if (h === '#/admin/comissoes') return viewComissoes(app);
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
      go(user.role === 'admin' ? '#/admin' : '#/vendedora');
    } catch (err) { toast(err.message, 'err'); }
  };
}

// ---------- shared widgets ----------
function kpiCards(s, prefix = '') {
  return `
  <div class="grid-kpi">
    <div class="card kpi"><div class="label">🛵 Vendas ${prefix}</div><div class="value mono">${fmtV(s.salesCredit)}</div><div class="sub">${fmtInt(s.records)} registro(s)</div></div>
    <div class="card kpi"><div class="label">📞 Chamadas ${prefix}</div><div class="value mono">${fmtInt(s.calls)}</div></div>
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
  const keys = [['mes', 'Mês'], ['semana', 'Semana'], ['ontem', 'Ontem'], ['hoje', 'Hoje'], ['custom', 'Personalizado']];
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

function saleCard(s, delBtn = '') {
  const parts = (s.participants || []).map((p) => `${esc(p.seller_name)} → ${fmtV(p.credit)}`).join(' · ');
  return `
  <div class="sale-card">
    <div class="row" style="justify-content:space-between;align-items:center">
      <b>${esc(s.customer_name)}</b>
      <span class="chip ${s.channel === 'WhatsApp' ? 'wa' : 'crm'}">${esc(s.channel)}</span>
    </div>
    <div class="muted" style="font-size:13px;margin-top:4px">${esc(s.product)} • ${esc(s.color)} • ${fmtDateBR(s.sale_date)}</div>
    <div style="font-size:13px;margin-top:6px">👥 ${parts}</div>
    ${delBtn ? `<div class="sale-foot">${delBtn}</div>` : ''}
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
          <a class="ava" href="#/vendedora/config" title="Configurações">${me.avatar_url ? `<img src="${me.avatar_url}" alt="Foto de perfil">` : esc((me.name || '?')[0].toUpperCase())}</a>
          <button class="ava-cam" id="avaCam" title="Trocar foto"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M19.14 12.94c.04-.3.06-.61.06-.94s-.02-.64-.06-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.2-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94L14.4 2.81c-.03-.44-.4-.81-.85-.81h-3.1c-.45 0-.82.37-.85.81l-.38 2.54c-.59.24-1.13.56-1.62.94l-2.39-.96c-.22-.08-.47.02-.59.22l-1.92 3.32c-.12.2-.06.47.12.61l2.03 1.58c-.04.3-.06.61-.06.94s.02.64.06.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.2.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.38 2.54c.03.44.4.81.85.81h3.1c.45 0 .82-.37.85-.81l.38-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47-.02.59-.22l1.92-3.32c-.12-.2-.06-.47-.12-.61l-2.03-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg></button>
          <input type="file" id="avaInput" accept="image/*" style="display:none">
        </div>
        <div class="seller-hi" style="flex:1">Olá, ${esc(me.name.split(' ')[0])}</div>
        <button class="saldo-top" id="saldoBtn" title="Ocultar/mostrar saldo"><span id="saldoTxt">Saldo: —</span></button>
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
      <div class="ponto-strip" id="pontoStrip"><span>🕒 Carregando ponto…</span></div>
    </div>
    <div class="phrase"><div class="phrase-title">Frase do dia:</div>
      ${phraseRes.author ? `<div class="phrase-text">“${esc(phraseRes.text)}”</div><div class="phrase-author">— ${esc(phraseRes.author)}</div>` : ''}
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
  api('/api/commissions/me').then((r) => { saldoCents = r.pending_cents; renderSaldo(); }).catch(() => {});
  let saldoCents = null;
  let saldoHidden = false;
  try { saldoHidden = localStorage.getItem('ec_saldo_hide_' + me.id) === '1'; } catch {}
  const renderSaldo = () => {
    const txt = $('#saldoTxt');
    if (txt) txt.textContent = saldoCents == null ? 'Saldo: —' : (saldoHidden ? 'Saldo: R$ ••••••' : `Saldo: ${fmtBRL(saldoCents)}`);
  };
  renderSaldo();
  $('#saldoBtn').onclick = () => {
    saldoHidden = !saldoHidden;
    try { localStorage.setItem('ec_saldo_hide_' + me.id, saldoHidden ? '1' : '0'); } catch {}
    renderSaldo();
  };
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
  const renderPonto = (punch) => {
    const el = $('#pontoStrip');
    if (!el) return;
    if (!punch) {
      el.innerHTML = `<span>🕒 Hoje: —</span>`;
    } else if (punch.check_in_at && !punch.check_out_at) {
      el.innerHTML = `<span>🕒 Entrada ${esc(punch.in_hhmm || '')} • Saída —</span>`;
    } else {
      el.innerHTML = `<span>🕒 Entrada ${esc(punch.in_hhmm || '')} • Saída ${esc(punch.out_hhmm || '')}</span>`;
    }
  };
  const loadPonto = async () => {
    try {
      const r = await api('/api/ponto/hoje');
      renderPonto(r.punch);
    } catch { renderPonto(null); }
  };
  loadPonto();
}

// ---------- PONTO da vendedora (QR + GPS, só na batida) ----------
function getGeo() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Este celular não tem GPS.'));
    navigator.geolocation.getCurrentPosition(resolve, (err) => {
      if (err.code === 1) reject(new Error('Localização negada. Ative em Ajustes → Privacidade → Localização e escolha "Ao usar o app".'));
      else if (err.code === 2) reject(new Error('Sem sinal de GPS. Ative a localização e tente perto da entrada.'));
      else if (err.code === 3) reject(new Error('Tempo esgotado no GPS. Tente de novo.'));
      else reject(new Error('Não foi possível obter a localização.'));
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 });
  });
}
function modalPonto(onSaved, autostart) {
  $('#modalRoot').innerHTML = `
  <div class="modal-bg anim-up" id="mbg"><div class="modal">
    <h3 style="margin:0">Bater ponto 🕒</h3>
    <p class="muted" style="font-size:13px">Aponte a câmera para o QR da loja. Vale para entrada e saída — a localização é usada <b>só agora</b>.</p>
    <button class="btn btn-big" id="scanBtn">📷 Escanear QR</button>
    <div style="height:10px"></div>
    <button class="btn btn-big" id="photoBtn">🖼️ Fotografar QR</button>
    <input type="file" id="qrFile" accept="image/*" capture="environment" style="display:none">
    <div id="scanBox" style="display:none;margin-top:10px"><div id="qrReader" style="width:100%"></div><video id="scanVideo" playsinline muted style="width:100%;border-radius:14px;background:#000;display:none"></video>
    <p class="muted" id="scanStatus" style="font-size:12px">Aponte para o QR…</p></div>
    <button class="btn btn-ghost btn-big" type="button" id="cancel" style="margin-top:10px">Cancelar</button>
  </div></div>`;
  $('#cancel').onclick = () => { stopScan(); closeModal(); };
  $('#mbg').onclick = (e) => { if (e.target.id === 'mbg') { stopScan(); closeModal(); } };
  // plano B (iPhones com câmera ao vivo bloqueada): fotografa e decodifica a imagem
  $('#photoBtn').onclick = () => $('#qrFile').click();
  $('#qrFile').onchange = async () => {
    const f = $('#qrFile').files[0];
    if (!f) return;
    const st = $('#scanStatus');
    $('#scanBox').style.display = 'block';
    try {
      stopScan();
      if (st) st.textContent = 'Lendo QR da foto…';
      const tmp = new Html5Qrcode('qrReader');
      const decoded = await tmp.scanFile(f, false);
      try { tmp.clear(); } catch {}
      punch(String(decoded).trim());
    } catch {
      if (st) st.textContent = 'Aponte para o QR…';
      toast('Não identifiquei o QR na foto. Tente de novo com mais luz, de perto.', 'err');
    }
    $('#qrFile').value = '';
  };
  let stream = null;
  let scanning = false;
  let done = false;
  const stopScan = () => { scanning = false; try { window.__qrScanner?.stop().catch(() => {}); } catch {} window.__qrScanner = null; if (stream) { try { stream.getTracks().forEach((t) => t.stop()); } catch {} stream = null; } const v = $('#scanVideo'); if (v) { try { v.srcObject = null; v.innerHTML = ''; } catch {} } };
  const punch = async (code) => {
    if (done) return;
    done = true;
    scanning = false;
    const st = $('#scanStatus');
    try {
      if (st) st.textContent = 'QR lido! Obtendo localização…';
      const pos = await getGeo();
      if (st) st.textContent = 'Registrando…';
      const r = await api('/api/ponto/bater', {
        method: 'POST',
        body: JSON.stringify({
          qr_code: String(code).toUpperCase(),
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        }),
      });
      stopScan(); closeModal();
      toast(r.type === 'in' ? `Entrada registrada: ${r.punch.in_hhmm}` : `Saída registrada: ${r.punch.out_hhmm}`);
      if (onSaved) onSaved();
    } catch (err) { done = false; if (st) st.textContent = 'Aponte para o QR…'; toast(err.message, 'err'); }
  };
  $('#scanBtn').onclick = async () => {
    // na reabertura automática (pós-aviso) pula a checagem e vai direto ao sistema
    if (!autostart) {
      try {
        if (navigator.permissions && navigator.permissions.query) {
          const st = await navigator.permissions.query({ name: 'camera' });
          if (st.state === 'denied') { modalCameraHelp(); return; }
          if (st.state === 'prompt') {
            const go2 = await modalCameraAsk();
            modalPonto(onSaved, go2);
            return;
          }
        }
      } catch {}
    }
    // 1) tenta lib com decoder próprio (funciona no iPhone e Android)
    if (window.Html5Qrcode) {
      $('#scanBox').style.display = 'block';
      $('#scanBtn').disabled = true;
      try {
        const qr = new Html5Qrcode('qrReader');
        window.__qrScanner = qr;
        scanning = true;
        await qr.start(
          { facingMode: 'environment', width: { ideal: 1280 } },
          { fps: 15, qrbox: { width: 250, height: 250 }, aspectRatio: 1.0 },
          (decoded) => { try { qr.stop().catch(() => {}); } catch {} scanning = false; punch(String(decoded).trim()); },
          () => {}
        );
      } catch (err) {
        scanning = false;
        $('#scanBtn').disabled = false;
        if (err && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) { modalCameraHelp(); return; }
        const why = err && (err.name || err.message) ? ` (${err.name || ''} ${err.message || ''})`.trim().slice(0, 80) : '';
        toast(`Câmera ao vivo indisponível${why}. Use "Fotografar QR" abaixo.`, 'err');
      }
      return;
    }
    // 2) fallback: detector nativo (Chrome/Edge em HTTPS)
    if (!('BarcodeDetector' in window)) { toast('Leitura de QR indisponível. Atualize o app e tente de novo.', 'err'); return; }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    } catch { toast('Permita a câmera para escanear.', 'err'); return; }
    $('#scanBox').style.display = 'block';
    $('#scanBtn').disabled = true;
    const video = $('#scanVideo');
    video.style.display = 'block';
    video.srcObject = stream;
    await video.play().catch(() => {});
    const det = new BarcodeDetector({ formats: ['qr_code'] });
    scanning = true;
    const tick = async () => {
      if (!scanning || done) return;
      try {
        const codes = await det.detect(video);
        if (codes?.length && codes[0].rawValue) { punch(codes[0].rawValue.trim()); return; }
      } catch {}
      setTimeout(tick, 400);
    };
    tick();
  };
  if (autostart) $('#scanBtn').click();
}

// explica antes de pedir: marcar "Ao usar o app" evita perguntar toda vez
function modalCameraAsk() {
  return new Promise((resolve) => {
    $('#modalRoot').innerHTML = `
    <div class="modal-bg anim-up" id="mbg"><div class="modal">
      <h3 style="margin:0">📷 Permissão da câmera</h3>
      <p class="muted" style="font-size:14px;line-height:1.5">O celular vai pedir acesso à câmera.<br><br>Toque em <b>Permitir</b> e escolha <b>"Ao usar o app"</b> (não "Só desta vez") — assim ele <b>não pergunta de novo</b>.</p>
      <button class="btn btn-accent btn-big" id="camOk">Entendi, abrir câmera</button>
      <button class="btn btn-ghost btn-big" type="button" id="cancel">Agora não</button>
    </div></div>`;
    $('#cancel').onclick = () => { closeModal(); resolve(false); };
    $('#mbg').onclick = (e) => { if (e.target.id === 'mbg') { closeModal(); resolve(false); } };
    $('#camOk').onclick = () => { closeModal(); resolve(true); };
  });
}

// câmera bloqueada: ensina a liberar (o navegador não pergunta de novo sozinho)
function modalCameraHelp() {
  $('#modalRoot').innerHTML = `
  <div class="modal-bg anim-up" id="mbg"><div class="modal">
    <h3 style="margin:0">📷 Câmera bloqueada</h3>
    <p class="muted" style="font-size:14px;line-height:1.6"><b>iPhone (app instalado):</b> abra <b>Ajustes → role até SellDay → Câmera → Ativar</b>.<br><br><b>iPhone (no Safari):</b> toque no <b>"aA" ao lado do endereço → Ajustes do site → Câmera → Permitir</b>.<br><br><b>Android:</b> <b>Configurações → Apps → SellDay/Chrome → Permissões → Câmera → Permitir</b>.</p>
    <button class="btn btn-accent btn-big" id="camOk">Entendi</button>
  </div></div>`;
  $('#camOk').onclick = closeModal;
  $('#mbg').onclick = (e) => { if (e.target.id === 'mbg') closeModal(); };
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
  r.setProperty('--on-accent', t.onAccent || '#fff');
  r.setProperty('--lime', t.lime || '#cdf14d');
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
    const { theme } = await api('/api/settings/theme');
    if (theme) {
      applyThemeVars(theme);
      localStorage.setItem('ec_theme_' + store.user.id, JSON.stringify(theme));
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
    <h3 class="section-title">Cor principal (fundo escuro)</h3>
    <div class="card">
      <div class="check-list" id="darkGrid"><p class="muted">Carregando…</p></div>
    </div>
    <h3 class="section-title">Cor detalhe (clara)</h3>
    <div class="card">
      <div class="check-list" id="lightGrid"><p class="muted">Carregando…</p></div>
      <p class="muted" style="font-size:12px">Sem branco: o fundo fica sempre branco e os textos se ajustam sozinhos.</p>
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
  $('#cfgLogout').onclick = () => { store.token = null; store.user = null; go('#/login'); };
  try {
    const { darks, lights, dark, light } = await api('/api/settings/theme');
    const paint = (gridId, map, current, colorOf) => {
      $('#' + gridId).innerHTML = Object.entries(map).map(([id, t]) => `
        <div class="check ${id === current ? 'on' : ''}" data-v="${id}">
          <span class="swdot" style="background:${colorOf(t)}"></span>${esc(t.name)}
        </div>`).join('');
    };
    let selDark = dark, selLight = light;
    const save = async () => {
      try {
        const { theme } = await api('/api/settings/theme', { method: 'PUT', body: JSON.stringify({ dark: selDark, light: selLight }) });
        applyThemeVars(theme);
        localStorage.setItem('ec_theme_' + me.id, JSON.stringify(theme));
        toast('Tema aplicado! 💚');
      } catch (err) { toast(err.message, 'err'); }
    };
    paint('darkGrid', darks, selDark, (t) => `linear-gradient(135deg, ${t.brand} 50%, ${t.brand2} 50%)`);
    paint('lightGrid', lights, selLight, (t) => `linear-gradient(135deg, ${t.accent} 50%, ${t.soft} 50%)`);
    const mark = () => {
      $$('#darkGrid .check').forEach((x) => x.classList.toggle('on', x.dataset.v === selDark));
      $$('#lightGrid .check').forEach((x) => x.classList.toggle('on', x.dataset.v === selLight));
    };
    $('#darkGrid').onclick = (e) => {
      const c = e.target.closest('[data-v]'); if (!c) return;
      selDark = c.dataset.v; mark(); save();
    };
    $('#lightGrid').onclick = (e) => {
      const c = e.target.closest('[data-v]'); if (!c) return;
      selLight = c.dataset.v; mark(); save();
    };
  } catch (e) {
    $('#darkGrid').innerHTML = `<div class="empty">${esc(e.message)}</div>`;
  }
}

// ---------- HISTÓRICO da vendedora (ícone papel) ----------
async function viewHistory(app) {
  const me = store.user;
  app.innerHTML = `
    <h2 style="margin:4px 0">Meu histórico</h2>
    <div class="hist-filters">
      <div class="mini-pills" id="hPills">
        <button data-k="mes" class="on">Mês</button>
        <button data-k="semana">Semana</button>
        <button data-k="ontem">Ontem</button>
        <button data-k="hoje">Hoje</button>
      </div>
      <div class="search-row">
        <select id="hChannel"><option value="">Todos os canais</option><option>WhatsApp</option><option>CRM</option></select>
        <input id="hQ" placeholder="Buscar cliente, produto…">
      </div>
    </div>
    <div id="hList"><div class="card empty">Carregando…</div></div>
    <div class="foot">Desenvolvido pela Wisionarium</div>
  `;
  let key = 'mes';
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
    <p class="muted" style="font-size:13px">Individual = 1,0 • Compartilhada (2–3) = 0,5 cada.<br>⚠️ Cadastre <b>1 vez só</b> com todas as participantes — ela já aparece no histórico de cada uma.</p>
    <form id="fSale">
      <label>Cliente *</label><input id="sClient" required placeholder="Nome do cliente">
      <label>Produto *</label><input id="sProduct" required placeholder="Ex: Scooter X">
      <label>Cor *</label><input id="sColor" required placeholder="Ex: Preta">
      <label>Canal *</label>
      <select id="sChannel"><option>WhatsApp</option><option>CRM</option></select>
      <label>Data</label><input type="date" id="sDate" value="${todayISO()}" max="${todayISO()}">
      <label>Participantes (1 a 3) *</label>
      <details class="tray" id="pTray">
        <summary id="pTraySum">Selecionar participantes…</summary>
        <div class="check-list" id="plist">
          ${sellers.filter((s) => s.active !== false).map((s) => `<div class="check ${preselected.includes(s.id) ? 'on' : ''}" data-id="${s.id}" data-name="${esc(s.name)}">${esc(s.name)}</div>`).join('')}
        </div>
      </details>
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
    const sel = $$('#plist .check.on').map((x) => x.dataset.name || x.textContent.trim());
    $('#pTraySum').textContent = sel.length ? sel.join(', ') : 'Selecionar participantes…';
  };
  $('#pTraySum').textContent = $$('#plist .check.on').map((x) => x.dataset.name || x.textContent.trim()).join(', ') || 'Selecionar participantes…';
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

function modalEditSale(sale, sellers, onSaved) {
  const selIds = (sale.participants || []).map((p) => Number(p.seller_id));
  $('#modalRoot').innerHTML = `
  <div class="modal-bg" id="mbg"><div class="modal">
    <h3 style="margin:0">Editar venda #${sale.id}</h3>
    <p class="muted" style="font-size:13px">Individual = 1,0 • Compartilhada (2–3) = 0,5 cada.</p>
    <form id="fEditSale">
      <label>Cliente *</label><input id="eClient" required value="${esc(sale.customer_name)}">
      <label>Produto *</label><input id="eProduct" required value="${esc(sale.product)}">
      <label>Cor *</label><input id="eColor" required value="${esc(sale.color)}">
      <label>Canal *</label>
      <select id="eChannel"><option ${sale.channel === 'WhatsApp' ? 'selected' : ''}>WhatsApp</option><option ${sale.channel === 'CRM' ? 'selected' : ''}>CRM</option></select>
      <label>Data</label><input type="date" id="eDate" value="${esc(sale.sale_date)}" max="${todayISO()}">
      <label>Participantes (1 a 3) *</label>
      <details class="tray" id="eTray">
        <summary id="eTraySum">Selecionar participantes…</summary>
        <div class="check-list" id="eplist">
          ${sellers.filter((s) => s.active !== false || selIds.includes(s.id)).map((s) => `<div class="check ${selIds.includes(s.id) ? 'on' : ''}" data-id="${s.id}" data-name="${esc(s.name)}">${esc(s.name)}</div>`).join('')}
        </div>
      </details>
      <div style="height:12px"></div>
      <button class="btn btn-accent btn-big" type="submit">Salvar alterações</button>
      <button class="btn btn-ghost btn-big" type="button" id="cancel">Cancelar</button>
    </form>
  </div></div>`;
  $('#cancel').onclick = closeModal;
  $('#mbg').onclick = (e) => { if (e.target.id === 'mbg') closeModal(); };
  $('#eplist').onclick = (e) => {
    const c = e.target.closest('.check'); if (!c) return;
    c.classList.toggle('on');
    if ($$('#eplist .check.on').length > 3) { c.classList.remove('on'); toast('Máximo de 3 participantes.', 'err'); }
    const sel = $$('#eplist .check.on').map((x) => x.dataset.name || x.textContent.trim());
    $('#eTraySum').textContent = sel.length ? sel.join(', ') : 'Selecionar participantes…';
  };
  $('#eTraySum').textContent = $$('#eplist .check.on').map((x) => x.dataset.name || x.textContent.trim()).join(', ') || 'Selecionar participantes…';
  $('#fEditSale').onsubmit = async (e) => {
    e.preventDefault();
    const pids = $$('#eplist .check.on').map((c) => Number(c.dataset.id));
    if (!pids.length) return toast('Selecione ao menos 1 participante.', 'err');
    try {
      await api(`/api/sales/${sale.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          customer_name: $('#eClient').value.trim(),
          product: $('#eProduct').value.trim(),
          color: $('#eColor').value.trim(),
          channel: $('#eChannel').value,
          sale_date: $('#eDate').value || sale.sale_date,
          participant_ids: pids,
        }),
      });
      closeModal(); toast('Venda atualizada!'); if (onSaved) onSaved();
    } catch (err) { toast(err.message, 'err'); }
  };
}

// ---------- ADMIN ----------
async function viewAdmin(app) {
  app.innerHTML = `
    <div class="row" style="justify-content:space-between;align-items:center"><h2 style="margin:4px 0">Visão geral</h2><div class="row"><a class="btn" href="#/admin/ponto" style="text-decoration:none">🕒 Ponto</a><a class="btn" href="#/admin/comissoes" style="text-decoration:none">💰 Comissões</a></div></div>
    <div id="kpiWrap"><div class="card"><p class="muted">Carregando…</p></div></div>
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
    <div id="rankWrap"></div>`;
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
    const kpi = $('#kpiWrap');
    const rank = $('#rankWrap');
    const [summary, ranking] = await Promise.all([
      api(`/api/stats/summary?${qs}${adminSeller ? `&seller_id=${adminSeller}` : ''}`),
      api(`/api/stats/ranking?${qs}`),
    ]);
    const filtered = adminSeller ? ranking.ranking.filter((r) => String(r.seller_id) === String(adminSeller)) : ranking.ranking;
    const withChannel = adminChannel
      ? filtered.map((r) => ({ ...r, sales: adminChannel === 'WhatsApp' ? r.whatsapp : r.crm }))
      : filtered;
    kpi.innerHTML = `
      <p class="muted" style="margin:12px 0">${esc(adminPeriod.label || '')} • ${from ? fmtDateBR(from) : '…'} a ${to ? fmtDateBR(to) : '…'}</p>
      ${kpiCards(summary)}
    `;
    rank.innerHTML = `
      <h3 class="section-title">Ranking</h3>
      ${withChannel.length ? `
      <div class="card" style="padding:0;overflow:hidden">
        <table><thead><tr><th>#</th><th>Vendedora</th><th>Chamadas</th><th>Vendas</th><th>Conv.</th></tr></thead>
        <tbody>${withChannel.map((r, i) => `<tr>
          <td>${i + 1}</td>
          <td><a href="#/admin/vendedora/${r.seller_id}" style="text-decoration:none"><span class="row" style="align-items:center;gap:8px;flex-wrap:nowrap"><span class="ava sm">${r.avatar_url ? `<img src="${r.avatar_url}" alt="">` : esc((r.name || '?')[0].toUpperCase())}</span><b>${esc(r.name)}</b></span></a></td>
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
    ${store.user?.role === 'seller' ? `<div style="height:10px"></div><button class="btn btn-big" id="chPonto" style="border-radius:10px;background:#fff">🕒 Bater ponto</button>` : ''}
    <button class="btn btn-ghost btn-big" id="cancel">Cancelar</button>
  </div></div>`;
  $('#cancel').onclick = closeModal;
  $('#mbg').onclick = (e) => { if (e.target.id === 'mbg') closeModal(); };
  const chPonto = $('#chPonto');
  if (chPonto) chPonto.onclick = () => modalPonto(() => route());
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
    <div class="row" style="margin-top:10px;flex-wrap:nowrap;align-items:center">
      <select id="fSellerSales" style="flex:1"><option value="">Todas as vendedoras</option></select>
      <select id="ch" style="flex:0 1 200px"><option value="">Todos os canais</option><option>WhatsApp</option><option>CRM</option></select>
      <button class="btn btn-primary" id="go">Filtrar</button>
    </div></div>
    <div id="list" style="margin-top:12px"><div class="card"><p class="muted">Carregando…</p></div></div>`;
  try {
    const { sellers } = await api('/api/sellers');
    $('#fSellerSales').innerHTML = `<option value="">Todas as vendedoras</option>` + sellers.map((s) => `<option value="${s.id}" ${String(adminSeller) === String(s.id) ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
  } catch {}
  const load = async () => {
    const sid = $('#fSellerSales').value || '';
    const qs = new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}), ...(sid ? { seller_id: sid } : {}), ...($('#ch').value ? { channel: $('#ch').value } : {}), ...($('#q').value ? { q: $('#q').value } : {}) });
    const { sales } = await api(`/api/sales?${qs}`);
    $('#list').innerHTML = sales.length
      ? sales.map((s) => saleCard(s, store.user.role === 'admin' ? `<button class="btn" data-edit="${s.id}">Editar</button> <button class="btn btn-ghost btn-del" data-del="${s.id}">Excluir</button>` : '')).join('')
      : '<div class="card empty">Não há vendas registradas neste período.</div>';
    $$('#list [data-del]').forEach((b) => (b.onclick = async () => {
      if (!confirm('Excluir esta venda?')) return;
      await api(`/api/sales/${b.dataset.del}`, { method: 'DELETE' });
      toast('Venda excluída.'); load();
    }));
    $$('#list [data-edit]').forEach((b) => (b.onclick = async () => {
      const sale = sales.find((x) => String(x.id) === String(b.dataset.edit));
      if (!sale) return;
      try {
        const { sellers } = await api('/api/sellers');
        modalEditSale(sale, sellers, load);
      } catch (e) { toast(e.message, 'err'); }
    }));
  };
  $('#go').onclick = load;
  $('#fSellerSales').onchange = load;
  $('#ch').onchange = load;
  await load();
}

// ---------- PONTO (admin): QR + dia + feriados + extras do mês ----------
async function viewPonto(app) {
  const t = todayISO();
  app.innerHTML = `
    <a href="#/admin" class="muted" style="font-size:13px">← Voltar</a>
    <h2 style="margin:6px 0">Ponto 🕒</h2>
    <div class="card">
      <b>QR da loja</b>
      <p class="muted" style="font-size:13px;margin:4px 0">Imprima e cole na parede. O código manual fica abaixo do QR.</p>
      <div id="qrBox"><p class="muted">Carregando…</p></div>
      <div style="height:8px"></div>
      <button class="btn btn-big" id="printQr">🖨️ Imprimir QR</button>
    </div>
    <h3 class="section-title">Loja e raio</h3>
    <div class="card"><div id="cfgBox"><p class="muted">Carregando…</p></div></div>
    <h3 class="section-title">Ponto do dia</h3>
    <div class="card">
      <label>Data</label><input type="date" id="pDate" value="${t}" max="${t}">
      <div style="height:10px"></div><button class="btn btn-primary" id="pGo">Ver dia</button>
      <div id="pDay" style="margin-top:12px"></div>
    </div>
    <h3 class="section-title">Extras do mês</h3>
    <div class="card">
      <label>Mês</label><input type="month" id="pMonth" value="${t.slice(0, 7)}">
      <div style="height:10px"></div><button class="btn btn-primary" id="pMonthGo">Ver mês</button>
      <div id="pMonthBody" style="margin-top:12px"></div>
    </div>
    <h3 class="section-title">Feriados</h3>
    <div class="card">
      <form id="fHol" class="row" style="flex-wrap:nowrap;align-items:end">
        <div style="flex:1"><label>Data</label><input type="date" id="hDate" required></div>
        <div style="flex:2"><label>Rótulo</label><input id="hLabel" placeholder="Ex: Natal" value="Feriado"></div>
        <button class="btn btn-primary" type="submit">Marcar</button>
      </form>
      <div id="hList" style="margin-top:10px"></div>
    </div>
    <div class="foot">Desenvolvido pela Wisionarium</div>`;
  // QR
  try {
    const { qr_code, qrImage, store_name } = await api('/api/ponto/qr');
    $('#qrBox').innerHTML = `
      <div style="text-align:center">
        <img src="${qrImage}" alt="QR do ponto" style="width:220px;height:220px;max-width:100%">
        <div class="mono" style="font-weight:800;font-size:18px;letter-spacing:.06em">${esc(qr_code)}</div>
        <div class="muted" style="font-size:12px">${esc(store_name)}</div>
      </div>`;
    $('#printQr').onclick = () => {
      const w = window.open('', '_blank');
      w.document.write(`<html><head><title>QR Ponto — ${esc(store_name)}</title></head><body style="text-align:center;font-family:sans-serif;padding:40px"><h1>${esc(store_name)} — Ponto</h1><img src="${qrImage}" style="width:320px;height:320px"><h2 style="letter-spacing:.1em">${esc(qr_code)}</h2><p>Escaneie ao chegar e ao sair. A localização é verificada.</p><script>onload=()=>{print();}<\/script></body></html>`);
      w.document.close();
    };
  } catch (e) { $('#qrBox').innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  // config
  const loadCfg = async () => {
    try {
      const { config } = await api('/api/ponto/config');
      $('#cfgBox').innerHTML = `
        <label>Nome da loja</label><input id="cName" value="${esc(config.store_name || '')}">
        <p class="muted" id="cGeoStatus" style="font-size:13px">${config.lat != null && config.lng != null ? '📍 Localização definida ✓' : '📍 Localização ainda não definida'}</p>
        <button class="btn btn-big" type="button" id="useGeo">📍 Usar minha posição atual</button>
        <div style="height:10px"></div>
        <button class="btn btn-accent btn-big" id="saveCfg">Salvar</button>`;
      let pendingLat = config.lat ?? null;
      let pendingLng = config.lng ?? null;
      $('#useGeo').onclick = async () => {
        const btn = $('#useGeo');
        btn.disabled = true;
        btn.textContent = 'Obtendo localização…';
        try {
          const pos = await getGeo();
          pendingLat = Number(pos.coords.latitude.toFixed(6));
          pendingLng = Number(pos.coords.longitude.toFixed(6));
          $('#cGeoStatus').textContent = '📍 Localização capturada ✓ (salve para confirmar)';
          toast('Posição capturada! Toque em Salvar.');
        } catch (e) { toast(e.message, 'err'); }
        btn.disabled = false;
        btn.textContent = '📍 Usar minha posição atual';
      };
      $('#saveCfg').onclick = async () => {
        try {
          await api('/api/ponto/config', { method: 'PUT', body: JSON.stringify({ store_name: $('#cName').value, lat: pendingLat, lng: pendingLng, radius_m: config.radius_m ?? 150 }) });
          toast('Loja salva!');
        } catch (e) { toast(e.message, 'err'); }
      };
    } catch (e) { $('#cfgBox').innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  };
  await loadCfg();
  // dia
  const loadDay = async () => {
    const date = $('#pDate').value || t;
    const box = $('#pDay');
    box.innerHTML = '<p class="muted">Carregando…</p>';
    try {
      const d = await api(`/api/ponto/dia?date=${date}`);
      box.innerHTML = `
        ${d.is_holiday ? `<p class="muted">🎉 Feriado (${esc(d.holiday.label)}) — padrão 5h 0min</p>` : ''}
        ${d.possible_holiday ? `<div class="card" style="background:#fffbeb;border-color:#fde68a;margin-bottom:10px"><b>⚠️ Possível feriado?</b><br><span class="muted" style="font-size:13px">Várias saídas ~13h. Se foi feriado, confirme:</span><div style="height:8px"></div><button class="btn btn-primary" id="confHol">Confirmar feriado</button></div>` : ''}
        <p class="muted" style="font-size:13px">Presentes: <b>${d.present}</b> • Saídas pendentes: <b>${d.pending}</b></p>
        ${d.rows.map((r) => `
          <div class="sale-card"><div class="row" style="justify-content:space-between;align-items:center">
            <b>${esc(r.name)}</b>
            <span class="muted mono" style="font-size:12px">${r.punch ? `Entrada ${r.punch.in_hhmm || '—'} • Saída ${r.punch.out_hhmm || '—'}` : '—'}</span>
          </div>
          <div class="muted" style="font-size:13px;margin-top:4px">Extra: <b class="mono">${r.punch ? r.punch.extra_label : '0h 0min'}</b>${r.punch?.worked_label ? ` • Trabalhou ${r.punch.worked_label}` : ''}</div>
          ${r.punch ? `<div class="sale-foot"><button class="btn" data-fix="${r.punch.id}">Corrigir</button></div>` : `<div class="sale-foot"><button class="btn" data-lancar="${r.seller_id}">Lançar ponto</button></div>`}
          </div>`).join('') || '<div class="empty">Sem vendedoras ativas.</div>'}`;
      const cf = $('#confHol');
      if (cf) cf.onclick = async () => {
        await api('/api/ponto/feriados', { method: 'POST', body: JSON.stringify({ date, label: 'Feriado' }) });
        toast('Feriado confirmado!'); loadDay(); loadHols();
      };
      $$('#pDay [data-fix]').forEach((b) => (b.onclick = () => {
        const row = d.rows.flatMap((x) => x.punch ? [x.punch] : []).find((p) => String(p.id) === String(b.dataset.fix));
        modalFixPonto(row, loadDay);
      }));
      $$('#pDay [data-lancar]').forEach((b) => (b.onclick = () => {
        const row = d.rows.find((x) => String(x.seller_id) === String(b.dataset.lancar));
        modalManualPonto(row.seller_id, row.name, date, loadDay);
      }));
    } catch (e) { box.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  };
  $('#pGo').onclick = loadDay;
  await loadDay();
  // mês
  const loadMonth = async () => {
    const month = $('#pMonth').value || t.slice(0, 7);
    const box = $('#pMonthBody');
    box.innerHTML = '<p class="muted">Carregando…</p>';
    try {
      const r = await api(`/api/ponto/resumo?month=${month}`);
      box.innerHTML = `
        <p class="muted" style="font-size:13px">Total geral: <b class="mono">${r.total_extra_label}</b></p>
        ${r.rows.map((x, i) => `<div class="bar-row"><span>#${i + 1}</span><div class="bar"><div style="width:${r.total_extra_min ? (x.extra_min / Math.max(1, Math.max(...r.rows.map((y) => y.extra_min)))) * 100 : 0}%"></div></div><b class="mono">${x.extra_label}</b></div><div style="font-size:13px;margin:-2px 0 8px 60px"><b>${esc(x.name)}</b> <span class="muted">• ${x.days} dia(s)</span></div>`).join('')}
        <button class="btn btn-big" id="copyExtra">Copiar resumo</button>`;
      $('#copyExtra').onclick = async () => {
        const msg = `*HORAS EXTRAS — ${month}*\nTotal: ${r.total_extra_label}\n` + r.rows.map((x) => `• ${x.name}: ${x.extra_label} (${x.days} dias)`).join('\n');
        await navigator.clipboard.writeText(msg).catch(() => {});
        toast('Resumo copiado!');
      };
    } catch (e) { box.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  };
  $('#pMonthGo').onclick = loadMonth;
  await loadMonth();
  // feriados
  const loadHols = async () => {
    try {
      const { holidays } = await api('/api/ponto/feriados');
      $('#hList').innerHTML = holidays.length ? holidays.map((h) => `
        <div class="row" style="align-items:center;justify-content:space-between;border-top:1px solid var(--line);padding:8px 0">
          <div><b class="mono">${fmtDateBR(h.date)}</b> <span class="muted" style="font-size:13px">${esc(h.label)}</span></div>
          <button class="btn btn-ghost" data-hdel="${h.date}">🗑️</button>
        </div>`).join('') : '<div class="empty">Nenhum feriado marcado.</div>';
      $$('#hList [data-hdel]').forEach((b) => (b.onclick = async () => {
        if (!confirm('Remover este feriado?')) return;
        await api(`/api/ponto/feriados/${b.dataset.hdel}`, { method: 'DELETE' });
        toast('Feriado removido.'); loadHols(); loadDay();
      }));
    } catch (e) { $('#hList').innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  };
  $('#fHol').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('/api/ponto/feriados', { method: 'POST', body: JSON.stringify({ date: $('#hDate').value, label: $('#hLabel').value || 'Feriado' }) });
      toast('Feriado marcado!'); $('#hDate').value = ''; loadHols(); loadDay();
    } catch (err) { toast(err.message, 'err'); }
  };
  await loadHols();
}

function modalManualPonto(sellerId, sellerName, date, reload) {
  $('#modalRoot').innerHTML = `
  <div class="modal-bg" id="mbg"><div class="modal">
    <h3 style="margin:0">Lançar ponto — ${esc(sellerName)}</h3>
    <p class="muted" style="font-size:13px">${esc(date)} — horário de São Paulo (HH:MM). Use quando o QR falhar.</p>
    <form id="fManual">
      <label>Entrada *</label><input id="mIn" required placeholder="08:00" inputmode="numeric">
      <label>Saída (vazio = só entrada)</label><input id="mOut" placeholder="18:00" inputmode="numeric">
      <div style="height:12px"></div>
      <button class="btn btn-accent btn-big" type="submit">Salvar</button>
      <button class="btn btn-ghost btn-big" type="button" id="cancel">Cancelar</button>
    </form>
  </div></div>`;
  $('#cancel').onclick = closeModal;
  $('#mbg').onclick = (e) => { if (e.target.id === 'mbg') closeModal(); };
  $('#fManual').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('/api/ponto/manual', { method: 'POST', body: JSON.stringify({ seller_id: sellerId, date, check_in_hhmm: $('#mIn').value.trim(), check_out_hhmm: $('#mOut').value.trim() || null }) });
      closeModal(); toast('Ponto lançado!'); if (reload) reload();
    } catch (err) { toast(err.message, 'err'); }
  };
}

function modalFixPonto(p, reload) {
  $('#modalRoot').innerHTML = `
  <div class="modal-bg" id="mbg"><div class="modal">
    <h3 style="margin:0">Corrigir ponto #${p.id}</h3>
    <p class="muted" style="font-size:13px">${esc(p.date)} — horário de São Paulo (HH:MM). Apague a saída para deixar pendente.</p>
    <form id="fFix">
      <label>Entrada *</label><input id="fxIn" required placeholder="08:00" value="${esc(p.in_hhmm || '')}">
      <label>Saída (vazio = pendente)</label><input id="fxOut" placeholder="18:00" value="${esc(p.out_hhmm || '')}">
      <div style="height:12px"></div>
      <button class="btn btn-accent btn-big" type="submit">Salvar</button>
      <button class="btn btn-ghost btn-big" type="button" id="cancel">Cancelar</button>
    </form>
  </div></div>`;
  $('#cancel').onclick = closeModal;
  $('#mbg').onclick = (e) => { if (e.target.id === 'mbg') closeModal(); };
  $('#fFix').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api(`/api/ponto/${p.id}`, { method: 'PUT', body: JSON.stringify({ check_in_hhmm: $('#fxIn').value.trim(), check_out_hhmm: $('#fxOut').value.trim() || null }) });
      closeModal(); toast('Ponto corrigido!'); if (reload) reload();
    } catch (err) { toast(err.message, 'err'); }
  };
}

// ---------- COMISSÕES (admin): conta a pagar + baixas ----------
async function viewComissoes(app) {
  const t = todayISO();
  app.innerHTML = `
    <a href="#/admin" class="muted" style="font-size:13px">← Voltar</a>
    <h2 style="margin:6px 0">Comissões 💰</h2>
    <p class="muted" style="font-size:13px;margin:0 0 10px">R$ 25,00 individual • R$ 12,50 dividida (2–3).</p>
    <div class="card">
      <label>Mês</label><input type="month" id="cMonth" value="${t.slice(0, 7)}">
      <div style="height:10px"></div><button class="btn btn-primary" id="cGo">Ver mês</button>
      <div id="cBody" style="margin-top:12px"></div>
    </div>
    <h3 class="section-title">Pagamentos</h3>
    <div class="card"><div id="payList"><p class="muted">Carregando…</p></div></div>
    <div class="foot">Desenvolvido pela Wisionarium</div>`;
  const load = async () => {
    const month = $('#cMonth').value || t.slice(0, 7);
    const box = $('#cBody');
    box.innerHTML = '<p class="muted">Carregando…</p>';
    try {
      const s = await api(`/api/commissions/summary?month=${month}`);
      box.innerHTML = `
        <p class="muted" style="font-size:13px">Mês: <b class="mono">${fmtBRL(s.total_month_cents)}</b> • Pendente geral: <b class="mono">${fmtBRL(s.total_pending_cents)}</b></p>
        ${s.rows.map((r) => `
          <div class="sale-card"><div class="row" style="justify-content:space-between;align-items:center">
            <b>${esc(r.name)}${r.active ? '' : ' <span class="muted" style="font-size:12px">(inativa)</span>'}</b>
            <span class="mono" style="font-size:13px;font-weight:800">${fmtBRL(r.month_cents)}</span>
          </div>
          <div class="muted" style="font-size:13px;margin-top:4px">Pendente: <b class="mono">${fmtBRL(r.pending_cents)}</b></div>
          ${r.pending_cents > 0 ? `<div class="sale-foot"><button class="btn" data-pay="${r.seller_id}">Marcar como pago</button></div>` : ''}
          </div>`).join('' )}
        <button class="btn btn-big" id="copyComm">Copiar resumo</button>`;
      $('#copyComm').onclick = async () => {
        const msg = `*COMISSÕES — ${month}*\nMês: ${(s.total_month_cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}\nPendente: ${(s.total_pending_cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}\n` +
          s.rows.map((r) => `• ${r.name}: mês ${(r.month_cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} • pendente ${(r.pending_cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`).join('\n');
        await navigator.clipboard.writeText(msg).catch(() => {});
        toast('Resumo copiado!');
      };
      $$('#cBody [data-pay]').forEach((b) => (b.onclick = () => {
        const row = s.rows.find((x) => String(x.seller_id) === String(b.dataset.pay));
        modalPagar(row, month, () => { load(); loadPays(); });
      }));
    } catch (e) { box.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  };
  const loadPays = async () => {
    try {
      const { payouts } = await api('/api/commissions/payouts');
      $('#payList').innerHTML = payouts.length ? payouts.map((p) => `
        <div class="row" style="align-items:center;justify-content:space-between;border-top:1px solid var(--line);padding:8px 0">
          <div><b>${esc(p.seller_name)}</b> <span class="muted" style="font-size:12px">${esc(p.month)}${p.by_name ? ` • por ${esc(p.by_name)}` : ''}</span></div>
          <b class="mono">${fmtBRL(p.amount_cents)}</b>
        </div>`).join('') : '<div class="empty">Nenhum pagamento registrado.</div>';
    } catch (e) { $('#payList').innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  };
  $('#cGo').onclick = load;
  await load();
  await loadPays();
}

function modalPagar(row, month, reload) {
  const maxReais = (row.pending_cents / 100).toFixed(2);
  $('#modalRoot').innerHTML = `
  <div class="modal-bg" id="mbg"><div class="modal">
    <h3 style="margin:0">Pagar — ${esc(row.name)}</h3>
    <p class="muted" style="font-size:13px">Pendente total: <b class="mono">${fmtBRL(row.pending_cents)}</b></p>
    <form id="fPay">
      <label>Valor (R$) *</label><input id="payVal" type="number" min="0.01" step="0.01" max="${maxReais}" value="${maxReais}" required>
      <div style="height:12px"></div>
      <button class="btn btn-accent btn-big" type="submit">Confirmar pagamento</button>
      <button class="btn btn-ghost btn-big" type="button" id="cancel">Cancelar</button>
    </form>
  </div></div>`;
  $('#cancel').onclick = closeModal;
  $('#mbg').onclick = (e) => { if (e.target.id === 'mbg') closeModal(); };
  $('#fPay').onsubmit = async (e) => {
    e.preventDefault();
    const cents = Math.round(Number($('#payVal').value) * 100);
    if (!confirm(`Confirmar pagamento de ${(cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} para ${row.name}?`)) return;
    try {
      await api('/api/commissions/payouts', { method: 'POST', body: JSON.stringify({ seller_id: row.seller_id, amount_cents: cents, month }) });
      closeModal(); toast('Pagamento registrado!'); if (reload) reload();
    } catch (err) { toast(err.message, 'err'); }
  };
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
    const { summary, details } = await api(`/api/report/daily?date=${date}`);
    const saleLine = (s) => `• ${fmtV(s.credit)} ${s.product}${s.partners.length ? ' + ' + s.partners.join(', ') : ''}`;
    const msg =
      `*RELATÓRIO COMERCIAL - ${fmtDateBR(date)}*\n\nChamadas: ${fmtInt(summary.calls)}\nVendas: ${fmtV(summary.salesCredit)}\nWhatsApp: ${fmtV(summary.whatsapp)} | CRM: ${fmtV(summary.crm)}` +
      details.map((d) => `\n\n*${d.name.toUpperCase()}${d.active ? '' : ' (INATIVA)'} - Vendas: ${fmtV(d.credit)} - Chamadas ${fmtInt(d.calls)}*` + (d.sales.length ? `\n${d.sales.map(saleLine).join('\n')}` : '')).join('');
    const waLink = (phone) => `https://wa.me/${phone ? phone.replace(/\D/g, '') : ''}?text=${encodeURIComponent(msg)}`;
    $('#rBody').innerHTML = `
      <div class="card">
        <h3 style="margin:0">Relatório comercial</h3>
        <p class="muted">Data: ${fmtDateBR(date)} • ordem alfabética</p>
        ${kpiCards(summary)}
        ${details.map((d) => `
          <div class="sale-card">
            <div class="row" style="justify-content:space-between;align-items:center">
              <b>${esc(d.name)}${d.active ? '' : ' <span class="muted" style="font-size:12px">(inativa)</span>'}</b>
              <span class="muted" style="font-size:13px">${fmtV(d.credit)} vendas • ${fmtInt(d.calls)} chamadas</span>
            </div>
            ${d.sales.length ? `<div style="margin-top:6px;font-size:13px">${d.sales.map((s) => `<div>• ${fmtV(s.credit)} ${esc(s.product)}${s.partners.length ? ' + ' + esc(s.partners.join(', ')) : ''} <b class="${s.channel === 'WhatsApp' ? 'ch-wa' : 'ch-crm'}">${esc(s.channel)}</b></div>`).join('')}</div>` : '<div class="muted" style="font-size:13px;margin-top:4px">Sem vendas neste dia.</div>'}
          </div>`).join('')}
        <label style="margin-top:14px">Número de destino (opcional, com DDI+DDD)</label>
        <input id="waPhone" inputmode="tel" placeholder="Ex: 5511999999999" value="${esc(localStorage.getItem('ec_wa_phone') || '')}">
        <div style="height:10px"></div>
        <a class="btn btn-green btn-big" id="waBtn" href="${waLink('')}" target="_blank" rel="noopener" style="display:block;text-align:center;text-decoration:none">Enviar relatório no WhatsApp</a>
        <button class="btn btn-big" id="copyBtn" style="margin-top:8px">Copiar mensagem</button>
        <button class="btn btn-ghost btn-big" id="prevBtn" style="margin-top:8px">Ver mensagem antes de enviar</button>
        <pre id="msgPrev" style="display:none;white-space:pre-wrap;font-size:13px;background:#f6f7f9;border:1px solid var(--line);border-radius:12px;padding:12px;margin-top:8px;font-family:inherit"></pre>
      </div>`;
    $('#waPhone').oninput = (e) => { localStorage.setItem('ec_wa_phone', e.target.value); $('#waBtn').href = waLink(e.target.value); };
    $('#copyBtn').onclick = async () => { await navigator.clipboard.writeText(msg).catch(() => {}); toast('Mensagem copiada!'); };
    $('#prevBtn').onclick = () => {
      const p = $('#msgPrev');
      const show = p.style.display === 'none';
      p.style.display = show ? 'block' : 'none';
      if (show) p.textContent = msg;
      $('#prevBtn').textContent = show ? 'Ocultar mensagem' : 'Ver mensagem antes de enviar';
    };
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
  // quebra o logo em letras p/ efeito de queda
  try {
    const logo = document.getElementById('splashLogo');
    let i = 0;
    logo.querySelectorAll('.s-sell, .s-day').forEach((part) => {
      const cls = part.className;
      const frag = document.createDocumentFragment();
      [...part.textContent].forEach((ch) => {
        const s = document.createElement('span');
        s.className = 'lt ' + cls;
        s.style.setProperty('--d', (i++ * 0.06).toFixed(2) + 's');
        s.textContent = ch;
        frag.appendChild(s);
      });
      part.replaceWith(frag);
    });
  } catch { /* mantém logo estático */ }
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const exit = () => {
    if (reduce) { el.remove(); return; }
    el.classList.add('leaving');
    setTimeout(() => el.classList.add('expand'), 280);
    setTimeout(() => el.classList.add('done'), 950);
    setTimeout(() => el.remove(), 1400);
  };
  setTimeout(exit, 3000);
})();

// ---------- PWA: auto-atualiza ao abrir/voltar (iPhone guarda o app suspenso) ----------
let bootVersion = null;
let alreadyReloaded = false;
async function fetchAppVersion() {
  try {
    const r = await fetch('/version.json?ts=' + Date.now(), { cache: 'no-store' });
    const j = await r.json();
    return j.version ?? null;
  } catch { return null; }
}
function maybeReload() {
  if (alreadyReloaded) return;
  alreadyReloaded = true;
  location.reload();
}
async function checkAppUpdate() {
  const v = await fetchAppVersion();
  if (v == null) return;
  if (bootVersion == null) { bootVersion = v; return; }
  if (v !== bootVersion) maybeReload();
}
fetchAppVersion().then((v) => { bootVersion = v; });
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js')
    .then((reg) => {
      reg.update().catch(() => {});
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (nw) nw.addEventListener('statechange', () => {
          if (nw.state === 'activated' && navigator.serviceWorker.controller) maybeReload();
        });
      });
    }).catch(() => {}));
  navigator.serviceWorker.addEventListener('controllerchange', () => maybeReload());
  const refreshSW = () => { try { navigator.serviceWorker.getRegistration().then((r) => r && r.update().catch(() => {})); } catch {} };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { refreshSW(); checkAppUpdate(); } });
  window.addEventListener('pageshow', (e) => { if (e.persisted) checkAppUpdate(); else refreshSW(); });
  window.addEventListener('focus', () => checkAppUpdate());
  setInterval(checkAppUpdate, 15 * 60 * 1000);
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
  if (!location.hash) go(store.user ? (store.user.role === 'admin' ? '#/admin' : '#/vendedora') : '#/login');
  route();
})();
