// ============================================================
// PRIMUS ETIQUETAS - js/app.js (v1)
// Fase 2a: setup inicial, login usuario+PIN, tela inicial com status da impressora
// ============================================================
import {
  auth, normalizarUsuario, validarUsuario, validarPin, traduzirErro,
  setupFeito, fazerSetup, entrar, sair, observarSessao, carregarPerfil, observarAgentes
} from "./db.js";

const VERSAO_APP = "v1";
const CHAVE_ULTIMO_USUARIO = "primusEtiquetas.ultimoUsuario";
const ONLINE_ATE_SEG = 150; // agente manda sinal a cada 60 s

const NOMES_PAPEL = { gestor: "Gestor", chef: "Chef", cozinha: "Cozinha" };

const $ = (id) => document.getElementById(id);

let perfilAtual = null;
let cancelarAgentes = null;
let agentesAtuais = [];
let timerStatus = null;
let setupRodando = false; // enquanto o setup roda, o observador de sessao espera

// ---------------------------------------------------------------- telas
function mostrarTela(id) {
  for (const t of document.querySelectorAll(".tela")) t.hidden = t.id !== id;
}

function mostrarErro(idCaixa, msg) {
  const el = $(idCaixa);
  el.textContent = msg || "";
  el.hidden = !msg;
}

function ocupado(botao, sim, textoOcupado) {
  if (sim) {
    botao.dataset.texto = botao.textContent;
    botao.textContent = textoOcupado || "Aguarde...";
    botao.disabled = true;
  } else {
    botao.textContent = botao.dataset.texto || botao.textContent;
    botao.disabled = false;
  }
}

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
  mostrarTela("tela-inicio");

  if (cancelarAgentes) cancelarAgentes();
  cancelarAgentes = observarAgentes(
    (lista) => { agentesAtuais = lista; desenharStatus(); },
    (e) => { agentesAtuais = []; desenharStatus(traduzirErro(e)); }
  );
  clearInterval(timerStatus);
  timerStatus = setInterval(() => desenharStatus(), 15000);
}

function fecharInicio() {
  perfilAtual = null;
  if (cancelarAgentes) { cancelarAgentes(); cancelarAgentes = null; }
  clearInterval(timerStatus);
  agentesAtuais = [];
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
  detalhe.textContent = `PC ${a.id} · último sinal há ${tempoDesde(a.ultimoSinal)}` +
    (a.impressora ? ` · ${a.impressora}` : "");
}

async function clicarSair() {
  fecharInicio();
  await sair();
}

// ---------------------------------------------------------------- inicio
async function iniciar() {
  $("versao").textContent = VERSAO_APP;
  $("form-setup").addEventListener("submit", enviarSetup);
  $("form-login").addEventListener("submit", enviarLogin);
  $("botao-sair").addEventListener("click", clicarSair);

  observarSessao(async (user) => {
    if (setupRodando) return;
    if (!user) {
      fecharInicio();
      try {
        if (await setupFeito()) {
          prepararLogin();
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
        await sair();
        prepararLogin("Usuário sem cadastro no sistema. Fale com o gestor.");
        return;
      }
      if (!perfil.ativo) {
        await sair();
        prepararLogin("Usuário desativado. Fale com o gestor.");
        return;
      }
      abrirInicio(perfil);
    } catch (e) {
      await sair();
      prepararLogin(traduzirErro(e));
    }
  });
}

iniciar();
