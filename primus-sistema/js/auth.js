// ===== AUTENTICAÇÃO — PRIMUS =====
// Login simples por PIN, sessão salva no sessionStorage do navegador.

import { db, collection, getDocs, doc, getDoc, setDoc, query, where } from './firebase-config.js';

// ===== NOMES DAS COLEÇÕES =====
// Todas prefixadas com 'primus_' para não conflitar com outros sistemas
// que você já tem no mesmo projeto Firebase.
const COL_USUARIOS = 'primus_usuarios';

const SESSION_KEY = 'primus_session';

// ===== HASH DE PIN =====
// Uso SHA-256 via Web Crypto API. Não é proteção militar, mas evita que um
// curioso abrindo o Firestore veja PINs em texto puro.
export async function hashPin(pin) {
  const enc = new TextEncoder().encode(pin + '|primus_salt_v1');
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}

// ===== BUSCAR TODOS OS USUÁRIOS (ativos) =====
// Retorna lista de { id, nome, perfil } — SEM o hash do PIN.
// Usado na tela de login — só mostra ativos.
export async function listarUsuarios() {
  const arr = await listarUsuariosCompleto();
  return arr.filter(u => u.ativo);
}

// ===== BUSCAR TODOS OS USUÁRIOS (incluindo inativos) =====
// Usado no painel do gestor pra gerenciar.
export async function listarUsuariosCompleto() {
  const snap = await getDocs(collection(db, COL_USUARIOS));
  const arr = [];
  snap.forEach(d => {
    const data = d.data();
    arr.push({
      id: d.id,
      nome: data.nome,
      perfil: data.perfil,
      ativo: data.ativo !== false,
      criadoEm: data.criadoEm || null
    });
  });
  // Ordena: gestor primeiro, depois gerente, depois barman; dentro disso por nome
  const ordem = { gestor: 0, gerente: 1, barman: 2 };
  arr.sort((a,b) => {
    // Inativos sempre no final
    if (a.ativo !== b.ativo) return a.ativo ? -1 : 1;
    const oa = ordem[a.perfil] ?? 99;
    const ob = ordem[b.perfil] ?? 99;
    if (oa !== ob) return oa - ob;
    return a.nome.localeCompare(b.nome, 'pt-BR');
  });
  return arr;
}

// ===== FAZER LOGIN =====
export async function fazerLogin(usuarioId, pin) {
  const ref = doc(db, COL_USUARIOS, usuarioId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    return { ok: false, erro: 'Usuário não encontrado.' };
  }
  const u = snap.data();
  const pinHash = await hashPin(pin);
  if (u.pinHash !== pinHash) {
    return { ok: false, erro: 'PIN incorreto.' };
  }
  const sessao = {
    id: usuarioId,
    nome: u.nome,
    perfil: u.perfil,
    loginAt: Date.now()
  };
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(sessao));
  return { ok: true, sessao };
}

// ===== SESSÃO ATUAL =====
export function getSessao() {
  try {
    const s = sessionStorage.getItem(SESSION_KEY);
    if (!s) return null;
    return JSON.parse(s);
  } catch { return null; }
}

export function logout() {
  sessionStorage.removeItem(SESSION_KEY);
  window.location.href = 'index.html';
}

// ===== GUARDA DE ROTA =====
// Chama no início de cada página protegida. Redireciona se não tiver
// sessão ou se o perfil não tiver permissão.
export function exigirPerfil(perfisPermitidos) {
  const s = getSessao();
  if (!s) {
    window.location.href = 'index.html';
    return null;
  }
  if (!perfisPermitidos.includes(s.perfil)) {
    alert('Você não tem permissão para acessar esta área.');
    // Manda pra onde ele tem acesso
    if (s.perfil === 'gestor') window.location.href = 'gestor.html';
    else window.location.href = 'contagem.html';
    return null;
  }
  return s;
}

// ===== CADASTRO DE USUÁRIO =====
// Usado pelo gestor pra criar novos usuários (e pelo seed inicial).
export async function criarUsuario({ id, nome, perfil, pin }) {
  if (!['barman','gerente','gestor'].includes(perfil)) {
    throw new Error('Perfil inválido.');
  }
  if (!/^\d{4}$/.test(pin)) {
    throw new Error('PIN deve ter exatamente 4 dígitos.');
  }
  const pinHash = await hashPin(pin);
  const dados = {
    nome: nome.trim(),
    perfil,
    pinHash,
    ativo: true,
    criadoEm: new Date().toISOString()
  };
  const docRef = id ? doc(db, COL_USUARIOS, id) : doc(collection(db, COL_USUARIOS));
  await setDoc(docRef, dados, { merge: false });
  return docRef.id;
}

// ===== EDITAR USUÁRIO (nome e/ou perfil) =====
// Busca o doc atual, mescla os campos novos, regrava tudo
// (as regras do Firestore exigem todos os campos obrigatórios na escrita).
export async function atualizarUsuario(id, { nome, perfil }) {
  const ref = doc(db, COL_USUARIOS, id);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Usuário não encontrado.');
  const atual = snap.data();

  if (perfil && !['barman','gerente','gestor'].includes(perfil)) {
    throw new Error('Perfil inválido.');
  }
  if (nome != null && (typeof nome !== 'string' || !nome.trim())) {
    throw new Error('Nome não pode ser vazio.');
  }

  const novoDado = {
    nome: nome != null ? nome.trim() : atual.nome,
    perfil: perfil || atual.perfil,
    pinHash: atual.pinHash,        // mantém o PIN atual
    ativo: atual.ativo !== false,  // mantém status
    criadoEm: atual.criadoEm || new Date().toISOString()
  };
  await setDoc(ref, novoDado, { merge: false });
}

// ===== TROCAR PIN =====
export async function trocarPin(id, novoPin) {
  if (!/^\d{4}$/.test(novoPin)) {
    throw new Error('PIN deve ter exatamente 4 dígitos.');
  }
  const ref = doc(db, COL_USUARIOS, id);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Usuário não encontrado.');
  const atual = snap.data();

  const novoDado = {
    nome: atual.nome,
    perfil: atual.perfil,
    pinHash: await hashPin(novoPin),
    ativo: atual.ativo !== false,
    criadoEm: atual.criadoEm || new Date().toISOString()
  };
  await setDoc(ref, novoDado, { merge: false });
}

// ===== DESATIVAR / REATIVAR =====
// Desativar preserva o documento (histórico das contagens continua associado).
// Pessoa desativada não aparece na tela de login.
export async function setAtivoUsuario(id, ativo) {
  const ref = doc(db, COL_USUARIOS, id);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Usuário não encontrado.');
  const atual = snap.data();

  const novoDado = {
    nome: atual.nome,
    perfil: atual.perfil,
    pinHash: atual.pinHash,
    ativo: !!ativo,
    criadoEm: atual.criadoEm || new Date().toISOString()
  };
  await setDoc(ref, novoDado, { merge: false });
}

// ===== SEED INICIAL =====
// Se não tiver nenhum usuário, cria os 3 padrão.
// Depois você pode mudar pelo painel do gestor.
export async function seedUsuariosSeNecessario() {
  const snap = await getDocs(collection(db, COL_USUARIOS));
  if (!snap.empty) return false;
  await criarUsuario({ id: 'barman_padrao',  nome: 'Barman',  perfil: 'barman',  pin: '1111' });
  await criarUsuario({ id: 'gerente_padrao', nome: 'Gerente', perfil: 'gerente', pin: '2222' });
  await criarUsuario({ id: 'gestor_padrao',  nome: 'Gestor',  perfil: 'gestor',  pin: '0000' });
  return true;
}
