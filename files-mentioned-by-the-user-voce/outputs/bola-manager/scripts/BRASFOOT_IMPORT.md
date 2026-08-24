# Importador Brasfoot

O importador aceita uma pasta raiz do Brasfoot, a pasta `teams`, um arquivo `.ban`/`.cfg` ou o JSON normalizado antigo. Ele le os streams Java como dados binarios; nenhuma classe Java e carregada ou executada.

## Pelo Editor da Base

1. Entre no Bola Manager com uma conta autorizada a usar o Editor.
2. Abra **Editor da Base** e clique em **Importar Brasfoot**.
3. Arraste os arquivos da pasta `teams`, clique em **Selecionar arquivos** ou use **Selecionar pasta**.
4. Inclua `.ban` para times/jogadores, `.cfg` para ligas e `.png` para escudos.
5. Clique em **Analisar arquivos**, confira a previa e confirme a gravacao no Firebase.

O navegador nao recebe acesso permanente a pasta do computador: ele envia somente os arquivos escolhidos. O limite por lote e de 200 arquivos, 32 MB por arquivo e 256 MB no total. Se a pasta tiver mais itens, importe em lotes; registros com o mesmo ID sao atualizados sem duplicacao.

## Uso seguro

```powershell
node scripts/import-brasfoot.mjs --dry-run --input C:\Brasfoot --report .\brasfoot-report.json
```

`--dry-run` e o padrao. O relatorio lista sucessos, erros, duplicidades, arquivos corrompidos, jogadores senior/juniores e imagens encontradas. O commit e bloqueado se houver erro; `--allow-partial` libera explicitamente um commit parcial.

```powershell
$env:BRASFOOT_IMPORT_PROVIDED_KEY="..."
node scripts/import-brasfoot.mjs --commit --input C:\Brasfoot --report .\brasfoot-report.json
```

O commit exige tambem `BRASFOOT_IMPORT_ADMIN_KEY` no ambiente e Firebase Admin configurado. As colecoes gravadas continuam sendo `brasfootClubs`, `brasfootPlayers`, `brasfootLeagues` e `brasfootCups`.

Quando Cloudinary (`MEDIA_STORAGE_PROVIDER=cloudinary` + `CLOUDINARY_URL`) ou `FIREBASE_STORAGE_BUCKET` esta configurado, o commit envia os escudos encontrados e grava `crestImageUrl`/`crestImagePath` no clube. Falhas individuais ficam no relatorio e nao cancelam os dados. Sem provedor, o importador registra um warning claro. Use `--skip-assets` para desativar os uploads de proposito; camisas nao sao enviadas.

## Mapeamento binario

Os nomes ofuscados foram confirmados contra os campos serializados e os getters do jogo. Campos desconhecidos ou auxiliares ficam em `brasfootRaw` para auditoria.

### Clube (`e.t`)

| Campo | Significado | Destino |
|---|---|---|
| `a` | pais numerico | `country`, resolvido pelo `.cfg` |
| `b` | estado numerico | `state` |
| `c` | nivel do time, 1–25 | base de `reputation`/`overall`, convertida para 1–20 |
| `d` | referencia de arquivo | `brasfootSlug` e procura de imagens |
| `e` | nome | `name` |
| `f` / `g` | estadio / capacidade | `stadium` / `stadiumCapacity` |
| `h` / `i` | tecnico / nacionalidade | `manager` / `brasfootRaw.i` |
| `l` / `m` | elenco senior / juniores | jogadores com `brasfootRoster` |
| `n` | reputacao Brasfoot, 0–5 | preservada em `brasfootRaw` |
| `cor1` / `cor2` | cores hexadecimais | `colors` |
| `valid` | time habilitado | `active` |

O ID do clube usa o caminho do arquivo `.ban`, pois `id` nao e unico e `d` contem aliases antigos duplicados. Quando dois nomes normalizam para o mesmo slug, todos recebem um sufixo SHA-256 deterministico do caminho e nenhum clube desaparece. Nomes repetidos continuam apenas como warning: clubes de paises diferentes podem ter o mesmo nome.

### Jogador (`e.g`)

| Campo | Significado | Destino |
|---|---|---|
| `a` | nome | `name` |
| `b` / `j` | estrela / top mundial | `isStar` / `worldStar` |
| `c` / `d` | pais / idade | `nationality` / `age` |
| `e` | grupo de posicao 0–4 | GOL, lateral, ZAG, MEI ou atacante |
| `f` | titular quando 1 | `starter` |
| `g` / `h` | duas caracteristicas | nomes e atributos favorecidos |
| `i` | lado: direito/esquerdo | `preferredSide`; separa laterais e pontas |
| `hash` | fator interno 1–10 | somente `brasfootRaw`; nao e overall |

O ID do jogador prefere `tid` quando ele e um inteiro positivo valido. Sem `tid`, usa fingerprint SHA-256 de campos estaveis do registro; a posicao do jogador na lista nunca participa do ID. Reordenar o elenco, portanto, nao recria jogadores no Firestore.

Os arquivos `.ban` de times nao armazenam numero de camisa. Quando a origem nao traz `shirtNumber`, o importador atribui camisas unicas de 1 a 99 de forma deterministica e adequada a posicao (por exemplo, goleiros priorizam 1/12/22, centroavantes 9 e pontas 7/11). Uma origem JSON que informe `shirtNumber` continua tendo o valor preservado.

O formato nao contem uma grade de atributos 1–100. O `overall` parte do nivel do clube convertido de 1–25 para 1–20, com bonus de estrela/top mundial. As duas caracteristicas aplicam bonus deterministico:

| Caracteristica Brasfoot | Atributos Bola Manager favorecidos |
|---|---|
| Velocidade | `velocidade` |
| Finalizacao | `chute` |
| Drible | `drible` |
| Passe | `passe` |
| Armacao | `passe`, `nocao` |
| Desarme ou Marcacao | `defesa` |
| Cruzamento | `passe` |
| Cabeceio | `nocao`, `chute` |
| Resistencia | `nocao`, `defesa` |
| Colocacao, Defesa de penalti, Reflexo ou Saida do gol | `defesa`, `nocao` |

Os demais atributos sao completados pelo normalizador de forma deterministica. No fluxo JSON legado, numeros 21–100 continuam sendo convertidos por divisao por cinco e todos os valores ficam limitados a 1–20.

### Liga (`est.ConfigLigaType`)

Cada `.cfg` contem quatro configuracoes de divisao. O nome do arquivo resolve o pais numerico; `divisao`, `nome` e `nomeDivisao` formam ID/nome. Formula, desempates, grupos, acessos e rebaixamentos permanecem em `brasfootRaw`. O formato nao associa diretamente cada clube a uma divisao, portanto o importador nao inventa essa ligacao.

## Escudos e camisas

O detector procura `teams/escudos`, `escudosMini`, `camisas`, `camisas2` e `camisas3`. Primeiro tenta a referencia interna `d`, depois o nome real do `.ban`. No commit, somente escudos sao enviados. O caminho e validado de forma lexical e por `realpath`/`lstat`; arquivo irregular, symlink, junction ou qualquer fuga da raiz e recusado. Os caminhos relativos encontrados ficam em `club.assets` e no relatorio.

## Commit, falhas e reconciliacao

Cada commit cria `brasfootImports/<runId>` com `running`, progresso por colecao/assets e, ao final, `completed` ou `failed`. `brasfootImports/current` so muda depois da conclusao. O relatorio local e regravado no `finally`, inclusive quando a execucao falha.

Firestore nao oferece uma transacao unica para centenas de milhares de documentos e uploads no Storage. Portanto, a importacao e observavel e recuperavel, mas nao atomica: uma falha pode deixar batches de dados ja gravados. Escudos enviados pela execucao que falhou sao removidos em best effort e eventuais falhas de limpeza ficam no relatorio.

Para reconciliar, preserve o relatorio, corrija a causa e execute novamente a mesma origem. IDs deterministas tornam o processo idempotente por documento e sobrescrevem o subconjunto parcial. Antes de promover a base, confirme que o novo run ficou `completed`; investigue `cleanupFailures` manualmente no Storage. O importador nao apaga documentos antigos que deixaram de existir na origem.

## Limites

O parser valida magic/version `AC ED 00 05`, referencias, comprimentos e bytes restantes. Ha limites de bytes, profundidade, handles, arrays, strings e blocos. Proxy, excecao serializada e `Externalizable` inseguro sao rejeitados. Um stream nunca instancia classes da origem.
