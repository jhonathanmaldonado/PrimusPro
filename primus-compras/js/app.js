// ============================================================================
// APP.JS — Orquestrador principal (com inputmode para mobile)
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

  $('edit-error').classList.remove('show');
  $('edit-error').textContent = '';

  $('modal-editar').classList.add('show');
  setTimeout(() => $('edit-nome').focus(), 100);
}

function fecharModalEditar() {
  $('modal-editar').classList.remove('show');
  itemEditandoId = null;
}

async function salvarEdicaoItem() {
  if (!itemEditandoId) return;

  const nome = $('edit-nome').value.trim();
  const tipo = $('edit-tipo').value.trim();
  const categoriaId = $('edit-categoria').value;
  const ordemStr = $('edit-ordem').value;
  const ordem = ordemStr === '' ? 0 : parseInt(ordemStr, 10);

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
    gerarPdfLista();
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
// PDF
// ============================================================================

function gerarPdfLista() {
  const hoje = new Date();
  const dd = String(hoje.getDate()).padStart(2, '0');
  const mm = String(hoje.getMonth() + 1).padStart(2, '0');
  const aaaa = hoje.getFullYear();
  const nomeArquivo = `Lista_Compras_${dd}-${mm}-${aaaa}`;

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
        h2 {
          color: #fff;
          background: #7A1F38;
          padding: 4px 8px;
          font-size: 11px;
          margin-top: 8px;
          margin-bottom: 0;
        }
        table {
          width: 100%;
          border-collapse: collapse;
        }
        th {
          background: #faf6f3;
          font-size: 9px;
          text-transform: uppercase;
          padding: 3px 6px;
          border-bottom: 1px solid #ddd;
          color: #888;
          font-weight: 700;
        }
        td {
          padding: 3px 6px;
          border-bottom: 1px solid #eee;
          font-size: 10px;
        }
        .col-item { text-align: left; width: 38%; }
        .col-tipo { text-align: right; width: 10%; }
        .col-media { text-align: right; width: 12%; color: #888; font-size: 9px; }
        .col-ultimo { text-align: right; width: 12%; color: #888; font-size: 9px; }
        .col-qtd { text-align: right; width: 10%; font-weight: 700; color: #7A1F38; }
        .col-pago { text-align: right; width: 18%; }
        .preco-blank {
          border-bottom: 1px solid #999;
          display: inline-block;
          width: 70px;
        }
        .total {
          margin-top: 12px;
          padding: 8px 12px;
          background: #fdf4e0;
          border-left: 3px solid #E9A93A;
          font-size: 11px;
        }
        .total strong { color: #c98e1f; }
        .footer {
          margin-top: 14px;
          font-size: 8px;
          color: #888;
          text-align: center;
          border-top: 1px solid #ddd;
          padding-top: 6px;
        }
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
      .filter(i => i.categoriaId === cat.id && getQtdEmCriacao(i.id) > 0)
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
      const qtd = getQtdEmCriacao(item.id);
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
    <script>
      document.title = '${nomeArquivo}';
    </script>
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
      fornecedor: item.fornecedorPreferido || ''
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
  $('tab-equipe').style.display = tab === 'equipe' ? 'block' : 'none';
  if (tab === 'historico') renderHistorico();
  if (tab === 'fornecedores') renderFornecedores();
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

  document.querySelectorAll('[data-close-modal]').forEach(b => {
    b.addEventListener('click', () => {
      $(b.dataset.closeModal).classList.remove('show');
    });
  });
  $('modal-salvar').addEventListener('click', e => {
    if (e.target.id === 'modal-salvar') fecharModalSalvar();
  });
  $('modal-editar').addEventListener('click', e => {
    if (e.target.id === 'modal-editar') fecharModalEditar();
  });
  $('modal-fornecedor').addEventListener('click', e => {
    if (e.target.id === 'modal-fornecedor') fecharModalFornecedor();
  });
  $('modal-membro').addEventListener('click', e => {
    if (e.target.id === 'modal-membro') fecharModalMembro();
  });

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
