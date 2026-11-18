import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("feed limita contexto factual e preserva dados quando analise falha", async () => {
  const source = await readFile(path.join(projectRoot, "src/hooks/useNewsFeed.ts"), "utf8");

  assert.match(source, /const maxAiEditorials = 8/);
  assert.match(source, /editorialPosts\.slice\(0, maxAiEditorials\)\.map/);
  assert.match(source, /analysisFailureMessage\(analysisResult\?\.reason\)/);

  const failureBranch = source.slice(
    source.indexOf("} else if (analysisRequest) {"),
    source.indexOf("}).finally", source.indexOf("} else if (analysisRequest) {")),
  );
  assert.doesNotMatch(failureBranch, /setReplies\(\{\}\)|setTeamComment\(null\)/);
});

test("feed reutiliza requestId por intencao ate sucesso", async () => {
  const source = await readFile(path.join(projectRoot, "src/hooks/useNewsFeed.ts"), "utf8");

  assert.match(source, /publishIntentsRef = useRef\(new Map<string, string>\(\)\)/);
  assert.match(source, /replyIntentsRef = useRef\(new Map<string, string>\(\)\)/);
  assert.match(source, /body: \{ message: normalized, requestId \}/);
  assert.match(source, /body: \{ message: normalized, parentCommentId, requestId \}/);
  assert.match(source, /publishIntentsRef\.current\.delete\(intentKey\)/);
  assert.match(source, /replyIntentsRef\.current\.delete\(intentKey\)/);
});
