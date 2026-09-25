// ============================================================
// PRIMUS ETIQUETAS - js/app.js (v10)
// v10: Fase 4 (historico e reimpressao em js/historico.js); QR da etiqueta abre o detalhe (?e=NUM)
// v7: Fase 3 (emissao em js/emissao.js) e configuracao do aparelho (tablet da cozinha x celular pessoal)
// v5: Fase 2c (produtos e grupos em js/produtos.js); utilitarios de tela em js/ui.js
// v4: usuarios separados em abas Ativos / Desativados
// v3: mensagem de usuario desativado nao some mais; modal nao corta o titulo
// Fase 2a: setup inicial, login usuario+PIN, tela inicial com status da impressora
// Fase 2b: usuarios (gestor e chef cadastram) e troca do proprio PIN
// ============================================================
import {
  auth, PAPEIS, normalizarUsuario, validarUsuario, validarPin, traduzirErro,
  setupFeito, fazerSetup, entrar, sair, observarSessao, carregarPerfil, observarAgentes,
  observarUsuarios, criarUsuario, atualizarUsuario, trocarMeuPin
} from "./db.js";
import {
  $, mostrarTela, mostrarErro, ocupado, abrirModal, fecharModal, fecharTodosModais, aviso, escapar, focarSemRolar
} from "./ui.js";
import { configurarProdutos, abrirProdutos, encerrarProdutos } from "./produtos.js";
import { configurarImportacao, abrirImportacao } from "./importacao.js";
import { configurarHistorico, abrirHistorico, abrirDetalhe, encerrarHistorico } from "./historico.js";

// QR da etiqueta: ?e=NUM abre o detalhe depois do login
let etiquetaDoQr = null;
(function lerQr() {
  const n = parseInt(new URLSearchParams(window.location.search).get("e"), 10);
  if (Number.isInteger(n) && n > 0) etiquetaDoQr = n;
  if (window.location.search) window.history.replaceState(null, "", window.location.pathname);
})();
import {
  configurarEmissao, abrirEmitir, encerrarEmissao, definirModoAparelho, modoAparelhoSalvo
} from "./emissao.js";

const VERSAO_APP = "v10";
const CHAVE_ULTIMO_USUARIO = "primusEtiquetas.ultimoUsuario";
const ONLINE_ATE_SEG = 150; // agente manda sinal a cada 60 s

const NOMES_PAPEL = { gestor: "Gestor", chef: "Chef", cozinha: "Cozinha" };


let perfilAtual = null;
let cancelarAgentes = null;
let agentesAtuais = [];
let timerStatus = null;
let setupRodando = false; // enquanto o setup roda, o observador de sessao espera
let cancelarUsuarios = null;
let usuariosAtuais = [];
let usuarioEmEdicao = null; // null = novo
let abaUsuarios = "ativos"; // "ativos" | "desativados"
let mensagemPendente = ""; // mostrada na tela de login depois de um sair() forcado

// ---------------------------------------------------------------- permissoes
function podeGerenciarUsuarios(p) {
  return !!p && (p.papel === "gestor" || p.papel === "chef");
}

function papeisQuePodeAtribuir(p) {
  if (!p) return [];
  if (p.papel === "gestor") return PAPEIS.slice();
  if (p.papel === "chef") return ["cozinha"];
  return [];
}

function podeEditarUsuario(p, alvo) {
  if (!p || !alvo) return false;
  if (p.papel === "gestor") return true;
  if (p.papel === "chef") return alvo.papel === "cozinha";
  return false;
}

// ---------------------------------------------------------------- memoria do ultimo usuario
function lerUltimoUsuario() {
  try { return localStorage.getItem(CHAVE_ULTIMO_USUARIO) || ""; } catch (e) { return ""; }
}

function gravarUltimoUsuario(usuario) {
  try { localStorage.setItem(CHAVE_ULTIMO_USUARIO, usuario); } catch (e) { /* ignora */ }
}

// ---------------------------------------------------------------- setup
async function enviarSetup(ev) {
  ev.preventDefault();
  mostrarErro("setup-erro", "");
  const nome = $("setup-nome").value.trim();
  const usuario = normalizarUsuario($("setup-usuario").value);
  const pin = $("setup-pin").value.trim();
  const pin2 = $("setup-pin2").value.trim();

  if (nome.length < 2) return mostrarErro("setup-erro", "Informe o seu nome.");
  const erroUsuario = validarUsuario(usuario);
  if (erroUsuario) return mostrarErro("setup-erro", erroUsuario);
  const erroPin = validarPin(pin);
  if (erroPin) return mostrarErro("setup-erro", erroPin);
  if (pin !== pin2) return mostrarErro("setup-erro", "Os dois PINs não são iguais.");

  const botao = $("setup-botao");
  ocupado(botao, true, "Criando...");
  setupRodando = true;
  try {
    await fazerSetup(nome, usuario, pin);
    gravarUltimoUsuario(usuario);
    const perfil = await carregarPerfil(auth.currentUser.uid);
    setupRodando = false;
    abrirInicio(perfil);
  } catch (e) {
    setupRodando = false;
    mostrarErro("setup-erro", traduzirErro(e));
    try { await sair(); } catch (e2) { /* ignora */ }
    mostrarTela("tela-setup");
  } finally {
    ocupado(botao, false);
  }
}

// ---------------------------------------------------------------- login
async function enviarLogin(ev) {
  ev.preventDefault();
  mostrarErro("login-erro", "");
  const usuario = normalizarUsuario($("login-usuario").value);
  const pin = $("login-pin").value.trim();

  const erroUsuario = validarUsuario(usuario);
  if (erroUsuario) return mostrarErro("login-erro", erroUsuario);
  const erroPin = validarPin(pin);
  if (erroPin) return mostrarErro("login-erro", erroPin);

  const botao = $("login-botao");
  ocupado(botao, true, "Entrando...");
  try {
    await entrar(usuario, pin);
    gravarUltimoUsuario(usuario);
  } catch (e) {
    mostrarErro("login-erro", traduzirErro(e));
    $("login-pin").value = "";
    $("login-pin").focus();
  } finally {
    ocupado(botao, false);
  }
}

function prepararLogin(mensagem) {
  $("login-usuario").value = lerUltimoUsuario();
  $("login-pin").value = "";
  mostrarErro("login-erro", mensagem || "");
  mostrarTela("tela-login");
  (lerUltimoUsuario() ? $("login-pin") : $("login-usuario")).focus();
}

// ---------------------------------------------------------------- tela inicial
function abrirInicio(perfil) {
  perfilAtual = perfil;
  $("inicio-nome").textContent = perfil.nome;
  $("inicio-papel").textContent = NOMES_PAPEL[perfil.papel] || perfil.papel;

  desenharAparelho();
  const cartaoUsuarios = $("acao-usuarios");
  if (podeGerenciarUsuarios(perfil)) {
    cartaoUsuarios.hidden = false;
  } else {
    cartaoUsuarios.hidden = true;
  }
  mostrarTela("tela-inicio");

  if (!cancelarAgentes) {
    cancelarAgentes = observarAgentes(
      (lista) => { agentesAtuais = lista; desenharStatus(); },
      (e) => { agentesAtuais = []; desenharStatus(traduzirErro(e)); }
    );
  }
  clearInterval(timerStatus);
  timerStatus = setInterval(() => desenharStatus(), 15000);
  desenharStatus();

  if (etiquetaDoQr) {
    const n = etiquetaDoQr;
    etiquetaDoQr = null;
    abrirDetalhe(n);
  }
}

function desenharAparelho() {
  const p = perfilAtual;
  const cartao = $("acao-aparelho");
  const podeConfigurar = !!p && (p.papel === "gestor" || p.papel === "chef");
  cartao.hidden = !podeConfigurar;
  if (!podeConfigurar) return;
  const tablet = modoAparelhoSalvo() === "tablet";
  $("aparelho-titulo").textContent = tablet ? "Este aparelho: tablet da cozinha" : "Este aparelho: celular pessoal";
  $("aparelho-texto").textContent = tablet
    ? "Cada sequência de etiquetas pede o PIN de quem está emitindo. Toque para mudar para celular pessoal."
    : "As etiquetas saem no seu nome, sem pedir PIN. Toque para transformar em tablet da cozinha.";
}

function trocarModoAparelho() {
  const tabletAgora = modoAparelhoSalvo() === "tablet";
  const msg = tabletAgora
    ? "Transformar este aparelho em celular pessoal? As etiquetas vão sair no nome de quem está logado, sem pedir PIN."
    : "Transformar este aparelho em tablet da cozinha? Cada sequência de etiquetas vai pedir o PIN de quem está emitindo.";
  if (!window.confirm(msg)) return;
  definirModoAparelho(!tabletAgora);
  desenharAparelho();
  aviso(tabletAgora ? "Aparelho definido como celular pessoal." : "Aparelho definido como tablet da cozinha.");
}

// Online = sinal do agente mais recente com menos de ONLINE_ATE_SEG
function impressoraOnline() {
  const comSinal = agentesAtuais.filter((a) => a.ultimoSinal);
  if (!comSinal.length) return false;
  const maisRecente = Math.max(...comSinal.map((a) => a.ultimoSinal.getTime()));
  return (Date.now() - maisRecente) / 1000 <= ONLINE_ATE_SEG;
}

function fecharSessaoLocal() {
  perfilAtual = null;
  if (cancelarAgentes) { cancelarAgentes(); cancelarAgentes = null; }
  if (cancelarUsuarios) { cancelarUsuarios(); cancelarUsuarios = null; }
  encerrarProdutos();
  encerrarEmissao();
  encerrarHistorico();
  clearInterval(timerStatus);
  agentesAtuais = [];
  usuariosAtuais = [];
  fecharTodosModais();
}

function tempoDesde(data) {
  const seg = Math.max(0, Math.round((Date.now() - data.getTime()) / 1000));
  if (seg < 60) return `${seg} s`;
  const min = Math.round(seg / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} h`;
  return `${Math.floor(h / 24)} dias`;
}

function desenharStatus(erro) {
  const caixa = $("status-impressora");
  const titulo = $("status-titulo");
  const detalhe = $("status-detalhe");
  caixa.classList.remove("online", "offline");

  if (erro) {
    caixa.classList.add("offline");
    titulo.textContent = "Não consegui ler o status";
    detalhe.textContent = erro;
    return;
  }
  const comSinal = agentesAtuais.filter((a) => a.ultimoSinal)
    .sort((a, b) => b.ultimoSinal - a.ultimoSinal);
  if (!comSinal.length) {
    caixa.classList.add("offline");
    titulo.textContent = "Impressora sem agente";
    detalhe.textContent = "Nenhum PC de impressão registrado ainda.";
    return;
  }
  const a = comSinal[0];
  const idadeSeg = (Date.now() - a.ultimoSinal.getTime()) / 1000;
  if (idadeSeg <= ONLINE_ATE_SEG) {
    caixa.classList.add("online");
    titulo.textContent = "Impressora online";
  } else {
    caixa.classList.add("offline");
    titulo.textContent = "Impressora offline";
  }
  detalhe.textContent = `PC ${a.id}, último sinal há ${tempoDesde(a.ultimoSinal)}` +
    (a.impressora ? `, ${a.impressora}` : "");
}

// Desloga e deixa a mensagem para o observador de sessao mostrar no login
async function sairComMensagem(msg) {
  mensagemPendente = msg || "";
  try { await sair(); } catch (e) { prepararLogin(msg); }
}

async function clicarSair() {
  fecharSessaoLocal();
  await sair();
}

// ---------------------------------------------------------------- usuarios: lista
function abrirUsuarios() {
  if (!podeGerenciarUsuarios(perfilAtual)) return;
  $("usuarios-dica").textContent = perfilAtual.papel === "chef"
    ? "Você pode cadastrar e editar usuários da cozinha."
    : "Toque em um usuário para editar.";
  abaUsuarios = "ativos";
  mostrarTela("tela-usuarios");
  if (!cancelarUsuarios) {
    $("lista-usuarios").innerHTML = '<p class="vazio">Carregando...</p>';
    cancelarUsuarios = observarUsuarios(
      (lista) => { usuariosAtuais = lista; desenharUsuarios(); },
      (e) => { $("lista-usuarios").innerHTML = `<p class="vazio">${escapar(traduzirErro(e))}</p>`; }
    );
  } else {
    desenharUsuarios();
  }
}

function trocarAbaUsuarios(aba) {
  abaUsuarios = aba;
  desenharUsuarios();
}

function desenharUsuarios() {
  const ativos = usuariosAtuais.filter((u) => u.ativo);
  const desativados = usuariosAtuais.filter((u) => !u.ativo);
  $("aba-ativos").textContent = `Ativos (${ativos.length})`;
  $("aba-desativados").textContent = `Desativados (${desativados.length})`;
  $("aba-ativos").classList.toggle("atual", abaUsuarios === "ativos");
  $("aba-desativados").classList.toggle("atual", abaUsuarios === "desativados");
  $("aba-ativos").setAttribute("aria-selected", abaUsuarios === "ativos" ? "true" : "false");
  $("aba-desativados").setAttribute("aria-selected", abaUsuarios === "desativados" ? "true" : "false");

  const lista = abaUsuarios === "ativos" ? ativos : desativados;
  const alvo = $("lista-usuarios");
  if (!lista.length) {
    alvo.innerHTML = abaUsuarios === "ativos"
      ? '<p class="vazio">Nenhum usuário ativo.</p>'
      : '<p class="vazio">Nenhum usuário desativado.</p>';
    return;
  }
  alvo.innerHTML = lista.map((u) => {
    const editavel = podeEditarUsuario(perfilAtual, u);
    const eu = perfilAtual && u.uid === perfilAtual.uid;
    return `
      <button type="button" class="linha-usuario${u.ativo ? "" : " inativo"}" data-uid="${escapar(u.uid)}" ${editavel ? "" : "disabled"}>
        <span class="nome-usuario">${escapar(u.nome)}${eu ? " (você)" : ""}</span>
        <span class="login-usuario">${escapar(u.usuario)}</span>
        <span class="selo selo-${escapar(u.papel)}">${escapar(NOMES_PAPEL[u.papel] || u.papel)}</span>
        ${u.ativo ? "" : '<span class="selo selo-inativo">Desativado</span>'}
      </button>`;
  }).join("");
}

function clicarListaUsuarios(ev) {
  const botao = ev.target.closest(".linha-usuario");
  if (!botao || botao.disabled) return;
  const u = usuariosAtuais.find((x) => x.uid === botao.dataset.uid);
  if (u) abrirFormUsuario(u);
}

// ---------------------------------------------------------------- usuarios: formulario
function preencherPapeis(selecionado, travado) {
  const sel = $("usuario-papel");
  const opcoes = papeisQuePodeAtribuir(perfilAtual);
  if (selecionado && !opcoes.includes(selecionado)) opcoes.push(selecionado);
  sel.innerHTML = opcoes.map((p) =>
    `<option value="${p}" ${p === selecionado ? "selected" : ""}>${NOMES_PAPEL[p]}</option>`).join("");
  sel.disabled = !!travado;
}

function abrirFormUsuario(usuario) {
  usuarioEmEdicao = usuario || null;
  mostrarErro("usuario-erro", "");
  const novo = !usuarioEmEdicao;
  const eu = !novo && usuarioEmEdicao.uid === perfilAtual.uid;

  $("usuario-titulo").textContent = novo ? "Novo usuário" : "Editar usuário";
  $("usuario-nome").value = novo ? "" : usuarioEmEdicao.nome;
  $("usuario-login").value = novo ? "" : usuarioEmEdicao.usuario;
  $("usuario-login").disabled = !novo;
  $("usuario-login-dica").textContent = novo
    ? "É o que a pessoa digita para entrar. Sem espaços nem acentos."
    : "O usuário não pode ser alterado.";

  // Chef so edita nome e ativo de quem e da cozinha; ninguem muda o proprio papel
  const travarPapel = !novo && (eu || perfilAtual.papel !== "gestor");
  preencherPapeis(novo ? papeisQuePodeAtribuir(perfilAtual).slice(-1)[0] : usuarioEmEdicao.papel, travarPapel);

  $("bloco-pin-novo").hidden = !novo;
  $("usuario-pin").value = "";
  $("usuario-pin2").value = "";

  $("bloco-ativo").hidden = novo || eu;
  $("usuario-ativo").checked = novo ? true : !!usuarioEmEdicao.ativo;

  $("usuario-salvar").textContent = novo ? "Cadastrar" : "Salvar alterações";
  abrirModal("modal-usuario");
  focarSemRolar("usuario-nome");
}

async function salvarUsuario(ev) {
  ev.preventDefault();
  mostrarErro("usuario-erro", "");
  const novo = !usuarioEmEdicao;
  const nome = $("usuario-nome").value.trim();
  const papel = $("usuario-papel").value;

  if (nome.length < 2) return mostrarErro("usuario-erro", "Informe o nome.");
  if (!papeisQuePodeAtribuir(perfilAtual).includes(papel) && (novo || papel !== usuarioEmEdicao.papel))
    return mostrarErro("usuario-erro", "Você não pode atribuir esse papel.");

  const botao = $("usuario-salvar");
  if (novo) {
    const usuario = normalizarUsuario($("usuario-login").value);
    const pin = $("usuario-pin").value.trim();
    const pin2 = $("usuario-pin2").value.trim();
    const erroUsuario = validarUsuario(usuario);
    if (erroUsuario) return mostrarErro("usuario-erro", erroUsuario);
    const erroPin = validarPin(pin);
    if (erroPin) return mostrarErro("usuario-erro", erroPin);
    if (pin !== pin2) return mostrarErro("usuario-erro", "Os dois PINs não são iguais.");

    ocupado(botao, true, "Cadastrando...");
    try {
      await criarUsuario({ nome, usuario, papel, pin });
      fecharModal("modal-usuario");
      aviso(`Usuário ${usuario} cadastrado.`);
    } catch (e) {
      mostrarErro("usuario-erro", traduzirErro(e));
    } finally {
      ocupado(botao, false);
    }
    return;
  }

  const campos = { nome };
  const eu = usuarioEmEdicao.uid === perfilAtual.uid;
  if (!eu && perfilAtual.papel === "gestor") campos.papel = papel;
  if (!eu) campos.ativo = $("usuario-ativo").checked;
  const mudouAtivo = !eu && campos.ativo !== !!usuarioEmEdicao.ativo;

  ocupado(botao, true, "Salvando...");
  try {
    await atualizarUsuario(usuarioEmEdicao.uid, campos);
    if (eu) {
      perfilAtual.nome = nome;
      $("inicio-nome").textContent = nome;
    }
    fecharModal("modal-usuario");
    if (mudouAtivo && !campos.ativo) aviso(`${nome} foi desativado. Está na aba Desativados.`);
    else if (mudouAtivo && campos.ativo) aviso(`${nome} foi reativado. Está na aba Ativos.`);
    else aviso("Alterações salvas.");
  } catch (e) {
    mostrarErro("usuario-erro", traduzirErro(e));
  } finally {
    ocupado(botao, false);
  }
}

// ---------------------------------------------------------------- meu PIN
function abrirMeuPin() {
  mostrarErro("pin-erro", "");
  $("pin-atual").value = "";
  $("pin-novo").value = "";
  $("pin-novo2").value = "";
  abrirModal("modal-pin");
  focarSemRolar("pin-atual");
}

async function salvarMeuPin(ev) {
  ev.preventDefault();
  mostrarErro("pin-erro", "");
  const atual = $("pin-atual").value.trim();
  const novo = $("pin-novo").value.trim();
  const novo2 = $("pin-novo2").value.trim();
  if (validarPin(atual)) return mostrarErro("pin-erro", "Digite o seu PIN atual (4 números).");
  const erroPin = validarPin(novo);
  if (erroPin) return mostrarErro("pin-erro", erroPin);
  if (novo !== novo2) return mostrarErro("pin-erro", "Os dois PINs novos não são iguais.");
  if (novo === atual) return mostrarErro("pin-erro", "O PIN novo é igual ao atual.");

  const botao = $("pin-salvar");
  ocupado(botao, true, "Trocando...");
  try {
    await trocarMeuPin(perfilAtual.usuario, atual, novo);
    fecharModal("modal-pin");
    aviso("PIN trocado.");
  } catch (e) {
    mostrarErro("pin-erro", traduzirErro(e));
  } finally {
    ocupado(botao, false);
  }
}

// ---------------------------------------------------------------- inicio
async function iniciar() {
  $("versao").textContent = VERSAO_APP;
  $("form-setup").addEventListener("submit", enviarSetup);
  $("form-login").addEventListener("submit", enviarLogin);
  $("botao-sair").addEventListener("click", clicarSair);
  $("botao-meu-pin").addEventListener("click", abrirMeuPin);
  $("acao-usuarios").addEventListener("click", abrirUsuarios);
  $("acao-produtos").addEventListener("click", abrirProdutos);
  $("acao-emitir").addEventListener("click", abrirEmitir);
  $("acao-historico").addEventListener("click", abrirHistorico);
  configurarHistorico({ impressoraOnline, voltar: () => abrirInicio(perfilAtual) });
  $("produtos-importar").addEventListener("click", abrirImportacao);
  configurarImportacao({ obterPerfil: () => perfilAtual });
  $("acao-aparelho").addEventListener("click", trocarModoAparelho);
  configurarEmissao({ obterPerfil: () => perfilAtual, impressoraOnline, voltar: () => abrirInicio(perfilAtual) });
  configurarProdutos({ obterPerfil: () => perfilAtual, voltar: () => abrirInicio(perfilAtual) });
  $("usuarios-voltar").addEventListener("click", () => abrirInicio(perfilAtual));
  $("usuarios-novo").addEventListener("click", () => abrirFormUsuario(null));
  $("lista-usuarios").addEventListener("click", clicarListaUsuarios);
  $("aba-ativos").addEventListener("click", () => trocarAbaUsuarios("ativos"));
  $("aba-desativados").addEventListener("click", () => trocarAbaUsuarios("desativados"));
  $("form-usuario").addEventListener("submit", salvarUsuario);
  $("usuario-cancelar").addEventListener("click", () => fecharModal("modal-usuario"));
  $("form-pin").addEventListener("submit", salvarMeuPin);
  $("pin-cancelar").addEventListener("click", () => fecharModal("modal-pin"));

  observarSessao(async (user) => {
    if (setupRodando) return;
    if (!user) {
      fecharSessaoLocal();
      try {
        if (await setupFeito()) {
          prepararLogin(mensagemPendente);
          mensagemPendente = "";
        } else {
          mostrarTela("tela-setup");
          $("setup-nome").focus();
        }
      } catch (e) {
        mostrarTela("tela-login");
        mostrarErro("login-erro", traduzirErro(e));
      }
      return;
    }
    mostrarTela("tela-carregando");
    try {
      const perfil = await carregarPerfil(user.uid);
      if (!perfil) {
        await sairComMensagem("Usuário sem cadastro no sistema. Fale com o gestor.");
        return;
      }
      if (!perfil.ativo) {
        await sairComMensagem("Usuário desativado. Fale com o gestor ou a chef.");
        return;
      }
      abrirInicio(perfil);
    } catch (e) {
      await sairComMensagem(traduzirErro(e));
    }
  });
}

iniciar();
