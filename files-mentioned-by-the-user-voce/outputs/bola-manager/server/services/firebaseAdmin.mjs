const SERVICE_ACCOUNT_KEYS = [
  "FIREBASE_PROJECT_ID",
  "FIREBASE_CLIENT_EMAIL",
  "FIREBASE_PRIVATE_KEY",
];

function hasValue(env, key) {
  return Boolean(env[key]?.trim());
}

function explicitServiceAccount(env) {
  if (hasValue(env, "FIREBASE_SERVICE_ACCOUNT_JSON")) {
    let account;
    try {
      account = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON);
    } catch {
      throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON nao contem JSON valido");
    }
    return { account, source: "service-account-json" };
  }

  const suppliedCredentialKeys = ["FIREBASE_CLIENT_EMAIL", "FIREBASE_PRIVATE_KEY"]
    .filter((key) => hasValue(env, key));
  if (suppliedCredentialKeys.length === 0) return null;
  const supplied = SERVICE_ACCOUNT_KEYS.filter((key) => hasValue(env, key));
  if (supplied.length !== SERVICE_ACCOUNT_KEYS.length) {
    throw new Error("Credenciais Firebase explicitas estao incompletas");
  }
  return {
    source: "service-account-env",
    account: {
      projectId: env.FIREBASE_PROJECT_ID.trim(),
      clientEmail: env.FIREBASE_CLIENT_EMAIL.trim(),
      privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    },
  };
}

function wantsApplicationDefault(env) {
  return String(env.FIREBASE_USE_APPLICATION_DEFAULT ?? "").toLowerCase() === "true"
    || hasValue(env, "GOOGLE_APPLICATION_CREDENTIALS");
}

export async function initializeFirebaseAdmin(env = process.env) {
  const serviceAccount = explicitServiceAccount(env);
  const useApplicationDefault = wantsApplicationDefault(env);
  if (!serviceAccount && !useApplicationDefault) {
    return {
      enabled: false,
      app: null,
      auth: null,
      firestore: null,
      credentialSource: null,
      reason: "credentials-not-configured",
    };
  }

  const { applicationDefault, cert, getApps, initializeApp } = await import("firebase-admin/app");
  const { getAuth } = await import("firebase-admin/auth");
  const { getFirestore } = await import("firebase-admin/firestore");
  const credential = serviceAccount ? cert(serviceAccount.account) : applicationDefault();
  const options = { credential };
  const projectId = serviceAccount?.account.projectId || env.FIREBASE_PROJECT_ID?.trim();
  if (projectId) options.projectId = projectId;

  const app = getApps()[0] ?? initializeApp(options);
  return {
    enabled: true,
    app,
    auth: getAuth(app),
    firestore: getFirestore(app),
    credentialSource: serviceAccount?.source || "application-default",
    reason: null,
  };
}
