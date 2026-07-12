# Entrada de dados Brasfoot

O arquivo real de importação deve ser salvo localmente como `data/brasfoot-normalized.json`. Ele é ignorado pelo Git e não deve ser publicado junto com o código.

O importador aceita apenas uma exportação autorizada em JSON com este formato de alto nível:

```json
{
  "version": "identificador-da-base",
  "clubs": [],
  "players": [],
  "leagues": [],
  "cups": []
}
```

Cada clube precisa de `id` e `name`. Cada jogador precisa de `id`, `clubId`, `name`, `position` e `age`. O contrato completo e a conversão de atributos ficam em `scripts/import-brasfoot.mjs`.

Valide antes de gravar:

```powershell
npm run import:brasfoot
```

O commit exige Firebase Admin e as variáveis temporárias `BRASFOOT_IMPORT_ADMIN_KEY` e `BRASFOOT_IMPORT_PROVIDED_KEY` com o mesmo valor. Não salve essas chaves no repositório. Arquivos `.dat` não são interpretados diretamente.
