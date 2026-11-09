# Fase 4 — Homologação de Segurança e Infraestrutura

## Persistência de partidas — adaptação local concluída para revisão, 2026-09-30

**Implementada e validada localmente; aguardando revisão antes de publicação.**
Branch `codex/ci-e2e`, HEAD preservado
`f59c83a5af499368b6cb43d797ba1c4c9164c0d6`.
Não houve stage, commit, push, deploy, alteração de IAM, credenciais, Redis,
Firebase remoto ou réplicas. As seções anteriores abaixo são histórico;
**Timeout controlado: FALHOU** e **Cleanup: FALHOU** permanecem registrados.

### Arquitetura, transação e orçamento

- Antes: `DocumentReference.get` / `runTransaction` protegidos por timeout da
  Promise; RPC/retries continuavam ativos e `terminate()` aguardava seu término.
- Agora, somente `activeMatches`: cliente público `v1.FirestoreClient` com
  transporte REST oficial (`fallback: true`), usando `getDocument`,
  `beginTransaction`, `commit`, `rollback`, `initialize` no harness e `close`.
  Cancelamento pelo `CancellablePromise.cancel()` público do GAX aborta a
  requisição HTTP real, inclusive corpo incompleto. Nenhuma API privada usada.
- A tentativa com v1/gRPC instalado ainda deixou socket de handshake TCP
  silencioso aberto após cancelamento/close. Foi descartada. O transporte REST
  foi escolhido após provar fechamento natural do socket no mesmo tipo de falha.
- Interface do consumidor `get/has/save/remove`, coleção, documentos,
  tombstones, ownership, gerações, sequências e códigos de fencing preservados.
  Somente a composição interna fornece a factory v1; demais stores, readiness
  e Auth continuam usando Firebase Admin como antes. Sem dual-write.
- `beginTransaction` → leitura com o mesmo token transacional → validação do
  ownership/fencing/sequence → `commit` com esse token. Não existe escrita
  independente da transação. Falha antes do commit tenta rollback dentro do
  orçamento; após expiração, nenhum RPC novo, nem rollback, pode começar.
- Deadline monotônico único de **15000 ms**, criado antes do cliente. Cada RPC
  recebe somente o restante. Inicialização, etapas e backoff não reiniciam o
  orçamento. A margem de regressão é 2 s para scheduler/CI, não para o produto.
- Retry GAX desativado explicitamente (`retry: null`). Apenas resposta
  `ABORTED` permite refazer a transação inteira, no máximo cinco tentativas,
  com backoff 20/40/80/160 ms debitado do mesmo orçamento.
- Commit enviado e resposta perdida: erro preservado com `commitOutcome=unknown`;
  sem retry/rollback cego e sem sucesso presumido. Cancelamento local não prova
  rollback remoto. Regressão confirma commit aceito antes do timeout e nenhuma
  segunda escrita iniciada. Fencing/sequence continuam rejeitando estado antigo.
- Cleanup cancela a chamada ativa, fecha o cliente e preserva
  `MATCH_PERSISTENCE_TIMEOUT` com causa `DEPENDENCY_TIMEOUT`, mesmo se close
  falhar. O header público `Connection: close` evita sockets HTTP idle. O GAX
  instalado pode não liquidar sua Promise após abortar um corpo; a camada
  liquida a própria operação depois do cancelamento real, sem aguardar essa
  Promise inerte. Não se trata apenas de `Promise.race`.

### Paridade e limites de compatibilidade

Paridade saudável comparada ao SDK anterior contra servidor wire loopback:
documento escrito/lido, mapas, arrays, null, boolean, integer/double,
NaN/Infinity, strings ISO, omissão de undefined e tombstone. Duas transações
concorrentes provocam ABORTED e nova leitura; estado mais novo não é perdido.
Token antigo mantém `MATCH_OWNERSHIP_LOST`, sem sobrescrever estado novo.

Snapshots produzidos pelo jogo são dados plain com datas ISO. Date, Timestamp,
DocumentReference, FieldValue e arrays diretamente aninhados são rejeitados
explicitamente com `MATCH_PERSISTENCE_DATA_INVALID`. O codec REST instalado
normaliza `-0`; esse valor também é rejeitado para evitar alteração silenciosa.
Esta restrição é um limite de compatibilidade para revisão, não suporte a todos
os tipos do SDK. Nenhuma migração de documentos foi executada.

Clientes por operação e conexões fechadas por RPC aumentam overhead HTTP/TLS.
Desempenho e integração com Firestore remoto dessa adaptação ainda não foram
homologados; nenhuma medição local é apresentada como homologação remota.

### Reprodução do servidor TCP silencioso, orçamento original de 15000 ms

Repetido somente para partidas, conforme escopo; readiness não foi migrado nem
reexecutado neste harness. SDK v1 real, TCP loopback, subprocesso isolado,
credencial sintética local, sem acesso a Google. Cleanup medido até fechamento
natural de todos os sockets e do listener, sem encerramento forçado do filho.

| Execução | Timeout público | Cleanup adicional | Sockets antes/depois | RPC após deadline | Exit |
| --- | ---: | ---: | --- | ---: | ---: |
| 1 | 15004 ms | 2,729 ms | 1 → 0 | 0 | 0 |
| 2 | 15003 ms | 2,237 ms | 1 → 0 | 0 | 0 |

Ambas preservam `MATCH_PERSISTENCE_TIMEOUT` / `DEPENDENCY_TIMEOUT`.
Também passaram TCP recusado, HTTP com corpo travado, shutdown saudável e
cancelamento de operação ativa. Leitura/auth liberadas após timeout não
iniciaram request/commit tardio. No caso separado de commit já enviado, a
resposta é indeterminada e não há alegação de rollback.

| Item pós-correção local | Status | Evidência |
| --- | --- | --- |
| Firestore timeout pós-correção | VALIDADO | 2/2 reproduções, aproximadamente 15000 ms |
| Firestore cleanup pós-correção | VALIDADO | 2/2 encerramentos naturais; sockets 1 → 0 |
| Escrita tardia pós-timeout | VALIDADO | 0 RPC novo após deadline; release controlado de leitura/auth |
| Atomicidade e concorrência | VALIDADO | commit transacional; ABORTED com nova leitura; sem lost update |
| Fencing | VALIDADO | novo aceito, antigo rejeitado; estado novo preservado |
| Integração remota pós-adaptação | NÃO EXECUTADO | publicação/deploy dependem de revisão |

### Validação final

| Execução | Pass | Fail | Cancel | Skip | Exit |
| --- | ---: | ---: | ---: | ---: | ---: |
| Regressões v1 + ownership/resiliência/coordenação | 33 | 0 | 0 | 0 | 0 |
| Firestore/readiness/ownership/infraestrutura relacionados | 97 | 0 | 0 | 0 | 0 |
| Server completo | 1429 | 0 | 0 | 1 | 0 |
| Frontend | 194 | 0 | 0 | 0 | 0 |
| E2E Chrome | 4 | 0 | 0 | 0 | 0 |

O único skip exige `TEST_REDIS_URL`. Grupos se sobrepõem; não somar como testes
únicos. Audit: **0 vulnerabilidades**. Typecheck, build e `git diff --check`
passaram; build mantém aviso preexistente de chunks acima de 500 kB.
Execuções com `BOLA_ENV_FILES=false`; `.env.local` não lido.

Primeira suíte completa desta adaptação: 1425 pass, 3 fail, 0 cancel, 1 skip.
As três falhas ocorreram no bootstrap de `coordinationAvailability`: mock
Firebase não fornecia a nova factory. Atualizado somente o contrato do harness,
sem mudar assertivas ou regras de coordenação. Regressão 7/7 e suíte final verde.

Evidências locais ignoradas: `.tmp/match-v1-reproduction-1.json`,
`.tmp/match-v1-reproduction-2.json`, `.tmp/match-v1-reproductions-final.log`,
`.tmp/match-v1-specific-final.log`, `.tmp/match-v1-related-final.log`,
`.tmp/match-v1-server-final.log`, `.tmp/match-v1-frontend.log`,
`.tmp/match-v1-e2e-final.log`, `.tmp/match-v1-audit.json`,
`.tmp/match-v1-typecheck.log` e `.tmp/match-v1-build.log`.

### Arquivos do escopo

Modificados (6): `server/index.mjs`, `server/services/firebaseAdmin.mjs`,
`server/store/matchSessionPersistence.mjs`,
`server/tests/matchPersistenceResilience.test.mjs`,
`server/tests/matchSessionOwnership.test.mjs`, `server/tests/testHarness.mjs`.

Novos (7): `server/store/matchFirestoreRpc.mjs`,
`server/store/matchFirestoreValues.mjs`, `server/tests/matchFirestoreRpc.test.mjs`,
`server/tests/helpers/fakeMatchFirestoreV1.mjs`,
`server/tests/helpers/matchFirestoreServer.mjs`,
`server/tests/fixtures/matchFirestoreLifecycle.mjs`,
`server/tests/fixtures/matchFirestore.proto`.

Código/testes: **13 arquivos, +884/-87**. Este relatório local preexistente foi
atualizado separadamente e permanece não rastreado. Dependências/lockfile
inalterados. Varredura dos arquivos do escopo não encontrou credenciais reais.
Arquivos externos preexistentes, envs, `.tmp`, logs e evidências fora do index.

## Firestore — investigação das APIs de cancelamento, 2026-09-26

**CORREÇÃO NÃO IMPLEMENTADA.** A abordagem mínima investigada não demonstrou
cancelamento integral da operação de alto nível. Nenhum código da aplicação,
dependência, timeout de produto ou recurso remoto foi alterado nesta investigação.
Os resultados históricos **Timeout controlado: FALHOU** e **Cleanup: FALHOU**
permanecem válidos e estão preservados abaixo.

Versões instaladas verificadas: `firebase-admin 13.10.0`,
`@google-cloud/firestore 7.11.6`, `google-gax 4.6.1` e
`@grpc/grpc-js 1.14.4` no caminho efetivamente resolvido pelo GAX.

### Superfície pública e limite encontrado

- `DocumentReference.get`/`Firestore.runTransaction` não expõem `AbortSignal`,
  `CallOptions` ou um handle cancelável da operação completa.
- `Firestore.terminate()` não oferece opção pública de force-close. A
  implementação instalada aguarda as operações em andamento antes de fechar
  os clientes; esse comportamento foi inspecionado, não modificado.
- O cliente público `v1.FirestoreClient` oferece `CallOptions.timeout`, opções
  de retry e streams canceláveis. É uma alternativa disponível sem upgrade,
  mas seu uso exige adaptar explicitamente leitura, transação, serialização,
  retries e fechamento no consumidor atual; não é apenas uma troca de timeout.
- O hook público gRPC `callInvocationTransformer` permite aplicar deadline e
  obter `SurfaceCall.cancel()`, mas cancelar uma chamada de transporte não
  cancela necessariamente a operação composta/retries do Firestore/GAX.

Experimento **descartado**, apenas local: `.tmp/firestore-rpc-spike.mjs` usou
SDK real, listener TCP loopback silencioso, deadline experimental de 2500 ms e
cancelamento público. Foram observados status gRPC `CANCELLED` (1) e
`DEADLINE_EXCEEDED` (4), seguidos por novas tentativas. O watchdog de contenção
do experimento, programado para 8500 ms, encontrou um socket ainda aberto.
Foi necessário encerrar o processo local. Esse experimento não é regressão
aprovada nem substitui o cenário original de persistência de **15000 ms**.
O processo local terminou; nenhum serviço real foi acessado.

Também não se deve confundir cancelamento do cliente com rollback de um
Commit já aceito pelo servidor. A regressão de escrita tardia precisa distinguir
uma leitura/transação bloqueada antes do commit de resultado de commit ambíguo.
Não foi alegada garantia de ausência de escrita remota com base somente em
um erro local de timeout.

| Item | Status nesta investigação |
| --- | --- |
| Firestore timeout pós-correção | NÃO EXECUTADO — não há correção aprovada |
| Firestore cleanup pós-correção | NÃO EXECUTADO — não há correção aprovada |
| Escrita tardia pós-timeout | NÃO EXECUTADO |
| Regressões novas / suíte completa / deploy | NÃO EXECUTADO |

Próximo caminho proposto: adaptação restrita da persistência ao cliente público
`v1.FirestoreClient`, com orçamento absoluto compartilhado entre chamadas,
cancelamento da operação e impedimento de novos commits/retries após expiração.
Preservar fencing, revisões, erros públicos e semântica transacional; avaliar
explicitamente o resultado ambíguo de Commit. Não há evidência de que um upgrade
isolado de SDK resolva o problema; nenhum upgrade foi realizado.

Referências públicas:
- [API Firestore](https://googleapis.dev/nodejs/firestore/latest/Firestore.html)
- [Call options e cancelamento GAX](https://github.com/googleapis/gax-nodejs/blob/main/client-libraries.md)
- [Semântica de cancelamento gRPC](https://grpc.io/docs/guides/cancellation/)

## Firebase/Firestore — campanha interrompida por cleanup reproduzido, 2026-09-26

**NÃO CONCLUÍDA.** Encontrada falha concreta de encerramento no cenário
Firestore silencioso, reproduzida uma vez (2/2). Conforme a condição de parada,
nenhuma correção foi aplicada e os demais cenários operacionais foram suspensos.
Não é evidência de bypass de autenticação, autorização ou fencing.

### Método informado antes da execução

| Cenário | Método | Impacto | Reversão |
| --- | --- | --- | --- |
| Credencial inválida | Credencial sintética inválida em subprocesso | Apenas inicialização local | Encerrar processo |
| Permissão negada (planejado, não executado) | Token temporário de staging sem escopo Firestore, apenas no harness | Requisições negadas; sem alteração IAM | Descartar token |
| Timeout | SDK Firestore instalado contra listener TCP silencioso loopback | Processo e sockets locais, sem acesso à base real | Fechar listener/subprocesso |
| Readiness/ownership | Helpers reais com cliente defeituoso isolado | Sem modificar backend real | Descartar cliente |
| Recuperação (planejada, não executada) | Cliente válido e documento exclusivo | Somente fixture própria | Conferir ownership e remover |

O contexto de OAuth insuficiente planejado validaria recusa por escopo, não
remoção de role IAM. Nenhum token desse cenário foi emitido, nenhuma identidade
foi criada e nenhuma key/IAM foi alterada: a campanha parou nos testes locais.
Não houve leitura de `.env.local` nem alteração das credenciais das réplicas.

### Credencial inválida

Subprocesso com ambiente explicitamente filtrado e `BOLA_ENV_FILES=false`,
ADC desativado, sem credenciais reais. `initializeFirebaseAdmin` recebeu uma
service account **sintética**, com PEM inválido e project ID de staging.

- Rejeição explícita: `app/invalid-credential`.
- `publicError`: HTTP 500, `SERVER_ERROR`, mensagem genérica. Asserção garante
  que o marcador da credencial sintética não aparece na resposta sanitizada.
- Factory em modo `firestore`, sem cliente disponível, rejeitou em vez de
  selecionar memória. `ALLOW_DEMO_AUTH=false`.
- Processo encerrou naturalmente: exit 0, signal null, stderr 0 bytes,
  zero conexões aceitas/residuais. Nenhuma escrita ocorreu.
- Limite: cobre inicialização inválida, não token revogado ou falha de OAuth
  durante uma operação já inicializada.
- Evidência local:
  `.tmp/security-staging/security-validation-1790464381616-e8ccbbb28d74d2e8-firestore-invalid.json`.

### Timeout e reprodução

O harness usa `@google-cloud/firestore` real, com configuração pública
`host=127.0.0.1:<porta efêmera>` e `ssl=false` **somente no subprocesso**.
O listener aceita TCP e não responde ao handshake. Não é um mock de Promise,
não altera gRPC internals, não acessa Firestore remoto e não usa credenciais
reais. Apenas duas leituras sobre paths próprios do run-id: readiness e
`FirestoreMatchSessionPersistence.get` via factory real.

Timeouts de produto preservados: readiness **2500 ms**, persistência
**15000 ms**. Depois da rejeição, observação de **3000 ms** para o cleanup;
mais 1000 ms de segurança antes de encerrar o subprocesso local. Esses limites
são do harness, não aumentam/redefinem os timeouts do aplicativo.

| Execução | Readiness | Persistência | Cleanup observado | Sockets antes do cleanup forçado | Encerramento |
| --- | --- | --- | --- | --- | --- |
| Inicial | timeout em 2502 ms | rejeição em 15002 ms | `terminate()` pendente após 3001 ms; total 18003 ms | 1 | Harness precisou forçar; SIGTERM |
| Reprodução | timeout em 2502 ms | rejeição em 15004 ms | `terminate()` pendente após 3001 ms; total 18005 ms | 1 | Harness precisou forçar; SIGTERM |

Ambas retornaram `MATCH_PERSISTENCE_TIMEOUT`, status 503, mantendo
`cause.code=DEPENDENCY_TIMEOUT` e `cause.name=TimeoutError`. Readiness retornou
`ok=false`, `status=timeout`. Não houve sucesso falso nem seleção de persistência
em memória nos caminhos exercitados.

Cada execução aceitou um socket, recebeu apenas 39 bytes de handshake e
manteve esse socket aberto até intervenção do harness. Cleanup de contenção:
socket loopback destruído, listener fechado e filho encerrado; **zero resíduos
locais finais**. Isso não converte o cleanup automático em sucesso.
Os dois coordenadores terminaram exit 1, registrando a falha esperada; filhos
forçados: exitCode null, signal SIGTERM, stderr 0 bytes.

Evidências preservadas, somente locais:

- `.tmp/security-staging/security-validation-1790464395589-35c91756764be78c-firestore-silent.json`;
- `.tmp/security-staging/security-validation-1790464443932-3b5390c20eb4dfa2-firestore-silent.json`.

Harness: `.tmp/firestore-failure-child.mjs` e
`.tmp/firestore-failure-local.mjs`.

### Causa comprovada e impacto delimitado

1. `server/infrastructure/readiness.mjs:11`: `withTimeout` faz `Promise.race`;
   a rejeição do timeout não cancela o RPC subjacente.
2. `server/store/matchSessionPersistence.mjs:93`: `boundedOperation` limita a
   espera e preserva a causa, mas não recebe/interrompe um handle cancelável.
3. No SDK instalado, `Firestore.terminate()` delega ao pool; o pool aguarda
   `opCount` chegar a zero **antes** de fechar os clientes gRPC.
4. O RPC continua pendente além do deadline do aplicativo. A configuração
   instalada de `BatchGetDocuments` tem timeout próprio de **300000 ms** e
   configuração de retry com orçamento de **600000 ms**, não os 2500/15000 ms
   do aplicativo. Esses valores não foram alterados.

Portanto o deadline de resposta não garante liberação de recursos/encerramento
limitado. Foi comprovada espera além do orçamento observado, **não espera
literalmente infinita**: o harness não aguardou os deadlines maiores do SDK.
O cenário é de leitura; não demonstra escrita tardia, corrupção ou perda de
ownership, que continuam sem teste nesta rodada.

Inspeção complementar: `server/index.mjs:486` fecha Socket.IO/importador/Redis,
mas não inclui explicitamente Firestore no fechamento. Isso exige revisão ao
definir o ciclo de vida do cliente; o shutdown completo do backend não foi
executado e não é classificado como outra reprodução operacional.

### Correção mínima proposta — NÃO implementada

- Propagar um deadline/cancelamento efetivo até os RPCs Firestore usados por
  readiness/persistência, via API pública suportada do SDK/GAX, compatível com
  os orçamentos existentes. O cliente instalado aceita `clientConfig`; revisar
  timeout e orçamento de retries por método, sem presumir que apenas timeout
  externo ou `terminate()` cancele operações pendentes.
- Integrar encerramento explícito e limitado do cliente ao ciclo de vida que
  o possui, depois de interromper operações pendentes. Não fechar clientes
  compartilhados/injetados que pertençam a outro proprietário.
- Preservar `MATCH_PERSISTENCE_TIMEOUT` e sua causa original; nunca selecionar
  memória, aumentar timeouts do produto, usar internals privados ou depender
  de `process.exit` como correção.
- Acrescentar regressão TCP silenciosa exigindo rejeição limitada, término
  natural e zero sockets **antes** de qualquer cleanup forçado; depois validar
  escrita/transação/ownership e recuperação com fixture de staging.

### Resultado desta rodada

| Cenário | Status | Evidência |
| --- | --- | --- |
| Credencial inválida | VALIDADO | Inicialização rejeitada; erro público sanitizado; exit natural 0 |
| Permission denied leitura | NÃO EXECUTADO | Campanha parada antes do contexto sem permissão |
| Permission denied escrita | NÃO EXECUTADO | Nenhuma escrita real realizada |
| Transação sem permissão | NÃO EXECUTADO | Parada por bug reproduzido |
| Readiness com Firestore inválido | PARCIALMENTE VALIDADO | Helper real retorna indisponibilidade por timeout; permissão/auth em operação não exercitadas |
| Sem fallback inseguro | PARCIALMENTE VALIDADO | Factory e leitura sob falha permanecem fail-closed; demais caminhos pendentes |
| Ownership fail-closed | NÃO EXECUTADO | Não extrapolar homologação anterior de fencing |
| Timeout controlado | FALHOU | Resposta limitada e causa preservada, mas RPC/socket e cleanup continuam pendentes |
| Cleanup | FALHOU | Encerramento automático falhou 2/2; contenção externa deixou zero resíduos |
| Recovery | NÃO EXECUTADO | Nenhuma fixture remota criada antes da parada |

Validação executada: credencial inválida 1/1; cenário silencioso falhou 2/2;
harness parseável; `git diff --check` sem erros. Regressões versionadas não foram
adicionadas. Por causa da condição explícita de parada, testes relacionados,
suítes server/frontend/E2E, audit, typecheck e build **não foram reexecutados**
nesta rodada. Resultados históricos verdes não são apresentados como atuais.

### Estado real final — leitura em 2026-09-26 23:15 UTC

- Backend original `0cd459df-bf43-4afb-92f6-8396fc8f6d65`: **SUCCESS**,
  commit `f59c83a5af499368b6cb43d797ba1c4c9164c0d6`, duas réplicas `us-west2`.
- R1 `30f73e77-3167-48d2-85b9-5e27e4083861`: `/ready` **200**,
  `firestore=ready`, `redis=ready`.
- R2 `cfef3a48-d229-42fb-b31b-d89fe9d5d63d`: `/ready` **200**,
  `firestore=ready`, `redis=ready`.
- Frontend: **HTTP 200**. Não houve interrupção Redis, troca de credencial,
  alteração IAM, projeto Firebase, quantidade de réplicas ou deploy.
- Nenhum usuário, documento ou identidade temporária remota criado; nenhum
  resíduo remoto desta execução. Zero sockets/listeners/subprocessos locais
  residuais após contenção explícita.
- Evidência somente local: `.tmp/security-staging/firestore-failure-final-status.json`.
- Alterações limitadas a este relatório e harness/evidências `.tmp`; arquivo
  externo preexistente intocado. Sem commit/push. Correção aguarda revisão.

## Redis real — outage reversível e recuperação, 2026-09-25 UTC

Esta rodada retoma apenas a indisponibilidade do Redis dedicado de staging.
As seções anteriores cronologicamente, mantidas abaixo, são histórico: seus
resultados não foram apagados nem convertidos retroativamente em sucesso.

- Branch/commit inalterados: `codex/ci-e2e`,
  `f59c83a5af499368b6cb43d797ba1c4c9164c0d6`.
- Backend deployment, antes e depois: `0cd459df-bf43-4afb-92f6-8396fc8f6d65`,
  **SUCCESS**, duas réplicas `us-west2`.
- R1: `30f73e77-3167-48d2-85b9-5e27e4083861`.
- R2: `cfef3a48-d229-42fb-b31b-d89fe9d5d63d`.
- Redis: serviço `6bb50156-7104-46f7-b8f6-696c70c81b1c`, deployment
  `6713fa9b-9bd2-4ba8-b318-a2d19a5febe5`, imagem `redis:8.2`.
- Volume original `/data`: `3cc4200e-7ab3-4403-8074-f24389f860ec`.
- Run-id: `security-validation-1790295407250-2bd2bd4351d908b97cd7`.
- Evidência sanitizada, **somente local**:
  `.tmp/security-staging/security-validation-1790295407250-2bd2bd4351d908b97cd7-redis-outage.json`.
- Harness local: `.tmp/redis-outage-operational.mjs` e
  `.tmp/redis-outage-worker.mjs`. Nenhum arquivo de runtime foi modificado.

### Mecanismo e baseline

| Ação | Comando/API oficial | Reversão | Risco delimitado |
| --- | --- | --- | --- |
| Interromper somente o deployment Redis identificado | Railway `deploymentStop(id)` | `deploymentRestart(id)` do mesmo deployment | Indisponibilidade temporária da coordenação em staging |
| Restaurar Redis | Railway `deploymentRestart(id)` | Imagem, configuração e volume originais preservados | Latência de reconexão |

O mecanismo foi apresentado antes da execução. Foi feita **uma** chamada stop
e **uma** restart, ambas confirmadas pela API. Restauração em `finally`, com
watchdog de 45 s; o watchdog não precisou atuar. Não houve delete, alteração de
configuração, rebuild, deploy de código ou restart do backend.

Antes da interrupção: `/ready` público e direto por réplica HTTP 200;
Firestore/Redis `ready`; frontend HTTP 200; identidade, deployment e hashes dos
módulos conferidos nas duas sessões SSH; Socket.IO autenticado e room própria
autorizados nas duas réplicas; lock adquirido/liberado (fence 1); rate fixture
com contador 1. A credencial temporária ficou somente em memória/stdin.

Primitivas usadas sem mocks/fallback: `createDistributedLock`,
`createDistributedRateLimiter`, `createRedisRuntime` e
`FirestoreMatchSessionPersistence.save`. Redis acessado somente pela rede
privada dentro das réplicas. O limiter da fixture usa limite 2/60 s para provar
compartilhamento com três operações; nenhum limite do produto foi alterado.

Configuração de persistência Redis observada, não alterada: `/data`,
`appendonly=no`, `save=60 1`. O resultado cobre stop/restart gracioso com volume
preservado; **não prova recuperação de crash abrupto nem durabilidade com perda
de volume**.

### Tempos e evidências

- Stop solicitado: **00:17:23.807 UTC**.
- Ambas as respostas negativas observadas pelo coordenador até **2732 ms**
  após a solicitação. `/ready`: 503, `redis=unavailable`, `firestore=ready`.
  `/health` continuou 200. Houve nova leitura negativa ao final dos checks.
- Restart solicitado: **00:17:27.294 UTC**. Intervalo entre solicitações:
  **3487 ms**; não confundir esse intervalo com duração exata da indisponibilidade.
- Redis `SUCCESS` e ambas as réplicas novamente ready confirmados até
  **3234 ms após o pedido de restauração** (6721 ms desde o pedido de stop).
  São limites superiores observacionais, incluindo consultas; não medição
  exata do instante de transição. O control plane ainda reportava `SUCCESS`
  durante uma consulta da outage; a indisponibilidade foi comprovada pelas
  respostas/runtime Redis, não pelo rótulo assíncrono do deployment.
- Mesmos IDs e uptime crescente: **8862 → 8864/8866 → 8868 s**. Nenhum restart
  do backend foi necessário.
- Lock pós-recuperação: fence **3 > 2**, escrita atual aceita. Escrita com
  fence 2 rejeitada com `MATCH_OWNERSHIP_LOST`; documento permaneceu idêntico.
- Rate pós-recuperação: R1 `(1, allowed)`, R2 `(2, allowed)`,
  R1 `(3, denied)`, mesmo fim de janela.
- Broadcast real bidirecional R1→R2 e R2→R1 recebido pelas conexões originais.
  Nenhum broadcast recusado durante a outage apareceu depois na recuperação.

| Cenário | Status | Evidência |
| --- | --- | --- |
| Redis outage real | VALIDADO | Stop/restart oficiais do mesmo Redis; ambos os runtimes perderam disponibilidade |
| Detecção pelo /ready | VALIDADO | Duas réplicas 503, Redis false, Firestore true; detecção conjunta até 2732 ms |
| Socket.IO fail-closed | VALIDADO | Nova conexão, room e broadcast recusados em R1/R2 com `REDIS_REQUIRED`; conexões já abertas continuaram abertas, sem falso sucesso distribuído |
| Rate limit fail-closed | VALIDADO | Primitiva real rejeitou em ambas; eventos e API protegidos retornaram `REDIS_REQUIRED`/503, sem fallback local |
| Distributed lock fail-closed | VALIDADO | `acquire` real rejeitado em R1/R2 com `REDIS_REQUIRED`, em 2/3 ms |
| Lease/renew durante outage | PARCIALMENTE VALIDADO | Lock ativo, TTL original 15000 ms: renew/release rejeitaram explicitamente; não foi executada partida completa com heartbeat automático |
| Redis recovery | VALIDADO | Mesmo deployment/volume; Redis online confirmado até 3234 ms após restart |
| Recovery sem restart | VALIDADO | Mesmos dois IDs, uptime crescente e deployment backend inalterado |
| Socket.IO após recovery | VALIDADO | Room autorizada e broadcast bidirecional entre réplicas, nas conexões originais |
| Rate limit após recovery | VALIDADO | Contador compartilhado 1→2→3; terceira operação negada |
| Lock após recovery | VALIDADO | Aquisição/release reais; zero lock ativo antes do cleanup |
| Fencing após recovery | VALIDADO | Fence 2→3; consumidor Firestore real rejeitou token antigo sem sobrescrever estado |
| Integridade Firestore | VALIDADO | Room própria sem alterações (hash antes/depois); estado da partida preservado após tentativa obsoleta; cleanup verificado |

Limite da evidência de lease: o handle manteve `held=true` depois do erro de
transporte, pois não havia confirmação de release. Isso **não comprova lease
válida/eterna**. Nenhuma escrita foi autorizada pelo harness com base nesse flag.
Após recovery, o release condicionado ao proprietário confirmou sucesso.
Na revisão do consumidor, `monitorSessionOwnership` captura erro de renew e
`loseSessionOwnership` cancela playback/remove sessão. Esse caminho foi
inspecionado, **não exercitado operacionalmente nesta rodada**. Fencing foi
exercitado de fato no consumidor Firestore, após aquisição do novo proprietário.

### Cleanup e estado final

Cleanup limitado a chaves exatas do run-id: lock, fence, três contadores de
fixture e contador Socket.IO do UID temporário. Ownership do documento e da
room comprovada antes da remoção; fence esperado conferido; nenhum lock ativo.
Documento de partida próprio e raiz/subcoleções da room própria removidos;
usuário temporário removido e ausência confirmada. Contadores normais por IP
não são exclusivos da fixture: não foram apagados e conservam seu TTL normal.
Não foram usados FLUSH, KEYS, SCAN, remoção de volume ou recursos de terceiros.

- Redis residual **da execução**: **não**, seis chaves exatas verificadas.
- Firestore residual: **não**, partida e room próprias ausentes.
- Usuário residual: **não**.
- Sockets/processos do harness residuais: **não**; sockets desconectados,
  ambos os processos SSH encerrados naturalmente com exit 0, sem signal,
  stderr 0 bytes; coordenador exit 0.
- Final às **00:17:50 UTC**: Redis original **SUCCESS**; mesmas duas réplicas,
  `/ready` público HTTP 200 em ambas, `firestore=ready`, `redis=ready`;
  frontend HTTP 200.
- Nenhum novo bug comprovado nesta janela. Limitações acima não foram
  convertidas em validação de cenários não executados.

### Histórico obrigatório do timeout

| Cenário | Status | Evidência |
| --- | --- | --- |
| Dependency timeout (histórico) | FALHOU | Runtime antigo pendente >8,5 s; diagnóstico original preservado abaixo |
| Dependency timeout pós-correção | VALIDADO | Rodada anterior: 2861 ms / 2846 ms, erro original preservado, 3→0 sockets, sem cleanup forçado |

O harness TCP antigo não foi reexecutado: nenhuma regressão exigiu reabrir a
investigação. Produção, IAM, réplicas, frontend, Firebase de configuração,
Storage, Cloudinary e Gemini não foram alterados. Somente fixtures autorizadas
de staging e a janela Redis descrita foram usadas. Sem commit/push/deploy de
código. Relatório e evidências locais aguardam revisão.

## Correção delimitada do cleanup Redis — 2026-09-24

O bug de encerramento reproduzido abaixo foi corrigido após autorização
específica. Não se trata de bypass de segurança; os testes de outage/recuperação
do Redis real continuam pendentes e **não foram retomados** nesta entrega.

- Branch: `codex/ci-e2e`.
- Commit publicado e hash remoto confirmado:
  `f59c83a5af499368b6cb43d797ba1c4c9164c0d6`.
- Mensagem: `fix: bound Redis cleanup after connection failure`.
- Três arquivos: `server/infrastructure/redisRuntime.mjs`,
  `server/tests/redisRuntimeCleanup.test.mjs` e
  `server/tests/fixtures/redisRuntimeLifecycle.mjs`.
- 224 inserções, 19 remoções. Relatório, `.tmp`, ambientes/credenciais e arquivo
  externo preexistente permanecem fora do commit. Nenhuma dependência alterada.

### Mecanismo e regressões

Versão inspecionada: `redis` e `@redis/client` 5.8.2. O startup falho usa a API
pública `destroy()` para cancelar clientes command/publisher/subscriber já
criados, inclusive se o factory/duplicate falhar parcialmente. Propaga o mesmo
erro original; exceções do cleanup não o substituem.

O shutdown saudável tenta `sendCommand(["QUIT"])` dentro do timeout existente e
sempre finaliza com `destroy()`. Na versão instalada, `quit()`/`close()` marcam
o socket como fechado antes de esvaziar pendências, prejudicando o abort posterior;
o comando público mantém o cliente abortável até a conclusão ou deadline.
Não há acesso a internals privados, aumento de timeout, retry arbitrário ou
`process.exit` na implementação/regressões.

As regressões usam o cliente Redis real contra TCP loopback, em subprocessos
que precisam encerrar naturalmente. Cobrem handshake silencioso, ECONNREFUSED,
shutdown saudável, QUIT sem resposta, factory/duplicate parcial e preservação
da identidade do erro original mesmo quando o cleanup lança outro erro.

Timeout de produto: **2500 ms**. Limite da asserção: **4000 ms**, com margem
de 1500 ms exclusivamente para scheduler/CI. Watchdog externo de 5000 ms cobre
também startup/exit do subprocesso; não altera o timeout do cliente.

### Reexecução do harness original

O harness original ganhou somente modo local para executar o cenário idêntico
de TCP silencioso contra o runtime corrigido, sem esperar implantação nem
conectar provedores. Duas execuções concluídas:

| Execução | Duração | Erro preservado | Conexões aceitas | Residuais | Sockets forçados pelo harness |
| --- | --- | --- | --- | --- | --- |
| 1 | 2861 ms | TimeoutError / DEPENDENCY_TIMEOUT | 3 | 0 | 0 |
| 2 | 2846 ms | TimeoutError / DEPENDENCY_TIMEOUT | 3 | 0 | 0 |

Ambos os subprocessos encerraram naturalmente, exit 0. O contador inicial
do harness antigo foi lido antes dos eventos TCP `close`: a primeira execução
local rejeitou corretamente em 2815 ms, mas reportou o contador ainda não
atualizado. Esse diagnóstico foi preservado. A observação foi ajustada para
aguardar os eventos por no máximo 500 ms, **antes** de qualquer cleanup da
fixture, exigindo zero sockets residuais e zero sockets forçados pelo harness.
Nenhum assert da aplicação foi relaxado nem timeout do produto aumentado.

Evidência final, somente local:
`.tmp/security-staging/security-validation-1790286147644-adf6a75c7fc2e266-dependency-timeout.json`.

### Validação pré-commit

| Verificação | Resultado |
| --- | --- |
| Novas regressões | 8 pass, 0 fail/cancel/skip |
| Primitivas | 8 pass, 0 fail/cancel/skip |
| Relacionados Redis | 32 pass, 0 fail/cancel, 1 skip por TEST_REDIS_URL |
| Servidor completo | 1413 testes: 1412 pass, 0 fail, 0 cancel, 1 skip por TEST_REDIS_URL |
| Frontend | 194 pass, 0 fail/cancel/skip |
| E2E Chrome | 4 pass |
| npm audit | 0 vulnerabilidades |
| Typecheck / build / git diff --check | Aprovados |

Revisão de causa, escopo, mecanismos e tempos foi informada antes do commit.
Não houve alteração IAM, Redis real, quantidade de réplicas, código/configuração
de frontend ou provedores. Nenhuma outage ou fixture de dados real foi criada.

Deployment automático do backend:
`0cd459df-bf43-4afb-92f6-8396fc8f6d65`, **SUCCESS**, commit
`f59c83a5af499368b6cb43d797ba1c4c9164c0d6`. Não houve redeploy manual.
Verificação final em **2026-09-24 23:49:07 UTC**:

| Réplica | /ready | Firestore | Redis | Commit/runtime |
| --- | --- | --- | --- | --- |
| `30f73e77-3167-48d2-85b9-5e27e4083861` | 200 | ready | ready | Conferido por SSH |
| `cfef3a48-d229-42fb-b31b-d89fe9d5d63d` | 200 | ready | ready | Conferido por SSH |

O hash normalizado de `redisRuntime.mjs` coincide com o arquivo publicado nas
duas réplicas. Quantidade de réplicas permanece dois; nenhuma outage real foi
executada. Evidência sanitizada exclusivamente local:
`.tmp/security-staging/redis-cleanup-post-push.json`.

## Resiliência — campanha interrompida por bug reproduzido, 2026-09-24

**Não concluída.** Bug concreto encontrado no primeiro cenário isolado e
reproduzido uma vez. Conforme instrução do usuário, a campanha foi interrompida
antes de causar a indisponibilidade do Redis real e antes de alterar código.
As homologações anteriores continuam registradas; não demonstram resiliência
durante uma falha que ainda não foi executada.

- Commit inspecionado/implantado: `01e453dd75167963f24cf9f82283e9e66bb53c7f`.
- Backend: `738d28e2-9ae3-417d-af73-34727e918434`, duas réplicas originais.
- Run-id: `security-validation-1790282900478-314568d07a8e2e4c`.
- Evidência sanitizada preservada, somente local:
  `.tmp/security-staging/security-validation-1790282900478-314568d07a8e2e4c-dependency-timeout.json`.
- Harness temporário local: `.tmp/staging-dependency-timeout.mjs`. Não faz
  parte da aplicação; nenhum arquivo versionado foi modificado.

### Planejamento e guardrails antes de provocar falhas

Inspeção readonly confirmou Redis exclusivo do staging, imagem `redis:8.2`,
volume persistente `/data`, snapshot RDB saudável, AOF desativado e zero chaves
na inspeção inicial. As operações Railway `deploymentStop`/`deploymentRestart`
foram identificadas, mas **nenhuma foi executada**. A janela autorizada continua
não utilizada. Não houve alteração IAM, credenciais, volumes ou configuração.

| Falha planejada | Método | Impacto esperado | Reversão | Dados em risco |
| --- | --- | --- | --- | --- |
| Redis indisponível | Parada oficial somente do deployment Redis dedicado, janela-alvo até 45 s | readiness 503; coordenação fail-closed | Restart da mesma imagem em finally e salvaguarda temporal | Fixtures próprias; preservar volume |
| Recuperação | Reconexão das réplicas existentes | Retorno de readiness/adapter/lock/limites | Sem restart do backend | Somente fixtures |
| Firebase/Auth | Token inválido e cliente Firestore isolado com credencial inválida | Rejeição, sem fallback/escrita | Encerrar cliente isolado | Documento do run-id |
| Timeout/degradação | TCP loopback sem resposta em subprocesso, createRedisRuntime real e timeout atual | Rejeição limitada e encerramento dos clientes | Fechar sockets/listener próprios; encerrar subprocesso | Nenhum dado do Redis/Firestore real |
| Operação interrompida | Lock próprio durante outage; renew/release/fencing | Coordenação antiga rejeitada | Recuperação e cleanup exato | Lock/documento do run-id |

O teste de timeout foi executado primeiro como verificação de segurança.
Não houve flood, varredura de chaves, FLUSH, chamadas pagas ou manipulação de
dados reais. Serviços Firebase, Storage, Cloudinary e Gemini não foram usados
para gerar a falha. O Firestore real foi apenas observado pelo readiness.

### Bug: cleanup Redis pode impedir que o timeout retorne

Na réplica `e087182a-7411-453a-bd6b-03aecfcf94d0`, dois subprocessos SSH
separados importaram o `createRedisRuntime` realmente implantado. O hash do
módulo foi comparado com o checkout publicado. Cada subprocesso criou um
listener TCP efêmero em `127.0.0.1`; este aceitou as três conexões do cliente
Redis real, mas não respondeu ao handshake. Sem mock do cliente, monkey patch
ou alteração da configuração das réplicas. A URL Redis real não foi usada
nesse cenário: trata-se de degradação de transporte controlada no harness,
**não** de uma outage do serviço Redis dedicado.

| Execução | Timeout da aplicação | Observação após | Promise | Sockets ainda abertos |
| --- | --- | --- | --- | --- |
| Inicial | 2500 ms | 8503 ms | Pendente | 3 |
| Reprodução única | 2500 ms | 8501 ms | Pendente | 3 |

O watchdog de observação foi 8500 ms; **não aumentou o timeout de 2500 ms da
aplicação**. A primeira evidência foi persistida antes da reprodução. Mesmo
após fechar a fixture TCP, a Promise permaneceu pendente por mais 1500 ms.
Os listeners e sockets próprios foram fechados, e ambos os subprocessos
terminaram com exit 0, signal null, stderr vazio. Esse exit significa cleanup
do harness concluído, não aprovação do cenário de timeout.

Causa identificada em `server/infrastructure/redisRuntime.mjs`:

1. `connectClient` limita `client.connect()` com `withTimeout` (linha 19).
2. O catch de `createRedisRuntime` aguarda o cleanup com `Promise.allSettled`
   antes de propagar o erro original (linha 93).
3. `closeClient` aguarda `client.quit()` sem timeout (linha 27), inclusive
   quando o socket está aberto mas o handshake ainda não ficou pronto.
4. Na dependência instalada, QUIT espera a resposta de um comando; ela não
   chega neste transporte degradado. Assim, o cleanup mascara a conclusão
   do timeout e retém recursos. O caminho de close normal reutiliza o helper.

Não foi observado bypass ou lock local indevido; esses cenários não foram
executados. O bug comprovado é falta de limite/cancelamento no cleanup do
startup Redis. O teste existente de runtime usa FakeRedisClient e cobre o
fechamento bem-sucedido, não esse handshake TCP incompleto.

**Correção mínima proposta, não implementada:** no startup mal-sucedido,
abortar/destruir os três clientes pela API pública do cliente Redis, cancelando
handshake/reconexões e propagando o erro original sem esperar QUIT. No fechamento
gracioso, limitar a espera e forçar encerramento ao exceder o prazo. Acrescentar
regressão com servidor TCP loopback silencioso, verificando rejeição limitada,
três conexões encerradas e ausência de reconexões residuais. Não substituir
simplesmente quit por close: close também aguarda comandos pendentes.

### Resultado da rodada e estado final

| Cenário | Status | Evidência |
| --- | --- | --- |
| Redis outage detectada | NÃO EXECUTADO | Campanha parada antes da janela Redis real |
| /ready durante outage | NÃO EXECUTADO | Somente baseline/final saudáveis |
| Socket.IO fail-closed | NÃO EXECUTADO | Não houve outage real |
| Rate limit fail-closed | NÃO EXECUTADO | Não houve outage real |
| Lock fail-closed | NÃO EXECUTADO | Não houve outage real |
| Redis recovery | NÃO EXECUTADO | Redis não foi interrompido |
| Cross-replica após recovery | NÃO EXECUTADO | Não extrapolar validação anterior |
| Lock após recovery | NÃO EXECUTADO | Não extrapolar validação anterior |
| Integridade Firestore | NÃO EXECUTADO | Nenhuma fixture/escrita criada; readiness não é prova de integridade de dados |
| Firebase auth failure | NÃO EXECUTADO | Interrompido antes deste cenário |
| Dependency timeout | FALHOU | Runtime pendente >8,5 s com timeout 2,5 s; repetido 2/2 |
| Recovery sem restart | NÃO EXECUTADO | Não houve ciclo de falha/recuperação do serviço real |

Verificação final em **2026-09-24 20:48:52 UTC**:

- Réplicas originais `e087182a-7411-453a-bd6b-03aecfcf94d0` e
  `39aca38f-51e8-451c-bda9-c6211d3c8636`: `/ready` HTTP 200,
  `firestore=ready`, `redis=ready`; requests correlacionados pelo run-id.
- Frontend: HTTP 200. Redis permaneceu saudável; nenhuma restauração foi necessária.
- Redis residual da execução: **não**; nenhuma chave criada.
- Firestore residual da execução: **não**; nenhuma fixture criada.
- Usuário temporário residual: **não**; nenhum usuário criado.
- Dois listeners TCP temporários fechados; zero sockets de fixture remanescentes;
  dois subprocessos SSH encerrados. Evidências locais preservadas.
- Sem commit, push, deploy, parada/restart de serviço ou alteração de código da aplicação.
- Aguardando revisão/autorização da correção mínima antes de retomar a campanha.

## Publicação do bloco de headers/diagnóstico — 2026-09-24

Esta seção registra a publicação posterior à homologação de 23/09 abaixo.
As referências históricas a ausência de commit/push e deployments locais
descrevem aquela rodada; o estado atual está vinculado ao GitHub.

- Branch: `codex/ci-e2e`.
- Commit e hash remoto confirmado: `01e453dd75167963f24cf9f82283e9e66bb53c7f`.
- Mensagem: `security: harden staging headers and proxy diagnostics`.
- Push para `origin/codex/ci-e2e` concluído.
- Seis arquivos commitados: três modificados e três novos, 337 inserções e
  12 remoções. Nenhuma dependência alterada.
- Este relatório continua deliberadamente local/não rastreado e não entrou
  no commit. Também ficaram fora os arquivos de ambiente reais, `.tmp`, logs,
  evidências, credenciais, secrets e o arquivo externo preexistente.

### Validação final antes do commit

| Validação | Resultado |
| --- | --- |
| Novas regressões | 13 pass, 0 fail, 0 cancel, 0 skip |
| Relacionados | 83 pass, 0 fail, 0 cancel, 0 skip |
| Servidor | 1405 testes: 1404 pass, 0 fail, 0 cancel, 1 skip por TEST_REDIS_URL |
| Frontend | 194 pass, 0 fail, 0 cancel, 0 skip |
| E2E Chrome | 4 pass |
| npm audit | 0 vulnerabilidades |
| Typecheck / build / git diff --check | Aprovados |

As suítes foram executadas sem carregamento implícito de `.env.local`.
O EPERM do receipt não reapareceu nesta rodada; permanece intermitência
conhecida de causa desconhecida, **não corrigida**. Nenhuma alteração
especulativa foi aplicada ao harness. Os diagnósticos anteriores permanecem locais.

### Deployments automáticos e verificação real pós-push

O push disparou ambos os deployments abaixo, sem redeploy manual. Ambos
terminaram em **SUCCESS**, com a branch e o commit publicados acima:

| Serviço | Deployment | Réplicas |
| --- | --- | --- |
| backend-staging | `738d28e2-9ae3-417d-af73-34727e918434` | 2 |
| frontend-staging | `04ecda25-6727-476f-951c-8b1d5d00438d` | 1 |

Verificação concluída em **2026-09-24 20:30:46 UTC**. Nas duas réplicas do
backend, HTTPS e SSH confirmaram o deployment e o commit corretos. Os seis
arquivos implantados também coincidem com os locais, normalizando apenas LF/CRLF.

| Réplica | /ready | Firestore | Redis | TRUST_PROXY | Telemetria |
| --- | --- | --- | --- | --- | --- |
| `e087182a-7411-453a-bd6b-03aecfcf94d0` | 200 | ready | ready | false | desativada |
| `39aca38f-51e8-451c-bda9-c6211d3c8636` | 200 | ready | ready | false | desativada |

- HTML do frontend (200), raiz do backend (404 esperado), health (200),
  ready (200), API sem credencial (401) e rota inexistente (404) mantêm os
  seis headers: HSTS, CSP, XFO, nosniff, Referrer-Policy e Permissions-Policy.
- HSTS permanece exatamente `max-age=86400`, sem includeSubDomains/preload.
  O redirect público HTTP → HTTPS foi comprovado na rodada anterior.
- WebSocket com Origin inválida e Origin null retorna 400, sem ACAO e com os
  seis headers. **VALIDADO somente para recusas de Origin**, não para todos
  os erros internos do protocolo Engine.IO.
- Proxy/XFF/XFP continua **PARCIALMENTE VALIDADO**. A evidência de 23/09 é
  preservada; peers/CIDRs confiáveis não foram comprovados. `TRUST_PROXY=false`
  não foi alterado. A telemetria opt-in está desativada nas duas réplicas.
- Não houve alterações em IAM, Redis, Firebase, réplicas, Storage, Cloudinary
  ou Gemini. Não foram repetidos testes distribuídos nem criadas fixtures.
- Evidência sanitizada: `.tmp/security-staging/post-push-transport-20260923.json`,
  exclusivamente local; o nome preserva a data em que o acompanhamento começou.

Pendências da Fase 4 não abrangidas por esta entrega: cadeia confiável de proxy;
intermitência EPERM; cenários restantes de revogação/falhas de Auth, quotas e
contenção reais; Storage, Cloudinary, Gemini/quotas Lua de IA; auditoria IAM
completa; partições/recuperação; backup, restore e medição de RPO/RTO.
As validações distribuídas e de autenticação já comprovadas permanecem válidas,
sem extrapolar para esses cenários ainda não executados.

## Atualização — HSTS, erros de upgrade e diagnóstico de proxy, 2026-09-23

Esta seção atualiza os resultados de 21/09 abaixo. Somente backend-staging
foi implantado; não houve commit/push, alteração de infraestrutura, IAM,
Firebase, Redis, Storage, Cloudinary, Gemini ou frontend. Não foram repetidos
os testes distribuídos já comprovados (adapter, autorização de sala,
rate limit, lock, exclusão mútua e fencing).

### Implementação e origem do deployment

- HSTS reaproveita `ENABLE_HSTS`, sem confiar em XFP. A nova declaração
  explícita `STAGING_HTTPS_ORIGIN` aceita somente uma origin HTTPS exata em
  `backend-staging` / `staging`. Em produção Node, com a flag habilitada e
  Host correspondente, emite `max-age=86400`, sem includeSubDomains/preload.
  A política anterior para conexão segura permanece nos demais ambientes.
- `httpSecurity.mjs` centraliza os headers HTTP/Engine.IO. O evento oficial
  `headers` cobre upgrades aceitos; um listener HTTP anterior ao Engine.IO
  cobre respostas HTTP de erro. A recusa de Origin usa a mesma política no
  roteador público de upgrade do servidor Node, com um único escritor, antes
  de delegar ao Engine.IO. Não há patch de ServerResponse, socket.write ou
  internals privados. Autenticação e CORS continuam inalterados.
- **Limite explícito:** o HTTP 400 validado aqui é a recusa de Origin.
  Outros abortos internos de protocolo do Engine.IO não estão cobertos por
  essa interceptação. CSP/XFO em um handshake não equivalem à proteção de um
  documento HTML; sua presença mantém consistência de hardening.
- A telemetria exige flag explícita, serviço/environment de staging,
  run-id e expiração em até uma hora. Registra no máximo 48 requests
  marcados por réplica. IPs públicos são pseudonimizados; somente endereços
  privados necessários à topologia e IPs sintéticos reservados podem aparecer.
  Não há endpoint público novo, logging de credenciais, cookies ou headers
  completos. Campos de IP/protocolo usados pela aplicação não são alterados.
- Primeiro deployment `17327074-a551-4a9c-be6c-1370c7a19ac6`: **SUCCESS**.
  Fonte: pacote local limpo, baseado em
  `c00510da6a08a37fceddbd66b54ab85ab7a56a8b`, com seis arquivos permitidos
  sobrepostos. **Não é um novo commit publicado.** Os hashes dos seis
  arquivos implantados foram conferidos por SSH nas duas réplicas.
- A interrupção por limite do mecanismo de aprovação consumiu a primeira
  janela de telemetria. O usuário autorizou expressamente um redeploy adicional.
  Deployment final `3ac0de3e-403b-475e-8877-cf1521b2d1af`: **SUCCESS**,
  reutilizando a mesma imagem (`usePreviousImageTag=true`), sem novo build ou
  alteração de código. Os seis hashes foram reconferidos nas duas réplicas.
- Somente cinco variáveis relacionadas a HSTS/diagnóstico foram configuradas.
  Comparação em memória confirmou as demais inalteradas. `TRUST_PROXY=false`
  efetivo permanece, sem alteração de sua configuração.

### Resultado real e headers

| Área | Status | Evidência |
| --- | --- | --- |
| HSTS backend | VALIDADO | max-age=86400 em raiz, health, ready, API 401, 404 e upgrades; HTTP público redireciona 301 para HTTPS. |
| WS 400 por Origin recusada | VALIDADO | Origins externa, null e HTTP recusadas com seis headers e sem ACAO. |
| Upgrade/autenticação | VALIDADO | Origin autorizada e ausente recebem 101 com headers; sem credencial o namespace rejeita com AUTH_REQUIRED. Não foi criado usuário Firebase. |
| Proxy | PARCIALMENTE VALIDADO | 20/20 requests sintéticos correlacionados com logs; normalização de XFF/XFP observada. Peer/CIDRs estáveis e fronteira de confiança do edge não comprovados. TRUST_PROXY=false mantido. |

| Resposta HTTPS | HSTS | CSP | XFO | nosniff | Referrer | Permissions |
| --- | --- | --- | --- | --- | --- | --- |
| HTML frontend 200 | Presente | Presente | DENY | Presente | no-referrer | Presente |
| Backend `/` 404 | Presente | Presente | DENY | Presente | no-referrer | Presente |
| `/health` 200 | Presente | Presente | DENY | Presente | no-referrer | Presente |
| `/ready` 200 | Presente | Presente | DENY | Presente | no-referrer | Presente |
| `/api/rooms` 401 | Presente | Presente | DENY | Presente | no-referrer | Presente |
| 404 | Presente | Presente | DENY | Presente | no-referrer | Presente |
| WS 400 por Origin | Presente | Presente | DENY | Presente | no-referrer | Presente |

HSTS exato: `max-age=86400`. CSP preservada:
`img-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'`.
Permissions-Policy: `camera=(), microphone=(), geolocation=(), payment=()`.
O redirect HTTP 301 é gerado pelo edge e não inclui esses headers; HSTS é
verificado nas respostas HTTPS. O backend não serve a SPA; sua raiz retorna
404 esperado. A skill agent-browser confirmou também o HTML e os headers
do frontend no Chrome, sem login ou alterações.

Cada rodada teve 30 requisições HTTP e cinco handshakes, incluindo 20 requests
controlados de proxy. A primeira não gerou telemetria por expiração. Na segunda,
todos os 20 requests de proxy foram correlacionados, por requestId e instanceId,
com exatamente um evento cada. Houve um GET adicional de correlação e leituras
readonly por SSH. Nenhuma fixture ou usuário foi criado.

### Proxy e spoofing — evidência da segunda janela

Cadeia observada: cliente HTTPS → Railway edge (`railway-hikari`) → Node HTTP.
Em todos os eventos: `req.ip === req.socket.remoteAddress`, `req.protocol=http`,
`req.secure=false`. Não foram registrados IPs públicos literais: peers fora
das faixas privadas explicitamente preservadas aparecem como pseudônimos
por execução. Foram observados 13 pseudônimos; o prefixo `public-` é um rótulo
de sanitização, não prova de roteabilidade pública ou de um CIDR confiável.
Uma leitura restrita de peers TCP da porta do backend não encontrou conexões
residuais correspondentes; não foi usada para inventar endereços/hops.

| Caso enviado | Requests | Réplicas | XFF recebido | XFP recebido | Forwarded sintético |
| --- | --- | --- | --- | --- | --- |
| Sem forwarded headers | 2 | 2 | 2 valores | https | Ausente |
| XFF com 1 IP sintético | 3 | 2 | 2 valores, sintético removido | https | Ausente |
| XFF com 2 IPs sintéticos | 2 | 2 | 2 valores, ambos removidos | https | Ausente |
| XFP=http | 4 | 2 | 2 valores | https | Ausente |
| XFP=https | 4 | 2 | 2 valores | https | Ausente |
| Forwarded for/proto/host sintéticos | 3 | 2 | 2 valores | https | Preservado |
| XFF + XFP + Forwarded combinados | 2 | 2 | 2 valores, sintéticos removidos | https | Preservado |

No caminho público ensaiado, XFF foi normalizado/substituído, não simplesmente
acrescentado à lista enviada pelo cliente. XFP foi normalizado para HTTPS.
O header padrão `Forwarded` sobreviveu, mas não alterou o IP/protocolo utilizado
pelo Express. Dois valores em XFF **não comprovam dois hops confiáveis**.
O peer variou entre conexões, mas o IP considerado continuou igual ao peer,
nunca aos valores sintéticos. Não afirmar que req.ip identifica o cliente final.

O rate limiter HTTP resolve a chave por `request.ip`; o de conexão Socket.IO,
por `socket.handshake.address`. A regressão local verifica que XFF sintético
não troca a chave quando trust proxy está false. O rate limit distribuído não
foi reexecutado/floodado. A auditoria HTTP normal não registra headers brutos;
a telemetria adicionada também não consome `Forwarded` como identidade.

**Decisão:** manter `TRUST_PROXY=false`. Não habilitar `true`, `1` ou uma
allowlist presumida. Falta evidência operacional/documental de peers/CIDRs
estáveis e da fronteira de confiança em todos os caminhos até o backend.

A coleta encontrou 29 eventos sanitizados, incluindo health/ready/API/404 e
o GET adicional. O CLI Railway entrega campos JSON achatados: o coletor local
foi ajustado para filtrar `event`/run-id em memória, sem imprimir outros logs.
Isto não exigiu mudança no código implantado. A flag foi deixada `false` na
configuração com `skipDeploys=true`; nos processos já em execução, a janela
expira automaticamente em **2026-09-23 18:44:39.590 UTC**, no máximo 48 eventos
marcados por réplica. Nenhum terceiro deployment foi realizado.

### Readiness e validação local

SSH e HTTPS confirmaram HTTP 200, Firestore ready e Redis ready em:

- `5aac3e05-f147-401b-ad73-24043a985678`;
- `fb4a9f05-ae59-4438-af21-0e608e18d634`.

Validação final do código:

- Novas regressões: 13/13; com securityHardening: 45/45.
- Relacionados, incluindo preflight: 83/83.
- Servidor: 1405 testes, 1404 pass, 0 fail, 0 cancel, 1 skip (TEST_REDIS_URL).
- Frontend: 194/194; E2E Chrome: 4/4.
- npm audit: 0 vulnerabilidades; typecheck, build e git diff --check: aprovados.
- Nenhuma dependência alterada. Aviso de tamanho de chunk do build permanece.

Na primeira suíte, o novo exemplo preenchido com `false` contrariava a regra
de placeholders vazios. O exemplo foi corrigido, sem modificar o teste.
Em uma execução relacionada reapareceu EPERM no rename do receipt de staging;
o log foi preservado, o harness não foi alterado e a repetição passou. Causa
desconhecida; não declarar corrigido. Logs/evidências/payloads permanecem
somente em `.tmp`, fora de Git e do upload.

## Estado atual — frontend e CORS reais, 2026-09-21

**Fase 4 ainda parcialmente homologada.** Esta seção substitui os bloqueios
anteriores de frontend/CORS; os demais resultados históricos continuam abaixo.
Nenhum teste de lock, fencing, adapter ou rate limit distribuído foi repetido.

### Deployments e configuração efetivamente usados

- Branch: `codex/ci-e2e`; source GitHub: `Masternuel/2026-07-09`.
- Commit dos dois builds: `c00510da6a08a37fceddbd66b54ab85ab7a56a8b`.
- Root Directory: `/files-mentioned-by-the-user-voce/outputs/bola-manager`,
  confirmado na árvore do monorepo antes de configurar o serviço.
- Frontend: `https://frontend-staging-staging-39e9.up.railway.app`.
  Deployment único `b54b82c5-9705-4e0e-bab4-9147f18b60f4`, **SUCCESS**.
- Backend: `https://backend-staging-staging-6c48.up.railway.app`.
  Único redeploy necessário para CORS:
  `e2d08335-d8a1-4e5b-8187-295908f43bf2`, **SUCCESS**.
- Backend continua com duas réplicas. IDs atuais, após o redeploy:
  `44e328a6-dbed-4104-89e6-c02e27ae2b50` e
  `055ad23c-e70c-4a45-b3d0-cbe285833231`.
  Os IDs anteriores nas evidências de lock/adapter são históricos.
- `CLIENT_ORIGIN` do backend contém exatamente o origin HTTPS do frontend,
  sem wildcard, porta extra, path ou trailing slash. Comparação em memória
  confirmou que nenhuma outra variável do backend foi alterada.
- `TRUST_PROXY=false` efetivo, `ENABLE_HSTS=false` e listener HTTP interno
  confirmados por SSH nas duas réplicas; não houve ajuste de proxy.

O frontend usa Railpack, `npm run build`, healthcheck `/` e servidor estático
Express definido no **Start Command do serviço Railway**, restrito a
`frontend-staging`/`staging`. Não usa o start do backend nem `vite preview`.
Serve somente `dist`, mantém fallback SPA, nega dotfiles/métodos de escrita
e reutiliza `shared/imagePolicy.mjs` / `shared/securityHeaders.mjs`.
Cinco verificações locais passaram: raiz, rota SPA, dotfile negado, asset
inexistente e POST negado, incluindo os headers de segurança.

**Distinção de fonte:** os assets foram construídos do commit GitHub acima;
o servidor estático está na configuração Railway, não nesse commit. Sua cópia
local está em `.tmp/phase4-frontend-static.mjs`; SHA-256 do Start Command:
`458c951b0893215ee9615821c0187136900c16ea582eab02861b7d138aabc611`.
O hash da configuração remota foi conferido. Versionar essa configuração
reproduzível fica sujeito à revisão; nenhum commit/push foi feito.

Foram configurados somente os seis valores públicos necessários:
`VITE_SERVER_URL`, `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`,
`VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_MESSAGING_SENDER_ID` e
`VITE_FIREBASE_APP_ID`. A presença dos seis no bundle foi conferida por
booleanos, sem exibir valores Firebase. `VITE_FIREBASE_STORAGE_BUCKET` não
foi configurado. Zero variáveis de credenciais administrativas/Redis/Gemini/
Cloudinary no frontend; zero VITE inesperadas. `BOLA_ENV_FILES=false`.

### Resultado operacional

| Área | Status | Evidência |
| --- | --- | --- |
| Frontend staging | VALIDADO | Deployment SUCCESS; `/` e `/competicoes` retornam HTML 200; Chrome renderiza a tela real de login. Não equivale a testar todos os fluxos do jogo. |
| CORS HTTP positivo | VALIDADO | GET autenticado 200; OPTIONS 204; ACAO igual ao origin exato; credentials=true conforme política; Chrome consegue ler a resposta com credentials=include. |
| CORS HTTP negativo | VALIDADO | Sete origins inválidas retornam 403 sem ACAO; preflight negativo 403; iframe sandbox com Origin null recebe bloqueio CORS real no Chrome. |
| CORS Socket.IO positivo | VALIDADO | Origin autorizado abre HTTP 101 e namespace com usuário Firebase válido, tanto pelo cliente de protocolo quanto pelo WebSocket do Chrome; sem token, AUTH_REQUIRED. |
| CORS Socket.IO negativo | VALIDADO | Sete origins inválidas recusadas com HTTP 400 mesmo com token válido; Origin null também bloqueado no Chrome; sem Origin ainda exige autenticação. |
| HSTS | PARCIALMENTE VALIDADO | Frontend HTTPS emite max-age=86400, sem includeSubDomains/preload, inclusive no 404. Backend continua sem HSTS; flag isolada não resolve request.secure=false. |
| WS error headers | FALHOU | Sete recusas HTTP 400 continuam sem os headers; causa localizada no abortUpgrade do Engine.IO. Falha de uniformidade, não prova de clickjacking/XSS no handshake. |
| Proxy chain | PARCIALMENTE VALIDADO | HTTPS → Railway edge → listener HTTP; redirecionamento HTTP 301 nos dois domínios. Hops, peer/CIDRs e normalização dos forwarded headers continuam sem evidência suficiente. |
| XFF spoofing | PARCIALMENTE VALIDADO | Evidência anterior preservada; trust proxy false confirmado nas novas réplicas. Sem telemetria de req.ip público para concluir atribuição/rate limit por cliente. |
| XFP spoofing | PARCIALMENTE VALIDADO | Evidência anterior preservada; protocolo/secure derivados do listener e trust proxy false, não capturados de request público. |

Os sete negativos foram: origin totalmente diferente, hostname semelhante,
porta 444, prefixo/subdomínio, sufixo malicioso, `null` e scheme HTTP.
OPTIONS positivo permitiu `GET,HEAD,PUT,PATCH,POST,DELETE`, refletiu somente
os headers solicitados `authorization,content-type` e retornou
`Vary: Origin, Access-Control-Request-Headers`.
ACAO nunca foi `*`. CORS não substitui autenticação: sem token, GET 401 e
namespace AUTH_REQUIRED, inclusive quando não existe Origin. Origin forjado
por cliente não-browser não é identidade; WebSocket usa validação de Origin
no servidor, não a política fetch/XHR do navegador.

Escopo principal: **22 requisições HTTP e 11 handshakes WebSocket** pelo
harness; adicionalmente, Chrome executou dois GETs, dois handshakes positivos/
sem token e um GET/handshake em iframe de Origin null. Houve dois checks
internos de readiness por SSH, verificação readonly do bundle/configuração
e dois redirecionamentos HTTP; sem flood ou novos ensaios distribuídos.

### Matriz de headers observados em HTTPS

| Header | HTML (raiz/SPA frontend) | API (200/401/403 backend) | 404 | WS 400 |
| --- | --- | --- | --- | --- |
| Content-Security-Policy | Presente | Presente | Presente nos dois serviços | Ausente |
| frame-ancestors 'none' (diretiva CSP) | Presente | Presente | Presente nos dois serviços | Ausente |
| X-Frame-Options | DENY | DENY | DENY nos dois serviços | Ausente |
| X-Content-Type-Options | nosniff | nosniff | nosniff nos dois serviços | Ausente |
| Referrer-Policy | no-referrer | no-referrer | no-referrer nos dois serviços | Ausente |
| Permissions-Policy | camera=(), microphone=(), geolocation=(), payment=() | Mesma política | Mesma política nos dois serviços | Ausente |
| Strict-Transport-Security | max-age=86400 | Ausente | Presente no frontend; ausente no backend | Ausente |

`/health`, `/ready`, `/` 404 do backend e OPTIONS 204/403 possuem os mesmos
cinco headers normais de segurança do backend; HSTS ausente. O upgrade 101
permitido também conserva esses cinco headers. CSP exata em HTML/API/404:
`img-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'`.
O edge não removeu nem substituiu essas políticas nos casos observados.

### HSTS: causa e limite desta rodada

No backend, `server/index.mjs` só emite HSTS se
`config.enableHsts && request.secure`. A configuração está desativada e,
com listener HTTP/trust proxy false, request.secure permanece falso.
Não houve HSTS emitido pelo edge nos ensaios. Não habilitar XFP confiável
ou trust proxy por contagem presumida apenas para satisfazer esse header.

O frontend dedicado emite HSTS no servidor estático com prazo inicial de
um dia, limitado ao seu hostname pelo browser, sem subdomínios/preload.
Os dois domínios públicos redirecionam HTTP para HTTPS (301).
Para o backend, propor após revisão uma política explícita de deployment
HTTPS-only ou header no edge, sem depender de XFP fornecido pelo cliente;
alternativamente concluir primeiro a evidência de proxies confiáveis.
Nenhuma dessas mudanças adicionais foi aplicada.

### WS 400: causa, impacto e proposta não implementada

Arquivos: `server/index.mjs` (Socket.IO e `io.engine.use`),
`server/infrastructure/networkPolicy.mjs` (política compartilhada de Origin),
`node_modules/engine.io/build/server.js` (`handleUpgrade` / `abortUpgrade`).
Engine.IO registra CORS antes do middleware de headers. Quando há erro,
`abortUpgrade` escreve diretamente no socket uma resposta HTTP 400 com
`Content-Type: text/html`, corpo de erro e Connection: close; não serializa
os headers acumulados no WebSocketResponse. Não passa pelo Express nem é
gerado pelo Railway. Apenas antecipar `io.engine.use` não corrige essa escrita.

| Header ausente | Impacto específico no handshake recusado |
| --- | --- |
| CSP | Nenhum documento da aplicação é criado pelo WebSocket recusado. Ausência não equivale a CSP ausente na SPA; exige cuidado se futuramente houver conteúdo ativo/refletido no erro. |
| frame-ancestors | Não protege um namespace WebSocket nem autentica sua origem. Não foi demonstrado documento interativo enquadrável nessa resposta. |
| X-Frame-Options | Mesma distinção de framing; HTML real da aplicação já mantém DENY. |
| X-Content-Type-Options | Hardening útil para padronizar erros; o aborto usa text/html, embora o erro observado seja texto fixo. Preferir text/plain e nosniff na resposta própria. |
| Referrer-Policy | Handshake não instala uma política de documento nem navegação subsequente; ausência não prova vazamento de token/referrer. |
| Permissions-Policy | Resposta recusada não cria documento que use câmera/microfone/geolocalização; impacto funcional reduzido neste caminho. |
| HSTS | Lacuna de política HTTPS do hostname deve ser avaliada separadamente; não depender de um erro WebSocket para estabelecer HSTS. Backend ainda sem HSTS também no HTTP normal. |

**Proposta mínima para revisão:** tratar a recusa de Origin no ponto de
entrada do upgrade, antes de delegar ao Engine.IO, reutilizando exatamente
`originPolicy.allows`. Um único escritor deve encerrar a resposta com status
400, corpo fixo text/plain, Content-Length correto e os headers compartilhados;
requests permitidos continuam no Engine.IO e na autenticação existente.
Não fazer monkey patch de node_modules, socket.write ou confiar em headers
recebidos. Essa proposta cobre a recusa de Origin; outros erros de protocolo
exigem avaliação própria, sem prometer cobertura universal do abortUpgrade.
Antes de implantar, adicionar regressões para 400 com headers, 101 aceito,
AUTH_REQUIRED sem token, null/ausência de Origin e não haver escrita dupla.
**Proposta somente; nenhum código de WS foi alterado.**

### Proxy: observação adicional depende de revisão

Cadeia conhecida: cliente → Railway public edge (`railway-hikari`, `gru1`)
→ backend container HTTP. Permanecem desconhecidos: valores normalizados
pelo edge, regras de sobrescrita, número de hops confiáveis e IP/CIDR do peer.
Configurar trust proxy=1 ou faixas presumidas continua proibido.

Se aprovado, adicionar logging temporário restrito ao staging e a um run-id,
desativado por padrão, com **somente** req.ip sanitizado, req.protocol,
req.secure, booleans de presença de XFF/XFP/Forwarded e instanceId. Não logar
Authorization, cookies, valores completos de headers ou credenciais; não
criar endpoint público de diagnóstico. Isso ajuda a medir os efeitos no
request, mas não substitui confirmação independente de peers/CIDRs/hops.
**Nenhuma telemetria nova foi implementada.**

### Cleanup, evidências e estado final

Usuário temporário criado com autorização específica do usuário, UID/email/
displayName exclusivos do run-id. Token customizado/ID token usados somente
em memória/stdin, nunca impressos ou persistidos na evidência. Após verificar
ownership, usuário excluído; `auth/user-not-found` confirmou a ausência.
Nenhuma sala, partida, documento Firestore, fixture de Storage ou chave Redis
de teste foi criada. Contadores normais de rate limit têm o TTL da aplicação;
não foram apagadas chaves compartilhadas. Navegador de teste encerrado.

Evidência sanitizada local, ignorada pelo Git:
`.tmp/security-staging/security-validation-frontend-1790004542802-60cfd157b535f4c7-evidence.json`.
Recibos de configuração e harness permanecem somente em `.tmp`.
Readiness público e específico por SSH nas duas réplicas atuais:
**HTTP 200; Firestore ready; Redis ready**.
Última revalidação pública: `2026-09-21T15:35:55.217Z`, três GETs adicionais,
todos 200, cobrindo os dois instanceIds atuais. Evidência principal: 25 GETs/
OPTIONS no total após essa revalidação, além dos checks do navegador/SSH e
das verificações readonly de configuração/assets descritas acima.

Nenhuma mudança de IAM, Redis, configuração Firebase, número de réplicas,
Storage, Cloudinary ou Gemini. Sem backup/restore ou falhas destrutivas.
Sem commit/push; `.env.local` não foi lido. Arquivo externo preexistente
mantido intocado. Testes Auth desta rodada cobrem custom-token/API/Socket.IO;
login UI por senha/Google e toda a aplicação não foram homologados aqui.

## Histórico — atualização operacional de 2026-09-18

**Registro histórico; não declarar a fase inteira concluída.**
Esta seção é a evidência de 18/09; frontend/CORS atuais estão na seção de 21/09.
Os resultados distribuídos já comprovados foram reaproveitados, sem reexecutar
os ensaios. Nesta rodada foram testados somente proxy, forwarded headers,
headers de segurança, CORS e readiness final.

### Ambiente comprovado

- Branch: `codex/ci-e2e`; HEAD: `c00510da6a08a37fceddbd66b54ab85ab7a56a8b`.
- Railway: projeto `bola-manager-staging`, environment `staging`, serviço
  `backend-staging`; deployment `7ecda254-f356-4c96-ab4c-8b47262df6f6`, `SUCCESS`.
- R1: `9c901cb4-7473-4d68-966e-fd0b10f87422`.
- R2: `baedd302-1881-453e-8fc8-461f9f62673d`.
- Backend público: `https://backend-staging-staging-6c48.up.railway.app`.
- Firebase exclusivo de staging: `bola-manager-staging-baf7002a`.
- `frontend-staging`: nenhum deployment ativo e nenhum domínio configurado.
- `.env.local` não foi lido; nenhum secret ou credencial foi exibido ou copiado.
  SSH exportou apenas a configuração não secreta necessária. Nenhuma configuração
  de runtime, infraestrutura, IAM, Redis ou Firebase foi alterada.

### Validações operacionais consolidadas

| Área | Status | Evidência |
| --- | --- | --- |
| Duas réplicas Railway | VALIDADO | IDs R1/R2 distintos; sessões SSH específicas e respostas públicas correlacionadas. |
| Firestore real | VALIDADO | Readiness, persistência transacional de fixture e rejeição de fence antigo; não equivale a homologar todas as quotas/importações. |
| Redis real | VALIDADO | Readiness, adapter, quota compartilhada, SET NX PX, INCR e release Lua executados no serviço privado dedicado. |
| Socket.IO conexão | VALIDADO | Clientes conectados às duas réplicas, confirmados pelos logs dos sockets. |
| Redis adapter cross-replica | VALIDADO | Dois eventos bidirecionais de chat correlacionados entre réplicas na mesma sala de teste. |
| Room authorization | VALIDADO | Não membro recebeu ROOM_NOT_FOUND em room:resume/chat:send; UID forjado ignorado; zero entregas não autorizadas. |
| Rate limit distribuído | VALIDADO | 122 eventos correlacionados: 120 aceitos e 2 rejeitados; cada réplica registrou 60 aceitos e 1 rejeitado. Este ensaio não valida atribuição HTTP por IP do cliente. |
| Distributed lock | VALIDADO | R2 tentou o mesmo recurso durante a seção crítica de R1; primeira tentativa rejeitada, aquisição subsequente concluída após 5 tentativas reais. |
| Mutual exclusion | VALIDADO | Intervalos medidos por Redis TIME sem sobreposição; separação de 345,988 ms. |
| Fencing crescente | VALIDADO | Tokens reais 1 e 2, com 2 > 1. |
| Fencing antigo rejeitado | VALIDADO | FirestoreMatchSessionPersistence.save aceitou o token 2, rejeitou o token 1 com MATCH_OWNERSHIP_LOST e preservou integralmente o estado novo. |

Evidências locais, ignoradas pelo Git e **fora de qualquer commit**:

- Adapter/autorização/quota: run-id
  `security-validation-1789673329455-2c0a4afee20783b25d8e361f`.
- Lock/fencing: run-id
  `security-validation-1789762966125-951380bb87fd675b3f7104f9`.
- Proxy/headers/CORS desta rodada: run-id
  `security-validation-proxy-1789766281210-3016a40897402ab1`.
- Artefatos sanitizados em `.tmp/security-staging/<run-id>-evidence.json`
  e, para lock/fencing, `<run-id>-lock-evidence.json`.

No ensaio anterior de lock, as seções críticas em 18/09/2026 UTC foram:
R1 `20:22:51.883516–20:22:52.833334`; R2
`20:22:53.179322–20:22:55.690613`. As duas chaves exatas e o documento exclusivo
foram removidos após conferir ownership; zero resíduos de lock/fixture.
O consumidor real usou coleção exclusiva `securityValidationMatches`, nunca
partidas ou usuários reais. Os módulos de lock/persistência foram conferidos
por hash normalizado nas duas réplicas antes da execução.

### Proxy e forwarded headers

Cadeia observável: **cliente HTTPS → Railway edge (`railway-hikari`, `gru1`)
→ backend-staging HTTP, porta 8080**. HTTP público redireciona com 301 para
HTTPS. Consulta interna por SSH a `http://127.0.0.1:8080/health` retornou 200.
O edge é comprovado pelos headers públicos e pelo domínio Railway; nenhum
número de saltos, CIDR ou endereço de peer foi presumido.

Configuração efetiva idêntica nas duas réplicas:

| Configuração | Valor observado |
| --- | --- |
| NODE_ENV | production (modo do processo; o environment Railway é staging) |
| TRUST_PROXY | Não definido; configuração efetiva false |
| ENABLE_HSTS | Não definido; configuração efetiva false |
| CLIENT_ORIGIN | Vazio; nenhuma origin autorizada |

O código Express em uso, com trust proxy false e listener HTTP, resolve
`req.ip` pelo peer TCP, `req.protocol` como `http` e `req.secure` como `false`.
Isso é **derivação do código/configuração efetivos**, não captura desses três
campos de uma requisição pública. O IP exato do peer e as redes confiáveis
continuam sem evidência. Não foi alterado TRUST_PROXY por tentativa e erro.

Foram feitas sete requisições controladas a `/api/rooms`: baseline, XFF simples,
XFF em cadeia, XFP=http, XFP=https, Forwarded e combinação dos três headers.
Usaram-se somente endereços sintéticos de documentação e host `.invalid`.
Todas retornaram 401 AUTH_REQUIRED, preservaram os headers de segurança e
foram correlacionadas por request-id nos logs reais das duas réplicas (7/7).

Os logs HTTP disponíveis registram método, rota, status, duração e instanceId,
mas **não ip/protocol/secure nem os forwarded headers recebidos**. Não existe
endpoint de diagnóstico desses campos. Logo, não é possível afirmar a
normalização feita pelo edge nem validar diretamente a atribuição do cliente
e o impacto na auditoria. Não houve evidência de injeção dos valores sintéticos
nos campos de auditoria existentes; a auditoria não registra esses campos.

O limitador HTTP usa `http:${request.ip}`. Os valores públicos de
RateLimit-Remaining ficaram em 239/238 e os resets variaram, inclusive entre
requisições sem spoofing. Isso **não prova bypass nem identidade estável**;
é insuficiente para homologar limitação por IP original atrás do proxy.
O ensaio distribuído anterior não foi repetido nem usado para encobrir essa lacuna.

### Headers públicos e preservação pelo edge

| Caminho | HTTP | CSP/XFO/nosniff/Referrer/Permissions |
| --- | ---: | --- |
| / | 404 | Todos presentes e iguais à política do código |
| /competicoes (candidato SPA) | 404 | Todos presentes; não há SPA implantada neste serviço |
| /health | 200 | Todos presentes |
| /ready | 200 | Todos presentes |
| /api/rooms, sem autenticação | 401 | Todos presentes |
| /<run-id>, inexistente | 404 | Todos presentes |

Valores verificados:

- CSP: `img-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'`.
- X-Frame-Options: `DENY`.
- X-Content-Type-Options: `nosniff`.
- Referrer-Policy: `no-referrer`.
- Permissions-Policy: `camera=(), microphone=(), geolocation=(), payment=()`.
- Strict-Transport-Security: **ausente**; HSTS está desativado. Somente ativá-lo
  não resolveria a condição `request.secure` enquanto trust proxy permanecer false.

Comparação com `/health` interno nas duas réplicas confirmou os mesmos cinco
headers: não foi observada remoção/substituição pelo Railway nessas respostas.
Não foi executado teste de iframe nem de documento SPA real nesta rodada.
O redirecionamento HTTP 301 é resposta do edge, sem esses headers; foi mantido
separado da matriz HTTPS da aplicação.

**Exceção comprovada:** as cinco recusas de upgrade WebSocket por Origin
retornaram HTTP 400 sem CSP, XFO ou headers complementares. Uma consulta direta
ao listener de R1, sem passar pelo edge, reproduziu o mesmo 400 e as mesmas
ausências. Não atribuir essa lacuna ao Railway: Engine.IO registra CORS no
construtor, antes de `io.engine.use` que adiciona os headers, e seu caminho
de abortUpgrade encerra a resposta sem a política completa. O upgrade aceito
sem Origin retornou 101 com os cinco headers presentes. Nenhuma correção ou
deploy foi realizado; o achado fica para revisão, sem presumir exploração
de clickjacking em uma resposta de erro de handshake.

### CORS real

- HTTP: Origin não autorizada, sufixo forjado, origin do próprio backend,
  origin HTTP e `null` retornaram 403 CORS_ORIGIN_DENIED, sem ACAO.
- OPTIONS com Origin não autorizada retornou 403, sem ACAO.
- Sem Origin: GET e OPTIONS da API privada retornaram 401 AUTH_REQUIRED.
  A ausência de Origin não liberou autenticação.
- Socket.IO/WebSocket: os cinco casos com Origin retornaram 400 antes do upgrade.
  Sem Origin, o transporte abriu (101) e o namespace foi rejeitado com AUTH_REQUIRED.
- Positivo com Origin autorizada e preflight autorizado: **NÃO EXECUTADO**,
  pois CLIENT_ORIGIN está vazio; não foi inventada uma origem nem alterada a
  allowlist. O próprio domínio do backend foi testado como candidato não
  configurado, nunca rotulado como origin autorizada.
- O frontend não tem deployment/domínio. A funcionalidade de um navegador
  autorizado continua bloqueada por configuração e não foi homologada.
- WebSocket não usa a política CORS do navegador como fetch/XHR; o bloqueio
  observado vem da validação de Origin no servidor. CORS não é autenticação:
  clientes não-browser podem omitir/forjar Origin, mas ainda precisam autenticar.

### Resultado desta rodada

| Área | Status | Evidência |
| --- | --- | --- |
| Proxy chain | PARCIALMENTE VALIDADO | HTTPS → Railway edge → listener HTTP confirmado; peer/CIDRs confiáveis e atribuição do IP original não observados. |
| X-Forwarded-For spoofing | PARCIALMENTE VALIDADO | Ensaios reais e logs correlacionados; trust proxy false; sem telemetria de req.ip para comprovar atribuição/rate limit por cliente. |
| X-Forwarded-Proto spoofing | PARCIALMENTE VALIDADO | http/https/Forwarded enviados sem efeito público visível; protocolo derivado de configuração, sem captura de req.protocol/secure no request real. |
| CSP | PARCIALMENTE VALIDADO | Política completa preservada nas seis respostas HTTPS do backend; ausente no 400 de upgrade recusado; SPA real indisponível. |
| Anti-framing | PARCIALMENTE VALIDADO | frame-ancestors 'none' e DENY nas seis respostas HTTPS; mesma exceção de handshake 400; iframe/SPA não exercitados. |
| Headers complementares | PARCIALMENTE VALIDADO | nosniff, Referrer-Policy e Permissions-Policy preservados; HSTS ausente e recusas WebSocket sem headers. |
| CORS HTTP | PARCIALMENTE VALIDADO | Negativos, ausência de Origin e OPTIONS reais conferidos; positivo bloqueado por allowlist vazia. |
| CORS Socket.IO | PARCIALMENTE VALIDADO | Origins recusadas; sem Origin abre transporte mas não autentica; positivo com Origin autorizada não configurado. |

Escopo executado: 28 requisições HTTP públicas (incluindo seis de readiness,
três delas após o último diagnóstico), seis tentativas WebSocket públicas, dois GETs internos de health e
uma recusa WebSocket interna para diagnóstico. Sem flood, fixtures, criação
de usuários ou chamadas a Storage/Cloudinary/Gemini. As requisições normais
podem consumir contadores de rate limit da aplicação, com TTL próprio;
nenhuma chave Redis foi consultada/manipulada diretamente nesta rodada.

Readiness final: R1 e R2 retornaram **HTTP 200, Firestore ready e Redis ready**.
Nenhum commit, push, deploy, mudança de IAM ou de quantidade de réplicas.
Apenas este relatório foi atualizado; harness/evidências locais permanecem
ignorados em `.tmp`. Arquivo externo preexistente mantido intocado.

### Pendências para revisão, sem mudanças automáticas

1. Comprovar peers/CIDRs e observar ip/protocol/secure sanitizados antes de
   propor configuração de TRUST_PROXY; revisar atribuição do limitador HTTP.
2. Definir a origin real de frontend, configurar allowlist somente após revisão
   e executar os positivos HTTP/OPTIONS/WebSocket.
3. Rever HSTS após comprovar o tratamento correto de HTTPS atrás do proxy.
4. Decidir correção da cobertura de headers no abort de upgrade Engine.IO;
   incluir regressão específica antes de qualquer deploy.
5. Frontend/SPA, ciclo completo de Firebase Auth, quotas de importação reais,
   restante dos scripts Lua/IA, Storage, Cloudinary, Gemini, IAM completo,
   falhas/partições, backup, restore e RPO/RTO continuam sem homologação integral.

## Histórico — retomada operacional de 2026-09-15

**Homologação operacional não concluída.** O provisionamento foi informado pelo
usuário, mas a configuração e as evidências de isolamento não estão disponíveis
nesta sessão. Isso não comprova que os recursos não existam; impede acessá-los
com segurança. Esta seção é o estado atual; o relatório anterior foi preservado
abaixo como histórico. **Nota de atualização: os bloqueios desta seção são
históricos; o estado atual está na seção de 2026-09-18 acima.**

### Preflight e bloqueios

- Primeiro comando operacional: `npm run security:staging:preflight`, **exit 2**.
- Resultado: `MISSING`, `NOT CONFIGURED` e `ISOLATION_UNCONFIRMED`.
  `BOLA_ENV_FILES=false` passou; nenhuma variável recebeu valor presumido de staging.
- Não havia variáveis `STAGING_*`, Redis ou provedores configuradas no processo.
  `.env.staging` e `.env.staging.local` não estavam na pasta do jogo;
  `STAGING_ISOLATION_FILE` não foi informado e `.tmp/staging-isolation.json`
  não estava disponível. `.env.local` não foi lido nem carregado nesta retomada.
- Avaliação offline por grupo: Redis, Firebase, mídia e IA retornaram
  `ok=false`, com configuração obrigatória ausente e isolamento não confirmado.
  Nenhum runner de integração real foi executado após o bloqueio.
- Foi solicitado somente o caminho seguro da configuração/manifesto ou o
  mecanismo de injeção de variáveis, sem pedir secrets no chat.
- Não foram confirmadas réplicas, identidades, endpoints, quotas, IAM ou proxy
  por hostname, documentação genérica ou testes locais.

| Área | Status | Evidência |
| --- | --- | --- |
| Redis | NÃO EXECUTADO | TEST_REDIS_URL/REDIS_URL ausentes; isolamento não confirmado. |
| Lua | NÃO EXECUTADO | Nenhum EVAL real; depende do Redis dedicado bloqueado. |
| Socket.IO multi-réplica | NÃO EXECUTADO | Backend, duas réplicas reais e logs/IDs não disponibilizados. |
| Firebase Auth | NÃO EXECUTADO | Projeto e duas identidades explícitas de staging ausentes. |
| Firestore | NÃO EXECUTADO | Projeto/banco isolado e identidade não confirmados; zero transações reais. |
| Storage | NÃO EXECUTADO | Bucket e identidade não confirmados; zero objetos reais. |
| Cloudinary | NÃO EXECUTADO | Configuração e isolamento da conta não confirmados. |
| Gemini | NÃO EXECUTADO | Chave/projeto/modelo, teto baixo e Redis isolado ausentes; 0 chamadas reais. |
| IAM | NÃO EXECUTADO | Identidades e contexto de acesso somente leitura não fornecidos. |
| Proxy | NÃO EXECUTADO | Backend, topologia e TRUST_PROXY não fornecidos; sem alterações por tentativa e erro. |
| Headers | NÃO EXECUTADO | Domínios implantados não identificados; nenhuma consulta real ou iframe de staging. |
| CORS | NÃO EXECUTADO | Origins/frontend/backend não confirmados; E2E local não substitui o ensaio. |
| Readiness | NÃO EXECUTADO | Endpoint, métricas e logs de probes reais indisponíveis. |
| Backup | NÃO EXECUTADO | Sem identificador, timestamp ou evidência operacional da cópia. |
| Restore | NÃO EXECUTADO | Sem cópia e destino novo, vazio e isolado comprovados. |
| RPO/RTO | NÃO EXECUTADO | Nenhum restore executado; valores não medidos. |
| Falhas/partições | NÃO EXECUTADO | Exclusividade dos serviços não confirmada; nenhuma interrupção induzida. |

### Regressão local desta retomada

Executada separadamente, com variáveis de provedores removidas dos processos
locais e arquivos de ambiente desabilitados. Não eleva nenhum status operacional.

| Grupo | Total | Pass | Fail | Cancel | Skip | Exit | Duração (ms) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Harness diagnóstico | 12 | 12 | 0 | 0 | 0 | 0 | 839.7989 |
| Staging local | 38 | 38 | 0 | 0 | 0 | 0 | 360.1242 |
| Relacionados | 81 | 81 | 0 | 0 | 0 | 0 | 4414.2588 |
| Primitivas | 8 | 8 | 0 | 0 | 0 | 0 | 126.5388 |
| npm run test:server | 1391 | 1390 | 0 | 0 | 1 | 0 | 207436.1763 |
| npm run test:frontend | 194 | 194 | 0 | 0 | 0 | 0 | 102760.878 |
| E2E Chrome | 4 | 4 | 0 | 0 | 0 | 0 | 19300 |

`npm audit`: 0 vulnerabilidades, exit 0. Typecheck, build e diff-check: exit 0.
Build em 4.55 s, com aviso preexistente de chunks acima de 500 kB.
Logs locais ignorados: `.tmp/phase4-operational-1789519271157/`.

O teste Redis **continua skip**: antes 1, depois 1; casos que deixaram de ser
skip: **0**. O servidor usou o observer/reporter existente, sem retries,
mudança de timeout, asserts ou concorrência. Nenhuma falha de escrita diagnóstica.

- `matchPersistenceResilience` / `mediaOwnership`:
  **NÃO REPRODUZIDA — diagnóstico melhorado**. Filhos PIDs 14676/50564,
  respectivamente, exit 0, signal null, um processo de teste concorrente.
- EPERM de receipt: **NÃO REPRODUZIDA — causa desconhecida**.
  Staging PID 51940, exit 0, signal null. `fixtures.mjs` permaneceu inalterado.
- Nenhuma das ocorrências anteriores foi declarada corrigida.

### Operações e Git

Chamadas operacionais a Redis, Firebase/Auth/Firestore/Storage, Cloudinary e
Gemini: **0 por serviço**. Fixtures reais, uploads, exclusões, restore e falhas
induzidas: **0**. Nenhum run-id operacional foi criado; cleanup real não foi
executado porque não existia fixture própria a limpar. Consultas do npm audit
ao registry não são chamadas aos provedores do jogo.

Branch `codex/ci-e2e`; HEAD mantido em
`f454cb096a21b85a31c6e52cc26d971d0dd0b152`. Apenas este relatório preexistente,
ainda não rastreado, foi atualizado. Código, configuração, testes, dependências
e arquivo externo preexistente permanecem intocados. Index vazio; diff rastreado
vazio. Logs e resultados ficam ignorados em `.tmp`.

**Sem commit, push, deploy adicional, mudança de IAM, rotação de secrets ou
uso de produção.** Retomada operacional depende da configuração de staging e
do manifesto de isolamento disponibilizados por mecanismo seguro.

## Registro histórico — execução anterior

## Resumo executivo

**Homologação operacional não concluída.** Nenhum ambiente de staging isolado foi identificado ou confirmado nesta execução. Não foram usados mocks para substituir testes operacionais indisponíveis. As suítes locais existentes foram executadas separadamente como regressão, sem comprovar integrações reais.

Foi solicitada a identificação dos domínios e da configuração de staging, sem solicitar secrets no chat. Até o fechamento deste relatório, essa identificação não foi fornecida.

| Área | Status | Evidência |
| --- | --- | --- |
| Redis | NÃO EXECUTADO | TEST_REDIS_URL ausente; Redis/Docker indisponíveis no PATH; WSL sem instalação. |
| Lua | NÃO EXECUTADO | Não há servidor Redis isolado acessível identificado. |
| Socket.IO multi-réplica | NÃO EXECUTADO | Nenhum par de backends implantados/isolados foi disponibilizado. |
| Firebase Auth | NÃO EXECUTADO | Projeto, credencial e contas de teste de homologação não confirmados. |
| Firestore | NÃO EXECUTADO | Banco isolado e identidade de teste não confirmados. |
| Storage | NÃO EXECUTADO | Bucket/prefixo e identidade de homologação não confirmados. |
| Cloudinary | NÃO EXECUTADO | Conta/pasta e configuração de homologação não confirmadas. |
| Gemini | NÃO EXECUTADO | Configuração de teste e limite financeiro não confirmados; zero chamadas reais. |
| IAM | NÃO EXECUTADO | Identidades e políticas efetivas do ambiente não disponibilizadas. |
| Proxy | NÃO EXECUTADO | Domínios, cadeia de proxies e telemetria do ambiente não informados. |
| Headers | NÃO EXECUTADO | Nenhum domínio implantado foi testado; E2E local não comprova headers do edge. |
| CORS | NÃO EXECUTADO | Não há frontend/backend de homologação e origins autorizadas confirmados. |
| Readiness | NÃO EXECUTADO | Sem endpoint de staging, dependências reais ou métricas de probes. |
| Backup | NÃO EXECUTADO | Não foram obtidas evidências operacionais de snapshots/exports. |
| Restore | NÃO EXECUTADO | Sem cópia de teste e destino isolado confirmados. |
| RPO/RTO | NÃO EXECUTADO | Nenhuma recuperação real executada ou cronometrada. |
| Falhas/partições | NÃO EXECUTADO | Requer serviços exclusivos e ambiente isolado confirmado. |

Os impedimentos de infraestrutura não são falhas das proteções das Fases 1–3. Há, separadamente, uma ocorrência local intermitente de encerramento de subprocesso de teste, descrita abaixo.

## Ambiente

- Data da execução: 2026-09-14; evidências locais usam timestamps UTC.
- Máquina Windows/PowerShell; Node v24.15.0; npm 11.12.1.
- Branch: `codex/ci-e2e`.
- HEAD/base: `c7a134c44619f9601bf539ca286ede961ded39a1`.
- Fase 1: `fce7d3d0794dc10c335101f7cae2c23e91112930`.
- Fase 2: `6f82cbd86a54ec587ab8d5aaa24355e6d1fbecac`.
- Réplicas de homologação simultâneas verificadas: **0**.
- E2E local: Chrome, frontend local e backend temporário com Auth/Firestore simulados e persistência em memória. Isso não constitui homologação multi-réplica.
- Sem TEST_REDIS_URL/REDIS_URL ou variáveis de staging/provedores no processo inspecionado.
- Nenhum arquivo `.env.staging`, `.env.staging.local` ou `.env.homologation` encontrado no projeto.
- `.env.local` preexistente contém nomes de configurações de serviços, mas seu isolamento não foi confirmado. Apenas nomes foram inventariados; valores não foram impressos nem carregados para chamadas.
- Docker, redis-server, redis-cli, gcloud e Firebase CLI não encontrados no PATH. O comando de inventário WSL informou que o subsistema não está instalado.
- Não houve instalação de infraestrutura, deploy, alteração de IAM, rotação de credenciais, exclusão de dados reais ou restore.
- `BOLA_ENV_FILES=false` utilizado nas validações/build. O E2E existente desabilita arquivos de ambiente e usa fixtures.
- Logs e artefatos locais permanecem em `.tmp`, ignorado pelo Git. Não há URLs autenticadas ou dados pessoais neste relatório.

## Resultados detalhados

Os procedimentos abaixo são os ensaios necessários para aceite, **não uma declaração de execução**. Onde há impedimento, nenhum dado real foi criado, alterado ou excluído.

| ID / Objetivo | Procedimento de homologação necessário | Resultado esperado | Resultado observado / evidência | Status |
| --- | --- | --- | --- | --- |
| R01 — Redis e readiness | Confirmar isolamento; conectar command/publisher/subscriber; PING e probes; executar socketClusterRedis.test.mjs. | Clientes prontos, conexão real e teste sem skip. | Sem URL de teste. Execução explícita do arquivo: 1 teste, 0 passou, 1 skip. Log phase4-redis.log. | NÃO EXECUTADO |
| R02 — Lua e atomicidade | Executar AI_ACQUIRE_SCRIPT/AI_RELEASE_SCRIPT em Redis dedicado; concorrência pequena, TTL, cooldown, orçamento e lease correta/incorreta. | Limites atômicos, expiração correta; token errado não libera lease alheia. | Nenhum EVAL real executado. Regressão com doubles não comprova sintaxe/semântica real. | NÃO EXECUTADO |
| R03 — Adapter e rooms | Subir dois processos backend isolados; conectar A/B; entrar/sair de room, emitir broadcast e testar usuário não autorizado. | Evento de B chega a A somente com autorização e membership válido. | Nenhuma dupla de processos com Redis/Firestore reais disponível. | NÃO EXECUTADO |
| R04 — Limites/locks globais | Alternar requisições/eventos entre A/B; disputar operação; registrar tokens de fencing sucessivos. | Uma quota global; exclusão mútua; fencing crescente e escrita antiga rejeitada. | Nenhuma competição real entre processos realizada. | NÃO EXECUTADO |
| R05 — Firebase Auth | Criar contas exclusivas; token válido, revogar sessão, reutilizar token via HTTP/Socket; desabilitar conta; expiração/timeout controlado quando possível. | Rejeição após revogação/desabilitação/expiração; indisponibilidade nunca libera autenticação. | Nenhuma conta criada, token real emitido, sessão revogada ou usuário desabilitado. | NÃO EXECUTADO |
| R06 — Firestore e importações | Usar registros com run-id; dois processos reservam sessões por UID, bytes e processamento acima do limite; validar cancelamento, falha, expiração e cleanup. | Transações impedem overbooking; reservas consistentes em todo o ciclo de vida. | Nenhuma transação real ou cleanup executado. | NÃO EXECUTADO |
| R07 — Storage | Prefixo exclusivo; A/B fazem upload; cruzar referência, substituir, excluir e bulk delete; conferir owner/entidade/registro/metadados/generation match; limpar pelos fluxos autorizados. | A nunca remove B; operações legítimas e precondições de geração funcionam. | Nenhum objeto real criado ou removido. | NÃO EXECUTADO |
| R08 — Cloudinary | Assets A/B isolados; public ID legítimo/adulterado/copiado, assinatura adulterada, legado sem prova; substituir/excluir legitimamente. | Vínculo verificado; exclusão cruzada bloqueada; legado não comprovado preservado. | Nenhum upload, assinatura ou remoção real testados. | NÃO EXECUTADO |
| R09 — Gemini | Configurar orçamento baixo; primeira chamada real; segunda dentro do cooldown pela outra réplica; concorrência mínima e tentativa acima do orçamento. | Reserva adquirida antes do provedor; rejeição não gera chamada paga; limite compartilhado. | Zero chamadas reais. Sem chave de teste/Redis exclusivo confirmados. | NÃO EXECUTADO |
| R10 — IAM | Consultar políticas efetivas das identidades e recursos de homologação em modo somente leitura. | Privilégio mínimo comprovado; privilégios excessivos identificados, sem alteração automática. | Políticas não obtidas; nenhum papel removido/adicionado. | NÃO EXECUTADO |
| R11 — Proxy/IP | Documentar cadeia real; comparar requests normais e X-Forwarded-For/Proto forjados com logs/req.ip/HTTPS/rate limit. | Cliente externo não controla identidade/protocolo; topologia confere com TRUST_PROXY. | Nenhum domínio ou telemetria de staging disponível. Não houve configuração por tentativa e erro. | NÃO EXECUTADO |
| R12 — Headers/framing | Consultar /, SPA, API, 404, /health, /ready; conferir CSP, frame-ancestors, XFO, nosniff, Referrer/Permissions e HSTS apropriado; iframe externo em Chrome. | Headers preservados por edge/proxy; iframe bloqueado; HSTS apropriado. | Teste local de iframe passou, mas não houve verificação de domínio implantado. | NÃO EXECUTADO |
| R13 — CORS | Origin A autorizada/B não autorizada; HTTP/Socket; sem Origin, forjado, OPTIONS e credenciais. | Sem autorização CORS indevida; autenticação privada independente de Origin. | Somente regressões locais existentes; nenhuma origem de staging testada. | NÃO EXECUTADO |
| R14 — /ready | Poucas chamadas sequenciais e concorrentes; medir latência e contar probes nos logs/métricas reais; repetir durante dependência pendente. | Cache/single-flight, ausência de consultas excessivas e detalhes internos; dependências refletidas corretamente. | Endpoint e métricas reais indisponíveis. Não houve flood. | NÃO EXECUTADO |
| R15 — Backup | Obter inventários/manifestos, timestamps, política de retenção, criptografia e isolamento. | Evidência de backup existente para cada ativo protegido. | Apenas documentação do repositório; não foi tratada como prova de backup. | NÃO EXECUTADO |
| R16 — Restore/RPO/RTO | Restaurar cópia de teste em destino novo isolado; validar registros, hashes, referências, mídias, permissões e uso básico; medir lacuna de dados e duração total. | Recuperação utilizável/integridade preservada; RPO/RTO efetivamente medidos. | Nenhum restore executado; nenhum valor observado disponível. | NÃO EXECUTADO |
| R17 — Redis some/volta | Somente em instância dedicada: interromper conectividade de teste e restaurar; observar novas conexões, handlers, HTTP e recuperação. | Fail-closed sem fallback local silencioso; recuperação conforme desenho. | Nenhuma interrupção de Redis real provocada. | NÃO EXECUTADO |
| R18 — Falhas de provedores | Em laboratório isolado: indisponibilidade Auth, falha Firestore em transação e falha Cloudinary em remoção. | Auth não libera; quotas não são liberadas indevidamente; sem exclusão cruzada/perda insegura. | Nenhuma partição ou indisponibilidade induzida em serviços reais. | NÃO EXECUTADO |

### Limites importantes dos testes disponíveis

`socketClusterRedis.test.mjs` exige Redis real, mas compartilha um RoomStore em memória e utiliza o test harness com Firebase simulado. Se executado com sucesso futuramente, comprovará a comunicação pelo adapter naquele cenário; **não comprovará sozinho dois processos produtivos, Firestore persistente ou Firebase Auth real**.

Os scripts de uso de IA contêm chaves globais compartilhadas. Um UID de teste, sozinho, não garante isolamento. Usar Redis dedicado à homologação, não uma instância de produção apenas com usuários diferentes.

Não foi criado um servidor falso de Redis nem usado emulador como substituto das integrações reais ausentes.

## IAM

Auditoria efetiva: **NÃO EXECUTADO**. Não houve consulta às políticas externas nem modificação de permissões.

| Permissão efetiva obtida | Motivo funcional a verificar | Serviço | Necessidade | Recomendação |
| --- | --- | --- | --- | --- |
| Nenhuma | Verificar token/revogação e estado do usuário; administrar somente contas de teste durante o ensaio. | Firebase Auth | Separar identidade de runtime da administração de testes. | Fornecer inventário redigido de papéis; confirmar apenas capacidades necessárias. |
| Nenhuma | Leituras, gravações, transações e cleanup dos dados da aplicação. | Firestore | Escopo do banco de homologação, sem acesso a dados produtivos. | Conferir papéis efetivos e permissões herdadas; não conceder Owner/Editor por conveniência. |
| Nenhuma | Criar, ler metadados e remover objetos próprios com generation match. | Storage | Bucket/prefixos de teste autorizados. | Revisar IAM, condições e herança; comprovar isolamento antes dos testes cruzados. |
| Nenhuma | Comandos, pub/sub e scripts Lua realmente utilizados. | Redis | ACL compatível com coordenação, sem acesso ao serviço produtivo. | Comparar ACL efetiva com comandos utilizados e negar operações administrativas desnecessárias. |
| Nenhuma | Upload, vínculo e exclusão de assets de teste. | Cloudinary | Conta/ambiente exclusivo ou isolamento comprovado. | Conferir escopo das credenciais; não presumir que nome de pasta cria isolamento de credencial. |
| Nenhuma | Chamadas mínimas de geração com orçamento baixo. | Gemini | Projeto/chave exclusiva de homologação e teto explícito. | Restringir API/projeto e custos; não consumir orçamento normal. |

Esta tabela orienta a coleta de evidências; **não é confirmação de papéis IAM nem autorização para alterá-los**.

## Backup real

| Componente | Backup existe | Frequência | Retenção | Criptografia | Isolamento |
| --- | --- | --- | --- | --- | --- |
| Firestore, subcoleções e manifests | Não comprovado | Não verificada | Não verificada | Não verificada | Não verificado |
| Firebase Auth | Não comprovado | Não verificada | Não verificada | Não verificada | Não verificado |
| Firebase/Cloud Storage | Não comprovado | Não verificada | Não verificada | Não verificada | Não verificado |
| Cloudinary | Não comprovado | Não verificada | Não verificada | Não verificada | Não verificado |
| Configuração, regras/índices e cofre de secrets | Não comprovado | Não verificada | Não verificada | Não verificada | Não verificado |
| Outros estados persistentes externos | Inventário externo não obtido | Não verificada | Não verificada | Não verificada | Não verificado |

O Git comprova versionamento do código/configuração rastreada, não backup dos dados externos. O runbook BACKUP_RESTORE.md continua sendo orientação, não evidência operacional. Leases Redis não devem ser restaurados como ownership válido; orçamento/quotas precisam de reconciliação.

## Falhas encontradas

### F01 — Encerramento intermitente de subprocesso na regressão local de mídia

- Status da ocorrência inicial: **FALHOU**.
- Severidade: não atribuída como vulnerabilidade; falha de execução de teste local a investigar.
- Componente: subprocesso Node de `server/tests/mediaOwnership.test.mjs`.
- Observado: runner reportou o arquivo como `test failed`, sem assertiva/stack/causa; total do grupo inicial 27 entradas, 26 passaram e 1 falhou.
- Causa: **não determinada**. Não há evidência para atribuir ao controle de propriedade de mídia, a um provedor real ou à concorrência entre suítes.
- Impacto comprovado: essa execução da regressão não terminou verde; não houve operação sobre dados reais.
- Reprodução investigada: execução isolada com reporter TAP passou 5/5; repetição integral da Fase 1 passou 31/31 sem alterações.
- Consulta a eventos de falha Windows não forneceu registro utilizável para identificar a causa.
- Evidência: `.tmp/phase4-phase1.log`, `.tmp/phase4-media-diagnostic.log`, `.tmp/phase4-phase1-repeat.log`.
- Recomendação: se reaparecer, capturar código/sinal do processo filho e diagnóstico do runner no mesmo ambiente. Não aumentar timeouts, desabilitar asserts ou declarar corrigido apenas por repetição verde.
- Correção aplicada: nenhuma. Código e testes permanecem iguais à Fase 3.

Nenhuma vulnerabilidade operacional nova foi comprovada: as integrações reais não puderam ser exercitadas. Isso não demonstra sua ausência.

## RPO/RTO

| Medida | Valor observado | Status |
| --- | --- | --- |
| RPO | Não medido | NÃO EXECUTADO |
| RTO | Não medido | NÃO EXECUTADO |
| Restore real | NÃO VALIDADO — falta cópia de teste e destino isolado confirmado | NÃO EXECUTADO |

As metas anteriores de 24h/8h são somente propostas do runbook e não resultados desta fase.

## Custos

- Chamadas reais a Firebase Auth, Firestore, Storage, Cloudinary e Gemini: **0 por serviço**.
- Chamadas reais a Redis: **0**.
- Uploads, remoções e restaurações de dados reais: **0**.
- Nenhum custo de provedor foi gerado intencionalmente por ensaios operacionais. Não houve acesso a faturamento para aferir a conta externa.
- Consultas do npm audit ao registry não são chamadas aos provedores do jogo.

## Testes automatizados

Regressão local separada da homologação. Os testes existentes que usam mocks continuam classificados como testes locais; não elevam o status das áreas externas na tabela executiva.

| Execução | Total | Passaram | Falharam | Cancelados | Skips |
| --- | ---: | ---: | ---: | ---: | ---: |
| Relacionados | 61 | 61 | 0 | 0 | 0 |
| Fase 1 — primeira execução | 27 | 26 | 1 | 0 | 0 |
| Mídia — diagnóstico isolado TAP | 5 | 5 | 0 | 0 | 0 |
| Fase 1 — repetição TAP | 31 | 31 | 0 | 0 | 0 |
| Fase 2 | 44 | 44 | 0 | 0 | 0 |
| Fase 3 | 32 | 32 | 0 | 0 | 0 |
| Redis — execução explícita | 1 | 0 | 0 | 0 | 1 |
| Servidor completo | 1341 | 1340 | 0 | 0 | 1 |
| Frontend | 194 | 194 | 0 | 0 | 0 |
| E2E Chrome | 4 | 4 | 0 | 0 | 0 |

Os grupos se sobrepõem; não somar como casos únicos. No primeiro grupo Fase 1, a falha do processo representa o arquivo inteiro, e seus cinco casos internos não foram reportados individualmente.

- Skips Redis antes: **1**. Depois: **1**. Casos que deixaram de ser skip: **0**.
- `npm audit`: exit 0, **0 vulnerabilidades** em todas as severidades.
- `npm run typecheck`: exit 0.
- `npm run build`: exit 0; permanece aviso de chunks maiores que 500 kB.
- `git diff --check`: exit 0; sem problemas.
- E2E executado com `E2E_CHANNEL=chrome`; nenhum navegador apontado a serviços produtivos.
- Nenhum timeout aumentado, teste alterado/desabilitado ou falha convertida artificialmente em skip.

Logs: `.tmp/phase4-related.log`, `.tmp/phase4-phase1*.log`, `.tmp/phase4-phase2.log`, `.tmp/phase4-phase3.log`, `.tmp/phase4-redis.log`, `.tmp/phase4-server.log`, `.tmp/phase4-frontend.log`, `.tmp/phase4-e2e.log`, `.tmp/phase4-audit.json`, `.tmp/phase4-typecheck.log` e `.tmp/phase4-build.log`.

## Requisitos para retomar a homologação

1. Identificar explicitamente frontend/backend de staging e confirmar que não contêm usuários/dados reais.
2. Disponibilizar configuração por mecanismo seguro, informando somente nomes/caminhos — não colar secrets no chat.
3. Redis dedicado com TEST_REDIS_URL; duas réplicas/processos de teste e telemetria acessível.
4. Projeto Firebase, banco, bucket, contas e run-id de teste; contexto de IAM somente leitura.
5. Conta/ambiente Cloudinary isolado; configuração Gemini com orçamento deliberadamente baixo.
6. Política real de origins e topologia proxy; métricas/logs suficientes para comparar probes/IP e respostas.
7. Manifesto/cópia de backup de teste e destino novo isolado para restore.
8. Confirmar exclusividade dos serviços antes de indisponibilidade/partições e limpeza de fixtures.

A inexistência de configurações identificadas não autoriza usar credenciais locais desconhecidas, apontar testes à produção ou substituir serviços reais por mocks.

## Git

- Branch: `codex/ci-e2e`.
- HEAD inalterado: `c7a134c44619f9601bf539ca286ede961ded39a1`.
- Arquivo novo desta fase: `docs/PHASE4_SECURITY_VALIDATION.md`.
- Arquivos de código/configuração/testes/dependências alterados: **0**.
- `git status --short`: relatório novo não rastreado e arquivo externo preexistente não rastreado; nada em stage.
- `git diff --stat`: sem alterações rastreadas. Relatório novo: 199 linhas adicionadas, 0 removidas (ainda não aparece no diff normal).
- `.env.local`, logs, `.tmp/*`, credenciais e o arquivo externo não foram adicionados ao index.
- Nenhum commit, push, deploy ou alteração de IAM executado nesta fase.

**Relatório encerrado com bloqueios explícitos. Não considerar a homologação operacional aprovada.**

## Atualização local — publicação Firestore v1 / dependências — 2026-10-02

Esta seção é cronológica: não substitui as ocorrências e classificações históricas acima. Relatório operacional permanece local, não rastreado e fora dos commits. Homologação pós-publicação **PARCIALMENTE VALIDADA**, com bloqueios explícitos.

### Publicação e deployments automáticos

- Branch: `codex/ci-e2e`.
- Dependências: `1031f21a3c381c6e71160ffc6c2db0ae2ce6a6f0` — `security: update vulnerable runtime dependencies` — 2 arquivos, +45/-36.
- Firestore: `44125f254b2df27005fd3c9b3c991477ca1475ca` — `fix: make match persistence cancellable with Firestore v1` — 13 arquivos, +960/-87.
- Push concluído; ambos os hashes confirmados em `origin/codex/ci-e2e` após fetch. Total: 15 arquivos, +1005/-123.
- Backend: deployment `bdb40ef8-8070-44ef-9404-3d1c25b3950c`, `SUCCESS`, commit final acima, duas réplicas.
- Frontend: deployment `ebfcec5f-4525-4713-b91a-f7ae0ee234ab`, `SUCCESS`, mesmo commit, uma réplica.
- Nenhum redeploy manual. Nenhuma alteração de IAM, Firebase, Redis, quantidade de réplicas, Storage, Cloudinary ou Gemini.
- `.env*`, `.tmp`, evidências, logs, credenciais, este relatório e arquivo externo preexistente ficaram fora dos dois commits. Varredura dos 15 arquivos: nenhum secret detectado.

### Validação local aprovada para publicação

| Verificação | Resultado |
| --- | --- |
| npm audit antes do commit | 0 vulnerabilidades |
| Árvore instalada | grpc-js 1.14.5 nos caminhos Firebase e google-gax; socket.io 4.8.4; engine.io 6.6.11 |
| Corpus | 37/37 |
| Servidor | 1431 pass, 0 fail, 1 skip |
| Frontend | 194/194 |
| E2E Chrome local | 4/4 |
| Typecheck / build / diff-check | Aprovados |

Esses resultados completos são a validação pré-publicação aprovada; não equivalem a E2E autenticado no staging real. `TEST_REDIS_URL` continua sendo requisito do único skip local.

### Timeout pós-publicação — harness local seguro, sem outage real

| Execução | Timeout observado | Cleanup adicional | Sockets antes/depois | RPC após deadline |
| --- | ---: | ---: | --- | ---: |
| 1 | 15003 ms | 2,541 ms | 1 → 0 | 0 |
| 2 | 15000 ms | 0,762 ms | 1 → 0 | 0 |

Nas duas execuções: `MATCH_PERSISTENCE_TIMEOUT`, causa `DEPENDENCY_TIMEOUT`, um RPC, cliente fechado e encerramento natural. Budget do produto permanece 15000 ms. Evidência local: `.tmp/security-staging/publication-timeout.json`.

Ocorrência original preservada: **Timeout controlado: FALHOU; Cleanup: FALHOU** — duas reproduções históricas com cleanup ainda pendente após +3001 ms e socket aberto. Resultados pós-correção são separados: timeout/cleanup locais **VALIDADOS**; ausência de escrita tardia continua aprovada pela regressão local, não por outage do serviço real nesta execução.

### Verificações reais sem escrita após o deployment

| Cenário | Status | Evidência |
| --- | --- | --- |
| Backend réplica 47b6aa46-4e0b-4e8b-bcdf-8a25e684a1b6 | VALIDADO | /ready 200; Firestore ready; Redis ready |
| Backend réplica 59d507ab-8a3d-431a-9e90-a320d0a81402 | VALIDADO | /ready 200; Firestore ready; Redis ready |
| Frontend | VALIDADO | HTTP 200; tela de login real carregada no Chrome; console/erros vazios antes de autenticação |
| Origin inválida | VALIDADO | WS 400, conexão encerrada, sem ACAO, com CSP/XFO/nosniff/Referrer/Permissions |
| Origin null | VALIDADO | Mesmo resultado de recusa segura |
| Origin autorizada, token ausente | VALIDADO | WebSocket chega à autenticação; namespace recusado com AUTH_REQUIRED; nenhuma sessão autenticada |
| EIO incompatível em conexão EIO4 exclusiva | PARCIALMENTE VALIDADO — risco residual de hardening | Upgrade recusado: HTTP 400 Bad request; conexão encerrada; nenhum novo namespace autenticado |
| EIO ausente em conexão EIO4 exclusiva | PARCIALMENTE VALIDADO — risco residual de hardening | Mesmo resultado de recusa de protocolo |

No caminho interno `abortUpgrade`, CSP/XFO/nosniff/Referrer/Permissions de documento não são aplicados. Não há bypass de autenticação/CORS nem informação sensível na resposta. Risco residual aceito pelo usuário; não houve modificação de internals, monkey-patch ou edição de node_modules. As conexões Engine.IO próprias dos probes foram encerradas. Polling não é habilitado no backend de produção/staging (`NODE_ENV=production`); o probe de namespace usou WebSocket.

Evidência local: `.tmp/security-staging/publication-transport.json`. As verificações distribuídas históricas (Socket.IO autenticado, adapter, room authorization, rate limit, lock, exclusão mútua e fencing) permanecem registradas como anteriormente validadas; não são prova de regressão autenticada pós-upgrade nesta execução.

### Bloqueios da homologação com escrita e autenticação

1. Manifesto local: `productionInventoryReviewed=false`; isolamento Firebase não confirmado; `credentialHash` Firebase não corresponde à configuração atual. `targetHash` corresponde. Nenhum flag/hash foi ajustado para contornar esse bloqueio.
2. SSH: serviço ssh-agent local parado; chave existente não disponível ao agente. Não foi pedida passphrase, criada chave, nem alterada infraestrutura.
3. Harness real de save/load abortou na verificação do manifesto, **antes** da inicialização Firestore ou criação de fixture. Não é falha da persistência v1; não há resultado real de transação/ownership/fencing/concorrência/-0 nesta execução.
4. Nenhum usuário temporário criado. Login Firebase, leitura/escrita client-side, E2E autenticado real com override grpc e Socket.IO autenticado cross-replica pós-upgrade: **NÃO EXECUTADOS**.
5. Fixtures Firestore criadas: 0. Usuários temporários criados: 0. Chaves Redis exclusivas de fixture: 0. O probe AUTH_REQUIRED pode atualizar o contador normal de conexão, que possui TTL; não foi removido por ser chave compartilhada sem ownership do run-id. Ausência de resíduos Redis não foi inspecionada diretamente sem SSH.

### Pendências preservadas

- Proxy/XFF/XFP: parcialmente validado; TRUST_PROXY não alterado.
- `TEST_REDIS_URL` skip local.
- Homologação real pós-migração v1 e fluxo Firebase frontend ainda pendentes pelos bloqueios acima.
- Permission Denied/ownership/recovery de falhas Firebase ainda precisam ser retomados no contexto operacional autorizado.
- Storage, Cloudinary, Gemini, IAM operacional, contenção/partições, backup/restore e RPO/RTO não foram validados neste bloco.
- Não declarar corrigidas as intermitências históricas `matchPersistenceResilience`/`mediaOwnership` (NÃO REPRODUZIDA — diagnóstico melhorado) ou EPERM de receipt (NÃO REPRODUZIDA — causa desconhecida).

**Publicação concluída; homologação operacional pós-publicação incompleta. Parar para revisão dos guardrails locais e acesso SSH antes de novas escritas.**

## Retomada remota — isolamento e SSH — 2026-10-02

Somente revisão operacional/read-only. Código rastreado inalterado; nenhum commit, push ou deploy. `.env.local` não foi lido. Nenhuma credencial de produção foi solicitada ou copiada.

### SSH resolvido

O serviço ssh-agent foi iniciado com sucesso e a chave **existente** estava disponível ao agente. Nenhuma chave nova e nenhuma solicitação/impressão de passphrase.

SSH específico confirmou em ambas:

- `47b6aa46-4e0b-4e8b-bcdf-8a25e684a1b6`;
- `59d507ab-8a3d-431a-9e90-a320d0a81402`.

Serviço `backend-staging`, environment `staging`, deployment `bdb40ef8-8070-44ef-9404-3d1c25b3950c`, commit `44125f254b2df27005fd3c9b3c991477ca1475ca`. Versões efetivamente instaladas em ambas: Socket.IO 4.8.4, Engine.IO 6.6.11, grpc-js 1.14.5 nos caminhos Firebase e google-gax. Processos SSH temporários encerraram normalmente.

### Inventário e bloqueio concreto

- Railway staging: projeto `1be41784-01e6-4963-8b71-a747e26a3d9a`, environment `aad3fc33-f735-4ac5-a0b6-0fedda3092e4`.
- Backend `24117ed9-bb09-4146-acaf-e9788c6bc898`; frontend `23698311-e53c-4bec-bf0b-1402fe37b5a1`; Redis dedicado `6bb50156-7104-46f7-b8f6-696c70c81b1c`.
- Domínios staging correspondem aos URLs esperados; nenhum domínio customizado. O environment chamado production dentro deste projeto **de staging** está vazio; não é prova de inventário completo da produção do jogo.
- Consulta read-only ao projeto Railway de produção informado, `5cd69095-072a-4b77-ab38-454694c81529`, retornou **Not Authorized**. A CLI lista somente o projeto dedicado de staging. Serviços, Redis e domínios atuais da produção não puderam ser confirmados.
- Metadados Google confirmam projetos ACTIVE distintos: produção `bola-manager`, número `326057995394`; staging `bola-manager-staging-baf7002a`, número `262839513440`.
- Lista read-only das service accounts do projeto de produção não contém as identidades staging.
- Banco staging confirmado: `projects/bola-manager-staging-baf7002a/databases/(default)`, Native, `southamerica-east1`.
- Runtime: `bm-staging-runtime@bola-manager-staging-baf7002a.iam.gserviceaccount.com`.
- Testes: `bm-staging-test-admin@bola-manager-staging-baf7002a.iam.gserviceaccount.com`.
- Identidades distintas; credencial runtime local corresponde à usada pelo backend. ADC/emulators não introduzidos.
- Cloudinary/Gemini fora da validação atual; não acessados.

### Credential hash — causa identificada, aplicação bloqueada

O hash armazenado coincide exatamente com `fingerprint(["", ""])`: credenciais vazias no template inicial. Não corresponde às credenciais atuais. `isolationTemplate()` calculou o fingerprint atual a partir da configuração staging atual, sem imprimir JSON, private key, token ou hashes.

A causa não é evidência de rotação maliciosa ou mistura com produção. O manifesto ainda contém evidência histórica de credenciais ausentes. Atualização **não aplicada**, pois ainda falta comprovar o inventário Railway de produção completo. `productionInventoryReviewed=false` e `STAGING_ALLOW_WRITES=false` permanecem. Nenhum boolean/hash foi editado para contornar o guardrail.

### Resultado desta retomada

| Área | Status | Evidência |
| --- | --- | --- |
| Isolation manifest | PARCIALMENTE VALIDADO | Separação Firebase confirmada; Railway produção Not Authorized; revisão não liberada |
| Credential hash | PARCIALMENTE VALIDADO | Causa template vazio identificada; hash atual calculado oficialmente, não aplicado |
| Save/load real | NÃO EXECUTADO | Guardrail de isolamento pendente |
| Transaction real | NÃO EXECUTADO | Mesmo bloqueio |
| Ownership | NÃO EXECUTADO | Mesmo bloqueio; validações históricas não reclassificadas |
| Fencing | NÃO EXECUTADO | Mesmo bloqueio |
| Concorrência | NÃO EXECUTADO | Mesmo bloqueio |
| -0 real | NÃO EXECUTADO | Mesmo bloqueio; nenhuma fixture criada |
| Firebase frontend | NÃO EXECUTADO | Nenhum usuário temporário criado; skill de browser não iniciou fluxo autenticado |
| Socket.IO auth | NÃO EXECUTADO | Sem usuário/fixture autorizados pelo manifesto |
| Cross-replica | NÃO EXECUTADO | Sem reexecução indevida de testes históricos |
| Redis cleanup | NÃO EXECUTADO | Nenhuma chave do run-id criada; sem KEYS/SCAN/FLUSH ou acesso público Redis |

Resíduos desta retomada: documentos Firestore **0**, usuários temporários **0**, chaves de fixture Redis **0**, sockets/processos temporários persistentes **0**. Isso não certifica ausência de resíduos históricos ou contadores normais da aplicação.

Estado final revalidado: `/ready` HTTP 200 nas duas réplicas, Firestore ready, Redis ready; frontend HTTP 200. Mesmos deployments backend `bdb40ef8-8070-44ef-9404-3d1c25b3950c` e frontend `ebfcec5f-4525-4713-b91a-f7ae0ee234ab`, ambos SUCCESS no commit publicado. Nenhum redeploy manual.

Ressalva preservada: abortUpgrade/mismatch EIO **PARCIALMENTE VALIDADO — risco residual de hardening**. Sem monkey-patch.

Evidências sanitizadas locais: `.tmp/security-staging/publication-runtime.json` e `.tmp/security-staging/isolation-review-20261002.json`.

**Parar conforme guardrails. Para retomar, disponibilizar acesso de leitura ao projeto Railway de produção ou inventário autoritativo atual, sem secrets, exportado por quem possui acesso. Não considerar a homologação remota concluída.**

## Inventário autoritativo recebido — manifesto revisto — 2026-10-02

O proprietário forneceu inventário atual da produção, revisado diretamente na conta proprietária. A limitação `Not Authorized` da CLI permanece, mas deixou de impedir a revisão documental dos recursos declarados. Nomes sozinhos não foram usados como evidência. Nenhuma escrita/chamada de configuração contra produção.

| Recurso | Produção autoritativa | Staging confirmado pela API | Separação |
| --- | --- | --- | --- |
| Project | 5cd69095-072a-4b77-ab38-454694c81529 | 1be41784-01e6-4963-8b71-a747e26a3d9a | IDs distintos |
| Environment | b1e9cd48-9052-4608-b9f1-2960f6cd20b1 | aad3fc33-f735-4ac5-a0b6-0fedda3092e4 | IDs distintos |
| Backend service | 4855e0c0-f7ec-42d0-a60b-f848ff1bf39c, único serviço | 24117ed9-bb09-4146-acaf-e9788c6bc898 | IDs distintos |
| Frontend service | Mesmo único serviço de produção | 23698311-e53c-4bec-bf0b-1402fe37b5a1 | IDs distintos |
| Redis | Nenhum Redis/database separado visível no inventário do proprietário | 6bb50156-7104-46f7-b8f6-696c70c81b1c | Serviço dedicado em outro project/environment |
| Firebase | bola-manager | bola-manager-staging-baf7002a | Project IDs distintos, confirmados por metadados Google |
| Firestore | projects/bola-manager/databases/(default) | projects/bola-manager-staging-baf7002a/databases/(default) | Nomes completos distintos; ambos Native/southamerica-east1 |
| Domains | bolamanager.up.railway.app | backend-staging-staging-6c48.up.railway.app e frontend-staging-staging-39e9.up.railway.app | Distintos; sem custom domains staging |
| Volume | Nenhum volume visível no canvas/configuração do único serviço, conforme proprietário | 3cc4200e-7ab3-4403-8074-f24389f860ec | Volume do project staging |

VolumeInstance staging `079058ac-87bd-46ce-b995-6014e7951a62`, environment staging acima, serviço Redis acima, mount `/data`, região `sfo`. Backend staging `us-west2`/2 réplicas, frontend `sfo`/1, Redis `sfo`/1. Produção: 1 réplica configurada em US West/California, trial expirado, offline e último build falhou, conforme inventário fornecido. Sobreposição geográfica não prova nem invalida isolamento; a evidência está nos IDs/vínculos e endpoints.

Vínculo Redis do backend com a instância dedicada foi comparado em memória contra a configuração do serviço staging: host/porta/usuário/credencial correspondem, pela rede privada. Nenhuma URL/senha foi impressa; nenhum TCP Proxy criado.

### Manifesto antes de escrita

Foi seguido o fluxo documentado em `docs/STAGING_SECURITY_SETUP.md`: revisão do operador, evidência no arquivo ignorado, denylist calculada com `serviceTargets()`/`fingerprint()` e hashes atuais calculados por `isolationTemplate()`. Nenhum hash digitado manualmente ou reaproveitado de execução anterior.

- `environment=staging`.
- `productionInventoryReviewed=true`, com inventário autoritativo e metadados staging registrados em `reviewEvidence`.
- Hash Firebase atual aplicado; corresponde às duas credenciais staging atuais. Runtime/admin continuam distintos e runtime local corresponde ao backend.
- `firebase isolation: PASS`.
- Hashes de todos os serviços foram recalculados a partir da configuração local atual. Serviços sem target local continuam sem target válido e **não foram certificados como isolados no preflight**.
- Mídia/IA/Storage não certificados nem exercitados neste bloco; registrados fora do escopo pretendido.
- `.env.staging` não foi preenchido com valores inventados; `STAGING_ALLOW_WRITES=false` preservado.

### Preflight bloqueou a janela

Comando oficial: `node --env-file=.env.staging scripts/security-staging-preflight.mjs`, **exit 2**. Resultado: 17 PASS, 16 MISSING, 0 INVALID, 8 NOT CONFIGURED. Nenhuma liberação de escrita.

Configuração local relevante ainda ausente:

- `STAGING_BACKEND_URL`, `STAGING_FRONTEND_ORIGIN`, `VITE_SERVER_URL`, `CLIENT_ORIGIN`;
- `TRUST_PROXY`;
- `REDIS_URL`, `TEST_REDIS_URL`;
- `FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_STORAGE_BUCKET`.

O preflight global também inclui Cloudinary e Gemini, não configurados e fora dos testes atuais. Não foram configurados/chamados para forçar resultado verde.

Mesmo o grupo oficial `firebase` retorna bloqueio: 7 PASS, 1 MISSING, 1 NOT CONFIGURED, pois esse grupo inclui `storage` e exige `FIREBASE_STORAGE_BUCKET`/isolamento Storage. O runner Firebase oficial exercita Storage; não foi executado nem substituído por uma aprovação parcial disfarçada. Nenhum bucket fictício, filtro de falhas ou alteração do preflight/runner.

### Parada conforme instrução

Save/load, transaction, ownership, fencing, concorrência, -0 real, login/leitura/escrita frontend e Socket.IO autenticado: **NÃO EXECUTADOS nesta retomada**, pois o guardrail falhou antes da janela. Documentos/usuários/chaves Redis de fixture/processos persistentes criados: **0**. Nenhuma mudança de código rastreado, commit/push/deploy/IAM/Firebase/Redis.

Risco residual abortUpgrade/mismatch EIO permanece **PARCIALMENTE VALIDADO — risco residual de hardening**.

Evidências locais sanitizadas: `.tmp/security-staging/current-staging-metadata.json`, `.tmp/security-staging/staging-volume-redis-binding.json` e `.tmp/security-staging/isolation-owner-review.json`. Manifesto preenchido continua ignorado e não commitado.

**Inventário/credentialHash resolvidos; homologação ainda bloqueada pela configuração/preflight local. Parar para revisão, sem habilitar STAGING_ALLOW_WRITES.**

## 2026-10-02 — escopos oficiais e homologação Firestore/frontend

Autorização posterior: adicionar escopos mínimos ao preflight/harness existente, sem
alterar runtime, reduzir requisitos globais, preencher provedores fictícios ou fazer
commit/push/deploy. Nenhuma integração Storage/Cloudinary/Gemini executada.

### Preflight e guardrails

Não existia profile/capability adequado: o grupo `firebase` inclui Storage. Foram
adicionados `--scope firestore-match-persistence` e `--scope frontend-socketio`,
mantendo os grupos anteriores e o comando global sem argumentos. Recursos excluídos
são `NOT_APPLICABLE`, nunca `PASS`. Recibos/cleanup são vinculados ao scope.

O helper `createScopeEvidence` vincula observações atuais de metadados/SSH/readiness
aos alvos/credenciais, com validade de 15 minutos; não aprova isolamento automaticamente.
Produção revisada, denylist, provas por serviço, identidades explícitas distintas e opt-in
de escrita continuam obrigatórios. Redis do segundo scope foi confirmado por SSH/rede
privada e `/ready`; URLs Redis locais continuam ausentes.

Somente URLs reais fornecidas pelo operador e `TRUST_PROXY=false` foram preenchidas
na configuração local ignorada. Storage permaneceu não configurado, sem bucket presumido.
Hashes foram atualizados pelos helpers oficiais; inventário autoritativo foi preservado.

| Check antes de escrita | Resultado |
| --- | --- |
| productionInventoryReviewed | PASS |
| Firebase isolation | PASS |
| targetHash / credentialHash atuais | PASS |
| Backend target | PASS |
| Firestore project/database | PASS — staging, `(default)`, Native, southamerica-east1 |
| Runtime identity | PASS |
| Test identity distinta | PASS |
| Writes | false |

| Preflight | Exit | PASS | NOT_APPLICABLE | MISSING | NOT CONFIGURED |
| --- | ---: | ---: | ---: | ---: | ---: |
| Firestore read-only final | 0 | 17 | 6 | 0 | 0 |
| Firestore janela de escrita | 0 | 18 | 6 | 0 | 0 |
| Frontend/Socket.IO read-only final | 0 | 27 | 6 | 0 | 0 |
| Frontend/Socket.IO janela de escrita | 0 | 28 | 6 | 0 | 0 |
| Global, mesma configuração atual | 2 | 25 | 0 | 11 | 5 |

Prova adicional: resultado global atual foi comparado com `evaluatePreflight` extraído
do HEAD publicado, usando exatamente o mesmo env e manifesto: `deepEqual` passou.
A melhora dos números globais decorre exclusivamente das URLs/provas reais agora
preenchidas; os requisitos e o resultado da versão anterior são idênticos. O modo
global continua bloqueando Redis local, Storage, Cloudinary e Gemini ausentes.

NOT_APPLICABLE Firestore: frontend, Redis/RedisTest locais, Storage, Cloudinary, Gemini.
NOT_APPLICABLE frontend/Socket.IO: REDIS_URL/TEST_REDIS_URL locais, Storage e seu campo
VITE, Cloudinary, Gemini. **Redis privado Railway é exigido e PASS, não é excluído.**

### Resultados operacionais

| Área | Status | Evidência |
| --- | --- | --- |
| Save/load real | VALIDADO | `FirestoreMatchSessionPersistence`, transporte oficial v1 REST; snapshot hidratado e semanticamente equivalente |
| Transaction real | VALIDADO | 8 beginTransaction, 11 getDocument, 5 commit, 4 rollback observados no cliente público |
| Ownership | VALIDADO | owner ausente/incorreto rejeitado; fixture própria |
| Fencing | VALIDADO | owner/fence atual aceito; anterior retorna MATCH_OWNERSHIP_LOST; estado novo preservado |
| Concorrência | VALIDADO | duas gravações concorrentes, sequência final 4, nenhuma atualização antiga sobrepôs a nova |
| -0 real | VALIDADO | 4-3-3, 11 jogadores válidos, atributos inteiros 10, instruções aprovadas; produtor mantém -0, wire integerValue=0, reload +0, snapshot original inalterado |
| Firebase frontend | VALIDADO | navegador Chrome real, login e logout; tema light lido da fixture, mudança dark salva pelo SDK cliente, recarregamento; zero erros Firebase/gRPC observados |
| Socket.IO auth/CORS | VALIDADO | token obrigatório; origin autorizado aceito, inválido/null recusados |
| R1/R2 + Redis adapter | VALIDADO | conexões autenticadas mapeadas aos logs reais, room:resume autorizado e chat broadcast nos dois sentidos |
| Cleanup | VALIDADO | documentos/usuários/chaves exatas removidos; provas de ownership verificadas; conexões/processos temporários encerrados |

O teste de fencing deste bloco usa owners/fences explícitos na fixture do consumidor
Firestore real; não reexecuta nem substitui a homologação anterior do distributed lock
Redis e da geração real de tokens. A fixture de sala/browser usa dados sintéticos
descartáveis; não é uma homologação do catálogo completo, Storage ou mercado.

### Incidentes do harness preservados

1. Primeira tentativa frontend: código BOLA com 8 caracteres, incompatível com o schema
   real de 4 caracteres. Backend recusou corretamente. Fixture/harness corrigido para
   usar `roomCodeSchema` antes de escrever; usuário/documentos/chave removidos.
2. Segunda tentativa: espera de entrega iniciava antes do ACK; o backend terminou
   chat:send com sucesso em 14,254 s, mas a Promise de entrega de 10 s rejeitou sem
   tratamento. Processo encerrou; recibo foi preservado e cleanup dedicado verificou
   ownership e removeu todos os recursos. Nenhuma alteração no backend.
3. Harness corrigido para instalar listener antes do envio e observar entrega após ACK;
   limite do ACK permanece 15 s e limite de entrega permanece 10 s. Tentativa final verde.

### Estado final e exclusões

- `STAGING_ALLOW_WRITES=false` após todas as janelas; `TRUST_PROXY=false` inalterado.
- Firestore residual: não; Redis residual do run-id: não; usuário residual: não.
- Frontend/browser desconectado; credencial temporária do auth vault excluída.
- Deployments permanecem backend `bdb40ef8-8070-44ef-9404-3d1c25b3950c`, frontend
  `ebfcec5f-4525-4713-b91a-f7ae0ee234ab`, commit `44125f254b2df27005fd3c9b3c991477ca1475ca`.
- R1 `47b6aa46-4e0b-4e8b-bcdf-8a25e684a1b6`; R2 `59d507ab-8a3d-431a-9e90-a320d0a81402`.
- Redis sem endpoint público novo; cleanup via SSH apenas da chave exata vinculada ao UID próprio.
- IAM, Redis/Firebase config, réplicas e produção não alterados. Nenhum commit/push/deploy.

Evidências sanitizadas locais: `scoped-readonly-observation.json` e recibos/relatórios
dos run-ids em `.tmp/security-staging/`. Manifesto, env, logs, provas e este relatório
operacional continuam locais, fora de commit.

Ressalvas anteriores preservadas: abortUpgrade/EIO mismatch sem headers de documento
é **PARCIALMENTE VALIDADO — risco residual de hardening**; proxy/XFF/XFP parcial;
integrações restantes da Fase 4 continuam fora deste bloco. Não declarar homologação
global concluída.

### Validação local deste bloco

- Preflight/harness: 69/69 (38 existentes + 31 novos), fail/cancel/skip 0.
- Servidor: 1463 testes, 1462 pass, 0 fail, 0 cancelled, 1 skip; exit 0.
  O único skip continua exigindo `TEST_REDIS_URL`.
- Frontend: 194/194, 0 fail/cancel/skip; exit 0.
- E2E Chrome: 4/4; exit 0.
- Typecheck e build: exit 0; aviso de tamanho de bundle já existente.
- `git diff --check`: exit 0.
- `npm audit`: exit 1, **6 High**, sem mudanças de dependências. Novos advisories
  `GHSA-xjh9-v7x6-24jw`, `GHSA-x8mw-p69m-v3mx` (@fastify/busboy) e
  `GHSA-vfj7-8cjw-p6xm` (braces, propagado na cadeia Tailwind/chokidar/fast-glob/micromatch).
  Correção não iniciada, fora do escopo autorizado; não usar omit/ignore para escondê-los.

## Publicação scoped preflight + Busboy/Tailwind — 2026-10-03

### Git e deployments automáticos

- Preflight: `09f7b3eee01ae8c7e16801b18a8abf76a687b35d`,
  `test: add scoped staging security preflight`; 5 arquivos, +201/-13.
- Dependências/Tailwind: `9b58e7eb15d02848bd84331380ed2a49a9feda44`,
  `security: update vulnerable dependencies and migrate Tailwind 4`;
  9 arquivos, +731/-856.
- Push `origin/codex/ci-e2e` confirmado; ambos os commits presentes na história remota.
- Total: 14 arquivos; 11 modificados, 2 novos, 1 removido; +932/-869.
- Backend: `b884a483-fd82-4ab3-a561-083e2366a09d`, SUCCESS, 2 réplicas.
- Frontend: `ff145dd1-a263-4a20-8a9f-a52fecf69c4e`, SUCCESS, 1 réplica.
- Ambos implantaram o commit final `9b58e7eb15d02848bd84331380ed2a49a9feda44`
  automaticamente pela branch GitHub. Nenhum redeploy manual.
- Env, .tmp, REVIEW temporário, evidências/screenshots/logs, este relatório local,
  credenciais/secrets e arquivo externo preexistente ficaram fora dos commits.

### Validação local final

- Servidor: 1470 testes; 1469 pass, 0 fail, 0 cancelled, 1 skip;
  exit 0; 252511,6907 ms. Skip continua exigindo TEST_REDIS_URL.
- Frontend: 200/200, fail/cancel/skip 0; exit 0; 118898,1382 ms.
- E2E Chrome: 4/4; exit 0; 18,8 s.
- Preflight: 69/69; exit 0; 332,7925 ms.
- Regressões dependências/Tailwind: 18/18; exit 0.
- npm ci, npm audit (0 vulnerabilidades), typecheck, build e diff-check: exit 0.
- Uma inconsistência local foi descoberta: o lock e o cache npm indicavam Busboy
  3.2.1, mas os arquivos efetivamente instalados eram 3.2.0. npm ci, sem mudar
  package/lock, corrigiu a instalação. As suítes acima foram repetidas depois disso.
- Integridade oficial npm do artefato 3.2.1 conferida; todos os seus 20 arquivos
  instalados correspondem ao tarball, sem diferenças. Não foi editado node_modules.

| Item | Resultado | Evidência |
| --- | --- | --- |
| Tailwind 4 — migração/build/paridade local | VALIDADO | 4.3.3; regressões verdes; comparação aprovada anterior 18/18 idêntica; CSS +0,23% |
| Busboy 3.2.1 | VALIDADO | instalação limpa, Dicer/multipart aprovado; versão 3.2.1 confirmada via SSH nas duas réplicas |
| CSS publicado | VALIDADO | frontend HTTPS 200; stylesheet servido identifica Tailwind 4.3.3 |
| npm audit | VALIDADO | 0 vulnerabilidades |
| Safari | NÃO EXECUTADO | Ressalva preservada; não ampliado o escopo |
| Firefox | NÃO EXECUTADO | Ressalva preservada; não ampliado o escopo |
| Bundle JS warning | PREEXISTENTE / NÃO BLOQUEADOR | Mantido, sem redesign ou alteração de splitting |

### Guardrails e smoke remoto

- Observação atual via metadados Railway/Firestore, SSH e helpers oficiais:
  Firestore scope 17 PASS + 6 NOT_APPLICABLE; frontend/socketio scope
  27 PASS + 6 NOT_APPLICABLE em read-only. Janela frontend escrita:
  28 PASS + 6 NOT_APPLICABLE, exit 0.
- Global continua restritivo: 25 PASS, 11 MISSING, 5 NOT CONFIGURED; não foi
  contornado nem interpretado como homologação global aprovada.
- Isolamento, inventário revisado, hashes atuais, identidades distintas e targets
  confirmados antes das fixtures. Escrita habilitada somente nas janelas locais.
- Redis acessado somente via rede privada/SSH e somente por chaves exatas dos UIDs.
- Sem mudança IAM, quantidade de réplicas, Firebase/Redis config, produção,
  Storage, Cloudinary ou Gemini.

| Smoke | Resultado | Evidência |
| --- | --- | --- |
| Firebase login | VALIDADO | Usuário temporário; login Chrome real via auth vault; lista de save própria carregada |
| Socket.IO autenticado | VALIDADO | Origin autorizada; conexão e room:resume com ACK válido na fixture exclusiva |
| Dashboard/time | PARCIALMENTE VALIDADO | Layout/CSS renderizados; dados do clube carregados; elenco não concluiu |
| Elenco/escalação | FALHOU | API de jogadores excedeu prazo; lista não carregou. Não é prova de regressão CSS |
| Táticas | PARCIALMENTE VALIDADO | Layout/formação/controles renderizados; jogadores ausentes pelo timeout de leitura |
| Tela de partida | PARCIALMENTE VALIDADO | Tela pré-jogo renderizada; não foi iniciada campanha de partidas |
| Modal/dialog e responsive completo | NÃO EXECUTADO | Smoke interrompido pelo bloqueio de leitura; não declarar visual remoto 100% |
| Logout pela UI | NÃO EXECUTADO | Browser/credencial temporária fechados e removidos pelo cleanup; não confundir com logout validado |

Ocorrências preservadas:

1. Fixture inicial AUR não existe no catálogo real desse usuário; cancelada e
   removida, incluindo catálogo pessoal inicializado automaticamente pelo backend.
2. Busca read-only no catálogo compartilhado não encontrou dois elencos válidos;
   tentativa cancelada/limpa. Nenhum catálogo global foi modificado.
3. Fixture representativa dos E2E persistida somente no catálogo de UID exclusivo,
   com dois clubes e 32 atletas. Login e Socket.IO passaram. Leitura de elenco
   na UI retornou timeout; uma recarga normal também não concluiu. A janela do
   harness terminou e executou cleanup; nenhuma asserção foi removida.
4. Leitura HTTP mínima equivalente em outra fixture válida, antes de abrir browser,
   também não concluiu em 15000 ms: AbortSignal TimeoutError (code 23).
   A causa subjacente não foi identificada. Não aumentar timeout, alterar runtime
   ou declarar esse bloqueio corrigido/causado por Tailwind sem evidência.
5. Tentativa isolada de ajustar o nome excessivo da terceira fixture via identidade
   administrativa foi rejeitada com auth/insufficient-permission. Nenhum IAM foi
   alterado e nenhum perfil foi atualizado. Fixture seguinte criada com nome normal.

Portanto, publicação concluída; homologação visual funcional completa deste bloco
permanece **PARCIALMENTE VALIDADA**, bloqueada pela leitura de elenco. Não marcar
a Fase 4 completa. Homologações anteriores distribuídas/Firestore foram preservadas
e não reexecutadas nem reclassificadas.

### Estado final

- Conferência read-only após cleanup das quatro execuções: zero documentos/filhos
  em rooms, users, catalogDatabases e activeMatches dos respectivos run-ids;
  quatro usuários ausentes; quatro chaves Redis exatas ausentes.
- Todas as sessões/socket clients/browser de fixture encerradas; credencial do
  auth vault apagada. Evidências locais mantidas, fora de versionamento.
- STAGING_ALLOW_WRITES=false; TRUST_PROXY=false local e nas réplicas.
- R1 `ece333de-6dcd-40cb-89c9-28bbbbd81041`: /ready 200, Firestore ready, Redis ready.
- R2 `49b70f1e-6d50-460a-9b50-363b10663fa1`: /ready 200, Firestore ready, Redis ready.
- Frontend HTTP 200; deployments/commit final acima inalterados.
- Evidências: publication-final-residuals.json, publication-installed-runtime.json,
  publication-deployments-final.json e recibos próprios em .tmp/security-staging.

Pendências: investigar o timeout de leitura antes de completar smoke de elenco,
modal/responsive/logout; TEST_REDIS_URL skip; proxy/XFF/XFP parcial; abortUpgrade
headers continua PARCIALMENTE VALIDADO — risco residual de hardening; integrações
Storage/Cloudinary/Gemini, falhas controladas/IAM ainda pendentes conforme matriz
histórica; backup/restore/RPO/RTO não homologados neste bloco.

## Diagnóstico restrito da leitura de elenco — 2026-10-04

Código/runtime/infraestrutura inalterados. Base permanece
9b58e7eb15d02848bd84331380ed2a49a9feda44; deployments backend
b884a483-fd82-4ab3-a561-083e2366a09d e frontend
ff145dd1-a263-4a20-8a9f-a52fecf69c4e. Sem commit/push/deploy.

### Fluxo e limites confirmados

App.tsx:117 -> usePlayerCatalog -> apiRequest ->
GET /api/teams/:clubId/players?roomCode=... -> security headers/request logging,
CORS/coordination/rate-limit -> createExpressAuthMiddleware -> createTeamsRouter.
Handler: catalogForRequest (requireMembership + catalogForOwner/ensureInitialized)
-> getClubRuntimeState (requireMembership novamente) -> requireMembership novamente,
pois runtime não contém marketState -> listRoomPlayers -> mergePlayerStates/moral
-> response.json -> normalizeResponse no browser.

requireMembership não é uma leitura leve: requireRoom/FirestoreRoomPersistence.get
reconstrói o save inteiro; hydrateCompetitionCatalog consulta catálogo e chama
mutate; migrações de carreira/emprego/lifecycle/leave/calendário/sistemas podem
chamar mutate novamente. mutate também reconstrói o save inteiro antes de decidir
se houve alteração. getPaths/requireMembershipPaths já existem para projeções.

Limites efetivos: apiRequest padrão 30000 ms; obtenção do token frontend 15000 ms;
Auth backend 10000 ms; dependency timeout 2500 ms; match persistence 15000 ms.
Os 15000 ms da ocorrência anterior de leitura HTTP eram AbortSignal.timeout do
harness, não o limite de apiRequest nem deadline de query de elenco. Match v1 não
participa deste endpoint: ele usa CatalogStore/FirestoreRoomPersistence Admin SDK.
HTTP_SLOW_MS=5000 somente registra lentidão. Nenhum limite foi alterado.

AbortController do frontend/harness cancela fetch/conexão HTTP. O handler não
propaga sinal para get()/runTransaction; close da response apenas encerra timer
de logging. Portanto não existe cancelamento desses RPCs ligado ao abort HTTP
nesse fluxo. Não houve abort nessa rodada pública; conclusão baseada no código,
não em uma campanha nova de falhas.

### Método, medições e limitações

Isolamento expirado foi revalidado pelo helper oficial, sem enfraquecer preflight.
Fixtures próprias pequenas: 2 clubes/32 jogadores do mesmo corpus representativo;
carreira criada pelos produtores reais (base gerada pelo jogo não foi removida).
Identidades distintas de staging. Writes autorizados pelo scoped preflight apenas
no objeto de configuração deste processo; .env.staging permaneceu false.

Local: mesmo router/RoomStore com MemoryRoomPersistence e catálogo fixture.
Staging instrumentado: subprocesso SSH específico, módulos reais publicados,
mesma identidade runtime/Firestore real, servidor HTTP loopback descartável.
Wrappers apenas no harness e APIs públicas. Nenhuma instrumentação foi injetada
nas duas aplicações em execução. Queries individuais sanitizadas nas evidências.
Requisição pública real: agent-browser + observer de fetch; correlação com logs
Railway por atributo requestId. Nenhum header de autenticação/body foi coletado.

| Execução | Backend/handler | Firestore | Browser | Resultado |
|---|---|---|---|---|
| Local, memória | total 82,795 ms | 0 queries | não aplicável | HTTP 200, 18 jogadores após evolução/base reais |
| SSH real 1, R1 | total 26569,761 ms; handler 26219,813 ms; auth 329,982 ms | 461 leituras instrumentadas + 22 envelopes de transação; 452 docs lidos | não aplicável | HTTP 409; código não capturado nesta primeira versão do diagnóstico |
| Público real, R1 | 4001 ms nos logs | sem telemetria por query no processo publicado | TTFB 4452,3 ms; HTTP 409; sem abort | timeout original NÃO REPRODUZIDO |
| SSH real 2, R2, sem browser concorrente | total 26479,757 ms; handler 26188,828 ms; auth 266,759 ms | mesmos 461 reads + 22 tx/452 docs; ocupação agregada Firestore 20703,599 ms | não aplicável | HTTP 409, SAVE_MAINTENANCE_BUSY |

Três leituras remotas no total; sem load test/retry. Primeira execução iniciou
subprocesso antes do resume do browser: concorrência é confundidor explicitamente
preservado. Segunda execução não abriu browser nem iniciou outra leitura concorrente.
GC automático da implementação permanece parte real do fluxo observado.

TTFB do browser foi medido até headers. Transferência/parse completo do body não
foi instrumentado separadamente; não confundir esse tempo com total completo.
Auth/query/handler detalhados pertencem ao subprocesso, não aos logs públicos.
Os envelopes runTransaction não são contados como RPCs adicionais aos seus gets;
telemetria inclui GC/background originado pelo fluxo. Uma leitura background
estava pendente no momento da resposta 409. Subprocessos SSH terminaram exit 1,
sem signal reportado, stderr não publicado; não apresentar harness como verde.

Público: requestId e14a8ac4-149e-4d7b-acc1-1f4dd8ff2dab,
instanceId ece333de-6dcd-40cb-89c9-28bbbbd81041;
http.request_start 03:05:55.926Z, http.request_end 03:05:59.927Z, HTTP 409/4001 ms.
Browser: 03:05:55.113Z -> headers 03:05:59.566Z. Relógios distintos; diferença
de duração (~451 ms), não timestamps absolutos, usada para comparação.

### Onde o custo foi observado

Na segunda execução, requireMembership inicial: 22361,573 ms. get completo:
4268,641 ms; duas mutações: 7104,184 ms e 10372,191 ms. getClubRuntimeState:
3456,600 ms, incluindo outro get completo 2493,310 ms. CPU do processo: 1515,285 ms;
serialização de resposta de erro: 1,416 ms. Transformação do elenco não foi
alcançada. Nenhuma query brasfootPlayers nem lookup por jogador/contrato ocorreu
nas execuções reais interrompidas antes dessa etapa.

| Caminho lógico | Operação observada | Quantidade/docs | Organização/custo observado |
|---|---|---|---|
| rooms/<fixture> | get da raiz | 12/12 | múltiplas leituras sequenciais entre fases; 257,798–1321,620 ms por chamada |
| rooms/<fixture>/career/<section> | get de manifesto/seção | 395/394 concluídos | lotes até 20 em paralelo; lotes sequenciais/reconstruções repetidas; 178,054–1227,877 ms |
| rooms/<fixture>/catalog/<section> | get de manifesto/seção | 10/10 | mesmo mecanismo; 176,383–522,633 ms |
| catalogDatabases/<fixture-user> | transaction.get metadata | 3/3 | inicialização repetida; 175,976–184,829 ms |
| catálogo brasfootLeagues | query.get | 2/2 | paralelo com clubes/tournaments, repetido na hidratação |
| catálogo brasfootClubs | query.get | 2/4 | paralelo com ligas; 199,166–210,489 ms |
| catálogo tournaments | where active == true / query.get | 2/0 | paralelo; 192,464–195,545 ms |
| rooms/<fixture>/maintenance | gets/transactions de writer/GC | demais operações | manutenção automática; inclui uma leitura ainda pendente |

Fan-out por seções do save e releituras/mutações redundantes comprovados; não
N+1 por jogador nesse cenário. loadV2Room lê cada manifesto individualmente,
em grupos de 20. Duas reconstruções somente em persistence.get produziram 202
leituras, além das feitas por mutate e GC. Não somar durações paralelas como
tempo de parede. O JSON local contém cada operação/start/end/duração/docs.

SAVE_MAINTENANCE_BUSY é emitido pelo guard de manutenção de RoomPersistence.
create/commits agendam GC após 1000 ms; GC adquire saveMaintenanceLease, enquanto
hydrateCompetitionCatalog/migrações tentam mutate. Essa interação foi observada
sem browser concorrente; não remover guard/lease para obter sucesso.

Classificação: A/F comprovados para custo observado (backend + amplificação de
I/O/releituras); Firestore participa como latência acumulada, sem prova de outage
ou query única anormal; CPU/serialização não são custo dominante; rede/proxy não
explica os 26 s do loopback; B não comprovado nessa rodada. Timeout original de
15 s: NÃO REPRODUZIDO exatamente — preservado no histórico, não corrigido.

### Proposta, sem implementação

Causa do custo: leitura de elenco passa por hidratação/migração global e releituras
do save, podendo disputar manutenção/GC antes de consultar os jogadores.
Impacto: resposta lenta e 409 mesmo em fixture de dois clubes; potencial para
exceder o orçamento do chamador. Nexo causal exato com ocorrência histórica de
abort 15 s não foi estabelecido nesta campanha.

Correção mínima proposta para revisão: leitura autorizada/projetada do estado
necessário ao elenco, reutilizando getPaths/requireMembershipPaths; reutilizar
esse snapshot para escopo do catálogo, estado/moral e merge de carreira/mercado,
sem invocar hidratação/migrações globais repetidas no GET. Arquivos candidatos:
server/routes/teams.mjs, server/store/catalogScope.mjs, server/store/roomStore.mjs
e regressões. Não alterar timeouts, Tailwind, match v1 ou guards de manutenção.
Risco: autorização, saves legados/migração, contratos/transferências/empréstimos,
base/treino e moral devem preservar paridade. Não cachear entre usuários/saves
nem omitir campos por conveniência. Parar para aprovação antes de codificar.

Git history: nenhuma alteração do fluxo acima entre 1031f21 e HEAD. Match v1
44125f2 afeta persistência de sessão de partida separada; grpc 1.14.5 já existia
em 1031f21; scoped preflight não entra no runtime; Tailwind/Vite/Busboy não
modificaram handler/store/hook. Não atribuir causa a essas migrações por data.

### Cleanup/estado final

Duas fixtures diagnósticas e seus usuários/prefs/catálogos/saves removidos com
ownership comprovada, documentos/filhos ausentes e usuários auth/user-not-found.
Somente chave Redis exata do socket do UID próprio verificada/removida; sem
SCAN/KEYS/FLUSH. Vault/sessão browser encerrados; subprocessos SSH encerrados.
Nenhuma alteração IAM, produção, Redis/infra ou quantidade de réplicas.
STAGING_ALLOW_WRITES=false no arquivo local; TRUST_PROXY efetivo false.
R1 e R2: /ready 200, Firestore ready, Redis ready. Frontend 200.
Deployments/commit acima inalterados. Tracked working tree sem alterações.

Evidências ignoradas: roster-diagnosis.json, roster-diagnosis-sequential.json,
roster-browser-observation.json, roster-public-logs.json e receipts em .tmp.
Somente este relatório operacional local não rastreado foi atualizado.

## Correção local autorizada — amplificação de I/O do elenco

Estado: VALIDADO localmente e em harness isolado com Firestore real de staging.
Não publicado. Branch codex/ci-e2e; HEAD permanece
9b58e7eb15d02848bd84331380ed2a49a9feda44. Nenhum stage, commit, push ou deploy.
Backend b884a483-fd82-4ab3-a561-083e2366a09d e frontend
ff145dd1-a263-4a20-8a9f-a52fecf69c4e continuam no código publicado anterior.

### Resoluções anteriores e causa

| Membership check | Arquivo | Necessidade real | Save completo necessário? | Repetida/reutilizável? |
|---|---|---|---|---|
| catalogForRequest → requireMembership | server/store/catalogScope.mjs | Membership persistida + proprietário do catálogo | Não | Primeira; escopo reutilizável |
| getClubRuntimeState → requireMembership | server/store/roomStore.mjs | Temporada, playerStates, moral | Não | Segunda; mesma room/uid |
| fallback da rota → requireMembership | server/routes/teams.mjs | Inscrições, carreira, contratos, empréstimos/base | Não | Terceira possível; runtime antigo não contém marketState |

As três chamadas antigas podiam entrar em requireRoom/get completo, hidratação
do catálogo, migrações e mutate. Mutate também reconstruía o save e podia
disputar lease de manutenção/GC. Nenhuma dessas escritas era necessária para
o DTO de elenco já persistido. O erro SAVE_MAINTENANCE_BUSY não foi mascarado:
o GET deixou de tentar manutenção; o guard de escrita permanece operacional.

Antes: auth → até três requireMembership/get/hydration/mutate → listRoomPlayers.
Depois: auth → rosterScopeForRequest → uma requireMembershipPaths/getPaths
read-only → catálogo do owner/geração persistidos + clube validado → reutilização
da mesma projeção para listRoomPlayers/mergePlayerStates/moral → resposta.

Projeção: metadados/membership e os agregados competitionCatalog,
tournamentCatalog, playerStates, clubMoraleStates, marketState.registrations,
careerState.players/roster/trainingPlans/currentSeason. Não lê histórico,
partidas, eventos, negociações ou outros domínios sem necessidade do DTO.
UID, save, room e clube ficam vinculados ao escopo imutável por request.
Não existe cache global entre usuários/saves. Adversários do catálogo autorizado
continuam acessíveis; clube de outro catálogo/save é rejeitado.

### Compatibilidade e ausência de escrita no GET

Decoders e validações existentes de saves raw, gzip e gzip-chunks reutilizados.
A interpretação/projeção do legado ocorre em memória, sem migração persistente,
writer lease, recovery com escrita ou GC. Containers vazios são preservados:
careerState={} não é tratado como carreira ausente.

Se uma carreira antiga ativa ainda não existe e não há jogos concluídos,
reutiliza-se o bootstrap real de carreira/base apenas em memória. Nesse caso,
facilities/staff/data necessários à qualidade dos jovens são projetados;
contratos e base são comparados ao DTO produzido pelo fluxo anterior. Esse
bootstrap excepcional ainda pode consultar os elencos necessários do catálogo;
os 12 reads medidos abaixo são do fluxo normal com carreira existente, não uma
promessa de custo constante para qualquer save legado.

Catálogo não inicializado: erro explícito CATALOG_DATABASE_NOT_INITIALIZED/503,
sem cópia implícita no GET. Inicialização deve ocorrer no fluxo de inicialização
existente. Catálogo em importação mantém o bloqueio; geração ativa é respeitada.
Save corrompido falha fechado, sem iniciar recovery mutante nesse GET.
O fluxo sem roomCode e outros caminhos de escrita/migração não foram alterados.

17 regressões: membro válido, não membro, room inexistente, clubId de outro
catálogo/save, adversário permitido, escopo imutável, concorrência, maintenance
lease ativo (GET 200/zero writes; mutate ainda SAVE_MAINTENANCE_BUSY), contratos,
empréstimos recebidos/cedidos, jogador livre, base/treino, formatos legados,
bootstrap legado/v2, carreira vazia, facilities/staff existentes, geração ativa,
catálogo não inicializado/importando e corrupção. Instrumentação conta leituras
e compara com o custo das resoluções completas anteriores. Zero transações e
zero tentativas de escrita na rota normal; paridade do DTO verificada.

### Três leituras controladas com Firestore real

R1/R2 executaram exatamente os módulos locais modificados em subprocessos SSH
isolados, usando a identidade runtime existente e Firestore real. Módulos
carregados em memória; arquivos/processos publicados das réplicas intocados.
Terceira leitura: Chrome real → HTTP loopback do mesmo handler corrigido →
Firestore real de staging. Não equivale a validar o endpoint público corrigido
após deploy; este não foi autorizado. Fixtures pequenas: 2 clubes/32 jogadores
de catálogo, carreira/base gerada pelos produtores reais, 18 jogadores no DTO.

| Leitura | Auth ms | Membership ms | Firestore wall ms | Handler ms | Backend ms | Transformação final ms | Browser TTFB/total ms | Resultado |
|---|---:|---:|---:|---:|---:|---:|---|---|
| SSH R1 | 267,782 | 2364,347 | 3000,525 | 3017,347 | 3288,142 | 8,582 | Não aplicável | HTTP 200 |
| SSH R2 | 258,909 | 2411,328 | 3052,434 | 3068,295 | 3329,314 | 7,223 | Não aplicável | HTTP 200 |
| Chrome + handler local/Firestore staging | 1228,522 | 130,122 | 290,106 | 297,930 | 1527,491 | 2,184 | 1532,100 / 1532,500 | HTTP 200, body completo, sem abort |

Backend medido entre request_start e finish; handler após auth até response.json.
Transformação final é o intervalo após a última query até response.json, não uma
medida de toda a CPU. Firestore wall usa união de intervalos, sem somar RPCs
paralelos. No harness Chrome o tempo externo de controle manual/espera do
observador não foi incluído na duração HTTP acima.

R1 requestId roster-profile-97ea3586-f684-4353-a3ad-0ac61ab4e55b,
04:31:27.921Z → 04:31:31.209Z.
R2 requestId roster-profile-20ef5144-7f45-4d52-8c5a-e51a24444a5a,
04:31:35.243Z → 04:31:38.572Z.
Chrome requestId roster-profile-ba1273ff-1eb1-4d68-889a-f39ec873c9e4,
04:56:34.446Z → 04:56:35.974Z. Datas: 2026-10-04 UTC.
instanceIds R1/R2: ece333de-6dcd-40cb-89c9-28bbbbd81041 /
49b70f1e-6d50-460a-9b50-363b10663fa1.

| Métrica | Antes comprovado | Depois, cada leitura |
|---|---:|---:|
| Operações Firestore de leitura instrumentadas | 461 | 12 |
| Documentos lidos | 452 | 27 |
| Resoluções membership | Até 3 | 1 |
| Reconstruções completas via persistence.get | 2 nas execuções interrompidas | 0 |
| Hidratações globais/mutações/manutenção disparadas pelo GET | Presentes; duas mutações na primeira membership | 0 |
| Tempo observado no harness R1/R2 | 26569,761 / 26479,757 ms | 3315,839 / 3346,393 ms |
| HTTP | 409 | 200 |

12 operações = raiz do save + oito seções projetadas em paralelo + metadata do
catálogo + documento do clube + uma query de jogadores. 27 documentos = onze
documentos de estado/escopo + dezesseis jogadores. Não há lookup por jogador
no corpus normal usado aqui. Os merges de empréstimo/base não foram recriados.
Redução de operações: 97,40%; documentos: 94,03%. Latência regional/cold-start
continua existindo, porém a amplificação estrutural comprovada foi removida.

Tentativas anteriores de iniciar o observador Chrome falharam no harness antes
da leitura do elenco (configuração/espera do observador), não na aplicação.
Não contadas como leituras do endpoint. Receipts/fixtures correspondentes foram
limpos com ownership comprovada; uma janela expirada exigiu revalidação oficial
do scope antes do cleanup, sem bypass. Evidência de falhas preservada localmente.

### Validação final e escopo

| Validação | Resultado |
|---|---|
| Regressões novas de elenco | 17/17 |
| Rota/auth/room/persistência/legado relacionados | 157/157, zero fail/cancel/skip |
| npm run test:server | 1486 pass, 0 fail, 0 cancel, 1 skip; 1487 testes, 238978,610 ms |
| npm run test:frontend | 200/200, 0 fail/cancel/skip |
| E2E Chrome | 4/4 |
| npm audit | 0 vulnerabilidades |
| Typecheck | PASS |
| Build | PASS; warning de bundle grande preexistente |
| git diff --check | PASS; avisos LF/CRLF não são erro de whitespace |

Skip único continua dependendo de TEST_REDIS_URL. Nenhum teste foi enfraquecido.
Código: cinco arquivos modificados e um teste novo; +459/-46 linhas (+165/-46
nos cinco arquivos rastreados; teste novo com 294 linhas). Arquivos:
server/routes/teams.mjs, server/store/catalogScope.mjs,
server/store/catalogStore.mjs, server/store/roomPersistence.mjs,
server/store/roomStore.mjs e server/tests/teamsRosterRead.test.mjs.
Este relatório permanece operacional/local, deliberadamente não rastreado.

Timeout histórico exato de 15 s: NÃO REPRODUZIDO; não declarado corrigido.
Frontend abort ≠ cancelamento dos RPCs desse handler. Propagação de AbortSignal
continua melhoria separada, não implementada. Nenhum timeout, Tailwind, match
persistence v1, IAM, Redis, infraestrutura ou quantidade de réplicas alterado.

Cleanup final: documentos do run-id e subcoleções ausentes; usuário temporário
auth/user-not-found; chave Redis exata ausente; browser próprio fechado;
subprocessos/clientes encerrados. Firestore/Redis/usuário/processo/socket
residual: não. .env.staging permaneceu STAGING_ALLOW_WRITES=false;
TRUST_PROXY=false. R1/R2 /ready 200, Firestore ready, Redis ready; frontend 200.
Credenciais, .env.local, .tmp, logs e arquivo externo preexistente não entram
em alterações versionáveis; .env.local não foi lido. Evidências detalhadas:
.tmp/security-staging/roster-fix-diagnosis.json,
.tmp/security-staging/roster-fix-browser-diagnosis.json e receipts exatos.
Pausa para revisão; nenhuma publicação executada.

## Publicação do fix de elenco — 2026-10-04/05

Commit publicado em origin/codex/ci-e2e:
`10481a8a123001d87035cc6e50fcf93c1aa05105`
(`perf: avoid repeated save hydration in player catalog`).
Seis arquivos; 459 inserções / 46 remoções. Push confirmado pelo hash remoto.
Revisão limitada à rota de jogadores, projeção/resolução de membership,
helpers de store e regressões. Nenhum cache global ou compartilhamento de
projeção entre requests. UID autenticado continua fonte de autorização;
roomCode/clubId não são confiáveis; os testes preservam rejeições de outsider,
room inexistente e clube externo ao catálogo autorizado, além de contratos,
empréstimos, base e interpretação legada em memória. Acesso já permitido a
adversários do catálogo da room não foi removido.

GET de jogadores com roomCode usa somente leituras/projeções: sem manutenção,
GC, migração com escrita ou inicialização/cópia implícita do catálogo.
Catálogo não inicializado continua 503 e SAVE_MAINTENANCE_BUSY continua nos
fluxos de escrita. Isso não amplia o fix para rotas gerais de catálogo sem room.
Revalidação específica antes do commit: 34/34 testes relacionados aprovados;
diff-check aprovado; varredura dos seis arquivos sem credenciais candidatas.
Validação completa local aprovada anteriormente: servidor 1486 pass, 0 fail,
0 cancel, 1 skip; frontend 200/200; E2E Chrome 4/4; novas regressões 17/17;
relacionados 157/157; typecheck/build aprovados. Audit reexecutado após deploy:
0 vulnerabilidades.

Deployments automáticos GitHub, sem redeploy manual:

- Backend: f8e7dae1-ca7d-4257-9b8c-d562e25245e6, SUCCESS, commit acima, 2 réplicas.
- Frontend: ff37d31a-ba67-4427-ad95-db121d10d359, SUCCESS, mesmo commit.
- R1: 895bab33-fc49-4ff4-847f-8e356cf2b6b0.
- R2: 00afeb28-2e1f-4453-b351-ac7299990f23.

### Três leituras públicas controladas

Usuário/save/catálogo próprios descartáveis; nenhum save existente utilizado.
As três requests autenticadas foram correlacionadas com logs HTTP sanitizados.
TTFB abaixo é o tempo observado no Chrome até o fetch disponibilizar headers,
incluindo eventual preflight/rede; não é duração Firestore isolada.

| Execução | HTTP backend | HTTP entregue ao fetch | Backend | TTFB Chrome | Total Chrome |
|---|---:|---:|---:|---:|---:|
| UI | 200 | 200 | 2237 ms | 2743,4 ms | 2745,2 ms |
| Concorrente A | 304 | 200 | 1404 ms | 3522,8 ms | 3523,5 ms |
| Concorrente B | 304 | 200 | 1425 ms | 1887,5 ms | 1887,9 ms |

Todas entregaram 18 jogadores, corpo completo, sem abort, timeout ou
SAVE_MAINTENANCE_BUSY. Nas concorrentes, o navegador revalidou cache HTTP;
o backend executou o handler e respondeu 304, e o fetch entregou o corpo
reconstituído com status 200. Não registrar essas respostas como HTTP 200 wire.
As duas chamadas foram iniciadas juntas no browser; os intervalos dos handlers
nos logs não se sobrepuseram. Portanto, concorrência de chamadas no cliente
foi observada, mas concorrência efetiva dos handlers não foi comprovada.
Nenhuma quarta leitura foi feita, respeitando o limite de três.

### Limitações da verificação pública

A revisão agregada da room mudou de 4 para 6 na janela de observação, enquanto
outras chamadas da tela estavam em curso. O catálogo manteve revision/updateTime
e não havia maintenance lease nas duas amostras. A origem concreta das alterações
da room não foi atribuída a uma request; elas não provam escrita pelo GET de
jogadores, mas tornam inconclusiva a prova agregada de zero escritas remotas.
O assert de invariância do harness local falhou (ERR_ASSERTION); não foi removido,
relaxado nem declarado verde. Cleanup foi executado e passou mesmo após a falha.
Os 17 testes específicos e a revisão do caminho continuam demonstrando zero
escritas no GET isolado, mas não substituem esta ressalva operacional.

Durante o smoke também ocorreram aborts em chamadas separadas de listas gerais:
/api/leagues, /api/teams sem players e /api/tournaments. Console registrou quatro
warnings de rede/timeout. Nenhuma das três leituras de jogadores foi abortada.
Não atribuir esses aborts ao fix sem investigação; não corrigidos nesta entrega.
Não houve telemetria Firestore por operação no endpoint público: os números
12 operações / 27 documentos pertencem ao harness isolado anterior, não foram
remedidos nem presumidos a partir dos logs HTTP do deployment.

Homologação pública completa deste bloco: PARCIALMENTE VALIDADA.
Ganho observado na leitura publicada: validado pela request UI HTTP 200 e timings.
Amplificação I/O do catálogo: correção publicada; não declarar toda a campanha
operacional VALIDADA enquanto permanecerem as ressalvas acima.

### Smoke visual e estado final

Login, abrir elenco, onze inicial/escalação, táticas, modal de jogador e logout
executados no frontend real. Layout inspecionado em 1366x768 e 390x844, sem
redesenho ou alteração CSS. Screenshots/telemetria permanecem somente locais.
Consoles/Network têm as ressalvas das listas gerais descritas acima, não um
resultado global sem erros.

Cleanup comprovado do run exclusivo: documentos e subcoleções Firestore ausentes,
usuário temporário removido, chave Redis exata ausente, perfil do vault removido,
browser próprio e clientes/subprocesso encerrados. Nenhum recurso residual.
STAGING_ALLOW_WRITES local permaneceu false; autorização de fixture existiu
somente no ambiente em memória do harness. TRUST_PROXY permanece false.
R1/R2 /ready HTTP 200, Firestore ready, Redis ready; frontend HTTP 200.
Nenhuma alteração IAM/Redis/Firebase/infraestrutura/réplicas feita.

Timeout histórico de 15 s: NÃO REPRODUZIDO, não declarado corrigido.
Propagação abort HTTP → RPC: PENDENTE SEPARADO.
.env*, .tmp, logs, evidências, credenciais e arquivo externo preexistente não
entraram no commit. Este relatório operacional continua não rastreado/local.
Evidências sanitizadas: .tmp/security-staging/roster-public-smoke.json,
roster-public-complete.json, roster-public-backend-timing.json e receipt da execução.
Pausa para revisão; nenhuma investigação/correção fora do escopo iniciada.
