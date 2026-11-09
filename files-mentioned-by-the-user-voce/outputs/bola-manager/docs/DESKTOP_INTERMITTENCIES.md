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
