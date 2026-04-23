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
  listarAuditoriasFechadas, excluirAuditoriaFechada
} from './db.js';
import { BEBIDAS, slugify, converterParaCaixas } from './produtos.js';
import { getSessao } from './auth.js';

// ===== ESTADO =====
let abaAtiva = 'atual';          // 'atual' | 'historico'
let modoAtual = 'operacional';   // 'operacional' | 'virada'
let dataInicio = '';
let dataFim    = '';
let resultadoAuditoria = [];
let contextoAuditoria = {};      // { contagemIni, contagemFin, vendas, recebimentos, contagemFinAnterior }
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
      <button class="subaba ativo" data-subaba="atual">
        <span class="subaba-ico">⏱️</span>
        <span class="subaba-txt">Auditoria Atual</span>
      </button>
      <button class="subaba" data-subaba="historico">
        <span class="subaba-ico">📈</span>
        <span class="subaba-txt">Histórico</span>
      </button>
    </div>

    <!-- Aba: Auditoria Atual -->
    <div class="subaba-conteudo" id="aud-aba-atual">
    <div class="card">
      <div class="grafico-head">
        <h3>🔍 Auditoria de Estoque</h3>
        <span class="grafico-sub" id="aud-sub">Selecione o modo e o período</span>
      </div>

      <!-- Toggle de modo -->
      <div class="aud-modo-toggle">
        <button class="aud-modo-btn ativo" id="aud-modo-op" data-modo="operacional">
          <span class="aud-modo-ico">📊</span>
          <span class="aud-modo-txt">
            <strong>Dia operacional</strong>
            <small>INI + recebimentos − vendas vs FIN (mesmo dia)</small>
          </span>
        </button>
        <button class="aud-modo-btn" id="aud-modo-vir" data-modo="virada">
          <span class="aud-modo-ico">🌙</span>
          <span class="aud-modo-txt">
            <strong>Virada de dia</strong>
            <small>FIN do dia X vs INI do próximo dia operacional</small>
          </span>
        </button>
      </div>

      <!-- Campos de data (adaptam ao modo) -->
      <div class="aud-periodo" id="aud-periodo">
        <div class="aud-periodo-campo">
          <label id="aud-label-ini">📅 Contagem de INÍCIO</label>
          <input type="date" id="aud-data-inicio" value="${ontemIso}">
        </div>
        <div class="aud-periodo-sep" id="aud-sep">→</div>
        <div class="aud-periodo-campo">
          <label id="aud-label-fim">🌙 Contagem de FINAL</label>
          <input type="date" id="aud-data-fim" value="${ontemIso}">
        </div>
        <button class="btn btn-primary" id="aud-executar">🔍 Executar</button>
      </div>

      <div class="aud-info" id="aud-info"></div>

      <!-- Banner de auditoria já fechada -->
      <div id="aud-fechada-banner" style="display:none"></div>

      <div id="aud-loading" style="display:none;text-align:center;padding:40px">
        <span class="spinner"></span>
        <div style="margin-top:10px;color:var(--cinza-texto);font-size:13px">Executando auditoria...</div>
      </div>

      <div id="aud-erro" style="display:none"></div>
      <div id="aud-resumo" style="display:none"></div>
      <div id="aud-tabela" style="display:none"></div>
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
  `;

  // Listeners do toggle
  document.getElementById('aud-modo-op').onclick  = () => trocarModo('operacional');
  document.getElementById('aud-modo-vir').onclick = () => trocarModo('virada');

  // No modo VIRADA, quando mudar a data FIN, sugere a próxima INI operacional
  document.getElementById('aud-data-inicio').onchange = () => {
    if (modoAtual === 'virada') {
      sugerirProximaINI();
    }
  };

  document.getElementById('aud-executar').onclick = executarAuditoria;

  // Listeners das sub-abas
  document.querySelectorAll('.subaba').forEach(btn => {
    btn.onclick = () => trocarSubaba(btn.dataset.subaba);
  });

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
  document.getElementById('aud-aba-atual').style.display     = nova === 'atual'     ? 'block' : 'none';
  document.getElementById('aud-aba-historico').style.display = nova === 'historico' ? 'block' : 'none';

  if (nova === 'historico') {
    carregarHistorico();
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
  document.getElementById('aud-erro').style.display = 'none';
  document.getElementById('aud-acoes').style.display = 'none';
  document.getElementById('aud-fechada-banner').style.display = 'none';
  auditoriaFechadaAtual = null;
}

function aplicarModo() {
  const btnOp  = document.getElementById('aud-modo-op');
  const btnVir = document.getElementById('aud-modo-vir');
  const labelIni = document.getElementById('aud-label-ini');
  const labelFim = document.getElementById('aud-label-fim');
  const info = document.getElementById('aud-info');
  const sub = document.getElementById('aud-sub');

  btnOp.classList.toggle('ativo',  modoAtual === 'operacional');
  btnVir.classList.toggle('ativo', modoAtual === 'virada');

  if (modoAtual === 'operacional') {
    labelIni.innerHTML = '📅 Contagem de INÍCIO';
    labelFim.innerHTML = '🌙 Contagem de FINAL';
    info.innerHTML = `
      <strong>📊 Modo Dia operacional:</strong>
      Busca a contagem INI na data de início e a FIN na data final. Soma recebimentos e
      subtrai vendas do PDV no período. Compara com a FIN pra detectar divergências
      <strong>durante a operação</strong> (consumo fora do PDV, quebras, erros).
    `;
    sub.textContent = 'Modo: Dia operacional';
  } else {
    labelIni.innerHTML = '🌙 FIN do dia';
    labelFim.innerHTML = '📅 INI do próximo dia';
    info.innerHTML = `
      <strong>🌙 Modo Virada de dia:</strong>
      Compara a FIN de um dia com a INI do próximo dia operacional. Detecta divergências
      <strong>entre operações</strong> (sumiço noturno, erro na virada de contagem).
      Em modo normal a diferença é zero — qualquer divergência merece atenção.
      ${avisoViradaLonga()}
    `;
    sub.textContent = 'Modo: Virada de dia';
    sugerirProximaINI();
  }
}

function avisoViradaLonga() {
  const dIni = document.getElementById('aud-data-inicio')?.value;
  const dFim = document.getElementById('aud-data-fim')?.value;
  if (!dIni || !dFim) return '';
  const diasEntre = diffDias(dIni, dFim);
  if (diasEntre >= 2) {
    return `<br><span style="color:var(--amarelo-status);font-weight:600">
      ⚠️ ${diasEntre} dias entre fechamento e abertura (parada semanal) — atenção redobrada.
    </span>`;
  }
  return '';
}

/**
 * Quando usuário escolher a FIN de um dia, sugere a INI do próximo dia operacional.
 * Regra: Qua-Dom opera. Se FIN for Domingo, sugere Quarta (pula Seg-Ter).
 * Nos outros casos, sugere o dia seguinte.
 * Só sugere se o usuário ainda não mexeu manualmente na data de fim.
 */
function sugerirProximaINI() {
  const dIniInput = document.getElementById('aud-data-inicio');
  const dFimInput = document.getElementById('aud-data-fim');
  if (!dIniInput.value) return;

  const proxima = proximoDiaOperacional(dIniInput.value);
  dFimInput.value = proxima;

  // Atualiza o aviso de parada longa
  const info = document.getElementById('aud-info');
  if (info && modoAtual === 'virada') {
    // Regenera mensagem com novo aviso
    aplicarModo();
  }
}

/**
 * Retorna o próximo dia operacional (Qua-Dom) depois de uma data.
 * Se a data for Domingo → pula pra Quarta (Seg-Ter fechado).
 * Caso contrário → próximo dia.
 * JS: getDay() = 0 (Dom), 1 (Seg), 2 (Ter), 3 (Qua), 4 (Qui), 5 (Sex), 6 (Sáb)
 */
function proximoDiaOperacional(dataIso) {
  const [y, m, d] = dataIso.split('-').map(Number);
  const data = new Date(y, m - 1, d);
  data.setDate(data.getDate() + 1);
  // Se cair em Seg ou Ter, avança até Quarta
  while (data.getDay() === 1 || data.getDay() === 2) {
    data.setDate(data.getDate() + 1);
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
  dataInicio = document.getElementById('aud-data-inicio').value;
  dataFim    = document.getElementById('aud-data-fim').value;

  if (!dataInicio || !dataFim) {
    mostrarErro('Selecione as duas datas.');
    return;
  }
  if (dataInicio > dataFim) {
    mostrarErro('A data de início precisa ser anterior ou igual à data final.');
    return;
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

  // Pega a contagem INI na data de início
  const contagemIni = todasContagens.find(c =>
    c.tipo === 'ini' && c.data === dataInicio
  );
  // Pega a contagem FIN na data de fim
  const contagemFin = todasContagens.find(c =>
    c.tipo === 'fin' && c.data === dataFim
  );

  if (!contagemIni) {
    throw new Error(`Não encontrei contagem de INÍCIO (ini) na data ${fmtData(dataInicio)}. Peça pro barman fazer essa contagem primeiro.`);
  }
  if (!contagemFin) {
    throw new Error(`Não encontrei contagem de FINAL (fin) na data ${fmtData(dataFim)}. Peça pro barman fazer essa contagem primeiro.`);
  }

  // 2) Busca a FIN do DIA OPERACIONAL ANTERIOR (pro cálculo do D-1)
  // Precisa ser FIN, de qualquer data anterior a dataInicio.
  // Ordenado desc, então basta pegar a primeira FIN com data < dataInicio.
  const contagemFinAnterior = todasContagens.find(c =>
    c.tipo === 'fin' && c.data < dataInicio
  );

  // 3) Busca vendas no período
  const vendas = await listarVendas({
    dataInicio,
    dataFim,
    limite: 365
  });

  // 4) Busca recebimentos no período
  const recebimentos = await listarRecebimentos(dataInicio, dataFim);

  // 5) Calcula auditoria (agora com D-1 e diagnóstico)
  resultadoAuditoria = calcularAuditoriaOperacional(contagemIni, contagemFin, vendas, recebimentos, contagemFinAnterior);

  // Salva contexto pro PDF usar depois
  contextoAuditoria = { contagemIni, contagemFin, vendas, recebimentos, contagemFinAnterior };

  // 6) Renderiza
  renderizarResumoOperacional(contagemIni, contagemFin, vendas, recebimentos, contagemFinAnterior);
  renderizarTabelaOperacional();
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

  if (!contagemFinAnterior) {
    throw new Error(`Não encontrei contagem de FINAL (fin) em ${fmtData(dataInicio)}.`);
  }
  if (!contagemIniAtual) {
    throw new Error(`Não encontrei contagem de INÍCIO (ini) em ${fmtData(dataFim)}.`);
  }

  // 2) Calcula auditoria de virada
  resultadoAuditoria = calcularAuditoriaVirada(contagemFinAnterior, contagemIniAtual);

  // Salva contexto pro PDF usar depois
  contextoAuditoria = { contagemFinAnterior, contagemIniAtual };

  // 3) Renderiza (layout específico do modo virada)
  renderizarResumoVirada(contagemFinAnterior, contagemIniAtual);
  renderizarTabelaVirada();
}

function mostrarErro(msg) {
  const erro = document.getElementById('aud-erro');
  erro.innerHTML = `<div class="preview-err">${msg}</div>`;
  erro.style.display = 'block';
  document.getElementById('aud-loading').style.display = 'none';
}

// ===== MOTOR DO CÁLCULO — MODO OPERACIONAL =====
function calcularAuditoriaOperacional(contagemIni, contagemFin, vendas, recebimentos, contagemFinAnterior) {
  // Extrai estoques por slug das contagens
  const estoqueIni = extrairEstoque(contagemIni);
  const estoqueFin = extrairEstoque(contagemFin);
  // Se tiver FIN anterior, extrai também (pra calcular D-1)
  const estoqueFinAnt = contagemFinAnterior ? extrairEstoque(contagemFinAnterior) : null;

  // Soma recebimentos por slug
  const recebidoPorSlug = {};
  recebimentos.forEach(r => {
    (r.itens || []).forEach(i => {
      if (!recebidoPorSlug[i.slug]) recebidoPorSlug[i.slug] = 0;
      recebidoPorSlug[i.slug] += i.qtd || 0;
    });
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

  // Monta linha por bebida
  return BEBIDAS.map(bebida => {
    const slug = slugify(bebida.nome);
    const ini  = estoqueIni[slug] || 0;
    const fin  = estoqueFin[slug] || 0;
    const recebido = recebidoPorSlug[slug] || 0;
    const vendido  = vendidoPorSlug[slug] || 0;

    const esperado = ini + recebido - vendido;
    const real     = fin;
    const diferenca = real - esperado;

    // D-1: diferença entre INI atual e FIN anterior (quanto sumiu/apareceu na virada)
    // Só calcula se tivermos FIN anterior
    let d1 = null;
    if (estoqueFinAnt !== null) {
      const finAnt = estoqueFinAnt[slug] || 0;
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

// ===== MOTOR DO CÁLCULO — MODO VIRADA =====
// Compara FIN do dia anterior com INI do dia atual.
// Em teoria, deveriam ser IGUAIS (não houve operação entre eles).
// Qualquer diferença significa sumiço ou erro de contagem.
function calcularAuditoriaVirada(contagemFinAnterior, contagemIniAtual) {
  const estoqueFim  = extrairEstoque(contagemFinAnterior);
  const estoqueIni  = extrairEstoque(contagemIniAtual);

  return BEBIDAS.map(bebida => {
    const slug = slugify(bebida.nome);
    const fimAnterior = estoqueFim[slug] || 0;
    const iniAtual    = estoqueIni[slug] || 0;
    const diferenca = iniAtual - fimAnterior;  // neg = sumiu; pos = "apareceu"

    const abs = Math.abs(diferenca);
    let status = 'ok';
    if (fimAnterior === 0 && iniAtual === 0) status = 'semdados';
    else if (abs >= 5) status = 'critico';
    else if (abs >= 2) status = 'atencao';
    else if (abs >= 1) status = 'leve';

    return {
      slug,
      nome: bebida.nome,
      grupo: bebida.grupo,
      unidCompra: bebida.unidCompra,
      porCaixa: bebida.porCaixa,
      fimAnterior,
      iniAtual,
      diferenca,
      status
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

  // Conta diagnósticos (cruzamento D-1)
  const diagErroContagem = resultadoAuditoria.filter(r => r.diagnostico === 'erro_contagem').length;
  const diagRecorrente   = resultadoAuditoria.filter(r => r.diagnostico === 'recorrente').length;
  const diagIsolado      = resultadoAuditoria.filter(r => r.diagnostico === 'isolado').length;

  // Totais gerais (unidades)
  const totalIni = resultadoAuditoria.reduce((s, r) => s + r.ini, 0);
  const totalRec = resultadoAuditoria.reduce((s, r) => s + r.recebido, 0);
  const totalVen = resultadoAuditoria.reduce((s, r) => s + r.vendido, 0);
  const totalFin = resultadoAuditoria.reduce((s, r) => s + r.real, 0);
  const totalDif = resultadoAuditoria.reduce((s, r) => s + r.diferenca, 0);

  // Banner de diagnóstico (só se houver pelo menos um achado)
  const totalAchados = diagErroContagem + diagRecorrente + diagIsolado;
  const bannerDiagnostico = (totalAchados > 0 && contagemFinAnterior)
    ? `
      <div class="aud-diag-banner">
        <div class="aud-diag-head">
          <span class="aud-diag-ico">🔍</span>
          <div>
            <strong>Análise cruzada com D-1</strong>
            <small>Comparando com a FIN de ${fmtData(contagemFinAnterior.data)}</small>
          </div>
        </div>
        <div class="aud-diag-chips">
          ${diagErroContagem > 0 ? `
            <div class="aud-diag-chip diag-erro">
              <span class="diag-chip-val">${diagErroContagem}</span>
              <span class="diag-chip-lbl">provável erro de contagem</span>
            </div>` : ''}
          ${diagRecorrente > 0 ? `
            <div class="aud-diag-chip diag-rec">
              <span class="diag-chip-val">${diagRecorrente}</span>
              <span class="diag-chip-lbl">problema recorrente</span>
            </div>` : ''}
          ${diagIsolado > 0 ? `
            <div class="aud-diag-chip diag-iso">
              <span class="diag-chip-val">${diagIsolado}</span>
              <span class="diag-chip-lbl">problema isolado do dia</span>
            </div>` : ''}
        </div>
      </div>
    `
    : (contagemFinAnterior ? '' : `
      <div class="aud-diag-banner aud-diag-sem">
        <span class="aud-diag-ico">💡</span>
        <span>Não há FIN anterior registrada para cruzar com o D-1. Conforme você acumular contagens, a análise cruzada vai automaticamente aparecer aqui.</span>
      </div>
    `);

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

    ${bannerDiagnostico}

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

  // Conversão da diferença pra caixa/fardo (útil pra entender o tamanho do problema)
  const produtoInfo = { unidCompra: r.unidCompra, porCaixa: r.porCaixa };
  const convDif = Math.abs(r.diferenca) >= (r.porCaixa || 999)
    ? ` (${converterParaCaixas(Math.abs(r.diferenca), produtoInfo)})`
    : '';

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

  return `
    <div class="aud-linha aud-linha-${r.status}${diag ? ' aud-linha-com-diag' : ''}">
      <div class="aud-nome">
        ${r.nome}
        ${diagHtml}
      </div>
      <div class="aud-num">${fmtInt(r.ini)}</div>
      <div class="aud-num aud-num-pos">${r.recebido > 0 ? '+' + fmtInt(r.recebido) : '—'}</div>
      <div class="aud-num aud-num-neg">${r.vendido > 0 ? '−' + fmtInt(r.vendido) : '—'}</div>
      <div class="aud-num aud-num-esp">${fmtInt(r.esperado)}</div>
      <div class="aud-num aud-num-real">${fmtInt(r.real)}</div>
      <div class="aud-num ${difClasse}">${fmtSgn(r.diferenca)}${convDif}</div>
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

  const produtoInfo = { unidCompra: r.unidCompra, porCaixa: r.porCaixa };
  const convDif = Math.abs(r.diferenca) >= (r.porCaixa || 999)
    ? ` (${converterParaCaixas(Math.abs(r.diferenca), produtoInfo)})`
    : '';

  const difClasse = r.diferenca < 0 ? 'aud-dif-neg' :
                    r.diferenca > 0 ? 'aud-dif-pos' : 'aud-dif-zero';

  return `
    <div class="aud-linha aud-linha-virada aud-linha-${r.status}">
      <div class="aud-nome">${r.nome}</div>
      <div class="aud-num">${fmtInt(r.fimAnterior)}</div>
      <div class="aud-num aud-num-real">${fmtInt(r.iniAtual)}</div>
      <div class="aud-num ${difClasse}">${fmtSgn(r.diferenca)}${convDif}</div>
      <div>${statusBadge}</div>
    </div>
  `;
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
    <div class="hist-aviso">
      <span>📋</span>
      <div>
        <strong>Auditorias fechadas</strong>
        <small>Ranking + gráficos + calendário serão adicionados na próxima entrega, conforme você acumular mais auditorias fechadas.</small>
      </div>
    </div>

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
}

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
    document.getElementById('aud-data-inicio').value = a.dataInicio;
    document.getElementById('aud-data-fim').value    = a.dataFim;
    dataInicio = a.dataInicio;
    dataFim    = a.dataFim;

    // Hidrata estado com o snapshot (dados congelados) — não recalcula
    resultadoAuditoria = a.resultado || [];
    // Reconstitui campos de produto (grupo, unidCompra, porCaixa) a partir do catálogo atual
    // — pra conversão de caixa/fardo funcionar no render
    resultadoAuditoria = resultadoAuditoria.map(r => {
      const bebida = BEBIDAS.find(b => slugify(b.nome) === r.slug);
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
