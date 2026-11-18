# Votação ao vivo (alternativa ao Mentimeter)

Site estático (GitHub Pages) com sincronização em tempo real pelo Firebase. Grátis, sem anúncios, sem limite de perguntas ou de salas.

**Tipos de pergunta:** múltipla escolha · nuvem de palavras · resposta aberta · escala/nota · quiz com ranking · perguntas da plateia (com votos 👍)

- `index.html` → a plateia abre no celular
- `apresentador.html` → você cria a sala, monta as perguntas e projeta

---

## Passo a passo (uns 15 minutos, só na primeira vez)

### 1. Criar o projeto no Firebase
1. Acesse <https://console.firebase.google.com> e clique em **Criar um projeto**. Dê um nome qualquer e pode desativar o Google Analytics.
2. No menu lateral, abra **Criação → Authentication**, clique em **Vamos começar**, depois na aba **Método de login**, escolha **Anônimo** e **ative**.
3. No menu lateral, abra **Criação → Realtime Database** e clique em **Criar banco de dados**.
   - Local: **Estados Unidos (us-central1)**
   - Modo: **bloqueado**
4. Ainda no Realtime Database, abra a aba **Regras**, apague tudo, cole o conteúdo do arquivo `database.rules.json` e clique em **Publicar**.

### 2. Conectar o site ao Firebase
1. Clique na engrenagem ⚙ e depois em **Configurações do projeto**. Em "Seus apps", clique no ícone **`</>`** (Web), dê um apelido e clique em **Registrar app**. *Não* marque Firebase Hosting.
2. O Firebase mostra um bloco `const firebaseConfig = { ... }`. Copie os valores para o arquivo **`js/firebase-config.js`**.
   - Confira se tem a linha **`databaseURL`**. Se não tiver, copie a URL que aparece no topo da página do Realtime Database (algo como `https://seu-projeto-default-rtdb.firebaseio.com`).

> A `apiKey` do Firebase pode ficar pública no GitHub, é assim mesmo que ele funciona. O que protege os dados são as regras do passo 1.4.

### 3. Publicar no GitHub Pages
1. Crie um repositório **público** no GitHub (ex.: `votacao`).
2. Clique em **Add file**, depois em **Upload files**, e arraste **todo o conteúdo** desta pasta: `index.html`, `apresentador.html`, as pastas `css/` e `js/` e o `database.rules.json`. Clique em **Commit**.
3. No repositório, abra **Settings → Pages**. Em "Branch", escolha **main** e **/ (root)** e clique em **Save**.
4. Em 1 a 2 minutos, o site estará em `https://SEU-USUARIO.github.io/votacao/`.
5. (Recomendado) No Firebase, abra **Authentication → Configurações → Domínios autorizados** e adicione `SEU-USUARIO.github.io`.

---

## Como usar no evento

1. Abra `https://SEU-USUARIO.github.io/votacao/apresentador.html` **no computador que vai projetar**.
2. **Crie a sala**, adicione as perguntas e clique em **▶ Apresentar**.
3. A primeira tela mostra o **QR code e o código**. A plateia entra pelo celular.
4. Use **→ / ←** (ou o passador de slides) para avançar. Outros atalhos:
   - **F**: tela cheia
   - **Q**: volta ao QR code
   - **R**: oculta ou mostra os resultados
   - Os botões de controle somem sozinhos quando o mouse fica parado.
5. **Quiz:** clique em **▶ Iniciar quiz**. O tempo encerra sozinho, ou antes, se todo mundo já tiver respondido. Depois mostre o **🏆 Ranking**.
6. No final, em **Editar**, clique em **⬇ Exportar CSV** para baixar todas as respostas (abre no Excel).

**Importante:**
- A sala fica ligada ao navegador que a criou (login anônimo). Crie e apresente no **mesmo computador e navegador** e não limpe os dados do navegador antes do evento.
- Cada celular vota uma vez por pergunta. A pessoa pode alterar o voto enquanto a votação estiver aberta.
- Faça um teste antes com 2 ou 3 celulares.

## Limites do plano grátis do Firebase (Spark)
- **100 conexões simultâneas**: 65 pessoas mais o telão cabem com folga.
- 1 GB armazenado e 10 GB de download por mês: dá para milhares de votações.
- Se um dia passar de 100 pessoas ao mesmo tempo, dá para mudar para o plano Blaze (pago por uso, que costuma custar centavos para eventos).

## Testar no seu computador (opcional)
Na pasta do projeto, rode `python -m http.server 8000` e abra `http://localhost:8000/apresentador.html`.
