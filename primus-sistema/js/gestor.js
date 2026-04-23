// ===== GESTOR — PRIMUS =====
// Painel do gestor: navegação entre módulos.

import { exigirPerfil, logout, listarUsuarios } from './auth.js';
import { listarContagens, excluirContagem } from './db.js';
import { BEBIDAS, SORVETES, slugify } from './produtos.js';
import { inicializarDashboard, recarregarDashboard } from './dashboard.js';
import { inicializarVendas } from './vendas.js';
import { inicializarUsuarios } from './usuarios.js';
import { inicializarCompras } from './compras.js';
import { inicializarAuditoria } from './auditoria.js';

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
}

// ===== CARREGADORES DE MÓDULO =====
// (carregam apenas na primeira visita pra economizar leituras do Firestore)
let dashboardCarregado = false;
let vendasCarregado = false;
let usuariosCarregado = false;
let comprasCarregado = false;
let auditoriaCarregado = false;

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
    renderizarContagens();
  } catch (e) {
    console.error(e);
    lista.innerHTML = `<div class="empty-state">
      <div class="empty-icon">⚠️</div>
      <h3>Erro ao carregar contagens</h3>
      <p>${e.message}</p>
    </div>`;
  }
}

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

  lista.innerHTML = arr.map(c => {
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
  }).join('');
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
    // Remove do cache local e re-renderiza
    contagensCache = contagensCache.filter(x => x.id !== id);
    renderizarContagens();
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

window.verDetalheContagem = function(id) {
  const c = contagensCache.find(x => x.id === id);
  if (!c) return;
  mostrarModalContagem(c);
};

function mostrarModalContagem(c) {
  const modal = document.getElementById('modal-contagem');
  const body  = document.getElementById('modal-body');
  const tipoLabel = { ini: 'Bebidas Início', fin: 'Bebidas Final', sorv: 'Sorvetes e Embalagens' };

  // Buscar nomes dos produtos a partir dos IDs
  const lista = c.tipo === 'sorv' ? SORVETES : BEBIDAS;
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
