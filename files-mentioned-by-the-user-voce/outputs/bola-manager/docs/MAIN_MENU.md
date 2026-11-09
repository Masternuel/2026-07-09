# Menu principal

O menu autenticado organiza o acesso ao jogo sem substituir os motores de carreira,
catálogo ou multiplayer. O fluxo continua `entry → lobby → game`, com o Editor em
um estágio separado. `MainMenuView` compõe o estágio `lobby`.

## Responsabilidades

- `App`: autenticação, seleção da página e estado autoritativo da sala, por meio dos
  hooks existentes. A página selecionada é preservada ao voltar do Editor.
- `MainMenuLayout`: navegação, identidade, conexão e área de conteúdo responsiva.
- `mainMenuModel`: registro tipado das páginas, capacidades por modo, ordenação
  imutável de saves autorizados e interpretação dos metadados disponíveis.
- Páginas do menu: apresentação e encaminhamento para integrações existentes.
- `LobbyView`: criação, carregamento e preparação da carreira/sala. As opções de
  incorporação são adicionais; o contrato de renderização padrão permanece válido.
- `SaveManager`, `DesktopPeerPanel`, `ConfigView`, `EditorView` e componentes
  compartilhados continuam responsáveis por suas operações atuais.

A navegação interna não recarrega a página. Mudar de seção não seleciona uma sala
nem carrega uma carreira para obter estatísticas. O formulário de criação é
preservado enquanto o usuário navega pelas seções do menu.

## Capacidades reais

| Modo | Carreira | Multiplayer | Editor |
| --- | --- | --- | --- |
| Firebase | Saves da conta | Salas privadas por código | Editor existente, autorizado no servidor |
| Desktop local | Saves locais | P2P direto, convites privados | Editor existente com persistência local; bloqueado durante multiplayer/partida |
| Convidado P2P | Carreira do anfitrião | Sessão P2P existente | Indisponível |
| Demonstração | Sessão de demonstração | Indisponível | Indisponível |

As capacidades do menu são apresentação, não uma nova camada de autorização.
O backend continua validando identidade, participação, propriedade e permissões.
Não existem matchmaking, descoberta pública, relay/NAT garantido, integração Steam
ou migração automática de anfitrião neste menu.

## Dados e expansão

Perfil e preferências usam os contextos existentes. Estatísticas e histórico são
um resumo dos **metadados dos saves**, não conquistas globais da conta. Contadores
ausentes permanecem desconhecidos; zero é exibido somente quando informado.
Contadores parciais são identificados explicitamente. Não se inferem vitórias,
títulos, rodada atual ou histórico detalhado sem dados suficientes.

A entrada Editor descreve as funções disponíveis e distingue expansões futuras
de ações executáveis. Novas páginas devem ser registradas no modelo e compostas
separadamente, reutilizando os serviços existentes. Novos recursos de multiplayer
devem ser conectados a capacidades reais antes de receber botões ativos.

O acesso local, as importações e a preservação de carreiras estão documentados em
[DESKTOP_EDITOR.md](DESKTOP_EDITOR.md).

O menu respeita os temas existentes, foco de teclado, redução de movimento e o
piso de 12px para tipografia. O botão Sair pede confirmação: fecha a janela no
desktop e encerra a sessão no navegador, sem apagar saves.

## Validação local

```text
node --test server/tests/mainMenuUi.test.mjs
npm run test:frontend
npm run test:desktop
E2E_CHANNEL=chrome npm run test:e2e
npm run typecheck
npm run build
```

Os testes de navegador usam o harness local existente; não requerem credenciais
de staging, Firebase real ou acesso a dados de produção.

## Arquivos desta evolução

Criados:

- `src/views/MainMenuView.tsx`
- `src/components/menu/mainMenuModel.ts`
- `src/components/menu/MainMenuLayout.tsx`
- `src/components/menu/CareerOverview.tsx`
- `src/components/menu/MultiplayerPage.tsx`
- `src/components/menu/EditorAvailabilityPage.tsx`
- `src/components/menu/ProfilePage.tsx`
- `src/components/menu/HistoryPage.tsx`
- `src/components/menu/CreditsPage.tsx`
- `src/components/menu/ExitMenuModal.tsx`
- `src/styles/main-menu.css`
- `server/tests/mainMenuUi.test.mjs`
- `e2e/menu.spec.mjs`
- `desktop/tests/mainMenuElectron.test.mjs`
- `docs/MAIN_MENU.md`

Modificados:

- `src/App.tsx`
- `src/views/LobbyView.tsx`
- `src/components/lobby/SaveManager.tsx`
- `src/views/media/ConfigView.tsx`
- `src/main.tsx`
- `e2e/career.spec.mjs`
- `e2e/security.spec.mjs`

Os dois E2E existentes passam a localizar a entrada **Novo Jogo** no menu, em vez
da antiga aba **Criar sala**. Os asserts de carreira, mercado, partida e CSP são
preservados. Não foram modificados APIs, banco de dados, transporte P2P,
dependências ou infraestrutura nesta evolução.
