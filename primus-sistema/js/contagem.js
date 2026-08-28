// ===== CONTAGEM — PRIMUS =====
// Baseado no contagem_primus.html original, mas salvando no Firestore.

import { slugify } from './produtos.js';
import { obterBebidas, obterSorvetes } from './produtos-store.js';
import { exigirPerfil, logout } from './auth.js';
import { salvarContagem, hoje, listarContagens, atualizarContagem, buscarAuditoriaFechada } from './db.js';

// Garante sessão válida — barman, gerente ou gestor podem contar
const sessao = exigirPerfil(['barman', 'gerente', 'gestor']);
if (!sessao) throw new Error('sem sessão');

// ===== ESTADO =====
let tipoAtual = null;
const dados = {}; // { id: { est, frPrinc, frAux, rec, qtd, obs, total } }
let editandoContagemId = null; // id do doc quando editando um dia existente (senão null = novo)
let modoAtual = 'contar';      // 'contar' | 'calendario'
let _calMes = null;            // mês exibido no calendário
let _contagensCache = null;    // cache das contagens (recarrega ao abrir o calendário)

// ===== HEADER DO USUÁRIO =====
function iniciais(nome) {
  return nome.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
}

document.getElementById('user-avatar').textContent = iniciais(sessao.nome);
document.getElementById('user-name').textContent = sessao.nome;
document.getElementById('user-perfil').textContent = sessao.perfil;

// Se for gestor, mostra botão pra ir pro painel
if (sessao.perfil === 'gestor') {
  document.getElementById('btn-painel-gestor').style.display = 'inline-flex';
}

// Menu dropdown
const userChip = document.getElementById('user-chip');
const userMenu = document.getElementById('user-menu');
userChip.onclick = (e) => {
  e.stopPropagation();
  userMenu.classList.toggle('open');
};
document.addEventListener('click', () => userMenu.classList.remove('open'));
document.getElementById('btn-logout').onclick = logout;

// ===== AJUSTE DE GRID PRA 3 LOCAIS (Estoque + Fz. Principal + Fz. Auxiliar) =====
// O layout base tinha 2 campos numéricos (freezer/estoque). Agora são 3.
// Injeta o grid-template-columns aqui pra não depender de editar o CSS da página.
(function ajustarGridLocais() {
  const st = document.createElement('style');
  st.textContent = `
    /* INÍCIO: Produto | Estoque | Fz.Princ | Fz.Aux | Total | Obs */
    .col-headers.layout-beb, .produto-row.layout-beb {
      display: grid;
      grid-template-columns: minmax(120px,2fr) 1fr 1fr 1fr 1fr minmax(90px,1.4fr);
      gap: 6px; align-items: center;
    }
    /* FINAL: Produto | Estoque | Fz.Princ | Fz.Aux | Total | Receb | Obs */
    .col-headers.layout-fin, .produto-row.layout-fin {
      display: grid;
      grid-template-columns: minmax(120px,2fr) 1fr 1fr 1fr 1fr 1fr minmax(90px,1.4fr);
      gap: 6px; align-items: center;
    }
  `;
  document.head.appendChild(st);
})();

// ===== DATA PADRÃO =====
document.getElementById('data-input').value = hoje();

// ===== SELEÇÃO DE TIPO =====
window.selecionarTipo = async function(tipo) {
  // Por padrão é um NOVO lançamento (carregarParaEditar sobrescreve isto depois)
  editandoContagemId = null;
  document.getElementById('data-input').removeAttribute('readonly');
  const _bnr = document.getElementById('edit-banner');
  _bnr.style.display = 'none';
  _bnr.style.background = ''; _bnr.style.color = ''; _bnr.style.borderLeftColor = '';
  document.getElementById('btn-salvar').innerHTML = '💾 Salvar Contagem';
  tipoAtual = tipo;
  ['ini','fin','sorv'].forEach(t => {
    document.getElementById('btn-'+t).classList.toggle('active', t===tipo);
  });
  document.getElementById('progresso-bar').style.display = 'flex';
  document.getElementById('bottom-bar').style.display = 'flex';
  await renderizarFormulario();
  atualizarProgresso();
};

// ===== RENDER FORMULÁRIO =====
async function renderizarFormulario() {
  const main = document.getElementById('main-content');
  // Loading enquanto busca o catálogo (chamada assíncrona ao Firebase)
  main.innerHTML = '<div class="tela-inicio"><div class="icon">⏳</div><h2>Carregando catálogo...</h2></div>';

  // Limpa estado ao trocar de tipo
  Object.keys(dados).forEach(k => delete dados[k]);

  // Busca o catálogo efetivo (base + overrides do gestor)
  const lista = tipoAtual === 'sorv'
    ? await obterSorvetes()
    : await obterBebidas();

  // Limpa o loading e parte pra renderização
  main.innerHTML = '';

  if (tipoAtual === 'sorv') {
    renderizarSorvetes(main, lista);
    return;
  }

  const grupos = {};
  lista.forEach(item => {
    if (!grupos[item.grupo]) grupos[item.grupo] = [];
    grupos[item.grupo].push(item);
  });

  Object.entries(grupos).forEach(([grupo, itens]) => {
    const div = document.createElement('div');
    div.className = 'grupo';

    const [icon, ...nomePartes] = grupo.split(' ');
    div.innerHTML = `
      <div class="grupo-header">
        <span class="grupo-icon">${icon}</span>
        <span class="grupo-nome">${nomePartes.join(' ')}</span>
        <span class="grupo-count">${itens.length} itens</span>
      </div>`;

    const colHeader = document.createElement('div');
    if (tipoAtual === 'ini') {
      colHeader.className = 'col-headers layout-beb';
      colHeader.innerHTML = `
        <div class="col-header">Produto</div>
        <div class="col-header">Estoque</div>
        <div class="col-header">Fz. Principal</div>
        <div class="col-header">Fz. Auxiliar</div>
        <div class="col-header">Total</div>
        <div class="col-header">Obs</div>`;
    } else { // fin
      colHeader.className = 'col-headers layout-fin';
      colHeader.innerHTML = `
        <div class="col-header">Produto</div>
        <div class="col-header">Estoque</div>
        <div class="col-header">Fz. Principal</div>
        <div class="col-header">Fz. Auxiliar</div>
        <div class="col-header">Total</div>
        <div class="col-header">Receb.</div>
        <div class="col-header">Obs</div>`;
    }
    div.appendChild(colHeader);

    itens.forEach(item => {
      const id = slugify(item.nome);
      const tagKS = item.ks ? '<span class="tag-ks">KS</span>' : '';
      const tagSaindo = item.saindo ? '<span class="tag-saindo">saindo</span>' : '';
      const nomeProd = `<div class="prod-nome">${item.nome}${tagKS}${tagSaindo}</div>`;
      const obsInput = `<textarea class="obs-input" id="${id}_obs" placeholder="obs..." rows="1" oninput="atualizarObs('${id}',this)"></textarea>`;

      const row = document.createElement('div');

      if (tipoAtual === 'ini') {
        row.className = 'produto-row layout-beb';
        row.innerHTML = `
          ${nomeProd}
          <input class="num-input" type="number" min="0" inputmode="numeric" placeholder="0" id="${id}_est" oninput="atualizar('${id}','est',this)" onfocus="this.select()">
          <input class="num-input" type="number" min="0" inputmode="numeric" placeholder="0" id="${id}_frPrinc" oninput="atualizar('${id}','frPrinc',this)" onfocus="this.select()">
          <input class="num-input" type="number" min="0" inputmode="numeric" placeholder="0" id="${id}_frAux" oninput="atualizar('${id}','frAux',this)" onfocus="this.select()">
          <div class="total-val" id="${id}_tot">—</div>
          ${obsInput}`;
      } else {
        row.className = 'produto-row layout-fin';
        row.innerHTML = `
          ${nomeProd}
          <input class="num-input" type="number" min="0" inputmode="numeric" placeholder="0" id="${id}_est" oninput="atualizar('${id}','est',this)" onfocus="this.select()">
          <input class="num-input" type="number" min="0" inputmode="numeric" placeholder="0" id="${id}_frPrinc" oninput="atualizar('${id}','frPrinc',this)" onfocus="this.select()">
          <input class="num-input" type="number" min="0" inputmode="numeric" placeholder="0" id="${id}_frAux" oninput="atualizar('${id}','frAux',this)" onfocus="this.select()">
          <div class="total-val" id="${id}_tot">—</div>
          <input class="num-input" type="number" min="0" inputmode="numeric" placeholder="0" id="${id}_rec" oninput="atualizar('${id}','rec',this)" onfocus="this.select()">
          ${obsInput}`;
      }

      div.appendChild(row);
    });

    main.appendChild(div);
  });
}

// ===== SORVETES (INÍCIO + FINAL na mesma folha) =====
// Recebe a lista já carregada do produtos-store (catálogo efetivo).
function renderizarSorvetes(main, lista) {
  const grupos = {};
  lista.forEach(item => {
    if (!grupos[item.grupo]) grupos[item.grupo] = [];
    grupos[item.grupo].push(item);
  });

  // SEÇÃO INÍCIO
  const divIniSep = document.createElement('div');
  divIniSep.innerHTML = `<div class="secao-sep-sorv">🌅 INÍCIO DO DIA — Quantidade em estoque</div>`;
  main.appendChild(divIniSep);

  Object.entries(grupos).forEach(([grupo, itens]) => {
    const div = document.createElement('div');
    div.className = 'grupo';
    const [icon, ...nomePartes] = grupo.split(' ');
    div.innerHTML = `<div class="grupo-header"><span class="grupo-icon">${icon}</span><span class="grupo-nome">${nomePartes.join(' ')}</span><span class="grupo-count">${itens.length} itens</span></div>`;
    const colHeader = document.createElement('div');
    colHeader.className = 'col-headers layout-sorv';
    colHeader.innerHTML = `<div class="col-header">Produto</div><div class="col-header">Quantidade</div><div class="col-header">Obs</div>`;
    div.appendChild(colHeader);

    itens.forEach(item => {
      const id = slugify(item.nome) + '__ini';
      const row = document.createElement('div');
      row.className = 'produto-row layout-sorv';
      row.innerHTML = `
        <div class="prod-nome">${item.nome}</div>
        <input class="num-input" type="number" min="0" inputmode="numeric" placeholder="0" id="${id}_qtd" oninput="atualizar('${id}','qtd',this)" onfocus="this.select()">
        <textarea class="obs-input" id="${id}_obs" placeholder="obs..." rows="1" oninput="atualizarObs('${id}',this)"></textarea>`;
      div.appendChild(row);
    });
    main.appendChild(div);
  });

  // SEÇÃO FINAL
  const divFinSep = document.createElement('div');
  divFinSep.innerHTML = `<div class="secao-sep-sorv" style="margin-top:20px">🌙 FINAL DO DIA — Contagem + Abastecimento</div>`;
  main.appendChild(divFinSep);

  Object.entries(grupos).forEach(([grupo, itens]) => {
    const div = document.createElement('div');
    div.className = 'grupo';
    const [icon, ...nomePartes] = grupo.split(' ');
    div.innerHTML = `<div class="grupo-header"><span class="grupo-icon">${icon}</span><span class="grupo-nome">${nomePartes.join(' ')}</span><span class="grupo-count">${itens.length} itens</span></div>`;
    const colHeader = document.createElement('div');
    colHeader.className = 'col-headers layout-sorv-fin';
    colHeader.innerHTML = `<div class="col-header">Produto</div><div class="col-header">Abast.</div><div class="col-header">Final</div><div class="col-header">Vendeu</div><div class="col-header">Obs</div>`;
    div.appendChild(colHeader);

    itens.forEach(item => {
      const baseId = slugify(item.nome);
      const id = baseId + '__fin';
      const row = document.createElement('div');
      row.className = 'produto-row layout-sorv-fin';
      row.innerHTML = `
        <div class="prod-nome">${item.nome}</div>
        <input class="num-input" type="number" min="0" inputmode="numeric" placeholder="0" id="${id}_abast" oninput="atualizar('${id}','abast',this); calcularVendeu('${baseId}')" onfocus="this.select()">
        <input class="num-input" type="number" min="0" inputmode="numeric" placeholder="0" id="${id}_final" oninput="atualizar('${id}','final',this); calcularVendeu('${baseId}')" onfocus="this.select()">
        <div class="total-val" id="${id}_vendeu">—</div>
        <textarea class="obs-input" id="${id}_obs" placeholder="obs..." rows="1" oninput="atualizarObs('${id}',this)"></textarea>`;
      div.appendChild(row);
    });
    main.appendChild(div);
  });
}

// ===== ATUALIZAR =====
window.atualizar = function(id, campo, input) {
  const val = parseInt(input.value) || 0;
  if (!dados[id]) dados[id] = {};
  dados[id][campo] = val;
  input.classList.toggle('filled', input.value !== '' && input.value !== '0');

  // Total de bebidas = Estoque + Freezer Bar Principal + Freezer Bar Auxiliar
  if (campo === 'est' || campo === 'frPrinc' || campo === 'frAux') {
    const est     = parseInt(document.getElementById(id+'_est')?.value)     || 0;
    const frPrinc = parseInt(document.getElementById(id+'_frPrinc')?.value) || 0;
    const frAux   = parseInt(document.getElementById(id+'_frAux')?.value)   || 0;
    const tot = est + frPrinc + frAux;
    dados[id].total = tot;
    const totEl = document.getElementById(id+'_tot');
    if (totEl) {
      totEl.textContent = tot > 0 ? tot : '—';
      totEl.style.color = tot > 0 ? 'var(--vinho)' : '#ccc';
    }
  }

  const row = input.closest('.produto-row');
  if (row) {
    const allInputs = row.querySelectorAll('input, textarea');
    const algumPreenchido = [...allInputs].some(i => i.value !== '');
    row.classList.toggle('preenchido', algumPreenchido);
  }

  atualizarProgresso();
};

window.atualizarObs = function(id, input) {
  if (!dados[id]) dados[id] = {};
  dados[id].obs = input.value.trim();
  const row = input.closest('.produto-row');
  if (row) row.classList.toggle('preenchido', true);
};

// Calcula "vendeu" para sorvetes no final: (início) + abastecido - final
window.calcularVendeu = function(baseId) {
  const ini  = parseInt(document.getElementById(baseId+'__ini_qtd')?.value)    || 0;
  const abast = parseInt(document.getElementById(baseId+'__fin_abast')?.value) || 0;
  const fin   = parseInt(document.getElementById(baseId+'__fin_final')?.value) || 0;
  const el = document.getElementById(baseId+'__fin_vendeu');
  if (!el) return;
  if (abast === 0 && fin === 0) { el.textContent = '—'; el.style.color = '#ccc'; return; }
  const vendeu = ini + abast - fin;
  el.textContent = vendeu;
  el.style.color = vendeu < 0 ? 'var(--vermelho)' : 'var(--verde)';
  if (!dados[baseId+'__fin']) dados[baseId+'__fin'] = {};
  dados[baseId+'__fin'].vendeu = vendeu;
};

// ===== PROGRESSO =====
function atualizarProgresso() {
  const rows = document.querySelectorAll('.produto-row');
  const preenchidos = document.querySelectorAll('.produto-row.preenchido').length;
  const total = rows.length;
  const pct = total ? Math.round((preenchidos / total) * 100) : 0;
  document.getElementById('prog-texto').textContent = `${preenchidos} / ${total} preenchidos`;
  document.getElementById('prog-fill').style.width = pct + '%';
  document.getElementById('prog-pct').textContent = pct + '%';
}

// ===== SALVAR =====
document.getElementById('btn-salvar').onclick = async () => {
  if (!tipoAtual) { alert('Selecione o tipo de contagem.'); return; }
  const data = document.getElementById('data-input').value;
  if (!data) { alert('Informe a data.'); return; }

  const preenchidos = Object.keys(dados).filter(k => {
    const d = dados[k];
    return Object.keys(d).some(kk => d[kk] !== 0 && d[kk] !== '' && d[kk] != null);
  });
  if (!preenchidos.length) {
    alert('Nenhum item preenchido.');
    return;
  }

  // Só salva os itens que foram preenchidos
  const itens = {};
  preenchidos.forEach(k => itens[k] = dados[k]);

  const btn = document.getElementById('btn-salvar');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Salvando...';

  try {
    if (editandoContagemId) {
      // Edição de dia existente: atualiza o doc (não cria duplicado)
      await atualizarContagem(editandoContagemId, itens, { editadoPor: sessao.nome });
    } else {
      await salvarContagem({
        tipo: tipoAtual,
        data,
        autor: { id: sessao.id, nome: sessao.nome, perfil: sessao.perfil },
        itens
      });
    }
    mostrarToast(editandoContagemId ? 'Contagem atualizada!' : 'Contagem salva com sucesso!', 'ok');
    btn.innerHTML = '✓ Salvo!';
    setTimeout(() => {
      if (confirm('Contagem salva. Deseja fazer outra contagem?')) {
        location.reload();
      } else {
        btn.disabled = false;
        btn.innerHTML = '💾 Salvar Contagem';
      }
    }, 500);
  } catch (e) {
    console.error(e);
    mostrarToast('Erro ao salvar: ' + e.message, 'err');
    btn.disabled = false;
    btn.innerHTML = '💾 Salvar Contagem';
  }
};

function mostrarToast(msg, tipo = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show ' + tipo;
  setTimeout(() => t.className = 'toast', 2800);
}

// ============================================================================
// ETAPA 3A — Aba Calendário do funcionário: ver dias lançados e editar.
// ============================================================================

// Alterna entre "Contar" (formulário) e "Calendário".
window.trocarModo = function(modo) {
  modoAtual = modo;
  const contar = modo === 'contar';
  document.getElementById('modo-contar').classList.toggle('active', contar);
  document.getElementById('modo-cal').classList.toggle('active', !contar);

  document.querySelector('.tipo-selector').style.display = contar ? '' : 'none';
  document.querySelector('.data-bar').style.display      = contar ? '' : 'none';
  document.getElementById('main-content').style.display  = contar ? '' : 'none';
  document.getElementById('cal-view').style.display      = contar ? 'none' : '';

  if (contar) {
    // Volta pro formulário; barras só aparecem se um tipo estiver selecionado
    if (tipoAtual) {
      document.getElementById('progresso-bar').style.display = 'flex';
      document.getElementById('bottom-bar').style.display = 'flex';
    }
  } else {
    document.getElementById('progresso-bar').style.display = 'none';
    document.getElementById('bottom-bar').style.display = 'none';
    document.getElementById('edit-banner').style.display = 'none';
    _contagensCache = null; // recarrega pra pegar edições recentes
    renderCalendario();
  }
};

window.calNavMes = function(delta) {
  if (!_calMes) _calMes = new Date();
  _calMes = new Date(_calMes.getFullYear(), _calMes.getMonth() + delta, 1);
  renderCalendario();
};

async function renderCalendario() {
  const grade = document.getElementById('cal-grade');
  grade.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:24px;color:#999;font-size:13px">Carregando...</div>';

  if (!_contagensCache) {
    try {
      _contagensCache = await listarContagens({ limite: 500 });
    } catch (e) {
      console.error(e);
      grade.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:24px;color:#c0392b;font-size:13px">Erro ao carregar contagens.</div>';
      return;
    }
  }

  // Mapa dia -> { tipo: docMaisRecente } (listarContagens já vem do mais novo pro mais velho)
  const diasMap = {};
  _contagensCache.forEach(c => {
    if (!c.data || !c.tipo) return;
    if (!diasMap[c.data]) diasMap[c.data] = {};
    if (!diasMap[c.data][c.tipo]) diasMap[c.data][c.tipo] = c;
  });

  if (!_calMes) _calMes = new Date();
  const ano = _calMes.getFullYear(), mes = _calMes.getMonth();
  document.getElementById('cal-titulo').textContent =
    _calMes.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

  const primeiroDiaSemana = new Date(ano, mes, 1).getDay(); // 0=Dom
  const ultimoN = new Date(ano, mes + 1, 0).getDate();

  let html = '';
  ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'].forEach(w => html += `<div class="cal-wd">${w}</div>`);
  for (let i = 0; i < primeiroDiaSemana; i++) html += '<div class="cal-cel vazia"></div>';

  for (let d = 1; d <= ultimoN; d++) {
    const diaIso = `${ano}-${String(mes + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const tipos = diasMap[diaIso];
    if (tipos) {
      const dots = (tipos.ini ? '🌅' : '') + (tipos.fin ? '🌙' : '') + (tipos.sorv ? '🍨' : '');
      html += `<div class="cal-cel tem" onclick="abrirDia('${diaIso}')"><span class="cal-dia">${d}</span><span class="cal-dots">${dots}</span></div>`;
    } else {
      html += `<div class="cal-cel"><span class="cal-dia" style="color:#ccc">${d}</span></div>`;
    }
  }
  grade.innerHTML = html;
}

// Ao tocar num dia, mostra as folhas que existem pra escolher qual editar.
window.abrirDia = function(diaIso) {
  const tipos = {};
  _contagensCache.forEach(c => {
    if (c.data === diaIso && c.tipo && !tipos[c.tipo]) tipos[c.tipo] = c;
  });
  const nomes = { ini: '🌅 Bebidas — Início', fin: '🌙 Bebidas — Final', sorv: '🍨 Sorvetes & Embalagens' };
  const [y, m, d] = diaIso.split('-');
  let btns = '';
  ['ini', 'fin', 'sorv'].forEach(tp => {
    if (tipos[tp]) btns += `<button class="cal-picker-btn" onclick="editarDia('${diaIso}','${tp}')">${nomes[tp]}</button>`;
  });

  const bg = document.createElement('div');
  bg.className = 'cal-picker-bg';
  bg.id = 'cal-picker-bg';
  bg.innerHTML = `<div class="cal-picker"><h3>${d}/${m}/${y}</h3>${btns}<button class="cal-picker-cancel" onclick="fecharPicker()">Cancelar</button></div>`;
  bg.addEventListener('click', (e) => { if (e.target === bg) fecharPicker(); });
  document.body.appendChild(bg);
};

window.fecharPicker = function() {
  document.getElementById('cal-picker-bg')?.remove();
};

window.editarDia = async function(diaIso, tipo) {
  const contagem = _contagensCache.find(c => c.data === diaIso && c.tipo === tipo);
  fecharPicker();
  if (!contagem) return;
  await carregarParaEditar(contagem);
};

// Carrega uma contagem existente no formulário pra reedição.
async function carregarParaEditar(contagem) {
  trocarModo('contar');
  document.getElementById('data-input').value = contagem.data;

  await selecionarTipo(contagem.tipo);   // renderiza o formulário vazio (e reseta edição)
  preencherFormComContagem(contagem);    // preenche com os valores salvos

  // Agora sim marca como edição (depois do reset feito por selecionarTipo)
  editandoContagemId = contagem.id;
  document.getElementById('data-input').setAttribute('readonly', 'readonly');
  document.getElementById('btn-salvar').innerHTML = '💾 Atualizar contagem';

  const [y, m, d] = contagem.data.split('-');
  const banner = document.getElementById('edit-banner');
  banner.innerHTML = `✏️ Editando contagem de <b>${d}/${m}/${y}</b>${contagem.autorNome ? ' · lançado por ' + contagem.autorNome : ''}`;
  banner.style.display = 'block';

  // 3B: se a auditoria operacional deste dia já foi FECHADA, vira só-leitura.
  // Tolerante a falha na leitura (não trava o uso se a checagem der erro).
  try {
    const fechada = await buscarAuditoriaFechada('operacional', contagem.data, contagem.data);
    if (fechada) aplicarModoSomenteLeitura(contagem.data);
  } catch (e) {
    console.warn('Não deu pra verificar auditoria fechada:', e.message);
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Trava o formulário em só-leitura quando a auditoria do dia já foi fechada.
function aplicarModoSomenteLeitura(diaIso) {
  document.querySelectorAll('#main-content input, #main-content textarea').forEach(el => {
    el.disabled = true;
    el.style.opacity = '0.7';
  });
  document.getElementById('bottom-bar').style.display = 'none';
  editandoContagemId = null; // garante que NADA será salvo
  const [y, m, d] = diaIso.split('-');
  const banner = document.getElementById('edit-banner');
  banner.innerHTML = `🔒 Auditoria de <b>${d}/${m}/${y}</b> já foi fechada — visualização apenas, não editável.`;
  banner.style.display = 'block';
  banner.style.background = '#fdecea';
  banner.style.color = '#c0392b';
  banner.style.borderLeftColor = '#c0392b';
}

// Preenche os inputs do formulário a partir dos itens salvos.
// Genérico: input id = `${chave}_${campo}` cobre bebidas (est/frPrinc/frAux/rec/obs)
// e sorvetes (chave __ini/__fin, campos qtd/abast/final/obs).
function preencherFormComContagem(contagem) {
  const itens = contagem.itens || {};
  Object.entries(itens).forEach(([chave, v]) => {
    if (!v || typeof v !== 'object') return;
    Object.entries(v).forEach(([campo, val]) => {
      if (campo === 'total' || campo === 'vendeu') return; // calculados
      const el = document.getElementById(`${chave}_${campo}`);
      if (!el) return;
      if (campo === 'obs') {
        el.value = val || '';
        window.atualizarObs(chave, el);
      } else {
        el.value = (val === 0 || val) ? val : '';
        window.atualizar(chave, campo, el);
        if (campo === 'abast' || campo === 'final') {
          window.calcularVendeu(chave.replace('__fin', ''));
        }
      }
    });
  });
}

