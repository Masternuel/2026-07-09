# Fase 2 — Calendário global e scheduledAt

Status: implementação concluída e validada localmente em 08/09/2026. Sem commit ou push.

## Causa

Ligas avançavam pelo número da rodada humana, enquanto copas usavam um corte próprio. Isso antecipava jogos futuros, atrasava jogos de outras ligas e podia concluir finais antes de sua data. Saves legados também preservavam uma ordem de partidas incompatível com as datas.

## Correção

- Fila oficial ordenada por `scheduledAt`, reunindo ligas e copas, excluindo partidas concluídas, canceladas ou com participantes indefinidos.
- Uma seleção compartilhada define as partidas de IA anteriores ao próximo compromisso humano. Jogos simultâneos só são liberados após uma partida humana daquele horário.
- Inicialização, preparação de partida, conclusão e fechamento da temporada usam essa fila. Chaves dinâmicas são reavaliadas após cada resultado de copa.
- O coordenador existente continua garantindo descanso mínimo de 72 horas e resolução de conflitos. Remarcações não retrocedem durante reconstrução ou reload.
- Saves legados mantêm IDs, confrontos e resultados; partidas pendentes passam a seguir a ordem cronológica.
- App e Calendário reutilizam a mesma seleção visual, respeitando `currentFixtureId` publicado pelo servidor.
- Falhas na coordenação ou ausência de elenco válido para mata-mata abortam a mutação, sem publicar progresso parcial.

## Arquivos desta etapa

- `server/game/officialCalendar.mjs`: seleção e ordenação oficial compartilhada.
- `server/game/fixtures.mjs`: coordenação, datas preservadas, status e migração da ordem pendente.
- `server/store/roomStore.mjs`: avanço cronológico integrado ao ciclo da sala.
- `src/App.tsx` e `src/types.ts`: seleção compartilhada e status da partida.
- `server/tests/officialCalendar.test.mjs`: 11 testes novos.
- `server/tests/aiLeagueSimulation.test.mjs`: migração preserva confrontos, não a antiga ordem incorreta.
- `server/tests/competitionRoomStore.test.mjs`: finais dinâmicas aguardam sua data; falha de elenco mantém atomicidade.
- Este relatório.

Alterações anteriores no worktree foram preservadas e não pertencem a esta etapa.

## Validação

- Baseline: 33 testes relacionados aprovados antes das alterações.
- Resultado: 97 testes aprovados, zero falhas, em 12 suítes: calendário global, integração, migração de turnos, simulação de ligas, copas, fila oficial, intervalo, integridade e simetria de elencos, RoomStore, catálogo de partidas e CalendarView.
- Cenários: liga e copa na mesma semana, duas competições, rodada alta com data anterior, adiamento, descanso insuficiente, remarcação, reload sem duplicação, recuperação de IA atrasada e conflito de datas fixas sem persistência parcial.
- `npm run typecheck` e `npm run build`: aprovados. Build mantém aviso de chunks maiores que 500 kB.
- A suíte completa do projeto não foi executada nesta etapa.

## Limites

- Testes de persistência usam memória; não houve escrita em Firebase real nem teste operacional com múltiplas réplicas.
- CalendarView foi validada por testes automatizados, sem inspeção visual em navegador.
- Conflitos históricos já concluídos continuam preservados pela compatibilidade existente. Conflitos entre datas futuras fixas exigem correção explícita, sem mover silenciosamente partidas bloqueadas.
- O limite existente de remarcação continua aplicável; calendários impossíveis retornam erro.

Próxima etapa: idempotência na criação de salas. Não iniciada aqui.
