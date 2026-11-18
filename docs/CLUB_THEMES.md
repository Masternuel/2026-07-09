# Club identity across the game interface

## Fix

Legacy/imported clubs often have only `colors[]`. Previously, a primary below 4.5:1 contrast was replaced with a neutral fallback. That accessible text color also supplied decorative tint, so Flamengo and Cruzeiro both appeared grey. Sidebar/topbar/mobile backgrounds also used fixed neutral colors.

`resolveClubIdentityColor` now keeps the validated active-theme Editor override, or the chromatic catalog primary when no override exists. No club-name mapping, crest analysis, catalog write or save migration is required. Invalid colors and neutral black/white clubs retain safe theme-aware fallbacks.

`resolveClubThemeColors` independently derives readable legacy accents by mixing toward white/black without losing the club hue. Contrast is checked against the actual derived canvas/menu/inset surfaces. Explicit Editor colors are preserved; the application does not silently replace an administrator's choices.

`AppShell` owns the palette locally. Canvas, side/top/mobile menus, active navigation and stadium atmosphere share that identity. Foreground on the solid active item is calculated independently. Dark/light mode and club changes recompute the palette on render; no global club-color cache or cross-career root mutation is introduced. Entry/Editor branding remains separate. Existing typography, structure, crest fallback, reduced-motion and high-contrast behavior remain in place.

## Validation — 2026-11-08

- Targeted palette/catalog/browser regressions initially passed 14/14. The browser regression was then placed in `e2e/club-theme.spec.mjs`, using Playwright's configured browser rather than introducing a Chrome requirement into Node-only server/frontend checks. Related Node palette/catalog/Tailwind/round/package checks passed 35/35. Real built-in Flamengo/Cruzeiro records pass through catalog normalization without explicit theme colors. Tests cover hue, contrast, explicit overrides, malformed/neutral values, club switching, navigation, light/dark text, mobile styling and absence of global pigment leakage.
- Before that test relocation, frontend passed 284/284 and Chrome E2E passed 8/8. Typecheck, desktop build, encoding and diff checks passed. A subsequent nine-test Chrome run passed the new color regression, but its career worker exited unexpectedly before the match test started (`code=3221226505`, `signal=null`): 8 passed, 1 failed. The diagnostic is retained; this process failure is not declared fixed by the UI patch.
- Final checks after relocation: frontend 283/283 and Chrome E2E 9/9, with zero failures/cancellations/skips. The prior worker exit remains recorded as an intermittent test-process occurrence, not a claimed runtime fix. Neither assertions nor the browser worker count/timeouts were weakened.
- Independent agent visual review: PASS, using actual React Home/Elenco/Táticas and menu/dialog at desktop 1440, tablet 768 and mobile 375/390. No horizontal overflow or palette mismatch observed. A different-provider evaluator was unavailable. Local fixture/screenshot evidence stays ignored in `.tmp/club-theme-review/`.
- Browser regression waits for the actual completed CSS transition, not an arbitrary sleep. Its Vite cache is private to the run and cleaned up afterward. The ignored visual fixture mirrors the real theme/root and demo-auth contexts without provider calls.
- During the first broad desktop test attempt, the existing image upload/restart test failed and the menu test timed out. The attempt was stopped; the original log is retained locally. Unmodified Editor tests subsequently passed 15/15 and the menu test 1/1 in controlled isolated checks. A confirmation run passed its first 50 tests (including Editor images), then repeated the menu timeout after 90,000 ms and was stopped. The remaining audio/local-P2P/AI selection passed 18/18 separately. These are not a fully green 69-test run, nor are the occurrences declared fixed by the color patch. The known real two-launcher P2P host-shutdown case was not retested.

No real profile/save, cloud configuration or secret was read or modified. No commit, push or deployment was performed. Version metadata is 0.1.7; dependencies were not updated.

Follow-up in portable 0.1.8: the native menu shutdown cause was reproduced and corrected, with a regression that fails on 0.1.7. The complete desktop suite now passes 70/70; the original Editor failure remains unreproduced, with response-resource ownership and content assertions strengthened. See `DESKTOP_INTERMITTENCIES.md`. The color implementation itself is unchanged.
