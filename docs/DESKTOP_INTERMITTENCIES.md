# Desktop menu / Editor investigation — 2026-11-08

Only disposable profiles under `.tmp` were used. Real user saves, encrypted user credentials and cloud providers were not accessed. The six files implementing the club-color fix were preserved.

## Menu — cause identified and corrected

Phase diagnostics reproduced the failure after successful UI exit, reopen and preference checks: the final programmatic `ElectronApplication.close()` entered application shutdown with the renderer still alive. The local backend then returned `SHUTDOWN_TIMEOUT`, and the native failure dialog left the automation waiting until its unchanged 90-second test timeout. Closing through the UI had already destroyed that renderer and did not have the same ordering.

`desktop/main.mjs` now destroys the game renderer before requesting backend shutdown. This stops its HTTP/Socket.IO traffic; the utility worker remains alive while the server and local database drain pending work. The hidden peer transport is still disposed after backend close, not before it. `window-all-closed` no longer recursively requests quit while that drain is in progress. The shutdown failure path remains visible and logs only a bounded error code.

The menu regression verifies that the renderer has stopped when the application shutdown handler returns. It also retains native exit, profile/theme persistence and reopen checks. To avoid freezing a broken test build on a native dialog, the observer releases only that test's renderer if it detects the wrong ordering; it records `false`, and the assertion still fails. The unchanged 0.1.7 portable failed this assertion deterministically in about five seconds. The corrected source passed five consecutive runs. No timeout was increased, assertion removed or automatic retry added.

Existing local-database regressions verify that concurrent close calls await the same queued commit, the committed state survives reopen and the lock is released only after that work. These passed in all three 25-test Editor/database runs.

## Editor — historical failure not reproduced

The original image-test failure had no retained assertion detail because the earlier broad suite stalled afterward in native menu cleanup. Its precise cause cannot be reconstructed from the old log. Before changing the image test, twelve complete Editor runs passed 15/15 each. This is **NOT REPRODUCED**, not proof that the original failure was corrected.

The image test did contain incomplete resource ownership: it checked only HTTP status without consuming response bodies before restarting the backend. It now fully reads every image/error response and additionally validates PNG content, exact bytes after restart, different bytes for a replacement image, disappearance of the old asset, deletion of the new asset and empty media storage. No Editor application logic, upload validation, ownership policy or save format was changed. Diagnostic phases and error codes make any recurrence actionable.

Evidence remains local in `.tmp`: `desktop-intermittency-*`, `menu-source-*`, `menu-regression-*`, `editor-repro-*`, `editor-resource-fixed-*` and `desktop-fixed-full-*`. No evidence or personal data is packaged. Full packaged-suite confirmation is recorded in `DESKTOP_INSTALLER.md`.

## Packaged confirmation

The 0.1.8 portable passed three consecutive 69-test desktop selections: 69/69 each, zero failures/cancellations/skips. The complete `npm run test:desktop` then passed 70/70, including the real two-launcher WebRTC regression. The real P2P test also passed alone. Palette/Tailwind checks passed 19/19. Build/typecheck/encoding and diff checks passed. The six color-fix source files are byte-identical to their pre-investigation hashes. These successful repetitions confirm the current tested behavior; they do not retroactively identify the old Editor assertion failure.

Final Chrome E2E also passed 9/9, including club switching, light/dark/mobile colors, career persistence and the match flow. No application test process remained after cleanup. The portable is an unsigned internal test build; no commit, push, installation or cloud deployment was performed.

## Editor follow-up — reproduced fixture cleanup failure

The old image sequence was exercised with ordinary ephemeral ports (100 cycles), forced port reuse (20 cycles), forced garbage collection (30 cycles), the original Editor module (20 complete 15-test runs), and five complete 69-test desktop selections using that original module. All passed. Ten Editor/backend/media source modules were also byte-identical to the 0.1.7 packaged versions. None of these observations identifies the missing historical assertion.

A separate, concrete Windows cleanup failure was reproduced after a successful upload/read and backend shutdown. A controlled read-only file handle, held by an owned child process over a disposable fixture, briefly prevented deletion. The previous `fs.rm` call failed with `EBUSY` / `unlink` after 2 ms. This is a test fixture disposal failure, not evidence of failed Editor persistence or damaged user saves.

`desktop/tests/helpers/fixtureCleanup.mjs` now uses the documented bounded native filesystem cleanup: `maxRetries: 3`, `retryDelay: 25`, only after validating the absolute fixture path, resolved containment and absence of root/target junctions. The same controlled fixture was removed in 83 ms once the reader released it. Both investigations left no fixture behind. [Node's documented `fs.rm` options](https://nodejs.org/docs/latest-v24.x/api/fs.html#fspromisesrmpath-options) apply these retries to recursive filesystem contention; this does not rerun a test or retry an Editor operation.

Five regressions cover the exact cleanup options, refusal of root/outside/junction targets, propagation of persistent errors, a native file reader, and idempotent disposal. On Windows the native-reader regression first proves that both immediate removal and bounded cleanup fail while the reader remains held; the fixture contents remain intact. It then releases the reader and verifies successful removal and normal child-process exit. Persistent contention still fails. No product timeout, assertion or test concurrency was relaxed.

The Editor test now diagnoses backend shutdown separately from fixture disposal and retains all upload, restart, image-content, replacement and deletion assertions. Only test infrastructure changed; no Editor runtime, save format or color source was edited.

Classification: **controlled fixture cleanup failure — cause identified and corrected**. The original historical image-test occurrence remains **NOT REPRODUCED — diagnostics improved** because its exception was not retained. These are distinct findings; a synthetic file-reader reproduction does not retroactively establish the old occurrence's cause. Local evidence is under `.tmp/editor-investigation/`, excluded from version control.

Follow-up validation: three complete desktop runs passed **75/75 each**, zero failures/cancellations/skips (54.398 s, 54.504 s, 54.799 s), including all five new cleanup regressions and real two-launcher P2P. Palette/Tailwind checks passed **19/19**; typecheck, encoding (607 files, zero issues) and diff checks passed. All six color-source hashes match the values recorded before this follow-up. The sharing-profile and cleanup-test directories contain no residual profile; no investigation process remains. User save locations were not accessed. No executable, dependency, application-runtime or save-format change was required.
