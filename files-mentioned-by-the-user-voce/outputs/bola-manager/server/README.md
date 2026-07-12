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

Firebase Admin e inicializado somente no servidor e expoe Auth e Firestore. Formas suportadas:

- `FIREBASE_SERVICE_ACCOUNT_JSON` com o JSON completo;
- `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL` e `FIREBASE_PRIVATE_KEY`;
- Application Default Credentials com `FIREBASE_USE_APPLICATION_DEFAULT=true` ou `GOOGLE_APPLICATION_CREDENTIALS`.

REST exige `Authorization: Bearer <Firebase ID token>`. Socket.IO exige `handshake.auth.token`. O UID e o nome sempre sao derivados do token; IDs enviados no corpo sao ignorados.

Para desenvolvimento local sem credenciais, habilite explicitamente `ALLOW_DEMO_AUTH=true`. REST passa `x-demo-user-id` e `x-demo-user-name`; Socket.IO passa `auth: { userId, name }`. Esse fallback e recusado quando `NODE_ENV=production`. O mesmo opt-in seleciona o RoomStore em memoria; fora dele, Firestore e obrigatorio.

## Contrato REST

Todas as rotas abaixo, exceto `/health`, sao autenticadas:

- `GET /health`: saude e modos ativos, sem dados privados.
- `GET /api/rooms`: somente salas que contem o UID autenticado.
- `POST /api/rooms`: `{ name, clubId?, activeLeagues?, seasonLength?, maxManagers? }`.
- `GET /api/rooms/:code`: somente membros; nao revela se uma sala de terceiros existe.
- `POST /api/rooms/:code/join`: `{ clubId? }`. Para membro de sala ativa, funciona apenas como resume e nao altera nome, clube ou revisao.
- `PATCH /api/rooms/:code/ready`: `{ ready, clubId? }`.
- `POST /api/rooms/:code/start`: corpo vazio; somente o criador.
- `GET /api/teams`: consulta `brasfootClubs`, com filtros opcionais `country`, `division` e `limit`.
- `GET /api/matches/:code/fixture?fixtureId=abertura`: fixture resolvido pelo servidor.
- `GET /api/market/:code` e `GET /api/news/:code`: scaffolds privados ligados ao Firestore.

Respostas de sala usam `{ room }`; listagem usa `{ rooms }`. Erros usam `{ error: { code, message, details? } }`. Datas sao strings ISO 8601. Cada Room inclui `revision`, incrementada na mesma transacao Firestore que persiste uma mutacao. O calendario de partidas usa `currentFixtureId`, `completedFixtureIds`, `completedMatches` e `lastCompletedMatch`.

## Contrato Socket.IO

Todos os eventos de mutacao usam acknowledgement `{ ok: true, ...data }` ou `{ ok: false, error }`.

- `room:create`: mesmo corpo do POST; ack `{ room }`; emite `room:state`.
- `room:join`: `{ code, clubId? }`; ack `{ room }`; emite `room:state`. Em sala ativa, um membro existente apenas retoma o canal e seus dados permanecem imutaveis.
- `room:ready`: `{ code, ready, clubId? }`; ack `{ room }`; emite `room:state`.
- `room:start`: `{ code }`; ack `{ room }`; emite `room:started` e `room:state`.
- `room:resume` ou `room:sync`: `{ code }`; reentra no canal sem mutar a sala e devolve `{ room }`.
- `room:delete`: `{ code }`; somente o owner; ack `{ code }`; emite `room:deleted` a todos os managers. Rejeita durante partida e remove todos os sockets do canal apagado.
- `chat:send`: `{ code, message }`; emite `chat:message`.
- `chat:direct`: `{ code, recipientId, message }`; emite `chat:direct-message` aos dois managers.
- `market:offer`: `{ code, recipientId, playerId, amount, message? }`.
- `market:bid`: `{ code, auctionId, amount }`. Mercado em tempo real ainda e scaffold e marca objetos com `persistent: false`.
- `match:ready`: `{ code, fixtureId?, ready }`; ack `{ room, started, readyCount, requiredCount, matchId? }`. O ultimo manager pronto inicia a transmissao.
- `match:start`: `{ code, fixtureId? }`; ack `{ matchId }`; rejeita enquanto nem todos os managers estiverem prontos.
- `match:skip`: `{ code }`; ack `{ skipped: true }`; emite `match:skipped`.
- `match:sync`: `{ code }`; ack `{ source, started, events, result }`.

O cliente nunca envia times, forcas ou seed. O servidor resolve esses dados pelo catalogo e pelo estado da sala. Ao iniciar a temporada, o servidor gera `fixtureSchedule` com jogos de cada manager contra clubes controlados pela IA e intercala confrontos entre managers. Uma fixture concluida nao pode ser repetida; a conclusao e persistida na transacao da Room, marca a fixture como consumida, limpa `matchReadiness` e avanca `currentFixtureId` antes de emitir `match:finished`.

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

`scripts/import-brasfoot.mjs` recebe JSON normalizado e validado. Ele nao decodifica nem finge conhecer o formato `.dat`, que e privado/nao documentado; a conversao para JSON precisa vir de uma exportacao autorizada e auditada pelo admin. Sempre execute `--dry-run` antes da importacao com credenciais Firebase Admin.
