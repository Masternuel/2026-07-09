# Gemini nas respostas do desktop

Configurações > Inteligência artificial permite salvar/ativar, testar, desativar e remover a chave **pessoal** Gemini. Salvar não chama o provedor; Testar conexão faz uma solicitação explícita. Internet é necessária e chamadas podem consumir quota ou gerar custo conforme a conta Google.

A chave nunca acompanha o instalador, bundle web, save, exportação do Editor, preferências ou sessões P2P. `desktop/aiSettings.mjs` grava somente ciphertext em `userData/ai-settings.json`, usando `safeStorage` assíncrono do Electron (DPAPI no Windows). Não há fallback plaintext; ausência de criptografia segura impede salvar. Isso protege contra outros usuários do computador, não contra comprometimento da própria conta/sistema.

O preload não oferece leitura da chave, somente status sanitizado. IPC valida janela/frame/origem. A chave é entregue ao utility process, que reutiliza `server/services/socialAi.mjs`: API oficial `generateContent`, JSON validado, contexto fictício limitado, sem estado conversacional remoto, cache, limite de uso e concorrência. O desktop usa Gemini 3.1 Flash-Lite, com Flash como reserva; a configuração web/Interactions não muda. Não é enviada ao renderer nem ao convidado P2P. No multiplayer, o anfitrião configura sua própria chave e gera respostas para a sessão.

Ativação é aplicada sem reiniciar o motor e não altera a carreira. Duas tentativas de modelo, sem retry adicional, respeitam o orçamento HTTP/IPC existente de 30 segundos. Erros, falta de internet ou quota podem gerar a resposta determinística de reserva; o painel mostra esse resultado, sem alegar que houve geração Gemini. Respostas de publicações/notícias são persistidas pelos stores existentes. Recuperação de posts anteriores segue o fluxo existente do feed.

Não há chave universal embutida. Para distribuir IA custeada pelo desenvolvedor, é necessário um proxy autenticado com quotas/custos próprios — uma credencial compartilhada jamais deve ser colocada no instalador. A configuração web não é lida/importada implicitamente.

Referências: [Gemini Interactions API](https://ai.google.dev/gemini-api/docs/interactions-overview), [segurança das chaves Gemini](https://ai.google.dev/gemini-api/docs/api-key), [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage).
