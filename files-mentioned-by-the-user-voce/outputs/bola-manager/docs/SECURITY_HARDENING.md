# Fase 3 — configuração e revisão operacional

## Erros e logs

HTTP e Socket.IO usam `publicErrors.mjs`: tipos enumerados ou `public: true` permitem mensagens de domínio 4xx. Infraestrutura recebe mensagens fixas para códigos explícitos; demais exceções recebem mensagem genérica. `expose: true` sozinho não libera mensagens internas.

Details não é repassado: apenas paths limitados de validação com mensagem genérica e números `retryAfterMs`/`maximumBytes`. Stack/cause/detalhes de provedor ficam no logger redigido. Correlation IDs têm formato/tamanho restritos; IDs suspeitos são substituídos. Não copiar exceptions de provedor para erro marcado público.

Na fronteira entre réplicas, mensagens/detalhes recebidos não são confiados: somente códigos com mensagem fixa são preservados; demais erros ficam genéricos, inclusive durante rollout com réplica antiga. Diagnóstico detalhado permanece no log correlacionado.

Redaction cobre campos sensíveis, corpos/payloads, Bearer/Basic, JWT, chaves identificáveis, PEM, userinfo de URLs e parâmetros secretos. Relatórios CLI preservam quantidade de entradas e JSON válido. Não inserir corpos/textos arbitrários de usuário em logs: nenhuma heurística identifica segredo arbitrário sem formato/contexto. Adicionar padrões/testes ao introduzir provedores; nunca carregar credenciais reais para testar.

Revisados: logger HTTP/Socket, handshake/auth/cluster/playback, Redis, Firebase/Cloudinary/Gemini, importações/relatórios, recovery e startup/shutdown. Requests registram família de rota, não path/query original.

## CORS

- Produção: `CLIENT_ORIGIN` lista origens exatas separadas por vírgula, sem caminho/query/userinfo/barra final. Exemplo sintético: `https://jogo.example,https://painel.example`.
- Wildcard em produção falha antes de inicializar dependências. Variável ausente não autoriza origens de navegador.
- Desenvolvimento mantém localhost padrão; wildcard explícito somente fora de produção e sem credenciais.
- Origin null é rejeitado. Sem Origin, clientes não-browser e healthchecks continuam permitidos, sem refletir header CORS; autenticação privada segue obrigatória.
- HTTP/polling e handshake WebSocket compartilham política; allowRequest cobre WebSocket. CORS não autentica clientes nativos, que podem forjar/omitir Origin. [Socket.IO](https://socket.io/docs/v4/handling-cors/).

## Proxy e HTTPS

`TRUST_PROXY` ausente/false usa peer TCP e ignora X-Forwarded-For/Proto. Não há presunção de um salto. Listar somente IPs/CIDRs **comprovados** de proxies, separados por vírgula. Números de saltos, true, wildcard e /0 são recusados.

O repositório não comprova a topologia Railway. Antes do deploy: confirmar peers, impedir bypass direto e assegurar que o último proxy confiável sobrescreve headers encaminhados. Não confiar cegamente em toda rede privada. Sem configuração, rate limit agrega clientes pelo IP do proxy: impede spoof, mas pode limitar clientes legítimos; homologar antes de liberar.

HTTP usa req.ip; conexão Socket.IO mantém peer TCP e eventos usam identidade autenticada. Não passar X-Forwarded-For diretamente ao limiter. HTTPS depende de TLS real ou proxy explicitamente confiável. [Express](https://expressjs.com/en/guide/behind-proxies/).

## Headers

CSP anterior, frame-ancestors 'none' e X-Frame-Options DENY preservados. Backend/Vite dev/preview/Vercel incluem nosniff, Referrer-Policy no-referrer e Permissions-Policy desativando câmera/microfone/geolocalização/pagamento.

`ENABLE_HSTS=true` habilita max-age de um ano **só** no backend de produção com request HTTPS confiável; sem includeSubDomains/preload, nunca no desenvolvimento. Confirmar redirecionamento HTTP→HTTPS e domínio antes de ativar. HSTS gerenciado por Vercel/edge é externo: conferir após deploy, inclusive erros/preflight.

`BOLA_ENV_FILES=false` permite validar/buildar Vite sem ler .env/.env.local. Variáveis já no processo ainda prevalecem: usar processo isolado sem secrets. E2E usa fixtures e desabilita arquivos de ambiente.

## CI

SHAs verificados nas refs públicas oficiais via git ls-remote sem credential helper:

| Action | Antes | SHA | Release |
| --- | --- | --- | --- |
| checkout | v6 | d23441a48e516b6c34aea4fa41551a30e30af803 | v6.1.0 |
| setup-node | v6 | 249970729cb0ef3589644e2896645e5dc5ba9c38 | v6.5.0 |
| upload-artifact | v4 | ea165f8d65b6e75b540449e92b4886f43607fa02 | v4.6.2 |

Permissão segue somente contents: read; sem pull_request_target, novos jobs ou acessos. Atualização futura exige verificar release/commit oficial e revisar diff.

## Pendências não executadas

Redis real/Lua, Firebase/Firestore/Storage, Cloudinary, Gemini, IAM, contenção/partições e headers pós-deploy dependem de homologação. Backup/restore real não comprovado: seguir [runbook isolado](BACKUP_RESTORE.md), medir RPO/RTO e registrar evidência. Nenhuma ação nesta fase executa deploy, acessa produção, usa credenciais reais ou concede IAM.
