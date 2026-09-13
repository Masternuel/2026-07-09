# Fase 1 — correções High

Data: 2026-09-13. Branch: `codex/ci-e2e`. Finalização da Fase 1 autorizada para commit e push; sem acesso a serviços de produção durante a validação.
Escopo restrito aos dois achados High solicitados. Achados Medium/Low/Informational não tratados.

## 1. Propriedade de mídia

- CRUD público ignora `crestImagePath`, `avatarImagePath` e `trophyImagePath`; requests contendo somente esses campos não constituem edição válida. Campos desconhecidos, como `public_id`, continuam rejeitados pelos schemas estritos.
- O store também remove esses campos na criação/edição comum. Somente o fluxo interno de upload/associação grava o identificador do provedor. URLs públicas continuam editáveis, mas não concedem autorização para excluir o objeto apontado.
- Cada remoção recebe UID autenticado, entidade e ID do registro, derivados no servidor. Isso inclui substituição, remoção de imagem, exclusão do registro, bulk delete e rollback de uploads/importações.
- Firebase: novo caminho inclui hashes do proprietário e registro; metadados persistem proprietário, entidade, tipo e registro. A exclusão lê esses metadados, compara o vínculo completo e usa `ifGenerationMatch` para não apagar uma geração diferente daquela verificada.
- Firebase legado: exclusão permitida somente com metadados de proprietário/entidade/tipo correspondentes e hash do registro correto no caminho antigo. Metadados insuficientes não autorizam exclusão.
- Cloudinary: novos IDs incluem vínculo HMAC-SHA256 de UID, entidade, registro e identificador aleatório, assinado com o segredo do servidor. Antes de `destroy`, o backend verifica o vínculo; copiar o ID de B ou trocar seus hashes não autoriza A a removê-lo.
- Cloudinary legado sem prova verificável é preservado. Falhas de limpeza são sinalizadas por `mediaRemoved`, `previousMediaRemoved`, contadores ou `mediaCleanupFailed`, conforme a operação.
- Brasfoot propaga o proprietário autenticado até upload e rollback. Importações CLI globais mantêm seu escopo próprio. A ativação de gerações de catálogo continua preservando objetos referenciados por gerações anteriores.

## 2. Coordenação Redis obrigatória

- HTTP e Socket.IO utilizam a mesma condição: runtime habilitado, clientes command/publisher/subscriber prontos, locks e rate limiter presentes.
- Handshake é verificado antes do rate limit e novamente depois da autenticação. Indisponibilidade rejeita a conexão com erro genérico `REDIS_REQUIRED`.
- Conexões existentes revalidam antes de processar eventos e depois de rate limit/autorização, antes do handler. Logout permanece possível; não é operação de negócio.
- Encaminhamento entre réplicas verifica coordenação na origem e no destino. O proxy receptor também passa pela proteção central dos handlers.
- Falhas de comandos Redis de rate limit/lock são encapsuladas sem expor URL, credenciais ou detalhes internos ao cliente. HTTP retorna 503. Readiness considera também publisher/subscriber.
- Não foi adicionado fallback. Desenvolvimento/testes sem Redis obrigatório continuam locais; `REDIS_URL` configurada torna a dependência necessária também nesses ambientes.

## Arquivos alterados

| Arquivo | Finalidade |
| --- | --- |
| `server/services/mediaOwnership.mjs` (novo) | Vínculos, hashes, assinatura, validação de escopo e filtro de campos privados. |
| `server/services/catalogMedia.mjs` | Propriedade Firebase, metadados, geração e limpeza segura após falha. |
| `server/services/cloudinaryMedia.mjs` | IDs assinados, autorização antes de destroy e sinalização de falha na limpeza. |
| `server/services/mediaService.mjs` | Propagar escopo de propriedade ao provedor correto. |
| `server/routes/editor.mjs` | Filtrar campos do cliente e levar contexto confiável a todos os caminhos de limpeza. |
| `server/store/catalogStore.mjs` | Proteger CRUD e preservar registro/entidade de cada objeto no bulk delete, inclusive retries transacionais. |
| `scripts/import-brasfoot.mjs` | Propagar proprietário dos escudos e contexto do rollback. |
| `server/services/brasfootImportSessions.mjs` | UID autenticado em commits locais e distribuídos. |
| `server/infrastructure/coordinationAvailability.mjs` (novo) | Condição compartilhada de disponibilidade e erro público genérico. |
| `server/index.mjs` | Aplicar bloqueios HTTP/handshake e injetar proteção nos sockets. |
| `server/sockets/helpers.mjs` | Bloquear eventos antes dos handlers, inclusive após esperas assíncronas. |
| `server/sockets/index.mjs` | Proteger conexões existentes e encaminhamento entre réplicas. |
| `server/infrastructure/distributedLock.mjs` | Encapsular falhas de comandos Redis sem expor detalhes. |
| `server/infrastructure/distributedRateLimit.mjs` | HTTP 503 controlado quando o rate limiter falha. |
| `server/infrastructure/redisRuntime.mjs` | Readiness dos três clientes Redis. |
| `server/tests/mediaOwnership.test.mjs` (novo) | Regressões HTTP/provedores para propriedade e exclusão cruzada. |
| `server/tests/coordinationAvailability.test.mjs` (novo) | Handshake, queda após conexão, recuperação, réplicas e compatibilidade local. |
| `server/tests/editorRoute.test.mjs` | Fixtures com metadados/geração; estado legado sem depender de escrita pública insegura. |
| `server/tests/cloudinaryMedia.test.mjs` | Vínculos e escopos válidos nos fluxos existentes. |
| `server/tests/fixtures/cloudinaryPendingBody.mjs` | Criar objeto autorizado antes de testar timeout de remoção; mantém corpo pendente real. |
| `server/tests/infrastructurePrimitives.test.mjs` | Estado isReady dos mocks e falha genérica preservando causa de timeout. |
| `server/tests/brasfootBinaryImport.test.mjs` | Verificar proprietário no upload e rollback. |
| `server/tests/brasfootImportSessions.test.mjs` | Verificar propagação do UID autenticado. |
| `docs/MULTI_REPLICA.md` | Documentar bloqueios HTTP/Socket.IO e comportamento local. |
| `docs/PHASE1_SECURITY_FIXES.md` (novo) | Este relatório. |

## Regressões novas

12 testes novos, incluindo cenários internos adicionais:

1. Firebase: A não associa identificador de B; substituição legítima remove apenas A; vínculos maliciosos antigos não autorizam clear/delete/bulk; bulk misto remove A e preserva B.
2. Mesmos cenários HTTP usando Cloudinary.
3. Firebase legado exige proprietário, entidade, tipo e registro; exclusão condicionada à geração.
4. Cloudinary rejeita assinatura copiada/adulterada e ID legado não comprovado.
5. CRUD de clubes, jogadores e torneios ignora os três campos privados; IDs arbitrários são rejeitados.
6. Produção sem Redis rejeita handshake e HTTP; nenhum handler é alcançado.
7. Queda de command/publisher/subscriber bloqueia sockets existentes e novos; falha de comando não vaza conexão; recuperação restabelece operação.
8. Duas instâncias usando backend Redis controlado compartilham contadores e exclusão mútua com fencing crescente.
9. Proxy encaminhado revalida depois da autorização assíncrona.
10. Runtime pronto sem locks ou rate limiter não é considerado disponível.
11. Desenvolvimento sem Redis obrigatório continua funcionando.
12. Testes locais sem Redis obrigatório continuam funcionando.

## Validação da revisão anterior

| Execução | Resultado |
| --- | --- |
| Apenas dois arquivos novos | 12 aprovados, 0 falhas, 0 cancelados. |
| Mídia, editor, imports e coordenação | 58 aprovados, 0 falhas, 0 cancelados. |
| Imagens, autenticação de sockets, infraestrutura e múltiplas instâncias | 52 aprovados, 0 falhas, 0 cancelados. |
| `npm run test:frontend` | 194 aprovados, 0 falhas, 0 cancelados. |
| `npm run test:e2e` com `E2E_CHANNEL=chrome` | 3 aprovados; navegador instalado, sem alterar os testes. |
| `npm run test:server`, última execução completa | 1.275 testes: 1.273 aprovados, 1 falha, 0 cancelados, 1 pulado. |
| `npm audit --json` | 0 vulnerabilidades, incluindo High/Critical. |
| `npm run typecheck` | Aprovado. |
| `npm run build` | Aprovado; aviso existente de chunks acima de 500 kB. |
| Lint | Não existe script de lint no package.json. |
| `git diff --check` | Aprovado. |

**A suíte completa não está integralmente verde.** Na última execução, `competitionRoomStore.test.mjs:226` falhou com `DYNAMIC_KNOCKOUT_ROSTER_INVALID` para Clube B x Clube C. A reexecução de todo esse arquivo passou (6/6). Nenhum arquivo do motor de competições ou desse teste foi modificado.

A primeira execução completa teve timeout aguardando `match:halftime` em `halftimeMatch.test.mjs:571`; o teste passou isoladamente e na segunda execução completa. Não foram aumentados timeouts nem desativadas verificações. Os resultados indicam instabilidade fora dos módulos alterados, mas sua causa não foi encerrada nesta fase.

O teste pulado já exige `TEST_REDIS_URL`: adapter com Redis real. Não há Redis/Docker/WSL disponível neste ambiente. As regressões de duas instâncias executam o código real de rate limit/locks com backend controlado e adapter local; não substituem validação com Redis real.

A tentativa E2E padrão falhou antes de executar cenários porque o Chromium headless do Playwright não estava instalado. A alternativa configurável existente com Chrome executou os três cenários com sucesso.

Logs locais, ignorados pelo Git: `.tmp/phase1-new-tests.log`, `.tmp/phase1-regression-tests.log`, `.tmp/phase1-existing-related.log`, `.tmp/phase1-server-tests-final.log`, `.tmp/phase1-frontend-tests.log`, `.tmp/phase1-e2e-chrome.log` e `.tmp/phase1-build-final.log`.

## Limitações operacionais

- Mídias antigas sem prova de propriedade podem ficar órfãs no provedor. Não são apagadas automaticamente; revisão administrativa/reenvio será necessário. Isso não concede a outro usuário autorização de exclusão.
- A assinatura Cloudinary usa o segredo atual. Rotacioná-lo invalida a autorização automática de limpeza dos objetos assinados com a chave antiga; preserve-os para revisão/migração segura. Não retenha chaves comprometidas apenas para permitir limpeza.
- Firebase requer permissão de leitura de metadados, além de gravação/exclusão. As regras do repositório proíbem escritas diretas de clientes; publicação dessas regras e IAM externos não foram verificadas.
- Não foram acessados Firebase/Cloudinary reais nem usados dados de produção. Não houve deploy. Atualize todas as réplicas; instâncias antigas continuam executando o código vulnerável.
- A aplicação não executa negócio sem coordenação obrigatória, mas Redis continua sendo dependência operacional crítica. A saúde externa/TLS/IAM e o teste de adapter real precisam de validação no ambiente de integração.
- Achados Medium/Low/Informational da auditoria permanecem fora do escopo.

## Revalidação antes do commit

- Os 11 arquivos de testes diretamente relacionados foram executados novamente: 110 aprovados, 0 falhas, 0 cancelados e 0 pulados.
- `npm audit`: 0 vulnerabilidades.
- `npm run typecheck` e `npm run build`: aprovados; permanece o aviso existente de chunks maiores que 500 kB.
- `git diff --check`: aprovado.
- `competitionRoomStore.test.mjs` e `halftimeMatch.test.mjs` não foram modificados nem reexecutados nesta finalização. A instabilidade observada anteriormente continua registrada acima.
- Redis real continua pendente. Firebase/Cloudinary reais não foram acessados. Medium/Low/Informational permanecem fora do escopo.

## Escopo Git

- Branch: `codex/ci-e2e`.
- Commit limitado aos 25 arquivos da Fase 1 listados neste relatório: implementação, testes de regressão e documentação.
- `package.json` e `package-lock.json` não alterados; nenhuma dependência adicionada.
- Arquivo não rastreado preexistente fora do projeto mantido intacto.
- `.env.local`, `.tmp/*`, logs locais, credenciais e arquivos externos não relacionados não pertencem ao commit.
- Publicação autorizada somente na branch `codex/ci-e2e`, sem iniciar a Fase 2. O hash e o resultado do push são registrados no relatório de entrega.
