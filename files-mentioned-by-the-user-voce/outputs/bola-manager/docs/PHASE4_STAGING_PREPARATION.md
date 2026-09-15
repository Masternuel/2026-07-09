# Fase 4 — preparação de staging

Status: **preparação implementada para revisão; homologação operacional NÃO CONCLUÍDA**.
Nenhuma infraestrutura isolada foi fornecida ou acessada. A regressão local completa não ficou inteiramente verde: uma falha de subprocesso está registrada abaixo.

## O que está pronto

- Inventário de configuração por serviço e instruções externas em [STAGING_SECURITY_SETUP.md](STAGING_SECURITY_SETUP.md).
- `.env.staging.example` somente com campos vazios/comentários. `.env.local`, `.env.staging`, `.env.staging.local` e `.tmp/*` seguem ignorados.
- Preflight offline com `PASS`, `MISSING`, `INVALID`, `NOT CONFIGURED`; secrets aparecem apenas como configurados/não configurados. Nenhum arquivo de ambiente é carregado implicitamente.
- Confirmação por serviço vinculada ao alvo e, para Firebase/Cloudinary/Gemini, às credenciais de staging. Inventário de produção revisado, denylist e evidência de isolamento obrigatórios.
- Grupos independentes Redis, Firebase, mídia e IA. Sem comando de deploy, restore ou “executar tudo”.
- Redis: teste existente de adapter mais ensaio dos scripts Lua reais exportados (lock, rate limit, reserva/liberação de IA), com namespace exclusivo. O runner rejeita skips/falhas/cancelamentos.
- Firebase: criação de usuário desabilitado, documento transacional e objeto Storage de fixture, usando identidades explícitas distintas. Mídia: upload pelo serviço Cloudinary e rejeição de exclusão sem propriedade. IA: reserva obrigatória Redis, uma chamada real ao modelo escolhido e verificações de bloqueio posteriores.
- Run-id aleatório por etapa, recibo local antes das fixtures, recursos vinculados a ele e cleanup separado, condicionado à prova de propriedade.
- Backup/restore somente checklist de evidências, sem cópia fictícia ou restauração automática.

**Preparado não significa homologado:** os runners de integração foram implementados, mas não executados contra os serviços. O teste Socket.IO existente usa Redis real quando habilitado, porém Auth/store do harness continuam locais/sintéticos; não equivale a duas réplicas Railway com Firebase real. Probes Firebase Admin não validam regras de cliente. IAM, partições, contenção e headers pós-deploy permanecem pendentes.

## O que ainda preciso fornecer externamente

- [ ] Origin HTTPS próprio do frontend de staging.
- [ ] URL HTTPS própria do backend de staging.
- [ ] Ambiente Railway separado, duas réplicas e configuração exclusiva.
- [ ] Redis dedicado, sem produção nem outro DB da instância produtiva, com ACL/pub-sub/Lua/TLS adequados.
- [ ] `TEST_REDIS_URL` configurado por cofre/arquivo local ignorado, sem enviar segredo ao chat.
- [ ] `REDIS_URL` do backend/IA configurado separadamente e seu isolamento confirmado.
- [ ] Projeto Firebase separado com Auth e Firestore default ativos.
- [ ] Bucket Storage separado, regras/IAM revisados.
- [ ] Identidade runtime e identidade administrativa de testes distintas, exclusivamente de staging.
- [ ] Permissão para usuários desabilitados e fixtures com run-id.
- [ ] Conta/product environment Cloudinary isolado, com credenciais sem alcance produtivo; pasta sozinha não basta.
- [ ] Projeto/chave Gemini exclusivos com quota baixa, modelo habilitado e teto de custo efetivo.
- [ ] Origin CORS exato, frontend e backend correspondentes.
- [ ] Cadeia de proxy documentada e `TRUST_PROXY` definido com evidência, sem adivinhar hops.
- [ ] Logs redigidos/métricas e IDs das réplicas acessíveis aos responsáveis.
- [ ] Manifesto de isolamento revisado e inventário de produção conhecido para exclusão.
- [ ] Cópia real de backup de teste com timestamp, ID, componentes, integridade, retenção e criptografia.
- [ ] Destino de restore novo/vazio/isolado e procedimento aprovado.

Não enviar valores secretos no chat. Fornecer somente confirmação de provisionamento, nomes de variáveis, caminhos seguros e referências das evidências.

## Comandos

Com ambiente injetado por cofre:

```powershell
npm run security:staging:preflight
npm run security:staging:redis
npm run security:staging:firebase
npm run security:staging:media
npm run security:staging:ai
npm run security:staging:cleanup -- security-validation-<timestamp>-<random>
```

Para usar explicitamente `.env.staging` (nunca `.env.local`):

```powershell
node --env-file=.env.staging scripts/security-staging-preflight.mjs --write-isolation-template .tmp/staging-isolation.json
node --env-file=.env.staging scripts/security-staging-preflight.mjs
node --env-file=.env.staging scripts/security-staging-runner.mjs redis
node --env-file=.env.staging scripts/security-staging-runner.mjs firebase
node --env-file=.env.staging scripts/security-staging-runner.mjs media
node --env-file=.env.staging scripts/security-staging-runner.mjs ai
node --env-file=.env.staging scripts/security-staging-runner.mjs cleanup security-validation-<timestamp>-<random>
```

Substituir o argumento de cleanup pelo run-id efetivamente emitido. O template de isolamento nasce com confirmações falsas e não sobrescreve arquivo existente. Revisar conforme o guia antes de habilitar escrita. Cada comando valida os serviços do seu grupo novamente, inclusive cleanup.

## Segurança

- `STAGING_ENVIRONMENT=staging` e provas/evidências por serviço são necessárias; configuração desconhecida retorna `ISOLATION_UNCONFIRMED`.
- Alvos conhecidos/rotulados como produção bloqueados. Redis compara host/porta, cruzando aplicação/teste: trocar credenciais, esquema ou DB não contorna a denylist.
- `NODE_ENV=production` bloqueia escrita do harness; o backend remoto deve continuar em modo production. `RAILWAY_ENVIRONMENT_NAME`, `APP_ENV` ou `ENVIRONMENT` explicitamente produtivos também bloqueiam o runner.
- Sem inferência automática por hostname genérico. Aliases, IAM e isolamento de credenciais precisam de comprovação externa.
- Sem ADC ou emuladores no ensaio Firebase; JSON explícito de duas identidades separadas, no projeto esperado. Sem fallback silencioso de Redis obrigatório ou de provedor de IA aprovado como sucesso.
- Chaves/URLs/tokens/corpos/respostas e erros brutos do SDK não entram na saída dos runners. Subprocessos não herdam `NODE_OPTIONS`/hooks/debug flags. Diagnóstico registra código, sinal, duração e tamanho de stderr.
- Cleanup verifica mesmo alvo/credenciais do recibo. Redis usa lista exata de chaves e marcador de proprietário; Firestore verifica prova dentro de transação; Storage verifica prova e geração; Auth verifica UID/desabilitado/prova; Cloudinary reutiliza HMAC e caminho vinculados ao run-id/nonce.
- Nenhum wildcard, `SCAN`, `KEYS`, `FLUSH*`, exclusão de prefixo genérico ou cleanup geral automático. Compensações internas do upload existente permanecem restritas à própria fixture, após confirmação de isolamento.
- Interrupções/falhas parciais podem deixar fixtures; sem prova/recibo a limpeza falha fechada. Retenção do recibo é obrigatória até reconciliação.

## Validação local

Executada sem carregar `.env.local`, com `BOLA_ENV_FILES=false` e variáveis de integrações reais removidas do processo dos testes. Nenhum secret foi impresso.

| Grupo | Total | Passaram | Falharam | Cancelados | Skips |
| --- | ---: | ---: | ---: | ---: | ---: |
| Novos testes preflight/runner | 38 | 38 | 0 | 0 | 0 |
| Relacionados (Auth, IA, mídia, readiness, hardening) | 81 | 81 | 0 | 0 | 0 |
| Primitivas de infraestrutura | 8 | 8 | 0 | 0 | 0 |
| Servidor completo | 1378 | 1376 | 1 | 0 | 1 |
| Diagnóstico isolado de matchPersistenceResilience | 7 | 7 | 0 | 0 | 0 |
| Frontend | 194 | 194 | 0 | 0 | 0 |
| E2E Chrome | 4 | 4 | 0 | 0 | 0 |

Grupos se sobrepõem; não somar como casos únicos. A falha por arquivo altera o total de entradas reportadas pela suíte.

- Reporter sanitizado executado com testes locais: 38/38, zero falhas/cancelamentos/skips.
- Preflight sem staging: exit **2**, bloqueado como esperado; nenhuma chamada de integração.
- `npm audit`: exit **0**, **0 vulnerabilidades** em todas as severidades.
- Typecheck: exit **0**; verificação de encoding também passou.
- Build: exit **0**; permanece aviso preexistente de chunks acima de 500 kB.
- `git diff --check`: exit **0**; checagem adicional dos arquivos novos sem whitespace indevido ou padrões de credenciais reais.
- Redis real, Firebase/Auth/Firestore/Storage reais, Cloudinary e Gemini: **não executados**. Teste Redis da suíte padrão continua com um skip por ausência de `TEST_REDIS_URL`; não é sucesso de integração.

Logs locais ignorados: `.tmp/staging-preflight-tests.log`, `.tmp/staging-related.log`, `.tmp/staging-infrastructure.log`, `.tmp/staging-server.log`, `.tmp/staging-match-diagnostic.log`, `.tmp/staging-frontend.log`, `.tmp/staging-e2e.log`, `.tmp/staging-audit.json`, `.tmp/staging-preflight.log`, `.tmp/staging-reporter-check.log`, `.tmp/staging-typecheck.log`, `.tmp/staging-build.log`.

### Ocorrências de diagnóstico

1. **F01 anterior:** `mediaOwnership.test.mjs` permanece inalterado; passou nos grupos desta preparação. Falha intermitente de subprocesso anterior continua sem causa comprovada e não é declarada corrigida.
2. **Nova ocorrência local:** suíte completa falhou no processo de `server/tests/matchPersistenceResilience.test.mjs`, reportando somente `'test failed'`, após cinco casos do arquivo. Exit da suíte 1; sinal/stack da falha original não foram fornecidos pelo reporter padrão. Diagnóstico isolado TAP passou os sete testes, exit 0, sem mudanças. Causa não determinada; não atribuir a infraestrutura real nem declarar corrigido por execução isolada verde. Nenhum teste/timeouts/assertions foi alterado para mascará-la. Resultado vermelho original preservado.

## Git

- Branch: `codex/ci-e2e`.
- HEAD: `c7a134c44619f9601bf539ca286ede961ded39a1` (inalterado).
- Modificados: `.gitignore`, `package.json`, `server/tests/socketClusterRedis.test.mjs`.
- Novos desta preparação: `.env.staging.example`, os dois documentos de preparação/setup, os dois scripts de entrada, quatro módulos em `scripts/staging/`, `server/tests/securityStagingPreflight.test.mjs`, `server/tests/staging/redisLua.test.mjs`.
- Total de arquivos desta preparação: **14** (3 modificados, 11 novos). Diff rastreado: **24 inserções, 2 remoções**; incluindo novos: **1199 inserções, 2 remoções**. Novos arquivos ainda não aparecem no `git diff --stat` padrão; contagem não inclui o relatório operacional preexistente.
- `docs/PHASE4_SECURITY_VALIDATION.md` era preexistente e não rastreado; preservado, sem reescrever a conclusão operacional anterior. Arquivo externo preexistente não rastreado também preservado.
- Dependências/lockfile, código runtime da aplicação e `mediaOwnership.test.mjs`: sem alterações.
- Nada em stage. `.env.local`, arquivos de staging preenchidos, `.tmp/*`, logs, credenciais e arquivo externo não foram adicionados ao index.
- **Sem commit, push, deploy, acesso produtivo, uso de credenciais reais existentes ou restore.**

Parar para revisão e provisionamento externo. Não retomar a homologação operacional sem isolamento suficiente confirmado.
