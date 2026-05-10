// ============================================================================
// APP.JS — Orquestrador principal (com botão de Reimprimir)
// ============================================================================

import './firebase-init.js';

import {
  login,
  logout,
  observarAuth,
  workspaceTemDono,
  criarWorkspaceEDono,
  criarMembro
} from './auth.js';

import {
  setUserContext,
  observarCategorias,
  observarItens,
  observarListaEmCriacao,
  observarListaAtual,
  observarHistorico,
  observarFornecedores,
  observarUsuarios,
  criarItem,
  atualizarItem,
  deletarItem,
  criarFornecedor,
  atualizarFornecedor,
  deletarFornecedor,
  deletarUsuario,
  setItemListaEmCriacao,
  limparListaEmCriacao,
  salvarListaParaAtual,
  atualizarPrecoListaAtual,
  atualizarCompradoListaAtual,
  atualizarQtdListaAtual,
  removerItemListaAtual,
  finalizarCompra,
  deletarHistorico,
  seedCatalogoSeVazio,
  calcularMediaPrecos,
  getConfigMediaN,
  setConfigMediaN
} from './db.js';

// ============================================================================
// ESTADO LOCAL
// ============================================================================

let categorias = [];
let itens = [];
let fornecedores = [];
let usuarios = [];
let listaEmCriacaoMap = {};
let listaAtualMap = {};
let historico = [];

let userCtx = null;
let collapsedCriar = {};
let collapsedAtual = {};
let searchCriar = '';
let searchAtual = '';
let searchFornecedores = '';
let currentTab = 'criar';
let mediaN = 5;

let unsubsRefs = [];

// ============================================================================
// HELPERS
// ============================================================================

const $ = (id) => document.getElementById(id);

function fmtMoeda(v) {
  const n = parseFloat(v) || 0;
  return 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function escHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showToast(msg, tipo = '') {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast show ' + tipo;
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => t.classList.remove('show'), 2600);
}

function matchesSearch(item, term) {
  if (!term) return true;
  const t = term.toLowerCase();
  return (item.nome || '').toLowerCase().includes(t)
      || (item.tipo || '').toLowerCase().includes(t)
      || (item.fornecedorPreferido || '').toLowerCase().includes(t);
}

// ============================================================================
// AUTH FLOW
// ============================================================================

function mostrarSplash() {
  $('splash').classList.remove('hidden');
  $('auth-screen').style.display = 'none';
  $('app-main').style.display = 'none';
}

function esconderSplash() {
  $('splash').classList.add('hidden');
  setTimeout(() => $('splash').style.display = 'none', 300);
}

function mostrarLogin() {
  esconderSplash();
  $('auth-screen').style.display = 'flex';
  $('app-main').style.display = 'none';
  $('form-login').style.display = 'block';
  $('form-criar').style.display = 'none';

  workspaceTemDono().then(temDono => {
    $('link-criar-workspace').style.display = temDono ? 'none' : 'block';
  }).catch(() => {
    $('link-criar-workspace').style.display = 'block';
  });
}

function mostrarApp() {
  esconderSplash();
  $('auth-screen').style.display = 'none';
  $('app-main').style.display = 'block';
}

async function tratarLogin() {
  const username = $('login-username').value.trim();
  const pin = $('login-pin').value.trim();
  const err = $('login-error');
  err.classList.remove('show');
  err.textContent = '';

  const btn = $('btn-login');
  btn.disabled = true;
  btn.textContent = 'Entrando...';

  try {
    await login(username, pin);
  } catch (e) {
    err.textContent = e.message || 'Erro ao fazer login';
    err.classList.add('show');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Entrar';
  }
}

async function tratarCriarWorkspace() {
  const adminCode = $('criar-admin-code').value.trim();
  const nome = $('criar-nome').value.trim();
  const username = $('criar-username').value.trim();
  const pin = $('criar-pin').value.trim();
  const err = $('criar-error');
  err.classList.remove('show');
  err.textContent = '';

  if (!nome) {
    err.textContent = 'Informe seu nome';
    err.classList.add('show');
    return;
  }

  const btn = $('btn-criar');
  btn.disabled = true;
  btn.textContent = 'Criando...';

  try {
    await criarWorkspaceEDono({
      adminCode,
      nomeWorkspace: 'Peixaria Primus',
      nome,
      username,
      pin
    });
    showToast('✓ Conta criada!', 'success');
    setTimeout(() => location.reload(), 800);
  } catch (e) {
    err.textContent = e.message || 'Erro ao criar conta';
    err.classList.add('show');
    btn.disabled = false;
    btn.textContent = 'Criar conta de dono';
  }
}

async function tratarLogout() {
  if (!confirm('Sair da conta?')) return;
  unsubsRefs.forEach(u => u && u());
  unsubsRefs = [];
  await logout();
}

async function onLogado({ user, perfil }) {
  if (!perfil) {
    showToast('⚠ Perfil não encontrado.', 'error');
    await logout();
    return;
  }

  userCtx = {
    uid: user.uid,
    nome: perfil.nome,
    username: perfil.username,
    role: perfil.role
  };
  setUserContext(userCtx);

  $('user-name').textContent = perfil.nome;
  $('user-role').textContent = perfil.role === 'dono' ? 'Dono' : 'Membro';
  $('user-avatar').textContent = (perfil.nome || '?').charAt(0).toUpperCase();

  $('tab-btn-equipe').style.display = perfil.role === 'dono' ? 'inline-block' : 'none';

  mostrarApp();

  try {
    mediaN = await getConfigMediaN();
    $('media-n').value = mediaN;
  } catch (e) {
    console.error('Erro carregando config média:', e);
  }

  if (perfil.role === 'dono') {
    await ofertaSeedSeVazio();
  }

  iniciarListeners();
}

async function ofertaSeedSeVazio() {
  try {
    const resp = await fetch('seed-catalog.json');
    if (!resp.ok) return;
    const seedData = await resp.json();
    const total = seedData.reduce((s, c) => s + c.itens.length, 0);

    if (confirm(
      `Importar catálogo inicial?\n\n` +
      `Vai importar ${seedData.length} categorias e ${total} itens.\n\n` +
      `Importar agora?`
    )) {
      const result = await seedCatalogoSeVazio(seedData);
      if (result.importado) {
        showToast(`✓ Importado: ${result.categorias} categorias, ${result.itens} itens`, 'success');
      }
    }
  } catch (e) {
    console.error('Erro ao oferecer seed:', e);
  }
}

// ============================================================================
// LISTENERS EM TEMPO REAL
// ============================================================================

function iniciarListeners() {
  unsubsRefs.push(observarCategorias((cats) => {
    categorias = cats;
    popularSelectCategoria();
    renderTudo();
  }));

  unsubsRefs.push(observarItens((its) => {
    itens = its;
    renderTudo();
  }));

  unsubsRefs.push(observarListaEmCriacao((lista) => {
    listaEmCriacaoMap = {};
    lista.forEach(i => { listaEmCriacaoMap[i.id] = i; });
    renderListaCriar();
  }));

  unsubsRefs.push(observarListaAtual((lista) => {
    listaAtualMap = {};
    lista.forEach(i => { listaAtualMap[i.id] = i; });
    renderListaAtual();
  }));

  unsubsRefs.push(observarHistorico((hist) => {
    historico = hist;
    if (currentTab === 'historico') renderHistorico();
  }));

  unsubsRefs.push(observarFornecedores((forn) => {
    fornecedores = forn;
    popularSelectFornecedor();
    if (currentTab === 'fornecedores') renderFornecedores();
  }));

  unsubsRefs.push(observarUsuarios((users) => {
    usuarios = users;
    if (currentTab === 'equipe') renderEquipe();
  }));
}

function renderTudo() {
  renderListaCriar();
  renderListaAtual();
}

// ============================================================================
// RENDER: ABA CRIAR LISTA
// ============================================================================

function getQtdEmCriacao(itemId) {
  return parseFloat(listaEmCriacaoMap[itemId]?.qtd || 0);
}

function temListaAtualAtiva() {
  return Object.keys(listaAtualMap).length > 0;
}

function renderListaCriar() {
  const el = $('list-criar');
  if (!categorias.length) {
    el.innerHTML = '<div class="empty-msg">Carregando catálogo...</div>';
    renderResumoCriar();
    return;
  }

  let html = '';

  if (temListaAtualAtiva()) {
    html += `<div class="alerta-bloqueio">
      ⚠️ <span><strong>Atenção:</strong> Você tem uma <strong>Lista Atual</strong> em andamento. Finalize-a antes de salvar uma nova lista.</span>
    </div>`;
  }

  let anyMatch = false;

  for (const cat of categorias) {
    const itensCat = itens
      .filter(i => i.categoriaId === cat.id)
      .filter(i => matchesSearch(i, searchCriar))
      .sort((a, b) => (a.ordem || 0) - (b.ordem || 0));

    if (searchCriar && itensCat.length === 0) continue;

    const todosItensCat = itens.filter(i => i.categoriaId === cat.id);
    if (!searchCriar && todosItensCat.length === 0) continue;

    anyMatch = true;
    const isCollapsed = collapsedCriar[cat.id] && !searchCriar;
    const withQty = todosItensCat.filter(i => getQtdEmCriacao(i.id) > 0).length;

    html += `<div class="section${isCollapsed ? ' collapsed' : ''}" data-cat="${cat.id}">`;
    html += `<div class="section-header" style="background:${escHtml(cat.cor)}" data-action="toggle-cat-criar" data-cat-id="${cat.id}">`;
    html += `<div class="section-info">`;
    html += `<span class="section-toggle">▼</span>`;
    html += `<span>${escHtml(cat.nome)}</span>`;
    html += `<span class="badge-count">${searchCriar ? itensCat.length + ' / ' : ''}${todosItensCat.length} itens${withQty ? ' · ' + withQty + ' c/ qtd' : ''}</span>`;
    html += `</div>`;
    html += `</div>`;

    html += `<div class="section-body"><table>`;
    html += `<thead><tr>
      <th class="col-item">Item</th>
      <th class="col-tipo">Tipo</th>
      <th class="col-media">Méd. ${mediaN}</th>
      <th class="col-ultimo">Última</th>
      <th class="col-qtd">Qtd</th>
      <th class="col-actions"></th>
    </tr></thead><tbody>`;

    for (const item of itensCat) {
      const qtd = getQtdEmCriacao(item.id);
      const media = calcularMediaPrecos(item, mediaN);
      const ultimo = item.ultimoPreco;

      html += `<tr data-item-id="${item.id}">`;
      html += `<td class="col-item">${escHtml(item.nome)}</td>`;
      html += `<td class="col-tipo">${escHtml(item.tipo || '')}</td>`;
      html += `<td class="col-media">${media ? `<span class="has-value">${fmtMoeda(media)}</span>` : `<span class="no-value">—</span>`}</td>`;
      html += `<td class="col-ultimo">${ultimo ? `<span class="has-value">${fmtMoeda(ultimo)}</span>` : `<span class="no-value">—</span>`}</td>`;
      html += `<td class="col-qtd"><input type="number" inputmode="decimal" class="qty" min="0" step="0.01" value="${qtd || ''}" placeholder="—" data-action="update-qtd-criar" data-item-id="${item.id}"></td>`;
      html += `<td class="col-actions"><span class="item-actions">`;
      html += `<button class="icon-btn edit" data-action="editar-item" data-item-id="${item.id}" title="Editar item">✏️</button>`;
      html += `<button class="icon-btn danger" data-action="remover-item" data-item-id="${item.id}" title="Remover do catálogo">×</button>`;
      html += `</span></td>`;
      html += `</tr>`;
    }
    html += `</tbody></table></div></div>`;
  }

  if (!anyMatch) {
    if (searchCriar) {
      html = `<div class="empty-msg">Nenhum item encontrado para "<strong>${escHtml(searchCriar)}</strong>"</div>`;
    } else {
      html = `<div class="empty-msg">Catálogo vazio. Adicione itens abaixo para começar.</div>`;
    }
  }

  el.innerHTML = html;
  renderResumoCriar();
  $('search-criar-clear').style.display = searchCriar ? 'block' : 'none';
}

function renderResumoCriar() {
  let totalItens = 0;
  let totalEstimado = 0;
  for (const item of itens) {
    const qtd = getQtdEmCriacao(item.id);
    if (qtd > 0) {
      totalItens++;
      const media = calcularMediaPrecos(item, mediaN) || item.ultimoPreco || 0;
      totalEstimado += qtd * media;
    }
  }
  $('stat-criar-items').textContent = totalItens;
  $('stat-criar-total').textContent = fmtMoeda(totalEstimado);
}

// ============================================================================
// RENDER: ABA LISTA ATUAL
// ============================================================================

function renderListaAtual() {
  const el = $('list-atual');

  if (!Object.keys(listaAtualMap).length) {
    el.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">🛒</div>
      <div class="empty-state-text">Nenhuma lista em andamento.<br>Crie uma na aba <strong>"Criar Lista"</strong> e salve para começar.</div>
    </div>`;
    renderResumoAtual();
    return;
  }

  let html = '';
  let anyMatch = false;

  for (const cat of categorias) {
    const itensNaListaAtual = itens
      .filter(i => i.categoriaId === cat.id)
      .filter(i => listaAtualMap[i.id])
      .filter(i => matchesSearch(i, searchAtual))
      .sort((a, b) => (a.ordem || 0) - (b.ordem || 0));

    if (itensNaListaAtual.length === 0) continue;

    anyMatch = true;
    const isCollapsed = collapsedAtual[cat.id] && !searchAtual;
    const subtotalCat = itensNaListaAtual.reduce((s, i) => {
      const e = listaAtualMap[i.id];
      return s + (parseFloat(e.qtd) || 0) * (parseFloat(e.preco) || 0);
    }, 0);

    html += `<div class="section${isCollapsed ? ' collapsed' : ''}">`;
    html += `<div class="section-header" style="background:${escHtml(cat.cor)}" data-action="toggle-cat-atual" data-cat-id="${cat.id}">`;
    html += `<div class="section-info">`;
    html += `<span class="section-toggle">▼</span>`;
    html += `<span>${escHtml(cat.nome)}</span>`;
    html += `<span class="badge-count">${itensNaListaAtual.length} itens</span>`;
    html += `</div>`;
    if (subtotalCat > 0) {
      html += `<span class="cat-subtotal">${fmtMoeda(subtotalCat)}</span>`;
    }
    html += `</div>`;

    html += `<div class="section-body"><table>`;
    html += `<thead><tr>
      <th class="col-check"></th>
      <th class="col-item">Item</th>
      <th class="col-tipo">Tipo</th>
      <th class="col-media">Méd. ${mediaN}</th>
      <th class="col-ultimo">Última</th>
      <th class="col-qtd">Qtd</th>
      <th class="col-pago">Preço pago</th>
      <th class="col-subtotal">Subtotal</th>
      <th class="col-actions"></th>
    </tr></thead><tbody>`;

    for (const item of itensNaListaAtual) {
      const estado = listaAtualMap[item.id];
      const qtd = parseFloat(estado.qtd) || 0;
      const preco = parseFloat(estado.preco) || 0;
      const sub = qtd * preco;
      const comprado = !!estado.comprado;
      const doneCls = comprado ? ' done' : '';
      const media = calcularMediaPrecos(item, mediaN);
      const ultimo = item.ultimoPreco;

      html += `<tr class="item-row${doneCls}" data-item-id="${item.id}">`;
      html += `<td class="col-check"><input type="checkbox" class="check" ${comprado ? 'checked' : ''} data-action="toggle-comprado" data-item-id="${item.id}"></td>`;
      html += `<td class="col-item">${escHtml(item.nome)}</td>`;
      html += `<td class="col-tipo">${escHtml(item.tipo || '')}</td>`;
      html += `<td class="col-media">${media ? `<span class="has-value">${fmtMoeda(media)}</span>` : `<span class="no-value">—</span>`}</td>`;
      html += `<td class="col-ultimo">${ultimo ? `<span class="has-value">${fmtMoeda(ultimo)}</span>` : `<span class="no-value">—</span>`}</td>`;
      html += `<td class="col-qtd"><input type="number" inputmode="decimal" class="qty" min="0" step="0.01" value="${qtd || ''}" data-action="update-qtd-atual" data-item-id="${item.id}"></td>`;
      html += `<td class="col-pago"><div class="price-wrap"><input type="number" inputmode="decimal" class="price" min="0" step="0.01" value="${preco || ''}" placeholder="0,00" data-action="update-preco-atual" data-item-id="${item.id}"></div></td>`;
      html += `<td class="col-subtotal">${sub > 0 ? fmtMoeda(sub) : '—'}</td>`;
      html += `<td class="col-actions"><span class="item-actions">`;
      html += `<button class="icon-btn edit" data-action="editar-item" data-item-id="${item.id}" title="Editar item">✏️</button>`;
      html += `<button class="icon-btn danger" data-action="remover-da-atual" data-item-id="${item.id}" title="Remover desta compra">×</button>`;
      html += `</span></td>`;
      html += `</tr>`;
    }
    html += `</tbody></table></div></div>`;
  }

  if (!anyMatch && searchAtual) {
    html = `<div class="empty-msg">Nenhum item encontrado para "<strong>${escHtml(searchAtual)}</stron
