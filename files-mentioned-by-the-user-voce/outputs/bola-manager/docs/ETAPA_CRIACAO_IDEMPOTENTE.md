# Fase 3 — Criação idempotente de salas

Status: COMPLETO. Validação local em 08/09/2026. Sem commit ou push.

## Problema original e causa raiz

Após timeout, cada chamada criava outro código e outro save. O identificador de transporte servia para logs, sem recibo persistente. O cliente também gerava uma solicitação independente a cada tentativa.

## Solução implementada

- `operationId`/`requestId` validados, vinculados ao UID autenticado e ao fingerprint da configuração. Alias diferentes na mesma chamada são rejeitados.
- Recibo e manifesto inicial da sala gravados na mesma transação. Réplicas podem preparar gerações concorrentes, mas apenas uma sala é publicada para a operação.
- Retry consulta o recibo antes de carregar o catálogo e retorna o estado atual da sala, sem sobrescrevê-lo. Reconciliação existente do save continua protegendo staging e commits com ACK perdido.
- Reutilização do ID com outro conteúdo retorna 409. Sala excluída retorna 410; recibo é preservado para impedir recriação por retry antigo. Recibo inválido falha explicitamente.
- Cliente persiste o ID antes do envio, agrupa solicitações simultâneas e o mantém após erro, timeout ou desconexão. Confirmação permite nova criação intencional. Resposta antiga não apaga outra operação pendente.
- REST e Socket usam o mesmo contrato e a mesma persistência. Não houve alteração do formato dos saves existentes.

## Arquivos alterados

- `server/store/roomCreationOperation.mjs`: identidade, fingerprint e validação de recibos.
- `server/store/roomPersistence.mjs`: atomicidade e consulta de recibos em memória/Firestore.
- `server/store/roomStore.mjs`: replay, configuração conflitante e sala excluída.
- `server/schemas.mjs`: IDs opcionais nos contratos existentes.
- `src/lib/roomCreationOperation.ts`: ID persistente e agrupamento de envios.
- `src/hooks/useRoom.ts` e `src/types.ts`: integração do cliente.
- `server/tests/roomCreationIdempotency.test.mjs` e `server/tests/roomCreationClient.test.mjs`: testes novos.
- `README.md` e este relatório.

Alterações de etapas anteriores foram preservadas; não fazem parte desta entrega.

## Testes e verificações

- Baseline: 81 testes relacionados aprovados antes das alterações.
- 23 testes novos: retry, concorrência, identidade, conflito de payload, criação intencional, exclusão, alias, compatibilidade legada, falha de ativação, corrupção do recibo, commit com ACK perdido, reload, armazenamento bloqueado e integração do hook.
- Integração com Socket.IO real em servidor local: sala criada, resposta retida até timeout, desconexão, reconnect, retries concorrentes e replay via HTTP; apenas uma sala registrada.
- Total executado: 164 testes aprovados, zero falhas, em nove suítes (criação servidor/cliente, RoomStore, persistência Firestore, timeouts, recovery, concorrência de recovery, seções assíncronas e catálogo de partidas).
- Typecheck: aprovado.
- Build: aprovado; aviso existente de chunks maiores que 500 kB.
- `git diff --check`: aprovado.

## Riscos e limites restantes

- Transações e falhas Firestore testadas com fake transacional, não Firebase real ou emulador. Não houve teste de implantação Railway/múltiplas réplicas reais.
- Recibos têm retenção permanente e pequeno custo adicional de armazenamento. Uma futura política de retenção não pode tratá-los como cache descartável.
- Chamadas sem ID continuam independentes por compatibilidade. Idempotência exige um ID estável; integrações antigas precisam adotá-lo.
- Modo demonstração offline continua local. Memória não sobrevive a reinício do processo; a garantia durável usa Firestore.
- Não houve inspeção visual em navegador nem execução da suíte completa do projeto.

Próxima etapa do roadmap: autenticação de conexões Socket persistentes. Não iniciada aqui.
