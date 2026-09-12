# Fase 1 — Importação JSON

Status: COMPLETO. Validação local em 08/09/2026. Sem commit ou push.

## Problema e causa raiz

A importação sobrescrevia documentos ativos em lotes e dependia de rollback compensatório. Uma interrupção ou falha na compensação podia expor um catálogo parcialmente atualizado.

## Solução

- Reutilização do motor geracional Brasfoot: staging isolado, validação e ativação atômica.
- Conferência dos documentos efetivamente gravados por quantidade, ID e checksum; validação das referências do catálogo combinado.
- Troca de geração e recibo de conclusão na mesma transação. Catálogo anterior preservado durante a operação.
- Recibos persistentes por conta/operationId, com rejeição de reutilização do ID para conteúdo diferente. Retry antigo não reativa uma geração superada.
- Lease com heartbeat; retomada após 10 minutos sem heartbeat usa geração nova. Worker substituído não pode publicar nem remover a geração vencedora.
- Reconciliação de ACK perdido; resultado incerto preserva staging. Falhas liberam apenas o próprio lock, sem sobrescrever metadados concorrentes.
- Editor mantém ID pendente por conta/hash no armazenamento local. Falha de upload ou de recarregamento mantém a mesma operação para retry; sucesso permite nova importação intencional.
- Bases legadas sem geração continuam suportadas; registros não presentes no pacote, copas Brasfoot e mídias anteriores são preservados.

## Arquivos desta etapa

- `server/store/catalogImportTransaction.mjs`: staging, validação, recibos e ativação.
- `server/store/catalogStore.mjs`: importação JSON geracional, merge, auditoria e propriedade de mídia.
- `server/services/catalogDatabase.mjs`: reutilização da validação de referências.
- `server/routes/editor.mjs`: operationId no endpoint existente.
- `src/lib/catalogImportOperation.ts`: identidade persistente da operação no cliente.
- `src/hooks/useEditorCatalog.ts`: integração do ID e propagação de erro no reload pós-importação.
- `server/tests/catalogJsonGeneration.test.mjs`: 23 testes novos de integridade.
- `server/tests/catalogImportOperation.test.mjs`: 5 testes novos do cliente e hook.
- `server/tests/editorRoute.test.mjs`: cobertura HTTP ampliada e falha de staging.
- `README.md`: contrato de retry, recuperação e limites operacionais.
- Este relatório.

Alterações anteriores no worktree foram preservadas; não fazem parte desta etapa.

## Verificações

- 28 testes novos: geração legada/atual, leituras durante staging, exclusividade, falhas de lote, corrupção/ausência/excesso de documentos, referências combinadas, idempotência, reinício, lease substituído, ACK perdido, atomicidade do recibo, conflitos, mídias, limite de bytes e retry do cliente.
- 92 testes relacionados aprovados, zero falhas: catálogo JSON/Brasfoot, sessões/parser Brasfoot, catálogo inicial, fixtures, endpoint Editor e cliente de importação.
- `npm run typecheck`: aprovado.
- `npm run build`: aprovado; aviso existente de chunks maiores que 500 kB.
- `git diff --check`: aprovado.
- Suíte completa do projeto não foi repetida nesta etapa. Testes de persistência usam fake Firestore com transações e injeção de falhas; não houve escrita em Firebase real nem execução em emulador.

## Limites e riscos restantes

- Gerações antigas, staging órfão e imagens retidas exigem futura política de coleta segura; há consumo adicional de armazenamento.
- Limite de arquivo permanece 24 MB. Cada nova geração copia também o catálogo já existente.
- Armazenamento local bloqueado impede iniciar upload com garantia de retry persistente.
- Catálogo legado já marcado `import_failed` pelo modelo anterior exige recuperação explícita de backup.
- Ainda é recomendada validação operacional em ambiente Firebase de homologação.

Próxima etapa do roadmap: calendário global e `scheduledAt`. Não iniciada aqui.
