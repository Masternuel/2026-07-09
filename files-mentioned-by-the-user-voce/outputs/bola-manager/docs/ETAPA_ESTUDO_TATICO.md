# Etapa — estudo tático por clube

Status: **COMPLETE** para Tática da Fase 6. Data: 2026-09-09. Rankings permanece para a próxima etapa.

## Problema e causa

A página compartilhada dos clubes recebia `tacticalIntel: null`, enquanto o endpoint de estudo consultava somente o próximo adversário. Não havia solicitação persistida, progresso de conhecimento ou escopo explícito do clube selecionado. Sem escalação pública, a inferência de formação recebia uma lista vazia e recorria ao padrão 4-3-3.

## Solução

- Reutilizado `opponentStudy.mjs`: análise determinística com atributos reais, disponibilidade, setores, forças, vulnerabilidades e recomendações. Formação inferida a partir do elenco quando o plano não é público; nenhuma tática secreta alimenta essa inferência.
- `GET /api/rooms/:code/opponent-study?clubId=...&depth=...` consulta o clube selecionado. Sem `clubId`, mantém o uso do próximo adversário, agora ordenado pelo calendário oficial.
- `POST` no mesmo endpoint solicita estudo. Persistência privada em `tacticalStudyState`, pelo armazenamento transacional existente. Não altera dados no GET nem exige migração destrutiva de saves antigos.
- Uma solicitação por par clube observador/adversário. Repetições e concorrência não duplicam nem reiniciam o progresso. Aumentar a profundidade conserva o tempo acumulado.
- Progresso pelo relógio da carreira: rápido 4 h, padrão 16 h, profundo 40 h, ajustados pela velocidade da comissão. Relatórios expiram em 14 dias ou na mudança de temporada.
- Nível calculado somente de olheiros/analistas empregados com contrato ativo. Nível 0–1: leitura rápida; 2–3: padrão; 4–5: profunda. Demissão ou término do contrato reduz os detalhes acessíveis imediatamente na próxima consulta.
- Sem conhecimento: formação, escalação e vulnerabilidades ocultas. Rápido: estilo estimado e um jogador-chave. Padrão: formação provável, setores e recomendações. Profundo: onze provável. Instruções conhecidas aparecem somente quando públicas; o plano secreto permanece protegido.
- Elenco mescla catálogo, carreira, transferências e estado individual do save. Contratados entram, vendidos saem; lesionados/suspensos não compõem a escalação provável. Elenco incompleto gera aviso e confiança limitada a 50%; falhas de catálogo não viram dados fictícios nem cache antigo.
- Permissões de sessão, participação, clube atual, carreira ativa e pertencimento do adversário ao save. Escrita revalida o vínculo dentro da transação. Estudos privados excluídos de projeções e broadcasts gerais.
- Cache local apenas da análise: até 128 entradas, TTL de 60 s. Assinatura inclui revisão, temporada, data, conhecimento, comissão, elenco e informações táticas autorizadas. Autorização e leitura atual do elenco precedem o cache. Não precisa de invalidação distribuída para a correção dos dados.
- Painel reutilizado em Táticas e na página única de clubes acessada por Competições/Rankings. Central e Partida continuam consultando o estudo contextual. Foco, troca de clube, profundidade e revisão atualizam a consulta; respostas atrasadas não substituem outro contexto.
- DTO validado antes de renderizar. Carregamento, análise pendente, ausência, expiração, erro e tentativa de atualização explícitos. Sem localStorage ou sucesso otimista.

## Arquivos desta etapa

- Motor: `server/game/clubTacticalStudy.mjs`, ajuste em `server/game/opponentStudy.mjs`.
- Persistência/API/privacidade: `server/store/roomStore.mjs`, `server/routes/rooms.mjs`, `server/services/roomVisibility.mjs`.
- Frontend: `src/services/opponentStudyService.ts`, `src/hooks/useOpponentStudy.ts`, `src/components/tactics/OpponentStudyPanel.tsx`, `src/types.ts`, `src/App.tsx`, `src/views/TacticsView.tsx`, `src/views/season/{CompetitionClubPage,CompetitionsView,RankingsView}.tsx`.
- Testes: `server/tests/{clubTacticalStudy,opponentStudyRoute,opponentStudyUi,competitionClubNavigation,roomStore}.test.mjs`, fixture `server/tests/fixtures/tacticalStudyData.mjs`.
- Smoke manual: `server/tests/tacticalStudyBrowserHarness.mjs`, `server/tests/fixtures/tacticalStudyBrowser.{html,tsx}`. Compila exclusivamente a página de teste; não entra no bundle normal.

Arquivos compartilhados já continham alterações anteriores, preservadas. O diff total não representa somente esta etapa.

## Validação

- **49/49 testes passaram**: motor de estudo, API, parser/painel, navegação, RoomStore, scouting e propriedade de jogadores.
- Cobertura: consulta sem mutação, escopo explícito, próximo jogo cronológico, autorização, payload, concorrência, progresso, upgrade, expiração, mudança de emprego/temporada, segredo, plano antigo de outro clube, cache/TTL/limite, transferências, lesões, elenco parcial, falha de catálogo e rollback.
- Persistência testada em memória e **Firestore simulado**, incluindo reabertura do armazenamento.
- `npm run typecheck`: passou. `npm run build`: passou, incluindo `tsc -b`. Permanece o aviso sobre chunks acima de 500 kB.
- `git diff --check` nos arquivos rastreados desta etapa: passou.
- Navegador integrado com save descartável: clube OPP inicialmente desconhecido, solicitação profunda, troca para OTHER sem herdar conhecimento, reload conservando o pedido, avanço de dois dias liberando a análise, formação inferida 4-4-2 sem revelar a secreta 5-4-1, erro de catálogo e recuperação confirmados. Layout inspecionado. Limite por comissão também coberto nos testes de API.

Reproduzir: `node server/tests/tacticalStudyBrowserHarness.mjs`. Abrir a URL exibida. Os controles avançam apenas o save de teste em memória. Encerrar com Ctrl+C. Compilados ficam em `.tmp/tactical-study-browser`, já ignorado.

## Limites e riscos

- Sem acesso a Firebase real, deploy, commit ou push. Smoke isolado não substitui homologação multiusuário em produção.
- Políticas de tempo/validade/cache/quantidade são parametrizadas no motor. Máximo explícito de 2.000 registros por save; não há descarte silencioso. Carreiras muito longas poderão exigir arquivamento.
- Relatório representa conhecimento vigente, não um arquivo histórico de formações passadas. Não foram inventadas “últimas formações”.
- Sincronização entre janelas ao ganhar foco, atualizar, navegar ou receber nova revisão; não há broadcast privado instantâneo para estudos.
- Se a gravação concluir e a leitura posterior falhar, atualizar/repetir consulta recupera o estado persistido. Retry não duplica o pedido; a interface orienta verificar a confirmação.
- Cache evita recomputar a análise, não evita a leitura autorizada do elenco atual.

## Próxima etapa

Rankings: ordenação, filtros e períodos enviados ao backend, com cálculo e interface usando o mesmo estado. Não iniciada nesta entrega.
