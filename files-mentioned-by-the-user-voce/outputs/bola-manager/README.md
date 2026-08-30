# Bola Manager

Vertical slice full-stack de um jogo de gerenciamento de futebol brasileiro no navegador. A interface combina a densidade de uma central de operações com navegação rápida, atributos por estrelas e partidas narradas em texto.

## Rodar localmente

Requisitos: Node.js 20+ e npm.

```bash
npm install
npm run dev
```

O frontend abre em `http://localhost:5173` e o servidor em `http://localhost:3001`. Para executar somente uma camada:

```bash
npm run dev:client
npm run server:dev
```

Na tela inicial, entre com Google/e-mail para usar o fluxo autenticado ou escolha **Explorar modo demonstração**. O modo demo usa dados determinísticos e funciona sem credenciais administrativas.

## Fluxo demonstrado

- Firebase Auth real com e-mail, criação de conta, Google e modo demonstração explícito.
- Lobby privado conectado ao Socket.io, com código, escolha exclusiva de clube, managers, revisão monotônica, prontidão e reconexão.
- Gerenciador de saves com seleção, retomada e exclusão permanente confirmada; somente o criador pode apagar uma temporada compartilhada.
- Central do clube com próximo jogo, classificação, tática, elenco, finanças, diretoria e imprensa.
- Elenco filtrável e ordenável com atributos de 1 a 10 estrelas e perfil detalhado.
- Editor tático dirigido por `lineupSlots` das formações, troca por arrastar, banco e instruções.
- Partida autoritativa no servidor com eventos Socket.io a cada 800 ms; o cliente adapta todos os eventos para a narração e recebe placar/estatísticas do servidor.
- Rotas de calendário, competições, mercado, finanças, infraestrutura, rankings, notícias, comissão, relatórios e configurações com dados e interações próprias.
- Rede social da sala com posts persistentes, conversas encadeadas em tempo real, repercussão de personagens e notícias editoriais geradas a partir de declarações relevantes.
- Calendário unificado por datas reais com ligas, copas, grupos e mata-mata; resultados da IA avançam as mesmas chaves dos jogos dos managers.
- Virada de temporada com promoção e rebaixamento entre divisões selecionadas do mesmo país.
- Carreira persistida no save com contratos, treino, evolução, envelhecimento, aposentadoria, Sub-20, promoção de jovens e convocações nacionais.

## Comandos

```bash
npm run dev             # frontend + servidor
npm run build           # typecheck + build Vite
npm run typecheck       # TypeScript estrito
npm run test:server     # testes Node do backend
npm run server          # servidor de produção
npm run import:brasfoot # dry-run do JSON padrão; aceite -- --input C:\Brasfoot para a pasta real
```

## Firebase e dados

O Firebase Web fornecido está em `.env.local`, ignorado pelo Git. Variáveis `VITE_FIREBASE_*` pertencem ao Firebase Client e entram apenas no bundle do frontend. Credenciais administrativas sem o prefixo `VITE_` pertencem exclusivamente ao servidor. Consulte [FIREBASE_SETUP.md](./FIREBASE_SETUP.md) para habilitar os provedores, criar o Firestore e configurar a conta de serviço sem expor a chave privada.

Com Firebase Admin configurado, o backend verifica o ID token no REST e no handshake Socket.io, deriva o UID no servidor e persiste salas em transações Firestore. Sem credenciais, o backend só inicia em memória quando `ALLOW_DEMO_AUTH=true` e nunca permite esse modo em produção.

O importador administrativo em `scripts/import-brasfoot.mjs` aceita JSON normalizado, `.ban`, `.cfg`, a pasta `teams` ou a raiz do Brasfoot. O parser lê Java Serialization como dados e nunca carrega classes da origem. Faça primeiro um `--dry-run --report`, confira corrompidos/duplicidades e consulte [scripts/BRASFOOT_IMPORT.md](./scripts/BRASFOOT_IMPORT.md) antes do commit.

O mesmo fluxo está disponível na interface: entre com sua conta Firebase, abra **Editor da Base**, clique em **Importar Brasfoot** e arraste os arquivos de `teams` ou use **Selecionar pasta**. Cada conta possui sua própria base. O Editor aceita `.ban`, `.cfg` e os escudos `.png`, mostra uma prévia de clubes/jogadores/avisos e só grava no Firebase após confirmação. Cada lote aceita até 200 arquivos, 32 MB por arquivo e 256 MB no total.

No Editor, **Exportar base** gera um pacote JSON versionado com ligas, clubes, jogadores e torneios; **Importar base** valida e combina esse pacote com a base da conta. Links públicos de imagens são preservados, mas os caminhos privados de remoção não são transferidos. Dentro de uma sala, todos os managers consultam automaticamente a base do criador, mesmo que não possuam aquelas ligas em suas próprias contas.

O lobby consulta o catálogo autenticado em `GET /api/teams`. Quando `brasfootClubs` ainda está vazio ou indisponível, a interface identifica e usa os quatro clubes fictícios apenas como fallback de demonstração. Consulte [data/README.md](./data/README.md) antes de preparar uma importação. O Editor aceita escudos, avatares e troféus pelo backend. Para usar Cloudinary sem Firebase Storage, defina `MEDIA_STORAGE_PROVIDER=cloudinary` e `CLOUDINARY_URL` somente no Railway; o segredo nunca vai para o navegador. Firebase Storage continua disponível como alternativa com `FIREBASE_STORAGE_BUCKET`.

## Deploy

### Vercel (frontend)

- Root directory: raiz deste projeto.
- Build command: `npm run build`.
- Output directory: `dist`.
- Defina `VITE_SERVER_URL` com a URL pública do Railway e, se usados, os valores `VITE_FIREBASE_*`.
- `vercel.json` inclui o fallback de SPA.

### Railway (backend)

- Start command: `npm run server`.
- Health check: `/health`.
- Defina `CLIENT_ORIGIN` com o domínio Vercel, `PORT` (normalmente fornecido pelo Railway) e as credenciais Firebase Admin. Elas são obrigatórias em produção com `ROOM_STORE=firestore`.
- Defina `GEMINI_API_KEY` somente no Railway e, opcionalmente, `GEMINI_MODEL` (padrão: `gemini-3.5-flash`). `GEMINI_FALLBACK_MODELS` aceita modelos reserva separados por vírgula e usa `gemini-3.1-flash-lite` por padrão. Nunca use prefixo `VITE_` nessas chaves.
- O servidor Socket.io deve permanecer em um serviço com conexões persistentes; não o publique como função serverless da Vercel.
- Adicione Redis/Valkey compartilhado, configure `REDIS_URL` e use duas ou mais réplicas. O health check é `/ready`; detalhes em [docs/MULTI_REPLICA.md](./docs/MULTI_REPLICA.md).
- Configure Cloudinary por **um** método: `CLOUDINARY_URL` ou o trio `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`. Se uma chave aparecer em chat, log ou arquivo rastreável, gere outra, atualize Railway/`.env.local`, teste e revogue a antiga.

## Limites desta vertical slice

O projeto comprova o ciclo principal e mantém temporadas sucessivas, mas não reproduz todos os regulamentos internacionais nem oferece gestão jogável de seleções. Os clubes e jogadores da demo são fictícios/sem licença.

O fluxo Auth → sala → prontidão → temporada → partida já está conectado. Salas, resultados, eventos emitidos, velocidade, intervalo, planos e prontidão da partida ativa são persistidos no Firestore. Lock Redis com fencing garante um playback por sala; adapter Redis sincroniza broadcasts entre réplicas.

Também permanecem como próximas etapas: balanceamento avançado, regras nacionais adicionais, gestão completa de seleções e E2E multi-processo com Redis real no pipeline.
