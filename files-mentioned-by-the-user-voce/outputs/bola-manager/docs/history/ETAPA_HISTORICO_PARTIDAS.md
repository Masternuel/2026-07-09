# Etapa — arquivo paginado de partidas

Status: **COMPLETE** (backend de arquivamento e consulta). Data: 2026-09-09.

## Problema e causa

`compactCompletedMatch` removia `events`, `playerStatistics` e `playerEffects`; somente `lastCompletedMatch` mantinha os detalhes. Ao concluir outro jogo, os detalhes anteriores deixavam de ter uma fonte persistente. Resultados de IA também eram reduzidos antes da gravação.

## Solução

- A conclusão grava resultado e fila `matchHistoryPending` na mesma operação CAS do save. Simulações de IA de ligas e copas alimentam essa mesma fila antes da compactação.
- Após o commit, o arquivador grava cabeçalho, manifesto e páginas em uma transação Firestore. Só depois da confirmação remove o item da fila, conferindo sua identidade e checksum. Falha ou ACK perdido mantém a fonte para repetição idempotente.
- Arquivo em `rooms/{code}/matchHistory/{id}`; payload em sua subcoleção `pages`. Reutiliza o codec com compactação, fragmentação e checksums do save v2. Não adiciona outro compressor nem outro motor de simulação.
- Identidade inclui sala, temporada, competição, fixture e clubes. Detalhes completos são imutáveis: divergências geram erro explícito, não sobrescrita silenciosa. Um resumo legado pode receber detalhes ainda disponíveis, mas não apagar detalhes completos.
- Listagem lê apenas cabeçalhos, com cursor e limite de 1–50 registros. Detalhes usam leitura transacional consistente. Payload ausente/corrompido resulta em erro, não em lista vazia.
- Exclusão da sala apaga arquivo e páginas. A transação de publicação verifica o documento pai, impedindo recriação após exclusão concorrente.
- Fila e marcador de migração não entram nas projeções/broadcasts dos jogadores. Endpoints exigem autenticação e participação na sala; DTO de histórico não inclui finanças, tática secreta ou estado administrativo.

## Operação e compatibilidade

- Primeiro lote: até 25 partidas, com alvo agregado de 4 MB; um registro grande pode ocupar sozinho o lote, limitado a 16 fragmentos. Lotes restantes drenam em segundo plano, com um trabalho por sala nesta instância.
- Réplicas concorrentes podem tentar arquivar o mesmo item; transações, identidade estável e confirmação por checksum evitam duplicação e remoção de versões novas da fila.
- Interrupção/falha preserva pendências. Nova mutação ou consulta do histórico retoma o trabalho; não há varredura automática de todos os saves inativos na inicialização.
- Com 512 detalhes previamente pendentes, novas mutações completas recebem `MATCH_HISTORY_BACKLOG` e acionam a drenagem. Um lote válido de calendário não é abortado no meio por ultrapassar esse limiar; o bloqueio protege a operação seguinte até o arquivo escoar.
- Logs: `match_history.archive_pending` e `match_history.drain_failed`. Lista retorna `pendingArchiveCount` e `archiveError` quando aplicável. Não foram configurados alertas externos nesta etapa.
- Saves antigos migram seus resumos de partidas de managers e o último resultado detalhado, quando ainda presente. Eventos já descartados, inclusive antigos jogos de IA sem arquivo, **não podem ser recuperados**. `detailsAvailable: false` identifica essa ausência nos resumos migrados.
- Resumos existentes continuam no save para os seletores atuais. O novo arquivo preserva dados esportivos; não duplica recibos financeiros, coletivas ou outros históricos administrativos.

## API

- `GET /api/matches/:code/history?limit=20&cursor=...`: `items`, `nextCursor`, `pendingArchiveCount`, `archiveError`.
- `GET /api/matches/:code/history/:id`: `{ match }`, contendo eventos, estatísticas coletivas/individuais e efeitos esportivos disponíveis.
- Cursor pertence à sala e ordena por temporada, data e identificador. Sem recarregar catálogo ou ler eventos na listagem.
- Não foi criada uma nova tela nesta etapa; a API fica pronta para integração visual posterior. As telas existentes não foram substituídas.

## Arquivos desta etapa

- `server/store/matchHistory.mjs`: arquivo, codec reutilizado, fila, identidade, paginação e proteção de acúmulo.
- `server/store/roomPersistence.mjs`: integração memória/Firestore e exclusão em cascata.
- `server/store/roomStore.mjs`: captura dos resultados, migração, drenagem e métodos autenticados.
- `server/services/roomVisibility.mjs`: exclusão dos campos internos.
- `server/routes/match.mjs`: endpoints de lista e detalhe.
- `server/tests/matchHistory.test.mjs`: 17 testes novos.
- `server/tests/roomStore.test.mjs`: expectativa atualizada da projeção leve.

## Validação

- **128/128 testes aprovados**: `matchHistory`, `roomStore`, `roomVisibility`, `firestorePersistence`, `competitionRoomStore`, `aiMarketRoomStore`, `matchPersistenceResilience`, `halftimeMatch`.
- Cobertura nova: recarga/troca de temporada; exclusão normal/concorrente; falha antes de commit; ACK perdido; repetição concorrente; falha ao limpar fila; confirmação sem remover entradas novas; fragmentação/corrupção; imutabilidade; saves legados; autorização HTTP; paginação sem duplicação; ocultação de dados privados; commit de partida rejeitado sem publicar arquivo; humanos/IA; copas com IDs locais iguais; drenagem de vários lotes; versão futura rejeitada.
- `npm run typecheck`: aprovado.
- `npm run build`: aprovado; aviso preexistente de chunks acima de 500 kB permanece.
- `git diff --check`: aprovado nos arquivos rastreados desta etapa.

## Limites e riscos

- Firestore testado com o double transacional existente, não em produção/emulador externo. Sem teste de carga, E2E visual ou deploy. A suíte inteira do projeto não foi executada.
- O primeiro lote ainda faz I/O após o commit da partida; medir latência real do Firestore antes de dimensionar produção. Lotes adicionais não prolongam a resposta do jogo.
- Backups completos precisam incluir a subcoleção `matchHistory` e suas páginas. Copiar somente o objeto do save não copia o arquivo histórico externo. Nenhum mecanismo externo de backup foi configurado.
- Recuperação para um checkpoint anterior não apaga o arquivo imutável de partidas já confirmadas. Uma eventual reexecução divergente da mesma fixture será sinalizada por conflito de histórico, exigindo reconciliação explícita.
- Alterações anteriores do workspace preservadas. Sem commit, push ou deploy. Próxima etapa do roteiro: scouting; não iniciada aqui.
