// ===== CATÁLOGO DE PRODUTOS — PRIMUS =====
// Centraliza todos os produtos em um só lugar.
// Usado por: contagem, lista de compras, dashboard.
//
// Campos:
//   nome       - nome de exibição
//   grupo      - categoria de UI (com emoji)
//   fornecedor - nome EXATO do fornecedor (LOUVADA, AMBEV, SOLAR+, PRATA, JONG) ou null
//   unidCompra - como o fornecedor entrega: 'caixa' ou 'fardo' (null = unidade avulsa)
//   porCaixa   - quantas unidades tem na caixa/fardo (default 1)
//   saindo     - true se é produto em descontinuação (preservar só enquanto tiver venda)
//   ks         - true se é KS (lata pequena)

export const BEBIDAS = [
  // ---------- CERVEJAS ----------
  { nome:'Louvada Primus',          grupo:'🍺 Cervejas', fornecedor:'LOUVADA', unidCompra:'caixa', porCaixa:12 },
  { nome:'Heineken 600ml',          grupo:'🍺 Cervejas', fornecedor:'SOLAR+',  unidCompra:'caixa', porCaixa:24 },
  { nome:'Original',                grupo:'🍺 Cervejas', fornecedor:'AMBEV',   unidCompra:'caixa', porCaixa:24 },
  { nome:'Heineken Zero Long Neck', grupo:'🍺 Cervejas', fornecedor:'SOLAR+',  unidCompra:'caixa', porCaixa:12 },
  { nome:'Louvada German',          grupo:'🍺 Cervejas', fornecedor:'LOUVADA', unidCompra:'caixa', porCaixa:12 },
  { nome:'Louvada Hop Zero',        grupo:'🍺 Cervejas', fornecedor:'LOUVADA', unidCompra:'caixa', porCaixa:12 },
  { nome:'Stella SG Longneck',      grupo:'🍺 Cervejas', fornecedor:'AMBEV',   unidCompra:'caixa', porCaixa:24 },

  // ---------- REFRIGERANTES KS ----------
  { nome:'Coca Cola KS',            grupo:'🔷 Refrigerantes KS', fornecedor:'SOLAR+', unidCompra:'caixa', porCaixa:24, ks:true },
  { nome:'Coca Cola KS Zero',       grupo:'🔷 Refrigerantes KS', fornecedor:'SOLAR+', unidCompra:'caixa', porCaixa:24, ks:true },
  { nome:'Fanta Laranja KS',        grupo:'🔷 Refrigerantes KS', fornecedor:'SOLAR+', unidCompra:'caixa', porCaixa:24, ks:true },
  { nome:'Sprite KS',               grupo:'🔷 Refrigerantes KS', fornecedor:'SOLAR+', unidCompra:'caixa', porCaixa:24, ks:true },
  { nome:'Kuat KS',                 grupo:'🔷 Refrigerantes KS', fornecedor:'SOLAR+', unidCompra:'caixa', porCaixa:24, ks:true },

  // ---------- REFRIGERANTES LATA ----------
  { nome:'Coca Cola Lata',          grupo:'🥤 Refrigerantes', fornecedor:'SOLAR+', unidCompra:'caixa', porCaixa:12 },
  { nome:'Coca Cola Zero Lata',     grupo:'🥤 Refrigerantes', fornecedor:'SOLAR+', unidCompra:'fardo', porCaixa:6  },
  { nome:'Fanta Laranja Lata',      grupo:'🥤 Refrigerantes', fornecedor:'SOLAR+', unidCompra:'fardo', porCaixa:6  },

  // ---------- ESPECIAIS ----------
  { nome:'Água Tônica',             grupo:'💧 Especiais', fornecedor:'AMBEV',   unidCompra:'fardo', porCaixa:12 },
  { nome:'Schweppes Citrus',        grupo:'💧 Especiais', fornecedor:'SOLAR+',  unidCompra:'fardo', porCaixa:6  },
  { nome:'Sprite Lemon Fresch',     grupo:'💧 Especiais', fornecedor:'SOLAR+',  unidCompra:'fardo', porCaixa:6  },

  // ---------- ÁGUAS ----------
  { nome:'Água Prata Com Gás',      grupo:'💧 Águas', fornecedor:'PRATA',  unidCompra:'caixa', porCaixa:24 },
  { nome:'Água Prata Sem Gás',      grupo:'💧 Águas', fornecedor:'PRATA',  unidCompra:'caixa', porCaixa:24 },
  { nome:'Água Premium Com Gás',    grupo:'💧 Águas', fornecedor:'SOLAR+', unidCompra:'fardo', porCaixa:12 },
  { nome:'Água Premium Sem Gás',    grupo:'💧 Águas', fornecedor:'SOLAR+', unidCompra:'fardo', porCaixa:12 },

  // ---------- KOMBUCHAS ----------
  { nome:'Kombucha Guaraná',        grupo:'🌿 Kombuchas', fornecedor:'JONG', unidCompra:'caixa', porCaixa:12 },
  { nome:'Kombucha Morango',        grupo:'🌿 Kombuchas', fornecedor:'JONG', unidCompra:'caixa', porCaixa:12 },
  { nome:'Kombucha de Limão',       grupo:'🌿 Kombuchas', fornecedor:'JONG', unidCompra:'caixa', porCaixa:12 },

  // ---------- CAFÉS (sem fornecedor cadastrado ainda) ----------
  { nome:'Cappuccino',              grupo:'☕ Cafés', fornecedor:null },
  { nome:'Café Ameno',              grupo:'☕ Cafés', fornecedor:null },
  { nome:'Café Forza',              grupo:'☕ Cafés', fornecedor:null },
  { nome:'Café Gourmet',            grupo:'☕ Cafés', fornecedor:null },

  // ---------- SUCOS 500ML (sem fornecedor cadastrado ainda) ----------
  { nome:'Suco Acerola 500ml',      grupo:'🧃 Sucos 500ml', fornecedor:null },
  { nome:'Suco Abacaxi Hort. 500ml',grupo:'🧃 Sucos 500ml', fornecedor:null },
  { nome:'Suco Maracujá 500ml',     grupo:'🧃 Sucos 500ml', fornecedor:null },
  { nome:'Suco Morango 500ml',      grupo:'🧃 Sucos 500ml', fornecedor:null },
];

export const SORVETES = [
  { nome:'Sorbet Moranja',                  grupo:'🍨 Sorbets' },
  { nome:'Sorbet Manga+Maracujá',           grupo:'🍨 Sorbets' },
  { nome:'Sorbet Frutas Vermelhas',         grupo:'🍨 Sorbets' },
  { nome:'Gelato Doce de Leite',            grupo:'🍦 Gelatos' },
  { nome:'Gelato Chocolatudo',              grupo:'🍦 Gelatos' },
  { nome:'Gelato Iogurte+Frutas Amarelas',  grupo:'🍦 Gelatos' },
  { nome:'Gelato Cacau com Laranja 0%',     grupo:'🍦 Gelatos' },
  { nome:'Gelato Ninho Trufado',            grupo:'🍦 Gelatos' },
  { nome:'Gelato Paçoca Proteica',          grupo:'🍦 Gelatos' },
  { nome:'Chocolate Proteico',              grupo:'🍦 Gelatos' },
  { nome:'Gelato Cookie e Crean Proteico',  grupo:'🍦 Gelatos' },
  { nome:'Embalagem P',                     grupo:'📦 Embalagens' },
  { nome:'Embalagem M',                     grupo:'📦 Embalagens' },
  { nome:'Embalagem G',                     grupo:'📦 Embalagens' },
  { nome:'Kit Festa',                       grupo:'📦 Embalagens' },
  { nome:'Espátula Descartável',            grupo:'📦 Embalagens' },
];

// ===== FORNECEDORES PADRÃO (seed na primeira vez) =====
// Usados pra pré-cadastrar automaticamente. Depois o gestor pode editar.
export const FORNECEDORES_PADRAO = [
  { id:'louvada', nome:'LOUVADA', telefone:'' },
  { id:'ambev',   nome:'AMBEV',   telefone:'' },
  { id:'solar',   nome:'SOLAR+',  telefone:'' },
  { id:'prata',   nome:'PRATA',   telefone:'' },
  { id:'jong',    nome:'JONG',    telefone:'' },
];

// ===== UTIL =====

export function slugify(s) {
  return s.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Converte uma quantidade em unidades para o texto "= N caixas/fardos (+ resto)".
 * Retorna string vazia se não tiver unidade de compra definida ou se caixas = 0.
 */
export function converterParaCaixas(qtd, produto) {
  if (!produto?.unidCompra || !produto?.porCaixa || produto.porCaixa <= 1) return '';
  if (qtd <= 0) return '';
  const caixas = Math.floor(qtd / produto.porCaixa);
  const resto  = qtd % produto.porCaixa;
  const unidade = produto.unidCompra === 'fardo' ? 'fardo' : 'caixa';
  const pluralUnidade = unidade + (caixas === 1 ? '' : 's');
  if (caixas === 0) return '';
  if (resto === 0)   return `= ${caixas} ${pluralUnidade}`;
  return `= ${caixas} ${pluralUnidade} + ${resto} un`;
}

/**
 * Arredonda uma quantidade sugerida para cima em múltiplos da caixa/fardo.
 * Torna a sugestão mais prática (você compra caixa cheia, não 87 unidades).
 */
export function arredondarParaCaixaCheia(qtd, produto) {
  if (!produto?.unidCompra || !produto?.porCaixa || produto.porCaixa <= 1) return qtd;
  if (qtd <= 0) return 0;
  return Math.ceil(qtd / produto.porCaixa) * produto.porCaixa;
}

/** Busca um produto do catálogo pelo slug (em BEBIDAS + SORVETES) */
export function buscarProdutoPorSlug(slug) {
  return [...BEBIDAS, ...SORVETES].find(p => slugify(p.nome) === slug);
}
