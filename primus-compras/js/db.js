// ============================================================================
// DB.JS — Operações no Firestore
// ============================================================================

import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  serverTimestamp,
  writeBatch,
  Timestamp
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

import { WORKSPACE_ID } from './firebase-config.js';

const db = getFirestore();

// ============================================================================
// HELPERS DE PATH
// ============================================================================

const wsPath = () => ['workspaces', WORKSPACE_ID];
const categoriasCol = () => collection(db, ...wsPath(), 'categorias');
const itensCol = () => collection(db, ...wsPath(), 'itens');
const listaAtualCol = () => collection(db, ...wsPath(), 'lista_atual');
const historicoCol = () => collection(db, ...wsPath(), 'historico');

// ============================================================================
// CONTEXTO DO USUÁRIO ATUAL (preenchido pelo app.js após login)
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
  // ⚠️ Atenção: não está deletando os itens da categoria. O app.js deve avisar.
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
  // Também remove da lista atual se estiver lá
  const listaRef = doc(db, ...wsPath(), 'lista_atual', id);
  try { await deleteDoc(listaRef); } catch (e) { /* não estava na lista */ }
}

// ============================================================================
// LISTA ATUAL (estado de compra)
// ============================================================================

/**
 * O id do doc em lista_atual é o MESMO id do item no catálogo.
 * Isso simplifica join e evita duplicatas.
 */

export function observarListaAtual(callback) {
  return onSnapshot(listaAtualCol(), (snap) => {
    const lista = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    callback(lista);
  });
}

export async function setItemListaAtual(itemId, { qtd, preco, comprado, observacao }) {
  const ref = doc(db, ...wsPath(), 'lista_atual', itemId);
  // Se qtd for 0 ou vazio E preco vazio E não comprado, removemos da lista
  const qtdNum = parseFloat(qtd) || 0;
  const precoNum = parseFloat(preco) || 0;
  const obs = observacao || '';

  if (qtdNum === 0 && precoNum === 0 && !comprado && !obs) {
    try { await deleteDoc(ref); } catch (e) { /* já não estava */ }
    return;
  }

  await setDoc(ref, {
    itemId,
    qtd: qtdNum,
    preco: precoNum,
    comprado: !!comprado,
    observacao: obs,
    ...carimboAuditoria()
  }, { merge: true });
}

export async function atualizarCampoListaAtual(itemId, campo, valor) {
  const ref = doc(db, ...wsPath(), 'lista_atual', itemId);
  const update = { [campo]: valor, ...carimboAuditoria() };
  await setDoc(ref, { itemId, ...update }, { merge: true });
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
 * Finaliza compra: cria doc no histórico e limpa lista_atual.
 * Recebe os itens enriquecidos com nome/categoria/etc do catálogo.
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

  // Atualiza ultimoPreco / precoAnterior em cada item do catálogo
  const batch = writeBatch(db);
  for (const it of itensEnriquecidos) {
    if (!it.itemId || !it.preco) continue;
    const itemRef = doc(db, ...wsPath(), 'itens', it.itemId);
    // Lê o doc atual pra mover ultimoPreco → precoAnterior
    const atualSnap = await getDoc(itemRef);
    if (!atualSnap.exists()) continue;
    const atual = atualSnap.data();
    batch.update(itemRef, {
      precoAnterior: atual.ultimoPreco || null,
      ultimoPreco: it.preco,
      ultimoPrecoData: serverTimestamp(),
      ...carimboAuditoria()
    });
  }
  await batch.commit();

  // Limpa lista_atual
  await limparListaAtual();

  return histRef.id;
}

export async function deletarHistorico(id) {
  const ref = doc(db, ...wsPath(), 'historico', id);
  await deleteDoc(ref);
}

// ============================================================================
// SEED INICIAL DO CATÁLOGO (importação do v9)
// ============================================================================

/**
 * Importa o seed-catalog.json no workspace.
 * Cria categorias e itens em batch. Só roda se ainda não houver categorias.
 */
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
