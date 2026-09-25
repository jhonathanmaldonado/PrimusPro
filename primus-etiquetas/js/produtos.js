// ============================================================
// PRIMUS ETIQUETAS - js/produtos.js (v4)
// v4: botao Importar (so gestor)
// v3: dados de produtos/grupos compartilhados com a emissao (garantirDados); botao Fechar largura total
// v2: filtros de grupo aparecem apos carregar produtos; botao Grupos junto do titulo;
//     cozinha nao ve a barra de abas (so tem uma)
// Fase 2c: produtos, grupos, busca, revisao e historico
// Regras: todos cadastram; so gestor e chef editam, revisam, excluem e gerenciam grupos.
//         Produto criado pela cozinha fica "aguardando revisao", mas ja pode ser usado.
// ============================================================
import {
  MODOS, normalizarBusca, traduzirErro,
  observarGrupos, criarGrupo, renomearGrupo,
  observarProdutos, criarProduto, atualizarProduto, lerHistorico
} from "./db.js";
import {
  $, mostrarTela, mostrarErro, ocupado, abrirModal, fecharModal, aviso, escapar, focarSemRolar
} from "./ui.js";

const MAX_DIAS = 3650;

let getPerfil = () => null;
let cancelarGrupos = null;
let cancelarProdutos = null;
let grupos = [];
let produtos = [];
let aba = "ativos";            // ativos | revisao | excluidos
let filtroGrupo = "";          // "" = todos
let textoBusca = "";
let produtoEmEdicao = null;    // null = novo
let somenteLeitura = false;
const ouvintes = new Set();    // outras telas (emissao) que querem saber quando os dados mudam

function avisarOuvintes() {
  for (const fn of ouvintes) { try { fn(); } catch (e) { /* ignora */ } }
}

export function obterProdutos() { return produtos; }
export function obterGrupos() { return grupos; }
export function nomeDoGrupo(id) { return nomeGrupo(id); }

// Liga os ouvintes do Firestore (uma vez) e registra quem quer ser avisado
export function garantirDados(aoMudar) {
  if (aoMudar) ouvintes.add(aoMudar);
  if (!cancelarGrupos) {
    cancelarGrupos = observarGrupos(
      (lista) => { grupos = lista; desenharFiltroGrupos(); desenharLista(); desenharGrupos(); avisarOuvintes(); },
      (e) => aviso(traduzirErro(e))
    );
  }
  if (!cancelarProdutos) {
    cancelarProdutos = observarProdutos(
      (lista) => { produtos = lista; desenharFiltroGrupos(); desenharLista(); desenharGrupos(); avisarOuvintes(); },
      (e) => {
        const alvo = $("lista-produtos");
        if (alvo) alvo.innerHTML = `<p class="vazio">${escapar(traduzirErro(e))}</p>`;
        aviso(traduzirErro(e));
      }
    );
  }
}

// ---------------------------------------------------------------- permissoes
function ehRevisor() {
  const p = getPerfil();
  return !!p && (p.papel === "gestor" || p.papel === "chef");
}

// ---------------------------------------------------------------- validade: horas <-> tela
export function textoValidade(horas) {
  if (horas == null) return "";
  if (horas % 24 === 0) {
    const d = horas / 24;
    return d === 1 ? "1 dia" : `${d} dias`;
  }
  return `${horas} h`;
}

function horasParaCampos(horas) {
  if (horas == null) return { valor: "", unidade: "dias" };
  if (horas % 24 === 0) return { valor: String(horas / 24), unidade: "dias" };
  return { valor: String(horas), unidade: "horas" };
}

function camposParaHoras(valor, unidade) {
  const t = String(valor || "").trim().replace(",", ".");
  if (!t) return { horas: null };
  if (!/^\d+$/.test(t)) return { erro: "Use só números inteiros na validade." };
  const n = parseInt(t, 10);
  if (n <= 0) return { erro: "A validade precisa ser maior que zero." };
  const horas = unidade === "horas" ? n : n * 24;
  if (horas > MAX_DIAS * 24) return { erro: "Validade acima de 10 anos. Confira o número." };
  return { horas };
}

function nomeGrupo(id) {
  const g = grupos.find((x) => x.id === id);
  return g ? g.nome : "Sem grupo";
}

// ---------------------------------------------------------------- abrir / fechar
export function configurarProdutos({ obterPerfil, voltar }) {
  getPerfil = obterPerfil;
  $("produtos-voltar").addEventListener("click", voltar);
  $("produtos-novo").addEventListener("click", () => abrirFormProduto(null));
  $("produtos-grupos").addEventListener("click", abrirGrupos);
  $("produtos-busca").addEventListener("input", (ev) => { textoBusca = ev.target.value; desenharLista(); });
  $("produtos-abas").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-aba]");
    if (b) { aba = b.dataset.aba; desenharLista(); }
  });
  $("produtos-filtro-grupos").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-grupo]");
    if (b) { filtroGrupo = b.dataset.grupo; desenharFiltroGrupos(); desenharLista(); }
  });
  $("lista-produtos").addEventListener("click", (ev) => {
    if (ev.target.closest("[data-abrir-grupos]")) { abrirGrupos(); return; }
    const b = ev.target.closest("[data-produto]");
    if (!b) return;
    const p = produtos.find((x) => x.id === b.dataset.produto);
    if (p) abrirFormProduto(p);
  });

  $("form-produto").addEventListener("submit", salvarProduto);
  $("produto-cancelar").addEventListener("click", () => fecharModal("modal-produto"));
  $("produto-revisado").addEventListener("click", marcarRevisado);
  $("produto-excluir").addEventListener("click", excluirOuRestaurar);

  $("grupos-fechar").addEventListener("click", () => fecharModal("modal-grupos"));
  $("form-grupo").addEventListener("submit", adicionarGrupo);
  $("lista-grupos").addEventListener("click", clicarRenomearGrupo);
}

export function abrirProdutos() {
  const revisor = ehRevisor();
  $("produtos-grupos").hidden = !revisor;
  $("produtos-importar").hidden = !(getPerfil() && getPerfil().papel === "gestor");
  $("aba-revisao").hidden = !revisor;
  $("aba-excluidos").hidden = !revisor;
  $("produtos-abas").hidden = !revisor;
  $("produtos-abas").classList.toggle("tres", revisor);
  aba = "ativos";
  filtroGrupo = "";
  textoBusca = "";
  $("produtos-busca").value = "";
  mostrarTela("tela-produtos");

  if (!cancelarProdutos) $("lista-produtos").innerHTML = '<p class="vazio">Carregando...</p>';
  garantirDados();
  desenharFiltroGrupos();
  desenharLista();
}

export function encerrarProdutos() {
  if (cancelarGrupos) { cancelarGrupos(); cancelarGrupos = null; }
  if (cancelarProdutos) { cancelarProdutos(); cancelarProdutos = null; }
  grupos = [];
  produtos = [];
  ouvintes.clear();
}

// ---------------------------------------------------------------- lista
function desenharFiltroGrupos() {
  const usados = new Set(produtos.map((p) => p.grupoId));
  const chips = [`<button type="button" class="chip${filtroGrupo === "" ? " atual" : ""}" data-grupo="">Todos</button>`]
    .concat(grupos.filter((g) => usados.has(g.id) || filtroGrupo === g.id).map((g) =>
      `<button type="button" class="chip${filtroGrupo === g.id ? " atual" : ""}" data-grupo="${escapar(g.id)}">${escapar(g.nome)}</button>`));
  $("produtos-filtro-grupos").innerHTML = chips.join("");
}

function pilulas(validades) {
  return MODOS.filter((m) => validades && validades[m.id] != null).map((m) =>
    `<span class="pilula modo-${m.id}">${escapar(m.nome)} ${escapar(textoValidade(validades[m.id]))}</span>`).join("");
}

function desenharLista() {
  const ativos = produtos.filter((p) => p.ativo);
  const revisao = ativos.filter((p) => p.pendenteRevisao);
  const excluidos = produtos.filter((p) => !p.ativo);
  $("aba-ativos-prod").textContent = `Ativos (${ativos.length})`;
  $("aba-revisao").textContent = `Revisar (${revisao.length})`;
  $("aba-excluidos").textContent = `Excluídos (${excluidos.length})`;
  for (const b of $("produtos-abas").querySelectorAll("[data-aba]")) {
    b.classList.toggle("atual", b.dataset.aba === aba);
    b.setAttribute("aria-selected", b.dataset.aba === aba ? "true" : "false");
  }

  let lista = aba === "revisao" ? revisao : aba === "excluidos" ? excluidos : ativos;
  if (filtroGrupo) lista = lista.filter((p) => p.grupoId === filtroGrupo);
  const termo = normalizarBusca(textoBusca);
  if (termo) {
    const partes = termo.split(" ");
    lista = lista.filter((p) => partes.every((t) => (p.nomeBusca || "").includes(t)));
  }

  const alvo = $("lista-produtos");
  if (!lista.length) {
    let msg = "Nenhum produto.";
    if (termo || filtroGrupo) msg = "Nenhum produto encontrado com esse filtro.";
    else if (aba === "revisao") msg = "Nada aguardando revisão.";
    else if (aba === "excluidos") msg = "Nenhum produto excluído.";
    else if (!grupos.length && ehRevisor()) {
      alvo.innerHTML = '<div class="vazio"><p>Ainda não há grupos. Crie os grupos primeiro e depois os produtos.</p>' +
        '<button type="button" class="botao compacto" data-abrir-grupos>Criar grupos</button></div>';
      return;
    }
    alvo.innerHTML = `<p class="vazio">${escapar(msg)}</p>`;
    return;
  }
  alvo.innerHTML = lista.map((p) => `
    <button type="button" class="linha-produto${p.ativo ? "" : " inativo"}" data-produto="${escapar(p.id)}">
      <span class="nome-produto">${escapar(p.nome)}</span>
      <span class="grupo-produto">${escapar(nomeGrupo(p.grupoId))}</span>
      <span class="pilulas">${pilulas(p.validades)}${p.pendenteRevisao && p.ativo ? '<span class="pilula revisar">Aguardando revisão</span>' : ""}</span>
    </button>`).join("");
}

// ---------------------------------------------------------------- formulario de produto
function preencherSelectGrupos(selecionado) {
  const sel = $("produto-grupo");
  const opcoes = ['<option value="">Escolha o grupo</option>']
    .concat(grupos.map((g) => `<option value="${escapar(g.id)}" ${g.id === selecionado ? "selected" : ""}>${escapar(g.nome)}</option>`));
  sel.innerHTML = opcoes.join("");
}

function preencherValidades(validades) {
  for (const m of MODOS) {
    const c = horasParaCampos(validades ? validades[m.id] : null);
    $(`val-${m.id}`).value = c.valor;
    $(`uni-${m.id}`).value = c.unidade;
  }
}

function travarFormulario(travar) {
  for (const id of ["produto-nome", "produto-grupo"]) $(id).disabled = travar;
  for (const m of MODOS) { $(`val-${m.id}`).disabled = travar; $(`uni-${m.id}`).disabled = travar; }
}

async function abrirFormProduto(produto) {
  produtoEmEdicao = produto || null;
  const novo = !produtoEmEdicao;
  const revisor = ehRevisor();
  somenteLeitura = !novo && !revisor;

  mostrarErro("produto-erro", "");
  $("produto-titulo").textContent = novo ? "Novo produto" : (somenteLeitura ? "Produto" : "Editar produto");
  $("produto-nome").value = novo ? "" : produtoEmEdicao.nome;
  preencherSelectGrupos(novo ? filtroGrupo : produtoEmEdicao.grupoId);
  preencherValidades(novo ? null : produtoEmEdicao.validades);
  travarFormulario(somenteLeitura || (!novo && !produtoEmEdicao.ativo));

  $("produto-dica-cozinha").hidden = !(novo && !revisor);
  $("produto-dica-leitura").hidden = !somenteLeitura;
  $("produto-sem-grupos").hidden = grupos.length > 0;

  $("produto-salvar").hidden = somenteLeitura || (!novo && !produtoEmEdicao.ativo);
  $("produto-salvar").textContent = novo ? "Cadastrar" : "Salvar";
  $("produto-cancelar").textContent = somenteLeitura ? "Fechar" : "Cancelar";
  $("produto-cancelar").parentElement.classList.toggle("unico", $("produto-salvar").hidden);

  const mostraAcoesRevisor = !novo && revisor;
  $("produto-acoes-revisor").hidden = !mostraAcoesRevisor;
  if (mostraAcoesRevisor) {
    $("produto-revisado").hidden = !(produtoEmEdicao.ativo && produtoEmEdicao.pendenteRevisao);
    $("produto-excluir").textContent = produtoEmEdicao.ativo ? "Excluir produto" : "Restaurar produto";
    $("produto-excluir").classList.toggle("perigo", produtoEmEdicao.ativo);
  }

  $("produto-historico").hidden = novo;
  $("produto-historico-lista").innerHTML = "";
  abrirModal("modal-produto");
  if (!somenteLeitura) focarSemRolar("produto-nome");

  if (!novo) {
    $("produto-historico-lista").innerHTML = '<li class="vazio-hist">Carregando...</li>';
    try {
      const hist = await lerHistorico(produtoEmEdicao.id, 15);
      desenharHistorico(hist);
    } catch (e) {
      $("produto-historico-lista").innerHTML = `<li class="vazio-hist">${escapar(traduzirErro(e))}</li>`;
    }
  }
}

function desenharHistorico(hist) {
  if (!hist.length) {
    $("produto-historico-lista").innerHTML = '<li class="vazio-hist">Sem registros.</li>';
    return;
  }
  const fmt = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  $("produto-historico-lista").innerHTML = hist.map((h) => `
    <li>
      <strong>${escapar(h.autorNome || "?")}</strong> ${escapar(h.acao)}
      <span class="quando">${h.quando ? escapar(fmt.format(h.quando)) : ""}</span>
      ${(h.mudancas || []).length ? `<ul>${h.mudancas.map((m) => `<li>${escapar(m)}</li>`).join("")}</ul>` : ""}
    </li>`).join("");
}

function lerFormulario() {
  const nome = $("produto-nome").value.replace(/\s+/g, " ").trim();
  const grupoId = $("produto-grupo").value;
  if (nome.length < 2) return { erro: "Informe o nome do produto." };
  if (nome.length > 60) return { erro: "Nome muito longo (máximo 60 letras)." };
  if (!grupoId) return { erro: "Escolha o grupo." };
  const validades = {};
  let algum = false;
  for (const m of MODOS) {
    const r = camposParaHoras($(`val-${m.id}`).value, $(`uni-${m.id}`).value);
    if (r.erro) return { erro: `${m.nome}: ${r.erro}` };
    validades[m.id] = r.horas;
    if (r.horas != null) algum = true;
  }
  if (!algum) return { erro: "Informe a validade em pelo menos um modo de conservação." };
  return { nome, grupoId, validades };
}

function descreverMudancas(antes, depois) {
  const m = [];
  if (!antes) {
    m.push(`Nome: ${depois.nome}`);
    m.push(`Grupo: ${nomeGrupo(depois.grupoId)}`);
    for (const modo of MODOS) {
      if (depois.validades[modo.id] != null) m.push(`${modo.nome}: ${textoValidade(depois.validades[modo.id])}`);
    }
    return m;
  }
  if (antes.nome !== depois.nome) m.push(`Nome: ${antes.nome} → ${depois.nome}`);
  if (antes.grupoId !== depois.grupoId) m.push(`Grupo: ${nomeGrupo(antes.grupoId)} → ${nomeGrupo(depois.grupoId)}`);
  for (const modo of MODOS) {
    const a = antes.validades ? antes.validades[modo.id] : null;
    const d = depois.validades[modo.id];
    if ((a == null ? null : a) !== (d == null ? null : d)) {
      m.push(`${modo.nome}: ${a == null ? "não se aplica" : textoValidade(a)} → ${d == null ? "não se aplica" : textoValidade(d)}`);
    }
  }
  return m;
}

async function salvarProduto(ev) {
  ev.preventDefault();
  if (somenteLeitura) return;
  mostrarErro("produto-erro", "");
  const f = lerFormulario();
  if (f.erro) return mostrarErro("produto-erro", f.erro);

  const busca = normalizarBusca(f.nome);
  const repetido = produtos.find((p) => p.nomeBusca === busca && (!produtoEmEdicao || p.id !== produtoEmEdicao.id));
  if (repetido) {
    return mostrarErro("produto-erro", repetido.ativo
      ? `Já existe um produto chamado "${repetido.nome}".`
      : `Existe um produto excluído chamado "${repetido.nome}". Peça para a chef restaurar em vez de cadastrar de novo.`);
  }

  const perfil = getPerfil();
  const botao = $("produto-salvar");
  const novo = !produtoEmEdicao;
  ocupado(botao, true, "Salvando...");
  try {
    if (novo) {
      await criarProduto(f, perfil, descreverMudancas(null, f));
      fecharModal("modal-produto");
      aviso(ehRevisor() ? `${f.nome} cadastrado.` : `${f.nome} cadastrado. A chef vai revisar.`);
    } else {
      const mudancas = descreverMudancas(produtoEmEdicao, f);
      if (!mudancas.length) { fecharModal("modal-produto"); return; }
      await atualizarProduto(produtoEmEdicao.id, f, perfil, "editou", mudancas);
      fecharModal("modal-produto");
      aviso("Alterações salvas.");
    }
  } catch (e) {
    mostrarErro("produto-erro", traduzirErro(e));
  } finally {
    ocupado(botao, false);
  }
}

async function marcarRevisado() {
  if (!produtoEmEdicao || !ehRevisor()) return;
  const f = lerFormulario();
  if (f.erro) return mostrarErro("produto-erro", f.erro);
  const mudancas = descreverMudancas(produtoEmEdicao, f);
  const botao = $("produto-revisado");
  ocupado(botao, true, "Salvando...");
  try {
    await atualizarProduto(produtoEmEdicao.id, { ...f, pendenteRevisao: false }, getPerfil(), "revisou e aprovou", mudancas);
    fecharModal("modal-produto");
    aviso(`${f.nome} revisado.`);
  } catch (e) {
    mostrarErro("produto-erro", traduzirErro(e));
  } finally {
    ocupado(botao, false);
  }
}

async function excluirOuRestaurar() {
  if (!produtoEmEdicao || !ehRevisor()) return;
  const excluir = produtoEmEdicao.ativo;
  if (excluir && !window.confirm(`Excluir "${produtoEmEdicao.nome}"? Ele some da emissão de etiquetas, mas o histórico fica guardado.`)) return;
  const botao = $("produto-excluir");
  ocupado(botao, true, "Salvando...");
  try {
    await atualizarProduto(produtoEmEdicao.id, { ativo: !excluir }, getPerfil(), excluir ? "excluiu" : "restaurou", []);
    fecharModal("modal-produto");
    aviso(excluir ? `${produtoEmEdicao.nome} excluído. Está na aba Excluídos.` : `${produtoEmEdicao.nome} restaurado.`);
  } catch (e) {
    mostrarErro("produto-erro", traduzirErro(e));
  } finally {
    ocupado(botao, false);
  }
}

// ---------------------------------------------------------------- grupos
function abrirGrupos() {
  if (!ehRevisor()) return;
  mostrarErro("grupo-erro", "");
  $("grupo-nome").value = "";
  desenharGrupos();
  abrirModal("modal-grupos");
  focarSemRolar("grupo-nome");
}

function desenharGrupos() {
  const alvo = $("lista-grupos");
  if (!alvo) return;
  if (!grupos.length) {
    alvo.innerHTML = '<li class="vazio-hist">Nenhum grupo ainda.</li>';
    return;
  }
  const contagem = {};
  for (const p of produtos) if (p.ativo) contagem[p.grupoId] = (contagem[p.grupoId] || 0) + 1;
  alvo.innerHTML = grupos.map((g) => `
    <li>
      <span>${escapar(g.nome)} <small>(${contagem[g.id] || 0})</small></span>
      <button type="button" class="botao-link" data-renomear="${escapar(g.id)}">Renomear</button>
    </li>`).join("");
}

function grupoRepetido(nome, ignorarId) {
  const busca = normalizarBusca(nome);
  return grupos.find((g) => g.nomeBusca === busca && g.id !== ignorarId);
}

async function adicionarGrupo(ev) {
  ev.preventDefault();
  mostrarErro("grupo-erro", "");
  const nome = $("grupo-nome").value.replace(/\s+/g, " ").trim();
  if (nome.length < 2 || nome.length > 40) return mostrarErro("grupo-erro", "O nome do grupo precisa ter de 2 a 40 letras.");
  if (grupoRepetido(nome)) return mostrarErro("grupo-erro", "Esse grupo já existe.");
  const botao = $("grupo-adicionar");
  ocupado(botao, true, "...");
  try {
    await criarGrupo(nome);
    $("grupo-nome").value = "";
    aviso(`Grupo ${nome} criado.`);
  } catch (e) {
    mostrarErro("grupo-erro", traduzirErro(e));
  } finally {
    ocupado(botao, false);
  }
}

async function clicarRenomearGrupo(ev) {
  const b = ev.target.closest("[data-renomear]");
  if (!b) return;
  const g = grupos.find((x) => x.id === b.dataset.renomear);
  if (!g) return;
  const novo = window.prompt("Novo nome do grupo:", g.nome);
  if (novo == null) return;
  const nome = novo.replace(/\s+/g, " ").trim();
  if (nome === g.nome) return;
  if (nome.length < 2 || nome.length > 40) return mostrarErro("grupo-erro", "O nome do grupo precisa ter de 2 a 40 letras.");
  if (grupoRepetido(nome, g.id)) return mostrarErro("grupo-erro", "Já existe um grupo com esse nome.");
  try {
    await renomearGrupo(g.id, nome);
    aviso("Grupo renomeado.");
  } catch (e) {
    mostrarErro("grupo-erro", traduzirErro(e));
  }
}
