// ============================================================================
// APP.JS — Orquestrador principal
// Fase 1 Precificação: aba Cardápio + CRUD de insumos + vínculo item->insumo
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
  observarInsumos,
  observarListaEmCriacao,
  observarListaAtual,
  observarHistorico,
  observarFornecedores,
  observarUsuarios,
  observarFichas,
  criarCategoria,
  atualizarCategoria,
  deletarCategoria,
  criarItem,
  atualizarItem,
  deletarItem,
  criarInsumo,
  atualizarInsumo,
  deletarInsumo,
  criarFornecedor,
  atualizarFornecedor,
  deletarFornecedor,
  criarFicha,
  atualizarFicha,
  deletarFicha,
  deletarUsuario,
  setItemListaEmCriacao,
  limparListaEmCriacao,
  salvarListaParaAtual,
  atualizarPrecoListaAtual,
  atualizarCompradoListaAtual,
  atualizarQtdListaAtual,
  removerItemListaAtual,
  adicionarItemListaAtual,
  finalizarCompra,
  deletarHistorico,
  seedCatalogoSeVazio,
  calcularMediaPrecos,
  getConfigMediaN,
  setConfigMediaN,
  getConfigPrecificacao,
  setConfigPrecificacao,
  calcularCustoIngrediente,
  calcularCustoReceita,
  calcularCustoPorPorcao,
  calcularNumeroPorcoes,
  calcularCMV,
  calcularPrecoSugerido,
  obterCMVAlvoEfetivo
} from './db.js';

// ============================================================================
// ESTADO LOCAL
// ============================================================================

let categorias = [];
let itens = [];
let insumos = [];
let fichas = [];
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
let searchAddAtual = '';
let searchInsumos = '';
let searchFichas = '';
let filtroFichas = 'todas';  // todas | pratos | pp
let currentTab = 'criar';
let currentSubTabCardapio = 'insumos';
let mediaN = 5;

// Categoria modal
let catEditandoId = null;
let catCorSelecionada = '#7A1F38';

// Insumo modal
let insumoEditandoId = null;

// Ficha modal (Sub-fase 2A)
let fichaEditandoId = null;
let fichaEmEdicao = null;  // ficha sendo editada/criada (em memória, antes de salvar)

// Config precificação
let configPrecificacao = { metodo: 'cmv_alvo', cmvAlvo: 0.30, markupFator: 3.0, margemAlvo: 0.70 };

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

  try {
    configPrecificacao = await getConfigPrecificacao();
    aplicarConfigPrecificacaoUI();
  } catch (e) {
    console.error('Erro carregando config precificação:', e);
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
    popularDatalistCategoriasInsumo();
    renderTudo();
    if ($('modal-categorias').classList.contains('show')) renderListaCategoriasModal();
  }));

  unsubsRefs.push(observarItens((its) => {
    itens = its;
    renderTudo();
    if ($('modal-add-atual').classList.contains('show')) renderResultadosAddAtual();
    if ($('modal-categorias').classList.contains('show')) renderListaCategoriasModal();
  }));

  unsubsRefs.push(observarInsumos((ins) => {
    insumos = ins;
    popularSelectInsumo();
    if (currentTab === 'cardapio' && currentSubTabCardapio === 'insumos') renderInsumos();
    if (currentTab === 'cardapio' && currentSubTabCardapio === 'relatorio') renderRelatorioFichas();
    // Se modal de ficha está aberto, recalcular (preço do insumo pode ter mudado)
    if ($('modal-ficha').classList.contains('show')) {
      renderIngredientesModal();
      atualizarPainelPrecificacao();
    }
  }));

  unsubsRefs.push(observarFichas((fs) => {
    fichas = fs;
    if (currentTab === 'cardapio' && currentSubTabCardapio === 'fichas') renderFichas();
    if (currentTab === 'cardapio' && currentSubTabCardapio === 'relatorio') renderRelatorioFichas();
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
    if ($('modal-add-atual').classList.contains('show')) renderResultadosAddAtual();
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
      html += `<td class="col-item">${escHtml(item.nome)}${item.insumoId ? ' <span style="font-size:9px;background:var(--gold);color:var(--wine);padding:1px 4px;border-radius:4px;font-weight:700" title="Vinculado a um insumo">🔗</span>' : ''}</td>`;
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
      html += `<td class="col-item">${escHtml(item.nome)}${item.insumoId ? ' <span style="font-size:9px;background:var(--gold);color:var(--wine);padding:1px 4px;border-radius:4px;font-weight:700" title="Vinculado a um insumo">🔗</span>' : ''}</td>`;
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
    html = `<div class="empty-msg">Nenhum item encontrado para "<strong>${escHtml(searchAtual)}</strong>"</div>`;
  }

  el.innerHTML = html;
  renderResumoAtual();
  $('search-atual-clear').style.display = searchAtual ? 'block' : 'none';
}

function renderResumoAtual() {
  let totalItens = 0, doneItens = 0, totalGeral = 0;
  for (const itemId in listaAtualMap) {
    const e = listaAtualMap[itemId];
    totalItens++;
    if (e.comprado) doneItens++;
    totalGeral += (parseFloat(e.qtd) || 0) * (parseFloat(e.preco) || 0);
  }
  $('stat-atual-items').textContent = totalItens;
  $('stat-atual-done').textContent = doneItens + (totalItens > 0 ? ' / ' + totalItens : '');
  $('stat-atual-total').textContent = fmtMoeda(totalGeral);
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

  const selEdit = $('edit-categoria');
  selEdit.innerHTML = '';
  for (const cat of categorias) {
    const opt = document.createElement('option');
    opt.value = cat.id;
    opt.textContent = cat.nome;
    selEdit.appendChild(opt);
  }

  const selAddAtual = $('add-atual-cat');
  if (selAddAtual) {
    const valorAdd = selAddAtual.value;
    selAddAtual.innerHTML = '';
    for (const cat of categorias) {
      const opt = document.createElement('option');
      opt.value = cat.id;
      opt.textContent = cat.nome;
      selAddAtual.appendChild(opt);
    }
    if (valorAdd) selAddAtual.value = valorAdd;
  }
}

function popularDatalistCategoriasInsumo() {
  const dl = $('datalist-cat-insumo');
  if (!dl) return;
  dl.innerHTML = '';
  for (const cat of categorias) {
    const opt = document.createElement('option');
    opt.value = cat.nome;
    dl.appendChild(opt);
  }
}

function popularSelectFornecedor() {
  const sel = $('edit-fornecedor-select');
  const valorAtual = sel.value;
  sel.innerHTML = `<option value="">— Nenhum —</option>`;
  for (const f of fornecedores) {
    const opt = document.createElement('option');
    opt.value = f.nome;
    opt.textContent = f.nome;
    sel.appendChild(opt);
  }
  const optNovo = document.createElement('option');
  optNovo.value = '__novo__';
  optNovo.textContent = '+ Novo fornecedor...';
  sel.appendChild(optNovo);

  if (valorAtual) sel.value = valorAtual;
}

function popularSelectInsumo() {
  const sel = $('edit-insumo-select');
  if (!sel) return;
  const valorAtual = sel.value;
  sel.innerHTML = `<option value="">— Não vinculado —</option>`;
  const insumosOrdenados = [...insumos].sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));
  for (const ins of insumosOrdenados) {
    const opt = document.createElement('option');
    opt.value = ins.id;
    opt.textContent = `${ins.nome} (${ins.unidade || 'KG'})`;
    sel.appendChild(opt);
  }
  if (valorAtual) sel.value = valorAtual;
}

// ============================================================================
// GERENCIAR CATEGORIAS (modal)
// ============================================================================

function abrirModalCategorias() {
  resetarFormularioCategoria();
  $('modal-categorias').classList.add('show');
  renderListaCategoriasModal();
  setTimeout(() => $('cat-nome').focus(), 100);
}

function fecharModalCategorias() {
  $('modal-categorias').classList.remove('show');
  catEditandoId = null;
}

function resetarFormularioCategoria() {
  catEditandoId = null;
  catCorSelecionada = '#7A1F38';
  $('cat-edit-id').value = '';
  $('cat-nome').value = '';
  $('cat-form-titulo').textContent = '+ Nova categoria';
  $('btn-cat-salvar').textContent = '+ Criar categoria';
  $('btn-cat-cancelar').style.display = 'none';
  $('cat-error').classList.remove('show');
  $('cat-error').textContent = '';
  atualizarCoresSelecionada();
}

function atualizarCoresSelecionada() {
  const opts = document.querySelectorAll('#cat-color-palette .color-option');
  opts.forEach(o => {
    o.classList.toggle('selected', o.dataset.cor === catCorSelecionada);
  });
}

function renderListaCategoriasModal() {
  const el = $('cats-list');
  if (!categorias.length) {
    el.innerHTML = '<div style="padding:14px;text-align:center;color:var(--muted);font-size:12px">Nenhuma categoria cadastrada.</div>';
    return;
  }
  let html = '';
  for (const cat of categorias) {
    const qtdItens = itens.filter(i => i.categoriaId === cat.id).length;
    html += `<div class="cat-card">`;
    html += `<div class="cat-card-color" style="background:${escHtml(cat.cor)}"></div>`;
    html += `<div class="cat-card-info">`;
    html += `<div class="cat-card-name">${escHtml(cat.nome)}</div>`;
    html += `<div class="cat-card-meta">${qtdItens} item(ns)</div>`;
    html += `</div>`;
    html += `<span class="item-actions">`;
    html += `<button class="icon-btn edit" data-action="editar-cat" data-cat-id="${cat.id}" title="Editar">✏️</button>`;
    html += `<button class="icon-btn danger" data-action="remover-cat" data-cat-id="${cat.id}" title="Remover">×</button>`;
    html += `</span>`;
    html += `</div>`;
  }
  el.innerHTML = html;
}

function editarCategoria(catId) {
  const cat = categorias.find(c => c.id === catId);
  if (!cat) return;

  catEditandoId = catId;
  catCorSelecionada = cat.cor || '#7A1F38';
  $('cat-edit-id').value = catId;
  $('cat-nome').value = cat.nome;
  $('cat-form-titulo').textContent = '✏️ Editar categoria';
  $('btn-cat-salvar').textContent = '💾 Salvar alterações';
  $('btn-cat-cancelar').style.display = 'inline-block';
  $('cat-error').classList.remove('show');
  atualizarCoresSelecionada();
  $('cat-nome').focus();
}

async function salvarCategoria() {
  const nome = $('cat-nome').value.trim();
  const err = $('cat-error');

  if (!nome) {
    err.textContent = 'Nome da categoria é obrigatório';
    err.classList.add('show');
    return;
  }

  const dup = categorias.find(c =>
    c.nome.toLowerCase() === nome.toLowerCase() && c.id !== catEditandoId
  );
  if (dup) {
    err.textContent = 'Já existe uma categoria com esse nome';
    err.classList.add('show');
    return;
  }

  err.classList.remove('show');
  const btn = $('btn-cat-salvar');
  btn.disabled = true;
  btn.textContent = 'Salvando...';

  try {
    if (catEditandoId) {
      await atualizarCategoria(catEditandoId, { nome, cor: catCorSelecionada });
      showToast(`✓ "${nome}" atualizada`, 'success');
    } else {
      const proxOrdem = categorias.length;
      await criarCategoria({ nome, cor: catCorSelecionada, ordem: proxOrdem });
      showToast(`✓ "${nome}" criada`, 'success');
    }
    resetarFormularioCategoria();
  } catch (e) {
    err.textContent = 'Erro: ' + e.message;
    err.classList.add('show');
  } finally {
    btn.disabled = false;
  }
}

async function removerCategoria(catId) {
  const cat = categorias.find(c => c.id === catId);
  if (!cat) return;

  const itensCat = itens.filter(i => i.categoriaId === catId);
  if (itensCat.length > 0) {
    if (!confirm(`Esta categoria tem ${itensCat.length} item(ns) vinculado(s).\n\nPara remover, primeiro mova ou exclua os itens dela.\n\nDeseja ver os itens dessa categoria na aba "Criar Lista"?`)) return;
    fecharModalCategorias();
    showToast(`⚠ Categoria "${cat.nome}" tem ${itensCat.length} item(ns) vinculado(s)`, 'error');
    return;
  }

  if (!confirm(`Remover a categoria "${cat.nome}"?`)) return;

  try {
    await deletarCategoria(catId);
    showToast(`✓ "${cat.nome}" removida`, 'success');
  } catch (e) {
    showToast('⚠ Erro: ' + e.message, 'error');
  }
}

// ============================================================================
// ABA CARDÁPIO - SUB-NAVEGAÇÃO
// ============================================================================

function switchSubTabCardapio(sub) {
  currentSubTabCardapio = sub;
  document.querySelectorAll('.sub-nav-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.subtab === sub);
  });
  $('subtab-insumos').style.display = sub === 'insumos' ? 'block' : 'none';
  $('subtab-fichas').style.display = sub === 'fichas' ? 'block' : 'none';
  $('subtab-relatorio').style.display = sub === 'relatorio' ? 'block' : 'none';
  $('subtab-precificacao').style.display = sub === 'precificacao' ? 'block' : 'none';
  $('subtab-config').style.display = sub === 'config' ? 'block' : 'none';

  if (sub === 'insumos') renderInsumos();
  if (sub === 'fichas') renderFichas();
  if (sub === 'relatorio') renderRelatorioFichas();
  if (sub === 'config') aplicarConfigPrecificacaoUI();
}

// ============================================================================
// FICHAS TÉCNICAS - render + modal completo (Sub-fase 2A)
// ============================================================================

function renderFichas() {
  const el = $('list-fichas');
  $('stat-fichas-total').textContent = fichas.length;
  const pratos = fichas.filter(f => !f.ehPrePreparo).length;
  const pp = fichas.filter(f => f.ehPrePreparo).length;
  $('stat-fichas-pratos').textContent = pratos;
  $('stat-fichas-pp').textContent = pp;

  let filtradas = fichas;
  if (filtroFichas === 'pratos') filtradas = filtradas.filter(f => !f.ehPrePreparo);
  if (filtroFichas === 'pp') filtradas = filtradas.filter(f => f.ehPrePreparo);

  if (searchFichas) {
    const t = searchFichas.toLowerCase();
    filtradas = filtradas.filter(f => (f.nome || '').toLowerCase().includes(t));
  }

  if (!fichas.length) {
    el.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">📋</div>
      <div class="empty-state-text">Nenhuma ficha técnica cadastrada.<br>Clique em <strong>"+ Nova Ficha"</strong> para começar.</div>
    </div>`;
    return;
  }

  if (!filtradas.length) {
    el.innerHTML = `<div class="empty-msg">Nenhuma ficha encontrada${searchFichas ? ' para "<strong>' + escHtml(searchFichas) + '</strong>"' : ''}</div>`;
    $('search-fichas-clear').style.display = searchFichas ? 'block' : 'none';
    return;
  }

  let html = '';
  for (const ficha of filtradas) {
    const custoReceita = calcularCustoReceita(ficha, insumos);
    const custoPorcao = calcularCustoPorPorcao(ficha, insumos);
    const cmv = calcularCMV(ficha, insumos);
    const cmvAlvo = obterCMVAlvoEfetivo(ficha, configPrecificacao);
    const precoSugerido = calcularPrecoSugerido(ficha, insumos, configPrecificacao);

    const badgePP = ficha.ehPrePreparo ? `<span class="insumo-badge pp">PRÉ-PREPARO</span>` : '';
    const nIngredientes = (ficha.ingredientes || []).length;

    // Cor do CMV
    let corCMV = 'var(--muted)';
    let textoCMV = '—';
    if (cmv !== null) {
      const pct = cmv * 100;
      textoCMV = pct.toFixed(1) + '%';
      const ratio = cmv / cmvAlvo;
      if (ratio < 0.80) corCMV = '#173404';      // verde
      else if (ratio < 1.0) corCMV = '#854F0B';   // amarelo
      else if (ratio < 1.2) corCMV = '#633806';   // âmbar
      else corCMV = '#791F1F';                    // vermelho
    }

    html += `<div class="ficha-card">`;
    html += `<div class="ficha-card-info">`;
    html += `<div class="ficha-card-nome">${escHtml(ficha.nome)} ${badgePP}</div>`;

    // Meta: rendimento + número de porções (se aplicável)
    const nPorcoes = calcularNumeroPorcoes(ficha);
    const unidade = ficha.unidadeRendimento || 'KG';
    let metaTxt = `Rende ${ficha.rendimento} ${escHtml(unidade)}`;
    if (unidade !== 'PORCOES') {
      const tam = parseFloat(ficha.tamanhoPorcao);
      if (!isNaN(tam) && tam > 0) {
        const nFmt = nPorcoes >= 10 ? Math.round(nPorcoes) : (Math.round(nPorcoes * 10) / 10);
        metaTxt += ` ≈ ${nFmt} porções`;
      } else {
        metaTxt += ` ⚠ tamanho da porção não definido`;
      }
    }
    html += `<div class="ficha-card-meta">${metaTxt} · ${nIngredientes} ingrediente(s)</div>`;

    html += `<div class="ficha-card-stats">`;
    html += `<span class="ficha-card-stat">Receita: <strong>${fmtMoeda(custoReceita)}</strong></span>`;
    html += `<span class="ficha-card-stat">Porção: <strong>${fmtMoeda(custoPorcao)}</strong></span>`;
    if (precoSugerido > 0) {
      html += `<span class="ficha-card-stat">Sugerido: <strong>${fmtMoeda(precoSugerido)}</strong></span>`;
    }
    html += `</div>`;
    html += `</div>`;
    html += `<div class="ficha-card-cmv" style="color:${corCMV}">CMV<br>${textoCMV}</div>`;
    html += `<span class="item-actions">`;
    html += `<button class="icon-btn" data-action="imprimir-ficha" data-ficha-id="${ficha.id}" title="Imprimir ficha" style="color:#7A1F38">📄</button>`;
    html += `<button class="icon-btn edit" data-action="editar-ficha" data-ficha-id="${ficha.id}" title="Editar">✏️</button>`;
    html += `<button class="icon-btn danger" data-action="remover-ficha" data-ficha-id="${ficha.id}" title="Remover">×</button>`;
    html += `</span>`;
    html += `</div>`;
  }

  el.innerHTML = html;
  $('search-fichas-clear').style.display = searchFichas ? 'block' : 'none';
}

// --- MODAL: abre/edita/cria ---

function abrirModalFicha(fichaId = null) {
  fichaEditandoId = fichaId;

  if (fichaId) {
    const f = fichas.find(x => x.id === fichaId);
    if (!f) {
      showToast('⚠ Ficha não encontrada', 'error');
      return;
    }
    $('modal-ficha-title').textContent = '✏️ Editar Ficha Técnica';
    fichaEmEdicao = {
      nome: f.nome || '',
      rendimento: f.rendimento ?? 1,
      unidadeRendimento: f.unidadeRendimento || 'KG',
      tamanhoPorcao: f.tamanhoPorcao ?? null,
      precoVenda: f.precoVenda ?? 0,
      cmvAlvoCustom: f.cmvAlvoCustom ?? null,
      ehPrePreparo: !!f.ehPrePreparo,
      ingredientes: JSON.parse(JSON.stringify(f.ingredientes || [])),
      tempoPreparo: f.tempoPreparo || '',
      modoPreparo: f.modoPreparo || '',
      observacoes: f.observacoes || ''
    };
    $('ficha-id').value = fichaId;
  } else {
    $('modal-ficha-title').textContent = '📋 Nova Ficha Técnica';
    fichaEmEdicao = {
      nome: '',
      rendimento: 1,
      unidadeRendimento: 'KG',
      tamanhoPorcao: null,
      precoVenda: 0,
      cmvAlvoCustom: null,
      ehPrePreparo: false,
      ingredientes: [],
      tempoPreparo: '',
      modoPreparo: '',
      observacoes: ''
    };
    $('ficha-id').value = '';
  }

  // Popular UI com dados
  $('ficha-nome').value = fichaEmEdicao.nome;
  $('ficha-rendimento').value = fichaEmEdicao.rendimento;
  $('ficha-unidade-rendimento').value = fichaEmEdicao.unidadeRendimento;
  $('ficha-tamanho-porcao').value = (fichaEmEdicao.tamanhoPorcao != null && fichaEmEdicao.tamanhoPorcao > 0)
    ? fichaEmEdicao.tamanhoPorcao
    : '';
  $('ficha-preco-venda').value = fichaEmEdicao.precoVenda || '';
  $('ficha-cmv-custom').value = fichaEmEdicao.cmvAlvoCustom != null ? Math.round(fichaEmEdicao.cmvAlvoCustom * 100) : '';
  $('ficha-eh-pp').checked = fichaEmEdicao.ehPrePreparo;
  $('ficha-tempo-preparo').value = fichaEmEdicao.tempoPreparo;
  $('ficha-modo-preparo').value = fichaEmEdicao.modoPreparo;
  $('ficha-observacoes').value = fichaEmEdicao.observacoes;
  $('ficha-error').classList.remove('show');
  $('ficha-error').textContent = '';

  atualizarVisibilidadeTamanhoPorcao();
  renderIngredientesModal();
  atualizarPainelPrecificacao();

  $('modal-ficha').classList.add('show');
  setTimeout(() => $('ficha-nome').focus(), 100);
}

function fecharModalFicha() {
  $('modal-ficha').classList.remove('show');
  fichaEditandoId = null;
  fichaEmEdicao = null;
}

// Atualiza o bloco "Tamanho da Porção": esconde se unidade é PORCOES,
// e atualiza a label dinâmica (KG/L/und) ao lado do input
function atualizarVisibilidadeTamanhoPorcao() {
  if (!fichaEmEdicao) return;
  const bloco = $('bloco-tamanho-porcao');
  const labelUnid = $('ficha-tamanho-porcao-unidade');
  const rendeInfo = $('ficha-rende-info');
  const unidade = fichaEmEdicao.unidadeRendimento || 'KG';

  if (unidade === 'PORCOES') {
    // Receita já está em porções: não precisa de tamanho de porção
    bloco.style.display = 'none';
    return;
  }

  bloco.style.display = 'block';

  // Label da unidade ao lado do input
  const labels = { KG: 'KG', LITRO: 'L', UND: 'unidades' };
  labelUnid.textContent = labels[unidade] || 'KG';

  // Calcula e exibe "Rende ≈ N porções"
  const rendimento = parseFloat(fichaEmEdicao.rendimento) || 0;
  const tamanho = parseFloat(fichaEmEdicao.tamanhoPorcao) || 0;
  if (rendimento > 0 && tamanho > 0) {
    const n = rendimento / tamanho;
    const nFormatado = n >= 100 ? Math.round(n) : (Math.round(n * 10) / 10);
    rendeInfo.textContent = `→ Rende ≈ ${nFormatado} porções`;
    rendeInfo.style.color = '#173404';
  } else {
    rendeInfo.textContent = '→ Informe o tamanho';
    rendeInfo.style.color = '#888780';
  }
}

// --- RENDER de ingredientes (cards) ---

function renderIngredientesModal() {
  const el = $('ingredientes-container');
  if (!fichaEmEdicao) return;

  const ings = fichaEmEdicao.ingredientes || [];

  if (!ings.length) {
    el.innerHTML = `<div style="padding:16px;text-align:center;color:var(--muted);font-size:12px;background:#fafaf9;border-radius:8px">
      Nenhum ingrediente adicionado.<br>
      <span style="font-size:11px">Clique em "+ Adicionar ingrediente" para começar.</span>
    </div>`;
    return;
  }

  let html = '';
  for (let i = 0; i < ings.length; i++) {
    const ing = ings[i];
    const calc = calcularCustoIngrediente(ing, insumos);
    const invalidoCls = !calc.encontrado ? ' invalido' : '';
    const semPreco = calc.encontrado && calc.precoUnitario <= 0;

    html += `<div class="ingrediente-card${invalidoCls}" data-idx="${i}">`;
    html += `<div class="ingrediente-header">`;
    html += `<span class="ingrediente-nome">${calc.encontrado ? '✓ ' + escHtml(calc.insumoNome) : '⚠ Insumo não selecionado'}</span>`;
    html += `<button class="icon-btn danger" data-action="remover-ing" data-idx="${i}" title="Remover ingrediente">×</button>`;
    html += `</div>`;

    html += `<div class="ingrediente-row">`;
    // Select insumo
    html += `<div class="field" style="flex:2;min-width:160px"><label>Insumo</label>`;
    html += `<select data-action="update-ing-insumo" data-idx="${i}">`;
    html += `<option value="">— Selecione —</option>`;
    const insumosOrdenados = [...insumos].sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));
    for (const ins of insumosOrdenados) {
      const sel = ing.insumoId === ins.id ? ' selected' : '';
      html += `<option value="${ins.id}"${sel}>${escHtml(ins.nome)} (${escHtml(ins.unidade || 'KG')})</option>`;
    }
    html += `</select></div>`;

    // Peso líquido
    html += `<div class="field" style="max-width:140px"><label>Peso líquido</label>`;
    html += `<input type="number" inputmode="decimal" min="0" step="0.001" value="${ing.pesoLiquido || ''}" placeholder="0" data-action="update-ing-peso" data-idx="${i}">`;
    html += `</div>`;
    html += `</div>`;

    if (calc.encontrado) {
      html += `<div class="ingrediente-info-calc">`;
      html += `<span>FC: <strong>${calc.fc.toFixed(2)}</strong></span>`;
      html += `<span>Peso bruto: <strong>${calc.pesoBruto.toFixed(3)} ${escHtml(calc.unidade)}</strong></span>`;
      html += `<span>Preço unit.: <strong>${semPreco ? '⚠ sem preço' : fmtMoeda(calc.precoUnitario) + '/' + escHtml(calc.unidade)}</strong></span>`;
      html += `<span>Custo: <strong>${fmtMoeda(calc.custoIngrediente)}</strong></span>`;
      html += `</div>`;
    }

    html += `</div>`;
  }

  el.innerHTML = html;
}

function adicionarIngrediente() {
  if (!fichaEmEdicao) return;
  // Insere no topo (unshift) ao invés de no fim (push)
  // Agiliza criar fichas grandes: o botão "+ Adicionar" fica sempre acima do último adicionado
  fichaEmEdicao.ingredientes.unshift({ insumoId: '', pesoLiquido: 0 });
  renderIngredientesModal();
  atualizarPainelPrecificacao();
}

function removerIngrediente(idx) {
  if (!fichaEmEdicao) return;
  fichaEmEdicao.ingredientes.splice(idx, 1);
  renderIngredientesModal();
  atualizarPainelPrecificacao();
}

function atualizarIngredienteInsumo(idx, insumoId) {
  if (!fichaEmEdicao || !fichaEmEdicao.ingredientes[idx]) return;
  fichaEmEdicao.ingredientes[idx].insumoId = insumoId;
  renderIngredientesModal();
  atualizarPainelPrecificacao();
}

function atualizarIngredientePeso(idx, peso) {
  if (!fichaEmEdicao || !fichaEmEdicao.ingredientes[idx]) return;
  fichaEmEdicao.ingredientes[idx].pesoLiquido = parseFloat(peso) || 0;
  // Não re-renderiza tudo (preserva foco), só recalcula
  const card = document.querySelector(`.ingrediente-card[data-idx="${idx}"]`);
  if (card) {
    const calc = calcularCustoIngrediente(fichaEmEdicao.ingredientes[idx], insumos);
    const infoEl = card.querySelector('.ingrediente-info-calc');
    if (infoEl && calc.encontrado) {
      const semPreco = calc.precoUnitario <= 0;
      infoEl.innerHTML = `
        <span>FC: <strong>${calc.fc.toFixed(2)}</strong></span>
        <span>Peso bruto: <strong>${calc.pesoBruto.toFixed(3)} ${escHtml(calc.unidade)}</strong></span>
        <span>Preço unit.: <strong>${semPreco ? '⚠ sem preço' : fmtMoeda(calc.precoUnitario) + '/' + escHtml(calc.unidade)}</strong></span>
        <span>Custo: <strong>${fmtMoeda(calc.custoIngrediente)}</strong></span>
      `;
    }
  }
  atualizarPainelPrecificacao();
}

// --- PAINEL DE PRECIFICAÇÃO (3 caixinhas + gauge) ---

function atualizarPainelPrecificacao() {
  if (!fichaEmEdicao) return;

  const custoReceita = calcularCustoReceita(fichaEmEdicao, insumos);
  const custoPorcao = calcularCustoPorPorcao(fichaEmEdicao, insumos);
  const cmv = calcularCMV(fichaEmEdicao, insumos);
  const cmvAlvo = obterCMVAlvoEfetivo(fichaEmEdicao, configPrecificacao);
  const precoSugerido = calcularPrecoSugerido(fichaEmEdicao, insumos, configPrecificacao);
  const nPorcoes = calcularNumeroPorcoes(fichaEmEdicao);

  $('painel-custo-receita').textContent = fmtMoeda(custoReceita);
  $('painel-custo-porcao').textContent = fmtMoeda(custoPorcao);

  // Mostra quantas porções a receita rende (no sublabel da caixinha)
  const nPorcoesEl = $('painel-n-porcoes');
  if (nPorcoesEl) {
    const unidade = fichaEmEdicao.unidadeRendimento || 'KG';
    const tamanho = parseFloat(fichaEmEdicao.tamanhoPorcao);
    if (unidade === 'PORCOES') {
      const nFmt = nPorcoes >= 10 ? Math.round(nPorcoes) : (Math.round(nPorcoes * 10) / 10);
      nPorcoesEl.textContent = `Rende ${nFmt} porções`;
    } else if (!isNaN(tamanho) && tamanho > 0) {
      const nFmt = nPorcoes >= 10 ? Math.round(nPorcoes) : (Math.round(nPorcoes * 10) / 10);
      nPorcoesEl.textContent = `Rende ≈ ${nFmt} porções`;
    } else {
      nPorcoesEl.textContent = '⚠ Informe o tamanho da porção';
      nPorcoesEl.style.color = '#791F1F';
    }
    if (nPorcoesEl.textContent.startsWith('Rende')) {
      nPorcoesEl.style.color = '#888780';
    }
  }

  $('painel-preco-sugerido').textContent = fmtMoeda(precoSugerido);

  // Método label
  const metodoLabels = {
    cmv_alvo: 'via CMV alvo',
    markup: 'via Markup',
    margem: 'via Margem'
  };
  $('painel-metodo').textContent = metodoLabels[configPrecificacao.metodo] || 'via CMV alvo';

  // Gauge CMV
  desenharGaugeCMV(cmv, cmvAlvo);
}

function desenharGaugeCMV(cmv, cmvAlvo) {
  const arc = $('painel-gauge-arc');
  const needle = $('painel-gauge-needle');
  const valor = $('painel-cmv-valor');
  const alvoEl = $('painel-cmv-alvo');

  alvoEl.textContent = 'Alvo: ' + Math.round(cmvAlvo * 100) + '%';

  if (cmv === null || cmv <= 0) {
    arc.setAttribute('d', '');
    arc.setAttribute('stroke', '#888780');
    needle.setAttribute('x2', '80');
    needle.setAttribute('y2', '80');
    needle.setAttribute('stroke', '#444441');
    valor.textContent = '—';
    valor.style.color = '#888780';
    return;
  }

  const ratio = cmv / cmvAlvo;
  // Mapeia: 0% do alvo = ângulo 180° (esquerda), 200% do alvo = 0° (direita)
  // ratio 1.0 = meio (90°)
  // limita ratio entre 0 e 2 pra não passar do arco
  const ratioLimitado = Math.max(0, Math.min(2, ratio));
  // ângulo: começa em 180° (esq), termina em 0° (dir)
  // ratio 0.0 → 180°, ratio 1.0 → 90°, ratio 2.0 → 0°
  const angulo = 180 - (ratioLimitado / 2) * 180;
  const anguloRad = angulo * Math.PI / 180;

  // Centro do gauge: (80, 80), raio: 60
  const cx = 80, cy = 80, r = 60;
  const px = cx + r * Math.cos(Math.PI - anguloRad);
  const py = cy - r * Math.sin(Math.PI - anguloRad);

  // Arc path: do ponto inicial (esquerda) até o ponto atual
  const startX = 20, startY = 80;
  const largeArc = (180 - angulo) > 180 ? 1 : 0;
  const arcPath = `M ${startX} ${startY} A ${r} ${r} 0 ${largeArc} 1 ${px.toFixed(2)} ${py.toFixed(2)}`;
  arc.setAttribute('d', arcPath);

  // Cor segundo o ratio
  let corArco, corNeedle, corTexto;
  if (ratio < 0.80) {
    corArco = '#639922'; corNeedle = '#173404'; corTexto = '#173404';
  } else if (ratio < 1.0) {
    corArco = '#FAC775'; corNeedle = '#854F0B'; corTexto = '#854F0B';
  } else if (ratio < 1.2) {
    corArco = '#EF9F27'; corNeedle = '#633806'; corTexto = '#633806';
  } else {
    corArco = '#E24B4A'; corNeedle = '#791F1F'; corTexto = '#791F1F';
  }

  arc.setAttribute('stroke', corArco);

  // Posição do ponteiro: centro até o ponto (px, py)
  needle.setAttribute('x2', px.toFixed(2));
  needle.setAttribute('y2', py.toFixed(2));
  needle.setAttribute('stroke', corNeedle);

  valor.textContent = (cmv * 100).toFixed(1) + '%';
  valor.style.color = corTexto;
}

// --- SALVAR ficha ---

async function salvarFicha() {
  if (!fichaEmEdicao) return;

  // Lê o estado atual da UI
  fichaEmEdicao.nome = $('ficha-nome').value.trim();
  fichaEmEdicao.rendimento = parseFloat($('ficha-rendimento').value) || 1;
  fichaEmEdicao.unidadeRendimento = $('ficha-unidade-rendimento').value;
  fichaEmEdicao.precoVenda = parseFloat($('ficha-preco-venda').value) || 0;

  // Tamanho da porção: só se aplica quando unidade NÃO é PORCOES
  if (fichaEmEdicao.unidadeRendimento === 'PORCOES') {
    fichaEmEdicao.tamanhoPorcao = null;
  } else {
    const tamPorcaoStr = $('ficha-tamanho-porcao').value;
    const tamPorcao = parseFloat(tamPorcaoStr);
    fichaEmEdicao.tamanhoPorcao = (!isNaN(tamPorcao) && tamPorcao > 0) ? tamPorcao : null;
  }

  const cmvCustomPct = parseFloat($('ficha-cmv-custom').value);
  fichaEmEdicao.cmvAlvoCustom = isNaN(cmvCustomPct) ? null : (cmvCustomPct / 100);

  fichaEmEdicao.ehPrePreparo = $('ficha-eh-pp').checked;
  fichaEmEdicao.tempoPreparo = $('ficha-tempo-preparo').value.trim();
  fichaEmEdicao.modoPreparo = $('ficha-modo-preparo').value.trim();
  fichaEmEdicao.observacoes = $('ficha-observacoes').value.trim();

  const err = $('ficha-error');

  if (!fichaEmEdicao.nome) {
    err.textContent = 'Nome da ficha é obrigatório';
    err.classList.add('show');
    return;
  }
  if (fichaEmEdicao.rendimento <= 0) {
    err.textContent = 'Rendimento deve ser maior que zero';
    err.classList.add('show');
    return;
  }
  // Verifica duplicado
  const dup = fichas.find(f =>
    f.nome.toLowerCase() === fichaEmEdicao.nome.toLowerCase() && f.id !== fichaEditandoId
  );
  if (dup) {
    err.textContent = 'Já existe uma ficha com esse nome';
    err.classList.add('show');
    return;
  }

  // Limpa ingredientes com insumoId vazio
  fichaEmEdicao.ingredientes = (fichaEmEdicao.ingredientes || []).filter(i => i.insumoId);

  err.classList.remove('show');
  const btn = $('btn-ficha-salvar');
  btn.disabled = true;
  btn.textContent = 'Salvando...';

  try {
    if (fichaEditandoId) {
      await atualizarFicha(fichaEditandoId, fichaEmEdicao);
      showToast(`✓ "${fichaEmEdicao.nome}" atualizada`, 'success');
    } else {
      await criarFicha(fichaEmEdicao);
      showToast(`✓ Ficha "${fichaEmEdicao.nome}" criada`, 'success');
    }
    fecharModalFicha();
  } catch (e) {
    err.textContent = 'Erro: ' + e.message;
    err.classList.add('show');
  } finally {
    btn.disabled = false;
    btn.textContent = '💾 Salvar Ficha';
  }
}

async function removerFicha(fichaId) {
  const f = fichas.find(x => x.id === fichaId);
  if (!f) return;

  if (!confirm(`Remover a ficha "${f.nome}"?`)) return;

  try {
    await deletarFicha(fichaId);
    showToast(`✓ "${f.nome}" removida`, 'success');
  } catch (e) {
    showToast('⚠ Erro: ' + e.message, 'error');
  }
}

// ============================================================================
// RELATÓRIO DE FICHAS TÉCNICAS (Ideia 2)
// ============================================================================

function renderRelatorioFichas() {
  const el = $('relatorio-tabela');

  // Resumo
  $('rel-total').textContent = fichas.length;
  const pratos = fichas.filter(f => !f.ehPrePreparo).length;
  $('rel-pratos').textContent = pratos;

  // CMV médio (só conta fichas com preço de venda)
  const fichasComPreco = fichas.filter(f => (f.precoVenda || 0) > 0);
  if (fichasComPreco.length === 0) {
    $('rel-cmv-medio').textContent = '—';
  } else {
    let somaCMV = 0;
    let count = 0;
    for (const f of fichasComPreco) {
      const cmv = calcularCMV(f, insumos);
      if (cmv !== null && cmv > 0) {
        somaCMV += cmv;
        count++;
      }
    }
    if (count === 0) {
      $('rel-cmv-medio').textContent = '—';
    } else {
      const cmvMedio = (somaCMV / count) * 100;
      $('rel-cmv-medio').textContent = cmvMedio.toFixed(1) + '%';
    }
  }

  // Data no rodapé de impressão
  const agora = new Date();
  $('print-data').textContent = `${agora.toLocaleDateString('pt-BR')} às ${agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;

  // Sem fichas?
  if (!fichas.length) {
    el.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">📊</div>
      <div class="empty-state-text">Nenhuma ficha técnica cadastrada ainda.<br>Crie fichas em <strong>Cardápio → Fichas Técnicas</strong> e o relatório aparecerá aqui.</div>
    </div>`;
    return;
  }

  // Ordenar: pratos primeiro (por CMV decrescente — quem tem mais problema vai no topo), depois pré-preparos
  const ordenadas = [...fichas].sort((a, b) => {
    if (!!a.ehPrePreparo !== !!b.ehPrePreparo) {
      return a.ehPrePreparo ? 1 : -1;  // pratos primeiro
    }
    const cmvA = calcularCMV(a, insumos) ?? -1;
    const cmvB = calcularCMV(b, insumos) ?? -1;
    return cmvB - cmvA;  // maior CMV no topo
  });

  let html = '<table class="tabela-relatorio">';
  html += '<thead><tr>';
  html += '<th>Ficha</th>';
  html += '<th class="num">Rende</th>';
  html += '<th class="num">Ing.</th>';
  html += '<th class="num">Custo Receita</th>';
  html += '<th class="num">Custo / Porção</th>';
  html += '<th class="num">Preço Venda</th>';
  html += '<th class="num">CMV</th>';
  html += '<th class="num">CMV Alvo</th>';
  html += '<th class="num">Preço Sugerido</th>';
  html += '</tr></thead><tbody>';

  for (const ficha of ordenadas) {
    const custoReceita = calcularCustoReceita(ficha, insumos);
    const custoPorcao = calcularCustoPorPorcao(ficha, insumos);
    const cmv = calcularCMV(ficha, insumos);
    const cmvAlvo = obterCMVAlvoEfetivo(ficha, configPrecificacao);
    const precoSugerido = calcularPrecoSugerido(ficha, insumos, configPrecificacao);
    const nIng = (ficha.ingredientes || []).length;
    const unidadeAbrev = ficha.unidadeRendimento === 'PORCOES' ? 'porç.' : (ficha.unidadeRendimento || 'KG').toLowerCase();
    const nPorcoes = calcularNumeroPorcoes(ficha);

    // Texto da coluna "Rende": mostra rendimento + número de porções calculado
    let rendeTxt = `${ficha.rendimento || 1} ${escHtml(unidadeAbrev)}`;
    if (ficha.unidadeRendimento !== 'PORCOES') {
      const tam = parseFloat(ficha.tamanhoPorcao);
      if (!isNaN(tam) && tam > 0) {
        const nFmt = nPorcoes >= 10 ? Math.round(nPorcoes) : (Math.round(nPorcoes * 10) / 10);
        rendeTxt += `<br><span style="font-size:10px;color:var(--muted)">≈ ${nFmt} porções</span>`;
      }
    }

    // Cor do CMV
    let corCMV = '#888780';
    let textoCMV = '—';
    if (cmv !== null) {
      const pct = cmv * 100;
      textoCMV = pct.toFixed(1) + '%';
      const ratio = cmv / cmvAlvo;
      if (ratio < 0.80) corCMV = '#173404';      // verde
      else if (ratio < 1.0) corCMV = '#854F0B';   // amarelo
      else if (ratio < 1.2) corCMV = '#633806';   // âmbar
      else corCMV = '#791F1F';                    // vermelho
    }

    const tagPP = ficha.ehPrePreparo ? '<span class="pp-tag">PP</span>' : '';

    html += `<tr>`;
    html += `<td><strong>${escHtml(ficha.nome)}</strong>${tagPP}</td>`;
    html += `<td class="num">${rendeTxt}</td>`;
    html += `<td class="num">${nIng}</td>`;
    html += `<td class="num">${fmtMoeda(custoReceita)}</td>`;
    html += `<td class="num">${fmtMoeda(custoPorcao)}</td>`;
    html += `<td class="num">${(ficha.precoVenda || 0) > 0 ? fmtMoeda(ficha.precoVenda) : '—'}</td>`;
    html += `<td class="num cmv-cell" style="color:${corCMV}">${textoCMV}</td>`;
    html += `<td class="num">${Math.round(cmvAlvo * 100)}%</td>`;
    html += `<td class="num">${precoSugerido > 0 ? fmtMoeda(precoSugerido) : '—'}</td>`;
    html += `</tr>`;
  }

  html += '</tbody></table>';
  el.innerHTML = html;
}

// Função auxiliar: troca o document.title (que vira nome do PDF),
// espera a logo carregar, chama window.print() e restaura tudo
function executarImpressao(tituloDoArquivo, classeBody) {
  const tituloOriginal = document.title;

  // Aguarda a logo Primus terminar de carregar (necessário p/ imprimir com a imagem)
  const logoImg = document.querySelector('img[src="img/logo-primus.png"]');
  const aguardarLogo = new Promise((resolve) => {
    if (!logoImg || logoImg.complete) {
      resolve();
    } else {
      logoImg.addEventListener('load', resolve, { once: true });
      logoImg.addEventListener('error', resolve, { once: true });
      // Timeout de segurança: 2s
      setTimeout(resolve, 2000);
    }
  });

  aguardarLogo.then(() => {
    // Troca o título (vira nome padrão do PDF)
    document.title = tituloDoArquivo;
    document.body.classList.add(classeBody);

    // Pequeno delay pro DOM atualizar
    setTimeout(() => {
      window.print();
      // Restaura título e remove classe após o diálogo de print fechar
      setTimeout(() => {
        document.title = tituloOriginal;
        document.body.classList.remove(classeBody);
      }, 500);
    }, 200);
  });
}

function imprimirRelatorio() {
  if (!fichas.length) {
    showToast('⚠ Cadastre fichas técnicas antes de imprimir', 'error');
    return;
  }
  // Re-renderiza pra garantir dados atualizados (e atualiza a data)
  renderRelatorioFichas();

  const dataFmt = new Date().toLocaleDateString('pt-BR').replace(/\//g, '-');
  executarImpressao(`Relatorio de Fichas Tecnicas - ${dataFmt}`, 'printing-relatorio');
}

// ============================================================================
// IMPRESSÃO DE FICHA TÉCNICA INDIVIDUAL
// ============================================================================

function imprimirFichaIndividual(fichaId) {
  const ficha = fichas.find(f => f.id === fichaId);
  if (!ficha) {
    showToast('⚠ Ficha não encontrada', 'error');
    return;
  }

  // Calcula tudo
  const custoReceita = calcularCustoReceita(ficha, insumos);
  const custoPorcao = calcularCustoPorPorcao(ficha, insumos);
  const cmv = calcularCMV(ficha, insumos);
  const cmvAlvo = obterCMVAlvoEfetivo(ficha, configPrecificacao);
  const precoSugerido = calcularPrecoSugerido(ficha, insumos, configPrecificacao);
  const nPorcoes = calcularNumeroPorcoes(ficha);

  const unidade = ficha.unidadeRendimento || 'KG';
  const unidadeLower = unidade.toLowerCase();
  const tamanhoPorcao = parseFloat(ficha.tamanhoPorcao);

  // Cor do CMV
  let corCMV = '#444';
  let textoCMV = '—';
  if (cmv !== null) {
    textoCMV = (cmv * 100).toFixed(1) + '%';
    const ratio = cmv / cmvAlvo;
    if (ratio < 0.80) corCMV = '#173404';
    else if (ratio < 1.0) corCMV = '#854F0B';
    else if (ratio < 1.2) corCMV = '#633806';
    else corCMV = '#791F1F';
  }

  const nPorcoesFmt = nPorcoes >= 10 ? Math.round(nPorcoes) : (Math.round(nPorcoes * 10) / 10);

  // ----- Cabeçalho -----
  let html = '';
  html += `<div class="ficha-print-header">`;
  html += `<img src="img/logo-primus.png" alt="Primus Peixaria" class="ficha-print-logo" onerror="this.style.display='none'">`;
  html += `<div class="ficha-print-header-info">`;
  html += `<div class="ficha-print-empresa">PRIMUS PEIXARIA</div>`;
  html += `<div class="ficha-print-empresa-sub">Cuiabá - MT</div>`;
  html += `</div>`;
  html += `<div class="ficha-print-titulo-doc">FICHA TÉCNICA</div>`;
  html += `</div>`;

  // ----- Nome do prato -----
  const badgePP = ficha.ehPrePreparo ? '<span class="ficha-print-pp-badge">PRÉ-PREPARO</span>' : '';
  html += `<div class="ficha-print-nome">${escHtml(ficha.nome)}${badgePP}</div>`;

  // ----- Informações da receita -----
  html += `<div class="ficha-print-secao">`;
  html += `<div class="ficha-print-secao-titulo">📊 Informações da Receita</div>`;
  html += `<table class="ficha-print-infos"><tbody>`;
  html += `<tr><td>Rendimento total</td><td>${ficha.rendimento || 1} ${escHtml(unidade)}</td></tr>`;

  if (unidade !== 'PORCOES') {
    if (!isNaN(tamanhoPorcao) && tamanhoPorcao > 0) {
      html += `<tr><td>Tamanho da porção</td><td>${tamanhoPorcao} ${escHtml(unidade)} (≈ ${nPorcoesFmt} porções)</td></tr>`;
    } else {
      html += `<tr><td>Tamanho da porção</td><td><em style="color:#888">não definido</em></td></tr>`;
    }
  } else {
    html += `<tr><td>Número de porções</td><td>${nPorcoesFmt}</td></tr>`;
  }

  if ((ficha.precoVenda || 0) > 0) {
    html += `<tr><td>Preço de venda</td><td>${fmtMoeda(ficha.precoVenda)} <span style="color:#888;font-size:10px">(por porção)</span></td></tr>`;
  }
  if (ficha.tempoPreparo) {
    html += `<tr><td>Tempo de preparo</td><td>${escHtml(ficha.tempoPreparo)}</td></tr>`;
  }
  html += `</tbody></table>`;
  html += `</div>`;

  // ----- Ingredientes -----
  html += `<div class="ficha-print-secao">`;
  html += `<div class="ficha-print-secao-titulo">📋 Ingredientes</div>`;
  html += `<table class="ficha-print-ingredientes">`;
  html += `<thead><tr>`;
  html += `<th>Insumo</th>`;
  html += `<th class="num">Peso Líq.</th>`;
  html += `<th class="num">FC</th>`;
  html += `<th class="num">Peso Bruto</th>`;
  html += `<th class="num">Preço Unit.</th>`;
  html += `<th class="num">Custo</th>`;
  html += `</tr></thead><tbody>`;

  const ingredientes = ficha.ingredientes || [];
  if (!ingredientes.length) {
    html += `<tr><td colspan="6" style="text-align:center;color:#888;padding:12px">Nenhum ingrediente cadastrado</td></tr>`;
  } else {
    for (const ing of ingredientes) {
      const calc = calcularCustoIngrediente(ing, insumos);
      if (!calc.encontrado) {
        html += `<tr><td colspan="6" style="color:#791F1F">⚠ Insumo não encontrado</td></tr>`;
        continue;
      }
      const unidadeIng = calc.unidade || 'KG';
      html += `<tr>`;
      html += `<td>${escHtml(calc.insumoNome)}</td>`;
      html += `<td class="num">${(ing.pesoLiquido || 0).toFixed(3)} ${escHtml(unidadeIng)}</td>`;
      html += `<td class="num">${calc.fc.toFixed(2)}</td>`;
      html += `<td class="num">${calc.pesoBruto.toFixed(3)} ${escHtml(unidadeIng)}</td>`;
      html += `<td class="num">${calc.precoUnitario > 0 ? fmtMoeda(calc.precoUnitario) + '/' + escHtml(unidadeIng) : '<em style="color:#888">sem preço</em>'}</td>`;
      html += `<td class="num">${fmtMoeda(calc.custoIngrediente)}</td>`;
      html += `</tr>`;
    }
  }

  html += `</tbody><tfoot>`;
  html += `<tr><td colspan="5" style="text-align:right">CUSTO TOTAL DA RECEITA</td><td class="num">${fmtMoeda(custoReceita)}</td></tr>`;
  html += `<tr><td colspan="5" style="text-align:right">CUSTO POR PORÇÃO <span style="font-weight:400;color:#888;font-size:9px">(${nPorcoesFmt} porções)</span></td><td class="num">${fmtMoeda(custoPorcao)}</td></tr>`;
  html += `</tfoot></table>`;
  html += `</div>`;

  // ----- Análise Financeira (só se tiver preço de venda) -----
  if ((ficha.precoVenda || 0) > 0 && custoPorcao > 0) {
    const margemContrib = ficha.precoVenda - custoPorcao;
    const pctMargem = (margemContrib / ficha.precoVenda) * 100;

    html += `<div class="ficha-print-secao">`;
    html += `<div class="ficha-print-secao-titulo">💰 Análise Financeira</div>`;
    html += `<table class="ficha-print-infos"><tbody>`;
    html += `<tr><td>Preço de venda</td><td><strong>${fmtMoeda(ficha.precoVenda)}</strong></td></tr>`;
    html += `<tr><td>Custo por porção</td><td>${fmtMoeda(custoPorcao)}</td></tr>`;
    html += `<tr><td>CMV atual</td><td><strong style="color:${corCMV}">${textoCMV}</strong></td></tr>`;
    html += `<tr><td>CMV alvo</td><td>${Math.round(cmvAlvo * 100)}%</td></tr>`;
    html += `<tr><td>Margem de contribuição</td><td><strong>${fmtMoeda(margemContrib)}</strong> <span style="color:#888;font-size:10px">(${pctMargem.toFixed(1)}%)</span></td></tr>`;
    if (precoSugerido > 0) {
      html += `<tr><td>Preço sugerido (CMV alvo)</td><td>${fmtMoeda(precoSugerido)}</td></tr>`;
    }
    html += `</tbody></table>`;
    html += `</div>`;
  }

  // ----- Modo de preparo -----
  if (ficha.modoPreparo) {
    html += `<div class="ficha-print-secao">`;
    html += `<div class="ficha-print-secao-titulo">👨‍🍳 Modo de Preparo</div>`;
    html += `<div class="ficha-print-modo">${escHtml(ficha.modoPreparo)}</div>`;
    html += `</div>`;
  }

  // ----- Observações -----
  if (ficha.observacoes) {
    html += `<div class="ficha-print-secao">`;
    html += `<div class="ficha-print-secao-titulo">📝 Observações</div>`;
    html += `<div class="ficha-print-modo">${escHtml(ficha.observacoes)}</div>`;
    html += `</div>`;
  }

  // ----- Rodapé -----
  const agora = new Date();
  const dataFmt = `${agora.toLocaleDateString('pt-BR')} às ${agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
  html += `<div class="ficha-print-rodape">Ficha técnica gerada em ${dataFmt}</div>`;

  // Insere no DOM
  $('ficha-impressao').innerHTML = html;

  // Nome do arquivo PDF: "Ficha Tecnica - Nome do Prato"
  // Remove caracteres especiais que dão problema em nome de arquivo
  const nomeArquivo = `Ficha Tecnica - ${(ficha.nome || 'sem nome').replace(/[\\/:*?"<>|]/g, '')}`;

  const tituloOriginal = document.title;
  const logoImg = document.querySelector('img[src="img/logo-primus.png"]');

  const aguardarLogo = new Promise((resolve) => {
    if (!logoImg || logoImg.complete) {
      resolve();
    } else {
      logoImg.addEventListener('load', resolve, { once: true });
      logoImg.addEventListener('error', resolve, { once: true });
      setTimeout(resolve, 2000);
    }
  });

  aguardarLogo.then(() => {
    document.title = nomeArquivo;
    document.body.classList.add('printing-ficha');

    setTimeout(() => {
      window.print();
      setTimeout(() => {
        document.title = tituloOriginal;
        document.body.classList.remove('printing-ficha');
        $('ficha-impressao').innerHTML = '';
      }, 500);
    }, 200);
  });
}

// ============================================================================
// INSUMOS - render + modal
// ============================================================================

function renderInsumos() {
  const el = $('list-insumos');
  $('stat-insumos-total').textContent = insumos.length;
  const comPreco = insumos.filter(i => i.precoPorUnidade != null && i.precoPorUnidade > 0).length;
  $('stat-insumos-com-preco').textContent = comPreco;

  const filtrados = insumos.filter(i => {
    if (!searchInsumos) return true;
    const t = searchInsumos.toLowerCase();
    return (i.nome || '').toLowerCase().includes(t)
        || (i.categoria || '').toLowerCase().includes(t)
        || (i.fornecedor || '').toLowerCase().includes(t);
  });

  if (!insumos.length) {
    el.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">📦</div>
      <div class="empty-state-text">Nenhum insumo cadastrado.<br>Clique em <strong>"+ Novo Insumo"</strong> para começar.</div>
    </div>`;
    return;
  }

  if (!filtrados.length) {
    el.innerHTML = `<div class="empty-msg">Nenhum insumo encontrado para "<strong>${escHtml(searchInsumos)}</strong>"</div>`;
    $('search-insumos-clear').style.display = 'block';
    return;
  }

  let html = '';
  for (const ins of filtrados) {
    const unidade = (ins.unidade || 'KG').toLowerCase();
    const badge = `<span class="insumo-badge ${unidade}">${escHtml(ins.unidade || 'KG')}</span>`;
    const badgePP = ins.ehPrePreparo ? `<span class="insumo-badge pp">PRÉ-PREPARO</span>` : '';
    const fc = ins.fatorCorrecao ?? 1.0;
    const fcTxt = fc !== 1 ? ` · FC ${fc.toFixed(2)}` : '';
    const itensVinculados = itens.filter(it => it.insumoId === ins.id).length;
    const vinculadosTxt = itensVinculados > 0 ? ` · 🔗 ${itensVinculados} item(ns)` : '';
    const categoria = ins.categoria ? ` · ${escHtml(ins.categoria)}` : '';

    html += `<div class="insumo-card">`;
    html += `<div class="insumo-card-info">`;
    html += `<div class="insumo-card-nome">${escHtml(ins.nome)} ${badge} ${badgePP}</div>`;
    html += `<div class="insumo-card-meta">${categoria}${fcTxt}${vinculadosTxt}</div>`;
    html += `</div>`;
    html += `<div class="insumo-card-preco">`;
    if (ins.precoPorUnidade && ins.precoPorUnidade > 0) {
      // Badge de origem
      let badgeOrigemHtml = '';
      if (ins.origemPreco === 'compra') {
        badgeOrigemHtml = `<span style="display:inline-block;font-size:9px;font-weight:600;padding:1px 5px;border-radius:4px;background:#dcfce7;color:#15803d;margin-left:2px" title="Atualizado por compra real">🛒</span>`;
      } else if (ins.origemPreco === 'manual') {
        badgeOrigemHtml = `<span style="display:inline-block;font-size:9px;font-weight:600;padding:1px 5px;border-radius:4px;background:#e5e7eb;color:#374151;margin-left:2px" title="Cadastrado manualmente">✋</span>`;
      }
      html += `${fmtMoeda(ins.precoPorUnidade)} ${badgeOrigemHtml}<br><span style="font-weight:400;font-size:10px;color:var(--muted)">por ${escHtml(ins.unidade || 'KG')}</span>`;
    } else {
      html += `<span class="insumo-card-preco-sem">sem preço</span>`;
    }
    html += `</div>`;
    html += `<span class="item-actions">`;
    html += `<button class="icon-btn edit" data-action="editar-insumo" data-insumo-id="${ins.id}" title="Editar">✏️</button>`;
    html += `<button class="icon-btn danger" data-action="remover-insumo" data-insumo-id="${ins.id}" title="Remover">×</button>`;
    html += `</span>`;
    html += `</div>`;
  }

  el.innerHTML = html;
  $('search-insumos-clear').style.display = searchInsumos ? 'block' : 'none';
}

function abrirModalInsumo(insumoId = null) {
  insumoEditandoId = insumoId;

  // Variável usada pra detectar se o usuário mudou o preço (ao salvar)
  window._precoInsumoOriginal = null;

  if (insumoId) {
    const ins = insumos.find(i => i.id === insumoId);
    if (!ins) {
      showToast('⚠ Insumo não encontrado', 'error');
      return;
    }
    $('modal-insumo-title').textContent = '✏️ Editar Insumo';
    $('insumo-id').value = insumoId;
    $('insumo-nome').value = ins.nome || '';
    $('insumo-unidade').value = ins.unidade || 'KG';
    $('insumo-fc').value = (ins.fatorCorrecao ?? 1.0).toFixed(2);
    $('insumo-categoria').value = ins.categoria || '';
    $('insumo-fornecedor').value = ins.fornecedor || '';

    // Bloco de preço
    const preco = ins.precoPorUnidade;
    $('insumo-preco').value = (preco && preco > 0) ? preco.toFixed(2) : '';
    window._precoInsumoOriginal = preco;

    // Data da cotação (formato yyyy-mm-dd pro input type=date)
    if (ins.dataUltimaCompra) {
      const d = ins.dataUltimaCompra.toDate ? ins.dataUltimaCompra.toDate() : new Date(ins.dataUltimaCompra);
      const ano = d.getFullYear();
      const mes = String(d.getMonth() + 1).padStart(2, '0');
      const dia = String(d.getDate()).padStart(2, '0');
      $('insumo-data-cotacao').value = `${ano}-${mes}-${dia}`;
    } else {
      $('insumo-data-cotacao').value = '';
    }

    atualizarBadgeOrigem(ins.origemPreco);
  } else {
    $('modal-insumo-title').textContent = '📦 Novo Insumo';
    $('insumo-id').value = '';
    $('insumo-nome').value = '';
    $('insumo-unidade').value = 'KG';
    $('insumo-fc').value = '1.00';
    $('insumo-categoria').value = '';
    $('insumo-fornecedor').value = '';
    $('insumo-preco').value = '';
    $('insumo-data-cotacao').value = '';
    atualizarBadgeOrigem(null);
  }

  atualizarUnidadePrecoLabel();

  $('insumo-error').classList.remove('show');
  $('insumo-error').textContent = '';
  $('modal-insumo').classList.add('show');
  setTimeout(() => $('insumo-nome').focus(), 100);
}

// Atualiza a label "/kg", "/L" ou "/und" ao lado do preço
function atualizarUnidadePrecoLabel() {
  const unidade = $('insumo-unidade').value;
  const labels = { KG: '/kg', LITRO: '/L', UND: '/und' };
  $('insumo-preco-unidade').textContent = labels[unidade] || '/kg';
}

// Atualiza a badge de origem (Manual / Compra / —)
function atualizarBadgeOrigem(origem) {
  const badge = $('insumo-origem-badge');
  if (!badge) return;

  if (origem === 'compra') {
    badge.textContent = '🛒 Compra';
    badge.style.background = '#dcfce7';
    badge.style.color = '#15803d';
  } else if (origem === 'manual') {
    badge.textContent = '✋ Manual';
    badge.style.background = '#e5e7eb';
    badge.style.color = '#374151';
  } else {
    badge.textContent = '— Sem preço';
    badge.style.background = '#f3f4f6';
    badge.style.color = '#9ca3af';
  }
}

function fecharModalInsumo() {
  $('modal-insumo').classList.remove('show');
  insumoEditandoId = null;
}

async function salvarInsumo() {
  const nome = $('insumo-nome').value.trim();
  const unidade = $('insumo-unidade').value;
  const fcStr = $('insumo-fc').value;
  const categoria = $('insumo-categoria').value.trim();
  const fornecedor = $('insumo-fornecedor').value.trim();

  const fc = parseFloat(fcStr);
  const err = $('insumo-error');

  if (!nome) {
    err.textContent = 'Nome do insumo é obrigatório';
    err.classList.add('show');
    return;
  }
  if (!['KG', 'LITRO', 'UND'].includes(unidade)) {
    err.textContent = 'Unidade inválida';
    err.classList.add('show');
    return;
  }
  if (isNaN(fc) || fc <= 0 || fc > 1) {
    err.textContent = 'Fator de Correção deve ser entre 0,01 e 1,00';
    err.classList.add('show');
    return;
  }

  // Verifica duplicado
  const dup = insumos.find(i =>
    i.nome.toLowerCase() === nome.toLowerCase() && i.id !== insumoEditandoId
  );
  if (dup) {
    err.textContent = 'Já existe um insumo com esse nome';
    err.classList.add('show');
    return;
  }

  err.classList.remove('show');
  const btn = $('btn-insumo-salvar');
  btn.disabled = true;
  btn.textContent = 'Salvando...';

  // Lê os novos campos de preço
  const precoStr = $('insumo-preco').value.trim();
  const precoNovo = precoStr === '' ? null : parseFloat(precoStr);
  const dataCotacaoStr = $('insumo-data-cotacao').value;

  // Valida preço se preenchido
  if (precoStr !== '' && (isNaN(precoNovo) || precoNovo < 0)) {
    err.textContent = 'Preço inválido';
    err.classList.add('show');
    btn.disabled = false;
    btn.textContent = '💾 Salvar';
    return;
  }

  // Converte data (formato yyyy-mm-dd do input) pra Date
  let dataCotacao = null;
  if (dataCotacaoStr) {
    dataCotacao = new Date(dataCotacaoStr + 'T12:00:00');
  }

  // Decide a origem do preço:
  // Se editando e o preço NÃO mudou em relação ao original, mantém origem atual
  // Se digitou preço (novo ou mudou), marca como 'manual'
  // Se apagou o preço, origem vira null
  let origemPreco = null;
  if (precoNovo !== null && precoNovo > 0) {
    const original = window._precoInsumoOriginal;
    if (insumoEditandoId && original !== null && Math.abs((original || 0) - precoNovo) < 0.001) {
      // Preço não mudou: mantém origem atual do insumo
      const insumoAtual = insumos.find(i => i.id === insumoEditandoId);
      origemPreco = insumoAtual?.origemPreco || 'manual';
    } else {
      origemPreco = 'manual';
    }
  }

  try {
    if (insumoEditandoId) {
      const payload = {
        nome,
        unidade,
        fatorCorrecao: fc,
        categoria,
        fornecedor,
        precoPorUnidade: precoNovo,
        origemPreco
      };
      // Só inclui dataUltimaCompra se uma data foi informada (não sobrescreve sem motivo)
      if (dataCotacao) {
        payload.dataUltimaCompra = dataCotacao;
      } else if (precoNovo === null) {
        payload.dataUltimaCompra = null;
      }
      await atualizarInsumo(insumoEditandoId, payload);
      showToast(`✓ "${nome}" atualizado`, 'success');
    } else {
      await criarInsumo({
        nome,
        unidade,
        fatorCorrecao: fc,
        categoria,
        fornecedor,
        precoPorUnidade: precoNovo,
        dataUltimaCompra: dataCotacao,
        origemPreco
      });
      showToast(`✓ Insumo "${nome}" criado`, 'success');
    }
    fecharModalInsumo();
  } catch (e) {
    err.textContent = 'Erro: ' + e.message;
    err.classList.add('show');
  } finally {
    btn.disabled = false;
    btn.textContent = '💾 Salvar';
  }
}

async function removerInsumo(insumoId) {
  const ins = insumos.find(i => i.id === insumoId);
  if (!ins) return;

  const itensVinculados = itens.filter(it => it.insumoId === insumoId);
  if (itensVinculados.length > 0) {
    if (!confirm(`Este insumo está vinculado a ${itensVinculados.length} item(ns) de compra.\n\nAo remover, esses itens ficarão sem vínculo (mas continuam no catálogo).\n\nContinuar?`)) return;
  } else {
    if (!confirm(`Remover o insumo "${ins.nome}"?`)) return;
  }

  try {
    // Desvincula itens primeiro
    for (const it of itensVinculados) {
      await atualizarItem(it.id, { insumoId: null });
    }
    await deletarInsumo(insumoId);
    showToast(`✓ "${ins.nome}" removido`, 'success');
  } catch (e) {
    showToast('⚠ Erro: ' + e.message, 'error');
  }
}

// ============================================================================
// CONFIGURAÇÕES DE PRECIFICAÇÃO
// ============================================================================

function aplicarConfigPrecificacaoUI() {
  const sel = $('config-metodo-precificacao');
  if (!sel) return;

  sel.value = configPrecificacao.metodo || 'cmv_alvo';
  $('config-cmv-alvo').value = Math.round((configPrecificacao.cmvAlvo ?? 0.30) * 100);
  $('config-markup-fator').value = (configPrecificacao.markupFator ?? 3.0).toFixed(1);
  $('config-margem-alvo').value = Math.round((configPrecificacao.margemAlvo ?? 0.70) * 100);

  atualizarVisibilidadeCamposMetodo();
}

function atualizarVisibilidadeCamposMetodo() {
  const metodo = $('config-metodo-precificacao').value;
  $('config-campo-cmv').style.display = metodo === 'cmv_alvo' ? 'block' : 'none';
  $('config-campo-markup').style.display = metodo === 'markup' ? 'block' : 'none';
  $('config-campo-margem').style.display = metodo === 'margem' ? 'block' : 'none';
}

async function salvarConfigPrecificacao() {
  const metodo = $('config-metodo-precificacao').value;
  const cmvAlvoPct = parseFloat($('config-cmv-alvo').value);
  const markupFator = parseFloat($('config-markup-fator').value);
  const margemAlvoPct = parseFloat($('config-margem-alvo').value);
  const err = $('config-error');

  if (metodo === 'cmv_alvo' && (isNaN(cmvAlvoPct) || cmvAlvoPct < 1 || cmvAlvoPct > 99)) {
    err.textContent = 'CMV alvo deve ser entre 1 e 99 (%)';
    err.classList.add('show');
    return;
  }
  if (metodo === 'markup' && (isNaN(markupFator) || markupFator <= 0)) {
    err.textContent = 'Markup fator deve ser maior que zero';
    err.classList.add('show');
    return;
  }
  if (metodo === 'margem' && (isNaN(margemAlvoPct) || margemAlvoPct < 1 || margemAlvoPct > 99)) {
    err.textContent = 'Margem alvo deve ser entre 1 e 99 (%)';
    err.classList.add('show');
    return;
  }

  err.classList.remove('show');
  const btn = $('btn-config-salvar');
  btn.disabled = true;
  btn.textContent = 'Salvando...';

  try {
    const novaConfig = {
      metodo,
      cmvAlvo: cmvAlvoPct / 100,
      markupFator,
      margemAlvo: margemAlvoPct / 100
    };
    await setConfigPrecificacao(novaConfig);
    configPrecificacao = novaConfig;
    showToast('✓ Configurações salvas', 'success');
  } catch (e) {
    err.textContent = 'Erro: ' + e.message;
    err.classList.add('show');
  } finally {
    btn.disabled = false;
    btn.textContent = '💾 Salvar configurações';
  }
}

// ============================================================================
// RENDER: ABA FORNECEDORES
// ============================================================================

function renderFornecedores() {
  const el = $('list-fornecedores');
  $('stat-forn-total').textContent = fornecedores.length;

  const filtrados = fornecedores.filter(f => {
    if (!searchFornecedores) return true;
    const t = searchFornecedores.toLowerCase();
    return (f.nome || '').toLowerCase().includes(t)
        || (f.telefone || '').toLowerCase().includes(t)
        || (f.observacao || '').toLowerCase().includes(t);
  });

  if (!fornecedores.length) {
    el.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">🚚</div>
      <div class="empty-state-text">Nenhum fornecedor cadastrado.<br>Clique em <strong>"+ Novo Fornecedor"</strong> para começar.</div>
    </div>`;
    return;
  }

  if (!filtrados.length) {
    el.innerHTML = `<div class="empty-msg">Nenhum fornecedor encontrado para "<strong>${escHtml(searchFornecedores)}</strong>"</div>`;
    return;
  }

  let html = '<div class="section" style="border-color:var(--wine-soft)">';
  html += `<table>`;
  html += `<thead><tr>
    <th>Nome</th>
    <th>Telefone</th>
    <th>Observação</th>
    <th class="col-actions"></th>
  </tr></thead><tbody>`;

  for (const f of filtrados) {
    html += `<tr>`;
    html += `<td><strong>${escHtml(f.nome)}</strong></td>`;
    html += `<td>${escHtml(f.telefone || '—')}</td>`;
    html += `<td style="color:var(--muted);font-size:12px">${escHtml(f.observacao || '—')}</td>`;
    html += `<td class="col-actions"><span class="item-actions">`;
    html += `<button class="icon-btn edit" data-action="editar-forn" data-forn-id="${f.id}" title="Editar">✏️</button>`;
    html += `<button class="icon-btn danger" data-action="remover-forn" data-forn-id="${f.id}" title="Remover">×</button>`;
    html += `</span></td>`;
    html += `</tr>`;
  }
  html += `</tbody></table></div>`;

  el.innerHTML = html;
  $('search-forn-clear').style.display = searchFornecedores ? 'block' : 'none';
}

// ============================================================================
// RENDER: ABA EQUIPE
// ============================================================================

function renderEquipe() {
  const el = $('list-equipe');
  $('stat-equipe-total').textContent = usuarios.length;

  if (!usuarios.length) {
    el.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">👥</div>
      <div class="empty-state-text">Carregando equipe...</div>
    </div>`;
    return;
  }

  let html = '<div class="section" style="border-color:var(--wine-soft)">';
  html += `<table>`;
  html += `<thead><tr>
    <th>Nome</th>
    <th>Usuário</th>
    <th>Cargo</th>
    <th>Último login</th>
    <th class="col-actions"></th>
  </tr></thead><tbody>`;

  for (const u of usuarios) {
    const isDono = u.role === 'dono';
    const isEu = u.id === userCtx?.uid;
    let ultimoLogin = '—';
    if (u.ultimoLogin) {
      const d = u.ultimoLogin.toDate ? u.ultimoLogin.toDate() : new Date(u.ultimoLogin);
      ultimoLogin = d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    }
    html += `<tr>`;
    html += `<td><strong>${escHtml(u.nome)}</strong>${isEu ? ' <span style="color:var(--gold-dark);font-size:11px">(você)</span>' : ''}</td>`;
    html += `<td style="color:var(--muted);font-size:12px">@${escHtml(u.username)}</td>`;
    html += `<td>${isDono ? '<span style="background:var(--gold);color:var(--wine);padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700">DONO</span>' : '<span style="background:var(--wine-soft);color:var(--wine);padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600">MEMBRO</span>'}</td>`;
    html += `<td style="color:var(--muted);font-size:12px">${ultimoLogin}</td>`;
    html += `<td class="col-actions"><span class="item-actions">`;
    if (!isDono && !isEu) {
      html += `<button class="icon-btn danger" data-action="remover-membro" data-uid="${u.id}" title="Remover membro">×</button>`;
    }
    html += `</span></td>`;
    html += `</tr>`;
  }
  html += `</tbody></table></div>`;

  el.innerHTML = html;
}

// ============================================================================
// HISTÓRICO
// ============================================================================

function renderHistorico() {
  const el = $('history-list');
  if (!historico.length) {
    el.innerHTML = `<div class="history-empty">📭 Nenhuma compra finalizada ainda.<br><br>Quando finalizar uma compra na <strong>Lista Atual</strong>, ela aparecerá aqui.</div>`;
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
// EDIÇÃO DE ITEM
// ============================================================================

let itemEditandoId = null;

function abrirModalEditar(itemId) {
  const item = itens.find(i => i.id === itemId);
  if (!item) {
    showToast('⚠ Item não encontrado', 'error');
    return;
  }

  itemEditandoId = itemId;
  $('edit-id').value = itemId;
  $('edit-nome').value = item.nome || '';
  $('edit-tipo').value = item.tipo || '';
  $('edit-categoria').value = item.categoriaId || '';
  $('edit-ordem').value = item.ordem ?? 0;

  popularSelectFornecedor();
  popularSelectInsumo();

  const fornAtual = item.fornecedorPreferido || '';
  const sel = $('edit-fornecedor-select');
  const inputLivre = $('edit-fornecedor-livre');
  inputLivre.style.display = 'none';
  inputLivre.value = '';

  const fornCadastrado = fornecedores.find(f => f.nome === fornAtual);
  if (fornAtual && !fornCadastrado) {
    sel.value = '__novo__';
    inputLivre.style.display = 'block';
    inputLivre.value = fornAtual;
  } else {
    sel.value = fornAtual;
  }

  // Insumo vínculo
  $('edit-insumo-select').value = item.insumoId || '';

  // Fator de conversão (carrega do item ou usa 1)
  $('edit-fator-conversao').value = item.fatorConversao ?? 1;
  atualizarVisibilidadeCampoFator();

  $('edit-error').classList.remove('show');
  $('edit-error').textContent = '';

  $('modal-editar').classList.add('show');
  setTimeout(() => $('edit-nome').focus(), 100);
}

function fecharModalEditar() {
  $('modal-editar').classList.remove('show');
  itemEditandoId = null;
}

// Mostra/esconde o campo de Fator de Conversão conforme tem vínculo de insumo
function atualizarVisibilidadeCampoFator() {
  const insumoId = $('edit-insumo-select').value;
  const campo = $('campo-fator-conversao');

  if (!insumoId) {
    campo.style.display = 'none';
    return;
  }

  // Tem vínculo: mostra
  campo.style.display = 'block';

  // Atualiza label de unidade com a unidade do insumo selecionado
  const ins = insumos.find(i => i.id === insumoId);
  const unidade = ins?.unidade || 'KG';
  $('fator-unidade-label').textContent = unidade;
  $('fator-unidade-suffix').textContent = unidade;

  // Texto de exemplo conforme a unidade
  let exemplo = '';
  if (unidade === 'KG') {
    exemplo = 'Ex: se 1 saco contém 20 kg do insumo, digite <strong>20</strong>. Se for o mesmo (kg = kg), digite <strong>1</strong>.';
  } else if (unidade === 'LITRO') {
    exemplo = 'Ex: se 1 galão contém 5 L do insumo, digite <strong>5</strong>. Se for o mesmo (L = L), digite <strong>1</strong>.';
  } else {
    exemplo = 'Ex: se 1 cartela contém 30 unidades, digite <strong>30</strong>. Se for o mesmo (und = und), digite <strong>1</strong>.';
  }
  $('fator-exemplo').innerHTML = exemplo;
}

// Tenta extrair um número do nome do item (auto-sugestão do fator)
function detectarFatorPeloNome(nomeItem) {
  if (!nomeItem) return null;
  // Procura padrões tipo: "20kg", "20 kg", "5L", "5 L", "30un", "30 und"
  const padroes = [
    /(\d+(?:[.,]\d+)?)\s*kg/i,
    /(\d+(?:[.,]\d+)?)\s*l(?:itro)?s?\b/i,
    /(\d+(?:[.,]\d+)?)\s*(?:und|un|unid|unidades)/i,
    /\b(\d+(?:[.,]\d+)?)\b/  // último recurso: qualquer número
  ];

  for (const p of padroes) {
    const m = nomeItem.match(p);
    if (m && m[1]) {
      const valor = parseFloat(m[1].replace(',', '.'));
      if (!isNaN(valor) && valor > 0) return valor;
    }
  }
  return null;
}

// Quando o usuário troca o insumo selecionado, sugere o fator se ainda for o default
function aoMudarInsumoSelecionado() {
  atualizarVisibilidadeCampoFator();

  const insumoId = $('edit-insumo-select').value;
  if (!insumoId) return;

  // Se o fator atual é 1 (default), tenta detectar pelo nome do item
  const fatorAtual = parseFloat($('edit-fator-conversao').value);
  if (fatorAtual === 1 || isNaN(fatorAtual)) {
    const nomeItem = $('edit-nome').value;
    const tipoItem = $('edit-tipo').value;
    // Procura tanto no nome quanto no tipo
    const detectado = detectarFatorPeloNome(nomeItem + ' ' + tipoItem);
    if (detectado && detectado !== 1) {
      $('edit-fator-conversao').value = detectado;
    }
  }
}

async function salvarEdicaoItem() {
  if (!itemEditandoId) return;

  const nome = $('edit-nome').value.trim();
  const tipo = $('edit-tipo').value.trim();
  const categoriaId = $('edit-categoria').value;
  const ordemStr = $('edit-ordem').value;
  const ordem = ordemStr === '' ? 0 : parseInt(ordemStr, 10);
  const insumoId = $('edit-insumo-select').value || null;

  // Fator de conversão: só aplica se tem vínculo, senão = 1
  let fatorConversao = 1;
  if (insumoId) {
    const fatorStr = $('edit-fator-conversao').value;
    fatorConversao = parseFloat(fatorStr);
  }

  const sel = $('edit-fornecedor-select');
  const inputLivre = $('edit-fornecedor-livre');
  let fornecedor = '';
  if (sel.value === '__novo__') {
    fornecedor = inputLivre.value.trim();
  } else {
    fornecedor = sel.value;
  }

  const err = $('edit-error');

  if (!nome) {
    err.textContent = 'Nome do produto é obrigatório';
    err.classList.add('show');
    return;
  }
  if (!categoriaId) {
    err.textContent = 'Selecione uma categoria';
    err.classList.add('show');
    return;
  }
  if (isNaN(ordem) || ordem < 0) {
    err.textContent = 'Posição deve ser um número (0 ou maior)';
    err.classList.add('show');
    return;
  }
  if (insumoId && (isNaN(fatorConversao) || fatorConversao <= 0)) {
    err.textContent = 'Fator de conversão deve ser maior que zero';
    err.classList.add('show');
    return;
  }

  err.classList.remove('show');
  const btn = $('btn-edit-salvar');
  btn.disabled = true;
  btn.textContent = 'Salvando...';

  try {
    if (sel.value === '__novo__' && fornecedor) {
      const jaExiste = fornecedores.find(f => f.nome.toLowerCase() === fornecedor.toLowerCase());
      if (!jaExiste) {
        await criarFornecedor({ nome: fornecedor, telefone: '', observacao: '' });
        showToast(`✓ Novo fornecedor "${fornecedor}" cadastrado`, 'success');
      }
    }

    await atualizarItem(itemEditandoId, {
      nome,
      tipo,
      categoriaId,
      fornecedorPreferido: fornecedor,
      insumoId,
      fatorConversao,
      ordem
    });
    showToast(`✓ "${nome}" atualizado`, 'success');
    fecharModalEditar();
  } catch (e) {
    err.textContent = 'Erro ao salvar: ' + e.message;
    err.classList.add('show');
  } finally {
    btn.disabled = false;
    btn.textContent = '💾 Salvar alterações';
  }
}

// ============================================================================
// FORNECEDORES (modal CRUD)
// ============================================================================

let fornEditandoId = null;

function abrirModalFornecedor(fornId = null) {
  fornEditandoId = fornId;
  const titulo = fornId ? '✏️ Editar Fornecedor' : '🚚 Novo Fornecedor';
  $('modal-forn-title').textContent = titulo;

  if (fornId) {
    const f = fornecedores.find(x => x.id === fornId);
    if (!f) {
      showToast('⚠ Fornecedor não encontrado', 'error');
      return;
    }
    $('forn-id').value = fornId;
    $('forn-nome').value = f.nome || '';
    $('forn-telefone').value = f.telefone || '';
    $('forn-obs').value = f.observacao || '';
  } else {
    $('forn-id').value = '';
    $('forn-nome').value = '';
    $('forn-telefone').value = '';
    $('forn-obs').value = '';
  }

  $('forn-error').classList.remove('show');
  $('forn-error').textContent = '';

  $('modal-fornecedor').classList.add('show');
  setTimeout(() => $('forn-nome').focus(), 100);
}

function fecharModalFornecedor() {
  $('modal-fornecedor').classList.remove('show');
  fornEditandoId = null;
}

async function salvarFornecedor() {
  const nome = $('forn-nome').value.trim();
  const telefone = $('forn-telefone').value.trim();
  const observacao = $('forn-obs').value.trim();

  const err = $('forn-error');

  if (!nome) {
    err.textContent = 'Nome do fornecedor é obrigatório';
    err.classList.add('show');
    return;
  }

  err.classList.remove('show');
  const btn = $('btn-forn-salvar');
  btn.disabled = true;
  btn.textContent = 'Salvando...';

  try {
    if (fornEditandoId) {
      await atualizarFornecedor(fornEditandoId, { nome, telefone, observacao });
      showToast(`✓ "${nome}" atualizado`, 'success');
    } else {
      const jaExiste = fornecedores.find(f => f.nome.toLowerCase() === nome.toLowerCase());
      if (jaExiste) {
        err.textContent = 'Já existe um fornecedor com esse nome';
        err.classList.add('show');
        btn.disabled = false;
        btn.textContent = '💾 Salvar';
        return;
      }
      await criarFornecedor({ nome, telefone, observacao });
      showToast(`✓ "${nome}" cadastrado`, 'success');
    }
    fecharModalFornecedor();
  } catch (e) {
    err.textContent = 'Erro: ' + e.message;
    err.classList.add('show');
  } finally {
    btn.disabled = false;
    btn.textContent = '💾 Salvar';
  }
}

async function removerFornecedor(fornId) {
  const f = fornecedores.find(x => x.id === fornId);
  if (!f) return;

  const itensComFornecedor = itens.filter(i => i.fornecedorPreferido === f.nome);
  let msg = `Remover "${f.nome}"?`;
  if (itensComFornecedor.length > 0) {
    msg += `\n\n⚠ ${itensComFornecedor.length} item(ns) usam esse fornecedor. Eles ficarão sem fornecedor preferido.`;
  }

  if (!confirm(msg)) return;

  try {
    await deletarFornecedor(fornId);
    showToast(`✓ "${f.nome}" removido`, 'success');
  } catch (e) {
    showToast('⚠ Erro: ' + e.message, 'error');
  }
}

// ============================================================================
// MEMBROS (modal)
// ============================================================================

function abrirModalMembro() {
  if (userCtx?.role !== 'dono') {
    showToast('⚠ Apenas o dono pode criar novos membros', 'error');
    return;
  }
  $('membro-nome').value = '';
  $('membro-username').value = '';
  $('membro-pin').value = '';
  $('membro-error').classList.remove('show');
  $('membro-error').textContent = '';
  $('modal-membro').classList.add('show');
  setTimeout(() => $('membro-nome').focus(), 100);
}

function fecharModalMembro() {
  $('modal-membro').classList.remove('show');
}

async function salvarNovoMembro() {
  const nome = $('membro-nome').value.trim();
  const username = $('membro-username').value.trim();
  const pin = $('membro-pin').value.trim();
  const err = $('membro-error');

  if (!nome) {
    err.textContent = 'Nome é obrigatório';
    err.classList.add('show');
    return;
  }
  if (!username) {
    err.textContent = 'Usuário é obrigatório';
    err.classList.add('show');
    return;
  }
  if (!/^\d{4}$/.test(pin)) {
    err.textContent = 'PIN deve ter exatamente 4 dígitos numéricos';
    err.classList.add('show');
    return;
  }

  err.classList.remove('show');
  const btn = $('btn-membro-salvar');
  btn.disabled = true;
  btn.textContent = 'Criando...';

  try {
    await criarMembro({ nome, username, pin, role: 'membro' });
    fecharModalMembro();
    showToast(`✓ Membro "${nome}" criado! Refazendo login...`, 'success');
    setTimeout(() => location.reload(), 2000);
  } catch (e) {
    err.textContent = 'Erro: ' + e.message;
    err.classList.add('show');
    btn.disabled = false;
    btn.textContent = '+ Criar Membro';
  }
}

async function removerMembro(uid) {
  if (userCtx?.role !== 'dono') {
    showToast('⚠ Apenas o dono pode remover membros', 'error');
    return;
  }
  const u = usuarios.find(x => x.id === uid);
  if (!u) return;
  if (u.role === 'dono') {
    showToast('⚠ Não é possível remover o dono', 'error');
    return;
  }
  if (!confirm(`Remover o membro "${u.nome}"?\n\nA conta dele(a) será desativada e ele(a) não conseguirá mais fazer login.`)) return;

  try {
    await deletarUsuario(uid);
    showToast(`✓ "${u.nome}" removido`, 'success');
  } catch (e) {
    showToast('⚠ Erro: ' + e.message, 'error');
  }
}

// ============================================================================
// ADICIONAR ITEM À LISTA ATUAL
// ============================================================================

function abrirModalAddAtual() {
  if (!temListaAtualAtiva()) {
    showToast('⚠ Não há lista atual em andamento', 'error');
    return;
  }
  $('search-add-atual').value = '';
  searchAddAtual = '';
  $('add-atual-novo-form').style.display = 'none';
  $('add-atual-nome').value = '';
  $('add-atual-tipo').value = '';
  $('add-atual-error').classList.remove('show');
  $('add-atual-error').textContent = '';
  $('modal-add-atual').classList.add('show');
  renderResultadosAddAtual();
  setTimeout(() => $('search-add-atual').focus(), 100);
}

function fecharModalAddAtual() {
  $('modal-add-atual').classList.remove('show');
}

function renderResultadosAddAtual() {
  const el = $('add-atual-resultados');
  if (!el) return;

  const itensDisponiveis = itens.filter(i => !listaAtualMap[i.id]);

  const filtrados = itensDisponiveis.filter(i => {
    if (!searchAddAtual) return true;
    return matchesSearch(i, searchAddAtual);
  });

  if (!filtrados.length) {
    if (searchAddAtual) {
      el.innerHTML = `<div style="padding:24px;text-align:center;color:var(--muted);font-size:13px">
        Nenhum item encontrado para "<strong>${escHtml(searchAddAtual)}</strong>"<br>
        <span style="font-size:11px">Use o botão abaixo para criar um item novo.</span>
      </div>`;
    } else if (!itensDisponiveis.length) {
      el.innerHTML = `<div style="padding:24px;text-align:center;color:var(--muted);font-size:13px">
        Todos os itens do catálogo já estão na lista atual.<br>
        <span style="font-size:11px">Use o botão abaixo para criar um item novo.</span>
      </div>`;
    } else {
      el.innerHTML = `<div style="padding:24px;text-align:center;color:var(--muted);font-size:13px">
        Digite no campo acima para buscar um item.
      </div>`;
    }
    $('search-add-atual-clear').style.display = searchAddAtual ? 'block' : 'none';
    return;
  }

  let html = '<table>';
  html += `<thead><tr>
    <th class="col-item">Item</th>
    <th>Categoria</th>
    <th class="col-tipo">Tipo</th>
    <th style="text-align:right">Méd. ${mediaN}</th>
    <th style="text-align:right">Última</th>
    <th class="col-actions"></th>
  </tr></thead><tbody>`;

  const limited = filtrados.slice(0, 30);

  for (const item of limited) {
    const cat = categorias.find(c => c.id === item.categoriaId);
    const media = calcularMediaPrecos(item, mediaN);
    const ultimo = item.ultimoPreco;

    html += `<tr>`;
    html += `<td class="col-item"><strong>${escHtml(item.nome)}</strong></td>`;
    html += `<td style="font-size:11px;color:${escHtml(cat?.cor || '#999')};font-weight:600">${escHtml(cat?.nome || '?')}</td>`;
    html += `<td class="col-tipo">${escHtml(item.tipo || '—')}</td>`;
    html += `<td style="text-align:right;font-size:12px">${media ? `<span style="color:var(--wine);font-weight:600">${fmtMoeda(media)}</span>` : `<span style="color:#bbb">—</span>`}</td>`;
    html += `<td style="text-align:right;font-size:12px">${ultimo ? `<span style="color:var(--wine);font-weight:600">${fmtMoeda(ultimo)}</span>` : `<span style="color:#bbb">—</span>`}</td>`;
    html += `<td class="col-actions"><button class="btn btn-sm btn-primary" data-action="add-to-atual" data-item-id="${item.id}">+ Add</button></td>`;
    html += `</tr>`;
  }

  if (filtrados.length > 30) {
    html += `<tr><td colspan="6" style="text-align:center;color:var(--muted);font-size:11px;padding:8px">+ ${filtrados.length - 30} resultados. Refine a busca para ver mais.</td></tr>`;
  }

  html += `</tbody></table>`;
  el.innerHTML = html;
  $('search-add-atual-clear').style.display = searchAddAtual ? 'block' : 'none';
}

async function adicionarItemDoCatalogoAtual(itemId) {
  const item = itens.find(i => i.id === itemId);
  if (!item) return;
  try {
    await adicionarItemListaAtual(itemId, 0);
    showToast(`✓ "${item.nome}" adicionado à lista`, 'success');
  } catch (e) {
    showToast('⚠ ' + e.message, 'error');
  }
}

async function criarItemENoAtual() {
  const nome = $('add-atual-nome').value.trim();
  const tipo = $('add-atual-tipo').value.trim();
  const catId = $('add-atual-cat').value;
  const err = $('add-atual-error');

  if (!nome) {
    err.textContent = 'Nome do produto é obrigatório';
    err.classList.add('show');
    return;
  }
  if (!catId) {
    err.textContent = 'Selecione uma categoria';
    err.classList.add('show');
    return;
  }

  err.classList.remove('show');
  const btn = $('btn-add-atual-criar');
  btn.disabled = true;
  btn.textContent = 'Salvando...';

  try {
    const itensCat = itens.filter(i => i.categoriaId === catId);
    const proxOrdem = itensCat.length;

    const novoId = await criarItem({ nome, tipo, categoriaId: catId, ordem: proxOrdem });
    await adicionarItemListaAtual(novoId, 0);

    showToast(`✓ "${nome}" criado e adicionado à lista`, 'success');
    fecharModalAddAtual();
  } catch (e) {
    err.textContent = 'Erro: ' + e.message;
    err.classList.add('show');
  } finally {
    btn.disabled = false;
    btn.textContent = '+ Cadastrar e adicionar à lista';
  }
}

// ============================================================================
// AÇÕES
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

async function atualizarQtdCriar(itemId, valor) {
  try { await setItemListaEmCriacao(itemId, valor); }
  catch (e) { showToast('⚠ Erro: ' + e.message, 'error'); }
}

async function atualizarPrecoAtual(itemId, valor) {
  try { await atualizarPrecoListaAtual(itemId, valor); }
  catch (e) { showToast('⚠ Erro: ' + e.message, 'error'); }
}

async function atualizarQtdAtual(itemId, valor) {
  try { await atualizarQtdListaAtual(itemId, valor); }
  catch (e) { showToast('⚠ Erro: ' + e.message, 'error'); }
}

async function toggleComprado(itemId, comprado) {
  try { await atualizarCompradoListaAtual(itemId, comprado); }
  catch (e) { showToast('⚠ Erro: ' + e.message, 'error'); }
}

async function removerDaListaAtual(itemId) {
  const item = itens.find(i => i.id === itemId);
  if (!item) return;
  if (!confirm(`Remover "${item.nome}" desta compra?\n\n(O item continua no catálogo para próximas listas.)`)) return;
  try {
    await removerItemListaAtual(itemId);
    showToast(`✓ "${item.nome}" removido da lista`, 'success');
  } catch (e) {
    showToast('⚠ Erro: ' + e.message, 'error');
  }
}

function toggleCatCriar(catId) {
  collapsedCriar[catId] = !collapsedCriar[catId];
  renderListaCriar();
}

function toggleCatAtual(catId) {
  collapsedAtual[catId] = !collapsedAtual[catId];
  renderListaAtual();
}

function expandirOuRecolherCriar(expandir) {
  if (expandir) collapsedCriar = {};
  else categorias.forEach(c => collapsedCriar[c.id] = true);
  renderListaCriar();
}

function expandirOuRecolherAtual(expandir) {
  if (expandir) collapsedAtual = {};
  else categorias.forEach(c => collapsedAtual[c.id] = true);
  renderListaAtual();
}

async function removerItem(itemId) {
  const item = itens.find(i => i.id === itemId);
  if (!item) return;
  if (!confirm(`Remover "${item.nome}" do catálogo?`)) return;
  try {
    await deletarItem(itemId);
    showToast('✓ Item removido', 'success');
  } catch (e) {
    showToast('⚠ Erro: ' + e.message, 'error');
  }
}

async function tratarLimparCriar() {
  const total = Object.keys(listaEmCriacaoMap).length;
  if (total === 0) {
    showToast('Lista já está vazia');
    return;
  }
  if (!confirm(`Limpar todas as ${total} quantidades preenchidas?`)) return;
  try {
    await limparListaEmCriacao();
    showToast('✓ Limpo', 'success');
  } catch (e) {
    showToast('⚠ Erro: ' + e.message, 'error');
  }
}

// ============================================================================
// SALVAR LISTA
// ============================================================================

function abrirModalSalvar() {
  if (temListaAtualAtiva()) {
    showToast('⚠ Você tem uma Lista Atual em andamento. Finalize antes.', 'error');
    return;
  }
  if (Object.keys(listaEmCriacaoMap).length === 0) {
    showToast('⚠ Lista vazia. Preencha quantidades antes.', 'error');
    return;
  }
  $('modal-salvar').classList.add('show');
}

function fecharModalSalvar() {
  $('modal-salvar').classList.remove('show');
}

async function tratarSalvar(comPdf) {
  fecharModalSalvar();

  if (comPdf) {
    gerarPdfLista('criacao');
  }

  try {
    const qtdItens = await salvarListaParaAtual();
    showToast(`✓ Lista salva (${qtdItens} itens)`, 'success');
    setTimeout(() => switchTab('atual'), 400);
  } catch (e) {
    showToast('⚠ ' + e.message, 'error');
  }
}

// ============================================================================
// REIMPRIMIR
// ============================================================================

function tratarReimprimir() {
  if (!Object.keys(listaAtualMap).length) {
    showToast('⚠ Não há lista atual para reimprimir', 'error');
    return;
  }
  gerarPdfLista('atual');
}

// ============================================================================
// PDF
// ============================================================================

function gerarPdfLista(origem = 'criacao') {
  const hoje = new Date();
  const dd = String(hoje.getDate()).padStart(2, '0');
  const mm = String(hoje.getMonth() + 1).padStart(2, '0');
  const aaaa = hoje.getFullYear();
  const nomeArquivo = `Lista_Compras_${dd}-${mm}-${aaaa}`;

  const getQtdParaPdf = (itemId) => {
    if (origem === 'atual') {
      return parseFloat(listaAtualMap[itemId]?.qtd || 0);
    }
    return getQtdEmCriacao(itemId);
  };

  const w = window.open('', '_blank');
  let html = `
    <html>
    <head>
      <title>${nomeArquivo}</title>
      <style>
        @page { margin: 1cm; size: A4; }
        body { font-family: Arial, sans-serif; font-size: 10px; color: #222; }
        h1 { color: #7A1F38; font-size: 16px; margin-bottom: 2px; border-bottom: 2px solid #E9A93A; padding-bottom: 4px; }
        .subtitle { font-size: 9px; color: #888; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 10px; }
        h2 { color: #fff; background: #7A1F38; padding: 4px 8px; font-size: 11px; margin-top: 8px; margin-bottom: 0; }
        table { width: 100%; border-collapse: collapse; }
        th { background: #faf6f3; font-size: 9px; text-transform: uppercase; padding: 3px 6px; border-bottom: 1px solid #ddd; color: #888; font-weight: 700; }
        td { padding: 3px 6px; border-bottom: 1px solid #eee; font-size: 10px; }
        .col-item { text-align: left; width: 38%; }
        .col-tipo { text-align: right; width: 10%; }
        .col-media { text-align: right; width: 12%; color: #888; font-size: 9px; }
        .col-ultimo { text-align: right; width: 12%; color: #888; font-size: 9px; }
        .col-qtd { text-align: right; width: 10%; font-weight: 700; color: #7A1F38; }
        .col-pago { text-align: right; width: 18%; }
        .preco-blank { border-bottom: 1px solid #999; display: inline-block; width: 70px; }
        .total { margin-top: 12px; padding: 8px 12px; background: #fdf4e0; border-left: 3px solid #E9A93A; font-size: 11px; }
        .total strong { color: #c98e1f; }
        .footer { margin-top: 14px; font-size: 8px; color: #888; text-align: center; border-top: 1px solid #ddd; padding-top: 6px; }
      </style>
    </head>
    <body>
      <h1>Peixaria Primus — Lista de Compras</h1>
      <div class="subtitle">${hoje.toLocaleDateString('pt-BR')} · ${hoje.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</div>
  `;

  let totalEstimado = 0;
  let totalItens = 0;

  for (const cat of categorias) {
    const itensCat = itens
      .filter(i => i.categoriaId === cat.id && getQtdParaPdf(i.id) > 0)
      .sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
    if (itensCat.length === 0) continue;

    html += `<h2 style="background:${cat.cor}">${escHtml(cat.nome)}</h2>`;
    html += `<table>`;
    html += `<thead><tr>
      <th class="col-item">Item</th>
      <th class="col-tipo">Tipo</th>
      <th class="col-media">Méd. ${mediaN}</th>
      <th class="col-ultimo">Última</th>
      <th class="col-qtd">Qtd</th>
      <th class="col-pago">Preço pago</th>
    </tr></thead><tbody>`;

    for (const item of itensCat) {
      const qtd = getQtdParaPdf(item.id);
      const media = calcularMediaPrecos(item, mediaN);
      const ultimo = item.ultimoPreco;
      const ref = media || ultimo || 0;
      totalEstimado += qtd * ref;
      totalItens++;

      html += `<tr>
        <td class="col-item">${escHtml(item.nome)}</td>
        <td class="col-tipo">${escHtml(item.tipo || '—')}</td>
        <td class="col-media">${media ? fmtMoeda(media) : '—'}</td>
        <td class="col-ultimo">${ultimo ? fmtMoeda(ultimo) : '—'}</td>
        <td class="col-qtd">${qtd}</td>
        <td class="col-pago"><span class="preco-blank"></span></td>
      </tr>`;
    }

    html += `</tbody></table>`;
  }

  html += `
    <div class="total">
      <strong>${totalItens} itens</strong> · Estimativa baseada em médias: <strong>${fmtMoeda(totalEstimado)}</strong>
    </div>
    <div class="footer">Peixaria Primus · Cuiabá/MT</div>
    <script>document.title = '${nomeArquivo}';</script>
    </body></html>
  `;

  w.document.write(html);
  w.document.close();
  setTimeout(() => w.print(), 500);
}

// ============================================================================
// FINALIZAR COMPRA
// ============================================================================

async function tratarFinalizarCompra() {
  const itensEnriquecidos = [];
  let total = 0;

  for (const item of itens) {
    const estado = listaAtualMap[item.id];
    if (!estado) continue;
    const qtd = parseFloat(estado.qtd) || 0;
    const preco = parseFloat(estado.preco) || 0;
    if (qtd <= 0) continue;
    const cat = categorias.find(c => c.id === item.categoriaId);
    const sub = qtd * preco;
    itensEnriquecidos.push({
      itemId: item.id,
      nome: item.nome,
      tipo: item.tipo || '',
      categoriaId: item.categoriaId,
      categoriaNome: cat?.nome || '?',
      categoriaCor: cat?.cor || '#7A1F38',
      qtd, preco, subtotal: sub,
      comprado: !!estado.comprado,
      fornecedor: item.fornecedorPreferido || '',
      insumoId: item.insumoId || null
    });
    total += sub;
  }

  if (!itensEnriquecidos.length) {
    showToast('⚠ Nenhum item com quantidade na lista', 'error');
    return;
  }

  const semPreco = itensEnriquecidos.filter(i => !i.preco).length;
  let msg = `Finalizar compra com ${itensEnriquecidos.length} itens (${fmtMoeda(total)})?`;
  if (semPreco > 0) {
    msg += `\n\n⚠ Atenção: ${semPreco} itens sem preço preenchido.`;
  }
  msg += '\n\nA lista será arquivada no histórico.';

  if (!confirm(msg)) return;

  try {
    await finalizarCompra(itensEnriquecidos, total);
    showToast('✓ Compra finalizada e arquivada', 'success');
    setTimeout(() => switchTab('historico'), 400);
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
  $('tab-criar').style.display = tab === 'criar' ? 'block' : 'none';
  $('tab-atual').style.display = tab === 'atual' ? 'block' : 'none';
  $('tab-historico').style.display = tab === 'historico' ? 'block' : 'none';
  $('tab-fornecedores').style.display = tab === 'fornecedores' ? 'block' : 'none';
  $('tab-cardapio').style.display = tab === 'cardapio' ? 'block' : 'none';
  $('tab-equipe').style.display = tab === 'equipe' ? 'block' : 'none';
  if (tab === 'historico') renderHistorico();
  if (tab === 'fornecedores') renderFornecedores();
  if (tab === 'cardapio') {
    switchSubTabCardapio(currentSubTabCardapio || 'insumos');
  }
  if (tab === 'equipe') renderEquipe();
}

// ============================================================================
// EVENTOS
// ============================================================================

function setupEventos() {
  $('btn-login').addEventListener('click', tratarLogin);
  $('login-pin').addEventListener('keydown', e => { if (e.key === 'Enter') tratarLogin(); });
  $('login-username').addEventListener('keydown', e => { if (e.key === 'Enter') $('login-pin').focus(); });
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

  // Sub-navegação do Cardápio
  document.querySelectorAll('.sub-nav-btn').forEach(b => {
    b.addEventListener('click', () => switchSubTabCardapio(b.dataset.subtab));
  });

  $('btn-criar-recolher').addEventListener('click', () => expandirOuRecolherCriar(false));
  $('btn-criar-expandir').addEventListener('click', () => expandirOuRecolherCriar(true));
  $('btn-criar-limpar').addEventListener('click', tratarLimparCriar);
  $('btn-salvar-lista').addEventListener('click', abrirModalSalvar);
  $('btn-add-item').addEventListener('click', adicionarItem);
  ['new-name', 'new-tipo'].forEach(id => {
    $(id).addEventListener('keydown', e => { if (e.key === 'Enter') adicionarItem(); });
  });
  $('search-criar').addEventListener('input', e => {
    searchCriar = e.target.value.trim();
    renderListaCriar();
  });
  $('search-criar-clear').addEventListener('click', () => {
    $('search-criar').value = '';
    searchCriar = '';
    renderListaCriar();
  });

  $('media-n').addEventListener('change', async e => {
    mediaN = parseInt(e.target.value, 10) || 5;
    try {
      await setConfigMediaN(mediaN);
      renderTudo();
      showToast(`✓ Média configurada para ${mediaN} compras`, 'success');
    } catch (e) {
      showToast('⚠ Erro: ' + e.message, 'error');
    }
  });

  $('btn-atual-recolher').addEventListener('click', () => expandirOuRecolherAtual(false));
  $('btn-atual-expandir').addEventListener('click', () => expandirOuRecolherAtual(true));
  $('btn-reimprimir').addEventListener('click', tratarReimprimir);
  $('btn-add-item-atual').addEventListener('click', abrirModalAddAtual);
  $('btn-finalizar').addEventListener('click', tratarFinalizarCompra);
  $('search-atual').addEventListener('input', e => {
    searchAtual = e.target.value.trim();
    renderListaAtual();
  });
  $('search-atual-clear').addEventListener('click', () => {
    $('search-atual').value = '';
    searchAtual = '';
    renderListaAtual();
  });

  // Insumos
  $('btn-novo-insumo').addEventListener('click', () => abrirModalInsumo());
  $('search-insumos').addEventListener('input', e => {
    searchInsumos = e.target.value.trim();
    renderInsumos();
  });
  $('search-insumos-clear').addEventListener('click', () => {
    $('search-insumos').value = '';
    searchInsumos = '';
    renderInsumos();
  });
  $('btn-insumo-salvar').addEventListener('click', salvarInsumo);
  $('btn-insumo-cancelar').addEventListener('click', fecharModalInsumo);
  ['insumo-nome', 'insumo-fc', 'insumo-categoria', 'insumo-fornecedor'].forEach(id => {
    $(id).addEventListener('keydown', e => { if (e.key === 'Enter') salvarInsumo(); });
  });

  // Quando muda unidade, atualiza label /kg /L /und ao lado do preço
  $('insumo-unidade').addEventListener('change', atualizarUnidadePrecoLabel);

  // Quando digita preço, atualiza badge ao vivo
  $('insumo-preco').addEventListener('input', () => {
    const valor = parseFloat($('insumo-preco').value);
    if (!isNaN(valor) && valor > 0) {
      // Se editando e o preço não mudou, mantém a badge original
      const original = window._precoInsumoOriginal;
      if (insumoEditandoId && original !== null && Math.abs((original || 0) - valor) < 0.001) {
        const insumoAtual = insumos.find(i => i.id === insumoEditandoId);
        atualizarBadgeOrigem(insumoAtual?.origemPreco || 'manual');
      } else {
        atualizarBadgeOrigem('manual');
        // Auto-preenche data de hoje se estiver vazia (preço mudou ou novo)
        if (!$('insumo-data-cotacao').value) {
          const hoje = new Date();
          const ano = hoje.getFullYear();
          const mes = String(hoje.getMonth() + 1).padStart(2, '0');
          const dia = String(hoje.getDate()).padStart(2, '0');
          $('insumo-data-cotacao').value = `${ano}-${mes}-${dia}`;
        }
      }
    } else {
      atualizarBadgeOrigem(null);
    }
  });
  $('list-insumos').addEventListener('click', e => {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    if (target.dataset.action === 'editar-insumo') abrirModalInsumo(target.dataset.insumoId);
    else if (target.dataset.action === 'remover-insumo') removerInsumo(target.dataset.insumoId);
  });

  // === FICHAS TÉCNICAS ===
  $('btn-nova-ficha').addEventListener('click', () => abrirModalFicha());
  $('filtro-fichas').addEventListener('change', e => {
    filtroFichas = e.target.value;
    renderFichas();
  });
  $('search-fichas').addEventListener('input', e => {
    searchFichas = e.target.value.trim();
    renderFichas();
  });
  $('search-fichas-clear').addEventListener('click', () => {
    $('search-fichas').value = '';
    searchFichas = '';
    renderFichas();
  });
  $('list-fichas').addEventListener('click', e => {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    if (target.dataset.action === 'editar-ficha') abrirModalFicha(target.dataset.fichaId);
    else if (target.dataset.action === 'remover-ficha') removerFicha(target.dataset.fichaId);
    else if (target.dataset.action === 'imprimir-ficha') imprimirFichaIndividual(target.dataset.fichaId);
  });

  // Modal de ficha - botões
  $('btn-ficha-salvar').addEventListener('click', salvarFicha);
  $('btn-ficha-cancelar').addEventListener('click', fecharModalFicha);
  $('btn-add-ingrediente').addEventListener('click', adicionarIngrediente);

  // Relatório de fichas (Ideia 2)
  $('btn-imprimir-relatorio').addEventListener('click', imprimirRelatorio);

  // Modal de ficha - inputs principais (atualizam painel ao vivo)
  // Função única: lê todos os campos da UI e atualiza fichaEmEdicao + painel
  function sincronizarCamposFicha() {
    if (!fichaEmEdicao) return;
    fichaEmEdicao.rendimento = parseFloat($('ficha-rendimento').value) || 1;
    fichaEmEdicao.unidadeRendimento = $('ficha-unidade-rendimento').value;

    // Tamanho da porção (null se unidade for PORCOES ou vazio)
    if (fichaEmEdicao.unidadeRendimento === 'PORCOES') {
      fichaEmEdicao.tamanhoPorcao = null;
    } else {
      const tam = parseFloat($('ficha-tamanho-porcao').value);
      fichaEmEdicao.tamanhoPorcao = (!isNaN(tam) && tam > 0) ? tam : null;
    }

    fichaEmEdicao.precoVenda = parseFloat($('ficha-preco-venda').value) || 0;
    const cmvPct = parseFloat($('ficha-cmv-custom').value);
    fichaEmEdicao.cmvAlvoCustom = isNaN(cmvPct) ? null : (cmvPct / 100);

    atualizarVisibilidadeTamanhoPorcao();
    atualizarPainelPrecificacao();
  }

  ['ficha-rendimento', 'ficha-unidade-rendimento', 'ficha-tamanho-porcao', 'ficha-preco-venda', 'ficha-cmv-custom'].forEach(id => {
    const el = $(id);
    if (el) {
      el.addEventListener('input', sincronizarCamposFicha);
      el.addEventListener('change', sincronizarCamposFicha);
    }
  });

  // Modal de ficha - container de ingredientes (delegação)
  $('ingredientes-container').addEventListener('click', e => {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    if (target.dataset.action === 'remover-ing') {
      removerIngrediente(parseInt(target.dataset.idx, 10));
    }
  });

  $('ingredientes-container').addEventListener('change', e => {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    const idx = parseInt(target.dataset.idx, 10);
    if (target.dataset.action === 'update-ing-insumo') {
      atualizarIngredienteInsumo(idx, target.value);
    } else if (target.dataset.action === 'update-ing-peso') {
      atualizarIngredientePeso(idx, target.value);
    }
  });

  $('ingredientes-container').addEventListener('input', e => {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    const idx = parseInt(target.dataset.idx, 10);
    if (target.dataset.action === 'update-ing-peso') {
      atualizarIngredientePeso(idx, target.value);
    }
  });

  // Click outside modal-ficha
  $('modal-ficha').addEventListener('click', e => {
    if (e.target.id === 'modal-ficha') fecharModalFicha();
  });

  // Configurações de precificação
  $('config-metodo-precificacao').addEventListener('change', atualizarVisibilidadeCamposMetodo);
  $('btn-config-salvar').addEventListener('click', salvarConfigPrecificacao);

  // Modal Adicionar à Lista Atual
  $('search-add-atual').addEventListener('input', e => {
    searchAddAtual = e.target.value.trim();
    renderResultadosAddAtual();
  });
  $('search-add-atual-clear').addEventListener('click', () => {
    $('search-add-atual').value = '';
    searchAddAtual = '';
    renderResultadosAddAtual();
    $('search-add-atual').focus();
  });
  $('btn-toggle-novo-item').addEventListener('click', () => {
    const form = $('add-atual-novo-form');
    const visible = form.style.display !== 'none';
    form.style.display = visible ? 'none' : 'block';
    if (!visible) {
      if (searchAddAtual) $('add-atual-nome').value = searchAddAtual;
      setTimeout(() => $('add-atual-nome').focus(), 100);
    }
  });
  $('btn-add-atual-criar').addEventListener('click', criarItemENoAtual);
  ['add-atual-nome', 'add-atual-tipo'].forEach(id => {
    $(id).addEventListener('keydown', e => { if (e.key === 'Enter') criarItemENoAtual(); });
  });

  // Gerenciar Categorias
  $('btn-gerenciar-cats').addEventListener('click', abrirModalCategorias);
  $('btn-cat-salvar').addEventListener('click', salvarCategoria);
  $('btn-cat-cancelar').addEventListener('click', resetarFormularioCategoria);
  $('cat-nome').addEventListener('keydown', e => { if (e.key === 'Enter') salvarCategoria(); });
  document.querySelectorAll('#cat-color-palette .color-option').forEach(opt => {
    opt.addEventListener('click', () => {
      catCorSelecionada = opt.dataset.cor;
      atualizarCoresSelecionada();
    });
  });
  $('cats-list').addEventListener('click', e => {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    if (target.dataset.action === 'editar-cat') editarCategoria(target.dataset.catId);
    else if (target.dataset.action === 'remover-cat') removerCategoria(target.dataset.catId);
  });

  $('btn-novo-fornecedor').addEventListener('click', () => abrirModalFornecedor());
  $('search-fornecedores').addEventListener('input', e => {
    searchFornecedores = e.target.value.trim();
    renderFornecedores();
  });
  $('search-forn-clear').addEventListener('click', () => {
    $('search-fornecedores').value = '';
    searchFornecedores = '';
    renderFornecedores();
  });

  $('btn-novo-membro').addEventListener('click', abrirModalMembro);

  $('btn-salvar-com-pdf').addEventListener('click', () => tratarSalvar(true));
  $('btn-salvar-sem-pdf').addEventListener('click', () => tratarSalvar(false));

  $('btn-edit-salvar').addEventListener('click', salvarEdicaoItem);
  $('btn-edit-cancelar').addEventListener('click', fecharModalEditar);

  $('btn-forn-salvar').addEventListener('click', salvarFornecedor);
  $('btn-forn-cancelar').addEventListener('click', fecharModalFornecedor);

  $('btn-membro-salvar').addEventListener('click', salvarNovoMembro);
  $('btn-membro-cancelar').addEventListener('click', fecharModalMembro);

  $('edit-fornecedor-select').addEventListener('change', e => {
    const inputLivre = $('edit-fornecedor-livre');
    if (e.target.value === '__novo__') {
      inputLivre.style.display = 'block';
      inputLivre.focus();
    } else {
      inputLivre.style.display = 'none';
      inputLivre.value = '';
    }
  });

  // Vínculo de insumo: mostra/esconde campo de fator + auto-detecta
  $('edit-insumo-select').addEventListener('change', aoMudarInsumoSelecionado);

  document.querySelectorAll('[data-close-modal]').forEach(b => {
    b.addEventListener('click', () => {
      $(b.dataset.closeModal).classList.remove('show');
    });
  });
  $('modal-salvar').addEventListener('click', e => { if (e.target.id === 'modal-salvar') fecharModalSalvar(); });
  $('modal-editar').addEventListener('click', e => { if (e.target.id === 'modal-editar') fecharModalEditar(); });
  $('modal-fornecedor').addEventListener('click', e => { if (e.target.id === 'modal-fornecedor') fecharModalFornecedor(); });
  $('modal-membro').addEventListener('click', e => { if (e.target.id === 'modal-membro') fecharModalMembro(); });
  $('modal-add-atual').addEventListener('click', e => { if (e.target.id === 'modal-add-atual') fecharModalAddAtual(); });
  $('modal-categorias').addEventListener('click', e => { if (e.target.id === 'modal-categorias') fecharModalCategorias(); });
  $('modal-insumo').addEventListener('click', e => { if (e.target.id === 'modal-insumo') fecharModalInsumo(); });

  $('list-criar').addEventListener('change', e => {
    const action = e.target.dataset.action;
    const itemId = e.target.dataset.itemId;
    if (!action || !itemId) return;
    if (action === 'update-qtd-criar') atualizarQtdCriar(itemId, e.target.value);
  });
  $('list-criar').addEventListener('click', e => {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    const itemId = target.dataset.itemId;
    if (action === 'toggle-cat-criar') toggleCatCriar(target.dataset.catId);
    else if (action === 'remover-item') removerItem(itemId);
    else if (action === 'editar-item') abrirModalEditar(itemId);
  });

  $('list-atual').addEventListener('change', e => {
    const action = e.target.dataset.action;
    const itemId = e.target.dataset.itemId;
    if (!action || !itemId) return;
    if (action === 'update-qtd-atual') atualizarQtdAtual(itemId, e.target.value);
    else if (action === 'update-preco-atual') atualizarPrecoAtual(itemId, e.target.value);
    else if (action === 'toggle-comprado') toggleComprado(itemId, e.target.checked);
  });
  $('list-atual').addEventListener('click', e => {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    const itemId = target.dataset.itemId;
    if (action === 'toggle-cat-atual') toggleCatAtual(target.dataset.catId);
    else if (action === 'remover-da-atual') removerDaListaAtual(itemId);
    else if (action === 'editar-item') abrirModalEditar(itemId);
  });

  $('add-atual-resultados').addEventListener('click', e => {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    if (target.dataset.action === 'add-to-atual') {
      adicionarItemDoCatalogoAtual(target.dataset.itemId);
    }
  });

  $('history-list').addEventListener('click', e => {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    if (target.dataset.action === 'ver-compra') verCompra(target.dataset.histId);
    else if (target.dataset.action === 'excluir-compra') excluirCompraConfirm(target.dataset.histId);
  });

  $('list-fornecedores').addEventListener('click', e => {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    if (target.dataset.action === 'editar-forn') abrirModalFornecedor(target.dataset.fornId);
    else if (target.dataset.action === 'remover-forn') removerFornecedor(target.dataset.fornId);
  });

  $('list-equipe').addEventListener('click', e => {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    if (target.dataset.action === 'remover-membro') removerMembro(target.dataset.uid);
  });

  ['edit-nome', 'edit-tipo', 'edit-fornecedor-livre', 'edit-ordem'].forEach(id => {
    $(id).addEventListener('keydown', e => { if (e.key === 'Enter') salvarEdicaoItem(); });
  });

  ['forn-nome', 'forn-telefone', 'forn-obs'].forEach(id => {
    $(id).addEventListener('keydown', e => { if (e.key === 'Enter') salvarFornecedor(); });
  });

  ['membro-nome', 'membro-username', 'membro-pin'].forEach(id => {
    $(id).addEventListener('keydown', e => { if (e.key === 'Enter') salvarNovoMembro(); });
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if ($('modal-salvar').classList.contains('show')) { fecharModalSalvar(); return; }
      if ($('modal-editar').classList.contains('show')) { fecharModalEditar(); return; }
      if ($('modal-fornecedor').classList.contains('show')) { fecharModalFornecedor(); return; }
      if ($('modal-membro').classList.contains('show')) { fecharModalMembro(); return; }
      if ($('modal-add-atual').classList.contains('show')) { fecharModalAddAtual(); return; }
      if ($('modal-categorias').classList.contains('show')) { fecharModalCategorias(); return; }
      if ($('modal-insumo').classList.contains('show')) { fecharModalInsumo(); return; }
      if ($('modal-ficha').classList.contains('show')) { fecharModalFicha(); return; }
    }
  });

  ['login-pin', 'criar-pin', 'membro-pin'].forEach(id => {
    $(id).addEventListener('input', e => {
      e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4);
    });
  });

  $('membro-username').addEventListener('input', e => {
    e.target.value = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '');
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
