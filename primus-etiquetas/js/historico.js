// ============================================================
// PRIMUS ETIQUETAS - js/historico.js (v2)
// v2: aberto pelo QR = so consulta (reimpressao so pelo Historico)
// Fase 4: historico de etiquetas (filtro por dia, produto e responsavel),
// detalhe da etiqueta (tambem aberto pelo QR) e reimpressao (2a via).
// Regras: reimpressao sai identica a original; etiqueta vencida nao reimprime.
// ============================================================
import {
  normalizarBusca, traduzirErro, formatarCodigo,
  observarEtiquetasDoDia, lerEtiqueta, observarCodigo, reimprimirEtiqueta
} from "./db.js";
import { $, mostrarTela, mostrarErro, ocupado, abrirModal, fecharModal, aviso, escapar } from "./ui.js";
import { comResponsavel, acompanhar } from "./emissao.js";

const MAX_COPIAS_REIMPRESSAO = 10;
const NOMES_STATUS = { pendente: "Na fila", imprimindo: "Imprimindo", impresso: "Impressa", erro: "Não imprimiu" };

let getImpressoraOnline = () => false;
let cancelarDia = null;
let etiquetasDia = [];
let diaAtual = hojeTexto();
let textoProduto = "";
let filtroResponsavel = "";
let cancelarDetalhe = null;
let detalhe = null;       // etiqueta original aberta
let copiasReimp = 1;
let timerRelogio = null;
let somenteConsulta = false; // true quando aberto pelo QR

const fmt = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const fmtHora = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });

function hojeTexto() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function textoParaData(t) {
  const [a, m, d] = t.split("-").map(Number);
  return new Date(a, m - 1, d);
}

function vencida(e) {
  return !!e.validadeEm && e.validadeEm.getTime() <= Date.now();
}

// ---------------------------------------------------------------- configuracao
export function configurarHistorico({ impressoraOnline, voltar }) {
  getImpressoraOnline = impressoraOnline;
  $("historico-voltar").addEventListener("click", () => { pararDia(); voltar(); });
  $("historico-dia").addEventListener("change", (ev) => { diaAtual = ev.target.value || hojeTexto(); escutarDia(); });
  $("historico-anterior").addEventListener("click", () => mudarDia(-1));
  $("historico-proximo").addEventListener("click", () => mudarDia(1));
  $("historico-busca").addEventListener("input", (ev) => { textoProduto = ev.target.value; desenharLista(); });
  $("historico-responsavel").addEventListener("change", (ev) => { filtroResponsavel = ev.target.value; desenharLista(); });
  $("historico-lista").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-num]");
    if (b) abrirDetalhe(Number(b.dataset.num));
  });

  $("detalhe-fechar").addEventListener("click", fecharDetalhe);
  $("detalhe-menos").addEventListener("click", () => { copiasReimp = Math.max(1, copiasReimp - 1); desenharReimpressao(); });
  $("detalhe-mais").addEventListener("click", () => { copiasReimp = Math.min(MAX_COPIAS_REIMPRESSAO, copiasReimp + 1); desenharReimpressao(); });
  $("detalhe-reimprimir").addEventListener("click", clicarReimprimir);
}

export function abrirHistorico() {
  $("historico-dia").value = diaAtual;
  $("historico-dia").max = hojeTexto();
  mostrarTela("tela-historico");
  escutarDia();
}

export function encerrarHistorico() {
  pararDia();
  fecharDetalhe();
  etiquetasDia = [];
}

function pararDia() {
  if (cancelarDia) { cancelarDia(); cancelarDia = null; }
}

function mudarDia(delta) {
  const d = textoParaData(diaAtual);
  d.setDate(d.getDate() + delta);
  const t = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  if (t > hojeTexto()) return;
  diaAtual = t;
  $("historico-dia").value = t;
  escutarDia();
}

function escutarDia() {
  pararDia();
  $("historico-proximo").disabled = diaAtual >= hojeTexto();
  $("historico-lista").innerHTML = '<p class="vazio">Carregando...</p>';
  cancelarDia = observarEtiquetasDoDia(textoParaData(diaAtual),
    (lista) => { etiquetasDia = lista.filter((e) => e.tipo === "etiqueta"); desenharResponsaveis(); desenharLista(); },
    (e) => { $("historico-lista").innerHTML = `<p class="vazio">${escapar(traduzirErro(e))}</p>`; });
}

// ---------------------------------------------------------------- lista
function desenharResponsaveis() {
  const nomes = [...new Set(etiquetasDia.map((e) => e.responsavel).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  if (filtroResponsavel && !nomes.includes(filtroResponsavel)) nomes.push(filtroResponsavel);
  $("historico-responsavel").innerHTML = ['<option value="">Todos os responsáveis</option>']
    .concat(nomes.map((n) => `<option value="${escapar(n)}" ${n === filtroResponsavel ? "selected" : ""}>${escapar(n)}</option>`)).join("");
}

function seloStatus(e) {
  if (e.status === "impresso") return "";
  const classe = e.status === "erro" ? "selo-erro" : "selo-fila";
  return `<span class="pilula ${classe}">${escapar(NOMES_STATUS[e.status] || e.status)}</span>`;
}

function desenharLista() {
  let lista = etiquetasDia;
  const termo = normalizarBusca(textoProduto);
  if (termo) {
    const partes = termo.split(" ");
    lista = lista.filter((e) => partes.every((t) => normalizarBusca(e.produto).includes(t)));
  }
  if (filtroResponsavel) lista = lista.filter((e) => e.responsavel === filtroResponsavel);

  const total = lista.reduce((s, e) => s + (e.copias || 1), 0);
  $("historico-total").textContent = lista.length
    ? `${lista.length} emissões, ${total} etiquetas`
    : "";

  const alvo = $("historico-lista");
  if (!lista.length) {
    alvo.innerHTML = `<p class="vazio">${etiquetasDia.length ? "Nada com esse filtro." : "Nenhuma etiqueta emitida neste dia."}</p>`;
    return;
  }
  alvo.innerHTML = lista.map((e) => `
    <button type="button" class="linha-produto linha-etiqueta${vencida(e) ? " vencida" : ""}" data-num="${e.codigoNum}">
      <span class="topo-etiqueta"><span class="codigo">#${escapar(e.codigo)}</span><span class="hora">${e.criadoEm ? escapar(fmtHora.format(e.criadoEm)) : ""}</span></span>
      <span class="nome-produto">${escapar(e.produto)}</span>
      <span class="grupo-produto">${escapar(e.conservacao)}, ${e.copias} ${e.copias === 1 ? "etiqueta" : "etiquetas"}, resp. ${escapar(e.responsavel)}</span>
      <span class="pilulas">
        <span class="pilula ${vencida(e) ? "selo-vencida" : "selo-validade"}">${vencida(e) ? "Vencida" : "Vence"} ${e.validadeEm ? escapar(fmt.format(e.validadeEm)) : ""}</span>
        ${seloStatus(e)}
      </span>
    </button>`).join("");
}

// ---------------------------------------------------------------- detalhe (lista ou QR)
export async function abrirDetalhe(num, opcoes) {
  fecharDetalhe();
  somenteConsulta = !!(opcoes && opcoes.somenteConsulta);
  detalhe = null;
  copiasReimp = 1;
  mostrarErro("detalhe-erro", "");
  $("detalhe-codigo").textContent = `#${formatarCodigo(num)}`;
  $("detalhe-corpo").innerHTML = '<p class="vazio">Carregando...</p>';
  $("detalhe-reimpressoes").innerHTML = "";
  $("bloco-reimprimir").hidden = true;
  abrirModal("modal-detalhe");
  try {
    const e = await lerEtiqueta(num);
    if (!e) {
      $("detalhe-corpo").innerHTML = '<p class="vazio">Etiqueta não encontrada.</p>';
      return;
    }
    detalhe = e;
    cancelarDetalhe = observarCodigo(num, (lista) => {
      const original = lista.find((x) => x.tipo === "etiqueta");
      if (original) detalhe = original;
      desenharDetalhe(lista.filter((x) => x.tipo === "reimpressao"));
    }, (err) => mostrarErro("detalhe-erro", traduzirErro(err)));
    clearInterval(timerRelogio);
    timerRelogio = setInterval(desenharReimpressao, 15000);
  } catch (err) {
    $("detalhe-corpo").innerHTML = `<p class="vazio">${escapar(traduzirErro(err))}</p>`;
  }
}

function fecharDetalhe() {
  if (cancelarDetalhe) { cancelarDetalhe(); cancelarDetalhe = null; }
  clearInterval(timerRelogio);
  fecharModal("modal-detalhe");
}

function linha(rotulo, valor, classe) {
  return `<div class="linha-detalhe${classe ? " " + classe : ""}"><span>${escapar(rotulo)}</span><strong>${escapar(valor)}</strong></div>`;
}

function desenharDetalhe(reimpressoes) {
  const e = detalhe;
  const venc = vencida(e);
  $("detalhe-corpo").innerHTML = [
    `<p class="emissao-produto">${escapar(e.produto)}</p>`,
    venc ? '<p class="erro">Etiqueta vencida. O produto não deve ser usado.</p>' : "",
    linha("Conservação", e.conservacao),
    linha("Manipulação", e.manipulacaoEm ? fmt.format(e.manipulacaoEm) : "-"),
    linha("Validade", e.validadeEm ? fmt.format(e.validadeEm) : "-", venc ? "venceu" : "destaque"),
    linha("Responsável", e.responsavel),
    linha("Emitida em", e.criadoEm ? fmt.format(e.criadoEm) : "-"),
    linha("Quantidade", String(e.copias)),
    linha("Situação", (NOMES_STATUS[e.status] || e.status) + (e.status === "erro" && e.erro ? ` (${e.erro})` : ""))
  ].join("");

  $("detalhe-reimpressoes").innerHTML = reimpressoes.length
    ? "<h2>Reimpressões</h2><ul>" + reimpressoes.map((r) =>
        `<li><strong>${escapar(r.reimpressoPorNome)}</strong>, ${r.copias} ${r.copias === 1 ? "etiqueta" : "etiquetas"}${r.segundaVia ? " (2ª via)" : ""}
         <span class="quando">${r.criadoEm ? escapar(fmt.format(r.criadoEm)) : ""}, ${escapar(NOMES_STATUS[r.status] || r.status)}</span></li>`).join("") + "</ul>"
    : "";
  desenharReimpressao();
}

function desenharReimpressao() {
  if (!detalhe) return;
  if (somenteConsulta) {
    $("bloco-reimprimir").hidden = true;
    $("detalhe-so-consulta").hidden = false;
    return;
  }
  $("detalhe-so-consulta").hidden = true;
  const venc = vencida(detalhe);
  const online = getImpressoraOnline();
  const bloco = $("bloco-reimprimir");
  bloco.hidden = false;
  $("detalhe-copias").textContent = String(copiasReimp);
  $("detalhe-menos").disabled = copiasReimp <= 1;
  $("detalhe-mais").disabled = copiasReimp >= MAX_COPIAS_REIMPRESSAO;
  const botao = $("detalhe-reimprimir");
  let motivo = "";
  if (venc) motivo = "Vencida: não pode ser reimpressa.";
  else if (!online) motivo = "Impressora offline.";
  $("detalhe-motivo").textContent = motivo;
  $("detalhe-motivo").hidden = !motivo;
  botao.disabled = !!motivo;
  const via = detalhe.status === "impresso" ? " (2ª via)" : "";
  botao.textContent = copiasReimp === 1 ? `Reimprimir 1 etiqueta${via}` : `Reimprimir ${copiasReimp} etiquetas${via}`;
}

function clicarReimprimir() {
  mostrarErro("detalhe-erro", "");
  if (!detalhe || somenteConsulta) return;
  if (vencida(detalhe)) return mostrarErro("detalhe-erro", "Etiqueta vencida não pode ser reimpressa.");
  if (!getImpressoraOnline()) return mostrarErro("detalhe-erro", "Impressora offline.");
  const original = detalhe;
  const qtd = copiasReimp;
  comResponsavel(async (quem) => {
    const botao = $("detalhe-reimprimir");
    ocupado(botao, true, "Enviando...");
    try {
      const id = await reimprimirEtiqueta(original, qtd, quem);
      acompanhar(id, original.produto, qtd, `#${original.codigo} 2ª via`);
      aviso("Reimpressão enviada.");
      copiasReimp = 1;
    } catch (e) {
      mostrarErro("detalhe-erro", traduzirErro(e));
    } finally {
      ocupado(botao, false);
      desenharReimpressao();
    }
  });
}
