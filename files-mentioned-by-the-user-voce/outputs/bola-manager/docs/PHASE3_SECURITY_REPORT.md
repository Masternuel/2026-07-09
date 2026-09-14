# Fase 3 — Security Hardening: revisão pré-publicação

Registro da revisão e validação antes do commit autorizado `security: harden application and CI security`. Hash e resultado do push serão identificados pelo Git e pelo relatório de entrega. **Sem deploy, acesso à produção ou uso de credenciais reais de provedores.** As verificações locais não substituem homologação dos serviços externos.

## Git e escopo no momento da revisão pré-stage

- Branch: `codex/ci-e2e`.
- HEAD mantido: `6f82cbd86a54ec587ab8d5aaa24355e6d1fbecac` (Fase 2).
- Fase 1 preservada: `fce7d3d0794dc10c335101f7cae2c23e91112930`.
- Index vazio: nenhum arquivo em stage.
- Estado: 32 arquivos rastreados modificados e 8 novos da Fase 3; 40 arquivos no escopo.
- `git diff --stat` dos rastreados: 213 inserções, 133 remoções. Incluindo novos arquivos e este relatório: **912 inserções, 133 remoções**.
- O arquivo externo preexistente não rastreado permanece intocado e fora do escopo.
- `.env.local`, `.tmp/*`, logs locais e arquivos externos não foram adicionados ao index. Varredura limitada aos arquivos alterados/novos e workflow não identificou credenciais reais introduzidas; testes contêm somente valores sintéticos.
- Nenhuma dependência foi adicionada ou alterada; `package.json` e `package-lock.json` permanecem intactos.
- Alterações nas fronteiras HTTP/Socket são necessárias para a política comum. Não houve reversão dos controles das Fases 1/2 nem alteração das regras esportivas/econômicas.

## Arquivos alterados

Caminhos relativos ao projeto `outputs/bola-manager`, exceto `.github/workflows/bola-manager-ci.yml`, situado na raiz Git.

| Arquivo | Motivo |
| --- | --- |
| `.github/workflows/bola-manager-ci.yml` | Fixar as 5 referências de Actions em SHAs oficiais; preservar permissões e gatilhos. |
| `README.md` | Apontar o guia de hardening e o requisito operacional de proxy. |
| `docs/BACKUP_RESTORE.md` | Inventário, backup recomendado e restore isolado; separar plano de evidência operacional. |
| `e2e/server.mjs` | Usar os headers compartilhados no servidor de testes. |
| `scripts/import-brasfoot.mjs` | Redigir erros e relatórios CLI preservando JSON e entradas. |
| `scripts/seed-builtin-catalog.mjs` | Redigir diagnósticos de falha do seed. |
| `server/auth.mjs` | Aplicar classificação e mensagens públicas controladas de autenticação. |
| `server/config.mjs` | Validar CORS, TRUST_PROXY e habilitação explícita de HSTS. |
| `server/game/aiMarketTick.mjs` | Redigir telemetria de falha do mercado. |
| `server/game/fixtures.mjs` | Classificar explicitamente erros de domínio conhecidos. |
| `server/game/professionalLifecycleAi.mjs` | Evitar persistir mensagens internas de exceções no histórico público. |
| `server/game/scouting.mjs` | Classificar falhas de domínio do estudo do adversário. |
| `server/index.mjs` | Unificar erros/logs HTTP, proxy, CORS, headers e startup/shutdown. |
| `server/infrastructure/observability.mjs` | Delegar redaction ao módulo central. |
| `server/routes/editor.mjs` | Classificar somente falhas de domínio conhecidas como públicas. |
| `server/routes/news.mjs` | Classificar falhas de domínio conhecidas. |
| `server/services/pressConference.mjs` | Classificar validação pública da coletiva. |
| `server/sockets/authSession.mjs` | Sanitizar erros de autenticação da sessão. |
| `server/sockets/chatHandlers.mjs` | Classificar validação de chat. |
| `server/sockets/helpers.mjs` | Unificar ACK/sem ACK e sanitizar erros encaminhados entre réplicas. |
| `server/sockets/index.mjs` | Sanitizar handshake e coordenação com logs correlacionados. |
| `server/sockets/lineupHandlers.mjs` | Classificar validação de escalação. |
| `server/sockets/marketHandlers.mjs` | Classificar validação de mercado. |
| `server/sockets/matchHandlers.mjs` | Sanitizar falhas da partida/playback e classificar domínio. |
| `server/sockets/roomHandlers.mjs` | Classificar validação de sala. |
| `server/store/roomCreationOperation.mjs` | Classificar erro esperado da criação de sala. |
| `server/store/roomPersistence.mjs` | Redigir diagnóstico de recuperação. |
| `server/store/roomStore.mjs` | Impedir que exceções internas sejam convertidas em mensagens públicas de domínio. |
| `server/tests/editorRoute.test.mjs` | Exigir mensagens genéricas de storage/upload; manter verificações de status/código. |
| `server/tests/testHarness.mjs` | Usar origens de teste explícitas compatíveis com a política de produção. |
| `vercel.json` | Preservar CSP/XFO e acrescentar headers complementares. |
| `vite.config.ts` | Compartilhar headers e permitir validação sem arquivos de ambiente. |
| `docs/SECURITY_HARDENING.md` | Documentar políticas, configurações, SHAs e requisitos de homologação. |
| `server/infrastructure/networkPolicy.mjs` | Centralizar validação de origens e IPs/CIDRs confiáveis. |
| `server/infrastructure/publicErrors.mjs` | Centralizar classificação, serialização segura e correlation IDs. |
| `server/infrastructure/redaction.mjs` | Centralizar mascaramento de campos, texto, exceções e relatórios. |
| `server/tests/securityHardening.test.mjs` | Cobrir os novos controles e tentativas sintéticas de bypass. |
| `shared/securityHeaders.d.mts` | Tipar os headers compartilhados para o frontend. |
| `shared/securityHeaders.mjs` | Compartilhar nosniff, Referrer-Policy e Permissions-Policy. |
| `docs/PHASE3_SECURITY_REPORT.md` | Registrar escopo, revisão final, validações e pendências desta entrega. |

## Erros HTTP e Socket.IO

- Mensagens úteis são permitidas somente para erros 4xx explicitamente classificados por tipo de domínio ou `public: true`. `expose: true` isolado não concede essa permissão.
- Códigos de autenticação/infraestrutura enumerados recebem mensagens fixas. Erros inesperados ou de provedor recebem mensagem genérica, sem stack, cause, paths, URLs internas ou detalhes arbitrários.
- `details` não é copiado integralmente: validações expõem apenas paths limitados e texto genérico; retry/tamanho podem expor somente números controlados.
- Correlation IDs têm formato e tamanho restritos; valores inadequados são substituídos por UUID. Resposta, header HTTP `X-Request-Id` e log correlacionam a mesma operação.
- ACK, erro sem ACK, autenticação, handshake, playback e coordenação adotam a mesma fronteira de sanitização.
- Erros encaminhados por réplicas antigas não têm mensagens/detalhes confiados: preservam somente códigos com mensagens fixas. Outros erros ficam genéricos; o diagnóstico permanece no log.
- Não se deve copiar texto de exceção de provedor para um erro marcado público. Os pontos identificados em sala/carreira foram corrigidos.

Testes incluem exceções Redis/Firebase/Cloudinary sintéticas, secrets, stack/path/details, erros de domínio, correlation IDs, ACK/sem ACK e mensagens entre réplicas.

## GitHub Actions

SHAs verificados contra refs públicas dos repositórios oficiais, sem credential helper. Nenhum SHA foi inventado.

| Action | Referência antiga | SHA completo | Versão |
| --- | --- | --- | --- |
| actions/checkout | v6 | d23441a48e516b6c34aea4fa41551a30e30af803 | v6.1.0 |
| actions/setup-node | v6 | 249970729cb0ef3589644e2896645e5dc5ba9c38 | v6.5.0 |
| actions/upload-artifact | v4 | ea165f8d65b6e75b540449e92b4886f43607fa02 | v4.6.2 |

São 5 usos: checkout e setup-node duas vezes cada; upload-artifact uma vez. O workflow encontrado está integralmente fixado. YAML válido, `permissions: contents: read` preservado, sem `pull_request_target`, novos jobs ou permissões adicionais. Nenhuma Action ficou pendente de fixação.

## CORS, proxy e headers

### CORS

Produção exige origens HTTP/HTTPS exatas em `CLIENT_ORIGIN`, separadas por vírgula. Wildcard ou origem malformada falham antes da inicialização de dependências. Ausência da variável não libera origens de navegador.

Desenvolvimento mantém localhost e permite wildcard explícito apenas sem credenciais. `Origin: null` é recusado. Ausência de Origin continua permitida para clientes não-browser/healthchecks, sem reflexão de header; rotas privadas continuam autenticadas.

A mesma política cobre HTTP/polling e `allowRequest` do WebSocket. CORS não autentica clientes nativos, que podem omitir ou forjar Origin. Referência: [Socket.IO](https://socket.io/docs/v4/handling-cors/).

### Proxy

`TRUST_PROXY` ausente/false não confia em forwarded headers. Somente IPs/CIDRs explícitos são aceitos; true, wildcard, contagem de saltos e redes universais são recusados.

HTTP usa `req.ip`; conexões Socket.IO usam peer TCP, e eventos usam identidade autenticada. Não há leitura direta de X-Forwarded-For para contornar essa política.

**Antes do deploy:** comprovar a topologia Railway/proxy, restringir acesso direto e assegurar sobrescrita dos headers encaminhados pelo proxy confiável. Nenhum CIDR Railway foi presumido. Sem configuração atrás de proxy, limites por IP podem agregar usuários legítimos; exige homologação. Referência: [Express](https://expressjs.com/en/guide/behind-proxies/).

### Headers

CSP anterior, `frame-ancestors 'none'` e `X-Frame-Options: DENY` preservados. Foram adicionados/compartilhados `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` e Permissions-Policy bloqueando câmera, microfone, geolocalização e pagamento.

Express, Engine.IO (incluindo upgrade), Vite dev/preview, servidor E2E e configuração Vercel recebem os controles aplicáveis. Foram testados sucesso, erro de autenticação, 404, erro CORS, preflight, polling e upgrade.

`ENABLE_HSTS=true` habilita HSTS no backend somente em produção e HTTPS confiável: max-age de um ano, sem includeSubDomains/preload. Nunca é aplicado ao desenvolvimento local. HSTS/redirects no edge e headers efetivamente entregues após deploy continuam pendentes.

## Logging e redaction

Revisados logger HTTP/Socket, autenticação/handshake/cluster/playback, Redis, Firebase, Cloudinary, Gemini, importações CLI, recuperação e startup/shutdown.

Política central:

- mascarar Authorization, cookies, tokens, senhas, API keys, credenciais e corpos/payloads;
- redigir Bearer/Basic, JWT, PEM, formatos identificáveis de chaves, userinfo de URLs autenticadas e parâmetros secretos;
- manter diagnóstico interno redigido, incluindo name/code/message/stack/cause;
- limitar estruturas e tratar referências circulares;
- registrar família de rota, não path/query original;
- preservar JSON válido e todas as entradas nos relatórios CLI.

Limitação explícita: nenhum filtro heurístico reconhece todo segredo arbitrário sem contexto/formato. Não registrar corpos de requests/provedores ou textos livres desnecessários; novos provedores exigem revisão e testes de redaction.

## Backup e restauração

| Situação | Evidência |
| --- | --- |
| Existente no projeto | Persistência da carreira, exportação de catálogo e configurações/índices. Exportação do catálogo não equivale a backup completo. |
| Documentado nesta fase | Inventário, frequência/retenção propostas, IAM, isolamento, criptografia, restore isolado, integridade e rollback. |
| Não comprovado | Scheduler, backups reais, retenção configurada, recuperação de mídias, restore real e tempos medidos. |

O inventário abrange Firestore e subcoleções/páginas/manifests, partidas em andamento, catálogos/notícias/importações/quotas, Firebase Auth, Storage, Cloudinary, configuração e segredos em cofre separado. Locks/leases Redis não devem ser restaurados como estado válido; reservas de uso precisam de reconciliação.

O runbook propõe backup diário, retenção de 30 diários/12 mensais e exercício mensal. **RPO de 24h e RTO de 8h são metas, não resultados medidos.**

Restore documentado somente para projeto isolado, sem chamadas a provedores reais, com ordem de restauração, validação de mídia/propriedade, autenticação, quotas, carreira e partidas; rollback interrompe o laboratório e reinicia de backup em destino vazio. Nenhum comando de backup/restore foi executado nesta fase.

Detalhamento: [BACKUP_RESTORE.md](BACKUP_RESTORE.md).

## Validação final

Suítes direcionadas são subconjuntos do servidor; não somar os números como testes distintos.

| Verificação | Total | Passaram | Falharam | Cancelados | Ignorados |
| --- | ---: | ---: | ---: | ---: | ---: |
| Novos testes Fase 3 | 32 | 32 | 0 | 0 | 0 |
| Diretamente relacionados | 61 | 61 | 0 | 0 | 0 |
| Regressão Fase 1 | 31 | 31 | 0 | 0 | 0 |
| Regressão Fase 2 | 44 | 44 | 0 | 0 | 0 |
| npm run test:server | 1341 | 1340 | 0 | 0 | 1 |
| npm run test:frontend | 194 | 194 | 0 | 0 | 0 |
| E2E_CHANNEL=chrome npm run test:e2e | 4 | 4 | 0 | 0 | 0 |

- Novos: `securityHardening.test.mjs`.
- Relacionados: authRoutes, socketAuth, timeoutBehavior, infrastructurePrimitives, editorRoute, careerRosterIntegrity, opponentStudyRoute e pressConference.
- Fase 1: mediaOwnership, coordinationAvailability e socketSessionAuth.
- Fase 2: httpAuthRevocation, readinessProtection, importQuotas, aiUsage e imageSecurity.
- Único skip: teste já condicionado a `TEST_REDIS_URL` em `socketClusterRedis.test.mjs`. Não foi desabilitado nesta fase.
- `competitionRoomStore.test.mjs` e `halftimeMatch.test.mjs` não foram alterados; não houve falha/cancelamento na execução final.
- E2E: navegação/carreira/táticas/rankings; scouting/transferência/reload; intervalo/recuperação/rodada; bloqueio de iframe pela CSP.

| Verificação adicional | Resultado |
| --- | --- |
| npm audit | Exit 0; 0 critical, high, moderate, low e informational |
| npm run typecheck | Exit 0; sem erros |
| npm run build | Exit 0; aviso existente de chunks acima de 500 kB |
| git diff --check | Exit 0; sem problemas |
| Workflow YAML | Parse válido; 5/5 Actions em SHA; contents: read |

Validação/build sem leitura de arquivos de ambiente com `BOLA_ENV_FILES=false`; E2E usa fixtures e desabilita env files. Foram verificados nomes de variáveis, sem imprimir valores: nenhuma credencial de provedor presente no processo de validação. Logs gerados permaneceram em `.tmp` ignorado.

Duas expectativas de mensagens de upload/storage e a origem do test harness foram adaptadas à nova política; códigos/status continuam verificados. Não houve timeout aumentado, teste removido ou verificação desabilitada para obter resultado verde.

## Revisão ofensiva final

| Tentativa | Resultado observado e limite |
| --- | --- |
| Exception interna via HTTP/Socket expõe stack/path/details? | Não nos casos sintéticos; mensagem genérica e ID correlacionado, inclusive em erro encaminhado de réplica antiga. |
| Token/credencial sintético no request vaza em log? | Campos, padrões sensíveis, URL autenticada e requests testados redigidos; logging não recebe body/path/query bruto. Segredo arbitrário sem formato permanece limitação documentada. |
| Origin não autorizada passa? | Recusada em HTTP e handshake WebSocket; wildcard de produção falha no startup. Cliente nativo sem Origin não é autenticado por CORS. |
| X-Forwarded-For/Proto forjado altera identidade/HTTPS? | Não com trust proxy padrão ou peer não confiável; confiança explícita exige isolamento real do proxy. |
| Rota omite headers? | Cobertura local passou para respostas de sucesso/erro/preflight e Engine.IO polling/upgrade; edge após deploy ainda não verificado. |
| Action mutável ou permissão ampliada? | Nenhuma no workflow encontrado: 5/5 SHAs oficiais, apenas contents: read. |
| Documento afirma backup/restore sem prova? | Não; separa recursos existentes, procedimento recomendado e execução não comprovada. |

## Pendências operacionais

Itens não validados; requisitos da homologação seguinte, não falhas locais da Fase 3:

1. Redis real; fornecer `TEST_REDIS_URL` em ambiente isolado.
2. Execução Lua contra Redis real.
3. Adapter Socket.IO com Redis real.
4. Firebase Auth real.
5. Firestore real.
6. Storage real.
7. Cloudinary real.
8. Gemini real.
9. IAM real.
10. Contenção Redis/Firestore real.
11. Comportamento durante partições de rede.
12. Configuração real do proxy, isolamento e rate limits.
13. Headers observados após deploy.
14. Backup real.
15. Restore real.
16. Medição real de RPO/RTO.

**Publicação limitada ao commit/push solicitado, após validação verde. Não iniciar Fase 4 nem executar deploy.**
