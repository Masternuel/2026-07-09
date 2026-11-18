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
- **Gerado pelo jogo:** posição específica (ZAG/LD/LE, VOL/MC/MEI, ATA/PD/PE, distribuídas de forma estável), atributos, nota, valor de mercado, reputação e orçamento. A nota depende da divisão (Série A ≈ 13 de 20, Série D ≈ 8), do tamanho do estádio dentro da divisão e da idade (pico entre 23 e 30), com uma variação fixa por jogador: rodar de novo não muda os números.
- **Elencos curtos** (comuns na Série D) são completados com jogadores fictícios até 22, com pelo menos 2 goleiros; eles ficam marcados como `generated`.
- Ligas com mais de 24 clubes (Série D) ficam em turno único.

## Limites conhecidos

- A API não informa nacionalidade nem o pé no elenco: todos entram como "Brasil". Ajuste no Editor quando importar.
- Cores e escudos não vêm da API (escudos são marcas dos clubes); cada clube recebe uma cor provisória.
- O plano grátis pode não liberar a temporada atual em algumas consultas; nesse caso o comando mostra a mensagem da API (por exemplo, quais temporadas o plano permite).
- Confira os [termos da API-Football](https://www.api-football.com/terms) antes de distribuir uma base gerada junto com o jogo.
