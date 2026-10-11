import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
  business,
  serialize,
  resolve,
  formTemplate,
  mappingValues,
  redact,
} from "../shared/data.js";
import {
  decodeDocument,
  inspectDocument,
  validateUpload,
} from "../shared/documents.js";
const asset = (name) =>
  fs.readFileSync(new URL("../public/assets/" + name, import.meta.url));
test("serialization preserves Feradel repeated arrays, nulls, nested values and XML encoding", () => {
  const xml = serialize({ ...business, Special: "<&\"' 🙂\\\n" });
  assert.deepEqual(resolve(xml, "/data/LineItems/Description"), [
    "Discovery",
    "Implementation",
  ]);
  assert.deepEqual(resolve(xml, "/data/Person/Optional"), [""]);
  assert.deepEqual(resolve(xml, "/data/Invoice/Paid"), ["true"]);
  assert.deepEqual(resolve(xml, "/data/Special"), ["<&\"' 🙂\\\n"]);
  assert.equal(resolve(xml, "count(/data/LineItems)"), 2);
  assert.throws(() => serialize({ "invalid key": 1 }));
  assert.throws(() => serialize({ control: "\u0001" }));
  assert.throws(() =>
    resolve('<!DOCTYPE a [<!ENTITY a SYSTEM "file:///etc/passwd">]><a/>', "/a"),
  );
});
test("expected XML fixture matches serializer; mapping distinguishes field names from data paths", () => {
  assert.equal(asset("business.xml").toString(), serialize(business));
  const mappings = JSON.parse(asset("form-mappings.json"));
  assert.equal(
    mappingValues(serialize(business), mappings)["Customer name"],
    "Alex Rivera",
  );
  assert.equal(
    mappingValues(
      serialize({ ...business, Person: { Name: "Changed" } }),
      mappings,
    )["Customer name"],
    "Changed",
  );
  const source = formTemplate(
    asset("fillable.pdf").toString("base64"),
    mappings,
  );
  assert.ok(source.content.includes("<file>JVBER"));
  assert.ok(source.xsl.includes("xml-to-json"));
  assert.throws(() =>
    formTemplate("base64", [
      { name: "x", kind: "xpath", value: "document('http://evil/')" },
    ]),
  );
});
test("real inspectable DOCX fixture validates ZIP, XML and expected text", async () => {
  const bytes = asset("literal.docx");
  const doc = decodeDocument({
    contentBase64: bytes.toString("base64"),
    name: "literal.docx",
  });
  const result = await inspectDocument(doc, {
    person: "Alex Rivera",
    invoice: "DEMO-1042",
  });
  assert.equal(result.valid, true);
  assert.equal(result.verified, true);
  assert.ok(result.text.includes("Northstar"));
  await assert.rejects(() =>
    inspectDocument({ bytes: new Uint8Array([80, 75]), type: "docx" }),
  );
  await validateUpload(bytes, "sample.docx");
  await assert.rejects(() => validateUpload(bytes, "sample.exe"));
});
test("PDF fixtures contain genuine fillable fields and populated text/checkbox values", async () => {
  const blank = await inspectDocument(
    decodeDocument({ Base64: asset("fillable.pdf").toString("base64") }),
  );
  assert.equal(blank.interactive, true);
  assert.equal(blank.fields.length, 6);
  const filled = await inspectDocument(
    decodeDocument({ Base64: asset("populated.pdf").toString("base64") }),
    {
      "Customer name": "Alex Rivera",
      "Invoice date": "2026-10-11",
      "Invoice paid": "true",
      Delivery: "Email",
    },
  );
  assert.equal(filled.verified, true);
  await assert.rejects(() => validateUpload(Buffer.from("junk"), "bad.pdf"));
  await assert.rejects(() =>
    validateUpload(asset("fillable.pdf"), "sample.pdf", 100),
  );
  const mismatch = await inspectDocument(
    decodeDocument({ Base64: asset("populated.pdf").toString("base64") }),
    { "Customer name": "wrong" },
  );
  assert.equal(mismatch.verified, false);
});
test("trace redaction removes secrets recursively", () =>
  assert.deepEqual(
    redact({
      password: "p",
      headers: { "x-auth-token": "jwt", "x-api-key": "key" },
      data: { token: "jwt" },
    }),
    {
      password: "[REDACTED]",
      headers: { "x-auth-token": "[REDACTED]", "x-api-key": "[REDACTED]" },
      data: { token: "[REDACTED]" },
    },
  ));
test("source-engine qualification: XSLT mapping escapes runtime JSON and DOCX/PDF source transforms", async (t) => {
  const enginePath = new URL(
    "../../feradel.render.api/support/xslt/SaxonJS2N.js",
    import.meta.url,
  );
  if (!fs.existsSync(enginePath))
    return t.skip(
      "Optional neighboring FeraRender source engine not installed; run in Feradel checkout for source-engine qualification.",
    );
  const require = createRequire(import.meta.url),
    sax = require(fileURLToPath(enginePath));
  const transform = (xsl, xml) => {
    const d = sax.getPlatform().parseXmlFromString(xsl);
    d._saxonBaseUri = "file:///";
    return sax.transform({
      stylesheetInternal: sax.compile(d),
      sourceText: xml,
      destination: "serialized",
    }).principalResult;
  };
  const xml = serialize({
    ...business,
    Person: { Name: 'A "quote" \\ slash\nUnicode 🙂 & < >' },
  });
  const mappings = [
    {
      name: 'A {field} "field" \\ \n🙂',
      kind: "xpath",
      value: "/data/Person/Name",
    },
    { name: "literal", kind: "literal", value: '" \\ \n 🙂' },
    { name: "empty", kind: "empty" },
  ];
  const output = JSON.parse(
    transform(formTemplate("base64", mappings).xsl, xml),
  );
  assert.deepEqual(output, mappingValues(xml, mappings));
  assert.ok(
    transform(
      asset("invoice-pdf.xsl").toString(),
      serialize(business),
    ).includes("DEMO-1042"),
  );
  const { parseXml } = await import("../shared/data.js");
  const doc = parseXml(asset("invoice-docx.xml").toString());
  const file = Array.from(doc.documentElement.childNodes).find(
    (n) => n.nodeType === 1 && n.getAttribute("name") === "document.xml",
  );
  const { XMLSerializer } = await import("@xmldom/xmldom");
  const xsl = Array.from(file.childNodes)
    .map((n) => new XMLSerializer().serializeToString(n))
    .join("");
  const result = transform(xsl, serialize(business));
  assert.ok(result.includes("Alex Rivera"));
  assert.ok(result.includes("Discovery"));
  assert.ok(result.includes("1,250.50"));
  assert.ok(result.includes("October 11, 2026"));
  const { compilePackage } = require(
    fileURLToPath(
      new URL(
        "../../feradel.render.api/services/compiler/openxml-header-footer-service.js",
        import.meta.url,
      ),
    ),
  );
  const composite = await compilePackage({
    packageContent: asset("invoice-docx.xml").toString(),
    assignments: [
      {
        enabled: true,
        placement: "PREAMBLE",
        sortOrder: 0,
        Component: {
          uuid: "sample-preamble",
          type: "PREAMBLE",
          name: "Demo preamble",
          contentFormat: "XSLT_OPENXML_FRAGMENT",
          content: asset("preamble.xsl").toString(),
          meta: "{}",
        },
      },
    ],
  });
  assert.equal(composite.validation.valid, true);
  assert.ok(composite.content.includes("Demonstration report"));
});
