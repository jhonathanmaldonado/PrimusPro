// ============================================================================
// DB.JS — Camada de acesso ao Firestore
// Fase 1 Precificação: CRUD de insumos + gatilho de atualização de preço
// ============================================================================

import { db } from './firebase-init.js';
import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc,
  onSnapshot, query, orderBy, where, serverTimestamp, writeBatch, addDoc,
  arrayUnion, limit
} from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js';

import { WORKSPACE_ID } from './firebase-config.js';

// ============================================================================
// CONTEXTO DE USUÁRIO
// ============================================================================

let _userCtx = null;

export function setUserContext(ctx) {
  _userCtx = ctx;
}

function getUserCtx() {
  return _userCtx;
}

function auditFields(extras = {}) {
  const ctx = getUserCtx();
  return {
    atualizadoEm: serverTimestamp(),
    atualizadoPor: ctx?.uid || null,
    atualizadoPorNome: ctx?.nome || null,
    ...extras
  };
}

// ============================================================================
// REFS
// ============================================================================

const ROOT = () => doc(db, 'workspaces', WORKSPACE_ID);
const USUARIOS = () => collection(db, 'workspaces', WORKSPACE_ID, 'usuarios');
const CATEGORIAS = () => collection(db, 'workspaces', WORKSPACE_ID, 'categorias');
const ITENS = () => collection(db, 'workspaces', WORKSPACE_ID, 'itens');
const LISTA_EM_CRIACAO = () => collection(db, 'workspaces', WORKSPACE_ID, 'lista_em_criacao');
const LISTA_ATUAL = () => collection(db, 'workspaces', WORKSPACE_ID, 'lista_atual');
const HISTORICO = () => collection(db, 'workspaces', WORKSPACE_ID, 'historico');
const FORNECEDORES = () => collection(db, 'workspaces', WORKSPACE_ID, 'fornecedores');
const INSUMOS = () => collection(db, 'workspaces', WORKSPACE_ID, 'insumos');
const FICHAS = () => collection(db, 'workspaces', WORKSPACE_ID, 'fichas');
const VENDAS_DIAS = () => collection(db, 'workspaces', WORKSPACE_ID, 'vendas_dias');
const VENDAS = () => collection(db, 'workspaces', WORKSPACE_ID, 'vendas');

// ============================================================================
// CONFIG (incluindo precificação)
// ============================================================================

export async function getConfigMediaN() {
  const snap = await getDoc(ROOT());
  return snap.data()?.config?.mediaN || 5;
}

export async function setConfigMediaN(n) {
  await updateDoc(ROOT(), { 'config.mediaN': n, ...auditFields() });
}

export async function getConfigPrecificacao() {
  const snap = await getDoc(ROOT());
  const c = snap.data()?.config?.precificacao || {};
  return {
    metodo: c.metodo || 'cmv_alvo', // cmv_alvo | markup | margem
    cmvAlvo: c.cmvAlvo ?? 0.30,
    markupFator: c.markupFator ?? 3.0,
    margemAlvo: c.margemAlvo ?? 0.70
  };
}

export async function setConfigPrecificacao(precif) {
  await updateDoc(ROOT(), {
    'config.precificacao': precif,
    ...auditFields()
  });
}

// ============================================================================
// USUÁRIOS
// ============================================================================

export function observarUsuarios(callback) {
  return onSnapshot(USUARIOS(), snap => {
    const lista = snap.docs.map(d => ({ ...d.data(), id: d.id }));
    callback(lista);
  });
}

export async function deletarUsuario(uid) {
  await deleteDoc(doc(USUARIOS(), uid));
  try {
    await deleteDoc(doc(db, 'workspaces', WORKSPACE_ID, 'auth_lookup', uid));
  } catch (e) {
    console.error('Erro ao deletar auth_lookup:', e);
  }
}

// ============================================================================
// CATEGORIAS (CRUD)
// ============================================================================

export function observarCategorias(callback) {
  const q = query(CATEGORIAS(), orderBy('ordem'));
  return onSnapshot(q, snap => {
    const lista = snap.docs.map(d => ({ ...d.data(), id: d.id }));
    callback(lista);
  });
}

export async function criarCategoria(dados) {
  const ref = doc(CATEGORIAS());
  await setDoc(ref, {
    nome: dados.nome,
    cor: dados.cor || '#7A1F38',
    ordem: dados.ordem ?? 0,
    ...auditFields({ criadoEm: serverTimestamp() })
  });
  return ref.id;
}

export async function atualizarCategoria(catId, dados) {
  const ref = doc(CATEGORIAS(), catId);
  await updateDoc(ref, { ...dados, ...auditFields() });
}

export async function deletarCategoria(catId) {
  const q = query(ITENS(), where('categoriaId', '==', catId));
  const snap = await getDocs(q);
  if (snap.size > 0) {
    throw new Error(`Esta categoria tem ${snap.size} item(ns) vinculado(s). Mova ou remova os itens antes de excluir.`);
  }
  await deleteDoc(doc(CATEGORIAS(), catId));
}

// ============================================================================
// ITENS (catálogo)
// ============================================================================

export function observarItens(callback) {
  return onSnapshot(ITENS(), snap => {
    const lista = snap.docs.map(d => ({ ...d.data(), id: d.id }));
    callback(lista);
  });
}

export async function criarItem(dados) {
  const ref = doc(ITENS());
  await setDoc(ref, {
    nome: dados.nome,
    tipo: dados.tipo || '',
    categoriaId: dados.categoriaId,
    fornecedorPreferido: dados.fornecedorPreferido || '',
    insumoId: dados.insumoId || null,
    fatorConversao: dados.fatorConversao ?? 1,
    ordem: dados.ordem ?? 0,
    ultimoPreco: null,
    precoAnterior: null,
    historicoPrecos: [],
    ...auditFields({ criadoEm: serverTimestamp() })
  });
  return ref.id;
}

export async function atualizarItem(itemId, dados) {
  const ref = doc(ITENS(), itemId);
  await updateDoc(ref, { ...dados, ...auditFields() });
}

export async function deletarItem(itemId) {
  await deleteDoc(doc(ITENS(), itemId));
}

export function calcularMediaPrecos(item, n) {
  const hist = item.historicoPrecos || [];
  if (!hist.length) return null;
  const slice = hist.slice(-n);
  const soma = slice.reduce((s, p) => s + (parseFloat(p.preco) || 0), 0);
  return soma / slice.length;
}

// ============================================================================
// INSUMOS (CRUD + gatilho de atualização de preço)
// ============================================================================

export function observarInsumos(callback) {
  const q = query(INSUMOS(), orderBy('nome'));
  return onSnapshot(q, snap => {
    const lista = snap.docs.map(d => ({ ...d.data(), id: d.id }));
    callback(lista);
  });
}

export async function criarInsumo(dados) {
  const ref = doc(INSUMOS());
  await setDoc(ref, {
    nome: dados.nome,
    unidade: dados.unidade || 'KG',          // KG | LITRO | UND
    fatorCorrecao: dados.fatorCorrecao ?? 1.0,
    categoria: dados.categoria || '',
    fornecedor: dados.fornecedor || '',
    precoPorUnidade: dados.precoPorUnidade ?? null,
    dataUltimaCompra: dados.dataUltimaCompra ?? null,
    origemPreco: dados.origemPreco || (dados.precoPorUnidade ? 'manual' : null),  // 'manual' | 'compra' | null
    ehPrePreparo: !!dados.ehPrePreparo,
    ...auditFields({ criadoEm: serverTimestamp() })
  });
  return ref.id;
}

export async function atualizarInsumo(insumoId, dados) {
  const ref = doc(INSUMOS(), insumoId);
  await updateDoc(ref, { ...dados, ...auditFields() });
}

export async function deletarInsumo(insumoId) {
  // Verifica se tem itens vinculados
  const q = query(ITENS(), where('insumoId', '==', insumoId));
  const snap = await getDocs(q);
  if (snap.size > 0) {
    throw new Error(`Este insumo tem ${snap.size} item(ns) de compra vinculado(s). Desvincule os itens antes de excluir.`);
  }
  await deleteDoc(doc(INSUMOS(), insumoId));
}

// Atualiza preço do insumo a partir de uma compra finalizada
// (preço por unidade já normalizado, ou seja, preço unitário pago)
export async function atualizarPrecoInsumo(insumoId, precoPorUnidade) {
  if (!insumoId) return;
  const preco = parseFloat(precoPorUnidade) || 0;
  if (preco <= 0) return;

  const ref = doc(INSUMOS(), insumoId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;

  await updateDoc(ref, {
    precoPorUnidade: preco,
    dataUltimaCompra: serverTimestamp(),
    origemPreco: 'compra',
    ...auditFields()
  });
}

// ============================================================================
// LISTA EM CRIAÇÃO (rascunho)
// ============================================================================

export function observarListaEmCriacao(callback) {
  return onSnapshot(LISTA_EM_CRIACAO(), snap => {
    const lista = snap.docs.map(d => ({ ...d.data(), id: d.id }));
    callback(lista);
  });
}

export async function setItemListaEmCriacao(itemId, qtd) {
  const ref = doc(LISTA_EM_CRIACAO(), itemId);
  const qtdNum = parseFloat(qtd) || 0;
  if (qtdNum <= 0) {
    await deleteDoc(ref).catch(() => {});
    return;
  }
  await setDoc(ref, {
    itemId,
    qtd: qtdNum,
    ...auditFields()
  });
}

export async function limparListaEmCriacao() {
  const snap = await getDocs(LISTA_EM_CRIACAO());
  const batch = writeBatch(db);
  snap.docs.forEach(d => batch.delete(d.ref));
  await batch.commit();
}

// ============================================================================
// LISTA ATUAL (em compra)
// ============================================================================

export function observarListaAtual(callback) {
  return onSnapshot(LISTA_ATUAL(), snap => {
    const lista = snap.docs.map(d => ({ ...d.data(), id: d.id }));
    callback(lista);
  });
}

export async function salvarListaParaAtual() {
  const snapAtual = await getDocs(LISTA_ATUAL());
  if (snapAtual.size > 0) {
    throw new Error('Já existe uma lista atual em andamento. Finalize-a primeiro.');
  }

  const snap = await getDocs(LISTA_EM_CRIACAO());
  if (snap.size === 0) {
    throw new Error('Lista vazia.');
  }

  const batch = writeBatch(db);
  let count = 0;
  snap.docs.forEach(d => {
    const data = d.data();
    const refAtual = doc(LISTA_ATUAL(), d.id);
    batch.set(refAtual, {
      itemId: d.id,
      qtd: data.qtd,
      preco: 0,
      comprado: false,
      ...auditFields({ criadoEm: serverTimestamp() })
    });
    batch.delete(d.ref);
    count++;
  });
  await batch.commit();
  return count;
}

export async function atualizarPrecoListaAtual(itemId, preco) {
  const ref = doc(LISTA_ATUAL(), itemId);
  await updateDoc(ref, {
    preco: parseFloat(preco) || 0,
    ...auditFields()
  });
}

export async function atualizarQtdListaAtual(itemId, qtd) {
  const ref = doc(LISTA_ATUAL(), itemId);
  await updateDoc(ref, {
    qtd: parseFloat(qtd) || 0,
    ...auditFields()
  });
}

export async function atualizarCompradoListaAtual(itemId, comprado) {
  const ref = doc(LISTA_ATUAL(), itemId);
  await updateDoc(ref, {
    comprado: !!comprado,
    ...auditFields()
  });
}

export async function removerItemListaAtual(itemId) {
  await deleteDoc(doc(LISTA_ATUAL(), itemId));
}

export async function adicionarItemListaAtual(itemId, qtdInicial = 0) {
  const ref = doc(LISTA_ATUAL(), itemId);
  const existing = await getDoc(ref);
  if (existing.exists()) {
    throw new Error('Esse item já está na lista atual.');
  }
  await setDoc(ref, {
    itemId,
    qtd: parseFloat(qtdInicial) || 0,
    preco: 0,
    comprado: false,
    ...auditFields({ criadoEm: serverTimestamp() })
  });
}

// ============================================================================
// FINALIZAR COMPRA (com gatilho de atualização de insumos)
// ============================================================================

export async function finalizarCompra(itensEnriquecidos, total) {
  const ctx = getUserCtx();
  const batch = writeBatch(db);

  const refHist = doc(HISTORICO());
  batch.set(refHist, {
    data: serverTimestamp(),
    total,
    qtdItens: itensEnriquecidos.length,
    finalizadoPor: ctx?.uid || null,
    finalizadoPorNome: ctx?.nome || null,
    itens: itensEnriquecidos
  });

  // Para coletar insumos a atualizar fora do batch (cada um precisa de getDoc)
  const insumosParaAtualizar = [];

  for (const it of itensEnriquecidos) {
    const refItem = doc(ITENS(), it.itemId);
    const snap = await getDoc(refItem);
    if (!snap.exists()) continue;
    const data = snap.data();
    const historicoPrecos = data.historicoPrecos || [];

    if (it.preco > 0) {
      historicoPrecos.push({
        preco: it.preco,
        qtd: it.qtd,
        data: new Date().toISOString()
      });
      while (historicoPrecos.length > 20) historicoPrecos.shift();

      batch.update(refItem, {
        precoAnterior: data.ultimoPreco || null,
        ultimoPreco: it.preco,
        historicoPrecos,
        ...auditFields()
      });

      // Se o item está vinculado a um insumo, marcar pra atualizar depois
      if (data.insumoId) {
        // Aplica fator de conversão: preço pago dividido pelo fator
        // Ex: comprou saco 20kg por R$ 90 → preço por kg = R$ 90 / 20 = R$ 4,50
        const fator = parseFloat(data.fatorConversao) || 1;
        const precoConvertido = it.preco / fator;
        insumosParaAtualizar.push({
          insumoId: data.insumoId,
          precoPorUnidade: precoConvertido
        });
      }
    }

    const refAtual = doc(LISTA_ATUAL(), it.itemId);
    batch.delete(refAtual);
  }

  await batch.commit();

  // Após o batch principal, atualizar os insumos vinculados (gatilho)
  // Roda em paralelo para ser rápido
  if (insumosParaAtualizar.length > 0) {
    await Promise.all(
      insumosParaAtualizar.map(({ insumoId, precoPorUnidade }) =>
        atualizarPrecoInsumo(insumoId, precoPorUnidade).catch(e =>
          console.error(`Erro ao atualizar insumo ${insumoId}:`, e)
        )
      )
    );
  }
}

// ============================================================================
// HISTÓRICO
// ============================================================================

export function observarHistorico(callback) {
  const q = query(HISTORICO(), orderBy('data', 'desc'), limit(50));
  return onSnapshot(q, snap => {
    const lista = snap.docs.map(d => ({ ...d.data(), id: d.id }));
    callback(lista);
  });
}

export async function deletarHistorico(histId) {
  await deleteDoc(doc(HISTORICO(), histId));
}

// ============================================================================
// FORNECEDORES
// ============================================================================

export function observarFornecedores(callback) {
  const q = query(FORNECEDORES(), orderBy('nome'));
  return onSnapshot(q, snap => {
    const lista = snap.docs.map(d => ({ ...d.data(), id: d.id }));
    callback(lista);
  });
}

export async function criarFornecedor(dados) {
  const ref = doc(FORNECEDORES());
  await setDoc(ref, {
    nome: dados.nome,
    telefone: dados.telefone || '',
    observacao: dados.observacao || '',
    ...auditFields({ criadoEm: serverTimestamp() })
  });
  return ref.id;
}

export async function atualizarFornecedor(fornId, dados) {
  const ref = doc(FORNECEDORES(), fornId);
  await updateDoc(ref, { ...dados, ...auditFields() });
}

export async function deletarFornecedor(fornId) {
  await deleteDoc(doc(FORNECEDORES(), fornId));
}

// ============================================================================
// FICHAS TÉCNICAS (CRUD)
// ============================================================================

export function observarFichas(callback) {
  const q = query(FICHAS(), orderBy('nome'));
  return onSnapshot(q, snap => {
    const lista = snap.docs.map(d => ({ ...d.data(), id: d.id }));
    callback(lista);
  });
}

export async function criarFicha(dados) {
  const ref = doc(FICHAS());
  await setDoc(ref, {
    nome: dados.nome,
    rendimento: parseFloat(dados.rendimento) || 1,
    unidadeRendimento: dados.unidadeRendimento || 'KG',  // KG | LITRO | UND | PORCOES
    tamanhoPorcao: dados.tamanhoPorcao != null ? parseFloat(dados.tamanhoPorcao) : null,  // tamanho de 1 porção (na mesma unidade do rendimento)
    precoVenda: parseFloat(dados.precoVenda) || 0,
    cmvAlvoCustom: dados.cmvAlvoCustom ?? null,  // se null, usa global
    ehPrePreparo: !!dados.ehPrePreparo,
    ingredientes: dados.ingredientes || [],  // [{ insumoId, pesoLiquido }]
    tempoPreparo: dados.tempoPreparo || '',
    modoPreparo: dados.modoPreparo || '',
    observacoes: dados.observacoes || '',
    ...auditFields({ criadoEm: serverTimestamp() })
  });
  return ref.id;
}

export async function atualizarFicha(fichaId, dados) {
  const ref = doc(FICHAS(), fichaId);
  const payload = { ...dados };
  // Normaliza campos numéricos
  if ('rendimento' in payload) payload.rendimento = parseFloat(payload.rendimento) || 1;
  if ('precoVenda' in payload) payload.precoVenda = parseFloat(payload.precoVenda) || 0;
  if ('tamanhoPorcao' in payload) {
    payload.tamanhoPorcao = payload.tamanhoPorcao != null && payload.tamanhoPorcao !== ''
      ? parseFloat(payload.tamanhoPorcao)
      : null;
  }
  await updateDoc(ref, { ...payload, ...auditFields() });
}

export async function deletarFicha(fichaId) {
  await deleteDoc(doc(FICHAS(), fichaId));
}

// ============================================================================
// CÁLCULOS DETERMINÍSTICOS DE FICHA TÉCNICA
// ============================================================================
// Tudo é puro: dado uma ficha + insumos, calcula custos.
// Sem dependências externas, fácil de auditar.

// Custo de um único ingrediente
// Ingrediente: { insumoId, pesoLiquido }
// Retorna: { custoIngrediente, precoUnitario, pesoBruto, fc, unidade, encontrado }
export function calcularCustoIngrediente(ingrediente, insumos) {
  const insumo = insumos.find(i => i.id === ingrediente.insumoId);
  if (!insumo) {
    return {
      encontrado: false,
      custoIngrediente: 0,
      precoUnitario: 0,
      pesoBruto: 0,
      fc: 1,
      unidade: '?'
    };
  }

  const pesoLiquido = parseFloat(ingrediente.pesoLiquido) || 0;
  const fc = parseFloat(insumo.fatorCorrecao) || 1;
  const precoUnitario = parseFloat(insumo.precoPorUnidade) || 0;
  const pesoBruto = fc > 0 ? pesoLiquido / fc : pesoLiquido;
  const custoIngrediente = pesoBruto * precoUnitario;

  return {
    encontrado: true,
    custoIngrediente,
    precoUnitario,
    pesoBruto,
    fc,
    unidade: insumo.unidade || 'KG',
    insumoNome: insumo.nome
  };
}

// Custo total da receita
// ficha: { ingredientes: [...] }
// Retorna o somatório dos custos dos ingredientes
export function calcularCustoReceita(ficha, insumos) {
  if (!ficha || !ficha.ingredientes) return 0;
  let total = 0;
  for (const ing of ficha.ingredientes) {
    const calc = calcularCustoIngrediente(ing, insumos);
    total += calc.custoIngrediente;
  }
  return total;
}

// Número de porções que a receita rende
// - Se unidadeRendimento === 'PORCOES': rendimento JÁ está em porções
// - Se tamanhoPorcao está definido: número de porções = rendimento / tamanhoPorcao
// - Caso contrário (compatibilidade com fichas antigas): assume rendimento = porções
export function calcularNumeroPorcoes(ficha) {
  if (!ficha) return 1;
  const rendimento = parseFloat(ficha.rendimento) || 1;
  const unidade = ficha.unidadeRendimento || 'KG';

  if (unidade === 'PORCOES') {
    return rendimento;
  }

  const tamanho = parseFloat(ficha.tamanhoPorcao);
  if (!isNaN(tamanho) && tamanho > 0) {
    return rendimento / tamanho;
  }

  // Compatibilidade com fichas antigas (sem tamanho de porção definido)
  return rendimento;
}

// Custo por porção
// custoPorPorcao = custoReceita ÷ númeroDePorcoes
export function calcularCustoPorPorcao(ficha, insumos) {
  const custoReceita = calcularCustoReceita(ficha, insumos);
  const nPorcoes = calcularNumeroPorcoes(ficha);
  if (nPorcoes <= 0) return custoReceita;
  return custoReceita / nPorcoes;
}

// CMV (Custo da Mercadoria Vendida) — fração entre 0 e 1+
// CMV = custo por porção ÷ preço de venda
export function calcularCMV(ficha, insumos) {
  const custoPorcao = calcularCustoPorPorcao(ficha, insumos);
  const precoVenda = parseFloat(ficha?.precoVenda) || 0;
  if (precoVenda <= 0) return null;
  return custoPorcao / precoVenda;
}

// Preço sugerido baseado no método configurado
// configPrecif: { metodo, cmvAlvo, markupFator, margemAlvo }
// cmvAlvoCustom: sobrescreve o cmvAlvo global se preenchido
export function calcularPrecoSugerido(ficha, insumos, configPrecif) {
  const custoPorcao = calcularCustoPorPorcao(ficha, insumos);
  if (custoPorcao <= 0) return 0;

  const metodo = configPrecif?.metodo || 'cmv_alvo';

  if (metodo === 'cmv_alvo') {
    const alvoUsado = ficha?.cmvAlvoCustom ?? configPrecif?.cmvAlvo ?? 0.30;
    if (alvoUsado <= 0) return 0;
    return custoPorcao / alvoUsado;
  } else if (metodo === 'markup') {
    const fator = configPrecif?.markupFator ?? 3.0;
    return custoPorcao * fator;
  } else if (metodo === 'margem') {
    const margem = configPrecif?.margemAlvo ?? 0.70;
    if (margem >= 1) return 0;
    return custoPorcao / (1 - margem);
  }

  return 0;
}

// Retorna o CMV alvo efetivo desta ficha (custom ou global)
export function obterCMVAlvoEfetivo(ficha, configPrecif) {
  return ficha?.cmvAlvoCustom ?? configPrecif?.cmvAlvo ?? 0.30;
}

// ============================================================================
// VENDAS - Importação e CRUD (Fase 3A)
// ============================================================================

export function observarVendas(callback) {
  const q = query(VENDAS(), orderBy('data', 'desc'));
  return onSnapshot(q, snap => {
    const lista = snap.docs.map(d => ({ ...d.data(), id: d.id }));
    callback(lista);
  });
}

export function observarVendasDias(callback) {
  const q = query(VENDAS_DIAS(), orderBy('data', 'desc'));
  return onSnapshot(q, snap => {
    const lista = snap.docs.map(d => ({ ...d.data(), id: d.id }));
    callback(lista);
  });
}

// Deleta todas as vendas de um dia específico (usado antes de reimportar)
export async function deletarVendasDoDia(data) {
  // data no formato 'YYYY-MM-DD'
  const q = query(VENDAS(), where('data', '==', data));
  const snap = await getDocs(q);
  const promises = snap.docs.map(d => deleteDoc(d.ref));
  await Promise.all(promises);

  // Deleta também o registro do dia
  const diaRef = doc(VENDAS_DIAS(), data);
  const diaSnap = await getDoc(diaRef);
  if (diaSnap.exists()) {
    await deleteDoc(diaRef);
  }
}

// Salva os dados parseados no Firestore
// vendasPorDia: { 'YYYY-MM-DD': { totalQuantidade, totalReceita, produtos: [...] } }
export async function salvarVendasImportadas(vendasPorDia, userName = '') {
  const datas = Object.keys(vendasPorDia);

  for (const data of datas) {
    const dadosDia = vendasPorDia[data];

    // 1. Primeiro, deleta vendas existentes desse dia (se houver)
    await deletarVendasDoDia(data);

    // 2. Cria o registro do dia
    const diaRef = doc(VENDAS_DIAS(), data);
    await setDoc(diaRef, {
      data,
      totalQuantidade: dadosDia.totalQuantidade,
      totalReceita: dadosDia.totalReceita,
      totalPratos: dadosDia.produtos.length,
      importadoEm: serverTimestamp(),
      importadoPor: userName || 'sistema'
    });

    // 3. Cria cada venda do dia
    for (const produto of dadosDia.produtos) {
      const vendaRef = doc(VENDAS());
      await setDoc(vendaRef, {
        data,
        produtoNome: produto.nome,
        quantidade: produto.quantidade,
        subtotal: produto.subtotal,
        acrescimo: produto.acrescimo,
        desconto: produto.desconto,
        total: produto.total,
        fichaId: null,  // será preenchido na fase 3B
        ...auditFields({ criadoEm: serverTimestamp() })
      });
    }
  }
}

// ============================================================================
// PARSER DO RELATÓRIO GESTOR FOOD
// ============================================================================
// Lê o texto bruto e extrai todas as vendas estruturadas.
// Resultado: { sucesso, mensagem, vendasPorDia, totalDias, totalProdutos, totalReceita }
// ============================================================================

export function parseRelatorioGestorFood(textoRelatorio) {
  try {
    if (!textoRelatorio || textoRelatorio.trim().length < 50) {
      return { sucesso: false, mensagem: 'Relatório muito curto ou vazio' };
    }

    const linhas = textoRelatorio.split('\n');

    // Estado do parser
    let secaoAtual = null;       // 'PRODUTO' = estamos na seção que interessa
    let produtoAtual = null;     // produto sendo lido
    const vendasPorDia = {};     // { 'YYYY-MM-DD': { produtos: [...] } }

    // Regex para detectar tipo de linha
    const REGEX_HEADER_SECAO = /^(TURNO|CAIXA|VENDEDOR|GRUPO|SUBGRUPO|PRODUTO|DIA)\s+QUANTIDADE/i;
    const REGEX_DATA = /^(\d{2})\/(\d{2})\/(\d{4})/;

    for (let i = 0; i < linhas.length; i++) {
      const linha = linhas[i].trim();
      if (!linha) continue;

      // Detecta header de seção
      const matchHeader = linha.match(REGEX_HEADER_SECAO);
      if (matchHeader) {
        secaoAtual = matchHeader[1].toUpperCase();
        produtoAtual = null;
        continue;
      }

      // Só processa linhas dentro da seção PRODUTO
      if (secaoAtual !== 'PRODUTO') continue;

      // Pula linhas vazias ou cabeçalho
      if (linha.toLowerCase().includes('quantidade')) continue;

      // Divide por tabs ou múltiplos espaços
      const partes = linha.split(/\t+|\s{2,}/).filter(p => p.trim());

      if (partes.length < 6) continue;

      // Os últimos 5 valores são sempre: qtd, subtotal, acréscimo, desconto, total
      const total = parseNumeroBR(partes[partes.length - 1]);
      const desconto = parseNumeroBR(partes[partes.length - 2]);
      const acrescimo = parseNumeroBR(partes[partes.length - 3]);
      const subtotal = parseNumeroBR(partes[partes.length - 4]);
      const quantidade = parseNumeroBR(partes[partes.length - 5]);

      // Todas as partes do início (até os 5 números) formam o nome
      const primeiraColuna = partes.slice(0, partes.length - 5).join(' ').trim();

      // É linha de DATA?
      const matchData = primeiraColuna.match(REGEX_DATA);
      if (matchData) {
        // Linha de data (dentro de um produto)
        if (!produtoAtual) continue;  // sem produto definido, ignora

        const dataISO = `${matchData[3]}-${matchData[2]}-${matchData[1]}`;

        // Garante estrutura do dia
        if (!vendasPorDia[dataISO]) {
          vendasPorDia[dataISO] = {
            totalQuantidade: 0,
            totalReceita: 0,
            produtos: []
          };
        }

        // Adiciona venda do produto-dia
        vendasPorDia[dataISO].produtos.push({
          nome: produtoAtual,
          quantidade,
          subtotal,
          acrescimo,
          desconto,
          total
        });

        vendasPorDia[dataISO].totalQuantidade += quantidade;
        vendasPorDia[dataISO].totalReceita += total;
      } else {
        // Linha de PRODUTO novo (totalizador)
        produtoAtual = primeiraColuna;
      }
    }

    const datas = Object.keys(vendasPorDia).sort();

    if (datas.length === 0) {
      return {
        sucesso: false,
        mensagem: 'Nenhum dado válido encontrado. Verifique se colou o relatório correto do Gestor Food (com a seção PRODUTO).'
      };
    }

    // Estatísticas globais
    let totalProdutos = 0;
    let totalReceita = 0;
    for (const data of datas) {
      totalProdutos += vendasPorDia[data].produtos.length;
      totalReceita += vendasPorDia[data].totalReceita;
    }

    return {
      sucesso: true,
      vendasPorDia,
      dataInicio: datas[0],
      dataFim: datas[datas.length - 1],
      totalDias: datas.length,
      totalProdutos,
      totalReceita,
      mensagem: `${datas.length} dia(s) detectado(s), ${totalProdutos} venda(s)`
    };

  } catch (e) {
    return {
      sucesso: false,
      mensagem: 'Erro ao processar: ' + e.message
    };
  }
}

// Helper: converte "1.234,56" → 1234.56
function parseNumeroBR(str) {
  if (!str) return 0;
  const limpo = String(str).trim().replace(/\./g, '').replace(',', '.');
  const num = parseFloat(limpo);
  return isNaN(num) ? 0 : num;
}

// Helper: formata data YYYY-MM-DD pra DD/MM/YYYY (uso na UI)
export function formatarDataBR(dataISO) {
  if (!dataISO) return '';
  const m = String(dataISO).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : dataISO;
}

// ============================================================================
// SEED INICIAL
// ============================================================================

export async function seedCatalogoSeVazio(seedData) {
  const snapCats = await getDocs(CATEGORIAS());
  if (snapCats.size > 0) {
    return { importado: false };
  }

  const batch = writeBatch(db);
  let countCats = 0, countItens = 0;

  for (let i = 0; i < seedData.length; i++) {
    const cat = seedData[i];
    const refCat = doc(CATEGORIAS());
    batch.set(refCat, {
      nome: cat.nome,
      cor: cat.cor,
      ordem: i,
      ...auditFields({ criadoEm: serverTimestamp() })
    });
    countCats++;

    for (let j = 0; j < cat.itens.length; j++) {
      const it = cat.itens[j];
      const refItem = doc(ITENS());
      batch.set(refItem, {
        nome: it.nome,
        tipo: it.tipo || '',
        categoriaId: refCat.id,
        fornecedorPreferido: '',
        insumoId: null,
        fatorConversao: 1,
        ordem: j,
        ultimoPreco: null,
        precoAnterior: null,
        historicoPrecos: [],
        ...auditFields({ criadoEm: serverTimestamp() })
      });
      countItens++;
    }
  }

  await batch.commit();
  return { importado: true, categorias: countCats, itens: countItens };
}
