# Auditoria Técnica — Bola Manager

**Data:** 2026-11-08 · **Escopo:** `C:\Users\Emanuel\Documents\Codex\2026-07-09` (repositório Git na raiz) · **Versão analisada:** `bola-manager@0.1.7`, commit `10481a8` + **112 arquivos modificados ou não versionados** no working tree.

> Nenhum arquivo do projeto foi alterado durante a auditoria. Os únicos efeitos colaterais vieram das verificações executadas: `tsc -b` regravou `*.tsbuildinfo`, e a suíte de testes escreveu em `.tmp/`. Os dois caminhos estão no `.gitignore`.
> Nenhum valor de segredo aparece neste relatório. Os arquivos `.env*` foram inspecionados apenas para conferir nomes de chaves, tamanho dos valores e se estão versionados.

**Legenda de evidência:** ✅ **Confirmado** (verificado em código, comando ou execução) · 🔎 **Suspeita** (indício concreto que ainda precisa de medição ou investigação).

---

## 1. Resumo executivo

O repositório contém **um único produto real**: o **Bola Manager**, um jogo de gestão de futebol (carreira de treinador/clube, mercado, partidas simuladas em tempo real, rankings, editor de base de dados, importação de bases Brasfoot e feed social com IA Gemini). O jogo tem três formas de execução:

1. **Web multiplayer:** frontend React/Vite (deploy na Vercel), backend Node/Express + Socket.IO (Railway, 2 réplicas), Firebase Auth/Firestore/Storage, Redis para coordenação e Cloudinary para mídia.
2. **Desktop (Electron 44):** o mesmo backend roda num `utilityProcess` local, com o save em arquivo binário próprio e **multiplayer P2P via WebRTC**.
3. **Ferramentas CLI:** importação Brasfoot, seed de catálogo e preflight de segurança para staging.

**Visão geral:** o projeto é **muito mais maduro do que a organização das pastas sugere**. A engenharia de segurança e de confiabilidade está acima da média: regras Firestore/Storage em deny-all, Electron bem isolado, locks distribuídos, rate limit, readiness/metrics, gravação atômica, e o typecheck passa sem erros. Os problemas principais são **estruturais e de processo**:

| # | Achado principal | Severidade |
|---|---|---|
| 1 | **112 arquivos (≈3.900 linhas alteradas + todo o módulo `desktop/`) não estão commitados.** Uma pane de disco ou um `git checkout`/`clean` acidental perde a versão desktop inteira. | **Crítica** (risco de perda de dados) |
| 2 | **Backend com cerca de 100 mil linhas de JavaScript sem verificação de tipos**, com arquivos-deus (`coachEmployment.mjs` 7.748 linhas, `roomStore.mjs` 4.628, um método de 531 linhas). | Alta |
| 3 | **CSP sem `script-src`/`default-src`/`connect-src`**: o cabeçalho não oferece mitigação real contra XSS. | Alta (defesa em profundidade) |
| 4 | **Testes desktop (14 arquivos) fora do CI** e testes de UI que fazem *string matching* em código-fonte. | Alta |
| 5 | **Token Firebase do usuário trafega pelo pub/sub do Redis** no encaminhamento entre réplicas. | Média |
| 6 | **Dependências de runtime vulneráveis** (`proxy-addr` crítica, que afeta o rate limit por IP; `body-parser` alta; Electron 44.6 no app distribuído). Todas têm correção por patch, sem major. | Alta |
| 7 | Estrutura de diretórios acidental (`files-mentioned-by-the-user-voce/outputs/bola-manager`), arquivo lixo na raiz, cerca de 2,2 GB de artefatos locais. | Média |

Não foi encontrada nenhuma vulnerabilidade crítica explorável remotamente **no código próprio**. Nenhum segredo está versionado no Git (verificado no histórico completo). Typecheck limpo e **1.863 de 1.864 testes passando** (1 pulado por exigir Redis real).

---

## 2. Inventário e visão geral da arquitetura

### 2.1 Estrutura real do repositório

```
2026-07-09/                         ← raiz Git
├── .github/workflows/bola-manager-ci.yml
├── README.md                       ← 17 bytes, só o título "# 2026-07-09"
├── moke e2e"                       ← LIXO: saída de `git diff --stat` salva por engano (não versionado)
├── cr/  cria-um-jogo-similar-a-brasfoot/     ← pastas VAZIAS (outputs/ e work/ vazios)
└── files-mentioned-by-the-user-voce/
    ├── .git/ (diretório vazio)  .agents/ .codex/ .codex-tmp/ (vazios)  .tmp/ (78 MB)
    ├── work/*.log                  ← 4 logs vazios VERSIONADOS
    └── outputs/bola-manager/       ← O PROJETO
        ├── src/        React 18 + TS strict (≈ 120 arquivos)
        ├── server/     Node ESM: routes, sockets, store, game, services, infrastructure, domain
        ├── shared/     módulos .mjs + .d.mts usados no cliente e no servidor
        ├── desktop/    Electron main, preload, worker, peer P2P (NÃO VERSIONADO)
        ├── scripts/    CLIs (importação Brasfoot, build desktop, staging, encoding)
        ├── e2e/        Playwright (5 specs)
        ├── docs/       36 documentos ETAPA_*/DESKTOP_* etc.
        └── (gerados) node_modules 839 MB, release-desktop 1,2 GB, .tmp 602 MB, .npm-cache 282 MB, dist, dist-desktop
```

### 2.2 Stack

| Camada | Tecnologia |
|---|---|
| Frontend | React 18.3, TypeScript 5.7 (`strict`), Vite 6, Tailwind 4 (com `@config` legado v3), lucide-react, socket.io-client, Firebase Web SDK 11 |
| Backend | Node ≥ 20.9 (CI usa 22; a máquina local tem 24.15), Express 4, Socket.IO 4.8 + `@socket.io/redis-adapter`, `redis` 5, firebase-admin 13, zod 3, sharp |
| Desktop | Electron 44.6, electron-builder 26, WebRTC numa janela oculta, `safeStorage` para a chave Gemini |
| Dados | Firestore (salas fragmentadas em seções/páginas), Storage/Cloudinary, Redis (locks, rate limit, orçamento de IA, adapter) |
| IA | Gemini via REST (feed social, entrevistas de treinador) com orçamento e concorrência por UID |
| Qualidade | `node:test` (189 arquivos em `server/tests`), Playwright, `check-encoding`, `tsc -b`, GitHub Actions |

### 2.3 Arquitetura e comunicação

```
          Vercel (SPA)                     Railway (2 réplicas)
React ──HTTP /api/*──► Express ──► routes ──► RoomStore ──► roomPersistence ──► Firestore (transações)
  │                       │                     │
  └──Socket.IO (WS)──► sockets/* ──► game/* (regras puras)      Redis: locks · rate limit · AI budget · adapter
                          │
                          └─ cluster:match-command (serverSideEmitWithAck) → réplica dona da partida

Electron main ──IPC (validado por origem)──► utilityProcess(server-worker)
   │                                           └─ createBolaManagerServer(injeções locais) @127.0.0.1:porta aleatória
   └─ janela oculta peer-network (WebRTC) ◄──frames──► peer/runtime (host/guest)
```

- **Composição por injeção de dependências** em `createBolaManagerServer` (`server/index.mjs:61-87`): stores, firebase, IA, locks e políticas podem ser substituídos. É isso que permite ao desktop reutilizar 100% do backend, uma decisão muito boa.
- **Camada de domínio** (`server/game/*`) composta majoritariamente por funções puras sobre o objeto `room`, mutadas dentro de `RoomStore.#mutate` → `persistence.mutate`, que roda em **transação Firestore** (`server/store/roomPersistence.mjs:2133`). O resultado é concorrência otimista correta entre réplicas.
- **Partidas ao vivo** ficam em memória na réplica dona (`matchSessions`), com *ownership* por lock Redis, snapshot persistido em `activeMatches` e recuperação após restart.

---

## 3. Pontos positivos (MANTER)

| Área | Evidência | Por que manter |
|---|---|---|
| Regras Firebase deny-all | `firestore.rules` e `storage.rules`: todo acesso a salas, partidas, news e mídia passa pelo Admin SDK; o cliente só lê o catálogo autenticado e o próprio `users/{uid}`. | Elimina a classe inteira de vulnerabilidades de regras permissivas. |
| Electron endurecido | `desktop/main.mjs:98-136,241-250`: `contextIsolation`, `sandbox`, `nodeIntegration:false`, permissões negadas, `setWindowOpenHandler` deny, `will-navigate` restrito, `onBeforeRequest` bloqueando qualquer origem externa, IPC validando `senderFrame` e origem; o worker recebe um env **sem segredos** (`:69-71`). | Postura melhor do que a da maioria dos apps Electron. |
| Backend local autenticado | `desktop/localBackend.mjs:43-89`: token de capacidade de 256 bits, `timingSafeEqual`, verificação de `Host` e `Origin`, bind em `127.0.0.1`. | Impede outro site no navegador de acessar o backend local (DNS rebinding/CSRF). |
| Proxy de imagens anti-SSRF | `shared/imagePolicy.mjs:23-39` + `server/routes/images.mjs`: allowlist de hosts com regex de path, `redirect:"error"`, limite de 5 MB por streaming, MIME restrito, reprocessamento com `sharp`, cache com limite de bytes e de entradas, concorrência ≤ 4. | Implementação de referência. |
| Gravação atômica e locks | `desktop/localDatabase.mjs` (temp + `fsync` + `rename`, checksum SHA-256, lock de PID, backup antes de importar); `desktop/aiSettings.mjs` (chave Gemini cifrada com `safeStorage`, recusando `basic_text` no Linux). | Protege contra corrupção de save. |
| Coordenação distribuída | `server/infrastructure/distributedLock.mjs`, `distributedRateLimit.mjs`, `aiUsage.mjs` (scripts Lua atômicos), `coordinationAvailability.mjs` (*fail-closed* quando o Redis cai em produção). | Correto para múltiplas réplicas. |
| Observabilidade | Logs estruturados com redaction (`infrastructure/redaction.mjs`), `X-Request-Id`, métricas por rota normalizada, lag do event loop (`index.mjs:224-236`), `/ready` com cache, *graceful shutdown* com timeout. | Base pronta para produção. |
| Configuração defensiva | `server/config.mjs:38-40` recusa `ALLOW_DEMO_AUTH` em produção; `allowLocalEditor` só vale em dev/test; `METRICS_TOKEN` validado. | Evita erro de configuração perigoso. |
| Supply chain no CI | Actions fixadas por SHA, `permissions: contents: read`, `concurrency`, `npm ci`. `overrides` para dependências transitivas vulneráveis. | Boa prática. |
| Frontend tipado | `tsconfig.app.json` `strict`; **0 ocorrências de `any`** e 1 supressão (`@ts-…`/`eslint-disable`) em `src/`; nenhum `dangerouslySetInnerHTML`/`innerHTML`/`eval` no app. | Qualidade alta no cliente. |
| Validação de entrada | zod nas rotas e sockets (`server/schemas.mjs`, `editorSchemas.mjs`), limite de JSON de 256 kb, parsers `raw` com limite por rota, parser Brasfoot com `maxDepth`/`maxHandles`/`maxArrayLength`. | Superfície de entrada bem controlada. |
| Segredos fora do Git | `.gitignore` cobre `.env.*`, service accounts, `*.pem`/`*.p12`; varredura do **histórico completo** (`git log -S`) não encontrou os valores das chaves Gemini/Cloudinary; o bundle `dist` contém apenas a API key **pública** do Firebase Web (o comportamento esperado). | ✅ Confirmado. |

---

## 4. Problemas identificados

### 4.1 Processo e repositório

**P-01 — Trabalho não versionado (CRÍTICA, ✅)**
`git status` mostra **63 arquivos modificados (+3.860/−726 linhas)** e **dezenas de itens não rastreados**, incluindo **todo o diretório `desktop/`** (main, preload, peer P2P, local DB, 14 testes), `shared/teamCohesion.mjs`, `src/audio/`, `src/components/menu/`, `scripts/build-desktop.mjs`, `scripts/package-desktop.mjs` e 13 documentos.
*Impacto:* o produto desktop (versões 0.1.6/0.1.7 já empacotadas em `release-desktop/`) **existe só no disco local**. Não há backup, revisão nem possibilidade de reproduzir o build.
*Correção:* commitar em commits temáticos numa branch (`feat/desktop`) e fazer push. Esse passo precede qualquer refatoração.

**P-02 — Estrutura de diretórios acidental (MÉDIA, ✅)**
O projeto vive em `files-mentioned-by-the-user-voce/outputs/bola-manager`, nome herdado de uma ferramenta de geração. O CI precisa repetir esse caminho 5 vezes (`bola-manager-ci.yml:20,30,45,57-58`). Na raiz, o `README.md` tem 17 bytes, há pastas vazias (`cr/`, `cria-um-jogo-similar-a-brasfoot/`, `.agents`, `.codex`, `.codex-tmp`, um `.git` vazio aninhado) e logs vazios versionados (`files-mentioned-by-the-user-voce/work/*.log`).
*Correção:* com `git mv`, mover `bola-manager/` para a raiz do repositório (ou para `apps/bola-manager`), atualizar o CI e remover o resto.

**P-03 — Arquivo lixo `moke e2e"` na raiz (BAIXA, ✅)**
Contém a saída colorida de um `git diff --stat`, criada por um comando de shell com aspas quebradas. Remover.

**P-04 — `NVIDIA Corporation/umdlogs/` dentro do projeto (BAIXA, ✅)**
Diretório criado pelo driver de vídeo porque o Electron foi iniciado com cwd no projeto. Remover e adicionar ao `.gitignore`.

**P-05 — Ausência de `.gitattributes` (BAIXA, ✅)**
O `git diff` emite dezenas de avisos *"LF will be replaced by CRLF"*. O `.editorconfig` existe, mas o Git normaliza de forma diferente. *Correção:* `* text=auto eol=lf` + binários marcados.

**P-06 — Proliferação de documentação de etapa (BAIXA, ✅)**
36 arquivos em `docs/` (`ETAPA_*.md`, `PHASE4_SECURITY_VALIDATION.md` com 2.434 linhas) registram o histórico de execução em vez de descrever o sistema atual. *Correção:* consolidar em `docs/architecture.md`, `docs/operations.md`, `docs/security.md` e `docs/desktop.md`, e mover os registros de etapa para `docs/history/` ou para o CHANGELOG.

### 4.2 Qualidade de código e arquitetura

**Q-01 — Backend sem verificação de tipos (ALTA, ✅)**
`tsconfig.app.json` inclui só `src/` com `allowJs:false`. Todo o `server/`, `desktop/`, `shared/` e `scripts/` (≈ 100 mil linhas `.mjs`) não passa por nenhuma checagem estática. Só existem `.d.mts` manuais para alguns módulos `shared/`, e eles podem divergir da implementação.
*Impacto:* erros de propriedade ou formato no objeto `room` (modelo enorme, ver `src/types.ts` com 3.055 linhas) só aparecem em runtime ou em teste.
*Correção incremental:* um `tsconfig.server.json` com `allowJs`, `checkJs`, `noEmit`, começando com `// @ts-check` por arquivo (infra → stores → game) e anotações JSDoc. Isso não exige migrar para `.ts`.

**Q-02 — Arquivos-deus e funções gigantes (ALTA, ✅)**

| Arquivo | Linhas | Observação |
|---|---|---|
| `server/game/coachEmployment.mjs` | 7.748 | ≈ 193 funções; mistura vagas, entrevistas, propostas, contratos e demissões |
| `server/store/roomStore.mjs` | 4.628 | 32 imports; 82 métodos; **`completeMatch` com 531 linhas (l. 3418)**, `manageProfessionalLifecycle` com 316 (l. 2356), `submitPressConference` com 162 (l. 3950) |
| `server/game/market.mjs` | 3.850 | ≈ 167 funções |
| `server/store/roomPersistence.mjs` | 3.061 | persistência, fragmentação, índices e migração no mesmo arquivo |
| `src/views/coach/CoachCareerView.tsx` | 2.422 | view única |
| `src/hooks/useCoachCareer.ts` | 1.855 | hook único |

*Impacto:* revisão difícil, conflitos de merge e alto custo cognitivo. O `RoomStore` viola SRP: é fachada, orquestrador de regras de 15+ subsistemas e cache ao mesmo tempo.
*Correção:* extrair **serviços de caso de uso** por subdomínio (`CoachCareerService`, `MatchCompletionService`, `MarketService`…) que recebem `mutate`/`mutatePaths` por injeção. O `RoomStore` passa a ser só a fachada. `completeMatch` deve virar um pipeline de etapas nomeadas (resultado → estatísticas → finanças → carreira → calendário → notícias), cada uma testável isoladamente.

**Q-03 — Código de produção importando `scripts/` (MÉDIA, ✅)**
`server/services/brasfootImportSessions.mjs:5-6` importa `../../scripts/lib/brasfoot-binary.mjs` e `../../scripts/import-brasfoot.mjs` (este é um CLI de 727 linhas). Isso inverte a dependência: ferramenta → runtime.
*Correção:* mover o parser e o `normalizeDataset`/`executeImportCommit` para `server/import/brasfoot/` e deixar os scripts como wrappers finos.

**Q-04 — Fonte de verdade duplicada para formações (MÉDIA, ✅)**
`server/game/tactics.mjs:7-13` (`FORMATION_ROLES`) e `src/constants/formations.ts` definem as mesmas formações separadamente. `src/utils/teamCohesion.ts:5-7` reconstrói o mapa a partir do frontend.
*Impacto:* adicionar ou alterar uma formação em um lado e não no outro gera coesão e força de escalação divergentes entre cliente e servidor.
*Correção:* mover as formações (id + papéis) para `shared/formations.mjs` com `.d.mts`, e deixar no `src/` só os metadados visuais (coordenadas e descrição).

**Q-05 — Middleware duplicado (BAIXA, ✅)**
`server/index.mjs:323-335` executa `assertCoordinationAvailable` **antes e depois** do rate limiter, e de novo em `:401-403` e `:432-434` para sockets. A segunda checagem HTTP é redundante. Basta uma antes do rate limiter. Se a intenção for revalidar após o `await` do rate limit, isso merece um comentário.

**Q-06 — `import` no fim do arquivo (BAIXA, ✅)**
`server/auth.mjs:146` importa `withTimeout` na última linha. Funciona por *hoisting* de ESM, mas confunde a leitura. Além disso, `withTimeout` mora em `readiness.mjs`, um acoplamento estranho. Mover para `infrastructure/timeout.mjs`.

**Q-07 — Sem lint/formatador (MÉDIA, ✅)**
Não há ESLint nem Prettier/Biome em `package.json`, e o CI não roda lint. Um lint teria apontado Q-05/Q-06 e detectaria `no-unused-vars`, promises flutuantes (`no-floating-promises` com type-aware) e `react-hooks/exhaustive-deps`, este último relevante com hooks de 1.800 linhas.

**Q-08 — Configuração Tailwind v3 dentro do Tailwind 4 (BAIXA, ✅)**
`src/styles.css:2` usa `@config "../tailwind.config.js"`, um modo de compatibilidade. Migrar os tokens para `@theme` no CSS e remover o arquivo JS.

**Q-09 — Duplicata em `.env.local` (BAIXA, ✅)**
`ALLOW_LOCAL_EDITOR` aparece duas vezes (linhas 24 e 37) com valores diferentes. Vale o último, e a leitura fica ambígua.

### 4.3 Segurança e confiabilidade

| ID | Sev. | Status | Problema | Evidência | Correção |
|---|---|---|---|---|---|
| S-01 | **Alta** | ✅ | **CSP sem diretivas de script.** O CSP aplicado (HTTP, Vercel, meta tag e Vite) é apenas `img-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'`. Sem `default-src`/`script-src`/`connect-src`, qualquer XSS executaria script e exfiltraria o ID token do Firebase. | `shared/imagePolicy.mjs:1-2`, `vercel.json:7`, `index.html:5` | Adicionar `default-src 'self'; script-src 'self' 'sha256-<hash do script inline de tema>'; connect-src 'self' https://*.googleapis.com https://*.firebaseio.com wss://<backend> https://<backend>; style-src 'self' 'unsafe-inline'; font-src 'self'; frame-src https://<auth-domain>`. Testar primeiro em `Content-Security-Policy-Report-Only`. Para o Electron, um CSP próprio com `connect-src 'self' ws://127.0.0.1:*`. |
| S-02 | Média | ✅ | **ID token do usuário trafega pelo Redis.** `socket.data.authCredentials()` envia `{ token }` em `serverSideEmitWithAck("cluster:match-command")`, que passa pelo pub/sub do Redis para **todas** as réplicas. | `server/sockets/index.mjs:105-109`, `authSession.mjs:125-130` | Encaminhar só `{ uid, authType, expiresAt }` com assinatura HMAC (segredo compartilhado entre réplicas) e TTL curto, ou exigir `rediss://` (TLS) e ACL no Redis. A réplica destino confia na identidade assinada em vez de reverificar o token. |
| S-03 | Média | ✅ | **Dev server exposto na rede.** `vite.config.ts:31` `host: true` publica o Vite em todas as interfaces, junto com o proxy `/api` e o `server.fs` do projeto. | `vite.config.ts:31` | `host: '127.0.0.1'` por padrão; expor na LAN só via flag (`vite --host`). |
| S-04 | Média | ✅ | **Segredos de staging em texto plano local.** `.env.staging` contém 2 service accounts Firebase completas (≈ 2,4 KB cada) e `METRICS_TOKEN`. Não estão versionados, mas qualquer processo do usuário, backup em nuvem ou indexador consegue lê-los. | `.env.staging:13-14` (nomes) | Usar `GOOGLE_APPLICATION_CREDENTIALS` apontando para um arquivo fora da árvore do projeto, ou o cofre do Railway. Rotacionar as chaves se o diretório já foi sincronizado (OneDrive etc.). |
| S-05 | Baixa | ✅ | **Endpoint `/api/media/image` sem autenticação.** É anônimo por design (proxy de imagens), mas consome CPU (`sharp`) e banda. Está limitado só pelo rate limit global por IP e por `active >= 4` por réplica. | `server/index.mjs:337`, `routes/images.mjs:21` | Aceitável. Opcionalmente exigir auth ou servir o cache via CDN. |
| S-06 | Baixa | 🔎 | **Proteções condicionadas só a `NODE_ENV === "production"`** (WebSocket-only, Redis obrigatório, HSTS, AI usage obrigatório). O `.env.staging` local usa `NODE_ENV=test` (intencional para o preflight destrutivo), mas não foi possível verificar o `NODE_ENV` do serviço **deployado** de staging. | `server/config.mjs:59`, `index.mjs:164,239` | Confirmar no Railway que o staging roda com `NODE_ENV=production`, para que o staging reproduza a produção. |
| S-07 | Baixa | 🔎 | **Guarda de exclusão de sala é local à réplica.** `deletingRooms`/`deletedRooms` são `Set` em memória. Em 2 réplicas, um `room:delete` concorrente noutra réplica não é bloqueado por ela (a transação Firestore ainda deve impedir corrupção). | `server/sockets/index.mjs:13-14`, `roomHandlers.mjs:126-136` | Usar o lock distribuído já existente (`distributedLocks`) com a chave `room-delete:<code>`. |
| S-08 | Baixa | ✅ | **Crescimento ilimitado de `deletedRooms`.** Recebe `add` a cada exclusão e só é limpo no shutdown. | `roomHandlers.mjs:136`, `sockets/index.mjs:139` | Usar um TTL (Map com timestamp) ou limitar o tamanho. O vazamento é pequeno (strings curtas), mas monotônico. |
| S-09 | Baixa | 🔎 | **Save desktop serializado com `node:v8`.** O formato `serialize()` depende da versão do V8. Upgrades de Electron costumam conseguir ler versões antigas, mas não há garantia documentada nem teste de compatibilidade entre versões. | `desktop/localDatabase.mjs:4,11,25` | Adicionar um teste de fixture (save gerado pela versão anterior, lido pela atual) ou migrar para JSON/CBOR comprimido com schema versionado. |
| S-10 | Baixa | 🔎 | **`rename` sobre arquivo existente no Windows** pode falhar com `EPERM`/`EBUSY` se antivírus ou indexador estiver com o save aberto. Não há retry. | `desktop/localDatabase.mjs:77` | Fazer retry com backoff curto (3–5 tentativas) em `EPERM`/`EBUSY`/`EACCES`. |
| S-11 | **Alta** | ✅ | **Dependências vulneráveis em runtime**: `proxy-addr` (crítica: IP spoofing que afeta o rate limit por `request.ip`), `body-parser` (DoS), `qs` fixado numa versão vulnerável pelo próprio `overrides`, e Electron 44.6 no app distribuído. | `npm audit`; `package.json` `overrides.express.qs` | Ver a seção 7. |

Não foram encontrados: execução de comandos (`child_process` só em scripts de build/teste), `eval` dinâmico (os `client.eval` são scripts Lua constantes do Redis), XSS por `innerHTML`, segredos no bundle nem regras Firebase permissivas.

### 4.4 Desempenho

Prioridade conforme o grau de evidência. Nenhuma métrica de produção foi fornecida, então os itens 🔎 devem ser confirmados com a métrica `event_loop_lag_ms`, que o projeto já coleta.

| ID | Status | Problema | Evidência | Correção |
|---|---|---|---|---|
| D-01 | ✅ | **Clonagem integral do estado a cada leitura no desktop.** `read()` faz `structuredClone(state)` do save inteiro (até 128 MiB) mesmo para ler só `state.profile`. `transaction()` clona de novo e reserializa tudo. | `desktop/localDatabase.mjs:106-108` | `read(selector)` deve aplicar o seletor sobre o estado congelado e clonar só o resultado: `structuredClone(operation(state))`. |
| D-02 | 🔎 | **Parsing Brasfoot síncrono na thread principal.** A função é `async`, mas a desserialização Java por arquivo é CPU-bound, com até 200 arquivos × 32 MB por sessão. Numa réplica compartilhada, isso bloqueia sockets de partidas ao vivo. | `scripts/lib/brasfoot-binary.mjs:443+`, `brasfootImportSessions.mjs:702,1044` | Executar `parseSource` num `worker_threads` com limite de memória (`resourceLimits`). O desktop já isola o backend num `utilityProcess`. |
| D-03 | ✅ | **Volume de logs.** Cada request HTTP e cada evento de socket gera 2 linhas `info` (start/end) mais um `debug` por emissão (`onAnyOutgoing`). Com partidas emitindo eventos a cada 800 ms, isso custa CPU e dinheiro em log ingestion. | `index.mjs:260`, `sockets/helpers.mjs:37`, `sockets/index.mjs:80` | Rebaixar `*_start` para `debug` e manter só `*_end` em `info`, com amostragem para rotas de alta frequência. |
| D-04 | ✅ | **`RoomStore.#snapshot` faz `structuredClone` da sala completa** após cada `#mutate` (salas são grandes: careerState, histórico, calendário). O `#mutatePaths` já evita isso com projeção parcial, e a maioria das mutações ainda usa `#mutate`. | `roomStore.mjs:4568-4594,4622-4626` | Migrar mutações frequentes (lineup, readiness, chat, market) para `#mutatePaths`, e medir antes e depois. |
| D-05 | ✅ | **Cache do proxy de imagens varre o Map inteiro a cada request** para expirar entradas. São ≤ 128 entradas, então o impacto é desprezível hoje. | `routes/images.mjs:18` | Não é prioritário. Só fazer junto com outra mudança no arquivo. |
| D-07 | ✅ | **Bundle principal monolítico e Firebase carregado de forma eager.** No build desktop, `index-*.js` tem **1,0 MB** (sem code splitting por rota) e o chunk `firebase-*.js` (**502 KB**) é pré-carregado pelo `index.html`, mesmo no modo local, que não usa Firebase. A causa é o import estático em `src/auth/AuthContext.tsx:13` e `src/preferences/UserPreferencesContext.tsx:13`. | `ls dist-desktop/assets`, `grep firebase- dist-desktop/index.html` | Usar `React.lazy` nas views pesadas (CoachCareer, Rankings, Editor, Market) e `import()` dinâmico do `firebaseClient` só quando `hasFirebaseConfig` for verdadeiro. |
| D-06 | ✅ | **Artefatos locais de 2,2 GB** (`release-desktop` com duas versões portáteis = 1,2 GB, `.tmp` 602 MB, `.npm-cache` 282 MB, `files-mentioned-by-the-user-voce/.tmp` 78 MB, incluindo binários `agent-browser`). Isso degrada busca no IDE, indexação e backups. | `du -sh` | Limpeza manual (com autorização) e um script `npm run clean`. |

### 4.5 Código desnecessário ou redundante (REMOVER)

| Item | Justificativa |
|---|---|
| `moke e2e"` (raiz) | Saída de comando salva por engano. |
| `cr/`, `cria-um-jogo-similar-a-brasfoot/`, `files-mentioned-by-the-user-voce/{.agents,.codex,.codex-tmp,.git}` | Diretórios vazios. |
| `files-mentioned-by-the-user-voce/work/*.log` (versionados, 0 bytes) | Logs não pertencem ao Git. |
| `bola-manager/NVIDIA Corporation/` | Lixo do driver de vídeo. |
| `release-desktop/Bola-Manager-0.1.6-portatil-x64` | Versão antiga do build; já ignorada pelo Git, ocupa ~600 MB. |
| Segundo `assertCoordinationAvailable` HTTP (`index.mjs:333-335`) | Redundante (Q-05). |
| `tailwind.config.js` (após migrar para `@theme`) | Compatibilidade v3 desnecessária. |
| Testes de UI baseados em leitura de código-fonte (17 arquivos usam `readFile` em `server/tests/*Ui*.test.mjs`) | Testam texto do código, não comportamento. Devem ser substituídos gradualmente por renderização (o padrão `renderToStaticMarkup` já usado em `uiClarityUi.test.mjs`). |

Não foi possível declarar nenhuma dependência npm como **comprovadamente** desnecessária: `cors`, `zod`, `lucide-react`, `socket.io-client`, `sharp` e `redis` têm uso confirmado. O `firebase` (cliente) entra no bundle desktop e é carregado de forma eager (D-07).

---

## 5. Melhorias e funcionalidades recomendadas (ADICIONAR)

| Recomendação | Justificativa técnica |
|---|---|
| **ESLint (flat config) + typescript-eslint + react-hooks**, rodando no CI | Detecta promises flutuantes e dependências de hooks. Hoje não existe nenhum lint (Q-07). |
| **`checkJs` incremental para `server/`, `shared/` e `desktop/`** | Reduz o maior risco de manutenção (Q-01) sem reescrever nada. |
| **Job `test:desktop` no CI** (Windows runner, ou xvfb no Linux) | 14 testes desktop existem e **nunca rodam no CI**. O workflow só executa `typecheck`, `build`, `test:server`, `test:frontend` e `test:e2e`. |
| **Teste de compatibilidade de save** (fixture binária da versão N−1) | Protege a carreira do jogador contra upgrades de Electron/V8 (S-09). |
| **`.gitattributes`** | Elimina o ruído de CRLF (P-05). |
| **CSP completo + report-only** | S-01. |
| **Rotação automática de saves desktop** (manter os últimos N) | Hoje só existe backup antes da importação de catálogo. Um bug de lógica que corrompa o estado é gravado por cima do único save. |
| **Dependabot/Renovate** para npm e GitHub Actions (SHA-pinned) | O projeto já fez 4 commits manuais de correção de dependências vulneráveis. Automatizar. |
| **README da raiz** descrevendo o repositório | Hoje tem 17 bytes. |
| **Script `clean`** (`dist*`, `release-desktop`, `.tmp`, `.npm-cache`) | D-06. |
| **Code signing do instalador Windows** (se for distribuído) | 🔎 Não verifiquei se o `electron-builder` assina. Sem assinatura, o SmartScreen bloqueia o instalador. |

**Não recomendo:** migrar para microsserviços, trocar o Express por outro framework ou adotar ORM/GraphQL. A arquitetura atual (monólito modular com DI) é adequada ao tamanho do projeto. O problema é a granularidade dos módulos, não o estilo arquitetural. A atualização para Express 5/React 19/Vite 7/zod 4 deve ser oportunista, não prioritária (ver a seção 7).

---

## 6. Testes e validação

### 6.1 Inventário

| Tipo | Quantidade | Executado no CI? |
|---|---|---|
| `server/tests/*.test.mjs` (node:test), incluindo fake Firestore | 189 arquivos (146 backend + 43 "frontend" selecionados por regex de nome) | ✅ |
| Frontend: SSR via Vite + `renderToStaticMarkup` | 43 arquivos (subconjunto acima) | ✅ |
| E2E Playwright | 5 specs (`career`, `club-theme`, `desktop-export`, `menu`, `security`) | ✅ (job `smoke`) |
| Desktop (Electron) | 14 arquivos em `desktop/tests` | ❌ **Fora do CI** e **não versionados** |

**Observações:**
- A seleção de testes de frontend por regex de nome de arquivo (`scripts/test-frontend.mjs:7`) é frágil: um teste chamado `fooUi.test.mjs` também roda em `test:server`, ou seja, roda duas vezes, e um teste com nome fora do padrão fica de fora do `test:frontend`. Mover para `tests/frontend/` e `tests/server/`.
- 17 arquivos `*Ui*.test.mjs` usam `readFile` do código-fonte para checar strings. São testes de implementação que quebram com refatorações inofensivas.
- Não há medição de cobertura. Sugestão: `node --test --experimental-test-coverage` (nativo, sem dependência nova).

### 6.2 Resultados das verificações executadas

| Verificação | Comando | Resultado |
|---|---|---|
| Encoding | `npm run check:encoding` | ✅ 604 arquivos, 0 problemas |
| Typecheck | `npm run typecheck` (`tsc -b`) | ✅ exit 0, sem erros (≈ 15 s) |
| Testes backend | `npm run test:server` | ✅ **1.581 testes: 1.580 passaram, 0 falharam, 1 pulado** (6 min 46 s) |
| Testes frontend | `npm run test:frontend` | ✅ **283 testes, 283 passaram** (3 min 59 s) |
| Auditoria de dependências | `npm audit` | ⚠️ 7 vulnerabilidades em produção (1 crítica, 3 altas, 3 moderadas); 20 no total com dev (ver a seção 7) |
| Build de produção | `npm run build` | ⏭️ Não executado: regrava `dist/`. Typecheck e testes cobrem a compilação. |
| E2E | `npm run test:e2e` | ⏭️ Não executado: sobe servidores locais e um navegador, e o CI já roda essa suíte. |
| Desktop | `npm run test:desktop` | ⏭️ Não executado: o `pretest:desktop` regrava `dist-desktop/` e abre o Electron. |
| Lint | — | ❌ Não existe lint configurado (Q-07). |

### 6.3 Resultados detalhados

- **Ambiente:** Windows 11, Node v24.15.0, npm 11.12.1 (o CI usa Node 22).
- **Backend:** 1.581 testes; 1.580 passaram, **0 falharam**. O único teste pulado é `Redis adapter entrega broadcast entre duas replicas` (`# SKIP`): ele exige um Redis real (`TEST_REDIS_URL`), indisponível localmente. Com isso, **o broadcast entre réplicas não foi validado nesta auditoria**.
- **Frontend:** 283 testes, todos passaram.
- A suíte é lenta (≈ 10,7 min somados), porque roda com `--test-concurrency=1` e sobe Vite SSR em vários arquivos. Paralelizar os arquivos puros de domínio (`server/game/*`) reduziria bastante o tempo de CI.
- Não houve falhas para investigar. Nenhum teste instável foi observado nesta execução única.

### 6.4 Funcionalidades críticas com cobertura insuficiente

- **Compatibilidade do save desktop** entre versões (S-09): nenhum teste.
- **P2P sob perda ou reordenação de frames:** existe `desktop/tests/p2p.test.mjs`, mas fora do CI.
- **Encaminhamento `cluster:match-command` entre réplicas reais:** os testes usam injeção. Recomendo um teste de integração com 2 instâncias e Redis real (o preflight de staging já tem infraestrutura para isso).
- **`completeMatch` (531 linhas):** verificar a cobertura por ramo quando houver medição.

---

## 7. Dependências

### 7.1 `npm audit --omit=dev` (runtime) — 7 vulnerabilidades ✅

| Pacote | Sev. | Relevância real neste projeto |
|---|---|---|
| `proxy-addr` (via express) | **Crítica** | **Relevante.** IP spoofing via IPv4-mapped IPv6 numa *trust subnet*. O servidor usa `app.set("trust proxy", config.trustProxy)` e a chave do **rate limit HTTP é `request.ip`** (`index.mjs:330`). Se o `TRUST_PROXY` estiver configurado com subnet, um atacante pode forjar o IP e contornar o rate limit. **Prioridade alta.** |
| `body-parser` (via express) | Alta | **Relevante.** DoS com bytes após um corpo comprimido. O `express.json()` é global (`index.mjs:314`). |
| `qs`, `express` | Moderada | O `qs` está fixado por `overrides` em 6.16.0, e a faixa vulnerável vai até 6.16.0. O override precisa subir. |
| `sharp` < 0.35.5 | Alta | **Mitigado:** CVE no librsvg (SVG), mas `catalogMedia.mjs:77` valida a assinatura de bytes antes do `sharp` e bloqueia SVG. Mesmo assim, atualizar para 0.35.5 (patch). |
| `zod` < 4.6.6 | Alta | Baixa: exaustão de memória com coleções grandes, e os corpos estão limitados a 256 KB. A correção exige zod 4 (breaking change). |
| `@fastify/busboy` (via firebase-admin) | Moderada | Baixa: o multipart não é usado nas rotas do app. |

### 7.2 Dev/build (13 adicionais)

| Pacote | Sev. | Observação |
|---|---|---|
| `electron` 44.6.0 | Alta | Mitigação de certificados intermediários comprometidos; corrigido em 44.9.1+. **Afeta o produto desktop distribuído.** Atualizar dentro da linha 44. |
| `shell-quote` via `concurrently` | Crítica | Só no script `dev`; injeção exige tokens controlados pelo atacante. Atualizar `concurrently` para 9.2.5. |
| `vite` ≤ 6.4.3 (`launch-editor`) | Alta | Só no dev server, e agravado por S-03 (`host: true`). Atualizar para 6.4.5. |
| `undici`, `source-map-js`, `fast-uri`, `minimatch`, `electron-builder`/`app-builder-lib` | Mod./Alta | Ferramentas de build. Atualizar em lote. |

### 7.3 `npm outdated` — correções dentro da faixa semver (baixo risco)
`express 4.22.3`, `sharp 0.35.5`, `vite 6.4.5`, `concurrently 9.2.5`, `tailwindcss`/`@tailwindcss/vite 4.3.5`, `redis 5.12.1`, `socket.io-client 4.8.4`, `@types/node 22.20.5`. Também é preciso atualizar os `overrides` (`qs`) e `electron` para ≥ 44.9.1.
**Saltos de major disponíveis** (não prioritários): React 19, Vite 8, Express 5, zod 4, Firebase 13, firebase-admin 14, redis 6, TypeScript 7, Electron 45, lucide 1.x.

**Recomendação:** um PR "deps: patch de segurança" com as versões acima, rodando a suíte completa e o `test:desktop`. Não usar `npm audit fix --force`, porque ele aplicaria majors.

---

## 8. Tabela priorizada de problemas

| Prioridade | Arquivo/Módulo | Problema | Impacto | Solução |
|---|---|---|---|---|
| **Crítica** | `bola-manager/desktop/**`, `shared/teamCohesion.*`, `src/audio/**`, 63 arquivos modificados | Trabalho (incluindo o produto desktop inteiro) não commitado | Perda irreversível em caso de falha de disco ou comando Git destrutivo. Build não reprodutível. | Commits temáticos numa branch + push (P-01) |
| **Alta** | `package.json` / `package-lock.json` (express → `proxy-addr`, `body-parser`, `qs`; `electron` 44.6) | `npm audit`: 1 crítica + 3 altas em runtime; Electron distribuído vulnerável | IP spoofing contornando o rate limit (`request.ip`), DoS no `express.json`, certificados comprometidos no desktop | PR de patch: express 4.22.3+, subir o override `qs`, sharp 0.35.5, electron ≥ 44.9.1, vite 6.4.5, concurrently 9.2.5 (seção 7) |
| **Alta** | `shared/imagePolicy.mjs:1-2`, `vercel.json:7`, `index.html:5` | CSP sem `script-src`/`default-src`/`connect-src` | Um XSS futuro roubaria o ID token sem nenhuma barreira | CSP completo com hash do script inline; rollout em report-only (S-01) |
| **Alta** | `server/**`, `desktop/**`, `shared/**` | ≈ 100 mil linhas JS sem checagem de tipos | Bugs de formato do `room` só aparecem em runtime | `tsconfig.server.json` + `checkJs` incremental (Q-01) |
| **Alta** | `.github/workflows/bola-manager-ci.yml` | `test:desktop` fora do CI | Regressões no desktop/P2P passam despercebidas | Job Windows com `npm run test:desktop` |
| **Alta** | `server/store/roomStore.mjs`, `server/game/coachEmployment.mjs`, `market.mjs` | Arquivos-deus; `completeMatch` com 531 linhas | Manutenção cara, alto risco de regressão | Extrair serviços por subdomínio e pipeline de etapas (Q-02) |
| **Média** | `server/sockets/index.mjs:105-109` | ID token Firebase trafega no pub/sub do Redis | Quem lê o Redis captura tokens válidos (até 1 h) | Identidade assinada (HMAC) ou TLS + ACL no Redis (S-02) |
| **Média** | `vite.config.ts:31` | Dev server em `0.0.0.0` | Exposição do código e do proxy na rede local | `host: '127.0.0.1'` (S-03) |
| **Média** | `.env.staging` | Service accounts em texto plano na árvore do projeto | Vazamento via backup ou sync | Mover para fora do projeto e rotacionar se sincronizado (S-04) |
| **Média** | `server/services/brasfootImportSessions.mjs:5-6` | Runtime importa `scripts/` | Acoplamento invertido; o CLI vira API | Mover para `server/import/brasfoot/` (Q-03) |
| **Média** | `server/game/tactics.mjs:7`, `src/constants/formations.ts` | Formações duplicadas | Divergência de regras entre cliente e servidor | `shared/formations.mjs` (Q-04) |
| **Média** | `desktop/localDatabase.mjs:106` | `structuredClone` do save inteiro a cada leitura | CPU e memória proporcionais ao tamanho da carreira | Aplicar o seletor antes de clonar (D-01) |
| **Média** | `brasfootImportSessions.mjs:702,1044` | Parsing CPU-bound no event loop | 🔎 Travamento de partidas ao vivo durante importação | `worker_threads` (D-02) |
| **Média** | `src/auth/AuthContext.tsx:13`, `src/App.tsx` | Bundle de 1 MB sem code splitting; Firebase (502 KB) eager também no desktop | Tempo de inicialização maior | `React.lazy` por view e `import()` condicional do Firebase (D-07) |
| **Média** | `package.json` | Sem ESLint/formatador | Defeitos evitáveis chegam ao review | ESLint flat + typescript-eslint (Q-07) |
| **Média** | Estrutura de pastas | Projeto em `files-mentioned-by-the-user-voce/outputs/…` | Fricção no CI, onboarding e ferramentas | `git mv` para a raiz (P-02) |
| **Baixa** | `server/index.mjs:260`, `sockets/helpers.mjs:37` | Logs start/end em `info` | Custo de ingestão de logs, ruído | Rebaixar para `debug` (D-03) |
| **Baixa** | `server/sockets/roomHandlers.mjs:136` | `deletedRooms` cresce sem limite | Vazamento lento de memória | TTL/limite (S-08) |
| **Baixa** | `server/sockets/index.mjs:13-14` | Guarda de exclusão local à réplica | 🔎 Corrida entre réplicas | Lock distribuído (S-07) |
| **Baixa** | `desktop/localDatabase.mjs:4,77` | Save com `v8.serialize`; `rename` sem retry no Windows | 🔎 Save ilegível após upgrade; falha transitória de gravação | Teste de fixture e retry em EPERM/EBUSY (S-09, S-10) |
| **Baixa** | `server/index.mjs:333-335`, `server/auth.mjs:146` | Middleware duplicado; import no fim do arquivo | Legibilidade | Remover e mover (Q-05, Q-06) |
| **Baixa** | raiz | `moke e2e"`, pastas vazias, logs versionados, `NVIDIA Corporation/`, sem `.gitattributes` | Ruído | Limpeza (P-03…P-05) |
| **Baixa** | `src/styles.css:2`, `tailwind.config.js` | Config v3 em Tailwind 4 | Duas fontes de tokens | Migrar para `@theme` (Q-08) |

---

## 9. Plano de refatoração por etapas

As dependências entre etapas estão indicadas com "→". Cada etapa deve terminar com `typecheck` + `test:server` + `test:frontend` verdes.

### Etapa 0 — Proteger o trabalho existente (urgente; complexidade **baixa**, risco **baixo**)
1. Criar a branch `chore/consolidate-desktop` e commitar o working tree em commits temáticos (desktop, áudio, menu, coesão, docs). **Pré-requisito de tudo.**
2. Push para o remoto.

### Etapa 1 — Segurança e higiene (complexidade **baixa a média**, risco **baixo**) → depende da Etapa 0
0. Patch de dependências da seção 7 (express/proxy-addr/body-parser/qs, sharp, electron ≥ 44.9.1, vite, concurrently). Rodar todas as suítes e o `test:desktop`.
1. S-03: `host: '127.0.0.1'` no Vite.
2. S-01: CSP completo em `Content-Security-Policy-Report-Only` em staging; após validação, aplicar em `vercel.json`, `httpSecurity`, `index.html` e Electron.
3. S-04: mover as service accounts para fora do projeto e rotacionar se houve sync.
4. S-02: identidade assinada no `cluster:match-command` (exige um segredo compartilhado novo, `CLUSTER_SIGNING_KEY`).
5. P-03/P-04/P-05: remover lixo e adicionar `.gitattributes`.

### Etapa 2 — Rede de segurança de qualidade (complexidade **média**, risco **baixo**) → depende da Etapa 0
1. Job `test:desktop` no CI (runner `windows-latest`).
2. ESLint flat config (sem autofix em massa; primeiro só report, depois correções por pasta).
3. `tsconfig.server.json` com `checkJs` começando por `server/infrastructure/` e `shared/`.
4. Cobertura com `--experimental-test-coverage` (só relatório).
5. Teste de fixture de save desktop (S-09).

### Etapa 3 — Correções de confiabilidade e desempenho (complexidade **média**, risco **médio**) → depende da Etapa 2
1. D-01: leitura com seletor no `localDatabase`.
2. S-10: retry em `rename` no Windows.
3. S-07/S-08: lock distribuído e TTL para exclusão de salas.
4. D-03: níveis de log.
5. D-02: medir o lag do event loop durante uma importação Brasfoot real; se passar de 250 ms, mover o parser para worker.

### Etapa 4 — Refatoração estrutural (complexidade **alta**, risco **médio-alto**) → depende das Etapas 2 e 3
1. P-02: mover o projeto para a raiz (`git mv`) e ajustar CI e docs.
2. Q-04: `shared/formations.mjs`.
3. Q-03: `server/import/brasfoot/`.
4. Q-02: decompor `RoomStore.completeMatch` em pipeline; depois extrair `CoachCareerService` de `coachEmployment.mjs`/`roomStore.mjs`; depois o mercado. **Um subdomínio por PR**, com os testes existentes como rede de segurança.
5. Separar `server/tests` em `tests/server` e `tests/frontend`, e substituir gradualmente os testes de leitura de fonte.

### Etapa 5 — Evolução (oportunista)
- Migrar para Tailwind `@theme`, e depois Express 5 / React 19 / Vite 7 / zod 4, cada um num PR próprio, só quando houver benefício concreto ou aviso de segurança.
- Consolidar `docs/`.
- Rotação de saves desktop e code signing.

---

### Status de execução

| Etapa | Status | Onde |
|---|---|---|
| 0 | ✅ Concluída: trabalho local commitado em 6 commits temáticos | branch `codex/desktop-offline`, PR #3 |
| 1 | ✅ Concluída, com as pendências listadas abaixo | branch `chore/etapa1-security`, PR #4 |
| — | ✅ Limpeza de fixtures dos testes do Editor (trabalho do Codex) | branch `test/editor-fixture-cleanup`, PR #5 |
| 2 | ✅ Concluída, com os limites listados abaixo | branch `chore/etapa2-quality`, PR #6 |
| 3 | ✅ Concluída, com os limites listados abaixo | branch `chore/etapa3-reliability` |

**Etapa 1, o que foi feito:**
- **Dependências:** express 4.22.3 (proxy-addr 2.0.8, body-parser 1.20.9), override `qs` 6.17.1, sharp 0.35.5, electron 44.10.2, vite 6.4.5, concurrently 9.2.5 e transitivas. `npm audit` caiu de 20 para 7 achados. Restam `zod` (exige v4, breaking) e `minimatch` dentro do electron-builder (só no build).
- **S-01:** política CSP completa (`shared/contentSecurityPolicy.mjs`) publicada como `Content-Security-Policy-Report-Only` na Vercel e no `vite preview`. O CSP aplicado continua o mesmo. Um teste garante que o hash do script inline corresponde ao `index.html`.
- **S-03:** dev server do Vite em `127.0.0.1`. Para expor na LAN, usar `npm run dev:client -- --host`.
- **S-02:** com `CLUSTER_SIGNING_KEY` configurada, as réplicas trocam uma identidade assinada por HMAC (TTL de 15 s) em vez do token Firebase. Sem a chave, o comportamento antigo continua, com um aviso em produção.
- **P-03/P-04/P-05:** `.gitattributes`, logs vazios removidos, `moke e2e"` e `NVIDIA Corporation/` removidos e ignorados.

**Etapa 1, pendências que dependem de você:**
- **S-01:** abrir o staging, conferir o console do navegador por violações de CSP (login, partida, editor, upload de imagem) e só então promover a política para `Content-Security-Policy`.
- **S-02:** gerar uma chave (`node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`) e configurar `CLUSTER_SIGNING_KEY` igual em todas as réplicas do Railway. Durante o deploy com overlap, réplicas ainda no código antigo não reconhecem a asserção, o que pode causar falhas pontuais por até 30 s.
- **S-04:** mover as service accounts do `.env.staging` para fora do projeto e rotacioná-las se a pasta já foi sincronizada com algum serviço de nuvem. Não alterei esse arquivo.
- **P-02:** as pastas vazias `cr/`, `cria-um-jogo-similar-a-brasfoot/` e `.agents`/`.codex`/`.codex-tmp` foram mantidas, porque o Codex usa essa estrutura e estava ativo durante o trabalho.

**Etapa 2, o que foi feito:**
- **CI desktop:** novo job `Desktop (Windows)` em `windows-latest`, rodando `npm run test:desktop` (typecheck + build desktop + testes nativos com o Electron instalado). Ele entra no job `required`. `ciPipeline.test.mjs` passou a exigir esse job.
- **ESLint 9 (flat config, `eslint.config.mjs`) em modo relatório:** todas as regras ficam como `warn`, e o `npm run lint` roda no job `quality`. Primeira medição: **160 avisos, 0 erros**, sendo 107 `no-unused-vars`, 33 `react-hooks/exhaustive-deps`, 8 `@typescript-eslint/no-unused-vars`, 6 `no-control-regex`, 2 `no-unsafe-finally`, 1 `no-dupe-keys` (em fixture de teste) e 3 avulsos. Nenhum autofix foi aplicado.
- **checkJs:** `tsconfig.server.json` entra no `npm run typecheck`. Cobre `shared/*.mjs` e 7 dos 15 módulos de `server/infrastructure/`. Para passar, recebi só duas anotações JSDoc, sem mudança de lógica: `metricPolicy.mjs` e `calculateTeamCohesion`. Pendentes, com 24 erros (opções desestruturadas e `Error` com campos customizados): aiUsage, coordinationAvailability, distributedLock, distributedRateLimit, metricsEndpoint, publicErrors, readiness, redisRuntime.
- **Cobertura:** `npm run coverage:server` gera `.tmp/coverage/lcov.info`. O job `coverage` publica o arquivo como artefato e não entra no `required`. Primeira medição do backend: **92,8 % das linhas, 79,2 % dos ramos, 92,9 % das funções**. O `roomStore.mjs` tem 88,7 % das linhas e 68,5 % dos ramos.
- **S-09:** foi criado `desktop/tests/fixtures/saves/career-v1-electron-44.10.2.bolasave`, com conteúdo fictício e determinístico, junto com um `.json` de metadados. `saveCompatibility.test.mjs` abre o fixture **dentro do Electron instalado** (`ELECTRON_RUN_AS_NODE`), usando o `openLocalDatabase` real. Ele compara o hash canônico do estado (que preserva Date, `undefined`, NaN e −0) e confirma que abrir o save não regrava o arquivo. Antes de cada upgrade de Electron, rode `npm run fixture:save` com a versão antiga e versione o par gerado. Fixtures existentes nunca são sobrescritos.

**Etapa 2, limites e observações:**
- O `npm audit` passou de 7 para 13 linhas porque o `typescript-eslint` (só desenvolvimento) também depende do `minimatch` vulnerável. Continuam os **mesmos 2 alertas**: `minimatch` (ferramentas de build e lint) e `zod`.
- Na primeira execução no GitHub Actions, o job de Windows encontrou dois problemas que não aparecem localmente:
  - o PowerShell auxiliar de um teste levou mais de 3 s para abrir; ele ganhou um tempo próprio de inicialização, e o teste da limpeza ficou igual;
  - **um defeito real de layout:** a 320 px, com a fonte `system-ui` mais larga do Windows Server, o rótulo "Configurações" do menu lateral transbordava 2 px. Corrigido em `main-menu.css`; com Verdana forçada, o transbordamento era de 15 px antes da correção e zero depois.
- O fixture de save só prova a leitura pela versão atual. A proteção real vem quando o próximo upgrade de Electron rodar esse teste.

**Etapa 3, o que foi feito:**
- **D-01:** o `read()` do banco local não copia mais o save inteiro a cada leitura. O estado gravado fica congelado em profundidade, e só o resultado de cada leitura é copiado. Uma leitura que tente alterar o estado falha com `TypeError`, em vez de corromper o próximo save. Os bytes binários de mídia não são congelados, mas continuam sendo copiados na leitura.
  - Achado no caminho: o `v8.serialize` depende do layout interno dos objetos (objetos congelados e arrays copiados geram bytes diferentes). Por isso, o backup antes da importação agora reaproveita os bytes exatos do último save gravado. O formato em disco não mudou, e um teste compara byte a byte. Custo: os bytes do save gravado ficam em memória, ou seja, mais uma vez o tamanho do save.
- **S-10:** a troca do arquivo de save e de backup (`rename`) tenta de novo em `EPERM`, `EBUSY` e `EACCES`: até 5 tentativas, com espera de 20, 40, 60 e 80 ms. Outros erros falham na hora.
- **S-07:** não precisou de mudança. Com locks distribuídos, `room:delete` segura `match:<code>` com `waitTimeoutMs: 0`, então duas réplicas não excluem a mesma sala ao mesmo tempo, e o store exclui dentro de uma transação. Única ressalva: a segunda tentativa recebe a mensagem "partida em andamento".
- **S-08:** `deletedRooms` virou um `ExpiringSet`: entradas expiram em 1 h, com no máximo 10.000 entradas, e a mesma interface de `Set`.
- **D-03:**
  - `http.request_start` e `socket.event_start` passaram para `debug`;
  - `*_end` continua em `info`, com status e duração;
  - probes bem-sucedidos (`/health`, `/ready`, `/metrics`) agora são `debug`;
  - no nível padrão, cada requisição gera **1 linha**, e não 2.
- **D-02:** a medição foi feita com `scripts/measure-brasfoot-event-loop.mjs`, usando arquivos `.ban` **sintéticos** (time com um array de jogadores no formato Java real). Resultados na thread principal: 200 times de 30 jogadores bloquearam 10 ms; 10 mil jogadores, 37 ms; 100 mil jogadores (perto do limite de 32 MB), **802 a 889 ms**, acima dos 250 ms combinados. Por isso o servidor agora lê os arquivos num `worker_threads`, com limite de 1 GiB de memória e 120 s de tempo. Com o worker, o pior caso bloqueia **7 ms**. O resultado é idêntico ao do parser antigo, e um teste garante isso.

**Etapa 3, limites e observações:**
- **D-02:**
  - Não havia arquivos reais do Brasfoot nesta máquina. Repita a medição com uma instalação real: `node scripts/measure-brasfoot-event-loop.mjs C:\Brasfoot` (worker) ou com `--inline` (thread principal).
  - O mapeamento dos arquivos sintéticos produz poucos jogadores, então o custo de transferir de volta um dataset grande não foi medido.
  - **O desktop continua lendo na thread atual**, de propósito: o backend dele já roda isolado num `utilityProcess` e atende um só usuário. Além disso, o worker teria de carregar código de dentro do `app.asar`, o que não foi validado.
- **D-01:** se alguma leitura não coberta pelos testes alterar o estado, ela agora falha com `TypeError` em vez de corromper o save. Nas suítes desktop e de servidor, nenhuma leitura fez isso.

---

## 10. Recomendações para evolução futura

1. **Modelo de domínio tipado e versionado.** O objeto `room` é o coração do sistema e tem dezenas de subestados com `version` próprio (`coachEmploymentState.version`, `professionalLifecycleState.version`…). Centralizar os schemas zod (ou JSDoc types) em `shared/model/` e gerar `src/types.ts` a partir deles elimina a duplicação manual de 3.055 linhas de tipos do frontend.
2. **Event sourcing leve para a carreira.** Já existe `server/domain/careerEvents.mjs`. Se ele virar a fonte das notícias, rankings e histórico, o `completeMatch` deixa de precisar conhecer todos os subsistemas.
3. **Orçamento de tamanho de documento Firestore.** A fragmentação em seções e páginas (`roomPersistenceSections.mjs`, `roomPersistencePageIndex.mjs`) existe porque salas crescem. Vale adicionar uma métrica de bytes por seção e alertas antes do limite de 1 MiB.
4. **Paridade desktop × web.** Como o desktop reutiliza o servidor por injeção, qualquer nova dependência de infraestrutura no `createBolaManagerServer` precisa de uma versão local. Um teste de contrato ("o servidor sobe só com as injeções do desktop") evita quebras silenciosas.

---

## 11. Notas (0–10)

| Dimensão | Nota | Justificativa baseada em evidências |
|---|---|---|
| **Arquitetura** | **7,0** | DI bem feita em `createBolaManagerServer`, que permite reuso total no desktop; separação routes/sockets/store/game/infra; transações Firestore + locks Redis corretos para múltiplas réplicas; módulos `shared/` com tipos. Perde pontos pelos arquivos-deus (Q-02), pela dependência runtime → scripts (Q-03) e pela estrutura de pastas acidental (P-02). |
| **Qualidade de código** | **6,0** | Frontend `strict` com 0 `any`; validação zod; nomes claros. Por outro lado, ≈ 100 mil linhas de backend sem tipos, funções de 300–531 linhas, sem lint, duplicação de formações. |
| **Segurança** | **7,5** | Regras deny-all, Electron exemplar, anti-SSRF, `timingSafeEqual`, segredos fora do Git (histórico verificado), rate limit e orçamento de IA, recusa de demo auth em produção. Perde pelo CSP ineficaz contra scripts (S-01), pelo token no Redis (S-02), pelo Vite em `0.0.0.0` e pelas service accounts em texto plano locais. |
| **Desempenho** | **6,5** | Cache de readiness, projeção parcial (`#mutatePaths`), chunks manuais no Vite, cache do proxy limitado. Perde pelos clones integrais (D-01, D-04), pelo parsing CPU-bound no event loop (D-02, suspeita) e pelo volume de logs. Sem medições de produção disponíveis. |
| **Manutenção** | **5,0** | O ponto mais fraco: 112 arquivos sem commit, 36 docs de etapa, arquivos de 4–8 mil linhas, testes acoplados a texto de código-fonte, ruído de CRLF. A documentação abundante e os testes compensam parcialmente. |
| **Escalabilidade** | **7,0** | Redis adapter, locks com heartbeat de ownership, recuperação de partida após restart, rate limit distribuído, salas fragmentadas no Firestore, 2 réplicas no Railway. Perde pelo estado in-memory por réplica para exclusão (S-07) e pelo parsing pesado compartilhando o event loop. |
| **Testes** | **8,0** | 1.864 testes automatizados (1.863 passando, 0 falhas), E2E Playwright no CI, fake Firestore, testes de recuperação de partida e concorrência, typecheck limpo. Perde porque os 14 testes desktop estão fora do CI (e sem commit), o teste multi-réplica com Redis real não rodou, não há medição de cobertura, 17 testes checam texto de código-fonte, e a suíte é serial e lenta (≈ 11 min). |

**Média geral: 6,7/10.** É um projeto tecnicamente sólido, com engenharia de segurança e confiabilidade acima da média. O que limita a nota é a governança do código: o trabalho sem commit, o tamanho dos módulos e a falta de tipos no backend. As correções de maior retorno são baratas: commitar (Etapa 0), aplicar o patch de dependências, ajustar o CSP e incluir os testes desktop no CI.

