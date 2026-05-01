// ===== DASHBOARD — PRIMUS =====
// Carrega vendas do Firestore, calcula KPIs e renderiza gráficos com Chart.js

import { listarVendas, ultimaContagem, listarContagens } from './db.js';

// Cache em memória das vendas carregadas (evita consultas repetidas)
let vendasCache = [];
let chartsAtivos = {};

// ===== CONFIGURAÇÃO DE CORES (identidade Primus) =====
const cores = {
  vinho:         '#7C0047',
  vinhoLight:    '#a13376',
  amarelo:       '#FAB900',
  amareloLight:  '#fcd04d',
  verde:         '#1e6641',
  verdeLight:    '#4a9d71',
  azul:          '#1a5276',
  vermelho:      '#b5451b',
  cinza:         '#6b6761',
  paleta: ['#7C0047', '#FAB900', '#1e6641', '#1a5276', '#b5451b', '#a13376', '#4a9d71', '#fcd04d']
};

// ===== FORMATADORES =====
const fmtMoeda = v => 'R$ ' + (v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtInt   = v => Math.round(v || 0).toLocaleString('pt-BR');
const fmtData  = d => { const [y,m,dd] = d.split('-'); return `${dd}/${m}/${y}`; };
const fmtDataCurta = d => { const [y,m,dd] = d.split('-'); return `${dd}/${m}`; };

// ===== INICIALIZAÇÃO =====
export async function inicializarDashboard() {
  const container = document.getElementById('dashboard-container');
  if (!container) return;

  container.innerHTML = `
    <div class="filtro-periodo">
      <label>Período:</label>
      <button class="periodo-btn active" data-periodo="7d">7 dias</button>
      <button class="periodo-btn" data-periodo="30d">30 dias</button>
      <button class="periodo-btn" data-periodo="mes">Mês atual</button>
      <button class="periodo-btn" data-periodo="tudo">Tudo</button>
      <div class="periodo-custom">
        <input type="date" id="periodo-de">
        <span>até</span>
        <input type="date" id="periodo-ate">
        <button class="btn btn-ghost btn-sm" id="btn-aplicar-periodo">Aplicar</button>
      </div>
    </div>

    <div id="dash-loading" style="text-align:center;padding:60px">
      <span class="spinner"></span>
      <div style="margin-top:12px;color:var(--cinza-texto);font-size:13px">Carregando dados...</div>
    </div>

    <div id="dash-conteudo" style="display:none">
      <!-- KPIs -->
      <div class="kpi-grid" id="kpi-grid"></div>

      <!-- Gráficos linha 1: faturamento diário + mix subgrupos -->
      <div class="graficos-grid">
        <div class="card grafico-card">
          <div class="grafico-head">
            <h3>📈 Faturamento diário</h3>
            <span class="grafico-sub" id="sub-diario"></span>
          </div>
          <div class="grafico-wrap">
            <canvas id="chart-diario"></canvas>
          </div>
        </div>

        <div class="card grafico-card">
          <div class="grafico-head">
            <h3>📊 Composição das vendas</h3>
            <span class="grafico-sub" id="sub-composicao">clique num grupo pra ver os subgrupos</span>
          </div>
          <div id="composicao-wrap">
            <div id="composicao-grupos"></div>
            <div id="composicao-subgrupos-wrap" style="display:none">
              <div class="composicao-sub-header">
                <button class="btn-voltar" id="btn-voltar-grupos">← Voltar</button>
                <span id="composicao-sub-titulo"></span>
              </div>
              <div id="composicao-subgrupos"></div>
            </div>
          </div>
        </div>
      </div>

      <!-- Gráficos linha 2: horas + top 10 produtos -->
      <div class="graficos-grid">
        <div class="card grafico-card">
          <div class="grafico-head">
            <h3>🕐 Vendas por hora</h3>
            <span class="grafico-sub" id="sub-horas"></span>
          </div>
          <div class="grafico-wrap">
            <canvas id="chart-horas"></canvas>
          </div>
        </div>

        <div class="card grafico-card">
          <div class="grafico-head">
            <h3>🏆 Top 10 produtos (por unidades)</h3>
            <span class="grafico-sub" id="sub-produtos"></span>
          </div>
          <div class="grafico-wrap" style="height:340px">
            <canvas id="chart-produtos"></canvas>
          </div>
        </div>
      </div>

      <!-- Gráficos linha 3: top pratos + ranking entradas -->
      <div class="graficos-grid">
        <div class="card grafico-card">
          <div class="grafico-head">
            <h3>🍽️ Top 10 pratos (REFEIÇÕES)</h3>
            <span class="grafico-sub" id="sub-pratos"></span>
          </div>
          <div class="grafico-wrap" style="height:340px">
            <canvas id="chart-pratos"></canvas>
          </div>
        </div>

        <div class="card grafico-card">
          <div class="grafico-head">
            <h3>🥗 Ranking vendedor × entradas</h3>
            <span class="grafico-sub" id="sub-entradas"></span>
          </div>
          <div class="grafico-wrap" style="height:340px">
            <canvas id="chart-entradas"></canvas>
          </div>
        </div>
      </div>

      <!-- Ranking de vendedores -->
      <div class="card">
        <div class="grafico-head">
          <h3>👥 Ranking de vendedores</h3>
          <span class="grafico-sub" id="sub-vendedores"></span>
        </div>
        <div id="ranking-vendedores"></div>
      </div>

      <!-- Explorador de dados (filtros avançados) -->
      <div class="card" id="card-explorador">
        <div class="grafico-head">
          <h3>🔎 Explorador de dados</h3>
          <span class="grafico-sub" id="sub-explorador">Use o período selecionado no topo do dashboard</span>
        </div>

        <div class="explorador-filtros">
          <div class="filtro-group">
            <label>Dimensão</label>
            <select id="expl-dimensao">
              <option value="vendedor">Por vendedor</option>
              <option value="grupo">Por grupo</option>
              <option value="subgrupo">Por subgrupo</option>
              <option value="produto">Por produto</option>
              <option value="hora">Por hora</option>
              <option value="dia">Por dia</option>
            </select>
          </div>
          <div class="filtro-group">
            <label>Filtrar vendedor</label>
            <select id="expl-vendedor">
              <option value="">Todos</option>
            </select>
          </div>
          <div class="filtro-group">
            <label>Filtrar subgrupo</label>
            <select id="expl-subgrupo">
              <option value="">Todos</option>
            </select>
          </div>
          <div class="filtro-group">
            <label>Filtrar produto</label>
            <select id="expl-produto">
              <option value="">Todos</option>
            </select>
          </div>
          <div class="explorador-botoes">
            <button class="btn btn-primary btn-sm" id="btn-expl-aplicar">🔎 Aplicar</button>
            <button class="btn btn-ghost btn-sm" id="btn-expl-limpar">Limpar</button>
          </div>
        </div>

        <div id="explorador-resultado"></div>
      </div>
    </div>

    <div id="dash-vazio" style="display:none">
      <div class="empty-state">
        <div class="empty-icon">📊</div>
        <h3>Ainda não há dados de vendas</h3>
        <p>Para ver o dashboard, faça o upload do primeiro TXT do PDV na aba <strong>Vendas</strong>.</p>
        <button class="btn btn-primary" onclick="document.getElementById('nav-vendas').click()">
          Ir para Vendas →
        </button>
      </div>
    </div>
  `;

  // Listeners dos botões de período
  container.querySelectorAll('.periodo-btn').forEach(btn => {
    btn.onclick = () => {
      container.querySelectorAll('.periodo-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      // Limpa datas custom
      document.getElementById('periodo-de').value = '';
      document.getElementById('periodo-ate').value = '';
      aplicarPeriodo(btn.dataset.periodo);
    };
  });

  document.getElementById('btn-aplicar-periodo').onclick = () => {
    const de  = document.getElementById('periodo-de').value;
    const ate = document.getElementById('periodo-ate').value;
    if (!de || !ate) { alert('Selecione as duas datas.'); return; }
    container.querySelectorAll('.periodo-btn').forEach(b => b.classList.remove('active'));
    aplicarPeriodo('custom', de, ate);
  };

  // Carrega os dados na primeira vez
  await carregarDados();
  aplicarPeriodo('7d');
}

async function carregarDados() {
  try {
    vendasCache = await listarVendas({ limite: 365 });
  } catch (e) {
    console.error('Erro ao carregar vendas:', e);
    vendasCache = [];
  }
  document.getElementById('dash-loading').style.display = 'none';

  if (!vendasCache.length) {
    document.getElementById('dash-vazio').style.display = 'block';
    return;
  }

  document.getElementById('dash-conteudo').style.display = 'block';
}

// ===== FILTRO DE PERÍODO =====
function aplicarPeriodo(tipo, de = null, ate = null) {
  let inicio, fim;
  const hoje = new Date();
  fim = toIso(hoje);

  if (tipo === '7d') {
    const d = new Date(); d.setDate(d.getDate() - 6);
    inicio = toIso(d);
  } else if (tipo === '30d') {
    const d = new Date(); d.setDate(d.getDate() - 29);
    inicio = toIso(d);
  } else if (tipo === 'mes') {
    const d = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    inicio = toIso(d);
  } else if (tipo === 'custom') {
    inicio = de;
    fim = ate;
  } else { // tudo
    inicio = '0000-00-00';
    fim = '9999-99-99';
  }

  const vendasFiltradas = vendasCache.filter(v => v.id >= inicio && v.id <= fim);
  renderizarDashboard(vendasFiltradas);
}

// ===== RENDERIZAÇÃO =====
function renderizarDashboard(vendas) {
  if (!vendas.length) {
    document.getElementById('kpi-grid').innerHTML = `
      <div class="kpi-card" style="grid-column:1/-1;text-align:center;padding:30px">
        <div style="font-size:30px;margin-bottom:10px">📅</div>
        <div class="kpi-label">Sem dados neste período</div>
      </div>`;
    // Limpa gráficos antigos
    Object.values(chartsAtivos).forEach(c => c?.destroy?.());
    chartsAtivos = {};
    document.getElementById('ranking-vendedores').innerHTML = '<p class="text-muted text-center" style="padding:20px">Sem dados.</p>';
    document.getElementById('explorador-resultado').innerHTML = '<p class="text-muted text-center" style="padding:20px">Sem dados.</p>';
    return;
  }

  renderKPIs(vendas);
  renderGraficoDiario(vendas);
  renderComposicao(vendas);
  renderGraficoHoras(vendas);
  renderGraficoProdutos(vendas);
  renderGraficoPratos(vendas);
  renderGraficoEntradas(vendas);
  renderRankingVendedores(vendas);
  renderExplorador(vendas);
}

// ===== KPIs =====
function renderKPIs(vendas) {
  const totalFat = vendas.reduce((s, v) => s + (v.totais?.total || 0), 0);
  const totalItens = vendas.reduce((s, v) => s + (v.totais?.qtd || 0), 0);
  const ticket = totalItens ? totalFat / totalItens : 0;
  const diasOp = vendas.length;
  const mediaDiaria = diasOp ? totalFat / diasOp : 0;

  // Melhor vendedor do período
  const somaVendedores = {};
  vendas.forEach(v => {
    (v.vendedores || []).forEach(vd => {
      somaVendedores[vd.nome] = (somaVendedores[vd.nome] || 0) + (vd.total || 0);
    });
  });
  const melhorVend = Object.entries(somaVendedores).sort((a,b) => b[1] - a[1])[0];

  document.getElementById('kpi-grid').innerHTML = `
    <div class="kpi-card vinho">
      <div class="kpi-label">Faturamento</div>
      <div class="kpi-value">${fmtMoeda(totalFat)}</div>
      <div class="kpi-sub">${diasOp} ${diasOp === 1 ? 'dia' : 'dias'} de operação</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Ticket Médio</div>
      <div class="kpi-value">${fmtMoeda(ticket)}</div>
      <div class="kpi-sub">por item vendido</div>
    </div>
    <div class="kpi-card verde">
      <div class="kpi-label">Média Diária</div>
      <div class="kpi-value">${fmtMoeda(mediaDiaria)}</div>
      <div class="kpi-sub">faturamento / dia operado</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Itens Vendidos</div>
      <div class="kpi-value">${fmtInt(totalItens)}</div>
      <div class="kpi-sub">quantidade total</div>
    </div>
    <div class="kpi-card vinho" style="grid-column:span 2">
      <div class="kpi-label">🏆 Maior vendedor do período</div>
      <div class="kpi-value small">${melhorVend ? firstName(melhorVend[0]) : '—'}</div>
      <div class="kpi-sub">${melhorVend ? fmtMoeda(melhorVend[1]) : 'sem vendedores no período'}</div>
    </div>
  `;
}

// ===== GRÁFICO: FATURAMENTO DIÁRIO =====
function renderGraficoDiario(vendas) {
  chartsAtivos.diario?.destroy?.();
  const vendasOrd = [...vendas].sort((a, b) => a.id.localeCompare(b.id));
  const labels = vendasOrd.map(v => fmtDataCurta(v.id));
  const valores = vendasOrd.map(v => v.totais?.total || 0);

  const ctx = document.getElementById('chart-diario');
  if (!ctx) return;

  chartsAtivos.diario = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Faturamento',
        data: valores,
        borderColor: cores.vinho,
        backgroundColor: 'rgba(124, 0, 71, 0.08)',
        borderWidth: 3,
        fill: true,
        tension: 0.3,
        pointRadius: 5,
        pointBackgroundColor: cores.amarelo,
        pointBorderColor: cores.vinho,
        pointBorderWidth: 2,
        pointHoverRadius: 7,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => fmtMoeda(ctx.parsed.y)
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { callback: v => 'R$ ' + (v >= 1000 ? (v/1000).toFixed(0) + 'k' : v) }
        }
      }
    }
  });

  const media = valores.reduce((s,v) => s+v, 0) / (valores.length || 1);
  document.getElementById('sub-diario').textContent = `média: ${fmtMoeda(media)}`;
}

// ===== PAINEL: COMPOSIÇÃO DAS VENDAS (grupos → subgrupos) =====
// Substitui a pizza por um painel navegável:
// 1) Tela principal: 3 grupos (REFEICOES / BEBIDAS / DIVERSOS)
// 2) Ao clicar, mostra os subgrupos daquele grupo
// Muito mais legível que pizza com 16 fatias.
//
// Nota técnica: o TXT não associa subgrupo → grupo diretamente.
// Uso mapeamento baseado em nomes conhecidos (construído a partir dos dados reais
// observados nos arquivos da Primus).
function renderComposicao(vendas) {
  // Somar totais por grupo e por subgrupo
  const somaGrupos = {};
  const somaSubgrupos = {};
  const totalGeral = vendas.reduce((s,v) => s + (v.totais?.total || 0), 0);

  vendas.forEach(v => {
    (v.grupos || []).forEach(g => {
      if (!somaGrupos[g.nome]) somaGrupos[g.nome] = { qtd: 0, total: 0 };
      somaGrupos[g.nome].qtd   += g.qtd || 0;
      somaGrupos[g.nome].total += g.total || 0;
    });
    (v.subgrupos || []).forEach(s => {
      if (!somaSubgrupos[s.nome]) somaSubgrupos[s.nome] = { qtd: 0, total: 0 };
      somaSubgrupos[s.nome].qtd   += s.qtd || 0;
      somaSubgrupos[s.nome].total += s.total || 0;
    });
  });

  // Renderizar grupos (visão principal)
  const grupos = Object.entries(somaGrupos).sort((a,b) => b[1].total - a[1].total);
  const maior = grupos[0]?.[1]?.total || 1;

  const iconesGrupo = {
    'REFEICOES': '🍽️',
    'BEBIDAS': '🍺',
    'DIVERSOS': '🎲'
  };
  const coresGrupo = {
    'REFEICOES': 'var(--vinho)',
    'BEBIDAS': 'var(--amarelo)',
    'DIVERSOS': 'var(--verde-status)'
  };

  const htmlGrupos = grupos.map(([nome, v]) => {
    const pct = totalGeral ? (v.total / totalGeral) * 100 : 0;
    const barraLarg = (v.total / maior) * 100;
    const cor = coresGrupo[nome] || 'var(--vinho)';
    const icone = iconesGrupo[nome] || '📦';

    return `
      <div class="composicao-item composicao-clicavel" data-grupo="${nome}" style="--item-cor:${cor}">
        <div class="composicao-item-head">
          <div class="composicao-item-nome">
            <span class="composicao-item-icone">${icone}</span>
            <strong>${nome}</strong>
          </div>
          <div class="composicao-item-vals">
            <span class="composicao-item-valor">${fmtMoeda(v.total)}</span>
            <span class="composicao-item-pct">${pct.toFixed(1)}%</span>
          </div>
        </div>
        <div class="composicao-barra">
          <div class="composicao-barra-fill" style="width:${barraLarg}%; background:${cor}"></div>
        </div>
        <div class="composicao-item-meta">
          ${fmtInt(v.qtd)} unidades vendidas · clique pra ver subgrupos →
        </div>
      </div>
    `;
  }).join('');

  document.getElementById('composicao-grupos').innerHTML = htmlGrupos || '<p class="text-muted" style="padding:20px">Sem dados</p>';

  // Ao clicar em um grupo, mostra os subgrupos
  document.querySelectorAll('.composicao-clicavel').forEach(el => {
    el.onclick = () => {
      const grupo = el.dataset.grupo;
      mostrarSubgruposDe(grupo, somaSubgrupos, somaGrupos[grupo]?.total || 0, vendas);
    };
  });

  // Botão voltar
  const btnVoltar = document.getElementById('btn-voltar-grupos');
  if (btnVoltar) {
    btnVoltar.onclick = () => {
      document.getElementById('composicao-grupos').style.display = 'block';
      document.getElementById('composicao-subgrupos-wrap').style.display = 'none';
      document.getElementById('sub-composicao').textContent = 'clique num grupo pra ver os subgrupos';
    };
  }

  // Indicador no subtítulo
  document.getElementById('sub-composicao').textContent = `${grupos.length} grupos principais · ${fmtMoeda(totalGeral)}`;
}

function mostrarSubgruposDe(grupo, somaSubgrupos, totalGrupo, vendas) {
  // Mapeia cada subgrupo ao seu grupo usando os dados das vendas
  // (os TXT vêm em ordem: cada subgrupo aparece DEPOIS do seu grupo, então
  // usamos a ordem de aparição no arquivo ou inferência por nome)
  const subgruposPorGrupo = inferirSubgruposPorGrupo(vendas);
  const listaSubgrupos = (subgruposPorGrupo[grupo] || []).map(nome => ({
    nome,
    ...somaSubgrupos[nome]
  })).filter(s => s.total > 0);

  listaSubgrupos.sort((a,b) => b.total - a.total);

  if (!listaSubgrupos.length) {
    document.getElementById('composicao-subgrupos').innerHTML =
      '<p class="text-muted" style="padding:20px">Sem subgrupos identificados para este grupo</p>';
  } else {
    const maior = listaSubgrupos[0].total;
    const html = listaSubgrupos.map(s => {
      const pct = totalGrupo ? (s.total / totalGrupo) * 100 : 0;
      const barraLarg = (s.total / maior) * 100;
      return `
        <div class="composicao-item-sub">
          <div class="composicao-item-head">
            <span>${s.nome}</span>
            <div class="composicao-item-vals">
              <span class="composicao-item-valor">${fmtMoeda(s.total)}</span>
              <span class="composicao-item-pct">${pct.toFixed(1)}%</span>
            </div>
          </div>
          <div class="composicao-barra composicao-barra-sub">
            <div class="composicao-barra-fill" style="width:${barraLarg}%"></div>
          </div>
          <div class="composicao-item-meta">${fmtInt(s.qtd)} unidades</div>
        </div>
      `;
    }).join('');
    document.getElementById('composicao-subgrupos').innerHTML = html;
  }

  document.getElementById('composicao-sub-titulo').innerHTML =
    `Subgrupos de <strong>${grupo}</strong>`;
  document.getElementById('composicao-grupos').style.display = 'none';
  document.getElementById('composicao-subgrupos-wrap').style.display = 'block';
  document.getElementById('sub-composicao').textContent = `${listaSubgrupos.length} subgrupos em ${grupo}`;
}

// Infere qual subgrupo pertence a qual grupo, analisando os nomes.
// Mapeamento baseado nos dados reais observados no PDV da Primus.
function inferirSubgruposPorGrupo(vendas) {
  const mapa = {
    'REFEICOES': new Set(),
    'BEBIDAS': new Set(),
    'DIVERSOS': new Set()
  };

  // Dicionário heurístico — palavras que indicam BEBIDA
  const ehBebida = nome => {
    const up = nome.toUpperCase();
    const palavrasBebida = [
      'CERVEJA', 'REFRI', 'SUCO', 'CAFE', 'DOSE', 'DRINK', 'DRINKS',
      'AGUA', 'CHA', 'KOMBUCHA', 'CAIPIRINHA', 'CAIPIROSKA',
      'LONGNECK', 'SHOT', 'SODA', 'BEBIDA'
    ];
    return palavrasBebida.some(p => up.includes(p));
  };

  // Nomes que normalmente são DIVERSOS
  const ehDiversos = nome => {
    const up = nome.toUpperCase();
    return up.includes('DIVERSOS') || up === 'EMBALAGEM' ||
           up.includes('COPO') || up.includes('GUARNICAO') ||
           up.includes('REPOSICAO');
  };

  // Coleta todos os subgrupos que apareceram nos dados
  const todos = new Set();
  vendas.forEach(v => (v.subgrupos || []).forEach(s => todos.add(s.nome)));

  todos.forEach(nome => {
    if (ehDiversos(nome))      mapa['DIVERSOS'].add(nome);
    else if (ehBebida(nome))   mapa['BEBIDAS'].add(nome);
    else                       mapa['REFEICOES'].add(nome);
  });

  // Converte Sets em arrays
  return {
    REFEICOES: [...mapa['REFEICOES']],
    BEBIDAS:   [...mapa['BEBIDAS']],
    DIVERSOS:  [...mapa['DIVERSOS']]
  };
}

// ===== GRÁFICO: HORAS =====
function renderGraficoHoras(vendas) {
  chartsAtivos.horas?.destroy?.();
  // Soma por faixa de hora
  const soma = {};
  vendas.forEach(v => {
    (v.horas || []).forEach(h => {
      // Normaliza a faixa (o PDV usa "ás" ou "às")
      const chave = h.faixa.replace(/\s+/g, ' ').trim();
      if (!soma[chave]) soma[chave] = { total: 0, horaInicio: null };
      soma[chave].total += h.total || 0;
      // Extrai hora para ordenar
      const m = chave.match(/^(\d{1,2}):(\d{2})/);
      if (m) soma[chave].horaInicio = parseInt(m[1]);
    });
  });
  const entries = Object.entries(soma).sort((a,b) => (a[1].horaInicio||0) - (b[1].horaInicio||0));
  const labels = entries.map(e => {
    const m = e[0].match(/^(\d{1,2}):/);
    return m ? m[1] + 'h' : e[0];
  });
  const valores = entries.map(e => e[1].total);

  const ctx = document.getElementById('chart-horas');
  if (!ctx) return;

  chartsAtivos.horas = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Faturamento',
        data: valores,
        backgroundColor: cores.amarelo,
        borderColor: cores.vinho,
        borderWidth: 1,
        borderRadius: 6,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: { label: ctx => fmtMoeda(ctx.parsed.y) }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { callback: v => 'R$ ' + (v >= 1000 ? (v/1000).toFixed(0) + 'k' : v) }
        }
      }
    }
  });

  if (entries.length) {
    const pico = entries.slice().sort((a,b) => b[1].total - a[1].total)[0];
    document.getElementById('sub-horas').textContent = `pico: ${pico[0]} (${fmtMoeda(pico[1].total)})`;
  } else {
    document.getElementById('sub-horas').textContent = '';
  }
}

// ===== GRÁFICO: TOP PRODUTOS (por unidades vendidas) =====
function renderGraficoProdutos(vendas) {
  chartsAtivos.produtos?.destroy?.();
  const soma = {};
  vendas.forEach(v => {
    (v.produtos || []).forEach(p => {
      if (!soma[p.nome]) soma[p.nome] = { qtd: 0, total: 0 };
      soma[p.nome].qtd   += p.qtd || 0;
      soma[p.nome].total += p.total || 0;
    });
  });
  const top = Object.entries(soma).sort((a,b) => b[1].qtd - a[1].qtd).slice(0, 10);
  const labels = top.map(e => e[0].length > 28 ? e[0].slice(0,26) + '…' : e[0]);
  const qtds   = top.map(e => e[1].qtd);
  const valores = top.map(e => e[1].total);

  const ctx = document.getElementById('chart-produtos');
  if (!ctx) return;

  chartsAtivos.produtos = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Unidades vendidas',
        data: qtds,
        backgroundColor: cores.vinho,
        borderRadius: 6,
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => {
              const i = ctx.dataIndex;
              return `${fmtInt(qtds[i])} unidades · ${fmtMoeda(valores[i])}`;
            }
          }
        }
      },
      scales: {
        x: {
          beginAtZero: true,
          ticks: {
            callback: v => fmtInt(v) + ' un',
            precision: 0
          }
        }
      }
    }
  });

  document.getElementById('sub-produtos').textContent = `${Object.keys(soma).length} produtos no total`;
}

// ===== RANKING VENDEDORES =====
function renderRankingVendedores(vendas) {
  const soma = {};
  vendas.forEach(v => {
    (v.vendedores || []).forEach(vd => {
      if (!soma[vd.nome]) soma[vd.nome] = { total: 0, qtd: 0, dias: 0 };
      soma[vd.nome].total += vd.total || 0;
      soma[vd.nome].qtd   += vd.qtd || 0;
      soma[vd.nome].dias  += 1;
    });
  });
  const ranking = Object.entries(soma)
    .map(([nome, d]) => ({ nome, ...d, media: d.dias ? d.total / d.dias : 0 }))
    .sort((a,b) => b.total - a.total);

  if (!ranking.length) {
    document.getElementById('ranking-vendedores').innerHTML =
      '<p class="text-muted text-center" style="padding:20px">Sem vendedores no período.</p>';
    document.getElementById('sub-vendedores').textContent = '';
    return;
  }

  const maior = ranking[0].total;
  const medalhas = ['🥇', '🥈', '🥉'];

  document.getElementById('ranking-vendedores').innerHTML = ranking.map((v, i) => {
    const pct = maior ? (v.total / maior) * 100 : 0;
    const medal = medalhas[i] || `<span class="pos">#${i + 1}</span>`;
    const ticket = v.qtd ? v.total / v.qtd : 0;
    return `
      <div class="rank-item">
        <div class="rank-pos">${medal}</div>
        <div class="rank-info">
          <div class="rank-nome">${v.nome}</div>
          <div class="rank-meta">
            <span>${fmtInt(v.qtd)} itens</span>
            <span>·</span>
            <span>ticket médio ${fmtMoeda(ticket)}</span>
            <span>·</span>
            <span>${v.dias} ${v.dias === 1 ? 'dia' : 'dias'}</span>
          </div>
          <div class="rank-barra">
            <div class="rank-fill" style="width:${pct}%"></div>
          </div>
        </div>
        <div class="rank-valor">${fmtMoeda(v.total)}</div>
      </div>
    `;
  }).join('');

  document.getElementById('sub-vendedores').textContent = `${ranking.length} vendedores no período`;
}

// ===== GRÁFICO: TOP 10 PRATOS (grupo REFEIÇÕES) =====
// Regras definidas pelo usuário (Jhonathan):
// INCLUI: PEIXADA, FILE, VENTRECHA, MOJICA/MOQUECA, PINTADO, COMBINADO, INDIVIDUAL
// EXCLUI: PASSAPORT KIDS, BATATA FRITA, PASTEL, BOLINHO, CALDO, PETISCO,
//         PORCAO (porção de compartilhar), UNIDADE (petisco), KIDS que não é file mignon
function renderGraficoPratos(vendas) {
  chartsAtivos.pratos?.destroy?.();

  // Palavras que DEFINEM o produto como PRATO PRINCIPAL (lista positiva)
  const palavrasPratos = [
    'PEIXADA', 'FILE', 'VENTRECHA', 'MOJICA', 'MOQUECA',
    'PINTADO', 'COMBINADO', 'INDIVIDUAL', 'TAMBATINGA',
    'PARMEGIANA', 'COSTELINHA', 'FRANGO'
  ];

  // Palavras que EXCLUEM o produto (lista negativa, tem prioridade)
  const exclusoes = [
    'PASSAPORT',      // passaport kids = entrada
    'BATATA',         // batata frita = entrada
    'PASTEL',         // pastel de peixe/carne = entrada
    'BOLINHO',        // bolinho de peixe = entrada
    'CALDO',          // caldo de peixe = entrada
    'PETISCO',        // mix de petiscos = entrada
    'PORCAO',         // porção de ventrecha = pra compartilhar
    'UNIDADE',        // unidade de file/ventrecha = petisco
    'GUARNICAO',      // guarnição = acompanhamento
    'REPOSICAO'       // reposição de peça = não é venda real
  ];

  function ehPrato(nomeProduto) {
    const up = nomeProduto.toUpperCase();
    // Se contém exclusão, NÃO é prato
    if (exclusoes.some(x => up.includes(x))) return false;
    // Se contém palavra de prato, É prato
    return palavrasPratos.some(p => up.includes(p));
  }

  const soma = {};
  vendas.forEach(v => {
    (v.produtos || []).forEach(p => {
      if (ehPrato(p.nome)) {
        if (!soma[p.nome]) soma[p.nome] = { qtd: 0, total: 0 };
        soma[p.nome].qtd   += p.qtd || 0;
        soma[p.nome].total += p.total || 0;
      }
    });
  });

  const top = Object.entries(soma).sort((a,b) => b[1].qtd - a[1].qtd).slice(0, 10);

  if (!top.length) {
    document.getElementById('sub-pratos').textContent = 'sem dados de pratos no período';
    const ctx = document.getElementById('chart-pratos');
    if (ctx) {
      const ctx2d = ctx.getContext('2d');
      ctx2d.clearRect(0, 0, ctx.width, ctx.height);
    }
    return;
  }

  const labels = top.map(e => e[0].length > 28 ? e[0].slice(0,26) + '…' : e[0]);
  const qtds   = top.map(e => e[1].qtd);
  const valores = top.map(e => e[1].total);

  const ctx = document.getElementById('chart-pratos');
  if (!ctx) return;

  chartsAtivos.pratos = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Unidades vendidas',
        data: qtds,
        backgroundColor: cores.amarelo,
        borderColor: cores.vinho,
        borderWidth: 1,
        borderRadius: 6,
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => {
              const i = ctx.dataIndex;
              return `${fmtInt(qtds[i])} unidades · ${fmtMoeda(valores[i])}`;
            }
          }
        }
      },
      scales: {
        x: {
          beginAtZero: true,
          ticks: {
            callback: v => fmtInt(v) + ' un',
            precision: 0
          }
        }
      }
    }
  });

  const totalPratos = qtds.reduce((s,v) => s+v, 0);
  document.getElementById('sub-pratos').textContent = `${Object.keys(soma).length} pratos · ${fmtInt(totalPratos)} unid. no top 10`;
}

// ===== GRÁFICO: RANKING VENDEDOR × ENTRADAS =====
// Mostra quantas entradas cada vendedor vendeu.
// Se o dia tiver `vendedoresDetalhado` (upload Vendedor × Produto),
// usa valores REAIS. Caso contrário, estima por proporção.
//
// Palavras-chave de ENTRADAS (pra filtrar produtos do detalhado):
function renderGraficoEntradas(vendas) {
  chartsAtivos.entradas?.destroy?.();

  // Palavras que definem ENTRADAS no cardápio Primus
  // PASSAPORT KIDS é "outros" / categoria própria, não vai aqui
  const palavrasEntrada = [
    'BOLINHO', 'PASTEL', 'CALDO', 'PETISCO',
    'BATATA FRITA', 'MIX DE PETISCOS'
  ];

  const ehEntrada = nome => {
    const up = nome.toUpperCase();
    return palavrasEntrada.some(p => up.includes(p));
  };

  const somaVend = {};
  let algumDetalhado = false;  // pra saber se mostrar "dados reais" ou "estimado"

  vendas.forEach(v => {
    // 1) Se tem detalhado, usa ele (VALOR REAL)
    if (v.vendedoresDetalhado && v.vendedoresDetalhado.length > 0) {
      algumDetalhado = true;
      v.vendedoresDetalhado.forEach(vd => {
        const entradas = (vd.produtos || []).filter(p => ehEntrada(p.nome));
        if (!entradas.length) return;
        if (!somaVend[vd.nome]) somaVend[vd.nome] = { qtd: 0, total: 0, real: true };
        somaVend[vd.nome].qtd   += entradas.reduce((s,p) => s + (p.qtd || 0), 0);
        somaVend[vd.nome].total += entradas.reduce((s,p) => s + (p.total || 0), 0);
        somaVend[vd.nome].real = true;
      });
      return;  // não faz fallback neste dia
    }

    // 2) Fallback: estima por proporção (valor antigo)
    const entradasDia = (v.subgrupos || []).find(s =>
      s.nome.toUpperCase() === 'ENTRADAS'
    );
    if (!entradasDia) return;

    const totalItensDia = v.totais?.qtd || 0;
    if (!totalItensDia) return;

    const proporcao = entradasDia.qtd / totalItensDia;

    (v.vendedores || []).forEach(vd => {
      const entradasEstimadas = (vd.qtd || 0) * proporcao;
      const valorEstimado = (vd.total || 0) * (entradasDia.total / (v.totais?.total || 1));
      // Se ainda não tem entrada com 'real' marcado, marca como não-real (estimado)
      if (!somaVend[vd.nome]) somaVend[vd.nome] = { qtd: 0, total: 0, real: false };
      if (somaVend[vd.nome].real) return;  // já tem dado real desse vendedor em outro dia, não mistura
      somaVend[vd.nome].qtd   += entradasEstimadas;
      somaVend[vd.nome].total += valorEstimado;
    });
  });

  const entries = Object.entries(somaVend)
    .filter(e => e[1].qtd > 0)
    .sort((a,b) => b[1].qtd - a[1].qtd)
    .slice(0, 10);

  if (!entries.length) {
    document.getElementById('sub-entradas').textContent = 'sem dados de entradas no período';
    const ctx = document.getElementById('chart-entradas');
    if (ctx) {
      const ctx2d = ctx.getContext('2d');
      ctx2d.clearRect(0, 0, ctx.width, ctx.height);
    }
    return;
  }

  const labels = entries.map(e => firstName(e[0]));
  const qtds   = entries.map(e => Math.round(e[1].qtd));
  const valores = entries.map(e => e[1].total);

  const ctx = document.getElementById('chart-entradas');
  if (!ctx) return;

  chartsAtivos.entradas = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: algumDetalhado ? 'Entradas (real)' : 'Entradas (estimado)',
        data: qtds,
        backgroundColor: cores.verde,
        borderRadius: 6,
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: ctx => entries[ctx[0].dataIndex][0],
            label: ctx => {
              const i = ctx.dataIndex;
              const fonteDado = entries[i][1].real ? '(REAL)' : '(estimado)';
              return `${fmtInt(qtds[i])} entradas · ${fmtMoeda(valores[i])} ${fonteDado}`;
            }
          }
        }
      },
      scales: {
        x: {
          beginAtZero: true,
          ticks: {
            callback: v => fmtInt(v),
            precision: 0
          }
        }
      }
    }
  });

  if (algumDetalhado) {
    const todosReais = entries.every(e => e[1].real);
    document.getElementById('sub-entradas').innerHTML = todosReais
      ? '<span class="badge-real">✓ valores reais</span>'
      : '<span class="badge-real">✓ valores reais (alguns dias)</span> + estimados';
  } else {
    document.getElementById('sub-entradas').textContent = 'valores estimados por proporção';
  }
}

// ===== EXPLORADOR DE DADOS =====
let vendasExploradorAtual = [];

function renderExplorador(vendas) {
  vendasExploradorAtual = vendas;

  // Atualiza subtítulo com info do período ativo
  const subEl = document.getElementById('sub-explorador');
  if (subEl) {
    if (vendas.length > 0) {
      const datas = vendas.map(v => v.id).sort();
      const primeira = datas[0];
      const ultima   = datas[datas.length - 1];
      const diasOp = vendas.length;
      if (primeira === ultima) {
        subEl.textContent = `${fmtData(primeira)} · ${diasOp} dia`;
      } else {
        subEl.textContent = `${fmtData(primeira)} a ${fmtData(ultima)} · ${diasOp} dias`;
      }
    } else {
      subEl.textContent = 'sem dados no período selecionado';
    }
  }

  // Popula dropdowns de filtro
  const vendedores = new Set();
  const subgrupos = new Set();
  const produtos = new Set();
  vendas.forEach(v => {
    (v.vendedores || []).forEach(vd => vendedores.add(vd.nome));
    (v.subgrupos || []).forEach(s => subgrupos.add(s.nome));
    (v.produtos || []).forEach(p => produtos.add(p.nome));
  });

  popularDropdown('expl-vendedor', vendedores, 'Todos');
  popularDropdown('expl-subgrupo', subgrupos, 'Todos');
  popularDropdown('expl-produto', produtos, 'Todos');

  // Botão Aplicar — único que dispara o cálculo
  const btnAplicar = document.getElementById('btn-expl-aplicar');
  if (btnAplicar) btnAplicar.onclick = atualizarExplorador;

  // Enter em qualquer select também aplica
  ['expl-dimensao', 'expl-vendedor', 'expl-subgrupo', 'expl-produto'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('keydown', e => {
        if (e.key === 'Enter') atualizarExplorador();
      });
    }
  });

  const btnLimpar = document.getElementById('btn-expl-limpar');
  if (btnLimpar) {
    btnLimpar.onclick = () => {
      document.getElementById('expl-vendedor').value = '';
      document.getElementById('expl-subgrupo').value = '';
      document.getElementById('expl-produto').value = '';
      atualizarExplorador();
    };
  }

  // Renderiza estado inicial (sem filtros, por vendedor)
  atualizarExplorador();
}

function popularDropdown(id, items, todosLabel) {
  const sel = document.getElementById(id);
  if (!sel) return;
  const arr = [...items].sort((a,b) => a.localeCompare(b, 'pt-BR'));
  sel.innerHTML = `<option value="">${todosLabel}</option>` +
    arr.map(x => `<option value="${x}">${x}</option>`).join('');
}

// Constrói um mapa "nome do produto" → "nome do subgrupo" baseado em heurísticas.
// O TXT do PDV infelizmente não associa produto × subgrupo diretamente,
// então usamos regras construídas a partir dos dados reais da Primus Peixaria.
// Esse mapa é usado no Explorador pra permitir cruzamentos precisos.
function construirMapaProdutoSubgrupo(vendas) {
  const mapa = new Map();
  if (!vendas.length) return mapa;

  // Coleta todos os subgrupos e produtos que apareceram.
  // IMPORTANTE: nomes podem variar entre o relatório geral (v.produtos)
  // e o detalhado (v.vendedoresDetalhado[].produtos). Ex: o geral pode ter
  // "INDIVIDUAL PINTADO A PARMEGIANA" e o detalhado "INDIVIDUAL PINTADO PARMEGIANA".
  // Por isso adicionamos NOMES DOS DOIS no mapa — assim qualquer lookup acerta.
  const subgrupos = new Set();
  const produtos  = new Set();
  vendas.forEach(v => {
    (v.subgrupos || []).forEach(s => subgrupos.add(s.nome));
    (v.produtos  || []).forEach(p => produtos.add(p.nome));
    // Também coleta nomes do detalhado (vendedor × produto)
    (v.vendedoresDetalhado || []).forEach(vd => {
      (vd.produtos || []).forEach(p => produtos.add(p.nome));
    });
  });

  // Regras heurísticas — cada produto é classificado pelo nome.
  // Ordem importa: regras mais específicas vêm primeiro.
  function classificar(nome) {
    const up = nome.toUpperCase();

    // ENTRADAS
    if (['BOLINHO DE PEIXE','PASTEL DE PEIXE','PASTEL DE CARNE',
         'CALDO DE PEIXE','MIX DE PETISCOS','BATATA FRITA',
         'PORCAO DE VENTRECHA','UNIDADE DE FILE','UNIDADE DE VENTRECHA'
        ].some(x => up.includes(x))) return 'ENTRADAS';

    // PRATOS KIDS
    if (up.includes('KIDS') && !up.includes('PASSAPORT')) return 'PRATOS KIDS';

    // PASSAPORT KIDS (subgrupo próprio — não é "entrada" nem "kids")
    // O PDV classifica como "PRATOS KIDS" — confirma-se pelos dados
    if (up.includes('PASSAPORT')) return 'PRATOS KIDS';

    // PRATOS COMPARTILHADOS (INTEIRAS e alguns sem o "INTEIRA" explícito)
    if (up.includes('INTEIRA') ||
        up.includes('COMBINADO') ||
        up === 'PEIXADA ESPECIAL') return 'PRATOS COMPARTILHADOS';

    // ESPECIALIDADES DA CASA (metades de peixada/ventrecha)
    if (up.startsWith('1/2 ') ||
        up.includes('MOQUECA DE BANANA') ||
        up.includes('PINTADO A PALITO')) return 'ESPECIALIDADES DA CASA';

    // PRATOS INDIVIDUAIS
    // Tanto o geral quanto o detalhado usam "INDIVIDUAL" no nome
    // (ex: "INDIVIDUAL PINTADO A PARMEGIANA" / "INDIVIDUAL PINTADO PARMEGIANA")
    if (up.includes('INDIVIDUAL')) return 'PRATOS INDIVIDUAIS';

    // SUGESTOES DO CHEFE
    if (up.includes('FILE MIGNON FIT') || up.includes('COSTELINHA')) return 'SUGESTOES DO CHEFE';

    // GUARNICOES
    if (up.includes('GUARNICAO')) return 'GUARNICOES';

    // CERVEJAS
    if (['HEINEKEN','ORIGINAL','LOUVADA','STELLA','KOMBUCHA','CDB'].some(x => up.includes(x))) {
      return 'CERVEJAS';
    }

    // REFRIGERANTES E SUCOS (TONICA pega AGUA TONICA e AGGUA TONICA com typo)
    if (['COCA COLA','SPRITE','FANTA','KUAT','SUCO','SODA','CHA GELADO','AGUA','PREMIUM','TONICA']
        .some(x => up.includes(x))) return 'REFRIGERANTES E SUCOS';

    // CAFE ESPRESSO
    if (['CAFE','CAPPUCCINO','CHOCOLATE PROTEICO'].some(x => up.includes(x))) return 'CAFE ESPRESSO';

    // DOSES
    if (['DOSE','SHOT'].some(x => up.includes(x))) return 'DOSES';

    // DRINKS
    if (['CAIPIRINHA','CAIPIROSKA'].some(x => up.includes(x))) return 'DRINKS';

    // SORVETES (gelatos, sorbets, iogurtes congelados e similares)
    // Inclui IOGURTE porque alguns produtos da carta de sorvetes têm "iogurte" no nome
    // (ex: "Iogurte com Frutas Vermelhas") e o PDV não usa "GELATO" pra esses
    if (['GELATO','SORBET','IOGURTE','PALETA'].some(x => up.includes(x))) return 'SORVETES';

    // SOBREMESAS
    if (up.includes('BROWNIE')) return 'SOBREMESAS';

    // DIVERSOS (embalagens, copo, reposicao)
    if (['EMBALAGEM','COPO','REPOSICAO'].some(x => up.includes(x))) return 'DIVERSOS';

    return null;
  }

  produtos.forEach(nome => {
    const sg = classificar(nome);
    if (sg && subgrupos.has(sg)) {
      mapa.set(nome, sg);
    }
  });

  return mapa;
}

function atualizarExplorador() {
  const vendas = vendasExploradorAtual;
  const dimensao   = document.getElementById('expl-dimensao').value;
  const fVend      = document.getElementById('expl-vendedor').value;
  const fSubgrupo  = document.getElementById('expl-subgrupo').value;
  const fProduto   = document.getElementById('expl-produto').value;

  const resultado = document.getElementById('explorador-resultado');

  // Agrupa conforme a dimensão escolhida
  const buckets = {}; // { chave: { qtd, total, dias: Set } }

  // Detecta se houve uso de proporção (mostra aviso amarelo) ou detalhado (mostra badge verde)
  let usouProporcao = false;
  let usouDetalhado = false;

  // Monta mapa "produto → subgrupo" a partir dos dados de vendas (vem do relatório geral).
  // Usa nome exato do produto. Se dois dias têm o mesmo produto em subgrupos diferentes,
  // o último vence (mas na prática não acontece).
  const mapaProdutoSubgrupo = construirMapaProdutoSubgrupo(vendas);

  // ========== CAMINHO 1: USO DE DETALHADO (valores REAIS) ==========
  // Cenários cobertos:
  // - Dim=Produto  + filtro Vendedor        → detalhado direto
  // - Dim=Vendedor + filtro Produto         → detalhado direto
  // - Dim=Produto  + filtro Subgrupo        → detalhado + mapa
  // - Dim=Vendedor + filtro Subgrupo        → detalhado + mapa (o caso do print do Jhonathan!)
  // - Dim=Subgrupo + filtro Vendedor        → detalhado + mapa
  // - Dim=Subgrupo + filtro Produto         → detalhado + mapa
  const temSubgrupoMapeavel = fSubgrupo && mapaProdutoSubgrupo.size > 0;

  const podeUsarDetalhado =
    (dimensao === 'produto'  && (fVend || fSubgrupo)) ||
    (dimensao === 'vendedor' && (fProduto || temSubgrupoMapeavel)) ||
    (dimensao === 'subgrupo' && (fVend || fProduto));

  if (podeUsarDetalhado) {
    vendas.forEach(v => {
      if (!v.vendedoresDetalhado?.length) return;  // pula dias sem detalhado

      v.vendedoresDetalhado.forEach(vd => {
        if (fVend && vd.nome !== fVend) return;
        (vd.produtos || []).forEach(p => {
          if (fProduto && p.nome !== fProduto) return;

          // Se filtra por subgrupo, testa se o produto pertence a ele
          if (fSubgrupo) {
            const subgrupoDoProduto = mapaProdutoSubgrupo.get(p.nome);
            if (!subgrupoDoProduto || subgrupoDoProduto !== fSubgrupo) return;
          }

          // Descobre a chave do bucket conforme a dimensão
          let chave;
          if (dimensao === 'produto')        chave = p.nome;
          else if (dimensao === 'vendedor')  chave = vd.nome;
          else if (dimensao === 'subgrupo')  chave = mapaProdutoSubgrupo.get(p.nome) || '(sem subgrupo)';
          else                               chave = p.nome;

          if (!buckets[chave]) buckets[chave] = { qtd: 0, total: 0, dias: new Set() };
          buckets[chave].qtd   += p.qtd || 0;
          buckets[chave].total += p.total || 0;
          buckets[chave].dias.add(v.id);
          usouDetalhado = true;
        });
      });
    });

    // Se conseguiu preencher buckets pelo detalhado, não precisa cair na proporção
    if (Object.keys(buckets).length > 0) {
      return renderizarExploradorResultado(buckets, dimensao, { usouDetalhado: true, usouProporcao: false });
    }
  }

  // ========== CAMINHO 2: USO DE PROPORÇÃO / FILTRO DIRETO ==========
  vendas.forEach(v => {
    const dataDia = v.id;
    const totalDia = v.totais?.total || 0;
    const qtdDia   = v.totais?.qtd || 0;
    if (!totalDia) return;

    // Passo 1: pesos proporcionais dos filtros que não coincidem com a dimensão
    let pesoValor = 1;
    let pesoQtd   = 1;

    if (fVend && dimensao !== 'vendedor') {
      const vd = (v.vendedores || []).find(x => x.nome === fVend);
      if (!vd) return;
      pesoValor *= vd.total / totalDia;
      pesoQtd   *= (qtdDia ? vd.qtd / qtdDia : 0);
      usouProporcao = true;
    }

    if (fSubgrupo && dimensao !== 'subgrupo') {
      const sg = (v.subgrupos || []).find(x => x.nome === fSubgrupo);
      if (!sg) return;
      pesoValor *= sg.total / totalDia;
      pesoQtd   *= (qtdDia ? sg.qtd / qtdDia : 0);
      usouProporcao = true;
    }

    if (fProduto && dimensao !== 'produto') {
      const prd = (v.produtos || []).find(x => x.nome === fProduto);
      if (!prd) return;
      pesoValor *= prd.total / totalDia;
      pesoQtd   *= (qtdDia ? prd.qtd / qtdDia : 0);
      usouProporcao = true;
    }

    // Passo 2: fonte com filtro direto aplicado quando coincide com a dimensão
    let fonte;
    if (dimensao === 'vendedor') {
      fonte = (v.vendedores || []).filter(x => !fVend || x.nome === fVend);
    } else if (dimensao === 'grupo') {
      fonte = v.grupos || [];
    } else if (dimensao === 'subgrupo') {
      fonte = (v.subgrupos || []).filter(x => !fSubgrupo || x.nome === fSubgrupo);
    } else if (dimensao === 'produto') {
      fonte = (v.produtos || []).filter(x => !fProduto || x.nome === fProduto);
      // Se há filtro de subgrupo, restringe aos produtos que pertencem a esse subgrupo
      // (senão o rateio espalha o valor do subgrupo entre TODOS os produtos do dia,
      // gerando linhas absurdas como "COCA COLA" com R$ 2,58 num filtro de "PRATOS")
      if (fSubgrupo) {
        const produtosDoSubgrupo = produtosPertencentesAoSubgrupo(v, fSubgrupo, mapaProdutoSubgrupo);
        if (produtosDoSubgrupo) {
          fonte = fonte.filter(x => produtosDoSubgrupo.has(x.nome));
        }
        // Se produtosDoSubgrupo for null, é porque não consegui identificar nenhum
        // produto desse subgrupo — então melhor não mostrar nada do que mostrar lixo.
        else {
          fonte = [];
        }
      }
    } else if (dimensao === 'hora') {
      fonte = (v.horas || []).map(h => ({ ...h, nome: h.faixa }));
    } else if (dimensao === 'dia') {
      fonte = [{ nome: dataDia, qtd: qtdDia, total: totalDia }];
    } else {
      fonte = [];
    }

    fonte.forEach(item => {
      const chave = dimensao === 'dia' ? fmtData(dataDia) : item.nome;
      const itemValor = (item.total || 0) * pesoValor;
      const itemQtd   = (item.qtd || 0) * pesoQtd;

      if (itemValor < 0.01 && itemQtd < 0.01) return;

      if (!buckets[chave]) buckets[chave] = { qtd: 0, total: 0, dias: new Set() };
      buckets[chave].qtd   += itemQtd;
      buckets[chave].total += itemValor;
      buckets[chave].dias.add(dataDia);
    });
  });

  renderizarExploradorResultado(buckets, dimensao, { usouDetalhado, usouProporcao });
}

/**
 * Descobre quais produtos vendidos num dia pertencem ao subgrupo dado.
 * Estratégia (em ordem de confiabilidade):
 *  1) Se há `vendedoresDetalhado` (relatório real Vendedor×Produto) — usa esse cruzamento
 *     com o mapa de classificação heurística.
 *  2) Senão, usa só o mapa heurístico (todos os produtos do dia que se classificam no subgrupo).
 *
 * Retorna um Set de nomes de produto, ou null se não conseguiu identificar nenhum.
 */
function produtosPertencentesAoSubgrupo(v, subgrupo, mapaProdutoSubgrupo) {
  const produtosDoDia = (v.produtos || []).map(p => p.nome);
  const set = new Set();
  produtosDoDia.forEach(nome => {
    if (mapaProdutoSubgrupo.get(nome) === subgrupo) {
      set.add(nome);
    }
  });
  return set.size > 0 ? set : null;
}

function renderizarExploradorResultado(buckets, dimensao, flags) {
  const resultado = document.getElementById('explorador-resultado');
  const fVend      = document.getElementById('expl-vendedor').value;
  const fSubgrupo  = document.getElementById('expl-subgrupo').value;
  const fProduto   = document.getElementById('expl-produto').value;

  const ordenado = Object.entries(buckets)
    .map(([k, v]) => ({ chave: k, qtd: v.qtd, total: v.total, dias: v.dias.size }))
    .sort((a, b) => {
      if (dimensao === 'hora' || dimensao === 'dia') {
        return a.chave.localeCompare(b.chave);
      }
      // Ranking por UNIDADES (mais intuitivo que por faturamento)
      return b.qtd - a.qtd;
    });

  if (!ordenado.length) {
    resultado.innerHTML = '<p class="text-muted text-center" style="padding:30px">Sem dados para os filtros selecionados.</p>';
    return;
  }

  // Base das barras e percentual: UNIDADES
  const maior = Math.max(...ordenado.map(r => r.qtd));
  const totalGeral = ordenado.reduce((s, r) => s + r.total, 0);
  const qtdTotal = ordenado.reduce((s, r) => s + r.qtd, 0);

  let avisoProporcao = '';
  if (flags.usouDetalhado) {
    avisoProporcao = '<div class="expl-aviso expl-aviso-ok">✓ Valores REAIS — extraídos do relatório Vendedor × Produto</div>';
  } else if (flags.usouProporcao) {
    avisoProporcao = `<div class="expl-aviso">⚠️ Valores estimados por proporção — o TXT do PDV não cruza diretamente ${descreverFiltros(fVend, fSubgrupo, fProduto, dimensao)}. Pra ter valores reais, suba o relatório Vendedor × Produto na aba Vendas.</div>`;
  }

  // Colunas "Dias" e "Média/dia" só fazem sentido quando há agregação por múltiplos dias.
  // Na dimensão "dia", cada linha É um dia, então seria sempre 1 — redundante.
  const mostrarDias = dimensao !== 'dia';

  resultado.innerHTML = `
    <div class="expl-resumo">
      <div class="expl-resumo-item">
        <div class="expl-resumo-label">Registros</div>
        <div class="expl-resumo-val">${ordenado.length}</div>
      </div>
      <div class="expl-resumo-item">
        <div class="expl-resumo-label">Faturamento</div>
        <div class="expl-resumo-val vinho">${fmtMoeda(totalGeral)}</div>
      </div>
      <div class="expl-resumo-item">
        <div class="expl-resumo-label">Unidades</div>
        <div class="expl-resumo-val">${fmtInt(qtdTotal)}</div>
      </div>
    </div>
    ${avisoProporcao}
    <table class="expl-tabela">
      <thead>
        <tr>
          <th class="expl-th-pos">#</th>
          <th class="expl-th-chave">${dimensaoLabel(dimensao)}</th>
          <th class="expl-th-num">Unidades</th>
          <th class="expl-th-num">Faturamento</th>
          ${mostrarDias ? '<th class="expl-th-num" title="Dias em que este item teve venda no período">Dias</th>' : ''}
          ${mostrarDias ? '<th class="expl-th-num" title="Média de unidades por dia trabalhado">Média/dia</th>' : ''}
          <th class="expl-th-barra">Participação</th>
        </tr>
      </thead>
      <tbody>
        ${ordenado.slice(0, 30).map((r, i) => {
          const pct = maior ? (r.qtd / maior) * 100 : 0;
          const pctTotal = qtdTotal ? (r.qtd / qtdTotal) * 100 : 0;
          const mediaDia = r.dias > 0 ? (r.qtd / r.dias) : 0;
          return `
            <tr>
              <td class="expl-td-pos">${i + 1}</td>
              <td class="expl-td-chave" title="${r.chave}">${r.chave}</td>
              <td class="expl-td-num">${fmtInt(r.qtd)}</td>
              <td class="expl-td-num expl-td-vinho">${fmtMoeda(r.total)}</td>
              ${mostrarDias ? `<td class="expl-td-num">${r.dias}</td>` : ''}
              ${mostrarDias ? `<td class="expl-td-num">${mediaDia.toFixed(1)}</td>` : ''}
              <td class="expl-td-barra">
                <div class="expl-barra-wrap">
                  <div class="expl-barra-fill" style="width:${pct}%"></div>
                </div>
                <span class="expl-barra-pct">${pctTotal.toFixed(1)}%</span>
              </td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
    ${ordenado.length > 30 ? `<p class="text-muted text-center" style="padding:10px;font-size:11px">Mostrando top 30 de ${ordenado.length} registros. Use filtros pra refinar.</p>` : ''}
  `;
}

function descreverFiltros(fVend, fSubgrupo, fProduto, dimensao) {
  const ativos = [];
  if (fVend && dimensao !== 'vendedor')      ativos.push('vendedor');
  if (fSubgrupo && dimensao !== 'subgrupo')  ativos.push('subgrupo');
  if (fProduto && dimensao !== 'produto')    ativos.push('produto');
  if (ativos.length === 0) return 'esses filtros';
  if (ativos.length === 1) return ativos[0] + ' × ' + dimensao;
  return ativos.join(' × ') + ' × ' + dimensao;
}

function dimensaoLabel(d) {
  return {
    vendedor: 'Vendedor',
    grupo: 'Grupo',
    subgrupo: 'Subgrupo',
    produto: 'Produto',
    hora: 'Faixa de hora',
    dia: 'Dia'
  }[d] || d;
}

// ===== UTILS =====
function toIso(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function firstName(nome) {
  const partes = nome.split(/\s+/);
  if (partes.length <= 2) return nome;
  // Pega primeiro + último nome
  return `${partes[0]} ${partes[partes.length - 1]}`;
}

// Exporta função pra recarregar dados quando o usuário subir novo TXT
export async function recarregarDashboard() {
  vendasCache = [];
  await carregarDados();
  // Re-aplica o período atualmente selecionado
  const ativo = document.querySelector('.periodo-btn.active');
  aplicarPeriodo(ativo ? ativo.dataset.periodo : '7d');
}
