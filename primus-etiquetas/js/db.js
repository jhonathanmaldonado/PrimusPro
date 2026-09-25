// ============================================================
// PRIMUS ETIQUETAS - js/db.js (v5)
// Firebase: inicializacao, login usuario+PIN, perfil, setup inicial, usuarios
// Projeto Firebase proprio: primus-etiquetas (independente dos outros sistemas)
// v2: cadastro/edicao de usuarios (gestor e chef) e troca do proprio PIN
// v3: grupos, produtos (validade em horas por modo de conservacao) e historico
// v4: emissao de etiquetas (codigo sequencial + fila de impressao) e conferencia de PIN do responsavel
// v5: importacao em lote de grupos e produtos (planilha revisada)
// ============================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, onAuthStateChanged, EmailAuthProvider, reauthenticateWithCredential, updatePassword
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, writeBatch, collection, onSnapshot, serverTimestamp,
  addDoc, getDocs, query, orderBy, limit, runTransaction, Timestamp
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCrg1urUvvy5IKwNUFxGaUeN0cb1Sfr2wU",
  authDomain: "primus-etiquetas.firebaseapp.com",
  projectId: "primus-etiquetas",
  storageBucket: "primus-etiquetas.firebasestorage.app",
  messagingSenderId: "954447192543",
  appId: "1:954447192543:web:2524c4cb6fdd3896be246a"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// Instancia secundaria: cria login de funcionario sem deslogar quem esta cadastrando
const appSecundario = initializeApp(firebaseConfig, "cadastro");
const authSecundario = getAuth(appSecundario);

export const PAPEIS = ["gestor", "chef", "cozinha"];

// ---------------------------------------------------------------- usuario + PIN
// O usuario vira um e-mail interno e o PIN vira a senha (o Firebase exige 6+ caracteres).
// Ninguem ve esse e-mail: a tela so pede usuario e PIN.
const DOMINIO_INTERNO = "primus-etiquetas.app";

export function normalizarUsuario(texto) {
  return String(texto || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().trim()
    .replace(/\s+/g, ".")
    .replace(/[^a-z0-9.]/g, "")
    .replace(/\.{2,}/g, ".")
    .replace(/^\.|\.$/g, "");
}

export function validarUsuario(usuario) {
  if (usuario.length < 3) return "O usuário precisa ter pelo menos 3 letras.";
  if (usuario.length > 20) return "O usuário pode ter no máximo 20 caracteres.";
  return "";
}

export function validarPin(pin) {
  return /^\d{4}$/.test(String(pin || "")) ? "" : "O PIN precisa ter exatamente 4 números.";
}

function usuarioParaEmail(usuario) {
  return `${usuario}@${DOMINIO_INTERNO}`;
}

function pinParaSenha(pin) {
  return `pe-${pin}-primus`;
}

export function traduzirErro(e) {
  const codigo = (e && e.code) || "";
  if (codigo === "auth/invalid-credential" || codigo === "auth/wrong-password" || codigo === "auth/user-not-found" || codigo === "auth/invalid-email")
    return "Usuário ou PIN incorretos.";
  if (codigo === "auth/too-many-requests")
    return "Muitas tentativas erradas. Aguarde alguns minutos e tente de novo.";
  if (codigo === "auth/network-request-failed" || codigo === "unavailable")
    return "Sem conexão com a internet.";
  if (codigo === "auth/email-already-in-use")
    return "Esse usuário já existe.";
  if (codigo === "auth/requires-recent-login")
    return "Por segurança, saia e entre de novo antes de trocar o PIN.";
  if (codigo === "permission-denied")
    return "Sem permissão para essa ação.";
  if (e && e.mensagemTela) return e.mensagemTela;
  return "Erro inesperado: " + (e && e.message ? e.message : String(e));
}

function erroTela(msg) {
  const e = new Error(msg);
  e.mensagemTela = msg;
  return e;
}

// ---------------------------------------------------------------- setup inicial
export async function setupFeito() {
  const snap = await getDoc(doc(db, "config", "sistema"));
  return snap.exists();
}

// Cria o primeiro gestor. So funciona enquanto config/sistema nao existir (garantido pelas regras).
export async function fazerSetup(nome, usuario, pin) {
  const email = usuarioParaEmail(usuario);
  const senha = pinParaSenha(pin);
  let cred;
  try {
    cred = await createUserWithEmailAndPassword(auth, email, senha);
  } catch (e) {
    if (e.code === "auth/email-already-in-use") {
      cred = await signInWithEmailAndPassword(auth, email, senha);
    } else {
      throw e;
    }
  }
  const uid = cred.user.uid;
  const lote = writeBatch(db);
  lote.set(doc(db, "usuarios", uid), {
    usuario,
    nome: nome.trim(),
    papel: "gestor",
    ativo: true,
    criadoEm: serverTimestamp(),
    criadoPor: uid
  });
  lote.set(doc(db, "config", "sistema"), {
    setupConcluido: true,
    criadoEm: serverTimestamp(),
    criadoPor: uid
  });
  await lote.commit();
}

// ---------------------------------------------------------------- sessao
export function entrar(usuario, pin) {
  return signInWithEmailAndPassword(auth, usuarioParaEmail(usuario), pinParaSenha(pin));
}

export function sair() {
  return signOut(auth);
}

export function observarSessao(callback) {
  return onAuthStateChanged(auth, callback);
}

export async function carregarPerfil(uid) {
  const snap = await getDoc(doc(db, "usuarios", uid));
  return snap.exists() ? { uid, ...snap.data() } : null;
}

// ---------------------------------------------------------------- usuarios
export function observarUsuarios(callback, callbackErro) {
  return onSnapshot(collection(db, "usuarios"), (snap) => {
    const lista = snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
    lista.sort((a, b) => {
      if (a.ativo !== b.ativo) return a.ativo ? -1 : 1;
      return String(a.nome || "").localeCompare(String(b.nome || ""), "pt-BR");
    });
    callback(lista);
  }, callbackErro);
}

// Cria o login (na instancia secundaria) e depois o perfil em usuarios/{uid}
export async function criarUsuario({ nome, usuario, papel, pin }) {
  const email = usuarioParaEmail(usuario);
  const senha = pinParaSenha(pin);
  let uid;
  try {
    const cred = await createUserWithEmailAndPassword(authSecundario, email, senha);
    uid = cred.user.uid;
  } catch (e) {
    if (e.code !== "auth/email-already-in-use") throw e;
    // Tentativa anterior pode ter criado o login e falhado no perfil: com o mesmo PIN, completa
    try {
      const cred = await signInWithEmailAndPassword(authSecundario, email, senha);
      uid = cred.user.uid;
    } catch (e2) {
      throw erroTela(`O usuário "${usuario}" já existe. Escolha outro nome de usuário.`);
    }
  } finally {
    try { await signOut(authSecundario); } catch (e3) { /* ignora */ }
  }

  const existente = await getDoc(doc(db, "usuarios", uid));
  if (existente.exists()) throw erroTela(`O usuário "${usuario}" já está cadastrado.`);

  await setDoc(doc(db, "usuarios", uid), {
    usuario,
    nome: nome.trim(),
    papel,
    ativo: true,
    criadoEm: serverTimestamp(),
    criadoPor: auth.currentUser.uid
  });
  return uid;
}

export function atualizarUsuario(uid, campos) {
  const permitido = {};
  for (const k of ["nome", "papel", "ativo"]) {
    if (campos[k] !== undefined) permitido[k] = campos[k];
  }
  permitido.atualizadoEm = serverTimestamp();
  permitido.atualizadoPor = auth.currentUser.uid;
  return updateDoc(doc(db, "usuarios", uid), permitido);
}

// Troca o PIN do proprio usuario logado (pede o PIN atual)
export async function trocarMeuPin(usuario, pinAtual, pinNovo) {
  const user = auth.currentUser;
  if (!user) throw erroTela("Sessão expirada. Entre de novo.");
  const credencial = EmailAuthProvider.credential(usuarioParaEmail(usuario), pinParaSenha(pinAtual));
  try {
    await reauthenticateWithCredential(user, credencial);
  } catch (e) {
    if (e.code === "auth/invalid-credential" || e.code === "auth/wrong-password")
      throw erroTela("O PIN atual está errado.");
    throw e;
  }
  await updatePassword(user, pinParaSenha(pinNovo));
}

// ---------------------------------------------------------------- status da impressora
// O agente do PC da cozinha grava agentes/{PC}.ultimoSinal a cada 60 s.
export function observarAgentes(callback, callbackErro) {
  return onSnapshot(collection(db, "agentes"), (snap) => {
    const lista = snap.docs.map((d) => {
      const dados = d.data();
      return {
        id: d.id,
        impressora: dados.impressora || "",
        versao: dados.versao || "",
        ultimoSinal: dados.ultimoSinal && dados.ultimoSinal.toDate ? dados.ultimoSinal.toDate() : null
      };
    });
    callback(lista);
  }, callbackErro);
}

// ---------------------------------------------------------------- texto para busca
export function normalizarBusca(texto) {
  return String(texto || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------- grupos
export function observarGrupos(callback, callbackErro) {
  return onSnapshot(collection(db, "grupos"), (snap) => {
    const lista = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    lista.sort((a, b) => String(a.nome).localeCompare(String(b.nome), "pt-BR"));
    callback(lista);
  }, callbackErro);
}

export function criarGrupo(nome) {
  return addDoc(collection(db, "grupos"), {
    nome: nome.trim(),
    nomeBusca: normalizarBusca(nome),
    criadoEm: serverTimestamp(),
    criadoPor: auth.currentUser.uid
  });
}

export function renomearGrupo(id, nome) {
  return updateDoc(doc(db, "grupos", id), {
    nome: nome.trim(),
    nomeBusca: normalizarBusca(nome),
    atualizadoEm: serverTimestamp(),
    atualizadoPor: auth.currentUser.uid
  });
}

// ---------------------------------------------------------------- produtos
// Modos de conservacao. A validade e SEMPRE guardada em horas (o "quente" futuro vence em horas).
export const MODOS = [
  { id: "congelado", nome: "Congelado" },
  { id: "resfriado", nome: "Resfriado" },
  { id: "ambiente", nome: "Temp. ambiente" }
];

export function observarProdutos(callback, callbackErro) {
  return onSnapshot(collection(db, "produtos"), (snap) => {
    const lista = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    lista.sort((a, b) => String(a.nome).localeCompare(String(b.nome), "pt-BR"));
    callback(lista);
  }, callbackErro);
}

function registroHistorico(perfil, acao, mudancas) {
  return {
    quando: serverTimestamp(),
    autorUid: auth.currentUser.uid,
    autorNome: perfil.nome,
    acao,
    mudancas: mudancas || []
  };
}

// dados: { nome, grupoId, validades: {congelado, resfriado, ambiente} } (horas ou null)
export async function criarProduto(dados, perfil, mudancas) {
  const revisor = perfil.papel === "gestor" || perfil.papel === "chef";
  const ref = doc(collection(db, "produtos"));
  const lote = writeBatch(db);
  lote.set(ref, {
    nome: dados.nome.trim(),
    nomeBusca: normalizarBusca(dados.nome),
    grupoId: dados.grupoId,
    validades: dados.validades,
    ativo: true,
    pendenteRevisao: !revisor,
    criadoEm: serverTimestamp(),
    criadoPor: auth.currentUser.uid,
    criadoPorNome: perfil.nome
  });
  lote.set(doc(collection(db, "produtos", ref.id, "historico")),
    registroHistorico(perfil, revisor ? "criou" : "criou (aguardando revisão)", mudancas));
  await lote.commit();
  return ref.id;
}

// campos: qualquer combinacao de nome, grupoId, validades, ativo, pendenteRevisao
export async function atualizarProduto(id, campos, perfil, acao, mudancas) {
  const dados = { ...campos };
  if (dados.nome !== undefined) {
    dados.nome = dados.nome.trim();
    dados.nomeBusca = normalizarBusca(dados.nome);
  }
  dados.atualizadoEm = serverTimestamp();
  dados.atualizadoPor = auth.currentUser.uid;
  dados.atualizadoPorNome = perfil.nome;
  const lote = writeBatch(db);
  lote.update(doc(db, "produtos", id), dados);
  lote.set(doc(collection(db, "produtos", id, "historico")), registroHistorico(perfil, acao, mudancas));
  await lote.commit();
}

export async function lerHistorico(id, maximo) {
  const q = query(collection(db, "produtos", id, "historico"), orderBy("quando", "desc"), limit(maximo || 20));
  const snap = await getDocs(q);
  return snap.docs.map((d) => {
    const h = d.data();
    return { id: d.id, ...h, quando: h.quando && h.quando.toDate ? h.quando.toDate() : null };
  });
}

// ---------------------------------------------------------------- emissao
export const URL_ETIQUETA = "https://gestao.primuspeixaria.com.br/primus-etiquetas/?e=";

export function formatarCodigo(num) {
  return String(num).padStart(6, "0");
}

// Confere o PIN de outra pessoa (tablet compartilhado) sem trocar quem esta logado
export async function verificarPin(usuario, pin) {
  try {
    const cred = await signInWithEmailAndPassword(authSecundario, usuarioParaEmail(usuario), pinParaSenha(pin));
    return cred.user.uid;
  } catch (e) {
    if (e.code === "auth/invalid-credential" || e.code === "auth/wrong-password" || e.code === "auth/user-not-found")
      throw erroTela("PIN incorreto.");
    throw e;
  } finally {
    try { await signOut(authSecundario); } catch (e2) { /* ignora */ }
  }
}

// Reserva o proximo codigo e cria o pedido na fila, na mesma transacao.
// e: { produto, modo:{id,nome}, horas, manipulacao:Date, copias, responsavel:{uid,nome} }
export async function emitirEtiqueta(e) {
  const refContador = doc(db, "config", "contador");
  const manipMs = e.manipulacao.getTime();
  return runTransaction(db, async (t) => {
    const snap = await t.get(refContador);
    const num = (snap.exists() ? snap.data().ultimo : 0) + 1;
    const codigo = formatarCodigo(num);
    t.set(refContador, { ultimo: num, atualizadoEm: serverTimestamp() });
    t.set(doc(db, "filaImpressao", String(num)), {
      status: "pendente",
      tipo: "etiqueta",
      codigoNum: num,
      codigo,
      copias: e.copias,
      produtoId: e.produto.id,
      modo: e.modo.id,
      criadoEm: serverTimestamp(),
      solicitadoEm: Timestamp.fromMillis(Date.now()),
      emitidoPor: auth.currentUser.uid,
      dados: {
        produto: e.produto.nome,
        conservacao: e.modo.nome,
        manipulacaoEm: Timestamp.fromMillis(manipMs),
        validadeEm: Timestamp.fromMillis(manipMs + e.horas * 3600000),
        responsavel: e.responsavel.nome,
        responsavelUid: e.responsavel.uid,
        lote: codigo,
        qr: URL_ETIQUETA + num
      }
    });
    return { num, codigo };
  });
}

export function observarEtiqueta(num, callback) {
  return onSnapshot(doc(db, "filaImpressao", String(num)), (snap) => {
    callback(snap.exists() ? snap.data() : null);
  }, () => callback(null));
}

// ---------------------------------------------------------------- importacao em lote
// plano: { gruposNovos: [nome], mapaGrupos: {nomeBusca: id}, itens: [{acao:"criar"|"atualizar", id?, nome, grupo, validades, mudancas}] }
const POR_LOTE = 50; // cada produto = 2 gravacoes (produto + historico); lotes pequenos por seguranca

export async function executarImportacao(plano, perfil, aoProgredir) {
  const uid = auth.currentUser.uid;
  const mapaGrupos = { ...plano.mapaGrupos };

  if (plano.gruposNovos.length) {
    const lote = writeBatch(db);
    for (const nome of plano.gruposNovos) {
      const ref = doc(collection(db, "grupos"));
      lote.set(ref, { nome, nomeBusca: normalizarBusca(nome), criadoEm: serverTimestamp(), criadoPor: uid });
      mapaGrupos[normalizarBusca(nome)] = ref.id;
    }
    await lote.commit();
  }

  const itens = plano.itens;
  let feitos = 0;
  for (let i = 0; i < itens.length; i += POR_LOTE) {
    const lote = writeBatch(db);
    for (const item of itens.slice(i, i + POR_LOTE)) {
      const grupoId = mapaGrupos[normalizarBusca(item.grupo)];
      if (!grupoId) throw erroTela(`Grupo não encontrado: ${item.grupo}`);
      if (item.acao === "criar") {
        const ref = doc(collection(db, "produtos"));
        lote.set(ref, {
          nome: item.nome,
          nomeBusca: normalizarBusca(item.nome),
          grupoId,
          validades: item.validades,
          ativo: true,
          pendenteRevisao: false,
          criadoEm: serverTimestamp(),
          criadoPor: uid,
          criadoPorNome: perfil.nome
        });
        lote.set(doc(collection(db, "produtos", ref.id, "historico")),
          registroHistorico(perfil, "importou da planilha revisada", item.mudancas));
      } else {
        lote.update(doc(db, "produtos", item.id), {
          nome: item.nome,
          nomeBusca: normalizarBusca(item.nome),
          grupoId,
          validades: item.validades,
          ativo: true,
          pendenteRevisao: false,
          atualizadoEm: serverTimestamp(),
          atualizadoPor: uid,
          atualizadoPorNome: perfil.nome
        });
        lote.set(doc(collection(db, "produtos", item.id, "historico")),
          registroHistorico(perfil, "atualizou pela importação da planilha", item.mudancas));
      }
    }
    await lote.commit();
    feitos = Math.min(itens.length, i + POR_LOTE);
    if (aoProgredir) aoProgredir(feitos, itens.length);
  }
  return feitos;
}
