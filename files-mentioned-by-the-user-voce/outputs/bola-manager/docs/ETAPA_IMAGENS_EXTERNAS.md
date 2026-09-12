# Fase 4 — Segurança de imagens externas

Status: COMPLETO — implementação e testes automatizados relacionados. Validação visual no navegador não executada: inicialização do Chrome automatizado falhou (`CDP response channel closed`). Sem deploy ou commit.

## Problema original e causa raiz

Escudos, fotos e avatares aceitavam URLs arbitrárias diretamente no navegador. Não havia CSP para imagens; o upload conferia MIME/assinatura/tamanho sem decodificar o arquivo ou limitar dimensões.

## Solução implementada

- Política compartilhada de origens: HTTPS, hosts exatos e caminhos específicos de Cloudinary upload, Firebase Storage download e avatar Google. Rejeita credenciais na URL, portas alternativas, SVG/GIF e destinos locais/desconhecidos.
- Proxy público `GET /api/media/image?url=...`: não encaminha cookies, Authorization ou referer; não segue redirecionamentos. Valida MIME, tamanho declarado e bytes efetivamente recebidos, com timeout e cancelamento por desconexão.
- `sharp` decodifica e regrava PNG/JPEG/WebP antes do upload e da exibição. Remove metadados/conteúdo adicional, rejeita arquivos falsos/truncados, SVG e imagens animadas identificadas pelo decoder. Teto de 5 MiB de entrada/saída, 4096 pixels por lado e 16 milhões de pixels. Proxy entrega miniaturas de até 512×512.
- Proxy: até 4 downloads simultâneos; processamento: até 4 decodificações por processo. Timeout externo de 10 s e de processamento de 5 s. Cache de 5 minutos, limitado a 128 entradas/16 MiB por réplica. Sob saturação, retorna erro explícito, sem fila ilimitada.
- Cliente: até 3 downloads simultâneos, deduplicação, cancelamento, timeout de 15 s, cache limitado a 128 entradas/16 MiB, revogação de Blob URLs. Imagens bloqueadas/indisponíveis usam o fallback visual existente; isso não altera dados de carreira.
- Todos os componentes de imagem usam o carregador seguro. Prévias do Editor usam Blob URLs registradas, com limpeza compatível com React StrictMode.
- CSP em HTML, Vite dev/preview e Vercel: `img-src 'self' blob:; object-src 'none'; base-uri 'self'`. Sem permissão de imagens externas diretas ou data URLs.
- URLs antigas e objetos já armazenados não são removidos/migrados. O Editor avisa quando a origem é bloqueada. Resposta inesperada do Cloudinary remove apenas o novo upload, sem alterar a mídia anterior.

## Arquivos da etapa

- Política/carregamento: `shared/imagePolicy.mjs`, `shared/imageLoader.mjs`, declarações `.d.mts`, `src/lib/imageSources.ts`.
- Backend: `server/routes/images.mjs`, `server/services/catalogMedia.mjs`, `server/services/cloudinaryMedia.mjs`, montagem em `server/index.mjs`, família fixa `/api/media` em `server/infrastructure/metricPolicy.mjs`.
- Interface: `ClubMark.tsx`, `ResilientImage.tsx`, `EditorRecordForm.tsx`, `ConfigView.tsx`.
- Configuração: `index.html`, `vite.config.ts`, `vercel.json`, `package.json`, `package-lock.json`, `README.md`.
- Testes: `imageSecurity.test.mjs`, `imageLoader.test.mjs`, `helpers/imageFixtures.mjs`; fixtures reais e regressões em `cloudinaryMedia.test.mjs` e `editorRoute.test.mjs`.

Alterações preexistentes do worktree foram preservadas. Diffs acumulados de arquivos compartilhados não pertencem integralmente a esta etapa.

## Testes e resultados

Baseline relacionado: 23/23 (`cloudinaryMedia`, `editorRoute`, `deploymentSafety`).

15 testes novos: allowlist/URLs maliciosas; arquivos reais e metadados; falsificação/truncamento/tamanho/dimensões; upload inválido sem escrita; proxy sem encaminhar credenciais; redirecionamentos e streams grandes; timeouts e recuperação; concorrência e liberação de vagas; miniaturas/cache/expiração; CSP; deduplicação e ciclo de vida de blobs; orçamento/expiração/falhas do cache; fila/cancelamento; MIME inválido; resposta maliciosa do provedor com limpeza do novo upload.

Validação final: 113/113 aprovados, incluindo `imageSecurity`, `imageLoader`, `cloudinaryMedia`, `editorRoute`, `deploymentSafety`, `brasfootImport`, `brasfootBinaryImport`, `brasfootImportSessions`, `catalogImportOperation`, `catalogJsonGeneration`, `metricsSecurity` e `metricsCardinality`.

- `npm run typecheck`: aprovado.
- `npm run build`: aprovado; permanece aviso de chunks maiores que 500 kB.
- `git diff --check`: aprovado.
- Chrome automatizado: não iniciou; diagnóstico offline sem falha de instalação. Sessão de teste encerrada. Vite preview iniciou normalmente. Vite dev encontrou restrição de leitura do sandbox durante prebundle; não foi alterada a configuração do jogo para contornar o ambiente.

## Operação e riscos restantes

- Instalar dependências com `npm ci` incluindo opcionais nativas do sharp; Node mínimo 20.9. Testado localmente em Node 24.15/Windows. Publicação Linux/Railway não executada; lock inclui binários Linux opcionais.
- Publicar backend e frontend juntos. Qualquer host que não seja Vercel deve preservar a CSP no HTML e, preferencialmente, replicar o header configurado no Vercel. Não ampliar `img-src` para resolver links bloqueados.
- Proxy usa a proteção HTTP global existente. Por ser público e limitado por instância, ainda requer proteção volumétrica no edge e acompanhamento de CPU/memória/egress. Não é um serviço de autorização de arquivos privados; só encaminhe URLs públicas ou URLs de download cujo compartilhamento já seja permitido.
- Confiança restrita ao DNS/TLS dos provedores listados; sem hosts customizados nem redirects. URLs com tokens podem constar nos access logs do proxy de infraestrutura: redigir query strings também no edge. O logger da aplicação registra somente o caminho.
- Limites podem exigir redução/reenvio de imagens legítimas muito grandes. Falha, saturação ou provedor indisponível exibe fallback; remontar a tela permite nova tentativa. A UI não gera fila/retries ilimitados.
- Não houve download de mídia real dos provedores, uso de credenciais de produção ou validação E2E visual. Testes usam HTTP/Express reais locais e respostas de provedores controladas. A suíte completa não foi reexecutada; a falha preexistente de simulação registrada na etapa Socket não foi reavaliada.
- Esta CSP protege imagens/objetos/base; não constitui uma política completa de scripts contra XSS.

Próxima etapa, ainda não iniciada: observabilidade e erros silenciosos do mercado autônomo da IA.

Referências: [Sharp — limites do decoder](https://sharp.pixelplumbing.com/api-constructor/), [Sharp — regravação/metadados](https://sharp.pixelplumbing.com/api-output/), [OWASP — uploads](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html), [MDN — CSP img-src](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/img-src).
