// ===== VENDAS — PRIMUS =====
// Importação por texto colado (PDV) + calendário mensal de cobertura de vendas.

import { parsePdvTxt, resumirParse } from './pdv-parser.js';
import { parseVendedorXProduto, validarParse } from './pdv-vxp-parser.js';
import { salvarVendas, listarDatasVendas, buscarVendasDia, listarVendas, salvarDetalhadoVxP } from './db.js';
import { recarregarDashboard } from './dashboard.js';

// Cache
let datasImportadas = [];      // só os IDs (datas) — usado no aviso de sobrescrever e no select do VxP
let vendasCache = [];          // documentos completos — alimenta o calendário
let calMes = null;             // Date do 1º dia do mês exibido no calendário
let arquivoPendente = null;    // { nome, parsed, resumo }
let arquivoVxPPendente = null; // { nome, texto, vendedores, validacao }

// ===== FORMATADORES =====
const fmtMoeda = v => 'R$ ' + (v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtInt   = v => Math.round(v || 0).toLocaleString('pt-BR');
const fmtData  = d => { const [y,m,dd] = d.split('-'); return `${dd}/${m}/${y}`; };
const fmtK     = v => { v = v || 0; return v >= 1000 ? 'R$' + (v/1000).toFixed(1) + 'k' : 'R$' + Math.round(v); };
const NOMES_MES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

// ===== CSS DO CALENDÁRIO (injetado uma única vez) =====
const VCAL_CSS = `
.vcal-totais{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:18px}
.vcal-card{border-radius:14px;padding:14px 16px;border-left:6px solid var(--vinho,#7C0047);background:#fbeef4}
.vcal-card.ouro{border-left-color:#FAB900;background:#fdf6e3;grid-column:1/-1}
.vcal-card-label{font-size:.72rem;letter-spacing:.04em;text-transform:uppercase;color:#7a6a72;font-weight:700;margin-bottom:6px}
.vcal-card-val{font-family:'DM Mono',monospace;font-size:1.5rem;font-weight:700;color:var(--vinho,#7C0047);line-height:1.1}
.vcal-card.ouro .vcal-card-val{color:#b6860a}
.vcal-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:14px;flex-wrap:wrap}
.vcal-mes{font-family:'Raleway',sans-serif;font-weight:800;font-size:1.15rem;color:var(--vinho,#7C0047)}
.vcal-nav{display:flex;gap:8px}
.vcal-nav button{border:1px solid #e4d6dd;background:#fff;border-radius:10px;padding:6px 12px;font-weight:700;color:var(--vinho,#7C0047);cursor:pointer;font-size:.85rem}
.vcal-nav button:hover{background:#fbeef4}
.vcal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:6px}
.vcal-dow{text-align:center;font-size:.68rem;font-weight:700;letter-spacing:.03em;color:#9a8c93;padding:4px 0}
.vcal-cell{position:relative;min-height:58px;border-radius:10px;border:1px solid #ececec;background:#fafafa;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:4px 2px}
.vcal-cell.off{background:transparent;border:none}
.vcal-cell.vazio .vcal-dnum{color:#bcbcbc;font-weight:600}
.vcal-cell.tem{background:#e8f6ed;border:1.5px solid #93d4a8;cursor:pointer;transition:transform .08s,box-shadow .08s}
.vcal-cell.tem:hover{transform:translateY(-1px);box-shadow:0 3px 10px rgba(31,122,61,.18)}
.vcal-cell.tem .vcal-dnum{color:#1c7a3d;font-weight:800}
.vcal-dnum{font-family:'DM Mono',monospace;font-size:1rem;line-height:1}
.vcal-dval{font-family:'DM Mono',monospace;font-size:.68rem;color:#2e8b57;margin-top:3px;font-weight:600}
.vcal-check{position:absolute;top:3px;right:5px;font-size:.7rem;color:#1c7a3d;font-weight:800}
.vcal-det{position:absolute;bottom:3px;right:4px;font-size:.62rem;opacity:.85}
.vcal-legenda{display:flex;flex-wrap:wrap;gap:14px;align-items:center;margin-top:14px;font-size:.78rem;color:#7a6a72}
.vcal-legenda .lg{display:inline-flex;align-items:center;gap:6px}
.vcal-legenda .sw{width:14px;height:14px;border-radius:4px;display:inline-block}
.vcal-legenda .sw.tem{background:#e8f6ed;border:1.5px solid #93d4a8}
.vcal-legenda .sw.vazio{background:#fafafa;border:1px solid #ececec}
@media(max-width:520px){
  .vcal-cell{min-height:50px}
  .vcal-dnum{font-size:.9rem}
  .vcal-dval{font-size:.6rem}
  .vcal-card-val{font-size:1.25rem}
}
`;

function injetarCssCalendario() {
  if (document.getElementById('vcal-style')) return;
  const style = document.createElement('style');
  style.id = 'vcal-style';
  style.textContent = VCAL_CSS;
  document.head.appendChild(style);
}

// ===== INICIALIZAÇÃO =====
export async function inicializarVendas() {
  const container = document.getElementById('vendas-container');
  if (!container) return;

  injetarCssCalendario();

  container.innerHTML = `
    <div class="card">
      <div class="grafico-head">
        <h3>📤 Importar vendas do PDV</h3>
        <span class="grafico-sub">Cole o relatório completo do Gestor Food (Ctrl+A → Ctrl+C → Ctrl+V)</span>
      </div>

      <textarea
        id="upload-texto"
        class="upload-textarea"
        placeholder="Cole aqui o conteúdo completo do relatório do PDV (Ctrl+V)..."
        rows="10"
      ></textarea>
      <div class="upload-acoes-texto">
        <span class="upload-hint" id="upload-texto-hint">0 linhas</span>
        <button class="btn btn-primary" id="btn-processar-texto">📊 Processar relatório</button>
      </div>

      <div id="preview-area" style="display:none"></div>
    </div>

    <!-- Upload adicional: Vendedor × Produto -->
    <div class="card" style="margin-top:16px">
      <div class="grafico-head">
        <h3>👥 Detalhamento Vendedor × Produto <span class="badge-opcional">opcional</span></h3>
        <span class="grafico-sub">Cole o relatório "Itens vendidos por vendedor" pra ter valores REAIS em vez de estimativas</span>
      </div>

      <div class="info-vxp">
        💡 Com esse relatório, o sistema consegue mostrar exatamente o que cada vendedor vendeu de cada produto.
        Útil para saber quem vende mais entradas, sobremesas, bebidas específicas, etc.
      </div>

      <textarea
        id="upload-texto-vxp"
        class="upload-textarea"
        placeholder="Cole aqui o conteúdo do relatório Vendedor × Produto (Ctrl+V)..."
        rows="6"
      ></textarea>
      <div class="upload-acoes-texto">
        <span class="upload-hint" id="upload-texto-vxp-hint">0 linhas</span>
        <button class="btn btn-primary" id="btn-processar-vxp">📊 Processar</button>
      </div>

      <div id="preview-vxp" style="display:none"></div>
    </div>

    <!-- Calendário de cobertura de vendas -->
    <div class="card" style="margin-top:16px">
      <div class="grafico-head">
        <h3>📅 Cobertura de vendas</h3>
        <span class="grafico-sub">Clique num dia verde para ver os detalhes</span>
      </div>

      <div id="vendas-cal-totais" class="vcal-totais"></div>

      <div class="vcal-head">
        <div class="vcal-mes" id="vcal-mes-label">—</div>
        <div class="vcal-nav">
          <button id="vcal-prev">◀ Anterior</button>
          <button id="vcal-next">Próximo ▶</button>
        </div>
      </div>

      <div id="vendas-cal-grid" class="vcal-grid"></div>

      <div class="vcal-legenda">
        <span class="lg"><span class="sw tem"></span> Com vendas importadas</span>
        <span class="lg"><span class="sw vazio"></span> Sem importação</span>
        <span class="lg">👥 = tem também o detalhado</span>
      </div>
    </div>
  `;

  setupColarTexto();
  setupColarTextoVxP();

  document.getElementById('vcal-prev').onclick = () => navegarMes(-1);
  document.getElementById('vcal-next').onclick = () => navegarMes(1);

  await carregarCalendario();
}

// ===== COLAR TEXTO (relatório geral) =====
function setupColarTexto() {
  const textarea = document.getElementById('upload-texto');
  const hint = document.getElementById('upload-texto-hint');
  const btn = document.getElementById('btn-processar-texto');

  textarea.addEventListener('input', () => {
    const linhas = textarea.value.split('\n').filter(l => l.trim()).length;
    hint.textContent = `${linhas} ${linhas === 1 ? 'linha' : 'linhas'}`;
    btn.disabled = linhas < 5;
  });

  btn.disabled = true;
  btn.onclick = () => {
    const texto = textarea.value;
    if (!texto.trim()) {
      mostrarToast('Cole o conteúdo do relatório primeiro.', 'err');
      return;
    }
    const hoje = new Date();
    const nomeVirtual = `texto-colado-${hoje.toISOString().slice(0, 10)}.txt`;
    processarTexto(texto, nomeVirtual);
  };
}

// ===== PROCESSAR TEXTO (core) =====
function processarTexto(texto, nomeVirtual = 'texto-colado.txt') {
  const preview = document.getElementById('preview-area');
  preview.style.display = 'block';
  preview.innerHTML = `<div style="text-align:center;padding:30px"><span class="spinner"></span> Processando...</div>`;

  try {
    const parsed = parsePdvTxt(texto);
    const resumo = resumirParse(parsed);

    if (!parsed.data) {
      preview.innerHTML = `
        <div class="preview-err">
          ⚠️ Não foi possível detectar a data do relatório. Verifique se o texto está completo e no formato correto.
        </div>`;
      return;
    }

    arquivoPendente = { nome: nomeVirtual, parsed, resumo };

    const jaExiste = datasImportadas.includes(parsed.data);
    const aviso = jaExiste ? `
      <div class="preview-aviso">
        ⚠️ <strong>Esse dia já foi importado.</strong> Se continuar, os dados anteriores serão sobrescritos.
      </div>` : '';

    preview.innerHTML = `
      <div class="preview-header">
        <span class="preview-icon">✅</span>
        <div>
          <div class="preview-titulo">Texto processado: ${nomeVirtual}</div>
          <div class="preview-sub">Data detectada: <strong>${fmtData(parsed.data)}</strong></div>
        </div>
      </div>

      ${aviso}

      <div class="preview-stats">
        <div class="preview-stat">
          <div class="preview-stat-label">Faturamento</div>
          <div class="preview-stat-value">${fmtMoeda(resumo.totalFaturamento)}</div>
        </div>
        <div class="preview-stat">
          <div class="preview-stat-label">Itens vendidos</div>
          <div class="preview-stat-value">${fmtInt(resumo.totalItens)}</div>
        </div>
        <div class="preview-stat">
          <div class="preview-stat-label">Vendedores</div>
          <div class="preview-stat-value">${resumo.qtdVendedores}</div>
        </div>
        <div class="preview-stat">
          <div class="preview-stat-label">Produtos</div>
          <div class="preview-stat-value">${resumo.qtdProdutos}</div>
        </div>
        <div class="preview-stat">
          <div class="preview-stat-label">Grupos</div>
          <div class="preview-stat-value">${resumo.qtdGrupos}</div>
        </div>
        <div class="preview-stat">
          <div class="preview-stat-label">Faixas de hora</div>
          <div class="preview-stat-value">${resumo.qtdHoras}</div>
        </div>
      </div>

      <div class="preview-acoes">
        <button class="btn btn-ghost" id="btn-cancelar-upload">Cancelar</button>
        <button class="btn btn-primary" id="btn-confirmar-upload">
          ${jaExiste ? '🔄 Sobrescrever' : '💾 Salvar no Firebase'}
        </button>
      </div>
    `;

    document.getElementById('btn-cancelar-upload').onclick = cancelarUpload;
    document.getElementById('btn-confirmar-upload').onclick = confirmarUpload;

  } catch (e) {
    console.error(e);
    preview.innerHTML = `
      <div class="preview-err">
        ⚠️ Erro ao processar: ${e.message}
      </div>`;
  }
}

function cancelarUpload() {
  arquivoPendente = null;
  const preview = document.getElementById('preview-area');
  if (preview) preview.style.display = 'none';
  const textarea = document.getElementById('upload-texto');
  if (textarea) {
    textarea.value = '';
    const hint = document.getElementById('upload-texto-hint');
    if (hint) hint.textContent = '0 linhas';
    const btn = document.getElementById('btn-processar-texto');
    if (btn) btn.disabled = true;
  }
}

async function confirmarUpload() {
  if (!arquivoPendente) return;
  const btn = document.getElementById('btn-confirmar-upload');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Salvando...';

  try {
    const { data, totais, turnos, caixas, vendedores, operadores, grupos, subgrupos, produtos, horas } = arquivoPendente.parsed;
    await salvarVendas(data, {
      totais,
      turnos,
      caixas,
      vendedores,
      operadores: operadores || null,
      grupos,
      subgrupos,
      produtos,
      horas
    });
    mostrarToast(`Vendas de ${fmtData(data)} salvas!`, 'ok');
    cancelarUpload();
    await carregarCalendario();
    // Dispara recarga do dashboard na próxima vez que abrir
    window._dashboardPrecisaRecarregar = true;
  } catch (e) {
    console.error(e);
    mostrarToast('Erro ao salvar: ' + e.message, 'err');
    btn.disabled = false;
    btn.innerHTML = '💾 Salvar no Firebase';
  }
}

// ===== COLAR TEXTO (Vendedor × Produto, detalhado, opcional) =====
function setupColarTextoVxP() {
  const ta = document.getElementById('upload-texto-vxp');
  const hint = document.getElementById('upload-texto-vxp-hint');
  const btn = document.getElementById('btn-processar-vxp');
  if (!ta || !btn) return;

  ta.addEventListener('input', () => {
    const linhas = ta.value.split('\n').filter(l => l.trim()).length;
    if (hint) hint.textContent = `${linhas} linhas`;
  });
  btn.onclick = () => {
    const texto = ta.value.trim();
    if (!texto) { mostrarToast('Cole o conteúdo do relatório primeiro.', 'err'); return; }
    processarTextoVxP(texto);
  };
}

function processarTextoVxP(texto, nomeVirtual = 'texto-colado.txt') {
  try {
    const vendedores = parseVendedorXProduto(texto);
    if (!vendedores.length) {
      mostrarToast('Nenhum vendedor encontrado. Verifique o formato do arquivo.', 'err');
      return;
    }

    const validacao = validarParse(vendedores);
    arquivoVxPPendente = { nome: nomeVirtual, texto, vendedores, validacao };

    renderPreviewVxP();
  } catch (e) {
    console.error(e);
    mostrarToast('Erro ao processar: ' + e.message, 'err');
  }
}

function renderPreviewVxP() {
  const { vendedores, validacao, nome } = arquivoVxPPendente;
  const div = document.getElementById('preview-vxp');
  if (!div) return;

  const topVend = [...vendedores].sort((a,b) => b.total - a.total).slice(0, 5);
  const totalQtd = vendedores.reduce((s,v) => s + v.totalQtd, 0);

  // Seletor de dia: lista os dias já importados
  const opcoesDia = datasImportadas.map(d =>
    `<option value="${d}">${fmtData(d)}</option>`
  ).join('');

  div.innerHTML = `
    <div class="preview-vxp-wrap">
      <div class="preview-vxp-head">
        <h4>📄 ${nome}</h4>
        <span class="preview-vxp-status ${validacao.consistente ? 'ok' : 'warn'}">
          ${validacao.consistente ? '✓ Soma consistente' : '⚠️ Soma com divergência'}
        </span>
      </div>

      <div class="preview-vxp-stats">
        <div>
          <div class="expl-resumo-label">Vendedores</div>
          <div class="preview-vxp-val">${validacao.vendedores}</div>
        </div>
        <div>
          <div class="expl-resumo-label">Total</div>
          <div class="preview-vxp-val vinho">${fmtMoeda(validacao.totalVendedores)}</div>
        </div>
        <div>
          <div class="expl-resumo-label">Itens vendidos</div>
          <div class="preview-vxp-val">${fmtInt(totalQtd)}</div>
        </div>
      </div>

      <div class="preview-vxp-top">
        <strong>Top 5 vendedores no arquivo:</strong>
        <ul>
          ${topVend.map(v => `
            <li>
              <span>${v.nome}</span>
              <span>${fmtInt(v.totalQtd)} itens · ${fmtMoeda(v.total)} · ${v.produtos.length} produtos</span>
            </li>
          `).join('')}
        </ul>
      </div>

      <div class="preview-vxp-dia">
        <label>A qual dia esse detalhamento se refere?</label>
        <select id="sel-dia-vxp">
          <option value="">-- Escolha o dia --</option>
          ${opcoesDia}
        </select>
        <small class="form-hint">Só é possível anexar a dias que já têm o relatório geral importado.</small>
      </div>

      <div class="preview-vxp-acoes">
        <button class="btn btn-ghost" id="btn-cancelar-vxp">Cancelar</button>
        <button class="btn btn-primary" id="btn-confirmar-vxp">Salvar detalhamento</button>
      </div>
    </div>
  `;
  div.style.display = 'block';

  document.getElementById('btn-cancelar-vxp').onclick = cancelarUploadVxP;
  document.getElementById('btn-confirmar-vxp').onclick = confirmarUploadVxP;

  // Scroll até preview
  div.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function cancelarUploadVxP() {
  arquivoVxPPendente = null;
  document.getElementById('preview-vxp').style.display = 'none';
  const ta = document.getElementById('upload-texto-vxp');
  if (ta) {
    ta.value = '';
    const hint = document.getElementById('upload-texto-vxp-hint');
    if (hint) hint.textContent = '0 linhas';
  }
}

async function confirmarUploadVxP() {
  const dia = document.getElementById('sel-dia-vxp').value;
  if (!dia) {
    mostrarToast('Selecione a qual dia o detalhamento se refere.', 'err');
    return;
  }

  const btn = document.getElementById('btn-confirmar-vxp');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Salvando...';

  try {
    // Valida consistência contra o geral
    const geral = await buscarVendasDia(dia);
    if (geral && geral.totais?.total) {
      const diff = Math.abs(geral.totais.total - arquivoVxPPendente.validacao.totalVendedores);
      const pctDiff = (diff / geral.totais.total) * 100;

      if (pctDiff > 20) {
        const ok = confirm(
          `⚠️ Aviso de divergência:\n\n` +
          `Relatório geral: ${fmtMoeda(geral.totais.total)}\n` +
          `Detalhado: ${fmtMoeda(arquivoVxPPendente.validacao.totalVendedores)}\n` +
          `Diferença: ${pctDiff.toFixed(1)}%\n\n` +
          `Essa diferença costuma significar que falta OPERADORES no detalhado ` +
          `(vendas sem vendedor atribuído). Deseja prosseguir mesmo assim?`
        );
        if (!ok) {
          btn.disabled = false;
          btn.innerHTML = 'Salvar detalhamento';
          return;
        }
      }
    }

    await salvarDetalhadoVxP(dia, arquivoVxPPendente.vendedores);

    mostrarToast(`✓ Detalhamento do dia ${fmtData(dia)} salvo!`, 'ok');
    cancelarUploadVxP();
    await carregarCalendario();
    window._dashboardPrecisaRecarregar = true;
  } catch (e) {
    console.error(e);
    mostrarToast('Erro ao salvar: ' + e.message, 'err');
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Salvar detalhamento';
  }
}

// ===== CALENDÁRIO DE COBERTURA =====
async function carregarCalendario() {
  const grid = document.getElementById('vendas-cal-grid');
  if (grid) grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:30px"><span class="spinner"></span></div>`;
  try {
    const vendas = await listarVendas({ limite: 400 });
    vendasCache = vendas;
    datasImportadas = vendas.map(v => v.id);

    if (!calMes) {
      const hoje = new Date();
      calMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    }
    renderCalendario();
  } catch (e) {
    console.error(e);
    if (grid) grid.innerHTML = `<div class="preview-err" style="grid-column:1/-1">Erro ao carregar: ${e.message}</div>`;
  }
}

function navegarMes(delta) {
  if (!calMes) return;
  calMes = new Date(calMes.getFullYear(), calMes.getMonth() + delta, 1);
  renderCalendario();
}

function renderCalendario() {
  const ano = calMes.getFullYear();
  const mes = calMes.getMonth(); // 0-based
  const prefixo = `${ano}-${String(mes + 1).padStart(2, '0')}`;

  // --- Totais ---
  const doMes = vendasCache.filter(v => v.id.startsWith(prefixo));
  const receitaMes = doMes.reduce((s, v) => s + (v.totais?.total || 0), 0);
  const totaisEl = document.getElementById('vendas-cal-totais');
  if (totaisEl) {
    totaisEl.innerHTML = `
      <div class="vcal-card">
        <div class="vcal-card-label">Dias importados (mês)</div>
        <div class="vcal-card-val">${doMes.length}</div>
      </div>
      <div class="vcal-card">
        <div class="vcal-card-label">Receita do mês</div>
        <div class="vcal-card-val">${fmtMoeda(receitaMes)}</div>
      </div>
      <div class="vcal-card ouro">
        <div class="vcal-card-label">Total geral importado</div>
        <div class="vcal-card-val">${vendasCache.length} ${vendasCache.length === 1 ? 'dia' : 'dias'}</div>
      </div>
    `;
  }

  // --- Cabeçalho do mês ---
  const lbl = document.getElementById('vcal-mes-label');
  if (lbl) lbl.textContent = `${NOMES_MES[mes]} ${ano}`;

  // --- Grade ---
  const mapa = {};
  vendasCache.forEach(v => { mapa[v.id] = v; });

  const primeiroDow = new Date(ano, mes, 1).getDay(); // 0=DOM
  const diasNoMes = new Date(ano, mes + 1, 0).getDate();

  const dows = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];
  let html = dows.map(d => `<div class="vcal-dow">${d}</div>`).join('');

  for (let i = 0; i < primeiroDow; i++) {
    html += `<div class="vcal-cell off"></div>`;
  }

  for (let d = 1; d <= diasNoMes; d++) {
    const id = `${prefixo}-${String(d).padStart(2, '0')}`;
    const v = mapa[id];
    if (v) {
      const temDet = (v.vendedoresDetalhado || []).length > 0;
      const titulo = `${fmtData(id)} · ${fmtMoeda(v.totais?.total)}${temDet ? ' · com detalhado' : ' · só geral'}`;
      html += `
        <div class="vcal-cell tem" onclick="verDetalheVendas('${id}')" title="${titulo}">
          <span class="vcal-check">✓</span>
          ${temDet ? '<span class="vcal-det" title="tem detalhado">👥</span>' : ''}
          <span class="vcal-dnum">${d}</span>
          <span class="vcal-dval">${fmtK(v.totais?.total)}</span>
        </div>`;
    } else {
      html += `<div class="vcal-cell vazio"><span class="vcal-dnum">${d}</span></div>`;
    }
  }

  const grid = document.getElementById('vendas-cal-grid');
  if (grid) grid.innerHTML = html;
}

// ===== AÇÕES GLOBAIS (chamadas do HTML) =====
window.verDetalheVendas = async function(dia) {
  const modal = document.getElementById('modal-contagem'); // reutilizando o modal
  const body  = document.getElementById('modal-body');
  body.innerHTML = `<div style="padding:40px;text-align:center"><span class="spinner"></span></div>`;
  modal.classList.add('open');

  try {
    const v = await buscarVendasDia(dia);
    if (!v) { body.innerHTML = '<div style="padding:20px">Dados não encontrados.</div>'; return; }

    const vendedoresHtml = (v.vendedores || [])
      .sort((a,b) => b.total - a.total)
      .map(vd => `
        <div class="det-linha">
          <span class="det-nome">${vd.nome}</span>
          <span class="det-valor">${fmtMoeda(vd.total)} <span class="det-qtd">(${fmtInt(vd.qtd)} itens)</span></span>
        </div>`).join('');

    const gruposHtml = (v.grupos || [])
      .sort((a,b) => b.total - a.total)
      .map(g => `
        <div class="det-linha">
          <span class="det-nome">${g.nome}</span>
          <span class="det-valor">${fmtMoeda(g.total)}</span>
        </div>`).join('');

    body.innerHTML = `
      <div class="modal-head">
        <h3>Vendas de ${fmtData(dia)}</h3>
        <p>${diaSemana(dia)} · Faturamento total: ${fmtMoeda(v.totais?.total)}</p>
      </div>
      <div class="items-detalhe">
        <h4 style="margin-bottom:8px;font-family:'Raleway',sans-serif">💰 Totais</h4>
        <div class="det-linha"><span>Subtotal</span><span class="det-valor">${fmtMoeda(v.totais?.subtotal)}</span></div>
        <div class="det-linha"><span>Acréscimos</span><span class="det-valor">${fmtMoeda(v.totais?.acrescimo)}</span></div>
        <div class="det-linha"><span>Descontos</span><span class="det-valor" style="color:var(--vermelho)">${fmtMoeda(v.totais?.desconto)}</span></div>
        <div class="det-linha" style="font-weight:800;border-top:2px solid var(--cinza-borda);margin-top:4px;padding-top:8px">
          <span>Total</span>
          <span class="det-valor" style="color:var(--vinho)">${fmtMoeda(v.totais?.total)}</span>
        </div>

        <h4 style="margin-top:20px;margin-bottom:8px;font-family:'Raleway',sans-serif">👥 Vendedores</h4>
        ${vendedoresHtml || '<p class="text-muted">Sem vendedores.</p>'}

        ${v.operadores ? `
          <h4 style="margin-top:20px;margin-bottom:8px;font-family:'Raleway',sans-serif">🖥️ OPERADORES</h4>
          <div class="det-linha">
            <span class="det-nome">OPERADORES</span>
            <span class="det-valor">${fmtMoeda(v.operadores.total)} <span class="det-qtd">(${fmtInt(v.operadores.qtd)} itens)</span></span>
          </div>
        ` : ''}

        <h4 style="margin-top:20px;margin-bottom:8px;font-family:'Raleway',sans-serif">📊 Grupos</h4>
        ${gruposHtml || '<p class="text-muted">Sem grupos.</p>'}
      </div>
    `;
  } catch (e) {
    body.innerHTML = `<div style="padding:20px;color:var(--vermelho)">Erro: ${e.message}</div>`;
  }
};

// ===== UTILS =====
function diaSemana(yyyymmdd) {
  const [y,m,d] = yyyymmdd.split('-').map(Number);
  const data = new Date(y, m-1, d);
  const dias = ['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado'];
  return dias[data.getDay()];
}

function mostrarToast(msg, tipo = '') {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'toast show ' + tipo;
  setTimeout(() => t.className = 'toast', 2800);
}
