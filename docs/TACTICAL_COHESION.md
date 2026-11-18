# Tactical cohesion

The shared calculator in `shared/teamCohesion.mjs` is used by the authoritative lineup save/match engine and the frontend preview. The server wrapper keeps the existing public import path. Formation validation, player availability, match strength and ownership rules are unchanged.

## Acquired cohesion vs adaptation

- `acquiredScore` is the team's learned baseline. Saving, loading or previewing a plan does not consume or improve it.
- `score` is current match readiness: acquired cohesion minus a temporary `adaptationPenalty`.
- `familiarity` remembers at most 32 learned configurations, initially seeded with the saved setup. It includes formation, ordered starters, position fit and strategic instructions; draft saves do not add experience entries.
- Mentality is a situational match instruction, not a separate learned system. Changing it alone leaves cohesion and familiarity unchanged, but still affects match tactics through the existing tactical profile.
- Formation changes, replacements, positional swaps and substantial strategic changes carry weighted adaptation costs. Adjacent instruction settings have smaller costs than structural changes. No cost is deducted from an already reduced score.
- Reverting to a remembered configuration restores its readiness without another penalty. Completed matches increase acquired cohesion and gradually reduce adaptation cost, retaining the existing staff bonuses. `stableMatches` records completed matches with the selected configuration, not the number of save clicks.
- Normalization clones and bounds the experience data. UI preview and room normalization preserve it across navigation/reload without mutating the original snapshot.

Legacy states without version 2 start from their existing saved score and current setup. Lost historical points/configurations cannot be reconstructed reliably, so migration does not invent a higher baseline or rewrite user saves automatically. The existing match-completion persistence path remains responsible for experience gains; this fix does not add a separate tactical training system or change player training.

## Regression coverage

`teamCohesionRegression.test.mjs` covers mentality cycling, reversible significant changes, repeated saves, JSON persistence, learned alternate configurations, immutable inputs, legacy migration and bounded history. `teamCohesionClient.test.mjs` checks server/preview parity and snapshot normalization. Socket.IO lineup coverage and a disposable desktop save/restart regression exercise the real save paths.

Final validation (2026-10-10): targeted regressions 60/60; server 1,578 passed, 0 failed/cancelled, 1 skipped (real Redis requires `TEST_REDIS_URL`); frontend 281/281; Chrome E2E 8/8; selected packaged desktop regressions 69/69. Typecheck, desktop build, encoding and diff checks passed. Empty preview slots retain their position instead of shifting the other starters. No real user save, cloud credentials or provider was accessed.
