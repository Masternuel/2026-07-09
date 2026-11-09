# Identidade do Bola Manager

A logo oficial fornecida pelo usuário fica em `public/assets/brand/bola-manager-logo.png`. O original é preservado; as versões menores mantêm transparência, proporção, desenho e cores, sem recorte ou filtros.

`node scripts/prepare-brand-assets.mjs` regenera as versões de interface (512 px), janela desktop (256 px) e favicon (64 px). O componente compartilhado `BrandLogo` apresenta a mesma marca nas entradas e cabeçalhos do jogo, sem substituir escudos dos clubes.

O empacotamento Windows gera o ICO multirresolução a partir do original e verifica a presença das imagens no pacote. A alteração não muda o identificador do aplicativo, o diretório de dados nem os saves. Um instalador já produzido não é atualizado retroativamente: é preciso gerar outro instalador para distribuir a nova identidade.
