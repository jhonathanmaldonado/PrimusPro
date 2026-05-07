// ============================================================================
// DB.JS — Operações no Firestore (com lista_em_criacao + média histórica)
// ============================================================================

import {
  doc,
  setDoc,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  collection,
  query,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
  writeBatch
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

import { db } from './firebase-init.js';
import { WORKSPACE_ID } from './firebase-config.js';

// ============================================================================
// HELPERS DE PATH
// ============================================================================

const wsPath = () => ['workspaces', WORKSPACE_ID];
const categoriasCol = () => collection(db, ...wsPath(), 'categorias');
const itensCol = () => collection(db, ...wsPath(), 'itens');
const listaAtualCol = () => collection(db, ...wsPath(), 'lista_atual');
const listaEmCriacaoCol = () => collection(db, ...wsPath(), 'lista_em_criacao');
const historicoCol = () => collection(db, ...wsPath(), 'historico');

// ============================================================================
// CONTEXTO DO USUÁRIO
// ============================================================================

let _userCtx = null;
export function setUserContext(ctx) { _userCtx = ctx; }
export function getUserContext() { return _userCtx; }

function carimboAuditoria() {
  return {
    atualizadoEm: serverTimestamp(),
    atualizadoPor: _userCtx?.uid || null,
    atualizadoPorNome: _userCtx?.nome || 'desconhecido'
  };
}

// ============================================================================
// CONFIGURAÇÕES DO WORKSPACE
// ============================================================================

export async function getConfigMediaN() {
  try {
    const wsRef = doc(db, ...wsPath());
    const snap = await getDoc(wsRef);
    if (!snap.exists()) return 5;
    const config = snap.data().config || {};
    return config.mediaN || 5;
  } catch {
    return 5;
  }
}

export async function setConfigMediaN(n) {
  const wsRef = doc(db, ...wsPath());
  await updateDoc(wsRef, { 'config.mediaN': n });
}

// ============================================================================
// CATEGORIAS
// ============================================================================

export async function listarCategorias() {
  const q = query(categoriasCol(), orderBy('ordem', 'asc'));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export function observarCategorias(callback) {
  const q = query(categoriasCol(), orderBy('ordem', 'asc'));
  return onSnapshot(q, (snap) => {
    const cats = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    callback(cats);
  });
}

export async function criarCategoria({ nome, cor, ordem }) {
  const ref = await addDoc(categoriasCol(), {
    nome,
    cor: cor || '#7A1F38',
    ordem: ordem ?? 999,
    criadoEm: serverTimestamp(),
    criadoPor: _userCtx?.uid || null,
    ...carimboAuditoria()
  });
  return ref.id;
}

export async function atualizarCategoria(id, dados) {
  const ref = doc(db, ...wsPath(), 'categorias', id);
  await updateDoc(ref, { ...dados, ...carimboAuditoria() });
}

export async function deletarCategoria(id) {
  const ref = doc(db, ...wsPath(), 'categorias', id);
  await deleteDoc(ref);
}

// ============================================================================
// ITENS (CATÁLOGO)
// ============================================================================

export async function listarItens() {
  const q = query(itensCol(), orderBy('ordem', 'asc'));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export function observarItens(callback) {
  const q = query(itensCol(), orderBy('ordem', 'asc'));
  return onSnapshot(q, (snap) => {
    const itens = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    callback(itens);
  });
}

export async function criarItem({ nome, tipo, categoriaId, fornecedorPreferido, ordem }) {
  const ref = await addDoc(itensCol(), {
    nome,
    tipo: tipo || '',
    categoriaId,
    fornecedorPreferido: fornecedorPreferido || '',
    ordem: ordem ?? 999,
    ativo: true,
    ultimoPreco: null,
    ultimoPrecoData: null,
    precoAnterior: null,
    historicoPrecos: [],
    criadoEm: serverTimestamp(),
    criadoPor: _userCtx?.uid || null,
    ...carimboAuditoria()
  });
  return ref.id;
}

export async function atualizarItem(id, dados) {
  const ref = doc(db, ...wsPath(), 'itens', id);
  await updateDoc(ref, { ...dados, ...carimboAuditoria() });
}

export async function deletarItem(id) {
  const ref = doc(db, ...wsPath(), 'itens', id);
  await deleteDoc(ref);
  // Limpa também das listas
  try { await deleteDoc(doc(db, ...wsPath(), 'lista_atual', id)); } catch {}
  try { await deleteDoc(doc(db, ...wsPath(), 'lista_em_criacao', id)); } catch {}
}

// ============================================================================
// LISTA EM CRIAÇÃO (rascunho — só quantidades)
// ============================================================================

export function observarListaEmCriacao(callback) {
  return onSnapshot(listaEmCriacaoCol(), (snap) => {
    const lista = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    callback(lista);
  });
}

export async function setItemListaEmCriacao(itemId, qtd) {
  const ref = doc(db, ...wsPath(), 'lista_em_criacao', itemId);
  const qtdNum = parseFloat(qtd) || 0;

  if (qtdNum === 0) {
    try { await deleteDoc(ref); } catch {}
    return;
  }

  await setDoc(ref, {
    itemId,
    qtd: qtdNum,
    ...carimboAuditoria()
  }, { merge: true });
}

export async function limparListaEmCriacao() {
  const snap = await getDocs(listaEmCriacaoCol());
  const batch = writeBatch(db);
  snap.docs.forEach(d => batch.delete(d.ref));
  await batch.commit();
}

/**
 * Move tudo da lista_em_criacao para lista_atual.
 * Falha se já tiver lista_atual ativa.
 */
export async function salvarListaParaAtual() {
  const atualSnap = await getDocs(listaAtualCol());
  if (!atualSnap.empty) {
    throw new Error('Já existe uma Lista Atual em andamento. Finalize-a primeiro.');
  }

  const criacaoSnap = await getDocs(listaEmCriacaoCol());
  if (criacaoSnap.empty) {
    throw new Error('Lista vazia. Adicione quantidades antes de salvar.');
  }

  const batch = writeBatch(db);
  criacaoSnap.docs.forEach(d => {
    const dados = d.data();
    const novoRef = doc(db, ...wsPath(), 'lista_atual', d.id);
    batch.set(novoRef, {
      itemId: d.id,
      qtd: dados.qtd || 0,
      preco: 0,
      comprado: false,
      observacao: '',
      ...carimboAuditoria()
    });
    batch.delete(d.ref);
  });
  await batch.commit();

  return criacaoSnap.size;
}

// ============================================================================
// LISTA ATUAL (compra em curso — preço pago + comprado)
// ============================================================================

export function observarListaAtual(callback) {
  return onSnapshot(listaAtualCol(), (snap) => {
    const lista = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    callback(lista);
  });
}

export async function atualizarPrecoListaAtual(itemId, preco) {
  const ref = doc(db, ...wsPath(), 'lista_atual', itemId);
  await setDoc(ref, {
    preco: parseFloat(preco) || 0,
    ...carimboAuditoria()
  }, { merge: true });
}

export async function atualizarCompradoListaAtual(itemId, comprado) {
  const ref = doc(db, ...wsPath(), 'lista_atual', itemId);
  await setDoc(ref, {
    comprado: !!comprado,
    ...carimboAuditoria()
  }, { merge: true });
}

export async function atualizarQtdListaAtual(itemId, qtd) {
  const ref = doc(db, ...wsPath(), 'lista_atual', itemId);
  const qtdNum = parseFloat(qtd) || 0;
  if (qtdNum === 0) {
    try { await deleteDoc(ref); } catch {}
    return;
  }
  await setDoc(ref, {
    qtd: qtdNum,
    ...carimboAuditoria()
  }, { merge: true });
}

export async function removerItemListaAtual(itemId) {
  const ref = doc(db, ...wsPath(), 'lista_atual', itemId);
  try {
    await deleteDoc(ref);
  } catch (e) {
    console.error('Erro ao remover item:', e);
    throw e;
  }
}

export async function limparListaAtual() {
  const snap = await getDocs(listaAtualCol());
  const batch = writeBatch(db);
  snap.docs.forEach(d => batch.delete(d.ref));
  await batch.commit();
}

// ============================================================================
// HISTÓRICO
// ============================================================================

export function observarHistorico(callback, limite = 50) {
  const q = query(historicoCol(), orderBy('data', 'desc'));
  return onSnapshot(q, (snap) => {
    const hist = snap.docs.slice(0, limite).map(d => ({ id: d.id, ...d.data() }));
    callback(hist);
  });
}

/**
 * Finaliza compra: cria histórico, atualiza histórico de preços nos itens, limpa lista_atual.
 */
export async function finalizarCompra(itensEnriquecidos, total) {
  if (!itensEnriquecidos.length) {
    throw new Error('Lista vazia');
  }

  const histRef = await addDoc(historicoCol(), {
    data: serverTimestamp(),
    total,
    qtdItens: itensEnriquecidos.length,
    finalizadoPor: _userCtx?.uid || null,
    finalizadoPorNome: _userCtx?.nome || 'desconhecido',
    itens: itensEnriquecidos
  });

  // Atualiza histórico de preços em cada item do catálogo
  const batch = writeBatch(db);
  for (const it of itensEnriquecidos) {
    if (!it.itemId || !it.preco) continue;
    const itemRef = doc(db, ...wsPath(), 'itens', it.itemId);
    const atualSnap = await getDoc(itemRef);
    if (!atualSnap.exists()) continue;
    const atual = atualSnap.data();
    const histPrecos = (atual.historicoPrecos || []).slice();
    histPrecos.unshift({
      preco: it.preco,
      data: new Date().toISOString(),
      qtd: it.qtd
    });
    while (histPrecos.length > 20) histPrecos.pop();

    batch.update(itemRef, {
      precoAnterior: atual.ultimoPreco || null,
      ultimoPreco: it.preco,
      ultimoPrecoData: serverTimestamp(),
      historicoPrecos: histPrecos,
      ...carimboAuditoria()
    });
  }
  await batch.commit();

  await limparListaAtual();

  return histRef.id;
}

export async function deletarHistorico(id) {
  const ref = doc(db, ...wsPath(), 'historico', id);
  await deleteDoc(ref);
}

// ============================================================================
// HELPERS DE MÉDIA HISTÓRICA
// ============================================================================

/**
 * Calcula média das últimas N compras de um item, baseado em historicoPrecos.
 */
export function calcularMediaPrecos(item, n = 5) {
  const hist = item.historicoPrecos || [];
  if (!hist.length) return null;
  const ultimasN = hist.slice(0, n);
  const soma = ultimasN.reduce((s, h) => s + (parseFloat(h.preco) || 0), 0);
  return soma / ultimasN.length;
}

// ============================================================================
// SEED INICIAL DO CATÁLOGO
// ============================================================================

export async function seedCatalogoSeVazio(seedData) {
  const catsExistentes = await getDocs(categoriasCol());
  if (!catsExistentes.empty) {
    return { importado: false, motivo: 'Catálogo já tem dados' };
  }

  const batch = writeBatch(db);
  let ordemCat = 0;
  let totalItens = 0;

  for (const cat of seedData) {
    const catRef = doc(categoriasCol());
    batch.set(catRef, {
      nome: cat.nome,
      cor: cat.cor,
      ordem: ordemCat++,
      criadoEm: serverTimestamp(),
      criadoPor: _userCtx?.uid || null,
      atualizadoEm: serverTimestamp(),
      atualizadoPor: _userCtx?.uid || null,
      atualizadoPorNome: _userCtx?.nome || 'seed'
    });

    let ordemItem = 0;
    for (const it of cat.itens) {
      const itemRef = doc(itensCol());
      batch.set(itemRef, {
        nome: it.nome,
        tipo: it.tipo || '',
        categoriaId: catRef.id,
        fornecedorPreferido: '',
        ordem: ordemItem++,
        ativo: true,
        ultimoPreco: null,
        ultimoPrecoData: null,
        precoAnterior: null,
        historicoPrecos: [],
        criadoEm: serverTimestamp(),
        criadoPor: _userCtx?.uid || null,
        atualizadoEm: serverTimestamp(),
        atualizadoPor: _userCtx?.uid || null,
        atualizadoPorNome: _userCtx?.nome || 'seed'
      });
      totalItens++;
    }
  }

  await batch.commit();
  return { importado: true, categorias: seedData.length, itens: totalItens };
}
