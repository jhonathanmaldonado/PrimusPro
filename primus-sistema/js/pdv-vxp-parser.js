// ===== PARSER: Relatório Vendedor × Produto (Primus) =====
// Formato esperado do PDV:
//   Itens vendidos
//   vendedor\tquantidade\tsubtotal\tacrescimo\tdesconto\ttotal
//   NOME VENDEDOR\t90,000\t3.327,00\t...          (linha de vendedor)
//   000023 - PEIXADA CUIABANA\t1,000\t200,00\t... (linha de produto desse vendedor)
//   ...repete o padrão vendedor → produtos...
//   itens: 9       (rodapé — ignorado)
//   total: 30.218,80

function parseNum(s) {
  if (!s) return 0;
  // Formato BR: 3.327,00 → 3327.00
  return parseFloat(String(s).replace(/\./g, '').replace(',', '.')) || 0;
}

export function parseVendedorXProduto(texto) {
  const linhas = texto.split('\n').map(l => l.trim()).filter(Boolean);
  const vendedores = [];
  let vendedorAtual = null;
  let iniciou = false;

  for (const linha of linhas) {
    // Pula cabeçalhos
    if (linha.startsWith('Itens vendidos')) { iniciou = true; continue; }
    if (linha.toLowerCase().startsWith('vendedor\t')) continue;

    // Pula rodapés: "itens: 9", "subtotal: ...", "total: ..."
    if (linha.match(/^\s*(itens|subtotal|acrescimos|descontos|total):\s*/i)) continue;

    if (!iniciou) continue;

    const cols = linha.split('\t');
    if (cols.length < 6) continue;

    const [col1, qtd, subtotal, acrescimo, desconto, total] = cols;

    // Linha de produto começa com "000XXX - NOME"
    const matchProduto = col1.match(/^(\d+)\s*-\s*(.+)$/);

    if (matchProduto) {
      // Linha de produto
      if (!vendedorAtual) continue; // produto sem vendedor? ignora
      vendedorAtual.produtos.push({
        codigo: matchProduto[1].trim(),
        nome: matchProduto[2].trim(),
        qtd: parseNum(qtd),
        total: parseNum(total)
      });
    } else {
      // Linha de vendedor
      vendedorAtual = {
        nome: col1.trim(),
        totalQtd: parseNum(qtd),
        total: parseNum(total),
        produtos: []
      };
      vendedores.push(vendedorAtual);
    }
  }

  return vendedores;
}

// Valida o parsing retornando estatísticas úteis
export function validarParse(vendedores) {
  const totalVend = vendedores.reduce((s,v) => s + v.total, 0);
  const totalProds = vendedores.reduce(
    (s,v) => s + v.produtos.reduce((ss,p) => ss + p.total, 0),
    0
  );
  const diff = Math.abs(totalVend - totalProds);

  return {
    vendedores: vendedores.length,
    totalVendedores: totalVend,
    totalProdutos: totalProds,
    diferenca: diff,
    consistente: diff < 0.01
  };
}
