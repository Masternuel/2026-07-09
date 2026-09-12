import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import reactPlugin from "@vitejs/plugin-react";
import { createServer } from "vite";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

let vite;
let preferences;

before(async () => {
  vite = await createServer({
    root: projectRoot,
    configFile: false, envFile: false,
    plugins: [reactPlugin()],
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  preferences = await vite.ssrLoadModule("/src/preferences/userPreferences.ts");
});

after(async () => {
  await vite?.close();
});

test("normaliza preferencias remotas desconhecidas para o schema vigente", () => {
  const normalized = preferences.normalizeUserPreferences({
    version: 99,
    theme: "light",
    notifications: {
      offers: false,
      matches: "nao",
      news: true,
      room: false,
    },
    profile: {
      locale: "en-US",
      region: "south-america",
    },
  });

  assert.deepEqual(normalized, {
    version: 1,
    theme: "light",
    notifications: {
      offers: false,
      matches: true,
      news: true,
      room: false,
    },
    profile: {
      locale: "pt-BR",
      region: "south-america",
    },
  });
});

test("aplica patches aninhados sem apagar categorias e resolve o tema do sistema", () => {
  const initial = preferences.normalizeUserPreferences(null);
  const next = preferences.applyUserPreferencesPatch(initial, {
    theme: "system",
    notifications: { matches: false },
    profile: { region: "south-america" },
  });

  assert.equal(initial.notifications.matches, true);
  assert.equal(next.notifications.offers, true);
  assert.equal(next.notifications.matches, false);
  assert.equal(next.notifications.room, true);
  assert.equal(next.profile.locale, "pt-BR");
  assert.equal(next.profile.region, "south-america");
  assert.equal(preferences.notificationCategoryEnabled(next.notifications, "matches"), false);
  assert.equal(preferences.notificationCategoryEnabled(next.notifications, "offers"), true);
  assert.equal(preferences.notificationCategoryEnabled(next.notifications, "news"), false);
  assert.equal(preferences.resolveThemePreference(next.theme, true), "light");
  assert.equal(preferences.resolveThemePreference(next.theme, false), "dark");
});

test("cache de prepaint guarda somente o tema e nunca o perfil", () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const values = new Map();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
      },
    },
  });

  try {
    preferences.writeCachedThemePreference("system");
    const cached = JSON.parse(values.get(preferences.USER_PREFERENCES_CACHE_KEY));
    assert.deepEqual(cached, { version: 1, theme: "system" });
    assert.equal(preferences.readCachedThemePreference(), "system");
    assert.equal("notifications" in cached, false);
    assert.equal("profile" in cached, false);
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else delete globalThis.window;
  }
});

test("configuracoes usam Auth como identidade e Firestore versionado como fonte oficial", async () => {
  const [
    contextSource,
    authSource,
    mainSource,
    shellSource,
    headerSource,
    sidebarSource,
    configSource,
    indexSource,
    notificationsSource,
    bridgeSource,
    appSource,
  ] = await Promise.all([
    readFile(path.join(projectRoot, "src/preferences/UserPreferencesContext.tsx"), "utf8"),
    readFile(path.join(projectRoot, "src/auth/AuthContext.tsx"), "utf8"),
    readFile(path.join(projectRoot, "src/main.tsx"), "utf8"),
    readFile(path.join(projectRoot, "src/components/layout/AppShell.tsx"), "utf8"),
    readFile(path.join(projectRoot, "src/components/layout/Header.tsx"), "utf8"),
    readFile(path.join(projectRoot, "src/components/layout/Sidebar.tsx"), "utf8"),
    readFile(path.join(projectRoot, "src/views/media/ConfigView.tsx"), "utf8"),
    readFile(path.join(projectRoot, "index.html"), "utf8"),
    readFile(path.join(projectRoot, "src/hooks/useNotifications.ts"), "utf8"),
    readFile(path.join(projectRoot, "src/hooks/useRealtimeNotifications.ts"), "utf8"),
    readFile(path.join(projectRoot, "src/App.tsx"), "utf8"),
  ]);

  assert.match(mainSource, /<AuthProvider>[\s\S]*<UserPreferencesProvider>/);
  assert.match(contextSource, /doc\(firebaseDb, 'users', identityUid\)/);
  assert.match(contextSource, /preferencesVersion:\s*USER_PREFERENCES_VERSION/);
  assert.match(contextSource, /setDoc\([\s\S]*\{ merge: true \}\)/);
  assert.match(contextSource, /replacePreferences\(previous\)[\s\S]*setStatus\('error'\)/);
  assert.match(authSource, /updateDisplayName[\s\S]*updateProfile\(user, \{ displayName \}\)/);
  assert.match(authSource, /user\.getIdToken\(true\)/);
  assert.match(shellSource, /useUserPreferences\(\)/);
  assert.doesNotMatch(shellSource, /const \[lightMode/);
  assert.match(configSource, /useAuth\(\)/);
  assert.match(configSource, /useUserPreferences\(\)/);
  assert.match(configSource, /Documento privado users\/\{uid\}/);
  assert.match(configSource, /Indisponível/);
  assert.doesNotMatch(configSource, /24 ms|Sessões ativas|Nível 12/);
  assert.doesNotMatch(headerSource, /<span>3<\/span>|Nível 12/);
  assert.doesNotMatch(sidebarSource, /<small>4<\/small>/);
  assert.doesNotMatch(headerSource, /:\s*2026/);
  assert.doesNotMatch(sidebarSource, /Objetivo: Libertadores|Upgrade concluído|<button className="club-switcher"/);
  assert.match(sidebarSource, /item\.key === 'match' && matchAvailable/);
  assert.match(notificationsSource, /notify = useCallback\(\([\s\S]*category: NotificationCategory/);
  assert.match(notificationsSource, /notificationCategoryEnabled\(settings\.preferences\.notifications, category\)/);
  assert.match(notificationsSource, /settings\.status !== 'saved'/);
  assert.match(bridgeSource, /socket\.on\('market:updated'/);
  assert.match(bridgeSource, /socket\.on\('news:post'/);
  assert.match(bridgeSource, /socket\.on\('match:started'/);
  assert.match(bridgeSource, /socket\.on\('match:halftime'/);
  assert.match(bridgeSource, /socket\.on\('match:finished'/);
  assert.doesNotMatch(bridgeSource, /socket\.on\('room:state'/);
  assert.match(appSource, /useRealtimeNotifications\(\{/);
  assert.match(indexSource, /bola-manager:user-preferences-cache:v1/);
  assert.match(indexSource, /prefers-color-scheme: light/);
});
