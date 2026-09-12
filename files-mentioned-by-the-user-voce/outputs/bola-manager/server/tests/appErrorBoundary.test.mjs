import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import reactPlugin from "@vitejs/plugin-react";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

let vite;
let AppErrorBoundary;
let AppErrorFallback;

before(async () => {
  vite = await createServer({
    root: projectRoot,
    configFile: false, envFile: false,
    plugins: [reactPlugin()],
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({ AppErrorBoundary, AppErrorFallback } = await vite.ssrLoadModule("/src/components/shared/AppErrorBoundary.tsx"));
});

after(async () => {
  await vite?.close();
});

test("fallback oferece recuperação sem expor detalhe técnico em produção", () => {
  const html = renderToStaticMarkup(React.createElement(AppErrorFallback, {
    error: new Error("segredo técnico"),
    componentStack: "at BrokenView",
    showTechnicalDetails: false,
    onRetry() {},
    onReload() {},
  }));

  assert.match(html, /O jogo encontrou um problema/);
  assert.match(html, /Seus saves continuam intactos/);
  assert.match(html, /Tentar novamente/);
  assert.match(html, /Recarregar jogo/);
  assert.doesNotMatch(html, /segredo técnico|BrokenView|Detalhes técnicos/);
});

test("detalhe técnico aparece somente quando explicitamente habilitado", () => {
  const html = renderToStaticMarkup(React.createElement(AppErrorFallback, {
    error: new Error("falha de renderização"),
    componentStack: "at BrokenView",
    showTechnicalDetails: true,
    onRetry() {},
    onReload() {},
  }));

  assert.match(html, /Detalhes técnicos/);
  assert.match(html, /falha de renderização/);
  assert.match(html, /BrokenView/);
});

test("tentar novamente limpa o erro e muda a chave de remontagem", () => {
  const boundary = new AppErrorBoundary({ children: React.createElement("div", null, "jogo") });
  boundary.state = {
    error: new Error("falha"),
    componentStack: "at BrokenView",
    retryKey: 4,
  };
  boundary.setState = (update) => {
    const patch = typeof update === "function" ? update(boundary.state, boundary.props) : update;
    boundary.state = { ...boundary.state, ...patch };
  };

  boundary.handleRetry();

  assert.equal(boundary.state.error, null);
  assert.equal(boundary.state.componentStack, "");
  assert.equal(boundary.state.retryKey, 5);
});

test("main instala a barreira acima da autenticação e CSS mantém tela visível", async () => {
  const [mainSource, cssSource, boundarySource, appSource] = await Promise.all([
    readFile(path.join(projectRoot, "src/main.tsx"), "utf8"),
    readFile(path.join(projectRoot, "src/styles.css"), "utf8"),
    readFile(path.join(projectRoot, "src/components/shared/AppErrorBoundary.tsx"), "utf8"),
    readFile(path.join(projectRoot, "src/App.tsx"), "utf8"),
  ]);

  assert.match(mainSource, /<AppErrorBoundary>[\s\S]*<AuthProvider>[\s\S]*<App \/>/);
  assert.match(cssSource, /\.app-error-screen\s*\{[^}]*min-height:\s*100vh/);
  assert.match(boundarySource, /componentDidCatch/);
  assert.match(boundarySource, /console\.error/);
  assert.doesNotMatch(boundarySource, /localStorage|sessionStorage/);
  assert.match(appSource, /stage === 'entry' \|\| !auth\.identity/);
});
