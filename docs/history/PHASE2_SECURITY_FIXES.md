# Fase 2 — correções Medium

Validação local: 14/09/2026. Branch: `codex/ci-e2e`.
Base preservada: `fce7d3d0794dc10c335101f7cae2c23e91112930` (Fase 1).
Somente os cinco achados Medium; dependências inalteradas.
O relatório inicial foi entregue sem stage, commit ou push. Revalidação para publicação abaixo.

## Diagnóstico confirmado antes das alterações

- HTTP verificava Firebase sem revogação; Socket.IO já verificava revogação.
- `/ready` iniciava novas consultas a cada chamada, inclusive com consultas anteriores pendentes.
- Importações tinham limites por sessão, sem reserva agregada por UID.
- Geração paga de IA não compartilhava cooldown, orçamento e concorrência entre réplicas.
- CSP preservava imagens, objetos e base URI, mas não enviava `frame-ancestors` no HTTP.

## Arquivos alterados

| Arquivo | Motivo |
| --- | --- |
| `server/auth.mjs` | Revogação HTTP e classificação comum de erros HTTP/Socket.IO. |
| `server/config.mjs` | Configuração de cache, quotas de importação e limites de IA. |
| `server/index.mjs` | Conectar controles aos serviços reais; cache de readiness e headers HTTP. |
| `server/infrastructure/readiness.mjs` | Cache curto, single-flight, timeout e sanitização. |
| `server/infrastructure/redisRuntime.mjs` | Compartilhar o PING subjacente, inclusive após timeout do chamador. |
| `server/infrastructure/aiUsage.mjs` (novo) | Admissão atômica Redis/Lua, orçamento, cooldown e leases. |
| `server/services/brasfootImportSessions.mjs` | Quotas transacionais, reserva de bytes, processamento e limpeza recuperável. |
| `server/services/socialAi.mjs` | Reservar capacidade antes de gerar, incluindo retries/modelos alternativos. |
| `server/services/coachInterviewAi.mjs` | Aplicar os mesmos controles à entrevista. |
| `server/routes/news.mjs` | Encaminhar UID autenticado e operação ao controle de IA. |
| `server/store/roomStore.mjs` | Encaminhar identidade validada do manager às entrevistas. |
| `shared/imagePolicy.mjs` | CSP HTTP adicional, preservando CSP usada em meta. |
| `shared/imagePolicy.d.mts` | Declaração do novo export de CSP. |
| `vite.config.ts` | Headers anti-framing no desenvolvimento e preview. |
| `vercel.json` | Headers anti-framing em todas as rotas do deploy. |
| `e2e/server.mjs` | Preview isolado E2E com a mesma política HTTP. |
| `e2e/security.spec.mjs` (novo) | Navegador real: bloqueio do iframe e acesso direto preservado. |
| `server/tests/httpAuthRevocation.test.mjs` (novo) | Oito regressões de autenticação, indisponibilidade e cobertura de rotas. |
| `server/tests/readinessProtection.test.mjs` (novo) | Cinco regressões de cache, concorrência, falha e headers. |
| `server/tests/importQuotas.test.mjs` (novo) | Dez regressões de quotas, concorrência, limpeza e compatibilidade. |
| `server/tests/aiUsage.test.mjs` (novo) | Onze regressões de orçamento/cooldown/concorrência/fail-closed. |
| `server/tests/imageSecurity.test.mjs` | Verificar CSP HTTP sem enfraquecer diretivas anteriores. |
| `server/tests/timeoutBehavior.test.mjs` | Diferenciar token inválido de expirado, mantendo ambos os asserts. |
| `docs/PHASE2_SECURITY_FIXES.md` (novo) | Este relatório e parâmetros operacionais. |

## 1. Tokens revogados

HTTP e Socket.IO usam `verifyIdToken(token, true)`. Erros possuem códigos distintos:
`INVALID_AUTH_TOKEN`, `AUTH_TOKEN_EXPIRED`, `AUTH_TOKEN_REVOKED`, `AUTH_USER_DISABLED` (401)
e `AUTH_UNAVAILABLE` (503). Timeout permanece limitado; nenhuma falha autentica o usuário.
Mensagens internas do Firebase não são devolvidas.

Regressões cobrem token válido, inválido, expirado, revogado, usuário desabilitado,
indisponibilidade e timeout. Teste HTTP percorre as nove famílias privadas com
GET/POST/PATCH/DELETE. `/health`, `/ready` e leitura pública de mídia mantêm o contrato existente.

Limite: checar revogação exige consulta adicional ao Firebase. A indisponibilidade pode
impedir acesso legítimo, deliberadamente sem bypass. Validação real do provedor ainda pendente.
A política segue a [documentação Firebase](https://firebase.google.com/docs/auth/admin/manage-sessions).

## 2. Readiness

- Cache de sucesso e falha: 1 segundo por padrão; teto de 2 segundos.
- Chamadas simultâneas compartilham uma execução.
- Consultas subjacentes ainda pendentes continuam compartilhadas mesmo após timeout.
- Firestore e Redis têm timeout; o timeout agregado usa `DEPENDENCY_TIMEOUT_MS` (2.500 ms padrão).
- Resposta pública contém somente estado e indicadores sanitizados das dependências.
- `Cache-Control: no-store` evita cache intermediário; draining continua retornando 503 imediatamente.

O rate limit incide sobre **probes caros**, não sobre respostas HTTP: no máximo uma nova
execução por intervalo de cache por instância, sem rejeitar health checks legítimos com 429.
Trocar IP, parâmetros ou fazer chamadas concorrentes não produz novas consultas dentro do cache.
O custo máximo cresce com o número de réplicas, não com o número de requisições.

Testes: 30 chamadas concorrentes, expiração, dependência permanentemente pendente,
redação de erros e 40 chamadas HTTP legítimas. Uma dependência caída pode permanecer
representada pelo último sucesso durante o curto TTL; não há cache longo.

## 3. Quotas agregadas de importação

Produção utiliza Firestore + Storage. A criação e a aquisição de processamento leem um
documento de coordenação por UID, consultam as sessões desse UID e gravam a reserva na
mesma transação. Duas réplicas não conseguem reservar a partir da mesma leitura antiga.
O documento da sessão é a reserva persistente, evitando contadores separados que fiquem órfãos.
Sessões legadas também entram no cálculo. Modo local continua restrito ao desenvolvimento.

Defaults:

| Variável | Padrão |
| --- | --- |
| `IMPORT_MAX_SESSIONS_PER_UID` | 3 |
| `IMPORT_MAX_RESERVED_BYTES_PER_UID` | 2 GiB |
| `IMPORT_MAX_PROCESSES_PER_UID` | 1 |

A reserva é conservadora: `3 × maxTotalBytes + maxFileBytes`, cobrindo fontes, substituição
de preview e upload em andamento. Com os limites existentes, são **800 MiB por sessão**;
portanto, o teto de 2 GiB permite efetivamente duas sessões, mesmo com teto nominal de três.
Os previews também ficam limitados ao tamanho reservado. A quota não representa apenas
o volume enviado naquele momento: sessões vazias já reservam sua capacidade máxima.

- Sucesso, cancelamento e falha operacional/5xx removem temporários e liberam a reserva.
- Validações 4xx mantêm a sessão corrigível; o processamento é liberado.
- Expiração permite cleanup e recuperação por outra réplica.
- Caminhos de upload pendente são registrados antes da escrita, permitindo limpar escrita parcial.
- Substituições antigas permanecem contabilizadas até exclusão efetiva.
- Lease de processamento é renovado enquanto a operação está em andamento.
- Se a própria exclusão falhar, a reserva permanece até limpeza bem-sucedida/TTL. Liberar
  a quota deixando os blobs no Storage permitiria contornar o limite.

Testes com duas instâncias e Firestore/Storage controlados: criação concorrente, UID independente,
reserva de bytes, cancelamento, expiração, falha de upload, processamento concorrente,
sucesso/falha no commit, sessão legada e desenvolvimento local. IAM, contenção real do
Firestore e falhas de rede prolongadas precisam de validação no ambiente de homologação.

## 4. Controles distribuídos de IA

Uma operação Lua valida e reserva atomicamente:

- cooldown por UID/operação;
- orçamento por UID/operação/janela, UID/janela e global/janela;
- concorrência por UID e global.

Relógio vem do Redis. Chaves usam o mesmo hash slot `{ai}`; leases possuem token único e TTL.
Liberação remove somente o token correspondente. TTL global não é reduzido por uma operação
mais curta. Não existe sequência vulnerável GET/verificar/SET no cliente.
Atomicidade segue o [modelo de scripts Redis](https://redis.io/docs/latest/develop/programmability/eval-intro/).

| Configuração | Padrão |
| --- | --- |
| `AI_BUDGET_WINDOW_MS` | 3.600.000 ms |
| `AI_OPERATION_ATTEMPTS` | 60 |
| `AI_UID_ATTEMPTS` | 120 |
| `AI_GLOBAL_ATTEMPTS` | 1.000 |
| `AI_UID_CONCURRENCY` | 1 |
| `AI_GLOBAL_CONCURRENCY` | 8 |

Cooldowns: feed/coletiva 10 s, post 5 s, comentário 3 s, entrevista 2 s.
Os serviços reservam o pior caso de chamadas ao provedor (modelos × tentativas), antes
do primeiro fetch. Tentativas falhas não devolvem orçamento: podem já ter gerado custo.
O orçamento é em **tentativas**, não em moeda/tokens faturados. Configuração e namespace
Redis devem ser iguais entre réplicas do mesmo ambiente.

UID vem da autenticação/manager validado, nunca do texto enviado ao modelo. Quando Redis
é obrigatório e está indisponível, geração paga falha fechada. Cache já existente e
respostas determinísticas sem provedor não geram custo nem representam fallback local
de quota. Os limitadores locais anteriores podem ainda reduzir chamadas, mas não autorizam
nenhum fetch por fora do controle distribuído. Desenvolvimento sem Redis usa a mesma política local.

Onze testes exercitam duas instâncias sobre um backend atômico controlado, concorrência,
troca de UID/operação/réplica, orçamento global, retries, expiração, timeout e ausência de
Redis sem acesso ao provedor. **Lua ainda não foi executado contra Redis real nesta validação**.
Redis deve preservar o estado compartilhado; perda/evicção das chaves elimina os limites
da janela. Usar instância adequada, política sem eviction dessas chaves e isolamento por ambiente.

## 5. Clickjacking

Headers HTTP aplicados no Express, Vite dev/preview e Vercel:

```http
Content-Security-Policy: img-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'
X-Frame-Options: DENY
```

`IMAGE_CSP` e meta existentes ficam intactos. `frame-ancestors` está em header, conforme
[MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/frame-ancestors).
Teste Chrome serve uma página externa em outra origem local real e confirma bloqueio CSP;
a abertura direta e os fluxos E2E existentes continuam funcionando.
Vercel foi validado pela configuração e teste de igualdade, não por novo deploy remoto.

## Revisão explícita de bypasses

| Tentativa | Resultado |
| --- | --- |
| Token revogado em outra família/verbo HTTP | Middleware comum rejeita; nove famílias × quatro verbos exercitados. |
| Flood concorrente em `/ready` | Uma consulta compartilhada; timeout não cria outra consulta pendente. |
| Duas réplicas criando/processando importações do mesmo UID | Transação por UID impede exceder a quota; sessões antigas contam. |
| Alternar réplicas, salas, operações ou UID na IA | Redis mantém limites por UID/operação e teto global; indisponibilidade impede fetch. |
| Framing em outra origem ou configuração de preview/deploy | Header HTTP uniforme e bloqueio observado no Chrome; CSP anterior preservada. |

Nenhuma alteração nas regras de propriedade/autorização de mídia ou no bloqueio Socket.IO
quando Redis obrigatório está indisponível. Testes relacionados da Fase 1 continuam passando.

## Validação

| Execução | Resultado |
| --- | --- |
| Novos testes server (quatro arquivos) | 34/34 aprovados; 0 falhas/cancelamentos |
| Novo teste E2E de clickjacking | 1/1 aprovado, também incluído na suíte E2E completa |
| Testes relacionados (15 arquivos) | 124/124 aprovados; 0 falhas/cancelamentos |
| `npm run test:server` | 1.309 testes: 1.308 aprovados, 0 falhas, 0 cancelamentos, 1 skip existente |
| `npm run test:frontend` | 194/194 aprovados; 0 falhas/cancelamentos/skips |
| `npm run test:e2e` com `E2E_CHANNEL=chrome` | 4/4 aprovados |
| `npm audit` | 0 vulnerabilidades |
| `npm run typecheck` | Sucesso |
| `npm run build` | Sucesso; aviso existente de chunks acima de 500 kB |
| `git diff --check` | Sucesso |

Os totais não são somáveis: novos/relacionados estão incluídos na suíte completa.
Relacionados: authRoutes, socketAuth, socketSessionAuth, timeoutBehavior, infrastructurePrimitives,
coordinationAvailability, brasfootImportSessions, catalogBrasfootGeneration, coachInterviewAiProvider,
socialAiProvider, newsRoute, careerNewsRoute, mediaOwnership, cloudinaryMedia e imageSecurity.

## Ocorrências, riscos e cenários não testados

- Primeira suíte server: 1 falha determinística em `timeoutBehavior`: o teste antigo tratava
  expirado como inválido. Correção manteve teste de inválido e acrescentou expectativa específica
  de expirado. Reexecução isolada e suíte completa passaram; não era flaky.
- Primeiro teste de iframe usava resposta interceptada, classificada pelo Chrome como rede
  pública; Local Network Access bloqueava antes da CSP. Substituído por servidor HTTP local
  real em outra origem. Nenhuma proteção do navegador foi desativada; teste isolado e suíte passaram.
- `competitionRoomStore.test.mjs` e `halftimeMatch.test.mjs`: instabilidades previamente
  relatadas não reapareceram na execução final; arquivos não alterados.
- O skip existente é `socketClusterRedis.test.mjs`, condicionado a `TEST_REDIS_URL`.
  Redis real, Firebase/Firestore/Storage reais, Cloudinary e Gemini reais não foram acessados.
- Multi-réplica foi exercitado com doubles compartilhados; validar Redis Lua, IAM,
  contenção e recuperação durante partições reais antes de promover para produção.
- Infraestrutura externa que sobrescreva headers precisa manter a política documentada.
- Achados Low/Informational continuam fora do escopo.

## Git e exclusões — estado da revisão inicial

- `codex/ci-e2e`, HEAD permanece no commit da Fase 1.
- 24 arquivos da Fase 2: 17 modificados (`M`) e 7 novos (`??`), incluindo este relatório.
- Diff dos arquivos já rastreados: 272 inserções e 56 remoções; arquivos novos não entram
  nesse `git diff --stat` enquanto não forem adicionados ao índice.
- Índice vazio; nenhum commit/push realizado.
- `.env.local`, `.tmp/*`, logs e artefatos locais continuam ignorados, fora das alterações entregues.
- Verificação dos arquivos alterados/novos contra padrões de credenciais e valores secretos
  locais: nenhuma ocorrência. Nenhum valor de credencial foi impresso.
- Um arquivo externo preexistente não rastreado na raiz superior (`moke e2e` com caractere
  adicional) foi preservado e permanece fora do escopo.

## Revalidação para publicação — 14/09/2026

Por autorização do usuário, toda a validação foi repetida antes do único commit
`security: fix medium audit findings` destinado a `origin/codex/ci-e2e`.
Resultados mantidos: 34 testes novos server, 124 relacionados, 1.308 aprovados no server
(0 falhas, 0 cancelamentos, 1 skip existente), 194 frontend e 4 E2E Chrome, incluindo
o novo teste de framing. Audit: zero vulnerabilidades. Typecheck, build e diff-check passaram.
Nenhuma nova falha; nenhum código ou teste foi alterado nesta revalidação.
Revisão confirmou os cinco controles, preservação da Fase 1 e ausência de mudanças em dependências.
Somente os 24 arquivos listados pertencem ao commit; exclusões locais permanecem válidas.
Pendências operacionais acima continuam abertas. Não iniciar a Fase 3 automaticamente.
