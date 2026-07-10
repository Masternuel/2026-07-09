# Bola Manager

Vertical slice full-stack de um jogo de gerenciamento de futebol brasileiro no navegador. A interface combina a densidade de uma central de operações com navegação rápida, atributos por estrelas e partidas narradas em texto.

## Rodar localmente

Requisitos: Node.js 20+ e npm.

```bash
npm install
npm run dev
```

O frontend abre em `http://localhost:5173` e o servidor em `http://localhost:3001`. Para executar somente uma camada:

```bash
npm run dev:client
npm run server:dev
```

Na tela inicial, entre com Google/e-mail para usar o fluxo autenticado ou escolha **Explorar modo demonstração**. O modo demo usa dados determinísticos e funciona sem credenciais administrativas.

## Fluxo demonstrado

- Firebase Auth real com e-mail, criação de conta, Google e modo demonstração explícito.
- Lobby privado conectado ao Socket.io, com código, escolha exclusiva de clube, managers, revisão monotônica, prontidão e reconexão.
- Central do clube com próximo jogo, classificação, tática, elenco, finanças, diretoria e imprensa.
- Elenco filtrável e ordenável com atributos de 1 a 10 estrelas e perfil detalhado.
- Editor tático dirigido por `lineupSlots` das formações, troca por arrastar, banco e instruções.
- Partida autoritativa no servidor com eventos Socket.io a cada 800 ms; o cliente adapta todos os eventos para a narração e recebe placar/estatísticas do servidor.
- Rotas de calendário, competições, mercado, finanças, infraestrutura, rankings, notícias, comissão, relatórios e configurações com dados e interações próprias.

## Comandos

```bash
npm run dev             # frontend + servidor
npm run build           # typecheck + build Vite
npm run typecheck       # TypeScript estrito
npm run test:server     # testes Node do backend
npm run server          # servidor de produção
npm run import:brasfoot # importação normalizada em dry-run
```

## Firebase e dados

O Firebase Web fornecido está em `.env.local`, ignorado pelo Git. Variáveis `VITE_FIREBASE_*` pertencem ao Firebase Client e entram apenas no bundle do frontend. Credenciais administrativas sem o prefixo `VITE_` pertencem exclusivamente ao servidor. Consulte [FIREBASE_SETUP.md](./FIREBASE_SETUP.md) para habilitar os provedores, criar o Firestore e configurar a conta de serviço sem expor a chave privada.

Com Firebase Admin configurado, o backend verifica o ID token no REST e no handshake Socket.io, deriva o UID no servidor e persiste salas em transações Firestore. Sem credenciais, o backend só inicia em memória quando `ALLOW_DEMO_AUTH=true` e nunca permite esse modo em produção.

O importador em `scripts/import-brasfoot.mjs` é administrativo e aceita entrada JSON já normalizada. Ele **não tenta interpretar o formato binário proprietário `.dat`**, cuja estrutura não foi documentada. Para integrar arquivos reais, implemente um adaptador autorizado que gere o contrato JSON validado pelo script e faça primeiro um `--dry-run`.

## Deploy

### Vercel (frontend)

- Root directory: raiz deste projeto.
- Build command: `npm run build`.
- Output directory: `dist`.
- Defina `VITE_SERVER_URL` com a URL pública do Railway e, se usados, os valores `VITE_FIREBASE_*`.
- `vercel.json` inclui o fallback de SPA.

### Railway (backend)

- Start command: `npm run server`.
- Health check: `/health`.
- Defina `CLIENT_ORIGIN` com o domínio Vercel, `PORT` (normalmente fornecido pelo Railway) e, opcionalmente, as credenciais Firebase Admin.
- O servidor Socket.io deve permanecer em um serviço com conexões persistentes; não o publique como função serverless da Vercel.

## Limites desta vertical slice

O projeto comprova o ciclo principal e apresenta as áreas dos 23 módulos, mas não implementa uma carreira de décadas, todos os regulamentos internacionais ou negociação completa entre contas reais. Os clubes e jogadores da demo são fictícios/sem licença.

O fluxo Auth → sala → prontidão → temporada → partida já está conectado. Nesta etapa, salas são persistidas no Firestore quando o Admin está configurado; a reprodução de uma partida em andamento ainda vive no processo Socket.io e precisa de histórico/sincronização persistente para sobreviver a reinícios ou múltiplas réplicas Railway.

Também permanecem como próximas etapas: catálogo Brasfoot real, engines completos dos 23 módulos, persistência de táticas/calendário/finanças, adapter Socket.io entre réplicas, balanceamento avançado e testes E2E com dois navegadores reais.
