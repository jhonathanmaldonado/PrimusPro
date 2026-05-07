# Lista de Compras — Peixaria Primus

App online de gerenciamento de lista de compras com sincronização em tempo real entre múltiplos dispositivos. Backend: Firebase (Firestore + Auth). Hospedagem: GitHub Pages.

## 🎯 Funcionalidades (Entrega 1)

- ✅ Login multi-usuário com username + PIN de 4 dígitos
- ✅ Criação inicial do workspace (primeiro dono) com código de admin
- ✅ Sincronização em tempo real entre dispositivos
- ✅ Catálogo de produtos com categorias coloridas
- ✅ Lista atual (qtd, preço, comprado) separada do catálogo
- ✅ Resumo com total estimado, itens comprados/pendentes
- ✅ Busca em tempo real
- ✅ Categorias colapsáveis
- ✅ Finalizar compra → arquiva no histórico, limpa lista atual, atualiza preços
- ✅ Histórico com snapshot completo da compra
- ✅ Auditoria (quem alterou, quando)
- ✅ Proteção anti-brute-force (5 tentativas → bloqueio 15min)

**Próximas entregas:** Entrega 2 (edição de itens, fornecedores, ordenação, comparativo de preços, "usar último preço") e Entrega 3 (WhatsApp, PDF, polimento final).

---

## 🚀 Setup completo (passo a passo)

### 1. Configure o Firebase

#### 1.1. Habilite Authentication
- Acesse [console.firebase.google.com](https://console.firebase.google.com) → seu projeto
- Menu lateral → **Authentication** → **Get started**
- Aba **Sign-in method** → habilite **Email/Password**

#### 1.2. Crie o Firestore Database
- Menu lateral → **Firestore Database** → **Create database**
- Modo: **Production mode** (vamos definir regras manualmente)
- Localização: `southamerica-east1` (São Paulo) — recomendado para Brasil

#### 1.3. Aplique as regras de segurança
- Firestore Database → aba **Rules**
- Cole todo o conteúdo de `firestore.rules` deste projeto
- Clique em **Publish**

#### 1.4. Pegue suas credenciais
- ⚙️ (engrenagem) → **Project settings**
- Aba **General** → role até **Your apps**
- Se não tiver app web ainda: clique no ícone `</>` para criar um
- Copie o objeto `firebaseConfig` que aparece

### 2. Configure o app

Edite `firebase-config.js` e substitua os valores:

```js
export const firebaseConfig = {
  apiKey: "AIzaSy...",
  authDomain: "seu-projeto.firebaseapp.com",
  projectId: "seu-projeto",
  storageBucket: "seu-projeto.appspot.com",
  messagingSenderId: "...",
  appId: "..."
};

// 🔐 ALTERE este código antes do deploy!
export const ADMIN_CODE = "PRIMUS-DONO-2026";
```

⚠️ **Importante:** o `ADMIN_CODE` é só para o primeiro acesso (criar a conta de dono). Depois disso, o link "Criar workspace" some automaticamente. Mesmo assim, escolha um valor que não seja óbvio.

### 3. Crie o repositório no GitHub

```bash
# No terminal, dentro da pasta do projeto:
git init
git add .
git commit -m "Versão inicial v10"

# Crie o repo em github.com (público)
# Depois:
git remote add origin https://github.com/SEU_USER/lista-primus.git
git branch -M main
git push -u origin main
```

### 4. Ative o GitHub Pages

- No repositório no GitHub: **Settings** → **Pages**
- **Source**: `Deploy from a branch`
- **Branch**: `main` / `/ (root)`
- Clique em **Save**
- Aguarde ~1 minuto. A URL ficará: `https://SEU_USER.github.io/lista-primus/`

### 5. Autorize o domínio no Firebase

- Console Firebase → **Authentication** → **Settings** → **Authorized domains**
- Clique em **Add domain**
- Adicione: `SEU_USER.github.io`

### 6. Primeiro acesso

1. Abra a URL do app
2. Clique em **"Primeiro acesso? Criar workspace"**
3. Preencha:
   - **Código de Admin**: o que você definiu em `firebase-config.js`
   - **Seu nome**: ex. Jhonathan
   - **Usuário**: ex. `jhonathan` (lowercase, sem espaço)
   - **PIN**: 4 dígitos
4. Clique em **Criar conta de dono**
5. Você será logado automaticamente
6. O app perguntará se quer importar o catálogo inicial (80+ itens) — clique em OK

✅ Pronto! O app está funcionando. Use o mesmo workspace de qualquer dispositivo com seu username + PIN.

---

## 👥 Adicionar funcionários

> **Atenção:** na Entrega 1 ainda não há tela visual para isso. Por enquanto, faça manualmente pelo Console do Firebase. Na Entrega 2 vou adicionar a tela "Adicionar membro".

Por enquanto, a função `criarMembro()` existe em `auth.js` mas não tem UI. Aguarde a Entrega 2.

---

## 📂 Estrutura dos arquivos

```
/
├── index.html             ← estrutura HTML + tela de login
├── styles.css             ← todos os estilos
├── firebase-config.js     ← suas credenciais (EDITE!)
├── auth.js                ← login, cadastro, anti-brute-force
├── db.js                  ← operações Firestore
├── app.js                 ← orquestrador principal
├── seed-catalog.json      ← catálogo v9 para importar uma vez
├── firestore.rules        ← regras de segurança (cole no Console Firebase)
└── README.md              ← este arquivo
```

---

## 🔐 Modelo de segurança

- **Login**: workspace + username + PIN(4) → `senhaFirebase = SHA-256(PIN + segredo)`
- O `segredo` (24 chars aleatórios) fica em `auth_lookup`, leitura pública
- O PIN só fica na cabeça do usuário
- Atacante precisa dos **dois** para entrar
- Após 5 tentativas falhas → bloqueio de 15 minutos
- Todas as operações no Firestore exigem autenticação + ser membro do workspace
- Histórico só pode ser deletado pelo dono

---

## 🐛 Troubleshooting

**"Firebase: Error (auth/configuration-not-found)"**
→ Você não habilitou Email/Password em Authentication.

**"Missing or insufficient permissions"**
→ As regras do Firestore não foram aplicadas. Veja passo 1.3.

**"auth/unauthorized-domain"**
→ Falta autorizar o domínio do GitHub Pages. Veja passo 5.

**Splash fica girando para sempre**
→ Abra o Console do navegador (F12) e veja o erro. Geralmente é credencial errada em `firebase-config.js`.

**"Catálogo já tem dados" ao tentar importar seed**
→ Já tem categorias no Firestore. Para reimportar, delete tudo na collection `categorias` pelo Console Firebase.

---

## 📝 Próximas entregas

**Entrega 2** (em breve):
- Modal "Editar item" (nome, tipo, categoria, fornecedor)
- Mover item entre categorias
- Cadastro de fornecedores (lista + texto livre)
- Ordenação dentro da categoria (alfabético/manual com drag)
- Botão "usar último preço" (ao lado do campo)
- Indicador ↑↓ de comparação de preço vs. compra anterior
- Tela "Adicionar membro" (só dono vê)

**Entrega 3** (final):
- Compartilhar via WhatsApp (com escolha do conteúdo)
- Geração de PDF (migrado do v9)
- Painel de auditoria (logs detalhados)
- Polimento final + testes

---

**Contato:** Jhonathan — Peixaria Primus, Cuiabá/MT
