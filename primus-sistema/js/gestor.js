// ===== GESTOR — PRIMUS =====
// Painel do gestor: navegação entre módulos.

import { exigirPerfil, logout, listarUsuarios } from './auth.js';
import { listarContagens, excluirContagem } from './db.js';
import { slugify } from './produtos.js';
import { obterBebidas, obterSorvetes } from './produtos-store.js';
import { inicializarDashboard, recarregarDashboard } from './dashboard.js';
import { inicializarVendas } from './vendas.js';
import { inicializarUsuarios } from './usuarios.js';
import { inicializarCompras } from './compras.js';
import { inicializarAuditoria } from './auditoria.js';
import { inicializarCatalogo } from './catalogo.js';

const sessao = exigirPerfil(['gestor']);
if (!sessao) throw new Error('sem sessão');

// ===== HEADER DO USUÁRIO =====
function iniciais(nome) {
  return nome.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
}
document.getElementById('user-avatar').textContent = iniciais(sessao.nome);
document.getElementById('user-name').textContent = sessao.nome;
document.getElementById('user-perfil').textContent = sessao.perfil;

const userChip = document.getElementById('user-chip');
const userMenu = document.getElementById('user-menu');
userChip.onclick = e => { e.stopPropagation(); userMenu.classList.toggle('open'); };
document.addEventListener('click', () => userMenu.classList.remove('open'));
document.getElementById('btn-logout').onclick = logout;

// ===== NAVEGAÇÃO ENTRE VIEWS =====
const views = {
  'dashboard': { titulo: 'Dashboard', icon: '📊' },
  'contagens': { titulo: 'Contagens do Estoque', icon: '📋' },
  'auditoria': { titulo: 'Auditoria', icon: '🔍' },
  'compras':   { titulo: 'Lista de Compras', icon: '🛒' },
  'vendas':    { titulo: 'Vendas & Vendedores', icon: '💰' },
  'catalogo':  { titulo: 'Catálogo de Produtos', icon: '📦' },
  'usuarios':  { titulo: 'Usuários', icon: '👥' },
};

function mostrarView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.side-nav button').forEach(b => b.classList.remove('active'));
  const view = document.getElementById('view-' + id);
  const btn  = document.getElementById('nav-' + id);
  if (view) view.classList.add('active');
  if (btn)  btn.classList.add('active');
  if (views[id]) {
    document.getElementById('view-title').textContent = views[id].titulo;
    document.getElementById('view-icon').textContent = views[id].icon;
  }
  // Fechar menu mobile
  document.getElementById('side-nav').classList.remove('mobile-open');
  // Carregadores específicos
  if (id === 'contagens') carregarContagens();
  if (id === 'usuarios')  carregarUsuariosTab();
  if (id === 'dashboard') carregarDashboard();
  if (id === 'vendas')    carregarVendas();
  if (id === 'compras')   carregarComprasTab();
  if (id === 'auditoria') carregarAuditoriaTab();
  if (id === 'catalogo')  carregarCatalogoTab();
}

// ===== CARREGADORES DE MÓDULO =====
// (carregam apenas na primeira visita pra economizar leituras do Firestore)
let dashboardCarregado = false;
let vendasCarregado = false;
let usuariosCarregado = false;
let comprasCarregado = false;
let auditoriaCarregado = false;
let catalogoCarregado = false;

async function carregarDashboard() {
  if (window._dashboardPrecisaRecarregar) {
    window._dashboardPrecisaRecarregar = false;
    await recarregarDashboard();
    return;
  }
  if (dashboardCarregado) return;
  dashboardCarregado = true;
  await inicializarDashboard();
}

async function carregarVendas() {
  if (vendasCarregado) return;
  vendasCarregado = true;
  await inicializarVendas();
}

async function carregarUsuariosTab() {
  if (usuariosCarregado) return;
  usuariosCarregado = true;
  await inicializarUsuarios();
}

async function carregarComprasTab() {
  if (comprasCarregado) return;
  comprasCarregado = true;
  await inicializarCompras();
}

async function carregarAuditoriaTab() {
  if (auditoriaCarregado) return;
  auditoriaCarregado = true;
  await inicializarAuditoria();
}

async function carregarCatalogoTab() {
  if (catalogoCarregado) return;
  catalogoCarregado = true;
  await inicializarCatalogo();
}

Object.keys(views).forEach(id => {
  const btn = document.getElementById('nav-' + id);
  if (btn) btn.onclick = () => mostrarView(id);
});

// Abre o dashboard por padrão
mostrarView('dashboard');

// Menu mobile
document.getElementById('btn-menu-mobile').onclick = () => {
  document.getElementById('side-nav').classList.toggle('mobile-open');
};

// ===== ABA: CONTAGENS =====
// Mostra todas as contagens salvas, com filtro por tipo e data

let contagensCache = [];

async function carregarContagens() {
  const lista = document.getElementById('contagens-lista');
  lista.innerHTML = '<div style="text-align:center;padding:40px"><span class="spinner"></span> Carregando contagens...</div>';
  try {
    contagensCache = await listarContagens({ limite: 200 });
    renderCalendarioContagens();
  } catch (e) {
    console.error(e);
    lista.innerHTML = `<div class="empty-state">
      <div class="empty-icon">⚠️</div>
      <h3>Erro ao carregar contagens</h3>
      <p>${e.message}</p>
    </div>`;
  }
}

// ===== CALENDÁRIO DE CONTAGENS (visão do gestor) =====
// Mostra um mês com ícones do que foi feito por dia (🌅 início, 🌙 final, 🍨 sorvete).
// Clicar no dia abre os cards daquele dia logo abaixo (com Ver detalhes / Excluir).
let calContagemMes = null;   // Date do 1º dia do mês exibido
let diaContagemSel = null;   // 'YYYY-MM-DD' selecionado

const TIPO_ICON_CAL = { ini: '🌅', fin: '🌙', sorv: '🍨' };

function injetarCssCalContagem() {
  if (document.getElementById('ccal-style')) return;
  const s = document.createElement('style');
  s.id = 'ccal-style';
  s.textContent = `
.ccal-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:14px;flex-wrap:wrap}
.ccal-mes{font-family:'Raleway',sans-serif;font-weight:800;font-size:1.15rem;color:var(--vinho,#7C0047)}
.ccal-nav{display:flex;gap:8px}
.ccal-nav button{border:1px solid #e4d6dd;background:#fff;border-radius:10px;padding:6px 12px;font-weight:700;color:var(--vinho,#7C0047);cursor:pointer;font-size:.85rem}
.ccal-nav button:hover{background:#fbeef4}
.ccal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:6px}
.ccal-dow{text-align:center;font-size:.68rem;font-weight:700;letter-spacing:.03em;color:#9a8c93;padding:4px 0}
.ccal-cell{position:relative;min-height:64px;border-radius:10px;border:1px solid #ececec;background:#fafafa;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:4px 2px}
.ccal-cell.off{background:transparent;border:none}
.ccal-cell.vazia .ccal-dnum{color:#bcbcbc;font-weight:600}
.ccal-cell.tem{background:#e8f6ed;border:1.5px solid #93d4a8;cursor:pointer;transition:transform .08s,box-shadow .08s}
.ccal-cell.tem:hover{transform:translateY(-1px);box-shadow:0 3px 10px rgba(31,122,61,.18)}
.ccal-cell.sel{outline:3px solid var(--amarelo,#FAB900);outline-offset:1px}
.ccal-cell.tem .ccal-dnum{color:#1c7a3d;font-weight:800}
.ccal-dnum{font-family:'DM Mono',monospace;font-size:1rem;line-height:1}
.ccal-icons{margin-top:4px;font-size:.82rem;letter-spacing:1px;line-height:1}
.ccal-legenda{display:flex;flex-wrap:wrap;gap:14px;align-items:center;margin-top:14px;font-size:.78rem;color:#7a6a72}
.ccal-dia-titulo{font-family:'Raleway',sans-serif;font-weight:800;color:var(--vinho,#7C0047);margin:18px 0 10px;font-size:1rem}
@media(max-width:520px){.ccal-cell{min-height:54px}.ccal-dnum{font-size:.9rem}.ccal-icons{font-size:.72rem}}
`;
  document.head.appendChild(s);
}

function renderCalendarioContagens() {
  injetarCssCalContagem();

  // Esconde a barra de filtros — o calendário a substitui
  const barra = document.querySelector('#view-contagens .filtros-bar');
  if (barra) barra.style.display = 'none';

  const lista = document.getElementById('contagens-lista');
  lista.classList.remove('contagens-grid'); // evita o grid de cards atrapalhar o calendário
  lista.innerHTML = `
    <div class="ccal-head">
      <div class="ccal-mes" id="ccal-mes-label">—</div>
      <div class="ccal-nav">
        <button id="ccal-prev">◀ Anterior</button>
        <button id="ccal-next">Próximo ▶</button>
      </div>
    </div>
    <div id="ccal-grid" class="ccal-grid"></div>
    <div class="ccal-legenda">
      <span>🌅 Início</span><span>🌙 Final</span><span>🍨 Sorvetes</span>
      <span>· clique num dia para ver os detalhes</span>
    </div>
    <div id="contagens-do-dia"></div>
  `;

  document.getElementById('ccal-prev').onclick = () => navegarMesContagem(-1);
  document.getElementById('ccal-next').onclick = () => navegarMesContagem(1);

  if (!calContagemMes) {
    // abre no mês da contagem mais recente (ou mês atual se não houver)
    const maisRecente = contagensCache[0]?.data;
    const base = maisRecente ? new Date(maisRecente + 'T00:00:00') : new Date();
    calContagemMes = new Date(base.getFullYear(), base.getMonth(), 1);
  }
  renderGradeContagem();
}

function navegarMesContagem(delta) {
  if (!calContagemMes) return;
  calContagemMes = new Date(calContagemMes.getFullYear(), calContagemMes.getMonth() + delta, 1);
  diaContagemSel = null;
  document.getElementById('contagens-do-dia').innerHTML = '';
  renderGradeContagem();
}

function renderGradeContagem() {
  const ano = calContagemMes.getFullYear();
  const mes = calContagemMes.getMonth();
  const prefixo = `${ano}-${String(mes + 1).padStart(2, '0')}`;

  document.getElementById('ccal-mes-label').textContent =
    new Date(ano, mes, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
      .replace(/^./, c => c.toUpperCase());

  // Agrupa tipos presentes por dia
  const tiposPorDia = {};
  contagensCache.forEach(c => {
    if (!c.data || !c.data.startsWith(prefixo)) return;
    (tiposPorDia[c.data] = tiposPorDia[c.data] || new Set()).add(c.tipo);
  });

  const primeiroDow = new Date(ano, mes, 1).getDay();
  const diasNoMes = new Date(ano, mes + 1, 0).getDate();
  const dows = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];
  let html = dows.map(d => `<div class="ccal-dow">${d}</div>`).join('');

  for (let i = 0; i < primeiroDow; i++) html += `<div class="ccal-cell off"></div>`;

  for (let d = 1; d <= diasNoMes; d++) {
    const data = `${prefixo}-${String(d).padStart(2, '0')}`;
    const tipos = tiposPorDia[data];
    if (tipos && tipos.size) {
      const icons = ['ini', 'fin', 'sorv'].filter(t => tipos.has(t)).map(t => TIPO_ICON_CAL[t]).join(' ');
      const sel = data === diaContagemSel ? ' sel' : '';
      html += `
        <div class="ccal-cell tem${sel}" onclick="__selDiaContagem('${data}')" title="${formatarDataPtBr(data)}">
          <span class="ccal-dnum">${d}</span>
          <span class="ccal-icons">${icons}</span>
        </div>`;
    } else {
      html += `<div class="ccal-cell vazia"><span class="ccal-dnum">${d}</span></div>`;
    }
  }

  document.getElementById('ccal-grid').innerHTML = html;
}

window.__selDiaContagem = function(data) {
  diaContagemSel = data;
  renderGradeContagem(); // re-render pra marcar o dia selecionado
  const alvo = document.getElementById('contagens-do-dia');
  const doDia = contagensCache.filter(c => c.data === data);
  if (!doDia.length) { alvo.innerHTML = ''; return; }
  alvo.innerHTML = `
    <div class="ccal-dia-titulo">📋 Contagens de ${formatarDataPtBr(data)}</div>
    <div class="contagens-grid">${doDia.map(cardContagemHTML).join('')}</div>
  `;
};

function renderizarContagens() {
  const lista = document.getElementById('contagens-lista');
  const filtroTipo = document.getElementById('filtro-tipo')?.value || '';
  const filtroData = document.getElementById('filtro-data')?.value || '';

  let arr = contagensCache;
  if (filtroTipo) arr = arr.filter(c => c.tipo === filtroTipo);
  if (filtroData) arr = arr.filter(c => c.data === filtroData);

  if (!arr.length) {
    lista.innerHTML = `<div class="empty-state">
      <div class="empty-icon">📋</div>
      <h3>Nenhuma contagem encontrada</h3>
      <p>Quando os barmen e gerentes salvarem contagens, elas aparecem aqui.</p>
    </div>`;
    return;
  }

  const tipoLabel = { ini: 'Bebidas Início', fin: 'Bebidas Final', sorv: 'Sorvetes' };
  const tipoIcon  = { ini: '🌅', fin: '🌙', sorv: '🍨' };

  lista.innerHTML = arr.map(cardContagemHTML).join('');
}

// Template de um card de contagem (reusado na lista e no calendário/dia)
function cardContagemHTML(c) {
  const tipoLabel = { ini: 'Bebidas Início', fin: 'Bebidas Final', sorv: 'Sorvetes' };
  const tipoIcon  = { ini: '🌅', fin: '🌙', sorv: '🍨' };
  const qtdItens = Object.keys(c.itens || {}).length;
  const dataFmt = formatarDataPtBr(c.data);
  const hora = c.criadoEm?.toDate ? formatarHora(c.criadoEm.toDate()) : '';
  return `
      <div class="contagem-card" data-id="${c.id}">
        <div class="contagem-card-head">
          <div class="contagem-tipo-badge ${c.tipo}">
            ${tipoIcon[c.tipo]} ${tipoLabel[c.tipo] || c.tipo}
          </div>
          <div class="contagem-data">${dataFmt}</div>
        </div>
        <div class="contagem-body">
          <div class="contagem-autor">
            <div class="autor-avatar">${iniciais(c.autorNome || '?')}</div>
            <div>
              <div class="autor-nome">${c.autorNome || 'Sem nome'}</div>
              <div class="autor-perfil">${c.autorPerfil || ''} ${hora ? '· ' + hora : ''}</div>
            </div>
          </div>
          <div class="contagem-stats">
            <div class="stat">
              <div class="stat-num">${qtdItens}</div>
              <div class="stat-label">itens</div>
            </div>
          </div>
        </div>
        <div class="contagem-acoes">
          <button class="btn btn-ghost btn-ver" onclick="verDetalheContagem('${c.id}')" style="flex:1">
            Ver detalhes →
          </button>
          <button class="btn btn-danger btn-sm" onclick="excluirContagemConf('${c.id}')" title="Excluir contagem">
            🗑️
          </button>
        </div>
      </div>`;
}

window.excluirContagemConf = async function(id) {
  const c = contagensCache.find(x => x.id === id);
  if (!c) return;
  const tipoLabel = { ini: 'Bebidas Início', fin: 'Bebidas Final', sorv: 'Sorvetes' };
  const msg = `Excluir a contagem de ${tipoLabel[c.tipo]} de ${formatarDataPtBr(c.data)} feita por ${c.autorNome}?\n\n⚠️ Essa ação é permanente e não pode ser desfeita.`;
  if (!confirm(msg)) return;
  // Confirmação dupla
  if (!confirm('Tem certeza absoluta? Os dados vão ser apagados para sempre.')) return;

  try {
    await excluirContagem(id);
    mostrarToastGlobal(`Contagem excluída.`, 'ok');
    // Remove do cache local e re-renderiza o calendário (e o dia aberto, se houver)
    contagensCache = contagensCache.filter(x => x.id !== id);
    renderGradeContagem();
    if (diaContagemSel) window.__selDiaContagem(diaContagemSel);
  } catch (e) {
    console.error(e);
    mostrarToastGlobal('Erro ao excluir: ' + e.message, 'err');
  }
};

function mostrarToastGlobal(msg, tipo = '') {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'toast show ' + tipo;
  setTimeout(() => t.className = 'toast', 2800);
}

window.verDetalheContagem = async function(id) {
  const c = contagensCache.find(x => x.id === id);
  if (!c) return;
  await mostrarModalContagem(c);
};

async function mostrarModalContagem(c) {
  const modal = document.getElementById('modal-contagem');
  const body  = document.getElementById('modal-body');
  const tipoLabel = { ini: 'Bebidas Início', fin: 'Bebidas Final', sorv: 'Sorvetes e Embalagens' };

  // Buscar nomes dos produtos a partir dos IDs (catálogo efetivo, incluindo
  // ocultos — pode ser uma contagem antiga de produto que foi descontinuado)
  const lista = c.tipo === 'sorv'
    ? await obterSorvetes({ incluirOcultos: true })
    : await obterBebidas({ incluirOcultos: true });
  const mapaNomes = {};
  lista.forEach(p => { mapaNomes[slugify(p.nome)] = p.nome; });

  // Para sorvetes, temos sufixos __ini e __fin
  const linhas = Object.entries(c.itens || {}).map(([id, v]) => {
    let nome = mapaNomes[id] || id;
    let contexto = '';
    if (id.endsWith('__ini')) {
      nome = mapaNomes[id.replace('__ini', '')] || id;
      contexto = '<span class="sub-ini">início</span>';
    } else if (id.endsWith('__fin')) {
      nome = mapaNomes[id.replace('__fin', '')] || id;
      contexto = '<span class="sub-fin">final</span>';
    }
    const cols = [];
    if (v.fr != null)     cols.push(`<span>Freezer: <b>${v.fr}</b></span>`);
    if (v.est != null)    cols.push(`<span>Estoque: <b>${v.est}</b></span>`);
    if (v.total != null)  cols.push(`<span>Total: <b>${v.total}</b></span>`);
    if (v.rec != null && v.rec !== 0) cols.push(`<span>Recebido: <b>${v.rec}</b></span>`);
    if (v.qtd != null)    cols.push(`<span>Qtd: <b>${v.qtd}</b></span>`);
    if (v.abast != null)  cols.push(`<span>Abast.: <b>${v.abast}</b></span>`);
    if (v.final != null)  cols.push(`<span>Final: <b>${v.final}</b></span>`);
    if (v.vendeu != null) cols.push(`<span>Vendeu: <b>${v.vendeu}</b></span>`);
    const obs = v.obs ? `<div class="item-obs">💬 ${v.obs}</div>` : '';
    return `
      <div class="item-detalhe">
        <div class="item-detalhe-head">
          <span class="item-nome">${nome}</span> ${contexto}
        </div>
        <div class="item-valores">${cols.join('')}</div>
        ${obs}
      </div>`;
  }).join('');

  body.innerHTML = `
    <div class="modal-head">
      <div>
        <h3>${tipoLabel[c.tipo] || c.tipo}</h3>
        <p>${formatarDataPtBr(c.data)} · por ${c.autorNome}</p>
      </div>
    </div>
    <div class="items-detalhe">${linhas || '<div class="text-muted text-center" style="padding:20px">Sem itens</div>'}</div>
  `;
  modal.classList.add('open');
}

document.getElementById('modal-close').onclick = () => {
  document.getElementById('modal-contagem').classList.remove('open');
};
document.getElementById('modal-contagem').onclick = e => {
  if (e.target.id === 'modal-contagem') {
    document.getElementById('modal-contagem').classList.remove('open');
  }
};

// Filtros
document.getElementById('filtro-tipo').onchange = renderizarContagens;
document.getElementById('filtro-data').onchange = renderizarContagens;
document.getElementById('btn-limpar-filtros').onclick = () => {
  document.getElementById('filtro-tipo').value = '';
  document.getElementById('filtro-data').value = '';
  renderizarContagens();
};

// ===== UTILS =====
function formatarDataPtBr(yyyymmdd) {
  if (!yyyymmdd) return '—';
  const [y, m, d] = yyyymmdd.split('-');
  return `${d}/${m}/${y}`;
}
function formatarHora(date) {
  return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}
