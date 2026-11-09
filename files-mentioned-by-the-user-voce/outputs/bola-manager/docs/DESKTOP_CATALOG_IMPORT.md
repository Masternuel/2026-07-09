# Base da conta Google → launcher local

Este incremento migra **somente o catálogo do Editor**: ligas, clubes, jogadores e torneios. Não converte saves de carreira da versão web, não sincroniza alterações futuras e não transfere arquivos de imagem. As URLs de imagens são preservadas, mas o launcher continua bloqueando destinos HTTP externos: o download/empacotamento de mídia é um incremento separado. Nenhum dado remoto é apagado.

## Uso

1. Execute sua versão web local com a configuração Firebase original. Use o mesmo projeto Firebase e a mesma conta que possuem a base; apenas repetir o e-mail em outro projeto não recupera os dados.
2. No launcher, abra **Editor → Importar base da sua conta**. Confira o endereço da versão web (normalmente `http://localhost:5173`) e clique em **Entrar com Google no navegador**.
3. A página `/desktop-export`, no navegador externo, reutiliza o Firebase Auth da versão web. Entre com Google, confira a conta e exporte o JSON. A exportação é explícita, nunca iniciada automaticamente no login.
4. Volte ao launcher e selecione o JSON exportado. Confira as contagens e confirme a importação.

Também é possível selecionar um JSON já exportado pelo Editor existente. O aplicativo não lê `.env.local`, não copia a configuração web e não inicializa Firebase no processo desktop. A versão web precisa estar em execução e configurada pelo usuário para o login/exportação; não há autenticação falsa quando isso falta.

O uso do navegador externo respeita a [política Google OAuth sobre agentes incorporados](https://developers.google.com/identity/protocols/oauth2/policies). Não são solicitados acesso ao Gmail ou escopos de e-mail; reutiliza-se a autenticação já existente do jogo. Tokens permanecem no navegador web e não são enviados por URL, IPC, catálogo ou arquivo de save local.

## Segurança e preservação

- O renderer solicita um seletor nativo, nunca fornece caminhos ao processo principal. Arquivo regular, UTF-8/JSON válido, máximo 24 MiB. Formato, versão, IDs, atributos e referências usam o parser já existente do Editor.
- A prévia é opaca, única e expira em cinco minutos. Nenhuma gravação ocorre na seleção/prévia. Há confirmação separada e cancelamento.
- A importação não funciona como convidado P2P, com sessão P2P ativa/pendente ou com partida local em andamento. O backend é encerrado de forma normal antes da troca e reaberto do disco; requests antigos não atravessam a troca do catálogo.
- A transação cria primeiro uma cópia integral verificada pelo formato existente em `userData/saves/backups/career-before-import-<uuid>.bolasave`, com permissões locais restritas. A gravação principal continua usando fsync e rename atômico. Falha no backup ou na gravação não publica novo estado em memória.
- Carreiras locais existentes recebem um `catalogOwnerId` interno que referencia uma cópia imutável do catálogo anterior. Sua identidade, clubes, escalações, contratos, mercado e partidas não são substituídos. Novas carreiras usam a base importada. Importações sucessivas preservam as gerações já utilizadas.
- O perfil local não passa a usar o UID Google. O pacote utiliza somente registros validados; metadados arbitrários na raiz do arquivo não são persistidos.
- O banco local continua limitado a 128 MiB. Catálogos arquivados podem consumir esse limite; a operação falha sem substituir o save se ele for excedido. Backups completos são mantidos e não são removidos automaticamente.

## Limites deste incremento

A recuperação por JSON continua separada da edição. O launcher também oferece agora o Editor completo das quatro entidades existentes, com mídia e persistência locais; consulte [DESKTOP_EDITOR.md](DESKTOP_EDITOR.md). Migração de carreiras web, recuperação guiada de backup, importação automática sem selecionar arquivo e sincronização entre dispositivos não estão implementadas. O JSON não incorpora arquivos binários das imagens externas.

Regressões: `desktop/tests/catalogImport.test.mjs`, `desktop/tests/catalogImportElectron.test.mjs`, `server/tests/desktopImportUi.test.mjs`. Nenhuma credencial real é necessária nesses testes.

## Validação local deste incremento

- Desktop: 41 aprovados, incluindo importação no Electron real, backup, cancelamento, reinício do motor e preservação do catálogo das carreiras anteriores.
- Servidor: 1512 aprovados, zero falhas/cancelamentos, um skip dependente de Redis externo.
- Frontend: 226 aprovados. E2E Chrome: 8 aprovados, incluindo download autorizado explícito e recusa de exportação.
- Typecheck, build desktop e `git diff --check`: aprovados. Avaliação visual independente em desktop e telas estreitas: aprovada.
- O login Google real e a recuperação da base do usuário não foram exercitados. Não foram acessados provedores reais nem lidos arquivos de configuração secretos. O instalador anterior não foi reconstruído neste incremento.

### Arquivos deste incremento

Criados: `desktop/catalogImport.mjs`, `desktop/tests/catalogImport.test.mjs`, `desktop/tests/catalogImportElectron.test.mjs`, este guia, `src/components/menu/DesktopCatalogImport.tsx`, `src/views/DesktopExportView.tsx`, `src/styles/desktop-import.css`, `server/tests/desktopImportUi.test.mjs` e `e2e/desktop-export.spec.mjs`.

Integração em arquivos existentes: `desktop/localDatabase.mjs`, `desktop/localCatalog.mjs`, `desktop/localBackend.mjs`, `desktop/server-worker.mjs`, `desktop/main.mjs`, `desktop/preload.cjs`, `docs/DESKTOP_MIGRATION.md`, `server/store/catalogStore.mjs` (exportação de dois helpers já existentes), `src/components/menu/EditorAvailabilityPage.tsx`, `src/views/LobbyView.tsx`, `src/lib/desktopClient.ts` e `src/main.tsx`. Alterações anteriores na working tree permanecem separadas deste escopo; nada foi commitado.
