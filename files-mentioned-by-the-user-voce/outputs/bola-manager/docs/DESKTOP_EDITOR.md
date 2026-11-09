# Editor local

O launcher reutiliza o Editor web existente. A entrada **Editor → Abrir Editor** funciona no perfil local, sem Google, Firebase ou Railway. Convidados P2P não têm acesso de edição.

## Recursos

- Ligas: dados, divisão, turnos, premiação e ativação.
- Clubes: dados, cores, estádio, reputação, orçamento e vínculos de liga.
- Jogadores: elenco completo, filtros/paginação, camisa, posição, idade, nacionalidade, destaque e atributos; overall calculado pelo motor existente.
- Torneios: formato, participantes, ida/volta e desempates.
- Criação, alteração, arquivamento e exclusão individual/em lote, com validação de referências.
- Imagens PNG/JPEG/WebP validadas e armazenadas no save local; substituição e remoção, sem upload para a nuvem.
- Importação/exportação JSON no formato do Editor antigo. Importação JSON do Editor faz merge; a recuperação de base pela entrada do menu continua oferecendo prévia e substituição explícita.
- Importação Brasfoot com os mesmos parser, prévia, limites, confirmação de importação parcial e processamento de escudos do Editor web. Sessões temporárias são removidas ao concluir/cancelar/fechar o aplicativo.

## Preservação

Os dados continuam em `userData/saves/career.bolasave`. A primeira alteração de catálogo por sessão cria backup integral em `saves/backups`; importações JSON também criam backup integral. A gravação usa a fila transacional e substituição atômica existentes. Falha na validação/gravação não publica alteração parcial.

Antes de modificar o catálogo, carreiras existentes são vinculadas a uma cópia imutável da base anterior. Mudanças do Editor alimentam **novas carreiras**; não reescrevem contratos, transferências, escalações ou partidas dos saves antigos. Imagens usadas por essas cópias são preservadas.

A API usa o token local do launcher e permite edição somente ao proprietário. Sessões multiplayer e partidas em andamento impedem mutações. Não há cache global de catálogo entre perfis.

## Limites

JSON exporta registros e URLs, não os arquivos binários de imagem. Para preservar integralmente imagens locais e carreiras, mantenha o backup nativo `.bolasave` junto da base. URLs externas antigas continuam nos registros, mas seus arquivos não são incorporados ao save. A exibição continua sujeita à política de imagens existente e à disponibilidade da origem. É possível substituir essas imagens por arquivos locais no Editor para uso offline.

Imagens locais não são transferidas automaticamente aos convidados P2P nesta etapa. A edição do catálogo permanece bloqueada durante sessões multiplayer.

O Editor continua com as quatro entidades existentes na versão web. Não foram inventados formulários de técnicos ou regras que o Editor antigo ainda não possuía. Também não há sincronização automática com a antiga conta Google.

## Validação

`npm run test:desktop` inclui CRUD, referências, autorização, paginação, importação, imagens, rollback e reinício, usando perfis descartáveis. `npm run build:desktop` gera a interface sem carregar arquivos `.env`.
