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

Sem Redis, produção permanece viva em `/health`, mas `/ready` e APIs retornam indisponibilidade. Handshakes Socket.IO são rejeitados com `REDIS_REQUIRED`; conexões existentes também rejeitam comandos de negócio enquanto command/publisher/subscriber não estiverem prontos. Comandos encaminhados entre réplicas são revalidados no destino. Falhas de rate-limit e comandos de lock retornam erro genérico, sem detalhes da conexão. Não existe fallback local quando Redis é obrigatório; desenvolvimento/testes locais sem `REDIS_URL` continuam permitidos.

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
| `METRICS_TOKEN` | segredo exclusivo do coletor; vazio desativa `/metrics` |
| `DEPENDENCY_TIMEOUT_MS` | timeout Redis/Firestore no readiness |
| `SHUTDOWN_TIMEOUT_MS` | limite do graceful shutdown |
| `IMPORT_OBJECT_TTL_DAYS` | retenção externa dos uploads temporários |

## Operação e monitoramento

- `/health`: liveness, sem dependências externas.
- `/ready`: Redis e Firestore com timeout; `503` durante falha ou drain.
- `/metrics`: JSON de contadores/gauges/sumários; desativado (`404`) sem `METRICS_TOKEN`. Quando configurado, exige `Authorization: Bearer <segredo>`; tokens Firebase, cookies, query string e IP local não concedem acesso. Não é formato Prometheus/OpenMetrics.
- Logs JSON incluem `instanceId`, evento, duração e request ID; tokens e segredos são removidos.
- `SIGTERM` marca not-ready, cancela playback, persiste estado, libera locks e fecha Socket.IO, importador e Redis.

Alertas mínimos: readiness `503`, lock perdido/timeout, erros `5xx`, latência elevada, rate-limit hits, Redis desconectado e crescimento de arquivos temporários.

### Coleta privada de métricas

Configure um segredo aleatório exclusivo (32–256 caracteres ASCII seguros) no backend e no coletor, nunca no frontend, repositório ou URL. Use HTTPS ou rede privada protegida. Para rotacionar, substitua o segredo no backend/coletor e reinicie as réplicas; não há tolerância simultânea ao token anterior. O controle de acesso não substitui isolamento de rede, conforme o [modelo de segurança do Prometheus](https://prometheus.io/docs/operating/security/).

O endpoint permite GET/HEAD autenticados, com `Cache-Control: no-store, private`, sem acesso às APIs de jogo. Limite: 60 coletas/minuto por instância, compartilhado pelos coletores; excesso retorna `429` e `Retry-After`. O limite é local e independente do Redis, para preservar diagnóstico durante indisponibilidade. Tentativas não autorizadas não consomem a cota dos coletores; proteção volumétrica deve existir no proxy/rede.

O registro preserva o formato de contadores, gauges e sumários, mas passa a aceitar somente métricas e labels declarados em `server/infrastructure/metricPolicy.mjs`. Rotas HTTP agregam por família (`/api/rooms`, `/api/editor`, etc.); rotas não atendidas usam `unmatched`. Locks usam `resource=match` ou `other`, sem códigos de sala. Eventos conhecidos são preservados; valores desconhecidos viram `other`; labels extras são removidos. Isso segue a orientação de [evitar dimensões de alta cardinalidade](https://prometheus.io/docs/practices/instrumentation/). Ajuste dashboards que filtravam rotas completas ou recursos individuais.

Limites por instância: 2048 séries no total e 256 por métrica. Nomes/tipos desconhecidos, amostras inválidas e novas séries acima do teto são descartados; séries existentes continuam atualizando. `registry.series`, `maxSeries`, `maxSeriesPerMetric` e `droppedSamples` aparecem no JSON; alerte sobre crescimento de `droppedSamples`. Não existe fila de amostras descartadas. Novas instrumentações precisam ser declaradas na política; opções internas do registro têm tetos absolutos de 4096/512. Reinício ou `reset()` zera métricas; não são dados persistidos da carreira.

Resultados desta correção: [etapa `/metrics`](./ETAPA_METRICS.md).

## Riscos residuais

- Redis é dependência operacional crítica; use persistência/alta disponibilidade oferecida pelo Railway.
- Teste de adapter entre processos requer Redis real (`TEST_REDIS_URL`) no pipeline de integração.
- Lifecycle do bucket e agendamento de backup são configurações externas e devem ser auditados após deploy.
