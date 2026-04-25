// ===== CATÁLOGO — PRIMUS =====
// Tela de gerenciamento de produtos pelo painel do gestor.
// Permite editar, ocultar, marcar como saindo, adicionar e remover produtos
// sem precisar mexer no código fonte.
//
// Toda persistência passa pela camada de produtos-store.js, que combina
// catálogo base (produtos.js) + overrides (Firestore) → catálogo efetivo.

import {
  obterBebidas, obterSorvetes, obterGrupos,
  editarProduto, resetarEdicao,
  ocultarProduto, reativarProduto,
  marcarSaindo, desmarcarSaindo,
  adicionarProduto, editarProdutoNovo, excluirProdutoNovo,
  adicionarGrupo, removerGrupo,
  invalidarCache
} from './produtos-store.js';
import { FORNECEDORES_PADRAO } from './produtos.js';

// ===== ESTADO =====
let tipoAtual = 'bebidas';        // 'bebidas' | 'sorvetes'
let mostrarOcultos = false;
let busca = '';
let listaCache = [];              // catálogo efetivo do tipo atual
let editandoSlug = null;          // slug do produto sendo editado no modal

// ===== INICIALIZAÇÃO =====
export async function inicializarCatalogo() {
  const container = document.getElementById('catalogo-container');
  if (!container) return;

  container.innerHTML = `
    <div class="card">
      <div class="grafico-head">
        <h3>📦 Catálogo de Produtos</h3>
        <span class="grafico-sub" id="cat-sub">carregando...</span>
      </div>

      <div class="cat-toolbar">
        <div class="cat-tipo-toggle">
          <button class="cat-tipo-btn ativo" id="cat-tipo-beb" data-tipo="bebidas">
            🍺 Bebidas
          </button>
          <button class="cat-tipo-btn" id="cat-tipo-sorv" data-tipo="sorvetes">
            🍨 Sorvetes &amp; Embalagens
          </button>
        </div>
        <button class="btn btn-primary" id="cat-btn-novo">+ Novo produto</button>
      </div>

      <div class="cat-filtros">
        <input type="text" id="cat-busca" placeholder="🔍 Buscar produto..." class="cat-busca-input">
        <label class="cat-checkbox">
          <input type="checkbox" id="cat-ocultos">
          <span>Mostrar ocultos</span>
        </label>
        <button class="btn btn-ghost btn-sm" id="cat-btn-grupo">+ Novo grupo</button>
      </div>

      <div id="cat-loading" style="text-align:center;padding:40px">
        <span class="spinner"></span>
        <div style="margin-top:10px;color:var(--cinza-texto);font-size:13px">Carregando catálogo...</div>
      </div>

      <div id="cat-lista" style="display:none"></div>
    </div>

    <!-- Modal: Editar/Adicionar produto -->
    <div class="modal-backdrop" id="cat-modal-prod">
      <div class="modal-box" style="max-width:520px">
        <button class="modal-close" id="cat-modal-prod-close">✕</button>
        <div class="modal-head">
          <h3 id="cat-modal-titulo">Editar produto</h3>
          <p id="cat-modal-sub"></p>
        </div>
        <div style="padding:16px 24px 24px">
          <div class="cat-form">
            <label class="cat-form-label">Nome do produto</label>
            <input type="text" id="cat-f-nome" class="cat-form-input" placeholder="Ex: Coca Cola Lata">

            <label class="cat-form-label">Grupo / Categoria</label>
            <select id="cat-f-grupo" class="cat-form-input"></select>

            <label class="cat-form-label">Fornecedor (opcional)</label>
            <select id="cat-f-fornecedor" class="cat-form-input">
              <option value="">— Sem fornecedor —</option>
            </select>

            <div class="cat-form-row">
              <div>
                <label class="cat-form-label">Unidade de compra</label>
                <select id="cat-f-unid" class="cat-form-input">
                  <option value="">— Avulso —</option>
                  <option value="caixa">Caixa</option>
                  <option value="fardo">Fardo</option>
                </select>
              </div>
              <div>
                <label class="cat-form-label">Qtd por caixa/fardo</label>
                <input type="number" id="cat-f-porcaixa" class="cat-form-input" min="1" placeholder="Ex: 12">
              </div>
            </div>

            <label class="cat-checkbox" style="margin-top:10px">
              <input type="checkbox" id="cat-f-ks">
              <span>É produto KS (lata pequena)</span>
            </label>
          </div>

          <div class="cat-modal-acoes">
            <button class="btn btn-ghost" id="cat-btn-cancelar">Cancelar</button>
            <button class="btn btn-primary" id="cat-btn-salvar">💾 Salvar</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Modal: Novo grupo -->
    <div class="modal-backdrop" id="cat-modal-grupo">
      <div class="modal-box" style="max-width:420px">
        <button class="modal-close" id="cat-modal-grupo-close">✕</button>
        <div class="modal-head">
          <h3>Novo grupo</h3>
          <p>Crie uma nova categoria para organizar produtos</p>
        </div>
        <div style="padding:16px 24px 24px">
          <label class="cat-form-label">Nome (use emoji + nome, ex: "🥃 Destilados")</label>
          <input type="text" id="cat-grupo-nome" class="cat-form-input" placeholder="🥃 Destilados">
          <div class="cat-modal-acoes">
            <button class="btn btn-ghost" id="cat-grupo-cancelar">Cancelar</button>
            <button class="btn btn-primary" id="cat-grupo-salvar">Criar grupo</button>
          </div>
        </div>
      </div>
    </div>
  `;

  // Listeners
  document.getElementById('cat-tipo-beb').onclick  = () => trocarTipo('bebidas');
  document.getElementById('cat-tipo-sorv').onclick = () => trocarTipo('sorvetes');
  document.getElementById('cat-btn-novo').onclick  = abrirModalNovo;
  document.getElementById('cat-btn-grupo').onclick = abrirModalGrupo;
  document.getElementById('cat-busca').oninput = e => {
    busca = e.target.value.toLowerCase();
    renderizar();
  };
  document.getElementById('cat-ocultos').onchange = async e => {
    mostrarOcultos = e.target.checked;
    await recarregar();
  };

  document.getElementById('cat-modal-prod-close').onclick = fecharModalProd;
  document.getElementById('cat-btn-cancelar').onclick = fecharModalProd;
  document.getElementById('cat-btn-salvar').onclick = salvarProduto;

  document.getElementById('cat-modal-grupo-close').onclick = fecharModalGrupo;
  document.getElementById('cat-grupo-cancelar').onclick = fecharModalGrupo;
  document.getElementById('cat-grupo-salvar').onclick = salvarNovoGrupo;

  await recarregar();
}

// ===== TROCAR TIPO =====
async function trocarTipo(tipo) {
  if (tipo === tipoAtual) return;
  tipoAtual = tipo;
  document.getElementById('cat-tipo-beb').classList.toggle('ativo',  tipo === 'bebidas');
  document.getElementById('cat-tipo-sorv').classList.toggle('ativo', tipo === 'sorvetes');
  await recarregar();
}

// ===== RECARREGAR LISTA =====
async function recarregar() {
  document.getElementById('cat-loading').style.display = 'block';
  document.getElementById('cat-lista').style.display = 'none';

  try {
    invalidarCache();  // garante que pega o estado mais recente do Firebase
    listaCache = tipoAtual === 'sorvetes'
      ? await obterSorvetes({ incluirOcultos: mostrarOcultos })
      : await obterBebidas({ incluirOcultos: mostrarOcultos });

    document.getElementById('cat-loading').style.display = 'none';
    document.getElementById('cat-lista').style.display = 'block';
    document.getElementById('cat-sub').textContent =
      `${listaCache.length} produto${listaCache.length === 1 ? '' : 's'} ${tipoAtual === 'bebidas' ? 'de bebidas' : 'de sorvetes/embalagens'}`;

    renderizar();
  } catch (err) {
    console.error('[catálogo] erro ao recarregar:', err);
    document.getElementById('cat-loading').innerHTML =
      `<div class="preview-err">Erro ao carregar catálogo: ${err.message}</div>`;
  }
}

// ===== RENDERIZAR LISTA =====
function renderizar() {
  const lista = document.getElementById('cat-lista');

  // Aplica busca
  const filtrada = busca
    ? listaCache.filter(p =>
        p.nome.toLowerCase().includes(busca) ||
        (p.grupo || '').toLowerCase().includes(busca) ||
        (p.fornecedor || '').toLowerCase().includes(busca)
      )
    : listaCache;

  if (!filtrada.length) {
    lista.innerHTML = `
      <div class="empty-state" style="padding:40px;text-align:center">
        <div class="empty-icon">📦</div>
        <p>${busca ? 'Nenhum produto encontrado para a busca.' : 'Nenhum produto cadastrado nesta categoria.'}</p>
      </div>`;
    return;
  }

  // Agrupa por grupo
  const grupos = {};
  filtrada.forEach(p => {
    const g = p.grupo || '— Sem grupo —';
    if (!grupos[g]) grupos[g] = [];
    grupos[g].push(p);
  });

  lista.innerHTML = Object.entries(grupos).map(([grupo, produtos]) => `
    <div class="cat-grupo">
      <div class="cat-grupo-head">
        <span>${escapeHtml(grupo)}</span>
        <span class="cat-grupo-count">${produtos.length} ${produtos.length === 1 ? 'item' : 'itens'}</span>
      </div>
      ${produtos.map(p => renderLinha(p)).join('')}
    </div>
  `).join('');

  // Anexa listeners de cada linha
  lista.querySelectorAll('.cat-linha').forEach(el => {
    const slug = el.dataset.slug;
    el.querySelector('[data-acao="editar"]')?.addEventListener('click', () => abrirModalEditar(slug));
    el.querySelector('[data-acao="saindo"]')?.addEventListener('click', () => toggleSaindo(slug));
    el.querySelector('[data-acao="ocultar"]')?.addEventListener('click', () => confirmarOcultar(slug));
    el.querySelector('[data-acao="reativar"]')?.addEventListener('click', () => reativar(slug));
    el.querySelector('[data-acao="excluir"]')?.addEventListener('click', () => confirmarExcluir(slug));
    el.querySelector('[data-acao="resetar"]')?.addEventListener('click', () => resetar(slug));
  });
}

function renderLinha(p) {
  const slug = p._slug;
  const detalhes = [];
  if (p.fornecedor) detalhes.push(p.fornecedor);
  if (p.unidCompra && p.porCaixa) {
    detalhes.push(`${p.unidCompra} de ${p.porCaixa}`);
  } else if (p.porCaixa) {
    detalhes.push(`${p.porCaixa} un`);
  }
  const detalheTxt = detalhes.length ? detalhes.join(' · ') : '<em style="opacity:0.5">sem detalhes</em>';

  // Badges
  const badges = [];
  if (p._origem === 'editado') badges.push('<span class="cat-badge cat-badge-editado">editado</span>');
  if (p._origem === 'novo')    badges.push('<span class="cat-badge cat-badge-novo">novo</span>');
  if (p.ks)                    badges.push('<span class="cat-badge cat-badge-ks">KS</span>');
  if (p._status === 'saindo')  badges.push('<span class="cat-badge cat-badge-saindo">saindo</span>');
  if (p._status === 'oculto')  badges.push('<span class="cat-badge cat-badge-oculto">oculto</span>');

  // Botões — variam dependendo do estado e da origem
  const botoes = [];

  if (p._status !== 'oculto') {
    botoes.push(`<button class="cat-btn-acao" data-acao="editar" title="Editar produto">✏️</button>`);
    botoes.push(`<button class="cat-btn-acao ${p._status === 'saindo' ? 'ativo' : ''}" data-acao="saindo" title="${p._status === 'saindo' ? 'Desmarcar saindo' : 'Marcar como saindo'}">⚠️</button>`);
    botoes.push(`<button class="cat-btn-acao" data-acao="ocultar" title="Ocultar (esconder das contagens)">🚫</button>`);
  } else {
    botoes.push(`<button class="cat-btn-acao cat-btn-reativar" data-acao="reativar" title="Reativar produto">✅ Reativar</button>`);
  }

  // Produtos novos: botão de exclusão definitiva (só pra eles)
  if (p._origem === 'novo') {
    botoes.push(`<button class="cat-btn-acao cat-btn-excluir" data-acao="excluir" title="Excluir produto novo">🗑️</button>`);
  }
  // Produtos editados (do catálogo base): botão pra reverter
  if (p._origem === 'editado') {
    botoes.push(`<button class="cat-btn-acao" data-acao="resetar" title="Reverter ao catálogo padrão">↩️</button>`);
  }

  return `
    <div class="cat-linha ${p._status === 'oculto' ? 'cat-linha-oculto' : ''}" data-slug="${slug}">
      <div class="cat-linha-info">
        <div class="cat-linha-nome">
          ${escapeHtml(p.nome)}
          ${badges.join('')}
        </div>
        <div class="cat-linha-detalhes">${detalheTxt}</div>
      </div>
      <div class="cat-linha-acoes">
        ${botoes.join('')}
      </div>
    </div>
  `;
}

// ===== MODAL: EDITAR PRODUTO =====
async function abrirModalEditar(slug) {
  const p = listaCache.find(x => x._slug === slug);
  if (!p) return;
  editandoSlug = slug;

  document.getElementById('cat-modal-titulo').textContent = 'Editar produto';
  document.getElementById('cat-modal-sub').textContent =
    p._origem === 'novo'
      ? 'Produto adicionado por você'
      : (p._origem === 'editado' ? 'Produto do catálogo base (com edições)' : 'Produto do catálogo base');

  // Nome: produtos novos podem ter nome editado; do catálogo base, NÃO
  // (porque mudar o nome muda o slug, e isso quebra referências históricas)
  const inputNome = document.getElementById('cat-f-nome');
  inputNome.value = p.nome;
  inputNome.disabled = (p._origem !== 'novo');
  inputNome.title = p._origem !== 'novo'
    ? 'O nome de produtos do catálogo base não pode ser alterado (afetaria contagens antigas)'
    : '';

  // Preenche grupos disponíveis
  await preencherGrupos(p.grupo);

  // Preenche fornecedores
  preencherFornecedores(p.fornecedor || '');

  document.getElementById('cat-f-unid').value = p.unidCompra || '';
  document.getElementById('cat-f-porcaixa').value = p.porCaixa || '';
  document.getElementById('cat-f-ks').checked = !!p.ks;

  document.getElementById('cat-modal-prod').classList.add('open');
}

async function abrirModalNovo() {
  editandoSlug = null;

  document.getElementById('cat-modal-titulo').textContent = 'Novo produto';
  document.getElementById('cat-modal-sub').textContent =
    `Adicionar em: ${tipoAtual === 'bebidas' ? '🍺 Bebidas' : '🍨 Sorvetes & Embalagens'}`;

  const inputNome = document.getElementById('cat-f-nome');
  inputNome.value = '';
  inputNome.disabled = false;
  inputNome.title = '';

  await preencherGrupos('');
  preencherFornecedores('');

  document.getElementById('cat-f-unid').value = '';
  document.getElementById('cat-f-porcaixa').value = '';
  document.getElementById('cat-f-ks').checked = false;

  document.getElementById('cat-modal-prod').classList.add('open');
  inputNome.focus();
}

async function preencherGrupos(selecionado) {
  const select = document.getElementById('cat-f-grupo');
  const grupos = await obterGrupos(tipoAtual);
  select.innerHTML = grupos.map(g =>
    `<option value="${escapeHtml(g)}" ${g === selecionado ? 'selected' : ''}>${escapeHtml(g)}</option>`
  ).join('');
}

function preencherFornecedores(selecionado) {
  const select = document.getElementById('cat-f-fornecedor');
  const opts = ['<option value="">— Sem fornecedor —</option>'];
  FORNECEDORES_PADRAO.forEach(f => {
    opts.push(`<option value="${escapeHtml(f.nome)}" ${f.nome === selecionado ? 'selected' : ''}>${escapeHtml(f.nome)}</option>`);
  });
  // Se o fornecedor atual não está nos padrões (algum customizado), adiciona
  if (selecionado && !FORNECEDORES_PADRAO.find(f => f.nome === selecionado)) {
    opts.push(`<option value="${escapeHtml(selecionado)}" selected>${escapeHtml(selecionado)}</option>`);
  }
  select.innerHTML = opts.join('');
}

function fecharModalProd() {
  document.getElementById('cat-modal-prod').classList.remove('open');
  editandoSlug = null;
}

async function salvarProduto() {
  const nome = document.getElementById('cat-f-nome').value.trim();
  const grupo = document.getElementById('cat-f-grupo').value;
  const fornecedor = document.getElementById('cat-f-fornecedor').value || null;
  const unidCompra = document.getElementById('cat-f-unid').value || null;
  const porCaixaRaw = document.getElementById('cat-f-porcaixa').value;
  const porCaixa = porCaixaRaw ? parseInt(porCaixaRaw, 10) : null;
  const ks = document.getElementById('cat-f-ks').checked;

  if (!nome) { alert('Informe o nome do produto.'); return; }
  if (!grupo) { alert('Selecione um grupo.'); return; }
  if (porCaixa != null && (isNaN(porCaixa) || porCaixa < 1)) {
    alert('Quantidade por caixa/fardo deve ser um número >= 1.');
    return;
  }
  if (unidCompra && !porCaixa) {
    alert('Se definir unidade de compra (caixa/fardo), informe a quantidade.');
    return;
  }

  const dados = { nome, grupo };
  if (fornecedor !== null) dados.fornecedor = fornecedor;
  if (unidCompra !== null) dados.unidCompra = unidCompra;
  if (porCaixa !== null)   dados.porCaixa = porCaixa;
  if (ks)                  dados.ks = true;

  try {
    if (editandoSlug) {
      // Editando: descobre se é produto novo ou do catálogo base
      const p = listaCache.find(x => x._slug === editandoSlug);
      if (p?._origem === 'novo') {
        await editarProdutoNovo(editandoSlug, dados);
      } else {
        // Pra produtos do catálogo base, não permite editar nome (já está disabled no form)
        // Só persistimos os campos que mudaram em relação ao base
        const { nome: _, ...semNome } = dados;
        await editarProduto(editandoSlug, semNome);
      }
      mostrarToast('Produto atualizado ✓', 'ok');
    } else {
      // Novo produto
      await adicionarProduto(dados, tipoAtual);
      mostrarToast('Produto adicionado ✓', 'ok');
    }
    fecharModalProd();
    await recarregar();
  } catch (err) {
    alert('Erro ao salvar: ' + err.message);
  }
}

// ===== AÇÕES INLINE =====

async function toggleSaindo(slug) {
  const p = listaCache.find(x => x._slug === slug);
  if (!p) return;
  try {
    if (p._status === 'saindo') {
      await desmarcarSaindo(slug);
      mostrarToast(`"${p.nome}" não está mais saindo`, 'ok');
    } else {
      await marcarSaindo(slug);
      mostrarToast(`"${p.nome}" marcado como saindo ⚠️`, 'ok');
    }
    await recarregar();
  } catch (err) {
    alert('Erro: ' + err.message);
  }
}

async function confirmarOcultar(slug) {
  const p = listaCache.find(x => x._slug === slug);
  if (!p) return;
  if (!confirm(
    `Ocultar "${p.nome}"?\n\n` +
    `O produto vai SUMIR das contagens, listas de compras e auditorias futuras.\n\n` +
    `As contagens e dados HISTÓRICOS são preservados. Você pode reativar a qualquer momento.\n\n` +
    `Continuar?`
  )) return;
  try {
    await ocultarProduto(slug);
    mostrarToast(`"${p.nome}" ocultado 🚫`, 'ok');
    await recarregar();
  } catch (err) {
    alert('Erro: ' + err.message);
  }
}

async function reativar(slug) {
  try {
    await reativarProduto(slug);
    mostrarToast('Produto reativado ✓', 'ok');
    await recarregar();
  } catch (err) {
    alert('Erro: ' + err.message);
  }
}

async function confirmarExcluir(slug) {
  const p = listaCache.find(x => x._slug === slug);
  if (!p) return;
  if (!confirm(
    `EXCLUIR "${p.nome}" permanentemente?\n\n` +
    `Esta ação NÃO PODE ser desfeita.\n\n` +
    `Se este produto já apareceu em alguma contagem, é melhor OCULTAR em vez de excluir, pra preservar o histórico.\n\n` +
    `Continuar com a exclusão?`
  )) return;
  try {
    await excluirProdutoNovo(slug);
    mostrarToast(`"${p.nome}" excluído`, 'ok');
    await recarregar();
  } catch (err) {
    alert('Erro: ' + err.message);
  }
}

async function resetar(slug) {
  const p = listaCache.find(x => x._slug === slug);
  if (!p) return;
  if (!confirm(
    `Reverter "${p.nome}" ao catálogo padrão?\n\n` +
    `As edições que você fez nele serão removidas, e o produto volta aos valores originais do código.\n\n` +
    `Continuar?`
  )) return;
  try {
    await resetarEdicao(slug);
    mostrarToast('Produto revertido ao padrão', 'ok');
    await recarregar();
  } catch (err) {
    alert('Erro: ' + err.message);
  }
}

// ===== MODAL: NOVO GRUPO =====

function abrirModalGrupo() {
  document.getElementById('cat-grupo-nome').value = '';
  document.getElementById('cat-modal-grupo').classList.add('open');
  document.getElementById('cat-grupo-nome').focus();
}

function fecharModalGrupo() {
  document.getElementById('cat-modal-grupo').classList.remove('open');
}

async function salvarNovoGrupo() {
  const nome = document.getElementById('cat-grupo-nome').value.trim();
  if (!nome) { alert('Informe o nome do grupo.'); return; }
  try {
    await adicionarGrupo(nome);
    mostrarToast(`Grupo "${nome}" criado ✓`, 'ok');
    fecharModalGrupo();
    // Não precisa recarregar a lista, mas o dropdown do modal já vai pegar
    // o novo grupo na próxima vez que abrir.
  } catch (err) {
    alert('Erro: ' + err.message);
  }
}

// ===== UTIL =====
function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function mostrarToast(msg, tipo = '') {
  const t = document.getElementById('toast');
  if (!t) {
    // fallback simples se não houver elemento toast no DOM
    console.log('[catálogo]', msg);
    return;
  }
  t.textContent = msg;
  t.className = 'toast show ' + tipo;
  setTimeout(() => t.className = 'toast', 2800);
}
