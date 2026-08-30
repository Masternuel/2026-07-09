# Operação multi-réplica

## Arquitetura

- Firestore permanece fonte durável de salas, carreira, catálogo, notícias e partidas ativas.
- Redis/Valkey compartilhado coordena adapter Socket.IO, rate-limit e ownership do playback.
- O lock `match:<ROOM>` usa `SET NX PX`, token exclusivo, renovação periódica, liberação por Lua e fencing crescente. Escritas em `activeMatches` rejeitam owners antigos.
- Socket.IO usa Redis adapter. Cliente e servidor usam somente WebSocket; Railway não precisa de sticky sessions.
- Sessões Brasfoot usam Firestore para metadados/locks e Firebase Storage para arquivos temporários. Disco local só é fallback em desenvolvimento/teste.
- Leases Firestore existentes continuam protegendo saves, GC e commit do catálogo; não recebem lock Redis duplicado.

## Railway

1. Adicione serviço Redis/Valkey na mesma região do backend.
2. No backend, referencie `REDIS_URL` do serviço Redis e configure Firebase Admin/Storage.
3. Mantenha `/ready` como health check. `railway.json` inicia duas réplicas.
4. Use bucket com lifecycle removendo `brasfoot-import-sessions/` após `IMPORT_OBJECT_TTL_DAYS` dias.

Sem Redis, produção permanece viva em `/health`, mas `/ready` e APIs retornam indisponibilidade. Isso impede tráfego sem coordenação distribuída.

## Variáveis

| Variável | Uso |
| --- | --- |
| `REDIS_URL` | Redis/Valkey compartilhado; obrigatório em produção |
| `INSTANCE_ID` | Identificador de log; fallback Railway/hostname |
| `LOCK_TTL_MS` | TTL do ownership |
| `LOCK_WAIT_MS` | espera máxima para adquirir lock |
| `LOCK_RETRY_MS` | base do backoff |
| `RATE_LIMIT_WINDOW_MS` | janela HTTP/Socket |
| `RATE_LIMIT_HTTP_MAX` | requisições por IP/janela |
| `RATE_LIMIT_SOCKET_MAX` | conexões/eventos por identidade/janela |
| `DEPENDENCY_TIMEOUT_MS` | timeout Redis/Firestore no readiness |
| `SHUTDOWN_TIMEOUT_MS` | limite do graceful shutdown |
| `IMPORT_OBJECT_TTL_DAYS` | retenção externa dos uploads temporários |

## Operação e monitoramento

- `/health`: liveness, sem dependências externas.
- `/ready`: Redis e Firestore com timeout; `503` durante falha ou drain.
- `/metrics`: contadores/gauges/sumários de HTTP, erros, sockets, locks, rate-limit e dependências.
- Logs JSON incluem `instanceId`, evento, duração e request ID; tokens e segredos são removidos.
- `SIGTERM` marca not-ready, cancela playback, persiste estado, libera locks e fecha Socket.IO, importador e Redis.

Alertas mínimos: readiness `503`, lock perdido/timeout, erros `5xx`, latência elevada, rate-limit hits, Redis desconectado e crescimento de arquivos temporários.

## Riscos residuais

- Redis é dependência operacional crítica; use persistência/alta disponibilidade oferecida pelo Railway.
- Teste de adapter entre processos requer Redis real (`TEST_REDIS_URL`) no pipeline de integração.
- Lifecycle do bucket e agendamento de backup são configurações externas e devem ser auditados após deploy.
