// ============================================================================
// AUTH.JS — versão simplificada com criação atômica
// ============================================================================

import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";

import {
  doc,
  setDoc,
  getDoc,
  getDocs,
  collection,
  query,
  where,
  serverTimestamp,
  Timestamp,
  writeBatch
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

import { auth, db } from './firebase-init.js';

import {
  WORKSPACE_ID,
  EMAIL_DOMAIN,
  MAX_TENTATIVAS,
  BLOQUEIO_MINUTOS,
  ADMIN_CODE
} from './firebase-config.js';

// 🔧 Flag global para suspender observador durante criação
let _suspendObserver = false;
export function suspenderObservador() { _suspendObserver = true; console.log('[auth] observador SUSPENSO'); }
export function liberarObservador() { _suspendObserver = false; console.log('[auth] observador LIBERADO'); }

export function gerarSegredo() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const arr = new Uint8Array(24);
  crypto.getRandomValues(arr);
  let out = '';
  for (let i = 0; i < arr.length; i++) {
    out += chars[arr[i] % chars.length];
  }
  return out;
}

export async function derivarSenha(pin, segredo) {
  const dados = pin + ':' + segredo;
  const buffer = new TextEncoder().encode(dados);
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArr = Array.from(new Uint8Array(hashBuffer));
  return hashArr.map(b => b.toString(16).padStart(2, '0')).join('');
}

export function normalizarUsername(s) {
  return (s || '').toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

export function validarPin(pin) {
  return /^\d{4}$/.test(pin);
}

export function validarUsername(u) {
  return /^[a-z0-9_]{3,20}$/.test(u);
}

export async function buscarAuthLookup(username) {
  const usernameNorm = normalizarUsername(username);
  console.log('[buscarAuthLookup] procurando:', usernameNorm);
  if (!usernameNorm) return null;

  const lookupRef = collection(db, 'workspaces', WORKSPACE_ID, 'auth_lookup');
  const q = query(lookupRef, where('username', '==', usernameNorm));
  const snap = await getDocs(q);
  console.log('[buscarAuthLookup] encontrados:', snap.size);
  if (snap.empty) return null;

  const docSnap = snap.docs[0];
  return { id: docSnap.id, ...docSnap.data() };
}

export function estaBloqueado(lookup) {
  if (!lookup || !lookup.bloqueadoAte) return false;
  const ate = lookup.bloqueadoAte.toDate ? lookup.bloqueadoAte.toDate() : new Date(lookup.bloqueadoAte);
  return ate > new Date();
}

async function registrarTentativaFalha(lookupId) {
  const lookupRef = doc(db, 'workspaces', WORKSPACE_ID, 'auth_lookup', lookupId);
  const snap = await getDoc(lookupRef);
  if (!snap.exists()) return;
  const dados = snap.data();
  const novasTentativas = (dados.tentativasFalhas || 0) + 1;
  const update = {
    tentativasFalhas: novasTentativas,
    ultimaTentativa: serverTimestamp()
  };
  if (novasTentativas >= MAX_TENTATIVAS) {
    const bloqueioAte = new Date(Date.now() + BLOQUEIO_MINUTOS * 60 * 1000);
    update.bloqueadoAte = Timestamp.fromDate(bloqueioAte);
  }
  await setDoc(lookupRef, update, { merge: true });
}

async function zerarTentativas(lookupId) {
  const lookupRef = doc(db, 'workspaces', WORKSPACE_ID, 'auth_lookup', lookupId);
  await setDoc(lookupRef, {
    tentativasFalhas: 0,
    bloqueadoAte: null,
    ultimaTentativa: serverTimestamp()
  }, { merge: true });
}

export async function login(username, pin) {
  console.log('[login] iniciando, username:', username);
  if (!validarUsername(normalizarUsername(username))) {
    const e = new Error('Nome de usuário inválido');
    e.codigo = 'username_invalido';
    throw e;
  }
  if (!validarPin(pin)) {
    const e = new Error('PIN deve ter 4 dígitos');
    e.codigo = 'pin_invalido';
    throw e;
  }

  const lookup = await buscarAuthLookup(username);
  if (!lookup) {
    const e = new Error('Usuário não encontrado');
    e.codigo = 'nao_encontrado';
    throw e;
  }

  if (estaBloqueado(lookup)) {
    const ate = lookup.bloqueadoAte.toDate();
    const min = Math.ceil((ate - new Date()) / 60000);
    const e = new Error(`Conta bloqueada. Tente em ${min} minuto(s).`);
    e.codigo = 'bloqueado';
    throw e;
  }

  const senha = await derivarSenha(pin, lookup.segredo);

  try {
    const userCred = await signInWithEmailAndPassword(auth, lookup.emailTecnico, senha);
    await zerarTentativas(lookup.id);
    const userRef = doc(db, 'workspaces', WORKSPACE_ID, 'usuarios', userCred.user.uid);
    await setDoc(userRef, { ultimoLogin: serverTimestamp() }, { merge: true });
    return userCred.user;
  } catch (err) {
    console.error('[login] erro:', err);
    await registrarTentativaFalha(lookup.id);
    const e = new Error('PIN incorreto');
    e.codigo = 'pin_incorreto';
    throw e;
  }
}

export async function workspaceTemDono() {
  console.log('[workspaceTemDono] verificando...');
  try {
    const wsRef = doc(db, 'workspaces', WORKSPACE_ID);
    const snap = await getDoc(wsRef);
    const tem = snap.exists() && snap.data().criadoPor;
    console.log('[workspaceTemDono] resultado:', tem);
    return tem;
  } catch (err) {
    console.error('[workspaceTemDono] ERRO:', err);
    throw err;
  }
}

// ============================================================================
// CRIAÇÃO DO DONO (versão atômica com batch)
// ============================================================================

export async function criarWorkspaceEDono({ adminCode, nomeWorkspace, nome, username, pin }) {
  console.log('[criar] INICIANDO');
  console.log('  - nome:', nome, '| username:', username);

  if (adminCode !== ADMIN_CODE) {
    throw new Error('Código de administrador inválido');
  }

  const usernameNorm = normalizarUsername(username);
  if (!validarUsername(usernameNorm)) {
    throw new Error('Nome de usuário inválido (3-20 letras/números/underscore)');
  }
  if (!validarPin(pin)) {
    throw new Error('PIN deve ter 4 dígitos');
  }

  if (await workspaceTemDono()) {
    throw new Error('Workspace já está configurado. Faça login normalmente.');
  }

  const lookupExistente = await buscarAuthLookup(usernameNorm);
  if (lookupExistente) {
    throw new Error('Este nome de usuário já está em uso');
  }

  const segredo = gerarSegredo();
  const emailTecnico = `${usernameNorm}@${EMAIL_DOMAIN}`;
  const senha = await derivarSenha(pin, segredo);

  // 🔧 Suspende observador ANTES de criar usuário
  suspenderObservador();

  let uid;
  try {
    console.log('[criar] criando user no Firebase Auth...');
    const userCred = await createUserWithEmailAndPassword(auth, emailTecnico, senha);
    uid = userCred.user.uid;
    console.log('[criar] uid:', uid);

    // 🔧 BATCH: cria os 3 docs ATOMICAMENTE em uma única operação
    console.log('[criar] criando 3 docs em batch...');
    const batch = writeBatch(db);

    const wsRef = doc(db, 'workspaces', WORKSPACE_ID);
    batch.set(wsRef, {
      nome: nomeWorkspace || 'Peixaria Primus',
      criadoEm: serverTimestamp(),
      criadoPor: uid,
      config: { moeda: 'BRL', locale: 'pt-BR' }
    });

    const userRef = doc(db, 'workspaces', WORKSPACE_ID, 'usuarios', uid);
    batch.set(userRef, {
      nome: nome,
      username: usernameNorm,
      role: 'dono',
      ativo: true,
      emailTecnico: emailTecnico,
      criadoEm: serverTimestamp(),
      ultimoLogin: serverTimestamp()
    });

    const lookupRef = doc(db, 'workspaces', WORKSPACE_ID, 'auth_lookup', uid);
    batch.set(lookupRef, {
      username: usernameNorm,
      emailTecnico: emailTecnico,
      segredo: segredo,
      tentativasFalhas: 0,
      bloqueadoAte: null,
      ultimaTentativa: null
    });

    await batch.commit();
    console.log('[criar] ✅ batch commitado com sucesso');

    return { uid };
  } catch (err) {
    console.error('[criar] FALHA:', err);
    throw err;
  } finally {
    // 🔧 Libera observador (vai disparar e logar normalmente)
    setTimeout(() => liberarObservador(), 500);
  }
}

export async function criarMembro({ nome, username, pin, role = 'membro' }) {
  const usernameNorm = normalizarUsername(username);
  if (!validarUsername(usernameNorm)) throw new Error('Nome de usuário inválido');
  if (!validarPin(pin)) throw new Error('PIN deve ter 4 dígitos');

  const lookupExistente = await buscarAuthLookup(usernameNorm);
  if (lookupExistente) throw new Error('Este nome de usuário já está em uso');

  const segredo = gerarSegredo();
  const emailTecnico = `${usernameNorm}@${EMAIL_DOMAIN}`;
  const senha = await derivarSenha(pin, segredo);

  suspenderObservador();
  try {
    const userCred = await createUserWithEmailAndPassword(auth, emailTecnico, senha);
    const uid = userCred.user.uid;

    const batch = writeBatch(db);
    batch.set(doc(db, 'workspaces', WORKSPACE_ID, 'usuarios', uid), {
      nome, username: usernameNorm, role, ativo: true,
      emailTecnico, criadoEm: serverTimestamp(), ultimoLogin: null
    });
    batch.set(doc(db, 'workspaces', WORKSPACE_ID, 'auth_lookup', uid), {
      username: usernameNorm, emailTecnico, segredo,
      tentativasFalhas: 0, bloqueadoAte: null, ultimaTentativa: null
    });
    await batch.commit();

    await signOut(auth);
    return { uid, username: usernameNorm, precisaReLogin: true };
  } finally {
    setTimeout(() => liberarObservador(), 500);
  }
}

export async function logout() {
  await signOut(auth);
}

export async function carregarPerfil(uid) {
  console.log('[carregarPerfil] uid:', uid);
  try {
    const userRef = doc(db, 'workspaces', WORKSPACE_ID, 'usuarios', uid);
    const snap = await getDoc(userRef);
    if (!snap.exists()) {
      console.log('[carregarPerfil] não existe');
      return null;
    }
    return { id: uid, ...snap.data() };
  } catch (err) {
    console.error('[carregarPerfil] ERRO:', err);
    throw err;
  }
}

export function observarAuth(callback) {
  return onAuthStateChanged(auth, async (user) => {
    // 🔧 Se observador suspenso, não faz nada
    if (_suspendObserver) {
      console.log('[observarAuth] suspenso, ignorando mudança');
      return;
    }
    if (!user) {
      callback(null);
      return;
    }
    try {
      const perfil = await carregarPerfil(user.uid);
      callback({ user, perfil });
    } catch (err) {
      console.error('Erro ao carregar perfil:', err);
      callback({ user, perfil: null });
    }
  });
}
