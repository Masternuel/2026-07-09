# Fase 5 — Observabilidade e erros do mercado autônomo

Status: COMPLETO para esta etapa. Sem commit ou deploy. Armazenamento paginado do histórico de partidas é a próxima etapa, ainda não iniciada.

## Problema original / causa raiz

`completeMatch` capturava e descartava qualquer exceção do mercado. Além disso, o motor tratava todo `MarketError`, inclusive falhas de integridade HTTP 500, como recusa comercial e podia terminar com `no-deal`. Não havia registro persistente das execuções que falhavam, nem logs/métricas correspondentes.

## Solução implementada

- Orquestrador síncrono separado do motor: `runRecordedAiMarketTick`. Mantidos estratégia, modalidades, termos e cadência global por temporada/rodada existentes.
- Identificação determinística por sala + temporada + rodada. O ID vai para logs/recibos, nunca para labels de métricas.
- Registro de estado (`succeeded`, `skipped`, `failed`), motivo, início/fim, duração, tentativas, erro classificado e esgotamento. `lastAiTransferTick` mantém o resultado compatível e acrescenta `runId`/`executionAttempts`; `lastCompletedMatch.aiMarketTick` identifica a execução associada.
- Falhas de integridade/inesperadas não viram `no-deal`. Somente recusas comerciais `MarketError` 4xx continuam a seleção de candidatos. Tentativas comerciais recusadas também são preservadas quando outro negócio do tick é concluído.
- Até 3 tentativas, apenas para códigos transitórios explícitos: `ETIMEDOUT`, `ECONNRESET`, `EAI_AGAIN`, `UNAVAILABLE`, `DEADLINE_EXCEEDED`, `RESOURCE_EXHAUSTED`. O limite do orquestrador pode ser reduzido via `maxAttempts`; nunca excede 3. Sem retry de erros genéricos/validação/integridade e sem fila ou loop entre rodadas.
- Antes de repetir, rollback da sala inteira, inclusive transferências anteriores do mesmo tick, contratos, orçamento e inscrições. A engine permanece síncrona/local, sem chamadas externas; os retries limitados não introduzem espera ou tarefas em background dentro da gravação.
- Uma falha terminal do mercado não impede salvar uma partida válida: persiste recibo de falha, sem negócio parcial. Erros da própria gravação continuam sendo propagados ao fluxo existente, não são convertidos em sucesso.
- Recibo e efeitos são gravados na mesma operação da sala. Ledger legado continua válido; ticks terminais, inclusive falhos, não são reiniciados por reload ou chamada repetida. Uma nova temporada recebe outro ID.
- Logs e métricas são emitidos somente após confirmação da gravação. Callback repetido por conflito CAS não duplica emissão. Falha/ACK perdido registra `ai_market.commit_failed`, com `commitStatus: unconfirmed` e `committed: null`, sem afirmar que o negócio foi confirmado nem que foi desfeito no banco.
- Mensagens e stacks de exceções não são persistidas nos recibos/logs desta camada. Códigos são limitados e sanitizados; categorias métricas têm allowlist. Falha da telemetria produz aviso JSON de contingência sem transformar uma operação já confirmada em erro para o jogador.

## Arquivos desta etapa

- Novo `server/game/aiMarketTick.mjs`: orquestração, classificação, recibos e publicação de telemetria.
- `server/game/market.mjs`: normalização dos recibos e distinção entre recusa comercial/falha interna.
- `server/store/roomStore.mjs`: integração na conclusão da partida e emissão pós-commit.
- `server/index.mjs`: logger/registry existentes injetados no RoomStore.
- `server/infrastructure/metricPolicy.mjs`: nomes e categorias fixas do mercado.
- Novo `server/tests/aiMarketTick.test.mjs`; testes adicionais em `aiMarketEngine.test.mjs` e `aiMarketRoomStore.test.mjs`.
- `README.md` e este relatório.

Demais alterações preexistentes foram preservadas. O diff acumulado do RoomStore/servidor não pertence integralmente a esta etapa.

## Testes criados e executados

17 testes novos: recibos/estados; ledger legado; identidade por temporada; retry/rollback; integridade e exceção inesperada; esgotamento e reload; retorno inválido; retenção/cardinalidade; commit incerto; falha da telemetria; erro real da engine antes mascarado; negócio revertido sem perder partida; retry após negócio real; repetição do callback CAS; falha antes do commit; perda de ACK após commit; duas instâncias concorrentes.

Baseline relacionado: 35/35 aprovados (`aiMarketEngine`, `aiMarketRoomStore`, `marketConsistency`, `marketTransport`).

Validação final:

- Backend: 160/160 aprovados em `aiMarketTick`, `aiMarketEngine`, `aiMarketRoomStore`, `market`, `marketConsistency`, `marketRoomStore`, `marketTransport`, `metricsSecurity`, `metricsCardinality`, `firestorePersistence`, `competitionRoomStore`, `multiReplicaServer`.
- Interface: 7/7 em `marketUi`, totalizando 167 testes. Primeira execução bloqueada pelo sandbox Windows durante o prebundle do esbuild; a repetição autorizada fora do sandbox passou. Nenhum teste foi desativado para contornar isso.
- Typecheck: `npm run typecheck` aprovado.
- Build: `npm run build` aprovado; aviso preexistente de chunks maiores que 500 kB permanece.
- Whitespace: `git diff --check` aprovado.

## Operação e riscos restantes

- Consultar `marketState.aiTickRuns` no save para auditoria; últimos 100 recibos detalhados. O ledger de deduplicação mantém o limite existente de 500 chaves. A API de conclusão também valida a fixture atual/concluída; não permite reenviar uma partida antiga para negociar novamente.
- Logs: `ai_market.tick_started`, `ai_market.attempt_failed`, `ai_market.tick_finished`, `ai_market.commit_failed`, `ai_market.telemetry_failed`. Eventos started/finished são retrospectivos, publicados após commit, não um indicador de job assíncrono em execução.
- Métricas: `ai_market_ticks_total`, `ai_market_attempts_total`, `ai_market_retries_total`, `ai_market_tick_duration_ms`, `ai_market_commit_failures_total`. Labels somente de estado/categoria. Monitorar falhas, retries esgotados e duração pelo coletor privado já existente; dashboard/alerta externo não foi configurado.
- A engine não possui I/O externo; tentativas são locais e síncronas. Não se deve colocar chamadas de rede dentro dela. Retries de persistência/conflitos continuam na camada existente; um ACK incerto não dispara nova transferência às cegas.
- CAS permite que duas réplicas calculem propostas em cópias concorrentes, mas somente a operação confirmada publica efeitos. Não foi acrescentado um segundo lock ou um scheduler paralelo.
- Não há outbox de entrega garantida da telemetria: morte do processo após commit e antes da emissão pode omitir logs/contadores. O recibo/resultado no save é a fonte de verdade para investigação. Contadores pertencem ao processo e reiniciam com ele.
- Testes de falhas/concorrência usam persistência em memória e doubles de Firestore/CAS. Não houve teste de carga, Redis/Firestore de produção ou deploy. A suíte inteira não foi reexecutada; a falha preexistente de simulação documentada na etapa Socket não foi reavaliada.
- Esta etapa não implementa histórico ilimitado/paginado de partidas, reprocessamento administrativo de ticks antigos ou mudanças na tomada de decisão comercial da IA.
