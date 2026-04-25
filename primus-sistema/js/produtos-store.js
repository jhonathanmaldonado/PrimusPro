// ===== PRODUTOS-STORE — PRIMUS =====
// Camada que combina o catálogo base (produtos.js, fixo no código) com os
// overrides do gestor (Firestore, editáveis pelo painel) e expõe um
// "catálogo efetivo" único pro resto do sistema.
//
// Idempotente: a primeira chamada carrega do Firebase, as seguintes usam cache
// em memória até alguém chamar `invalidarCache()` (típico após uma edição).
//
// Compatibilidade:
//  - Enquanto a Etapa 2 não pluga este arquivo nos consumidores
//    (contagem.js, auditoria.js, etc), o sistema continua usando os
//    imports diretos de BEBIDAS/SORVETES de produtos.js.
//  - Este módulo é seguro de carregar sem efeitos colaterais.

import { BEBIDAS, SORVETES, slugify } from './produtos.js';
import {
  lerProdutosOverrides,
  salvarProdutosOverrides
} from './db.js';

// ===== CACHE EM MEMÓRIA =====

let _cacheOverrides = null;     // último snapshot lido do Firebase
let _cacheCarregadoEm = 0;      // timestamp do último load
let _promiseCarregando = null;  // dedup pra carregar 1x mesmo em N chamadas paralelas

/** Invalida o cache forçando próxima leitura ir ao Firebase. */
export function invalidarCache() {
  _cacheOverrides = null;
  _cacheCarregadoEm = 0;
  _promiseCarregando = null;
}

/**
 * Garante que os overrides estão carregados em memória.
 * Se já estão no cache, retorna instantâneo.
 * Se 2 chamadas concorrentes pedirem ao mesmo tempo, ambas esperam a mesma promise.
 */
async function garantirCarregado() {
  if (_cacheOverrides) return _cacheOverrides;
  if (_promiseCarregando) return _promiseCarregando;

  _promiseCarregando = (async () => {
    try {
      _cacheOverrides = await lerProdutosOverrides();
      _cacheCarregadoEm = Date.now();
      return _cacheOverrides;
    } catch (err) {
      console.error('[produtos-store] erro ao ler overrides:', err);
      // Em caso de erro, devolve estrutura vazia pra não quebrar o sistema.
      // O usuário vai ver só o catálogo base — comportamento atual de hoje.
      _cacheOverrides = {
        editados: {}, ocultos: [], saindo: [], novos: [], gruposNovos: []
      };
      return _cacheOverrides;
    } finally {
      _promiseCarregando = null;
    }
  })();

  return _promiseCarregando;
}

// ===== CATÁLOGO EFETIVO =====

/**
 * Aplica os overrides sobre uma lista de produtos do catálogo base.
 * Retorna uma nova lista (não muta o original).
 * Cada item devolvido tem um campo extra `_origem` com:
 *   - 'base'     → produto do catálogo (produtos.js), sem alteração
 *   - 'editado'  → produto do catálogo com edição aplicada
 *   - 'novo'     → produto adicionado pelo gestor (não está no produtos.js)
 * E um campo `_status`:
 *   - 'ativo'    → aparece normalmente
 *   - 'saindo'   → aparece com badge "saindo"
 *   - 'oculto'   → não aparece (filtrado por padrão; só se incluirOcultos=true)
 */
function aplicarOverrides(listaBase, overrides, tipo) {
  // tipo = 'bebidas' | 'sorvetes' (pra anexar os "novos" do tipo certo)
  const editados    = overrides.editados    || {};
  const ocultosSet  = new Set(overrides.ocultos || []);
  const saindoSet   = new Set(overrides.saindo  || []);
  const novos       = (overrides.novos || []).filter(n => (n._tipo || 'bebidas') === tipo);

  // 1) Mapeia o catálogo base aplicando edições + status
  const efetiva = listaBase.map(p => {
    const slug = slugify(p.nome);
    const edicao = editados[slug] || null;
    const merged = edicao ? { ...p, ...edicao } : { ...p };

    // Status: ocultos são filtrados depois, saindo ganha flag
    if (saindoSet.has(slug)) merged.saindo = true;

    merged._slug   = slug;
    merged._origem = edicao ? 'editado' : 'base';
    merged._status = ocultosSet.has(slug) ? 'oculto'
                   : (merged.saindo ? 'saindo' : 'ativo');
    return merged;
  });

  // 2) Adiciona os "novos" criados pelo gestor
  novos.forEach(n => {
    const slug = slugify(n.nome);
    efetiva.push({
      ...n,
      _slug: slug,
      _origem: 'novo',
      _status: ocultosSet.has(slug) ? 'oculto'
             : (saindoSet.has(slug) ? 'saindo' : 'ativo'),
      saindo: saindoSet.has(slug) || !!n.saindo
    });
  });

  return efetiva;
}

/**
 * Retorna o catálogo efetivo de bebidas (base + overrides).
 * Por padrão filtra ocultos. Passe `{ incluirOcultos: true }` na tela de
 * gerenciamento pra ver tudo (inclusive ocultos, pra reativar).
 */
export async function obterBebidas({ incluirOcultos = false } = {}) {
  const overrides = await garantirCarregado();
  const efetiva = aplicarOverrides(BEBIDAS, overrides, 'bebidas');
  return incluirOcultos ? efetiva : efetiva.filter(p => p._status !== 'oculto');
}

/**
 * Retorna o catálogo efetivo de sorvetes/embalagens (base + overrides).
 */
export async function obterSorvetes({ incluirOcultos = false } = {}) {
  const overrides = await garantirCarregado();
  const efetiva = aplicarOverrides(SORVETES, overrides, 'sorvetes');
  return incluirOcultos ? efetiva : efetiva.filter(p => p._status !== 'oculto');
}

/**
 * Lista todos os grupos disponíveis (do catálogo base + grupos novos do gestor).
 * Útil pra preencher o dropdown "Grupo" ao criar um produto novo.
 */
export async function obterGrupos(tipo = 'bebidas') {
  const overrides = await garantirCarregado();
  const lista = tipo === 'sorvetes' ? SORVETES : BEBIDAS;
  const gruposBase = [...new Set(lista.map(p => p.grupo))];
  const gruposExtras = overrides.gruposNovos || [];
  // Mantém ordem do catálogo base, adiciona extras no final
  return [...gruposBase, ...gruposExtras.filter(g => !gruposBase.includes(g))];
}

/** Busca um produto específico no catálogo efetivo (busca por slug). */
export async function buscarProduto(slug) {
  const beb = await obterBebidas({ incluirOcultos: true });
  const found = beb.find(p => p._slug === slug);
  if (found) return found;
  const sorv = await obterSorvetes({ incluirOcultos: true });
  return sorv.find(p => p._slug === slug) || null;
}

// ===== EDIÇÃO DE OVERRIDES =====
// Estas funções são as que a tela de Catálogo (Etapa 3) vai chamar.
// Cada uma carrega o estado atual, modifica e salva de volta.

/**
 * Edita campos de um produto do catálogo base.
 * Ex: editarProduto('coca_cola_ks', { porCaixa: 12, fornecedor: 'AMBEV' })
 *
 * Só funciona pra produtos que existem no catálogo BASE. Pra produtos novos,
 * use editarProdutoNovo (que altera diretamente a entrada da lista `novos`).
 */
export async function editarProduto(slug, alteracoes) {
  const overrides = await garantirCarregado();
  const atual = overrides.editados[slug] || {};
  overrides.editados = {
    ...overrides.editados,
    [slug]: { ...atual, ...alteracoes }
  };
  await salvarProdutosOverrides(overrides);
  invalidarCache();
}

/** Remove a edição de um produto, voltando ao valor do catálogo base. */
export async function resetarEdicao(slug) {
  const overrides = await garantirCarregado();
  if (overrides.editados[slug]) {
    delete overrides.editados[slug];
    overrides.editados = { ...overrides.editados };
    await salvarProdutosOverrides(overrides);
    invalidarCache();
  }
}

/**
 * Marca um produto como oculto (some completamente das contagens).
 * Funciona tanto pra produtos do catálogo base quanto pra produtos novos.
 */
export async function ocultarProduto(slug) {
  const overrides = await garantirCarregado();
  const set = new Set(overrides.ocultos || []);
  set.add(slug);
  // Se estava marcado como saindo, remove (oculto e saindo são exclusivos)
  const setSaindo = new Set(overrides.saindo || []);
  setSaindo.delete(slug);
  overrides.ocultos = [...set];
  overrides.saindo  = [...setSaindo];
  await salvarProdutosOverrides(overrides);
  invalidarCache();
}

/** Reativa um produto que estava oculto. */
export async function reativarProduto(slug) {
  const overrides = await garantirCarregado();
  const set = new Set(overrides.ocultos || []);
  set.delete(slug);
  overrides.ocultos = [...set];
  await salvarProdutosOverrides(overrides);
  invalidarCache();
}

/**
 * Marca um produto como "saindo" (continua aparecendo, mas com badge visual).
 * Útil pra produtos em descontinuação que ainda têm estoque restante.
 */
export async function marcarSaindo(slug) {
  const overrides = await garantirCarregado();
  const set = new Set(overrides.saindo || []);
  set.add(slug);
  // Se estava oculto, remove (não pode estar nos dois)
  const setOcultos = new Set(overrides.ocultos || []);
  setOcultos.delete(slug);
  overrides.saindo  = [...set];
  overrides.ocultos = [...setOcultos];
  await salvarProdutosOverrides(overrides);
  invalidarCache();
}

/** Remove a marca de "saindo" de um produto. */
export async function desmarcarSaindo(slug) {
  const overrides = await garantirCarregado();
  const set = new Set(overrides.saindo || []);
  set.delete(slug);
  overrides.saindo = [...set];
  await salvarProdutosOverrides(overrides);
  invalidarCache();
}

/**
 * Adiciona um produto novo (não estava no catálogo base).
 * @param {object} produto - { nome, grupo, fornecedor?, unidCompra?, porCaixa?, ks? }
 * @param {'bebidas'|'sorvetes'} tipo - em qual lista entra
 * @returns {string} slug do produto criado
 * @throws se o slug já existir (no catálogo base ou em outro produto novo)
 */
export async function adicionarProduto(produto, tipo = 'bebidas') {
  if (!produto?.nome || !produto?.grupo) {
    throw new Error('Nome e grupo são obrigatórios.');
  }
  const slug = slugify(produto.nome);

  // Valida conflito
  const existente = await buscarProduto(slug);
  if (existente) {
    throw new Error(`Já existe um produto com esse nome (slug: ${slug}).`);
  }

  const overrides = await garantirCarregado();
  overrides.novos = [
    ...(overrides.novos || []),
    { ...produto, _tipo: tipo }
  ];
  await salvarProdutosOverrides(overrides);
  invalidarCache();
  return slug;
}

/**
 * Edita os campos de um produto novo (criado pelo gestor).
 * Pra produtos do catálogo base, use editarProduto.
 */
export async function editarProdutoNovo(slug, alteracoes) {
  const overrides = await garantirCarregado();
  const idx = (overrides.novos || []).findIndex(n => slugify(n.nome) === slug);
  if (idx < 0) throw new Error('Produto novo não encontrado.');

  // Se mudou o nome, o slug muda também — precisa validar conflito
  if (alteracoes.nome && slugify(alteracoes.nome) !== slug) {
    const novoSlug = slugify(alteracoes.nome);
    const conflito = await buscarProduto(novoSlug);
    if (conflito) throw new Error(`Já existe um produto com esse nome.`);
  }

  overrides.novos = [...overrides.novos];
  overrides.novos[idx] = { ...overrides.novos[idx], ...alteracoes };
  await salvarProdutosOverrides(overrides);
  invalidarCache();
}

/**
 * Exclui um produto novo permanentemente.
 * ATENÇÃO: só funciona pra produtos novos (criados pelo gestor).
 * Pra "remover" um produto do catálogo base, use ocultarProduto.
 */
export async function excluirProdutoNovo(slug) {
  const overrides = await garantirCarregado();
  overrides.novos = (overrides.novos || []).filter(n => slugify(n.nome) !== slug);
  // Limpa também das listas de oculto/saindo se estiver lá
  overrides.ocultos = (overrides.ocultos || []).filter(s => s !== slug);
  overrides.saindo  = (overrides.saindo  || []).filter(s => s !== slug);
  await salvarProdutosOverrides(overrides);
  invalidarCache();
}

/** Adiciona um grupo/categoria novo (pra usar em produtos novos). */
export async function adicionarGrupo(nomeGrupo) {
  if (!nomeGrupo?.trim()) throw new Error('Nome do grupo é obrigatório.');
  const overrides = await garantirCarregado();
  const set = new Set(overrides.gruposNovos || []);
  set.add(nomeGrupo.trim());
  overrides.gruposNovos = [...set];
  await salvarProdutosOverrides(overrides);
  invalidarCache();
}

/**
 * Remove um grupo novo. Não permite remover se houver produtos novos
 * usando esse grupo (evita produtos órfãos).
 */
export async function removerGrupo(nomeGrupo) {
  const overrides = await garantirCarregado();
  const emUso = (overrides.novos || []).some(n => n.grupo === nomeGrupo);
  if (emUso) {
    throw new Error('Há produtos novos usando este grupo. Mova-os antes de remover.');
  }
  overrides.gruposNovos = (overrides.gruposNovos || []).filter(g => g !== nomeGrupo);
  await salvarProdutosOverrides(overrides);
  invalidarCache();
}

// ===== DEBUG/INSPEÇÃO =====
// Útil pra verificar o estado atual no console do navegador.
// Em produção: window.__primusOverrides() pra ver o snapshot atual.
if (typeof window !== 'undefined') {
  window.__primusOverrides = async () => {
    invalidarCache();
    return await garantirCarregado();
  };
}
