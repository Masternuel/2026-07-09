# Etapa 4 — Proteção de /metrics e cardinalidade

Status: COMPLETO no código e na validação local. Sem commit, push ou deploy. Próxima etapa: imagens externas; não iniciada.

## Problema original e causa raiz

`/metrics` retornava dados operacionais sem autenticação, antes do rate-limit das APIs. O registro mantinha mapas sem limite, aceitava nomes/labels arbitrários e usava recursos de lock como `match:<codigo-da-sala>`. Rotas montadas com parâmetros também podiam incluir identificadores em `baseUrl`.

## Solução implementada

- Endpoint desativado por padrão (`404`). `METRICS_TOKEN` válido ativa acesso por Bearer exclusivo, comparado por hashes de tamanho fixo com `timingSafeEqual`. Credenciais comuns do jogo, cookies, query string e IP local não liberam coleta.
- Segredo inválido falha na configuração sem imprimir seu valor. Segredo ausente não impede iniciar o jogo.
- Autorização precede parsing do corpo; GET/HEAD autenticados retornam JSON sem cache. Outros métodos retornam `405`; credencial inválida, `401`.
- Até 60 coletas/minuto por instância, com `429` e `Retry-After`. Controle local usa apenas contador e início da janela, sem mapas por IP/usuário nem dependência de Redis/Firebase.
- Política explícita de métricas, tipos, dimensões e valores permitidos. Labels desconhecidos são removidos; valores não reconhecidos viram categorias fixas. HTTP agrega por família da API; locks agregam por tipo de recurso. Chaves reais, ownership e fencing dos locks permanecem inalterados.
- Registro limitado a 2048 séries no total e 256 por métrica; opções internas nunca ultrapassam 4096/512. Novas séries excedentes são descartadas sem fila; séries existentes continuam atualizando. Contador `registry.droppedSamples` torna descarte observável.
- Valores inválidos, tipos incompatíveis e overflow não corrompem amostras. Snapshots copiam labels; alterações por consumidores não modificam o registro interno.
- `/health`, `/ready`, autenticação do jogo e dados dos saves permanecem independentes.

As escolhas seguem as recomendações oficiais de [segurança do endpoint](https://prometheus.io/docs/operating/security/) e [controle de cardinalidade](https://prometheus.io/docs/practices/instrumentation/). O endpoint continua em JSON, não em formato Prometheus/OpenMetrics.

## Arquivos alterados

- Novos: `server/infrastructure/metricsEndpoint.mjs`, `server/infrastructure/metricPolicy.mjs`.
- Integração: `server/infrastructure/observability.mjs`, `server/infrastructure/distributedLock.mjs`, `server/config.mjs`, `server/index.mjs`, `.env.example`.
- Novos testes: `server/tests/metricsSecurity.test.mjs` e `server/tests/metricsCardinality.test.mjs`.
- Verificação de segredo vazio ampliada: `server/tests/deploymentSafety.test.mjs`.
- Documentação: `README.md`, `docs/MULTI_REPLICA.md` e este relatório.

Alterações anteriores do worktree foram preservadas; diffs acumulados de arquivos compartilhados não pertencem integralmente a esta etapa.

## Testes criados e executados

13 novos testes cobrem: endpoint desativado; configuração segura; credencial ausente/inválida/correta; separação de privilégios; ausência do token nos logs/respostas; GET/HEAD e métodos inválidos; limite real de 60 coletas; renovação da janela; 10 mil identificadores dinâmicos; teto global/por métrica; overflow; snapshots; rotas Express com parâmetros e queries; locks distintos com fencing, renovação, perda e timeout.

Baseline relacionado, antes da alteração: 17/17 aprovados (`infrastructurePrimitives`, `multiReplicaServer`, `deploymentSafety`).

Validação final: 67/67 aprovados, reunindo os dois arquivos novos e `infrastructurePrimitives`, `multiReplicaServer`, `deploymentSafety`, `authRoutes`, `socketSessionAuth`, `socketSessionClient`, `timeoutBehavior`.

- Typecheck: `npm run typecheck` aprovado.
- Build: `npm run build` aprovado; permanece aviso de chunks maiores que 500 kB.
- Whitespace: `git diff --check` aprovado.

## Riscos restantes e operação

- Configurar `METRICS_TOKEN` no backend/coletor é uma ação de implantação ainda não executada. Sem isso, `/metrics` retorna `404`. Usar segredo aleatório, HTTPS/rede privada e rotação conforme [manual operacional](./MULTI_REPLICA.md#coleta-privada-de-métricas).
- Dashboards que filtravam recursos individuais ou rotas completas precisam adotar as categorias novas. Novas instrumentações devem entrar na política explícita; monitorar `registry.droppedSamples` para detectar descarte.
- Limite de coletas é por instância, não global ao cluster. Proteção volumétrica de tentativas não autorizadas permanece responsabilidade do proxy/rede. Réplicas possuem métricas independentes e devem ser coletadas individualmente.
- Validação usou HTTP/Express reais localmente e clientes de dependências simulados. Não houve deploy, coletor externo, Redis real ou teste de carga de produção. A suíte completa não foi executada; a falha preexistente de simulação documentada na etapa Socket não foi reavaliada aqui.
- O registro de métricas é limitado; esta etapa não limita arquivos/logs externos nem outras estruturas de memória do jogo.
