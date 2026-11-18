# Etapa 17 — Encoding

Status: COMPLETO para os fontes do jogo. Saves existentes não foram migrados.

## Problema e causa

Literais já corrompidos estavam gravados em UTF-8: caracteres de uma leitura anterior como Latin-1/Windows-1252 reapareciam em Rankings, notícias do ciclo profissional e mensagens de segurança no cargo. O HTML já declarava UTF-8; trocar apenas o charset não corrigiria esses textos.

A verificação inicial encontrou 48 linhas suspeitas em cinco arquivos: três de produção e dois de testes. Um teste aceitava o travessão corrompido; outro procurava rótulos fixos com acentos corrompidos, deixando os rótulos corretos passarem.

## Correção

- Correção pontual dos literais, incluindo acentos, ordinais, separadores, legendas e textos acessíveis. Regras de negócio preservadas.
- `.editorconfig` define UTF-8 sem BOM para novas gravações.
- `npm run check:encoding` verifica UTF-8 estrito, BOM, NUL e assinaturas comuns de mojibake. Executa antes de `npm run build` e `npm run typecheck`; falhas de leitura também impedem aprovação.
- Varredura somente leitura de código, testes, scripts, documentação e configurações textuais da raiz. Não percorre bases, saves, dependências, artefatos de build, cache ou arquivos de ambiente; não segue links simbólicos.
- Testes de geração de notícias, serialização, mensagens de pressão/apoio e renderização SSR do histórico. O teste do Elenco agora exige o travessão correto e fornece o contexto de autenticação necessário; sua inicialização Vite não faz descoberta automática de dependências.

## Arquivos

- `server/domain/careerEvents.mjs`, `server/game/coachJobSecurity.mjs`: textos de carreira.
- `src/views/season/RankingsView.tsx`: histórico e gráfico.
- `scripts/check-encoding.mjs`, `.editorconfig`, `package.json`, `README.md`: prevenção e comando.
- `server/tests/sourceEncoding.test.mjs`, `careerEvents.test.mjs`, `coachJobSecurity.test.mjs`, `rankingsUi.test.mjs`, `playerAttributesUi.test.mjs`: regressões.

## Validação

- 70 testes aprovados: `sourceEncoding`, `careerEvents`, `coachJobSecurity`, `rankingsUi`, `playerAttributesUi` e `rankingTimeline`.
- A verificação detectou a corrupção antes da correção; depois, nenhum problema nos fontes cobertos.
- Casos específicos: UTF-8 inválido, dupla conversão, emoji, nomes internacionais, caixa alta legítima, BOM, NUL, localização por linha, exclusões e ausência de escrita.
- Typecheck e build aprovados. Continua o aviso preexistente de bundles maiores que 500 kB.
- `git diff --check` dos arquivos tocados aprovado. Alterações anteriores preservadas; sem commit, push ou deploy.

## Limites e próxima etapa

- Notícias ou nomes corrompidos já persistidos não são regravados automaticamente: uma migração exigiria identificar a origem e preservar textos legítimos. Novas notícias usam os literais corrigidos.
- O detector reconhece assinaturas comuns; não consegue reconstruir acentos já substituídos por `?` nem provar a correção semântica de todo texto.
- Validação de interface por HTML renderizado, sem inspeção visual de navegador nesta etapa. Suíte global e produção não executadas.
- Próxima etapa: funcionalidades visuais incompletas, conforme o roteiro da auditoria.
