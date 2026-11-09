# Fase 4: investigacao de subprocessos de teste

## Escopo

Instrumentacao opt-in, exclusiva do harness. Nenhum timeout, assertion, retry,
concorrencia ou arquivo de teste preexistente foi alterado nesta investigacao.
O comando `test:server` e os 14 arquivos da preparacao de staging foram preservados.
Sem conexoes reais, commit, push ou deploy.

## Reproducao e registros

```sh
node scripts/test-server-diagnostic.mjs identificador-unico
node scripts/test-server-diagnostic.mjs outro-identificador matchPersistenceResilience.test.mjs
```

Cada chamada executa uma unica vez, com a mesma lista ordenada e
`--test-concurrency=1` do comando existente. Identificadores repetidos sao
recusados para preservar o primeiro diagnostico. Nao existe retry automatico.

Registros locais ignorados em `.tmp/test-diagnostics/<identificador>/`:

- `result.json`: codigo/sinal, duracao, contagens, TAP completo, memoria do pai,
  ultimas linhas de stdout/stderr e eventual falha da instrumentacao.
- `stdout.log` / `stderr.log`: saida sanitizada da execucao.
- `<pid>.jsonl`: nascimento/encerramento dos filhos, PIDs, codigo/sinal, memoria
  antes/depois, concorrencia observada, recursos ativos por tipo, falhas e resumos.

O reporter padrao oculta detalhes de `ERR_TEST_FAILURE`; o novo reporter conserva
`exitCode`, `signal`, `failureType` e `cause` quando fornecidos pelo Node.
O filho de `node --test` usa protocolo serializado, nao TAP. O harness distingue
ausencia do resumo de um filho de TAP incompleto da execucao agregada: o pai pode
emitir TAP valido mesmo quando um filho morre antes do resumo.

Nao sao instalados handlers de `unhandledRejection`, `uncaughtException`, SIGTERM
ou SIGKILL que consumam falhas. `uncaughtExceptionMonitor` observa erros fatais;
rejeicoes tratadas pelo proprio test runner aparecem nos eventos de falha e nos
diagnosticos dele. Ausencia de evento nao prova ausencia de uma falha nativa.
SIGKILL nao pode produzir um registro de saida no filho: usa-se o sinal observado
pelo pai. Falha ao gravar telemetria emite um aviso fixo, sem substituir o exit code
original. O harness nao modifica `process.emit` nem listeners dos testes.

Mensagens passam pelo redator existente e pela remocao de valores de variaveis
sensíveis conhecidas; ambiente, argumentos completos e diagnostic reports do Node
nao sao gravados. Tokens sinteticos nos testes validam a sanitizacao. Nao carregar
credenciais reais para usar este runner. O wrapper desabilita env files e remove
variaveis das integracoes, staging e `NODE_OPTIONS` dos filhos.

## Inspecao de interferencia

- `matchPersistenceResilience.test.mjs`: stores e Firestore falso por caso,
  promessas pendentes deliberadas, timeout referenciado e liberado em `finally`.
  Servidor em `127.0.0.1:0`; hooks fecham servidor/socket. Nao utiliza arquivos
  temporarios fixos, workers, `process.exit` ou mudancas de ambiente globais.
- `mediaOwnership.test.mjs`: mapas/buckets/Firestore falsos por caso, upload
  externo substituido por mock, porta efemera e hooks de encerramento. Fixtures
  de imagem usam `sharp`; isso nao constitui evidencia de falha nativa.
- Grupo vizinho: `marketTransport`, `marketUi`, `matchHistory`,
  `matchSessionOwnership`, `matchSimulator`, `matchSpeed`, `metricsCardinality`,
  `metricsSecurity`, `modalViewport`. Servidores usam portas efemeras; timers de
  espera removem listeners e sao limpos quando resolvidos. O Vite de `marketUi`
  desliga env files, remove seus tres globals e fecha no hook `after`.
- Cada arquivo roda em processo separado. Mocks e globals locais nao sao
  compartilhados entre arquivos. Nao foi encontrada evidencia causal de colisao
  de porta, arquivo temporario ou estado Firebase/Redis compartilhado nesse grupo.
- Os subprocessos com falha deliberada dos testes do harness nao representam
  reproducao da falha original; o teste pai verifica esses codigos/sinais.
- Na rodada C3, `marketUi` encerrou com o processo esbuild ainda registrado no
  observador (PID 4612). Esse PID ja nao estava em execucao na verificacao seguinte.
  A biblioteca instalada explicitamente aplica `unref()` ao processo e aos pipes.
  Nao ha evidencia de que essa transicao causou a ocorrencia original. Os dois
  arquivos suspeitos encerraram sem filhos pendentes e apenas com os pipes do runner.

## Resultados

As cinco execucoes isoladas iniciais foram independentes, nao retries condicionados.

| Execucao | Testes | Pass | Fail | Cancel | Skip | Exit | Duracao (ms) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| A1 | 7 | 7 | 0 | 0 | 0 | 0 | 1541.1711 |
| A2 | 7 | 7 | 0 | 0 | 0 | 0 | 1045.6084 |
| A3 | 7 | 7 | 0 | 0 | 0 | 0 | 1033.4869 |
| A4 | 7 | 7 | 0 | 0 | 0 | 0 | 1021.6191 |
| A5 | 7 | 7 | 0 | 0 | 0 | 0 | 1035.8625 |
| B1 (11 arquivos vizinhos/alvo) | 68 | 68 | 0 | 0 | 0 | 0 | 21387.5844 |
| C1 (servidor) | 1388 | 1387 | 0 | 0 | 1 | 0 | 210844.1329 |
| C2 (servidor) | 1390 | 1389 | 0 | 0 | 1 | 0 | 211280.3397 |
| C3 (npm, servidor) | 1390 | 1387 | 2 | 0 | 1 | 1 | 216160.7441 |
| C4 (npm, servidor, apos correcao do harness) | 1391 | 1389 | 1 | 0 | 1 | 1 | 223729.2986 |

C1 tinha nove testes novos de diagnostico; C2/C3 tinham onze. A suite funcional
preexistente e a concorrencia nao mudaram. O skip e o teste Redis real, que exige
`TEST_REDIS_URL`. Uma verificacao adicional do observador de processos passou 7/7
(`phase4-probe-observer`, 1020.3053 ms).

### Falha propria do harness encontrada em C3

Os dois asserts que falharam pertencem exclusivamente a `testRunnerDiagnostics`.
Os subprocessos de fixture recebiam `--test-reporter` pela linha de comando e
tambem pelo `NODE_OPTIONS` usado para instrumentar `npm run test:server`.
Node rejeitou a duplicacao sem destinations correspondentes com
`ERR_INVALID_ARG_VALUE`. Exit 1, sem sinal. Nao e a falha original do jogo.

Diagnostico completo preservado em `phase4-C3`, antes de nova execucao. Correcao:
as fixtures removem `NODE_OPTIONS` herdado, pois ja configuram explicitamente seu
preload/reporter. Nenhum assert foi removido; nova regressao passa um reporter
herdado invalido e exige sucesso da configuracao explicita. Testes do harness:
12/12, exit 0, 910.0351 ms. A rodada C4 repetiu a mesma invocacao npm:
`testRunnerDiagnostics.test.mjs` passou, exit 0, sem sinal.

### Outra ocorrencia capturada em C4: recibo local de staging

`securityStagingPreflight.test.mjs`, caso "fixtures Redis registram apenas chaves
prefixadas e recusam comandos genericos": `EPERM`, errno -4048, em `renameSync`
de `scripts/staging/fixtures.mjs:33`. Filho PID 6192, exit 1, signal null,
354.2243 ms, um processo de teste concorrente. TAP agregado completo, sem
cancelamentos. Causa do bloqueio pelo sistema de arquivos ainda nao identificada.

A operacao le o recibo, grava `.json.write` com `wx` e tenta substituir `.json`.
O teste usa run-id aleatorio e chamadas sequenciais; nao foi demonstrada uma
colisao entre testes. O arquivo residual `.json.write` tem atributo Archive e
permanece preservado em `.tmp/security-staging/`. O hook preexistente removeu
somente o recibo `.json`. Nao foram alteradas permissoes, arquitetura, operacao
atomica, cleanup ou adicionado retry. Nao atribuir a antivirus sem evidencia.

Validacao final isolada de staging: 38/38, exit 0, 364.2459 ms. Isso nao corrige
nem invalida a falha C4. **C4 permaneceu vermelha; a nova rodada R2 consta abaixo.**

## Conclusao da ocorrencia original

**NÃO REPRODUZIDA — diagnóstico melhorado.**

`matchPersistenceResilience` e `mediaOwnership` passaram em todas as rodadas
completas; nas observadas, exit 0 e signal null. Nenhum ajuste foi aplicado a
esses arquivos ou a seu codigo de aplicacao. Nao ha causa comprovada para as
ocorrencias originais, nem regressao que autorize declara-las corrigidas.

Os logs originais da preparacao anterior, C3 e C4 continuam preservados. Os 14
arquivos de preparacao de staging permanecem identicos (SHA-256 verificado).
O acrescimo fica em cinco arquivos de runner/testes e neste documento.

## Validacao complementar

- Novos testes do diagnostico: 12/12, sem falha/cancelamento/skip.
- Staging local: 38/38, sem falha/cancelamento/skip (nao substitui C4).
- Relacionados: 81/81, sem falha/cancelamento/skip, 4540.3688 ms.
- Primitivas: 8/8, sem falha/cancelamento/skip, 104.1237 ms.
- `npm audit`: exit 0; zero vulnerabilidades em todas as severidades.
- Frontend: 194/194, zero falhas/cancelamentos/skips, exit 0, 106487.2197 ms.
- E2E Chrome: 4/4, exit 0, 19.1 s; Playwright local com dependencias simuladas.
- Typecheck: exit 0 (incluindo verificacao de encoding).
- Build: exit 0; aviso preexistente de chunks acima de 500 kB.
- `git diff --check`: exit 0; arquivos novos tambem verificados contra whitespace.

## Estado Git para revisao

- Branch `codex/ci-e2e`, HEAD `c7a134c44619f9601bf539ca286ede961ded39a1`.
- Modificados preexistentes: `.gitignore`, `package.json`,
  `server/tests/socketClusterRedis.test.mjs`; nenhum alterado nesta investigacao.
- Os 11 novos arquivos preexistentes da preparacao continuam intactos. Novos
  desta investigacao: `scripts/test-server-diagnostic.mjs`, os tres modulos em
  `scripts/test-diagnostics/`, `server/tests/testRunnerDiagnostics.test.mjs` e
  este documento. Total do escopo: 20 arquivos (14 staging + 6 diagnostico).
- Diff rastreado: +24/-2. Novos ainda nao constam no `git diff --stat` padrao.
- Index vazio. `docs/PHASE4_SECURITY_VALIDATION.md` e arquivo externo preexistente
  continuam fora do escopo. `.env.local`, `.tmp/*`, logs e credenciais nao foram
  adicionados ao index; nenhuma dependencia/lockfile foi alterado.

Homologacao real segue pendente: Redis/Lua, Firebase/Firestore/Storage, Cloudinary,
Gemini, IAM, contencao/particoes e headers apos deploy nao foram exercitados.
Nenhum commit, push, deploy ou conexao real foi realizado.

## Nova revisao solicitada: rodada R2

Rodada independente com o harness estabilizado, sem alteracoes adicionais de
codigo, timeout, asserts, concorrencia ou preparacao de staging. Apenas este
relatorio foi atualizado. Todos os logs anteriores foram preservados; novos
registros usam `.tmp/test-diagnostics/phase4-r2-*`.

| Execucao | Total | Pass | Fail | Cancel | Skip | Exit | Duracao (ms) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| R2-A1 | 7 | 7 | 0 | 0 | 0 | 0 | 1513.9219 |
| R2-A2 | 7 | 7 | 0 | 0 | 0 | 0 | 1121.2663 |
| R2-A3 | 7 | 7 | 0 | 0 | 0 | 0 | 1044.4613 |
| R2-A4 | 7 | 7 | 0 | 0 | 0 | 0 | 1044.3198 |
| R2-A5 | 7 | 7 | 0 | 0 | 0 | 0 | 1052.1446 |
| R2-B1 (11 arquivos) | 68 | 68 | 0 | 0 | 0 | 0 | 24952.9172 |
| R2-C1 | 1391 | 1390 | 0 | 0 | 1 | 0 | 260138.1433 |
| R2-C2 | 1391 | 1390 | 0 | 0 | 1 | 0 | 247665.5213 |
| R2-C3 (npm) | 1391 | 1390 | 0 | 0 | 1 | 0 | 250604.5393 |

C1/C2 usaram o runner opt-in; C3 executou `npm run test:server` com preload e
reporter via `NODE_OPTIONS`. Nenhum retry automatico. Os dois arquivos suspeitos
encerraram com exit 0 e signal null nas tres rodadas, sem resumo incompleto.
No C3, PIDs 30744 e 22464, respectivamente. O teste de staging encerrou com PID
19232, exit 0 e signal null.

Classificacao mantida: **NÃO REPRODUZIDA — diagnóstico melhorado.**
Os sucessos nao identificam a causa original nem demonstram que ela foi corrigida.
O `EPERM` da antiga C4 tambem nao reapareceu nesta rodada; permanece como ocorrencia
historica sem causa comprovada, sem alteracao de arquitetura ou cleanup.

Validacao final R2: harness 12/12 (1077.8788 ms), staging 38/38 (414.6654 ms),
relacionados 81/81 (5422.7393 ms), infraestrutura 8/8 (124.1241 ms); todos exit 0,
zero falhas/cancelamentos/skips. `npm audit`: exit 0, zero vulnerabilidades.
Frontend: 194/194, exit 0, 133698.8297 ms. E2E Chrome: 4/4, exit 0, 23.9 s.
Typecheck, build e `git diff --check`: exit 0; build manteve apenas o aviso
preexistente de chunks acima de 500 kB. Zero cancelamentos nos grupos finais.

Os 14 hashes SHA-256 da preparacao continuam iguais aos do inicio desta rodada
e da rodada anterior. Nenhum secret, arquivo de ambiente preenchido, log ou
arquivo externo entrou no index, que permanece vazio. Sem commit/push/deploy
ou integracao real. A validacao local atual esta verde, mas a homologacao real
e a causa dos episodios intermitentes anteriores continuam pendentes.

### Inventario dos 17 arquivos novos no escopo

- `.env.staging.example`
- `docs/PHASE4_STAGING_PREPARATION.md`
- `docs/STAGING_SECURITY_SETUP.md`
- `docs/PHASE4_TEST_DIAGNOSTICS.md`
- `scripts/security-staging-preflight.mjs`
- `scripts/security-staging-runner.mjs`
- `scripts/staging/fixtures.mjs`
- `scripts/staging/providers.mjs`
- `scripts/staging/redis-checks.mjs`
- `scripts/staging/reporter.mjs`
- `scripts/test-server-diagnostic.mjs`
- `scripts/test-diagnostics/preload.mjs`
- `scripts/test-diagnostics/records.mjs`
- `scripts/test-diagnostics/reporter.mjs`
- `server/tests/securityStagingPreflight.test.mjs`
- `server/tests/staging/redisLua.test.mjs`
- `server/tests/testRunnerDiagnostics.test.mjs`

## Fechamento da preparacao: validacao final antes do commit

Esta secao atualiza o estado de entrega; os registros anteriores permanecem
historicos, incluindo suas falhas. Base revisada:
`codex/ci-e2e`, `c7a134c44619f9601bf539ca286ede961ded39a1`.
Os 20 arquivos foram revisados; nenhuma alteracao adicional de codigo,
dependencia, timeout, concorrencia, retry ou assert foi necessaria.

| Grupo | Total | Pass | Fail | Cancel | Skip | Exit | Duracao (ms) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Harness diagnostico | 12 | 12 | 0 | 0 | 0 | 0 | 810.476 |
| Staging local | 38 | 38 | 0 | 0 | 0 | 0 | 335.4792 |
| Relacionados | 81 | 81 | 0 | 0 | 0 | 0 | 4192.9926 |
| Primitivas | 8 | 8 | 0 | 0 | 0 | 0 | 101.4923 |
| npm run test:server | 1391 | 1390 | 0 | 0 | 1 | 0 | 199072.8823 |
| npm run test:frontend | 194 | 194 | 0 | 0 | 0 | 0 | 98732.2261 |
| E2E Chrome | 4 | 4 | 0 | 0 | 0 | 0 | 17200 |

O unico skip continua exigindo `TEST_REDIS_URL`. Audit: zero vulnerabilidades;
typecheck, build e diff-check: exit 0. Build: 4.40 s, com aviso preexistente de
chunks acima de 500 kB. Logs ignorados: `.tmp/phase4-commit-final-*` e
`.tmp/test-diagnostics/phase4-commit-final-server/`. Nenhuma evidencia anterior
foi sobrescrita. Nao houve falha de escrita da instrumentacao.

- `matchPersistenceResilience` / `mediaOwnership`:
  **NÃO REPRODUZIDA — diagnóstico melhorado**. Arquivos inalterados; filhos
  PIDs 48552/2148, respectivamente, exit 0, signal null, concorrencia 1.
- EPERM de receipt: **NÃO REPRODUZIDA — causa desconhecida**.
  `fixtures.mjs` inalterado; nenhum dos episodios e declarado corrigido.
- Os 14 arquivos de staging mantiveram seus hashes. O template possui apenas
  nomes/campos vazios. Varredura sem credencial real identificada; literais de
  testes sao sinteticos. Arquivos locais, recibos, logs e os dois arquivos
  preexistentes fora do escopo permanecem excluidos da entrega.

Homologacao real continua **NAO VALIDADA**: Redis, Lua, Socket.IO multi-replica,
Firebase Auth, Firestore, Storage, Cloudinary, Gemini, IAM, contencao/particoes,
proxy, headers apos deploy, backup, restore e RPO/RTO. Nenhum deploy, conexao
real ou homologacao operacional foi iniciado.
