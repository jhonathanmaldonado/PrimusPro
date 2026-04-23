# Sistema Primus

Sistema unificado de gestão para a Peixaria Primus:
- **Contagem de estoque** (barman, gerente e gestor)
- **Painel do gestor** com dashboard, auditoria, compras e vendas

## Como colocar no ar (GitHub Pages)

1. **Suba todos os arquivos** desta pasta para o seu repositório do GitHub.
2. **Ative o GitHub Pages** nas configurações do repositório (Branch: `main`, pasta `/`).
3. Acesse pela URL que o GitHub te der (algo como `https://seu-usuario.github.io/seu-repo/`).

> ⚠️ Certifique-se de que o arquivo `index.html` está na raiz. Ele é a porta de entrada do sistema.

## Como testar localmente

Como o sistema usa `type="module"` no JavaScript, **não dá pra abrir o arquivo direto no navegador** (erro de CORS). Use um servidor local simples:

```bash
# Opção 1: Python
python3 -m http.server 8000

# Opção 2: Node (npx)
npx serve
```

Depois abra `http://localhost:8000` no navegador.

## Primeiro acesso

Na primeira vez que alguém acessa o sistema, ele cria 3 usuários padrão automaticamente:

| Usuário  | Perfil  | PIN inicial |
|----------|---------|-------------|
| Barman   | barman  | `1111`      |
| Gerente  | gerente | `2222`      |
| Gestor   | gestor  | `0000`      |

**🔐 Troque os PINs assim que entrar pela primeira vez como gestor** (a tela de edição vem na Parte 3, por enquanto isso pode ser feito direto no Firestore — no painel do Firebase).

## Perfis e permissões

| Perfil | Acessa Contagem | Acessa Painel do Gestor |
|--------|-----------------|-------------------------|
| **Barman** | ✅ | ❌ |
| **Gerente** | ✅ | ❌ |
| **Gestor** | ✅ | ✅ |

## Estrutura dos arquivos

```
primus/
├── index.html          # Tela de login
├── contagem.html       # Tela de contagem (mobile-first)
├── gestor.html         # Painel do gestor (desktop-first)
├── css/
│   └── primus.css      # Estilos compartilhados
└── js/
    ├── firebase-config.js  # Config do Firebase + imports
    ├── auth.js             # Login, PIN, sessão, permissões
    ├── db.js               # Leitura/escrita no Firestore
    ├── produtos.js         # Catálogo central de produtos
    ├── pdv-parser.js       # Parser do TXT do PDV
    ├── contagem.js         # Lógica da tela de contagem
    ├── vendas.js           # Upload e gestão de vendas
    ├── dashboard.js        # KPIs e gráficos (Chart.js)
    └── gestor.js           # Navegação do painel do gestor
```

## Coleções do Firestore

Todas as coleções usam o prefixo `primus_` para não conflitar com outros sistemas que já usam o mesmo projeto Firebase.

- **`primus_usuarios`** — Cadastro de pessoas (nome, perfil, pinHash)
- **`primus_contagens`** — Toda contagem salva (tipo, data, autor, itens)
- **`primus_vendas`** — Dados do PDV por dia (Parte 2)
- **`primus_compras`** — Listas de compras (Parte 3)
- **`primus_produtos`** — Catálogo dinâmico de produtos (Parte 3)

## O que está pronto (Parte 1 + Parte 2)

### Parte 1 — Base do sistema
- ✅ Login com PIN (4 dígitos) por pessoa
- ✅ 3 perfis com permissões diferentes
- ✅ Seed automático dos usuários padrão no primeiro acesso
- ✅ Tela de contagem (início/final/sorvetes) salvando direto no Firebase
- ✅ Painel do gestor com navegação entre módulos
- ✅ Listagem de todas as contagens com filtros (tipo e data)
- ✅ Modal com detalhes de cada contagem
- ✅ Listagem básica de usuários

### Parte 2 — Vendas & Dashboard
- ✅ Parser automático do TXT do PDV (entende o formato do seu relatório)
- ✅ Upload com drag-and-drop + prévia antes de salvar
- ✅ Detecção automática de encoding (UTF-8 ou latin-1)
- ✅ Aviso de sobrescrita se o dia já foi importado
- ✅ Histórico de dias importados com acesso aos detalhes
- ✅ Dashboard com 5 KPIs (faturamento, ticket médio, média diária, itens, melhor vendedor)
- ✅ Filtros de período (7 dias, 30 dias, mês atual, tudo, personalizado)
- ✅ Gráfico de faturamento diário (linha, com médias)
- ✅ Gráfico de mix por grupo (pizza/donut)
- ✅ Gráfico de vendas por hora (barras, com destaque do pico)
- ✅ Top 10 produtos (barras horizontais)
- ✅ Ranking de vendedores (com medalhas 🥇🥈🥉, barras de progresso, ticket médio)
- ✅ OPERADORES em seção separada (não atrapalha o ranking dos vendedores nomeados)
- ✅ Chart.js com paleta de cores Primus

## Próximas partes

### Parte 3 — Auditoria, Compras & Usuários
- Módulo de auditoria (evolução do Primus Pro)
- Lista de compras inteligente (sugestão automática + ajuste manual)
- Gestão completa de usuários (criar, editar PIN, desativar)

## Segurança do Firestore

Enquanto estamos desenvolvendo, as regras do Firestore estão abertas (qualquer um com o link do Firebase pode ler/escrever). **Isso não é seguro pra produção.** Quando terminarmos as 3 partes, vamos apertar as regras para que só usuários autenticados consigam acessar.
