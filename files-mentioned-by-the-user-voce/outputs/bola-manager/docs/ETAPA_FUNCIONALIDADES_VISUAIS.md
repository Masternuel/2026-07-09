# Etapa 18 — Funcionalidades visuais incompletas

Status: COMPLETO no escopo desta etapa. Serviços ausentes permanecem explicitamente indisponíveis, conforme a alternativa prevista no roteiro; não foram implementados artificialmente.

## Problemas e correções

- Seis tabelas resumidas de Rankings recebiam callbacks de ordenação sem efeito. `RankingTable` agora aceita cabeçalhos estáticos quando não há callback; tabelas completas conservam ordenação interativa e abertura de perfis.
- O Elenco desenhava o atalho de busca, mas não o executava. Ctrl+K e Cmd+K agora focam e selecionam a busca existente. O listener é removido ao sair da tela, respeita edição em outros campos e não retira o foco de diálogos.
- A sugestão do auxiliar na partida demonstrativa apenas mostrava uma mensagem. Agora abre Táticas. O fluxo online de ajustes e suas restrições de intervalo permanecem inalterados.
- `StarRating.tsx` não possuía consumidores nem era alcançável pela entrada da aplicação. Componente antigo removido.
- Dois testes de interface falhavam na inicialização pela descoberta de dependências do Vite fora do projeto. Seus harnesses SSR agora desativam essa descoberta e usam JSX automático, sem mudar a configuração de produção.

## Serviços explicitamente indisponíveis

- Busca global: botão desabilitado, título e nome acessível explicativos.
- Relatório do auxiliar no Elenco: botão desabilitado com aviso de ausência do serviço persistido.
- Inventário de sessões/dispositivos: indisponibilidade explicada em Configurações.

Esses controles já estavam desabilitados; foram verificados e protegidos por regressões. Perfil, tema e notificações já persistidos não foram substituídos. Callbacks opcionais, confirmações de transporte e tratamento de cancelamento não foram removidos indiscriminadamente.

## Arquivos

- `src/components/rankings/RankingTable.tsx`, `src/views/season/RankingsView.tsx`: cabeçalhos estáticos versus interativos.
- `src/utils/searchShortcut.ts`, `src/views/SquadView.tsx`: atalho de busca e acessibilidade.
- `src/views/MatchView.tsx`: navegação da sugestão do auxiliar.
- `src/components/shared/StarRating.tsx`: remoção de componente sem uso.
- `server/tests/uiActions.test.mjs`: cinco regressões de ações, foco, ordenação e indisponibilidade explícita.
- `server/tests/halftimeUi.test.mjs`, `server/tests/renderSafetyUi.test.mjs`: inicialização SSR isolada.
- `server/tests/uiActionsBrowserHarness.mjs`, `server/tests/fixtures/uiActionsBrowser.html`, `server/tests/fixtures/uiActionsBrowser.tsx`: cenário isolado de navegador reutilizando os componentes reais, sem gravação em saves ou acesso à API. Artefatos em `.tmp`, já ignorado.

## Validação

- 53 testes aprovados, zero falhas: `uiActions`, `rankingsUi`, `playerAttributesUi`, `settingsPreferences`, `renderSafetyUi` e `halftimeUi`.
- Typecheck e build aprovados. Permanece o aviso preexistente de bundles maiores que 500 kB.
- Navegador integrado: Ctrl+K e Cmd+K filtram o Elenco; outros campos e diálogos genéricos e de perfil mantêm o foco; sair da tela remove o atalho; tabelas completas ordenam e abrem registros; resumos não oferecem cliques falsos; sugestão demonstrativa navega para Táticas.
- O CLI agent-browser não estava instalado; a inspeção interativa foi feita pelo navegador integrado, com fixtures isoladas e componentes reais. Não foi um teste de carreira autenticada em produção.
- `git diff --check` aprovado. Alterações de etapas anteriores preservadas; sem commit, push ou deploy.

## Riscos e próxima etapa

- Os três serviços explicitamente indisponíveis ainda exigem implementação própria para serem habilitados.
- A validação foi direcionada; a suíte global e o backend de produção não foram executados nesta etapa.
- O harness de navegador é uma ferramenta local, não uma suíte E2E automática nem integração de CI.
- Próxima etapa: 19 — CI/E2E, conforme o roteiro da auditoria.
