# Dependency security update — 2026-09-11

## Scope and compatibility

Express remains **4.22.2**, Firebase Admin **13.10.0**, and Socket.IO server/client
**4.8.3**. These were already the latest releases allowed by their current major
version ranges. No application behavior or runtime configuration was changed.

| Dependency | Before | After | Resolution |
| --- | --- | --- | --- |
| qs | 6.15.3 | 6.16.0 | Override under Express, including body-parser |
| fast-xml-parser | 5.9.3 | 5.11.1 | Compatible lockfile update under Google Cloud Storage |
| uuid | 9.0.1 | 11.1.1 | Override under Firebase Admin |
| socket.io-parser | 4.2.6 | 4.2.7 | Compatible lockfile update for server and client |
| autoprefixer | 10.5.2 | 10.5.6 | Direct patch update |
| concurrently | 9.2.3 | 9.2.4 | Direct patch update |
| postcss | 8.5.16 | 8.5.28 | Direct patch update |

The development updates also resolve audit findings in Browserslist,
baseline-browser-mapping, shell-quote and Nano ID. Browser compatibility datasets
were refreshed with their consumers. fast-xml-parser brings the upstream-required
major changes to its internal @nodable/entities and is-unsafe dependencies; those
packages are not imported by the application.

## Why overrides are necessary

- Express 4.22.2 requests `qs ~6.15.1`, excluding the fixed 6.16.0 release.
  Its query and URL-encoded body middleware work with the corrected version.
- Firebase Admin 13 depends on Firestore 7 and Storage 7. Their google-gax 4,
  gaxios 6 and teeny-request 9 consumers request UUID 9. Inspection of the
  installed consumers found only CommonJS `v4()` calls, for request identifiers
  and multipart boundaries. UUID 11.1.1 preserves that export and API.
- UUID 10/11 changes to Node support and v1/v7 state handling do not affect these
  uses; the application requires Node >=20.9. UUID 12+ is deliberately not forced.
- No override is needed for XML or Socket.IO parsing: the parent version ranges
  already admit the patched releases.

Keep the two overrides until upstream compatible releases remove their need.
Reassess them when changing the Express or Firebase Admin major version. Never
remove an override solely because the lockfile currently contains a safe version.

## Vulnerabilities and primary references

- `qs`: attacker-controlled `constructor.isBuffer` can crash serialization;
  comma-separated bracket arrays can bypass configured limits.
  [CVE-2026-82417](https://github.com/ljharb/qs/security/advisories/GHSA-4mjr-xmp4-gh2g),
  [CVE-2026-82562](https://github.com/ljharb/qs/security/advisories/GHSA-x5fp-wj9c-mxmx).
- `fast-xml-parser`: repeated DOCTYPE declarations reset entity-expansion limits,
  enabling denial of service.
  [CVE-2026-73569](https://github.com/NaturalIntelligence/fast-xml-parser/security/advisories/GHSA-8r6m-32jq-jx6q).
- `uuid`: v3/v5/v6 omit output-buffer bounds checks, allowing partial writes.
  [CVE-2026-41907](https://github.com/uuidjs/uuid/security/advisories/GHSA-w5hq-g745-h8pq),
  [11.1.1 changelog](https://github.com/uuidjs/uuid/blob/v11.1.1/CHANGELOG.md).
- `socket.io-parser`: malformed attachment counts can retain binary buffers and
  exhaust memory.
  [CVE-2026-69185](https://github.com/socketio/socket.io/security/advisories/GHSA-2m8v-j782-fhvr).

## Regression checks

`server/tests/dependencySecurity.test.mjs` is included in `npm run test:server`:

- All lockfile occurrences satisfy patched-version floors.
- Express query/form parsing and both qs security regressions.
- CommonJS UUID generation and bounds checks from all three Google consumers.
- Actual google-gax request ID generation.
- Real loopback HTTP multipart uploads through gaxios and teeny-request.
- Storage XML building/parsing and duplicate DOCTYPE rejection.
- Socket.IO client/server binary round trips and invalid attachment rejection.

Installation was checked with both `npm install` and `npm ci`; the latter left
the lockfile SHA-256 unchanged. Full `npm ls --all` found no invalid dependencies.
`npm audit` decreased from 38 findings (19 high, 19 moderate) to **zero**, without
omitting production or development dependencies or suppressing advisories.

Validation on Node 24.15.0 / npm 11.12.1:

- `npm run test:server`: 1,262 passed, 0 failed, 0 cancelled, 1 existing Redis skip.
- `npm run test:frontend`: 194 passed, 0 failed/cancelled/skipped (a server-suite subset).
- `npm run test:e2e`: 3 passed using `E2E_CHANNEL=msedge`.
- `npm run typecheck`, `npm run build` and a Vite build with `envFile: false`: passed.
- Eleven new dependency regression tests are included in the server result.
- No lint script exists. Snyk itself was not rerun; results above are from npm audit.

Final `npm ls qs fast-xml-parser uuid socket.io-parser` (deduped edges condensed):

```text
express@4.22.2
  qs@6.16.0 (also body-parser@1.20.6)
firebase-admin@13.10.0
  @google-cloud/firestore@7.11.6 > google-gax@4.6.1 > uuid@11.1.1
  @google-cloud/storage@7.21.0 > fast-xml-parser@5.11.1
  @google-cloud/storage@7.21.0 > gaxios@6.7.1 > uuid@11.1.1
  @google-cloud/storage@7.21.0 > teeny-request@9.0.0 > uuid@11.1.1
socket.io@4.8.3 > socket.io-parser@4.2.7
socket.io-client@4.8.3 > socket.io-parser@4.2.7
```

Local SDK initialization checks cover Firebase Auth, Firestore and Storage without
external requests. HTTP smoke checks use the existing memory/demo mode. E2E uses
the existing Playwright harness and Microsoft Edge, with test authentication and
persistence adapters; it does not validate live Firebase credentials, IAM or cloud
network behavior. The existing Redis integration test needs `TEST_REDIS_URL` and
was not executable here because no Redis service was available. No tests were
removed or newly skipped. Build warnings about large chunks remain unchanged.
