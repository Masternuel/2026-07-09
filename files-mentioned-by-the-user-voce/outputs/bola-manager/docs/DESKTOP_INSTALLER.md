# Windows installer — local test build

Build on Windows x64 with the project dependencies installed:

```sh
npm run installer:windows
```

The resulting offline installer is `release-desktop/Bola-Manager-Setup-<version>-x64.exe`. The player does not need Node.js, npm or an external game server to run the installed launcher. The existing direct WebRTC P2P mode remains limited to reachable LAN/VPN networks; Steam relay/internet NAT traversal is not added by packaging.

The NSIS wizard installs for the current user without elevation, allows selecting the installation directory and creates desktop/Start Menu shortcuts. It does not automatically start the game at the end of installation. Saves remain in Electron's user-data directory, outside the installation directory; uninstall is configured not to delete that data. Automated updates and code signing are not configured. This unsigned test build may trigger Windows reputation warnings. Do not disable antivirus protections.

## Run without installing

```sh
npm run portable:windows
```

This uses the same guarded package and produces `release-desktop/Bola-Manager-<version>-portatil-x64/`. Open `Bola Manager Desktop.exe` inside that folder: no installation, elevation or shortcuts are required. Keep the entire folder together; the executable needs its adjacent runtime/resources files. Existing portable output is never overwritten automatically.

Saves, preferences and protected Gemini settings still use the existing Windows user-data directory, not the portable application folder. This preserves compatibility with the installed version and does not include personal data or credentials in the portable copy. Moving the folder to another computer does not move saves or encrypted credentials. This is an unsigned internal test build with the same release limitations as the installer.

Portable 0.1.5 validation (2026-10-10): build/typecheck and archive inspection passed (11,651 entries, zero forbidden paths). Selected desktop/package regressions passed against the executable in the final portable folder: 68 passed, 0 failed/cancelled/skipped. Native branding, import, Editor, menu, audio and protected Gemini settings used disposable profiles only, without provider calls or accessing the real user profile. Five packaged runtime/renderer files were also byte-identical to current source/build. The known intermittent real two-launcher P2P host-shutdown behavior was not retested or declared fixed in this packaging-only task.

### Tactical cohesion portable update — 0.1.6, 2026-10-10

- Saving or cycling mentality no longer repeatedly consumes acquired cohesion. Significant formation/lineup/strategy changes retain a temporary adaptation cost; returning to a learned setup restores its familiarity. Legacy saves preserve their existing score, without inventing historical refunds. See `TACTICAL_COHESION.md`.
- Final validation: targeted 60/60; server 1,578 passed, 0 failed/cancelled, 1 skipped (requires real `TEST_REDIS_URL`); frontend 281/281; Chrome E2E 8/8; selected packaged desktop regressions 69/69. Typecheck, desktop build, encoding and diff checks passed. The known real two-launcher P2P host-shutdown case remains outside this regression selection.
- Archive inspection passed: 11,652 entries, zero forbidden paths. Shared calculator, server wrapper, lineup handler and renderer entry were byte-identical to current source/build. No saves, credentials or real provider access were included.
- Packaging completed its build/archive guard, but Node's final directory rename returned `EPERM`. After the packaging process exited, a checked native PowerShell move completed the final folder without overwriting outputs or killing application processes. The packaged tests then used that final folder. The packager itself was not changed speculatively.
- Artifact: `Bola-Manager-0.1.6-portatil-x64/Bola Manager Desktop.exe`, product version 0.1.6.0, SHA-256 `AC8BD87CA787C7BA9001FD4CACC885CCABF8096FAECDDD1F0BD17C1643468348`. It remains unsigned. Close the older game before starting this executable because both versions share the existing user-data location and single-instance lock. Keep the complete folder together.
- No installation, commit, push or cloud deployment was performed. Earlier outputs and real user saves were preserved. Existing release limitations below still apply.

### Club identity portable update — 0.1.7, 2026-11-08

- Selected club colors now drive the canvas, stadium atmosphere, side/top/mobile menus and active navigation. Legacy chromatic colors retain their hue, while text accents are adjusted independently for contrast. Existing Editor overrides and user saves remain untouched. See `CLUB_THEMES.md` for the full validation and its known test-process limitations.
- Typecheck, desktop build, encoding and archive guard passed: 11,652 entries, zero forbidden paths. All 22 packaged renderer/assets files matched the current build byte-for-byte.
- Node's final portable-directory rename again returned `EPERM` after successful packaging. A checked native PowerShell move completed the final folder after the packaging process exited, with no overwrite or unrelated process termination. This does not count as an exit-0 execution of the original packaging command; the packager was not modified speculatively.
- Artifact: `Bola-Manager-0.1.7-portatil-x64/Bola Manager Desktop.exe`, product version 0.1.7.0, SHA-256 `D6DFEB429F8BCAED98C94E453EB5F1D5B7F0E723DCFE820B1B929FF2BA9336E9`. Unsigned internal test build. Close the older game before starting this executable and retain the whole folder.
- The broad desktop check is not fully green: Editor images failed in one attempt but passed in a complete isolated Editor run and the confirmation run; the native menu test passed alone but timed out in both broad attempts. Original evidence was retained and no unrelated tests or runtime behavior were changed to hide the failures. No real save/provider/credential was accessed. No installation, commit, push or cloud deployment was performed.

### Shutdown / test stability portable update — 0.1.8, 2026-11-08

- Programmatic quit now closes the game renderer before draining the backend, avoiding active renderer connections keeping shutdown open. The backend/database still finish pending writes before the worker is stopped. Recursive `window-all-closed` quit is guarded while draining. No save format, catalog logic or color source file changed.
- Regression: the unchanged 0.1.7 executable fails the renderer-order assertion; corrected source passed five consecutive runs. The 0.1.8 executable passed three consecutive 69/69 selections and the complete `npm run test:desktop` passed 70/70, including real two-launcher P2P. Palette/Tailwind checks passed 19/19. See `DESKTOP_INTERMITTENCIES.md` for scope and evidence.
- The Editor image test now fully consumes responses and checks image content across restart/replacement/deletion. Its historical failure was not reproduced in twelve complete pre-change Editor runs, and is not declared causally resolved. All strengthened Editor checks passed in the packaged runs. No assertions were removed or timeouts increased.
- `npm run portable:windows` exited 0. Typecheck/encoding/build passed; archive guard checked 11,652 entries with no forbidden paths. Five packaged runtime/renderer entry files matched current source/build byte-for-byte. No manual directory move was required for this build; this does not identify or claim a fix for earlier packaging `EPERM` occurrences.
- Final Chrome E2E passed 9/9, including the color regression. Color source hashes remain identical to 0.1.7.
- Artifact: `Bola-Manager-0.1.8-portatil-x64/Bola Manager Desktop.exe`, product version 0.1.8.0, SHA-256 `498E589EA66AF685CABDB7D253E4D5069A41BE4BD63DBD037CD6AD09FDC1FC8D`. Unsigned internal test build. Close the older version first and retain the whole folder. Older outputs were preserved; real user saves were not accessed. No installation, commit, push or cloud deployment was performed.

## Package boundaries

- Uses the pinned Electron 44.6.0 distribution and electron-builder 26.15.3, with no automatic publishing or signing credential discovery.
- The multi-size Windows icon is generated from the approved original logo in `public/assets/brand/bola-manager-logo.png`, not downloaded from an external service.
- Builds the renderer without loading dotenv files or embedding inherited cloud endpoints/credentials.
- Includes an explicit runtime allowlist: compiled frontend, desktop engine/transport, server/shared modules and the catalog/import helpers required by their static imports.
- Excludes local `.env*`, saves, test fixtures, logs, credential files, source evidence and operational reports. An `afterPack` archive inspection rejects forbidden paths and verifies required runtime modules before building the installer.
- Keeps native sharp platform binaries unpacked; the real packaged-launcher regression verifies they load with the embedded Electron runtime.
- Generated installers, icons, caches and evidence are ignored by Git.

## Initial installer validation — 0.1.0, 2026-10-07

- Installer build and typecheck passed; source encoding and final diff checks passed.
- Desktop regressions: 28 passed, 0 failed/cancelled/skipped, including two packaging-policy tests.
- The real two-launcher WebRTC regression also passed against `release-desktop/win-unpacked/Bola Manager Desktop.exe`: authenticated sharing, roster read, authorization, host-only saves, UI reload, fail-closed disconnection and save reload after restart.
- Packaged UI smoke: startup, local lobby, career form and P2P controls; no browser errors observed.
- The NSIS installer file was generated and its package verified. Installation/uninstallation into the user's actual Windows profile was not performed; no real user save was opened or deleted. QA used only disposable profiles.
- The artifact is unsigned, version 0.1.0, 136,365,160 bytes, SHA-256 `7253bfed98667e13fe9be036e6b57a1fed9793ad842b8e202e48c89edeb7b3e7`.

## Main-menu installer update — 0.1.1, 2026-10-07

- Rebuilt the renderer and Windows installer with the modular main menu. Only application version metadata changed in package files; no dependency versions or runtime behavior changed in this packaging step.
- Application ID, product name, per-user installation and save directory remain unchanged. The 0.1.0 installer was retained as a separate artifact.
- Archive inspection verified 11,629 entries with no local env, saves, credentials or test fixtures. Packaged HTML/JavaScript/CSS were byte-identical to the current desktop build, with the new menu present.
- Desktop suite: 29 passed, 0 failed/cancelled/skipped. Both menu and two-launcher WebRTC tests used `release-desktop/win-unpacked/Bola Manager Desktop.exe`. Profile/theme persistence, confirmation/cancellation/native exit, host-only saves and fail-closed disconnection passed.
- Packaged UI smoke confirmed the new main menu, career form and P2P controls without browser errors. Its disposable profile, process and debugging listener were removed after normal exit.
- Installer/typecheck/encoding/diff checks passed. Actual installation, upgrade and uninstallation in the user's Windows profile were not performed; existing user saves were not accessed.
- Artifact: `Bola-Manager-Setup-0.1.1-x64.exe`, 136,374,392 bytes, SHA-256 `94ff634120d42161e1f210d92eac2c002cae03a1842e122add329fcb975c09f8`.
- Authenticode status remains `NotSigned`; this is an internal test build, not a signed public release.

To repeat the packaged regression from PowerShell after building:

```powershell
$env:BOLA_DESKTOP_TEST_EXECUTABLE = (Resolve-Path 'release-desktop/win-unpacked/Bola Manager Desktop.exe').Path
try { node --test --test-concurrency=1 desktop/tests/*.test.mjs } finally { Remove-Item Env:BOLA_DESKTOP_TEST_EXECUTABLE }
```

## Local Editor installer update — 0.1.2, 2026-10-08

- Includes the completed local Editor, JSON catalog recovery, local images and the original Brasfoot import flow. Application ID, product name and user-data directory are unchanged; older installers remain available as separate artifacts.
- Only root application version metadata changed in package files. Dependency versions were not changed in this packaging step. The archive guard now explicitly requires all local Editor/import runtime modules.
- Package inspection verified 11,633 entries without local env, saves, credentials or test fixtures. All 9 compiled frontend files and 5 Editor/import runtime modules were byte-identical to the current source/build.
- Desktop suite against the packaged executable: 57 passed, 0 failed/cancelled/skipped. The new Electron regression checks Editor edits, images, JSON export, Brasfoot session creation/cancellation, native backups and complete restart; existing native import, menu and two-launcher P2P regressions also passed.
- Typecheck, encoding, desktop build, installer generation and final diff check passed. Test profiles were disposable; installation/upgrade/uninstallation in the real Windows user profile were not performed.
- Artifact: `Bola-Manager-Setup-0.1.2-x64.exe`, 136,381,270 bytes, SHA-256 `BD8A5C34A3666D17FFB74715426B451E03B84603A99CAC2875AE578EA1016638`.
- Authenticode remains `NotSigned`. Known dependency advisories remain unresolved; this is an internal test build, not a security-approved public release. No commit, push or cloud deployment was performed.

## Music popup installer update — 0.1.3, 2026-10-09

- Includes the nine local soundtrack files, persistent Audio settings and only the temporary now-playing popup; no bottom music player or reserved footer lane. Existing Editor/menu/P2P implementation is retained. Application ID, installation model and save directory remain unchanged.
- Root version metadata changed to 0.1.3; no dependency versions changed in this packaging step. The music regression now supports the packaged executable, like the other native tests.
- Archive inspection verified 11,644 entries, no local env, saves, credentials or tests; all 18 frontend/assets files were byte-identical to the current desktop build, including all nine MP3s.
- Typecheck, encoding, desktop build, installer generation and diff check passed. Packaged audio/navigation/preferences/restart/responsive regression passed, as did native import, Editor and menu tests.
- Full desktop suite: 58 tests, 57 passed, 0 assertion failures, 1 cancelled at the existing 90-second real WebRTC deadline. One controlled isolated rerun also cancelled at the same deadline; diagnostic instrumentation identified the pending step as host shutdown. Pairing, authorized roster/API access and UI reload assertions preceding host shutdown passed on the isolated run. This is not declared fixed or a fully green suite. No timeout/assert/runtime behavior was changed to hide the issue.
- Only the owned disposable P2P processes were forcibly ended after the cancelled runs to unblock harness cleanup. The installed game, real user profile and saves were not accessed. Actual installation, upgrade and uninstallation in the real Windows user profile were not performed.
- Artifact: `Bola-Manager-Setup-0.1.3-x64.exe`, 169,528,746 bytes, SHA-256 `EFB2A75BACBFC4E3D48C33D4C6DF85B90EE08959F459184E311A851913BE1C47`. The previous 0.1.2 installer hash is unchanged.
- Authenticode remains `NotSigned`; internal test build only. Soundtrack redistribution still requires the rights described in `docs/AUDIO.md`. No commit, push, cloud deployment or runtime P2P correction was performed.

## Official-logo installer update — 0.1.4, 2026-10-09

- Includes the approved logo across menu/Entry/Sidebar/Lobby/Editor/export, the browser favicon and native window/Windows shortcut icons. Original artwork, colors and transparency are preserved. Root version metadata changed to 0.1.4 without dependency updates; application ID, product name and save directory remain unchanged.
- Archive inspection verified 11,649 entries, zero forbidden paths and 22 frontend/assets files byte-identical to the current desktop build, including four branding PNGs and nine soundtrack files. The generated ICO contains six verified renditions: 16, 32, 48, 64, 128 and 256 px. Executable metadata reports version 0.1.4.
- Selected desktop regressions: 58 passed, 0 failed/cancelled/skipped. Native branding, import, Editor, menu and music tests ran against the packaged executable using disposable profiles. Asset/installer-policy checks also passed (6/6). Typecheck, encoding, desktop build, installer generation and diff check passed.
- The previously cancelled real two-launcher `p2pElectron.test.mjs` was deliberately not rerun as part of this branding/package-only update. Its known host-shutdown issue remains unresolved; the selected results are not presented as a fully green complete desktop suite. No runtime P2P changes were made.
- Artifact: `Bola-Manager-Setup-0.1.4-x64.exe`, 171,714,671 bytes, SHA-256 `02F4865C702A153391A331A21EDA12BE5582597A2792385A8802F0A8C7E23FE5`. The previous 0.1.3 installer hash is unchanged.
- Authenticode remains `NotSigned`; internal test build only. Existing dependency/security and soundtrack redistribution limitations remain. Installation/upgrade/uninstallation in the real Windows profile were not performed; no real save was accessed. No commit, push or cloud deployment was performed.

## Clean-interface and Gemini installer update — 0.1.5, 2026-10-09

- Includes the simplified menu, Header, Central, Squad, Tactics and Market screens; secondary help/import information stays in accessible closed disclosures while actual alerts and actions remain visible. Also includes the recent final-whistle placement and optional desktop Gemini integration. No API key is bundled: the existing protected user configuration remains outside the installation directory.
- Root version metadata changed to 0.1.5 without dependency updates. Application ID, product name, per-user installation and save location remain unchanged. The native Gemini regression now accepts the packaged executable, preserving all encryption/restart/removal assertions without calling the provider.
- Installer/typecheck/encoding/build and diff checks passed. Archive inspection verified 11,651 entries, zero forbidden paths and 164 frontend/assets/runtime files byte-identical to the current build/source. Executable metadata reports 0.1.5.
- Selected desktop/package regressions: 67 passed, 0 failed/cancelled/skipped, including native branding, import, Editor, menu, audio and Gemini settings against the packaged executable. The real two-launcher `p2pElectron.test.mjs` was not rerun in this packaging-only step; its historically intermittent host-shutdown behavior is not declared fixed. The local P2P primitive/authorization regressions were included.
- QA used disposable profiles only. Real user saves/configuration were not accessed, and installation/upgrade/uninstallation in the actual Windows profile were not performed.
- Artifact: `Bola-Manager-Setup-0.1.5-x64.exe`, 171,718,052 bytes, SHA-256 `5DAA35C844457FEEECFD60E65E050B4A07606270EED8E820EBA613DB36340EE0`. Authenticode remains `NotSigned`; this is an internal test build, not a signed public release.
- After validation, the five 0.1.0–0.1.4 installers, their blockmaps, the unused current blockmap/build-debug file and generated `win-unpacked` test copy were removed at the user's request. Cleanup freed 1,346,373,874 bytes and leaves only the 0.1.5 installer in `release-desktop`. Rebuilding regenerates the unpacked copy needed by the packaged-regression command above. Project files, dependencies, saves, protected credentials and local evidence were retained.
- Existing dependency/security and soundtrack redistribution limitations remain. No commit, push, installation into the user profile or cloud deployment was performed.

## Release limitations

This is an internal test installer, not a security-approved public release. The latest full npm audit reports 14 affected dependency nodes: 9 moderate, 2 high and 3 critical. Six nodes were already present before installer work; the eight additional moderate nodes belong to the development/build-tool graph. electron-builder and its development dependencies are not distributed as runtime dependencies. Existing runtime advisories remain unresolved; no audit exclusions or forced upgrades were used.

The large JavaScript chunk warning remains preexisting. Code signing, update delivery, installation/uninstallation validation on a clean Windows machine, public dependency remediation and cross-computer P2P testing remain pending. No commit, push, deployment, cloud configuration or Steam integration was performed.
