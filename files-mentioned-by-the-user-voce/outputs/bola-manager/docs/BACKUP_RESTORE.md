# Backup e restauração — runbook operacional

## Evidência e limites

O repositório contém persistência Firestore, exportação/importação **do catálogo**, regras/índices Firebase e configuração Railway com duas réplicas. Não contém agendamento de backup, retenção aplicada, inventário de objetos versionados, execução de restore nem RPO/RTO medidos. Exportar o catálogo pelo Editor não salva a carreira completa.

Este documento é um procedimento proposto. Nenhum backup, restore ou acesso real foi executado na Fase 3. Configurações de console, IAM, criptografia e monitoramento externos não foram comprovados.

## Ativos e política recomendada

| Ativo | Conteúdo/risco | Configuração externa necessária |
| --- | --- | --- |
| Firestore completo | Salas/carreiras, contratos, transações, partidas ativas, histórico/outbox, páginas/índices/manifests e gerações; catálogos; notícias; importações/quotas | Export diário, 30 diários + 12 mensais; snapshot antes de migração; validar manifesto semanalmente |
| Firebase Auth | UIDs, identidades e claims; não incluídos no export Firestore | Backup administrativo separado e criptografado; no ensaio, usuários sintéticos e mapeamento de UID |
| Firebase/Cloud Storage | Escudos, fotos, troféus e arquivos de importação referenciados | Versionamento/soft-delete, inventário de geração/tamanho/hash/metadados e cópia diária isolada; TTL dos temporários não pode eliminar cópia necessária |
| Cloudinary | Assets, public IDs, versões, metadados e propriedade | Backup/versionamento conforme plano e inventário diário; confirmar recuperação isolada |
| Configuração | Commit, lockfile, regras, índices, regiões, banco/buckets e runtime | Manifesto de release por backup; secrets somente em cofre, nunca no manifesto |
| Redis | Leases, fencing, coordenação, limites e reservas de IA | Não restaurar leases antigos; usar instância/prefixo isolado. Redis vazio reinicia limites: IA paga permanece desativada até recompor orçamento ou transcorrer a janela |

Não selecionar apenas `rooms`: incluir subcoleções e formatos legados/atuais. Export integral abrange também `roomPayloads`, `activeMatches`, `catalogDatabases`/gerações, `brasfootCatalogGenerations`, `news`, `newsOperations`, `brasfootImportSessions`, arquivos e guardas de quota.

Controles externos obrigatórios:

- Projeto/conta de backup separado do runtime; sem acesso público nem exclusão pela aplicação.
- TLS no transporte e criptografia em repouso. Se CMEK for exigido, retenção/recuperação da chave deve acompanhar backups.
- Contas dedicadas para exportar/restaurar, sem Owner/Editor genérico; privilégio mínimo e autorização do service agent Firestore no bucket conforme documentação oficial.
- Retenção/lifecycle e proteção contra exclusão com aprovação: bloqueio de retenção pode ser irreversível e gerar custos.
- Agendador externo e alertas de atraso, falha, crescimento, objetos ausentes e integridade; logs sem secrets/dados pessoais.
- Ponto consistente entre banco e mídias. Export durante escritas concorrentes não comprova snapshot transacional da aplicação.

## Restore isolado e reproduzível

### Pré-requisitos

1. Aprovação, identificador do backup, manifesto/hash, horário do ponto de recuperação e commit compatível.
2. Projeto Firebase **novo e descartável**, banco vazio em região compatível, bucket e Redis exclusivos. Conta de restore sem escrita em produção.
3. Egress bloqueado para Gemini, Cloudinary e serviços reais durante o ensaio. Não copiar secrets, usuários reais nem chaves de assinatura de produção.
4. Backup original somente leitura; identidades separadas para ler backup e executar o jogo.
5. Regras/índices do commit restaurado provisionados, índices prontos; backend, workers e cleanup parados até reconciliação.

### Ordem e comandos

Modelos para operador autorizado, **não executados**. Preencher somente com destino de laboratório e export existente. Import pode sobrescrever documentos e não remove excedentes: usar banco vazio.

```powershell
$RestoreProject = 'REPLACE_WITH_ISOLATED_PROJECT'
$ProductionProject = 'REPLACE_WITH_SOURCE_PROJECT_ID_ONLY'
$ExportUri = 'gs://REPLACE_WITH_BACKUP_BUCKET/firestore/REPLACE_WITH_EXPORT'
if ($RestoreProject -like 'REPLACE*' -or $ProductionProject -like 'REPLACE*' -or
    $ExportUri -match 'REPLACE' -or $RestoreProject -eq $ProductionProject) {
  throw 'Configure e verifique um destino isolado antes de continuar'
}
# Conferir manualmente inventário/IAM e banco vazio antes do import.
gcloud firestore databases describe --project=$RestoreProject --database='(default)'
if ($LASTEXITCODE -ne 0) { throw 'Destino não validado' }
gcloud firestore import $ExportUri --project=$RestoreProject --database='(default)'
if ($LASTEXITCODE -ne 0) { throw 'Import falhou; manter aplicação parada' }
gcloud firestore operations list --project=$RestoreProject
```

A existência do projeto não basta: verificar isolamento, IAM e autorização antes do import. Banco nomeado exige ID explícito conferido no manifesto. Registrar ID da operação e aguardar sucesso antes do próximo passo.

6. Restaurar versões de objetos no bucket isolado; conferir hash, tipo, tamanho, geração, metadados e vínculo registro/objeto.
7. Cloudinary: mecanismo oficial em ambiente separado. Sem cópia isolada suportada, usar fixtures e registrar mídia real como **não validada**.
8. Mapear identidades sintéticas de forma auditável. Provas/HMAC de propriedade dependem do ambiente: não desabilitar validação nem copiar secrets reais; ensaiar mídias assinadas com chaves sintéticas.
9. Reconciliar sessões/TTL/quotas, ownership/fencing e partidas antes de ligar workers. Não apagar guardas ou zerar quotas indiscriminadamente; não reutilizar leases. Manter IA paga bloqueada.
10. Iniciar exclusivamente no laboratório com origens explícitas e proxies validados; arquivar evidências redigidas, horários e divergências.

### Integridade e aceite

- Manifestos, contagens e hashes conferem; sem páginas/gerações/referências ausentes.
- Isolamento dos catálogos/UIDs preservado.
- Carregar/gravar/recarregar amostra determinística de saves pequenos, grandes e legados.
- Vínculos únicos de jogadores, contratos, finanças e transações consistentes; avançar rodada e recarregar.
- Retomar partida/intervalo sem duplicar resultado, estatísticas ou outbox; ensaiar troca de instância/fencing.
- Importações concluídas/canceladas/expiradas e cleanup preservam quotas e impedem exclusão cruzada.
- Verificar auth revogada, mídia de outro usuário, CORS, headers e Redis obrigatório fail-closed.
- /ready saudável, logs redigidos e suíte server/frontend/E2E do commit aprovado.
- Comparar com manifesto/fixture esperado, não apenas HTTP 200; divergência impeditiva bloqueia aceite.

### Rollback e objetivos

Falha: parar somente o laboratório, preservar manifesto/logs redigidos, manter backup original intacto. Repetir em outro projeto vazio com ponto anterior; não limpar banco compartilhado ou sobrescrever produção. Exclusão do laboratório requer conferência dos IDs e autorização separada.

RPO proposto: até 24 horas para ativos no ciclo diário. RTO inicial proposto: até 8 horas após disponibilizar destino/IAM. São **metas não medidas**, dependentes de volume, índices, import, provedor e reconciliação. Ensaio mensal deve medir resultados e ajustar metas. Promover restore para produção exige plano/autorização distintos.

## Referências oficiais

Requisitos e limitações do export/import: [Firebase](https://firebase.google.com/docs/firestore/manage-data/export-import). Export de documentos não substitui backup de objetos/identidade.

Recuperação/versionamento de assets depende da configuração/plano: [Cloudinary](https://cloudinary.com/documentation/backups_and_version_management).
