# Entrada de dados Brasfoot

O importador aceita duas origens:

- a raiz do Brasfoot, a pasta `teams` ou um arquivo `.ban`/`.cfg` real;
- `data/brasfoot-normalized.json`, para integrações que já produzem o contrato JSON.

O JSON local é ignorado pelo Git e não deve ser publicado. Seu formato de alto nível é:

```json
{
  "version": "identificador-da-base",
  "clubs": [],
  "players": [],
  "leagues": [],
  "cups": []
}
```

Cada clube precisa de `id` e `name`. Cada jogador precisa de `id`, `clubId`, `name`, posição canônica e idade. Ligas recebem padrões para país, nível, divisão e estado ativo. O contrato e a conversão de atributos ficam em `scripts/import-brasfoot.mjs`.

Valide sem gravar:

```powershell
npm run import:brasfoot
npm run import:brasfoot -- --input C:\Brasfoot --report .\brasfoot-report.json
```

O commit exige Firebase Admin e `BRASFOOT_IMPORT_ADMIN_KEY`/`BRASFOOT_IMPORT_PROVIDED_KEY` com o mesmo valor. Não salve essas chaves no repositório. Arquivos `.dat` continuam não suportados; os arquivos binários reconhecidos são `.ban` e `.cfg` com header Java Serialization válido.

Consulte [scripts/BRASFOOT_IMPORT.md](../scripts/BRASFOOT_IMPORT.md) para segurança, escudos, status da execução e reconciliação de falhas parciais.
