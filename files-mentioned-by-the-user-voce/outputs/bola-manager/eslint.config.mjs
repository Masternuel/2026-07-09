// Etapa 2 da auditoria: ESLint em modo relatorio. Todas as regras saem como "warn",
// entao `npm run lint` nao falha por estilo; erros de parse continuam falhando.
// Proximo passo: corrigir por pasta e promover a pasta limpa para "error" (sem autofix em massa).
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

const asWarnings = (config) => ({
  ...config,
  rules: Object.fromEntries(Object.entries(config.rules ?? {}).map(([name, value]) => {
    const [level, ...options] = Array.isArray(value) ? value : [value];
    const off = level === "off" || level === 0;
    return [name, off ? value : ["warn", ...options]];
  })),
});

export default [
  {
    ignores: [
      "node_modules/", "dist/", "dist-desktop/", "release-desktop/", ".tmp/", ".npm-cache/",
      "artifacts/", "coverage/", "public/", "screenshots/", "data/", "**/*.d.mts",
    ],
  },
  { linterOptions: { reportUnusedDisableDirectives: "warn" } },
  asWarnings({ ...js.configs.recommended, files: ["**/*.{js,mjs,cjs}"] }),
  {
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: { ecmaVersion: "latest", sourceType: "module", globals: { ...globals.node } },
  },
  { files: ["**/*.cjs"], languageOptions: { sourceType: "commonjs" } },
  ...tseslint.configs.recommended.map((config) => asWarnings({ ...config, files: ["src/**/*.{ts,tsx}", "*.ts"] })),
  asWarnings({
    files: ["src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: reactHooks.configs.recommended.rules,
    languageOptions: { globals: { ...globals.browser } },
  }),
  // Code that also runs in a page: Playwright evaluate callbacks and the WebRTC transport.
  {
    files: ["e2e/**", "src/**/*.test.{ts,tsx}", "desktop/tests/*Electron.test.mjs", "desktop/peer/transport.mjs"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
];
