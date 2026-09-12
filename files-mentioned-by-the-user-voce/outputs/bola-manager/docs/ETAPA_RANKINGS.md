# Etapa 16 — Rankings

Status: COMPLETO no escopo de filtros, ordenação e períodos já suportados.

## Problema e causa

O backend calculava dados reais, mas recebia apenas clube/competição. Busca, filtros, período e ordenação eram aplicados no navegador; a tabela reordenava a página novamente. Estados de ordenação duplicados e snapshots antigos podiam divergir dos controles. Os últimos cinco jogos misturavam contextos de temporada/competição.

Na validação visual surgiram duas falhas adicionais: filtros de jogadores inacessíveis no desktop (details fechado com summary oculto) e sequências apenas de derrotas `D` interpretadas como empates.

## Correção

- Consulta compartilhada e validada com limites, enums e colunas permitidas. A API ecoa a seleção calculada.
- Backend aplica filtros combinados e ordenação estável antes da paginação local. Métricas ausentes ficam por último, inclusive em ordem crescente.
- Últimos cinco jogos do treinador restritos à temporada/competição selecionada, sem duplicatas; aceita janelas menores quando há menos partidas. Score anual e títulos não são apresentados como métricas dessa janela.
- Carreira/temporada histórica agregam passagens preservadas sem duplicar score acumulado e títulos da mesma temporada/competição. Clubes anteriores permanecem identificáveis.
- Estado único de ordenação na tela, categorias e atalhos atualizados atomicamente, página reiniciada ao trocar ordenação. Tabelas completas respeitam a ordem recebida.
- Snapshot vinculado a usuário, sala, clube, competição, revisão e consulta; requisições substituídas são abortadas. Respostas inválidas/incompatíveis são rejeitadas. Erro no save real não aciona dados de demonstração.
- Perfis, opções, histórico e comparação mantidos. Formato V/E/D da API convertido explicitamente; filtros de jogadores abertos por padrão.

## Arquivos desta etapa

- `shared/rankingQuery.mjs` e `.d.mts`: contrato da consulta.
- `server/services/rankingSelection.mjs`: seleção pura; `rankings.mjs`: integração.
- `server/routes/rooms.mjs`: validação e encaminhamento dos parâmetros.
- `src/hooks/useRankings.ts`, `src/utils/rankings.ts`: transporte, normalização e tipos.
- `src/views/season/RankingsView.tsx`, `src/components/rankings/RankingTable.tsx`: estado e renderização.
- `server/tests/rankingSelection.test.mjs`, `rankingsRoute.test.mjs`, `rankingsUi.test.mjs`: regressões.
- `server/tests/rankingsBrowserHarness.mjs` e `fixtures/rankingsBrowser*`: reprodução isolada, em memória, com autenticação fictícia.

## Verificação

- Baseline direcionada: 39 testes aprovados.
- Suíte final: 51 testes aprovados (`rankingSelection`, `rankingsRoute`, `rankingsUi`, `coachRankingCareer`, `rankingTimeline`).
- Typecheck: aprovado. Build: aprovado; permanece aviso de bundles maiores que 500 kB.
- Navegador: páginas 1/2 com 26 atletas sem reiniciar a ordenação; busca rápida com resposta atrasada; filtro preservado no reload; nacionalidade BRA + Sub-21 retornando somente dois jogadores; consulta enviada conferida no servidor; período de treinadores alterando campanha de 6 para 5 jogos; score indisponível como traço; falha HTTP e payload inválido sem fallback; recuperação do serviço; derrotas exibidas corretamente.
- Skill agent-browser consultada; CLI ausente, validação realizada pelo navegador integrado. Nenhum save real alterado.
- `git diff --check` dos arquivos tocados: aprovado. Sem commit, push ou deploy.

## Limites e riscos restantes

- Períodos curtos de jogadores e snapshots históricos completos de elencos/finanças continuam indisponíveis quando não preservados pelo motor. A interface informa essa ausência; não inventa estatísticas.
- A consulta ainda constrói o snapshot completo e pagina no cliente. Não houve benchmark com grandes bases nem execução da suíte global; otimização/caching permanece trabalho separado.
- Teste visual em ambiente isolado, não em produção/Firebase/Railway. Alterações preexistentes do repositório foram preservadas.
- Próxima etapa do roteiro: Encoding.
