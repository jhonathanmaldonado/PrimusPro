// ============================================================
// PRIMUS ETIQUETAS - js/importacao.js (v1)
// Fase 2d: importacao unica dos produtos da Suflex (planilha revisada pela chef).
// So o gestor ve. Le um arquivo .json gerado a partir da planilha, mostra o resumo
// e so grava depois da confirmacao. Produto com mesmo nome e atualizado, nao duplicado.
// ============================================================
import { MODOS, normalizarBusca, traduzirErro, executarImportacao } from "./db.js";
import { $, mostrarErro, ocupado, abrirModal, fecharModal, aviso, escapar } from "./ui.js";
import { garantirDados, obterProdutos, obterGrupos, textoValidade, nomeDoGrupo } from "./produtos.js";

let getPerfil = () => null;
let plano = null;

export function configurarImportacao({ obterPerfil }) {
  getPerfil = obterPerfil;
  $("importar-arquivo").addEventListener("change", lerArquivo);
  $("importar-cancelar").addEventListener("click", () => fecharModal("modal-importar"));
  $("importar-confirmar").addEventListener("click", confirmar);
}

export function abrirImportacao() {
  const p = getPerfil();
  if (!p || p.papel !== "gestor") return;
  garantirDados();
  plano = null;
  $("importar-arquivo").value = "";
  $("importar-resumo").innerHTML = "";
  $("importar-progresso").textContent = "";
  $("importar-confirmar").disabled = true;
  mostrarErro("importar-erro", "");
  abrirModal("modal-importar");
}

function horasOk(v) {
  return v === null || (Number.isInteger(v) && v > 0 && v <= 87600);
}

function validarArquivo(d) {
  if (!d || d.formato !== "primus-etiquetas-importacao" || !Array.isArray(d.produtos) || !Array.isArray(d.grupos))
    return "Arquivo não é uma importação do Primus Etiquetas.";
  const nomes = new Set();
  for (const p of d.produtos) {
    if (!p || typeof p.nome !== "string" || p.nome.trim().length < 2 || p.nome.length > 60) return `Nome inválido: ${p && p.nome}`;
    if (typeof p.grupo !== "string" || !d.grupos.includes(p.grupo)) return `Grupo inválido em ${p.nome}`;
    const v = p.validades || {};
    if (!MODOS.every((m) => horasOk(v[m.id] === undefined ? null : v[m.id]))) return `Validade inválida em ${p.nome}`;
    if (!MODOS.some((m) => v[m.id] != null)) return `${p.nome} sem nenhuma validade.`;
    const k = normalizarBusca(p.nome);
    if (nomes.has(k)) return `Produto repetido no arquivo: ${p.nome}`;
    nomes.add(k);
  }
  return "";
}

function linhasValidade(v) {
  return MODOS.filter((m) => v[m.id] != null).map((m) => `${m.nome}: ${textoValidade(v[m.id])}`);
}

function montarPlano(d) {
  const grupos = obterGrupos();
  const produtos = obterProdutos();
  const mapaGrupos = {};
  for (const g of grupos) mapaGrupos[g.nomeBusca || normalizarBusca(g.nome)] = g.id;
  const gruposNovos = d.grupos.filter((n) => !mapaGrupos[normalizarBusca(n)]);

  const porNome = new Map(produtos.map((p) => [p.nomeBusca, p]));
  const itens = [];
  let iguais = 0;
  for (const p of d.produtos) {
    const validades = {};
    for (const m of MODOS) validades[m.id] = p.validades[m.id] == null ? null : p.validades[m.id];
    const existente = porNome.get(normalizarBusca(p.nome));
    if (!existente) {
      itens.push({ acao: "criar", nome: p.nome.trim(), grupo: p.grupo, validades,
        mudancas: [`Grupo: ${p.grupo}`].concat(linhasValidade(validades)) });
      continue;
    }
    const mudancas = [];
    if (existente.nome !== p.nome.trim()) mudancas.push(`Nome: ${existente.nome} → ${p.nome.trim()}`);
    const grupoAtual = nomeDoGrupo(existente.grupoId);
    if (normalizarBusca(grupoAtual) !== normalizarBusca(p.grupo)) mudancas.push(`Grupo: ${grupoAtual} → ${p.grupo}`);
    for (const m of MODOS) {
      const a = existente.validades ? (existente.validades[m.id] == null ? null : existente.validades[m.id]) : null;
      const b = validades[m.id];
      if (a !== b) mudancas.push(`${m.nome}: ${a == null ? "não se aplica" : textoValidade(a)} → ${b == null ? "não se aplica" : textoValidade(b)}`);
    }
    if (!existente.ativo) mudancas.push("Restaurado (estava excluído)");
    if (existente.pendenteRevisao) mudancas.push("Revisão: aprovado pela planilha");
    if (!mudancas.length) { iguais++; continue; }
    itens.push({ acao: "atualizar", id: existente.id, nome: p.nome.trim(), grupo: p.grupo, validades, mudancas });
  }
  const noArquivo = new Set(d.produtos.map((p) => normalizarBusca(p.nome)));
  const foraDoArquivo = produtos.filter((p) => p.ativo && !noArquivo.has(p.nomeBusca));
  return { gruposNovos, mapaGrupos, itens, iguais, foraDoArquivo, total: d.produtos.length };
}

function desenharResumo() {
  const criar = plano.itens.filter((i) => i.acao === "criar");
  const atualizar = plano.itens.filter((i) => i.acao === "atualizar");
  const partes = [
    `<p><strong>${plano.total}</strong> produtos no arquivo.</p>`,
    "<ul>",
    `<li><strong>${plano.gruposNovos.length}</strong> grupos novos${plano.gruposNovos.length ? ": " + escapar(plano.gruposNovos.join(", ")) : ""}</li>`,
    `<li><strong>${criar.length}</strong> produtos novos</li>`,
    `<li><strong>${atualizar.length}</strong> produtos já existentes que serão atualizados</li>`,
    `<li><strong>${plano.iguais}</strong> já estão iguais (nada muda)</li>`,
    "</ul>"
  ];
  if (atualizar.length) {
    partes.push("<p><strong>Atualizações:</strong></p><ul class='lista-mudancas'>");
    for (const a of atualizar) partes.push(`<li>${escapar(a.nome)}<br><small>${a.mudancas.map(escapar).join("<br>")}</small></li>`);
    partes.push("</ul>");
  }
  if (plano.foraDoArquivo.length) {
    partes.push(`<p class="aviso-caixa">Continuam ativos e <strong>não estão no arquivo</strong> (a importação não mexe neles): ${escapar(plano.foraDoArquivo.map((p) => p.nome).join(", "))}. Se forem de teste, exclua depois.</p>`);
  }
  $("importar-resumo").innerHTML = partes.join("");
  const nada = !plano.itens.length && !plano.gruposNovos.length;
  $("importar-confirmar").disabled = nada;
  $("importar-confirmar").textContent = nada ? "Nada para importar" : `Importar ${plano.itens.length} produtos`;
}

function lerArquivo(ev) {
  mostrarErro("importar-erro", "");
  $("importar-resumo").innerHTML = "";
  $("importar-confirmar").disabled = true;
  plano = null;
  const arquivo = ev.target.files && ev.target.files[0];
  if (!arquivo) return;
  if (!obterProdutos().length && !obterGrupos().length) {
    // dados podem ainda estar carregando; tenta de novo em instantes
  }
  const leitor = new FileReader();
  leitor.onload = () => {
    let d;
    try { d = JSON.parse(String(leitor.result)); } catch (e) { return mostrarErro("importar-erro", "Arquivo inválido (não é JSON)."); }
    const erro = validarArquivo(d);
    if (erro) return mostrarErro("importar-erro", erro);
    plano = montarPlano(d);
    desenharResumo();
  };
  leitor.onerror = () => mostrarErro("importar-erro", "Não consegui ler o arquivo.");
  leitor.readAsText(arquivo, "utf-8");
}

async function confirmar() {
  if (!plano) return;
  const botao = $("importar-confirmar");
  ocupado(botao, true, "Importando...");
  $("importar-cancelar").disabled = true;
  try {
    const feitos = await executarImportacao(plano, getPerfil(), (n, total) => {
      $("importar-progresso").textContent = `Gravados ${n} de ${total}...`;
    });
    fecharModal("modal-importar");
    aviso(`Importação concluída: ${feitos} produtos gravados.`);
  } catch (e) {
    mostrarErro("importar-erro", traduzirErro(e) + " Parte pode ter sido gravada: abra a importação de novo com o mesmo arquivo para completar.");
  } finally {
    ocupado(botao, false);
    $("importar-cancelar").disabled = false;
  }
}
