# Bola Manager

Vertical slice full-stack de um jogo de gerenciamento de futebol brasileiro no navegador. A interface combina a densidade de uma central de operações com navegação rápida, atributos por estrelas e partidas narradas em texto.

## Rodar localmente

Requisitos: Node.js 20.9+ e npm (incluindo dependências opcionais nativas do `sharp`).

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
npm run check:encoding  # UTF-8 e textos corrompidos; também roda antes de build/typecheck
npm run test:server     # suíte Node completa (backend + regressões frontend)
npm run test:frontend   # recorte explícito de testes frontend
npm run test:e2e:install # instala Chromium para os testes
npm run test:e2e        # smoke integrado: navegador + backend local isolado
npm run server          # servidor de produção
npm run import:brasfoot # dry-run do JSON padrão; aceite -- --input C:\Brasfoot para a pasta real
```

## CI e smoke E2E

O workflow `Bola Manager CI`, em `.github/workflows/bola-manager-ci.yml` na raiz Git, executa typecheck, build, testes Node/frontend e smoke E2E. Após publicá-lo, configure `Bola Manager required` como verificação obrigatória da branch; o arquivo sozinho não ativa proteção contra merge.

O E2E usa as telas, HTTP, Socket.IO e regras reais, substituindo somente autenticação externa e armazenamento por adaptadores em memória. Não carrega `.env` nem usa saves existentes. Relatórios ficam em `.tmp/e2e/`; no CI são retidos por sete dias. Para usar Edge instalado no Windows: `$env:E2E_CHANNEL = 'msedge'; npm run test:e2e`.

Cobertura, limites e validação: [ETAPA_CI_E2E.md](docs/ETAPA_CI_E2E.md).

## Firebase e dados

O Firebase Web fornecido está em `.env.local`, ignorado pelo Git. Variáveis `VITE_FIREBASE_*` pertencem ao Firebase Client e entram apenas no bundle do frontend. Credenciais administrativas sem o prefixo `VITE_` pertencem exclusivamente ao servidor. Consulte [FIREBASE_SETUP.md](./FIREBASE_SETUP.md) para habilitar os provedores, criar o Firestore e configurar a conta de serviço sem expor a chave privada.

Com Firebase Admin configurado, o backend verifica o ID token no REST e no handshake Socket.io, deriva o UID no servidor e persiste salas em transações Firestore. Sem credenciais, o backend só inicia em memória quando `ALLOW_DEMO_AUTH=true` e nunca permite esse modo em produção.

### Sessões Socket persistentes

- Sockets autenticados verificam expiração, revogação e usuário desabilitado no handshake, antes de cada ação e durante ociosidade. A verificação usa `verifyIdToken(token, true)`, conforme [Firebase: gerenciamento de sessões](https://firebase.google.com/docs/auth/admin/manage-sessions). A política REST não foi alterada nesta etapa.
- `SOCKET_AUTH_RECHECK_MS` controla a revisão ociosa (padrão: 60000 ms); `AUTH_TIMEOUT_MS` limita a espera pelo Firebase. Indisponibilidade temporária bloqueia a ação, mas permite tentar novamente. Credenciais inválidas encerram a conexão; a expiração também possui temporizador próprio.
- O cliente verifica o token a cada 60 segundos e envia `auth:refresh` quando necessário, mantendo a conexão e o mesmo UID. Após desconexão por expiração, tenta renovar o token antes de reconectar. Comandos do jogo não são repetidos automaticamente.
- Logout fecha imediatamente as conexões locais e invalida verificações pendentes. `auth:logout` não revoga globalmente os tokens das outras sessões do usuário. Operações já admitidas antes do logout podem terminar.
- Comandos encaminhados entre réplicas também autenticam as credenciais no destino. O canal Redis deve ser privado, autenticado e protegido por TLS em produção; não registre tokens em logs.
- Implementação, testes e limites: [relatório da etapa](./docs/ETAPA_AUTENTICACAO_SOCKET.md).

O importador administrativo em `scripts/import-brasfoot.mjs` aceita JSON normalizado, `.ban`, `.cfg`, a pasta `teams` ou a raiz do Brasfoot. O parser lê Java Serialization como dados e nunca carrega classes da origem. Faça primeiro um `--dry-run --report`, confira corrompidos/duplicidades e consulte [scripts/BRASFOOT_IMPORT.md](./scripts/BRASFOOT_IMPORT.md) antes do commit.

O mesmo fluxo está disponível na interface: entre com sua conta Firebase, abra **Editor da Base**, clique em **Importar Brasfoot** e arraste os arquivos de `teams` ou use **Selecionar pasta**. Cada conta possui sua própria base. O Editor aceita `.ban`, `.cfg` e os escudos `.png`, mostra uma prévia de clubes/jogadores/avisos e só grava no Firebase após confirmação. Cada lote aceita até 200 arquivos, 32 MB por arquivo e 256 MB no total.

No Editor, **Exportar base** gera um pacote JSON versionado com ligas, clubes, jogadores e torneios; **Importar base** valida e combina esse pacote com a base da conta. Links públicos de imagens são preservados, mas os caminhos privados de remoção não são transferidos. Dentro de uma sala, todos os managers consultam automaticamente a base do criador, mesmo que não possuam aquelas ligas em suas próprias contas.

### Criação idempotente de salas

- `room:create` e `POST /api/rooms` aceitam `operationId` ou `requestId` (1–128 caracteres: letras, números, `_`, `.`, `:`, `-`). Se ambos forem enviados, devem ser iguais. Repita o mesmo ID e configuração após timeout/reconexão.
- Sala e recibo em `roomsCreationOperations/{hash(uid, operationId)}` são publicados na mesma transação Firestore. Retry retorna a sala atual, inclusive após reinício ou por outro transporte; IDs são isolados por usuário autenticado. Conteúdo diferente com o mesmo ID retorna `ROOM_CREATION_CONFLICT` (409).
- O cliente mantém o ID no armazenamento local antes do envio e reutiliza solicitações simultâneas. Somente uma resposta confirmada libera uma nova criação intencional. Armazenamento bloqueado impede o envio protegido.
- Recibos não expiram e sobrevivem à exclusão da sala: retry antigo retorna `ROOM_CREATION_GONE` (410), sem recriação. O cliente então libera uma nova tentativa intencional. Não apague recibos como cache; sua retenção impede duplicações tardias.
- Chamadas legadas sem ID continuam criando salas independentes; integrações precisam enviar um ID estável para obter idempotência. O modo demonstração offline permanece local, fora desta garantia de persistência.

### Integridade da importação JSON

- A importação grava uma geração isolada, confere contagem, checksum de cada registro e referências do catálogo combinado. Só então publica `activeGenerationId` e o recibo em uma única transação. Leituras continuam na geração anterior durante o staging; edições e importações concorrentes ficam bloqueadas.
- `POST /api/editor/database/import?mode=merge&operationId=...` aceita um ID de 1–128 caracteres alfanuméricos, `_` ou `-`. Repita o mesmo ID/arquivo após timeout. O recibo persistido em `catalogDatabases/{uid}/jsonImports/{operationId}` impede reaplicação, inclusive após restart ou importações posteriores. Reutilizar um ID com conteúdo diferente retorna 409. Clientes sem ID usam o checksum do pacote normalizado; uma nova importação intencional deve usar um novo ID.
- O Editor guarda apenas ID e hash do arquivo por conta no armazenamento local até confirmar importação e recarregamento. Reabrir o Editor ou selecionar novamente o mesmo arquivo retoma essa operação. Armazenamento local bloqueado impede iniciar o upload; nenhum conteúdo da base é armazenado ali.
- Após interrupção do servidor, o lease expira em 10 minutos sem heartbeat. Repetir a operação cria staging novo a partir da base ativa; o worker antigo não pode publicar. Uma resposta de ativação incerta preserva a geração e deve ser reconciliada pelo mesmo ID, não apagada manualmente.
- Gerações anteriores, staging órfão e suas imagens são mantidos por segurança. Coleta automática desses dados não faz parte deste fluxo; há custo adicional de armazenamento. O limite do arquivo continua em 24 MB. Bases legadas marcadas `import_failed` por importação in-place exigem recuperação explícita de backup, não liberação automática.

O lobby consulta o catálogo autenticado em `GET /api/teams`. Quando `brasfootClubs` ainda está vazio ou indisponível, a interface identifica e usa os quatro clubes fictícios apenas como fallback de demonstração. Consulte [data/README.md](./data/README.md) antes de preparar uma importação. O Editor aceita escudos, avatares e troféus pelo backend. Para usar Cloudinary sem Firebase Storage, defina `MEDIA_STORAGE_PROVIDER=cloudinary` e `CLOUDINARY_URL` somente no Railway; o segredo nunca vai para o navegador. Firebase Storage continua disponível como alternativa com `FIREBASE_STORAGE_BUCKET`.

Imagens externas passam por `/api/media/image`: somente HTTPS de Cloudinary (`image/upload`), Firebase Storage (`alt=media`) e avatares Google (`lh3.googleusercontent.com`). PNG/JPEG/WebP são decodificados e regravados, com teto de 5 MB, 4096 pixels por lado e 16 milhões de pixels; SVG/GIF e redirecionamentos são bloqueados. Links antigos de outras origens permanecem nos saves, mas exibem fallback; reenvie o arquivo pelo Editor. CSP bloqueia carregamento externo direto. Publique frontend e backend juntos; o frontend usa `VITE_SERVER_URL` ou o proxy `/api` existente. Limites, testes e operação: [segurança de imagens](./docs/ETAPA_IMAGENS_EXTERNAS.md).

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
- Para monitoramento, configure `METRICS_TOKEN` exclusivo no backend/coletor. `/metrics` fica desativado sem segredo; exige Bearer próprio, limita coletas e séries, sem códigos de sala nos labels. `/health` e `/ready` permanecem públicos. Consulte [coleta privada de métricas](./docs/MULTI_REPLICA.md#coleta-privada-de-métricas).
- Mercado autônomo: recibos em `marketState.aiTickRuns`, logs `ai_market.*` e métricas `ai_market_*`. Falhas de integridade são registradas sem repetir; erros transitórios reconhecidos têm até 3 tentativas com rollback. Efeitos e recibo são gravados junto com a partida. Consulte [operação e testes do mercado IA](./docs/ETAPA_MERCADO_IA.md).

## Limites desta vertical slice

O projeto comprova o ciclo principal e mantém temporadas sucessivas, mas não reproduz todos os regulamentos internacionais nem oferece gestão jogável de seleções. Os clubes e jogadores da demo são fictícios/sem licença.

O fluxo Auth → sala → prontidão → temporada → partida já está conectado. Salas, resultados, eventos emitidos, velocidade, intervalo, planos e prontidão da partida ativa são persistidos no Firestore. Lock Redis com fencing garante um playback por sala; adapter Redis sincroniza broadcasts entre réplicas.

### Recuperação de saves

Cada gravação v2 preserva um checkpoint completo da geração anterior na mesma transação da nova raiz. As leituras detectam páginas ausentes, checksums incorretos e manifestos corrompidos. Antes do reparo, o servidor bloqueia gravações/GC, revalida a geração atual e carrega **toda** a anterior. O reparo publica metadados e seções juntos, avança revisão/versão e registra `saveRecovery`, `maintenance/recovery-last` e o evento `save_recovered` no log.

A recuperação pode perder o progresso da última gravação: ela retorna à geração anterior, nunca combina dados de gerações diferentes. Falhas de rede/permissão e schemas futuros não acionam rollback. Saves antigos ganham checkpoint na próxima gravação; sem checkpoint verificável, ou com corrupção nas duas gerações (inclusive páginas compartilhadas), a operação falha explicitamente e exige restauração de backup. Isso não substitui backups externos. Exclusão do save também remove os checkpoints e registros de recuperação.

Também permanecem como próximas etapas: balanceamento avançado, regras nacionais adicionais, gestão completa de seleções e E2E multi-processo com Redis real no pipeline.
