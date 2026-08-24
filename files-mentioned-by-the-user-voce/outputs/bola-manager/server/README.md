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

Firebase Admin e inicializado somente no servidor e expoe Auth, Firestore e, quando `FIREBASE_STORAGE_BUCKET` foi definido, Storage. O upload de imagens tambem pode usar Cloudinary sem alterar Auth ou Firestore. Formas de credencial Firebase suportadas:

- `FIREBASE_SERVICE_ACCOUNT_JSON` com o JSON completo;
- `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL` e `FIREBASE_PRIVATE_KEY`;
- Application Default Credentials com `FIREBASE_USE_APPLICATION_DEFAULT=true` ou `GOOGLE_APPLICATION_CREDENTIALS`.

REST exige `Authorization: Bearer <Firebase ID token>`. Socket.IO exige `handshake.auth.token`. O UID e o nome sempre sao derivados do token; IDs enviados no corpo sao ignorados.

Para desenvolvimento local sem credenciais, habilite explicitamente `ALLOW_DEMO_AUTH=true`. REST passa `x-demo-user-id` e `x-demo-user-name`; Socket.IO passa `auth: { userId, name }`. Esse fallback e recusado quando `NODE_ENV=production`. O mesmo opt-in seleciona o RoomStore em memoria; fora dele, Firestore e obrigatorio.

O Editor da Base fica disponível para toda conta Firebase autenticada, porque cada UID recebe uma base isolada em `catalogDatabases/{uid}`. Contas demo continuam sem Editor. Na primeira leitura, o catálogo legado global é clonado uma única vez para manter compatibilidade; alterações seguintes pertencem somente àquela conta.

Para imagens sem Firebase Storage, configure no backend `MEDIA_STORAGE_PROVIDER=cloudinary` e `CLOUDINARY_URL=cloudinary://API_KEY:API_SECRET@CLOUD_NAME`. Tambem e aceito o trio `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`. Nunca use prefixo `VITE_`: o segredo assina uploads somente no Railway. `auto` (padrao) prefere Cloudinary quando suas credenciais estao completas e, caso contrario, usa Firebase Storage.

## Contrato REST

Todas as rotas abaixo, exceto `/health`, sao autenticadas:

- `GET /health`: saude e modos ativos, sem dados privados.
- `GET /api/rooms`: somente salas que contem o UID autenticado.
- `POST /api/rooms`: `{ name, clubId?, activeLeagues?, seasonLength?, unlimitedSeasons?, maxManagers? }`. `unlimitedSeasons` e booleano e usa `false` por padrao.
- `GET /api/rooms/:code`: somente membros; nao revela se uma sala de terceiros existe.
- `POST /api/rooms/:code/join`: `{ clubId? }`. Para membro de sala ativa, funciona apenas como resume e nao altera nome, clube ou revisao.
- `PATCH /api/rooms/:code/ready`: `{ ready, clubId? }`.
- `POST /api/rooms/:code/start`: corpo vazio; somente o criador.
- `GET /api/rooms/:code/career`: snapshot privado de carreira do clube do manager, com elenco principal, Sub-20, contratos, treino e convocações.
- `PUT /api/rooms/:code/career/training`: salva `{ focus, intensity, playerIds? }` para o clube do manager.
- `POST /api/rooms/:code/career/contracts/renew`: renova `{ playerId, seasons, wage? }` quando o atleta pertence ao clube.
- `POST /api/rooms/:code/career/academy/promote`: promove `{ playerId }` do Sub-20 e cria contrato profissional.
- `GET /api/teams`: consulta `brasfootClubs`, com filtros opcionais `country`, `division` e `limit`.
- `GET /api/teams/:clubId/star-impact`: resume estrelas ativas, bonus de forca e projecao comercial do clube; sem catalogo devolve impacto zero.
- `GET /api/teams/:clubId/players`: lista somente jogadores ativos do clube, ordenados por overall, nome e ID.
- `GET /api/tournaments`: consulta apenas torneios ativos e busca por ID somente os clubes referenciados por eles; devolve configuracao, imagem do trofeu e participantes ativos (incluindo URL/path do escudo).
- `GET /api/editor/access`: informa `{ canEdit }` para o usuario autenticado.
- `GET /api/editor/catalog?limit=50`: bootstrap limitado para editores autorizados. Preserva as listas `{ leagues, clubs, players, tournaments }` e acrescenta `meta.<entity> = { count, returned, limit, nextCursor, hasMore, filters }`. O limite padrao e 50 por entidade e o maximo e 200; portanto esta rota nunca carrega todos os jogadores.
- `GET /api/editor/database/export`: baixa a base pessoal como pacote JSON `bola-manager-database` versão 1. O pacote inclui campos extras persistidos e URLs públicas, mas remove `crestImagePath`, `avatarImagePath` e `trophyImagePath` para não transferir permissão de apagar a mídia de outra conta.
- `POST /api/editor/database/import`: recebe o pacote como `application/octet-stream`, valida formato, versão, IDs duplicados, referências e limites antes de combinar os registros por ID. O limite do arquivo é 24 MB e o modo atual é `merge`.
- `GET /api/editor/:entity?limit=50&cursor=<opaco>&query=<prefixo>&clubId=<id>`: pagina uma entidade (`leagues`, `clubs`, `players` ou `tournaments`) por nome. `query` e uma busca de prefixo sensivel a maiusculas/minusculas. `clubId` e aceito somente para `players`. A resposta usa `{ entity, records, count, returned, limit, nextCursor, hasMore, filters }`; o cliente deve repetir exatamente os mesmos filtros ao reutilizar `nextCursor`.
- `POST/PATCH/DELETE /api/editor/:entity/:id?`: cria, altera, arquiva ou exclui `leagues`, `clubs`, `players` e `tournaments` via Firebase Admin. `DELETE` tambem tenta remover a midia associada e devolve `{ deleted, id, mediaRemoved }`; falha de Storage nao desfaz a exclusao e aparece como `mediaRemoved: false`.
- `POST /api/editor/media?entity=clubs|players|tournaments&id=<id>&kind=crest|avatar|trophy`: recebe a imagem como corpo binario `image/png`, `image/jpeg` ou `image/webp`, com limite de 5 MB. O registro precisa existir. O servidor gera o caminho, grava no provedor configurado (Cloudinary ou Firebase), associa URL/path ao registro e remove a imagem anterior depois da substituicao. Retorna `{ media, record, previousMediaRemoved }`.
- `DELETE /api/editor/media?entity=clubs|players|tournaments&id=<id>&kind=crest|avatar|trophy`: desassocia URL/path e tenta remover o objeto anterior. Retorna `{ record, mediaRemoved }`; `false` indica apenas que a limpeza do objeto precisa ser repetida.
- `GET /api/matches/:code/fixture?fixtureId=abertura`: fixture resolvido pelo servidor.
- `GET /api/market/:code`: snapshot privado do mercado da sala (`{ snapshot }`), incluindo saldo do clube, anuncios, candidatos, propostas visiveis, emprestimos e transacoes.
- `GET /api/news/:code`: posts persistidos da sala, ordenados do mais novo para o mais antigo.
- `POST /api/news/:code/ai`: gera radar e repercussao, sincroniza os posts editoriais da sala para que comentarios sejam persistentes e devolve `{ teamComment, replies, posts }`; corpo `{ posts }` validado.
- `POST /api/news/:code/posts`: publica `{ message }`, deriva autor do token, gera a repercussao inicial e, quando a declaracao e noticiavel, uma materia editorial separada. Persiste e emite cada `news:post`.
- `POST /api/news/:code/posts/:postId/comments`: publica `{ message, parentCommentId? }`, valida o encadeamento no post da sala, persiste a resposta do manager e a replica do personagem e emite o post atualizado.

Respostas de sala usam `{ room }`; listagem usa `{ rooms }`. Erros usam `{ error: { code, message, details? } }`. Datas sao strings ISO 8601. Cada Room inclui `revision`, incrementada na mesma transacao Firestore que persiste uma mutacao. O calendario usa `currentFixtureId`, `completedFixtureIds`, `completedMatches` e `lastCompletedMatch`. A carreira expoe `unlimitedSeasons`, `currentSeason`, `seasonYear`, `seasonStartedAt`, `seasonHistory`, `careerCompleted` e `careerCompletedAt`.

### Persistencia de saves

Saves novos usam `saveSchemaVersion: 2` e
`saveStorageFormat: firestore-sections-v2`. O documento `rooms/{code}` e um
manifesto compacto: metadata de lobby/carreira, contagens, descritores das secoes,
checksum `saveCommitId` e, durante manutencao, o lease ativo. Dados volumosos nao
ficam no documento raiz.

#### Divisao fisica e paginas dinamicas

```text
rooms/{code}
|-- catalog/{manifesto-de-secao}
|-- catalog/page--{sha256}
|-- catalog/page-index--{sha256}
|-- career/{manifesto-de-secao}
|-- career/page--{sha256}
|-- career/page-index--{sha256}
|-- maintenance/{leases-e-marcas-de-gc}
`-- migrations/{backup-do-legado}
```

`catalog` guarda definicoes e snapshots de competicoes, torneios e demais dados
de referencia. `career` guarda estado mutavel, mercado, partidas, historicos e
sistemas profissionais. Agregados grandes, como `marketState` e
`clubCareerState`, sao divididos mais um nivel para uma alteracao localizada nao
reescrever todos os seus ramos.

Valores pequenos ficam no manifesto da secao. Arrays grandes sao divididos em
paginas com alvo de 240 KB; objetos extensos usam gzip e, quando necessario,
fragmentos. Todo documento respeita margem segura de 850 KB. Paginas sao
imutaveis e enderecadas por SHA-256, portanto conteudo identico e reutilizado
entre geracoes.

Nao existe mais limite fixo de sete partes. Cada manifesto paginado aponta apenas
para a raiz, profundidade e contagem de um indice Merkle
`content-page-index-v1`. Nos do indice tambem sao enderecados por conteudo e tem
fan-out maximo de 64. Assim, tanto paginas quanto indice crescem em novos
documentos sem fazer o manifesto raiz crescer com a quantidade total de itens.
Saves v2 antigos com `pageDocumentIds` ou paginas aninhadas em `pages/*`
continuam legiveis.

#### Escrita incremental e consistencia

`mutatePaths(code, paths, mutation)` carrega e publica somente os caminhos
declarados. Secoes cujo checksum nao mudou reutilizam manifesto, paginas e indice;
somente secoes alteradas recebem uma nova geracao. `mutate(code, mutation)` fica
reservado para operacoes que realmente dependem do estado completo.

Uma gravacao segue estas etapas:

1. adquire e renova um writer lease em `maintenance/*`;
2. prepara paginas, indice e manifestos imutaveis fora do documento raiz;
3. valida checksums e relê as secoes preparadas;
4. em transacao, confirma lease, ausencia de manutencao e `saveCommitId` esperado;
5. troca o manifesto raiz e mantem a geracao imediatamente anterior referenciada;
6. reconcilia resposta ambigua do Firestore antes de decidir se houve falha.

Conflitos otimistas recebem ate cinco tentativas. Uma queda antes da troca do
manifesto deixa a geracao anterior visivel; blobs preparados e nao publicados
viram candidatos ao GC. Writer leases e maintenance lease impedem sweep durante
escrita e escrita durante sweep. Leases expiram e recebem heartbeat, evitando
lock permanente depois de queda do processo.

#### Leitura parcial e lazy load

Use a menor leitura compativel com o caso:

- `listMetadataByManager` e `getMetadata`: somente raiz compacta;
- `getPartial(code, { excludePaths })`: sala sem ramos pesados conhecidos;
- `getPaths(code, paths)`: somente secoes solicitadas;
- `getSection(code, path, { page })`: uma pagina de array sob demanda;
- `getSectionTail(code, path)`: ultimo item sem reconstruir todo o historico.

A abertura para espectadores usa uma projecao leve e exclui historicos globais,
mercado e estados profissionais extensos. Leituras de uma geracao incompleta
reiniciam a partir do manifesto raiz, evitando combinar paginas de commits
diferentes. Novas rotas nao devem chamar a leitura/mutacao completa quando uma
projecao por caminhos resolve o caso.

#### Migracao segura de v1

Ao abrir ou alterar um documento legado (`JSON`, `gzip-json-v1` ou
`gzip-json-chunks-v1`), o adaptador migra automaticamente e de forma idempotente.
A migracao adquire writer lease, decodifica a origem, prepara todas as secoes v2,
valida cada checksum, reconstrui o Room completo e compara seu checksum canonico
com a origem. Somente depois grava auditoria em `rooms/{code}/migrations/*` e
troca o manifesto raiz em transacao. O v1 e seus chunks nao sao apagados antes
dessa validacao. Se a migracao falhar, o manifesto antigo continua sendo a fonte
ativa. Versoes superiores a 2 sao recusadas com
`SAVE_SCHEMA_VERSION_UNSUPPORTED`.

#### GC streaming e exclusao

O GC roda em duas fases sob maintenance lease. O mark percorre, via iterador, os
manifestos atuais e da geracao anterior, a arvore Merkle e as paginas; referencias
vivas viram marcas persistentes em lotes limitados, sem manter todos os IDs do
save em memoria. Se um manifesto, no ou pagina viva estiver ausente/corrompido, o
mark aborta antes de qualquer exclusao. O sweep pagina as colecoes em grupos de
200 e remove candidatos em transacoes de ate 100, sempre relendo root, lease,
writer state e marcas. Heartbeat renova o lease durante ambos os passos.

Excluir uma sala grava primeiro uma tombstone reservando definitivamente o codigo
e marcando `storageCleanupPending`. A limpeza percorre em paginas `catalog`,
`career`, indices, paginas legadas, migrations, maintenance e payloads v1; ao
terminar, finaliza a tombstone. Se o processo cair, nova tentativa continua a
limpeza sem reativar o save nem liberar o codigo.

#### Regra de deploy no Railway

`railway.json` fixa `numReplicas: 1` e `overlapSeconds: 0`. Mantenha exatamente
uma replica. Room v2 e partidas ativas sao persistidos no Firestore, mas ownership
do playback, mapa Socket.IO e sessoes temporarias de importacao ainda sao locais
ao processo. Duas replicas poderiam reproduzir a mesma partida ou separar cliente
e sessao. Escala horizontal exige antes lock distribuido de playback, adapter
Socket.IO compartilhado e armazenamento compartilhado para imports.

Torneios ficam em `tournaments` e usam `format` (`league`, `knockout` ou `groups_knockout`), `teamCount`, `legs` (`single` ou `double`), `tiebreakers`, `teamIds`, imagem de trofeu opcional e `active`. IDs de times precisam existir em `brasfootClubs`; um torneio ativo exige exatamente `teamCount` IDs e todos os clubes precisam estar ativos. O backend valida as referencias em lote quando `getAll` esta disponivel e impede arquivar um clube ainda usado por torneio ativo. Duplicatas, criterios repetidos e combinacoes incoerentes como `away_goals` com jogo unico sao recusados. A colecao `tournaments` nao permite leitura direta pelas regras do cliente; o contrato publico e somente `GET /api/tournaments`.

Uploads validam tamanho em bytes, MIME e assinatura antes do provedor. O caminho marca objetos Cloudinary para que a remocao nao os confunda com arquivos Firebase legados. Risco residual: sem uma biblioteca de decodificacao de imagens, o backend nao mede dimensoes nem pixels decodificados; uma imagem pequena comprimida pode ser um *pixel bomb*. O limite de 5 MB reduz a exposicao, mas consumidores devem impor limites de dimensao/decodificacao e a validacao completa deve ser adicionada quando houver um decoder de imagem auditado.

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
- `market:sync`: `{ code }`; ack `{ snapshot }` e reinscreve o socket no canal da sala.
- `market:offer`: `{ code, requestId, playerId, listingId?, dealType, amount, message?, loanTerms? }`.
- `market:respond`: `{ code, requestId, offerId, action, counterAmount? }`, com `action` igual a `accept`, `reject`, `counter` ou `cancel`.
- `market:list`: `{ code, requestId, playerId, mode, dealType, askingPrice?, minimumBid?, expiresInHours?, loanTerms? }`.
- `market:bid`: `{ code, requestId, listingId, amount }`.
- `market:cancel-listing`: `{ code, requestId, listingId }`. Mutacoes sao idempotentes pelo `requestId`, persistidas na Room e rejeitadas durante partidas. Depois do ack, o servidor emite `market:updated` para a sala solicitar novo snapshot.
- `match:ready`: `{ code, fixtureId?, ready }`; ack `{ room, started, readyCount, requiredCount, matchId? }`. O ultimo manager pronto inicia a transmissao.
- `match:start`: `{ code, fixtureId? }`; ack `{ matchId }`; rejeita enquanto nem todos os managers estiverem prontos.
- `match:skip`: `{ code }`; somente o owner; ack `{ skipped: true }`; emite `match:skipped`. O skip acelera somente ate o intervalo e nao ignora a confirmacao dos managers.
- `match:speed`: `{ code, matchId, speed }`, com `speed` igual a `0.5`, `1`, `2` ou `3`; somente o owner. Ack `{ changed, speed }`; emite `match:speed-changed` apenas quando a velocidade muda. O estado informa `rate`, atraso base/efetivo, autor e horario da mudanca.
- `match:halftime-plan`: `{ code, matchId, lineupIds, tactics: { mentality, instruction } }`; somente managers da fixture. Valida elenco, disponibilidade e no maximo cinco substituicoes; editar remove o proprio pronto. O ack inclui apenas o plano do manager autenticado.
- `match:halftime-ready`: `{ code, matchId, ready }`; o segundo tempo inicia somente quando todos os IDs de `fixture.managerIds` confirmarem. Espectadores nao bloqueiam nem podem confirmar.
- `match:sync`: `{ code }`; ack `{ source, phase, started, events, result, halftime, speed }`. Durante o intervalo, `halftime` inclui contagens publicas e apenas `ownPlan` do manager autenticado. Sessoes ao vivo devolvem a velocidade atual; estados ociosos ou persistidos devolvem `speed: null`.

O cliente nunca envia times, forcas ou seed. O servidor resolve esses dados pelo catalogo e pelo estado da sala. Ao iniciar a temporada, o servidor gera um `fixtureSchedule` unificado e ordenado por data, combinando ligas selecionadas e torneios personalizados. Uma fixture concluida nao pode ser repetida; a conclusao e persistida na transacao da Room, atualiza liga/grupo/chave, simula os jogos da IA da etapa, limpa `matchReadiness` e avanca `currentFixtureId` antes de emitir `match:finished`.

Ao concluir a ultima fixture, carreiras ilimitadas e carreiras finitas ainda abaixo de `seasonLength` arquivam um resumo em `seasonHistory`, incrementam `currentSeason` e `seasonYear`, aplicam promoção/rebaixamento entre divisões carregadas do mesmo país e geram o novo calendário. A transição também processa contratos, envelhecimento, evolução, aposentadoria, retorno de empréstimos, entrada anual do Sub-20 e convocações nacionais. `completedMatches` permanece como histórico global. A última temporada de uma carreira finita mantém `currentFixtureId: null` e marca `careerCompleted: true`. Saves legados assumem temporada 1, ano derivado da criação/início e `unlimitedSeasons: false`.

Jogadores do Editor usam `isStar` booleano, independente de `overall`; registros legados sem o campo equivalem a `false`. Todas as estrelas ativas contam `5%` de atratividade comercial (teto `25%`) e R$ 2.500.000 na projecao anual de patrocinio (teto R$ 12.500.000). Em campo, somente estrelas da escalacao salva somam `0.25` de forca (teto `1.0`); lesionados e suspensos sao ignorados. Sem escalacao salva, o servidor escolhe deterministicamente os 11 jogadores disponiveis de maior overall, com desempate por nome e ID. Os dois clubes sao consultados atomicamente; falha ou timeout zera ambos os bonus. O perfil aplicado fica nos metadados da partida e no resultado persistido.

## IA da rede social

Configure `GEMINI_API_KEY` apenas no processo do backend. `GEMINI_MODEL` e opcional e usa `gemini-3.5-flash` por padrao. `GEMINI_FALLBACK_MODELS` aceita modelos reserva separados por virgula e usa `gemini-3.1-flash-lite` por padrao. A chave segue para a Gemini pelo header `x-goog-api-key` e nunca entra no bundle Vite. Falhas transitorias recebem uma nova tentativa por modelo antes da troca para o modelo reserva. Saidas usam JSON estruturado, validacao Zod, timeout, cache de dez minutos e fallback local quando todos os modelos estiverem indisponiveis. Posts do manager gravados durante uma indisponibilidade sao reprocessados na proxima atualizacao bem-sucedida do feed. Posts sao tratados como conteudo nao confiavel no prompt; instrucoes escritas por usuarios nao podem substituir a persona do sistema.

Os endpoints exigem Firebase Auth e membership antes de gerar conteudo. Posts e comentarios humanos usam UID/nome derivados do token. Materias sao criadas somente para declaracoes relevantes, como anuncios, transferencias, lesoes, resultados e criticas; respostas de conversa nunca criam materia por conta propria. Metadados de provedor ficam restritos ao servidor e nao fazem parte dos contratos publicos. Em producao, a colecao `news` e escrita apenas pelo Firebase Admin; regras do cliente continuam negando acesso direto.

Os editoriais-base enviados pela interface sao identificados apenas pelas chaves `n1` a `n4`. Fonte, persona, manchete, corpo, categoria e reacoes sao reconstruidos por um catalogo canonico no servidor antes da persistencia; valores adulterados pelo cliente sao ignorados.

Chamadas de analise usam cooldown por manager/sala e limite global de concorrencia para proteger a quota. Publicacoes tambem usam cooldown e mantem o texto no cliente quando falham. A consulta Firestore usa o indice composto de `firestore.indexes.json` quando ele esta pronto. Se o indice ainda nao foi publicado, o backend consulta pela sala e ordena os resultados localmente para manter o feed disponivel; publicar o indice continua recomendado para reduzir leituras em salas grandes.

A ordem garantida e: ack do ultimo `match:ready` (ou de `match:start`), `match:started`, eventos ate `halftime`, `match:halftime`, ack do ultimo `match:halftime-ready`, `match:resumed`, eventos do segundo tempo e `match:finished`. Os payloads incluem `code` para o cliente filtrar a sala. Eventos mantem `score` como tupla `[mandante, visitante]` e `statistics` como snapshot. O intervalo padrao e 800 ms, configuravel por `MATCH_EVENT_DELAY_MS`.

A velocidade inicia em `1x` e divide o atraso base entre eventos. Uma mudanca durante uma espera reaproveita o tempo-base ja consumido e recalcula imediatamente apenas o restante. Alterar a velocidade no intervalo nao libera a pausa; o novo valor passa a valer quando todos confirmarem e o segundo tempo recomecar. Depois de `match:skip`, novas mudancas sao rejeitadas porque o avancar resultado e irreversivel.

Payload de sincronizacao:

```json
{
  "ok": true,
  "source": "live | persisted | idle",
  "phase": "running | halftime | finished",
  "started": "metadados de match:started ou null",
  "events": "eventos enriquecidos ja emitidos, ou []",
  "result": "resultado concluido/resumo persistido, ou null",
  "halftime": "estado do intervalo para este manager, ou null",
  "speed": "velocidade ao vivo, ou null"
}
```

`source: "live"` devolve a sessao em andamento, inclusive quando ela acaba de ser
reidratada de `activeMatches` depois de reinicio. Snapshot ativo persiste partida,
cursor, eventos emitidos, velocidade, intervalo, planos e prontidao; o playback
continua do proximo evento sem repetir o primeiro tempo. `source: "persisted"`
representa a ultima partida ja concluida e devolve `lastCompletedMatch` com seus
eventos, quando presentes. Sem partida iniciada ou concluida, a resposta usa
`source: "idle"`.

## Persistencia de salas

`RoomStore` depende de uma interface de persistencia. `FirestoreRoomPersistence` usa criacao atomica e transacoes para entrada, escolha de clube, prontidao, inicio e conclusao de fixture; a gravacao termina antes de qualquer broadcast ou ack. Ao excluir, substitui o documento por uma tombstone minima `{ code, deleted: true }`: dados do save e managers somem, mas o codigo nunca pode ser reutilizado por outra temporada nem herdar news/market antigos. `MemoryRoomPersistence` aplica a mesma reserva com um conjunto de codigos excluidos e existe apenas para teste/demo explicitamente habilitado.

## Importacao Brasfoot

O Editor envia `.ban`, `.cfg` e `.png` por sessoes temporarias da base pessoal. O fluxo usa `POST /api/editor/brasfoot-import/sessions`, `PUT .../files`, `POST .../preview`, `POST .../commit` e `DELETE` para descarte. Cada sessao pertence ao UID que a criou, grava somente na base desse UID, expira em 30 minutos e aceita ate 200 arquivos, 32 MB por arquivo e 256 MB no total. O commit e bloqueado quando a previa possui erros, salvo confirmacao explicita de importacao parcial.

As sessoes ficam no disco temporario do processo. Em producao, mantenha uma replica durante cada upload ou configure afinidade de sessao antes de escalar horizontalmente. O commit monta uma geracao isolada, ativa tudo em uma unica transacao, aplica merge idempotente e compensa escudos enviados quando ocorre rollback.

Como alternativa de automacao, `scripts/import-brasfoot.mjs` recebe JSON normalizado, `.ban`, `.cfg`, `teams` ou a raiz do Brasfoot. O leitor de Java Serialization e data-only e nao instancia classes. Consulte [o guia do importador](../scripts/BRASFOOT_IMPORT.md) para o modo CLI, limites e reconciliacao.
