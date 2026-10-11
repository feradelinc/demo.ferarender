import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.resolve(root, "../feradel.render.api/openapi/openapi.json");
const contract = JSON.parse(fs.readFileSync(source));
const operations = [];
for (const [route, methods] of Object.entries(contract.paths)) {
  if (!route.startsWith("/api/v1/")) continue;
  for (const [method, op] of Object.entries(methods)) {
    if (!["get", "post", "put", "delete", "patch"].includes(method)) continue;
    const internal = route.includes("/internal/");
    let permission =
      route.includes("/pdf/") ||
      route === "/api/v1/docx" ||
      route.endsWith("/docx/package")
        ? "CAN.RENDER"
        : method === "get" || /\/(scan|validate|resolve|suggest)$/.test(route)
          ? "VIEW.TEMPLATE"
          : "EDIT.TEMPLATE";
    if (route.includes("template-components") && method !== "get")
      permission = "EDIT.TEMPLATE (+ EDIT.TEMPLATE.XSLT for native XSLT)";
    if (route === "/api/v1/xml")
      permission =
        "JWT/product access; service imports EDIT permission but does not check it";
    if (
      (route.includes("/datasets/") && method === "get") ||
      /datasets.*\/validate$/.test(route)
    )
      permission = "JWT/product access; no service permission call";
    const media = op.requestBody?.content || {};
    let example = media["application/json"]?.example || {};
    const sanitize = (value) =>
      typeof value === "string" && /^[a-f\d]{8}-[a-f\d-]{27}$/i.test(value)
        ? ""
        : Array.isArray(value)
          ? value.map(sanitize)
          : value && typeof value === "object"
            ? Object.fromEntries(
                Object.entries(value).map(([k, v]) => [k, sanitize(v)]),
              )
            : value;
    example = sanitize(example);
    if (
      /\/(scan|validate|compile)$/.test(route) &&
      route.includes("/templates/")
    )
      example = {};
    if (route.endsWith("/assignments") && method === "put")
      example = { assignments: [] };
    if (
      route.includes("/template-components") &&
      ["post", "put"].includes(method)
    )
      example = {
        type: "PREAMBLE",
        name: "demo-component",
        contentFormat: "XSLT_OPENXML_FRAGMENT",
        content: "",
        meta: { fieldMappings: {} },
      };
    if (route === "/api/v1/pdf/forms/fields") example = { form: "" };
    if (route === "/api/v1/pdf/forms")
      example = {
        owner: "",
        uuid: "",
        xml: "<data/>",
        contentType: "application/pdf",
      };
    if (/datasets.*\/validate$/.test(route)) example = {};
    const refSchema =
      media["application/json"]?.schema || media["multipart/form-data"]?.schema;
    let schema = refSchema?.$ref
      ? contract.components.schemas[refSchema.$ref.split("/").pop()]
      : refSchema;
    if (
      (route.includes("/templates/") &&
        /\/(scan|compile|validate)$/.test(route)) ||
      /datasets.*\/validate$/.test(route)
    )
      schema = {
        type: "object",
        description:
          "The operation uses the UUID path parameter; no render body is required.",
      };
    if (route.endsWith("/assignments") && method === "put")
      schema = {
        type: "object",
        required: ["assignments"],
        properties: {
          assignments: {
            type: "array",
            items: {
              type: "object",
              required: ["componentUuid"],
              properties: {
                componentUuid: { type: "string" },
                placement: { enum: ["PREAMBLE", "POSTAMBLE"] },
                sortOrder: { type: "number" },
                enabled: { type: "boolean" },
                condition: { type: "string" },
              },
            },
          },
        },
      };
    if (
      route.includes("/template-components") &&
      ["post", "put"].includes(method)
    )
      schema = {
        type: "object",
        required: method === "put" ? [] : ["type", "content"],
        properties: {
          type: { enum: ["PREAMBLE", "BODY", "POSTAMBLE", "BASE_PACKAGE"] },
          contentFormat: {
            enum: [
              "EDITOR_JSON",
              "OPENXML_FRAGMENT",
              "XSLT_OPENXML_FRAGMENT",
              "DOCX",
              "OPENXML_PACKAGE",
            ],
          },
          name: { type: "string" },
          content: { type: "string" },
          meta: { type: "object" },
          owner: { type: "string" },
          datasetUuid: { type: "string" },
        },
      };
    if (route === "/api/v1/pdf/forms/fields")
      schema = {
        type: "object",
        description:
          "Supply encoded form or pdf, or existing uuid/name with owner context.",
        properties: {
          form: { type: "string", contentEncoding: "base64" },
          pdf: { type: "string", contentEncoding: "base64" },
          owner: { type: "string" },
          uuid: { type: "string" },
          name: { type: "string" },
        },
      };
    operations.push({
      id: op.operationId,
      method: method.toUpperCase(),
      route,
      group: route.split("/")[3],
      summary: op.summary,
      description: op.description,
      parameters: op.parameters || [],
      schema,
      example,
      multipart: !!media["multipart/form-data"],
      responses: op.responses,
      permission,
      internal,
      status: internal ? "internal-only" : "implemented",
      test: "tests/proxy.test.js canonical dispatch; workflow/artifact tests; live qualification opt-in",
    });
  }
}
fs.writeFileSync(
  path.join(root, "shared/operations.json"),
  JSON.stringify(operations, null, 2),
);
fs.writeFileSync(
  path.join(root, "public/assets/openapi.json"),
  JSON.stringify(contract, null, 2),
);
const rows = operations.map(
  (o) =>
    `| ${o.method} | \`${o.route}\` | ${o.internal ? "Lifecycle HMAC" : "JWT + instance + product access"} | ${o.internal ? "Infrastructure only" : o.permission} | ${o.parameters.map((p) => p.name).join(", ") || "—"}; ${JSON.stringify(o.example).replace(/\|/g, "")} | ${Object.keys(o.responses?.["200"]?.content || {}).join(", ") || "JSON/status contract"} | ${o.internal ? "Reference only" : o.group + " / Explorer"} | ${o.test} | ${o.status} |`,
);
fs.writeFileSync(
  path.join(root, "docs/coverage.md"),
  "# Endpoint coverage\n\nGenerated from the repository contract; source-corrected request examples. Implemented means executable demo UI/proxy support, not live qualification. Deprecated `/api` aliases are deliberately excluded.\n\n| Method | Route | Authentication | Permission | Inputs | Response | Demo | Tests | Status |\n|---|---|---|---|---|---|---|---|---|\n" +
    rows.join("\n") +
    "\n",
);
console.log(
  `${operations.length} canonical operations: ${operations.filter((o) => !o.internal).length} public, ${operations.filter((o) => o.internal).length} internal.`,
);
