# Backend do Bola Manager

Servidor ESM com Express, Socket.IO, Zod e Firebase Admin. Nenhuma API externa de futebol e consultada. Clubes e jogadores vem apenas das colecoes importadas da base normalizada do Brasfoot.

## Dependencias e scripts

Dependencias de runtime: `express`, `cors`, `socket.io`, `zod` e `firebase-admin`. Os testes usam `node:test`; `socket.io-client` e usado apenas nos testes de integracao e ja e dependencia do cliente.

Scripts sugeridos no `package.json` raiz:

```json
{
  "server": "node server/index.mjs",
  "server:dev": "node --watch server/index.mjs",
  "test:server": "node --test server/tests/*.test.mjs",
  "import:brasfoot": "node scripts/import-brasfoot.mjs --dry-run --input ./data/brasfoot-normalized.json"
}
```

O processo local carrega `.env.local` e depois `.env` com `process.loadEnvFile`. Variaveis ja definidas pelo processo continuam prioritarias. Railway usa as variaveis nativas e nao carrega arquivos em `NODE_ENV=production`.

## Firebase e autenticacao

Firebase Admin e inicializado somente no servidor e expoe Auth, Firestore e, quando `FIREBASE_STORAGE_BUCKET` foi definido, Storage. Formas suportadas:

- `FIREBASE_SERVICE_ACCOUNT_JSON` com o JSON completo;
- `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL` e `FIREBASE_PRIVATE_KEY`;
- Application Default Credentials com `FIREBASE_USE_APPLICATION_DEFAULT=true` ou `GOOGLE_APPLICATION_CREDENTIALS`.

REST exige `Authorization: Bearer <Firebase ID token>`. Socket.IO exige `handshake.auth.token`. O UID e o nome sempre sao derivados do token; IDs enviados no corpo sao ignorados.

Para desenvolvimento local sem credenciais, habilite explicitamente `ALLOW_DEMO_AUTH=true`. REST passa `x-demo-user-id` e `x-demo-user-name`; Socket.IO passa `auth: { userId, name }`. Esse fallback e recusado quando `NODE_ENV=production`. O mesmo opt-in seleciona o RoomStore em memoria; fora dele, Firestore e obrigatorio.

O Editor da Base exige o custom claim booleano `editor: true` ou um UID listado em `EDITOR_ADMIN_UIDS`. O bypass local e separado e precisa de `ALLOW_LOCAL_EDITOR=true`, lista de UIDs vazia e um usuario Firebase autenticado; contas demo nunca recebem acesso. A flag local e ignorada em `NODE_ENV=production` e o valor padrao e fechado, inclusive quando `NODE_ENV` nao foi informado.

## Contrato REST

Todas as rotas abaixo, exceto `/health`, sao autenticadas:

- `GET /health`: saude e modos ativos, sem dados privados.
- `GET /api/rooms`: somente salas que contem o UID autenticado.
- `POST /api/rooms`: `{ name, clubId?, activeLeagues?, seasonLength?, unlimitedSeasons?, maxManagers? }`. `unlimitedSeasons` e booleano e usa `false` por padrao.
- `GET /api/rooms/:code`: somente membros; nao revela se uma sala de terceiros existe.
- `POST /api/rooms/:code/join`: `{ clubId? }`. Para membro de sala ativa, funciona apenas como resume e nao altera nome, clube ou revisao.
- `PATCH /api/rooms/:code/ready`: `{ ready, clubId? }`.
- `POST /api/rooms/:code/start`: corpo vazio; somente o criador.
- `GET /api/teams`: consulta `brasfootClubs`, com filtros opcionais `country`, `division` e `limit`.
- `GET /api/teams/:clubId/star-impact`: resume estrelas ativas, bonus de forca e projecao comercial do clube; sem catalogo devolve impacto zero.
- `GET /api/teams/:clubId/players`: lista somente jogadores ativos do clube, ordenados por overall, nome e ID.
- `GET /api/tournaments`: consulta apenas torneios ativos e busca por ID somente os clubes referenciados por eles; devolve configuracao, imagem do trofeu e participantes ativos (incluindo URL/path do escudo).
- `GET /api/editor/access`: informa `{ canEdit }` para o usuario autenticado.
- `GET /api/editor/catalog?limit=50`: bootstrap limitado para editores autorizados. Preserva as listas `{ leagues, clubs, players, tournaments }` e acrescenta `meta.<entity> = { count, returned, limit, nextCursor, hasMore, filters }`. O limite padrao e 50 por entidade e o maximo e 200; portanto esta rota nunca carrega todos os jogadores.
- `GET /api/editor/:entity?limit=50&cursor=<opaco>&query=<prefixo>&clubId=<id>`: pagina uma entidade (`leagues`, `clubs`, `players` ou `tournaments`) por nome. `query` e uma busca de prefixo sensivel a maiusculas/minusculas. `clubId` e aceito somente para `players`. A resposta usa `{ entity, records, count, returned, limit, nextCursor, hasMore, filters }`; o cliente deve repetir exatamente os mesmos filtros ao reutilizar `nextCursor`.
- `POST/PATCH/DELETE /api/editor/:entity/:id?`: cria, altera, arquiva ou exclui `leagues`, `clubs`, `players` e `tournaments` via Firebase Admin. `DELETE` tambem tenta remover a midia associada e devolve `{ deleted, id, mediaRemoved }`; falha de Storage nao desfaz a exclusao e aparece como `mediaRemoved: false`.
- `POST /api/editor/media?entity=clubs|players|tournaments&id=<id>&kind=crest|avatar|trophy`: recebe a imagem como corpo binario `image/png`, `image/jpeg` ou `image/webp`, com limite de 5 MB. O registro precisa existir. O servidor gera o caminho, grava no Storage, associa URL/path ao registro e remove a imagem anterior depois da substituicao. Retorna `{ media, record, previousMediaRemoved }`.
- `DELETE /api/editor/media?entity=clubs|players|tournaments&id=<id>&kind=crest|avatar|trophy`: desassocia URL/path e tenta remover o objeto anterior. Retorna `{ record, mediaRemoved }`; `false` indica apenas que a limpeza do objeto precisa ser repetida.
- `GET /api/matches/:code/fixture?fixtureId=abertura`: fixture resolvido pelo servidor.
- `GET /api/market/:code`: scaffold privado ligado ao Firestore.
- `GET /api/news/:code`: posts persistidos da sala, ordenados do mais novo para o mais antigo.
- `POST /api/news/:code/ai`: gera radar e repercussao, sincroniza os posts editoriais da sala para que comentarios sejam persistentes e devolve `{ teamComment, replies, posts }`; corpo `{ posts }` validado.
- `POST /api/news/:code/posts`: publica `{ message }`, deriva autor do token, gera a repercussao inicial e, quando a declaracao e noticiavel, uma materia editorial separada. Persiste e emite cada `news:post`.
- `POST /api/news/:code/posts/:postId/comments`: publica `{ message, parentCommentId? }`, valida o encadeamento no post da sala, persiste a resposta do manager e a replica do personagem e emite o post atualizado.

Respostas de sala usam `{ room }`; listagem usa `{ rooms }`. Erros usam `{ error: { code, message, details? } }`. Datas sao strings ISO 8601. Cada Room inclui `revision`, incrementada na mesma transacao Firestore que persiste uma mutacao. O calendario usa `currentFixtureId`, `completedFixtureIds`, `completedMatches` e `lastCompletedMatch`. A carreira expoe `unlimitedSeasons`, `currentSeason`, `seasonYear`, `seasonStartedAt`, `seasonHistory`, `careerCompleted` e `careerCompletedAt`.

Torneios ficam em `tournaments` e usam `format` (`league`, `knockout` ou `groups_knockout`), `teamCount`, `legs` (`single` ou `double`), `tiebreakers`, `teamIds`, imagem de trofeu opcional e `active`. IDs de times precisam existir em `brasfootClubs`; um torneio ativo exige exatamente `teamCount` IDs e todos os clubes precisam estar ativos. O backend valida as referencias em lote quando `getAll` esta disponivel e impede arquivar um clube ainda usado por torneio ativo. Duplicatas, criterios repetidos e combinacoes incoerentes como `away_goals` com jogo unico sao recusados. A colecao `tournaments` nao permite leitura direta pelas regras do cliente; o contrato publico e somente `GET /api/tournaments`.

Uploads validam tamanho em bytes, MIME e assinatura antes do Storage. Risco residual: sem uma biblioteca de decodificacao de imagens, o backend nao mede dimensoes nem pixels decodificados; uma imagem pequena comprimida pode ser um *pixel bomb*. O limite de 5 MB reduz a exposicao, mas consumidores devem impor limites de dimensao/decodificacao e a validacao completa deve ser adicionada quando houver um decoder de imagem auditado.

## Contrato Socket.IO

Todos os eventos de mutacao usam acknowledgement `{ ok: true, ...data }` ou `{ ok: false, error }`.

- `room:create`: mesmo corpo do POST; ack `{ room }`; emite `room:state`.
- `room:join`: `{ code, clubId? }`; ack `{ room }`; emite `room:state`. Em sala ativa, um membro existente apenas retoma o canal e seus dados permanecem imutaveis.
- `room:ready`: `{ code, ready, clubId? }`; ack `{ room }`; emite `room:state`.
- `room:start`: `{ code }`; ack `{ room }`; emite `room:started` e `room:state`.
- `room:resume` ou `room:sync`: `{ code }`; reentra no canal sem mutar a sala e devolve `{ room }`.
- `room:delete`: `{ code }`; somente o owner; ack `{ code }`; emite `room:deleted` a todos os managers. Rejeita durante partida e remove todos os sockets do canal apagado.
- `lineup:save`: `{ code, lineupIds }`, com 1 a 11 IDs unicos; manager e clube sao derivados do token e da sala. Ack `{ lineup, room, source }`; emite `room:state` e remove a confirmacao de pronto desse manager.
- `chat:send`: `{ code, message }`; emite `chat:message`.
- `chat:direct`: `{ code, recipientId, message }`; emite `chat:direct-message` aos dois managers.
- `market:offer`: `{ code, recipientId, playerId, amount, message? }`.
- `market:bid`: `{ code, auctionId, amount }`. Mercado em tempo real ainda e scaffold e marca objetos com `persistent: false`.
- `match:ready`: `{ code, fixtureId?, ready }`; ack `{ room, started, readyCount, requiredCount, matchId? }`. O ultimo manager pronto inicia a transmissao.
- `match:start`: `{ code, fixtureId? }`; ack `{ matchId }`; rejeita enquanto nem todos os managers estiverem prontos.
- `match:skip`: `{ code }`; ack `{ skipped: true }`; emite `match:skipped`.
- `match:sync`: `{ code }`; ack `{ source, started, events, result }`.

O cliente nunca envia times, forcas ou seed. O servidor resolve esses dados pelo catalogo e pelo estado da sala. Ao iniciar a temporada, o servidor gera `fixtureSchedule` com jogos de cada manager contra clubes controlados pela IA e intercala confrontos entre managers. Uma fixture concluida nao pode ser repetida; a conclusao e persistida na transacao da Room, marca a fixture como consumida, limpa `matchReadiness` e avanca `currentFixtureId` antes de emitir `match:finished`.

Ao concluir a ultima fixture, carreiras ilimitadas e carreiras finitas ainda abaixo de `seasonLength` arquivam um resumo em `seasonHistory`, incrementam `currentSeason` e `seasonYear`, geram um novo calendario e limpam `completedFixtureIds`, `matchReadiness` e escalacoes. `completedMatches` permanece como historico global. A ultima temporada de uma carreira finita mantem `currentFixtureId: null` e marca `careerCompleted: true`. Saves legados assumem temporada 1, ano derivado da criacao/inicio e `unlimitedSeasons: false`.

Jogadores do Editor usam `isStar` booleano, independente de `overall`; registros legados sem o campo equivalem a `false`. Todas as estrelas ativas contam `5%` de atratividade comercial (teto `25%`) e R$ 2.500.000 na projecao anual de patrocinio (teto R$ 12.500.000). Em campo, somente estrelas da escalacao salva somam `0.25` de forca (teto `1.0`); lesionados e suspensos sao ignorados. Sem escalacao salva, o servidor escolhe deterministicamente os 11 jogadores disponiveis de maior overall, com desempate por nome e ID. Os dois clubes sao consultados atomicamente; falha ou timeout zera ambos os bonus. O perfil aplicado fica nos metadados da partida e no resultado persistido.

## IA da rede social

Configure `GEMINI_API_KEY` apenas no processo do backend. `GEMINI_MODEL` e opcional e usa `gemini-3.5-flash` por padrao. A chave segue para a Gemini pelo header `x-goog-api-key` e nunca entra no bundle Vite. Saidas usam JSON estruturado, validacao Zod, timeout, cache de dez minutos e fallback local quando a API estiver ausente ou indisponivel. Posts sao tratados como conteudo nao confiavel no prompt; instrucoes escritas por usuarios nao podem substituir a persona do sistema.

Os endpoints exigem Firebase Auth e membership antes de gerar conteudo. Posts e comentarios humanos usam UID/nome derivados do token. Materias sao criadas somente para declaracoes relevantes, como anuncios, transferencias, lesoes, resultados e criticas; respostas de conversa nunca criam materia por conta propria. Metadados de provedor ficam restritos ao servidor e nao fazem parte dos contratos publicos. Em producao, a colecao `news` e escrita apenas pelo Firebase Admin; regras do cliente continuam negando acesso direto.

Os editoriais-base enviados pela interface sao identificados apenas pelas chaves `n1` a `n4`. Fonte, persona, manchete, corpo, categoria e reacoes sao reconstruidos por um catalogo canonico no servidor antes da persistencia; valores adulterados pelo cliente sao ignorados.

Chamadas de analise usam cooldown por manager/sala e limite global de concorrencia para proteger a quota. Publicacoes tambem usam cooldown e mantem o texto no cliente quando falham. A consulta Firestore usa o indice composto de `firestore.indexes.json` quando ele esta pronto. Se o indice ainda nao foi publicado, o backend consulta pela sala e ordena os resultados localmente para manter o feed disponivel; publicar o indice continua recomendado para reduzir leituras em salas grandes.

A ordem garantida e: ack do ultimo `match:ready` (ou de `match:start`), `match:started`, zero ou mais `match:event`, e `match:finished`. Os payloads `match:started`, `match:event` e `match:finished`, inclusive o resumo persistido, incluem `code` para o cliente filtrar a sala. Eventos mantem `score` como tupla `[mandante, visitante]` e `statistics` como snapshot. O intervalo padrao e 800 ms, configuravel por `MATCH_EVENT_DELAY_MS`.

Payload de sincronizacao:

```json
{
  "ok": true,
  "source": "live | persisted | idle",
  "started": "metadados de match:started ou null",
  "events": "eventos enriquecidos ja emitidos, ou []",
  "result": "resultado concluido/resumo persistido, ou null"
}
```

`source: "live"` devolve os metadados e eventos retidos pela sessao deste processo. Apos reinicio, `source: "persisted"` devolve `lastCompletedMatch`; como os eventos completos nao sao gravados na Room, `started` e `null` e `events` e `[]`. Sem partida iniciada ou concluida, a resposta usa `source: "idle"`.

## Persistencia de salas

`RoomStore` depende de uma interface de persistencia. `FirestoreRoomPersistence` usa criacao atomica e transacoes para entrada, escolha de clube, prontidao, inicio e conclusao de fixture; a gravacao termina antes de qualquer broadcast ou ack. Ao excluir, substitui o documento por uma tombstone minima `{ code, deleted: true }`: dados do save e managers somem, mas o codigo nunca pode ser reutilizado por outra temporada nem herdar news/market antigos. `MemoryRoomPersistence` aplica a mesma reserva com um conjunto de codigos excluidos e existe apenas para teste/demo explicitamente habilitado.

## Importacao Brasfoot

O Editor envia `.ban`, `.cfg` e `.png` por sessoes temporarias protegidas pelo mesmo acesso administrativo do catalogo. O fluxo usa `POST /api/editor/brasfoot-import/sessions`, `PUT .../files`, `POST .../preview`, `POST .../commit` e `DELETE` para descarte. Cada sessao pertence ao UID que a criou, expira em 30 minutos e aceita ate 200 arquivos, 32 MB por arquivo e 256 MB no total. O commit e bloqueado quando a previa possui erros, salvo confirmacao explicita de importacao parcial.

As sessoes ficam no disco temporario do processo. Em producao, mantenha uma replica durante cada importacao ou configure afinidade de sessao antes de escalar horizontalmente. O commit registra uma execucao em `brasfootImports`, aplica merge idempotente e envia escudos somente quando solicitado e quando o Storage esta configurado.

Como alternativa de automacao, `scripts/import-brasfoot.mjs` recebe JSON normalizado, `.ban`, `.cfg`, `teams` ou a raiz do Brasfoot. O leitor de Java Serialization e data-only e nao instancia classes. Consulte [o guia do importador](../scripts/BRASFOOT_IMPORT.md) para o modo CLI, limites e reconciliacao.
