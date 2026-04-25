// ===== LISTA DE COMPRAS — PRIMUS =====
// Gera sugestão inteligente de compras cruzando:
// - Estoque atual (última contagem "ini" de bebidas)
// - Consumo médio dos últimos 14 dias (vendas do PDV)
// - Configuração: cobertura de 7 dias

import {
  listarContagens, listarVendas,
  listarFornecedores, salvarFornecedores,
  buscarUltimosPrecos, salvarPrecosCompra
} from './db.js';
import {
  slugify, FORNECEDORES_PADRAO,
  converterParaCaixas, arredondarParaCaixaCheia
} from './produtos.js';
import { obterBebidas } from './produtos-store.js';

// ===== CONFIGURAÇÃO =====
const JANELA_CONSUMO_DIAS = 14;   // média calculada sobre os últimos 14 dias
const COBERTURA_ALVO_DIAS = 7;    // sugestão cobre 7 dias
const ALERTA_CRITICO_DIAS = 2;    // < 2 dias = crítico (vermelho)
const ALERTA_ATENCAO_DIAS = 4;    // < 4 dias = atenção (amarelo)

// ===== ESTADO =====
let fornecedoresCache = [];
let sugestaoCache = [];           // produtos com cálculo pronto
let quantidadesAjustadas = {};    // slug → quantidade editada pelo usuário
let ultimosPrecos = {};           // slug → { valor, data, fornecedor }
let precosDigitados = {};         // slug → preço unit digitado agora
let bebidasCache = [];            // catálogo efetivo de bebidas (base + overrides)

const fmtMoeda = v => 'R$ ' + (v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtInt   = v => Math.round(v || 0).toLocaleString('pt-BR');
const fmtData  = d => { const [y,m,dd] = d.split('-'); return `${dd}/${m}/${y}`; };

// ===== INICIALIZAÇÃO =====
export async function inicializarCompras() {
  const container = document.getElementById('compras-container');
  if (!container) return;

  container.innerHTML = `
    <div class="card">
      <div class="grafico-head">
        <h3>🛒 Lista de Compras Inteligente</h3>
        <span class="grafico-sub" id="compras-sub">calculando...</span>
      </div>

      <div class="compras-config">
        <div class="compras-config-info">
          📊 Consumo médio dos últimos <strong>${JANELA_CONSUMO_DIAS} dias</strong>
          · Sugestão para cobrir <strong>${COBERTURA_ALVO_DIAS} dias</strong>
        </div>
        <div class="compras-acoes-topo">
          <button class="btn btn-ghost btn-sm" id="btn-fornecedores">⚙️ Gerenciar fornecedores</button>
          <button class="btn btn-ghost btn-sm" id="btn-recalcular">🔄 Recalcular</button>
        </div>
      </div>

      <div id="compras-loading" style="text-align:center;padding:40px">
        <span class="spinner"></span>
        <div style="margin-top:10px;color:var(--cinza-texto);font-size:13px">Cruzando estoque e consumo...</div>
      </div>

      <div id="compras-vazio" style="display:none">
        <div class="empty-state">
          <div class="empty-icon">📊</div>
          <h3>Dados insuficientes pra calcular</h3>
          <p id="compras-vazio-msg"></p>
        </div>
      </div>

      <div id="compras-resumo" style="display:none"></div>
      <div id="compras-lista" style="display:none"></div>
      <div id="compras-acoes-rodape" style="display:none"></div>
    </div>

    <!-- Modal: Gerenciar Fornecedores -->
    <div class="modal-backdrop" id="modal-fornecedores">
      <div class="modal-box" style="max-width:700px">
        <button class="modal-close" id="modal-forn-close">✕</button>
        <div class="modal-head">
          <h3>⚙️ Fornecedores e produtos</h3>
          <p>Agrupe produtos por fornecedor pra listas organizadas</p>
        </div>
        <div style="padding:16px 24px 24px">
          <div class="fornecedores-lista" id="fornecedores-lista"></div>
          <button class="btn btn-primary" id="btn-novo-fornecedor" style="margin-top:14px;width:100%">
            + Adicionar fornecedor
          </button>
          <button class="btn btn-ghost" id="btn-resetar-associacoes" style="margin-top:8px;width:100%;font-size:11px">
            🔄 Resetar associações para o padrão do catálogo
          </button>
        </div>
      </div>
    </div>
  `;

  document.getElementById('btn-fornecedores').onclick = abrirModalFornecedores;
  document.getElementById('btn-recalcular').onclick = carregarECalcular;
  document.getElementById('modal-forn-close').onclick = fecharModalFornecedores;

  await carregarECalcular();
}

// ===== CARREGAR DADOS E CALCULAR SUGESTÃO =====
async function carregarECalcular() {
  const loading = document.getElementById('compras-loading');
  const vazio   = document.getElementById('compras-vazio');
  const resumo  = document.getElementById('compras-resumo');
  const lista   = document.getElementById('compras-lista');
  const rodape  = document.getElementById('compras-acoes-rodape');

  loading.style.display = 'block';
  vazio.style.display   = 'none';
  resumo.style.display  = 'none';
  lista.style.display   = 'none';
  rodape.style.display  = 'none';

  try {
    // 0) Carrega o catálogo efetivo de bebidas (base + overrides do gestor).
    // Toda função abaixo usa `bebidasCache` em vez de importar BEBIDAS direto.
    bebidasCache = await obterBebidas();

    // 1) Busca a contagem MAIS RECENTE de bebidas (ini ou fin).
    // A lógica: o estoque atual é o que foi contado por último.
    // Se a última contagem foi "fin" (encerramento do dia), é o que vale.
    // Se foi "ini" (abertura), também vale.
    const todasContagens = await listarContagens({ limite: 200 });
    const contagensBebidas = todasContagens.filter(c => c.tipo === 'ini' || c.tipo === 'fin');

    if (!contagensBebidas.length) {
      mostrarVazio('Nenhuma contagem de bebidas encontrada. Peça pro barman fazer uma contagem primeiro.');
      return;
    }
    const ultimaContagem = contagensBebidas[0];  // já vem ordenada desc (data + criadoEm)

    // 2) Busca vendas dos últimos 14 dias
    const hoje = new Date();
    const inicio = new Date();
    inicio.setDate(inicio.getDate() - (JANELA_CONSUMO_DIAS - 1));
    const dataInicio = toIso(inicio);
    const vendas = await listarVendas({ dataInicio, limite: 365 });

    if (!vendas.length) {
      mostrarVazio('Nenhuma venda importada no período. Suba o TXT do PDV na aba Vendas primeiro.');
      return;
    }

    // 3) Busca fornecedores — se for a primeira vez, faz seed automático
    fornecedoresCache = await listarFornecedores();
    if (!fornecedoresCache.length) {
      fornecedoresCache = await criarFornecedoresPadrao();
    }

    // 4) Busca o último preço pago de cada produto (histórico)
    ultimosPrecos = await buscarUltimosPrecos();

    // 5) Calcula sugestão
    sugestaoCache = calcularSugestao(ultimaContagem, vendas);

    // 6) Renderiza
    quantidadesAjustadas = {};  // reset ao recalcular
    precosDigitados = {};        // reset de preços ao recalcular
    renderizar(ultimaContagem, vendas.length);

    loading.style.display = 'none';
  } catch (e) {
    console.error(e);
    loading.innerHTML = `<div class="preview-err">Erro: ${e.message}</div>`;
  }
}

function mostrarVazio(msg) {
  document.getElementById('compras-loading').style.display = 'none';
  document.getElementById('compras-vazio').style.display = 'block';
  document.getElementById('compras-vazio-msg').textContent = msg;
}

/**
 * Cria os fornecedores padrão (LOUVADA, AMBEV, SOLAR+, PRATA, JONG)
 * e associa automaticamente cada produto ao fornecedor definido no catálogo.
 * Executado apenas na primeira vez.
 */
async function criarFornecedoresPadrao() {
  // Começa com os fornecedores padrão, sem produtos associados ainda
  const lista = FORNECEDORES_PADRAO.map(f => ({
    id: f.id,
    nome: f.nome,
    telefone: f.telefone || '',
    produtos: []
  }));

  // Associa cada produto ao seu fornecedor (a partir do campo "fornecedor" no catálogo)
  bebidasCache.forEach(b => {
    if (!b.fornecedor) return;
    const forn = lista.find(f => f.nome === b.fornecedor);
    if (forn) {
      forn.produtos.push(slugify(b.nome));
    }
  });

  await salvarFornecedores(lista);
  return lista;
}

// ===== MOTOR DO CÁLCULO =====
// Para cada bebida:
//   estoque = qtd na última contagem (ini ou fin)
//   consumo = soma das qtd vendidas no período / dias com venda (média diária real)
//   cobertura = estoque / consumo (em dias)
//   sugerido = max(0, consumo * 7 - estoque)  (arredondado pra caixa cheia)
function calcularSugestao(contagem, vendas) {
  // Extrai estoque por produto, tratando as duas estruturas possíveis:
  //
  // Contagem tipo "ini" (Bebidas Início):
  //   { fr: 50, est: 30, total: 80, obs: '...' }  → estoque = total (ou fr+est)
  //
  // Contagem tipo "fin" (Bebidas Final):
  //   { abast: 10, final: 127, vendeu: -117, obs: '...' }  → estoque = final
  //   (o "final" é literalmente quantas unidades sobraram no fim do dia)
  const estoquePorSlug = {};
  const tipoContagem = contagem.tipo;

  Object.entries(contagem.itens || {}).forEach(([chave, v]) => {
    if (typeof v !== 'object' || v === null) return;

    // Contagem fin: chave tem sufixo "__fin" e estoque vem de "final"
    if (chave.endsWith('__fin')) {
      const slug = chave.replace(/__fin$/, '');
      estoquePorSlug[slug] = v.final || 0;
      return;
    }

    // Contagem ini: chave é o slug direto, estoque = fr + est (ou total se existir)
    const total = (typeof v.total === 'number' && v.total > 0)
      ? v.total
      : (v.fr || v.freezer || 0) + (v.est || v.estoque || 0);
    estoquePorSlug[chave] = total;
  });

  // Calcula consumo médio por produto, com matching fuzzy:
  // A contagem usa slugs tipo "heineken_600ml", mas as vendas usam nome "HEINEKEN 600ML"
  const consumoPorSlug = {};
  const diasComVenda = new Set();

  vendas.forEach(v => {
    diasComVenda.add(v.id);
    (v.produtos || []).forEach(p => {
      const slugProduto = slugify(p.nome);
      // Tenta match direto
      if (!consumoPorSlug[slugProduto]) consumoPorSlug[slugProduto] = 0;
      consumoPorSlug[slugProduto] += p.qtd || 0;
    });
  });

  const qtdDias = Math.max(diasComVenda.size, 1);

  // Monta sugestão para cada bebida do catálogo efetivo
  const sugestao = bebidasCache.map(bebida => {
    const slug = slugify(bebida.nome);
    const estoque = estoquePorSlug[slug] || 0;

    // Matching de consumo: tenta slug direto primeiro, depois variações
    let totalVendido = consumoPorSlug[slug] || 0;
    // Se não achou, tenta versões alternativas (ex: "Água" vs "Agua")
    if (totalVendido === 0) {
      const slugsSimilares = Object.keys(consumoPorSlug).filter(s =>
        slugsSemelhantes(s, slug)
      );
      if (slugsSimilares.length > 0) {
        totalVendido = slugsSimilares.reduce((sum, s) => sum + consumoPorSlug[s], 0);
      }
    }

    const consumoDia = totalVendido / qtdDias;
    const cobertura = consumoDia > 0 ? estoque / consumoDia : 999;
    const necessidadeAlvo = consumoDia * COBERTURA_ALVO_DIAS;
    const sugeridoBruto = Math.max(0, Math.ceil(necessidadeAlvo - estoque));
    // Arredonda pra caixa/fardo cheio quando aplicável
    const sugerido = arredondarParaCaixaCheia(sugeridoBruto, bebida);

    // Status
    let status = 'ok';
    if (consumoDia === 0 && estoque === 0) status = 'semdados';
    else if (cobertura < ALERTA_CRITICO_DIAS) status = 'critico';
    else if (cobertura < ALERTA_ATENCAO_DIAS) status = 'atencao';
    else if (cobertura < COBERTURA_ALVO_DIAS) status = 'medio';

    return {
      slug,
      nome: bebida.nome,
      grupo: bebida.grupo,
      unidCompra: bebida.unidCompra,
      porCaixa: bebida.porCaixa,
      estoque,
      consumoDia,
      cobertura,
      sugerido,
      status
    };
  });

  return sugestao;
}

// Compara dois slugs pra decidir se são o "mesmo" produto (matching fuzzy)
function slugsSemelhantes(a, b) {
  if (a === b) return true;
  // Remove plurais simples, underscores e números pra comparar
  const norm = s => s.replace(/[_\d]+/g, '').replace(/s$/, '');
  return norm(a) === norm(b);
}

// ===== RENDERIZAR =====
function renderizar(contagemUsada, totalDiasVendas) {
  const sub    = document.getElementById('compras-sub');
  const resumo = document.getElementById('compras-resumo');
  const lista  = document.getElementById('compras-lista');
  const rodape = document.getElementById('compras-acoes-rodape');

  const tipoLabel = contagemUsada.tipo === 'fin' ? 'Bebidas Final' :
                    contagemUsada.tipo === 'ini' ? 'Bebidas Início' :
                    contagemUsada.tipo;
  sub.innerHTML = `Última contagem: <strong>${fmtData(contagemUsada.data)}</strong> (${tipoLabel}) · Vendas de <strong>${totalDiasVendas} ${totalDiasVendas === 1 ? 'dia' : 'dias'}</strong>`;

  // Resumo superior: KPIs rápidos
  const criticos = sugestaoCache.filter(s => s.status === 'critico').length;
  const atencao  = sugestaoCache.filter(s => s.status === 'atencao').length;
  const aComprar = sugestaoCache.filter(s => s.sugerido > 0).length;
  const totalItens = sugestaoCache.reduce((sum, s) => sum + s.sugerido, 0);

  resumo.innerHTML = `
    <div class="compras-kpis">
      <div class="compras-kpi kpi-critico">
        <div class="compras-kpi-val">${criticos}</div>
        <div class="compras-kpi-label">CRÍTICOS (&lt;${ALERTA_CRITICO_DIAS} dias)</div>
      </div>
      <div class="compras-kpi kpi-atencao">
        <div class="compras-kpi-val">${atencao}</div>
        <div class="compras-kpi-label">ATENÇÃO (&lt;${ALERTA_ATENCAO_DIAS} dias)</div>
      </div>
      <div class="compras-kpi">
        <div class="compras-kpi-val">${aComprar}</div>
        <div class="compras-kpi-label">A COMPRAR</div>
      </div>
      <div class="compras-kpi kpi-destaque">
        <div class="compras-kpi-val">${fmtInt(totalItens)}</div>
        <div class="compras-kpi-label">UNIDADES SUGERIDAS</div>
      </div>
    </div>
  `;
  resumo.style.display = 'block';

  // Agrupa por fornecedor
  const agrupado = agruparPorFornecedor(sugestaoCache, fornecedoresCache);
  lista.innerHTML = agrupado.map(g => renderGrupoFornecedor(g)).join('');
  lista.style.display = 'block';

  // Ações no rodapé
  rodape.innerHTML = `
    <div class="compras-rodape">
      <div class="compras-total-geral" id="compras-total-geral"></div>
      <div class="compras-rodape-acoes">
        <button class="btn btn-ghost" id="btn-exportar-pdf">📄 Exportar PDF</button>
        <button class="btn btn-primary" id="btn-salvar-compra">💾 Salvar compra</button>
      </div>
    </div>
  `;
  rodape.style.display = 'block';

  document.getElementById('btn-exportar-pdf').onclick = exportarPDF;
  document.getElementById('btn-salvar-compra').onclick = salvarCompra;

  // Listeners nos inputs de qtd editável
  document.querySelectorAll('.compra-qtd-input').forEach(inp => {
    inp.addEventListener('input', e => {
      const slug = e.target.dataset.slug;
      const v = parseInt(e.target.value, 10) || 0;
      quantidadesAjustadas[slug] = v;

      // Atualiza o texto "= N caixas" ao lado do input
      const item = sugestaoCache.find(x => x.slug === slug);
      const convEl = document.querySelector(`[data-slug-conv="${slug}"]`);
      if (item && convEl) {
        const produtoInfo = { unidCompra: item.unidCompra, porCaixa: item.porCaixa };
        convEl.textContent = v > 0 ? converterParaCaixas(v, produtoInfo) : '';
      }

      atualizarTotaisRodape();
    });
  });

  // Listeners nos inputs de preço unitário (aceita 12,50 ou 12.50)
  document.querySelectorAll('.compra-preco-input').forEach(inp => {
    inp.addEventListener('input', e => {
      const slug = e.target.dataset.slug;
      const raw = e.target.value.replace(/[^\d,.]/g, '');
      // Converte "12,50" → 12.50; "12.5" fica 12.5
      const v = parseFloat(raw.replace(',', '.')) || 0;
      precosDigitados[slug] = v;
      atualizarTotaisRodape();
    });
  });
}

function agruparPorFornecedor(itens, fornecedores) {
  // Mapa slug → fornecedor
  const mapaForn = {};
  fornecedores.forEach(f => {
    (f.produtos || []).forEach(slug => { mapaForn[slug] = f; });
  });

  // Agrupa
  const grupos = {};
  itens.forEach(item => {
    const f = mapaForn[item.slug];
    const chave = f ? f.nome : '__sem_fornecedor__';
    if (!grupos[chave]) {
      grupos[chave] = {
        fornecedor: f || null,
        nome: f ? f.nome : 'Sem fornecedor cadastrado',
        itens: []
      };
    }
    grupos[chave].itens.push(item);
  });

  // Ordena: fornecedores cadastrados primeiro (ordem do cadastro), "sem fornecedor" por último
  const arr = Object.values(grupos);
  arr.sort((a, b) => {
    if (a.fornecedor && !b.fornecedor) return -1;
    if (!a.fornecedor && b.fornecedor) return 1;
    return a.nome.localeCompare(b.nome, 'pt-BR');
  });

  // Dentro de cada grupo: críticos primeiro, depois por cobertura crescente
  arr.forEach(g => {
    const ordemStatus = { critico: 0, atencao: 1, medio: 2, ok: 3, semdados: 4 };
    g.itens.sort((a, b) => {
      const ds = (ordemStatus[a.status] ?? 9) - (ordemStatus[b.status] ?? 9);
      if (ds !== 0) return ds;
      return a.cobertura - b.cobertura;
    });
  });

  return arr;
}

function renderGrupoFornecedor(g) {
  const qtdAComprar = g.itens.filter(i => (quantidadesAjustadas[i.slug] ?? i.sugerido) > 0).length;
  const telefone = g.fornecedor?.telefone
    ? `<span class="forn-tel">📱 ${g.fornecedor.telefone}</span>`
    : '';

  return `
    <div class="compras-grupo">
      <div class="compras-grupo-head">
        <h4>🏬 ${g.nome} ${telefone}</h4>
        <span class="compras-grupo-meta">${qtdAComprar} item(ns) a comprar</span>
      </div>
      <div class="compras-tabela">
        <div class="compras-linha compras-cab">
          <div>Produto</div>
          <div>Estoque</div>
          <div>Consumo/dia</div>
          <div>Cobertura</div>
          <div>Sugerido</div>
          <div>Comprar</div>
          <div>R$ Unit.</div>
        </div>
        ${g.itens.map(i => renderLinhaProduto(i)).join('')}
      </div>
    </div>
  `;
}

function renderLinhaProduto(i) {
  const qtdAtual = quantidadesAjustadas[i.slug] ?? i.sugerido;
  const coberturaTxt = i.cobertura >= 999 ? '—' :
                       i.cobertura >= 30  ? '30+ dias' :
                       `${i.cobertura.toFixed(1)} dias`;
  const statusBadge = {
    critico:  '<span class="compra-badge bad-critico">CRÍTICO</span>',
    atencao:  '<span class="compra-badge bad-atencao">ATENÇÃO</span>',
    medio:    '<span class="compra-badge bad-medio">MÉDIO</span>',
    ok:       '<span class="compra-badge bad-ok">OK</span>',
    semdados: '<span class="compra-badge bad-semdados">s/ dados</span>'
  }[i.status];

  // Conversão pra caixa/fardo (mostra ao lado do sugerido e da qtd final)
  const produtoInfo = { unidCompra: i.unidCompra, porCaixa: i.porCaixa };
  const convSugerido = i.sugerido > 0 ? converterParaCaixas(i.sugerido, produtoInfo) : '';
  const convAtual    = qtdAtual > 0   ? converterParaCaixas(qtdAtual,   produtoInfo) : '';

  // Último preço pago (referência histórica)
  const ultimoPreco = ultimosPrecos[i.slug];
  const ultimoPrecoTxt = ultimoPreco?.valor
    ? `<div class="compra-ultimo-preco" title="Pago em ${fmtData(ultimoPreco.data)}">último: ${fmtMoeda(ultimoPreco.valor)}</div>`
    : `<div class="compra-ultimo-preco compra-ultimo-vazio">sem histórico</div>`;

  // Preço digitado agora (se já digitou nessa sessão)
  const precoAtual = precosDigitados[i.slug] ?? '';

  return `
    <div class="compras-linha ${i.status}">
      <div class="compra-nome">
        <div>${i.nome}</div>
        <div class="compra-grupo-label">${i.grupo}</div>
      </div>
      <div class="compra-num">${fmtInt(i.estoque)}</div>
      <div class="compra-num">${i.consumoDia.toFixed(1)}</div>
      <div class="compra-cobertura">${coberturaTxt} ${statusBadge}</div>
      <div class="compra-sugerido">
        <div class="compra-num">${i.sugerido > 0 ? fmtInt(i.sugerido) : '—'}</div>
        ${convSugerido ? `<div class="compra-conv">${convSugerido}</div>` : ''}
      </div>
      <div class="compra-final">
        <input type="number" class="compra-qtd-input" min="0" step="1"
          data-slug="${i.slug}" value="${qtdAtual}">
        <div class="compra-conv compra-conv-final" data-slug-conv="${i.slug}">${convAtual}</div>
      </div>
      <div class="compra-preco">
        <input type="text" class="compra-preco-input" inputmode="decimal"
          data-slug="${i.slug}" value="${precoAtual}" placeholder="${ultimoPreco?.valor ? ultimoPreco.valor.toFixed(2).replace('.', ',') : '0,00'}">
        ${ultimoPrecoTxt}
      </div>
    </div>
  `;
}

function atualizarTotaisRodape() {
  // Atualiza "qtd a comprar" por grupo
  const grupos = document.querySelectorAll('.compras-grupo');
  grupos.forEach(g => {
    const inputs = g.querySelectorAll('.compra-qtd-input');
    const qtdItens = Array.from(inputs).filter(inp => parseInt(inp.value, 10) > 0).length;
    const meta = g.querySelector('.compras-grupo-meta');
    if (meta) meta.textContent = `${qtdItens} item(ns) a comprar`;
  });

  // Calcula total geral em R$ (soma qtd × preco)
  let totalGeral = 0;
  let itensComPreco = 0;
  let itensAComprar = 0;
  sugestaoCache.forEach(i => {
    const qtd = quantidadesAjustadas[i.slug] ?? i.sugerido;
    if (qtd > 0) {
      itensAComprar++;
      const preco = precosDigitados[i.slug] || 0;
      if (preco > 0) {
        totalGeral += qtd * preco;
        itensComPreco++;
      }
    }
  });

  const totalEl = document.getElementById('compras-total-geral');
  if (totalEl) {
    if (itensComPreco > 0) {
      const pct = Math.round((itensComPreco / itensAComprar) * 100);
      totalEl.innerHTML = `
        <div class="total-label">Total preenchido (${itensComPreco}/${itensAComprar} · ${pct}%)</div>
        <div class="total-valor">${fmtMoeda(totalGeral)}</div>
      `;
      totalEl.style.display = 'block';
    } else {
      totalEl.style.display = 'none';
    }
  }
}

// ===== AÇÕES =====

async function salvarCompra() {
  // Coleta todos os itens com preço digitado E qtd > 0
  const itensComPreco = [];
  sugestaoCache.forEach(i => {
    const qtd = quantidadesAjustadas[i.slug] ?? i.sugerido;
    const preco = precosDigitados[i.slug] || 0;
    if (qtd > 0 && preco > 0) {
      itensComPreco.push({
        slug: i.slug,
        nome: i.nome,
        qtd,
        precoUnit: preco
      });
    }
  });

  if (itensComPreco.length === 0) {
    mostrarToast('Preencha pelo menos 1 preço pra salvar.', 'err');
    return;
  }

  const btn = document.getElementById('btn-salvar-compra');
  const txtOriginal = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Salvando...';

  try {
    // Agrupa por fornecedor (pra passar info de fornecedor no metadado)
    // Como cada item pode ter fornecedor diferente, salvamos um bulk
    const gravados = await salvarPrecosCompra(itensComPreco, '');
    mostrarToast(`${gravados} preço(s) salvos no histórico! 💰`, 'ok');

    // Recarrega últimos preços pra mostrar na tela
    ultimosPrecos = await buscarUltimosPrecos();

    // Re-renderiza a lista pra mostrar "último pago" atualizado
    const agrupado = agruparPorFornecedor(sugestaoCache, fornecedoresCache);
    const lista = document.getElementById('compras-lista');
    lista.innerHTML = agrupado.map(g => renderGrupoFornecedor(g)).join('');

    // Re-anexa listeners (porque re-renderizou)
    reatacharListeners();

    btn.innerHTML = '✓ Salvo!';
    setTimeout(() => { btn.innerHTML = txtOriginal; btn.disabled = false; }, 2000);
  } catch (e) {
    console.error(e);
    mostrarToast('Erro ao salvar: ' + e.message, 'err');
    btn.innerHTML = txtOriginal;
    btn.disabled = false;
  }
}

// Re-anexa listeners nos inputs após re-render (chamado por salvarCompra)
function reatacharListeners() {
  document.querySelectorAll('.compra-qtd-input').forEach(inp => {
    inp.addEventListener('input', e => {
      const slug = e.target.dataset.slug;
      const v = parseInt(e.target.value, 10) || 0;
      quantidadesAjustadas[slug] = v;
      const item = sugestaoCache.find(x => x.slug === slug);
      const convEl = document.querySelector(`[data-slug-conv="${slug}"]`);
      if (item && convEl) {
        const produtoInfo = { unidCompra: item.unidCompra, porCaixa: item.porCaixa };
        convEl.textContent = v > 0 ? converterParaCaixas(v, produtoInfo) : '';
      }
      atualizarTotaisRodape();
    });
  });

  document.querySelectorAll('.compra-preco-input').forEach(inp => {
    inp.addEventListener('input', e => {
      const slug = e.target.dataset.slug;
      const raw = e.target.value.replace(/[^\d,.]/g, '');
      const v = parseFloat(raw.replace(',', '.')) || 0;
      precosDigitados[slug] = v;
      atualizarTotaisRodape();
    });
  });
}

function exportarPDF() {
  // Usa jsPDF se disponível (carregado via CDN na página)
  if (typeof window.jspdf === 'undefined') {
    mostrarToast('jsPDF não carregado. Impressão com a janela do navegador.', 'err');
    window.print();
    return;
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const agrupado = agruparPorFornecedor(sugestaoCache, fornecedoresCache);
  const dataHoje = fmtData(toIso(new Date()));

  // Filtra só os que têm qtd a comprar
  const gruposFiltrados = agrupado.map(g => ({
    ...g,
    itens: g.itens.filter(i => (quantidadesAjustadas[i.slug] ?? i.sugerido) > 0)
  })).filter(g => g.itens.length > 0);

  if (!gruposFiltrados.length) {
    mostrarToast('Nenhum item a comprar no momento.', 'err');
    return;
  }

  // ========== CABEÇALHO DA PÁGINA ==========
  doc.setFillColor(124, 0, 71);  // vinho
  doc.rect(0, 0, 210, 22, 'F');
  doc.setTextColor(255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('PRIMUS PEIXARIA', 15, 10);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text('Lista de Compras — Controle Interno', 15, 16);
  doc.text(dataHoje, 195, 16, { align: 'right' });

  // ========== CONTEÚDO ==========
  let y = 30;
  const marginL = 12;
  const marginR = 198;

  // Colunas: Produto | Qtd | Un | Conv | Último R$ | R$ unit. | R$ total
  const colX = {
    produto: marginL + 2,
    qtd:     105,
    un:      115,
    conv:    129,
    ultimo:  158,
    unit:    178,
    total:   marginR - 2
  };

  // Cabeçalho de tabela
  function desenharCabecalhoTabela(yPos) {
    doc.setFillColor(30, 30, 30);
    doc.rect(marginL, yPos - 4, marginR - marginL, 6, 'F');
    doc.setTextColor(255);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    doc.text('PRODUTO',   colX.produto,  yPos);
    doc.text('QTD',       colX.qtd,      yPos, { align: 'right' });
    doc.text('UN',        colX.un,       yPos, { align: 'right' });
    doc.text('CAIXA/FARDO', colX.conv,   yPos);
    doc.text('ÚLT. R$',   colX.ultimo,   yPos, { align: 'right' });
    doc.text('R$ UNIT.',  colX.unit,     yPos, { align: 'right' });
    doc.text('R$ TOTAL',  colX.total,    yPos, { align: 'right' });
    doc.setTextColor(0);
    return yPos + 3;
  }

  // Quebra de página
  function verificarQuebra(yAtual, espacoNecessario = 10) {
    if (yAtual + espacoNecessario > 285) {
      doc.addPage();
      return 15;
    }
    return yAtual;
  }

  let totalGeralUnidades = 0;
  let totalGeralItens = 0;

  gruposFiltrados.forEach((g, idx) => {
    y = verificarQuebra(y, 20);

    // Título do fornecedor (bloco vinho com nome)
    doc.setFillColor(124, 0, 71);
    doc.rect(marginL, y, marginR - marginL, 7, 'F');
    doc.setTextColor(255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(g.nome, colX.produto, y + 5);

    // Telefone alinhado à direita no título (se tiver)
    if (g.fornecedor?.telefone) {
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.text(`Tel: ${g.fornecedor.telefone}`, marginR - 2, y + 5, { align: 'right' });
    }
    doc.setTextColor(0);
    y += 10;

    // Cabeçalho da tabela
    y = desenharCabecalhoTabela(y + 5);
    y += 3;  // espaço adicional antes da primeira linha

    // Linhas de produtos
    let subtotalUnidades = 0;
    let subtotalItens = 0;

    g.itens.forEach(i => {
      y = verificarQuebra(y, 6);

      const qtd = quantidadesAjustadas[i.slug] ?? i.sugerido;
      subtotalUnidades += qtd;
      subtotalItens++;

      const produtoInfo = { unidCompra: i.unidCompra, porCaixa: i.porCaixa };
      // Conversão compacta pro PDF: "10 cx" ou "3 fd + 2un" etc
      const conv = conversaoCurta(qtd, produtoInfo);

      doc.setFontSize(8.5);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(0);
      // Nome (cortado se for muito longo)
      const nomeCurto = i.nome.length > 36 ? i.nome.slice(0, 34) + '…' : i.nome;
      doc.text(nomeCurto, colX.produto, y);

      doc.text(String(qtd), colX.qtd, y, { align: 'right' });
      doc.setTextColor(120);
      doc.text('un', colX.un, y, { align: 'right' });
      doc.text(conv, colX.conv, y);

      // Último preço pago (referência histórica) - cinza pra destacar que é só referência
      const ultimoPreco = ultimosPrecos[i.slug];
      if (ultimoPreco?.valor) {
        doc.setTextColor(100);
        doc.setFont('helvetica', 'italic');
        doc.text(fmtMoeda(ultimoPreco.valor), colX.ultimo, y, { align: 'right' });
        doc.setFont('helvetica', 'normal');
      } else {
        doc.setTextColor(180);
        doc.text('—', colX.ultimo, y, { align: 'right' });
      }
      doc.setTextColor(0);

      // Linhas de preenchimento pra R$ unit. e R$ total
      doc.setDrawColor(180);
      doc.setLineWidth(0.2);
      // R$ unit. - linha tracejada
      doc.line(colX.unit - 15, y + 0.8, colX.unit, y + 0.8);
      // R$ total - linha tracejada
      doc.line(colX.total - 15, y + 0.8, colX.total, y + 0.8);

      // Linha horizontal separadora (muito sutil)
      doc.setDrawColor(230);
      doc.setLineWidth(0.15);
      doc.line(marginL, y + 2.5, marginR, y + 2.5);

      y += 5.5;
    });

    // Total do fornecedor
    y += 1;
    doc.setFillColor(245, 243, 240);
    doc.rect(marginL, y - 3, marginR - marginL, 6, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(80);
    doc.text(`${subtotalItens} ${subtotalItens === 1 ? 'item' : 'itens'}`, colX.produto, y + 1);
    doc.setTextColor(124, 0, 71);
    doc.text(`Subtotal: ${subtotalUnidades} un`, colX.qtd + 15, y + 1, { align: 'right' });
    // Espaço pra preencher total do fornecedor em R$
    doc.setTextColor(80);
    doc.setFont('helvetica', 'normal');
    doc.text('R$', colX.unit - 18, y + 1);
    doc.setDrawColor(124, 0, 71);
    doc.setLineWidth(0.5);
    doc.line(colX.unit - 15, y + 1.5, colX.total, y + 1.5);

    totalGeralUnidades += subtotalUnidades;
    totalGeralItens += subtotalItens;
    y += 10;
  });

  // ========== RODAPÉ COM TOTAL GERAL ==========
  y = verificarQuebra(y, 20);
  doc.setFillColor(30, 30, 30);
  doc.rect(marginL, y, marginR - marginL, 10, 'F');
  doc.setTextColor(255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('TOTAL GERAL', colX.produto, y + 6.5);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(`${totalGeralItens} itens · ${totalGeralUnidades} unidades`, colX.qtd + 15, y + 6.5, { align: 'right' });
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('R$', colX.unit - 18, y + 6.5);
  doc.setDrawColor(250, 185, 0);  // amarelo
  doc.setLineWidth(0.6);
  doc.line(colX.unit - 15, y + 7.5, colX.total, y + 7.5);
  y += 14;

  // ========== LEGENDA/DATA ==========
  doc.setTextColor(130);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'italic');
  doc.text('Preencha os campos em branco com os valores pagos. Gerado pelo Sistema Primus em ' + dataHoje, marginL, y);

  doc.save(`lista_compras_${dataHoje.replace(/\//g, '-')}.pdf`);
  mostrarToast('PDF gerado!', 'ok');
}

// Versão curta de conversão pra caber no PDF
// Ex: "10 cx", "3 cx + 7 un", "5 fd"
function conversaoCurta(qtd, produto) {
  if (!produto?.unidCompra || !produto?.porCaixa || produto.porCaixa <= 1) return '';
  if (qtd <= 0) return '';
  const caixas = Math.floor(qtd / produto.porCaixa);
  const resto  = qtd % produto.porCaixa;
  const sigla = produto.unidCompra === 'fardo' ? 'fd' : 'cx';
  if (caixas === 0) return `${resto} un`;
  if (resto === 0)   return `${caixas} ${sigla}`;
  return `${caixas} ${sigla} + ${resto} un`;
}

// ===== MODAL DE FORNECEDORES =====

function abrirModalFornecedores() {
  // Garantia: se chegou aqui antes do catálogo carregar (clique muito rápido,
  // ou recarregamento parcial), busca o catálogo de novo antes de abrir
  if (!bebidasCache.length) {
    obterBebidas().then(b => {
      bebidasCache = b;
      _abrirModalFornecedoresAgora();
    });
    return;
  }
  _abrirModalFornecedoresAgora();
}

function _abrirModalFornecedoresAgora() {
  renderizarFornecedoresModal();
  document.getElementById('modal-fornecedores').classList.add('open');

  document.getElementById('btn-novo-fornecedor').onclick = novoFornecedor;
  document.getElementById('btn-resetar-associacoes').onclick = resetarAssociacoes;
  document.getElementById('modal-fornecedores').onclick = e => {
    if (e.target.id === 'modal-fornecedores') fecharModalFornecedores();
  };
}

/**
 * Reseta todas as associações produto→fornecedor para o padrão definido no catálogo (produtos.js).
 * Mantém os fornecedores existentes (nome, telefone), só atualiza a lista de produtos de cada um.
 */
async function resetarAssociacoes() {
  if (!confirm(
    'Isso vai ZERAR todas as associações atuais e refazer baseado no catálogo padrão.\n\n' +
    'Fornecedores (nome, telefone) são preservados, mas a lista de produtos de cada um é refeita.\n\n' +
    'Continuar?'
  )) return;

  // Zera produtos de todos os fornecedores existentes
  fornecedoresCache.forEach(f => { f.produtos = []; });

  // Re-associa baseado no catálogo efetivo
  bebidasCache.forEach(b => {
    if (!b.fornecedor) return;
    const forn = fornecedoresCache.find(f => f.nome === b.fornecedor);
    if (forn) {
      forn.produtos.push(slugify(b.nome));
    }
  });

  // Se algum fornecedor do catálogo não existir, cria
  FORNECEDORES_PADRAO.forEach(padrao => {
    if (!fornecedoresCache.find(f => f.nome === padrao.nome)) {
      const produtos = bebidasCache
        .filter(b => b.fornecedor === padrao.nome)
        .map(b => slugify(b.nome));
      fornecedoresCache.push({
        id: padrao.id,
        nome: padrao.nome,
        telefone: '',
        produtos
      });
    }
  });

  await salvarFornecedores(fornecedoresCache);
  mostrarToast('Associações resetadas para o padrão! ✓', 'ok');
  renderizarFornecedoresModal();
}

function fecharModalFornecedores() {
  document.getElementById('modal-fornecedores').classList.remove('open');
  // Recarrega sugestão pra refletir novos agrupamentos
  carregarECalcular();
}

function renderizarFornecedoresModal() {
  const div = document.getElementById('fornecedores-lista');
  if (!fornecedoresCache.length) {
    div.innerHTML = '<p class="text-muted" style="text-align:center;padding:20px">Nenhum fornecedor cadastrado ainda.</p>';
    return;
  }

  div.innerHTML = fornecedoresCache.map((f, idx) => `
    <div class="fornecedor-card" data-idx="${idx}">
      <div class="fornecedor-head">
        <input type="text" class="fornecedor-nome-input" value="${escapeHtml(f.nome)}"
               data-campo="nome" data-idx="${idx}" placeholder="Nome do fornecedor">
        <input type="text" class="fornecedor-tel-input" value="${escapeHtml(f.telefone || '')}"
               data-campo="telefone" data-idx="${idx}" placeholder="Telefone (opcional)">
        <button class="btn btn-danger btn-sm" onclick="removerFornecedor(${idx})" title="Remover fornecedor">🗑️</button>
      </div>
      <div class="fornecedor-produtos">
        <label class="fornecedor-produtos-label">Produtos fornecidos:</label>
        <div class="fornecedor-chips">
          ${bebidasCache.map(b => {
            const slug = slugify(b.nome);
            const marcado = (f.produtos || []).includes(slug);
            return `
              <label class="chip-produto ${marcado ? 'ativo' : ''}">
                <input type="checkbox" data-idx="${idx}" data-slug="${slug}"
                       ${marcado ? 'checked' : ''}>
                <span>${b.nome}</span>
              </label>
            `;
          }).join('')}
        </div>
      </div>
    </div>
  `).join('');

  // Listeners para salvar ao digitar/marcar
  div.querySelectorAll('.fornecedor-nome-input, .fornecedor-tel-input').forEach(inp => {
    inp.onblur = async () => {
      const idx = +inp.dataset.idx;
      const campo = inp.dataset.campo;
      fornecedoresCache[idx][campo] = inp.value.trim();
      await salvarFornecedores(fornecedoresCache);
    };
  });

  div.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.onchange = async () => {
      const idx = +cb.dataset.idx;
      const slug = cb.dataset.slug;
      if (!fornecedoresCache[idx].produtos) fornecedoresCache[idx].produtos = [];
      const lista = fornecedoresCache[idx].produtos;
      if (cb.checked) {
        if (!lista.includes(slug)) lista.push(slug);
      } else {
        const i = lista.indexOf(slug);
        if (i >= 0) lista.splice(i, 1);
      }
      // Feedback visual no chip
      cb.closest('.chip-produto').classList.toggle('ativo', cb.checked);
      await salvarFornecedores(fornecedoresCache);
    };
  });
}

async function novoFornecedor() {
  const nome = prompt('Nome do novo fornecedor:');
  if (!nome || !nome.trim()) return;
  fornecedoresCache.push({
    id: Date.now().toString(),
    nome: nome.trim(),
    telefone: '',
    produtos: []
  });
  await salvarFornecedores(fornecedoresCache);
  renderizarFornecedoresModal();
}

window.removerFornecedor = async function(idx) {
  const f = fornecedoresCache[idx];
  if (!f) return;
  if (!confirm(`Remover fornecedor "${f.nome}"?\n\nOs produtos dele voltam para "Sem fornecedor cadastrado".`)) return;
  fornecedoresCache.splice(idx, 1);
  await salvarFornecedores(fornecedoresCache);
  renderizarFornecedoresModal();
};

// ===== UTILS =====
function toIso(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

function mostrarToast(msg, tipo = '') {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'toast show ' + tipo;
  setTimeout(() => t.className = 'toast', 2800);
}
