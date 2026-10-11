import "dotenv/config";
import fs from "node:fs";
import { safeBase } from "../server/app.js";
import {
  business,
  serialize,
  formTemplate,
  mappingValues,
  redact,
} from "../shared/data.js";
import { decodeDocument, inspectDocument } from "../shared/documents.js";
if (
  process.env.SMOKE_NONPRODUCTION !== "true" ||
  !process.env.INSTANCE_UUID ||
  !process.env.SMOKE_EMAIL ||
  !process.env.SMOKE_PASSWORD
) {
  console.error(
    "Live smoke is disabled. Configure an expressly authorized nonproduction account and set SMOKE_NONPRODUCTION=true, INSTANCE_UUID, SMOKE_EMAIL and SMOKE_PASSWORD.",
  );
  process.exit(2);
}
const auth = safeBase(process.env.AUTH_API_URL),
  render = safeBase(process.env.RENDER_API_URL),
  instance = process.env.INSTANCE_UUID;
const asset = (name) =>
  fs.readFileSync(new URL("../public/assets/" + name, import.meta.url));
const created = [],
  runName = "demo-smoke-" + Date.now().toString(36);
let token;
async function call(method, route, body, base = render) {
  const start = Date.now(),
    multipart = body instanceof FormData;
  const response = await fetch(base + route, {
    method,
    headers: {
      instance,
      ...(token ? { "x-auth-token": token } : {}),
      ...(!multipart && body ? { "content-type": "application/json" } : {}),
    },
    body: body ? (multipart ? body : JSON.stringify(body)) : undefined,
    redirect: "manual",
    signal: AbortSignal.timeout(120000),
  });
  const type = response.headers.get("content-type") || "",
    data = type.includes("json")
      ? await response.json()
      : {
          base64: Buffer.from(await response.arrayBuffer()).toString("base64"),
          contentType: type,
        };
  if (!response.ok || data.success === false)
    throw Error(
      `${method} ${route} -> ${response.status}: ${JSON.stringify(redact(data))}`,
    );
  console.log(
    `${method} ${route} -> ${response.status} (${Date.now() - start} ms)`,
  );
  return data;
}
async function saveTemplate(kind, content, output) {
  const name = runName + "-" + kind,
    result = await call("POST", "/api/v1/templates", {
      owner: instance,
      name,
      caption: "Nonproduction smoke",
      category: "DEMO",
      output,
      content,
      fileName: kind + "." + (kind === "docx" ? "docx" : "pdf"),
      mode: "FULL",
    });
  if (!result.uuid) throw Error("Template API did not return a UUID");
  created.push({ kind: "templates", uuid: result.uuid, name });
  return result.uuid;
}
async function verify(data, name, expected = {}) {
  const doc = decodeDocument(data);
  if (!doc) throw Error("Response did not contain a document");
  const check = await inspectDocument(doc, expected);
  if (!check.valid || check.verified === false)
    throw Error("Artifact verification failed: " + JSON.stringify(check));
  fs.mkdirSync("live-results", { recursive: true });
  fs.writeFileSync("live-results/" + name, doc.bytes);
  console.log(
    `${name}: structure verified${check.verified === true ? ", expected values verified" : ""}`,
  );
}
try {
  token = (
    await call(
      "POST",
      "/api/v1/auth",
      { email: process.env.SMOKE_EMAIL, password: process.env.SMOKE_PASSWORD },
      auth,
    )
  ).token;
  if (!token) throw Error("Login did not return token");
  await call("GET", "/api/v1/templates");
  const xml = serialize(business);
  const datasetName = runName + "-dataset",
    dataset = await call("POST", "/api/v1/datasets", {
      name: datasetName,
      rootPath: "/data",
      schema: {},
      sampleData: business,
    });
  created.push({
    kind: "datasets",
    uuid: dataset.item.uuid,
    name: datasetName,
  });
  await call("POST", `/api/v1/datasets/i/${dataset.item.uuid}/infer`, {
    sampleData: business,
  });
  await call("POST", `/api/v1/datasets/i/${dataset.item.uuid}/validate`, {});
  const docx = await saveTemplate(
    "docx",
    asset("invoice-docx.xml").toString(),
    "RTF",
  );
  await call("POST", `/api/v1/templates/i/${docx}/validate`, {});
  await call("POST", `/api/v1/templates/i/${docx}/scan`, {});
  const rendered = await call("POST", "/api/v1/docx", {
    owner: instance,
    uuid: docx,
    xml,
    metadata: true,
  });
  await verify(rendered, "invoice.docx", {
    customer: business.Person.Name,
    invoice: business.Invoice.Number,
  });
  const pdf = await saveTemplate(
    "pdf",
    asset("invoice-pdf.xsl").toString(),
    "PDF",
  );
  await verify(
    await call("POST", "/api/v1/pdf/document", {
      owner: instance,
      uuid: pdf,
      xml,
    }),
    "invoice.pdf",
  );
  await verify(
    await call("POST", "/api/v1/pdf/html", {
      html: "<html><body><h1>Northstar Studio</h1><p>DEMO-1042</p></body></html>",
      name: "html.pdf",
    }),
    "html.pdf",
  );
  const transform = await call("POST", "/api/v1/xml", {
    xml,
    xsl: asset("transform.xsl").toString(),
  });
  if (!transform.result.includes(business.Person.Name))
    throw Error("Transformation did not contain substituted customer");
  const fields = await call("POST", "/api/v1/pdf/forms/fields", {
    form: asset("fillable.pdf").toString("base64"),
  });
  if (!Array.isArray(fields.fields) || fields.fields.length !== 6)
    throw Error("Sample AcroForm discovery did not return six fields");
  const mappings = JSON.parse(asset("form-mappings.json")),
    form = formTemplate(asset("fillable.pdf").toString("base64"), mappings);
  const mapped = await call("POST", "/api/v1/xml", { xml, xsl: form.xsl });
  if (
    JSON.stringify(JSON.parse(mapped.result)) !==
    JSON.stringify(mappingValues(xml, mappings))
  )
    throw Error("Mapping serialization did not preserve values");
  const formId = await saveTemplate("form", form.content, "PDF");
  await verify(
    await call("POST", "/api/v1/pdf/forms", {
      owner: instance,
      uuid: formId,
      xml,
      contentType: "application/json",
    }),
    "form.pdf",
    mappingValues(xml, mappings),
  );
  const changed = serialize({
    ...business,
    Person: { ...business.Person, Name: "Morgan Example" },
  });
  await verify(
    await call("POST", "/api/v1/pdf/forms", {
      owner: instance,
      uuid: formId,
      xml: changed,
      contentType: "application/pdf",
    }),
    "form-rerender.pdf",
    mappingValues(changed, mappings),
  );
  const upload = new FormData();
  upload.append(
    "file",
    new Blob([decodeDocument(rendered).bytes]),
    "invoice.docx",
  );
  await verify(
    await call("POST", "/api/v1/pdf/docx/docx/pdf", upload),
    "converted.pdf",
  );
  await verify(
    await call("POST", "/api/v1/docx/package", {
      package: asset("literal-package.xml").toString(),
      name: "literal.docx",
    }),
    "literal.docx",
    { customer: "Alex Rivera" },
  );
  console.log(
    "Live qualification completed. Inspect invoice.pdf and html.pdf visually for expected layout/values.",
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (process.env.SMOKE_CLEANUP === "true")
    for (const resource of created.reverse()) {
      try {
        const check = await call(
            "GET",
            `/api/v1/${resource.kind}/i/${resource.uuid}`,
          ),
          item =
            check.item || check.items?.find((x) => x.uuid === resource.uuid);
        if (item?.name !== resource.name)
          throw Error("Scoped cleanup refused: resource name changed");
        await call("DELETE", `/api/v1/${resource.kind}/i/${resource.uuid}`);
      } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
      }
    }
  else
    console.log(
      "Created resources retained (cleanup is opt-in): " +
        JSON.stringify(created),
    );
  token = null;
}
