# Backup e restauração

Use export/import oficial do Firestore para Cloud Storage. Não há endpoint administrativo no jogo.

## Escopo

Exportar banco completo inclui `rooms` e subcoleções, `roomPayloads`, `activeMatches`, `news`, `newsOperations`, catálogos pessoais/gerações e metadados `brasfootImportSessions`. Redis é transitório e não entra no backup.

Firestore export não inclui arquivos. Ative versionamento e lifecycle no Firebase Storage; configure backup nativo separado caso Cloudinary seja usado.

## Backup

1. Crie bucket de backup em região compatível e conceda ao service agent Firestore acesso de escrita.
2. Agende export diário via Cloud Scheduler + Workflows ou Cloud Run:

   `gcloud firestore export gs://BUCKET/firestore/$(date +%F) --project=PROJECT_ID`

3. Retenha 30 backups diários e 12 mensais. Ative versionamento e alertas de falha.
4. Valide semanalmente manifesto e faça restore de teste mensal em projeto separado.

## Restore seguro

1. Coloque backend em manutenção/zero réplicas para interromper escritas.
2. Faça export pré-restore.
3. Importe primeiro em projeto staging e valide login, catálogo, save, partida ativa e checksums.
4. Em produção, execute:

   `gcloud firestore import gs://BUCKET/firestore/EXPORT --project=PROJECT_ID`

5. Restaure mídia pelo mecanismo do bucket/provedor, publique índices/regras e reative Redis/backend.
6. Confirme `/ready`, logs de integridade e amostra de saves antes de liberar tráfego.

Import não apaga documentos extras. Para rollback destrutivo, use projeto novo ou remova somente dados previamente inventariados; nunca exponha credenciais ou comandos de restore por HTTP.
