// Run with an explicitly configured nonproduction account. No secrets are logged.
import "dotenv/config";
import fs from "node:fs";
import { business, serialize } from "../shared/data.js";
import { safeBase } from "../server/app.js";
import { decodeDocument, inspectDocument } from "../shared/documents.js";
if (process.env.SMOKE_NONPRODUCTION !== "true")
  throw Error("Set SMOKE_NONPRODUCTION=true for an authorized test account.");
const auth = safeBase(process.env.AUTH_API_URL),
  render = safeBase(process.env.RENDER_API_URL),
  instance = process.env.INSTANCE_UUID;
const login = await fetch(auth + "/api/v1/auth", {
  method: "POST",
  headers: { instance, "content-type": "application/json" },
  body: JSON.stringify({
    email: process.env.SMOKE_EMAIL,
    password: process.env.SMOKE_PASSWORD,
  }),
});
if (!login.ok) throw Error(`Login failed: ${login.status}`);
const { token } = await login.json();
const headers = {
  instance,
  "x-auth-token": token,
  "content-type": "application/json",
};
const saved = await fetch(render + "/api/v1/templates", {
  method: "POST",
  headers,
  body: JSON.stringify({
    owner: instance,
    name: "demo-example-" + Date.now().toString(36),
    caption: "Example invoice",
    output: "RTF",
    fileName: "invoice.docx",
    content: fs.readFileSync(
      new URL("../public/assets/invoice-docx.xml", import.meta.url),
      "utf8",
    ),
    mode: "FULL",
  }),
});
if (!saved.ok) throw Error(`Save failed: ${saved.status}`);
const { uuid } = await saved.json();
const response = await fetch(render + "/api/v1/docx", {
  method: "POST",
  headers,
  body: JSON.stringify({
    owner: instance,
    uuid,
    xml: serialize(business),
    metadata: true,
  }),
});
if (!response.ok) throw Error(`Render failed: ${response.status}`);
const document = decodeDocument(await response.json());
const check = await inspectDocument(document, {
  customer: business.Person.Name,
});
if (!check.verified) throw Error("DOCX substitution not verified");
fs.mkdirSync("live-results", { recursive: true });
fs.writeFileSync("live-results/example.docx", document.bytes);
console.log(
  `Verified example.docx; created template UUID ${uuid}. No automatic deletion.`,
);
