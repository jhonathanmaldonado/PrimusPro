// ============================================================
// PRIMUS ETIQUETAS - js/emissao.js (v2)
// v2: comResponsavel() e acompanhar() exportados para a reimpressao (Fase 4)
// Fase 3: emissao de etiquetas
// - escolher produto (busca + grupos), modo de conservacao, quantidade e hora de manipulacao
// - no tablet da cozinha, cada sequencia de etiquetas pede o PIN de quem esta emitindo
// - acompanha o pedido na fila ate "impresso" ou "erro"
// ============================================================
import {
  MODOS, normalizarBusca, traduzirErro, normalizarUsuario,
  emitirEtiqueta, observarEtiqueta, verificarPin, observarUsuarios, formatarCodigo
} from "./db.js";
import {
  $, mostrarTela, mostrarErro, ocupado, abrirModal, fecharModal, aviso, escapar, focarSemRolar
} from "./ui.js";
import { garantirDados, obterProdutos, obterGrupos, nomeDoGrupo, textoValidade } from "./produtos.js";

const CHAVE_MODO_APARELHO = "primusEtiquetas.modoAparelho"; // "tablet" | "pessoal"
const RESPONSAVEL_VALE_MS = 2 * 60 * 1000;   // no tablet, o PIN vale por 2 min apos a ultima impressao
const MAX_COPIAS = 30;
const MAX_ATRAS_HORAS = 24;

let getPerfil = () => null;
let getImpressoraOnline = () => false;
let filtroGrupo = "";
let textoBusca = "";
let produtoAtual = null;
let modoAtual = null;
let copias = 1;
let manipulacaoAgora = true;
let responsavel = null;        // { uid, nome, validoAte }
let usuariosAtivos = [];
let cancelarUsuarios = null;
let usuarioEscolhido = null;
let acaoDepoisDoPin = null;
const acompanhando = new Map(); // num -> cancelar

// ---------------------------------------------------------------- aparelho
export function aparelhoEhTablet() {
  const p = getPerfil();
  let modo = "";
  try { modo = localStorage.getItem(CHAVE_MODO_APARELHO) || ""; } catch (e) { /* ignora */ }
  if (modo === "tablet") return true;
  return !!p && p.papel === "cozinha";
}

export function definirModoAparelho(tablet) {
  try { localStorage.setItem(CHAVE_MODO_APARELHO, tablet ? "tablet" : "pessoal"); } catch (e) { /* ignora */ }
  responsavel = null;
}

export function modoAparelhoSalvo() {
  try { return localStorage.getItem(CHAVE_MODO_APARELHO) || "pessoal"; } catch (e) { return "pessoal"; }
}

// ---------------------------------------------------------------- configuracao
export function configurarEmissao({ obterPerfil, impressoraOnline, voltar }) {
  getPerfil = obterPerfil;
  getImpressoraOnline = impressoraOnline;
  $("emitir-voltar").addEventListener("click", voltar);
  $("emitir-busca").addEventListener("input", (ev) => { textoBusca = ev.target.value; desenharProdutos(); });
  $("emitir-grupos").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-grupo]");
    if (b) { filtroGrupo = b.dataset.grupo; desenharGrupos(); desenharProdutos(); }
  });
  $("emitir-lista").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-produto]");
    if (!b) return;
    const p = obterProdutos().find((x) => x.id === b.dataset.produto);
    if (p) abrirEmissao(p);
  });
  $("emitir-quem-trocar").addEventListener("click", () => { responsavel = null; desenharQuem(); pedirResponsavel(null); });

  $("emissao-modos").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-modo]");
    if (b) { modoAtual = MODOS.find((m) => m.id === b.dataset.modo) || null; desenharEmissao(); }
  });
  $("emissao-menos").addEventListener("click", () => { copias = Math.max(1, copias - 1); desenharEmissao(); });
  $("emissao-mais").addEventListener("click", () => { copias = Math.min(MAX_COPIAS, copias + 1); desenharEmissao(); });
  $("emissao-agora").addEventListener("click", () => { manipulacaoAgora = true; desenharEmissao(); });
  $("emissao-antes").addEventListener("click", () => {
    manipulacaoAgora = false;
    if (!$("emissao-hora").value) $("emissao-hora").value = horaAtualTexto();
    desenharEmissao();
    focarSemRolar("emissao-hora");
  });
  $("emissao-hora").addEventListener("input", desenharEmissao);
  $("emissao-cancelar").addEventListener("click", () => fecharModal("modal-emissao"));
  $("form-emissao").addEventListener("submit", clicarImprimir);

  $("responsavel-lista").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-uid]");
    if (!b) return;
    usuarioEscolhido = usuariosAtivos.find((u) => u.uid === b.dataset.uid) || null;
    desenharResponsaveis();
  });
  $("responsavel-cancelar").addEventListener("click", () => { acaoDepoisDoPin = null; fecharModal("modal-responsavel"); });
  $("form-responsavel").addEventListener("submit", confirmarResponsavel);

  $("acompanhamento").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-fechar]");
    if (b) { const card = b.closest(".status-envio"); if (card) card.remove(); }
  });
}

export function abrirEmitir() {
  filtroGrupo = "";
  textoBusca = "";
  $("emitir-busca").value = "";
  mostrarTela("tela-emitir");
  garantirDados(() => { if (!$("tela-emitir").hidden) { desenharGrupos(); desenharProdutos(); } });
  desenharQuem();
  desenharGrupos();
  desenharProdutos();
}

export function encerrarEmissao() {
  responsavel = null;
  if (cancelarUsuarios) { cancelarUsuarios(); cancelarUsuarios = null; }
  usuariosAtivos = [];
  for (const cancelar of acompanhando.values()) cancelar();
  acompanhando.clear();
  $("acompanhamento").innerHTML = "";
}

// ---------------------------------------------------------------- lista de produtos
function desenharQuem() {
  const tablet = aparelhoEhTablet();
  $("emitir-quem").hidden = !tablet;
  if (!tablet) return;
  const valido = responsavel && responsavel.validoAte > Date.now();
  $("emitir-quem-texto").textContent = valido
    ? `Emitindo como ${responsavel.nome}`
    : "Ao imprimir, o sistema vai pedir o seu PIN.";
  $("emitir-quem-trocar").hidden = !valido;
}

function desenharGrupos() {
  const produtos = obterProdutos().filter((p) => p.ativo);
  const usados = new Set(produtos.map((p) => p.grupoId));
  const grupos = obterGrupos().filter((g) => usados.has(g.id));
  $("emitir-grupos").innerHTML = [`<button type="button" class="chip${filtroGrupo === "" ? " atual" : ""}" data-grupo="">Todos</button>`]
    .concat(grupos.map((g) => `<button type="button" class="chip${filtroGrupo === g.id ? " atual" : ""}" data-grupo="${escapar(g.id)}">${escapar(g.nome)}</button>`))
    .join("");
}

function desenharProdutos() {
  let lista = obterProdutos().filter((p) => p.ativo);
  if (filtroGrupo) lista = lista.filter((p) => p.grupoId === filtroGrupo);
  const termo = normalizarBusca(textoBusca);
  if (termo) {
    const partes = termo.split(" ");
    lista = lista.filter((p) => partes.every((t) => (p.nomeBusca || "").includes(t)));
  }
  const alvo = $("emitir-lista");
  if (!obterProdutos().length) {
    alvo.innerHTML = '<p class="vazio">Carregando produtos...</p>';
    return;
  }
  if (!lista.length) {
    alvo.innerHTML = '<p class="vazio">Nenhum produto encontrado.</p>';
    return;
  }
  alvo.innerHTML = lista.map((p) => `
    <button type="button" class="linha-produto emitir" data-produto="${escapar(p.id)}">
      <span class="nome-produto">${escapar(p.nome)}</span>
      <span class="grupo-produto">${escapar(nomeDoGrupo(p.grupoId))}</span>
    </button>`).join("");
}

// ---------------------------------------------------------------- painel de emissao
function horaAtualTexto() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function modosDisponiveis(p) {
  return MODOS.filter((m) => p.validades && p.validades[m.id] != null);
}

function abrirEmissao(produto) {
  produtoAtual = produto;
  const modos = modosDisponiveis(produto);
  modoAtual = modos.length === 1 ? modos[0] : null;
  copias = 1;
  manipulacaoAgora = true;
  $("emissao-hora").value = "";
  mostrarErro("emissao-erro", "");
  $("emissao-produto").textContent = produto.nome;
  $("emissao-modos").innerHTML = modos.map((m) => `
    <button type="button" class="botao-modo modo-${m.id}" data-modo="${m.id}">
      <strong>${escapar(m.nome)}</strong><span>${escapar(textoValidade(produto.validades[m.id]))}</span>
    </button>`).join("");
  desenharEmissao();
  abrirModal("modal-emissao");
}

// Retorna { data } ou { erro }
function calcularManipulacao() {
  const agora = new Date();
  if (manipulacaoAgora) {
    agora.setSeconds(0, 0);
    return { data: agora };
  }
  const v = $("emissao-hora").value;
  if (!/^\d{2}:\d{2}$/.test(v)) return { erro: "Informe a hora da manipulação." };
  const [h, m] = v.split(":").map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  if (d.getTime() > Date.now()) d.setDate(d.getDate() - 1); // hora "no futuro" = ontem
  if (Date.now() - d.getTime() > MAX_ATRAS_HORAS * 3600000) return { erro: `No máximo ${MAX_ATRAS_HORAS} horas atrás.` };
  return { data: d };
}

const fmtDataHora = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

function desenharEmissao() {
  for (const b of $("emissao-modos").querySelectorAll("[data-modo]")) {
    b.classList.toggle("atual", !!modoAtual && b.dataset.modo === modoAtual.id);
  }
  $("emissao-copias").textContent = String(copias);
  $("emissao-menos").disabled = copias <= 1;
  $("emissao-mais").disabled = copias >= MAX_COPIAS;
  $("emissao-agora").classList.toggle("atual", manipulacaoAgora);
  $("emissao-antes").classList.toggle("atual", !manipulacaoAgora);
  $("bloco-hora").hidden = manipulacaoAgora;

  const resumo = $("emissao-resumo");
  const m = calcularManipulacao();
  if (!modoAtual) {
    resumo.innerHTML = '<span class="resumo-dica">Escolha o modo de conservação.</span>';
  } else if (m.erro) {
    resumo.innerHTML = `<span class="resumo-dica">${escapar(m.erro)}</span>`;
  } else {
    const horas = produtoAtual.validades[modoAtual.id];
    const validade = new Date(m.data.getTime() + horas * 3600000);
    resumo.innerHTML = `
      <span>Manipulação <strong>${escapar(fmtDataHora.format(m.data))}</strong></span>
      <span class="resumo-validade">Validade <strong>${escapar(fmtDataHora.format(validade))}</strong></span>`;
  }

  const online = getImpressoraOnline();
  $("emissao-offline").hidden = online;
  const botao = $("emissao-imprimir");
  botao.disabled = !online || !modoAtual || !!m.erro;
  botao.textContent = copias === 1 ? "Imprimir 1 etiqueta" : `Imprimir ${copias} etiquetas`;
}

function clicarImprimir(ev) {
  ev.preventDefault();
  mostrarErro("emissao-erro", "");
  if (!modoAtual) return mostrarErro("emissao-erro", "Escolha o modo de conservação.");
  if (!getImpressoraOnline()) return mostrarErro("emissao-erro", "Impressora offline. Confira o PC da cozinha.");
  const m = calcularManipulacao();
  if (m.erro) return mostrarErro("emissao-erro", m.erro);

  if (aparelhoEhTablet()) {
    if (responsavel && responsavel.validoAte > Date.now()) {
      enviar();
    } else {
      pedirResponsavel(enviar);
    }
  } else {
    const p = getPerfil();
    responsavel = { uid: p.uid, nome: p.nome, validoAte: Infinity };
    enviar();
  }
}

async function enviar() {
  const m = calcularManipulacao();
  if (m.erro) return mostrarErro("emissao-erro", m.erro);
  const botao = $("emissao-imprimir");
  ocupado(botao, true, "Enviando...");
  try {
    const r = await emitirEtiqueta({
      produto: produtoAtual,
      modo: modoAtual,
      horas: produtoAtual.validades[modoAtual.id],
      manipulacao: m.data,
      copias,
      responsavel: { uid: responsavel.uid, nome: responsavel.nome }
    });
    if (aparelhoEhTablet()) responsavel.validoAte = Date.now() + RESPONSAVEL_VALE_MS;
    fecharModal("modal-emissao");
    acompanhar(r.num, produtoAtual.nome, copias);
    desenharQuem();
  } catch (e) {
    mostrarErro("emissao-erro", traduzirErro(e));
  } finally {
    ocupado(botao, false);
    desenharEmissao();
  }
}

// ---------------------------------------------------------------- responsavel para outras telas
// Chama fn({uid, nome}) com quem esta operando: no tablet pede o PIN (se o anterior expirou)
export function comResponsavel(fn) {
  const executar = async () => {
    const r = { uid: responsavel.uid, nome: responsavel.nome };
    await fn(r);
    if (aparelhoEhTablet() && responsavel) responsavel.validoAte = Date.now() + RESPONSAVEL_VALE_MS;
  };
  if (aparelhoEhTablet()) {
    if (responsavel && responsavel.validoAte > Date.now()) return executar();
    pedirResponsavel(executar);
    return;
  }
  const p = getPerfil();
  responsavel = { uid: p.uid, nome: p.nome, validoAte: Infinity };
  return executar();
}

// ---------------------------------------------------------------- acompanhamento do pedido
// id = id do documento na fila (numero da etiqueta ou id da reimpressao)
export function acompanhar(id, nome, qtd, rotulo) {
  const num = id;
  const alvo = $("acompanhamento");
  const card = document.createElement("div");
  card.className = "status-envio enviando";
  card.id = `envio-${num}`;
  card.innerHTML = `<div><strong>${escapar(rotulo || "#" + formatarCodigo(num))} ${escapar(nome)}</strong><span class="status-texto">Enviando para a impressora...</span></div>`;
  alvo.prepend(card);

  const cancelar = observarEtiqueta(num, (d) => {
    const texto = card.querySelector(".status-texto");
    if (!d) return;
    if (d.status === "imprimindo") {
      texto.textContent = "Imprimindo...";
    } else if (d.status === "impresso") {
      card.className = "status-envio ok";
      texto.textContent = qtd === 1 ? "Impressa." : `${qtd} etiquetas impressas.`;
      encerrar();
      setTimeout(() => card.remove(), 6000);
    } else if (d.status === "erro") {
      card.className = "status-envio falhou";
      texto.textContent = `Não imprimiu: ${d.erro || "erro desconhecido"}`;
      card.insertAdjacentHTML("beforeend", '<button type="button" class="botao-link" data-fechar>OK</button>');
      encerrar();
    }
  });
  function encerrar() {
    cancelar();
    acompanhando.delete(num);
  }
  acompanhando.set(num, cancelar);
}

// ---------------------------------------------------------------- responsavel (tablet)
function pedirResponsavel(depois) {
  acaoDepoisDoPin = depois;
  usuarioEscolhido = null;
  $("responsavel-pin").value = "";
  mostrarErro("responsavel-erro", "");
  if (!cancelarUsuarios) {
    cancelarUsuarios = observarUsuarios(
      (lista) => { usuariosAtivos = lista.filter((u) => u.ativo); desenharResponsaveis(); },
      (e) => mostrarErro("responsavel-erro", traduzirErro(e))
    );
  }
  desenharResponsaveis();
  abrirModal("modal-responsavel");
}

function desenharResponsaveis() {
  $("responsavel-lista").innerHTML = usuariosAtivos.map((u) =>
    `<button type="button" class="chip nome${usuarioEscolhido && usuarioEscolhido.uid === u.uid ? " atual" : ""}" data-uid="${escapar(u.uid)}">${escapar(u.nome)}</button>`
  ).join("") || '<p class="vazio">Carregando...</p>';
  $("bloco-pin-responsavel").hidden = !usuarioEscolhido;
  $("responsavel-confirmar").disabled = !usuarioEscolhido;
  if (usuarioEscolhido) {
    $("responsavel-pin-rotulo").textContent = `PIN de ${usuarioEscolhido.nome}`;
    focarSemRolar("responsavel-pin");
  }
}

async function confirmarResponsavel(ev) {
  ev.preventDefault();
  mostrarErro("responsavel-erro", "");
  if (!usuarioEscolhido) return mostrarErro("responsavel-erro", "Toque no seu nome.");
  const pin = $("responsavel-pin").value.trim();
  if (!/^\d{4}$/.test(pin)) return mostrarErro("responsavel-erro", "Digite o PIN (4 números).");
  const botao = $("responsavel-confirmar");
  ocupado(botao, true, "Conferindo...");
  try {
    const uid = await verificarPin(normalizarUsuario(usuarioEscolhido.usuario), pin);
    if (uid !== usuarioEscolhido.uid) throw new Error("Usuário não confere.");
    responsavel = { uid, nome: usuarioEscolhido.nome, validoAte: Date.now() + RESPONSAVEL_VALE_MS };
    fecharModal("modal-responsavel");
    desenharQuem();
    const depois = acaoDepoisDoPin;
    acaoDepoisDoPin = null;
    if (depois) await depois();
  } catch (e) {
    $("responsavel-pin").value = "";
    mostrarErro("responsavel-erro", traduzirErro(e));
  } finally {
    ocupado(botao, false);
    $("responsavel-confirmar").disabled = !usuarioEscolhido;
  }
}
