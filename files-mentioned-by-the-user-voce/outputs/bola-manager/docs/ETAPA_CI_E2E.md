# Etapa 19 — CI/E2E

## Status: PARCIAL

Implementação local concluída e validada. Publicação do workflow, execução no GitHub e ativação da verificação obrigatória ainda pendentes. Nenhum commit, push, deploy ou alteração de proteção da branch foi realizado.

## Problema original

Faltava um pipeline que reunisse typecheck, build, testes backend/frontend e smoke dos fluxos essenciais. Testes existentes não exercitavam a criação de carreira pelo transporte real do navegador.

## Causa raiz

- Ausência de workflow e harness E2E integrado.
- Algumas fixtures SSR ficaram incompatíveis com AuthContext e a política de imagens atual. A descoberta automática de dependências também falhava no Windows.
- `emitSocketRequest` extraía `socket.emit` e o chamava sem preservar `this`. O primeiro smoke encontrou o erro `_opts` na criação da sala, antes do ACK.

## Solução implementada

- Workflow `Bola Manager CI`, na raiz Git, executado em pull requests, pushes para `main` e manualmente.
- Job de qualidade: instalação pelo lockfile, typecheck, build, suíte Node completa e recorte frontend explícito.
- Job E2E: instalação do Chromium, build isolado, backend local real e navegador Playwright. Sem retries para ocultar falhas.
- Job agregador `Bola Manager required`: falha caso qualidade ou E2E não terminem com sucesso. Permissões somente de leitura; relatórios retidos por sete dias.
- Harness com catálogo de quatro clubes, elencos completos e persistência em memória. HTTP, Socket.IO, hooks, telas e regras do jogo continuam reais; não há interceptação para simular respostas dos serviços de domínio.
- Autenticação externa substituída apenas no build E2E; nenhuma credencial ou `.env` é carregada por esse build. Servidores de teste escutam somente em `127.0.0.1`.
- Emissão Socket.IO preserva o receptor. Falhas síncronas rejeitam com erro estruturado e limpam timer/listener.
- Fixtures atualizadas sem relaxar autorização, regras de simulação ou validação de imagens.

## Arquivos alterados

- Raiz Git: `.github/workflows/bola-manager-ci.yml`.
- Configuração: `package.json`, `package-lock.json`, `playwright.config.mjs`, `scripts/test-frontend.mjs`, `scripts/check-encoding.mjs` e `README.md`.
- E2E: `e2e/server.mjs`, `e2e/AuthProvider.tsx`, `e2e/career.spec.mjs`.
- Correção de produção: `src/lib/socketRequest.ts`.
- Novos testes: `server/tests/ciPipeline.test.mjs`, `server/tests/socketRequestClient.test.mjs` e `server/tests/helpers/withTestAuth.mjs`.
- Fixtures/harness: `testHarness`, `socketAuth`, `careerUi`, `marketUi`, `seasonRoundUi`, `roundResultsUi`, `teamThemeColors`, `clubCatalogSafety`, `editorClubRosterUi`, `lobbyLeagueSelector` e `pressConferenceUi`, em `server/tests`.

## Testes criados

1. Criação/carregamento da carreira; navegação em carreira, calendário, elenco e rankings; formação, mentalidade e pedido de estudo preservados após reload.
2. Observação, interesse e contato com empresário preservados; compra pelo mercado; jogador presente uma única vez no comprador, ausente do vendedor e movimentação única no histórico após reload.
3. Partida até o intervalo, reload durante a pausa, confirmação para o segundo tempo e resultados da rodada.
4. Regressões do Socket.IO real: ACK, receptor preservado, falha síncrona, timeout, desconexão e resposta inválida, incluindo limpeza de recursos.
5. Contratos do pipeline: todos os comandos presentes, gate exige os dois jobs e adaptador E2E isolado da entrada de produção.

Todos os smokes falham diante de exceção não tratada da página ou resposta HTTP 5xx em `/api/`.

## Testes executados

- `npm run test:server`: 1.246 aprovados, zero falhas e um ignorado (1.247 testes). Inclui integração e regressões frontend. O teste de broadcast entre duas réplicas é ignorado sem Redis real.
- `npm run test:frontend`: 190 testes aprovados em 33 arquivos, sem falhas. É um recorte da suíte completa, não uma contagem adicional de testes distintos.
- `E2E_CHANNEL=msedge npm run test:e2e`: três smokes aprovados. No PowerShell, definir antes `$env:E2E_CHANNEL = 'msedge'`.
- `git diff --check`: sem erros.
- Bundle normal verificado: não contém token, identidade nem adaptador de autenticação dos testes.

## Resultado do build

`npm run build`: aprovado. Permanece o aviso de chunks maiores que 500 kB; divisão arquitetural/bundle não faz parte desta etapa.

## Resultado do typecheck

`npm run typecheck`: aprovado, incluindo verificação de encoding das fontes.

## Riscos restantes e ativação

- Publicar as alterações e exigir `Bola Manager required` na proteção/ruleset da branch. O workflow não consegue obrigar merges sozinho.
- Validar a primeira execução Ubuntu/Chromium no GitHub. Localmente foi usado Edge: o download do Chromium excedeu o prazo neste ambiente.
- Estes smokes validam reload no navegador, não reinício de processos, persistência Firestore real, login Firebase real, múltiplos managers nem múltiplas réplicas Redis.
- Adapters em memória são deliberados e restritos ao teste. Não substituir validação de staging com serviços reais.
- Novos testes frontend fora dos padrões de nome utilizados devem ser incluídos no seletor de `scripts/test-frontend.mjs`; a suíte Node completa continua incluindo todos os arquivos `*.test.mjs`.
- Alterações de etapas anteriores foram preservadas. Nenhuma refatoração da etapa 20 foi iniciada.

Referência do harness e CI: [Playwright — CI](https://playwright.dev/docs/ci-intro).

## Correção posterior — CI sem `.env.local`

O primeiro resultado local não reproduzia integralmente o ambiente do CI: testes SSR ainda carregavam `.env.local`. Sem `VITE_SERVER_URL`, `src/lib/apiClient.ts` avaliava `window.location.origin` durante a importação em Node e lançava `ReferenceError`. Essa falha não depende de Firebase ou Redis.

- Fallback protegido com `typeof window`; conserva a URL configurada e a mesma origem no navegador. Importação SSR sem configuração não precisa de DOM.
- Vinte configurações SSR passaram a usar `envFile: false`; nenhum segredo foi adicionado e o `.env.local` não foi removido nem modificado.
- `apiEnvironmentClient.test.mjs` cobre Node sem DOM/configuração, URL explícita em Node, mesma origem no navegador e prioridade da URL explícita. Antes da correção: um erro reproduzido; depois: quatro testes aprovados, incluindo requisição JSON e download.
- A descoberta de dependências foi desativada no harness SSR do calendário após uma falha independente de acesso a diretórios no Windows. As sete verificações do calendário continuam aprovadas.
- Suíte completa reexecutada após os ajustes: 1.250 testes aprovados, zero falhas e um ignorado por exigir Redis real. O teste ignorado não é a causa do erro de importação.
- Typecheck e build Vite com `envFile: false` aprovados. A confirmação no GitHub depende de publicar esta correção e executar novamente o workflow; não foram adicionadas credenciais como contorno.
