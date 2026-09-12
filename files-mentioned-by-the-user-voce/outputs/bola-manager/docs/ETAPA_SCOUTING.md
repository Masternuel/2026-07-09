# Etapa — scouting persistente

Status: **COMPLETE** (observar, interesse, contato e recarga). Data: 2026-09-09.

## Problema e causa

O perfil compartilhado oferecia apenas botões desabilitados para observação, interesse e contato. Não existiam endpoints, estado persistido nem consulta desses dados ao reabrir o jogador.

## Implementação

- Perfil único usado por Competições, Rankings, Elenco, Táticas e Mercado conectado ao mesmo serviço de scouting.
- API autenticada `GET/POST /api/scouting/:code`. O servidor obtém o treinador da sessão; não aceita `managerId` enviado pelo cliente.
- Estado privado do clube em `scoutingState`, persistido pelo armazenamento existente do save. Saves anteriores iniciam vazios, sem migração destrutiva.
- Observar/remover e demonstrar/retirar interesse são gravados junto com o recibo da operação e a revisão do save, em uma operação CAS/transacional.
- `operationId` estável durante retries; requisições simultâneas e resposta perdida não duplicam a ação. Repetir um comando antigo retorna o estado atual, sem desfazer decisões posteriores.
- Contato com representação **simulada**, identificado na tela: resposta usa disponibilidade, clube atual, salário, valor e vencimento de contrato conhecidos. Não chama Gemini, não envia mensagens externas e não conclui transferências.
- Consulta repetida reutiliza a resposta por três dias do calendário da carreira; mudança de clube do jogador permite nova avaliação. Datas são exibidas em UTC para evitar deslocamento de um dia.
- Dados inexistentes permanecem indisponíveis; falhas de catálogo/API não viram sucesso nem lista vazia.
- Permissões verificadas novamente dentro da escrita: participação na sala, clube atual do treinador, carreira ativa e jogador pertencente ao universo do save. Novas ações em jogador próprio são bloqueadas; remoções já registradas continuam possíveis quando o jogador sai do save.
- Observações pertencem ao clube: outro clube não recebe os dados; troca de emprego muda o escopo consultado. Estado e histórico privados ficam fora das projeções e broadcasts gerais da sala.
- Interface mostra carregamento, confirmação, erro e atualização. Não usa localStorage nem confirmação otimista. Respostas atrasadas não substituem outro jogador/clube ou uma revisão mais nova; reabrir, recarregar e retornar à janela consultam a fonte persistente.

## Arquivos desta etapa

- Novos: `server/game/scouting.mjs`, `server/routes/scouting.mjs`, `src/services/scoutingService.ts`, `src/hooks/useScouting.ts`.
- Integração: `server/index.mjs`, `server/store/roomStore.mjs`, `server/services/roomVisibility.mjs`, `src/components/player/PlayerProfileHost.tsx`, `src/components/rankings/RankingEntityProfiles.tsx`.
- Testes: `server/tests/scouting.test.mjs`, `server/tests/scoutingUi.test.mjs`; expectativas atualizadas em `roomStore.test.mjs` e `competitionClubNavigation.test.mjs`.
- Smoke visual reutilizável: `server/tests/scoutingBrowserHarness.mjs` e `server/tests/fixtures/scoutingBrowser.{html,tsx}`. Autenticação falsa e save em memória, exclusivamente para teste; não integra o bundle normal do jogo.

Os arquivos compartilhados já continham alterações de etapas anteriores, preservadas. O diff total desses arquivos não representa somente scouting.

## Validação

- **72/72 testes passaram**, cobrindo scouting, RoomStore, privacidade, consistência/transporte de mercado, navegação de clubes e UI de Rankings.
- 13 testes específicos de scouting: persistência em memória e Firestore simulado, reabertura do armazenamento, mudança de temporada no estado, concorrência, rollback, resposta perdida, permissões, troca de clube, remoção após saída do save, contrato, cooldown, payload/API autenticada, erro de catálogo, parser e transporte do frontend.
- `npm run build`: **passou**, incluindo `tsc -b` e build Vite. Permanece o aviso existente sobre chunks acima de 500 kB.
- `git diff --check` nos arquivos rastreados desta etapa: passou.
- Navegador integrado, perfil real com dados de teste: observar, demonstrar interesse, contato, reload, remoção das marcações e reabertura confirmados. Layout inspecionado; data corrigida confirmada em novo build (10/07 e 13/07).
- Agent-browser não estava instalado. O modo dev do harness encontrou restrição de leitura no esbuild mesmo após permissão; o smoke usa build/preview local, sem alterar a configuração de produção nem instalar dependências.

Reproduzir smoke: `node server/tests/scoutingBrowserHarness.mjs`. Abrir a URL exibida; encerrar com Ctrl+C. Arquivos compilados ficam em `.tmp/scouting-browser`, já ignorado pelo Git. Reiniciar esse harness apaga apenas seu save descartável em memória.

## Limites e riscos

- Firestore exercitado por adapter simulado com falha transacional injetada; não houve escrita em banco real, deploy, commit ou push.
- Consulta ao empresário é informativa. Ofertas, salários propostos e contratação continuam no motor de mercado existente; não há promessa de aceitação.
- Histórico preservado no save, limitado explicitamente a 20.000 operações e 2.000 registros de jogadores por sala, com erro ao atingir o limite; não há descarte silencioso. Uma carreira muito longa poderá exigir paginação/arquivamento próprio.
- Sincronização entre janelas ocorre ao ganhar foco, recarregar ou reabrir o perfil; não foi criado broadcast privado em tempo real.
- Fixtures isoladas não substituem homologação com Firebase e múltiplos clientes reais.

## Próxima etapa

Conectar a aba **Tática** ao estudo do clube selecionado, com conhecimento progressivo, cache e permissões. Não iniciada nesta entrega.
