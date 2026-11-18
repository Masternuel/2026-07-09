# Configuração Firebase — Bola Manager

O Firebase Web já está configurado em `.env.local`. Essas chaves identificam o aplicativo cliente; elas não substituem as credenciais administrativas do servidor.

## 1. Habilitar autenticação

No Firebase Console do projeto `bola-manager`:

1. Abra **Authentication → Sign-in method**.
2. Habilite **E-mail/senha**.
3. Habilite **Google** e escolha o e-mail de suporte.
4. Em **Settings → Authorized domains**, mantenha `localhost` e adicione o domínio final da Vercel.

Sem esses provedores habilitados, a interface exibirá `auth/operation-not-allowed` em português.

## 2. Criar o Firestore

1. Abra **Firestore Database** e crie o banco.
2. Escolha a região conscientemente: essa decisão não deve ser alterada depois e precisa considerar onde estarão os jogadores e o backend Railway.
3. Publique `firestore.rules` e `firestore.indexes.json`:

```powershell
npx firebase-tools login
npx firebase-tools use bola-manager
npx firebase-tools deploy --only firestore:rules,firestore:indexes,storage
```

As coleções `rooms`, `matches` e as bases pessoais em `catalogDatabases/{uid}` são bloqueadas para acesso direto do cliente. O Firebase Admin ignora essas regras, valida o UID no backend e mantém a autoridade do servidor. O catálogo Brasfoot global permanece apenas como origem de migração para a primeira cópia pessoal.

Firebase Storage e opcional. Para evitar a exigencia de plano, use Cloudinary: escudos, avatares e trofeus continuam passando pela rota administrativa, que valida PNG/JPEG/WebP (ate 5 MB), assina o envio no backend e associa a URL ao catalogo. O Firebase continua cuidando de Auth e Firestore.

## 3. Credencial Firebase Admin local

Não cole nem envie a chave privada em chat e não salve o JSON dentro deste projeto.

1. Gere uma conta de serviço no Firebase/GCP com acesso apenas ao necessário.
2. Salve o JSON fora do repositório.
3. Em `.env.local`, informe o caminho:

```dotenv
GOOGLE_APPLICATION_CREDENTIALS=C:\caminho-fora-do-projeto\bola-manager-admin.json
FIREBASE_USE_APPLICATION_DEFAULT=true
ALLOW_DEMO_AUTH=false
ROOM_STORE=firestore
```

Alternativamente, o servidor aceita `FIREBASE_SERVICE_ACCOUNT_JSON` ou o trio `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL` e `FIREBASE_PRIVATE_KEY`. Prefira o arquivo local para não duplicar a chave.

## 4. Railway

Defina como secrets/variables:

```text
NODE_ENV=production
CLIENT_ORIGIN=https://SEU-DOMINIO.vercel.app
FIREBASE_PROJECT_ID=bola-manager
FIREBASE_CLIENT_EMAIL=...
FIREBASE_PRIVATE_KEY=...
MEDIA_STORAGE_PROVIDER=cloudinary
CLOUDINARY_URL=cloudinary://API_KEY:API_SECRET@CLOUD_NAME
ROOM_STORE=firestore
ALLOW_DEMO_AUTH=false
MATCH_EVENT_DELAY_MS=800
```

Nunca use prefixo `VITE_` nas credenciais administrativas. O servidor recusa `ALLOW_DEMO_AUTH=true` em produção.

## 5. Vercel

Copie as variáveis `VITE_FIREBASE_*` do `.env.local` e configure:

```text
VITE_SERVER_URL=https://SEU-BACKEND.up.railway.app
```

Depois adicione o domínio da Vercel aos domínios autorizados do Firebase Auth e configure o mesmo domínio em `CLIENT_ORIGIN` no Railway.

## 6. Verificação

```powershell
npm run typecheck
npm run test:server
npm run build
npm run dev
```

O endpoint `GET /health` deve mostrar `firebase: "connected"` e `roomStore: "firestore"`. Se mostrar `disabled`/`memory`, a aplicação continua apenas no modo demonstração explícito.
