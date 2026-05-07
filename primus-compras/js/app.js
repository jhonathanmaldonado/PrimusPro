// ============================================================================
// APP.JS — Orquestrador principal do app
// ============================================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";

import { firebaseConfig, WORKSPACE_ID } from './firebase-config.js';

// Inicializa Firebase ANTES de importar módulos que dependem dele
const app = initializeApp(firebaseConfig);
getAuth(app);

// Agora importa módulos que usam getFirestore()/getAuth()
import {
  login,
  logout,
  observarAuth,
  workspaceTemDono,
  criarWorkspaceEDono
} from './auth.js';

import {
  setUserContext,
  observarCategorias,
  observarItens,
  observarListaAtual,
  observarHistorico,
  criarItem,
  atualizarCampoListaAtual,
  setItemListaAtual,
  finalizarCompra,
  limparListaAtual,
  seedCatalogoSeVazio,
  deletarHistorico
} from './db.js';

// ============================================================================
// ESTADO LOCAL
// ============================================================================

let categorias = [];
let itens = [];
let listaAtualMap = {};
let historico = [];

let userCtx = null;
let collapsed = {};
let searchTerm = '';
let currentTab = 'lista';

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

function getEstadoLista(itemId) {
  return listaAtualMap[itemId] || { qtd: 0, preco: 0, comprado: false };
}

function subtotal(itemId) {
  const e = getEstadoLista(itemId);
  return (parseFloat(e.qtd) || 0) * (parseFloat(e.preco) || 0);
}

function categoriaTotal(catId) {
  return itens
    .filter(i => i.categoriaId === catId)
    .reduce((s, i) => s + subtotal(i.id), 0);
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
    showToast('✓ Conta criada! Fazendo login...', 'success');
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
    showToast('⚠ Perfil não encontrado. Contate o administrador.', 'error');
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

  mostrarApp();

  if (perfil.role === 'dono') {
    await ofertaSeedSeVazio();
  }

  iniciarListeners();
}

async function ofertaSeedSeVazio() {
  try {
    const resp = await fetch('../seed-catalog.json');
    if (!resp.ok) return;
    const seedData = await resp.json();
    const total = seedData.reduce((s, c) => s + c.itens.length, 0);

    if (confirm(
      `Importar catálogo inicial?\n\n` +
      `Vai importar ${seedData.length} categorias e ${total} itens.\n\n` +
      `Você pode editar tudo depois. Importar agora?`
    )) {
      const result = await seedCatalogoSeVazio(seedData);
      if (result.importado) {
        showToast(`✓ Importado: ${result.categorias} categorias, ${result.itens} itens`, 'success');
      } else {
        showToast('Catálogo já tem dados', '');
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
    renderLista();
  }));

  unsubsRefs.push(observarItens((its) => {
    itens = its;
    renderLista();
  }));

  unsubsRefs.push(observarListaAtual((lista) => {
    listaAtualMap = {};
    lista.forEach(i => { listaAtualMap[i.id] = i; });
    renderLista();
  }));

  unsubsRefs.push(observarHistorico((hist) => {
    historico = hist;
    if (currentTab === 'historico') renderHistorico();
  }));
}

// ============================================================================
// RENDER LISTA
// ============================================================================

function renderLista() {
  const el = $('list');
  if (!categorias.length) {
    el.innerHTML = '<div class="empty-msg">Carregando catálogo...</div>';
    renderResumo();
    return;
  }

  let html = '';
  let anyMatch = false;

  for (const cat of categorias) {
    const itensCat = itens
      .filter(i => i.categoriaId === cat.id)
      .filter(i => matchesSearch(i, searchTerm));

    if (searchTerm && itensCat.length === 0) continue;

    const todosItensCat = itens.filter(i => i.categoriaId === cat.id);
    if (!searchTerm && todosItensCat.length === 0) continue;

    anyMatch = true;
    const isCollapsed = collapsed[cat.id] && !searchTerm;
    const subtotalCat = categoriaTotal(cat.id);
    const withQty = todosItensCat.filter(i => (parseFloat(getEstadoLista(i.id).qtd) || 0) > 0).length;

    html += `<div class="section${isCollapsed ? ' collapsed' : ''}" data-cat="${cat.id}">`;
    html += `<div class="section-header" style="background:${escHtml(cat.cor)}" data-action="toggle-cat" data-cat-id="${cat.id}">`;
    html += `<div class="section-info">`;
    html += `<span class="section-toggle">▼</span>`;
    html += `<span>${escHtml(cat.nome)}</span>`;
    html += `<span class="badge-count">${searchTerm ? itensCat.length + ' / ' : ''}${todosItensCat.length} itens${withQty ? ' · ' + withQty + ' c/ qtd' : ''}</span>`;
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
      <th class="col-qtd">Qtd</th>
      <th class="col-preco">Preço unit.</th>
      <th class="col-subtotal">Subtotal</th>
      <th class="col-action"></th>
    </tr></thead><tbody>`;

    for (const item of itensCat) {
      const estado = getEstadoLista(item.id);
      const sub = subtotal(item.id);
      const doneCls = estado.comprado ? ' done' : '';

      html += `<tr class="item-row${doneCls}" data-item-id="${item.id}">`;
      html += `<td class="col-check"><input type="checkbox" class="check" ${estado.comprado ? 'checked' : ''} data-action="toggle-comprado" data-item-id="${item.id}" title="Marcar como comprado"></td>`;
      html += `<td class="col-item">${escHtml(item.nome)}</td>`;
      html += `<td class="col-tipo">${escHtml(item.tipo || '')}</td>`;
      html += `<td class="col-qtd"><input type="number" class="qty" min="0" step="0.01" value="${estado.qtd || ''}" placeholder="—" data-action="update-qtd" data-item-id="${item.id}"></td>`;
      html += `<td class="col-preco"><div class="price-wrap"><input type="number" class="price" min="0" step="0.01" value="${estado.preco || ''}" placeholder="0,00" data-action="update-preco" data-item-id="${item.id}"></div></td>`;
      html += `<td class="col-subtotal">${sub > 0 ? fmtMoeda(sub) : '—'}</td>`;
      html += `<td class="col-action"><div class="action-btns"><button class="icon-btn danger" data-action="remover-item" data-item-id="${item.id}" title="Remover do catálogo">×</button></div></td>`;
      html += `</tr>`;
    }
    html += `</tbody></table></div></div>`;
  }

  if (!anyMatch) {
    if (searchTerm) {
      html = `<div class="empty-msg">Nenhum item encontrado para "<strong>${escHtml(searchTerm)}</strong>"</div>`;
    } else {
      html = `<div class="empty-msg">Catálogo vazio. Adicione itens abaixo para começar.</div>`;
    }
  }

  el.innerHTML = html;
  renderResumo();
  $('search-clear').style.display = searchTerm ? 'block' : 'none';
}

function renderResumo() {
  let totalItens = 0, doneItens = 0, totalGeral = 0;
  for (const item of itens) {
    const e = getEstadoLista(item.id);
    if ((parseFloat(e.qtd) || 0) > 0) {
      totalItens++;
      if (e.comprado) doneItens++;
    }
    totalGeral += subtotal(item.id);
  }
  $('stat-items').textContent = totalItens;
  $('stat-done').textContent = doneItens + (totalItens > 0 ? ' / ' + totalItens : '');
  $('stat-total').textContent = fmtMoeda(totalGeral);
}

function popularSelectCategoria() {
  const sel = $('new-cat');
  const valorAtual = sel.value;
  sel.innerHTML = '';
  for (const cat of categorias) {
    const opt = document.createElement('option');
    opt.value = cat.id;
    opt.textContent = cat.nome;
    sel.appendChild(opt);
  }
  if (valorAtual) sel.value = valorAtual;
}

// ============================================================================
// HISTÓRICO
// ============================================================================

function renderHistorico() {
  const el = $('history-list');
  if (!historico.length) {
    el.innerHTML = `<div class="history-empty">📭 Nenhuma compra finalizada ainda.<br><br>Quando terminar uma lista, clique em <strong>"Finalizar compra"</strong> para arquivá-la aqui.</div>`;
    return;
  }
  let html = '<div class="section" style="border-color:var(--wine-soft)">';
  for (const h of historico) {
    const d = h.data && h.data.toDate ? h.data.toDate() : new Date(h.data);
    const dataStr = d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    html += `<div class="history-item">`;
    html += `<div class="history-info">`;
    html += `<div class="history-date">${dataStr}</div>`;
    html += `<div class="history-meta">${h.qtdItens || 0} itens · finalizado por ${escHtml(h.finalizadoPorNome || '?')}</div>`;
    html += `</div>`;
    html += `<div class="history-total">${fmtMoeda(h.total)}</div>`;
    html += `<div class="history-actions">`;
    html += `<button class="btn btn-sm" data-action="ver-compra" data-hist-id="${h.id}">👁 Ver</button>`;
    if (userCtx?.role === 'dono') {
      html += `<button class="btn btn-sm btn-ghost" data-action="excluir-compra" data-hist-id="${h.id}">🗑</button>`;
    }
    html += `</div></div>`;
  }
  html += '</div>';
  el.innerHTML = html;
}

function verCompra(id) {
  const h = historico.find(x => x.id === id);
  if (!h) return;
  const d = h.data && h.data.toDate ? h.data.toDate() : new Date(h.data);
  let txt = '🛒 COMPRA - ' + d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) + '\n';
  txt += `Finalizado por: ${h.finalizadoPorNome || '?'}\n`;
  txt += '─────────────────────────────\n\n';
  let lastCat = '';
  (h.itens || []).forEach(i => {
    if (i.categoriaNome !== lastCat) {
      txt += '\n■ ' + i.categoriaNome + '\n';
      lastCat = i.categoriaNome;
    }
    txt += '  • ' + i.nome + ' — ' + i.qtd + ' ' + (i.tipo || '');
    if (i.preco) txt += ' × ' + fmtMoeda(i.preco) + ' = ' + fmtMoeda(i.subtotal);
    txt += '\n';
  });
  txt += '\n─────────────────────────────\n';
  txt += 'TOTAL: ' + fmtMoeda(h.total) + '\n';
  alert(txt);
}

async function excluirCompraConfirm(id) {
  if (!confirm('Excluir esta compra do histórico? Esta ação não pode ser desfeita.')) return;
  try {
    await deletarHistorico(id);
    showToast('✓ Compra excluída', 'success');
  } catch (e) {
    showToast('⚠ Erro: ' + e.message, 'error');
  }
}

// ============================================================================
// AÇÕES DA LISTA
// ============================================================================

async function adicionarItem() {
  const nome = $('new-name').value.trim();
  const tipo = $('new-tipo').value.trim();
  const catId = $('new-cat').value;

  if (!nome) {
    showToast('Digite um nome para o produto');
    return;
  }
  if (!catId) {
    showToast('Selecione uma categoria');
    return;
  }

  const itensCat = itens.filter(i => i.categoriaId === catId);
  const proxOrdem = itensCat.length;

  try {
    await criarItem({ nome, tipo, categoriaId: catId, ordem: proxOrdem });
    $('new-name').value = '';
    $('new-tipo').value = '';
    $('new-name').focus();
    showToast(`✓ "${nome}" adicionado`, 'success');
  } catch (e) {
    showToast('⚠ Erro: ' + e.message, 'error');
  }
}

async function atualizarQtd(itemId, valor) {
  const v = parseFloat(valor) || 0;
  const estado = getEstadoLista(itemId);
  try {
    await setItemListaAtual(itemId, {
      qtd: v,
      preco: estado.preco || 0,
      comprado: estado.comprado || false
    });
  } catch (e) {
    showToast('⚠ Erro ao salvar: ' + e.message, 'error');
  }
}

async function atualizarPreco(itemId, valor) {
  const v = parseFloat(valor) || 0;
  const estado = getEstadoLista(itemId);
  try {
    await setItemListaAtual(itemId, {
      qtd: estado.qtd || 0,
      preco: v,
      comprado: estado.comprado || false
    });
  } catch (e) {
    showToast('⚠ Erro ao salvar: ' + e.message, 'error');
  }
}

async function toggleComprado(itemId, comprado) {
  const estado = getEstadoLista(itemId);
  try {
    await setItemListaAtual(itemId, {
      qtd: estado.qtd || 0,
      preco: estado.preco || 0,
      comprado: !!comprado
    });
  } catch (e) {
    showToast('⚠ Erro: ' + e.message, 'error');
  }
}

function toggleCat(catId) {
  collapsed[catId] = !collapsed[catId];
  renderLista();
}

function expandirOuRecolherTodas(expandir) {
  if (expandir) {
    collapsed = {};
  } else {
    categorias.forEach(c => collapsed[c.id] = true);
  }
  renderLista();
}

async function removerItem(itemId) {
  const item = itens.find(i => i.id === itemId);
  if (!item) return;
  if (!confirm(`Remover "${item.nome}" do catálogo? Esta ação não pode ser desfeita.`)) return;
  try {
    const { deletarItem } = await import('./db.js');
    await deletarItem(itemId);
    showToast('✓ Item removido', 'success');
  } catch (e) {
    showToast('⚠ Erro: ' + e.message, 'error');
  }
}

async function tratarLimparLista() {
  const total = Object.keys(listaAtualMap).length;
  if (total === 0) {
    showToast('Lista já está vazia');
    return;
  }
  if (!confirm(`Limpar todas as ${total} entradas (qtd, preço, comprado)?\n\nO catálogo de produtos é mantido.`)) return;
  try {
    await limparListaAtual();
    showToast('✓ Lista limpa', 'success');
  } catch (e) {
    showToast('⚠ Erro: ' + e.message, 'error');
  }
}

async function tratarFinalizarCompra() {
  const itensEnriquecidos = [];
  let total = 0;

  for (const item of itens) {
    const estado = getEstadoLista(item.id);
    if ((parseFloat(estado.qtd) || 0) <= 0) continue;
    const cat = categorias.find(c => c.id === item.categoriaId);
    const sub = subtotal(item.id);
    itensEnriquecidos.push({
      itemId: item.id,
      nome: item.nome,
      tipo: item.tipo || '',
      categoriaId: item.categoriaId,
      categoriaNome: cat?.nome || '?',
      categoriaCor: cat?.cor || '#7A1F38',
      qtd: parseFloat(estado.qtd) || 0,
      preco: parseFloat(estado.preco) || 0,
      subtotal: sub,
      comprado: !!estado.comprado,
      fornecedor: item.fornecedorPreferido || ''
    });
    total += sub;
  }

  if (!itensEnriquecidos.length) {
    showToast('⚠ Nenhum item com quantidade na lista', 'error');
    return;
  }

  if (!confirm(
    `Finalizar compra com ${itensEnriquecidos.length} itens (${fmtMoeda(total)})?\n\n` +
    `A lista atual será arquivada no histórico e os campos de quantidade/preço/comprado serão limpos.`
  )) return;

  try {
    await finalizarCompra(itensEnriquecidos, total);
    showToast('✓ Compra arquivada no histórico', 'success');
  } catch (e) {
    showToast('⚠ Erro: ' + e.message, 'error');
    console.error(e);
  }
}

// ============================================================================
// TABS
// ============================================================================

function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tab);
  });
  $('tab-lista').style.display = tab === 'lista' ? 'block' : 'none';
  $('tab-historico').style.display = tab === 'historico' ? 'block' : 'none';
  if (tab === 'historico') renderHistorico();
}

// ============================================================================
// EVENTOS
// ============================================================================

function setupEventos() {
  $('btn-login').addEventListener('click', tratarLogin);
  $('login-pin').addEventListener('keydown', e => { if (e.key === 'Enter') tratarLogin(); });
  $('login-username').addEventListener('keydown', e => {
    if (e.key === 'Enter') $('login-pin').focus();
  });

  $('goto-criar').addEventListener('click', () => {
    $('form-login').style.display = 'none';
    $('form-criar').style.display = 'block';
  });
  $('goto-login').addEventListener('click', () => {
    $('form-criar').style.display = 'none';
    $('form-login').style.display = 'block';
  });
  $('btn-criar').addEventListener('click', tratarCriarWorkspace);
  $('criar-pin').addEventListener('keydown', e => { if (e.key === 'Enter') tratarCriarWorkspace(); });

  $('user-chip').addEventListener('click', tratarLogout);

  document.querySelectorAll('.tab').forEach(t => {
    t.addEventListener('click', () => switchTab(t.dataset.tab));
  });

  $('btn-recolher').addEventListener('click', () => expandirOuRecolherTodas(false));
  $('btn-expandir').addEventListener('click', () => expandirOuRecolherTodas(true));
  $('btn-limpar').addEventListener('click', tratarLimparLista);
  $('btn-finalizar').addEventListener('click', tratarFinalizarCompra);
  $('btn-add-item').addEventListener('click', adicionarItem);

  ['new-name', 'new-tipo'].forEach(id => {
    $(id).addEventListener('keydown', e => { if (e.key === 'Enter') adicionarItem(); });
  });

  $('search').addEventListener('input', e => {
    searchTerm = e.target.value.trim();
    renderLista();
  });
  $('search-clear').addEventListener('click', () => {
    $('search').value = '';
    searchTerm = '';
    renderLista();
  });

  $('list').addEventListener('change', e => {
    const action = e.target.dataset.action;
    const itemId = e.target.dataset.itemId;
    if (!action || !itemId) return;
    if (action === 'update-qtd') atualizarQtd(itemId, e.target.value);
    else if (action === 'update-preco') atualizarPreco(itemId, e.target.value);
    else if (action === 'toggle-comprado') toggleComprado(itemId, e.target.checked);
  });
  $('list').addEventListener('click', e => {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    if (action === 'toggle-cat') toggleCat(target.dataset.catId);
    else if (action === 'remover-item') removerItem(target.dataset.itemId);
  });

  $('history-list').addEventListener('click', e => {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    if (target.dataset.action === 'ver-compra') verCompra(target.dataset.histId);
    else if (target.dataset.action === 'excluir-compra') excluirCompraConfirm(target.dataset.histId);
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if ($('search').value) {
        $('search').value = '';
        searchTerm = '';
        renderLista();
      }
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'f' && currentTab === 'lista') {
      e.preventDefault();
      $('search').focus();
      $('search').select();
    }
  });

  ['login-pin', 'criar-pin'].forEach(id => {
    $(id).addEventListener('input', e => {
      e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4);
    });
  });
}

// ============================================================================
// INICIALIZAÇÃO
// ============================================================================

function init() {
  setupEventos();
  mostrarSplash();

  observarAuth(estado => {
    if (!estado) {
      userCtx = null;
      setUserContext(null);
      mostrarLogin();
    } else {
      onLogado(estado);
    }
  });
}

init();
