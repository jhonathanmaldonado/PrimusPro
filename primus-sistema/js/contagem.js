// ===== CONTAGEM — PRIMUS =====
// Baseado no contagem_primus.html original, mas salvando no Firestore.

import { slugify } from './produtos.js';
import { obterBebidas, obterSorvetes } from './produtos-store.js';
import { exigirPerfil, logout } from './auth.js';
import { salvarContagem, hoje } from './db.js';

// Garante sessão válida — barman, gerente ou gestor podem contar
const sessao = exigirPerfil(['barman', 'gerente', 'gestor']);
if (!sessao) throw new Error('sem sessão');

// ===== ESTADO =====
let tipoAtual = null;
const dados = {}; // { id: { fr, est, rec, qtd, obs, total } }

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

// ===== DATA PADRÃO =====
document.getElementById('data-input').value = hoje();

// ===== SELEÇÃO DE TIPO =====
window.selecionarTipo = async function(tipo) {
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
        <div class="col-header">Freezer</div>
        <div class="col-header">Estoque</div>
        <div class="col-header">Total</div>
        <div class="col-header">Obs</div>`;
    } else { // fin
      colHeader.className = 'col-headers layout-fin';
      colHeader.innerHTML = `
        <div class="col-header">Produto</div>
        <div class="col-header">Freezer</div>
        <div class="col-header">Estoque</div>
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
          <input class="num-input" type="number" min="0" inputmode="numeric" placeholder="0" id="${id}_fr" oninput="atualizar('${id}','fr',this)" onfocus="this.select()">
          <input class="num-input" type="number" min="0" inputmode="numeric" placeholder="0" id="${id}_est" oninput="atualizar('${id}','est',this)" onfocus="this.select()">
          <div class="total-val" id="${id}_tot">—</div>
          ${obsInput}`;
      } else {
        row.className = 'produto-row layout-fin';
        row.innerHTML = `
          ${nomeProd}
          <input class="num-input" type="number" min="0" inputmode="numeric" placeholder="0" id="${id}_fr" oninput="atualizar('${id}','fr',this)" onfocus="this.select()">
          <input class="num-input" type="number" min="0" inputmode="numeric" placeholder="0" id="${id}_est" oninput="atualizar('${id}','est',this)" onfocus="this.select()">
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

  // Total de bebidas (freezer + estoque)
  if (campo === 'fr' || campo === 'est') {
    const fr  = parseInt(document.getElementById(id+'_fr')?.value)  || 0;
    const est = parseInt(document.getElementById(id+'_est')?.value) || 0;
    const tot = fr + est;
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
    await salvarContagem({
      tipo: tipoAtual,
      data,
      autor: { id: sessao.id, nome: sessao.nome, perfil: sessao.perfil },
      itens
    });
    mostrarToast('Contagem salva com sucesso!', 'ok');
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
