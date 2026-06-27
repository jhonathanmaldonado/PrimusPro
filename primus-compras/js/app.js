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
  obterCMVAlvoEfetivo,
  calcularCustoPorUnidadeFicha,
  verificarDependenciaCircular,
  observarVendas,
  observarVendasDias,
  parseRelatorioGestorFood,
  salvarVendasImportadas,
  deletarVendasDoDia,
  formatarDataBR,
  vincularVendaAFicha,
  desvincularVenda,
  marcarProdutoIgnorado,
  autoVincularPorNomeNoPDV,
  agregarVendasPorProduto,
  calcularConsumoInsumos,
  calcularFatorAjustePorDiaSemana,
  adicionarItensListaEmCriacaoEmLote
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
let vendas = [];
let vendasDias = [];
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
let searchVendas = '';
let filtroFichas = 'todas';  // todas | pratos | pp
let currentTab = 'criar';
let currentSubTabCardapio = 'insumos';
let currentSubTabVendas = 'importar';  // importar | calendario | dados
let mediaN = 5;

// Vendas - estado
let vendasPreviewParseado = null;  // resultado do parser aguardando confirmação
let calendarioAno = new Date().getFullYear();
let calendarioMes = new Date().getMonth();  // 0-indexed
let diaSelecionadoCalendario = null;
let searchVinculos = '';
let filtroVinculos = 'todos';  // todos | pendentes | vinculados | ignorados

// CMV Real (Fase 3C)
let cmvPeriodoTipo = 'mes-atual';      // mes-atual | mes-especifico | todos
let cmvMesEspecifico = null;            // 'YYYY-MM' quando tipo === 'mes-especifico'
let cmvOrdenacao = 'receita';           // receita | cmv

// Análises (Fase 3D)
let analisesPeriodoTipo = 'mes-atual';
let analisesMesEspecifico = null;

// Sugestão de compras (Fase 3E)
let comprasBaseTipo = 'mes-atual';   // mes-atual | mes-especifico | todos
let comprasBaseMes = null;            // 'YYYY-MM' quando tipo === 'mes-especifico'
let comprasHorizonte = 7;             // dias (3 | 7 | 14 | 30)
let comprasMargem = 10;               // % (margem de segurança)
let comprasSelecionados = {};         // { insumoId: true } - quais insumos estão marcados
let comprasResultadoAtual = null;     // último resultado calculado, pra usar no btn criar lista

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

    // Importa automaticamente se o workspace estiver vazio (sem perguntar)
    const result = await seedCatalogoSeVazio(seedData);
    if (result.importado) {
      showToast(`✓ Catálogo inicial importado: ${result.categorias} categorias, ${result.itens} itens`, 'success');
    }
  } catch (e) {
    console.error('Erro ao importar seed:', e);
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
    if (currentTab === 'vendas' && currentSubTabVendas === 'cmv') renderCMVReal();
    if (currentTab === 'vendas' && currentSubTabVendas === 'analises') renderAnalises();
    if (currentTab === 'vendas' && currentSubTabVendas === 'compras') renderCompras();
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
    if (currentTab === 'vendas' && currentSubTabVendas === 'vinculos') renderVinculos();
    if (currentTab === 'vendas' && currentSubTabVendas === 'cmv') renderCMVReal();
    if (currentTab === 'vendas' && currentSubTabVendas === 'analises') renderAnalises();
    if (currentTab === 'vendas' && currentSubTabVendas === 'compras') renderCompras();
  }));

  unsubsRefs.push(observarVendas((v) => {
    vendas = v;
    if (currentTab === 'vendas' && currentSubTabVendas === 'dados') renderDadosVendas();
    if (currentTab === 'vendas' && currentSubTabVendas === 'vinculos') renderVinculos();
    if (currentTab === 'vendas' && currentSubTabVendas === 'cmv') renderCMVReal();
    if (currentTab === 'vendas' && currentSubTabVendas === 'analises') renderAnalises();
    if (currentTab === 'vendas' && currentSubTabVendas === 'compras') renderCompras();
    if (currentTab === 'vendas' && currentSubTabVendas === 'calendario' && diaSelecionadoCalendario) {
      renderDetalhesDia(diaSelecionadoCalendario);
    }
  }));

  unsubsRefs.push(observarVendasDias((vd) => {
    vendasDias = vd;
    if (currentTab === 'vendas' && currentSubTabVendas === 'calendario') renderCalendario();
    if (currentTab === 'vendas' && currentSubTabVendas === 'dados') renderDadosVendas();
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
    const custoReceita = calcularCustoReceita(ficha, insumos, fichas);
    const custoPorcao = calcularCustoPorPorcao(ficha, insumos, fichas);
    const cmv = calcularCMV(ficha, insumos, fichas);
    const cmvAlvo = obterCMVAlvoEfetivo(ficha, configPrecificacao);
    const precoSugerido = calcularPrecoSugerido(ficha, insumos, configPrecificacao, fichas);

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
      nomeNoPDV: f.nomeNoPDV || '',
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
      nomeNoPDV: '',
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
  $('ficha-nome-pdv').value = fichaEmEdicao.nomeNoPDV;
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

  // Pré-calcula listas ordenadas pra reusar em todas as linhas
  const insumosOrdenados = [...insumos].sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));
  // Pré-preparos disponíveis = todas as fichas exceto a ficha atual (e que não criem loop)
  const prePreparosDisponiveis = fichas
    .filter(f => {
      if (!f.ehPrePreparo) return false;
      if (fichaEditandoId && f.id === fichaEditandoId) return false;  // não pode usar a si mesmo
      // Verifica loop (se a ficha atual for usada na árvore deste pré-preparo)
      if (fichaEditandoId && verificarDependenciaCircular(fichaEditandoId, f.id, fichas)) return false;
      return true;
    })
    .sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));

  let html = '';
  for (let i = 0; i < ings.length; i++) {
    const ing = ings[i];
    const tipo = ing.tipo || 'insumo';
    const calc = calcularCustoIngrediente(ing, insumos, fichas);
    const invalidoCls = !calc.encontrado ? ' invalido' : '';
    const semPreco = calc.encontrado && calc.precoUnitario <= 0;

    html += `<div class="ingrediente-card${invalidoCls}" data-idx="${i}">`;
    html += `<div class="ingrediente-header">`;

    // Nome + badge de tipo
    let nomeMostrado = '⚠ Não selecionado';
    let badgeTipo = '';
    if (calc.encontrado) {
      nomeMostrado = '✓ ' + escHtml(calc.insumoNome);
      if (tipo === 'ficha') {
        badgeTipo = ' <span style="background:#FAC775;color:#854F0B;font-size:9px;font-weight:700;padding:1px 6px;border-radius:4px;margin-left:4px;letter-spacing:0.3px;text-transform:uppercase">Pré-preparo</span>';
      }
    }
    html += `<span class="ingrediente-nome">${nomeMostrado}${badgeTipo}</span>`;
    html += `<button class="icon-btn danger" data-action="remover-ing" data-idx="${i}" title="Remover ingrediente">×</button>`;
    html += `</div>`;

    html += `<div class="ingrediente-row">`;
    // Select unificado: insumos + pré-preparos
    // Valor combinado: "ins:ID" ou "ff:ID"
    html += `<div class="field" style="flex:2;min-width:160px"><label>Insumo ou pré-preparo</label>`;
    html += `<select data-action="update-ing-select" data-idx="${i}">`;
    html += `<option value="">— Selecione —</option>`;

    // Grupo: Insumos
    if (insumosOrdenados.length > 0) {
      html += `<optgroup label="📦 Insumos">`;
      for (const ins of insumosOrdenados) {
        const selecionado = (tipo === 'insumo' && ing.insumoId === ins.id) ? ' selected' : '';
        html += `<option value="ins:${ins.id}"${selecionado}>${escHtml(ins.nome)} (${escHtml(ins.unidade || 'KG')})</option>`;
      }
      html += `</optgroup>`;
    }

    // Grupo: Pré-preparos
    if (prePreparosDisponiveis.length > 0) {
      html += `<optgroup label="🍳 Pré-preparos">`;
      for (const f of prePreparosDisponiveis) {
        const selecionado = (tipo === 'ficha' && ing.fichaId === f.id) ? ' selected' : '';
        const custoUnit = calcularCustoPorUnidadeFicha(f, fichas, insumos);
        const semCustoTag = custoUnit <= 0 ? ' ⚠ sem custo' : '';
        const labelExtra = custoUnit > 0 ? ` — ${fmtMoeda(custoUnit)}/${f.unidadeRendimento || 'KG'}` : '';
        html += `<option value="ff:${f.id}"${selecionado}>${escHtml(f.nome)} (${escHtml(f.unidadeRendimento || 'KG')})${labelExtra}${semCustoTag}</option>`;
      }
      html += `</optgroup>`;
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
  fichaEmEdicao.ingredientes.unshift({ tipo: 'insumo', insumoId: '', fichaId: '', pesoLiquido: 0 });
  renderIngredientesModal();
  atualizarPainelPrecificacao();
}

function removerIngrediente(idx) {
  if (!fichaEmEdicao) return;
  fichaEmEdicao.ingredientes.splice(idx, 1);
  renderIngredientesModal();
  atualizarPainelPrecificacao();
}

function atualizarIngredienteSelecionado(idx, valorSelecionado) {
  if (!fichaEmEdicao || !fichaEmEdicao.ingredientes[idx]) return;

  if (!valorSelecionado) {
    // Limpa: nem insumo nem ficha
    fichaEmEdicao.ingredientes[idx].tipo = 'insumo';
    fichaEmEdicao.ingredientes[idx].insumoId = '';
    fichaEmEdicao.ingredientes[idx].fichaId = '';
  } else if (valorSelecionado.startsWith('ins:')) {
    // É insumo
    fichaEmEdicao.ingredientes[idx].tipo = 'insumo';
    fichaEmEdicao.ingredientes[idx].insumoId = valorSelecionado.substring(4);
    fichaEmEdicao.ingredientes[idx].fichaId = '';
  } else if (valorSelecionado.startsWith('ff:')) {
    // É pré-preparo (ficha)
    const fichaId = valorSelecionado.substring(3);

    // Validação de loop circular (caso usuário burle o filtro do dropdown)
    if (fichaEditandoId && verificarDependenciaCircular(fichaEditandoId, fichaId, fichas)) {
      showToast('⚠ Não é possível usar este pré-preparo (criaria dependência circular)', 'error');
      renderIngredientesModal();
      return;
    }

    fichaEmEdicao.ingredientes[idx].tipo = 'ficha';
    fichaEmEdicao.ingredientes[idx].fichaId = fichaId;
    fichaEmEdicao.ingredientes[idx].insumoId = '';
  }

  renderIngredientesModal();
  atualizarPainelPrecificacao();
}

function atualizarIngredientePeso(idx, peso) {
  if (!fichaEmEdicao || !fichaEmEdicao.ingredientes[idx]) return;
  fichaEmEdicao.ingredientes[idx].pesoLiquido = parseFloat(peso) || 0;
  // Não re-renderiza tudo (preserva foco), só recalcula
  const card = document.querySelector(`.ingrediente-card[data-idx="${idx}"]`);
  if (card) {
    const calc = calcularCustoIngrediente(fichaEmEdicao.ingredientes[idx], insumos, fichas);
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

  const custoReceita = calcularCustoReceita(fichaEmEdicao, insumos, fichas);
  const custoPorcao = calcularCustoPorPorcao(fichaEmEdicao, insumos, fichas);
  const cmv = calcularCMV(fichaEmEdicao, insumos, fichas);
  const cmvAlvo = obterCMVAlvoEfetivo(fichaEmEdicao, configPrecificacao);
  const precoSugerido = calcularPrecoSugerido(fichaEmEdicao, insumos, configPrecificacao, fichas);
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
  fichaEmEdicao.nomeNoPDV = $('ficha-nome-pdv').value.trim();
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

  // Limpa ingredientes inválidos (sem insumoId nem fichaId)
  fichaEmEdicao.ingredientes = (fichaEmEdicao.ingredientes || [])
    .filter(i => {
      const tipo = i.tipo || 'insumo';
      if (tipo === 'ficha') return !!i.fichaId;
      return !!i.insumoId;
    })
    .map(i => {
      // Garante consistência dos campos por tipo
      const tipo = i.tipo || 'insumo';
      if (tipo === 'ficha') {
        return { tipo: 'ficha', fichaId: i.fichaId, pesoLiquido: parseFloat(i.pesoLiquido) || 0 };
      }
      return { tipo: 'insumo', insumoId: i.insumoId, pesoLiquido: parseFloat(i.pesoLiquido) || 0 };
    });

  err.classList.remove('show');
  const btn = $('btn-ficha-salvar');
  btn.disabled = true;
  btn.textContent = 'Salvando...';

  try {
    let fichaIdSalva = fichaEditandoId;
    if (fichaEditandoId) {
      await atualizarFicha(fichaEditandoId, fichaEmEdicao);
      showToast(`✓ "${fichaEmEdicao.nome}" atualizada`, 'success');
    } else {
      fichaIdSalva = await criarFicha(fichaEmEdicao);
      showToast(`✓ Ficha "${fichaEmEdicao.nome}" criada`, 'success');
    }

    // Auto-vínculo: se preencheu nomeNoPDV, vincula todas as vendas com esse nome
    if (fichaEmEdicao.nomeNoPDV && fichaIdSalva) {
      try {
        const n = await autoVincularPorNomeNoPDV(fichaIdSalva, fichaEmEdicao.nomeNoPDV);
        if (n > 0) {
          showToast(`🔗 ${n} venda(s) vinculada(s) automaticamente`, 'success');
        }
      } catch (e) {
        console.warn('Auto-vínculo falhou:', e);
      }
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
      const cmv = calcularCMV(f, insumos, fichas);
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
    const cmvA = calcularCMV(a, insumos, fichas) ?? -1;
    const cmvB = calcularCMV(b, insumos, fichas) ?? -1;
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
    const custoReceita = calcularCustoReceita(ficha, insumos, fichas);
    const custoPorcao = calcularCustoPorPorcao(ficha, insumos, fichas);
    const cmv = calcularCMV(ficha, insumos, fichas);
    const cmvAlvo = obterCMVAlvoEfetivo(ficha, configPrecificacao);
    const precoSugerido = calcularPrecoSugerido(ficha, insumos, configPrecificacao, fichas);
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

  // TROCA O TÍTULO IMEDIATAMENTE - antes de qualquer await
  // o navegador captura este valor quando window.print() é chamado
  document.title = tituloDoArquivo;

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
    document.body.classList.add(classeBody);

    // Espera o próximo frame para garantir que o título já está renderizado
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.print();
        // Restaura título e remove classe após o diálogo de print fechar
        setTimeout(() => {
          document.title = tituloOriginal;
          document.body.classList.remove(classeBody);
        }, 1000);
      });
    });
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
  const custoReceita = calcularCustoReceita(ficha, insumos, fichas);
  const custoPorcao = calcularCustoPorPorcao(ficha, insumos, fichas);
  const cmv = calcularCMV(ficha, insumos, fichas);
  const cmvAlvo = obterCMVAlvoEfetivo(ficha, configPrecificacao);
  const precoSugerido = calcularPrecoSugerido(ficha, insumos, configPrecificacao, fichas);
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
      const calc = calcularCustoIngrediente(ing, insumos, fichas);
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

  // TROCA O TÍTULO IMEDIATAMENTE
  document.title = nomeArquivo;

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
    document.body.classList.add('printing-ficha');

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.print();
        setTimeout(() => {
          document.title = tituloOriginal;
          document.body.classList.remove('printing-ficha');
          $('ficha-impressao').innerHTML = '';
        }, 1000);
      });
    });
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

  // Título
  $('modal-hist-title').textContent = `🛒 Compra de ${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;

  // Meta
  const itensCount = (h.itens || []).length;
  $('modal-hist-meta').innerHTML = `
    <div>Finalizado por: <strong>${escHtml(h.finalizadoPorNome || '?')}</strong></div>
    <div>${itensCount} ${itensCount === 1 ? 'item' : 'itens'}</div>
  `;

  // Agrupa por categoria e calcula subtotais
  const porCategoria = {};
  const ordemCategorias = [];
  for (const i of (h.itens || [])) {
    const cat = i.categoriaNome || 'Sem categoria';
    if (!porCategoria[cat]) {
      porCategoria[cat] = { itens: [], subtotal: 0 };
      ordemCategorias.push(cat);
    }
    porCategoria[cat].itens.push(i);
    porCategoria[cat].subtotal += i.subtotal || 0;
  }

  // Monta HTML
  let html = '';
  for (const cat of ordemCategorias) {
    const grupo = porCategoria[cat];
    html += `<div class="hist-categoria">`;
    html += `<span>${escHtml(cat)} <span style="opacity:0.7;font-weight:400">(${grupo.itens.length})</span></span>`;
    html += `<span class="hist-categoria-subtotal">${fmtMoeda(grupo.subtotal)}</span>`;
    html += `</div>`;

    for (const i of grupo.itens) {
      const semPreco = !i.preco || i.preco === 0;
      html += `<div class="hist-item${semPreco ? ' sem-preco' : ''}">`;
      html += `<span class="hist-item-nome">${escHtml(i.nome)}</span>`;
      html += `<span class="hist-item-qtd">${i.qtd} ${escHtml(i.tipo || '')}</span>`;
      if (i.preco) {
        html += `<span class="hist-item-preco">× ${fmtMoeda(i.preco)}</span>`;
        html += `<span class="hist-item-subtotal">${fmtMoeda(i.subtotal)}</span>`;
      } else {
        html += `<span class="hist-item-preco">—</span>`;
        html += `<span class="hist-item-subtotal">sem preço</span>`;
      }
      html += `</div>`;
    }
  }

  $('modal-hist-conteudo').innerHTML = html;
  $('modal-hist-total').textContent = `TOTAL: ${fmtMoeda(h.total)}`;

  $('modal-historico-detalhes').classList.add('show');
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
  $('tab-vendas').style.display = tab === 'vendas' ? 'block' : 'none';
  $('tab-equipe').style.display = tab === 'equipe' ? 'block' : 'none';
  if (tab === 'historico') renderHistorico();
  if (tab === 'fornecedores') renderFornecedores();
  if (tab === 'cardapio') {
    switchSubTabCardapio(currentSubTabCardapio || 'insumos');
  }
  if (tab === 'vendas') {
    switchSubTabVendas(currentSubTabVendas || 'importar');
  }
  if (tab === 'equipe') renderEquipe();
}

// ============================================================================
// ABA VENDAS - sub-navegação
// ============================================================================

function switchSubTabVendas(sub) {
  currentSubTabVendas = sub;
  document.querySelectorAll('[data-vendas-subtab]').forEach(b => {
    b.classList.toggle('active', b.dataset.vendasSubtab === sub);
  });
  $('vendas-subtab-importar').style.display = sub === 'importar' ? 'block' : 'none';
  $('vendas-subtab-calendario').style.display = sub === 'calendario' ? 'block' : 'none';
  $('vendas-subtab-dados').style.display = sub === 'dados' ? 'block' : 'none';
  $('vendas-subtab-vinculos').style.display = sub === 'vinculos' ? 'block' : 'none';
  $('vendas-subtab-cmv').style.display = sub === 'cmv' ? 'block' : 'none';
  $('vendas-subtab-analises').style.display = sub === 'analises' ? 'block' : 'none';
  $('vendas-subtab-compras').style.display = sub === 'compras' ? 'block' : 'none';

  if (sub === 'calendario') renderCalendario();
  if (sub === 'dados') renderDadosVendas();
  if (sub === 'vinculos') renderVinculos();
  if (sub === 'cmv') renderCMVReal();
  if (sub === 'analises') renderAnalises();
  if (sub === 'compras') renderCompras();
}

// ============================================================================
// VENDAS - Importação
// ============================================================================

function analisarRelatorio() {
  const texto = $('vendas-textarea').value.trim();

  // Reset
  $('vendas-preview').style.display = 'none';
  $('vendas-erro').style.display = 'none';
  vendasPreviewParseado = null;

  if (!texto) {
    $('vendas-erro').textContent = '⚠ Cole o relatório do Gestor Food antes de analisar';
    $('vendas-erro').style.display = 'block';
    return;
  }

  const resultado = parseRelatorioGestorFood(texto);

  if (!resultado.sucesso) {
    $('vendas-erro').textContent = '⚠ ' + resultado.mensagem;
    $('vendas-erro').style.display = 'block';
    return;
  }

  vendasPreviewParseado = resultado;

  // Preenche resumo
  $('prev-dias').textContent = resultado.totalDias;
  $('prev-produtos').textContent = resultado.totalProdutos;
  $('prev-receita').textContent = fmtMoeda(resultado.totalReceita);

  // Período
  const periodoTxt = resultado.totalDias === 1
    ? `📅 Dia: ${formatarDataBR(resultado.dataInicio)}`
    : `📅 Período: ${formatarDataBR(resultado.dataInicio)} até ${formatarDataBR(resultado.dataFim)}`;
  $('prev-periodo').textContent = periodoTxt;

  // Verifica quais dias já existem
  const diasJaExistentes = [];
  const diasNovos = [];
  for (const data of Object.keys(resultado.vendasPorDia)) {
    if (vendasDias.find(vd => vd.data === data)) {
      diasJaExistentes.push(data);
    } else {
      diasNovos.push(data);
    }
  }

  // Alerta de sobrescrita
  if (diasJaExistentes.length > 0) {
    let alerta = `⚠️ <strong>Atenção:</strong> ${diasJaExistentes.length} dia(s) já estão importados e serão <strong>substituídos</strong>:<br>`;
    alerta += diasJaExistentes.map(d => formatarDataBR(d)).join(', ');
    $('prev-alerta').innerHTML = alerta;
    $('prev-alerta').style.display = 'block';
  } else {
    $('prev-alerta').style.display = 'none';
  }

  // Lista resumida de dias
  let listaHtml = '<div style="background:#fafaf9;border-radius:6px;padding:6px 10px;max-height:200px;overflow-y:auto">';
  for (const data of Object.keys(resultado.vendasPorDia).sort()) {
    const d = resultado.vendasPorDia[data];
    const tag = diasJaExistentes.includes(data)
      ? '<span class="dia-preview-substitui">⚠ SUBSTITUI</span>'
      : '<span class="dia-preview-novo">✓ NOVO</span>';
    listaHtml += `<div class="dia-preview-item">`;
    listaHtml += `<span><span class="dia-preview-data">${formatarDataBR(data)}</span> ${tag}</span>`;
    listaHtml += `<span class="dia-preview-info">${d.produtos.length} produtos · ${fmtMoeda(d.totalReceita)}</span>`;
    listaHtml += `</div>`;
  }
  listaHtml += '</div>';
  $('prev-dias-lista').innerHTML = listaHtml;

  $('vendas-preview').style.display = 'block';
  // Rola pra preview
  setTimeout(() => $('vendas-preview').scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
}

async function confirmarImportacao() {
  if (!vendasPreviewParseado) return;

  const btn = $('btn-confirmar-importacao');
  btn.disabled = true;
  btn.textContent = 'Importando...';

  try {
    const userName = userCtx?.username || 'sistema';
    await salvarVendasImportadas(vendasPreviewParseado.vendasPorDia, userName);

    const totalDias = vendasPreviewParseado.totalDias;
    showToast(`✓ ${totalDias} dia(s) importado(s) com sucesso!`, 'success');

    // Limpa tudo
    $('vendas-textarea').value = '';
    $('vendas-preview').style.display = 'none';
    vendasPreviewParseado = null;

    // Vai pra sub-aba calendário pra ver o resultado
    switchSubTabVendas('calendario');
  } catch (e) {
    showToast('⚠ Erro ao importar: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '💾 Confirmar Importação';
  }
}

function cancelarImportacao() {
  $('vendas-preview').style.display = 'none';
  vendasPreviewParseado = null;
}

function limparTextarea() {
  $('vendas-textarea').value = '';
  $('vendas-preview').style.display = 'none';
  $('vendas-erro').style.display = 'none';
  vendasPreviewParseado = null;
  $('vendas-textarea').focus();
}

// ============================================================================
// VENDAS - Calendário
// ============================================================================

const NOMES_MESES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
];

function renderCalendario() {
  // Atualiza título
  $('cal-titulo').textContent = `${NOMES_MESES[calendarioMes]} ${calendarioAno}`;

  // Stats globais
  $('cal-dias-total').textContent = `${vendasDias.length} dias`;

  // Stats do mês
  const mesStr = String(calendarioMes + 1).padStart(2, '0');
  const anoStr = String(calendarioAno);
  const diasDoMes = vendasDias.filter(vd => {
    return vd.data && vd.data.startsWith(`${anoStr}-${mesStr}`);
  });
  $('cal-dias-mes').textContent = diasDoMes.length;
  const receitaMes = diasDoMes.reduce((sum, vd) => sum + (vd.totalReceita || 0), 0);
  $('cal-receita-mes').textContent = fmtMoeda(receitaMes);

  // Monta grid
  const primeiroDia = new Date(calendarioAno, calendarioMes, 1);
  const ultimoDia = new Date(calendarioAno, calendarioMes + 1, 0);
  const diaSemanaInicio = primeiroDia.getDay();  // 0=domingo
  const totalDiasMes = ultimoDia.getDate();
  const hoje = new Date();
  const ehMesAtual = hoje.getFullYear() === calendarioAno && hoje.getMonth() === calendarioMes;

  let html = '<div class="calendario-grid">';

  // Cabeçalho com dias da semana
  html += '<div class="calendario-header">';
  ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].forEach(d => {
    html += `<div class="calendario-header-dia">${d}</div>`;
  });
  html += '</div>';

  // Corpo do calendário
  html += '<div class="calendario-body">';

  // Células vazias antes do dia 1
  for (let i = 0; i < diaSemanaInicio; i++) {
    html += '<div class="calendario-celula vazio"></div>';
  }

  // Células dos dias
  for (let dia = 1; dia <= totalDiasMes; dia++) {
    const diaStr = String(dia).padStart(2, '0');
    const dataISO = `${anoStr}-${mesStr}-${diaStr}`;
    const venda = vendasDias.find(vd => vd.data === dataISO);

    let cls = 'calendario-celula';
    if (venda) cls += ' tem-vendas';
    if (ehMesAtual && hoje.getDate() === dia) cls += ' hoje';

    if (venda) {
      const receita = venda.totalReceita || 0;
      const receitaFmt = receita >= 1000 ? `R$${(receita / 1000).toFixed(1)}k` : `R$${receita.toFixed(0)}`;
      html += `<div class="${cls}" data-dia="${dataISO}">`;
      html += `<div class="marca">✓</div>`;
      html += `<div>${dia}</div>`;
      html += `<div class="valor-receita">${receitaFmt}</div>`;
      html += `</div>`;
    } else {
      html += `<div class="${cls}">${dia}</div>`;
    }
  }

  html += '</div>';

  // Legenda
  html += '<div class="calendario-legenda">';
  html += '<div class="calendario-legenda-item"><div class="calendario-legenda-quadrado" style="background:#dcfce7;border-color:#86efac"></div>Com vendas importadas</div>';
  html += '<div class="calendario-legenda-item"><div class="calendario-legenda-quadrado" style="background:#fafaf9"></div>Sem importação</div>';
  html += '<div class="calendario-legenda-item">👆 Clique em um dia para ver detalhes</div>';
  html += '</div>';

  html += '</div>';

  $('calendario-grid').innerHTML = html;

  // Esconde detalhes se mudou de mês
  if (diaSelecionadoCalendario && !diaSelecionadoCalendario.startsWith(`${anoStr}-${mesStr}`)) {
    $('dia-detalhes').style.display = 'none';
    diaSelecionadoCalendario = null;
  }
}

function renderDetalhesDia(dataISO) {
  const dia = vendasDias.find(vd => vd.data === dataISO);
  if (!dia) {
    $('dia-detalhes').style.display = 'none';
    return;
  }

  diaSelecionadoCalendario = dataISO;

  const vendasDoDia = vendas.filter(v => v.data === dataISO);
  // Ordena por receita (maior primeiro)
  vendasDoDia.sort((a, b) => (b.total || 0) - (a.total || 0));

  $('dia-detalhes-titulo').textContent = `📅 ${formatarDataBR(dataISO)} — ${dia.totalPratos} produtos · ${fmtMoeda(dia.totalReceita)}`;

  let html = '';
  if (vendasDoDia.length === 0) {
    html = '<div style="text-align:center;color:var(--muted);padding:14px">Sem vendas neste dia</div>';
  } else {
    for (const v of vendasDoDia) {
      html += `<div class="venda-card">`;
      html += `<div class="venda-card-info">`;
      html += `<div class="venda-card-nome">${escHtml(v.produtoNome)}</div>`;
      html += `<div class="venda-card-meta">${v.quantidade} un · ${fmtMoeda(v.subtotal)} subtotal`;
      if (v.desconto < 0) html += ` · ${fmtMoeda(v.desconto)} desc`;
      html += `</div>`;
      html += `</div>`;
      html += `<div>`;
      html += `<div class="venda-card-valor">${fmtMoeda(v.total)}</div>`;
      html += `</div>`;
      html += `</div>`;
    }
  }

  $('dia-detalhes-conteudo').innerHTML = html;
  $('dia-detalhes').style.display = 'block';
  setTimeout(() => $('dia-detalhes').scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100);
}

async function deletarDiaSelecionado() {
  if (!diaSelecionadoCalendario) return;
  const dataFmt = formatarDataBR(diaSelecionadoCalendario);
  if (!confirm(`Remover a importação do dia ${dataFmt}?\n\nTodas as vendas deste dia serão apagadas.`)) return;

  try {
    await deletarVendasDoDia(diaSelecionadoCalendario);
    showToast(`✓ Vendas de ${dataFmt} removidas`, 'success');
    $('dia-detalhes').style.display = 'none';
    diaSelecionadoCalendario = null;
  } catch (e) {
    showToast('⚠ Erro: ' + e.message, 'error');
  }
}

function navegarMes(delta) {
  calendarioMes += delta;
  if (calendarioMes < 0) {
    calendarioMes = 11;
    calendarioAno--;
  } else if (calendarioMes > 11) {
    calendarioMes = 0;
    calendarioAno++;
  }
  $('dia-detalhes').style.display = 'none';
  diaSelecionadoCalendario = null;
  renderCalendario();
}

// ============================================================================
// VENDAS - Dados (agregação por produto)
// ============================================================================

function renderDadosVendas() {
  // Stats gerais
  const totalReceita = vendas.reduce((sum, v) => sum + (v.total || 0), 0);
  const totalQtd = vendas.reduce((sum, v) => sum + (v.quantidade || 0), 0);
  const ticket = totalQtd > 0 ? totalReceita / totalQtd : 0;

  $('dados-receita').textContent = fmtMoeda(totalReceita);
  $('dados-qtd').textContent = Math.round(totalQtd);
  $('dados-ticket').textContent = fmtMoeda(ticket);

  // Agrega por produto (soma todos os dias)
  const agrupado = {};
  for (const v of vendas) {
    const nome = v.produtoNome;
    if (!agrupado[nome]) {
      agrupado[nome] = { nome, quantidade: 0, total: 0, dias: new Set() };
    }
    agrupado[nome].quantidade += v.quantidade || 0;
    agrupado[nome].total += v.total || 0;
    agrupado[nome].dias.add(v.data);
  }

  let produtos = Object.values(agrupado);
  // Filtro de busca
  if (searchVendas) {
    const t = searchVendas.toLowerCase();
    produtos = produtos.filter(p => (p.nome || '').toLowerCase().includes(t));
  }
  // Ordena por receita (maior primeiro)
  produtos.sort((a, b) => b.total - a.total);

  const el = $('lista-vendas');

  if (!vendas.length) {
    el.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">📊</div>
      <div class="empty-state-text">Nenhuma venda importada ainda.<br>Vá em <strong>📥 Importar</strong> para começar.</div>
    </div>`;
    $('search-vendas-clear').style.display = 'none';
    return;
  }

  if (!produtos.length) {
    el.innerHTML = `<div class="empty-msg">Nenhum produto encontrado para "<strong>${escHtml(searchVendas)}</strong>"</div>`;
    $('search-vendas-clear').style.display = 'block';
    return;
  }

  let html = '';
  for (const p of produtos) {
    html += `<div class="venda-card">`;
    html += `<div class="venda-card-info">`;
    html += `<div class="venda-card-nome">${escHtml(p.nome)}</div>`;
    html += `<div class="venda-card-meta">${Math.round(p.quantidade)} un vendidas · ${p.dias.size} dia(s)</div>`;
    html += `</div>`;
    html += `<div>`;
    html += `<div class="venda-card-valor">${fmtMoeda(p.total)}</div>`;
    html += `<div class="venda-card-qtd">${fmtMoeda(p.total / p.quantidade)}/un</div>`;
    html += `</div>`;
    html += `</div>`;
  }

  el.innerHTML = html;
  $('search-vendas-clear').style.display = searchVendas ? 'block' : 'none';
}

// ============================================================================
// VENDAS - Vínculos PDV ↔ Ficha (Fase 3B)
// ============================================================================

function renderVinculos() {
  // Agrega vendas por produto
  const produtos = agregarVendasPorProduto(vendas);

  // Stats
  $('vinc-total').textContent = produtos.length;
  const vinculados = produtos.filter(p => p.fichaId).length;
  const ignorados = produtos.filter(p => p.ignorado).length;
  const pendentes = produtos.filter(p => !p.fichaId && !p.ignorado).length;
  $('vinc-vinculados').textContent = vinculados;
  $('vinc-pendentes').textContent = pendentes;

  // Aplica filtros
  let filtrados = produtos;
  if (filtroVinculos === 'pendentes') {
    filtrados = filtrados.filter(p => !p.fichaId && !p.ignorado);
  } else if (filtroVinculos === 'vinculados') {
    filtrados = filtrados.filter(p => p.fichaId);
  } else if (filtroVinculos === 'ignorados') {
    filtrados = filtrados.filter(p => p.ignorado);
  }

  if (searchVinculos) {
    const t = searchVinculos.toLowerCase();
    filtrados = filtrados.filter(p => (p.nome || '').toLowerCase().includes(t));
  }

  // Ordena: pendentes primeiro (maior receita), depois vinculados, depois ignorados
  filtrados.sort((a, b) => {
    const prioridadeA = a.ignorado ? 2 : (a.fichaId ? 1 : 0);
    const prioridadeB = b.ignorado ? 2 : (b.fichaId ? 1 : 0);
    if (prioridadeA !== prioridadeB) return prioridadeA - prioridadeB;
    return b.total - a.total;  // dentro do mesmo grupo, maior receita primeiro
  });

  const el = $('lista-vinculos');

  if (!vendas.length) {
    el.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">🔗</div>
      <div class="empty-state-text">Nenhuma venda importada ainda.<br>Vá em <strong>📥 Importar</strong> primeiro.</div>
    </div>`;
    return;
  }

  if (!filtrados.length) {
    const txt = filtroVinculos === 'pendentes'
      ? 'Não há produtos pendentes — todos foram vinculados ou ignorados! 🎉'
      : 'Nenhum produto encontrado com os filtros aplicados';
    el.innerHTML = `<div class="empty-msg">${txt}</div>`;
    return;
  }

  // Monta lista de opções de fichas (pra dropdown)
  const fichasOrdenadas = [...fichas].sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));

  let html = '';
  for (const p of filtrados) {
    const ficha = p.fichaId ? fichas.find(f => f.id === p.fichaId) : null;

    let cls = 'vinculo-card';
    if (p.ignorado) cls += ' ignorado';
    else if (p.fichaId) cls += ' vinculado';
    else cls += ' pendente';

    html += `<div class="${cls}">`;

    // Header (nome + receita)
    html += `<div class="vinculo-header">`;
    html += `<div class="vinculo-nome">`;
    html += `<div class="vinculo-nome-produto">${escHtml(p.nome)}</div>`;
    html += `<div class="vinculo-nome-meta">${Math.round(p.quantidade)} un · ${p.dias} dia(s)</div>`;
    html += `</div>`;
    html += `<div class="vinculo-valor">${fmtMoeda(p.total)}</div>`;
    html += `</div>`;

    // Linha de ação (varia conforme status)
    html += `<div class="vinculo-acao">`;

    if (p.ignorado) {
      html += `<span class="vinculo-status ignorado">🚫 Ignorado</span>`;
      html += `<button class="vinculo-btn-sm" data-action="vinc-desfazer-ignorar" data-produto="${escHtml(p.nome)}">Desfazer</button>`;
    } else if (p.fichaId && ficha) {
      html += `<span class="vinculo-status ok">✅ Vinculado a: <strong>${escHtml(ficha.nome)}</strong></span>`;
      html += `<div style="flex:1"></div>`;
      html += `<button class="vinculo-btn-sm" data-action="vinc-editar" data-produto="${escHtml(p.nome)}">✏️ Trocar</button>`;
      html += `<button class="vinculo-btn-sm danger" data-action="vinc-desvincular" data-produto="${escHtml(p.nome)}">Desvincular</button>`;
    } else if (p.fichaId && !ficha) {
      html += `<span class="vinculo-status pendente">⚠ Ficha apagada</span>`;
      html += `<button class="vinculo-btn-sm" data-action="vinc-desvincular" data-produto="${escHtml(p.nome)}">Limpar</button>`;
    } else {
      // Pendente - mostra dropdown pra escolher
      html += `<span class="vinculo-status pendente">⚠️ Sem vínculo</span>`;
      html += `<select class="vinculo-select-ficha" data-action="vinc-selecionar" data-produto="${escHtml(p.nome)}">`;
      html += `<option value="">— Escolher ficha técnica —</option>`;
      for (const f of fichasOrdenadas) {
        if (f.ehPrePreparo) continue;  // pré-preparos não vendem direto
        html += `<option value="${f.id}">${escHtml(f.nome)}</option>`;
      }
      html += `</select>`;
      html += `<button class="vinculo-btn-sm" data-action="vinc-ignorar" data-produto="${escHtml(p.nome)}">🚫 Ignorar</button>`;
    }

    html += `</div>`;
    html += `</div>`;
  }

  el.innerHTML = html;
}

async function vinculoSelecionarFicha(produtoNome, fichaId) {
  if (!fichaId) return;
  try {
    const n = await vincularVendaAFicha(produtoNome, fichaId);
    showToast(`✓ ${n} venda(s) vinculada(s)`, 'success');
  } catch (e) {
    showToast('⚠ Erro: ' + e.message, 'error');
  }
}

async function vinculoDesvincular(produtoNome) {
  if (!confirm(`Desvincular todas as vendas de "${produtoNome}"?`)) return;
  try {
    const n = await desvincularVenda(produtoNome);
    showToast(`✓ ${n} venda(s) desvinculada(s)`, 'success');
  } catch (e) {
    showToast('⚠ Erro: ' + e.message, 'error');
  }
}

async function vinculoEditar(produtoNome) {
  // Permite trocar a ficha vinculada
  const fichasDisponiveis = fichas.filter(f => !f.ehPrePreparo);
  if (!fichasDisponiveis.length) {
    showToast('⚠ Nenhuma ficha disponível', 'error');
    return;
  }
  // Cria prompt simples com lista de opções (numerada)
  let opcoes = 'Escolha a nova ficha:\n\n';
  fichasDisponiveis.forEach((f, i) => {
    opcoes += `${i + 1}. ${f.nome}\n`;
  });
  opcoes += '\nDigite o número:';
  const escolha = prompt(opcoes);
  const idx = parseInt(escolha, 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= fichasDisponiveis.length) return;

  const novaFicha = fichasDisponiveis[idx];
  try {
    const n = await vincularVendaAFicha(produtoNome, novaFicha.id);
    showToast(`✓ Vinculado a "${novaFicha.nome}" (${n} vendas)`, 'success');
  } catch (e) {
    showToast('⚠ Erro: ' + e.message, 'error');
  }
}

async function vinculoIgnorar(produtoNome) {
  try {
    const n = await marcarProdutoIgnorado(produtoNome, true);
    showToast(`🚫 ${n} venda(s) marcada(s) como ignorada(s)`, 'success');
  } catch (e) {
    showToast('⚠ Erro: ' + e.message, 'error');
  }
}

async function vinculoDesfazerIgnorar(produtoNome) {
  try {
    const n = await marcarProdutoIgnorado(produtoNome, false);
    showToast(`✓ ${n} venda(s) reativada(s)`, 'success');
  } catch (e) {
    showToast('⚠ Erro: ' + e.message, 'error');
  }
}

// ============================================================================
// VENDAS - CMV Real (Fase 3C)
// ============================================================================

// Filtra vendas pelo período selecionado e retorna apenas as vinculadas a fichas
function filtrarVendasPeriodo() {
  let vendasFiltradas = vendas.filter(v => v.fichaId && !v.ignorado);

  if (cmvPeriodoTipo === 'mes-atual') {
    const hoje = new Date();
    const prefix = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
    vendasFiltradas = vendasFiltradas.filter(v => v.data && v.data.startsWith(prefix));
  } else if (cmvPeriodoTipo === 'mes-especifico' && cmvMesEspecifico) {
    vendasFiltradas = vendasFiltradas.filter(v => v.data && v.data.startsWith(cmvMesEspecifico));
  }
  // 'todos' = sem filtro adicional

  return vendasFiltradas;
}

// Calcula o CMV real agregado (e também por prato)
function calcularCMVRealCompleto() {
  const vendasVinculadas = filtrarVendasPeriodo();

  // Calcula receita total no período (incluindo pendentes/ignoradas, pra mostrar cobertura)
  let vendasTotaisDoPeriodo = vendas;
  if (cmvPeriodoTipo === 'mes-atual') {
    const hoje = new Date();
    const prefix = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
    vendasTotaisDoPeriodo = vendas.filter(v => v.data && v.data.startsWith(prefix));
  } else if (cmvPeriodoTipo === 'mes-especifico' && cmvMesEspecifico) {
    vendasTotaisDoPeriodo = vendas.filter(v => v.data && v.data.startsWith(cmvMesEspecifico));
  }
  const receitaTotal = vendasTotaisDoPeriodo.reduce((s, v) => s + (v.total || 0), 0);

  // Agrupa por ficha (prato)
  const porFicha = {};

  for (const v of vendasVinculadas) {
    const ficha = fichas.find(f => f.id === v.fichaId);
    if (!ficha) continue;  // ficha foi apagada

    const fichaId = ficha.id;
    if (!porFicha[fichaId]) {
      // Verifica se a ficha tem todos os ingredientes com preço
      let incompleta = false;
      for (const ing of (ficha.ingredientes || [])) {
        const insumo = insumos.find(i => i.id === ing.insumoId);
        if (!insumo || !insumo.precoPorUnidade || insumo.precoPorUnidade <= 0) {
          incompleta = true;
          break;
        }
      }

      porFicha[fichaId] = {
        ficha,
        nome: ficha.nome,
        quantidade: 0,
        receita: 0,
        custo: 0,
        custoPorPorcao: calcularCustoPorPorcao(ficha, insumos, fichas),
        incompleta
      };
    }
    porFicha[fichaId].quantidade += v.quantidade || 0;
    porFicha[fichaId].receita += v.total || 0;
    porFicha[fichaId].custo += (v.quantidade || 0) * porFicha[fichaId].custoPorPorcao;
  }

  // Totais
  const pratos = Object.values(porFicha).map(p => ({
    ...p,
    cmv: p.receita > 0 ? p.custo / p.receita : 0
  }));

  const receitaVinculada = pratos.reduce((s, p) => s + p.receita, 0);
  const custoTotal = pratos.reduce((s, p) => s + p.custo, 0);
  const margem = receitaVinculada - custoTotal;
  const cmvReal = receitaVinculada > 0 ? custoTotal / receitaVinculada : 0;
  const cobertura = receitaTotal > 0 ? receitaVinculada / receitaTotal : 0;

  return {
    receitaVinculada,
    receitaTotal,
    cobertura,
    custoTotal,
    margem,
    cmvReal,
    pratos,
    cmvAlvo: configPrecificacao.cmvAlvo || 0.30
  };
}

// Lista os meses disponíveis (com pelo menos uma venda)
function listarMesesDisponiveis() {
  const meses = new Set();
  for (const vd of vendasDias) {
    if (vd.data && vd.data.length >= 7) {
      meses.add(vd.data.substring(0, 7));  // YYYY-MM
    }
  }
  return Array.from(meses).sort().reverse();  // mais recentes primeiro
}

function nomeMes(yyyyMM) {
  const NOMES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
                 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  const [ano, mes] = yyyyMM.split('-');
  return `${NOMES[parseInt(mes, 10) - 1]} ${ano}`;
}

function renderCMVReal() {
  // Atualiza dropdown de meses (se mudou)
  const mesesDisponiveis = listarMesesDisponiveis();
  const selectMeses = $('cmv-filtro-mes');
  if (selectMeses.options.length !== mesesDisponiveis.length || selectMeses.options.length === 0) {
    selectMeses.innerHTML = mesesDisponiveis
      .map(m => `<option value="${m}">${nomeMes(m)}</option>`)
      .join('');
  }
  // Se mes-especifico mas sem mês selecionado, escolhe o mais recente
  if (cmvPeriodoTipo === 'mes-especifico' && !cmvMesEspecifico && mesesDisponiveis.length > 0) {
    cmvMesEspecifico = mesesDisponiveis[0];
    selectMeses.value = cmvMesEspecifico;
  }

  // Mostra/esconde select de mês específico
  selectMeses.style.display = cmvPeriodoTipo === 'mes-especifico' ? 'inline-block' : 'none';

  // Texto do período
  const hoje = new Date();
  const NOMES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
                 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  let periodoTxt = '';
  if (cmvPeriodoTipo === 'mes-atual') {
    periodoTxt = `${NOMES[hoje.getMonth()]} ${hoje.getFullYear()}`;
  } else if (cmvPeriodoTipo === 'mes-especifico' && cmvMesEspecifico) {
    periodoTxt = nomeMes(cmvMesEspecifico);
  } else {
    periodoTxt = `Todo histórico (${vendasDias.length} dias)`;
  }
  $('cmv-periodo-texto').textContent = periodoTxt;

  // Empty state se não tem vendas vinculadas
  if (!vendas.length) {
    $('cmv-valor-principal').textContent = '—';
    $('cmv-alvo-texto').textContent = 'Importe vendas primeiro';
    $('cmv-status-mensagem').textContent = 'Sem dados';
    $('cmv-status-mensagem').className = '';
    $('cmv-receita').textContent = 'R$ 0,00';
    $('cmv-custo').textContent = 'R$ 0,00';
    $('cmv-margem').textContent = 'R$ 0,00';
    $('cmv-cobertura').textContent = '—';
    $('cmv-margem-pct').textContent = '—';
    $('cmv-tabela-pratos').innerHTML = `<div class="empty-msg">Importe vendas primeiro</div>`;
    $('cmv-aviso-cobertura').style.display = 'none';
    desenharGaugeCMVReal(null, 0.30);
    return;
  }

  const r = calcularCMVRealCompleto();

  if (r.pratos.length === 0) {
    // Tem vendas mas nenhuma vinculada
    $('cmv-valor-principal').textContent = '—';
    $('cmv-alvo-texto').textContent = `Alvo: ${Math.round(r.cmvAlvo * 100)}%`;
    const msg = $('cmv-status-mensagem');
    msg.textContent = '⚠️ Vincule produtos em 🔗 Vínculos para calcular o CMV';
    msg.className = 'cmv-status-atencao';
    $('cmv-receita').textContent = fmtMoeda(0);
    $('cmv-custo').textContent = fmtMoeda(0);
    $('cmv-margem').textContent = fmtMoeda(0);
    $('cmv-cobertura').textContent = `de ${fmtMoeda(r.receitaTotal)} (0%)`;
    $('cmv-margem-pct').textContent = '—';
    $('cmv-tabela-pratos').innerHTML = `<div class="empty-msg">Nenhum prato vinculado neste período</div>`;
    $('cmv-aviso-cobertura').style.display = 'none';
    desenharGaugeCMVReal(null, r.cmvAlvo);
    return;
  }

  // Preenche stats
  $('cmv-receita').textContent = fmtMoeda(r.receitaVinculada);
  $('cmv-custo').textContent = fmtMoeda(r.custoTotal);
  $('cmv-margem').textContent = fmtMoeda(r.margem);
  $('cmv-margem-pct').textContent = r.receitaVinculada > 0
    ? `${((r.margem / r.receitaVinculada) * 100).toFixed(1)}% da receita`
    : '—';
  $('cmv-cobertura').textContent = `de ${fmtMoeda(r.receitaTotal)} (${Math.round(r.cobertura * 100)}%)`;

  // CMV principal
  const cmvPct = (r.cmvReal * 100).toFixed(1);
  $('cmv-valor-principal').textContent = `${cmvPct}%`;
  $('cmv-alvo-texto').textContent = `Alvo: ${Math.round(r.cmvAlvo * 100)}%`;

  // Cor do valor principal
  const ratio = r.cmvReal / r.cmvAlvo;
  let corValor;
  if (ratio < 0.80) corValor = '#173404';
  else if (ratio < 1.0) corValor = '#854F0B';
  else if (ratio < 1.2) corValor = '#633806';
  else corValor = '#791F1F';
  $('cmv-valor-principal').style.color = corValor;

  // Mensagem de status
  const msg = $('cmv-status-mensagem');
  const diffPontos = (r.cmvReal - r.cmvAlvo) * 100;
  if (ratio < 0.80) {
    msg.textContent = `✅ Excelente! Você está LUCRANDO ${Math.abs(diffPontos).toFixed(1)} pontos acima do alvo`;
    msg.className = 'cmv-status-otimo';
  } else if (ratio < 1.0) {
    msg.textContent = `🟡 Próximo ao alvo (${Math.abs(diffPontos).toFixed(1)} pontos abaixo) — saudável`;
    msg.className = 'cmv-status-bom';
  } else if (ratio < 1.2) {
    msg.textContent = `⚠️ Atenção: ${diffPontos.toFixed(1)} pontos acima do alvo — margem apertando`;
    msg.className = 'cmv-status-atencao';
  } else {
    msg.textContent = `🔴 Crítico: ${diffPontos.toFixed(1)} pontos acima do alvo — revisar preços/custos`;
    msg.className = 'cmv-status-critico';
  }

  // Aviso de cobertura
  const aviso = $('cmv-aviso-cobertura');
  if (r.cobertura < 0.80) {
    const naoVinculada = r.receitaTotal - r.receitaVinculada;
    aviso.innerHTML = `ℹ️ <strong>Cobertura ${Math.round(r.cobertura * 100)}%</strong> — ${fmtMoeda(naoVinculada)} de receita ainda não tem ficha vinculada. Para análise mais precisa, vincule mais produtos em <strong>🔗 Vínculos</strong>.`;
    aviso.style.display = 'block';
  } else {
    aviso.style.display = 'none';
  }

  // Desenha gauge
  desenharGaugeCMVReal(r.cmvReal, r.cmvAlvo);

  // Tabela de pratos
  renderTabelaCMV(r.pratos);
}

function renderTabelaCMV(pratos) {
  if (!pratos.length) {
    $('cmv-tabela-pratos').innerHTML = `<div class="empty-msg">Nenhum prato com vendas vinculadas</div>`;
    return;
  }

  // Ordena
  if (cmvOrdenacao === 'receita') {
    pratos.sort((a, b) => b.receita - a.receita);
  } else {
    pratos.sort((a, b) => b.cmv - a.cmv);  // pior CMV no topo (chama atenção)
  }

  let html = '<table class="cmv-tabela">';
  html += '<thead><tr>';
  html += '<th>Prato</th>';
  html += '<th class="num">Vendido</th>';
  html += '<th class="num">Receita</th>';
  html += '<th class="num">Custo</th>';
  html += '<th class="num">CMV</th>';
  html += '</tr></thead><tbody>';

  for (const p of pratos) {
    const cmvAlvo = p.ficha.cmvAlvoCustom ?? configPrecificacao.cmvAlvo ?? 0.30;
    const ratio = cmvAlvo > 0 ? p.cmv / cmvAlvo : 0;
    let corPct;
    if (ratio < 0.80) corPct = 'background:#dcfce7;color:#173404';
    else if (ratio < 1.0) corPct = 'background:#fef9c3;color:#854F0B';
    else if (ratio < 1.2) corPct = 'background:#fed7aa;color:#633806';
    else corPct = 'background:#fecaca;color:#791F1F';

    const cmvPct = (p.cmv * 100).toFixed(1);
    const incompletaBadge = p.incompleta ? `<span class="cmv-incompleta" title="Algum insumo desta ficha não tem preço cadastrado - o CMV está subestimado">⚠ incompleta</span>` : '';

    html += `<tr>`;
    html += `<td><strong>${escHtml(p.nome)}</strong>${incompletaBadge}</td>`;
    html += `<td class="num">${Math.round(p.quantidade)} un</td>`;
    html += `<td class="num">${fmtMoeda(p.receita)}</td>`;
    html += `<td class="num">${fmtMoeda(p.custo)}</td>`;
    html += `<td class="num"><span class="pct" style="${corPct}">${cmvPct}%</span></td>`;
    html += `</tr>`;
  }

  html += '</tbody></table>';
  $('cmv-tabela-pratos').innerHTML = html;
}

// Desenha o gauge principal de CMV Real (versão maior do gauge do modal de ficha)
function desenharGaugeCMVReal(cmv, cmvAlvo) {
  const arc = $('cmv-gauge-arc');
  const needle = $('cmv-gauge-needle');

  if (cmv === null || cmv <= 0) {
    arc.setAttribute('d', '');
    arc.setAttribute('stroke', '#888780');
    needle.setAttribute('x2', '100');
    needle.setAttribute('y2', '100');
    needle.setAttribute('stroke', '#444441');
    return;
  }

  const ratio = cmv / cmvAlvo;
  const ratioLimitado = Math.max(0, Math.min(2, ratio));
  const angulo = 180 - (ratioLimitado / 2) * 180;
  const anguloRad = angulo * Math.PI / 180;

  // Centro do gauge: (100, 100), raio: 70 (maior que o do modal)
  const cx = 100, cy = 100, r = 70;
  const px = cx + r * Math.cos(Math.PI - anguloRad);
  const py = cy - r * Math.sin(Math.PI - anguloRad);

  const startX = 30, startY = 100;
  const largeArc = (180 - angulo) > 180 ? 1 : 0;
  const arcPath = `M ${startX} ${startY} A ${r} ${r} 0 ${largeArc} 1 ${px.toFixed(2)} ${py.toFixed(2)}`;
  arc.setAttribute('d', arcPath);

  let corArco, corNeedle;
  if (ratio < 0.80) {
    corArco = '#639922'; corNeedle = '#173404';
  } else if (ratio < 1.0) {
    corArco = '#FAC775'; corNeedle = '#854F0B';
  } else if (ratio < 1.2) {
    corArco = '#EF9F27'; corNeedle = '#633806';
  } else {
    corArco = '#E24B4A'; corNeedle = '#791F1F';
  }

  arc.setAttribute('stroke', corArco);
  needle.setAttribute('x2', px.toFixed(2));
  needle.setAttribute('y2', py.toFixed(2));
  needle.setAttribute('stroke', corNeedle);
}

// ============================================================================
// VENDAS - Análises Estratégicas (Fase 3D)
// ============================================================================

// Filtra vendas vinculadas pelo período da análise
function filtrarVendasAnalises() {
  let v = vendas.filter(x => x.fichaId && !x.ignorado);
  if (analisesPeriodoTipo === 'mes-atual') {
    const h = new Date();
    const prefix = `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, '0')}`;
    v = v.filter(x => x.data && x.data.startsWith(prefix));
  } else if (analisesPeriodoTipo === 'mes-especifico' && analisesMesEspecifico) {
    v = v.filter(x => x.data && x.data.startsWith(analisesMesEspecifico));
  }
  return v;
}

// Agrupa vendas vinculadas por ficha
function agruparVendasPorFicha(vendasFiltradas) {
  const porFicha = {};
  for (const v of vendasFiltradas) {
    const ficha = fichas.find(f => f.id === v.fichaId);
    if (!ficha) continue;
    if (!porFicha[ficha.id]) {
      porFicha[ficha.id] = {
        ficha,
        nome: ficha.nome,
        quantidade: 0,
        receita: 0,
        custoPorPorcao: calcularCustoPorPorcao(ficha, insumos, fichas)
      };
    }
    porFicha[ficha.id].quantidade += v.quantidade || 0;
    porFicha[ficha.id].receita += v.total || 0;
  }
  // Calcula custo total e CMV de cada
  return Object.values(porFicha).map(p => ({
    ...p,
    custo: p.quantidade * p.custoPorPorcao,
    cmv: p.receita > 0 ? (p.quantidade * p.custoPorPorcao) / p.receita : 0,
    margem: p.receita - (p.quantidade * p.custoPorPorcao)
  }));
}

function calcularAnalises() {
  const vendasFiltradas = filtrarVendasAnalises();
  const pratos = agruparVendasPorFicha(vendasFiltradas);

  if (!pratos.length) {
    return { vazio: true };
  }

  const receitaTotal = pratos.reduce((s, p) => s + p.receita, 0);
  const cmvAlvoGlobal = configPrecificacao.cmvAlvo || 0.30;

  // 🏆 Produto âncora: maior valor de "contribuição absoluta para margem"
  // = receita × (1 - cmv) = margem em valor absoluto
  const pratosOrdenadosPorContribuicao = [...pratos].sort((a, b) => b.margem - a.margem);
  const ancora = pratosOrdenadosPorContribuicao[0];
  const ancoraPctReceita = receitaTotal > 0 ? (ancora.receita / receitaTotal) * 100 : 0;

  // 🚀 Top 5 mais vendidos (por receita)
  const topReceita = [...pratos].sort((a, b) => b.receita - a.receita).slice(0, 5);

  // 💎 Top 5 maiores margens (menor CMV)
  // Filtra apenas pratos com volume mínimo (>= 3 vendas) pra não enviesar
  const topMargens = pratos
    .filter(p => p.quantidade >= 3)
    .sort((a, b) => a.cmv - b.cmv)
    .slice(0, 5);

  // 💡 Sugestões pra promoção: CMV bom + vendas abaixo da mediana
  // Calcula mediana das quantidades
  const qtds = pratos.map(p => p.quantidade).sort((a, b) => a - b);
  const mediana = qtds.length > 0 ? qtds[Math.floor(qtds.length / 2)] : 0;
  const promocao = pratos
    .filter(p => {
      const ratio = p.cmv / cmvAlvoGlobal;
      return ratio < 0.80 && p.quantidade < mediana && p.quantidade >= 2;
    })
    .sort((a, b) => a.cmv - b.cmv)
    .slice(0, 5);

  // ⚠️ Pratos pra revisar - 2 grupos
  // (a) CMV alto (> 120% do alvo)
  const cmvAlto = pratos
    .filter(p => (p.cmv / cmvAlvoGlobal) > 1.2)
    .sort((a, b) => b.cmv - a.cmv)
    .slice(0, 5);
  // (b) Baixa rotação (bottom 5 em quantidade, mas tendo pelo menos 1 venda)
  const baixaRotacao = pratos
    .filter(p => p.quantidade >= 1)
    .sort((a, b) => a.quantidade - b.quantidade)
    .slice(0, 5);

  // 📅 Demanda por dia da semana (usa TODAS vendas do período, não só vinculadas)
  let todasVendasPeriodo = vendas;
  if (analisesPeriodoTipo === 'mes-atual') {
    const h = new Date();
    const prefix = `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, '0')}`;
    todasVendasPeriodo = vendas.filter(x => x.data && x.data.startsWith(prefix));
  } else if (analisesPeriodoTipo === 'mes-especifico' && analisesMesEspecifico) {
    todasVendasPeriodo = vendas.filter(x => x.data && x.data.startsWith(analisesMesEspecifico));
  }

  const demandaPorDia = [0, 0, 0, 0, 0, 0, 0];  // [Dom, Seg, Ter, Qua, Qui, Sex, Sáb]
  for (const v of todasVendasPeriodo) {
    if (!v.data) continue;
    const [ano, mes, dia] = v.data.split('-');
    const d = new Date(parseInt(ano), parseInt(mes) - 1, parseInt(dia));
    const diaSemana = d.getDay();
    demandaPorDia[diaSemana] += v.total || 0;
  }

  return {
    vazio: false,
    receitaTotal,
    cmvAlvoGlobal,
    ancora: { ...ancora, pctReceita: ancoraPctReceita },
    topReceita,
    topMargens,
    promocao,
    cmvAlto,
    baixaRotacao,
    demandaPorDia
  };
}

function renderAnalises() {
  // Atualiza select de meses
  const mesesDisponiveis = listarMesesDisponiveis();
  const selectMeses = $('analises-filtro-mes');
  if (selectMeses.options.length !== mesesDisponiveis.length || selectMeses.options.length === 0) {
    selectMeses.innerHTML = mesesDisponiveis.map(m => `<option value="${m}">${nomeMes(m)}</option>`).join('');
  }
  if (analisesPeriodoTipo === 'mes-especifico' && !analisesMesEspecifico && mesesDisponiveis.length > 0) {
    analisesMesEspecifico = mesesDisponiveis[0];
    selectMeses.value = analisesMesEspecifico;
  }
  selectMeses.style.display = analisesPeriodoTipo === 'mes-especifico' ? 'inline-block' : 'none';

  // Texto do período
  const hoje = new Date();
  const NOMES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
                 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  let periodoTxt = '';
  if (analisesPeriodoTipo === 'mes-atual') {
    periodoTxt = `${NOMES[hoje.getMonth()]} ${hoje.getFullYear()}`;
  } else if (analisesPeriodoTipo === 'mes-especifico' && analisesMesEspecifico) {
    periodoTxt = nomeMes(analisesMesEspecifico);
  } else {
    periodoTxt = `Todo histórico`;
  }
  $('analises-periodo-texto').textContent = periodoTxt;

  const a = calcularAnalises();

  if (a.vazio) {
    $('analises-conteudo').innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">🎯</div>
      <div class="empty-state-text">Nenhuma análise disponível neste período.<br>Importe vendas e vincule produtos a fichas em <strong>🔗 Vínculos</strong>.</div>
    </div>`;
    return;
  }

  let html = '';

  // 🏆 PRODUTO ÂNCORA
  if (a.ancora) {
    const stars = '⭐⭐⭐⭐⭐';
    const cmvAlvoEfetivo = a.ancora.ficha.cmvAlvoCustom ?? a.cmvAlvoGlobal;
    html += `<div class="ancora-card">`;
    html += `<div class="ancora-label">🏆 Produto Âncora</div>`;
    html += `<div class="ancora-nome">${escHtml(a.ancora.nome)}</div>`;
    html += `<div class="ancora-stats"><strong>${fmtMoeda(a.ancora.receita)}</strong> em receita · CMV <strong>${(a.ancora.cmv * 100).toFixed(1)}%</strong> · ${Math.round(a.ancora.quantidade)} vendas</div>`;
    html += `<div class="ancora-contribui">Responde por ${a.ancora.pctReceita.toFixed(1)}% da sua receita vinculada</div>`;
    html += `<div class="ancora-stars">${stars} Carro-chefe</div>`;
    html += `</div>`;
  }

  // 🚀 TOP 5 MAIS VENDIDOS (por receita)
  html += `<div class="analise-section">`;
  html += `<div class="analise-section-titulo">🚀 Top 5 — Mais vendidos <span class="analise-section-subtitulo">(por receita)</span></div>`;
  html += `<ul class="top-lista">`;
  for (let i = 0; i < a.topReceita.length; i++) {
    const p = a.topReceita[i];
    html += `<li class="top-item">`;
    html += `<span class="top-item-numero">${i + 1}</span>`;
    html += `<span class="top-item-nome">${escHtml(p.nome)}</span>`;
    html += `<span class="top-item-valores">`;
    html += `<div class="top-item-valor-principal">${fmtMoeda(p.receita)}</div>`;
    html += `<div class="top-item-valor-meta">${Math.round(p.quantidade)} un · CMV ${(p.cmv * 100).toFixed(1)}%</div>`;
    html += `</span>`;
    html += `</li>`;
  }
  html += `</ul></div>`;

  // 💎 TOP 5 MAIORES MARGENS
  html += `<div class="analise-section">`;
  html += `<div class="analise-section-titulo">💎 Top 5 — Maiores margens <span class="analise-section-subtitulo">(CMV mais baixo, mín. 3 vendas)</span></div>`;
  if (a.topMargens.length === 0) {
    html += `<div style="font-size:12px;color:var(--muted);font-style:italic">Sem dados suficientes (precisa de pratos com 3+ vendas)</div>`;
  } else {
    html += `<ul class="top-lista">`;
    for (let i = 0; i < a.topMargens.length; i++) {
      const p = a.topMargens[i];
      html += `<li class="top-item">`;
      html += `<span class="top-item-numero">${i + 1}</span>`;
      html += `<span class="top-item-nome">${escHtml(p.nome)}</span>`;
      html += `<span class="top-item-valores">`;
      html += `<div class="top-item-valor-principal" style="color:#173404">CMV ${(p.cmv * 100).toFixed(1)}%</div>`;
      html += `<div class="top-item-valor-meta">${Math.round(p.quantidade)} un · ${fmtMoeda(p.receita)}</div>`;
      html += `</span>`;
      html += `</li>`;
    }
    html += `</ul>`;
  }
  html += `</div>`;

  // 💡 SUGESTÕES PRA PROMOÇÃO
  html += `<div class="analise-section">`;
  html += `<div class="analise-section-titulo">💡 Sugestões pra promoção <span class="analise-section-subtitulo">(margem ótima mas vendendo pouco)</span></div>`;
  if (a.promocao.length === 0) {
    html += `<div style="font-size:12px;color:var(--muted);font-style:italic">Nenhum prato identificado neste período. Todos os pratos com margem boa já estão com bom volume de vendas! 🎉</div>`;
  } else {
    for (const p of a.promocao) {
      html += `<div class="sugestao-card">`;
      html += `<div class="sugestao-nome">${escHtml(p.nome)}</div>`;
      html += `<div class="sugestao-stats">CMV ${(p.cmv * 100).toFixed(1)}% · ${Math.round(p.quantidade)} un · ${fmtMoeda(p.receita)}</div>`;
      html += `<div class="sugestao-comentario">Margem ótima! Vale a pena destacar no cardápio ou promover.</div>`;
      html += `</div>`;
    }
  }
  html += `</div>`;

  // ⚠️ PRATOS PRA REVISAR
  html += `<div class="analise-section">`;
  html += `<div class="analise-section-titulo">⚠️ Pratos pra revisar</div>`;

  if (a.cmvAlto.length > 0) {
    html += `<div style="font-size:12px;color:var(--muted);margin-bottom:6px;font-weight:600">CMV muito acima do alvo:</div>`;
    for (const p of a.cmvAlto) {
      html += `<div class="sugestao-card critico">`;
      html += `<div class="sugestao-nome">${escHtml(p.nome)}</div>`;
      html += `<div class="sugestao-stats">CMV <strong style="color:#791F1F">${(p.cmv * 100).toFixed(1)}%</strong> (alvo ${Math.round(a.cmvAlvoGlobal * 100)}%) · ${Math.round(p.quantidade)} un · ${fmtMoeda(p.receita)}</div>`;
      html += `<div class="sugestao-comentario">Margem comprimida. Considere ajustar preço de venda ou rever ingredientes.</div>`;
      html += `</div>`;
    }
    html += `<div style="height:10px"></div>`;
  }

  if (a.baixaRotacao.length > 0) {
    html += `<div style="font-size:12px;color:var(--muted);margin-bottom:6px;font-weight:600">Baixa rotação no período:</div>`;
    for (const p of a.baixaRotacao) {
      html += `<div class="sugestao-card atencao">`;
      html += `<div class="sugestao-nome">${escHtml(p.nome)}</div>`;
      html += `<div class="sugestao-stats">${Math.round(p.quantidade)} un · CMV ${(p.cmv * 100).toFixed(1)}% · ${fmtMoeda(p.receita)}</div>`;
      html += `<div class="sugestao-comentario">Pouca venda no período. Avaliar se vale a pena manter no cardápio.</div>`;
      html += `</div>`;
    }
  }

  if (a.cmvAlto.length === 0 && a.baixaRotacao.length === 0) {
    html += `<div style="font-size:12px;color:var(--muted);font-style:italic">Nenhum prato com sinais de alerta. Seu cardápio está bem balanceado! 👏</div>`;
  }
  html += `</div>`;

  // 📅 DEMANDA POR DIA DA SEMANA
  const diasNomes = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const maxDemanda = Math.max(...a.demandaPorDia);
  const totalDemanda = a.demandaPorDia.reduce((s, v) => s + v, 0);
  const diasComVenda = a.demandaPorDia.filter(v => v > 0).length;

  if (totalDemanda > 0) {
    html += `<div class="analise-section">`;
    html += `<div class="analise-section-titulo">📅 Demanda por dia da semana <span class="analise-section-subtitulo">(receita por dia)</span></div>`;
    html += `<div class="demanda-barras">`;
    for (let i = 0; i < 7; i++) {
      const valor = a.demandaPorDia[i];
      const pct = maxDemanda > 0 ? (valor / maxDemanda) * 100 : 0;
      const ehPico = valor === maxDemanda && valor > 0;
      const fmt = valor >= 1000 ? `R$${(valor / 1000).toFixed(1)}k` : `R$${valor.toFixed(0)}`;
      html += `<div class="demanda-linha">`;
      html += `<span class="demanda-dia">${diasNomes[i]}</span>`;
      html += `<div class="demanda-barra-wrap"><div class="demanda-barra-fill" style="width:${pct.toFixed(1)}%"></div></div>`;
      html += `<span class="demanda-valor">${fmt}`;
      if (ehPico) html += `<span class="demanda-pico"> pico</span>`;
      html += `</span>`;
      html += `</div>`;
    }
    html += `</div>`;
    if (diasComVenda > 0) {
      html += `<div style="font-size:11px;color:var(--muted);margin-top:10px;font-style:italic">💡 Use essa visão pra programar compras: planeje estoque considerando os dias de pico.</div>`;
    }
    html += `</div>`;
  }

  $('analises-conteudo').innerHTML = html;
}

// ============================================================================
// VENDAS - Sugestão de Compras (Fase 3E)
// ============================================================================

// Filtra vendas pelo período base selecionado
function filtrarVendasCompras() {
  let v = vendas.filter(x => x.fichaId && !x.ignorado);
  if (comprasBaseTipo === 'mes-atual') {
    const h = new Date();
    const prefix = `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, '0')}`;
    v = v.filter(x => x.data && x.data.startsWith(prefix));
  } else if (comprasBaseTipo === 'mes-especifico' && comprasBaseMes) {
    v = v.filter(x => x.data && x.data.startsWith(comprasBaseMes));
  }
  return v;
}

// Conta quantos dias únicos têm vendas no período filtrado
function contarDiasBase() {
  let diasUnicos;
  if (comprasBaseTipo === 'mes-atual') {
    const h = new Date();
    const prefix = `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, '0')}`;
    diasUnicos = vendasDias.filter(d => d.data && d.data.startsWith(prefix));
  } else if (comprasBaseTipo === 'mes-especifico' && comprasBaseMes) {
    diasUnicos = vendasDias.filter(d => d.data && d.data.startsWith(comprasBaseMes));
  } else {
    diasUnicos = vendasDias;
  }
  return diasUnicos.length;
}

// Calcula receita histórica por dia da semana (pra fator de ajuste)
function calcularReceitaPorDiaSemana(vendasFiltradas) {
  const porDia = [0, 0, 0, 0, 0, 0, 0];  // [Dom, Seg, ..., Sáb]
  for (const v of vendasFiltradas) {
    if (!v.data) continue;
    const [ano, mes, dia] = v.data.split('-');
    const d = new Date(parseInt(ano), parseInt(mes) - 1, parseInt(dia));
    porDia[d.getDay()] += v.total || 0;
  }
  return porDia;
}

// Gera array de dias futuros a partir de hoje
function gerarDiasFuturos(quantidadeDias) {
  const dias = [];
  const hoje = new Date();
  for (let i = 1; i <= quantidadeDias; i++) {
    const d = new Date(hoje);
    d.setDate(hoje.getDate() + i);
    dias.push(d);
  }
  return dias;
}

// Encontra o item de catálogo correspondente a um insumo
function encontrarItemDoInsumo(insumoId) {
  return itens.find(i => i.insumoId === insumoId);
}

// Calcula classe ABC: A = top X que somam 80% do custo, B = +15%, C = restante 5%
function classificarABC(itensOrdenados) {
  // itensOrdenados deve estar em ordem decrescente de custo
  const total = itensOrdenados.reduce((s, i) => s + (i.custoProjetado || 0), 0);
  if (total === 0) return itensOrdenados.map(i => ({ ...i, classe: 'C' }));

  let acumulado = 0;
  return itensOrdenados.map(i => {
    acumulado += (i.custoProjetado || 0);
    const pct = acumulado / total;
    let classe = 'C';
    if (pct <= 0.80) classe = 'A';
    else if (pct <= 0.95) classe = 'B';
    return { ...i, classe };
  });
}

// Núcleo: calcula sugestões de compra completas
function calcularSugestaoCompras() {
  const vendasFiltradas = filtrarVendasCompras();
  if (!vendasFiltradas.length) return { vazio: true, motivo: 'sem-vendas' };

  const diasBase = contarDiasBase();
  if (diasBase === 0) return { vazio: true, motivo: 'sem-dias' };

  // 1. Calcula consumo do período (usando função pura do db.js)
  const consumos = calcularConsumoInsumos(vendasFiltradas, fichas, insumos);
  if (!consumos.length) return { vazio: true, motivo: 'sem-consumo' };

  // 2. Fator de ajuste pelo dia da semana
  const receitaPorDia = calcularReceitaPorDiaSemana(vendasFiltradas);
  const diasFuturos = gerarDiasFuturos(comprasHorizonte);
  const fatorAjuste = calcularFatorAjustePorDiaSemana(receitaPorDia, diasFuturos);

  // 3. Projeção: consumo médio diário × dias do horizonte × fator × (1 + margem)
  const margemMultiplicador = 1 + (comprasMargem / 100);
  const sugestoes = consumos.map(c => {
    const consumoMedioDia = c.consumoBruto / diasBase;
    const projecao = consumoMedioDia * comprasHorizonte * fatorAjuste;
    const sugestao = projecao * margemMultiplicador;
    const custoProjetado = sugestao * (c.insumo.precoPorUnidade || 0);
    const itemCatalogo = encontrarItemDoInsumo(c.insumoId);
    return {
      ...c,
      consumoMedioDia,
      projecao,
      sugestao,
      custoProjetado,
      itemCatalogo  // pode ser undefined
    };
  });

  // 4. Ordena por custo decrescente
  sugestoes.sort((a, b) => b.custoProjetado - a.custoProjetado);

  // 5. Aplica classificação ABC
  const sugestoesClassificadas = classificarABC(sugestoes);

  // 6. Estatísticas
  const totalCusto = sugestoesClassificadas.reduce((s, i) => s + i.custoProjetado, 0);
  const receitaVinculadaPeriodo = vendasFiltradas.reduce((s, v) => s + (v.total || 0), 0);
  const receitaTotalPeriodo = (() => {
    let vp = vendas;
    if (comprasBaseTipo === 'mes-atual') {
      const h = new Date();
      const prefix = `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, '0')}`;
      vp = vendas.filter(x => x.data && x.data.startsWith(prefix));
    } else if (comprasBaseTipo === 'mes-especifico' && comprasBaseMes) {
      vp = vendas.filter(x => x.data && x.data.startsWith(comprasBaseMes));
    }
    return vp.reduce((s, v) => s + (v.total || 0), 0);
  })();
  const cobertura = receitaTotalPeriodo > 0 ? receitaVinculadaPeriodo / receitaTotalPeriodo : 0;

  return {
    vazio: false,
    sugestoes: sugestoesClassificadas,
    totalCusto,
    diasBase,
    fatorAjuste,
    cobertura,
    receitaVinculadaPeriodo,
    receitaTotalPeriodo
  };
}

// Helper: formata quantidade do insumo de acordo com a unidade
function fmtQtdInsumo(qtd, unidade) {
  const u = unidade || 'KG';
  if (u === 'UND') {
    return `${Math.ceil(qtd)} ${u}`;
  }
  return `${qtd.toFixed(2)} ${u}`;
}

function renderCompras() {
  // Popular dropdown de meses
  const mesesDisponiveis = listarMesesDisponiveis();
  const selectMeses = $('compras-base-mes');
  if (selectMeses.options.length !== mesesDisponiveis.length || selectMeses.options.length === 0) {
    selectMeses.innerHTML = mesesDisponiveis.map(m => `<option value="${m}">${nomeMes(m)}</option>`).join('');
  }
  if (comprasBaseTipo === 'mes-especifico' && !comprasBaseMes && mesesDisponiveis.length > 0) {
    comprasBaseMes = mesesDisponiveis[0];
    selectMeses.value = comprasBaseMes;
  }
  selectMeses.style.display = comprasBaseTipo === 'mes-especifico' ? 'inline-block' : 'none';

  const r = calcularSugestaoCompras();
  comprasResultadoAtual = r;

  if (r.vazio) {
    let msg = '';
    if (r.motivo === 'sem-vendas') {
      msg = 'Sem vendas vinculadas a fichas no período. Vincule produtos em <strong>🔗 Vínculos</strong> primeiro.';
    } else if (r.motivo === 'sem-dias') {
      msg = 'Nenhum dia importado neste período. Vá em <strong>📥 Importar</strong> primeiro.';
    } else {
      msg = 'As fichas vinculadas não têm ingredientes cadastrados. Edite as fichas em <strong>🍽️ Cardápio</strong>.';
    }

    $('compras-vazio').innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">🛒</div>
      <div class="empty-state-text">${msg}</div>
    </div>`;
    $('compras-vazio').style.display = 'block';
    $('compras-lista-wrap').style.display = 'none';
    $('compras-abc-wrap').style.display = 'none';
    $('compras-cobertura').textContent = '—';
    $('compras-base-dias').textContent = '—';
    $('compras-total-insumos').textContent = '0';
    $('compras-total-valor').textContent = 'R$ 0,00';
    $('compras-fator-ajuste').textContent = '—';
    return;
  }

  $('compras-vazio').style.display = 'none';
  $('compras-lista-wrap').style.display = 'block';
  $('compras-abc-wrap').style.display = 'block';

  // Stats
  $('compras-cobertura').textContent = `${Math.round(r.cobertura * 100)}%`;
  $('compras-base-dias').textContent = `${r.diasBase} dia${r.diasBase > 1 ? 's' : ''} de base`;
  $('compras-total-insumos').textContent = r.sugestoes.length;
  $('compras-total-valor').textContent = fmtMoeda(r.totalCusto);
  $('compras-fator-ajuste').textContent = r.fatorAjuste === 1
    ? 'sem ajuste'
    : `ajuste ${r.fatorAjuste > 1 ? '+' : ''}${((r.fatorAjuste - 1) * 100).toFixed(0)}% (dias semana)`;

  // Marca por padrão apenas os classe A se ainda não tiver seleção
  if (Object.keys(comprasSelecionados).length === 0) {
    for (const s of r.sugestoes) {
      if (s.classe === 'A') {
        comprasSelecionados[s.insumoId] = true;
      }
    }
  }

  // Lista de insumos
  let html = '';
  for (const s of r.sugestoes) {
    const checked = comprasSelecionados[s.insumoId] ? 'checked' : '';
    const itemTag = s.itemCatalogo
      ? `<span class="classe-label ${s.classe === 'A' ? 'classe-A-tag' : ''}">${s.classe}</span>`
      : `<span class="classe-label ${s.classe === 'A' ? 'classe-A-tag' : ''}">${s.classe}</span><span class="sem-item-tag" title="Este insumo não tem item de compra vinculado no catálogo">⚠ sem item</span>`;

    const disabled = !s.itemCatalogo ? 'disabled title="Sem item de compra vinculado"' : '';

    html += `<div class="compra-card ${s.classe === 'A' ? 'classe-A' : ''}">`;
    html += `<input type="checkbox" class="compra-check" data-insumo="${s.insumoId}" ${checked} ${disabled}>`;
    html += `<div class="compra-info">`;
    html += `<div class="compra-nome">${escHtml(s.insumo.nome)}</div>`;
    html += `<div class="compra-meta">${itemTag} · ${s.consumoMedioDia.toFixed(2)} ${s.insumo.unidade}/dia</div>`;
    html += `</div>`;
    html += `<div class="compra-quantidade">${fmtQtdInsumo(s.sugestao, s.insumo.unidade)}</div>`;
    html += `<div class="compra-valor">${fmtMoeda(s.custoProjetado)}</div>`;
    html += `</div>`;
  }
  $('compras-lista').innerHTML = html;

  atualizarComprasSelecionados();

  // Curva ABC
  renderCurvaABC(r.sugestoes);
}

function atualizarComprasSelecionados() {
  if (!comprasResultadoAtual || comprasResultadoAtual.vazio) return;
  let valor = 0;
  let count = 0;
  let temItemValido = false;
  for (const s of comprasResultadoAtual.sugestoes) {
    if (comprasSelecionados[s.insumoId]) {
      valor += s.custoProjetado;
      count++;
      if (s.itemCatalogo) temItemValido = true;
    }
  }
  $('compras-selecionados-valor').textContent = fmtMoeda(valor);
  $('compras-selecionados-count').textContent = `${count} ${count === 1 ? 'insumo' : 'insumos'}`;
  $('btn-criar-lista-compras').disabled = !temItemValido;
}

function renderCurvaABC(sugestoes) {
  const grupos = { A: [], B: [], C: [] };
  for (const s of sugestoes) grupos[s.classe].push(s);

  const total = sugestoes.reduce((s, i) => s + (i.custoProjetado || 0), 0);

  let html = '';
  for (const letra of ['A', 'B', 'C']) {
    const itens = grupos[letra];
    if (itens.length === 0) continue;
    const custoGrupo = itens.reduce((s, i) => s + i.custoProjetado, 0);
    const pctGrupo = total > 0 ? (custoGrupo / total) * 100 : 0;

    const descricoes = {
      A: 'Críticos — 80% do custo',
      B: 'Importantes — 15% do custo',
      C: 'Secundários — 5% do custo'
    };

    html += `<div class="abc-grupo">`;
    html += `<div class="abc-letra ${letra}">${letra}</div>`;
    html += `<div class="abc-info">`;
    html += `<div class="abc-titulo">${descricoes[letra]}</div>`;
    html += `<div class="abc-percentual">${itens.length} ${itens.length === 1 ? 'insumo' : 'insumos'} · ${fmtMoeda(custoGrupo)} (${pctGrupo.toFixed(1)}% do total)</div>`;
    html += `<div class="abc-insumos">${itens.slice(0, 8).map(i => escHtml(i.insumo.nome)).join(', ')}${itens.length > 8 ? ` <em>+${itens.length - 8} outros</em>` : ''}</div>`;
    html += `</div>`;
    html += `</div>`;
  }

  $('compras-abc-conteudo').innerHTML = html;
}

async function criarListaDaSugestao() {
  if (!comprasResultadoAtual || comprasResultadoAtual.vazio) return;

  const itensParaAdicionar = [];
  let semItemCount = 0;
  for (const s of comprasResultadoAtual.sugestoes) {
    if (!comprasSelecionados[s.insumoId]) continue;
    if (!s.itemCatalogo) {
      semItemCount++;
      continue;
    }
    // Arredonda quantidade pra cima se UND, senão 2 decimais
    const qtdFinal = s.insumo.unidade === 'UND' ? Math.ceil(s.sugestao) : parseFloat(s.sugestao.toFixed(2));
    itensParaAdicionar.push({ itemId: s.itemCatalogo.id, qtd: qtdFinal });
  }

  if (!itensParaAdicionar.length) {
    showToast('⚠ Nenhum insumo selecionado com item de compra válido', 'error');
    return;
  }

  const btn = $('btn-criar-lista-compras');
  btn.disabled = true;
  btn.textContent = 'Adicionando...';

  try {
    const n = await adicionarItensListaEmCriacaoEmLote(itensParaAdicionar);
    let msg = `✓ ${n} ${n === 1 ? 'item adicionado' : 'itens adicionados'} à Lista em Criação`;
    if (semItemCount > 0) {
      msg += ` (${semItemCount} sem item de compra ignorados)`;
    }
    showToast(msg, 'success');

    // Reseta seleção pra não duplicar acidentalmente
    comprasSelecionados = {};

    // Vai pra aba Criar Lista
    setTimeout(() => switchTab('criar'), 600);
  } catch (e) {
    showToast('⚠ Erro: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '📥 Adicionar à Lista em Criação';
  }
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
  document.querySelectorAll('[data-subtab]').forEach(b => {
    b.addEventListener('click', () => switchSubTabCardapio(b.dataset.subtab));
  });

  // Sub-navegação de Vendas
  document.querySelectorAll('[data-vendas-subtab]').forEach(b => {
    b.addEventListener('click', () => switchSubTabVendas(b.dataset.vendasSubtab));
  });

  // Vendas - Importação
  $('btn-analisar-relatorio').addEventListener('click', analisarRelatorio);
  $('btn-confirmar-importacao').addEventListener('click', confirmarImportacao);
  $('btn-cancelar-importacao').addEventListener('click', cancelarImportacao);
  $('btn-limpar-textarea').addEventListener('click', limparTextarea);

  // Vendas - Calendário
  $('btn-cal-anterior').addEventListener('click', () => navegarMes(-1));
  $('btn-cal-proximo').addEventListener('click', () => navegarMes(1));
  $('calendario-grid').addEventListener('click', e => {
    const cel = e.target.closest('.calendario-celula.tem-vendas');
    if (cel && cel.dataset.dia) {
      renderDetalhesDia(cel.dataset.dia);
    }
  });
  $('btn-deletar-dia').addEventListener('click', deletarDiaSelecionado);

  // Vendas - Dados (busca)
  $('search-vendas').addEventListener('input', e => {
    searchVendas = e.target.value.trim();
    renderDadosVendas();
  });
  $('search-vendas-clear').addEventListener('click', () => {
    $('search-vendas').value = '';
    searchVendas = '';
    renderDadosVendas();
  });

  // Vendas - Vínculos (filtros e busca)
  $('filtro-vinculos').addEventListener('change', e => {
    filtroVinculos = e.target.value;
    renderVinculos();
  });
  $('search-vinculos').addEventListener('input', e => {
    searchVinculos = e.target.value.trim();
    renderVinculos();
  });
  $('search-vinculos-clear').addEventListener('click', () => {
    $('search-vinculos').value = '';
    searchVinculos = '';
    renderVinculos();
  });

  // Vendas - Vínculos (ações nos cards) - delegação
  $('lista-vinculos').addEventListener('change', e => {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    if (target.dataset.action === 'vinc-selecionar') {
      const produto = target.dataset.produto;
      const fichaId = target.value;
      if (fichaId) vinculoSelecionarFicha(produto, fichaId);
    }
  });
  $('lista-vinculos').addEventListener('click', e => {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    const produto = target.dataset.produto;
    if (target.dataset.action === 'vinc-desvincular') vinculoDesvincular(produto);
    else if (target.dataset.action === 'vinc-editar') vinculoEditar(produto);
    else if (target.dataset.action === 'vinc-ignorar') vinculoIgnorar(produto);
    else if (target.dataset.action === 'vinc-desfazer-ignorar') vinculoDesfazerIgnorar(produto);
  });

  // Vendas - CMV Real
  $('cmv-filtro-periodo').addEventListener('change', e => {
    cmvPeriodoTipo = e.target.value;
    if (cmvPeriodoTipo === 'mes-especifico' && !cmvMesEspecifico) {
      const meses = listarMesesDisponiveis();
      if (meses.length > 0) cmvMesEspecifico = meses[0];
    }
    renderCMVReal();
  });
  $('cmv-filtro-mes').addEventListener('change', e => {
    cmvMesEspecifico = e.target.value;
    renderCMVReal();
  });
  $('cmv-ordenar-receita').addEventListener('click', () => {
    cmvOrdenacao = 'receita';
    renderCMVReal();
  });
  $('cmv-ordenar-cmv').addEventListener('click', () => {
    cmvOrdenacao = 'cmv';
    renderCMVReal();
  });

  // Vendas - Análises (Fase 3D)
  $('analises-filtro-periodo').addEventListener('change', e => {
    analisesPeriodoTipo = e.target.value;
    if (analisesPeriodoTipo === 'mes-especifico' && !analisesMesEspecifico) {
      const meses = listarMesesDisponiveis();
      if (meses.length > 0) analisesMesEspecifico = meses[0];
    }
    renderAnalises();
  });
  $('analises-filtro-mes').addEventListener('change', e => {
    analisesMesEspecifico = e.target.value;
    renderAnalises();
  });

  // Vendas - Sugestão de Compras (Fase 3E)
  $('compras-base').addEventListener('change', e => {
    comprasBaseTipo = e.target.value;
    if (comprasBaseTipo === 'mes-especifico' && !comprasBaseMes) {
      const meses = listarMesesDisponiveis();
      if (meses.length > 0) comprasBaseMes = meses[0];
    }
    comprasSelecionados = {};  // reseta seleção quando muda período
    renderCompras();
  });
  $('compras-base-mes').addEventListener('change', e => {
    comprasBaseMes = e.target.value;
    comprasSelecionados = {};
    renderCompras();
  });
  $('compras-horizonte').addEventListener('change', e => {
    comprasHorizonte = parseInt(e.target.value, 10) || 7;
    renderCompras();
  });
  $('compras-margem').addEventListener('change', e => {
    comprasMargem = parseFloat(e.target.value) || 0;
    renderCompras();
  });

  // Lista de compras: checkbox individual
  $('compras-lista').addEventListener('change', e => {
    if (e.target.classList.contains('compra-check')) {
      const insumoId = e.target.dataset.insumo;
      if (e.target.checked) comprasSelecionados[insumoId] = true;
      else delete comprasSelecionados[insumoId];
      atualizarComprasSelecionados();
    }
  });

  // Selecionar/desmarcar todos
  $('compras-selecionar-todos').addEventListener('click', () => {
    if (!comprasResultadoAtual || comprasResultadoAtual.vazio) return;
    for (const s of comprasResultadoAtual.sugestoes) {
      if (s.itemCatalogo) comprasSelecionados[s.insumoId] = true;
    }
    renderCompras();
  });
  $('compras-deselecionar').addEventListener('click', () => {
    comprasSelecionados = {};
    renderCompras();
  });

  // Botão criar lista
  $('btn-criar-lista-compras').addEventListener('click', criarListaDaSugestao);

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
    if (target.dataset.action === 'update-ing-select') {
      atualizarIngredienteSelecionado(idx, target.value);
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
  $('modal-historico-detalhes').addEventListener('click', e => { if (e.target.id === 'modal-historico-detalhes') $('modal-historico-detalhes').classList.remove('show'); });
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
      if ($('modal-historico-detalhes').classList.contains('show')) { $('modal-historico-detalhes').classList.remove('show'); return; }
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
