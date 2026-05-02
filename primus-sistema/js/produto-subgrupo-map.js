// ===== TABELA PRODUTO → SUBGRUPO (Primus) =====
// Mapeamento OFICIAL extraído do GESTOR FOOD.
// Quando você criar/renomear produtos no PDV, atualize esta tabela aqui.
//
// IMPORTANTE: o sistema usa "slugify" pra fazer match — não importa
// se o nome no PDV vier em maiúscula, com acento ou com pontuação.
// O lookup é normalizado.
//
// Última atualização: 01/05/2026 (snapshot completo do PDV).

export const PRODUTO_SUBGRUPO = {

  // ========== CAFE ESPRESSO ==========
  'CAFE - AMENO':                    'CAFE ESPRESSO',
  'CAFE - FORZA':                    'CAFE ESPRESSO',
  'CAFE GOURMET':                    'CAFE ESPRESSO',
  'CAPPUCCINO':                      'CAFE ESPRESSO',

  // ========== CERVEJAS ==========
  'HEINEKEN 600ML':                  'CERVEJAS',
  'HEINEKEN ZERO LONG NECK':         'CERVEJAS',
  'LOUVADA HOP ZERO':                'CERVEJAS',
  'LOUVADA HOPE LAGER LONGNECK':     'CERVEJAS',
  'LOUVADA PRIMUS':                  'CERVEJAS',
  'ORIGINAL':                        'CERVEJAS',
  'STELLA SG LONGNECK':              'CERVEJAS',

  // ========== DIVERSOS ==========
  'EMBALAGEM G':                     'DIVERSOS',
  'EMBALAGEM M':                     'DIVERSOS',
  'EMBALAGEM P':                     'DIVERSOS',
  'EMBALAGEM SELADA':                'DIVERSOS',
  'ESPATULA DESCARTAVEL':            'DIVERSOS',
  'KIT FESTA':                       'DIVERSOS',
  'PASSAPORT KIDS':                  'DIVERSOS',

  // ========== DOSES ==========
  'CDB':                             'DOSES',
  'COPO CUZUMEL':                    'DOSES',
  'COPO DE GELO':                    'DOSES',
  'DOSE CACHACA':                    'DOSES',
  'DOSE CAMPARI':                    'DOSES',
  'DOSE LICOR':                      'DOSES',
  'DOSE VODKA':                      'DOSES',
  'SHOT LIMAO':                      'DOSES',

  // ========== DRINKS ==========
  'APEROL SPRITZ':                   'DRINKS',
  'CAIPIRINHA FRUTAS VERMELHAS':     'DRINKS',
  'CAIPIRINHA KIWI':                 'DRINKS',
  'CAIPIRINHA LIMAO':                'DRINKS',
  'CAIPIRINHA MORANGO':              'DRINKS',
  'CAIPIROSKA FRUTAS VERMELHAS':     'DRINKS',
  'CAIPIROSKA KIWI':                 'DRINKS',
  'CAIPIROSKA LIMAO':                'DRINKS',
  'CAIPIROSKA MORANGO':              'DRINKS',
  'CAIPIROSKA PRIMUS':               'DRINKS',
  'GIN FRUTAS VERMELHAS':            'DRINKS',
  'GIN KIWI':                        'DRINKS',
  'GIN MORANGO':                     'DRINKS',
  'GIN TONICA TRADICIONAL':          'DRINKS',
  'SODA ITALIANA MACA VERDE':        'DRINKS',
  'SODA ITALIANA MORANGO':           'DRINKS',
  'TAXA DE ROLHA':                   'DRINKS',

  // ========== ENTRADAS ==========
  'BATATA FRITA':                    'ENTRADAS',
  'BOLINHO DE PEIXE':                'ENTRADAS',
  'CALDO DE PEIXE':                  'ENTRADAS',
  'COSTELINHA DE TAMBATINGA':        'ENTRADAS',
  'CROQUETE DE MANDIOCA':            'ENTRADAS',
  'MIX DE PETISCOS':                 'ENTRADAS',
  'MOJIQUINHA':                      'ENTRADAS',
  'PASTEL DE CARNE':                 'ENTRADAS',
  'PASTEL DE PEIXE':                 'ENTRADAS',
  'PINTADO A PALITO':                'ENTRADAS',
  'PORCAO DE VENTRECHA (05 UNID.)':  'ENTRADAS',

  // ========== ESPECIALIDADES DA CASA ==========
  '1/2 PEIXADA CUIABANA':            'ESPECIALIDADES DA CASA',
  '1/2 PEIXADA ESPECIAL':            'ESPECIALIDADES DA CASA',
  '1/2 PEIXADA PRIMUS':              'ESPECIALIDADES DA CASA',
  '1/2 PEIXADA SO FILE':             'ESPECIALIDADES DA CASA',
  'PEIXADA CUIABANA INTEIRA':        'ESPECIALIDADES DA CASA',
  'PEIXADA ESPECIAL':                'ESPECIALIDADES DA CASA',
  'PEIXADA PRIMUS INTEIRA':          'ESPECIALIDADES DA CASA',
  'PEIXADA SO FILE INTEIRA':         'ESPECIALIDADES DA CASA',

  // ========== GUARNICOES ==========
  'ARROZ BRANCO':                    'GUARNICOES',
  'BANANA DA TERRA FRITA':           'GUARNICOES',
  'FAROFA CROCANTE':                 'GUARNICOES',
  'FAROFA DE BANANA':                'GUARNICOES',
  'FEIJAO DE VO':                    'GUARNICOES',
  'PIRAO DA CASA':                   'GUARNICOES',
  'UNIDADE DE FILE FRITO':           'GUARNICOES',
  'UNIDADE DE FILE GRELHADO':        'GUARNICOES',
  'UNIDADE DE VENTRECHA':            'GUARNICOES',
  'VINAGRETE DA CASA':               'GUARNICOES',

  // ========== PRATOS COMPARTILHADOS ==========
  '1/2 ESCABECHE DE VENTRECHA':      'PRATOS COMPARTILHADOS',
  '1/2 FILE E MOJICA':               'PRATOS COMPARTILHADOS',
  '1/2 VENTRECHA E FILE':            'PRATOS COMPARTILHADOS',
  '1/2 VENTRECHA E MOJICA':          'PRATOS COMPARTILHADOS',
  'ESCABECHE DE VENTRECHA':          'PRATOS COMPARTILHADOS',
  'FILE E MOJICA INTEIRA':           'PRATOS COMPARTILHADOS',
  'VENTRECHA E FILE INTEIRA':        'PRATOS COMPARTILHADOS',
  // Combinado é o mesmo prato com nome diferente em alguns relatórios:
  'COMBINADO VENTRECHA E FILE INTEIRA': 'PRATOS COMPARTILHADOS',
  'VENTRECHA E MOJICA INTEIRA':      'PRATOS COMPARTILHADOS',

  // ========== PRATOS INDIVIDUAIS ==========
  'FILE MIGNON FIT':                 'PRATOS INDIVIDUAIS',
  'INDIVIDUAL ESPECIAL':             'PRATOS INDIVIDUAIS',
  'INDIVIDUAL FILE PINT. FRITO':     'PRATOS INDIVIDUAIS',
  'INDIVIDUAL FILE PINTADO GRELHA':  'PRATOS INDIVIDUAIS',
  'INDIVIDUAL FRANGO GRELHADO':      'PRATOS INDIVIDUAIS',
  'INDIVIDUAL MOJICA DE PINTADO':    'PRATOS INDIVIDUAIS',
  'INDIVIDUAL PINTADO PARMEGIANA':   'PRATOS INDIVIDUAIS',
  // Variação: o relatório "PRODUTO" pode trazer "INDIVIDUAL PINTADO A PARMEGIANA" (com "A").
  // Mantemos as duas grafias mapeadas pro mesmo subgrupo.
  'INDIVIDUAL PINTADO A PARMEGIANA': 'PRATOS INDIVIDUAIS',
  'INDIVIDUAL VENTRECHA':            'PRATOS INDIVIDUAIS',
  'MOQUECA DE BANANA':               'PRATOS INDIVIDUAIS',
  'PICADINHO DE FILE MIGNON':        'PRATOS INDIVIDUAIS',

  // ========== PRATOS KIDS ==========
  'FILE MIGNON KIDS':                'PRATOS KIDS',
  'KIDS DE FRANGO':                  'PRATOS KIDS',
  'KIDS DE PINTADO':                 'PRATOS KIDS',
  'PICADINHO KIDS':                  'PRATOS KIDS',

  // ========== REFRIGERANTES E SUCOS ==========
  'AGUA PRATA COM GAS':              'REFRIGERANTES E SUCOS',
  'AGUA PRATA SEM GAS':              'REFRIGERANTES E SUCOS',
  'AGUA PREMIUM COM GAS':            'REFRIGERANTES E SUCOS',
  'AGUA PREMIUM SEM GAS':            'REFRIGERANTES E SUCOS',
  'AGUA TONICA':                     'REFRIGERANTES E SUCOS',
  'AGUA TONICA ZERO':                'REFRIGERANTES E SUCOS',
  'CHA GELADO LARANJA':              'REFRIGERANTES E SUCOS',
  'CHA GELADO LIMAO':                'REFRIGERANTES E SUCOS',
  'COCA COLA KS':                    'REFRIGERANTES E SUCOS',
  'COCA COLA KS ZERO':               'REFRIGERANTES E SUCOS',
  'COCA COLA LATA':                  'REFRIGERANTES E SUCOS',
  'COCA COLA ZERO LATA':             'REFRIGERANTES E SUCOS',
  'FANTA LARANJA KS':                'REFRIGERANTES E SUCOS',
  'FANTA LARANJA LATA':              'REFRIGERANTES E SUCOS',
  'KOMBUCHA DE LIMAO':               'REFRIGERANTES E SUCOS',
  'KOMBUCHA GUARANA':                'REFRIGERANTES E SUCOS',
  'KOMBUCHA MORANGO':                'REFRIGERANTES E SUCOS',
  'KUAT KS':                         'REFRIGERANTES E SUCOS',
  'SCHWEPPES CITRUS':                'REFRIGERANTES E SUCOS',
  'SPRITE KS':                       'REFRIGERANTES E SUCOS',
  'SPRITE LATA':                     'REFRIGERANTES E SUCOS',
  'SPRITE LEMON FRESCH':             'REFRIGERANTES E SUCOS',
  'SUCO ABACAXI HORT. 500ML':        'REFRIGERANTES E SUCOS',
  'SUCO ACEROLA 500ML':              'REFRIGERANTES E SUCOS',
  'SUCO LARANJA 500ML':              'REFRIGERANTES E SUCOS',
  'SUCO LIMAO 500ML':                'REFRIGERANTES E SUCOS',
  'SUCO MARACUJA 500ML':             'REFRIGERANTES E SUCOS',
  'SUCO MORANGO 500ML':              'REFRIGERANTES E SUCOS',
  'SUCO MORANGO C LARANJA':          'REFRIGERANTES E SUCOS',

  // ========== SALADAS ==========
  'SALADA VERDE':                    'SALADAS',

  // ========== SOBREMESAS ==========
  'BROWNIE ANIVERSARIANTE':          'SOBREMESAS',
  'BROWNIE DE CHOCOLATE':            'SOBREMESAS',

  // ========== SORVETES ==========
  'CHOCOLATE PROTEICO':              'SORVETES',
  'GELATO CHOCOLATUDO':              'SORVETES',
  'GELATO DOCE DE LEITE':            'SORVETES',
  'GELATO NINHO TRUFADO':            'SORVETES',
  'GELATO PACOCA PROTEICA':          'SORVETES',
  'IOGURTE COM FRUTAS VERMELHAS':    'SORVETES',
  'SORBET MANGA + MARACUJA':         'SORVETES',
  'SORBET MORANJA':                  'SORVETES',

  // ========== SUGESTOES DO CHEFE ==========
  '1/2 FILE DE PINTADO':             'SUGESTOES DO CHEFE',
  '1/2 PINTADO A PARMEGIANA':        'SUGESTOES DO CHEFE',
  '1/2 PINTADO GRELHADO':            'SUGESTOES DO CHEFE',
  '1/2 VENTRECHA FRITA':             'SUGESTOES DO CHEFE',
  'FILE DE PINTADO INTEIRO':         'SUGESTOES DO CHEFE',
  'PINTADO A PARMEGIANA INTEIRA':    'SUGESTOES DO CHEFE',
  'PINTADO GRELHADO INTEIRA':        'SUGESTOES DO CHEFE',
  'VENTRECHA FRITA INTEIRA':         'SUGESTOES DO CHEFE',
};

/**
 * Helper de slugify (cópia da do produtos.js — mantida aqui pra não criar dependência circular).
 */
function _slug(s) {
  return (s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// Pré-computa o mapa de slugs → subgrupo (tolera variações de caixa/acento/etc)
const _MAPA_SLUG_SUBGRUPO = (() => {
  const m = {};
  Object.entries(PRODUTO_SUBGRUPO).forEach(([nome, sg]) => {
    m[_slug(nome)] = sg;
  });
  return m;
})();

/**
 * Busca o subgrupo oficial de um produto pelo nome.
 * Tolerante a variações de caixa/acento. Retorna null se o produto
 * não estiver na tabela (chamador pode então usar fallback heurístico).
 */
export function buscarSubgrupoOficial(nomeProduto) {
  const slug = _slug(nomeProduto);
  return _MAPA_SLUG_SUBGRUPO[slug] || null;
}
