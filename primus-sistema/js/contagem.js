// ===== CONTAGEM — PRIMUS =====
// Baseado no contagem_primus.html original, mas salvando no Firestore.

import { slugify } from './produtos.js';
import { obterBebidas, obterSorvetes } from './produtos-store.js';
import { exigirPerfil, logout } from './auth.js';
import { db, doc, getDoc, setDoc } from './firebase-config.js';
import { salvarContagem, hoje, listarContagens, atualizarContagem, buscarAuditoriaFechada, ultimaContagem, listarConsumoInternoDia } from './db.js';

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
let _listaForm = [];           // produtos do formulário atual (pra recontagem)
let _recontagemFeita = false;  // a recontagem do INÍCIO roda 1 vez só por salvamento

// ===== HEADER DO USUÁRIO =====
function iniciais(nome) {
  return nome.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
}

document.getElementById('user-avatar').textContent = iniciais(sessao.nome);
document.getElementById('user-name').textContent = sessao.nome;
document.getElementById('user-perfil').textContent = sessao.perfil;

// Gestor e gerente: botão 📊 Painel na barra de cima (volta pro Dashboard).
// Pergunta antes se tiver contagem digitada e não salva (não existe rascunho).
if (['gestor', 'gerente'].includes(sessao.perfil)) {
  const btnPainel = document.getElementById('btn-painel');
  btnPainel.style.display = '';
  btnPainel.onclick = () => {
    if (tipoAtual === 'ini' || tipoAtual === 'fin') {   // bebidas: fica no rascunho
      if (_rascTimer) salvarRascunho();
      location.href = 'gestor.html';
      return;
    }
    const digitou = [...document.querySelectorAll('.num-input')].some(i => i.value !== '' && Number(i.value) !== 0);
    if (digitou && !confirm('Você tem números digitados que ainda não foram salvos.\n\nSair pro Painel e perder essa contagem?')) return;
    location.href = 'gestor.html';
  };
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

// =====================================================================
// ===== CONTAGEM POR LOCAL (bebidas INÍCIO/FINAL) — etapa 3 =====
// Abas: 📦 Estoque · 🍺 Bar principal · 🧊 Bar de apoio · (🚚 Recebido no FINAL) · 📝 Conferir
// Nos bares, os produtos aparecem por FREEZER (configurado em ⚙️ Freezers).
// Um produto em 2 freezers ganha 2 campos e o sistema soma. "Fora do lugar"
// traz todos os produtos (recolhido) pra nada ficar sem poder ser contado.
// Grava igual antes: est / frPrinc / frAux / total (+ det = detalhe por freezer),
// então auditoria, recontagem e Telegram continuam iguais.
// Rascunho automático no celular (localStorage) — nada se perde se fechar o app.
// =====================================================================
const LOCAIS = [
  { loc: 'est',     nome: 'Estoque',       icon: '📦' },
  { loc: 'frPrinc', nome: 'Bar principal', icon: '🍺' },
  { loc: 'frAux',   nome: 'Bar de apoio',  icon: '🧊' },
];
const BARES = LOCAIS.filter(l => l.loc !== 'est');
const OUTROS = '_outros';
const REF_FREEZERS = () => doc(db, 'primus_config', 'freezers');
let _cfgFreezers = null;      // { frPrinc: [{id,nome,produtos:[slug]}], frAux: [...] }
let _carregandoEdicao = false;
let _rascTimer = null;
let _painelAtivo = 'est';

const escH = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

async function carregarFreezers(forcar = false) {
  if (_cfgFreezers && !forcar) return _cfgFreezers;
  try {
    const s = await getDoc(REF_FREEZERS());
    const b = (s.exists() && s.data().bares) || {};
    _cfgFreezers = {
      frPrinc: Array.isArray(b.frPrinc) ? b.frPrinc : [],
      frAux:   Array.isArray(b.frAux)   ? b.frAux   : [],
    };
  } catch (e) {
    console.warn('[freezers] não deu pra ler a configuração:', e);
    _cfgFreezers = _cfgFreezers || { frPrinc: [], frAux: [] };
  }
  return _cfgFreezers;
}

(function estilosContagemLocal() {
  const st = document.createElement('style');
  st.textContent = `
    .loc-tabs { position: sticky; top: 0; z-index: 20; display: flex; gap: 6px; overflow-x: auto;
      padding: 10px 2px; margin: -4px 0 10px; background: var(--cinza-bg, #f4f2ee); scrollbar-width: none; }
    .loc-tab { flex: 0 0 auto; border: 1.5px solid var(--cinza-borda, #ddd); background: #fff; border-radius: 20px;
      padding: 8px 12px; font-weight: 700; font-size: 13px; color: var(--preto, #222); cursor: pointer; white-space: nowrap; }
    .loc-tab.ativo { background: var(--vinho); border-color: var(--vinho); color: #fff; }
    .loc-tab .loc-cont { font-family: 'DM Mono', monospace; font-size: 10px; opacity: .75; margin-left: 4px; }
    .loc-tab.completo .loc-cont::after { content: ' ✅'; }
    .loc-painel { display: none; }
    .loc-painel.ativo { display: block; }
    .loc-linha { display: flex; align-items: center; gap: 10px; padding: 9px 14px;
      border-bottom: 1px solid var(--cinza-borda, #eee); }
    .loc-linha:last-child { border-bottom: none; }
    .loc-linha .prod-nome { flex: 1; font-size: 14px; }
    .loc-linha .num-input { width: 92px; flex: 0 0 92px; font-size: 18px; padding: 10px 4px; }
    details.grupo > summary { list-style: none; cursor: pointer; }
    details.grupo > summary::-webkit-details-marker { display: none; }
    .loc-dica { font-size: 12px; color: var(--cinza-texto, #777); padding: 10px 14px; line-height: 1.4; }
    .conf-linha { display: grid; grid-template-columns: minmax(110px,2fr) repeat(4, minmax(38px,1fr)) minmax(90px,1.6fr);
      gap: 6px; align-items: center; padding: 8px 12px; border-bottom: 1px solid var(--cinza-borda, #eee); font-size: 12px; }
    .conf-linha .c { text-align: center; font-family: 'DM Mono', monospace; }
    .conf-linha .c.tot { font-weight: 800; color: var(--vinho); }
    .conf-cab { font-size: 9px; color: var(--cinza-texto, #777); text-transform: uppercase; letter-spacing: 1px; font-weight: 700; }
    .fz-card { border-bottom: 1px solid var(--cinza-borda, #eee); padding: 12px 14px; }
    .fz-topo { display: flex; gap: 6px; align-items: center; }
    .fz-nome { flex: 1; min-width: 0; padding: 9px 10px; border: 1.5px solid var(--cinza-borda, #ddd); border-radius: 8px; font-size: 15px; font-weight: 700; }
    .fz-ico { border: 1px solid var(--cinza-borda, #ddd); background: #fff; border-radius: 8px; padding: 8px 10px; cursor: pointer; }
    .fz-prods { margin-top: 8px; }
    .fz-prods summary { font-size: 13px; color: var(--vinho); font-weight: 700; cursor: pointer; padding: 6px 0; }
    .fz-grupo-nome { font-size: 11px; font-weight: 800; color: var(--cinza-texto, #777); margin: 10px 0 4px; text-transform: uppercase; letter-spacing: 1px; }
    .fz-check { display: flex; align-items: center; gap: 10px; padding: 8px 2px; font-size: 14px; }
    .fz-check input { width: 20px; height: 20px; }
    .fz-sem { font-size: 12px; color: #8a5a00; background: #fff6e0; padding: 10px 14px; line-height: 1.45; }
    .fz-rodape { position: sticky; bottom: 0; background: var(--cinza-bg, #f4f2ee); padding: 12px 0; display: flex; gap: 8px; }
    .loc-linha.cx { flex-wrap: wrap; row-gap: 6px; }
    .loc-linha.cx .prod-nome { flex: 1 1 100%; }
    .cx-info { font-size: 11px; color: var(--cinza-texto, #777); margin-left: 6px; font-weight: 400; }
    .cx-res { float: right; font-family: 'DM Mono', monospace; font-weight: 800; color: var(--vinho); }
    .cx-campos { display: flex; align-items: center; gap: 8px; width: 100%; }
    .cx-campos label { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--cinza-texto, #777); }
    .cx-campos .num-input { width: 84px; flex: 0 0 84px; font-size: 18px; padding: 10px 4px; }
  `;
  document.head.appendChild(st);
})();

function idInput(id, loc, fz) {
  if (loc === 'est' || loc === 'rec') return `${id}_${loc}`;
  return `${id}__fz_${loc}_${fz}`;
}

function linhaInput(item, loc, fz, rotulo, conta) {
  const id = slugify(item.nome);
  const tags = (item.ks ? '<span class="tag-ks">KS</span>' : '') + (item.saindo ? '<span class="tag-saindo">saindo</span>' : '');
  return `
    <div class="loc-linha">
      <div class="prod-nome">${escH(item.nome)}${tags}</div>
      <input class="num-input loc-input" type="number" min="0" inputmode="numeric" placeholder="—"
             id="${idInput(id, loc, fz)}" data-id="${id}" data-loc="${loc}" data-fz="${fz || ''}"
             data-rotulo="${escH(rotulo)}" data-conta="${conta ? 1 : 0}"
             oninput="atualizarLocal(this)" onfocus="this.select()">
    </div>`;
}

// Estoque de produto que vem em caixa/fardo: [caixas] + [soltas] = unidades.
// Os 2 campos contam como 1 no progresso (data-par). Grava est (unidades) e
// det.est = { cx, un, por } pra conferência.
function porCaixaDe(item) {
  const n = Number(item.porCaixa) || 0;
  return item.unidCompra && n > 1 ? n : 0;
}

function linhaEstoque(item) {
  const por = porCaixaDe(item);
  if (!por) return linhaInput(item, 'est', '', 'Estoque', true);
  const id = slugify(item.nome);
  const emb = item.unidCompra === 'fardo' ? 'fardo' : 'cx';
  const tags = (item.ks ? '<span class="tag-ks">KS</span>' : '') + (item.saindo ? '<span class="tag-saindo">saindo</span>' : '');
  const campo = (fz, rot, ph) => `<input class="num-input loc-input" type="number" min="0" inputmode="numeric" placeholder="${ph}"
      id="${id}_est_${fz}" data-id="${id}" data-loc="est" data-fz="${fz}" data-par="${id}" data-por="${por}"
      data-rotulo="${escH(rot)}" data-conta="1" oninput="atualizarLocal(this)" onfocus="this.select()">`;
  return `
    <div class="loc-linha cx">
      <div class="prod-nome">${escH(item.nome)}${tags}<span class="cx-info">${emb} de ${por}</span>
        <span class="cx-res" id="${id}__cx_res"></span></div>
      <div class="cx-campos">
        <label>${campo('cx', `Estoque · ${emb === 'fardo' ? 'fardos' : 'caixas'} (de ${por})`, emb)} ${emb === 'fardo' ? 'fardos' : 'caixas'}</label>
        <span style="font-weight:800">+</span>
        <label>${campo('un', 'Estoque · soltas', 'un')} soltas</label>
      </div>
    </div>`;
}

function porGrupo(lista) {
  const g = {};
  lista.forEach(i => { (g[i.grupo] = g[i.grupo] || []).push(i); });
  return g;
}

function cabecalhoGrupo(titulo, qtd) {
  const [icon, ...resto] = titulo.split(' ');
  return `<div class="grupo-header"><span class="grupo-icon">${icon}</span>
    <span class="grupo-nome">${escH(resto.join(' '))}</span><span class="grupo-count">${qtd} itens</span></div>`;
}

async function renderizarBebidasPorLocal(main, lista) {
  const cfg = await carregarFreezers();
  const slugsLista = new Set(lista.map(i => slugify(i.nome)));
  const ehFin = tipoAtual === 'fin';
  const abas = [...LOCAIS, ...(ehFin ? [{ loc: 'rec', nome: 'Recebido', icon: '🚚' }] : []), { loc: 'conf', nome: 'Conferir', icon: '📝' }];

  let html = `<div class="loc-tabs">${abas.map(a =>
    `<button class="loc-tab" id="tab-${a.loc}" onclick="trocarPainel('${a.loc}')">${a.icon} ${a.nome}<span class="loc-cont" id="tabc-${a.loc}"></span></button>`
  ).join('')}</div>`;

  // 📦 Estoque: por grupo do catálogo
  html += `<div class="loc-painel" id="painel-est">` + Object.entries(porGrupo(lista)).map(([g, itens]) =>
    `<div class="grupo">${cabecalhoGrupo(g, itens.length)}${itens.map(i => linhaEstoque(i)).join('')}</div>`
  ).join('') + `</div>`;

  // 🍺 / 🧊 Bares: por freezer + "fora do lugar"
  BARES.forEach(b => {
    const freezers = (cfg[b.loc] || []).filter(f => f && f.id);
    let p = `<div class="loc-painel" id="painel-${b.loc}">`;
    freezers.forEach(f => {
      const prods = lista.filter(i => (f.produtos || []).includes(slugify(i.nome)));
      p += `<div class="grupo">${cabecalhoGrupo('🧊 ' + (f.nome || 'Freezer'), prods.length)}` +
        (prods.length ? prods.map(i => linhaInput(i, b.loc, f.id, `${b.nome} · ${f.nome || 'Freezer'}`, true)).join('')
                      : `<div class="loc-dica">Nenhum produto neste freezer. Escolha em ⚙️ Freezers.</div>`) + `</div>`;
    });
    if (!freezers.length) {
      p += `<div class="grupo">${cabecalhoGrupo('📋 Todos os produtos', lista.length)}
        <div class="loc-dica">Os freezers do ${b.nome} ainda não foram configurados. Configure em <b>⚙️ Freezers</b> pra lista seguir a ordem dos freezers.</div>
        ${lista.map(i => linhaInput(i, b.loc, OUTROS, b.nome, true)).join('')}</div>`;
    } else {
      p += `<details class="grupo" id="outros-${b.loc}"><summary>${cabecalhoGrupo('📋 Fora do lugar / outros', lista.length)}
          <div class="loc-dica">Toque aqui se algum produto estiver fora do freezer dele (ou num freezer não cadastrado).</div></summary>
        ${lista.map(i => linhaInput(i, b.loc, OUTROS, `${b.nome} · fora do lugar`, false)).join('')}</details>`;
    }
    html += p + `</div>`;
  });

  // 🚚 Recebido (só FINAL)
  if (ehFin) {
    html += `<div class="loc-painel" id="painel-rec"><div class="loc-dica">Quantidade que chegou hoje e ainda não foi lançada como recebimento (se houver).</div>` +
      Object.entries(porGrupo(lista)).map(([g, itens]) =>
        `<div class="grupo">${cabecalhoGrupo(g, itens.length)}${itens.map(i => linhaInput(i, 'rec', '', 'Recebido', false)).join('')}</div>`
      ).join('') + `</div>`;
  }

  // 📝 Conferir: totais por local + observação
  html += `<div class="loc-painel" id="painel-conf"><div class="grupo">
      <div class="conf-linha conf-cab"><div>Produto</div><div class="c">Est.</div><div class="c">B.pr.</div><div class="c">B.ap.</div><div class="c">Total</div><div>Obs</div></div>` +
    lista.map(i => {
      const id = slugify(i.nome);
      return `<div class="conf-linha"><div class="prod-nome" id="${id}__c_nome">${escH(i.nome)}</div>
        <div class="c" id="${id}__c_est">—</div><div class="c" id="${id}__c_frPrinc">—</div><div class="c" id="${id}__c_frAux">—</div>
        <div class="c tot" id="${id}__c_tot">—</div>
        <textarea class="obs-input" id="${id}_obs" placeholder="obs..." rows="1" oninput="atualizarObs('${id}',this); agendarRascunho()"></textarea></div>`;
    }).join('') + `</div></div>`;

  main.innerHTML = html;
  window.trocarPainel('est');

  if (!editandoContagemId && !_carregandoEdicao) restaurarRascunho();
}

window.trocarPainel = function(loc) {
  _painelAtivo = loc;
  document.querySelectorAll('.loc-tab').forEach(t => t.classList.toggle('ativo', t.id === 'tab-' + loc));
  document.querySelectorAll('.loc-painel').forEach(p => p.classList.toggle('ativo', p.id === 'painel-' + loc));
  const tabs = document.querySelector('.loc-tabs');
  if (tabs && tabs.getBoundingClientRect().top < 0) tabs.scrollIntoView({ block: 'start' });
};

window.atualizarLocal = function(input) {
  const id = input.dataset.id, loc = input.dataset.loc, fz = input.dataset.fz;
  const vazio = input.value === '';
  const val = vazio ? null : Math.max(0, parseInt(input.value, 10) || 0);
  input.classList.toggle('filled', !vazio);
  const d = dados[id] || (dados[id] = {});
  if (loc === 'est' && (fz === 'cx' || fz === 'un')) {
    const por = Number(input.dataset.por) || 1;
    const cxEl = document.getElementById(`${id}_est_cx`), unEl = document.getElementById(`${id}_est_un`);
    const cx = cxEl && cxEl.value !== '' ? Math.max(0, parseInt(cxEl.value, 10) || 0) : null;
    const un = unEl && unEl.value !== '' ? Math.max(0, parseInt(unEl.value, 10) || 0) : null;
    d.det = d.det || {};
    if (cx === null && un === null) {
      delete d.est; delete d.det.est;
    } else {
      d.est = (cx || 0) * por + (un || 0);
      d.det.est = { cx: cx || 0, un: un || 0, por };
    }
    if (!Object.keys(d.det).length) delete d.det;
    const res = document.getElementById(`${id}__cx_res`);
    if (res) res.textContent = d.est != null ? `= ${d.est} un` : '';
  } else if (loc === 'est' || loc === 'rec') {
    if (vazio) delete d[loc]; else d[loc] = val;
  } else {
    d.det = d.det || {};
    d.det[loc] = d.det[loc] || {};
    if (vazio) delete d.det[loc][fz]; else d.det[loc][fz] = val;
    if (!Object.keys(d.det[loc]).length) { delete d.det[loc]; delete d[loc]; }
    else d[loc] = Object.values(d.det[loc]).reduce((a, b) => a + b, 0);
    if (!Object.keys(d.det).length) delete d.det;
  }
  d.total = (d.est || 0) + (d.frPrinc || 0) + (d.frAux || 0);
  atualizarConferir(id);
  atualizarProgresso();
  agendarRascunho();
};

function atualizarConferir(id) {
  const d = dados[id] || {};
  const set = (k, v) => { const el = document.getElementById(`${id}__c_${k}`); if (el) el.textContent = v; };
  set('est', d.est ?? '—');
  set('frPrinc', d.frPrinc ?? '—');
  set('frAux', d.frAux ?? '—');
  const algum = d.est != null || d.frPrinc != null || d.frAux != null;
  set('tot', algum ? d.total : '—');
}

// Progresso só conta os campos "do lugar" (estoque + freezers configurados)
function progressoPorLocal() {
  const r = { total: 0, feitos: 0, porLocal: {} };
  const pares = {};   // caixas + soltas do mesmo item = 1 campo
  document.querySelectorAll('#main-content .loc-input[data-conta="1"]').forEach(el => {
    const loc = el.dataset.loc;
    const p = r.porLocal[loc] || (r.porLocal[loc] = { total: 0, feitos: 0 });
    if (el.dataset.par) {
      const k = loc + '|' + el.dataset.par;
      if (!pares[k]) { pares[k] = { p, feito: false }; p.total++; r.total++; }
      if (el.value !== '' && !pares[k].feito) { pares[k].feito = true; p.feitos++; r.feitos++; }
      return;
    }
    p.total++; r.total++;
    if (el.value !== '') { p.feitos++; r.feitos++; }
  });
  return r;
}

// ===== RASCUNHO AUTOMÁTICO (no próprio celular) =====
const chaveRascunho = (tipo = tipoAtual) => `primus_rasc_${tipo}`;

function agendarRascunho() {
  if (!tipoAtual || tipoAtual === 'sorv' || editandoContagemId || _carregandoEdicao) return;
  clearTimeout(_rascTimer);
  _rascTimer = setTimeout(salvarRascunho, 400);
}
window.agendarRascunho = agendarRascunho;

function salvarRascunho() {
  clearTimeout(_rascTimer); _rascTimer = null;
  if (!tipoAtual || tipoAtual === 'sorv' || editandoContagemId || _carregandoEdicao) return;
  const valores = {};
  document.querySelectorAll('#main-content .loc-input, #main-content .obs-input').forEach(el => {
    if (el.value !== '') valores[el.id] = el.value;
  });
  try {
    if (Object.keys(valores).length) {
      localStorage.setItem(chaveRascunho(), JSON.stringify({
        data: document.getElementById('data-input').value, valores, em: new Date().toISOString()
      }));
    } else {
      localStorage.removeItem(chaveRascunho());
    }
  } catch (e) { console.warn('[rascunho] não salvou:', e); }
}

function limparRascunho(tipo = tipoAtual) {
  clearTimeout(_rascTimer); _rascTimer = null;
  try { localStorage.removeItem(chaveRascunho(tipo)); } catch (_) {}
}

function restaurarRascunho() {
  let r = null;
  try { r = JSON.parse(localStorage.getItem(chaveRascunho()) || 'null'); } catch (_) { r = null; }
  if (!r || !r.valores || !Object.keys(r.valores).length) return;
  const dataEl = document.getElementById('data-input');
  const rot = { ini: 'INÍCIO', fin: 'FINAL' }[tipoAtual] || tipoAtual;
  const [y, m, dd] = String(r.data || '').split('-');
  if (r.data && r.data !== dataEl.value) {
    if (!confirm(`Tem uma contagem de ${rot} de ${dd}/${m}/${y} que não foi salva.\n\nContinuar ela? (Cancelar descarta esse rascunho)`)) {
      limparRascunho();
      return;
    }
    dataEl.value = r.data;
  }
  let perdidos = 0;
  Object.entries(r.valores).forEach(([elId, v]) => {
    const el = document.getElementById(elId);
    if (!el) { perdidos++; return; }
    el.value = v;
    if (el.classList.contains('obs-input')) window.atualizarObs(elId.replace(/_obs$/, ''), el);
    else window.atualizarLocal(el);
  });
  abrirOutrosPreenchidos();
  const hora = r.em ? new Date(r.em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
  const banner = document.getElementById('edit-banner');
  banner.innerHTML = `📝 Rascunho recuperado${hora ? ' (salvo às ' + hora + ')' : ''} — continue de onde parou.` +
    (perdidos ? ` <b>${perdidos} número(s) não voltaram</b> porque a configuração dos freezers mudou.` : '') +
    ` <a href="#" onclick="descartarRascunho();return false" style="margin-left:6px;font-weight:700">Descartar rascunho</a>`;
  banner.style.display = 'block';
}

window.descartarRascunho = async function() {
  if (!confirm('Descartar o rascunho e começar a contagem do zero?')) return;
  limparRascunho();
  document.getElementById('edit-banner').style.display = 'none';
  await window.selecionarTipo(tipoAtual);
};

// Abre o "fora do lugar" de um bar quando tem número lá dentro
function abrirOutrosPreenchidos() {
  BARES.forEach(b => {
    const det = document.getElementById('outros-' + b.loc);
    if (det && [...det.querySelectorAll('.loc-input')].some(i => i.value !== '')) det.open = true;
  });
}

// Salva o rascunho na hora se o app for pro fundo/fechar
window.addEventListener('pagehide', () => { if (_rascTimer) salvarRascunho(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && _rascTimer) salvarRascunho(); });

// ===== EDIÇÃO (calendário): preenche a tela por local a partir do salvo =====
function preencherBebidas(contagem) {
  const itens = contagem.itens || {};
  const setar = (elId, v) => {
    const el = document.getElementById(elId);
    if (!el || v == null) return false;
    el.value = v;
    window.atualizarLocal(el);
    return true;
  };
  Object.entries(itens).forEach(([slug, v]) => {
    if (!v || typeof v !== 'object' || slug.includes('__')) return;
    if (v.est != null) {
      const cxEl = document.getElementById(`${slug}_est_cx`);
      if (cxEl) {
        const de = v.det && v.det.est;
        const por = Number(cxEl.dataset.por) || 1;
        if (de && de.por === por && (de.cx || 0) * por + (de.un || 0) === v.est) {
          setar(`${slug}_est_cx`, de.cx || 0);
          setar(`${slug}_est_un`, de.un || 0);
        } else {
          setar(`${slug}_est_un`, v.est);   // sem detalhe (antiga/corrigida): tudo como soltas
        }
      } else {
        setar(`${slug}_est`, v.est);
      }
    }
    if (v.rec != null) setar(`${slug}_rec`, v.rec);
    if (v.obs) {
      const o = document.getElementById(`${slug}_obs`);
      if (o) { o.value = v.obs; window.atualizarObs(slug, o); }
    }
    BARES.forEach(b => {
      const tot = v[b.loc] != null ? v[b.loc] : (b.loc === 'frPrinc' ? (v.fr || v.freezer) : null);
      if (tot == null) return;
      const det = v.det && v.det[b.loc];
      const somaDet = det ? Object.values(det).reduce((a, x) => a + (Number(x) || 0), 0) : null;
      const detValido = det && somaDet === tot &&
        Object.keys(det).every(fz => document.getElementById(idInput(slug, b.loc, fz)));
      if (detValido) {
        Object.entries(det).forEach(([fz, n]) => setar(idInput(slug, b.loc, fz), n));
      } else if (tot !== 0 || !det) {
        // Sem detalhe (contagem antiga ou corrigida na auditoria): vai inteiro pro "fora do lugar"
        setar(idInput(slug, b.loc, OUTROS), tot);
      }
    });
    if (v._editado) {
      const nomeEl = document.getElementById(`${slug}__c_nome`);
      if (nomeEl && !nomeEl.querySelector('.selo-editado')) nomeEl.insertAdjacentHTML('beforeend', seloEditadoContagem(v._editado));
    }
  });
  abrirOutrosPreenchidos();
  atualizarProgresso();
}

// =====================================================================
// ===== ⚙️ FREEZERS — o próprio barman diz o que fica em cada freezer =====
// Grava em primus_config/freezers = { bares: { frPrinc: [...], frAux: [...] } }
// Cada freezer: { id, nome, produtos: [slug, ...] }. Ordem = ordem na contagem.
// =====================================================================
let _cfgEdit = null;       // cópia em edição
let _cfgMudouDesdeContagem = false;  // config salva com uma contagem aberta: redesenha ao voltar
let _cfgSujo = false;      // tem mudança não salva
let _catalogoFz = [];

function novoIdFreezer() {
  return 'fz_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

(function injetarModoFreezers() {
  const painel = document.getElementById('btn-painel');
  const b = document.createElement('button');
  b.className = 'modo-btn';
  b.id = 'modo-fz';
  b.textContent = '⚙️ Freezers';
  b.onclick = () => window.trocarModo('freezers');
  painel.parentNode.insertBefore(b, painel);
  const v = document.createElement('div');
  v.id = 'fz-view';
  v.className = 'main';
  v.style.display = 'none';
  const cal = document.getElementById('cal-view');
  cal.parentNode.insertBefore(v, cal.nextSibling);
})();

async function renderFreezers() {
  const v = document.getElementById('fz-view');
  v.innerHTML = '<div class="tela-inicio"><div class="icon">⏳</div><h2>Carregando...</h2></div>';
  _catalogoFz = await obterBebidas();
  const cfg = await carregarFreezers(true);
  _cfgEdit = JSON.parse(JSON.stringify(cfg));
  _cfgSujo = false;
  desenharFreezers();
}

function desenharFreezers() {
  const v = document.getElementById('fz-view');
  const grupos = porGrupo(_catalogoFz);
  let html = `<div class="loc-dica" style="padding:12px 2px">Monte aqui como os produtos estão guardados.
    Na contagem, cada bar mostra os freezers <b>nesta ordem</b>, com os produtos de cada um.
    Um produto pode estar em mais de um freezer.</div>`;
  BARES.forEach(b => {
    const lista = _cfgEdit[b.loc] || (_cfgEdit[b.loc] = []);
    html += `<div class="grupo">${cabecalhoGrupo(b.icon + ' ' + b.nome, lista.length).replace(' itens<', ' freezers<')}`;
    lista.forEach((f, i) => {
      const sel = new Set(f.produtos || []);
      html += `<div class="fz-card">
        <div class="fz-topo">
          <input class="fz-nome" value="${escH(f.nome)}" placeholder="Nome (ex: Verde, Refri 1)" oninput="fzRenomear('${b.loc}',${i},this.value)">
          <button class="fz-ico" title="Subir" onclick="fzMover('${b.loc}',${i},-1)" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button class="fz-ico" title="Descer" onclick="fzMover('${b.loc}',${i},1)" ${i === lista.length - 1 ? 'disabled' : ''}>↓</button>
          <button class="fz-ico" title="Remover freezer" onclick="fzRemover('${b.loc}',${i})">🗑️</button>
        </div>
        <details class="fz-prods">
          <summary id="fzsum-${b.loc}-${i}">${sel.size} produto${sel.size === 1 ? '' : 's'} — toque pra escolher</summary>
          ${Object.entries(grupos).map(([g, itens]) => `
            <div class="fz-grupo-nome">${escH(g)}</div>
            ${itens.map(it => {
              const s = slugify(it.nome);
              return `<label class="fz-check"><input type="checkbox" ${sel.has(s) ? 'checked' : ''}
                onchange="fzMarcar('${b.loc}',${i},'${s}',this.checked)"> ${escH(it.nome)}</label>`;
            }).join('')}`).join('')}
        </details>
      </div>`;
    });
    html += `<div class="fz-card"><button class="btn btn-ghost" style="width:100%" onclick="fzAdicionar('${b.loc}')">+ Adicionar freezer no ${b.nome}</button></div>
      <div class="fz-sem" id="fzsem-${b.loc}"></div></div>`;
  });
  html += `<div class="fz-rodape">
    <button class="btn btn-primary" id="fz-salvar" style="flex:1" onclick="fzSalvar()">💾 Salvar configuração</button>
  </div>`;
  v.innerHTML = html;
  BARES.forEach(b => atualizarSemFreezer(b.loc));
  atualizarBotaoSalvarFz();
}

function atualizarSemFreezer(loc) {
  const el = document.getElementById('fzsem-' + loc);
  if (!el) return;
  const usados = new Set((_cfgEdit[loc] || []).flatMap(f => f.produtos || []));
  const sem = _catalogoFz.filter(it => !usados.has(slugify(it.nome)));
  el.innerHTML = !(_cfgEdit[loc] || []).length
    ? 'Nenhum freezer cadastrado aqui ainda: na contagem, este bar mostra todos os produtos numa lista só.'
    : (sem.length
        ? `Sem freezer neste bar (${sem.length}): ${sem.map(i => escH(i.nome)).join(', ')}. Se algum deles estiver aqui, ele aparece em "Fora do lugar" na contagem.`
        : '✅ Todos os produtos têm freezer neste bar.');
}

function atualizarBotaoSalvarFz() {
  const b = document.getElementById('fz-salvar');
  if (b) b.textContent = _cfgSujo ? '💾 Salvar configuração (tem mudança)' : '💾 Configuração salva';
}

function sujar() { _cfgSujo = true; atualizarBotaoSalvarFz(); }

window.fzRenomear = (loc, i, nome) => { _cfgEdit[loc][i].nome = nome; sujar(); };
window.fzMarcar = (loc, i, slug, on) => {
  const f = _cfgEdit[loc][i];
  const s = new Set(f.produtos || []);
  on ? s.add(slug) : s.delete(slug);
  f.produtos = [...s];
  const sum = document.getElementById(`fzsum-${loc}-${i}`);
  if (sum) sum.textContent = `${s.size} produto${s.size === 1 ? '' : 's'} — toque pra escolher`;
  atualizarSemFreezer(loc);
  sujar();
};
window.fzMover = (loc, i, dir) => {
  const l = _cfgEdit[loc], j = i + dir;
  if (j < 0 || j >= l.length) return;
  [l[i], l[j]] = [l[j], l[i]];
  sujar(); desenharFreezers();
};
window.fzRemover = (loc, i) => {
  const f = _cfgEdit[loc][i];
  if (!confirm(`Remover o freezer "${f.nome || 'sem nome'}"?\n\nOs produtos dele continuam podendo ser contados em "Fora do lugar".`)) return;
  _cfgEdit[loc].splice(i, 1);
  sujar(); desenharFreezers();
};
window.fzAdicionar = (loc) => {
  const nome = prompt('Nome do freezer (ex: Verde, Amarelo, Refri 1, KS):');
  if (!nome || !nome.trim()) return;
  _cfgEdit[loc].push({ id: novoIdFreezer(), nome: nome.trim(), produtos: [] });
  sujar(); desenharFreezers();
};
window.fzSalvar = async () => {
  for (const b of BARES) {
    if ((_cfgEdit[b.loc] || []).some(f => !String(f.nome || '').trim())) {
      alert(`Tem freezer sem nome no ${b.nome}.`);
      return;
    }
  }
  const btn = document.getElementById('fz-salvar');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Salvando...';
  try {
    const bares = {};
    BARES.forEach(b => {
      bares[b.loc] = (_cfgEdit[b.loc] || []).map(f => ({ id: f.id, nome: String(f.nome).trim(), produtos: [...new Set(f.produtos || [])] }));
    });
    await setDoc(REF_FREEZERS(), { bares, atualizadoEm: new Date().toISOString(), atualizadoPor: sessao.nome });
    _cfgFreezers = JSON.parse(JSON.stringify(bares));
    _cfgSujo = false;
    _cfgMudouDesdeContagem = true;
    mostrarToast('Freezers salvos!', 'ok');
  } catch (e) {
    console.error(e);
    alert('Erro ao salvar: ' + e.message);
  } finally {
    btn.disabled = false;
    atualizarBotaoSalvarFz();
  }
};

// ===== SELEÇÃO DE TIPO =====
window.selecionarTipo = async function(tipo) {
  if (_rascTimer) salvarRascunho();   // não perde o que foi digitado no tipo anterior
  // Por padrão é um NOVO lançamento (carregarParaEditar sobrescreve isto depois)
  editandoContagemId = null;
  document.getElementById('data-input').removeAttribute('readonly');
  const _bnr = document.getElementById('edit-banner');
  _bnr.style.display = 'none';
  _bnr.style.background = ''; _bnr.style.color = ''; _bnr.style.borderLeftColor = '';
  document.getElementById('btn-salvar').innerHTML = '💾 Salvar Contagem';
  tipoAtual = tipo;
  _recontagemFeita = false;
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
  _listaForm = lista;

  if (tipoAtual === 'sorv') {
    renderizarSorvetes(main, lista);
    return;
  }

  // Bebidas (INÍCIO/FINAL): tela por local, com freezers e rascunho automático
  await renderizarBebidasPorLocal(main, lista);
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
  if (document.querySelector('#main-content .loc-input')) {
    const p = progressoPorLocal();
    const pct = p.total ? Math.round((p.feitos / p.total) * 100) : 0;
    document.getElementById('prog-texto').textContent = `${p.feitos} / ${p.total} campos`;
    document.getElementById('prog-fill').style.width = pct + '%';
    document.getElementById('prog-pct').textContent = pct + '%';
    LOCAIS.forEach(l => {
      const c = p.porLocal[l.loc] || { total: 0, feitos: 0 };
      const el = document.getElementById('tabc-' + l.loc);
      if (el) el.textContent = c.total ? `${c.feitos}/${c.total}` : '';
      const tab = document.getElementById('tab-' + l.loc);
      if (tab) tab.classList.toggle('completo', c.total > 0 && c.feitos === c.total);
    });
    return;
  }
  const rows = document.querySelectorAll('.produto-row');
  const preenchidos = document.querySelectorAll('.produto-row.preenchido').length;
  const total = rows.length;
  const pct = total ? Math.round((preenchidos / total) * 100) : 0;
  document.getElementById('prog-texto').textContent = `${preenchidos} / ${total} preenchidos`;
  document.getElementById('prog-fill').style.width = pct + '%';
  document.getElementById('prog-pct').textContent = pct + '%';
}

// ===== RECONTAGEM DO INÍCIO =====
// Com o restaurante fechado de noite, o INÍCIO tem que bater com o FINAL anterior
// (descontado o consumo interno daquele dia — mesma conta da virada D-1).
// Antes de salvar um INÍCIO novo, os itens que não bateram são pedidos de novo,
// SEM mostrar o número esperado (contagem cega). Uma rodada só; o que ele digitar
// vale. Cada item recontado ganha a marca `recontagem` (confirmou ou corrigiu),
// que a auditoria e o Telegram usam pra apontar quem errou: o início ou o final de ontem.
function totalDoItem(v) {
  if (!v || typeof v !== 'object') return 0;
  if (typeof v.total === 'number' && v.total > 0) return v.total;
  return (v.est || 0) + (v.frPrinc || 0) + (v.frAux || 0) + (v.fr || 0);
}

async function itensParaRecontar(data) {
  try {
    const todas = await listarContagens({ limite: 500 });
    // Último FINAL antes desta data (a lista vem do mais novo pro mais antigo)
    const finAnt = todas.find(c => c.tipo === 'fin' && c.data && c.data < data);
    if (!finAnt) return [];
    const consumo = (await listarConsumoInternoDia(finAnt.data)).itens || {};
    const pedir = [];
    _listaForm.forEach(item => {
      const id = slugify(item.nome);
      const esperado = totalDoItem((finAnt.itens || {})[id]) - (consumo[id] || 0);
      const contado = (dados[id] && dados[id].total) || 0;
      if (contado !== esperado) pedir.push({ id, nome: item.nome, contado });
    });
    return pedir;
  } catch (e) {
    // Se não der pra comparar (sem internet etc.), não trava o salvamento
    console.warn('[recontagem] não foi possível comparar com o final anterior:', e);
    return [];
  }
}

// Campos de um item na tela por local: estoque + cada freezer onde ele está.
// "Fora do lugar" só entra se o item não tem freezer naquele bar ou se tem número lá.
function camposDoItem(id) {
  const todos = [...document.querySelectorAll(`#main-content .loc-input[data-id="${id}"]`)]
    .filter(el => ['est', 'frPrinc', 'frAux'].includes(el.dataset.loc));
  return todos.filter(el => {
    if (el.dataset.fz !== OUTROS) return true;
    const temFreezer = todos.some(o => o.dataset.loc === el.dataset.loc && o.dataset.fz !== OUTROS);
    return !temFreezer || el.value !== '';
  });
}

function abrirRecontagem(itens) {
  const bg = document.createElement('div');
  bg.className = 'cal-picker-bg';
  bg.id = 'recontagem-bg';
  const blocos = itens.map(it => {
    const campos = camposDoItem(it.id);
    it._campos = campos.map(c => c.id);
    return `
      <div style="padding:10px 0;border-top:1px solid #eee">
        <div style="font-weight:700;margin-bottom:6px">${escH(it.nome)}</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:8px">
          ${campos.map(c => `
            <label style="font-size:11px;color:#666;text-align:center">${escH(c.dataset.rotulo)}
              <input class="num-input" type="number" min="0" inputmode="numeric" placeholder="—"
                     id="rc_${c.id}" style="width:100%;margin-top:4px" onfocus="this.select()">
            </label>`).join('')}
        </div>
      </div>`;
  }).join('');
  bg.innerHTML = `
    <div class="cal-picker" style="max-height:88vh;overflow-y:auto">
      <h3>🔁 Reconte antes de salvar</h3>
      <p style="font-size:13px;color:#555;margin:0 0 12px;line-height:1.45">
        ${itens.length === 1 ? 'Este item não bateu' : `Estes ${itens.length} itens não bateram`} com o final de ontem.
        Vá até cada lugar, <b>conte de novo</b> e digite tudo outra vez.
        Se der o mesmo número, tudo bem: salva assim mesmo.
      </p>
      ${blocos}
      <button class="cal-picker-btn" id="rc-salvar" style="margin-top:14px;background:var(--vinho);color:#fff;border-color:var(--vinho)">
        💾 Salvar com a recontagem
      </button>
      <button class="cal-picker-cancel" id="rc-voltar">Voltar e revisar</button>
    </div>`;
  document.body.appendChild(bg);
  document.getElementById('rc-voltar').onclick = () => bg.remove();
  document.getElementById('rc-salvar').onclick = () => {
    // Item todo em branco: confirma que é zero mesmo (pode ter esquecido)
    for (const it of itens) {
      const vazio = it._campos.every(cid => document.getElementById('rc_' + cid).value === '');
      if (vazio && !confirm(`${it.nome} ficou em branco na recontagem.\n\nSalvar como ZERO?`)) return;
    }
    const agora = new Date().toISOString();
    itens.forEach(it => {
      const antes = (dados[it.id] && dados[it.id].total) || 0;
      // Joga a recontagem nos campos da tela (atualiza total, conferir e rascunho)
      it._campos.forEach(cid => {
        const v = document.getElementById('rc_' + cid).value;
        const alvo = document.getElementById(cid);
        if (alvo) { alvo.value = v === '' ? '0' : v; window.atualizarLocal(alvo); }
      });
      const d = dados[it.id] || (dados[it.id] = {});
      const depois = d.total || 0;
      d.recontagem = { antes, depois, confirmado: antes === depois, em: agora };
    });
    bg.remove();
    _recontagemFeita = true;
    document.getElementById('btn-salvar').click();   // segue o salvamento normal
  };
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

  // Bebidas: campos do lugar ainda em branco contam como zero — confirma antes
  if ((tipoAtual === 'ini' || tipoAtual === 'fin') && !editandoContagemId && !_recontagemFeita) {
    const p = progressoPorLocal();
    const faltam = p.total - p.feitos;
    if (faltam > 0) {
      const det = LOCAIS.map(l => {
        const c = p.porLocal[l.loc];
        return c && c.total - c.feitos ? `${l.nome}: ${c.total - c.feitos}` : null;
      }).filter(Boolean).join(' · ');
      if (!confirm(`Ainda tem ${faltam} campo(s) em branco (${det}).\n\nEles contam como ZERO. Salvar assim mesmo?`)) return;
    }
  }

  // INÍCIO novo: antes de salvar, pede pra recontar o que não bateu com o final anterior
  if (tipoAtual === 'ini' && !editandoContagemId && !_recontagemFeita) {
    const btnR = document.getElementById('btn-salvar');
    btnR.disabled = true;
    btnR.innerHTML = '<span class="spinner"></span> Conferindo...';
    const pedir = await itensParaRecontar(data);
    btnR.disabled = false;
    btnR.innerHTML = '💾 Salvar Contagem';
    if (pedir.length) { abrirRecontagem(pedir); return; }
  }

  // Só salva os itens que foram preenchidos (de novo: a recontagem pode ter mudado)
  const itens = {};
  Object.keys(dados).filter(k => {
    const d = dados[k];
    return Object.keys(d).some(kk => d[kk] !== 0 && d[kk] !== '' && d[kk] != null);
  }).forEach(k => itens[k] = dados[k]);

  const btn = document.getElementById('btn-salvar');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Salvando...';

  try {
    if (editandoContagemId) {
      // Edição de dia existente: atualiza o doc (não cria duplicado)
      await atualizarContagem(editandoContagemId, itens, { editadoPor: sessao.nome });
    } else {
      // Anti-duplicata: se já existe contagem deste dia+tipo, SUBSTITUI (atualiza) em
      // vez de criar outro doc — impede o salvamento em dobro (2 docs do mesmo dia/tipo).
      const existente = await ultimaContagem({ tipo: tipoAtual, data });
      if (existente) {
        const rotulo = { ini: 'INÍCIO', fin: 'FINAL', sorv: 'SORVETE' }[tipoAtual] || tipoAtual;
        const ok = confirm(`Já existe uma contagem de ${rotulo} de ${data} (por ${existente.autorNome || 'alguém'}). Deseja SUBSTITUIR?`);
        if (!ok) {
          btn.disabled = false;
          btn.innerHTML = '💾 Salvar Contagem';
          return;
        }
        await atualizarContagem(existente.id, itens, { editadoPor: sessao.nome });
      } else {
        await salvarContagem({
          tipo: tipoAtual,
          data,
          autor: { id: sessao.id, nome: sessao.nome, perfil: sessao.perfil },
          itens
        });
      }
    }
    if (!editandoContagemId) limparRascunho();   // salvou: o rascunho não serve mais
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
  // Saindo dos freezers com mudança não salva: confirma
  if (modoAtual === 'freezers' && modo !== 'freezers' && _cfgSujo &&
      !confirm('A configuração dos freezers tem mudança NÃO salva.\n\nSair mesmo assim e perder a mudança?')) return;
  if (modoAtual === 'contar' && modo !== 'contar' && _rascTimer) salvarRascunho();
  modoAtual = modo;
  const contar = modo === 'contar';
  const cal = modo === 'calendario';
  const fz = modo === 'freezers';
  document.getElementById('modo-contar').classList.toggle('active', contar);
  document.getElementById('modo-cal').classList.toggle('active', cal);
  document.getElementById('modo-fz').classList.toggle('active', fz);

  document.querySelector('.tipo-selector').style.display = contar ? '' : 'none';
  document.querySelector('.data-bar').style.display      = contar ? '' : 'none';
  document.getElementById('main-content').style.display  = contar ? '' : 'none';
  document.getElementById('cal-view').style.display      = cal ? '' : 'none';
  document.getElementById('fz-view').style.display       = fz ? '' : 'none';

  if (contar) {
    // Volta pro formulário; barras só aparecem se um tipo estiver selecionado
    if (tipoAtual) {
      document.getElementById('progresso-bar').style.display = 'flex';
      document.getElementById('bottom-bar').style.display = 'flex';
    }
    // Freezers mudaram com uma contagem de bebidas aberta (e nova): redesenha.
    // O rascunho traz os números de volta.
    if (_cfgMudouDesdeContagem && (tipoAtual === 'ini' || tipoAtual === 'fin') && !editandoContagemId) {
      _cfgMudouDesdeContagem = false;
      window.selecionarTipo(tipoAtual);
    }
  } else {
    document.getElementById('progresso-bar').style.display = 'none';
    document.getElementById('bottom-bar').style.display = 'none';
    document.getElementById('edit-banner').style.display = 'none';
    if (cal) {
      _contagensCache = null; // recarrega pra pegar edições recentes
      renderCalendario();
    } else {
      renderFreezers();
    }
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

  if (_rascTimer) salvarRascunho();
  _carregandoEdicao = true;               // não restaura/grava rascunho durante a edição
  try {
    await selecionarTipo(contagem.tipo);   // renderiza o formulário vazio (e reseta edição)
    preencherFormComContagem(contagem);    // preenche com os valores salvos
  } finally {
    _carregandoEdicao = false;
  }

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
  if (tipoAtual !== 'sorv') { preencherBebidas(contagem); return; }
  const itens = contagem.itens || {};
  Object.entries(itens).forEach(([chave, v]) => {
    if (!v || typeof v !== 'object') return;
    let algumEl = null;
    Object.entries(v).forEach(([campo, val]) => {
      if (campo === 'total' || campo === 'vendeu' || campo === '_editado') return; // calculados/meta
      const el = document.getElementById(`${chave}_${campo}`);
      if (!el) return;
      algumEl = el;
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
    // 3C.2: selo de item alterado após o 1º lançamento
    if (v._editado && algumEl) {
      const row = algumEl.closest('.produto-row');
      const nomeEl = row && row.querySelector('.prod-nome');
      if (nomeEl && !nomeEl.querySelector('.selo-editado')) {
        nomeEl.insertAdjacentHTML('beforeend', seloEditadoContagem(v._editado));
      }
    }
  });
}

// Selo compacto de item alterado (lado do funcionário).
function seloEditadoContagem(e) {
  let quando = '';
  if (e && e.em) {
    const dt = new Date(e.em);
    if (!isNaN(dt)) quando = ` \u00b7 ${String(dt.getDate()).padStart(2,'0')}/${String(dt.getMonth()+1).padStart(2,'0')} ` +
      dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }
  const por = (e && e.por) || 'edição';
  return `<span class="selo-editado" style="display:inline-block;font-size:8px;padding:1px 5px;border-radius:6px;margin-left:5px;background:#e8f1fb;color:#1a5276;font-family:'DM Mono',monospace;font-weight:600;vertical-align:middle" title="Item alterado após o 1º lançamento">\u270f\ufe0f ${por}${quando}</span>`;
}

