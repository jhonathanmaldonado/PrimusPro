// ===== USUÁRIOS — PRIMUS =====
// Gestão completa de usuários (só o gestor acessa).

import {
  listarUsuariosCompleto,
  criarUsuario,
  atualizarUsuario,
  trocarPin,
  setAtivoUsuario,
  getSessao
} from './auth.js';
import { db, doc, getDoc, setDoc } from './firebase-config.js';

// Lista de quem usa os bots do Telegram (Primus Vendas e Primus Avisos).
// Um doc so: primus_config/telegram -> { destinatarios: [{ nome, id, avisos }] }
// - id: chat id do Telegram (a pessoa descobre mandando /meuid no Primus Vendas)
// - avisos: true = recebe os automaticos (diferenca do dia, virada D-1)
const REF_TELEGRAM = () => doc(db, 'primus_config', 'telegram');
let telegramCache = [];

let usuariosCache = [];
let usuarioEditando = null;

// ===== INICIALIZAÇÃO =====
export async function inicializarUsuarios() {
  const container = document.getElementById('usuarios-container');
  if (!container) return;

  container.innerHTML = `
    <div class="card">
      <div class="usuarios-toolbar">
        <div class="grafico-head" style="border:none;margin:0;padding:0">
          <h3>👥 Equipe cadastrada</h3>
          <span class="grafico-sub" id="sub-usuarios"></span>
        </div>
        <button class="btn btn-primary" id="btn-novo-usuario">
          + Novo usuário
        </button>
      </div>

      <div id="usuarios-lista" class="usuarios-grid">
        <div style="text-align:center;padding:30px;grid-column:1/-1">
          <span class="spinner"></span>
        </div>
      </div>
    </div>

    <!-- Telegram: quem usa os bots -->
    <div class="card" style="margin-top:18px">
      <div class="grafico-head" style="border:none;margin:0 0 6px;padding:0">
        <h3>📨 Telegram — quem usa os bots</h3>
        <span class="grafico-sub" id="sub-telegram"></span>
      </div>
      <p style="font-size:13px;color:var(--cinza-texto);margin:0 0 14px;line-height:1.5">
        Cada pessoa aqui pode consultar <b>Vendas</b> e <b>Ranking</b> no bot Primus Vendas, no privado dela.
        Com <b>Avisos</b> ligado, recebe também os automáticos (diferença do dia, virada D-1).<br>
        Pra descobrir o número: a pessoa dá <b>/start</b> nos dois bots e manda <b>/meuid</b> no Primus Vendas.
      </p>
      <div id="telegram-lista"><span class="spinner"></span></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-top:14px">
        <div class="form-group" style="flex:1 1 160px;margin:0">
          <label>Nome</label>
          <input type="text" id="tg-nome" placeholder="Ex: Maria" maxlength="40">
        </div>
        <div class="form-group" style="flex:1 1 160px;margin:0">
          <label>Chat id</label>
          <input type="text" id="tg-id" placeholder="Ex: 8829509051" inputmode="numeric" maxlength="20">
        </div>
        <label style="display:flex;align-items:center;gap:6px;font-size:14px;padding-bottom:10px">
          <input type="checkbox" id="tg-avisos" checked> Recebe avisos
        </label>
        <button class="btn btn-primary" id="tg-adicionar">+ Adicionar</button>
      </div>
      <div class="form-erro" id="tg-erro" style="display:none;margin-top:10px"></div>
    </div>

    <!-- Modal de criar/editar -->
    <div class="modal-backdrop" id="modal-usuario">
      <div class="modal-box" style="max-width:440px">
        <button class="modal-close" id="modal-usuario-close">✕</button>
        <div class="modal-head">
          <h3 id="modal-usuario-titulo">Novo usuário</h3>
          <p id="modal-usuario-sub">Preencha os dados</p>
        </div>
        <div style="padding:20px 24px 24px">
          <div class="form-group">
            <label>Nome completo</label>
            <input type="text" id="form-nome" placeholder="Ex: João Silva" maxlength="80">
          </div>
          <div class="form-group">
            <label>Perfil</label>
            <select id="form-perfil">
              <option value="barman">Barman</option>
              <option value="gerente">Gerente</option>
              <option value="gestor">Gestor</option>
            </select>
            <small class="form-hint" id="form-perfil-hint"></small>
          </div>
          <div class="form-group" id="form-pin-group">
            <label>PIN de 4 dígitos</label>
            <input type="tel" id="form-pin" placeholder="••••" maxlength="4" inputmode="numeric" pattern="[0-9]{4}">
            <small class="form-hint">Esse será o código que a pessoa usa pra entrar no sistema.</small>
          </div>
          <div class="form-erro" id="form-erro" style="display:none"></div>
          <div class="form-acoes">
            <button class="btn btn-ghost" id="form-cancelar">Cancelar</button>
            <button class="btn btn-primary" id="form-salvar">Salvar</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Modal de trocar PIN -->
    <div class="modal-backdrop" id="modal-pin">
      <div class="modal-box" style="max-width:380px">
        <button class="modal-close" id="modal-pin-close">✕</button>
        <div class="modal-head">
          <h3>🔑 Trocar PIN</h3>
          <p id="modal-pin-sub"></p>
        </div>
        <div style="padding:20px 24px 24px">
          <div class="form-group">
            <label>Novo PIN (4 dígitos)</label>
            <input type="tel" id="form-novo-pin" placeholder="••••" maxlength="4" inputmode="numeric" pattern="[0-9]{4}">
          </div>
          <div class="form-group">
            <label>Confirmar novo PIN</label>
            <input type="tel" id="form-conf-pin" placeholder="••••" maxlength="4" inputmode="numeric" pattern="[0-9]{4}">
          </div>
          <div class="form-erro" id="form-pin-erro" style="display:none"></div>
          <div class="form-acoes">
            <button class="btn btn-ghost" id="form-pin-cancelar">Cancelar</button>
            <button class="btn btn-primary" id="form-pin-salvar">Atualizar PIN</button>
          </div>
        </div>
      </div>
    </div>
  `;

  setupEventos();
  document.getElementById('tg-adicionar').onclick = adicionarTelegram;
  document.getElementById('tg-id').addEventListener('input', e => {
    e.target.value = e.target.value.replace(/[^\d-]/g, '');   // so digitos (e o - de grupo)
  });
  await recarregar();
  await carregarTelegram();
}

// ===== TELEGRAM (destinatarios dos bots) =====
async function carregarTelegram() {
  const lista = document.getElementById('telegram-lista');
  try {
    const snap = await getDoc(REF_TELEGRAM());
    telegramCache = snap.exists() && Array.isArray(snap.data().destinatarios) ? snap.data().destinatarios : [];
    renderTelegram();
  } catch (e) {
    console.error(e);
    lista.innerHTML = `<div class="preview-err">Erro ao carregar: ${e.message}</div>`;
  }
}

function renderTelegram() {
  const lista = document.getElementById('telegram-lista');
  const comAvisos = telegramCache.filter(d => d.avisos).length;
  document.getElementById('sub-telegram').textContent = telegramCache.length
    ? `${telegramCache.length} ${telegramCache.length === 1 ? 'pessoa' : 'pessoas'} · ${comAvisos} com avisos`
    : '';
  if (!telegramCache.length) {
    lista.innerHTML = `<p style="font-size:13px;color:var(--cinza-texto);margin:0">
      Ninguém cadastrado ainda. <b>Comece por você</b> — enquanto a lista estiver vazia, os bots continuam só no seu Telegram.</p>`;
    return;
  }
  lista.innerHTML = telegramCache.map((d, i) => `
    <div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--cinza-borda)">
      <div style="flex:1;min-width:0">
        <div style="font-weight:600">${escHtml(d.nome)}</div>
        <div style="font-size:12px;color:var(--cinza-texto)">chat id ${escHtml(d.id)}</div>
      </div>
      <label style="display:flex;align-items:center;gap:6px;font-size:13px;white-space:nowrap">
        <input type="checkbox" ${d.avisos ? 'checked' : ''} onchange="tgToggleAvisos(${i}, this.checked)"> Avisos
      </label>
      <button class="icon-btn danger" title="Remover" onclick="tgRemover(${i})">🗑️</button>
    </div>`).join('');
}

async function salvarTelegram(nova) {
  const sessao = getSessao();
  await setDoc(REF_TELEGRAM(), {
    destinatarios: nova,
    atualizadoEm: new Date().toISOString(),
    atualizadoPor: sessao?.nome || ''
  });
  telegramCache = nova;
  renderTelegram();
}

async function adicionarTelegram() {
  const erro = document.getElementById('tg-erro');
  erro.style.display = 'none';
  const nome = document.getElementById('tg-nome').value.trim();
  const id = document.getElementById('tg-id').value.trim();
  const avisos = document.getElementById('tg-avisos').checked;
  if (!nome) return tgErro('Coloque o nome.');
  if (!/^-?\d{5,20}$/.test(id)) return tgErro('Chat id inválido — só números (a pessoa pega com /meuid).');
  if (telegramCache.some(d => String(d.id) === id)) return tgErro('Esse chat id já está na lista.');
  const btn = document.getElementById('tg-adicionar');
  btn.disabled = true;
  try {
    await salvarTelegram([...telegramCache, { nome, id, avisos }]);
    document.getElementById('tg-nome').value = '';
    document.getElementById('tg-id').value = '';
    document.getElementById('tg-avisos').checked = true;
    mostrarToast(`${nome} adicionado ao Telegram!`, 'ok');
  } catch (e) {
    console.error(e);
    tgErro('Erro ao salvar: ' + e.message);
  } finally {
    btn.disabled = false;
  }
}

window.tgToggleAvisos = async function(i, ligado) {
  const nova = telegramCache.map((d, j) => j === i ? { ...d, avisos: !!ligado } : d);
  try {
    await salvarTelegram(nova);
    mostrarToast(`Avisos ${ligado ? 'ligados' : 'desligados'} pra ${nova[i].nome}.`, 'ok');
  } catch (e) {
    console.error(e);
    mostrarToast('Erro: ' + e.message, 'err');
    renderTelegram();   // volta a caixinha pro estado real
  }
};

window.tgRemover = async function(i) {
  const d = telegramCache[i];
  if (!d || !confirm(`Tirar ${d.nome} dos bots do Telegram?\n\nA pessoa para de receber avisos e não consegue mais consultar.`)) return;
  try {
    await salvarTelegram(telegramCache.filter((_, j) => j !== i));
    mostrarToast(`${d.nome} removido.`, 'ok');
  } catch (e) {
    console.error(e);
    mostrarToast('Erro: ' + e.message, 'err');
  }
};

function tgErro(msg) {
  const el = document.getElementById('tg-erro');
  el.textContent = msg;
  el.style.display = 'block';
}

function escHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ===== EVENTOS =====
function setupEventos() {
  document.getElementById('btn-novo-usuario').onclick = abrirCriar;
  document.getElementById('modal-usuario-close').onclick = fecharModalUsuario;
  document.getElementById('form-cancelar').onclick = fecharModalUsuario;
  document.getElementById('form-salvar').onclick = salvarUsuario;
  document.getElementById('modal-pin-close').onclick = fecharModalPin;
  document.getElementById('form-pin-cancelar').onclick = fecharModalPin;
  document.getElementById('form-pin-salvar').onclick = salvarPin;

  // PIN só aceita números
  ['form-pin','form-novo-pin','form-conf-pin'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('input', e => {
        e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4);
      });
    }
  });

  // Aviso sobre perfil gestor
  document.getElementById('form-perfil').addEventListener('change', e => {
    const hint = document.getElementById('form-perfil-hint');
    if (e.target.value === 'gestor') {
      hint.textContent = '⚠️ Gestores têm acesso a tudo, inclusive gestão de usuários.';
      hint.style.color = 'var(--amarelo-status)';
    } else if (e.target.value === 'gerente') {
      hint.textContent = 'Gerentes fazem contagens e veem o Dashboard (sem auditoria, compras, vendas, catálogo e usuários).';
      hint.style.color = 'var(--cinza-texto)';
    } else {
      hint.textContent = 'Barmen só fazem contagens de estoque.';
      hint.style.color = 'var(--cinza-texto)';
    }
  });

  // Fechar modal clicando fora
  document.getElementById('modal-usuario').addEventListener('click', e => {
    if (e.target.id === 'modal-usuario') fecharModalUsuario();
  });
  document.getElementById('modal-pin').addEventListener('click', e => {
    if (e.target.id === 'modal-pin') fecharModalPin();
  });
}

// ===== CARREGAR / RENDERIZAR =====
async function recarregar() {
  const lista = document.getElementById('usuarios-lista');
  try {
    usuariosCache = await listarUsuariosCompleto();
    renderizar();
  } catch (e) {
    console.error(e);
    lista.innerHTML = `<div class="preview-err" style="grid-column:1/-1">Erro ao carregar: ${e.message}</div>`;
  }
}

function renderizar() {
  const lista = document.getElementById('usuarios-lista');
  const sub = document.getElementById('sub-usuarios');
  const ativos = usuariosCache.filter(u => u.ativo).length;
  const inativos = usuariosCache.length - ativos;
  sub.textContent = `${ativos} ${ativos === 1 ? 'ativo' : 'ativos'}${inativos ? ` · ${inativos} ${inativos === 1 ? 'inativo' : 'inativos'}` : ''}`;

  if (!usuariosCache.length) {
    lista.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1;box-shadow:none;padding:30px">
        <div class="empty-icon">👥</div>
        <h3>Nenhum usuário cadastrado</h3>
      </div>`;
    return;
  }

  const sessao = getSessao();
  const meuId = sessao?.id;

  lista.innerHTML = usuariosCache.map(u => {
    const ini = iniciais(u.nome);
    const ehEu = u.id === meuId;
    return `
      <div class="user-admin-card ${u.ativo ? '' : 'inativo'}">
        <div class="user-admin-avatar">${ini}</div>
        <div class="user-admin-info">
          <div class="user-admin-nome">
            ${u.nome}
            ${ehEu ? '<span class="user-admin-eu">você</span>' : ''}
          </div>
          <div class="user-admin-meta">
            <span class="perfil-badge ${u.perfil}">${u.perfil}</span>
            ${!u.ativo ? '<span class="badge-inativo">INATIVO</span>' : ''}
          </div>
        </div>
        <div class="user-admin-acoes">
          <button class="icon-btn" title="Editar" onclick="editarUsuario('${u.id}')">✏️</button>
          <button class="icon-btn" title="Trocar PIN" onclick="abrirTrocarPin('${u.id}')">🔑</button>
          ${u.ativo
            ? (ehEu
                ? `<button class="icon-btn" title="Você não pode desativar a si mesmo" disabled>🚫</button>`
                : `<button class="icon-btn danger" title="Desativar" onclick="desativarUsuario('${u.id}')">🚫</button>`)
            : `<button class="icon-btn" title="Reativar" onclick="reativarUsuario('${u.id}')">✅</button>`
          }
        </div>
      </div>
    `;
  }).join('');
}

// ===== ABRIR MODAL NOVO =====
function abrirCriar() {
  usuarioEditando = null;
  document.getElementById('modal-usuario-titulo').textContent = 'Novo usuário';
  document.getElementById('modal-usuario-sub').textContent = 'Preencha os dados';
  document.getElementById('form-nome').value = '';
  document.getElementById('form-perfil').value = 'barman';
  document.getElementById('form-perfil').dispatchEvent(new Event('change'));
  document.getElementById('form-pin').value = '';
  document.getElementById('form-pin-group').style.display = 'block';
  document.getElementById('form-erro').style.display = 'none';
  document.getElementById('modal-usuario').classList.add('open');
  setTimeout(() => document.getElementById('form-nome').focus(), 100);
}

// ===== ABRIR MODAL EDITAR =====
window.editarUsuario = function(id) {
  const u = usuariosCache.find(x => x.id === id);
  if (!u) return;
  usuarioEditando = u;
  document.getElementById('modal-usuario-titulo').textContent = 'Editar usuário';
  document.getElementById('modal-usuario-sub').textContent = `Alterando: ${u.nome}`;
  document.getElementById('form-nome').value = u.nome;
  document.getElementById('form-perfil').value = u.perfil;
  document.getElementById('form-perfil').dispatchEvent(new Event('change'));
  document.getElementById('form-pin-group').style.display = 'none';
  document.getElementById('form-erro').style.display = 'none';
  document.getElementById('modal-usuario').classList.add('open');
  setTimeout(() => document.getElementById('form-nome').focus(), 100);
};

function fecharModalUsuario() {
  document.getElementById('modal-usuario').classList.remove('open');
}

// ===== SALVAR (criar ou editar) =====
async function salvarUsuario() {
  const nome = document.getElementById('form-nome').value.trim();
  const perfil = document.getElementById('form-perfil').value;
  const pin = document.getElementById('form-pin').value.trim();
  const erroEl = document.getElementById('form-erro');
  erroEl.style.display = 'none';

  if (!nome) return mostrarErro(erroEl, 'Nome é obrigatório.');
  if (nome.length < 2) return mostrarErro(erroEl, 'Nome muito curto.');
  if (!usuarioEditando && !/^\d{4}$/.test(pin)) {
    return mostrarErro(erroEl, 'PIN precisa ter exatamente 4 dígitos.');
  }

  const btn = document.getElementById('form-salvar');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Salvando...';

  try {
    if (usuarioEditando) {
      await atualizarUsuario(usuarioEditando.id, { nome, perfil });
      mostrarToast(`${nome} atualizado!`, 'ok');
    } else {
      await criarUsuario({ nome, perfil, pin });
      mostrarToast(`${nome} cadastrado!`, 'ok');
    }
    fecharModalUsuario();
    await recarregar();
  } catch (e) {
    console.error(e);
    mostrarErro(erroEl, e.message || 'Erro ao salvar.');
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Salvar';
  }
}

// ===== TROCAR PIN =====
window.abrirTrocarPin = function(id) {
  const u = usuariosCache.find(x => x.id === id);
  if (!u) return;
  usuarioEditando = u;
  document.getElementById('modal-pin-sub').textContent = `Usuário: ${u.nome}`;
  document.getElementById('form-novo-pin').value = '';
  document.getElementById('form-conf-pin').value = '';
  document.getElementById('form-pin-erro').style.display = 'none';
  document.getElementById('modal-pin').classList.add('open');
  setTimeout(() => document.getElementById('form-novo-pin').focus(), 100);
};

function fecharModalPin() {
  document.getElementById('modal-pin').classList.remove('open');
}

async function salvarPin() {
  const novo = document.getElementById('form-novo-pin').value.trim();
  const conf = document.getElementById('form-conf-pin').value.trim();
  const erroEl = document.getElementById('form-pin-erro');
  erroEl.style.display = 'none';

  if (!/^\d{4}$/.test(novo)) return mostrarErro(erroEl, 'PIN precisa ter 4 dígitos.');
  if (novo !== conf) return mostrarErro(erroEl, 'Os PINs não coincidem.');

  const btn = document.getElementById('form-pin-salvar');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Atualizando...';

  try {
    await trocarPin(usuarioEditando.id, novo);
    mostrarToast(`PIN de ${usuarioEditando.nome} atualizado!`, 'ok');
    fecharModalPin();
  } catch (e) {
    console.error(e);
    mostrarErro(erroEl, e.message || 'Erro ao atualizar PIN.');
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Atualizar PIN';
  }
}

// ===== DESATIVAR / REATIVAR =====
window.desativarUsuario = async function(id) {
  const u = usuariosCache.find(x => x.id === id);
  if (!u) return;
  if (!confirm(`Desativar ${u.nome}?\n\nA pessoa não vai conseguir mais fazer login, mas o histórico das contagens feitas por ela fica preservado.\n\nVocê pode reativar a qualquer momento.`)) return;

  try {
    await setAtivoUsuario(id, false);
    mostrarToast(`${u.nome} desativado.`, 'ok');
    await recarregar();
  } catch (e) {
    console.error(e);
    mostrarToast('Erro: ' + e.message, 'err');
  }
};

window.reativarUsuario = async function(id) {
  const u = usuariosCache.find(x => x.id === id);
  if (!u) return;
  try {
    await setAtivoUsuario(id, true);
    mostrarToast(`${u.nome} reativado.`, 'ok');
    await recarregar();
  } catch (e) {
    console.error(e);
    mostrarToast('Erro: ' + e.message, 'err');
  }
};

// ===== UTILS =====
function iniciais(nome) {
  return nome.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
}

function mostrarErro(el, msg) {
  el.textContent = msg;
  el.style.display = 'block';
  document.getElementById('form-salvar').disabled = false;
  document.getElementById('form-salvar').innerHTML = 'Salvar';
  document.getElementById('form-pin-salvar').disabled = false;
  document.getElementById('form-pin-salvar').innerHTML = 'Atualizar PIN';
}

function mostrarToast(msg, tipo = '') {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'toast show ' + tipo;
  setTimeout(() => t.className = 'toast', 2800);
}
