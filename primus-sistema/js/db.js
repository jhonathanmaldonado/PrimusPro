// ===== DB — PRIMUS =====
// Funções de alto nível para salvar/buscar contagens, vendas, etc.

import {
  db,
  collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, serverTimestamp, Timestamp
} from './firebase-config.js';

// ===== NOMES DAS COLEÇÕES =====
// Todas prefixadas com 'primus_' para não conflitar com outros sistemas.
const COL_CONTAGENS = 'primus_contagens';
const COL_VENDAS    = 'primus_vendas';
const COL_COMPRAS   = 'primus_compras';
const COL_PRODUTOS  = 'primus_produtos';

// ===== CONTAGENS =====

/**
 * Salva uma contagem no Firestore.
 * @param {object} contagem - { tipo: 'ini'|'fin'|'sorv', data: 'YYYY-MM-DD', autor: {id,nome,perfil}, itens: {...} }
 */
export async function salvarContagem(contagem) {
  const ref = await addDoc(collection(db, COL_CONTAGENS), {
    tipo: contagem.tipo,
    data: contagem.data,
    autorId: contagem.autor.id,
    autorNome: contagem.autor.nome,
    autorPerfil: contagem.autor.perfil,
    itens: contagem.itens,
    criadoEm: serverTimestamp()
  });
  return ref.id;
}

/**
 * Lista contagens com filtros opcionais.
 * NOTA: busca todos os documentos e filtra/ordena em JS para evitar
 * necessidade de índices compostos. Em volume normal (até ~5000 contagens),
 * isso é perfeitamente aceitável.
 */
export async function listarContagens({ tipo, dataInicio, dataFim, limite = 500 } = {}) {
  const snap = await getDocs(collection(db, COL_CONTAGENS));
  const arr = [];
  snap.forEach(d => arr.push({ id: d.id, ...d.data() }));
  // Ordena por data (desc) e depois por criadoEm (desc)
  arr.sort((a, b) => {
    if (a.data !== b.data) return b.data.localeCompare(a.data);
    // Se mesma data, o mais recente (criadoEm) primeiro
    const aMs = a.criadoEm?.toMillis?.() || 0;
    const bMs = b.criadoEm?.toMillis?.() || 0;
    return bMs - aMs;
  });
  // Aplica filtros em JS
  let filtrado = arr;
  if (tipo)       filtrado = filtrado.filter(c => c.tipo === tipo);
  if (dataInicio) filtrado = filtrado.filter(c => c.data >= dataInicio);
  if (dataFim)    filtrado = filtrado.filter(c => c.data <= dataFim);
  return filtrado.slice(0, limite);
}

/**
 * Busca a contagem mais recente de um tipo e data (pra usar de "última contagem").
 */
export async function ultimaContagem({ tipo, data }) {
  // Busca todas e filtra em JS para evitar precisar de índice composto
  const snap = await getDocs(collection(db, COL_CONTAGENS));
  const arr = [];
  snap.forEach(d => {
    const dt = d.data();
    if (dt.tipo === tipo && dt.data === data) {
      arr.push({ id: d.id, ...dt });
    }
  });
  if (!arr.length) return null;
  arr.sort((a, b) => (b.criadoEm?.toMillis?.() || 0) - (a.criadoEm?.toMillis?.() || 0));
  return arr[0];
}

export async function excluirContagem(id) {
  await deleteDoc(doc(db, COL_CONTAGENS, id));
}

// ===== VENDAS (parseadas do TXT do PDV) =====

/**
 * Salva vendas de um dia. Sobrescreve se já existir.
 * @param {string} dia - 'YYYY-MM-DD'
 * @param {object} dados - { totais, vendedores, grupos, subgrupos, produtos, horas, operadores }
 */
export async function salvarVendas(dia, dados) {
  // dia = 'YYYY-MM-DD', dados = { totais, vendedores, grupos, subgrupos, produtos, horas, operadores }
  await setDoc(doc(db, COL_VENDAS, dia), {
    ...dados,
    atualizadoEm: serverTimestamp()
  });
}

export async function buscarVendasDia(dia) {
  const snap = await getDoc(doc(db, COL_VENDAS, dia));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

/**
 * Salva o detalhamento Vendedor × Produto num dia que já tem vendas importadas.
 * Mescla com o documento existente (preserva todos os outros campos).
 * @param {string} dia - 'YYYY-MM-DD'
 * @param {array} detalhado - array de { nome, totalQtd, total, produtos }
 */
export async function salvarDetalhadoVxP(dia, detalhado) {
  const existente = await buscarVendasDia(dia);
  if (!existente) {
    throw new Error(`Não há vendas importadas pro dia ${dia}. Suba primeiro o relatório geral.`);
  }
  // Remove o campo "id" que vem da leitura antes de gravar
  const { id, ...dados } = existente;
  await setDoc(doc(db, COL_VENDAS, dia), {
    ...dados,
    vendedoresDetalhado: detalhado,
    detalhadoAtualizadoEm: serverTimestamp()
  });
}

/**
 * Lista vendas ordenadas por data (mais recente primeiro).
 * Pode filtrar por período.
 * NOTA: busca todos os documentos e filtra/ordena em JS para evitar
 * necessidade de índices compostos no Firestore. Como cada doc é um dia,
 * em 1 ano são no máximo ~365 docs — perfeitamente aceitável.
 */
export async function listarVendas({ dataInicio, dataFim, limite = 365 } = {}) {
  const snap = await getDocs(collection(db, COL_VENDAS));
  const arr = [];
  snap.forEach(d => arr.push({ id: d.id, ...d.data() }));
  // Ordena por ID (que é a data YYYY-MM-DD), mais recente primeiro
  arr.sort((a, b) => b.id.localeCompare(a.id));
  // Filtra período se especificado
  let filtrado = arr;
  if (dataInicio) filtrado = filtrado.filter(v => v.id >= dataInicio);
  if (dataFim)    filtrado = filtrado.filter(v => v.id <= dataFim);
  // Aplica limite
  return filtrado.slice(0, limite);
}

/**
 * Lista apenas os IDs (datas) de vendas já importadas - útil pra detectar duplicatas.
 */
export async function listarDatasVendas() {
  const snap = await getDocs(collection(db, COL_VENDAS));
  const arr = [];
  snap.forEach(d => arr.push(d.id));
  arr.sort((a, b) => b.localeCompare(a));
  return arr;
}

// ===== LISTA DE COMPRAS =====

export async function salvarListaCompras(id, dados) {
  await setDoc(doc(db, COL_COMPRAS, id), {
    ...dados,
    atualizadoEm: serverTimestamp()
  });
}

export async function buscarListaCompras(id) {
  const snap = await getDoc(doc(db, COL_COMPRAS, id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// ===== FORNECEDORES =====
// Armazenados em primus_compras com ID fixo 'fornecedores' (um único documento)
// contendo um array de { id, nome, telefone?, produtos: [slug1, slug2...] }

const DOC_FORNECEDORES = 'fornecedores';

/** Busca a lista de fornecedores cadastrados. */
export async function listarFornecedores() {
  const snap = await getDoc(doc(db, COL_COMPRAS, DOC_FORNECEDORES));
  if (!snap.exists()) return [];
  return snap.data().lista || [];
}

/** Salva a lista completa de fornecedores (sobrescreve). */
export async function salvarFornecedores(lista) {
  await setDoc(doc(db, COL_COMPRAS, DOC_FORNECEDORES), {
    lista,
    atualizadoEm: serverTimestamp()
  });
}

// ===== HISTÓRICO DE PREÇOS =====
// Armazenado em primus_compras com ID fixo 'precos' (um único documento)
// Estrutura: { precos: { slug1: { valor, data, fornecedor }, slug2: {...} } }
// Guardamos apenas o ÚLTIMO preço de cada produto (mais recente sobrescreve).

const DOC_PRECOS = 'precos';

/** Busca o último preço pago de cada produto. Retorna objeto { slug: { valor, data, fornecedor } } */
export async function buscarUltimosPrecos() {
  const snap = await getDoc(doc(db, COL_COMPRAS, DOC_PRECOS));
  if (!snap.exists()) return {};
  return snap.data().precos || {};
}

/**
 * Salva os preços pagos numa compra + registra como recebimento.
 * Sobrescreve o último preço de cada item e adiciona um recebimento no histórico.
 * @param {array} itens - [{ slug, nome, qtd, precoUnit }]
 * @param {string} fornecedor - nome do fornecedor (opcional, usado como metadado)
 */
export async function salvarPrecosCompra(itens, fornecedor = '') {
  const ref = doc(db, COL_COMPRAS, DOC_PRECOS);
  const atual = await getDoc(ref);
  const precos = atual.exists() ? (atual.data().precos || {}) : {};

  const hoje = new Date().toISOString().slice(0, 10);
  let gravados = 0;
  const itensValidos = [];

  itens.forEach(i => {
    if (!i.precoUnit || i.precoUnit <= 0) return;
    precos[i.slug] = {
      valor: i.precoUnit,
      data: hoje,
      fornecedor: fornecedor || ''
    };
    gravados++;
    itensValidos.push(i);
  });

  if (gravados === 0) return 0;

  // Salva os preços
  await setDoc(ref, {
    precos,
    atualizadoEm: serverTimestamp()
  });

  // Registra também como recebimento (pra Auditoria usar depois)
  await registrarRecebimento({
    data: hoje,
    fornecedor,
    itens: itensValidos.map(i => ({
      slug: i.slug,
      nome: i.nome,
      qtd: i.qtd,
      precoUnit: i.precoUnit,
      total: i.qtd * i.precoUnit
    }))
  });

  return gravados;
}

// ===== RECEBIMENTOS =====
// Cada recebimento é um documento em primus_compras com ID "receb_YYYY-MM-DD_timestamp"
// Estrutura: { tipo: 'recebimento', data, fornecedor, itens: [...], criadoEm }

/**
 * Registra um recebimento (entrada de mercadoria) manualmente.
 * @param {object} dados - { data: 'YYYY-MM-DD', fornecedor, itens: [{slug, nome, qtd, precoUnit?, total?}] }
 */
export async function registrarRecebimento(dados) {
  const ts = Date.now();
  const id = `receb_${dados.data}_${ts}`;
  await setDoc(doc(db, COL_COMPRAS, id), {
    tipo: 'recebimento',
    data: dados.data,
    fornecedor: dados.fornecedor || '',
    itens: dados.itens || [],
    criadoEm: serverTimestamp()
  });
  return id;
}

/**
 * Lista recebimentos entre duas datas (inclusive).
 */
export async function listarRecebimentos(dataInicio, dataFim) {
  const snap = await getDocs(collection(db, COL_COMPRAS));
  const resultado = [];
  snap.forEach(d => {
    const v = d.data();
    if (v.tipo !== 'recebimento') return;
    if (v.data < dataInicio || v.data > dataFim) return;
    resultado.push({ id: d.id, ...v });
  });
  // Ordena por data asc
  resultado.sort((a, b) => a.data.localeCompare(b.data));
  return resultado;
}

/**
 * Exclui um recebimento pelo ID (pra corrigir erro ou remover duplicata).
 */
export async function excluirRecebimento(id) {
  await deleteDoc(doc(db, COL_COMPRAS, id));
}

// ===== AUDITORIAS FECHADAS =====
// Cada auditoria fechada vira um documento em primus_auditorias
// ID fixo = `${modo}_${dataInicio}_${dataFim}` pra permitir "regravar" a mesma auditoria
// (se o gestor fechou e depois quer atualizar, sobrescreve)

const COL_AUDITORIAS = 'primus_auditorias';

/**
 * Salva (ou sobrescreve) uma auditoria fechada.
 * @param {object} dados - {
 *   modo: 'operacional'|'virada',
 *   dataInicio, dataFim,
 *   resultado: [...],  // array do resultadoAuditoria
 *   contexto: {...},   // dados brutos (contagens, totais)
 *   observacoes: string,
 *   responsavel: string,
 *   fechadoPor: {id, nome}
 * }
 */
export async function salvarAuditoriaFechada(dados) {
  const id = `${dados.modo}_${dados.dataInicio}_${dados.dataFim}`;
  await setDoc(doc(db, COL_AUDITORIAS, id), {
    ...dados,
    fechadoEm: serverTimestamp()
  });
  return id;
}

/** Busca uma auditoria fechada específica. Retorna null se não existir. */
export async function buscarAuditoriaFechada(modo, dataInicio, dataFim) {
  const id = `${modo}_${dataInicio}_${dataFim}`;
  const snap = await getDoc(doc(db, COL_AUDITORIAS, id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

/**
 * Lista todas as auditorias fechadas (opcional: filtra por modo e/ou período).
 * Retorna ordenadas por data desc.
 */
export async function listarAuditoriasFechadas({ modo = null, dataInicio = null, dataFim = null } = {}) {
  const snap = await getDocs(collection(db, COL_AUDITORIAS));
  const resultado = [];
  snap.forEach(d => {
    const v = d.data();
    if (modo && v.modo !== modo) return;
    if (dataInicio && v.dataFim < dataInicio) return;
    if (dataFim && v.dataInicio > dataFim) return;
    resultado.push({ id: d.id, ...v });
  });
  // Ordena por dataFim desc (mais recentes primeiro)
  resultado.sort((a, b) => (b.dataFim || '').localeCompare(a.dataFim || ''));
  return resultado;
}

/** Remove uma auditoria fechada (caso queira "reabrir"). */
export async function excluirAuditoriaFechada(id) {
  await deleteDoc(doc(db, COL_AUDITORIAS, id));
}

// ===== UTIL =====

/** Converte YYYY-MM-DD para objeto Date (local, não UTC) */
export function parseData(yyyymmdd) {
  const [y, m, d] = yyyymmdd.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Converte Date para YYYY-MM-DD (local) */
export function formatarData(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Data de hoje (local) como YYYY-MM-DD */
export function hoje() {
  return formatarData(new Date());
}
