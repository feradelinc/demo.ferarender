# Developer guide

## Connect and inspect

Start locally, set trusted Auth/Render URLs and instance context, then authenticate. Login's request preview masks the password. The response panel masks `token`; reveal or copy your own JWT only through the session controls. List templates to verify the session. Missing/invalid-token and incorrect-instance examples send real requests with controlled header changes. Use a restricted account for 403 and let a signed token expire naturally for expiration testing. Disconnect clears the proxy session.

Every operation follows **Explanation → Input → HTTP Request → API Response → Result**. Guided pages share the request inspector at the bottom. The explorer adds a pre-execution preview and generates cURL/JavaScript examples. The inspector records application request headers; transport headers automatically added by Node are not part of the application contract. Multipart boundary headers are captured from the encoded request. Binary results appear as metadata; encoded content requires explicit viewing/copying. History export redacts tokens/passwords and summarizes large encoded payloads.

## JSON and XML

Edit the business sample, validate/convert, reset, load or download JSON. Arrays become repeated elements (`/data/LineItems[1]/Description`), not a new `item` wrapper. Nulls become empty elements. Missing properties remain missing. Invalid XML element names/control characters produce errors. UTF-8 differs from the legacy serializer's ISO-8859-1 declaration to match actual Unicode bytes, while preserving its element conventions.

XPath examples: `/data/Person/Name`, `/data/Firm/Address/City`, `/data/LineItems/Description`, `count(/data/LineItems)`. The exact generated XML remains editable for advanced requests. All guided render calls convert the current JSON before submission. Local XPath preview is separate from API mapping resolution.

Create a dataset definition and capture its UUID. Infer returns a schema tree; use dataset update in the explorer to store it. Retrieve tree to inspect the stored schema. The current dataset validate endpoint checks stored JSON syntax, not schema conformance of submitted sample values.

## DOCX

Load `invoice-docx.xml`. Its `<root>` wrapper contains `[Content_Types].xml`, relationships, and `word/document.xml` as an XSLT part marked `transform="true"`. The API transforms that part and builds a ZIP package. Dynamic business/customer data, repeated rows, formatted dates/currency and an optional notes paragraph are in the actual XSLT source.

Save the template to the selected owner with a distinctive name and `output: RTF` (the existing three-character DOCX output code). The UI parses XML before saving, then calls the backend validator by returned UUID. The backend validator primarily scans placeholders; it is not a full package verifier. Full templates render directly. Composite templates require assignment replacement/compilation before render. `metadata=true` produces JSON/base64; otherwise request the DOCX media type. Result inspection parses the ZIP, required XML parts, text and expected values; text preview is not a Word page-layout renderer.

## PDF reports and transformations

The sample PDF template emits XSL-FO for the configured PDF renderer. Save it, pass `owner`, saved UUID and XML to `/pdf/document`. The actual controller returns a base64 JSON string; the demo decodes it, parses the PDF and embeds a preview. Visual report content/layout still needs live verification.

HTML input must be static and self-contained. The backend rejects scripts, frames, external resources, images, forms, event attributes and unsafe styles. Direct XML transformation uses the body property `xsl` and returns `{result}`. The demo rejects external XML/XSLT resources/DTD declarations. DOCX conversion sends a multipart field named `file` to the verified duplicated path. The package-generation example uses literal OpenXML parts only.

## Arbitrary fillable PDFs, without code

1. Upload/drop an AcroForm PDF or load the synthetic sample. The file is parsed locally and capped at 20 MiB, then sent encoded in the discovery endpoint's JSON `form` property.
2. Inspect the real field inventory and metadata. Empty fields, unidentifiable names and malformed/unsupported PDFs produce errors; field names are never invented from JSON keys.
3. Keep the business dataset or generate one value per discovered field. This creates safe `FormValues/FieldN` source properties independent of PDF names. Edit and convert JSON.
4. Select JSON paths, equivalent XPath expressions, literals or intentional empties. The live value preview evaluates the same mapping paths. Select exact choice options; checkbox encodings depend on the configured external renderer. The supplied sample uses `true` and verifies the returned checkbox state.
5. Test mapping through `/xml`; the generated XSLT 3.0 uses `fn:xml-to-json`, so runtime quotes, backslashes/newlines and Unicode are JSON-escaped correctly. Field names also escape XML attributes and XSLT attribute-value-template braces. The mapping is nested in `<mapping>` beside `<file>` inside `<root>`.
6. Save to the actual template API and capture UUID. Choose binary PDF or JSON/Base64 response mode via body `contentType`. Render with XML and the correct owner.
7. Inspect/download the result. Actual text/choice/checkbox field values are compared with expected assignments. A mismatch is explicitly unverified. Interactive fields are reported when present; no flattening option is sent.
8. Change JSON and render again against the saved UUID. Mapping edits require another save; dataset-only edits reuse the stored template. Download/compare the previous and current artifacts.

The demo's PDF inspection library may not support every exotic AcroForm encoding that an external renderer accepts. In that case inspect the visible PDF and raw API response; an inspection failure is not silently reported as a verified fill.

## Components, assignments and mappings

Create and validate the provided XSLT preamble, then create a base package template, explicitly replace assignments and compile it. Native components require the backend's configured XSLT edit permission (default `EDIT.TEMPLATE.XSLT`). Inspect returned validation and compilation status, then render the compiled template. The current assignment route permits PREAMBLE/POSTAMBLE only. Its replacement action replaces the whole set; review selected template UUID first.

General field mappings connect `[[placeholder]]` values to XPath for component compilation. They are stored separately from PDF field assignments. Select a path from the dataset tree, inspect the resolved local value, and save the mapping. Resolve/suggest return actual stored records; the present suggest handler does not infer a new mapping. API errors and missing/ambiguous paths remain visible.

## Advanced operations and safe cleanup

Choose any of the 42 canonical public operations. Path inputs, JSON body, query parameters and Accept header are editable. CRUD, register/import, template resources, scan, validation, compilation and assignments remain available even where a guided example is narrower. UUIDs returned from resource creation are retained in the current session and passed to subsequent steps. Deletes require a separately checked explicit selection; no automatic cleanup runs in the app.

Four internal lifecycle operations appear only in the reference/coverage document. Legacy aliases are identified as deprecated and are not executable in the proxy. Upstream permissions/product/owner checks are authoritative and unchanged.
