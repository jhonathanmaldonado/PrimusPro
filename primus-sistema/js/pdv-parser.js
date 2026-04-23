// ===== PARSER DO TXT DO PDV — PRIMUS =====
// Converte o relatório de vendas do PDV (formato tabulado) em um objeto estruturado
// Seções esperadas: TURNO, CAIXA, VENDEDOR, GRUPO, SUBGRUPO, PRODUTO, DIA (hora)

/**
 * Parseia o conteúdo bruto do TXT do PDV
 * @param {string} texto - Conteúdo do arquivo
 * @returns {object} { data, totais, turnos, caixas, vendedores, operadores, grupos, subgrupos, produtos, horas }
 */
export function parsePdvTxt(texto) {
  if (!texto || typeof texto !== 'string') {
    throw new Error('Conteúdo do arquivo vazio ou inválido.');
  }

  // Normaliza line endings
  const linhas = texto.replace(/\r\n/g, '\n').split('\n').filter(l => l.trim());

  // Resultado final
  const resultado = {
    data: null,           // YYYY-MM-DD
    totais: null,         // { qtd, subtotal, acrescimo, desconto, total }
    turnos: [],           // [{ nome, qtd, subtotal, acrescimo, desconto, total }]
    caixas: [],
    vendedores: [],       // só os vendedores nomeados (exclui OPERADORES)
    operadores: null,     // linha OPERADORES separada
    grupos: [],
    subgrupos: [],
    produtos: [],
    horas: [],            // [{ faixa, qtd, subtotal, acrescimo, desconto, total }]
  };

  // Cabeçalhos que identificam o início de cada seção
  // Eles vêm exatamente como no TXT: "TURNO\tQUANTIDADE\tSUBTOTAL\tACRESCIMO\tDESCONTO\tTOTAL"
  const cabecalhos = {
    'TURNO':     'turno',
    'CAIXA':     'caixa',
    'VENDEDOR':  'vendedor',
    'GRUPO':     'grupo',
    'SUBGRUPO':  'subgrupo',
    'PRODUTO':   'produto',
    'DIA':       'dia',
  };

  let secaoAtual = null;       // qual seção estamos processando
  let itemAtual = null;        // item em construção (precisa de 2 linhas: dados + data de referência)

  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i];
    const cols = linha.split('\t').map(c => c.trim());

    // Ignora linhas de rodapé totalizadoras ("qtd:", "subtotal:", etc.)
    if (/^\s*(qtd|subtotal|acrescimos|descontos|total)\s*:/i.test(linha)) {
      continue;
    }

    // Detecta cabeçalho de seção: primeira coluna é nome de seção e segunda é "QUANTIDADE"
    const primeiraCol = cols[0]?.toUpperCase();
    if (cabecalhos[primeiraCol] && cols[1]?.toUpperCase() === 'QUANTIDADE') {
      secaoAtual = cabecalhos[primeiraCol];
      itemAtual = null;
      continue;
    }

    if (!secaoAtual) continue;

    // Processa linha conforme a seção
    if (secaoAtual === 'dia') {
      processarLinhaDia(cols, resultado);
    } else {
      itemAtual = processarLinhaSecao(cols, secaoAtual, resultado, itemAtual);
    }
  }

  // Se não conseguiu detectar a data ainda, procura no campo turno
  if (!resultado.data && resultado.turnos.length > 0) {
    // Não achou data, deixa null mesmo
  }

  if (!resultado.totais) {
    throw new Error('Não foi possível extrair os totais. Arquivo tem formato esperado?');
  }

  return resultado;
}

/**
 * Processa linha de uma seção normal (turno, caixa, vendedor, grupo, subgrupo, produto)
 * Cada item ocupa 2 linhas consecutivas: primeira com o nome + valores, segunda com a data + mesmos valores
 */
function processarLinhaSecao(cols, secao, resultado, itemAtual) {
  if (cols.length < 6) return null;

  const primeiraCol = cols[0];
  if (!primeiraCol) return null;

  // Se a primeira coluna for uma data (DD/MM/AAAA), é a linha-filha do item anterior
  if (ehData(primeiraCol)) {
    if (itemAtual) {
      // Extrai a data para o resultado global se ainda não tem
      if (!resultado.data) {
        resultado.data = dataBrParaIso(primeiraCol);
      }
      // Finaliza o item: já está com valores da linha pai, só descarta linha filha
      return null;
    }
    return null;
  }

  // Linha nova de item
  const valores = extrairValores(cols);
  if (!valores) return null;

  const item = {
    nome: primeiraCol,
    ...valores
  };

  // Separa OPERADORES em seção própria se for vendedor
  if (secao === 'vendedor') {
    if (primeiraCol.toUpperCase() === 'OPERADORES') {
      resultado.operadores = item;
    } else {
      resultado.vendedores.push(item);
    }
  } else if (secao === 'turno') {
    resultado.turnos.push(item);
    // Se só tem uma linha de turno e não tem totais ainda, usa como totais gerais
    if (!resultado.totais) {
      resultado.totais = { ...valores };
    }
  } else if (secao === 'caixa') {
    resultado.caixas.push(item);
  } else if (secao === 'grupo') {
    resultado.grupos.push(item);
  } else if (secao === 'subgrupo') {
    resultado.subgrupos.push(item);
  } else if (secao === 'produto') {
    resultado.produtos.push(item);
  }

  return item;
}

/**
 * Processa linhas da seção DIA (hora a hora)
 * Formato: "DIA\tQUANTIDADE\tSUBTOTAL\tACRESCIMO\tDESCONTO\tTOTAL"
 * Primeira linha: data com totais do dia (usada se não tiver totais ainda)
 * Demais linhas: faixas de hora como "10:00 ás 10:59"
 */
function processarLinhaDia(cols, resultado) {
  if (cols.length < 6) return;
  const primeiraCol = cols[0];
  if (!primeiraCol) return;

  const valores = extrairValores(cols);
  if (!valores) return;

  // Se a primeira coluna é uma data, é o totalizador do dia
  if (ehData(primeiraCol)) {
    if (!resultado.data) {
      resultado.data = dataBrParaIso(primeiraCol);
    }
    // Atualiza totais se ainda não foram setados
    if (!resultado.totais) {
      resultado.totais = { ...valores };
    }
    return;
  }

  // Faixa de hora (ex: "10:00 ás 10:59" — pode ter "ás" ou "às")
  if (/^\d{1,2}:\d{2}\s*[àá]s\s*\d{1,2}:\d{2}/i.test(primeiraCol)) {
    resultado.horas.push({
      faixa: primeiraCol,
      ...valores
    });
  }
}

/**
 * Extrai os 5 valores numéricos a partir das colunas 1-5
 * Formato do PDV: quantidade, subtotal, acréscimo, desconto, total
 * Valores em formato BR: "1.234,56" (ponto=milhar, vírgula=decimal)
 */
function extrairValores(cols) {
  if (cols.length < 6) return null;
  const qtd       = parseNumeroBr(cols[1]);
  const subtotal  = parseNumeroBr(cols[2]);
  const acrescimo = parseNumeroBr(cols[3]);
  const desconto  = parseNumeroBr(cols[4]);
  const total     = parseNumeroBr(cols[5]);

  if ([qtd, subtotal, total].some(v => v === null)) {
    return null;
  }

  return {
    qtd: qtd || 0,
    subtotal: subtotal || 0,
    acrescimo: acrescimo || 0,
    desconto: desconto || 0,
    total: total || 0
  };
}

/**
 * Converte número no formato brasileiro para Number
 * Ex: "1.234,56" → 1234.56
 *     "47.784,25" → 47784.25
 *     "-44,78" → -44.78
 *     "" → 0
 */
function parseNumeroBr(str) {
  if (str == null) return null;
  str = String(str).trim();
  if (str === '') return 0;
  // Remove pontos de milhar e troca vírgula por ponto
  const limpo = str.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(limpo);
  return isNaN(n) ? null : n;
}

/**
 * Verifica se a string está no formato DD/MM/AAAA
 */
function ehData(str) {
  return /^\d{2}\/\d{2}\/\d{4}$/.test(String(str).trim());
}

/**
 * Converte "DD/MM/AAAA" para "AAAA-MM-DD"
 */
function dataBrParaIso(str) {
  const m = String(str).trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/**
 * Formata o resultado em um resumo legível para prévia
 */
export function resumirParse(resultado) {
  return {
    data: resultado.data,
    totalFaturamento: resultado.totais?.total || 0,
    totalItens: resultado.totais?.qtd || 0,
    qtdVendedores: resultado.vendedores.length,
    qtdProdutos: resultado.produtos.length,
    qtdGrupos: resultado.grupos.length,
    qtdHoras: resultado.horas.length,
    temOperadores: !!resultado.operadores,
  };
}
