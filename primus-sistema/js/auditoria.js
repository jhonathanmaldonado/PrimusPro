// ===== AUDITORIA — PRIMUS =====
// Cruza fontes pra detectar divergências de estoque em 2 modos:
//
// MODO 'operacional':
//   INI + Recebimentos - Vendas = Esperado  vs  FIN = Real
//   Detecta divergências DURANTE a operação (consumo fora do PDV, erros, etc)
//
// MODO 'virada':
//   FIN do dia X vs INI do dia Y (próximo dia operacional)
//   Detecta divergências ENTRE operações (furto, erro de contagem, etc)

import {
  listarContagens, listarVendas, listarRecebimentos,
  salvarAuditoriaFechada, buscarAuditoriaFechada,
  listarAuditoriasFechadas, excluirAuditoriaFechada,
  corrigirItemContagem,
  registrarRecebimento, excluirRecebimento,
  salvarConsumoInterno, listarConsumoInternoDia
} from './db.js';
import { slugify } from './produtos.js';
import { obterBebidas, obterSorvetes } from './produtos-store.js';
import { getSessao } from './auth.js';

// ===== ESTADO =====
let abaAtiva = 'calendario';    // 'calendario' | 'historico' (detalhe é sub-estado)
let modoAtual = 'operacional';   // 'operacional' | 'virada'
let dataInicio = '';
let dataFim    = '';
let resultadoAuditoria = [];     // resultado das BEBIDAS
let resultadoSorvetes  = [];     // resultado dos SORVETES + EMBALAGENS (modo operacional)
let resultadoSorvetesVirada = []; // resultado dos SORVETES + EMBALAGENS (modo virada)
let contextoAuditoria = {};      // { contagemIni, contagemFin, vendas, recebimentos, contagemFinAnterior, contagemSorv, contagemSorvAnterior }
let logoDataURL = null;          // logo da Primus em base64 (carregada uma vez)
let auditoriaFechadaAtual = null; // preenchido quando a auditoria do período já está fechada

const fmtMoeda = v => 'R$ ' + (v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtInt   = v => Math.round(v || 0).toLocaleString('pt-BR');
const fmtSgn   = v => { const n = Math.round(v || 0); return n > 0 ? `+${n}` : `${n}`; };
const fmtData  = d => { if (!d) return '—'; const [y,m,dd] = d.split('-'); return `${dd}/${m}/${y}`; };

// ===== INICIALIZAÇÃO =====
export async function inicializarAuditoria() {
  const container = document.getElementById('auditoria-container');
  if (!container) return;

  // Data padrão: ontem
  const ontem = new Date();
  ontem.setDate(ontem.getDate() - 1);
  const ontemIso = toIso(ontem);

  container.innerHTML = `
    <!-- Sub-abas: Atual vs Histórico -->
    <div class="subabas-wrapper">
      <button class="subaba ativo" data-subaba="calendario">
        <span class="subaba-ico">📅</span>
        <span class="subaba-txt">Calendário</span>
      </button>
      <button class="subaba" data-subaba="historico">
        <span class="subaba-ico">📈</span>
        <span class="subaba-txt">Histórico</span>
      </button>
    </div>

    <!-- Tela de DETALHE (aparece ao clicar num dia do calendário) -->
    <div class="subaba-conteudo" id="aud-aba-atual" style="display:none">
    <div class="card">
      <div class="aud-det-topo">
        <button class="btn btn-ghost btn-sm" id="aud-voltar-cal">‹ Voltar ao calendário</button>
        <span class="aud-det-data" id="aud-det-data"></span>
      </div>

      <div id="aud-consumo-wrap" style="display:none;margin:6px 0 8px">
        <button class="btn btn-ghost btn-sm" id="aud-btn-consumo">🥤 Lançar consumo interno</button>
        <small class="aud-periodo-hint" style="display:block;margin-top:4px">
          Retiradas do estoque fora do PDV (ex: pegou do freezer após a contagem). Corrige a virada para o dia seguinte.
        </small>
      </div>

      <!-- Seleção antiga preservada oculta: o calendário controla a data (sempre modo operacional) -->
      <div id="aud-selecao-oculta" style="display:none">
        <span id="aud-sub"></span>
        <div class="aud-modo-toggle">
          <button class="aud-modo-btn ativo" id="aud-modo-op" data-modo="operacional">
            <span class="aud-modo-ico">📊</span>
            <span class="aud-modo-txt"><strong>Dia operacional</strong><small>INI + recebimentos − vendas vs FIN do mesmo dia</small></span>
          </button>
          <button class="aud-modo-btn" id="aud-modo-vir" data-modo="virada">
            <span class="aud-modo-ico">🌙</span>
            <span class="aud-modo-txt"><strong>Virada de dia</strong><small>INI do dia vs FIN do dia operacional anterior</small></span>
          </button>
        </div>
        <div class="aud-periodo" id="aud-periodo">
          <div class="aud-periodo-campo">
            <label id="aud-label-principal">📅 Contagem do dia</label>
            <input type="date" id="aud-data-principal" value="${ontemIso}">
            <small class="aud-periodo-hint" id="aud-hint"></small>
          </div>
          <button class="btn btn-primary" id="aud-executar">🔍 Executar</button>
        </div>
        <div class="aud-info" id="aud-info"></div>
      </div>
      <!-- Banner de auditoria já fechada -->
      <div id="aud-fechada-banner" style="display:none"></div>

      <div id="aud-loading" style="display:none;text-align:center;padding:40px">
        <span class="spinner"></span>
        <div style="margin-top:10px;color:var(--cinza-texto);font-size:13px">Executando auditoria...</div>
      </div>

      <div id="aud-erro" style="display:none"></div>
      <div id="aud-resumo" style="display:none"></div>
      <div id="aud-tabela" style="display:none"></div>
      <!-- Seção de sorvetes & embalagens (renderizada empilhada abaixo da de bebidas) -->
      <div id="aud-sorvetes-secao" style="display:none"></div>
      <div id="aud-acoes" style="display:none" class="aud-acoes">
        <button class="btn btn-ghost" id="aud-btn-pdf">📄 Exportar PDF</button>
        <button class="btn btn-primary" id="aud-btn-fechar">🔒 Fechar auditoria</button>
      </div>
    </div>
    </div>

    <!-- Aba: Histórico -->
    <div class="subaba-conteudo" id="aud-aba-historico" style="display:none">
      <div class="card">
        <div class="grafico-head">
          <h3>📈 Histórico e tendências</h3>
          <span class="grafico-sub" id="hist-sub">Carregando...</span>
        </div>
        <div id="hist-container">
          <div style="text-align:center;padding:40px">
            <span class="spinner"></span>
            <div style="margin-top:10px;color:var(--cinza-texto);font-size:13px">Carregando histórico...</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Aba: Calendário (tela principal da auditoria) -->
    <div class="subaba-conteudo" id="aud-aba-calendario" style="display:none">
      <div class="card">
        <div class="aud-cal-nav">
          <span class="aud-cal-titulo" id="aud-cal-titulo">—</span>
          <div class="aud-cal-nav-btns">
            <button id="aud-cal-prev" type="button">◀ Anterior</button>
            <button id="aud-cal-next" type="button">Próximo ▶</button>
          </div>
        </div>
        <div id="aud-cal-lista"></div>
        <div class="aud-cal-legenda">🔴 crítico (≥5) · 🟠 atenção (≥2) · 🟡 leve (≥1) · 🟢 ok · clique num dia para ver o detalhe</div>
      </div>
    </div>

    <!-- Modal de exportação de PDF -->
    <div class="modal-backdrop" id="aud-modal-pdf">
      <div class="modal-box" style="max-width:500px">
        <button class="modal-close" id="aud-modal-pdf-close">✕</button>
        <div class="modal-head">
          <h3>📄 Exportar Auditoria em PDF</h3>
          <p>Escolha o conteúdo do relatório</p>
        </div>
        <div style="padding:20px 24px 24px">
          <label class="aud-pdf-opt">
            <input type="radio" name="aud-pdf-conteudo" value="todos" checked>
            <div>
              <strong>Todos os produtos</strong>
              <small>Lista completa, inclusive OK. Ideal pra arquivar auditoria do dia.</small>
            </div>
          </label>
          <label class="aud-pdf-opt">
            <input type="radio" name="aud-pdf-conteudo" value="divergencias">
            <div>
              <strong>Só divergências</strong>
              <small>Só críticos, atenção e leves. Ideal pra resolver problemas.</small>
            </div>
          </label>
          <div class="aud-pdf-botoes">
            <button class="btn btn-ghost" id="aud-pdf-cancelar">Cancelar</button>
            <button class="btn btn-primary" id="aud-pdf-confirmar">📄 Gerar PDF</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Modal de fechamento de auditoria -->
    <div class="modal-backdrop" id="aud-modal-fechar">
      <div class="modal-box" style="max-width:560px">
        <button class="modal-close" id="aud-modal-fechar-close">✕</button>
        <div class="modal-head">
          <h3>🔒 Fechar auditoria</h3>
          <p>Registra essa auditoria no histórico com sua revisão</p>
        </div>
        <div style="padding:20px 24px 24px">
          <div id="aud-fechar-resumo" class="aud-fechar-resumo"></div>
          <div class="aud-fechar-campo">
            <label>📝 Observações (opcional)</label>
            <textarea id="aud-fechar-obs" rows="3" placeholder="Ex: Sprite KS +11 = vendedores reabastecem diretamente. Sem ação necessária."></textarea>
          </div>
          <div class="aud-fechar-campo">
            <label>👤 Responsável</label>
            <input type="text" id="aud-fechar-resp" placeholder="Nome de quem revisou">
          </div>
          <div class="aud-pdf-botoes">
            <button class="btn btn-ghost" id="aud-fechar-cancelar">Cancelar</button>
            <button class="btn btn-primary" id="aud-fechar-confirmar">🔒 Fechar e salvar no histórico</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Modal de edição de contagens (INI / REC / FIN) -->
    <div class="modal-backdrop" id="aud-modal-editar">
      <div class="modal-box" style="max-width:520px">
        <button class="modal-close" id="aud-modal-editar-close">✕</button>
        <div class="modal-head">
          <h3>✏️ Editar valores</h3>
          <p id="aud-editar-produto-nome"></p>
        </div>
        <div style="padding:20px 24px 24px">
          <div class="aud-edit-aviso">
            <strong>⚠️ Atenção:</strong> a edição altera as contagens originais salvas. Use só pra corrigir erros de registro (ex: recebimento duplicado, valor digitado errado). Para divergências reais (sumiço, quebra), <strong>não edite</strong> — registre a observação no fechamento.
          </div>

          <div class="aud-edit-campos">
            <div class="aud-edit-linha">
              <label>INI <small>(contagem inicial)</small></label>
              <input type="number" id="aud-edit-ini" min="0" step="1">
              <span class="aud-edit-original" id="aud-edit-ini-orig"></span>
            </div>
            <div class="aud-edit-linha">
              <label>REC <small>(recebimentos)</small></label>
              <input type="number" id="aud-edit-rec" min="0" step="1">
              <span class="aud-edit-original" id="aud-edit-rec-orig"></span>
            </div>
            <div class="aud-edit-linha">
              <label>FIN <small>(contagem final)</small></label>
              <input type="number" id="aud-edit-fin" min="0" step="1">
              <span class="aud-edit-original" id="aud-edit-fin-orig"></span>
            </div>
          </div>

          <div class="aud-edit-preview" id="aud-edit-preview">
            <!-- preenchido pelo JS dinamicamente -->
          </div>

          <div class="aud-fechar-campo">
            <label>📝 Motivo da edição <small>(obrigatório)</small></label>
            <textarea id="aud-edit-motivo" rows="2" placeholder="Ex: Recebido duplicado — entrega chegou no dia anterior depois do barman ir embora."></textarea>
          </div>

          <div class="aud-pdf-botoes">
            <button class="btn btn-ghost" id="aud-edit-cancelar">Cancelar</button>
            <button class="btn btn-primary" id="aud-edit-confirmar">💾 Salvar edição</button>
          </div>
        </div>
      </div>
    </div>
  `;

  // Listeners do toggle
  document.getElementById('aud-modo-op').onclick  = () => trocarModo('operacional');
  document.getElementById('aud-modo-vir').onclick = () => trocarModo('virada');

  // Quando a data muda no modo VIRADA, atualiza o aviso de quantos dias estão entre
  // o dia anterior operacional e o dia escolhido (parada semanal vs noite normal).
  document.getElementById('aud-data-principal').onchange = () => {
    if (modoAtual === 'virada') {
      aplicarModo();
    }
  };

  document.getElementById('aud-executar').onclick = executarAuditoria;

  // Consumo interno: só gestor vê o botão
  const sessaoAtual = getSessao();
  if (sessaoAtual?.perfil === 'gestor') {
    const wrap = document.getElementById('aud-consumo-wrap');
    if (wrap) wrap.style.display = 'block';
    const btnCons = document.getElementById('aud-btn-consumo');
    if (btnCons) btnCons.onclick = abrirModalConsumoInterno;
  }

  // Listeners das sub-abas
  document.querySelectorAll('.subaba').forEach(btn => {
    btn.onclick = () => trocarSubaba(btn.dataset.subaba);
  });

  // Calendário de auditoria: navegação de mês + estilo
  const calPrev = document.getElementById('aud-cal-prev');
  const calNext = document.getElementById('aud-cal-next');
  if (calPrev) calPrev.onclick = () => calNavegarMes(-1);
  if (calNext) calNext.onclick = () => calNavegarMes(1);
  const btnVoltar = document.getElementById('aud-voltar-cal');
  if (btnVoltar) btnVoltar.onclick = voltarAoCalendario;
  injetarEstiloCalendario();

  // Estado inicial: calendário é a tela principal da auditoria
  document.getElementById('aud-aba-atual').style.display = 'none';
  document.getElementById('aud-aba-historico').style.display = 'none';
  document.getElementById('aud-aba-calendario').style.display = 'block';
  renderCalendarioAuditoria();

  // Listeners do modal de PDF
  document.getElementById('aud-btn-pdf').onclick = abrirModalPDF;
  document.getElementById('aud-modal-pdf-close').onclick = fecharModalPDF;
  document.getElementById('aud-pdf-cancelar').onclick = fecharModalPDF;
  document.getElementById('aud-pdf-confirmar').onclick = gerarPDF;
  document.getElementById('aud-modal-pdf').onclick = e => {
    if (e.target.id === 'aud-modal-pdf') fecharModalPDF();
  };

  // Listeners do modal de fechamento
  document.getElementById('aud-btn-fechar').onclick = abrirModalFechar;
  document.getElementById('aud-modal-fechar-close').onclick = fecharModalFechar;
  document.getElementById('aud-fechar-cancelar').onclick = fecharModalFechar;
  document.getElementById('aud-fechar-confirmar').onclick = confirmarFechamento;
  document.getElementById('aud-modal-fechar').onclick = e => {
    if (e.target.id === 'aud-modal-fechar') fecharModalFechar();
  };

  // Listeners do modal de edição (INI / REC / FIN)
  document.getElementById('aud-modal-editar-close').onclick = fecharModalEditar;
  document.getElementById('aud-edit-cancelar').onclick      = fecharModalEditar;
  document.getElementById('aud-edit-confirmar').onclick     = confirmarEdicao;
  document.getElementById('aud-modal-editar').onclick = e => {
    if (e.target.id === 'aud-modal-editar') fecharModalEditar();
  };
  // Recalcula preview ao mudar qualquer campo
  ['aud-edit-ini', 'aud-edit-rec', 'aud-edit-fin'].forEach(id => {
    document.getElementById(id).oninput = atualizarPreviewEdicao;
  });

  // Aplica modo inicial
  aplicarModo();

  // Carrega a logo em background (pra uso no PDF)
  carregarLogo();
}

// ===== SUB-ABAS =====
function trocarSubaba(nova) {
  if (nova === abaAtiva) return;
  abaAtiva = nova;

  document.querySelectorAll('.subaba').forEach(btn => {
    btn.classList.toggle('ativo', btn.dataset.subaba === nova);
  });
  document.getElementById('aud-aba-atual').style.display     = 'none';
  document.getElementById('aud-aba-historico').style.display = nova === 'historico' ? 'block' : 'none';
  const calEl = document.getElementById('aud-aba-calendario');
  if (calEl) calEl.style.display = nova === 'calendario' ? 'block' : 'none';
  document.querySelector('.subabas-wrapper').style.display = '';

  if (nova === 'historico') {
    carregarHistorico();
  } else if (nova === 'calendario') {
    renderCalendarioAuditoria();
  }
}

/**
 * Converte a logo.png para base64 uma vez, cacheado em logoDataURL.
 * jsPDF aceita DataURL direto em addImage.
 */
async function carregarLogo() {
  if (logoDataURL) return;
  try {
    const res = await fetch('img/logo.png');
    const blob = await res.blob();
    logoDataURL = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (e) {
    console.warn('Logo não pôde ser carregada:', e);
    logoDataURL = null;
  }
}

// ===== TOGGLE DE MODO =====
function trocarModo(novoModo) {
  if (novoModo === modoAtual) return;
  modoAtual = novoModo;
  aplicarModo();
  // Limpa resultado anterior ao trocar de modo (evita confusão)
  document.getElementById('aud-resumo').style.display = 'none';
  document.getElementById('aud-tabela').style.display = 'none';
  document.getElementById('aud-sorvetes-secao').style.display = 'none';
  document.getElementById('aud-erro').style.display = 'none';
  document.getElementById('aud-acoes').style.display = 'none';
  document.getElementById('aud-fechada-banner').style.display = 'none';
  auditoriaFechadaAtual = null;
}

function aplicarModo() {
  const btnOp  = document.getElementById('aud-modo-op');
  const btnVir = document.getElementById('aud-modo-vir');
  const labelPrincipal = document.getElementById('aud-label-principal');
  const hint = document.getElementById('aud-hint');
  const info = document.getElementById('aud-info');
  const sub = document.getElementById('aud-sub');

  btnOp.classList.toggle('ativo',  modoAtual === 'operacional');
  btnVir.classList.toggle('ativo', modoAtual === 'virada');

  if (modoAtual === 'operacional') {
    labelPrincipal.innerHTML = '📅 Contagem do dia';
    hint.textContent = 'Compara INI + recebimentos − vendas vs FIN do mesmo dia';
    info.innerHTML = `
      <strong>📊 Modo Dia operacional:</strong>
      Busca a contagem INI e a FIN do dia selecionado. Soma recebimentos e
      subtrai vendas do PDV. Compara com a FIN pra detectar divergências
      <strong>durante a operação</strong> (consumo fora do PDV, quebras, erros).
    `;
    sub.textContent = 'Modo: Dia operacional';
  } else {
    labelPrincipal.innerHTML = '📅 INI do dia';
    const dIni = document.getElementById('aud-data-principal')?.value;
    const diaAnteriorTxt = dIni ? fmtData(diaAnteriorOperacional(dIni)) : '—';
    hint.textContent = `Compara com a FIN do dia operacional anterior (${diaAnteriorTxt})`;
    info.innerHTML = `
      <strong>🌙 Modo Virada de dia:</strong>
      Compara a FIN do dia operacional anterior com a INI do dia selecionado. Detecta divergências
      <strong>entre operações</strong> (sumiço noturno, erro na virada de contagem).
      Em modo normal a diferença é zero — qualquer divergência merece atenção.
      ${avisoViradaLonga()}
    `;
    sub.textContent = 'Modo: Virada de dia';
  }
}

function avisoViradaLonga() {
  const dIni = document.getElementById('aud-data-principal')?.value;
  if (!dIni) return '';
  const dAnterior = diaAnteriorOperacional(dIni);
  const diasEntre = diffDias(dAnterior, dIni);
  if (diasEntre >= 2) {
    return `<br><span style="color:var(--amarelo-status);font-weight:600">
      ⚠️ ${diasEntre} dias entre fechamento e abertura (parada semanal) — atenção redobrada.
    </span>`;
  }
  return '';
}

/**
 * Retorna o dia operacional ANTERIOR a uma data.
 * Regra: Qua-Dom opera. Se a data for Quarta → o anterior é Domingo (pula Seg-Ter).
 * Caso contrário → dia anterior.
 * JS: getDay() = 0 (Dom), 1 (Seg), 2 (Ter), 3 (Qua), 4 (Qui), 5 (Sex), 6 (Sáb)
 */
function diaAnteriorOperacional(dataIso) {
  const [y, m, d] = dataIso.split('-').map(Number);
  const data = new Date(y, m - 1, d);
  data.setDate(data.getDate() - 1);
  // Se cair em Ter ou Seg, volta até Domingo
  while (data.getDay() === 1 || data.getDay() === 2) {
    data.setDate(data.getDate() - 1);
  }
  return toIso(data);
}

function diffDias(dataA, dataB) {
  const a = new Date(dataA + 'T00:00:00');
  const b = new Date(dataB + 'T00:00:00');
  return Math.round((b - a) / (1000 * 60 * 60 * 24));
}

// ===== EXECUÇÃO =====
async function executarAuditoria() {
  const dataPrincipal = document.getElementById('aud-data-principal').value;

  if (!dataPrincipal) {
    mostrarErro('Selecione a data.');
    return;
  }

  // Calcula dataInicio e dataFim de acordo com o modo
  if (modoAtual === 'operacional') {
    // Contagem do dia → INI e FIN do mesmo dia
    dataInicio = dataPrincipal;
    dataFim    = dataPrincipal;
  } else {
    // Virada: INI do dia escolhido vs FIN do dia operacional anterior
    dataFim    = dataPrincipal;
    dataInicio = diaAnteriorOperacional(dataPrincipal);
  }

  const loading = document.getElementById('aud-loading');
  const erro    = document.getElementById('aud-erro');
  const resumo  = document.getElementById('aud-resumo');
  const tabela  = document.getElementById('aud-tabela');
  const acoes   = document.getElementById('aud-acoes');
  const banner  = document.getElementById('aud-fechada-banner');

  loading.style.display = 'block';
  erro.style.display    = 'none';
  resumo.style.display  = 'none';
  tabela.style.display  = 'none';
  acoes.style.display   = 'none';
  banner.style.display  = 'none';
  auditoriaFechadaAtual = null;

  try {
    if (modoAtual === 'operacional') {
      await executarModoOperacional();
    } else {
      await executarModoVirada();
    }

    // Verifica se essa auditoria já foi fechada antes (tolerante a falha)
    try {
      auditoriaFechadaAtual = await buscarAuditoriaFechada(modoAtual, dataInicio, dataFim);
    } catch (errFechada) {
      console.warn('Não foi possível verificar auditoria fechada (pode ser regra Firestore ausente):', errFechada.message);
      auditoriaFechadaAtual = null;
    }
    renderizarBannerFechamento();

    loading.style.display = 'none';
    resumo.style.display  = 'block';
    tabela.style.display  = 'block';
    acoes.style.display   = 'flex';
  } catch (e) {
    console.error(e);
    mostrarErro('Erro: ' + e.message);
    loading.style.display = 'none';
  }
}

/**
 * Renderiza banner quando a auditoria atual já está fechada.
 * Muda o botão de "Fechar" pra "Atualizar fechamento".
 */
function renderizarBannerFechamento() {
  const banner = document.getElementById('aud-fechada-banner');
  const btn    = document.getElementById('aud-btn-fechar');

  if (auditoriaFechadaAtual) {
    const data = auditoriaFechadaAtual.fechadoEm?.toDate
      ? auditoriaFechadaAtual.fechadoEm.toDate().toLocaleDateString('pt-BR')
      : '—';
    banner.innerHTML = `
      <div class="aud-fechada-info">
        <span class="aud-fechada-ico">🔒</span>
        <div class="aud-fechada-txt">
          <strong>Auditoria fechada em ${data}</strong>
          <small>Por: ${auditoriaFechadaAtual.responsavel || auditoriaFechadaAtual.fechadoPor?.nome || '—'}</small>
          ${auditoriaFechadaAtual.observacoes ? `<div class="aud-fechada-obs">"${auditoriaFechadaAtual.observacoes}"</div>` : ''}
        </div>
      </div>
    `;
    banner.style.display = 'block';
    btn.innerHTML = '🔓 Atualizar fechamento';
  } else {
    banner.style.display = 'none';
    btn.innerHTML = '🔒 Fechar auditoria';
  }
}

// ===== MODO OPERACIONAL =====
async function executarModoOperacional() {
  // 1) Busca contagens no período
  const todasContagens = await listarContagens({ limite: 500 });

  // Pega a contagem INI na data de início (bebidas)
  const contagemIni = todasContagens.find(c =>
    c.tipo === 'ini' && c.data === dataInicio
  );
  // Pega a contagem FIN na data de fim (bebidas)
  const contagemFin = todasContagens.find(c =>
    c.tipo === 'fin' && c.data === dataFim
  );
  // Pega a contagem de SORVETES (única, mesmo dia — tipo='sorv')
  const contagemSorv = todasContagens.find(c =>
    c.tipo === 'sorv' && c.data === dataInicio
  );

  if (!contagemIni) {
    throw new Error(`Não encontrei contagem de INÍCIO (ini) na data ${fmtData(dataInicio)}. Peça pro barman fazer essa contagem primeiro.`);
  }
  if (!contagemFin) {
    throw new Error(`Não encontrei contagem de FINAL (fin) na data ${fmtData(dataFim)}. Peça pro barman fazer essa contagem primeiro.`);
  }
  // Sorvetes é opcional — se não tiver, a tabela de sorvetes não é renderizada,
  // mas a auditoria de bebidas continua funcionando normalmente.

  // 2) Busca a FIN do DIA OPERACIONAL ANTERIOR (pro cálculo do D-1)
  const contagemFinAnterior = todasContagens.find(c =>
    c.tipo === 'fin' && c.data < dataInicio
  );
  // Contagem de SORVETES do dia operacional anterior (pro D-1 dos sorvetes)
  const contagemSorvAnteriorOp = todasContagens
    .filter(c => c.tipo === 'sorv' && c.data < dataInicio)
    .sort((a, b) => b.data.localeCompare(a.data))[0] || null;

  // 3) Busca vendas no período
  const vendas = await listarVendas({
    dataInicio,
    dataFim,
    limite: 365
  });

  // 4) Busca recebimentos no período
  const recebimentos = await listarRecebimentos(dataInicio, dataFim);

  // 5) Calcula auditoria de bebidas (com D-1 e diagnóstico)
  // Consumo interno do dia anterior (abatido do FIN anterior no D-1)
  const consumoInternoAnt = contagemFinAnterior
    ? (await listarConsumoInternoDia(contagemFinAnterior.data)).itens
    : {};
  resultadoAuditoria = await calcularAuditoriaOperacional(contagemIni, contagemFin, vendas, recebimentos, contagemFinAnterior, consumoInternoAnt);

  // 5b) Calcula auditoria de sorvetes (se houver contagem)
  if (contagemSorv) {
    resultadoSorvetes = await calcularAuditoriaSorvetes(contagemSorv, vendas, contagemSorvAnteriorOp);
  } else {
    resultadoSorvetes = [];
  }

  // Salva contexto pro PDF usar depois
  contextoAuditoria = { contagemIni, contagemFin, vendas, recebimentos, contagemFinAnterior, contagemSorv };

  // 6) Renderiza
  renderizarResumoOperacional(contagemIni, contagemFin, vendas, recebimentos, contagemFinAnterior);
  renderizarTabelaOperacional();
  // Tabela de sorvetes (empilhada abaixo) — só se tiver contagem
  if (contagemSorv) {
    await renderizarSecaoSorvetesOperacional(vendas);
  } else {
    limparSecaoSorvetes();
  }
}

// ===== MODO VIRADA =====
async function executarModoVirada() {
  // 1) Busca a FIN do "dia 1" e a INI do "dia 2"
  const todasContagens = await listarContagens({ limite: 500 });

  const contagemFinAnterior = todasContagens.find(c =>
    c.tipo === 'fin' && c.data === dataInicio
  );
  const contagemIniAtual = todasContagens.find(c =>
    c.tipo === 'ini' && c.data === dataFim
  );

  // Sorvetes: pega as duas folhas (anterior e atual)
  const contagemSorvAnterior = todasContagens.find(c =>
    c.tipo === 'sorv' && c.data === dataInicio
  );
  const contagemSorvAtual = todasContagens.find(c =>
    c.tipo === 'sorv' && c.data === dataFim
  );

  if (!contagemFinAnterior) {
    throw new Error(`Não encontrei contagem de FINAL (fin) em ${fmtData(dataInicio)}.`);
  }
  if (!contagemIniAtual) {
    throw new Error(`Não encontrei contagem de INÍCIO (ini) em ${fmtData(dataFim)}.`);
  }

  // 2) Busca auditoria operacional FECHADA do dia anterior (pro cruzamento de erro de contagem)
  let auditoriaOperacionalDiaAnterior = null;
  try {
    auditoriaOperacionalDiaAnterior = await buscarAuditoriaFechada('operacional', dataInicio, dataInicio);
  } catch (e) {
    console.warn('Não foi possível buscar auditoria operacional do dia anterior:', e);
  }

  // 3) Calcula auditoria de virada com cruzamento (bebidas)
  // Consumo interno do dia anterior (abatido do FIN anterior)
  const consumoInternoViradaAnt = (await listarConsumoInternoDia(contagemFinAnterior.data)).itens;
  resultadoAuditoria = await calcularAuditoriaVirada(contagemFinAnterior, contagemIniAtual, auditoriaOperacionalDiaAnterior, consumoInternoViradaAnt);

  // 3b) Calcula virada de sorvetes (se houver as duas contagens)
  if (contagemSorvAnterior && contagemSorvAtual) {
    resultadoSorvetesVirada = await calcularAuditoriaSorvetesVirada(contagemSorvAnterior, contagemSorvAtual);
  } else {
    resultadoSorvetesVirada = [];
  }

  // Salva contexto pro PDF e correção usarem depois
  contextoAuditoria = {
    contagemFinAnterior, contagemIniAtual, auditoriaOperacionalDiaAnterior,
    contagemSorvAnterior, contagemSorvAtual
  };

  // 4) Renderiza (layout específico do modo virada)
  renderizarResumoVirada(contagemFinAnterior, contagemIniAtual);
  renderizarTabelaVirada();
  // Tabela de virada de sorvetes (empilhada abaixo)
  if (contagemSorvAnterior && contagemSorvAtual) {
    renderizarSecaoSorvetesVirada();
  } else {
    limparSecaoSorvetes();
  }
}

function mostrarErro(msg) {
  const erro = document.getElementById('aud-erro');
  erro.innerHTML = `<div class="preview-err">${msg}</div>`;
  erro.style.display = 'block';
  document.getElementById('aud-loading').style.display = 'none';
}

// ===== MOTOR DO CÁLCULO — MODO OPERACIONAL =====
async function calcularAuditoriaOperacional(contagemIni, contagemFin, vendas, recebimentos, contagemFinAnterior, consumoInternoAnt = {}) {
  // Carrega catálogo efetivo de bebidas (base + overrides do gestor)
  const bebidas = await obterBebidas();

  // Extrai estoques por slug das contagens
  const estoqueIni = extrairEstoque(contagemIni);
  const estoqueFin = extrairEstoque(contagemFin);
  // Se tiver FIN anterior, extrai também (pra calcular D-1)
  const estoqueFinAnt = contagemFinAnterior ? extrairEstoque(contagemFinAnterior) : null;

  // Recebimentos têm 2 fontes possíveis:
  //  (a) registrados via Lista de Compras (documentos tipo "recebimento" em primus_compras)
  //  (b) anotados direto na folha FIN (campo "Recebido" → dados[slug].rec)
  // Somamos as duas — se o gestor registrar em uma só fonte, funciona igual.
  const recebidoPorSlug = {};
  // Fonte (a): documentos de recebimento
  recebimentos.forEach(r => {
    (r.itens || []).forEach(i => {
      if (!recebidoPorSlug[i.slug]) recebidoPorSlug[i.slug] = 0;
      recebidoPorSlug[i.slug] += i.qtd || 0;
    });
  });
  // Fonte (b): campo "rec" dentro da própria contagem FIN
  Object.entries(contagemFin.itens || {}).forEach(([chave, v]) => {
    if (typeof v !== 'object' || v === null) return;
    // Só bebidas (chaves sem sufixo __fin/__ini) têm o campo rec
    if (chave.includes('__')) return;
    const qtdRec = v.rec || 0;
    if (qtdRec > 0) {
      if (!recebidoPorSlug[chave]) recebidoPorSlug[chave] = 0;
      recebidoPorSlug[chave] += qtdRec;
    }
  });

  // Soma vendas por slug (match fuzzy pelo nome → slug)
  const vendidoPorSlug = {};
  vendas.forEach(v => {
    (v.produtos || []).forEach(p => {
      const slugP = slugify(p.nome);
      if (!vendidoPorSlug[slugP]) vendidoPorSlug[slugP] = 0;
      vendidoPorSlug[slugP] += p.qtd || 0;
    });
  });

  // Monta linha por bebida (usa catálogo efetivo carregado acima)
  return bebidas.map(bebida => {
    const slug = slugify(bebida.nome);
    const ini  = estoqueIni[slug] || 0;
    const fin  = estoqueFin[slug] || 0;
    const recebido = recebidoPorSlug[slug] || 0;
    const vendido  = vendidoPorSlug[slug] || 0;

    const esperado = ini + recebido - vendido;
    const real     = fin;
    const diferenca = real - esperado;

    // D-1: diferença entre INI atual e FIN anterior (quanto sumiu/apareceu na virada)
    // Só calcula se tivermos FIN anterior. O consumo interno do dia anterior
    // (retiradas fora do PDV após a contagem final) é abatido do FIN anterior,
    // pra não aparecer como "sumiço" na virada.
    let d1 = null;
    if (estoqueFinAnt !== null) {
      const finAnt = (estoqueFinAnt[slug] || 0) - (consumoInternoAnt[slug] || 0);
      d1 = ini - finAnt;  // negativo = sumiu na virada; positivo = apareceu
    }

    // DIAGNÓSTICO (cruzamento DIF x D-1)
    // Lógica correta:
    // - ERRO DE CONTAGEM: sinais OPOSTOS e valores próximos
    //   (ex: D-1 = -5 + DIF = +4 → provavelmente alguém contou errado em algum lugar)
    // - RECORRENTE: sinais IGUAIS (ex: D-1 = -2 + DIF = -3 → problema real continuando)
    // - ISOLADO: D-1 = 0 e DIF ≠ 0 (virada perfeita, problema só no dia)
    let diagnostico = null;
    if (diferenca !== 0 && d1 !== null) {
      const d1_relevante   = Math.abs(d1) >= 1;
      const dif_relevante  = Math.abs(diferenca) >= 1;

      if (d1_relevante && dif_relevante && Math.sign(diferenca) !== Math.sign(d1)) {
        // Sinais opostos → possível erro de contagem.
        // Quanto mais próximos os módulos, mais provável o erro.
        // Tolerância: |DIF + D-1| ≤ 2 (se compensam quase exatamente)
        if (Math.abs(diferenca + d1) <= 2) {
          diagnostico = 'erro_contagem';
        }
      } else if (d1 !== 0 && dif_relevante && Math.sign(diferenca) === Math.sign(d1)) {
        // Sinais iguais → problema recorrente (acumulativo)
        diagnostico = 'recorrente';
      } else if (d1 === 0 && Math.abs(diferenca) >= 2) {
        // Virada perfeita mas operação gerou divergência
        diagnostico = 'isolado';
      }
    }

    // Status por diferença absoluta
    const abs = Math.abs(diferenca);
    let status = 'ok';
    if (ini === 0 && fin === 0 && recebido === 0 && vendido === 0) status = 'semdados';
    else if (abs >= 5) status = 'critico';
    else if (abs >= 2) status = 'atencao';
    else if (abs >= 1) status = 'leve';

    return {
      slug,
      nome: bebida.nome,
      grupo: bebida.grupo,
      unidCompra: bebida.unidCompra,
      porCaixa: bebida.porCaixa,
      ini,
      recebido,
      vendido,
      esperado,
      real,
      diferenca,
      d1,
      diagnostico,
      status
    };
  });
}

// Extrai estoque por slug, lidando com as 2 estruturas (ini e fin)
function extrairEstoque(contagem) {
  const estoque = {};
  Object.entries(contagem.itens || {}).forEach(([chave, v]) => {
    if (typeof v !== 'object' || v === null) return;
    if (chave.endsWith('__fin')) {
      const slug = chave.replace(/__fin$/, '');
      estoque[slug] = v.final || 0;
      return;
    }
    const total = (typeof v.total === 'number' && v.total > 0)
      ? v.total
      : (v.fr || v.freezer || 0) + (v.est || v.estoque || 0);
    estoque[chave] = total;
  });
  return estoque;
}

/**
 * Extrai os campos completos de sorvetes (qtd inicial, abast, final, vendeu calculado).
 * A folha de sorvetes (tipo='sorv') é única e tem estrutura:
 *   - "<slug>__ini" → { qtd, obs }
 *   - "<slug>__fin" → { abast, final, vendeu, obs }
 * Retorna: { <slug>: { ini, abast, fin, vendeuAnotado } }
 */
function extrairCamposSorvetes(contagemSorv) {
  const out = {};
  if (!contagemSorv?.itens) return out;
  Object.entries(contagemSorv.itens).forEach(([chave, v]) => {
    if (typeof v !== 'object' || v === null) return;
    if (chave.endsWith('__ini')) {
      const slug = chave.replace(/__ini$/, '');
      if (!out[slug]) out[slug] = {};
      out[slug].ini = v.qtd || 0;
    } else if (chave.endsWith('__fin')) {
      const slug = chave.replace(/__fin$/, '');
      if (!out[slug]) out[slug] = {};
      out[slug].abast = v.abast || 0;
      out[slug].fin   = v.final || 0;
      out[slug].vendeuAnotado = v.vendeu;  // pode ser undefined se não anotou
    }
  });
  return out;
}

// ===== MOTOR DO CÁLCULO — MODO VIRADA =====
// Compara FIN do dia anterior com INI do dia atual.
// Em teoria, deveriam ser IGUAIS (não houve operação entre eles).
// Qualquer diferença significa sumiço ou erro de contagem.
async function calcularAuditoriaVirada(contagemFinAnterior, contagemIniAtual, auditoriaOperacionalDiaAnterior = null, consumoInternoAnt = {}) {
  // Carrega catálogo efetivo de bebidas (base + overrides do gestor)
  const bebidas = await obterBebidas();

  const estoqueFim  = extrairEstoque(contagemFinAnterior);
  const estoqueIni  = extrairEstoque(contagemIniAtual);

  // Mapa slug → diferença da auditoria operacional do dia anterior (se existir)
  const difOperacionalPorSlug = {};
  if (auditoriaOperacionalDiaAnterior && auditoriaOperacionalDiaAnterior.resultado) {
    auditoriaOperacionalDiaAnterior.resultado.forEach(r => {
      difOperacionalPorSlug[r.slug] = r.diferenca || 0;
    });
  }

  return bebidas.map(bebida => {
    const slug = slugify(bebida.nome);
    // FIN anterior já descontando o consumo interno daquele dia (retiradas fora do PDV)
    const fimAnterior = (estoqueFim[slug] || 0) - (consumoInternoAnt[slug] || 0);
    const iniAtual    = estoqueIni[slug] || 0;
    const diferenca = iniAtual - fimAnterior;  // neg = sumiu; pos = "apareceu"

    const abs = Math.abs(diferenca);
    let status = 'ok';
    if (fimAnterior === 0 && iniAtual === 0) status = 'semdados';
    else if (abs >= 5) status = 'critico';
    else if (abs >= 2) status = 'atencao';
    else if (abs >= 1) status = 'leve';

    // DETECÇÃO DE ERRO DE CONTAGEM CONFIRMADO
    // Se na auditoria do dia anterior houve DIF, e hoje na virada a DIF está
    // próximo do oposto, é "coincidência suspeita" → erro de contagem confirmado
    let erroContagemConfirmado = false;
    let difOperacionalAnterior = null;

    if (slug in difOperacionalPorSlug) {
      const difOp = difOperacionalPorSlug[slug];
      difOperacionalAnterior = difOp;

      // Soma das duas diferenças deveria ser ~0 se for erro de contagem
      // (uma "sumiu" no dia, a outra "apareceu" na virada — se anulam)
      const soma = difOp + diferenca;

      // Tolerância 1: soma entre -1 e +1
      // E além disso, ambos têm que ter magnitude >= 1 (senão é só zero vs zero)
      if (Math.abs(soma) <= 1 && Math.abs(difOp) >= 1 && Math.abs(diferenca) >= 1) {
        erroContagemConfirmado = true;
      }
    }

    return {
      slug,
      nome: bebida.nome,
      grupo: bebida.grupo,
      unidCompra: bebida.unidCompra,
      porCaixa: bebida.porCaixa,
      fimAnterior,
      iniAtual,
      diferenca,
      status,
      erroContagemConfirmado,
      difOperacionalAnterior
    };
  });
}

// ===== MOTOR DO CÁLCULO — SORVETES OPERACIONAL =====
// Sorvetes têm uma estrutura diferente das bebidas:
// - INI e FIN ficam no MESMO documento (tipo='sorv')
// - Pra cada sorvete: { ini, abast, fin } → vendeuCalculado = ini + abast - fin
// - Compara com vendas do PDV
// - Embalagens (categoria 📦) têm a mesma estrutura, mas geralmente o "vendeu"
//   no PDV é o consumo de embalagem (ex: "EMBALAGEM M" no relatório de produtos).
async function calcularAuditoriaSorvetes(contagemSorv, vendas, contagemSorvAnterior = null) {
  // Carrega catálogo efetivo de sorvetes (inclui embalagens — todos vão na mesma folha)
  const sorvetes = await obterSorvetes();

  // Extrai os campos da contagem (e da anterior, pro D-1)
  const camposSorv = extrairCamposSorvetes(contagemSorv);
  const camposAnt  = extrairCamposSorvetes(contagemSorvAnterior);

  // Soma vendas do PDV por slug
  const vendidoPorSlug = {};
  vendas.forEach(v => {
    (v.produtos || []).forEach(p => {
      const slug = slugify(p.nome);
      if (!vendidoPorSlug[slug]) vendidoPorSlug[slug] = 0;
      vendidoPorSlug[slug] += p.qtd || 0;
    });
  });

  const temAnterior = !!contagemSorvAnterior;

  // Monta linha por sorvete cadastrado — MESMO formato das bebidas
  return sorvetes.map(sorv => {
    const slug = slugify(sorv.nome);
    const c = camposSorv[slug] || { ini: 0, abast: 0, fin: 0 };
    const ini   = c.ini   || 0;
    const abast = c.abast || 0;   // reabastecimento durante o dia = "recebido"
    const fin   = c.fin   || 0;
    const vendido = vendidoPorSlug[slug] || 0;   // vendeu no PDV

    // Formato bebidas: esperado = ini + recebido − vendido ; real = fin ; dif = real − esperado
    const esperado  = ini + abast - vendido;
    const real      = fin;
    const diferenca = real - esperado;

    // D-1: INI de hoje − FIN do dia operacional anterior (mesma lógica das bebidas)
    let d1 = null;
    if (temAnterior) {
      const finAnt = (camposAnt[slug] && camposAnt[slug].fin) || 0;
      d1 = ini - finAnt;
    }

    // Status pela magnitude da diferença (mesma régua das bebidas)
    const abs = Math.abs(diferenca);
    let status;
    if (ini === 0 && fin === 0 && abast === 0 && vendido === 0) status = 'sem_dados';
    else if (abs >= 5) status = 'critico';
    else if (abs >= 2) status = 'atencao';
    else if (abs >= 1) status = 'leve';
    else                status = 'ok';

    return {
      slug,
      nome: sorv.nome,
      grupo: sorv.grupo || '',
      ini,
      // campos no padrão bebidas (usados no render novo)
      recebido: abast,
      vendido,
      esperado,
      real,
      diferenca,
      d1,
      // campos legados mantidos p/ histórico/PDF/snapshot não quebrarem
      abast,
      fin,
      vendeuCalc: ini + abast - fin,
      vendeuPDV: vendido,
      vendeuAnotado: c.vendeuAnotado,
      status,
      _origem: 'cadastrado'
    };
  });
}
  // OBS: produtos vendidos no PDV que NÃO estão no catálogo de sorvetes
  // são tratados pela função detectarSorvetesNaoCadastrados (para não poluir
  // a tabela principal — vão pra um aviso separado).

/**
 * Detecta produtos vendidos no PDV que se parecem com sorvete/embalagem
 * mas não estão no catálogo. Mostra como aviso pra o gestor cadastrar.
 */
async function detectarSorvetesNaoCadastrados(vendas) {
  const sorvetes = await obterSorvetes({ incluirOcultos: true });
  const slugsCadastrados = new Set(sorvetes.map(s => slugify(s.nome)));
  const naoCadastrados = [];
  const PALAVRAS_CHAVE = ['GELATO', 'SORBET', 'IOGURTE', 'PALETA',
                          'EMBALAGEM', 'COPO CUZUMEL', 'KIT FESTA',
                          'ESPATULA'];
  const vistos = new Set();
  vendas.forEach(v => {
    (v.produtos || []).forEach(p => {
      const up = (p.nome || '').toUpperCase();
      if (!PALAVRAS_CHAVE.some(k => up.includes(k))) return;
      const slug = slugify(p.nome);
      if (slugsCadastrados.has(slug)) return;
      if (vistos.has(slug)) return;
      vistos.add(slug);
      naoCadastrados.push({ nome: p.nome, qtd: p.qtd || 0 });
    });
  });
  return naoCadastrados;
}

// ===== MOTOR DO CÁLCULO — SORVETES VIRADA =====
// Compara o FIN do dia anterior com o INI do dia atual (ambos no mesmo doc tipo='sorv').
// Em teoria, deveriam ser iguais — qualquer divergência é sumiço noturno ou erro de contagem.
async function calcularAuditoriaSorvetesVirada(contagemSorvAnterior, contagemSorvAtual) {
  const sorvetes = await obterSorvetes();
  const camposAnt = extrairCamposSorvetes(contagemSorvAnterior);
  const camposAtu = extrairCamposSorvetes(contagemSorvAtual);

  return sorvetes.map(sorv => {
    const slug = slugify(sorv.nome);
    const fimAnterior = camposAnt[slug]?.fin || 0;
    const iniAtual    = camposAtu[slug]?.ini || 0;
    const diferenca   = iniAtual - fimAnterior;  // negativo = sumiu; positivo = "apareceu"

    const abs = Math.abs(diferenca);
    let status;
    if (fimAnterior === 0 && iniAtual === 0) status = 'sem_dados';
    else if (abs === 0)                       status = 'ok';
    else if (abs === 1)                       status = 'leve';
    else if (abs >= 2 && abs <= 4)            status = 'atencao';
    else                                       status = 'critico';

    return {
      slug,
      nome: sorv.nome,
      grupo: sorv.grupo || '',
      fimAnterior,
      iniAtual,
      diferenca,
      status,
      _origem: 'cadastrado'
    };
  });
}

// ===== RENDERIZAR RESUMO — OPERACIONAL =====
function renderizarResumoOperacional(contagemIni, contagemFin, vendas, recebimentos, contagemFinAnterior) {
  const resumo = document.getElementById('aud-resumo');
  const sub = document.getElementById('aud-sub');

  const periodoLabel = dataInicio === dataFim
    ? fmtData(dataInicio)
    : `${fmtData(dataInicio)} → ${fmtData(dataFim)}`;
  sub.textContent = `${periodoLabel} · ${vendas.length} ${vendas.length === 1 ? 'dia de venda' : 'dias de venda'}`;

  // Conta status
  const criticos = resultadoAuditoria.filter(r => r.status === 'critico').length;
  const atencao  = resultadoAuditoria.filter(r => r.status === 'atencao').length;
  const leves    = resultadoAuditoria.filter(r => r.status === 'leve').length;
  const ok       = resultadoAuditoria.filter(r => r.status === 'ok').length;
  const semdados = resultadoAuditoria.filter(r => r.status === 'semdados').length;

  // Totais gerais (unidades)
  const totalIni = resultadoAuditoria.reduce((s, r) => s + r.ini, 0);
  const totalRec = resultadoAuditoria.reduce((s, r) => s + r.recebido, 0);
  const totalVen = resultadoAuditoria.reduce((s, r) => s + r.vendido, 0);
  const totalFin = resultadoAuditoria.reduce((s, r) => s + r.real, 0);
  const totalDif = resultadoAuditoria.reduce((s, r) => s + r.diferenca, 0);

  // Nota: o banner "Análise cruzada com D-1" foi removido do topo do resumo
  // (o gestor já verá os detalhes do D-1 no modo Virada de dia).
  // Os chips "problema recorrente/isolado/erro de contagem" continuam aparecendo
  // embaixo do nome de cada produto na tabela — lá são úteis item a item.

  resumo.innerHTML = `
    <div class="aud-kpis">
      <div class="aud-kpi aud-kpi-critico">
        <div class="aud-kpi-val">${criticos}</div>
        <div class="aud-kpi-label">CRÍTICOS (≥5 un)</div>
      </div>
      <div class="aud-kpi aud-kpi-atencao">
        <div class="aud-kpi-val">${atencao}</div>
        <div class="aud-kpi-label">ATENÇÃO (2-4)</div>
      </div>
      <div class="aud-kpi aud-kpi-leve">
        <div class="aud-kpi-val">${leves}</div>
        <div class="aud-kpi-label">LEVES (1)</div>
      </div>
      <div class="aud-kpi aud-kpi-ok">
        <div class="aud-kpi-val">${ok}</div>
        <div class="aud-kpi-label">OK (0)</div>
      </div>
      <div class="aud-kpi aud-kpi-semdados">
        <div class="aud-kpi-val">${semdados}</div>
        <div class="aud-kpi-label">SEM DADOS</div>
      </div>
    </div>

    <div class="aud-equacao">
      <div class="aud-eq-item">
        <div class="aud-eq-label">INICIAL</div>
        <div class="aud-eq-val">${fmtInt(totalIni)}</div>
      </div>
      <div class="aud-eq-op">+</div>
      <div class="aud-eq-item aud-eq-recebido">
        <div class="aud-eq-label">RECEBIDO</div>
        <div class="aud-eq-val">${fmtInt(totalRec)}</div>
        <div class="aud-eq-sub">${recebimentos.length} ${recebimentos.length === 1 ? 'entrega' : 'entregas'}</div>
      </div>
      <div class="aud-eq-op">−</div>
      <div class="aud-eq-item aud-eq-vendido">
        <div class="aud-eq-label">VENDIDO</div>
        <div class="aud-eq-val">${fmtInt(totalVen)}</div>
      </div>
      <div class="aud-eq-op">=</div>
      <div class="aud-eq-item aud-eq-esperado">
        <div class="aud-eq-label">ESPERADO</div>
        <div class="aud-eq-val">${fmtInt(totalIni + totalRec - totalVen)}</div>
      </div>
      <div class="aud-eq-op aud-eq-vs">vs</div>
      <div class="aud-eq-item aud-eq-real">
        <div class="aud-eq-label">REAL (FIN)</div>
        <div class="aud-eq-val">${fmtInt(totalFin)}</div>
      </div>
      <div class="aud-eq-op">=</div>
      <div class="aud-eq-item ${totalDif < 0 ? 'aud-eq-neg' : totalDif > 0 ? 'aud-eq-pos' : 'aud-eq-zero'}">
        <div class="aud-eq-label">DIFERENÇA</div>
        <div class="aud-eq-val">${fmtSgn(totalDif)}</div>
      </div>
    </div>
  `;
}

// ===== RENDERIZAR TABELA — OPERACIONAL =====
function renderizarTabelaOperacional() {
  const tabela = document.getElementById('aud-tabela');

  // Ordena: críticos primeiro, depois atenção, leves, ok, sem dados (mesma lógica da lista de compras)
  const ordemStatus = { critico: 0, atencao: 1, leve: 2, ok: 3, semdados: 4 };
  const sorted = [...resultadoAuditoria].sort((a, b) => {
    const ds = ordemStatus[a.status] - ordemStatus[b.status];
    if (ds !== 0) return ds;
    // Dentro do mesmo status, ordena por |diferença| descendente
    return Math.abs(b.diferenca) - Math.abs(a.diferenca);
  });

  // Agrupa por grupo (Cervejas, Refrigerantes, etc) pra facilitar leitura
  const grupos = {};
  sorted.forEach(r => {
    if (!grupos[r.grupo]) grupos[r.grupo] = [];
    grupos[r.grupo].push(r);
  });

  tabela.innerHTML = `
    <h4 class="aud-sec-title">📋 Detalhamento por produto</h4>
    <div class="aud-lista">
      <div class="aud-linha aud-cab">
        <div>Produto</div>
        <div title="Variação na virada (INI atual − FIN do dia anterior). 'n/c' = não calculado (sem FIN anterior).">D-1</div>
        <div title="Contagem inicial">INI</div>
        <div title="Recebido no período">+REC</div>
        <div title="Vendido no período (PDV)">−VEN</div>
        <div title="Estoque esperado ao final">=ESP</div>
        <div title="Contagem real ao final">REAL</div>
        <div title="Diferença (Real − Esperado)">DIF</div>
        <div>Status</div>
      </div>
      ${Object.entries(grupos).map(([grupo, itens]) => `
        <div class="aud-grupo-header">${grupo}</div>
        ${itens.map(renderLinhaOperacional).join('')}
      `).join('')}
    </div>
  `;
}

function renderLinhaOperacional(r) {
  const statusBadge = {
    critico:  '<span class="aud-badge bad-critico">CRÍTICO</span>',
    atencao:  '<span class="aud-badge bad-atencao">ATENÇÃO</span>',
    leve:     '<span class="aud-badge bad-leve">LEVE</span>',
    ok:       '<span class="aud-badge bad-ok">OK</span>',
    semdados: '<span class="aud-badge bad-semdados">s/ dados</span>'
  }[r.status];

  const difClasse = r.diferenca < 0 ? 'aud-dif-neg' :
                    r.diferenca > 0 ? 'aud-dif-pos' : 'aud-dif-zero';

  // Diagnóstico cruzado (D-1 vs DIF) — mostra logo embaixo do status
  const diagMap = {
    erro_contagem: {
      txt: `🔍 Provável erro de contagem (D-1 = ${fmtSgn(r.d1)})`,
      cls: 'aud-diag-erro',
      titulo: 'A diferença do dia é oposta à variação D-1 (um faltou, o outro sobrou em quantidades parecidas). Isso sugere que alguém contou errado em uma das contagens — o que "sumiu" numa, "reapareceu" na outra.'
    },
    recorrente: {
      txt: `⚠️ Problema recorrente (D-1 = ${fmtSgn(r.d1)})`,
      cls: 'aud-diag-rec',
      titulo: 'A mesma direção de divergência (falta ou sobra) aparece na virada E na auditoria do dia. Indica problema contínuo — pode ser vazamento de estoque ou consumo não registrado sistemático.'
    },
    isolado: {
      txt: `🎯 Problema isolado (D-1 = 0)`,
      cls: 'aud-diag-iso',
      titulo: 'A virada foi perfeita (sem divergência entre fechamento anterior e abertura), mas a operação de hoje gerou divergência. Algo aconteceu só hoje.'
    }
  };
  const diag = diagMap[r.diagnostico];
  const diagHtml = diag
    ? `<div class="aud-diag-cell ${diag.cls}" title="${diag.titulo}">${diag.txt}</div>`
    : '';

  // ===== ÁREA DE CORREÇÃO MANUAL =====
  // Aparece quando o sistema diagnosticou "erro_contagem" (D-1 e DIF com sinais
  // opostos e magnitudes próximas). O gestor decide qual contagem do DIA atual
  // ajustar:
  //   - Corrigir INI: assume que a INI foi contada baixa/alta → o ajuste sobe/desce
  //                   o INI pra alinhar com FIN do dia anterior. Resolve a divergência
  //                   E o D-1 ao mesmo tempo (matemática mais coerente).
  //   - Corrigir FIN: assume que a FIN foi contada errada → ajusta a FIN pra
  //                   zerar a divergência. O D-1 continua existindo (foi erro
  //                   da contagem anterior, não desta).
  let areaCorrecaoOpHtml = '';
  if (r.diagnostico === 'erro_contagem') {
    const novoIni = r.ini - r.d1;       // sobe/desce ini pra alinhar com FIN anterior
    const novoFin = r.real - r.diferenca; // sobe/desce fin pra zerar a divergência
    areaCorrecaoOpHtml = `
      <div class="aud-corrigir-manual">
        <button class="btn btn-ghost btn-sm aud-btn-toggle-manual"
                id="aud-btn-toggle-op-${r.slug}"
                onclick="window.__aud_toggleCorrigirManualOp('${r.slug}')">
          💡 Aceitar sugestão e corrigir
        </button>
        <div class="aud-corrigir-manual-box" id="aud-corr-manual-op-${r.slug}" style="display:none">
          <div class="aud-corr-aviso">
            <strong>📊 Análise:</strong> ontem (D-1) faltou <strong>${fmtSgn(r.d1)}</strong> e hoje sobrou <strong>${fmtSgn(r.diferenca)}</strong>. Os sinais opostos sugerem erro de contagem em uma das duas contagens deste dia.
            <br><br>
            <strong>⚠️ Atenção:</strong> a correção abaixo é uma sugestão matemática. Se houver dúvida sobre qual contagem está errada, investigue antes de aplicar.
          </div>
          <div class="aud-corrigir-botoes">
            <button class="btn btn-primary btn-sm"
                    onclick="window.__aud_corrigirOpErro('${r.slug}', 'ini')"
                    title="Ajusta INI do dia atual de ${fmtInt(r.ini)} pra ${fmtInt(novoIni)} (alinha com FIN do dia anterior — recomendado)">
            🔄 Corrigir INI (${fmtInt(r.ini)} → ${fmtInt(novoIni)})
          </button>
          <button class="btn btn-ghost btn-sm"
                  onclick="window.__aud_corrigirOpErro('${r.slug}', 'fin')"
                  title="Ajusta FIN do dia atual de ${fmtInt(r.real)} pra ${fmtInt(novoFin)} (zera a divergência mas D-1 permanece)">
            🔄 Corrigir FIN (${fmtInt(r.real)} → ${fmtInt(novoFin)})
          </button>
          </div>
        </div>
      </div>
    `;
  }

  // Célula D-1
  // - null → "n/c" (não calculado: não tem FIN do dia anterior)
  // - 0    → ✓ verde (virada perfeita)
  // - ≠ 0  → valor formatado com sinal (vermelho se negativo, amarelo se positivo)
  let cellD1Html;
  if (r.d1 === null || r.d1 === undefined) {
    cellD1Html = '<div class="aud-num aud-d1-nc" title="Sem FIN do dia anterior pra comparar">n/c</div>';
  } else if (r.d1 === 0) {
    cellD1Html = '<div class="aud-num aud-d1-ok" title="Virada perfeita (INI atual = FIN do dia anterior)">✓</div>';
  } else {
    const d1Cls = r.d1 < 0 ? 'aud-d1-neg' : 'aud-d1-pos';
    const d1Title = r.d1 < 0
      ? `Sumiu ${Math.abs(r.d1)} entre o fechamento de ontem e a abertura de hoje`
      : `Apareceu ${r.d1} entre o fechamento de ontem e a abertura de hoje`;
    cellD1Html = `<div class="aud-num ${d1Cls}" title="${d1Title}">${fmtSgn(r.d1)}</div>`;
  }

  return `
    <div class="aud-linha aud-linha-${r.status}${diag ? ' aud-linha-com-diag' : ''}">
      <div class="aud-nome">
        <span class="aud-nome-texto">${r.nome}</span>
        <button class="aud-btn-editar"
                onclick="window.__aud_abrirEdicao('${r.slug}')"
                title="Editar valores INI / REC / FIN deste produto">✏️</button>
        ${diagHtml}
        ${areaCorrecaoOpHtml}
      </div>
      ${cellD1Html}
      <div class="aud-num">${fmtInt(r.ini)}</div>
      <div class="aud-num aud-num-pos">${r.recebido > 0 ? '+' + fmtInt(r.recebido) : '—'}</div>
      <div class="aud-num aud-num-neg">${r.vendido > 0 ? '−' + fmtInt(r.vendido) : '—'}</div>
      <div class="aud-num aud-num-esp">${fmtInt(r.esperado)}</div>
      <div class="aud-num aud-num-real">${fmtInt(r.real)}</div>
      <div class="aud-num ${difClasse}">${fmtSgn(r.diferenca)}</div>
      <div>${statusBadge}</div>
    </div>
  `;
}

// ===== RENDERIZAR RESUMO — VIRADA =====
function renderizarResumoVirada(contagemFinAnterior, contagemIniAtual) {
  const resumo = document.getElementById('aud-resumo');
  const sub = document.getElementById('aud-sub');

  const dias = diffDias(dataInicio, dataFim);
  const labelDias = dias === 1
    ? '1 dia de parada (noite)'
    : `${dias} dias de parada (parada semanal)`;
  sub.textContent = `🌙 Virada: ${fmtData(dataInicio)} → ${fmtData(dataFim)} · ${labelDias}`;

  const criticos = resultadoAuditoria.filter(r => r.status === 'critico').length;
  const atencao  = resultadoAuditoria.filter(r => r.status === 'atencao').length;
  const leves    = resultadoAuditoria.filter(r => r.status === 'leve').length;
  const ok       = resultadoAuditoria.filter(r => r.status === 'ok').length;
  const semdados = resultadoAuditoria.filter(r => r.status === 'semdados').length;

  // Totais
  const totalFim = resultadoAuditoria.reduce((s, r) => s + r.fimAnterior, 0);
  const totalIni = resultadoAuditoria.reduce((s, r) => s + r.iniAtual, 0);
  const totalDif = resultadoAuditoria.reduce((s, r) => s + r.diferenca, 0);

  resumo.innerHTML = `
    <div class="aud-kpis">
      <div class="aud-kpi aud-kpi-critico">
        <div class="aud-kpi-val">${criticos}</div>
        <div class="aud-kpi-label">CRÍTICOS (≥5 un)</div>
      </div>
      <div class="aud-kpi aud-kpi-atencao">
        <div class="aud-kpi-val">${atencao}</div>
        <div class="aud-kpi-label">ATENÇÃO (2-4)</div>
      </div>
      <div class="aud-kpi aud-kpi-leve">
        <div class="aud-kpi-val">${leves}</div>
        <div class="aud-kpi-label">LEVES (1)</div>
      </div>
      <div class="aud-kpi aud-kpi-ok">
        <div class="aud-kpi-val">${ok}</div>
        <div class="aud-kpi-label">OK (0)</div>
      </div>
      <div class="aud-kpi aud-kpi-semdados">
        <div class="aud-kpi-val">${semdados}</div>
        <div class="aud-kpi-label">SEM DADOS</div>
      </div>
    </div>

    <div class="aud-equacao aud-eq-virada">
      <div class="aud-eq-item">
        <div class="aud-eq-label">FIN ${fmtData(dataInicio)}</div>
        <div class="aud-eq-val">${fmtInt(totalFim)}</div>
        <div class="aud-eq-sub">fechamento</div>
      </div>
      <div class="aud-eq-op aud-eq-vs">vs</div>
      <div class="aud-eq-item">
        <div class="aud-eq-label">INI ${fmtData(dataFim)}</div>
        <div class="aud-eq-val">${fmtInt(totalIni)}</div>
        <div class="aud-eq-sub">abertura</div>
      </div>
      <div class="aud-eq-op">=</div>
      <div class="aud-eq-item ${totalDif < 0 ? 'aud-eq-neg' : totalDif > 0 ? 'aud-eq-pos' : 'aud-eq-zero'}">
        <div class="aud-eq-label">DIFERENÇA</div>
        <div class="aud-eq-val">${fmtSgn(totalDif)}</div>
        <div class="aud-eq-sub">${totalDif === 0 ? 'tudo certo ✓' : 'investigar'}</div>
      </div>
    </div>
  `;
}

// ===== RENDERIZAR TABELA — VIRADA =====
function renderizarTabelaVirada() {
  const tabela = document.getElementById('aud-tabela');

  const ordemStatus = { critico: 0, atencao: 1, leve: 2, ok: 3, semdados: 4 };
  const sorted = [...resultadoAuditoria].sort((a, b) => {
    const ds = ordemStatus[a.status] - ordemStatus[b.status];
    if (ds !== 0) return ds;
    return Math.abs(b.diferenca) - Math.abs(a.diferenca);
  });

  const grupos = {};
  sorted.forEach(r => {
    if (!grupos[r.grupo]) grupos[r.grupo] = [];
    grupos[r.grupo].push(r);
  });

  tabela.innerHTML = `
    <h4 class="aud-sec-title">🌙 Comparativo de virada — item por item</h4>
    <div class="aud-lista aud-lista-virada">
      <div class="aud-linha aud-cab">
        <div>Produto</div>
        <div title="Contagem FIN do dia anterior">FIN ${fmtData(dataInicio)}</div>
        <div title="Contagem INI do dia atual">INI ${fmtData(dataFim)}</div>
        <div title="Diferença (INI − FIN anterior)">DIF</div>
        <div>Status</div>
      </div>
      ${Object.entries(grupos).map(([grupo, itens]) => `
        <div class="aud-grupo-header">${grupo}</div>
        ${itens.map(renderLinhaVirada).join('')}
      `).join('')}
    </div>
  `;
}

function renderLinhaVirada(r) {
  const statusBadge = {
    critico:  '<span class="aud-badge bad-critico">CRÍTICO</span>',
    atencao:  '<span class="aud-badge bad-atencao">ATENÇÃO</span>',
    leve:     '<span class="aud-badge bad-leve">LEVE</span>',
    ok:       '<span class="aud-badge bad-ok">OK</span>',
    semdados: '<span class="aud-badge bad-semdados">s/ dados</span>'
  }[r.status];

  const difClasse = r.diferenca < 0 ? 'aud-dif-neg' :
                    r.diferenca > 0 ? 'aud-dif-pos' : 'aud-dif-zero';

  // ===== ÁREA DE CORREÇÃO (apenas Cenário A: erro confirmado) =====
  // O botão "corrigir manualmente" foi MOVIDO para a tela operacional —
  // lá ele aparece quando há diagnóstico "Provável erro de contagem (D-1)",
  // que é o lugar mais natural pra o gestor agir após executar a auditoria
  // do dia. Aqui na virada mantemos só o caso de matemática confirmada,
  // que é raro e merece destaque vermelho.
  let areaCorrecaoHtml = '';

  if (r.erroContagemConfirmado) {
    const difOp = r.difOperacionalAnterior;
    areaCorrecaoHtml = `
      <div class="aud-erro-confirmado">
        <span class="aud-erro-ico">⚠️</span>
        <div class="aud-erro-txt">
          <strong>Erro de contagem confirmado</strong>
          <small>Ontem faltou ${fmtSgn(difOp)}, hoje apareceu ${fmtSgn(r.diferenca)}. Total = 0 → uma das contagens foi feita errada.</small>
        </div>
        <div class="aud-corrigir-botoes">
          <button class="btn btn-primary btn-sm aud-btn-corrigir"
                  onclick="window.__aud_corrigirErro('${r.slug}', 'fin', true)"
                  title="Ajusta FIN do dia anterior pra ${fmtInt(r.iniAtual)}">
            🔄 Corrigir FIN (${fmtInt(r.fimAnterior)} → ${fmtInt(r.iniAtual)})
          </button>
          <button class="btn btn-ghost btn-sm aud-btn-corrigir"
                  onclick="window.__aud_corrigirErro('${r.slug}', 'ini', true)"
                  title="Ajusta INI do dia atual pra ${fmtInt(r.fimAnterior)}">
            🔄 Corrigir INI (${fmtInt(r.iniAtual)} → ${fmtInt(r.fimAnterior)})
          </button>
        </div>
      </div>
    `;
  }

  return `
    <div class="aud-linha aud-linha-virada aud-linha-${r.status}${r.erroContagemConfirmado ? ' aud-linha-erro-confirmado' : ''}">
      <div class="aud-nome">
        ${r.nome}
        ${areaCorrecaoHtml}
      </div>
      <div class="aud-num">${fmtInt(r.fimAnterior)}</div>
      <div class="aud-num aud-num-real">${fmtInt(r.iniAtual)}</div>
      <div class="aud-num ${difClasse}">${fmtSgn(r.diferenca)}</div>
      <div>${statusBadge}</div>
    </div>
  `;
}

// ========================================================================
// RENDERIZAÇÃO — SORVETES & EMBALAGENS
// ========================================================================

/** Limpa a seção de sorvetes (esconde) — usado quando troca modo ou não há contagem). */
function limparSecaoSorvetes() {
  const secao = document.getElementById('aud-sorvetes-secao');
  if (secao) {
    secao.style.display = 'none';
    secao.innerHTML = '';
  }
}

/**
 * Renderiza a tabela de sorvetes & embalagens no modo operacional.
 * Mostra: INI / +ABAST / =ESP / FIN / VEN-PDV / DIF
 * Onde ESP = INI + ABAST e DIF = (INI+ABAST-FIN) - VEN-PDV
 */
async function renderizarSecaoSorvetesOperacional(vendas) {
  const secao = document.getElementById('aud-sorvetes-secao');
  if (!secao) return;

  const naoCadastrados = await detectarSorvetesNaoCadastrados(vendas);

  // KPIs
  const criticos = resultadoSorvetes.filter(r => r.status === 'critico').length;
  const atencao  = resultadoSorvetes.filter(r => r.status === 'atencao').length;
  const leves    = resultadoSorvetes.filter(r => r.status === 'leve').length;
  const ok       = resultadoSorvetes.filter(r => r.status === 'ok').length;
  const semdados = resultadoSorvetes.filter(r => r.status === 'sem_dados').length;

  // Totais (formato bebidas)
  const totalIni    = resultadoSorvetes.reduce((s, r) => s + (r.ini || 0), 0);
  const totalRec    = resultadoSorvetes.reduce((s, r) => s + (r.recebido || 0), 0);
  const totalVen    = resultadoSorvetes.reduce((s, r) => s + (r.vendido || 0), 0);
  const totalEsp    = resultadoSorvetes.reduce((s, r) => s + (r.esperado || 0), 0);
  const totalReal   = resultadoSorvetes.reduce((s, r) => s + (r.real || 0), 0);
  const totalDif    = resultadoSorvetes.reduce((s, r) => s + (r.diferenca || 0), 0);

  // Agrupa por grupo (Sorbets / Gelatos / Embalagens) — MOSTRA TODOS os produtos
  const grupos = {};
  resultadoSorvetes.forEach(r => {
    const g = r.grupo || '— Sem grupo —';
    if (!grupos[g]) grupos[g] = [];
    grupos[g].push(r);
  });

  // Aviso de produtos vendidos não cadastrados
  let avisoNaoCadastrados = '';
  if (naoCadastrados.length > 0) {
    const lista = naoCadastrados.map(p => `<li><strong>${p.nome}</strong> (${p.qtd} un)</li>`).join('');
    avisoNaoCadastrados = `
      <div class="aud-aviso-naocad">
        <div class="aud-aviso-head">
          <span class="aud-aviso-ico">⚠️</span>
          <strong>Produtos vendidos no PDV mas não cadastrados em Sorvetes/Embalagens</strong>
        </div>
        <small>Vá em <strong>Catálogo</strong> e adicione esses produtos pra que apareçam na auditoria:</small>
        <ul class="aud-aviso-lista">${lista}</ul>
      </div>
    `;
  }

  secao.innerHTML = `
    <div class="aud-sorv-titulo">
      <h3>🍨 Sorvetes &amp; Embalagens</h3>
      <span class="aud-sorv-sub">Mesmo cálculo das bebidas: esperado (INI+REC−VEN) vs contagem real</span>
    </div>

    <div class="aud-kpis aud-kpis-sorv">
      <div class="aud-kpi aud-kpi-critico"><div class="aud-kpi-val">${criticos}</div><div class="aud-kpi-label">CRÍTICOS (≥5)</div></div>
      <div class="aud-kpi aud-kpi-atencao"><div class="aud-kpi-val">${atencao}</div><div class="aud-kpi-label">ATENÇÃO (2-4)</div></div>
      <div class="aud-kpi aud-kpi-leve"><div class="aud-kpi-val">${leves}</div><div class="aud-kpi-label">LEVES (1)</div></div>
      <div class="aud-kpi aud-kpi-ok"><div class="aud-kpi-val">${ok}</div><div class="aud-kpi-label">OK (0)</div></div>
      <div class="aud-kpi aud-kpi-semdados"><div class="aud-kpi-val">${semdados}</div><div class="aud-kpi-label">SEM DADOS</div></div>
    </div>

    ${avisoNaoCadastrados}

    <div class="aud-equacao">
      <div class="aud-eq-card">
        <div class="aud-eq-label">INICIAL</div>
        <div class="aud-eq-val">${fmtInt(totalIni)}</div>
      </div>
      <div class="aud-eq-op">+</div>
      <div class="aud-eq-card">
        <div class="aud-eq-label">RECEBIDO</div>
        <div class="aud-eq-val">${fmtInt(totalRec)}</div>
      </div>
      <div class="aud-eq-op">−</div>
      <div class="aud-eq-card">
        <div class="aud-eq-label">VENDIDO</div>
        <div class="aud-eq-val">${fmtInt(totalVen)}</div>
      </div>
      <div class="aud-eq-op">=</div>
      <div class="aud-eq-card aud-eq-card-esp">
        <div class="aud-eq-label">ESPERADO</div>
        <div class="aud-eq-val">${fmtInt(totalEsp)}</div>
      </div>
      <div class="aud-eq-op">vs</div>
      <div class="aud-eq-card aud-eq-card-real">
        <div class="aud-eq-label">REAL (FIN)</div>
        <div class="aud-eq-val">${fmtInt(totalReal)}</div>
      </div>
      <div class="aud-eq-op">=</div>
      <div class="aud-eq-card aud-eq-card-dif">
        <div class="aud-eq-label">DIFERENÇA</div>
        <div class="aud-eq-val ${totalDif < 0 ? 'aud-dif-neg' : totalDif > 0 ? 'aud-dif-pos' : 'aud-dif-zero'}">${fmtSgn(totalDif)}</div>
      </div>
    </div>

    <div class="aud-lista">
      <div class="aud-linha aud-cab">
        <div>Produto</div>
        <div title="INI atual − FIN do dia anterior">D-1</div>
        <div title="Contagem inicial">INI</div>
        <div title="Reabastecido no dia">+REC</div>
        <div title="Vendido no PDV">−VEN</div>
        <div title="Estoque esperado ao final">=ESP</div>
        <div title="Contagem real ao final">REAL</div>
        <div title="Diferença (Real − Esperado)">DIF</div>
        <div>Status</div>
      </div>
      ${Object.entries(grupos).map(([grupo, itens]) => `
        <div class="aud-grupo-header">${grupo}</div>
        ${itens.map(r => renderLinhaSorvetesOperacional(r)).join('')}
      `).join('')}
    </div>
  `;

  secao.style.display = 'block';
}

function renderLinhaSorvetesOperacional(r) {
  const statusBadge = {
    critico:  '<span class="aud-badge bad-critico">CRÍTICO</span>',
    atencao:  '<span class="aud-badge bad-atencao">ATENÇÃO</span>',
    leve:     '<span class="aud-badge bad-leve">LEVE</span>',
    ok:       '<span class="aud-badge bad-ok">OK</span>',
    sem_dados:'<span class="aud-badge bad-semdados">s/ dados</span>'
  }[r.status];

  const difClasse = r.diferenca < 0 ? 'aud-dif-neg' :
                    r.diferenca > 0 ? 'aud-dif-pos' : 'aud-dif-zero';

  const d1Txt = (r.d1 === null || r.d1 === undefined) ? 'n/c' : fmtSgn(r.d1);
  const d1Classe = (r.d1 === null || r.d1 === undefined) ? 'aud-dif-zero'
                 : r.d1 < 0 ? 'aud-dif-neg' : r.d1 > 0 ? 'aud-dif-pos' : 'aud-dif-zero';

  return `
    <div class="aud-linha aud-linha-${r.status}">
      <div class="aud-nome">${r.nome}</div>
      <div class="aud-num ${d1Classe}">${d1Txt}</div>
      <div class="aud-num">${fmtInt(r.ini)}</div>
      <div class="aud-num aud-num-pos">${r.recebido > 0 ? '+' + fmtInt(r.recebido) : '—'}</div>
      <div class="aud-num">${r.vendido > 0 ? '−' + fmtInt(r.vendido) : '—'}</div>
      <div class="aud-num aud-num-esp">${fmtInt(r.esperado)}</div>
      <div class="aud-num aud-num-real">${fmtInt(r.real)}</div>
      <div class="aud-num ${difClasse}">${fmtSgn(r.diferenca)}</div>
      <div>${statusBadge}</div>
    </div>
  `;
}

/**
 * Renderiza a virada de sorvetes (FIN do dia X vs INI do dia X+1).
 */
function renderizarSecaoSorvetesVirada() {
  const secao = document.getElementById('aud-sorvetes-secao');
  if (!secao) return;

  const criticos = resultadoSorvetesVirada.filter(r => r.status === 'critico').length;
  const atencao  = resultadoSorvetesVirada.filter(r => r.status === 'atencao').length;
  const leves    = resultadoSorvetesVirada.filter(r => r.status === 'leve').length;
  const ok       = resultadoSorvetesVirada.filter(r => r.status === 'ok').length;
  const semdados = resultadoSorvetesVirada.filter(r => r.status === 'sem_dados').length;

  const totalFim = resultadoSorvetesVirada.reduce((s, r) => s + r.fimAnterior, 0);
  const totalIni = resultadoSorvetesVirada.reduce((s, r) => s + r.iniAtual, 0);
  const totalDif = resultadoSorvetesVirada.reduce((s, r) => s + r.diferenca, 0);

  const grupos = {};
  resultadoSorvetesVirada.forEach(r => {
    if (r.status === 'sem_dados') return;
    const g = r.grupo || '— Sem grupo —';
    if (!grupos[g]) grupos[g] = [];
    grupos[g].push(r);
  });

  secao.innerHTML = `
    <div class="aud-sorv-titulo">
      <h3>🍨 Sorvetes &amp; Embalagens</h3>
      <span class="aud-sorv-sub">Virada: FIN do dia anterior vs INI do dia atual</span>
    </div>

    <div class="aud-kpis aud-kpis-sorv">
      <div class="aud-kpi aud-kpi-critico"><div class="aud-kpi-val">${criticos}</div><div class="aud-kpi-label">CRÍTICOS (≥5)</div></div>
      <div class="aud-kpi aud-kpi-atencao"><div class="aud-kpi-val">${atencao}</div><div class="aud-kpi-label">ATENÇÃO (2-4)</div></div>
      <div class="aud-kpi aud-kpi-leve"><div class="aud-kpi-val">${leves}</div><div class="aud-kpi-label">LEVES (1)</div></div>
      <div class="aud-kpi aud-kpi-ok"><div class="aud-kpi-val">${ok}</div><div class="aud-kpi-label">OK (0)</div></div>
      <div class="aud-kpi aud-kpi-semdados"><div class="aud-kpi-val">${semdados}</div><div class="aud-kpi-label">SEM DADOS</div></div>
    </div>

    <div class="aud-equacao aud-equacao-virada">
      <div class="aud-eq-card">
        <div class="aud-eq-label">FIN ANTERIOR</div>
        <div class="aud-eq-val">${fmtInt(totalFim)}</div>
      </div>
      <div class="aud-eq-op">vs</div>
      <div class="aud-eq-card aud-eq-card-real">
        <div class="aud-eq-label">INI ATUAL</div>
        <div class="aud-eq-val">${fmtInt(totalIni)}</div>
      </div>
      <div class="aud-eq-op">=</div>
      <div class="aud-eq-card aud-eq-card-dif">
        <div class="aud-eq-label">DIFERENÇA</div>
        <div class="aud-eq-val ${totalDif < 0 ? 'aud-dif-neg' : totalDif > 0 ? 'aud-dif-pos' : 'aud-dif-zero'}">${fmtSgn(totalDif)}</div>
      </div>
    </div>

    <div class="aud-tabela-wrapper">
      <div class="aud-cabecalho aud-cabecalho-virada">
        <div>Produto</div>
        <div class="aud-num">FIN ANT.</div>
        <div class="aud-num">INI ATUAL</div>
        <div class="aud-num">DIF</div>
        <div>Status</div>
      </div>
      ${Object.entries(grupos).map(([grupo, itens]) => `
        <div class="aud-grupo-sep">
          <span class="aud-grupo-icon">◆</span> ${grupo}
        </div>
        ${itens.map(r => renderLinhaSorvetesVirada(r)).join('')}
      `).join('')}
    </div>
  `;

  secao.style.display = 'block';
}

function renderLinhaSorvetesVirada(r) {
  const statusBadge = {
    critico:  '<span class="aud-badge bad-critico">CRÍTICO</span>',
    atencao:  '<span class="aud-badge bad-atencao">ATENÇÃO</span>',
    leve:     '<span class="aud-badge bad-leve">LEVE</span>',
    ok:       '<span class="aud-badge bad-ok">OK</span>',
    sem_dados:'<span class="aud-badge bad-semdados">s/ dados</span>'
  }[r.status];

  const difClasse = r.diferenca < 0 ? 'aud-dif-neg' :
                    r.diferenca > 0 ? 'aud-dif-pos' : 'aud-dif-zero';

  return `
    <div class="aud-linha aud-linha-virada aud-linha-${r.status}">
      <div class="aud-nome">${r.nome}</div>
      <div class="aud-num">${fmtInt(r.fimAnterior)}</div>
      <div class="aud-num aud-num-real">${fmtInt(r.iniAtual)}</div>
      <div class="aud-num ${difClasse}">${fmtSgn(r.diferenca)}</div>
      <div>${statusBadge}</div>
    </div>
  `;
}

/**
 * Renderiza a tabela de sorvetes do HISTÓRICO (sem buscar vendas).
 * Usa o snapshot já hidratado em `resultadoSorvetes`.
 * Mesma lógica visual do operacional, mas sem o aviso de "não cadastrados"
 * (que só faria sentido em tempo real, comparando com o catálogo atual).
 */
async function renderizarSecaoSorvetesHistoricoOperacional() {
  const secao = document.getElementById('aud-sorvetes-secao');
  if (!secao) return;

  // KPIs
  const criticos = resultadoSorvetes.filter(r => r.status === 'critico').length;
  const atencao  = resultadoSorvetes.filter(r => r.status === 'atencao').length;
  const leves    = resultadoSorvetes.filter(r => r.status === 'leve').length;
  const ok       = resultadoSorvetes.filter(r => r.status === 'ok').length;
  const semdados = resultadoSorvetes.filter(r => r.status === 'sem_dados').length;

  // Totais
  const totalIni    = resultadoSorvetes.reduce((s, r) => s + (r.ini || 0), 0);
  const totalAbast  = resultadoSorvetes.reduce((s, r) => s + (r.abast || 0), 0);
  const totalFin    = resultadoSorvetes.reduce((s, r) => s + (r.fin || 0), 0);
  const totalVCalc  = resultadoSorvetes.reduce((s, r) => s + (r.vendeuCalc || 0), 0);
  const totalVPdv   = resultadoSorvetes.reduce((s, r) => s + (r.vendeuPDV || 0), 0);
  const totalDif    = resultadoSorvetes.reduce((s, r) => s + (r.diferenca || 0), 0);

  // Agrupa por grupo
  const grupos = {};
  resultadoSorvetes.forEach(r => {
    if (r.status === 'sem_dados' && (r.vendeuPDV || 0) === 0) return;
    const g = r.grupo || '— Sem grupo —';
    if (!grupos[g]) grupos[g] = [];
    grupos[g].push(r);
  });

  secao.innerHTML = `
    <div class="aud-sorv-titulo">
      <h3>🍨 Sorvetes &amp; Embalagens</h3>
      <span class="aud-sorv-sub">Histórico — snapshot da auditoria fechada</span>
    </div>

    <div class="aud-kpis aud-kpis-sorv">
      <div class="aud-kpi aud-kpi-critico"><div class="aud-kpi-val">${criticos}</div><div class="aud-kpi-label">CRÍTICOS (≥5)</div></div>
      <div class="aud-kpi aud-kpi-atencao"><div class="aud-kpi-val">${atencao}</div><div class="aud-kpi-label">ATENÇÃO (2-4)</div></div>
      <div class="aud-kpi aud-kpi-leve"><div class="aud-kpi-val">${leves}</div><div class="aud-kpi-label">LEVES (1)</div></div>
      <div class="aud-kpi aud-kpi-ok"><div class="aud-kpi-val">${ok}</div><div class="aud-kpi-label">OK (0)</div></div>
      <div class="aud-kpi aud-kpi-semdados"><div class="aud-kpi-val">${semdados}</div><div class="aud-kpi-label">SEM DADOS</div></div>
    </div>

    <div class="aud-equacao">
      <div class="aud-eq-card"><div class="aud-eq-label">INICIAL</div><div class="aud-eq-val">${fmtInt(totalIni)}</div></div>
      <div class="aud-eq-op">+</div>
      <div class="aud-eq-card"><div class="aud-eq-label">ABAST.</div><div class="aud-eq-val">${fmtInt(totalAbast)}</div></div>
      <div class="aud-eq-op">−</div>
      <div class="aud-eq-card"><div class="aud-eq-label">FINAL</div><div class="aud-eq-val">${fmtInt(totalFin)}</div></div>
      <div class="aud-eq-op">=</div>
      <div class="aud-eq-card aud-eq-card-esp"><div class="aud-eq-label">VENDEU CALC.</div><div class="aud-eq-val">${fmtInt(totalVCalc)}</div></div>
      <div class="aud-eq-op">vs</div>
      <div class="aud-eq-card aud-eq-card-real"><div class="aud-eq-label">VENDEU PDV</div><div class="aud-eq-val">${fmtInt(totalVPdv)}</div></div>
      <div class="aud-eq-op">=</div>
      <div class="aud-eq-card aud-eq-card-dif">
        <div class="aud-eq-label">DIFERENÇA</div>
        <div class="aud-eq-val ${totalDif < 0 ? 'aud-dif-neg' : totalDif > 0 ? 'aud-dif-pos' : 'aud-dif-zero'}">${fmtSgn(totalDif)}</div>
      </div>
    </div>

    <div class="aud-tabela-wrapper">
      <div class="aud-cabecalho aud-cabecalho-sorv">
        <div>Produto</div>
        <div class="aud-num">INI</div>
        <div class="aud-num">+ABAST</div>
        <div class="aud-num">−FIN</div>
        <div class="aud-num">=CALC</div>
        <div class="aud-num">PDV</div>
        <div class="aud-num">DIF</div>
        <div>Status</div>
      </div>
      ${Object.entries(grupos).map(([grupo, itens]) => `
        <div class="aud-grupo-sep">
          <span class="aud-grupo-icon">◆</span> ${grupo}
        </div>
        ${itens.map(r => renderLinhaSorvetesOperacional(r)).join('')}
      `).join('')}
    </div>
  `;

  secao.style.display = 'block';
}

// ========================================================================
// EXPORTAÇÃO PDF
// ========================================================================

function abrirModalPDF() {
  document.getElementById('aud-modal-pdf').classList.add('open');
}
function fecharModalPDF() {
  document.getElementById('aud-modal-pdf').classList.remove('open');
}

function gerarPDF() {
  if (typeof window.jspdf === 'undefined') {
    alert('jsPDF não carregado.');
    return;
  }
  const conteudo = document.querySelector('input[name="aud-pdf-conteudo"]:checked')?.value || 'todos';

  // Filtra produtos conforme a escolha
  let itens = [...resultadoAuditoria];
  if (conteudo === 'divergencias') {
    itens = itens.filter(r => r.status === 'critico' || r.status === 'atencao' || r.status === 'leve');
  }

  if (itens.length === 0) {
    alert('Nenhum produto para exportar nesse filtro.');
    return;
  }

  if (modoAtual === 'operacional') {
    gerarPDFOperacional(itens, conteudo);
  } else {
    gerarPDFVirada(itens, conteudo);
  }

  fecharModalPDF();
}

// ===== PDF MODO OPERACIONAL =====
function gerarPDFOperacional(itens, conteudo) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const { contagemIni, contagemFin, vendas, recebimentos, contagemFinAnterior } = contextoAuditoria;
  const hoje = fmtData(toIso(new Date()));

  const margL = 12;
  const margR = 198;

  // ========== CABEÇALHO ==========
  doc.setFillColor(124, 0, 71);
  doc.rect(0, 0, 210, 26, 'F');

  // Logo no canto esquerdo (se tiver carregada)
  let textStartX = margL + 2;
  if (logoDataURL) {
    try {
      // Logo quadrada de 20x20mm, centralizada verticalmente
      doc.addImage(logoDataURL, 'PNG', margL, 3, 20, 20);
      textStartX = margL + 24;  // desloca o texto pra direita
    } catch (e) {
      console.warn('Erro ao adicionar logo ao PDF:', e);
    }
  }

  doc.setTextColor(255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('PRIMUS PEIXARIA', textStartX, 11);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text('Auditoria de Estoque — Dia operacional', textStartX, 17);
  doc.setFontSize(8);
  doc.text(`Gerado em ${hoje}`, margR - 2, 17, { align: 'right' });

  // ========== PERÍODO E INFO ==========
  let y = 34;
  doc.setTextColor(0);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  const periodoLbl = dataInicio === dataFim
    ? `Data: ${fmtData(dataInicio)}`
    : `Período: ${fmtData(dataInicio)} → ${fmtData(dataFim)}`;
  doc.text(periodoLbl, margL, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(90);
  const infoConteudo = conteudo === 'divergencias' ? 'Só divergências' : 'Todos os produtos';
  doc.text(`${infoConteudo} · ${itens.length} ${itens.length === 1 ? 'item' : 'itens'}`, margR, y, { align: 'right' });
  doc.setTextColor(0);
  y += 8;

  // ========== EQUAÇÃO DE TOTAIS ==========
  const totalIni = resultadoAuditoria.reduce((s, r) => s + r.ini, 0);
  const totalRec = resultadoAuditoria.reduce((s, r) => s + r.recebido, 0);
  const totalVen = resultadoAuditoria.reduce((s, r) => s + r.vendido, 0);
  const totalFin = resultadoAuditoria.reduce((s, r) => s + r.real, 0);
  const totalDif = resultadoAuditoria.reduce((s, r) => s + r.diferenca, 0);

  // Layout: 5 caixinhas de valores + 1 caixa destacada da DIFERENÇA à direita
  // Total largura disponível: margR - margL = 186mm
  // Reservamos 32mm pra DIFERENÇA + 2mm de gap = 34mm
  // Sobra 152mm pra 5 caixinhas = 30.4mm cada
  const boxDifW = 32;
  const gapDif  = 2;
  const areaEqW = (margR - margL) - boxDifW - gapDif;   // 152mm
  const boxW    = areaEqW / 5;                           // 30.4mm cada

  // Fundo da área das 5 caixinhas
  doc.setFillColor(245, 243, 240);
  doc.rect(margL, y, areaEqW, 14, 'F');

  const labels = [
    { lbl: 'INICIAL',    val: fmtInt(totalIni) },
    { lbl: '+ RECEBIDO', val: fmtInt(totalRec) },
    { lbl: '- VENDIDO',  val: fmtInt(totalVen) },
    { lbl: '= ESPERADO', val: fmtInt(totalIni + totalRec - totalVen) },
    { lbl: 'REAL',       val: fmtInt(totalFin) },
  ];

  labels.forEach((item, i) => {
    const cx = margL + i * boxW + boxW / 2;  // centro da caixinha
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(120);
    doc.text(item.lbl, cx, y + 4.5, { align: 'center' });
    doc.setFontSize(12);
    doc.setTextColor(0);
    doc.text(item.val, cx, y + 11, { align: 'center' });
  });

  // Caixa da DIFERENÇA (colorida, à direita)
  const difX = margL + areaEqW + gapDif;
  const corDif = totalDif < 0 ? [181, 69, 27] : totalDif > 0 ? [240, 165, 0] : [46, 125, 50];
  doc.setFillColor(...corDif);
  doc.rect(difX, y, boxDifW, 14, 'F');
  doc.setTextColor(255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.text('DIFERENÇA', difX + boxDifW / 2, y + 4.5, { align: 'center' });
  doc.setFontSize(14);
  doc.text(fmtSgn(totalDif), difX + boxDifW / 2, y + 11, { align: 'center' });
  doc.setTextColor(0);
  y += 18;

  // ========== KPIs DE STATUS ==========
  const criticos = resultadoAuditoria.filter(r => r.status === 'critico').length;
  const atencao  = resultadoAuditoria.filter(r => r.status === 'atencao').length;
  const leves    = resultadoAuditoria.filter(r => r.status === 'leve').length;
  const ok       = resultadoAuditoria.filter(r => r.status === 'ok').length;

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.text(`Status: ${criticos} críticos · ${atencao} atenção · ${leves} leves · ${ok} OK`, margL, y);

  // Diagnóstico resumido (se houver FIN anterior)
  if (contagemFinAnterior) {
    const diagErro = resultadoAuditoria.filter(r => r.diagnostico === 'erro_contagem').length;
    const diagRec  = resultadoAuditoria.filter(r => r.diagnostico === 'recorrente').length;
    const diagIso  = resultadoAuditoria.filter(r => r.diagnostico === 'isolado').length;
    if (diagErro + diagRec + diagIso > 0) {
      y += 5;
      doc.setTextColor(90);
      const partes = [];
      if (diagErro > 0) partes.push(`${diagErro} provável erro de contagem`);
      if (diagRec  > 0) partes.push(`${diagRec} recorrente`);
      if (diagIso  > 0) partes.push(`${diagIso} isolado`);
      doc.text(`Análise D-1 (vs FIN ${fmtData(contagemFinAnterior.data)}): ${partes.join(' · ')}`, margL, y);
      doc.setTextColor(0);
    }
  }
  y += 8;

  // ========== TABELA DE PRODUTOS ==========
  // Colunas
  const colX = {
    produto: margL + 2,
    ini:     98,
    rec:     112,
    ven:     126,
    esp:     140,
    real:    154,
    dif:     170,
    status:  margR - 2
  };

  function desenharCabecalho(yPos) {
    doc.setFillColor(30, 30, 30);
    doc.rect(margL, yPos - 4, margR - margL, 6, 'F');
    doc.setTextColor(255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.text('PRODUTO', colX.produto, yPos);
    doc.text('INI',    colX.ini,    yPos, { align: 'right' });
    doc.text('+REC',   colX.rec,    yPos, { align: 'right' });
    doc.text('-VEN',   colX.ven,    yPos, { align: 'right' });
    doc.text('=ESP',   colX.esp,    yPos, { align: 'right' });
    doc.text('REAL',   colX.real,   yPos, { align: 'right' });
    doc.text('DIF',    colX.dif,    yPos, { align: 'right' });
    doc.text('STATUS', colX.status, yPos, { align: 'right' });
    doc.setTextColor(0);
    return yPos + 3;
  }

  y = desenharCabecalho(y + 4);
  y += 3;

  // Agrupa por grupo
  const ordemStatus = { critico: 0, atencao: 1, leve: 2, ok: 3, semdados: 4 };
  const sorted = [...itens].sort((a, b) => {
    const ds = ordemStatus[a.status] - ordemStatus[b.status];
    if (ds !== 0) return ds;
    return Math.abs(b.diferenca) - Math.abs(a.diferenca);
  });

  const grupos = {};
  sorted.forEach(r => {
    if (!grupos[r.grupo]) grupos[r.grupo] = [];
    grupos[r.grupo].push(r);
  });

  Object.entries(grupos).forEach(([grupo, items]) => {
    // Quebra de página
    if (y > 260) { doc.addPage(); y = 20; y = desenharCabecalho(y + 4); y += 3; }

    // Cabeçalho do grupo
    doc.setFillColor(240, 240, 240);
    doc.rect(margL, y - 3, margR - margL, 5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(90);
    const grupoLimpo = grupo.replace(/[^\w\sÀ-ÿ]/g, '').trim().toUpperCase();
    doc.text(grupoLimpo, colX.produto, y + 0.5);
    doc.setTextColor(0);
    y += 5;

    items.forEach(r => {
      if (y > 275) { doc.addPage(); y = 20; y = desenharCabecalho(y + 4); y += 3; }

      // Linha colorida por status (fundo sutil)
      if (r.status === 'critico') {
        doc.setFillColor(252, 241, 237);
        doc.rect(margL, y - 3.5, margR - margL, 5, 'F');
      } else if (r.status === 'atencao') {
        doc.setFillColor(255, 249, 230);
        doc.rect(margL, y - 3.5, margR - margL, 5, 'F');
      }

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(0);

      const nomeCurto = r.nome.length > 38 ? r.nome.slice(0, 36) + '…' : r.nome;
      doc.text(nomeCurto, colX.produto, y);

      doc.text(fmtInt(r.ini),  colX.ini,  y, { align: 'right' });
      doc.setTextColor(r.recebido > 0 ? 46 : 180, r.recebido > 0 ? 125 : 180, r.recebido > 0 ? 50 : 180);
      doc.text(r.recebido > 0 ? '+' + fmtInt(r.recebido) : '—', colX.rec,  y, { align: 'right' });
      doc.setTextColor(r.vendido > 0 ? 176 : 180, r.vendido > 0 ? 116 : 180, r.vendido > 0 ? 32 : 180);
      doc.text(r.vendido > 0 ? '-' + fmtInt(r.vendido) : '—', colX.ven,  y, { align: 'right' });
      doc.setTextColor(124, 0, 71);
      doc.setFont('helvetica', 'bold');
      doc.text(fmtInt(r.esperado), colX.esp, y, { align: 'right' });
      doc.setTextColor(0);
      doc.text(fmtInt(r.real),  colX.real, y, { align: 'right' });

      // Diferença colorida
      if (r.diferenca < 0) doc.setTextColor(181, 69, 27);
      else if (r.diferenca > 0) doc.setTextColor(240, 165, 0);
      else doc.setTextColor(46, 125, 50);
      doc.text(fmtSgn(r.diferenca), colX.dif, y, { align: 'right' });
      doc.setTextColor(0);

      // Status
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      const statusMap = {
        critico: { txt: 'CRÍTICO', cor: [181, 69, 27] },
        atencao: { txt: 'ATENÇÃO', cor: [176, 116, 32] },
        leve:    { txt: 'LEVE',    cor: [176, 116, 32] },
        ok:      { txt: 'OK',      cor: [46, 125, 50] },
        semdados: { txt: 's/dados', cor: [150, 150, 150] }
      };
      const s = statusMap[r.status];
      doc.setTextColor(...s.cor);
      doc.text(s.txt, colX.status, y, { align: 'right' });
      doc.setTextColor(0);

      // Diagnóstico inline (se houver)
      if (r.diagnostico) {
        y += 3;
        const diagTxt = {
          erro_contagem: `Provavel erro de contagem (D-1 = ${fmtSgn(r.d1)})`,
          recorrente: `Problema recorrente (D-1 = ${fmtSgn(r.d1)})`,
          isolado: `Problema isolado (D-1 = 0)`
        }[r.diagnostico];
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(7);
        doc.setTextColor(90);
        doc.text('↳ ' + diagTxt, colX.produto + 4, y);
        doc.setTextColor(0);
      }

      y += 5;
    });

    y += 1;
  });

  // ========== OBSERVAÇÕES E ASSINATURA ==========
  if (y > 240) { doc.addPage(); y = 20; }
  y += 6;

  doc.setDrawColor(180);
  doc.setLineWidth(0.3);
  doc.line(margL, y, margR, y);
  y += 6;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('Observações:', margL, y);
  y += 4;
  // Linhas em branco pra escrever
  for (let i = 0; i < 4; i++) {
    doc.setDrawColor(200);
    doc.setLineWidth(0.2);
    doc.line(margL, y + 3, margR, y + 3);
    y += 5;
  }

  y += 4;
  // Bloco de assinatura
  doc.setDrawColor(100);
  doc.setLineWidth(0.3);
  doc.line(margL, y + 6, margL + 70, y + 6);
  doc.line(margR - 40, y + 6, margR, y + 6);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(100);
  doc.text('Responsável pela auditoria', margL, y + 10);
  doc.text('Data', margR - 40, y + 10);

  // Rodapé
  doc.setFontSize(7);
  doc.setFont('helvetica', 'italic');
  doc.setTextColor(130);
  doc.text(`Gerado pelo Sistema Primus em ${hoje}`, margL, 290);

  const nomeArq = `auditoria_${dataInicio}_${dataFim}.pdf`;
  doc.save(nomeArq);
}

// ===== PDF MODO VIRADA =====
function gerarPDFVirada(itens, conteudo) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const hoje = fmtData(toIso(new Date()));
  const margL = 12;
  const margR = 198;

  // Cabeçalho
  doc.setFillColor(124, 0, 71);
  doc.rect(0, 0, 210, 26, 'F');

  let textStartX = margL + 2;
  if (logoDataURL) {
    try {
      doc.addImage(logoDataURL, 'PNG', margL, 3, 20, 20);
      textStartX = margL + 24;
    } catch (e) {
      console.warn('Erro ao adicionar logo ao PDF:', e);
    }
  }

  doc.setTextColor(255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('PRIMUS PEIXARIA', textStartX, 11);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text('Auditoria de Estoque — Virada de dia', textStartX, 17);
  doc.setFontSize(8);
  doc.text(`Gerado em ${hoje}`, margR - 2, 17, { align: 'right' });

  let y = 34;
  doc.setTextColor(0);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  const dias = diffDias(dataInicio, dataFim);
  doc.text(`FIN ${fmtData(dataInicio)} → INI ${fmtData(dataFim)}`, margL, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(90);
  const labelDias = dias === 1 ? '1 dia de parada' : `${dias} dias de parada (parada semanal)`;
  const infoConteudo = conteudo === 'divergencias' ? 'Só divergências' : 'Todos os produtos';
  doc.text(`${labelDias} · ${infoConteudo} · ${itens.length} ${itens.length === 1 ? 'item' : 'itens'}`, margR, y, { align: 'right' });
  doc.setTextColor(0);
  y += 8;

  // Equação simplificada (FIN vs INI = DIF)
  const totalFim = resultadoAuditoria.reduce((s, r) => s + r.fimAnterior, 0);
  const totalIni = resultadoAuditoria.reduce((s, r) => s + r.iniAtual, 0);
  const totalDif = resultadoAuditoria.reduce((s, r) => s + r.diferenca, 0);

  // Layout: 2 caixinhas (FIN e INI) + 1 caixa de DIFERENÇA
  const boxDifW = 32;
  const gapDif  = 2;
  const areaEqW = (margR - margL) - boxDifW - gapDif;
  const boxW    = areaEqW / 2;

  doc.setFillColor(245, 243, 240);
  doc.rect(margL, y, areaEqW, 14, 'F');

  // FIN anterior
  let cx = margL + boxW / 2;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(120);
  doc.text(`FIN ${fmtData(dataInicio)}`, cx, y + 4.5, { align: 'center' });
  doc.setFontSize(12);
  doc.setTextColor(0);
  doc.text(fmtInt(totalFim), cx, y + 11, { align: 'center' });

  // INI atual
  cx = margL + boxW + boxW / 2;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(120);
  doc.text(`INI ${fmtData(dataFim)}`, cx, y + 4.5, { align: 'center' });
  doc.setFontSize(12);
  doc.setTextColor(0);
  doc.text(fmtInt(totalIni), cx, y + 11, { align: 'center' });

  // DIFERENÇA (caixa colorida à direita)
  const difX = margL + areaEqW + gapDif;
  const corDif = totalDif < 0 ? [181, 69, 27] : totalDif > 0 ? [240, 165, 0] : [46, 125, 50];
  doc.setFillColor(...corDif);
  doc.rect(difX, y, boxDifW, 14, 'F');
  doc.setTextColor(255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.text('DIFERENÇA', difX + boxDifW / 2, y + 4.5, { align: 'center' });
  doc.setFontSize(14);
  doc.text(fmtSgn(totalDif), difX + boxDifW / 2, y + 11, { align: 'center' });
  doc.setTextColor(0);
  y += 18;

  // Status resumo
  const criticos = resultadoAuditoria.filter(r => r.status === 'critico').length;
  const atencao  = resultadoAuditoria.filter(r => r.status === 'atencao').length;
  const leves    = resultadoAuditoria.filter(r => r.status === 'leve').length;
  const ok       = resultadoAuditoria.filter(r => r.status === 'ok').length;
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.text(`Status: ${criticos} críticos · ${atencao} atenção · ${leves} leves · ${ok} OK`, margL, y);
  y += 8;

  // Tabela
  const colX = {
    produto: margL + 2,
    fimAnt:  120,
    iniAt:   148,
    dif:     170,
    status:  margR - 2
  };

  function desenharCabecalho(yPos) {
    doc.setFillColor(30, 30, 30);
    doc.rect(margL, yPos - 4, margR - margL, 6, 'F');
    doc.setTextColor(255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.text('PRODUTO', colX.produto, yPos);
    doc.text(`FIN ${fmtData(dataInicio)}`, colX.fimAnt, yPos, { align: 'right' });
    doc.text(`INI ${fmtData(dataFim)}`, colX.iniAt, yPos, { align: 'right' });
    doc.text('DIF', colX.dif, yPos, { align: 'right' });
    doc.text('STATUS', colX.status, yPos, { align: 'right' });
    doc.setTextColor(0);
    return yPos + 3;
  }

  y = desenharCabecalho(y + 4);
  y += 3;

  const ordemStatus = { critico: 0, atencao: 1, leve: 2, ok: 3, semdados: 4 };
  const sorted = [...itens].sort((a, b) => {
    const ds = ordemStatus[a.status] - ordemStatus[b.status];
    if (ds !== 0) return ds;
    return Math.abs(b.diferenca) - Math.abs(a.diferenca);
  });

  const grupos = {};
  sorted.forEach(r => {
    if (!grupos[r.grupo]) grupos[r.grupo] = [];
    grupos[r.grupo].push(r);
  });

  Object.entries(grupos).forEach(([grupo, items]) => {
    if (y > 260) { doc.addPage(); y = 20; y = desenharCabecalho(y + 4); y += 3; }

    doc.setFillColor(240, 240, 240);
    doc.rect(margL, y - 3, margR - margL, 5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(90);
    const grupoLimpo = grupo.replace(/[^\w\sÀ-ÿ]/g, '').trim().toUpperCase();
    doc.text(grupoLimpo, colX.produto, y + 0.5);
    doc.setTextColor(0);
    y += 5;

    items.forEach(r => {
      if (y > 275) { doc.addPage(); y = 20; y = desenharCabecalho(y + 4); y += 3; }

      if (r.status === 'critico') {
        doc.setFillColor(252, 241, 237);
        doc.rect(margL, y - 3.5, margR - margL, 5, 'F');
      } else if (r.status === 'atencao') {
        doc.setFillColor(255, 249, 230);
        doc.rect(margL, y - 3.5, margR - margL, 5, 'F');
      }

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(0);

      const nomeCurto = r.nome.length > 40 ? r.nome.slice(0, 38) + '…' : r.nome;
      doc.text(nomeCurto, colX.produto, y);
      doc.text(fmtInt(r.fimAnterior), colX.fimAnt, y, { align: 'right' });
      doc.text(fmtInt(r.iniAtual), colX.iniAt, y, { align: 'right' });

      if (r.diferenca < 0) doc.setTextColor(181, 69, 27);
      else if (r.diferenca > 0) doc.setTextColor(240, 165, 0);
      else doc.setTextColor(46, 125, 50);
      doc.setFont('helvetica', 'bold');
      doc.text(fmtSgn(r.diferenca), colX.dif, y, { align: 'right' });
      doc.setTextColor(0);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      const statusMap = {
        critico: { txt: 'CRÍTICO', cor: [181, 69, 27] },
        atencao: { txt: 'ATENÇÃO', cor: [176, 116, 32] },
        leve:    { txt: 'LEVE',    cor: [176, 116, 32] },
        ok:      { txt: 'OK',      cor: [46, 125, 50] },
        semdados: { txt: 's/dados', cor: [150, 150, 150] }
      };
      const s = statusMap[r.status];
      doc.setTextColor(...s.cor);
      doc.text(s.txt, colX.status, y, { align: 'right' });
      doc.setTextColor(0);

      y += 5;
    });

    y += 1;
  });

  // Observações e assinatura
  if (y > 240) { doc.addPage(); y = 20; }
  y += 6;
  doc.setDrawColor(180);
  doc.setLineWidth(0.3);
  doc.line(margL, y, margR, y);
  y += 6;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('Observações:', margL, y);
  y += 4;
  for (let i = 0; i < 4; i++) {
    doc.setDrawColor(200);
    doc.setLineWidth(0.2);
    doc.line(margL, y + 3, margR, y + 3);
    y += 5;
  }

  y += 4;
  doc.setDrawColor(100);
  doc.setLineWidth(0.3);
  doc.line(margL, y + 6, margL + 70, y + 6);
  doc.line(margR - 40, y + 6, margR, y + 6);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(100);
  doc.text('Responsável pela auditoria', margL, y + 10);
  doc.text('Data', margR - 40, y + 10);

  doc.setFontSize(7);
  doc.setFont('helvetica', 'italic');
  doc.setTextColor(130);
  doc.text(`Gerado pelo Sistema Primus em ${hoje}`, margL, 290);

  const nomeArq = `auditoria_virada_${dataInicio}_${dataFim}.pdf`;
  doc.save(nomeArq);
}

// ========================================================================
// CORREÇÃO DE ERRO DE CONTAGEM (fluxo do D-1)
// ========================================================================

/**
 * Chamado quando o usuário clica em "🔄 Corrigir FIN" num produto com
 * erro de contagem confirmado. Abre modal de confirmação, e se OK,
 * atualiza a FIN do dia anterior pra igualar a INI de hoje.
 */
/**
 * Corrige uma divergência da auditoria de virada ajustando uma das duas
 * contagens envolvidas: a FIN do dia anterior ou a INI do dia atual.
 *
 * Parâmetros:
 *  - slug: identificador do produto
 *  - alvo: 'fin' (corrige FIN do dia anterior) ou 'ini' (corrige INI do dia atual)
 *  - confirmadoAuto: true se o sistema confirmou matematicamente o erro;
 *                    false se o gestor está corrigindo na confiança
 */
window.__aud_corrigirErro = async function(slug, alvo, confirmadoAuto) {
  const item = resultadoAuditoria.find(r => r.slug === slug);
  if (!item) {
    alert('Item não encontrado.');
    return;
  }

  // Decide qual contagem alterar e qual valor aplicar
  const { contagemFinAnterior, contagemIniAtual } = contextoAuditoria;
  let contagemAlvo, valorAtual, valorNovo, dataAlvoLabel, descricao;

  if (alvo === 'fin') {
    if (!contagemFinAnterior) {
      alert('Contagem FIN do dia anterior não disponível.');
      return;
    }
    contagemAlvo = contagemFinAnterior;
    valorAtual = item.fimAnterior;
    valorNovo  = item.iniAtual;
    dataAlvoLabel = fmtData(dataInicio);
    descricao = `FIN de ${fmtData(dataInicio)}: ${valorAtual} → ${valorNovo}`;
  } else if (alvo === 'ini') {
    if (!contagemIniAtual) {
      alert('Contagem INI do dia atual não disponível.');
      return;
    }
    contagemAlvo = contagemIniAtual;
    valorAtual = item.iniAtual;
    valorNovo  = item.fimAnterior;
    dataAlvoLabel = fmtData(dataFim);
    descricao = `INI de ${fmtData(dataFim)}: ${valorAtual} → ${valorNovo}`;
  } else {
    alert('Alvo inválido (use "fin" ou "ini").');
    return;
  }

  // Mostra modal de confirmação
  const aviso = confirmadoAuto
    ? '✅ Esta correção tem alta confiança (matemática D-1 confirmou erro de contagem).'
    : '⚠️  ATENÇÃO: você está corrigindo SEM confirmação automática.\n' +
      'Isso pode mascarar um sumiço/quebra real. Tem certeza?';

  const confirmado = confirm(
    `🔄 CORRIGIR CONTAGEM\n\n` +
    `Produto: ${item.nome}\n` +
    `Alvo: ${alvo === 'fin' ? 'FIN do dia anterior' : 'INI do dia atual'}\n` +
    `Data: ${dataAlvoLabel}\n\n` +
    `Valor atual: ${valorAtual}\n` +
    `Novo valor: ${valorNovo}\n\n` +
    `${aviso}\n\n` +
    `A correção fica registrada no histórico. Confirmar?`
  );

  if (!confirmado) return;

  try {
    // Copia os itens atuais da contagem e atualiza só o item alvo
    const novosItens = { ...contagemAlvo.itens };
    const chaveAtual = Object.keys(novosItens).find(k =>
      k === slug || k.startsWith(`${slug}__`)
    );

    if (!chaveAtual) {
      alert('Estrutura da contagem não reconhecida. Contate o administrador.');
      return;
    }

    // Atualiza o valor do item
    // Estruturas possíveis na contagem:
    //   - FIN de bebidas (sem sufixo): { fr, est, total }
    //   - INI de bebidas (sem sufixo): { fr, est, total }
    //   - FIN de sorvetes (sufixo __fin): { final, abast, vendeu }
    //   - INI de sorvetes (sufixo __ini): { qtd }
    const valorObj = novosItens[chaveAtual];
    if (valorObj && typeof valorObj === 'object') {
      if (chaveAtual.endsWith('__fin') && 'final' in valorObj) {
        // FIN de sorvetes
        valorObj.final = valorNovo;
      } else if (chaveAtual.endsWith('__ini') && 'qtd' in valorObj) {
        // INI de sorvetes
        valorObj.qtd = valorNovo;
      } else if ('fr' in valorObj || 'est' in valorObj || 'total' in valorObj) {
        // Bebidas (INI ou FIN)
        valorObj.fr = valorNovo;
        valorObj.est = 0;
        valorObj.total = valorNovo;
      } else {
        alert('Formato da contagem não reconhecido.');
        return;
      }
    } else {
      novosItens[chaveAtual] = valorNovo;
    }

    // Grava a correção
    const sessao = getSessao();
    const motivoBase = confirmadoAuto
      ? `Correção via D-1 confirmada: ${descricao}`
      : `Correção manual (sem confirmação D-1): ${descricao}`;
    await corrigirItemContagem(contagemAlvo.id, novosItens, {
      responsavel: sessao?.nome || 'Gestor',
      motivo: motivoBase,
      itemSlug: slug,
      valorAntigo: valorAtual,
      valorNovo: valorNovo
    });

    alert(`✅ Correção aplicada!\n\n${descricao}\n\nRecalculando auditoria...`);

    // Re-executa a auditoria pra atualizar a tela
    await executarAuditoria();

  } catch (e) {
    console.error(e);
    alert(`❌ Erro ao corrigir: ${e.message}`);
  }
};

/**
 * Toggle do botão "expandir" (mostra/esconde os 2 botões de correção sem confirmação).
 * Usado quando o gestor quer corrigir sem ter confirmação automática.
 */
window.__aud_toggleCorrigirManual = function(slug) {
  const box = document.getElementById(`aud-corr-manual-${slug}`);
  const btn = document.getElementById(`aud-btn-toggle-${slug}`);
  if (!box) return;
  const aberto = box.style.display !== 'none';
  box.style.display = aberto ? 'none' : 'block';
  if (btn) btn.textContent = aberto ? '💡 Quero corrigir mesmo assim' : '✕ Cancelar';
};

/**
 * Toggle do box de correção da TELA OPERACIONAL.
 * Aparece quando o sistema diagnostica "erro_contagem" (D-1 vs DIF opostos).
 */
window.__aud_toggleCorrigirManualOp = function(slug) {
  const box = document.getElementById(`aud-corr-manual-op-${slug}`);
  const btn = document.getElementById(`aud-btn-toggle-op-${slug}`);
  if (!box) return;
  const aberto = box.style.display !== 'none';
  box.style.display = aberto ? 'none' : 'block';
  if (btn) btn.textContent = aberto ? '💡 Aceitar sugestão e corrigir' : '✕ Cancelar';
};

/**
 * Corrige uma das contagens do DIA OPERACIONAL atual (modo operacional).
 * Diferente do __aud_corrigirErro (que mexe na FIN do dia anterior ou INI atual,
 * mais usado pela virada), este aqui mexe nas contagens do PRÓPRIO DIA da
 * auditoria operacional.
 *
 * Parâmetros:
 *  - slug: identificador do produto
 *  - alvo: 'ini' (corrige INI deste dia, alinha com FIN do dia anterior)
 *           'fin' (corrige FIN deste dia, zera a divergência)
 */
window.__aud_corrigirOpErro = async function(slug, alvo) {
  const item = resultadoAuditoria.find(r => r.slug === slug);
  if (!item) {
    alert('Item não encontrado.');
    return;
  }

  if (modoAtual !== 'operacional') {
    alert('Esta correção só é válida no modo operacional.');
    return;
  }

  const { contagemIni, contagemFin } = contextoAuditoria;
  let contagemAlvo, valorAtual, valorNovo, dataAlvoLabel, descricao;

  if (alvo === 'ini') {
    if (!contagemIni) {
      alert('Contagem INI não disponível.');
      return;
    }
    // Alinha INI com FIN do dia anterior: novoIni = ini - d1
    valorAtual = item.ini;
    valorNovo  = item.ini - (item.d1 || 0);
    contagemAlvo = contagemIni;
    dataAlvoLabel = fmtData(dataInicio);
    descricao = `INI de ${fmtData(dataInicio)}: ${valorAtual} → ${valorNovo}`;
  } else if (alvo === 'fin') {
    if (!contagemFin) {
      alert('Contagem FIN não disponível.');
      return;
    }
    // Zera a divergência: novoFin = fin - dif
    valorAtual = item.real;
    valorNovo  = item.real - item.diferenca;
    contagemAlvo = contagemFin;
    dataAlvoLabel = fmtData(dataFim);
    descricao = `FIN de ${fmtData(dataFim)}: ${valorAtual} → ${valorNovo}`;
  } else {
    alert('Alvo inválido (use "ini" ou "fin").');
    return;
  }

  // Confirmação
  const confirmado = confirm(
    `🔄 CORRIGIR CONTAGEM\n\n` +
    `Produto: ${item.nome}\n` +
    `Alvo: ${alvo === 'ini' ? 'INI deste dia' : 'FIN deste dia'}\n` +
    `Data: ${dataAlvoLabel}\n\n` +
    `Valor atual: ${valorAtual}\n` +
    `Novo valor: ${valorNovo}\n\n` +
    `📊 Análise: D-1 = ${fmtSgn(item.d1)} / DIF = ${fmtSgn(item.diferenca)}\n` +
    `${alvo === 'ini'
        ? '✅ Esta opção (INI) resolve a divergência E elimina o D-1.'
        : '⚠️ Esta opção (FIN) zera a DIF mas o D-1 permanece.'}\n\n` +
    `A correção fica registrada no histórico. Confirmar?`
  );

  if (!confirmado) return;

  try {
    // Copia os itens atuais da contagem e atualiza só o item alvo
    const novosItens = { ...contagemAlvo.itens };
    const chaveAtual = Object.keys(novosItens).find(k =>
      k === slug || k.startsWith(`${slug}__`)
    );

    if (!chaveAtual) {
      alert('Estrutura da contagem não reconhecida. Contate o administrador.');
      return;
    }

    // Atualiza o valor do item (mesma lógica de __aud_corrigirErro)
    const valorObj = novosItens[chaveAtual];
    if (valorObj && typeof valorObj === 'object') {
      if (chaveAtual.endsWith('__fin') && 'final' in valorObj) {
        valorObj.final = valorNovo;
      } else if (chaveAtual.endsWith('__ini') && 'qtd' in valorObj) {
        valorObj.qtd = valorNovo;
      } else if ('fr' in valorObj || 'est' in valorObj || 'total' in valorObj) {
        valorObj.fr = valorNovo;
        valorObj.est = 0;
        valorObj.total = valorNovo;
      } else {
        alert('Formato da contagem não reconhecido.');
        return;
      }
    } else {
      novosItens[chaveAtual] = valorNovo;
    }

    // Grava a correção
    const sessao = getSessao();
    const motivo = `Correção operacional via D-1: ${descricao}`;
    await corrigirItemContagem(contagemAlvo.id, novosItens, {
      responsavel: sessao?.nome || 'Gestor',
      motivo,
      itemSlug: slug,
      valorAntigo: valorAtual,
      valorNovo: valorNovo
    });

    alert(`✅ Correção aplicada!\n\n${descricao}\n\nRecalculando auditoria...`);

    // Re-executa a auditoria pra atualizar a tela
    await executarAuditoria();

  } catch (e) {
    console.error(e);
    alert(`❌ Erro ao corrigir: ${e.message}`);
  }
};

// ========================================================================
// EDIÇÃO MANUAL DE CONTAGENS (INI / REC / FIN)
// ========================================================================
//
// Permite editar item por item os valores que entram na auditoria operacional.
// Casos de uso: recebimento duplicado, valor digitado errado, ajuste pontual.
// IMPORTANTE: edição altera as contagens originais salvas. Cada operação
// é registrada com motivo (auditoria interna no Firebase).

let _edicaoEmAndamento = null;  // { slug, valoresOriginais }

window.__aud_abrirEdicao = function(slug) {
  const item = resultadoAuditoria.find(r => r.slug === slug);
  if (!item) {
    alert('Item não encontrado.');
    return;
  }
  if (modoAtual !== 'operacional') {
    alert('A edição de valores está disponível apenas no modo operacional.');
    return;
  }

  _edicaoEmAndamento = {
    slug,
    valoresOriginais: {
      ini: item.ini || 0,
      recebido: item.recebido || 0,
      vendido: item.vendido || 0,  // somente leitura no modal (vem do PDV)
      real: item.real || 0
    }
  };

  // Preenche o modal
  document.getElementById('aud-editar-produto-nome').textContent =
    `${item.nome} · ${fmtData(dataInicio)}`;
  document.getElementById('aud-edit-ini').value  = item.ini || 0;
  document.getElementById('aud-edit-rec').value  = item.recebido || 0;
  document.getElementById('aud-edit-fin').value  = item.real || 0;

  document.getElementById('aud-edit-ini-orig').textContent = `original: ${item.ini || 0}`;
  document.getElementById('aud-edit-rec-orig').textContent = `original: ${item.recebido || 0}`;
  document.getElementById('aud-edit-fin-orig').textContent = `original: ${item.real || 0}`;

  document.getElementById('aud-edit-motivo').value = '';

  atualizarPreviewEdicao();

  document.getElementById('aud-modal-editar').classList.add('open');
};

function fecharModalEditar() {
  document.getElementById('aud-modal-editar').classList.remove('open');
  _edicaoEmAndamento = null;
}

/**
 * Recalcula o preview ao vivo conforme o usuário muda os valores no modal.
 * Mostra ESP, REAL e DIF antes vs depois.
 */
function atualizarPreviewEdicao() {
  if (!_edicaoEmAndamento) return;
  const { valoresOriginais } = _edicaoEmAndamento;

  const ini = parseInt(document.getElementById('aud-edit-ini').value, 10) || 0;
  const rec = parseInt(document.getElementById('aud-edit-rec').value, 10) || 0;
  const fin = parseInt(document.getElementById('aud-edit-fin').value, 10) || 0;
  const vendido = valoresOriginais.vendido || 0;

  // Cálculos antes
  const espAntes = (valoresOriginais.ini || 0) + (valoresOriginais.recebido || 0) - vendido;
  const difAntes = (valoresOriginais.real || 0) - espAntes;

  // Cálculos depois
  const espDepois = ini + rec - vendido;
  const difDepois = fin - espDepois;

  const corDif = (d) => {
    if (d === 0) return 'aud-dif-zero';
    return d < 0 ? 'aud-dif-neg' : 'aud-dif-pos';
  };

  document.getElementById('aud-edit-preview').innerHTML = `
    <div class="aud-edit-preview-titulo">📊 Preview do recálculo</div>
    <div class="aud-edit-preview-tabela">
      <div class="aud-edit-preview-linha aud-edit-preview-cab">
        <span></span>
        <span>Antes</span>
        <span>→</span>
        <span>Depois</span>
      </div>
      <div class="aud-edit-preview-linha">
        <span>VEN (PDV)</span>
        <span>${fmtInt(vendido)}</span>
        <span>=</span>
        <span>${fmtInt(vendido)} <small>(não muda)</small></span>
      </div>
      <div class="aud-edit-preview-linha">
        <span>ESP</span>
        <span>${fmtInt(espAntes)}</span>
        <span>→</span>
        <span><strong>${fmtInt(espDepois)}</strong></span>
      </div>
      <div class="aud-edit-preview-linha">
        <span>REAL</span>
        <span>${fmtInt(valoresOriginais.real || 0)}</span>
        <span>→</span>
        <span><strong>${fmtInt(fin)}</strong></span>
      </div>
      <div class="aud-edit-preview-linha aud-edit-preview-dif">
        <span>DIF</span>
        <span class="${corDif(difAntes)}">${fmtSgn(difAntes)}</span>
        <span>→</span>
        <span class="${corDif(difDepois)}"><strong>${fmtSgn(difDepois)}</strong></span>
      </div>
    </div>
  `;
}

async function confirmarEdicao() {
  if (!_edicaoEmAndamento) {
    alert('Edição não inicializada.');
    return;
  }

  const slug = _edicaoEmAndamento.slug;
  const item = resultadoAuditoria.find(r => r.slug === slug);
  if (!item) {
    alert('Item não encontrado.');
    return;
  }

  const ini = parseInt(document.getElementById('aud-edit-ini').value, 10);
  const rec = parseInt(document.getElementById('aud-edit-rec').value, 10);
  const fin = parseInt(document.getElementById('aud-edit-fin').value, 10);
  const motivo = document.getElementById('aud-edit-motivo').value.trim();

  // Validações
  if (isNaN(ini) || isNaN(rec) || isNaN(fin)) {
    alert('Todos os campos devem ser números válidos.');
    return;
  }
  if (ini < 0 || rec < 0 || fin < 0) {
    alert('Valores não podem ser negativos.');
    return;
  }
  if (!motivo) {
    alert('O motivo da edição é obrigatório.');
    document.getElementById('aud-edit-motivo').focus();
    return;
  }

  const { contagemIni, contagemFin } = contextoAuditoria;
  if (!contagemIni || !contagemFin) {
    alert('Contagens INI/FIN não disponíveis no contexto. Recarregue a auditoria.');
    return;
  }

  const valOriginais = _edicaoEmAndamento.valoresOriginais;
  const mudouIni = ini !== valOriginais.ini;
  const mudouRec = rec !== valOriginais.recebido;
  const mudouFin = fin !== valOriginais.real;

  if (!mudouIni && !mudouRec && !mudouFin) {
    alert('Nenhum valor foi alterado.');
    return;
  }

  // Confirmação final
  const partes = [];
  if (mudouIni) partes.push(`INI: ${valOriginais.ini} → ${ini}`);
  if (mudouRec) partes.push(`REC: ${valOriginais.recebido} → ${rec}`);
  if (mudouFin) partes.push(`FIN: ${valOriginais.real} → ${fin}`);

  const confirmado = confirm(
    `💾 SALVAR EDIÇÃO\n\n` +
    `Produto: ${item.nome}\n` +
    `Data: ${fmtData(dataInicio)}\n\n` +
    `Mudanças:\n  • ${partes.join('\n  • ')}\n\n` +
    `Motivo: ${motivo}\n\n` +
    `Confirmar?`
  );
  if (!confirmado) return;

  try {
    const sessao = getSessao();
    const sessaoNome = sessao?.nome || 'Gestor';

    // 1) Edita INI (se mudou)
    if (mudouIni) {
      await aplicarEdicaoContagem(contagemIni, slug, ini,
        `Edição manual: INI ${valOriginais.ini} → ${ini}. Motivo: ${motivo}`,
        sessaoNome, valOriginais.ini);
    }

    // 2) Edita FIN (se mudou)
    if (mudouFin) {
      await aplicarEdicaoContagem(contagemFin, slug, fin,
        `Edição manual: FIN ${valOriginais.real} → ${fin}. Motivo: ${motivo}`,
        sessaoNome, valOriginais.real);
    }

    // 3) Edita REC (se mudou) — caso especial: REC vem de "recebimentos",
    // não de contagem. Estratégia: deletar todos os recebimentos atuais do
    // produto no período e criar UM novo com o valor desejado (se > 0).
    if (mudouRec) {
      await aplicarEdicaoRecebimento(slug, item.nome, rec, motivo, sessaoNome);
    }

    alert(`✅ Edição salva!\n\nRecalculando auditoria...`);
    fecharModalEditar();
    await executarAuditoria();

  } catch (e) {
    console.error(e);
    alert(`❌ Erro ao salvar edição: ${e.message}`);
  }
}

/**
 * Aplica edição num documento de contagem (INI ou FIN).
 * Atualiza a chave do slug com o novo valor preservando a estrutura
 * (compatível com bebidas { fr, est, total } e sorvetes { qtd } / { final, abast, vendeu }).
 */
async function aplicarEdicaoContagem(contagem, slug, novoValor, motivo, responsavel, valorAntigo) {
  const novosItens = { ...contagem.itens };
  const chaveAtual = Object.keys(novosItens).find(k =>
    k === slug || k.startsWith(`${slug}__`)
  );

  if (!chaveAtual) {
    // Item não existia na contagem ainda — cria estrutura padrão de bebidas
    novosItens[slug] = { fr: novoValor, est: 0, total: novoValor };
  } else {
    const valorObj = novosItens[chaveAtual];
    if (valorObj && typeof valorObj === 'object') {
      if (chaveAtual.endsWith('__fin') && 'final' in valorObj) {
        valorObj.final = novoValor;
      } else if (chaveAtual.endsWith('__ini') && 'qtd' in valorObj) {
        valorObj.qtd = novoValor;
      } else if ('fr' in valorObj || 'est' in valorObj || 'total' in valorObj) {
        valorObj.fr = novoValor;
        valorObj.est = 0;
        valorObj.total = novoValor;
      } else {
        throw new Error('Formato da contagem não reconhecido.');
      }
    } else {
      novosItens[chaveAtual] = novoValor;
    }
  }

  await corrigirItemContagem(contagem.id, novosItens, {
    responsavel, motivo, itemSlug: slug,
    valorAntigo, valorNovo: novoValor
  });
}

/**
 * Aplica edição de recebimentos do produto.
 *
 * O REC tem 2 fontes possíveis no sistema:
 *   1) Coleção "recebimentos" (cada doc é uma entrega registrada via Lista de Compras)
 *   2) Campo "rec" dentro do objeto do produto na contagem FIN (registrado direto pelo barman)
 *
 * Estratégia: ZERAR ambas as fontes, e depois (se novoValor > 0) criar um único
 * recebimento na coleção com o valor desejado. Assim o REC efetivo fica = novoValor.
 */
async function aplicarEdicaoRecebimento(slug, nomeProduto, novoValor, motivo, responsavel) {
  const { contagemFin } = contextoAuditoria;

  // 1) Zera o campo "rec" dentro da contagem FIN (caso o barman tenha
  //    registrado lá direto)
  if (contagemFin?.itens) {
    const novosItens = { ...contagemFin.itens };
    let mudou = false;
    Object.entries(novosItens).forEach(([chave, v]) => {
      if (chave === slug && typeof v === 'object' && v !== null && (v.rec || 0) > 0) {
        v.rec = 0;
        mudou = true;
      }
    });
    if (mudou) {
      await corrigirItemContagem(contagemFin.id, novosItens, {
        responsavel,
        motivo: `Edição de REC: zerou campo rec da contagem FIN. Motivo: ${motivo}`,
        itemSlug: slug,
        valorAntigo: null,
        valorNovo: 0
      });
    }
  }

  // 2) Apaga todos os recebimentos da coleção "recebimentos" no período
  const recebimentos = await listarRecebimentos(dataInicio, dataFim);
  for (const r of recebimentos) {
    const temItem = (r.itens || []).some(i => i.slug === slug);
    if (!temItem) continue;
    // Se o doc só tem este produto, deleta o doc inteiro
    if (r.itens.length === 1 && r.itens[0].slug === slug) {
      await excluirRecebimento(r.id);
    } else {
      // Se tem outros produtos, deletar todo o doc seria perigoso (perderia
      // os outros). Por enquanto, alertamos e seguimos — gestor deve resolver
      // pela Lista de Compras nesse caso raro.
      console.warn(`Recebimento ${r.id} tem múltiplos produtos. Edição manual necessária na Lista de Compras.`);
    }
  }

  // 3) Cria um novo recebimento com o valor desejado (se > 0)
  if (novoValor > 0) {
    await registrarRecebimento({
      data: dataInicio,
      fornecedor: '— Edição manual via auditoria —',
      itens: [{
        slug,
        nome: nomeProduto,
        qtd: novoValor
      }]
    });
  }
}

// ========================================================================
// FECHAMENTO DE AUDITORIA
// ========================================================================

function abrirModalFechar() {
  if (!resultadoAuditoria || resultadoAuditoria.length === 0) {
    alert('Execute a auditoria primeiro.');
    return;
  }

  // Resumo rápido no modal
  const resumoEl = document.getElementById('aud-fechar-resumo');
  const criticos = resultadoAuditoria.filter(r => r.status === 'critico').length;
  const atencao  = resultadoAuditoria.filter(r => r.status === 'atencao').length;
  const leves    = resultadoAuditoria.filter(r => r.status === 'leve').length;

  const periodoLbl = dataInicio === dataFim
    ? fmtData(dataInicio)
    : `${fmtData(dataInicio)} → ${fmtData(dataFim)}`;

  const modoLbl = modoAtual === 'operacional' ? '📊 Dia operacional' : '🌙 Virada de dia';

  resumoEl.innerHTML = `
    <div><strong>${modoLbl}</strong></div>
    <div>Período: <strong>${periodoLbl}</strong></div>
    <div style="margin-top:6px">
      <span class="badge-critico">${criticos} crítico(s)</span>
      <span class="badge-atencao">${atencao} atenção</span>
      <span class="badge-leve">${leves} leve(s)</span>
    </div>
  `;

  // Pré-preenche se já existe (atualizando fechamento anterior)
  const obsEl = document.getElementById('aud-fechar-obs');
  const respEl = document.getElementById('aud-fechar-resp');
  if (auditoriaFechadaAtual) {
    obsEl.value  = auditoriaFechadaAtual.observacoes  || '';
    respEl.value = auditoriaFechadaAtual.responsavel || '';
  } else {
    obsEl.value  = '';
    try {
      const sessao = getSessao();
      respEl.value = sessao?.nome || '';
    } catch { respEl.value = ''; }
  }

  document.getElementById('aud-modal-fechar').classList.add('open');
}

function fecharModalFechar() {
  document.getElementById('aud-modal-fechar').classList.remove('open');
}

async function confirmarFechamento() {
  const obs  = document.getElementById('aud-fechar-obs').value.trim();
  const resp = document.getElementById('aud-fechar-resp').value.trim();

  if (!resp) {
    alert('Informe o nome do responsável.');
    return;
  }

  const btn = document.getElementById('aud-fechar-confirmar');
  const txtOriginal = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Salvando...';

  try {
    const sessao = getSessao();
    const dados = {
      modo: modoAtual,
      dataInicio,
      dataFim,
      resultado: resultadoAuditoria.map(r => ({
        slug: r.slug,
        nome: r.nome,
        grupo: r.grupo,
        status: r.status,
        diagnostico: r.diagnostico || null,
        ...(modoAtual === 'operacional'
          ? { ini: r.ini, recebido: r.recebido, vendido: r.vendido, esperado: r.esperado, real: r.real, diferenca: r.diferenca, d1: r.d1 ?? null }
          : { fimAnterior: r.fimAnterior, iniAtual: r.iniAtual, diferenca: r.diferenca }
        )
      })),
      // Snapshot de sorvetes (se houver) — pra histórico preservar tudo
      resultadoSorvetes: (modoAtual === 'operacional' ? resultadoSorvetes : resultadoSorvetesVirada).map(r => ({
        slug: r.slug,
        nome: r.nome,
        grupo: r.grupo,
        status: r.status,
        ...(modoAtual === 'operacional'
          ? { ini: r.ini, abast: r.abast, fin: r.fin, vendeuCalc: r.vendeuCalc, vendeuPDV: r.vendeuPDV, diferenca: r.diferenca }
          : { fimAnterior: r.fimAnterior, iniAtual: r.iniAtual, diferenca: r.diferenca }
        )
      })),
      totais: calcularTotaisResumo(),
      observacoes: obs,
      responsavel: resp,
      fechadoPor: sessao ? { id: sessao.id, nome: sessao.nome } : { id: '', nome: resp }
    };

    await salvarAuditoriaFechada(dados);

    auditoriaFechadaAtual = dados;
    renderizarBannerFechamento();

    btn.innerHTML = '✓ Salvo!';
    setTimeout(() => {
      fecharModalFechar();
      btn.innerHTML = txtOriginal;
      btn.disabled = false;
    }, 1200);

  } catch (e) {
    console.error(e);
    alert('Erro ao salvar: ' + e.message);
    btn.innerHTML = txtOriginal;
    btn.disabled = false;
  }
}

function calcularTotaisResumo() {
  const r = resultadoAuditoria;
  const criticos = r.filter(x => x.status === 'critico').length;
  const atencao  = r.filter(x => x.status === 'atencao').length;
  const leves    = r.filter(x => x.status === 'leve').length;
  const ok       = r.filter(x => x.status === 'ok').length;
  const totalDif = r.reduce((s, x) => s + (x.diferenca || 0), 0);
  return { criticos, atencao, leves, ok, totalDivergencia: totalDif };
}

// ========================================================================
// HISTÓRICO
// ========================================================================

async function carregarHistorico() {
  const container = document.getElementById('hist-container');
  const sub = document.getElementById('hist-sub');

  container.innerHTML = `
    <div style="text-align:center;padding:40px">
      <span class="spinner"></span>
      <div style="margin-top:10px;color:var(--cinza-texto);font-size:13px">Carregando auditorias fechadas...</div>
    </div>
  `;

  try {
    const auditorias = await listarAuditoriasFechadas();

    if (auditorias.length === 0) {
      sub.textContent = 'Nenhuma auditoria fechada ainda';
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🔒</div>
          <h3>Nenhuma auditoria fechada ainda</h3>
          <p>Quando você <strong>fechar uma auditoria</strong>, ela aparece aqui com ranking, gráficos e calendário.</p>
          <p style="font-size:12px;color:var(--cinza-texto);margin-top:10px">
            Pra fechar: rode uma auditoria na aba <strong>Atual</strong> e clique em <strong>🔒 Fechar auditoria</strong>.
          </p>
        </div>
      `;
      return;
    }

    sub.textContent = `${auditorias.length} ${auditorias.length === 1 ? 'auditoria fechada' : 'auditorias fechadas'}`;
    renderizarDashboardHistorico(auditorias);
  } catch (e) {
    console.error(e);
    container.innerHTML = `<div class="preview-err">Erro ao carregar: ${e.message}</div>`;
  }
}

function renderizarDashboardHistorico(auditorias) {
  const container = document.getElementById('hist-container');

  container.innerHTML = `
    <div id="hist-ranking-secao"></div>

    <div class="hist-legenda">
      <div class="hist-legenda-titulo">Entendendo os status:</div>
      <div class="hist-legenda-items">
        <div class="hist-legenda-item">
          <span class="hist-legenda-bolinha hist-s-c"></span>
          <div>
            <strong>Críticos</strong>
            <small>Divergência ≥ 5 unidades — investigar urgente</small>
          </div>
        </div>
        <div class="hist-legenda-item">
          <span class="hist-legenda-bolinha hist-s-a"></span>
          <div>
            <strong>Atenção</strong>
            <small>Divergência de 2 a 4 unidades — monitorar</small>
          </div>
        </div>
        <div class="hist-legenda-item">
          <span class="hist-legenda-bolinha hist-s-l"></span>
          <div>
            <strong>Leves</strong>
            <small>Divergência de 1 unidade — margem aceitável</small>
          </div>
        </div>
        <div class="hist-legenda-item">
          <span class="hist-legenda-bolinha hist-s-o"></span>
          <div>
            <strong>OK</strong>
            <small>Sem divergência — tudo batendo</small>
          </div>
        </div>
      </div>
    </div>

    <div class="hist-lista">
      ${auditorias.map(a => renderLinhaHistorico(a)).join('')}
    </div>
  `;

  // Renderiza o ranking com período padrão de 30 dias
  renderizarRankingProdutos(auditorias, 30);
}

// ===== RANKING DE PRODUTOS MAIS PROBLEMÁTICOS =====
// Combina 3 critérios (frequência, magnitude média, pior caso) num score
// ponderado 40/35/25 e mostra Top 10 expansíveis.
//
// Considera apenas auditorias OPERACIONAIS fechadas (a virada compara
// FIN vs INI sem vendas, então diferença ali é outro tipo de problema —
// caberia outro ranking se útil no futuro).
//
// Status considerados: CRITICO + ATENCAO (DIF >= 2 un).

function renderizarRankingProdutos(todasAuditorias, periodoDias) {
  const secao = document.getElementById('hist-ranking-secao');
  if (!secao) return;

  // 1. Filtra auditorias operacionais pelo período
  const auditoriasOp = todasAuditorias.filter(a => a.modo === 'operacional');

  let auditoriasFiltradas;
  if (periodoDias === 'todos') {
    auditoriasFiltradas = auditoriasOp;
  } else {
    const hoje = new Date();
    const corte = new Date(hoje);
    corte.setDate(corte.getDate() - periodoDias);
    const corteISO = corte.toISOString().slice(0, 10);
    auditoriasFiltradas = auditoriasOp.filter(a => (a.dataFim || a.dataInicio) >= corteISO);
  }

  // 2. Agrega por produto
  const produtos = calcularAgregadoProdutos(auditoriasFiltradas);

  // 3. Calcula score com pesos 40/35/25
  const ranking = calcularScoreProdutos(produtos);

  // 4. Filtra Top 10
  const top10 = ranking.slice(0, 10);

  // 5. Renderiza
  const toggleHtml = `
    <div class="hist-rank-toggle">
      ${[7, 30, 90, 'todos'].map(p => {
        const lbl = p === 'todos' ? 'Todos' : `${p} dias`;
        const cls = p === periodoDias ? 'active' : '';
        return `<button class="hist-rank-btn ${cls}" data-periodo="${p}">${lbl}</button>`;
      }).join('')}
    </div>
  `;

  let conteudo;
  if (auditoriasFiltradas.length === 0) {
    conteudo = `
      <div class="hist-rank-vazio">
        <span>📊</span>
        <p>Nenhuma auditoria operacional fechada nesse período.</p>
        <small>Tente um período maior, ou feche mais auditorias.</small>
      </div>
    `;
  } else if (top10.length === 0) {
    conteudo = `
      <div class="hist-rank-vazio">
        <span>🎉</span>
        <p>Nenhum produto com divergência relevante!</p>
        <small>${auditoriasFiltradas.length} auditoria(s) analisada(s) — todos os produtos batendo (DIF &lt; 2 un).</small>
      </div>
    `;
  } else {
    conteudo = `
      <div class="hist-rank-explicacao">
        <strong>Score de problematicidade</strong> ·
        combina <em>frequência</em> (40%) + <em>magnitude média</em> (35%) + <em>pior caso</em> (25%).
        <br><small>Clique num produto pra ver o histórico de auditorias onde ele apareceu.</small>
      </div>
      <div class="hist-rank-lista">
        ${top10.map((p, i) => renderLinhaRanking(p, i + 1)).join('')}
      </div>
    `;
  }

  secao.innerHTML = `
    <div class="hist-rank-secao">
      <div class="hist-rank-cabecalho">
        <h3>🏆 Produtos mais problemáticos</h3>
        ${toggleHtml}
      </div>
      ${conteudo}
    </div>
  `;

  // Listeners do toggle de período
  secao.querySelectorAll('.hist-rank-btn').forEach(btn => {
    btn.onclick = () => {
      const p = btn.dataset.periodo;
      const periodo = p === 'todos' ? 'todos' : parseInt(p, 10);
      renderizarRankingProdutos(todasAuditorias, periodo);
    };
  });
}

/**
 * Agrega ocorrências de cada produto em todas as auditorias.
 * Retorna { slug: { nome, ocorrencias, ocorrenciasProblema, diferencas[], piorCaso, historico[] } }
 */
function calcularAgregadoProdutos(auditorias) {
  const produtos = {};

  auditorias.forEach(a => {
    (a.resultado || []).forEach(r => {
      if (!produtos[r.slug]) {
        produtos[r.slug] = {
          slug: r.slug,
          nome: r.nome,
          grupo: r.grupo,
          ocorrencias: 0,
          ocorrenciasProblema: 0,
          diferencasProblema: [],   // |DIF| nas auditorias com problema
          piorCaso: 0,
          historico: []             // pra detalhe expansível
        };
      }
      const p = produtos[r.slug];
      p.ocorrencias++;

      const dif = Math.abs(r.diferenca || 0);
      const temProblema = r.status === 'critico' || r.status === 'atencao';

      if (temProblema) {
        p.ocorrenciasProblema++;
        p.diferencasProblema.push(dif);
      }
      if (dif > p.piorCaso) p.piorCaso = dif;

      p.historico.push({
        dataInicio: a.dataInicio,
        dataFim: a.dataFim,
        status: r.status,
        diferenca: r.diferenca,
        ini: r.ini,
        recebido: r.recebido,
        vendido: r.vendido,
        real: r.real
      });
    });
  });

  return produtos;
}

/**
 * Calcula score ponderado dos produtos.
 * Considera só produtos com pelo menos 1 ocorrência com problema (CRITICO ou ATENCAO).
 *
 * Score = 0.40 × freqNorm + 0.35 × magNorm + 0.25 × piorNorm
 *
 * Cada métrica é normalizada (dividida pelo maior valor entre todos os produtos)
 * pra que tenham mesma escala (0 a 1).
 */
function calcularScoreProdutos(produtosMap) {
  // Filtra só os que tiveram problema pelo menos 1 vez
  const candidatos = Object.values(produtosMap).filter(p => p.ocorrenciasProblema > 0);
  if (candidatos.length === 0) return [];

  // Calcula métricas brutas
  candidatos.forEach(p => {
    p.frequencia = p.ocorrenciasProblema / p.ocorrencias;
    p.magnitudeMedia = p.diferencasProblema.reduce((s, x) => s + x, 0) / p.diferencasProblema.length;
  });

  // Encontra máximos pra normalizar
  const maxFreq = Math.max(...candidatos.map(p => p.frequencia)) || 1;
  const maxMag  = Math.max(...candidatos.map(p => p.magnitudeMedia)) || 1;
  const maxPior = Math.max(...candidatos.map(p => p.piorCaso)) || 1;

  // Calcula score normalizado
  candidatos.forEach(p => {
    p.scoreFreq = p.frequencia / maxFreq;
    p.scoreMag  = p.magnitudeMedia / maxMag;
    p.scorePior = p.piorCaso / maxPior;
    p.score = 0.40 * p.scoreFreq + 0.35 * p.scoreMag + 0.25 * p.scorePior;
  });

  // Ordena por score desc
  candidatos.sort((a, b) => b.score - a.score);

  return candidatos;
}

function renderLinhaRanking(p, posicao) {
  const medalha = posicao === 1 ? '🥇' : posicao === 2 ? '🥈' : posicao === 3 ? '🥉' : `#${posicao}`;
  const freqPct = Math.round(p.frequencia * 100);

  // Cor do score: alto = vermelho, médio = amarelo, baixo = cinza
  const corScore = p.score >= 0.7 ? 'hist-rank-score-alto' :
                   p.score >= 0.4 ? 'hist-rank-score-medio' :
                   'hist-rank-score-baixo';

  return `
    <div class="hist-rank-item">
      <div class="hist-rank-item-resumo" onclick="window.__hist_toggleRanking('${p.slug}')">
        <div class="hist-rank-pos">${medalha}</div>
        <div class="hist-rank-nome">
          <strong>${p.nome}</strong>
          <small>${p.grupo || ''}</small>
        </div>
        <div class="hist-rank-metricas">
          <div class="hist-rank-metr">
            <small>Frequência</small>
            <strong>${freqPct}%</strong>
            <span class="hist-rank-detalhe">${p.ocorrenciasProblema}/${p.ocorrencias} audit.</span>
          </div>
          <div class="hist-rank-metr">
            <small>Magnitude média</small>
            <strong>${fmtInt(p.magnitudeMedia)}</strong>
            <span class="hist-rank-detalhe">un / audit.</span>
          </div>
          <div class="hist-rank-metr">
            <small>Pior caso</small>
            <strong>${fmtInt(p.piorCaso)}</strong>
            <span class="hist-rank-detalhe">un</span>
          </div>
        </div>
        <div class="hist-rank-score ${corScore}" title="Score: ${(p.score * 100).toFixed(0)}/100">
          ${(p.score * 100).toFixed(0)}
        </div>
        <div class="hist-rank-seta" id="hist-rank-seta-${p.slug}">▼</div>
      </div>
      <div class="hist-rank-item-detalhe" id="hist-rank-det-${p.slug}" style="display:none">
        <div class="hist-rank-det-titulo">📋 Histórico (${p.historico.length} auditoria${p.historico.length === 1 ? '' : 's'})</div>
        <div class="hist-rank-det-tabela">
          <div class="hist-rank-det-cab">
            <div>Data</div>
            <div>INI</div>
            <div>+REC</div>
            <div>−VEN</div>
            <div>REAL</div>
            <div>DIF</div>
            <div>Status</div>
          </div>
          ${p.historico
            .slice()
            .sort((a, b) => (b.dataInicio || '').localeCompare(a.dataInicio || ''))
            .map(h => `
              <div class="hist-rank-det-linha hist-rank-det-${h.status}">
                <div>${fmtData(h.dataInicio)}</div>
                <div>${fmtInt(h.ini)}</div>
                <div>${h.recebido > 0 ? '+' + fmtInt(h.recebido) : '—'}</div>
                <div>${h.vendido > 0 ? '−' + fmtInt(h.vendido) : '—'}</div>
                <div>${fmtInt(h.real)}</div>
                <div class="${h.diferenca < 0 ? 'aud-dif-neg' : h.diferenca > 0 ? 'aud-dif-pos' : 'aud-dif-zero'}">${fmtSgn(h.diferenca)}</div>
                <div class="hist-rank-det-status hist-s-${h.status[0]}">${h.status.toUpperCase()}</div>
              </div>
            `).join('')}
        </div>
      </div>
    </div>
  `;
}

window.__hist_toggleRanking = function(slug) {
  const det = document.getElementById(`hist-rank-det-${slug}`);
  const seta = document.getElementById(`hist-rank-seta-${slug}`);
  if (!det) return;
  const aberto = det.style.display !== 'none';
  det.style.display = aberto ? 'none' : 'block';
  if (seta) seta.textContent = aberto ? '▼' : '▲';
};

function renderLinhaHistorico(a) {
  const modoLbl = a.modo === 'operacional' ? '📊 Operacional' : '🌙 Virada';
  const periodoLbl = a.dataInicio === a.dataFim
    ? fmtData(a.dataInicio)
    : `${fmtData(a.dataInicio)} → ${fmtData(a.dataFim)}`;
  const t = a.totais || {};

  return `
    <div class="hist-item">
      <div class="hist-data">
        <div class="hist-data-principal">${fmtData(a.dataFim)}</div>
        <div class="hist-data-modo">${modoLbl}</div>
      </div>
      <div class="hist-info">
        <div class="hist-periodo">${periodoLbl}</div>
        <div class="hist-status">
          <span class="hist-s hist-s-c" title="Críticos">${t.criticos || 0}</span>
          <span class="hist-s hist-s-a" title="Atenção">${t.atencao || 0}</span>
          <span class="hist-s hist-s-l" title="Leves">${t.leves || 0}</span>
          <span class="hist-s hist-s-o" title="OK">${t.ok || 0}</span>
        </div>
        ${a.observacoes ? `<div class="hist-obs">"${a.observacoes}"</div>` : ''}
      </div>
      <div class="hist-meta">
        <button class="btn btn-ghost btn-sm" onclick="window.__aud_abrirFechada('${a.id}')">🔍 Abrir</button>
        <small style="display:block;margin-top:4px;text-align:right">Por: ${a.responsavel || '—'}</small>
      </div>
    </div>
  `;
}

/**
 * Abre uma auditoria fechada a partir do snapshot salvo.
 * Volta pra aba Atual, preenche datas/modo, renderiza a tabela com os dados congelados.
 */
window.__aud_abrirFechada = async function(id) {
  try {
    // Busca todas as auditorias e acha a que tem esse ID
    const auditorias = await listarAuditoriasFechadas();
    const a = auditorias.find(x => x.id === id);
    if (!a) {
      alert('Auditoria não encontrada.');
      return;
    }

    // Volta pra aba Atual
    trocarSubaba('atual');

    // Aplica modo e datas
    if (a.modo !== modoAtual) {
      modoAtual = a.modo;
      aplicarModo();
    }
    // No campo único, guardamos a "data principal":
    //   - operacional: dataInicio = dataFim (mesmo dia)
    //   - virada:     dataFim (INI do dia escolhido)
    const dataPrincipal = (a.modo === 'virada') ? a.dataFim : a.dataInicio;
    document.getElementById('aud-data-principal').value = dataPrincipal;
    dataInicio = a.dataInicio;
    dataFim    = a.dataFim;
    // Atualiza a hint (no modo virada, mostra qual dia é o anterior)
    aplicarModo();

    // Hidrata estado com o snapshot (dados congelados) — não recalcula
    resultadoAuditoria = a.resultado || [];
    // Reconstitui campos de produto (grupo, unidCompra, porCaixa) a partir
    // do catálogo efetivo atual — pra render funcionar.
    // Nota: usa o catálogo de HOJE pra produtos antigos. Se o produto foi
    // editado depois da auditoria fechada, mostra os dados atualizados.
    const bebidasAtuais = await obterBebidas({ incluirOcultos: true });
    resultadoAuditoria = resultadoAuditoria.map(r => {
      const bebida = bebidasAtuais.find(b => slugify(b.nome) === r.slug);
      return {
        ...r,
        grupo: r.grupo || bebida?.grupo || '',
        unidCompra: bebida?.unidCompra,
        porCaixa: bebida?.porCaixa
      };
    });

    // Define contexto mínimo pro PDF funcionar
    contextoAuditoria = {
      contagemIni: null,
      contagemFin: null,
      vendas: [],
      recebimentos: [],
      contagemFinAnterior: null,
      // flag pra renderizador saber que veio de histórico (não usa vendas.length)
      deHistorico: true
    };

    // Marca como auditoria fechada (pra banner aparecer)
    auditoriaFechadaAtual = a;

    // Renderiza conforme o modo
    if (a.modo === 'operacional') {
      renderizarResumoHistorico(a);
      renderizarTabelaOperacional();
    } else {
      renderizarResumoViradaHistorico(a);
      renderizarTabelaVirada();
    }

    // Re-hidrata sorvetes do snapshot (se houver no fechamento)
    const sorvSnapshot = a.resultadoSorvetes || [];
    if (a.modo === 'operacional') {
      resultadoSorvetes = sorvSnapshot;
      resultadoSorvetesVirada = [];
      if (sorvSnapshot.length > 0) {
        // Renderização simplificada (sem buscar vendas — usa dados do snapshot)
        await renderizarSecaoSorvetesHistoricoOperacional();
      } else {
        limparSecaoSorvetes();
      }
    } else {
      resultadoSorvetesVirada = sorvSnapshot;
      resultadoSorvetes = [];
      if (sorvSnapshot.length > 0) {
        renderizarSecaoSorvetesVirada();
      } else {
        limparSecaoSorvetes();
      }
    }

    renderizarBannerFechamento();

    // Mostra seções
    document.getElementById('aud-resumo').style.display = 'block';
    document.getElementById('aud-tabela').style.display = 'block';
    document.getElementById('aud-acoes').style.display  = 'flex';

    // Scroll suave pra seção da tabela
    setTimeout(() => {
      document.getElementById('aud-resumo').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);

  } catch (e) {
    console.error(e);
    alert('Erro ao abrir auditoria: ' + e.message);
  }
};

/**
 * Versão simplificada do renderizarResumoOperacional pra quando abrimos do histórico.
 * Não precisa recalcular nada — só exibe o snapshot.
 */
function renderizarResumoHistorico(a) {
  const resumo = document.getElementById('aud-resumo');
  const sub = document.getElementById('aud-sub');

  const periodoLabel = a.dataInicio === a.dataFim
    ? fmtData(a.dataInicio)
    : `${fmtData(a.dataInicio)} → ${fmtData(a.dataFim)}`;
  sub.textContent = `📜 Snapshot de ${periodoLabel} (auditoria fechada)`;

  const t = a.totais || {};
  const r = a.resultado || [];

  // Recalcula totais do snapshot pra equação
  const totalIni = r.reduce((s, x) => s + (x.ini || 0), 0);
  const totalRec = r.reduce((s, x) => s + (x.recebido || 0), 0);
  const totalVen = r.reduce((s, x) => s + (x.vendido || 0), 0);
  const totalFin = r.reduce((s, x) => s + (x.real || 0), 0);
  const totalDif = r.reduce((s, x) => s + (x.diferenca || 0), 0);

  const criticos = r.filter(x => x.status === 'critico').length;
  const atencao  = r.filter(x => x.status === 'atencao').length;
  const leves    = r.filter(x => x.status === 'leve').length;
  const ok       = r.filter(x => x.status === 'ok').length;
  const semdados = r.filter(x => x.status === 'semdados').length;

  resumo.innerHTML = `
    <div class="aud-kpis">
      <div class="aud-kpi aud-kpi-critico">
        <div class="aud-kpi-val">${criticos}</div>
        <div class="aud-kpi-label">CRÍTICOS (≥5 un)</div>
      </div>
      <div class="aud-kpi aud-kpi-atencao">
        <div class="aud-kpi-val">${atencao}</div>
        <div class="aud-kpi-label">ATENÇÃO (2-4)</div>
      </div>
      <div class="aud-kpi aud-kpi-leve">
        <div class="aud-kpi-val">${leves}</div>
        <div class="aud-kpi-label">LEVES (1)</div>
      </div>
      <div class="aud-kpi aud-kpi-ok">
        <div class="aud-kpi-val">${ok}</div>
        <div class="aud-kpi-label">OK (0)</div>
      </div>
      <div class="aud-kpi aud-kpi-semdados">
        <div class="aud-kpi-val">${semdados}</div>
        <div class="aud-kpi-label">SEM DADOS</div>
      </div>
    </div>

    <div class="aud-equacao">
      <div class="aud-eq-item">
        <div class="aud-eq-label">INICIAL</div>
        <div class="aud-eq-val">${fmtInt(totalIni)}</div>
      </div>
      <div class="aud-eq-op">+</div>
      <div class="aud-eq-item aud-eq-recebido">
        <div class="aud-eq-label">RECEBIDO</div>
        <div class="aud-eq-val">${fmtInt(totalRec)}</div>
      </div>
      <div class="aud-eq-op">−</div>
      <div class="aud-eq-item aud-eq-vendido">
        <div class="aud-eq-label">VENDIDO</div>
        <div class="aud-eq-val">${fmtInt(totalVen)}</div>
      </div>
      <div class="aud-eq-op">=</div>
      <div class="aud-eq-item aud-eq-esperado">
        <div class="aud-eq-label">ESPERADO</div>
        <div class="aud-eq-val">${fmtInt(totalIni + totalRec - totalVen)}</div>
      </div>
      <div class="aud-eq-op aud-eq-vs">vs</div>
      <div class="aud-eq-item aud-eq-real">
        <div class="aud-eq-label">REAL (FIN)</div>
        <div class="aud-eq-val">${fmtInt(totalFin)}</div>
      </div>
      <div class="aud-eq-op">=</div>
      <div class="aud-eq-item ${totalDif < 0 ? 'aud-eq-neg' : totalDif > 0 ? 'aud-eq-pos' : 'aud-eq-zero'}">
        <div class="aud-eq-label">DIFERENÇA</div>
        <div class="aud-eq-val">${fmtSgn(totalDif)}</div>
      </div>
    </div>
  `;
}

/** Versão do resumo pro modo virada, usando snapshot. */
function renderizarResumoViradaHistorico(a) {
  const resumo = document.getElementById('aud-resumo');
  const sub = document.getElementById('aud-sub');
  const r = a.resultado || [];

  const dias = diffDias(a.dataInicio, a.dataFim);
  const labelDias = dias === 1 ? '1 dia de parada (noite)' : `${dias} dias de parada (parada semanal)`;
  sub.textContent = `📜 Snapshot — 🌙 Virada: ${fmtData(a.dataInicio)} → ${fmtData(a.dataFim)} · ${labelDias}`;

  const criticos = r.filter(x => x.status === 'critico').length;
  const atencao  = r.filter(x => x.status === 'atencao').length;
  const leves    = r.filter(x => x.status === 'leve').length;
  const ok       = r.filter(x => x.status === 'ok').length;
  const semdados = r.filter(x => x.status === 'semdados').length;

  const totalFim = r.reduce((s, x) => s + (x.fimAnterior || 0), 0);
  const totalIni = r.reduce((s, x) => s + (x.iniAtual || 0), 0);
  const totalDif = r.reduce((s, x) => s + (x.diferenca || 0), 0);

  resumo.innerHTML = `
    <div class="aud-kpis">
      <div class="aud-kpi aud-kpi-critico">
        <div class="aud-kpi-val">${criticos}</div>
        <div class="aud-kpi-label">CRÍTICOS (≥5 un)</div>
      </div>
      <div class="aud-kpi aud-kpi-atencao">
        <div class="aud-kpi-val">${atencao}</div>
        <div class="aud-kpi-label">ATENÇÃO (2-4)</div>
      </div>
      <div class="aud-kpi aud-kpi-leve">
        <div class="aud-kpi-val">${leves}</div>
        <div class="aud-kpi-label">LEVES (1)</div>
      </div>
      <div class="aud-kpi aud-kpi-ok">
        <div class="aud-kpi-val">${ok}</div>
        <div class="aud-kpi-label">OK (0)</div>
      </div>
      <div class="aud-kpi aud-kpi-semdados">
        <div class="aud-kpi-val">${semdados}</div>
        <div class="aud-kpi-label">SEM DADOS</div>
      </div>
    </div>

    <div class="aud-equacao aud-eq-virada">
      <div class="aud-eq-item">
        <div class="aud-eq-label">FIN ${fmtData(a.dataInicio)}</div>
        <div class="aud-eq-val">${fmtInt(totalFim)}</div>
        <div class="aud-eq-sub">fechamento</div>
      </div>
      <div class="aud-eq-op aud-eq-vs">vs</div>
      <div class="aud-eq-item">
        <div class="aud-eq-label">INI ${fmtData(a.dataFim)}</div>
        <div class="aud-eq-val">${fmtInt(totalIni)}</div>
        <div class="aud-eq-sub">abertura</div>
      </div>
      <div class="aud-eq-op">=</div>
      <div class="aud-eq-item ${totalDif < 0 ? 'aud-eq-neg' : totalDif > 0 ? 'aud-eq-pos' : 'aud-eq-zero'}">
        <div class="aud-eq-label">DIFERENÇA</div>
        <div class="aud-eq-val">${fmtSgn(totalDif)}</div>
        <div class="aud-eq-sub">${totalDif === 0 ? 'tudo certo ✓' : 'investigar'}</div>
      </div>
    </div>
  `;
}

// ===== UTILS =====
function toIso(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

// ============================================================================
// CONSUMO INTERNO — lançamento manual (só gestor)
// Retiradas de estoque fora do PDV. Abate do FIN do dia escolhido na virada.
// ============================================================================

let _ciHouveLancamento = false;

function garantirModalConsumo() {
  if (document.getElementById('modal-consumo-interno')) return;
  const html = `
    <div class="modal-backdrop" id="modal-consumo-interno">
      <div class="modal-box" style="max-width:480px">
        <button class="modal-close" id="ci-close">✕</button>
        <div class="modal-head">
          <h3>🥤 Lançar consumo interno</h3>
          <p>Retiradas do estoque fora do PDV. Abate do FIN do dia escolhido — corrige a virada para o dia seguinte. Não altera a auditoria do próprio dia.</p>
        </div>
        <div style="padding:4px 24px 24px">
          <label style="display:block;font-size:.8rem;font-weight:700;color:#7a6a72;margin:10px 0 4px">Dia (em que retirou, após a contagem final)</label>
          <input type="date" id="ci-data" style="width:100%;padding:9px 11px;border:1px solid #e0d8dc;border-radius:9px;font-size:14px">
          <label style="display:block;font-size:.8rem;font-weight:700;color:#7a6a72;margin:12px 0 4px">Produto</label>
          <select id="ci-produto" style="width:100%;padding:9px 11px;border:1px solid #e0d8dc;border-radius:9px;font-size:14px;background:#fff"></select>
          <label style="display:block;font-size:.8rem;font-weight:700;color:#7a6a72;margin:12px 0 4px">Quantidade</label>
          <input type="number" id="ci-qtd" min="1" step="1" value="1" style="width:100%;padding:9px 11px;border:1px solid #e0d8dc;border-radius:9px;font-size:14px">
          <div id="ci-registros" style="margin-top:14px"></div>
          <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:16px">
            <button class="btn btn-ghost" id="ci-cancelar">Fechar</button>
            <button class="btn btn-primary" id="ci-salvar">Lançar</button>
          </div>
        </div>
      </div>
    </div>`;
  document.body.insertAdjacentHTML('beforeend', html);
  document.getElementById('ci-close').onclick = fecharModalConsumoInterno;
  document.getElementById('ci-cancelar').onclick = fecharModalConsumoInterno;
  document.getElementById('ci-salvar').onclick = salvarConsumoInternoUI;
  document.getElementById('modal-consumo-interno').onclick = e => {
    if (e.target.id === 'modal-consumo-interno') fecharModalConsumoInterno();
  };
  document.getElementById('ci-data').onchange = () => carregarRegistrosConsumo();
}

async function abrirModalConsumoInterno() {
  garantirModalConsumo();
  _ciHouveLancamento = false;

  // Popula produtos (bebidas)
  const bebidas = await obterBebidas();
  const sel = document.getElementById('ci-produto');
  sel.innerHTML = bebidas
    .slice()
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
    .map(b => `<option value="${b.nome.replace(/"/g, '&quot;')}">${b.nome}</option>`)
    .join('');

  // Default: o dia que está na auditoria
  const diaAud = document.getElementById('aud-data-principal')?.value || '';
  document.getElementById('ci-data').value = diaAud;
  document.getElementById('ci-qtd').value = 1;

  await carregarRegistrosConsumo();
  document.getElementById('modal-consumo-interno').classList.add('open');
}

function fecharModalConsumoInterno() {
  const m = document.getElementById('modal-consumo-interno');
  if (m) m.classList.remove('open');
  // Se lançou algo, recalcula a auditoria pra refletir
  if (_ciHouveLancamento) {
    _ciHouveLancamento = false;
    executarAuditoria();
  }
}

async function carregarRegistrosConsumo() {
  const data = document.getElementById('ci-data')?.value;
  const box = document.getElementById('ci-registros');
  if (!box) return;
  if (!data) { box.innerHTML = ''; return; }
  try {
    const { registros } = await listarConsumoInternoDia(data);
    if (!registros.length) {
      box.innerHTML = `<div style="font-size:.8rem;color:#999">Nenhum consumo interno lançado em ${fmtData(data)}.</div>`;
      return;
    }
    box.innerHTML = `
      <div style="font-size:.8rem;font-weight:700;color:#7a6a72;margin-bottom:6px">Já lançado em ${fmtData(data)}:</div>
      ${registros.map(r => `
        <div style="display:flex;justify-content:space-between;font-size:.85rem;padding:3px 0;border-bottom:1px solid #f0f0f0">
          <span>${r.nome}</span><span><b>${r.qtd}</b>${r.por ? ' · ' + r.por : ''}</span>
        </div>`).join('')}`;
  } catch (e) {
    box.innerHTML = `<div style="font-size:.8rem;color:var(--vermelho)">Erro ao ler: ${e.message}</div>`;
  }
}

async function salvarConsumoInternoUI() {
  const data = document.getElementById('ci-data').value;
  const nome = document.getElementById('ci-produto').value;
  const qtd  = parseInt(document.getElementById('ci-qtd').value, 10);

  if (!data) { mostrarToastAud('Escolha o dia.', 'err'); return; }
  if (!nome) { mostrarToastAud('Escolha o produto.', 'err'); return; }
  if (!qtd || qtd < 1) { mostrarToastAud('Quantidade inválida.', 'err'); return; }

  const btn = document.getElementById('ci-salvar');
  btn.disabled = true;
  try {
    const sessao = getSessao();
    await salvarConsumoInterno(data, slugify(nome), nome, qtd, sessao?.nome || 'Gestor');
    _ciHouveLancamento = true;
    document.getElementById('ci-qtd').value = 1;
    await carregarRegistrosConsumo();
    mostrarToastAud(`Lançado: ${qtd}× ${nome}`, 'ok');
  } catch (e) {
    console.error(e);
    mostrarToastAud('Erro ao salvar: ' + e.message, 'err');
  } finally {
    btn.disabled = false;
  }
}

function mostrarToastAud(msg, tipo = '') {
  const t = document.getElementById('toast');
  if (!t) { alert(msg); return; }
  t.textContent = msg;
  t.className = 'toast show ' + tipo;
  setTimeout(() => t.className = 'toast', 2800);
}

// ============================================================================
// CALENDÁRIO DE AUDITORIA — tela principal (modo operacional)
// Grade mensal (estilo Vendas). Cada dia mostra crítico/atenção/leve/ok.
// Calcula tudo em LOTE (1 busca por tipo) e roda cada dia em memória.
// Clicar num dia abre o DETALHE (reusa executarAuditoria).
// ============================================================================

let _calMes = null; // Date apontando pro 1º dia do mês exibido

function injetarEstiloCalendario() {
  if (document.getElementById('aud-cal-style')) return;
  const st = document.createElement('style');
  st.id = 'aud-cal-style';
  st.textContent = `
    .aud-cal-nav { display:flex; align-items:center; justify-content:space-between; margin-bottom:14px; flex-wrap:wrap; gap:8px; }
    .aud-cal-titulo { font-weight:800; font-size:17px; text-transform:capitalize; color:var(--vinho,#7C0047); }
    .aud-cal-nav-btns { display:flex; gap:8px; }
    .aud-cal-nav-btns button { background:#fff; color:var(--vinho,#7C0047); border:1px solid var(--vinho,#7C0047); padding:7px 12px; border-radius:9px; font-size:13px; font-weight:700; cursor:pointer; }
    .aud-cal-nav-btns button:active { opacity:.75; }
    .aud-cal-legenda { font-size:11.5px; color:#888; text-align:center; margin-top:14px; }

    .aud-cal-grade { display:grid; grid-template-columns:repeat(7,1fr); gap:6px; }
    .aud-cal-wd { text-align:center; font-size:11px; font-weight:700; color:#aaa; padding-bottom:2px; }
    .aud-cal-cel { min-height:72px; border:1px solid #ececec; border-radius:10px; padding:5px 4px; background:#fff; display:flex; flex-direction:column; }
    .aud-cal-cel.vazia { border:none; background:transparent; min-height:0; }
    .aud-cal-cel.sem { background:#fafafa; }
    .aud-cal-cel.parcial { background:#fafafa; }
    .aud-cal-cel.tem { cursor:pointer; transition:.12s; }
    .aud-cal-cel.tem:hover { border-color:var(--vinho,#7C0047); box-shadow:0 2px 8px rgba(0,0,0,.10); }
    .aud-cal-cel-num { font-size:12.5px; font-weight:700; color:#666; line-height:1; }
    .aud-cal-cel.sem .aud-cal-cel-num { color:#ccc; }
    .aud-cal-cel-bolas { display:flex; flex-wrap:wrap; gap:2px 5px; margin-top:auto; padding-top:4px; }
    .aud-cal-mb { display:inline-flex; align-items:center; gap:1px; font-size:11px; line-height:1; }
    .aud-cal-mb b { font-size:11px; color:#444; font-weight:700; }
    .aud-cal-mb.z { opacity:.22; }
    .aud-cal-cel-inc { font-size:9px; color:#bbb; font-style:italic; margin-top:auto; }

    .aud-det-topo { display:flex; align-items:center; gap:12px; margin-bottom:10px; flex-wrap:wrap; }
    .aud-det-data { font-weight:800; font-size:16px; color:var(--vinho,#7C0047); text-transform:capitalize; }

    @media (max-width:600px) {
      .aud-cal-grade { gap:3px; }
      .aud-cal-cel { min-height:64px; padding:3px; border-radius:8px; }
      .aud-cal-cel-num { font-size:11px; }
      .aud-cal-mb, .aud-cal-mb b { font-size:10px; }
    }
  `;
  document.head.appendChild(st);
}

function calNavegarMes(delta) {
  if (!_calMes) return;
  _calMes = new Date(_calMes.getFullYear(), _calMes.getMonth() + delta, 1);
  renderCalendarioAuditoria();
}

async function renderCalendarioAuditoria() {
  const cont = document.getElementById('aud-cal-lista');
  if (!cont) return;

  if (!_calMes) {
    const h = new Date();
    _calMes = new Date(h.getFullYear(), h.getMonth(), 1);
  }

  const ano = _calMes.getFullYear();
  const mes = _calMes.getMonth(); // 0-11
  const tituloEl = document.getElementById('aud-cal-titulo');
  if (tituloEl) tituloEl.textContent = _calMes.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

  cont.innerHTML = `<div style="text-align:center;padding:30px">
      <span class="spinner"></span>
      <div style="margin-top:8px;color:#999;font-size:13px">Calculando auditoria do mês...</div>
    </div>`;

  const ultimoN = new Date(ano, mes + 1, 0).getDate();
  const primeiroIso = toIso(new Date(ano, mes, 1));
  const ultimoIso = toIso(new Date(ano, mes, ultimoN));

  try {
    const [todasContagens, vendasLote, recebLote] = await Promise.all([
      listarContagens({ limite: 500 }),
      listarVendas({ dataInicio: primeiroIso, dataFim: ultimoIso, limite: 366 }),
      listarRecebimentos(primeiroIso, ultimoIso),
    ]);
    await obterBebidas(); // aquece o cache do catálogo

    // Calcula o status de cada dia do mês
    const dias = {};
    for (let d = 1; d <= ultimoN; d++) {
      const diaIso = toIso(new Date(ano, mes, d));
      const ini  = todasContagens.find(c => c.tipo === 'ini'  && c.data === diaIso);
      const fin  = todasContagens.find(c => c.tipo === 'fin'  && c.data === diaIso);
      const sorv = todasContagens.find(c => c.tipo === 'sorv' && c.data === diaIso);

      if (!ini && !fin && !sorv) { dias[d] = { tipo: 'vazio' }; continue; }

      if (ini && fin) {
        const finAnt = todasContagens
          .filter(c => c.tipo === 'fin' && c.data < diaIso)
          .sort((a, b) => b.data.localeCompare(a.data))[0] || null;
        const vendasDia = vendasLote.filter(v => (v.data || v.id) === diaIso);
        const recebDia  = recebLote.filter(r => r.data === diaIso);

        const res = await calcularAuditoriaOperacional(ini, fin, vendasDia, recebDia, finAnt, {});
        const c = { critico: 0, atencao: 0, leve: 0, ok: 0 };
        res.forEach(r => { if (c[r.status] !== undefined) c[r.status]++; });
        dias[d] = { tipo: 'completo', cont: c, diaIso };
      } else {
        dias[d] = { tipo: 'parcial', diaIso };
      }
    }

    // Monta a grade (7 colunas, semanas em linhas)
    const primeiroDiaSemana = new Date(ano, mes, 1).getDay(); // 0=Dom
    let html = '<div class="aud-cal-grade">';
    ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'].forEach(w => { html += `<div class="aud-cal-wd">${w}</div>`; });
    for (let i = 0; i < primeiroDiaSemana; i++) html += '<div class="aud-cal-cel vazia"></div>';

    for (let d = 1; d <= ultimoN; d++) {
      const info = dias[d];
      if (info.tipo === 'completo') {
        const c = info.cont;
        html += `<div class="aud-cal-cel tem" data-dia="${info.diaIso}">
            <div class="aud-cal-cel-num">${d}</div>
            <div class="aud-cal-cel-bolas">${miniBola('🔴', c.critico)}${miniBola('🟠', c.atencao)}${miniBola('🟡', c.leve)}${miniBola('🟢', c.ok)}</div>
          </div>`;
      } else if (info.tipo === 'parcial') {
        html += `<div class="aud-cal-cel parcial">
            <div class="aud-cal-cel-num">${d}</div>
            <div class="aud-cal-cel-inc">incompleto</div>
          </div>`;
      } else {
        html += `<div class="aud-cal-cel sem"><div class="aud-cal-cel-num">${d}</div></div>`;
      }
    }
    html += '</div>';
    cont.innerHTML = html;

    cont.querySelectorAll('.aud-cal-cel[data-dia]').forEach(el => {
      el.onclick = () => irParaDetalheAuditoria(el.dataset.dia);
    });
  } catch (e) {
    console.error('[calendario auditoria]', e);
    cont.innerHTML = `<div style="text-align:center;padding:30px;color:var(--vermelho,#c0392b);font-size:14px">Erro ao carregar: ${e.message}</div>`;
  }
}

function miniBola(emoji, n) {
  return `<span class="aud-cal-mb${n === 0 ? ' z' : ''}">${emoji}<b>${n}</b></span>`;
}

// ===== navegação grade <-> detalhe =====
function irParaDetalheAuditoria(diaIso) {
  const inp = document.getElementById('aud-data-principal');
  if (inp) inp.value = diaIso;
  modoAtual = 'operacional';

  const dataEl = document.getElementById('aud-det-data');
  if (dataEl) {
    const [y, m, d] = diaIso.split('-');
    const dt = new Date(Number(y), Number(m) - 1, Number(d));
    dataEl.textContent = dt.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
  }

  // Mostra a tela de detalhe, esconde a barra de sub-abas e as outras abas
  document.querySelector('.subabas-wrapper').style.display = 'none';
  document.getElementById('aud-aba-calendario').style.display = 'none';
  document.getElementById('aud-aba-historico').style.display = 'none';
  document.getElementById('aud-aba-atual').style.display = 'block';

  executarAuditoria();
}

function voltarAoCalendario() {
  document.getElementById('aud-aba-atual').style.display = 'none';
  document.querySelector('.subabas-wrapper').style.display = '';
  abaAtiva = 'calendario';
  document.querySelectorAll('.subaba').forEach(b => b.classList.toggle('ativo', b.dataset.subaba === 'calendario'));
  document.getElementById('aud-aba-calendario').style.display = 'block';
  document.getElementById('aud-aba-historico').style.display = 'none';
  renderCalendarioAuditoria();
}
