# FeraRender Developer Studio

A standalone React application for learning the real FerAuth/FeraRender APIs. Every canonical public operation can be executed through guided pages or the advanced explorer. The interface shows the transmitted request, status, headers, response, elapsed time, code examples and document artifacts. Live API mode is the only runtime mode. Tests intercept APIs explicitly; their fixtures are never used as a fallback for live errors.

## Start locally

Prerequisites: Node.js 22.12+ (qualified with 24.21), npm, and access to configured FerAuth/FeraRender services. Render service operators must configure the PDF renderer and DOCX conversion engine. Starting this application does not start or provision those services.

```powershell
cd C:\Projects\Feradel\demo.ferarender
npm ci
Copy-Item .env.example .env
# Edit .env: AUTH_API_URL, RENDER_API_URL, INSTANCE_UUID
npm run dev
```

Open **http://127.0.0.1:4178**. The Auth URL in `.env.example` is a configurable local example; use the actual port of your FerAuth instance. Change `PORT` to choose another application port. `scripts/start.ps1` is a convenience launcher.

For a production build served locally:

```powershell
npm run build
npm start
```

This is a local developer application, bound to loopback. It does not deploy or change infrastructure. Hosting it publicly would require a separate deployment design and request.

## Configuration and authentication

| Setting                         | Purpose                                                                             |
| ------------------------------- | ----------------------------------------------------------------------------------- |
| `AUTH_API_URL`                  | Trusted FerAuth base URL, without `/api/v1/auth`                                    |
| `RENDER_API_URL`                | Trusted FeraRender base URL, without `/api/v1`                                      |
| `INSTANCE_UUID`                 | Instance/owner context of your authorized nonproduction account                     |
| `PORT`                          | Local application port; default 4178                                                |
| `ALLOWED_API_URLS`              | Additional explicitly trusted base URLs, comma separated                            |
| `DEMO_EMAIL`                    | Optional prefilled demonstration email; no password prefill                         |
| `DEMO_MODE`                     | Reserved configuration; runtime always reports live mode, never silently mocks      |
| `SMOKE_NONPRODUCTION`           | Explicit opt-in for account-backed qualification                                    |
| `SMOKE_EMAIL`, `SMOKE_PASSWORD` | Optional live-test credentials; ignored by ordinary startup                         |
| `SMOKE_CLEANUP`                 | If `true`, live smoke deletes only resources it created after verifying their names |

Remote API URLs must use HTTPS. Plain HTTP is accepted only for loopback services. API bases edited in the UI must be present in the server allowlist; edit `.env` and restart to authorize new bases. The proxy permits the 42 audited public operations and the single login route. It never accepts an arbitrary upstream route or lifecycle operation.

Sign in with email/password using **POST `/api/v1/auth`**, with the instance in the `instance` header. Capture the response's `token`; subsequent calls use **`x-auth-token`**, alongside `instance`. API-key account login is a separate option only for actually provisioned API-key accounts; it also exchanges credentials for a JWT. The JWT is held in transient server memory, protected by an HttpOnly/SameSite session cookie. Restart, disconnect or one hour of inactivity clears the server session. Expiration decoded from the JWT is informational; FerAuth/FeraRender enforce signature, expiry, permissions and licensed access. Neither passwords nor JWTs are persisted in localStorage or logged. Reveal/copy of your own token is explicit, and traces are redacted.

## Workflows

- **DOCX:** business JSON → compatible XML → save OpenXML package template → validate → render binary DOCX or `metadata=true` JSON/base64 → inspect ZIP/XML and expected substitutions → download/text preview. `asPdf` is an explicit separate conversion option.
- **PDF report:** business JSON → XML → save XSLT producing XSL-FO → render PDF → decode JSON-string base64 response → preview/download. Additional pages demonstrate safe HTML-to-PDF, direct XML/XSLT transformation, the confirmed multipart `/api/v1/pdf/docx/docx/pdf` route, and literal OpenXML package generation.
- **PDF AcroForm:** upload arbitrary supported fillable PDF → live field discovery → business or per-field JSON → visually map original PDF names to JSON/XPath/literal/empty values → generate wrapper/mapping XSLT → test XSLT against current XML → save template → render PDF bytes or JSON/base64 → inspect actual filled text/checkbox/choice fields → change data and rerender the unchanged saved template. Previous and current results can be downloaded. Flattening is not advertised or requested.
- **Components:** validate/create a native XSLT preamble → create package → replace PREAMBLE assignments → compile → inspect compilation → render. The sample package has a table/body and the sample preamble adds dynamic text. CRUD and validation are accessible in the explorer. The current backend does not support header/footer assignment placement through this API.
- **Datasets/mappings/templates:** editable JSON request bodies expose all CRUD, inference, tree, registration, resources, scanning, validation, assignments, resolve and suggest operations. Returned UUIDs are captured for reuse. Deletes require explicit selection and confirmation of the resource UUID.

The prominent **Run Full Demonstration** guides DOCX, PDF and PDF form sequences, tracks completed steps/UUIDs, and permits returning to earlier steps. Form upload/mapping panels carry their state in memory across page navigation.

See [developer guide](docs/developer-guide.md), [endpoint coverage matrix](docs/coverage.md), [contract discrepancies](docs/backend-discrepancies.md), and [qualification report](docs/qualification.md). Downloadable assets are in `public/assets`. JavaScript and cURL examples are generated from actual requests. External examples are in [examples/ferarender.http](examples/ferarender.http) and [examples/client.mjs](examples/client.mjs).

## Tests and qualification

```powershell
npm test
npm run build
npx playwright install chromium
npm run test:ui
```

Node tests exercise serialization, XPath, real inspectable document fixtures, proxy sessions, authentication failures, public/internal dispatch, multipart handling, redaction and URL/origin restrictions. Browser tests intercept APIs and verify UI navigation, DOCX/PDF walkthroughs and PDF form mapping/save/render/rerender. Browser outputs contain synthetic data only. Tests do not require production credentials. Source-engine qualification additionally runs against a neighboring `../feradel.render.api` checkout when present; a standalone clone explicitly skips that test.

For authorized live testing, configure **an expressly approved nonproduction account** in your ignored `.env`, set `SMOKE_NONPRODUCTION=true`, and run:

```powershell
npm run smoke
```

The smoke script creates distinctly named datasets/templates and writes artifacts to ignored `live-results/`. It validates DOCX content and filled PDF field values, exercises both form response modes and rerendering, and checks PDF structure for reports/conversion. Inspect report layout and visible dynamic values manually. Cleanup is disabled by default; `SMOKE_CLEANUP=true` deletes only IDs created by this run after checking their names. Normal startup performs no upstream writes. Never commit `.env`, account credentials, live documents or tokens.

## Architecture and maintenance

`src/`: React components, reusable request inspector, code snippets and styles adapted from Feradel's existing palette/layout. `server/`: small Express/Vite host and allowlisted credential/session proxy. `shared/`: audited operation inventory, safe dataset/mapping serialization and real artifact inspection. `scripts/`: inventory regeneration, synthetic assets, startup and opt-in smoke. `tests/`: Node and intercepted browser qualification. `docs/`: coverage, workflows, discrepancies and screenshots.

`npm run audit` regenerates inventory and coverage from the neighboring Render OpenAPI source, keeping verified source corrections. It does not run at startup. `node scripts/fixtures.mjs` regenerates synthetic fixtures. Review API source changes before regenerating; the OpenAPI inventory has generic examples that need source corrections. The checked-in inventory and assets make the demo independent of the neighboring API checkout at runtime.

**Required backend serialization fix:** source testing found that PDF mapping text was incorrectly XML-escaped by the service's result-tree `.toString()`. A minimal tested patch is included in `docs/backend-serialization.patch` and applied in the local Render checkout. Live services need this fix for faithful `&`, `<` and other mapping text; see the discrepancy report. The demo does not alter backend security or bypass permission checks.

The public repository's existing MIT license is retained. The Feradel brand asset is reused from the neighboring Feradel frontend; upstream Saxon engine code is not copied into this project.
