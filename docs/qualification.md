# Implementation and qualification report

Completed October 11, 2026. This report separates locally executed checks from unverified live API behavior.

## Deliverables

Source lives in `C:\Projects\Feradel\demo.ferarender`: `src/`, `server/`, `shared/`, `scripts/`, `tests/`, `examples/`, `docs/`, `public/assets/`, `.env.example`, startup/build configuration, lockfile and CI workflow. The existing public repository's license is retained. The app uses React + Vite and a small Express proxy, with Feradel's frontend layout/palette conventions and the existing FeraRender logo from `feradel.licensee`.

Authentication is source-confirmed as `POST /api/v1/auth`, email/password JSON plus `instance` header, extracting returned `token` and reusing it in `x-auth-token`. Proxy session extraction/reuse/redaction/logout and failure forwarding are tested with controlled upstream responses. API-key account exchange is separately selectable for provisioned accounts. No runtime mock fallback exists.

Implemented guided workflows: nested JSON/XML/XPath; dataset creation and all dataset operations; template management including source editing, list/select, save/validation and all advanced functions; DOCX binary/metadata/asPdf; XSLT/XSL-FO PDF report; HTML PDF; direct XML transformation; multipart DOCX PDF conversion; literal DOCX package; arbitrary supported AcroForm upload/discovery/per-field dataset/visual mapping/test/save/render/inspection/rerender; composite preamble assignment/compilation/render; general field mapping preview and APIs; full walkthrough step tracking; reusable request/response inspector, code generation, downloads, encoded-content opt-in and redacted trace export.

Coverage: **42/42 public canonical operations** are exposed in guided pages or the explorer. **4 internal lifecycle/HMAC operations** are documented without execution controls. Deprecated compatibility aliases are not executable. Header/footer assignment placement and true dataset schema validation are unavailable in the current backend; their limits are documented. Operational `implemented` means the demo has executable support, not a claim of successful live qualification.

## Executed checks

| Check                              | Result                        | Scope                                                                                                                                                                                                                                                                                     |
| ---------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test`                         | 17 passed                     | Proxy authentication/session/error handling, all public/internal dispatch, canonical payloads, multipart boundary/file content, scoped template actions, dataset inference/validation request logic, XML/XPath/encoding, genuine DOCX/PDF fixtures and inspection, unsafe-input rejection |
| `npm run build`                    | Passed                        | Production Vite build; document/XML dependencies split into separate chunks                                                                                                                                                                                                               |
| `npm run test:ui`                  | 3 passed                      | Authentication/navigation/XPath/reference; DOCX and PDF walkthroughs; form discovery/mapping/save/actual field inspection/rerender under explicit browser API interception                                                                                                                |
| Neighboring source engine          | Passed within Node suite      | Real Saxon mapping JSON escaping, report XSLT transformation, DOCX fields/table/date/currency, and real composite package compilation                                                                                                                                                     |
| Render serialization regression    | 1 passed                      | Real Saxon verifies text output integrity with `destination: "serialized"`                                                                                                                                                                                                                |
| `npm run audit`                    | 46 operations reconciled      | Generated inventory/matrix: 42 public + 4 internal, source-corrected examples/schemas                                                                                                                                                                                                     |
| Live smoke without configuration   | Refused as designed           | No credentials or API writes; explicit nonproduction opt-in required                                                                                                                                                                                                                      |
| Full neighboring Render `npm test` | Blocked before test execution | Existing database setup requires a verified RDS CA bundle not configured in this environment                                                                                                                                                                                              |

The fixture PDFs/DOCX are real inspectable files. Test fixture generation/population is explicitly local; it is not evidence that a remote renderer returned those files. Browser screenshots in this directory show intercepted synthetic test sessions, not a production account. PDF iframe rendering depends on the browser's built-in PDF viewer; artifact parsing and populated-field checks are independently verified.

## Backend fix

The audit reproduced a genuine text-serialization defect: the forms service serialized Saxon's result tree as XML, changing `&`/`<` inside JSON field assignments. The minimal fix sets `destination: "serialized"` and uses the returned string in:

- `feradel.render.api/routes/api/v1/pdf.forms/service.js`
- `feradel.render.api/routes/api/v1/xml/service.js`
- New regression: `feradel.render.api/test/xslt-text-serialization.test.js`

These changes are applied locally to the neighboring Render checkout and supplied as [backend-serialization.patch](backend-serialization.patch). They are not deployed or pushed as part of the demo repository. Authentication/permission/tenant security behavior is unchanged. See [backend discrepancies](backend-discrepancies.md) for other source limitations.

## Live verification still required

No authenticated nonproduction account, instance and running renderer were supplied for this task. Consequently actual FerAuth login, product/permission failures, renderer-backed PDF/DOCX generation, PDF checkbox/choice conventions, conversion-engine availability and end-to-end upstream workflows are **not claimed as live verified**. Configure the ignored `.env` and run `npm run smoke`; it checks genuine returned artifacts and field substitutions, retains created resources by default and offers scoped opt-in cleanup. Then inspect report layout/visible dynamic values in the produced PDFs.

## Commands

```powershell
npm ci
Copy-Item .env.example .env
npm run dev
# http://127.0.0.1:4178

npm test
npm run build
npx playwright install chromium
npm run test:ui
npm start

# After explicitly configuring an authorized nonproduction account:
npm run smoke
```

No infrastructure was created or deployment performed. Normal startup makes no upstream writes and performs no resource deletion.
