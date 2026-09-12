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
const sectorLabel = (s) => (s === 'presencial' ? 'Presencial' : 'Online');
const sectorTag = (s) => `<span class="chip ${(s || 'online') === 'presencial' ? 'crm' : 'wa'}" style="font-size:10px;padding:1px 8px">${sectorLabel(s || 'online')}</span>`;
// prévia da comissão (espelha a regra do backend): base por loja+setor ou bônus; metade se dividida
function previewCommission(sellers, pids, bonusCents, storeName) {
  if (!pids.length) return null;
  const sectors = pids.map((id) => {
    const s = (sellers || []).find((x) => Number(x.id) === Number(id));
    return (s && s.sector) || 'online';
  });
  let base;
  if (bonusCents != null) base = bonusCents;
  else if (storeName && storeName !== 'Sede') base = 2500;
  else base = sectors.every((s) => s === 'presencial') ? 3500 : 2500;
  const each = pids.length === 1 ? base : Math.round(base / 2);
  return { base, each, count: pids.length, isBonus: bonusCents != null };
}
const parseBonusReais = (str) => {
  const v = Math.round(Number(String(str ?? '').replace(',', '.')) * 100);
  return Number.isFinite(v) && v > 0 ? v : null;
};

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

let adminSector = '';

let adminStore = '';
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
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
};
function setNav() {
  const u = store.user;
  const nav = $('#bottomNav');
  const badge = $('#userBadge');
  const logout = $('#logoutBtn');
  if (!u) { nav.style.display = 'none'; badge.textContent = ''; logout.style.display = 'none'; return; }
  const roleLabel = u.role === 'admin' ? 'Admin' : u.role === 'manager' ? `Gerente • ${u.store_name || ''}` : u.role === 'staff' ? `Equipe • ${u.store_name || ''}` : 'Vendedora';
  badge.textContent = `${u.name} • ${roleLabel}`;
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
  } else if (u.role === 'manager') {
    nav.innerHTML = `
      <a href="#/admin" title="Início">${ICONS.home}</a>
      <a href="#/admin/vendas" title="Vendas">${ICONS.tag}</a>
      ${fab}
      <a href="#/admin/relatorio" title="Relatório">${ICONS.chart}</a>
      <a href="#/admin/ponto" title="Ponto">${ICONS.clock}</a>`;
  } else if (u.role === 'staff') {
    nav.innerHTML = `
      <a href="#/funcionario" title="Início">${ICONS.home}</a>
      ${fab}
      <a href="#/funcionario/historico" title="Histórico">${ICONS.doc}</a>`;
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
$('#logoutBtn').onclick = () => modalConfirmLogout();

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
  document.body.classList.toggle('seller-home', h === '#/vendedora' || h === '#/funcionario');
  document.body.classList.toggle('history-top', h === '#/vendedora/historico' || h === '#/vendedora/vendas' || h === '#/vendedora/config' || h === '#/funcionario/historico' || h === '#/funcionario/config');
  const app = $('#app');
  const u = store.user;
  if (!u && h !== '#/login') { go('#/login'); return; }
  if (u && h === '#/login') { go(u.role === 'seller' ? '#/vendedora' : u.role === 'staff' ? '#/funcionario' : '#/admin'); return; }

  try {
    if (h === '#/login' || h === '') return viewLogin(app);
    if (h === '#/funcionario') {
      if (u.role !== 'staff' && u.role !== 'admin') { go(u.role === 'seller' ? '#/vendedora' : '#/login'); return; }
      return viewStaff(app);
    }
    if (h === '#/funcionario/config') {
      if (u.role !== 'staff') { go(u.role === 'seller' ? '#/vendedora/config' : '#/login'); return; }
      return viewConfig(app, '#/funcionario');
    }
    if (h === '#/funcionario/historico') {
      if (u.role !== 'staff' && u.role !== 'admin') { go(u.role === 'seller' ? '#/vendedora/historico' : '#/login'); return; }
      return viewStaffHistory(app);
    }
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
      if (u.role !== 'admin' && u.role !== 'manager') { go(u.role === 'staff' ? '#/funcionario' : '#/vendedora'); return; }
      // gerente: tudo da loja, menos Equipe, Comissões e Arquivo
      if (u.role === 'manager' && (h === '#/admin/vendedoras' || h === '#/admin/comissoes' || h === '#/admin/arquivo')) { go('#/admin'); return; }
      if (h === '#/admin/vendas') return viewAllSales(app);
      if (h === '#/admin/arquivo') return viewArchive(app);
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
      // força re-render mesmo se o hash já for o destino (troca de conta na mesma rota)
      const dest = user.role === 'seller' ? '#/vendedora' : user.role === 'staff' ? '#/funcionario' : '#/admin';
      if (location.hash === dest) route();
      else go(dest);
    } catch (err) { toast(err.message, 'err'); }
  };
}

// ---------- shared widgets ----------
// whole=true: visão geral/setor — venda dividida conta como 1 (o 0,5 é só crédito da vendedora).
// whole=false (padrão): visão da vendedora — mantém o crédito fracionado.
function kpiCards(s, prefix = '', whole = false) {
  const conv = whole ? (s.calls > 0 ? (s.records / s.calls) * 100 : null) : s.conversion;
  const vSales = whole ? fmtInt(s.records) : fmtV(s.salesCredit);
  // Online = WhatsApp + CRM (vendas feitas online)
  const vOn = whole ? fmtInt((s.waRecords ?? 0) + (s.crmRecords ?? 0)) : fmtV((s.whatsapp || 0) + (s.crm || 0));
  const vPres = whole ? fmtInt(s.presRecords ?? s.presencial) : fmtV(s.presencial);
  return `
  <div class="grid-kpi">
    <div class="card kpi"><div class="label">🛵 Vendas ${prefix}</div><div class="value mono">${vSales}</div><div class="sub">${fmtInt(s.records)} registro(s)</div></div>
    <div class="card kpi"><div class="label">📞 Chamadas ${prefix}</div><div class="value mono">${fmtInt(s.calls)}</div></div>
    <div class="card kpi"><div class="label">🌐 Online</div><div class="value mono">${vOn}</div><div class="sub">Conversão: ${fmtPct(conv)}</div></div>
    <div class="card kpi"><div class="label">🏬 Presencial</div><div class="value mono">${vPres}</div></div>
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

// detalhe da vendedora (admin): online → Chamadas+Vendas; presencial → só Vendas
function kpiCardsDetail(s, seller) {
  const vCard = `<div class="card kpi"><div class="label">🛵 Vendas • mês</div><div class="value mono">${fmtV(s.salesCredit)}</div><div class="sub">${fmtInt(s.records)} registro(s)</div></div>`;
  if ((seller?.sector || 'online') === 'presencial') return `<div class="grid-kpi two">${vCard}</div>`;
  return `<div class="grid-kpi two">
    <div class="card kpi"><div class="label">📞 Chamadas • mês</div><div class="value mono">${fmtInt(s.calls)}</div></div>
    ${vCard}</div>`;
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

const chanChip = (ch) => ch === 'WhatsApp' ? 'wa' : ch === 'Presencial' ? 'lime' : 'crm';
function saleCard(s, delBtn = '') {
  const parts = (s.participants || []).map((p) => `${esc(p.seller_name)} → ${fmtV(p.credit)}`).join(' · ');
  return `
  <div class="sale-card" style="padding:10px 12px">
    <div class="row" style="justify-content:space-between;align-items:center;flex-wrap:nowrap">
      <b>${esc(s.customer_name)}${s.is_bonus ? ' ⭐' : ''}</b>
      <span style="white-space:nowrap">${s.store_name && s.store_name !== 'Sede' ? `${storeTag(s.store_name)} ` : ''}<span class="chip ${chanChip(s.channel)}">${esc(s.channel)}</span>${s.is_bonus && s.bonus_cents != null ? ` <span class="chip" title="Bônus exclusivo">🎁 ${fmtBRL(s.bonus_cents)}</span>` : ''}</span>
    </div>
    <div class="muted" style="font-size:12.5px;margin-top:2px">${esc(s.product)} • ${esc(s.color)} • ${fmtDateBR(s.sale_date)} • 👥 ${parts}</div>
    ${delBtn ? `<div class="sale-foot" style="margin-top:4px">${delBtn}</div>` : ''}
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
          <span class="ava-cam" aria-hidden="true"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M19.14 12.94c.04-.3.06-.61.06-.94s-.02-.64-.06-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.2-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94L14.4 2.81c-.03-.44-.4-.81-.85-.81h-3.1c-.45 0-.82.37-.85.81l-.38 2.54c-.59.24-1.13.56-1.62.94l-2.39-.96c-.22-.08-.47.02-.59.22l-1.92 3.32c-.12.2-.06.47.12.61l2.03 1.58c-.04.3-.06.61-.06.94s.02.64.06.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.2.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.38 2.54c.03.44.4.81.85.81h3.1c.45 0 .82-.37.85-.81l.38-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47-.02.59-.22l1.92-3.32c-.12-.2-.06-.47-.12-.61l-2.03-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg></span>
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
      ${phraseRes.author ? `<div class="phrase-text">“${esc(phraseRes.text)}”</div><div class="phrase-author">— ${esc(phraseRes.author)} <button class="share-btn" id="sharePhrase" title="Compartilhar frase"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.6" y1="10.7" x2="15.4" y2="6.3"/><line x1="8.6" y1="13.3" x2="15.4" y2="17.7"/></svg></button></div>` : ''}
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
  const wp = $('#writePhrase');
  if (wp) wp.onclick = () => modalPhrase();
  const sp = $('#sharePhrase');
  if (sp) sp.onclick = () => modalSharePhrase(phraseRes.text, phraseRes.author);
  const loadList = async (k) => {
    const r = rangeFor(k);
    try {
      const { sales } = await api(`/api/sales?from=${r.from}&to=${r.to}`);
      $('#homeList').innerHTML = sales.length
        ? compactListHTML(sales, (s, idx) => sliRow(s, me.id, idx), 8)
        : '<div class="card empty">Nenhuma venda neste período.</div>';
      bindCompactList($('#homeList'));
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
function modalPonto(onSaved) {
  $('#modalRoot').innerHTML = `
  <div class="modal-bg anim-up" id="mbg"><div class="modal">
    <h3 style="margin:0">Bater ponto 🕒</h3>
    <p class="muted" style="font-size:13px">Toque em Escanear e <b>permita a câmera</b> (marque "Ao usar o app"). Vale para entrada e saída — a localização é usada <b>só agora</b>.</p>
    <button class="btn btn-big" id="scanBtn">📷 Escanear QR</button>
    <div id="scanBox" style="display:none;margin-top:10px"><div id="qrReader" style="width:100%"></div><video id="scanVideo" playsinline muted style="width:100%;border-radius:14px;background:#000;display:none"></video>
    <p class="muted" id="scanStatus" style="font-size:12px">Aponte para o QR…</p></div>
    <button class="btn btn-ghost btn-big" type="button" id="cancel" style="margin-top:10px">Cancelar</button>
  </div></div>`;
  $('#cancel').onclick = () => { stopScan(); closeModal(); };
  $('#mbg').onclick = (e) => { if (e.target.id === 'mbg') { stopScan(); closeModal(); } };
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
  // abre DIRETO no toque (sem telas no meio): o iOS só libera a câmera dentro do gesto
  $('#scanBtn').onclick = async () => {
    if (window.Html5Qrcode) {
      $('#scanBox').style.display = 'block';
      $('#scanBtn').disabled = true;
      try {
        const qr = new Html5Qrcode('qrReader');
        window.__qrScanner = qr;
        scanning = true;
        await qr.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: 250 },
          (decoded) => { try { qr.stop().catch(() => {}); } catch {} scanning = false; punch(String(decoded).trim()); },
          () => {}
        );
      } catch (err) {
        scanning = false;
        $('#scanBtn').disabled = false;
        if (err && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) { modalCameraHelp(); return; }
        toast(`Não abriu a câmera (${(err && (err.name || err.message)) || 'erro'}). Tente de novo.`, 'err');
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
  if (su && (su.role === 'seller' || su.role === 'staff')) {
    const cached = JSON.parse(localStorage.getItem('ec_theme_' + su.id) || 'null');
    if (cached) applyThemeVars(cached);
  }
} catch { /* sem tema em cache */ }
async function refreshTheme() {
  try {
    if (store.user?.role !== 'seller' && store.user?.role !== 'staff') return;
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

// ---------- COMPARTILHAR frase do dia (arte para baixar) ----------
const SHARE_THEMES = [
  { name: 'Clássico', bg: '#f4efe6', rect: '#3d8b66', brand: '#0e3b2e' },
  { name: 'Escuro', bg: '#0e3b2e', rect: '#cdf14d', brand: '#cdf14d' },
  { name: 'Rosa', bg: '#fdeef4', rect: '#a11c50', brand: '#7c1039' },
  { name: 'Areia', bg: '#faf5e9', rect: '#8a5f28', brand: '#5c3d17' },
];

function wrapText(ctx, text, maxW) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; }
    else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}

// cor de texto legível sobre um fundo (branco ou escuro)
function contrastOn(hex) {
  const h = String(hex).replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.5 ? '#1f2937' : '#ffffff';
}

function drawPhraseArt(canvas, text, author, c) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.shadowColor = 'rgba(0,0,0,0)';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  ctx.fillStyle = c.bg;
  ctx.fillRect(0, 0, W, H);
  const phraseColor = contrastOn(c.rect);
  const subColor = contrastOn(c.bg);
  // @wisionarium topo direito com transparência
  ctx.save();
  ctx.globalAlpha = 0.45;
  ctx.fillStyle = subColor;
  ctx.font = '600 30px "Open Sans", sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('@WISIONARIUM', W - 60, 85);
  ctx.restore();
  // Sell Day à esquerda (retângulo passa por cima, como na referência)
  ctx.fillStyle = c.brand;
  ctx.textAlign = 'left';
  ctx.font = '400 300px Allura, cursive';
  ctx.fillText('Sell', 60, 520);
  ctx.font = '400 340px "Yeseva One", serif';
  ctx.fillText('DAY', 60, 800);
  // frase dentro do retângulo (altura conforme o texto)
  ctx.font = '700 46px "Open Sans", sans-serif';
  const maxW = 460;
  const lines = wrapText(ctx, text, maxW);
  const lh = 64;
  const padV = 55, padH = 45;
  const rw = maxW + padH * 2;
  const rh = lines.length * lh + padV * 2 - 14;
  const rx = W - rw - 60;
  const ry = Math.round((H - (rh + 70)) / 2);
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.28)';
  ctx.shadowBlur = 45;
  ctx.shadowOffsetY = 14;
  ctx.fillStyle = c.rect;
  if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(rx, ry, rw, rh, 36); ctx.fill(); }
  else ctx.fillRect(rx, ry, rw, rh);
  ctx.restore();
  ctx.fillStyle = phraseColor;
  ctx.textAlign = 'center';
  lines.forEach((ln, i) => ctx.fillText(ln, rx + rw / 2, ry + padV + 34 + i * lh));
  // nome da vendedora abaixo do retângulo
  ctx.fillStyle = subColor;
  ctx.font = '400 36px "Open Sans", sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('– ' + author, rx + rw, ry + rh + 62);
}

function modalSharePhrase(text, author) {
  let custom = { ...SHARE_THEMES[0] };
  $('#modalRoot').innerHTML = `
  <div class="modal-bg anim-up" id="mbg"><div class="modal">
    <h3 style="margin:0">Compartilhar frase 📤</h3>
    <p class="muted" style="font-size:13px">Escolha um modelo pronto ou ajuste cada cor.</p>
    <canvas id="shareCanvas" width="1080" height="1080" style="width:100%;border-radius:16px;border:1px solid var(--line)"></canvas>
    <label>Modelos prontos</label>
    <div class="check-list" id="themeList">
      ${SHARE_THEMES.map((t, i) => `<div class="check ${i === 0 ? 'on' : ''}" data-i="${i}"><span class="swdot" style="background:linear-gradient(135deg, ${t.bg} 50%, ${t.rect} 50%)"></span>${esc(t.name)}</div>`).join('')}
    </div>
    <div class="row" style="margin-top:4px">
      <div style="flex:1"><label>Fundo</label><input type="color" id="cBg" value="${custom.bg}" style="height:48px;padding:6px"></div>
      <div style="flex:1"><label>Retângulo</label><input type="color" id="cRect" value="${custom.rect}" style="height:48px;padding:6px"></div>
      <div style="flex:1"><label>Sell Day</label><input type="color" id="cBrand" value="${custom.brand}" style="height:48px;padding:6px"></div>
    </div>
    <p class="muted" style="font-size:12px">O texto da frase se ajusta sozinho (branco ou escuro) pra sempre contrastar.</p>
    <div style="height:12px"></div>
    <button class="btn btn-accent btn-big" id="dlArt">⬇️ Baixar imagem</button>
    <button class="btn btn-ghost btn-big" type="button" id="cancel">Fechar</button>
  </div></div>`;
  $('#cancel').onclick = closeModal;
  $('#mbg').onclick = (e) => { if (e.target.id === 'mbg') closeModal(); };
  const redraw = async () => {
    try { await document.fonts.ready; } catch {}
    drawPhraseArt($('#shareCanvas'), text, author, custom);
  };
  const syncInputs = () => { $('#cBg').value = custom.bg; $('#cRect').value = custom.rect; $('#cBrand').value = custom.brand; };
  $('#themeList').onclick = (e) => {
    const c = e.target.closest('.check'); if (!c) return;
    custom = { ...SHARE_THEMES[Number(c.dataset.i)] };
    $$('#themeList .check').forEach((x) => x.classList.toggle('on', x === c));
    syncInputs();
    redraw();
  };
  $('#cBg').oninput = (e) => { custom.bg = e.target.value; redraw(); };
  $('#cRect').oninput = (e) => { custom.rect = e.target.value; redraw(); };
  $('#cBrand').oninput = (e) => { custom.brand = e.target.value; redraw(); };
  $('#dlArt').onclick = () => {
    const a = document.createElement('a');
    a.download = 'frase-do-dia.png';
    a.href = $('#shareCanvas').toDataURL('image/png');
    a.click();
    toast('Imagem baixada!');
  };
  redraw();
}

// ---------- CONFIGURAÇÕES da vendedora ----------
async function viewConfig(app, back = '#/vendedora') {
  const me = store.user;
  app.innerHTML = `
    <a href="${back}" class="muted" style="font-size:13px">← Voltar</a>
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
  $('#cfgLogout').onclick = () => modalConfirmLogout();
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

// ---------- HOME do funcionário (só ponto, padrão vendedora) ----------
function staffPunchRow(x, showDate = true) {
  return `
  <div class="sale-card" style="padding:10px 12px"><div class="row" style="justify-content:space-between;align-items:center;flex-wrap:nowrap">
    <span><span class="muted" style="font-size:12px">${showDate ? `Dia: ${fmtDateBR(x.date)}` : fmtDateBR(x.date)}</span><br>
    <span style="font-size:13px">Entrada: ${x.in_hhmm || '—'} • Saída: ${x.out_hhmm || '—'}</span></span>
    <span class="mono" style="font-size:13px;font-weight:800">${x.extra_min > 0 ? `+${esc(x.extra_label)}` : '—'}</span>
  </div></div>`;
}
async function viewStaff(app) {
  const me = store.user;
  const t = todayISO();
  const mk = t.slice(0, 7);
  app.innerHTML = `<div class="card"><p class="muted">Carregando…</p></div>`;
  const [hoje, mes, phraseRes] = await Promise.all([
    api('/api/ponto/hoje').catch(() => ({ punch: null })),
    api(`/api/ponto/eu?month=${mk}`).catch(() => ({ punches: [] })),
    api('/api/phrases/today').catch(() => ({ text: '' })),
  ]);
  const totalExtra = (mes.punches || []).reduce((a, p) => a + (Number(p.extra_min) || 0), 0);
  const fmtDurLocal = (min) => `${Math.floor(min / 60)}h ${min % 60}min`;
  const p = hoje.punch;
  const recent = (mes.punches || []).slice(0, 5);
  app.innerHTML = `
    <div class="seller-head">
      <div class="seller-top">
        <div class="ava-wrap">
          <a class="ava" href="#/funcionario/config" title="Configurações">${me.avatar_url ? `<img src="${me.avatar_url}" alt="Foto de perfil">` : esc((me.name || '?')[0].toUpperCase())}</a>
          <span class="ava-cam" aria-hidden="true"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M19.14 12.94c.04-.3.06-.61.06-.94s-.02-.64-.06-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.2-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94L14.4 2.81c-.03-.44-.4-.81-.85-.81h-3.1c-.45 0-.82.37-.85.81l-.38 2.54c-.59.24-1.13.56-1.62.94l-2.39-.96c-.22-.08-.47.02-.59.22l-1.92 3.32c-.12.2-.06.47.12.61l2.03 1.58c-.04.3-.06.61-.06.94s.02.64.06.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.2.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.38 2.54c.03.44.4.81.85.81h3.1c.45 0 .82-.37.85-.81l.38-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47-.02.59-.22l1.92-3.32c-.12-.2-.06-.47-.12-.61l-2.03-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg></span>
        </div>
        <div class="seller-hi" style="flex:1">Olá, ${esc(me.name.split(' ')[0])}</div>
      </div>
      <div style="text-align:center;color:#fff;font-size:17px;font-weight:700;margin-top:10px">${p ? `Hoje: ${p.in_hhmm || '--:--'} - Saída: ${p.out_hhmm || '--:--'}` : 'Hoje: sem registro ainda'}</div>
      <div class="card" style="background:#fff;text-align:center;margin:12px 4px 0;border:none">
        <div class="muted" style="font-size:12px">Hora extra total:</div>
        <div class="mono" style="font-size:26px;font-weight:800">${fmtDurLocal(totalExtra)}</div>
      </div>
    </div>
    <div class="phrase"><div class="phrase-title">Frase do dia:</div>
      ${phraseRes.author ? `<div class="phrase-text">“${esc(phraseRes.text)}”</div><div class="phrase-author">— ${esc(phraseRes.author)}</div>` : `<div class="muted" style="font-size:12px">Ainda não publicada hoje.</div>`}
    </div>
    <div class="mini-pills"><button class="on" style="pointer-events:none">Recente</button></div>
    <div id="staffRecent">${recent.length ? recent.map((x) => staffPunchRow(x, false)).join('') : '<div class="card empty">Nenhum ponto recente.</div>'}</div>
    <div class="foot">Desenvolvido pela Wisionarium</div>
  `;
}

// ---------- HISTÓRICO do funcionário (só seletor de mês) ----------
async function viewStaffHistory(app) {
  const t = todayISO();
  app.innerHTML = `
    <h2 style="margin:4px 0">Meu histórico</h2>
    <div class="card">
      <div class="row" style="flex-wrap:nowrap;align-items:end">
        <div style="flex:1"><label>Mês</label><input type="month" id="shMonth" value="${t.slice(0, 7)}" max="${t.slice(0, 7)}"></div>
        <button class="btn btn-primary" id="shGo">Ver mês</button>
      </div>
      <div id="shTotal" style="margin-top:12px"></div>
      <div id="shList" style="margin-top:8px"><p class="muted">Carregando…</p></div>
    </div>
    <div class="foot">Desenvolvido pela Wisionarium</div>`;
  const load = async () => {
    const month = $('#shMonth').value || t.slice(0, 7);
    const box = $('#shList');
    box.innerHTML = '<p class="muted">Carregando…</p>';
    try {
      const { punches } = await api(`/api/ponto/eu?month=${month}`);
      const total = (punches || []).reduce((a, p) => a + (Number(p.extra_min) || 0), 0);
      $('#shTotal').innerHTML = `<p class="muted" style="font-size:13px;margin:0">Extra no mês: <b class="mono">${Math.floor(total / 60)}h ${total % 60}min</b> • ${punches.length} dia(s)</p>`;
      box.innerHTML = punches.length
        ? compactListHTML(punches, (x) => staffPunchRow(x), 10)
        : '<div class="card empty">Nenhum ponto neste mês.</div>';
      bindCompactList(box);
    } catch (e) { box.innerHTML = `<div class="card empty">${esc(e.message)}</div>`; }
  };
  $('#shGo').onclick = load;
  $('#shMonth').onchange = load;
  await load();
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
    if ($('#hQ').value.trim()) qs.set('q', $('#hQ').value.trim());
    try {
      const { sales } = await api(`/api/sales?${qs}`);
      const mine = sales.reduce((a, s) => a + s.participants.filter((p) => p.seller_id === me.id).reduce((x, p) => x + Number(p.credit), 0), 0);
      $('#hList').innerHTML = `
        <p class="muted" style="margin:4px 0 10px">${r.label} • ${sales.length} registro(s) • <b class="mono">${fmtV(mine)} vendas</b></p>
        ${sales.length ? compactListHTML(sales, (s) => sliRow(s, me.id), 10) : '<div class="card empty">Nenhuma venda neste período.</div>'}`;
      bindCompactList($('#hList'));
    } catch (e) {
      $('#hList').innerHTML = `<div class="card empty">${esc(e.message)}</div>`;
    }
  };
  $('#hPills').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    $$('#hPills button').forEach((x) => x.classList.toggle('on', x === b));
    key = b.dataset.k; load();
  };
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
    ${sales.length ? sales.map(saleCard).join('') : '<div class="card empty">Não há vendas registradas neste período.</div>'}`;
}

// ---------- modals ----------
function closeModal() { $('#modalRoot').innerHTML = ''; }

// confirmação de saída (evita toque acidental ao rolar a tela)
function modalConfirmLogout() {
  $('#modalRoot').innerHTML = `
  <div class="modal-bg anim-up" id="mbg"><div class="modal">
    <h3 style="margin:0">Sair da conta?</h3>
    <p class="muted" style="font-size:14px">Você precisará fazer login de novo para entrar.</p>
    <button class="btn btn-big" id="logoutYes" style="border-radius:10px;background:#fff">Sair</button>
    <div style="height:10px"></div>
    <button class="btn btn-ghost btn-big" id="cancel">Cancelar</button>
  </div></div>`;
  $('#cancel').onclick = closeModal;
  $('#mbg').onclick = (e) => { if (e.target.id === 'mbg') closeModal(); };
  $('#logoutYes').onclick = () => { store.token = null; store.user = null; closeModal(); if (location.hash === '#/login') route(); else go('#/login'); };
}

function modalCalls() {
  if (store.user?.role !== 'admin') { toast('Apenas o administrador pode registrar chamadas.', 'err'); return; }
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

function modalSale(sellers, stores) {
  if (store.user?.role !== 'admin' && store.user?.role !== 'manager') { toast('Apenas o administrador pode registrar vendas.', 'err'); return; }
  const me = store.user;
  const lockedStore = me.role === 'manager' ? (stores || []).find((s) => Number(s.id) === Number(me.store_id)) : null;
  const saleStores = lockedStore ? [lockedStore] : (stores || []);
  const preselected = [];
  $('#modalRoot').innerHTML = `
  <div class="modal-bg" id="mbg"><div class="modal">
    <h3 style="margin:0">Nova venda</h3>
    <p class="muted" style="font-size:13px">Individual = 1,0 • Compartilhada (2–3) = 0,5 cada.<br>⚠️ Cadastre <b>1 vez só</b> com todas as participantes — ela já aparece no histórico de cada uma.</p>
    <form id="fSale">
      <label>Cliente *</label><input id="sClient" required placeholder="Nome do cliente">
      <label>Produto *</label><input id="sProduct" required placeholder="Ex: Scooter X">
      <label>Cor *</label><input id="sColor" required placeholder="Ex: Preta">
      <label>Loja *</label>
      <select id="sStore">${saleStores.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select>
      <label>Canal *</label>
      <select id="sChannel"><option>WhatsApp</option><option>CRM</option><option>Presencial</option></select>
      <label>Data</label><input type="date" id="sDate" value="${todayISO()}" max="${todayISO()}">
      <label>Participantes (1 a 3) *</label>
      <details class="tray" id="pTray">
        <summary id="pTraySum">Selecionar participantes…</summary>
        <div class="check-list" id="plist">
          ${sellers.filter((s) => s.active !== false).map((s) => `<div class="check ${preselected.includes(s.id) ? 'on' : ''}" data-id="${s.id}" data-name="${esc(s.name)}" data-sector="${esc(s.sector || 'online')}">${esc(s.name)} ${sectorTag(s.sector)} ${s.store_name && s.store_name !== 'Sede' ? storeTag(s.store_name) : ''}</div>`).join('')}
        </div>
      </details>
      <label style="display:flex;gap:8px;align-items:center;font-weight:normal;margin-top:10px"><input type="checkbox" id="sBonus" style="width:auto"> ⭐ Valor exclusivo (bônus de modelo especial)</label>
      <div id="sBonusBox" style="display:none">
        <label>Comissão exclusiva por vendedora (R$) *</label>
        <input id="sBonusVal" type="number" min="0.01" max="1000" step="0.01" placeholder="Ex: 50,00">
      </div>
      <div class="card" id="sPreview" style="margin-top:10px;background:var(--brand-soft)"><p class="muted" style="margin:0;font-size:13px">Selecione as participantes para ver a comissão.</p></div>
      <div style="height:12px"></div>
      <button class="btn btn-accent btn-big" type="submit">Registrar venda</button>
      <button class="btn btn-ghost btn-big" type="button" id="cancel">Cancelar</button>
    </form>
  </div></div>`;
  $('#cancel').onclick = closeModal;
  $('#mbg').onclick = (e) => { if (e.target.id === 'mbg') closeModal(); };
  const sBonusCents = () => ($('#sBonus').checked ? parseBonusReais($('#sBonusVal').value) : null);
  const sStoreName = () => {
    const opt = $('#sStore').selectedOptions?.[0];
    return opt ? opt.textContent.trim() : 'Sede';
  };
  const refreshSalePreview = () => {
    const pids = $$('#plist .check.on').map((c) => Number(c.dataset.id));
    const pv = previewCommission(sellers, pids, sBonusCents(), sStoreName());
    $('#sPreview').innerHTML = !pv
      ? '<p class="muted" style="margin:0;font-size:13px">Selecione as participantes para ver a comissão.</p>'
      : `<p style="margin:0;font-size:13px">💰 Comissão: <b>${fmtBRL(pv.each)} cada</b> <span class="muted">(${pv.isBonus ? 'bônus exclusivo' : 'base ' + fmtBRL(pv.base) + ' • ' + esc(sStoreName())} • ${pv.count} participante${pv.count > 1 ? 's' : ''})</span></p>`;
  };
  $('#sStore').onchange = refreshSalePreview;
  $('#sBonus').onchange = () => { $('#sBonusBox').style.display = $('#sBonus').checked ? 'block' : 'none'; refreshSalePreview(); };
  $('#sBonusVal').oninput = refreshSalePreview;
  $('#plist').onclick = (e) => {
    const c = e.target.closest('.check'); if (!c) return;
    c.classList.toggle('on');
    if ($$('#plist .check.on').length > 3) { c.classList.remove('on'); toast('Máximo de 3 participantes.', 'err'); }
    const sel = $$('#plist .check.on').map((x) => x.dataset.name || x.textContent.trim());
    $('#pTraySum').textContent = sel.length ? sel.join(', ') : 'Selecionar participantes…';
    refreshSalePreview();
  };
  $('#pTraySum').textContent = $$('#plist .check.on').map((x) => x.dataset.name || x.textContent.trim()).join(', ') || 'Selecionar participantes…';
  refreshSalePreview();
  $('#fSale').onsubmit = async (e) => {
    e.preventDefault();
    const pids = $$('#plist .check.on').map((c) => Number(c.dataset.id));
    if (!pids.length) return toast('Selecione ao menos 1 participante.', 'err');
    const isBonus = $('#sBonus').checked;
    if (isBonus && sBonusCents() == null) return toast('Informe o valor do bônus.', 'err');
    try {
      await api('/api/sales', {
        method: 'POST',
        body: JSON.stringify({
          customer_name: $('#sClient').value.trim(),
          product: $('#sProduct').value.trim(),
          color: $('#sColor').value.trim(),
          channel: $('#sChannel').value,
          sale_date: $('#sDate').value || todayISO(),
          store_id: Number($('#sStore').value),
          participant_ids: pids,
          is_bonus: isBonus,
          bonus_value: isBonus ? Number(String($('#sBonusVal').value).replace(',', '.')) : undefined,
        }),
      });
      closeModal(); toast('Venda registrada!'); route();
    } catch (err) { toast(err.message, 'err'); }
  };
}

function modalCancelSale(sale, onSaved) {
  if (store.user?.role !== 'admin' && store.user?.role !== 'manager') { toast('Apenas o administrador pode cancelar vendas.', 'err'); return; }
  const parts = (sale.participants || []).map((p) => esc(p.seller_name)).join(', ');
  $('#modalRoot').innerHTML = `
  <div class="modal-bg anim-up" id="mbg"><div class="modal">
    <h3 style="margin:0">Cancelar venda #${sale.id}?</h3>
    <p class="muted" style="font-size:13px"><b>${esc(sale.customer_name)}</b> • ${esc(sale.product)} • ${esc(sale.color)} • ${fmtDateBR(sale.sale_date)}${parts ? `<br>👥 ${parts}` : ''}</p>
    <p class="muted" style="font-size:13px">A venda sai das listas, do ranking e das comissões. Essa ação não pode ser desfeita.</p>
    <form id="fCancelSale">
      <label>Motivo do cancelamento *</label>
      <label style="display:flex;gap:8px;align-items:center;font-weight:normal"><input type="radio" name="reason" value="desistencia" checked style="width:auto"> Desistência do cliente</label>
      <label style="display:flex;gap:8px;align-items:center;font-weight:normal"><input type="radio" name="reason" value="outros" style="width:auto"> Outros</label>
      <label style="margin-top:8px">Observação (opcional)</label>
      <input id="cNote" maxlength="140" placeholder="Ex: cliente pediu para aguardar">
      <div style="height:12px"></div>
      <button class="btn btn-primary btn-big" type="submit">Confirmar cancelamento</button>
      <button class="btn btn-ghost btn-big" type="button" id="cancel">Voltar</button>
    </form>
  </div></div>`;
  $('#cancel').onclick = closeModal;
  $('#mbg').onclick = (e) => { if (e.target.id === 'mbg') closeModal(); };
  $('#fCancelSale').onsubmit = async (e) => {
    e.preventDefault();
    const reason = ($('input[name="reason"]:checked') || {}).value;
    if (!['desistencia', 'outros'].includes(reason)) return toast('Escolha o motivo do cancelamento.', 'err');
    try {
      await api(`/api/sales/${sale.id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ reason, note: $('#cNote').value.trim() }),
      });
      closeModal(); toast('Venda cancelada.'); if (onSaved) onSaved();
    } catch (err) { toast(err.message, 'err'); }
  };
}

function modalEditSale(sale, sellers, stores, onSaved) {
  if (store.user?.role !== 'admin' && store.user?.role !== 'manager') { toast('Apenas o administrador pode editar vendas.', 'err'); return; }
  const selIds = (sale.participants || []).map((p) => Number(p.seller_id));
  const wasBonus = !!sale.is_bonus;
  const wasBonusReais = sale.bonus_cents != null ? (Number(sale.bonus_cents) / 100).toFixed(2) : '';
  const me = store.user;
  const lockedStore = me.role === 'manager' ? (stores || []).find((s) => Number(s.id) === Number(me.store_id)) : null;
  const editStores = lockedStore ? [lockedStore] : (stores || []);
  $('#modalRoot').innerHTML = `
  <div class="modal-bg" id="mbg"><div class="modal">
    <h3 style="margin:0">Editar venda #${sale.id}</h3>
    <p class="muted" style="font-size:13px">Individual = 1,0 • Compartilhada (2–3) = 0,5 cada.</p>
    <form id="fEditSale">
      <label>Cliente *</label><input id="eClient" required value="${esc(sale.customer_name)}">
      <label>Produto *</label><input id="eProduct" required value="${esc(sale.product)}">
      <label>Cor *</label><input id="eColor" required value="${esc(sale.color)}">
      <label>Loja *</label>
      <select id="eStore">${editStores.map((s) => `<option value="${s.id}" ${Number(sale.store_id) === Number(s.id) ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
      <label>Canal *</label>
      <select id="eChannel"><option ${sale.channel === 'WhatsApp' ? 'selected' : ''}>WhatsApp</option><option ${sale.channel === 'CRM' ? 'selected' : ''}>CRM</option><option ${sale.channel === 'Presencial' ? 'selected' : ''}>Presencial</option></select>
      <label>Data</label><input type="date" id="eDate" value="${esc(sale.sale_date)}" max="${todayISO()}">
      <label>Participantes (1 a 3) *</label>
      <details class="tray" id="eTray">
        <summary id="eTraySum">Selecionar participantes…</summary>
        <div class="check-list" id="eplist">
          ${sellers.filter((s) => s.active !== false || selIds.includes(s.id)).map((s) => `<div class="check ${selIds.includes(s.id) ? 'on' : ''}" data-id="${s.id}" data-name="${esc(s.name)}" data-sector="${esc(s.sector || 'online')}">${esc(s.name)} ${sectorTag(s.sector)} ${s.store_name && s.store_name !== 'Sede' ? storeTag(s.store_name) : ''}</div>`).join('')}
        </div>
      </details>
      <label style="display:flex;gap:8px;align-items:center;font-weight:normal;margin-top:10px"><input type="checkbox" id="eBonus" style="width:auto" ${wasBonus ? 'checked' : ''}> ⭐ Valor exclusivo (bônus de modelo especial)</label>
      <div id="eBonusBox" style="display:${wasBonus ? 'block' : 'none'}">
        <label>Comissão exclusiva por vendedora (R$) *</label>
        <input id="eBonusVal" type="number" min="0.01" max="1000" step="0.01" placeholder="Ex: 50,00" value="${wasBonusReais}">
      </div>
      <div class="card" id="ePreview" style="margin-top:10px;background:var(--brand-soft)"></div>
      <div style="height:12px"></div>
      <button class="btn btn-accent btn-big" type="submit">Salvar alterações</button>
      <button class="btn btn-ghost btn-big" type="button" id="cancel">Cancelar</button>
    </form>
  </div></div>`;
  $('#cancel').onclick = closeModal;
  $('#mbg').onclick = (e) => { if (e.target.id === 'mbg') closeModal(); };
  const eBonusCents = () => ($('#eBonus').checked ? parseBonusReais($('#eBonusVal').value) : null);
  const eStoreName = () => {
    const opt = $('#eStore').selectedOptions?.[0];
    return opt ? opt.textContent.trim() : 'Sede';
  };
  const refreshEditPreview = () => {
    const pids = $$('#eplist .check.on').map((c) => Number(c.dataset.id));
    const pv = previewCommission(sellers, pids, eBonusCents(), eStoreName());
    $('#ePreview').innerHTML = !pv
      ? '<p class="muted" style="margin:0;font-size:13px">Selecione as participantes para ver a comissão.</p>'
      : `<p style="margin:0;font-size:13px">💰 Comissão: <b>${fmtBRL(pv.each)} cada</b> <span class="muted">(${pv.isBonus ? 'bônus exclusivo' : 'base ' + fmtBRL(pv.base) + ' • ' + esc(eStoreName())} • ${pv.count} participante${pv.count > 1 ? 's' : ''})</span></p>`;
  };
  $('#eStore').onchange = refreshEditPreview;
  $('#eBonus').onchange = () => { $('#eBonusBox').style.display = $('#eBonus').checked ? 'block' : 'none'; refreshEditPreview(); };
  $('#eBonusVal').oninput = refreshEditPreview;
  $('#eplist').onclick = (e) => {
    const c = e.target.closest('.check'); if (!c) return;
    c.classList.toggle('on');
    if ($$('#eplist .check.on').length > 3) { c.classList.remove('on'); toast('Máximo de 3 participantes.', 'err'); }
    const sel = $$('#eplist .check.on').map((x) => x.dataset.name || x.textContent.trim());
    $('#eTraySum').textContent = sel.length ? sel.join(', ') : 'Selecionar participantes…';
    refreshEditPreview();
  };
  $('#eTraySum').textContent = $$('#eplist .check.on').map((x) => x.dataset.name || x.textContent.trim()).join(', ') || 'Selecionar participantes…';
  refreshEditPreview();
  $('#fEditSale').onsubmit = async (e) => {
    e.preventDefault();
    const pids = $$('#eplist .check.on').map((c) => Number(c.dataset.id));
    if (!pids.length) return toast('Selecione ao menos 1 participante.', 'err');
    const isBonus = $('#eBonus').checked;
    if (isBonus && eBonusCents() == null) return toast('Informe o valor do bônus.', 'err');
    try {
      await api(`/api/sales/${sale.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          customer_name: $('#eClient').value.trim(),
          product: $('#eProduct').value.trim(),
          color: $('#eColor').value.trim(),
          channel: $('#eChannel').value,
          sale_date: $('#eDate').value || sale.sale_date,
          store_id: Number($('#eStore').value),
          participant_ids: pids,
          is_bonus: isBonus,
          bonus_value: isBonus ? Number(String($('#eBonusVal').value).replace(',', '.')) : undefined,
        }),
      });
      closeModal(); toast('Venda atualizada!'); if (onSaved) onSaved();
    } catch (err) { toast(err.message, 'err'); }
  };
}

const storeTag = (name) => !name || name === 'Sede'
  ? `<span class="chip wa" style="font-size:10px;padding:1px 8px">Sede</span>`
  : `<span class="chip lime" style="font-size:10px;padding:1px 8px">${esc(name)}</span>`;

// ---------- ADMIN ----------
async function viewAdmin(app) {
  const isManager = store.user?.role === 'manager';
  if (isManager) adminStore = String(store.user.store_id || '');
  let stores = [];
  try { stores = (await api('/api/stores')).stores; } catch {}
  app.innerHTML = `
    <div class="row" style="justify-content:space-between;align-items:center"><h2 style="margin:4px 0">Visão geral${isManager ? ` <span class="muted" style="font-size:13px">• ${esc(store.user.store_name || '')}</span>` : ''}</h2><div class="row"><a class="btn" href="#/admin/ponto" style="text-decoration:none">🕒 Ponto</a>${isManager ? '' : '<a class="btn" href="#/admin/comissoes" style="text-decoration:none">💰 Comissões</a>'}</div></div>
    <div id="kpiWrap"><div class="card"><p class="muted">Carregando…</p></div></div>
    ${isManager ? '' : `<div class="mini-pills" id="storePills">
      <button data-st="" class="${!adminStore ? 'on' : ''}">Todas</button>
      ${stores.map((s) => `<button data-st="${s.id}" class="${String(adminStore) === String(s.id) ? 'on' : ''}">${esc(s.name)}</button>`).join('')}
    </div>`}
    <div class="mini-pills" id="sectorPills">
      <button data-s="" class="${!adminSector ? 'on' : ''}">Todos</button>
      <button data-s="online" class="${adminSector === 'online' ? 'on' : ''}">Online</button>
      <button data-s="presencial" class="${adminSector === 'presencial' ? 'on' : ''}">Presencial</button>
    </div>
    ${periodPills(adminPeriod.key)}
    <div id="customRow" style="display:${adminPeriod.key === 'custom' ? 'block' : 'none'}" class="card">
      <div class="row"><div style="flex:1"><label>De</label><input type="date" id="fFrom" value="${adminPeriod.from || ''}"></div>
      <div style="flex:1"><label>Até</label><input type="date" id="fTo" value="${adminPeriod.to || ''}"></div></div>
      <div style="height:10px"></div><button class="btn btn-primary" id="applyCustom">Aplicar</button>
    </div>
    <div class="row" style="margin:10px 0">
      <select id="fSeller" style="flex:1;max-width:240px"><option value="">Todas as vendedoras</option></select>
      <select id="fChannel" style="flex:1;max-width:200px"><option value="">Todos os canais</option><option ${adminChannel === 'WhatsApp' ? 'selected' : ''}>WhatsApp</option><option ${adminChannel === 'CRM' ? 'selected' : ''}>CRM</option><option ${adminChannel === 'Presencial' ? 'selected' : ''}>Presencial</option></select>
    </div>
    <div id="rankWrap"></div>`;
  const storePills = $('#storePills');
  if (storePills) storePills.onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    adminStore = b.dataset.st; adminSeller = '';
    route();
  };
  $('#sectorPills').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    adminSector = b.dataset.s; adminSeller = '';
    route();
  };
  bindPeriodPills((p) => {
    if (p.key === 'custom') { adminPeriod = { key: 'custom', from: adminPeriod.from, to: adminPeriod.to }; route(); return; }
    adminPeriod = p; route();
  });
  $('#applyCustom')?.addEventListener('click', () => {
    adminPeriod = { key: 'custom', from: $('#fFrom').value, to: $('#fTo').value, label: 'Personalizado' };
    loadAdminBody();
  });

  const { sellers } = await api(`/api/sellers${adminSector ? `?sector=${adminSector}` : ''}`);
  const sel = $('#fSeller');
  sel.innerHTML = `<option value="">Todas as vendedoras</option>` + sellers.map((s) => `<option value="${s.id}" ${String(adminSeller) === String(s.id) ? 'selected' : ''}>${esc(s.name)} (${sectorLabel(s.sector)})</option>`).join('');
  sel.onchange = () => { adminSeller = sel.value; loadAdminBody(); };
  $('#fChannel').onchange = (e) => { adminChannel = e.target.value; loadAdminBody(); };
  await loadAdminBody();

  async function loadAdminBody() {
    const { from, to } = adminPeriod;
    const qs = new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}) });
    const sectorQs = adminSector ? `&sector=${adminSector}` : '';
    const storeQs = adminStore ? `&store_id=${adminStore}` : '';
    const kpi = $('#kpiWrap');
    const rank = $('#rankWrap');
    const [summary, ranking] = await Promise.all([
      api(`/api/stats/summary?${qs}${adminSeller ? `&seller_id=${adminSeller}` : sectorQs + storeQs}`),
      api(`/api/stats/ranking?${qs}${sectorQs}${storeQs}`),
    ]);
    const filtered = adminSeller ? ranking.ranking.filter((r) => String(r.seller_id) === String(adminSeller)) : ranking.ranking;
    const chanVal = (r) => (adminChannel === 'WhatsApp' ? r.whatsapp : adminChannel === 'CRM' ? r.crm : r.presencial);
    const withChannel = adminChannel
      ? filtered.map((r) => ({ ...r, sales: chanVal(r) }))
      : filtered;
    kpi.innerHTML = `
      <p class="muted" style="margin:12px 0">${esc(adminPeriod.label || '')} • ${from ? fmtDateBR(from) : '…'} a ${to ? fmtDateBR(to) : '…'}</p>
      ${kpiCards(summary, '', !adminSeller)}
    `;
    const rankRow = (r, i) => `<tr>
      <td>${i + 1}</td>
          <td><a href="#/admin/vendedora/${r.seller_id}" style="text-decoration:none"><span class="row" style="align-items:center;gap:8px;flex-wrap:nowrap"><span class="ava sm">${r.avatar_url ? `<img src="${r.avatar_url}" alt="">` : esc((r.name || '?')[0].toUpperCase())}</span><span><b>${esc(r.name)}</b> ${sectorTag(r.sector)} ${storeTag(r.store_name)}</span></span></a></td>
      <td class="mono">${fmtInt(r.calls)}</td><td class="mono"><b>${fmtV(r.sales)}</b></td><td class="mono">${fmtPct(r.conversion)}</td>
    </tr>`;
    const rankHead = '<table><thead><tr><th>#</th><th>Vendedora</th><th>Chamadas</th><th>Vendas</th><th>Conv.</th></tr></thead><tbody>';
    const first5 = withChannel.slice(0, 5).map(rankRow).join('');
    const restRank = withChannel.slice(5);
    rank.innerHTML = `
      <h3 class="section-title">Ranking</h3>
      ${withChannel.length ? `
      <div class="card" style="padding:0;overflow:hidden">
        ${rankHead}${first5}</tbody></table>
        ${restRank.length ? `<div data-rest style="display:none"><table><tbody>${restRank.map((r, k) => rankRow(r, k + 5)).join('')}</tbody></table></div>
        <div style="padding:10px"><button class="btn btn-ghost btn-big" data-more>Ver mais (${restRank.length})</button></div>` : ''}
      </div>` : '<div class="card empty">Não há dados neste período.</div>'}
    `;
    bindCompactList(rank);
  }
}

async function viewArchive(app) {
  app.innerHTML = `
    <a href="#/admin" class="muted" style="font-size:13px">← Voltar</a>
    <h2 style="margin:6px 0">Arquivo 🗃️</h2>
    <p class="muted" style="font-size:13px">Vendas com +90 dias, só leitura.</p>
    <div class="card"><label>Buscar</label><input id="aQ" placeholder="Cliente, produto…">
    <div style="height:10px"></div><button class="btn btn-primary" id="aGo">Buscar</button></div>
    <div id="aList" style="margin-top:12px"><div class="card"><p class="muted">Carregando…</p></div></div>`;
  const load = async () => {
    const q = $('#aQ').value.trim();
    try {
      const { sales } = await api(`/api/maintenance/archive${q ? `?q=${encodeURIComponent(q)}` : ''}`);
      $('#aList').innerHTML = sales.length
        ? compactListHTML(sales, (s) => {
          const parts = (s.participants || []).map((p) => `${esc(p.seller_name)} → ${fmtV(p.credit)}`).join(' · ');
          return `<div class="sale-card" style="padding:10px 12px">
            <div class="row" style="justify-content:space-between;align-items:center">
              <b>${esc(s.customer_name)}</b><span class="muted mono" style="font-size:12px">${fmtDateBR(s.sale_date)}</span>
            </div>
            <div class="muted" style="font-size:12.5px;margin-top:2px">${esc(s.product)} • ${esc(s.color)} • ${esc(s.channel)} • 👥 ${parts}</div>
          </div>`;
        }, 10)
        : '<div class="card empty">Nada no arquivo.</div>';
      bindCompactList($('#aList'));
    } catch (e) { $('#aList').innerHTML = `<div class="card empty">${esc(e.message)}</div>`; }
  };
  $('#aGo').onclick = load;
  let deb = null;
  $('#aQ').oninput = () => { clearTimeout(deb); deb = setTimeout(load, 400); };
  await load();
}

// menu do botão central: admin registra vendas/chamadas, vendedora só bate ponto
function modalEscolhaRegistro() {
  // gerente registra vendas (sem chamadas, sem comissões); vendedora só bate ponto
  if (store.user?.role === 'manager') {
    api('/api/sellers').then(({ sellers }) => {
      modalSale(sellers || [], [{ id: store.user.store_id, name: store.user.store_name || 'Minha loja' }]);
    }).catch((e) => toast(e.message, 'err'));
    return;
  }
  if (store.user?.role !== 'admin') {
    modalPonto(() => route());
    return;
  }
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
      const [{ sellers }, { stores }] = await Promise.all([api('/api/sellers'), api('/api/stores')]);
      modalSale(sellers, stores);
    } catch (e) { toast(e.message, 'err'); }
  };
  $('#chCalls').onclick = () => modalCallsAdmin();
}

function modalCallsAdmin() {
  if (store.user?.role !== 'admin') { toast('Apenas o administrador pode registrar chamadas.', 'err'); return; }
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
  const isManager = store.user?.role === 'manager';
  let stores = [];
  try { stores = (await api('/api/stores')).stores; } catch {}
  app.innerHTML = `<h2 style="margin:4px 0">Vendas${isManager ? ` <span class="muted" style="font-size:13px">• ${esc(store.user.store_name || '')}</span>` : ''}</h2>
    <div class="card"><label>Buscar</label><input id="q" placeholder="Cliente, produto, cor…">
    <div class="row" style="margin-top:10px;flex-wrap:nowrap;align-items:center">
      <select id="fSellerSales" style="flex:1"><option value="">Todas as vendedoras</option></select>
      ${isManager ? '' : `<select id="fStoreSales" style="flex:1"><option value="">Todas as lojas</option>${stores.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select>`}
      <select id="ch" style="flex:0 1 200px"><option value="">Todos os canais</option><option>WhatsApp</option><option>CRM</option><option>Presencial</option></select>
      <button class="btn btn-primary" id="go">Filtrar</button>
    </div></div>
    <div id="list" style="margin-top:12px"><div class="card"><p class="muted">Carregando…</p></div></div>`;
  try {
    const { sellers } = await api('/api/sellers');
    $('#fSellerSales').innerHTML = `<option value="">Todas as vendedoras</option>` + sellers.map((s) => `<option value="${s.id}" ${String(adminSeller) === String(s.id) ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
  } catch {}
  const load = async () => {
    const sid = $('#fSellerSales').value || '';
    const stid = $('#fStoreSales')?.value || '';
    const qs = new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}), ...(sid ? { seller_id: sid } : {}), ...(stid ? { store_id: stid } : {}), ...($('#ch').value ? { channel: $('#ch').value } : {}), ...($('#q').value ? { q: $('#q').value } : {}) });
    const { sales } = await api(`/api/sales?${qs}`);
    $('#list').innerHTML = sales.length
      ? compactListHTML(sales, (s) => saleCard(s, `<button class="btn btn-ghost" style="font-size:12px;padding:6px 10px" data-edit="${s.id}">Editar</button> <button class="btn btn-ghost btn-del" style="font-size:12px;padding:6px 10px" data-del="${s.id}">Cancelar</button>`), 8)
      : '<div class="card empty">Não há vendas registradas neste período.</div>';
    bindCompactList($('#list'));
    $$('#list [data-del]').forEach((b) => (b.onclick = () => {
      const sale = sales.find((x) => String(x.id) === String(b.dataset.del));
      if (!sale) return;
      modalCancelSale(sale, load);
    }));
    $$('#list [data-edit]').forEach((b) => (b.onclick = async () => {
      const sale = sales.find((x) => String(x.id) === String(b.dataset.edit));
      if (!sale) return;
      try {
        const [{ sellers }, { stores }] = await Promise.all([api('/api/sellers'), api('/api/stores')]);
        modalEditSale(sale, sellers, stores, load);
      } catch (e) { toast(e.message, 'err'); }
    }));
  };
  $('#go').onclick = load;
  $('#fSellerSales').onchange = load;
  $('#ch').onchange = load;
  const fsSales = $('#fStoreSales');
  if (fsSales) fsSales.onchange = load;
  await load();
}

// lista compacta com "Ver mais" inline (reutilizável em todas as listas)
function compactListHTML(items, renderFn, initial = 5) {
  const shown = items.slice(0, initial).map((it, k) => renderFn(it, k)).join('');
  const rest = items.length - initial;
  if (rest <= 0) return shown;
  return `${shown}<div data-rest style="display:none">${items.slice(initial).map((it, k) => renderFn(it, k + initial)).join('')}</div>
    <button class="btn btn-ghost btn-big" data-more>Ver mais (${rest})</button>`;
}
function bindCompactList(box) {
  const btn = box.querySelector('[data-more]');
  if (!btn) return;
  btn.onclick = () => {
    const rest = box.querySelector('[data-rest]');
    const open = rest.style.display === 'none';
    rest.style.display = open ? 'block' : 'none';
    btn.textContent = open ? 'Ver menos' : `Ver mais (${rest.children.length})`;
  };
}

let pontoTab = 'dia';
// ---------- PONTO (admin): abas Dia / Extras / Feriados / QR-Loja ----------
async function viewPonto(app) {
  const t = todayISO();
  app.innerHTML = `
    <a href="#/admin" class="muted" style="font-size:13px">← Voltar</a>
    <h2 style="margin:6px 0">Ponto 🕒</h2>
    <div class="mini-pills" id="pontoTabs">
      <button data-tab="dia" class="${pontoTab === 'dia' ? 'on' : ''}">Dia</button>
      <button data-tab="extras" class="${pontoTab === 'extras' ? 'on' : ''}">Extras</button>
      <button data-tab="feriados" class="${pontoTab === 'feriados' ? 'on' : ''}">Feriados</button>
      <button data-tab="loja" class="${pontoTab === 'loja' ? 'on' : ''}">QR / Loja</button>
    </div>
    <div id="pontoBody" style="margin-top:12px"></div>
    <div class="foot">Desenvolvido pela Wisionarium</div>`;
  const body = $('#pontoBody');
  const showTab = async (tab) => {
    pontoTab = tab;
    $$('#pontoTabs button').forEach((x) => x.classList.toggle('on', x.dataset.tab === tab));
    if (tab === 'dia') return tabPontoDia(body, t);
    if (tab === 'extras') return tabPontoExtras(body, t);
    if (tab === 'feriados') return tabPontoFeriados(body);
    return tabPontoLoja(body);
  };
  $('#pontoTabs').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    showTab(b.dataset.tab);
  };
  await showTab(pontoTab);
}

async function tabPontoLoja(body) {
  body.innerHTML = `<div id="qrBox"><p class="muted">Carregando lojas…</p></div>`;
  try {
    const { stores } = await api('/api/stores/qr');
    if (!stores.length) { $('#qrBox').innerHTML = '<div class="card empty">Nenhuma loja cadastrada.</div>'; return; }
    $('#qrBox').innerHTML = stores.map((s) => `
      <div class="card" style="margin-bottom:12px">
        <div class="row" style="align-items:center;flex-wrap:nowrap">
          <img src="${s.qrImage}" alt="QR ${esc(s.name)}" style="width:96px;height:96px;border-radius:12px">
          <div style="flex:1"><b>${esc(s.name)}</b>
            <div class="mono" style="font-weight:800;letter-spacing:.06em">${esc(s.qr_code)}</div>
            <span class="muted" style="font-size:12px">${s.lat != null && s.lng != null ? `📍 Local definido ✓ • raio ${s.radius_m}m` : '📍 Local ainda não definido'}</span>
          </div>
        </div>
        ${s.lat != null && s.lng != null ? `<div style="margin-top:6px;font-size:13px"><span class="mono">${Number(s.lat).toFixed(6)}, ${Number(s.lng).toFixed(6)}</span> • <a href="https://maps.google.com/?q=${s.lat},${s.lng}" target="_blank" rel="noopener">Ver no mapa</a></div>` : ''}
        <div class="row" style="margin-top:10px">
          <button class="btn" data-printqr="${s.id}">🖨️ Imprimir QR</button>
          <button class="btn btn-ghost" data-geostore="${s.id}">📍 Ajustar localização</button>
        </div>
        <div id="geo-${s.id}" style="margin-top:8px"></div>
      </div>`).join('');
    const byId = Object.fromEntries(stores.map((s) => [s.id, s]));
    $('#qrBox').onclick = async (e) => {
      const pr = e.target.closest('[data-printqr]');
      if (pr) {
        const s = byId[pr.dataset.printqr];
        const w = window.open('', '_blank');
        w.document.write(`<html><head><title>QR Ponto — ${esc(s.name)}</title></head><body style="text-align:center;font-family:sans-serif;padding:40px"><h1>${esc(s.name)} — Ponto</h1><img src="${s.qrImage}" style="width:320px;height:320px"><h2 style="letter-spacing:.1em">${esc(s.qr_code)}</h2><p>Escaneie ao chegar e ao sair. A localização é verificada (raio ${s.radius_m}m).</p><script>onload=()=>{print();}<\/script></body></html>`);
        w.document.close();
        return;
      }
      const gs = e.target.closest('[data-geostore]');
      if (gs) {
        const s = byId[gs.dataset.geostore];
        const box = $(`#geo-${s.id}`);
        box.innerHTML = `
          <div class="card" style="background:var(--brand-soft);margin:0">
            <b style="font-size:13px">1) GPS aqui na loja</b><br>
            <span class="muted" style="font-size:12px">Fique na entrada, com céu visível.</span>
            <div style="height:6px"></div>
            <button class="btn" data-geogps="${s.id}">Usar minha posição</button>
            <div id="geogps-${s.id}" style="margin-top:6px;font-size:13px"></div>
            <div style="height:10px"></div>
            <b style="font-size:13px">2) Buscar pelo CEP</b>
            <div class="row" style="flex-wrap:nowrap;margin-top:4px">
              <input id="geocz-${s.id}" inputmode="numeric" placeholder="Ex: 25900-000" style="flex:1">
              <button class="btn" data-geosearch="${s.id}">Buscar</button>
            </div>
            <div id="geores-${s.id}" style="margin-top:6px;font-size:13px"></div>
            <div style="height:10px"></div>
            <b style="font-size:13px">3) Manual (do Google Maps)</b>
            <div class="row" style="margin-top:4px">
              <div style="flex:1"><input id="geolat-${s.id}" inputmode="decimal" placeholder="Latitude"></div>
              <div style="flex:1"><input id="geolng-${s.id}" inputmode="decimal" placeholder="Longitude"></div>
              <div style="flex:0 1 90px"><input id="georad-${s.id}" type="number" min="30" max="2000" value="${s.radius_m ?? 150}" title="Raio (m)"></div>
            </div>
            <div style="height:6px"></div>
            <button class="btn btn-accent" data-geosave="${s.id}">Salvar localização</button>
          </div>`;
        return;
      }
      const gps = e.target.closest('[data-geogps]');
      if (gps) {
        const s = byId[gps.dataset.geogps];
        const out = $(`#geogps-${s.id}`);
        out.innerHTML = `<span class="muted">Obtendo posição…</span>`;
        try {
          const pos = await getGeo();
          const acc = Math.round(pos.coords.accuracy || 0);
          const lat = Number(pos.coords.latitude.toFixed(6));
          const lng = Number(pos.coords.longitude.toFixed(6));
          out.innerHTML = `📍 <span class="mono">${lat}, ${lng}</span> <span class="muted">(precisão ±${acc}m)</span><br>
            ${acc > 150 ? `<b style="color:var(--red)">Sinal fraco — saia para a calçada e tente de novo antes de salvar.</b><br>` : `<span style="color:var(--brand)">Sinal bom ✓</span><br>`}
            <a href="https://maps.google.com/?q=${lat},${lng}" target="_blank" rel="noopener">Ver no mapa</a>
            <div style="height:6px"></div>
            <button class="btn btn-accent" data-geousesave="${s.id}" data-lat="${lat}" data-lng="${lng}">Salvar este ponto</button>`;
        } catch (err) { out.innerHTML = `<span style="color:var(--red)">${esc(err.message)}</span>`; }
        return;
      }
      const usesave = e.target.closest('[data-geousesave]');
      if (usesave) {
        const s = byId[usesave.dataset.geousesave];
        try {
          await api(`/api/stores/${s.id}`, { method: 'PUT', body: JSON.stringify({ lat: Number(usesave.dataset.lat), lng: Number(usesave.dataset.lng), radius_m: s.radius_m ?? 150 }) });
          toast(`Localização da ${s.name} salva!`);
          tabPontoLoja(body);
        } catch (err) { toast(err.message, 'err'); }
        return;
      }
      const sch = e.target.closest('[data-geosearch]');
      if (sch) {
        const s = byId[sch.dataset.geosearch];
        const out = $(`#geores-${s.id}`);
        const cep = String($(`#geocz-${s.id}`).value || '').replace(/\D/g, '');
        if (cep.length !== 8) { out.innerHTML = `<span style="color:var(--red)">Digite os 8 números do CEP.</span>`; return; }
        out.innerHTML = `<span class="muted">Buscando CEP…</span>`;
        try {
          const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&countrycodes=br&postalcode=${cep}&limit=1`, { headers: { Accept: 'application/json' } });
          const j = await r.json();
          if (!j.length) { out.innerHTML = `<span style="color:var(--red)">CEP não encontrado. Confira o número ou use o modo manual.</span>`; return; }
          const lat = Number(Number(j[0].lat).toFixed(6));
          const lng = Number(Number(j[0].lon).toFixed(6));
          out.innerHTML = `📍 ${esc(j[0].display_name.split(',').slice(0, 3).join(','))}<br>
            <span class="mono">${lat}, ${lng}</span> • <a href="https://maps.google.com/?q=${lat},${lng}" target="_blank" rel="noopener">Ver no mapa</a><br>
            <span class="muted" style="font-size:12px">Confira no mapa se é a rua da loja antes de salvar.</span>
            <div style="height:6px"></div>
            <button class="btn btn-accent" data-geousesave="${s.id}" data-lat="${lat}" data-lng="${lng}">Usar este ponto</button>`;
        } catch (err) { out.innerHTML = `<span style="color:var(--red)">Sem internet para buscar o CEP. Tente o GPS ou o modo manual.</span>`; }
        return;
      }
      const sv = e.target.closest('[data-geosave]');
      if (sv) {
        const s = byId[sv.dataset.geosave];
        const lat = Number(String($(`#geolat-${s.id}`).value || '').replace(',', '.'));
        const lng = Number(String($(`#geolng-${s.id}`).value || '').replace(',', '.'));
        const rad = Number($(`#georad-${s.id}`).value || s.radius_m || 150);
        if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
          toast('Coordenadas inválidas. Confira latitude (-90 a 90) e longitude (-180 a 180).', 'err');
          return;
        }
        try {
          await api(`/api/stores/${s.id}`, { method: 'PUT', body: JSON.stringify({ lat, lng, radius_m: rad }) });
          toast(`Localização da ${s.name} salva!`);
          tabPontoLoja(body);
        } catch (err) { toast(err.message, 'err'); }
      }
    };
  } catch (e) { $('#qrBox').innerHTML = `<div class="card empty">${esc(e.message)}</div>`; }
}
  // dia
let pontoKind = '';
async function tabPontoDia(body, t) {
  const isManager = store.user?.role === 'manager';
  let stores = [];
  // gerente não tem o seletor de loja (travado na dele) — e /api/stores é só-admin
  if (!isManager) {
    try { stores = (await api('/api/stores')).stores; } catch {}
  }
  body.innerHTML = `
    <div class="card">
      <div class="row" style="flex-wrap:nowrap;align-items:end">
        <div style="flex:1"><label>Data</label><input type="date" id="pDate" value="${t}" max="${t}"></div>
        ${isManager ? '' : `<div style="flex:1"><label>Loja</label><select id="pStore"><option value="">Todas</option>${stores.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></div>`}
        <button class="btn btn-primary" id="pGo">Ver dia</button>
      </div>
      <div class="mini-pills" id="pKind" style="margin-top:10px">
        <button data-k="" class="${!pontoKind ? 'on' : ''}">Todos</button>
        <button data-k="seller" class="${pontoKind === 'seller' ? 'on' : ''}">Vendedoras</button>
        <button data-k="staff" class="${pontoKind === 'staff' ? 'on' : ''}">Funcionários</button>
      </div>
      <div id="pDay" style="margin-top:12px"><p class="muted">Carregando…</p></div>
    </div>`;
  $('#pKind').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    pontoKind = b.dataset.k;
    $$('#pKind button').forEach((x) => x.classList.toggle('on', x === b));
    loadDay();
  };
  const loadDay = async () => {
    const date = $('#pDate').value || t;
    const stid = $('#pStore')?.value || '';
    const box = $('#pDay');
    box.innerHTML = '<p class="muted">Carregando…</p>';
    try {
      const d = await api(`/api/ponto/dia?date=${date}${stid ? `&store_id=${stid}` : ''}${pontoKind ? `&kind=${pontoKind}` : ''}`);
      const present = d.rows.filter((r) => r.punch);
      const absent = d.rows.filter((r) => !r.punch);
      const rowHTML = (r) => {
        const ava = `<span class="ava sm">${r.avatar_url ? `<img src="${r.avatar_url}" alt="">` : esc((r.name || '?')[0].toUpperCase())}</span>`;
        const extra = r.punch && r.punch.extra_min > 0 ? ` <span class="chip lime">＋${esc(r.punch.extra_label)}</span>` : '';
        const elsewhere = r.punch?.punch_store && r.punch.punch_store !== (r.store_name || 'Sede') ? ` ${storeTag(r.punch.punch_store)}` : '';
        return `
          <div class="sale-card"><div class="row" style="justify-content:space-between;align-items:center;flex-wrap:nowrap">
            <span class="row" style="align-items:center;gap:8px;flex-wrap:nowrap">${ava}<span><b>${esc(r.name)}</b> ${r.role === 'staff' ? '<span class="chip" style="font-size:10px;padding:1px 8px">Funcionário</span>' : sectorTag(r.sector)}${elsewhere}<br>
            <span class="mono" style="font-size:15px;font-weight:800">${r.punch.in_hhmm || '—'} → ${r.punch.out_hhmm || '—'}</span></span></span>
            <span style="text-align:right">${extra}<br><button class="btn btn-ghost" style="font-size:12px;padding:4px 8px" data-fix="${r.punch.id}">corrigir</button></span>
          </div></div>`;
      };
      box.innerHTML = `
        ${!d.rows.length ? `<div class="card empty">Nenhuma vendedora vinculada a esta loja ainda.<br><span class="muted" style="font-size:12px">O admin geral cadastra em Equipe → Nova pessoa → Vendedora → Loja.</span></div>` : ''}
        <p class="muted" style="font-size:13px">✅ Presentes: <b>${d.present}</b> • ⬜ Ausentes: <b>${d.absent}</b></p>
        ${d.is_holiday ? `<p class="muted" style="font-size:13px">🎉 Feriado (${esc(d.holiday.label)}) — padrão 5h${d.auto_holiday ? ' • <span style="color:var(--brand)">detectado automaticamente 🤖</span>' : ''}</p>` : ''}
        ${compactListHTML(present, rowHTML, 8)}
        ${absent.length ? `<h3 class="section-title" style="font-size:15px">Ausentes (${absent.length})</h3>
          ${compactListHTML(absent, (r) => `
          <div class="sale-card"><div class="row" style="justify-content:space-between;align-items:center;flex-wrap:nowrap">
            <span><b>${esc(r.name)}</b> ${sectorTag(r.sector)}</span>
            <button class="btn" data-lancar="${r.seller_id}">Lançar ponto</button>
          </div></div>`, 8)}` : ''}`;
      bindCompactList(box);
      box._rows = d.rows;
      box.onclick = (e) => {
        const fx = e.target.closest('[data-fix]');
        if (fx) {
          const row = box._rows.flatMap((x) => x.punch ? [x.punch] : []).find((p) => String(p.id) === String(fx.dataset.fix));
          modalFixPonto(row, loadDay);
          return;
        }
        const lc = e.target.closest('[data-lancar]');
        if (lc) {
          const row = box._rows.find((x) => String(x.seller_id) === String(lc.dataset.lancar));
          modalManualPonto(row.seller_id, row.name, date, loadDay);
        }
      };
    } catch (e) { box.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  };
  $('#pGo').onclick = loadDay;
  const pStoreEl = $('#pStore');
  if (pStoreEl) pStoreEl.onchange = loadDay;
  await loadDay();
}
  // mês
async function tabPontoExtras(body, t) {
  body.innerHTML = `
    <div class="card">
      <div class="row" style="flex-wrap:nowrap;align-items:end">
        <div style="flex:1"><label>Mês</label><input type="month" id="pMonth" value="${t.slice(0, 7)}"></div>
        <button class="btn btn-primary" id="pMonthGo">Ver mês</button>
      </div>
      <div class="mini-pills" id="pMonthKind" style="margin-top:10px">
        <button data-k="" class="${!pontoKind ? 'on' : ''}">Todos</button>
        <button data-k="seller" class="${pontoKind === 'seller' ? 'on' : ''}">Vendedoras</button>
        <button data-k="staff" class="${pontoKind === 'staff' ? 'on' : ''}">Funcionários</button>
      </div>
      <div id="pMonthBody" style="margin-top:12px"><p class="muted">Carregando…</p></div>
    </div>`;
  $('#pMonthKind').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    pontoKind = b.dataset.k;
    $$('#pMonthKind button').forEach((x) => x.classList.toggle('on', x === b));
    loadMonth();
  };
  const loadMonth = async () => {
    const month = $('#pMonth').value || t.slice(0, 7);
    const box = $('#pMonthBody');
    box.innerHTML = '<p class="muted">Carregando…</p>';
    try {
      const r = await api(`/api/ponto/resumo?month=${month}${pontoKind ? `&kind=${pontoKind}` : ''}`);
      const msg = `*HORAS EXTRAS — ${month.slice(5, 7)}/${month.slice(0, 4)}*\nTotal: ${r.total_extra_label}\n` +
        r.rows.map((x) => `• ${x.name}: ${x.extra_label}`).join('\n');
      const waLink = (phone) => `https://wa.me/${phone ? phone.replace(/\D/g, '') : ''}?text=${encodeURIComponent(msg)}`;
      box.innerHTML = `
        <div class="card" style="background:var(--brand-soft);text-align:center;margin-bottom:12px">
          <div class="muted" style="font-size:12px">Total do mês</div>
          <div class="mono" style="font-size:30px;font-weight:800">${r.total_extra_label}</div>
        </div>
        ${compactListHTML(r.rows, (x, i) => `
          <div class="sale-card"><div class="row" style="justify-content:space-between;align-items:center;flex-wrap:nowrap">
            <span class="row" style="align-items:center;gap:8px;flex-wrap:nowrap"><b class="mono muted">#${i + 1}</b>
            <span class="ava sm">${x.avatar_url ? `<img src="${x.avatar_url}" alt="">` : esc((x.name || '?')[0].toUpperCase())}</span>
            <span><b>${esc(x.name)}</b> ${x.role === 'staff' ? '<span class="chip" style="font-size:10px;padding:1px 8px">Funcionário</span>' : sectorTag(x.sector)}</span></span>
            <b class="mono" style="font-size:17px">${x.extra_label}</b>
          </div></div>`, 8)}
        <label style="margin-top:14px">Número de destino (opcional, com DDI+DDD)</label>
        <input id="exPhone" inputmode="tel" placeholder="Ex: 5511999999999" value="${esc(localStorage.getItem('ec_wa_phone') || '')}">
        <div style="height:10px"></div>
        <a class="btn btn-green btn-big" id="exWa" href="${waLink('')}" target="_blank" rel="noopener" style="display:block;text-align:center;text-decoration:none">Enviar no WhatsApp</a>
        <div class="row" style="margin-top:8px">
          <button class="btn btn-big" id="copyExtra" style="flex:1">Copiar resumo</button>
          <button class="btn btn-big" id="printExtra" style="flex:1">🖨️ Imprimir / PDF</button>
        </div>`;
      bindCompactList(box);
      $('#exPhone').oninput = (e) => { localStorage.setItem('ec_wa_phone', e.target.value); $('#exWa').href = waLink(e.target.value); };
      $('#copyExtra').onclick = async () => { await navigator.clipboard.writeText(msg).catch(() => {}); toast('Resumo copiado!'); };
      $('#printExtra').onclick = () => printExtrasPDF(month, r);
    } catch (e) { box.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  };
  $('#pMonthGo').onclick = loadMonth;
  await loadMonth();
}

// PDF simples de horas extras (totais por vendedora) via impressão do sistema
function printExtrasPDF(month, r) {
  const [y, m] = month.split('-');
  const rows = r.rows.map((x, i) => `<tr><td>${i + 1}</td><td>${esc(x.name)}</td><td>${x.role === 'staff' ? 'Funcionário' : x.sector === 'presencial' ? 'Presencial' : 'Online'}</td><td style="text-align:right"><b>${x.extra_label}</b></td></tr>`).join('');
  const w = window.open('', '_blank');
  w.document.write(`<html><head><title>Horas Extras — ${m}/${y}</title><style>
    body{font-family:sans-serif;padding:40px;color:#111} h1{font-size:22px;margin:0} p{color:#555;font-size:13px}
    table{width:100%;border-collapse:collapse;margin-top:16px} th,td{border:1px solid #999;padding:8px;font-size:14px;text-align:left}
    tfoot td{font-weight:800} .sign{margin-top:48px;display:flex;gap:40px} .sign div{flex:1;border-top:1px solid #111;padding-top:6px;font-size:13px;text-align:center}
    </style></head><body>
    <h1>Horas Extras — ${m}/${y}</h1><p>Gerado em ${new Date().toLocaleDateString('pt-BR')}</p>
    <table><thead><tr><th>#</th><th>Vendedora</th><th>Setor</th><th style="text-align:right">Extras</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="4">Sem registros no mês.</td></tr>'}</tbody>
    <tfoot><tr><td colspan="3">Total geral</td><td style="text-align:right">${r.total_extra_label}</td></tr></tfoot></table>
    <div class="sign"><div>Responsável</div><div>Conferência</div></div>
    <script>onload=()=>{print();}<\/script></body></html>`);
  w.document.close();
}

async function tabPontoFeriados(body) {
  const readOnly = store.user?.role === 'manager';
  body.innerHTML = `
    <div class="card">
      <p class="muted" style="font-size:13px;margin-top:0">🤖 Dias com saída geral ~13h são marcados <b>automaticamente</b> como feriado.${readOnly ? '' : ' Abaixo dá para adicionar manual ou remover se marcar errado.'}</p>
      ${readOnly ? '' : `<form id="fHol" class="row" style="flex-wrap:nowrap;align-items:end">
        <div style="flex:1"><label>Data</label><input type="date" id="hDate" required></div>
        <div style="flex:2"><label>Rótulo</label><input id="hLabel" placeholder="Ex: Natal" value="Feriado"></div>
        <button class="btn btn-primary" type="submit">Marcar</button>
      </form>`}
      <div id="hList" style="margin-top:12px"></div>
    </div>`;
  const loadHols = async () => {
    try {
      const { holidays } = await api('/api/ponto/feriados');
      $('#hList').innerHTML = holidays.length
        ? `<div>${compactListHTML(holidays, (h) => `<span class="chip" style="margin:0 6px 6px 0">${fmtDateBR(h.date)} • ${esc(h.label)}${readOnly ? '' : ` <button data-hdel="${h.date}" style="border:none;background:none;cursor:pointer;font-weight:800" title="Remover">×</button>`}</span>`, 12)}</div>`
        : '<div class="empty">Nenhum feriado marcado.</div>';
      bindCompactList($('#hList'));
      if (readOnly) return;
      $('#hList').onclick = async (e) => {
        const b = e.target.closest('[data-hdel]');
        if (!b) return;
        if (!confirm('Remover este feriado?')) return;
        await api(`/api/ponto/feriados/${b.dataset.hdel}`, { method: 'DELETE' });
        toast('Feriado removido.'); loadHols();
      };
    } catch (e) { $('#hList').innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  };
  const fHol = $('#fHol');
  if (fHol) fHol.onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('/api/ponto/feriados', { method: 'POST', body: JSON.stringify({ date: $('#hDate').value, label: $('#hLabel').value || 'Feriado' }) });
      toast('Feriado marcado!'); $('#hDate').value = ''; loadHols();
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
    <p class="muted" style="font-size:13px;margin:0 0 10px">Online: R$ 25,00 / R$ 12,50 • Presencial: R$ 35,00 / R$ 17,50 • ⭐ modelo especial: valor exclusivo.</p>
    <div class="mini-pills" id="commSector" style="margin-bottom:10px">
      <button data-s="" class="on">Todos</button>
      <button data-s="online">Online</button>
      <button data-s="presencial">Presencial</button>
    </div>
    <div class="card">
      <label>Mês</label><input type="month" id="cMonth" value="${t.slice(0, 7)}">
      <div style="height:10px"></div><button class="btn btn-primary" id="cGo">Ver mês</button>
      <div id="cBody" style="margin-top:12px"></div>
    </div>
    <h3 class="section-title">Pagamentos</h3>
    <div class="card"><div id="payList"><p class="muted">Carregando…</p></div></div>
    <div class="foot">Desenvolvido pela Wisionarium</div>`;
  let commSector = '';
  let commStore = store.user?.role === 'manager' ? String(store.user.store_id || '') : '';
  $('#commSector').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    commSector = b.dataset.s;
    $$('#commSector button').forEach((x) => x.classList.toggle('on', x === b));
    load();
  };
  const load = async () => {
    const month = $('#cMonth').value || t.slice(0, 7);
    const box = $('#cBody');
    box.innerHTML = '<p class="muted">Carregando…</p>';
    try {
      const s = await api(`/api/commissions/summary?month=${month}${commSector ? `&sector=${commSector}` : ''}${commStore ? `&store_id=${commStore}` : ''}`);
      box.innerHTML = `
        <p class="muted" style="font-size:13px">Mês: <b class="mono">${fmtBRL(s.total_month_cents)}</b> • Pendente geral: <b class="mono">${fmtBRL(s.total_pending_cents)}</b></p>
        ${compactListHTML(s.rows, (r) => `
          <div class="sale-card" style="padding:10px 12px"><div class="row" style="justify-content:space-between;align-items:center">
            <span><b>${esc(r.name)}</b> ${sectorTag(r.sector)}${r.store_name && r.store_name !== 'Sede' ? ` ${storeTag(r.store_name)}` : ''}${r.active ? '' : ' <span class="muted" style="font-size:12px">(inativa)</span>'}</span>
            <span class="mono" style="font-size:13px;font-weight:800">${fmtBRL(r.month_cents)}</span>
          </div>
          <div class="muted" style="font-size:13px;margin-top:2px">Pendente: <b class="mono">${fmtBRL(r.pending_cents)}</b></div>
          ${r.pending_cents > 0 ? `<div class="sale-foot" style="margin-top:4px"><button class="btn" data-pay="${r.seller_id}">Marcar como pago</button></div>` : ''}
          </div>`, 8)}
        <button class="btn btn-big" id="copyComm">Copiar resumo</button>`;
      bindCompactList(box);
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
    <h2 style="margin:6px 0">${esc(d.seller.name)} ${sectorTag(d.seller.sector)} ${storeTag(d.seller.store_name)}</h2>
    ${kpiCardsDetail(d.current, d.seller)}
    ${(d.byStore || []).length > 1 ? `
    <div class="card" style="margin-top:12px">
      <b>Por loja (mês)</b>
      <table><tbody>
        ${(d.byStore || []).map((b) => `<tr><td>${storeTag(b.store_name)}</td><td class="mono"><b>${fmtV(b.sales)}</b> vendas</td><td class="mono">${b.records} registro(s)</td></tr>`).join('')}
      </tbody></table>
    </div>` : ''}
    <div class="card" style="margin-top:12px">
      <b>Comparação com mês anterior</b>
      <table><thead><tr><th></th><th>Atual</th><th>Anterior</th><th>Δ</th></tr></thead><tbody>
        <tr><td>Vendas</td><td class="mono">${fmtV(d.current.salesCredit)}</td><td class="mono">${fmtV(d.compare.salesCredit)}</td><td class="${(d.deltas.sales ?? 0) >= 0 ? 'delta-up' : 'delta-down'}">${d.deltas.sales == null ? '—' : (d.deltas.sales >= 0 ? '↑ ' : '↓ ') + fmtPct(Math.abs(d.deltas.sales)).replace('%', '') + '%'}</td></tr>
        ${(d.seller.sector || 'online') === 'presencial' ? '' : `
        <tr><td>Chamadas</td><td class="mono">${fmtInt(d.current.calls)}</td><td class="mono">${fmtInt(d.compare.calls)}</td><td>${d.deltas.calls == null ? '—' : fmtPct(d.deltas.calls)}</td></tr>
        <tr><td>Conversão</td><td class="mono">${fmtPct(d.current.conversion)}</td><td class="mono">${fmtPct(d.compare.conversion)}</td><td>${d.deltas.conversion == null ? '—' : fmtPct(d.deltas.conversion)}</td></tr>`}
      </tbody></table>
    </div>
    <h3 class="section-title">Evolução diária (vendas)</h3>
    <div class="card">${d.daily.length ? d.daily.map((x) => `<div class="bar-row"><span>${fmtDateBR(x.date).slice(0, 5)}</span><div class="bar"><div style="width:${(x.sales / max) * 100}%"></div></div><b class="mono">${fmtV(x.sales)}</b></div>`).join('') : '<div class="empty">Sem vendas no período.</div>'}</div>
  `;
}

let reportSector = '';
let reportStore = '';
async function viewReport(app) {
  const t = todayISO();
  const isManager = store.user?.role === 'manager';
  if (isManager) reportStore = String(store.user.store_id || '');
  let stores = [];
  try { stores = (await api('/api/stores')).stores; } catch {}
  app.innerHTML = `<h2 style="margin:4px 0">Relatório do dia</h2><div class="card"><label>Data</label><input type="date" id="rDate" value="${t}" max="${t}">
    ${isManager ? '' : `<div class="mini-pills" id="repStore" style="margin-top:10px">
      <button data-st="" class="${!reportStore ? 'on' : ''}">Todas</button>
      ${stores.map((s) => `<button data-st="${s.id}" class="${String(reportStore) === String(s.id) ? 'on' : ''}">${esc(s.name)}</button>`).join('')}
    </div>`}
    <div class="mini-pills" id="repSector" style="margin-top:10px">
      <button data-s="" class="${!reportSector ? 'on' : ''}">Todos</button>
      <button data-s="online" class="${reportSector === 'online' ? 'on' : ''}">Online</button>
      <button data-s="presencial" class="${reportSector === 'presencial' ? 'on' : ''}">Presencial</button>
    </div>
    <div style="height:10px"></div><button class="btn btn-primary" id="rGo">Gerar</button></div><div id="rBody" style="margin-top:12px"></div>`;
  // filial é tudo presencial: sem pílulas Online/Presencial (só em Todas/Sede)
  const syncSectorPills = () => {
    let branch = false;
    if (isManager) branch = (store.user.store_name || 'Sede') !== 'Sede';
    else if (reportStore) {
      const s = stores.find((x) => String(x.id) === String(reportStore));
      branch = !!s && s.name !== 'Sede';
    }
    if (branch && reportSector) {
      reportSector = '';
      $$('#repSector button').forEach((x) => x.classList.toggle('on', x.dataset.s === ''));
    }
    const el = $('#repSector');
    if (el) el.style.display = branch ? 'none' : '';
  };
  const repStoreEl = $('#repStore');
  if (repStoreEl) repStoreEl.onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    reportStore = b.dataset.st;
    $$('#repStore button').forEach((x) => x.classList.toggle('on', x === b));
    syncSectorPills();
    load();
  };
  syncSectorPills();
  $('#repSector').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    reportSector = b.dataset.s;
    $$('#repSector button').forEach((x) => x.classList.toggle('on', x === b));
    load();
  };
  const load = async () => {
    const date = $('#rDate').value || t;
    const { summary, details, sector, store } = await api(`/api/report/daily?date=${date}${reportSector ? `&sector=${reportSector}` : ''}${reportStore ? `&store_id=${reportStore}` : ''}`);
    const saleLine = (s) => `• ${fmtV(s.credit)} ${s.product}${s.partners.length ? ' + ' + s.partners.join(', ') : ''}`;
    const sectorTitle = `${sector && sector !== 'all' ? ` (${sectorLabel(sector).toUpperCase()})` : ''}${store ? ` [${store.toUpperCase()}]` : ''}`;
    const msg =
      `*RELATÓRIO COMERCIAL${sectorTitle} - ${fmtDateBR(date)}*\n\nChamadas: ${fmtInt(summary.calls)}\nVendas: ${fmtInt(summary.records)}\nWhatsApp: ${fmtInt(summary.waRecords ?? 0)} | CRM: ${fmtInt(summary.crmRecords ?? 0)} | Presencial: ${fmtInt(summary.presRecords ?? 0)}` +
      details.map((d) => `\n\n*${d.name.toUpperCase()}${d.active ? '' : ' (INATIVA)'} - Vendas: ${fmtV(d.credit)} - Chamadas ${fmtInt(d.calls)}*` + (d.sales.length ? `\n${d.sales.map(saleLine).join('\n')}` : '')).join('');
    const waLink = (phone) => `https://wa.me/${phone ? phone.replace(/\D/g, '') : ''}?text=${encodeURIComponent(msg)}`;
    $('#rBody').innerHTML = `
      <div class="card">
        <h3 style="margin:0">Relatório comercial</h3>
        <p class="muted">Data: ${fmtDateBR(date)} • ordem alfabética</p>
        ${kpiCards(summary, '', true)}
        ${compactListHTML(details, (d) => `
          <div class="sale-card" style="padding:10px 12px">
            <div class="row" style="justify-content:space-between;align-items:center">
              <span><b>${esc(d.name)}</b> ${sectorTag(d.sector)}${d.active ? '' : ' <span class="muted" style="font-size:12px">(inativa)</span>'}</span>
              <span class="muted" style="font-size:13px">${fmtV(d.credit)} vendas • ${fmtInt(d.calls)} chamadas</span>
            </div>
            ${d.sales.length ? `<div style="margin-top:4px;font-size:13px">${d.sales.map((s) => `<div>• ${fmtV(s.credit)} ${esc(s.product)}${s.partners.length ? ' + ' + esc(s.partners.join(', ')) : ''} <b class="${s.channel === 'WhatsApp' ? 'ch-wa' : s.channel === 'Presencial' ? 'ch-pres' : 'ch-crm'}">${esc(s.channel)}</b>${s.store_name && s.store_name !== (d.store_name || 'Sede') ? ` ${storeTag(s.store_name)}` : ''}</div>`).join('')}</div>` : '<div class="muted" style="font-size:13px;margin-top:4px">Sem vendas neste dia.</div>'}
          </div>`, 5)}
        <label style="margin-top:14px">Número de destino (opcional, com DDI+DDD)</label>
        <input id="waPhone" inputmode="tel" placeholder="Ex: 5511999999999" value="${esc(localStorage.getItem('ec_wa_phone') || '')}">
        <div style="height:10px"></div>
        <a class="btn btn-green btn-big" id="waBtn" href="${waLink('')}" target="_blank" rel="noopener" style="display:block;text-align:center;text-decoration:none">Enviar relatório no WhatsApp</a>
        <button class="btn btn-big" id="copyBtn" style="margin-top:8px">Copiar mensagem</button>
        <button class="btn btn-ghost btn-big" id="prevBtn" style="margin-top:8px">Ver mensagem antes de enviar</button>
        <pre id="msgPrev" style="display:none;white-space:pre-wrap;font-size:13px;background:#f6f7f9;border:1px solid var(--line);border-radius:12px;padding:12px;margin-top:8px;font-family:inherit"></pre>
      </div>`;
    bindCompactList($('#rBody'));
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
  app.innerHTML = `<div class="row" style="justify-content:space-between;align-items:center"><h2>Equipe</h2><button class="btn btn-primary" id="add">+ Nova pessoa</button></div><div id="teamBody"><div class="card"><p class="muted">Carregando…</p></div></div>`;
  const load = async () => {
    try {
      const { users } = await api('/api/users');
    const people = users.filter((u) => u.role !== 'admin');
    const teamRow = (s) => `<tr><td><div class="row" style="align-items:center;gap:8px;flex-wrap:nowrap"><span class="ava sm">${s.avatar_url ? `<img src="${s.avatar_url}" alt="">` : esc((s.name || '?')[0].toUpperCase())}</span><span><b>${esc(s.name)}</b><br><span class="muted" style="font-size:12px">${esc(s.email)}</span></span></div></td>
      <td>${s.role === 'manager' ? '<span class="chip lime" style="font-size:10px">Gerente</span>' : s.role === 'staff' ? '<span class="chip" style="font-size:10px">Funcionário</span>' : `<span class="chip ${(s.sector || 'online') === 'presencial' ? 'crm' : 'wa'}">${(s.sector || 'online') === 'presencial' ? 'Presencial' : 'Online'}</span>`}<br>${storeTag(s.store_name)}</td>
      <td>${s.active ? '✅ Ativa' : '⏸️ Inativa'}</td>
      <td><button class="btn" data-edit="${s.id}">Editar</button> <button class="btn" data-toggle="${s.id}">${s.active ? 'Desativar' : 'Ativar'}</button></td></tr>`;
    const teamHead = '<table><thead><tr><th>Nome</th><th>Perfil / Loja</th><th>Status</th><th>Ações</th></tr></thead><tbody>';
    const teamRest = people.slice(8);
    $('#teamBody').innerHTML = people.length ? `<div class="card" style="padding:0;overflow:hidden">
      ${teamHead}${people.slice(0, 8).map(teamRow).join('')}</tbody></table>
      ${teamRest.length ? `<div data-rest style="display:none"><table><tbody>${teamRest.map(teamRow).join('')}</tbody></table></div>
      <div style="padding:10px"><button class="btn btn-ghost btn-big" data-more>Ver mais (${teamRest.length})</button></div>` : ''}
      </div>` : '<div class="card empty">Ninguém cadastrado.</div>';
    bindCompactList($('#teamBody'));
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

async function modalUser(u, reload) {
  let stores = [];
  try { stores = (await api('/api/stores')).stores; } catch {}
  const isSeller = !u || u.role === 'seller';
  $('#modalRoot').innerHTML = `
  <div class="modal-bg" id="mbg"><div class="modal">
    <h3 style="margin:0">${u ? (u.role === 'manager' ? 'Editar gerente' : u.role === 'staff' ? 'Editar funcionário' : 'Editar vendedora') : 'Nova pessoa'}</h3>
    <form id="fUser">
      <label>Nome *</label><input id="uName" required value="${esc(u?.name || '')}">
      <label>E-mail *</label><input id="uEmail" type="email" required value="${esc(u?.email || '')}">
      <label>${u ? 'Nova senha (opcional)' : 'Senha *'}</label><input id="uPass" type="password" ${u ? '' : 'required'} placeholder="mín. 4 caracteres">
      <label>Perfil *</label>
      <select id="uRole"><option value="seller" ${isSeller ? 'selected' : ''}>Vendedora</option><option value="manager" ${u?.role === 'manager' ? 'selected' : ''}>Gerente de loja</option><option value="staff" ${u?.role === 'staff' ? 'selected' : ''}>Funcionário (só ponto)</option></select>
      <div id="sellerFields" style="display:${isSeller ? 'block' : 'none'}">
        <label>Setor *</label>
        <select id="uSector"><option value="online" ${(u?.sector || 'online') === 'online' ? 'selected' : ''}>Online</option><option value="presencial" ${u?.sector === 'presencial' ? 'selected' : ''}>Presencial</option></select>
      </div>
      <label>Loja *</label>
      <select id="uStore">${stores.map((s) => `<option value="${s.id}" ${Number(u?.store_id) === Number(s.id) ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
      <p class="muted" id="mgrHint" style="font-size:12px;${u?.role === 'manager' ? '' : 'display:none'}">Gerente enxerga e gerencia apenas a própria loja.</p>
      <p class="muted" id="staffHint" style="font-size:12px;${u?.role === 'staff' ? '' : 'display:none'}">Funcionário só bate ponto e vê os próprios horários.</p>
      <div style="height:12px"></div>
      <button class="btn btn-primary btn-big" type="submit">Salvar</button>
      <button class="btn btn-ghost btn-big" type="button" id="cancel">Cancelar</button>
    </form>
  </div></div>`;
  $('#cancel').onclick = closeModal;
  $('#uRole').onchange = () => {
    const role = $('#uRole').value;
    $('#sellerFields').style.display = role === 'seller' ? 'block' : 'none';
    $('#mgrHint').style.display = role === 'manager' ? 'block' : 'none';
    $('#staffHint').style.display = role === 'staff' ? 'block' : 'none';
  };
  $('#fUser').onsubmit = async (e) => {
    e.preventDefault();
    try {
      const role = $('#uRole').value;
      const payload = {
        name: $('#uName').value.trim(), email: $('#uEmail').value.trim(), role,
        sector: role === 'seller' ? $('#uSector').value : 'online',
        store_id: Number($('#uStore').value),
        ...( $('#uPass').value ? { password: $('#uPass').value } : {}),
      };
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
  if (!location.hash) go(!store.user ? '#/login' : store.user.role === 'seller' ? '#/vendedora' : store.user.role === 'staff' ? '#/funcionario' : '#/admin');
  route();
})();
