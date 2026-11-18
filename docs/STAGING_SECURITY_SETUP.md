# Staging de segurança: preparação externa

Estado: **infraestrutura não fornecida; nenhuma integração real executada nesta preparação**.
Os scripts não leem `.env.local`, não fazem deploy e não aprovam IAM por inferência.
Preflight é validação offline de formato e de **declarações de isolamento do operador**, não uma prova independente de isolamento da nuvem.

## Railway / Backend

- Criar ambiente Railway separado, domínio HTTPS próprio e duas réplicas do mesmo commit.
- Usar variáveis, Redis, Firebase, mídia e orçamento exclusivos de staging, sem usuários/dados reais.
- Runtime: `NODE_ENV=production`, `ROOM_STORE=firestore`, autenticação demo/editor local desativadas, Redis obrigatório, identidades e métricas próprias.
- **Não usar o arquivo do harness como arquivo de runtime.** O harness destrutivo exige `NODE_ENV=test` ou `staging`; o backend remoto continua em modo production para exercitar os controles reais.
- Ter acesso a logs redigidos, métricas autenticadas, eventos de restart e IDs das duas réplicas. Não colocar tokens em query strings.
- Registrar evidência de separação e configuração de cada réplica; indicar responsável e ticket/revisão no manifesto de isolamento.
- Nenhum deploy é realizado pelos comandos desta preparação.

## Redis

- Criar instância dedicada e descartável de homologação, **não a instância de produção, nem outro DB lógico dela**. De preferência separar também o Redis de testes do Redis do backend staging.
- `REDIS_URL`: Redis normal do servidor e reserva distribuída da etapa IA.
- `TEST_REDIS_URL`: Redis do teste real `socketClusterRedis.test.mjs` e ensaio Lua. Uma não substitui silenciosamente a outra.
- Exigir Redis/Valkey compatível com `PING`, `GET`, `SET NX PX`, `INCR`, `INCRBY`, `DEL`, `PTTL`, `PEXPIRE`, `TIME`, hashes (`HGET`, `HSET`), sorted sets (`ZADD`, `ZREM`, `ZCARD`, `ZREMRANGEBYSCORE`), `EVAL` e pub/sub (`PUBLISH`, `SUBSCRIBE`, `PSUBSCRIBE`, unsubscribe). O cliente também negocia comandos de sessão conforme a versão do serviço.
- Configurar ACL mínima para esses comandos, namespace de teste e canais correspondentes; não conceder `FLUSHALL`, `FLUSHDB` ou administração desnecessária.
- Política `noeviction`, capacidade monitorada e memória reservada para locks/quotas. Eviction de coordenação pode invalidar exclusividade.
- TLS (`rediss://`) quando suportado; nunca desativar verificação de certificado. Documentar exceção se somente rede privada oferecer Redis sem TLS.
- Preencher `TEST_REDIS_URL` no cofre/variável segura ou no arquivo ignorado `.env.staging`. Não colar no chat, argumento do shell ou log. URL com senha é secret.
- Registrar aliases/DNS/endpoints de produção no inventário de exclusão. O preflight compara host/porta sem distinguir senha/DB/esquema, mas não consegue descobrir aliases ou resolver topologia offline.

## Firebase

- Criar **projeto separado** com Auth, Firestore (banco default usado atualmente pelo app) e bucket Storage próprios; nunca reutilizar projeto/bucket de produção.
- Aplicar regras equivalentes às pretendidas para produção. Registrar versão/hash das regras e IAM para revisão posterior.
- Criar contas exclusivamente de teste. Autorizar criação de usuário desabilitado com UID `security-validation-*`; não reutilizar usuários existentes.
- Identidade runtime dedicada: permissões mínimas requeridas pelo jogo, incluindo leitura do usuário de fixture, transação Firestore e objeto Storage de teste.
- Identidade administrativa de testes **diferente**: criar/consultar/excluir somente usuários de homologação conforme permissões disponíveis. IAM do Firebase Auth pode não permitir restrição por UID: por isso o projeto inteiro precisa ser isolado.
- Harness aceita somente JSON explícito em `FIREBASE_SERVICE_ACCOUNT_JSON` e `STAGING_FIREBASE_ADMIN_JSON`, de contas distintas no projeto indicado. ADC, emuladores e credenciais ambientais implícitas não são aceitos para esta etapa.
- A etapa cria um usuário desabilitado, documento transacional `security-validation/<run-id>` e objeto `security-validation/<run-id>/fixture.png`. Não testa regras de cliente com Admin SDK; autorização HTTP, revogação, regras, contenção e duas réplicas reais permanecem ensaios operacionais posteriores.

## Cloudinary

- Criar conta/product environment dedicado, sem assets de produção e com API key/secret exclusivos. Confirmar escopo das credenciais no painel/IAM, não só o nome da pasta.
- **Uma pasta isolada não comprova isolamento das credenciais.** Credencial com poder de destruir assets produtivos bloqueia o ensaio.
- Escolher `CLOUDINARY_URL` **ou** `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`.
- O runner reutiliza upload e prova de propriedade HMAC do jogo. ID do objeto contém run-id; usuário/registro também usam run-id. Cleanup só deriva esse caminho exato e verifica a assinatura existente.
- Mudança de credencial entre ensaio e cleanup invalida o recibo: preservar credencial de teste em cofre até concluir limpeza/reconciliação.

## Gemini

- Criar projeto e chave exclusivos de staging, sem acesso ao orçamento produtivo. Restringir API, quota e faturamento; alerta de orçamento sozinho não é teto rígido.
- Configurar limites baixos no provedor e limites agregados da aplicação. Confirmar manualmente relação da chave com `STAGING_GEMINI_PROJECT_ID` e registrar evidência.
- Etapa IA faz no máximo uma chamada ao modelo explicitamente configurado, até o limite de saída já aplicado pelo serviço. Sem retries ou modelos alternativos no runner.
- A chamada usa reserva real Redis obrigatória. Depois verifica bloqueio de segunda geração e Redis desconectado sem nova chamada paga. Fallback local do conteúdo é tratado como falha, não sucesso de homologação.

## Frontend

- Criar origin HTTPS exclusivo de staging, com backend correspondente em `VITE_SERVER_URL`.
- Neste harness, `CLIENT_ORIGIN` aceita somente o origin exato confirmado por `STAGING_FRONTEND_ORIGIN`, sem wildcard ou origins adicionais não revisados. Configuração Vite do Firebase aponta para o mesmo projeto de staging.
- Verificar depois do deploy CSP, `frame-ancestors 'none'`, `X-Frame-Options: DENY`, HSTS quando aplicável e demais headers em respostas/erros/Engine.IO. O preflight **não acessa URLs** e não comprova headers servidos.

## Proxy

Registrar a cadeia real: cliente → edge/proxy → Railway/backend. Fornecer:

- quais hops terminam TLS e quais IPs/CIDRs chegam ao backend;
- quem remove/substitui `Forwarded`/`X-Forwarded-*`, tratamento de múltiplos valores e acesso direto ao backend;
- documentação do provedor e captura de IP observado no backend com requisições controladas;
- resultado de tentativa de spoofing de headers em staging.

Somente então definir `TRUST_PROXY` com IPs/CIDRs explícitos ou `false` se nenhum proxy confiável for necessário. Não adivinhar contagem de hops, não usar `true`/wildcards/redes universais. `false` não prova que a topologia de deploy está correta; registrar evidência mesmo nesse caso.

## Configuração local e confirmação

1. Preencher uma cópia `.env.staging` do template, por editor/cofre seguro. Todos os valores do template são vazios. Os scripts npm usam somente o ambiente do processo; **não carregam arquivos automaticamente**.
2. No harness, definir `STAGING_ENVIRONMENT=staging`, `NODE_ENV=test`, `BOLA_ENV_FILES=false`. Para autorizar fixtures, definir `STAGING_ALLOW_WRITES=true` somente após revisar isolamento/custos.
3. Criar diretório local ignorado `.tmp` se necessário. Gerar manifesto **ainda não confirmado**, sem rede ou impressão de valores:

```powershell
node --env-file=.env.staging scripts/security-staging-preflight.mjs --write-isolation-template .tmp/staging-isolation.json
```

4. No arquivo ignorado, manter hashes calculados, preencher `environment` com `staging`, `services.<serviço>.isolated=true`, `services.<serviço>.environment=staging` e `evidence` com referência à revisão da conta/projeto/endpoint/IAM. Confirmar `productionInventoryReviewed` somente após inventariar produção.
5. Preencher `production.<serviço>` com hashes SHA-256 dos identificadores conhecidos de produção. Formato: `fingerprint(serviceTargets(config)[serviço])`, funções exportadas pelo preflight, calculado offline por quem mantém o inventário. Não fornecer secrets produtivos ao harness. Redis identifica host:porta (mesmo DB alternativo bloqueado); Firebase/Gemini projeto; Storage bucket; Cloudinary cloud name; frontend/backend origin HTTPS. Redis e redisTest cruzam ambas as listas. Lista vazia significa inventário revisado sem recurso produtivo desse serviço, **não** “desconhecido”.
6. Para Firebase/Cloudinary/Gemini, o template vincula também hashes de credenciais de staging. Rotação exige nova revisão; não imprimir hashes ou valores em logs. SHA-256 não substitui gestão de secrets ou evidência humana.
7. Definir `STAGING_ISOLATION_FILE=.tmp/staging-isolation.json`. Nunca versionar manifesto preenchido/recibos.

O preflight não adivinha produção pelo hostname. Sem confirmação/evidência, retorna `ISOLATION_UNCONFIRMED` e bloqueia escrita. Configuração explicitamente produtiva ou com alvo na denylist é bloqueada. Cada grupo pode validar apenas seus serviços; `preflight` completo exige todos.

## Comandos por etapa

Com variáveis injetadas pelo cofre no processo:

```powershell
npm run security:staging:preflight
npm run security:staging:redis
npm run security:staging:firebase
npm run security:staging:media
npm run security:staging:ai
npm run security:staging:cleanup -- security-validation-<timestamp>-<random>
```

Alternativa explícita para arquivo ignorado (Node 20.9+):

```powershell
node --env-file=.env.staging scripts/security-staging-preflight.mjs
node --env-file=.env.staging scripts/security-staging-runner.mjs redis
node --env-file=.env.staging scripts/security-staging-runner.mjs firebase
node --env-file=.env.staging scripts/security-staging-runner.mjs media
node --env-file=.env.staging scripts/security-staging-runner.mjs ai
node --env-file=.env.staging scripts/security-staging-runner.mjs cleanup security-validation-<timestamp>-<random>
```

**Não executar essas etapas antes de fornecer staging e obter preflight válido.** Não existe comando “executar tudo” ou restore automático.

### Alcance e resultados

- Redis: exige `TEST_REDIS_URL`; executa teste de adapter existente mais teste Lua real; qualquer skip/falha/cancelamento bloqueia aprovação. Adapter usa dois servidores locais com Redis real, mas compartilha store em memória/Auth falso do teste existente: **não equivale a validar persistência/Auth de duas réplicas Railway**. Lua usa exatamente scripts exportados de locks, rate limit e IA.
- Firebase/media/IA: probes reais limitados descritos acima, não substituem todos os ensaios da Fase 4. Os testes unitários do preflight usam configuração sintética apenas para validar guardrails, nunca como evidência de infraestrutura real.
- Run-id aleatório único por etapa; recibo antes de fixtures em `.tmp/security-staging/<run-id>.json`. Preserve recibo (inclui prova local de propriedade) com acesso restrito. Em Windows conferir ACL do diretório; mode 0600 sozinho não garante ACL NTFS.
- Redis: todas as chaves de fixture (inclusive contadores/locks globais do código) recebem hash tag do run-id por adapter de teste; canais Socket.IO usam run-id. Cleanup confere marcador de propriedade e deleta lista exata registrada. Sem `SCAN`, `KEYS` ou wildcard. Marcador não expira sozinho para permitir reconciliação; limpar explicitamente.
- Firestore: prova run-id + hash de nonce conferida dentro da transação de exclusão. Storage: prova nos metadados e geração condicionada. Auth: UID, usuário desabilitado e prova no displayName. Cloudinary: caminho exato e HMAC do serviço.
- Cleanup exige isolamento ainda válido, mesmos alvos/credenciais e recibo íntegro. Sem prova, falha fechado. Falha parcial/interrupção pode deixar fixtures: preservar recibo e investigar; nunca varrer projeto/conta para “resolver”. Recuperação manual de recibo perdido exige nova revisão.
- Runner limita subprocesso a 120s, registra código, sinal, duração e tamanho de stderr; não imprime conteúdo bruto, corpos, tokens ou erros do SDK. Não há retry automático. Timeout não prova que operação remota não ocorreu.

## Backup / Restore — checklist de evidências

Seguir também [BACKUP_RESTORE.md](BACKUP_RESTORE.md). Nenhum backup fictício ou função de restore foi criado.

- [ ] Timestamp, identificador verificável da cópia real de teste e responsável.
- [ ] Componentes incluídos: Firestore/subcoleções, Auth separado, Storage, Cloudinary, configuração; exclusões explícitas.
- [ ] Política de retenção, criptografia em repouso/trânsito, permissões, integridade/checksum.
- [ ] Destino conhecido e isolado, projeto/bucket **novo e vazio**, Redis próprio e credenciais sem alcance produtivo.
- [ ] Procedimento de restore revisado, ordem das etapas, conciliação de referências/ownership/quotas e critério de rollback.
- [ ] Evidência de restore de teste, timestamps inicial/final, RPO/RTO medidos e validação de leitura/jogada/save.

Restore permanece bloqueado até cópia real e destino novo isolado existirem. Nenhuma variável sozinha comprova backup ou autoriza restore.

## Inventário de variáveis

Somente nomes; nenhum valor existente foi copiado. “Compartilhada” sempre significa **entre componentes de staging**, nunca com produção. Obrigatoriedade runtime pode diferir do harness.

| Variável | Serviço | Obrigatória | Pode ser compartilhada? | Secret? | Finalidade |
| --- | --- | --- | --- | --- | --- |
| NODE_ENV | Backend/harness | Sim | Não: arquivos separados | Não | Modo runtime vs ensaio com escrita |
| BOLA_ENV_FILES | Frontend/harness | Harness | Sim | Não | Impedir carregamento automático Vite |
| STAGING_ENVIRONMENT | Harness | Sim | Sim | Não | Declaração explícita de staging |
| STAGING_ALLOW_WRITES | Harness | Para fixtures/cleanup | Não com runtime | Não | Opt-in de escrita |
| STAGING_ISOLATION_FILE | Harness | Sim | Só operadores | Não; arquivo sensível | Manifesto de isolamento/denylist |
| STAGING_FRONTEND_ORIGIN | Frontend | Preflight completo | Sim | Não | Origin staging revisado |
| STAGING_BACKEND_URL | Backend | Preflight completo | Sim | Não | URL staging revisada |
| STAGING_REPLICA_COUNT | Railway | Preflight completo | Sim | Não | Réplicas declaradas; não verifica deploy |
| STAGING_GEMINI_PROJECT_ID | Gemini | Grupo IA | Só backend/harness | Não | Projeto da chave confirmado externamente |
| STAGING_AI_BUDGET_CONFIRMED | Gemini | Grupo IA | Só operadores | Não | Confirma teto de custo/quota externo |
| STAGING_FIREBASE_ADMIN_JSON | Firebase Auth | Grupo Firebase | Não com runtime/frontend | Sim | Identidade administrativa de testes |
| STAGING_RUN_ID | Harness | Gerada pelo runner | Entre filhos da execução | Não | Namespace único; não preencher manualmente |
| PORT | Backend | Default disponível | Não: por instância | Não | Porta HTTP |
| CLIENT_ORIGIN | CORS | Staging | Entre réplicas | Não | Origins exatos autorizados |
| TRUST_PROXY | Proxy | Staging | Conforme mesma topologia | Não | IP/CIDR confiável confirmado |
| ENABLE_HSTS | Headers | Conforme HTTPS validado | Entre réplicas | Não | HSTS no backend |
| ROOM_STORE | Firestore | Staging | Entre réplicas | Não | Persistência real |
| ALLOW_DEMO_AUTH | Auth | Staging | Entre réplicas | Não | Deve permanecer desativado |
| ALLOW_LOCAL_EDITOR | Auth | Staging | Entre réplicas | Não | Deve permanecer desativado |
| EDITOR_ADMIN_UIDS | Auth/editor | Para ensaios editor | Só backend/harness | Identificadores privados | Allowlist dos usuários de teste |
| MATCH_EVENT_DELAY_MS | Backend | Opcional | Entre réplicas | Não | Ritmo da simulação |
| FIREBASE_PROJECT_ID | Firebase | Grupo Firebase | Só staging | Não | Projeto separado |
| FIREBASE_STORAGE_BUCKET | Storage | Grupo Firebase | Só staging | Não | Bucket separado |
| FIREBASE_SERVICE_ACCOUNT_JSON | Firebase runtime | Harness; alternativa no runtime | Só réplicas/harness | Sim | Credencial runtime explícita |
| FIREBASE_CLIENT_EMAIL | Firebase runtime | Alternativa runtime; proibida harness | Só backend | Identidade privada | Credencial em campos separados |
| FIREBASE_PRIVATE_KEY | Firebase runtime | Alternativa runtime; proibida harness | Só backend | Sim | Chave privada |
| GOOGLE_APPLICATION_CREDENTIALS | Firebase runtime | Alternativa runtime; proibida harness | Não com frontend | Caminho privado | ADC explícito runtime |
| FIREBASE_USE_APPLICATION_DEFAULT | Firebase runtime | Alternativa runtime; desativado harness | Só backend | Não | Ativação de ADC |
| VITE_SERVER_URL | Frontend | Sim | Sim | Não | Backend correspondente |
| VITE_FIREBASE_API_KEY | Firebase client | Sim | Somente frontend staging | Pública/restrita; saída mascarada | Identifica projeto cliente |
| VITE_FIREBASE_AUTH_DOMAIN | Firebase Auth | Sim | Só staging | Não | Domínio de autenticação |
| VITE_FIREBASE_PROJECT_ID | Firebase client | Sim | Só staging | Não | Mesmo projeto do backend |
| VITE_FIREBASE_STORAGE_BUCKET | Storage client | Preflight completo | Só staging | Não | Mesmo bucket do backend |
| VITE_FIREBASE_MESSAGING_SENDER_ID | Firebase client | Preflight completo | Só staging | Não | Configuração cliente |
| VITE_FIREBASE_APP_ID | Firebase client | Sim | Só staging | Não | App de homologação |
| VITE_FIREBASE_MEASUREMENT_ID | Analytics | Opcional | Só staging | Não | Telemetria separada |
| REDIS_URL | Redis aplicação/IA | Grupo IA/runtime | Só réplicas staging | Sim | Coordenação normal da aplicação |
| TEST_REDIS_URL | Redis testes | Grupo Redis | Só runners staging | Sim | Testes reais Redis; não usa REDIS_URL |
| INSTANCE_ID | Multi-réplica | Opcional com ID automático | Não | Não | Identidade única |
| RAILWAY_REPLICA_ID | Railway | Injetada pelo provedor | Não | Não | Identidade da réplica |
| RAILWAY_DEPLOYMENT_ID | Railway/logs | Injetada pelo provedor | Mesmo deploy | Não | Correlação de deploy |
| RAILWAY_ENVIRONMENT_NAME | Railway | Injetada pelo provedor | Mesmo ambiente | Não | Se indicar produção, runner bloqueia |
| APP_ENV | Guarda externa | Opcional; não configura o jogo | Mesmo ambiente | Não | Se indicar produção, runner bloqueia |
| ENVIRONMENT | Guarda externa | Opcional; não configura o jogo | Mesmo ambiente | Não | Se indicar produção, runner bloqueia |
| HOSTNAME | Runtime | Fallback do sistema | Não | Não | Identidade fallback |
| LOCK_TTL_MS | Redis | Default disponível | Entre réplicas | Não | Validade do lock |
| LOCK_WAIT_MS | Redis | Default disponível | Entre réplicas | Não | Espera por lock |
| LOCK_RETRY_MS | Redis | Default disponível | Entre réplicas | Não | Intervalo de aquisição |
| RATE_LIMIT_WINDOW_MS | Redis/HTTP/Socket | Default disponível | Entre réplicas | Não | Janela de rate limit |
| RATE_LIMIT_HTTP_MAX | HTTP | Default disponível | Entre réplicas | Não | Limite agregado HTTP |
| RATE_LIMIT_SOCKET_MAX | Socket.IO | Default disponível | Entre réplicas | Não | Limite agregado Socket |
| METRICS_TOKEN | Telemetria | Preflight completo | Só coletor/backend | Sim | Acesso privado a métricas |
| DEPENDENCY_TIMEOUT_MS | Backend | Default disponível | Entre réplicas | Não | Prazo de dependências |
| READINESS_CACHE_MS | Readiness | Default disponível | Entre réplicas | Não | Cache/single-flight do probe |
| AUTH_TIMEOUT_MS | Firebase Auth | Default disponível | Entre réplicas | Não | Prazo de autenticação |
| SOCKET_AUTH_RECHECK_MS | Socket/Auth | Default disponível | Entre réplicas | Não | Revalidação de token |
| HTTP_SLOW_MS | Telemetria | Default disponível | Entre réplicas | Não | Alerta HTTP lento |
| SOCKET_SLOW_MS | Telemetria | Default disponível | Entre réplicas | Não | Alerta evento lento |
| EVENT_LOOP_WARN_MS | Telemetria | Default disponível | Entre réplicas | Não | Atraso do event loop |
| MATCH_PERSISTENCE_TIMEOUT_MS | Persistência | Default disponível | Entre réplicas | Não | Prazo para save de partida |
| SHUTDOWN_TIMEOUT_MS | Runtime | Default disponível | Entre réplicas | Não | Encerramento ordenado |
| IMPORT_OBJECT_TTL_DAYS | Storage/importação | Default disponível | Entre réplicas | Não | Expiração de uploads |
| IMPORT_MAX_SESSIONS_PER_UID | Firestore/importação | Default disponível | Entre réplicas | Não | Quota agregada de sessões |
| IMPORT_MAX_RESERVED_BYTES_PER_UID | Firestore/importação | Default disponível | Entre réplicas | Não | Quota agregada de bytes |
| IMPORT_MAX_PROCESSES_PER_UID | Firestore/importação | Default disponível | Entre réplicas | Não | Processamentos concorrentes |
| BRASFOOT_IMPORT_ADMIN_KEY | Importação CLI | Só modo administrativo externo | Só operadores | Sim | Guarda da importação administrativa |
| BRASFOOT_IMPORT_PROVIDED_KEY | Importação CLI | Só modo administrativo externo | Só operador | Sim | Confirmação da importação administrativa |
| MEDIA_STORAGE_PROVIDER | Mídia | Configurar runtime | Entre réplicas | Não | Selecionar provedor |
| MEDIA_PROVIDER | Mídia | Alias legado; evitar | Entre réplicas | Não | Fallback de configuração |
| CLOUDINARY_URL | Cloudinary | URL ou trio | Só backend/harness | Sim | Credenciais do ambiente isolado |
| CLOUDINARY_CLOUD_NAME | Cloudinary | Se usar trio | Só staging | Não | Identificador do ambiente |
| CLOUDINARY_API_KEY | Cloudinary | Se usar trio | Só backend/harness | Sim | Chave API |
| CLOUDINARY_API_SECRET | Cloudinary | Se usar trio | Só backend/harness | Sim | Assinatura/API/HMAC |
| GEMINI_API_KEY | Gemini | Grupo IA | Só backend/harness | Sim | Chave exclusiva com teto baixo |
| GEMINI_MODEL | Gemini | Grupo IA | Só staging | Não | Modelo habilitado no projeto |
| GEMINI_FALLBACK_MODELS | Gemini runtime | Opcional; runner não usa | Entre réplicas | Não | Alternativas runtime |
| AI_BUDGET_WINDOW_MS | Redis/IA | Default disponível | Entre réplicas | Não | Janela de uso agregado |
| AI_OPERATION_ATTEMPTS | Redis/IA | Default disponível | Entre réplicas | Não | Orçamento por operação |
| AI_UID_ATTEMPTS | Redis/IA | Default disponível | Entre réplicas | Não | Orçamento por usuário |
| AI_GLOBAL_ATTEMPTS | Redis/IA | Default disponível | Entre réplicas | Não | Orçamento global |
| AI_UID_CONCURRENCY | Redis/IA | Default disponível | Entre réplicas | Não | Concorrência por usuário |
| AI_GLOBAL_CONCURRENCY | Redis/IA | Default disponível | Entre réplicas | Não | Concorrência global |
| E2E_CHANNEL | Testes locais | Chrome solicitado | Só runners locais | Não | Canal de navegador |

Backup/restore não possui variáveis de automação no projeto: identificação da cópia, timestamps, destino, retenção e criptografia são evidências do checklist/runbook, não configurações fictícias. Credenciais administrativas de restore ficam fora do runtime/harness e exigem aprovação específica.

## F01

`mediaOwnership.test.mjs` permanece inalterado. Falha intermitente anterior de subprocesso continua sem causa determinada. Runners capturam exit code/signal/duração e tamanho de stderr sem expor conteúdo sensível. Não aumentar timeout do teste, remover assertions ou usar retries automáticos para mascarar a ocorrência.
