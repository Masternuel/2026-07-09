# Atualizar a base pela API-Football (Série A a D)

`npm run catalog:update` baixa os clubes e elencos das Séries A, B, C e D da [API-Football](https://www.api-football.com) e gera uma base do Bola Manager pronta para importar. O jogo continua offline: a internet só é usada nesse comando, no seu PC.

## Uma vez só

1. Crie uma conta grátis em <https://dashboard.api-football.com/register> e copie a chave em **Account → My Access**.
2. Em `.env.local` (na pasta do projeto), adicione a linha `API_FOOTBALL_KEY=sua-chave`. O arquivo não vai para o Git e a chave nunca é exibida pelo comando.

## Cada atualização

```
npm run catalog:update
```

- O plano grátis permite 100 consultas por dia. São uma consulta por divisão e uma por clube (cerca de 125 no total), então a primeira atualização completa leva **dois dias**: se a cota acabar, o comando para e avisa quantos elencos já baixou; rode de novo no dia seguinte e ele continua de onde parou (as respostas ficam em `.tmp/api-football-cache`).
- Para gerar mesmo com elencos faltando: `npm run catalog:update -- --partial` (os que faltam viram elencos gerados).
- Outra temporada: `--season 2025`. Sem completar elencos com jogadores gerados: `--no-fill`.

O arquivo sai em `.tmp/api-football/bola-manager-base-<temporada>.json`. Importe no jogo em **Editor da Base → Selecionar base exportada**. Carreiras já existentes continuam com a base antiga; a nova vale para carreiras novas.

## Como os dados são montados

- **Da API:** nome do clube, estádio, cidade e capacidade; nome, idade, número e posição geral (goleiro/defensor/meio/atacante) de cada jogador.
- **Também da API:** a classificação final da temporada, que define a força de cada clube dentro da divisão (o campeão fica mais forte que o lanterna; na Série D, pela posição no grupo).
- **Gerado pelo jogo:** posição específica (ZAG/LD/LE, VOL/MC/MEI, ATA/PD/PE, distribuídas de forma estável), atributos, nota, valor de mercado, reputação e orçamento. A nota depende da divisão (Série A ≈ 13 de 20, Série D ≈ 8), da posição do clube na tabela (e, em menor peso, do tamanho do estádio) e da idade (pico entre 23 e 30), com uma variação fixa por jogador: rodar de novo não muda os números.
- **Elencos curtos** (comuns na Série D) são completados com jogadores fictícios até 22, com pelo menos 2 goleiros; eles ficam marcados como `generated`.
- Ligas com mais de 24 clubes (Série D) ficam em turno único.

## Limites conhecidos

- A API não informa nacionalidade nem o pé no elenco: todos entram como "Brasil". Ajuste no Editor quando importar.
- Cores e escudos não vêm da API (escudos são marcas dos clubes); cada clube recebe uma cor provisória.
- **O plano grátis só libera as temporadas 2022 a 2024** (verificado em 18/11/2026). Com ele, use `--season 2024`: as divisões e a classificação são de 2024, mas os elencos são os atuais (essa consulta não depende de temporada). Para as divisões da temporada atual, é preciso um plano pago.
- As notas dos jogadores não usam desempenho real: dentro do mesmo clube, um titular pode sair com nota parecida com a de um reserva. Ajuste os destaques no Editor.
- Confira os [termos da API-Football](https://www.api-football.com/terms) antes de distribuir uma base gerada junto com o jogo.

## Incluir a base no instalador

```
npm run catalog:update -- --season 2024 --bundle
npm run installer:windows
```

`--bundle` copia a base para `desktop/data/base-brasil.json` (fora do Git). O instalador gerado em seguida já começa perfis novos com os clubes reais. Quem já tinha o jogo instalado continua com a base atual e pode trocar em **Editor da Base → Usar base do Brasil incluída** (as carreiras existentes são preservadas). Rodando pelo código-fonte (`npm run desktop`) e nos testes, a base incluída não é usada.
