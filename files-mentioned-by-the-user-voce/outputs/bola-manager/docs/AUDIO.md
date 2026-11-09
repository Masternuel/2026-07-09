# Áudio do Bola Manager

O player usa um único HTMLAudioElement, montado em MusicProvider acima da navegação. Nos menus, Editor e telas de gerenciamento, mantém posição e faixa. Ao abrir a partida, pausa com fade; ao voltar, retoma, salvo pausa manual. Navegação não dispara aviso de música.

## Cadastrar músicas

1. Coloque arquivos em `public/audio/tracks/`. MP3 e WAV são compatíveis com o desktop Chromium; outros codecs dependem do navegador. Um MP4 precisa conter áudio real compatível, não apenas ter essa extensão.
2. Cadastre `{ id, title, artist, src, cover? }` em `src/audio/playlist.ts`. `src` deve ser caminho da aplicação, por exemplo `/audio/tracks/minha-musica.mp3`, nunca um caminho de disco do usuário. IDs são únicos.
3. Capa opcional PNG/JPG/WebP: coloque em `public/assets/audio/covers/` e defina `cover: '/assets/audio/covers/album.jpg'`. Esse caminho reutiliza a política segura de imagens do jogo. Sem capa, aparece o ícone musical.
4. Recompile o desktop/instalador para incluir os assets. Vite copia `public/` para o build, inclusive para uso offline.

Os nove MP3 fornecidos foram copiados sem alterar os originais. `onte - halcyon.mp4` contém HTML de erro 410 Gone, portanto não foi incluído. Envie um arquivo de mídia válido para cadastrar essa faixa.

Os arquivos musicais/capas estão ignorados no Git. São assets locais do usuário, não uma licença de redistribuição. Antes de publicar o jogo/instalador publicamente ou na Steam, obtenha autorização dos titulares ou substitua por músicas licenciadas. Não distribua essas gravações presumindo licença comercial.

## Preferências e reprodução

Configurações > Áudio: volumes geral, música, efeitos e interface; ativar música, shuffle e aviso de faixa. Ganho de categoria = volume geral × volume da categoria. Perfis antigos recebem defaults, sem modificar a carreira. Desktop salva pelo bridge já existente; web autenticada usa suas preferências Firestore; demo mantém apenas a sessão. Alterações são imediatas, escritas de sliders são agrupadas por 150ms (máximo 500ms) e serializadas; erros aparecem no status de sincronização.

Shuffle exclui a faixa atual quando há alternativas; o motor mantém histórico recente. Arquivos ausentes são ignorados em uma rodada limitada, sem loop infinito. Loading de mídia tem limite de 10s. Restrições de autoplay são liberadas pela primeira interação do usuário, sem simular playback. Aviso aparece somente após início confirmado de nova faixa, fica 5s e é substituído, não empilhado.

Não existe player fixo no rodapé: somente um popup temporário com faixa e artista. O popup não reserva espaço nem reduz a área do jogo; fechar o aviso não pausa a música. Volumes, ativação, shuffle e avisos continuam em Configurações > Áudio.

Fade-in 350ms, mudança de volume/faixa 220ms e pausa 180ms. Desativar música silencia imediatamente. Trocas cancelam transições antigas e utilizam o mesmo elemento, sem crossfade de duas músicas. Timers/listeners/media são encerrados no desmontar.

Efeitos/interface têm ganhos e sons breves de teste via Web Audio. Ainda não existe um banco de efeitos de estádio/ações; esses controles não inventam efeitos de partida. Futuras integrações devem reutilizar os ganhos centrais, não criar volume global paralelo.

## Validação

`server/tests/musicAudioClient.test.mjs`: motor, fades, autoplay, falhas, navegação, shuffle, avanço, concorrência, volumes e fila de preferências. `desktop/tests/musicElectron.test.mjs`: mídia real Chromium com WAV determinístico, navegação sem recriar player, notice/auto-hide, alterações rápidas, gravação no perfil descartável e restart, responsividade. Os testes não dependem das gravações privadas e não acessam o perfil real do usuário.

## Arquivos do recurso

- Motor, contexto e cadastro: `src/audio/musicManager.ts`, `MusicProvider.tsx` e `playlist.ts`.
- Interface: `src/components/audio/AudioSettingsPanel.tsx`, `MusicNotification.tsx`, `MusicOverlay.tsx` e `src/styles/audio.css`.
- Preferências: novo `src/preferences/preferenceWriter.ts`; integração em `userPreferences.ts` e `UserPreferencesContext.tsx`.
- Montagem/navegação: `src/main.tsx`, `src/App.tsx` e `src/views/media/ConfigView.tsx`.
- Regressões: novos testes de áudio mencionados acima; compatibilidade atualizada em `settingsPreferences.test.mjs` e `desktopImportUi.test.mjs`.
- Assets privados: regras em `.gitignore`. Nenhuma dependência nova é necessária.
