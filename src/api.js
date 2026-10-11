import { redact, errors } from "../shared/data.js";
import { decodeDocument, inspectDocument } from "../shared/documents.js";
export async function local(path, body) {
  const response = await fetch(`/demo/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers:
      body === undefined
        ? {}
        : { "content-type": "application/json", "x-demo-request": "1" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok)
    throw Error(
      data.message || errors[response.status] || `HTTP ${response.status}`,
    );
  return data;
}
export const pretty = (value) => JSON.stringify(value, null, 2);
export function visualBody(value) {
  if (typeof value === "string")
    return value.length > 2000 && /^[A-Za-z0-9+/=\s]+$/.test(value)
      ? `[encoded document: ${value.length} characters]`
      : value;
  if (Array.isArray(value)) return value.map(visualBody);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(redact(value)).map(([k, v]) => [
        k,
        /^(base64|contentBase64|form|pdf)$/i.test(k) &&
        typeof v === "string" &&
        v.length > 200
          ? `[encoded content: ${v.length} characters]`
          : visualBody(v),
      ]),
    );
  return value;
}
const shell = (value) => `'${String(value).replace(/'/g, "'\\''")}'`;
export function snippets(request) {
  if (!request) return { curl: "", js: "" };
  const headers = { ...request.headers };
  delete headers["content-type"];
  const multipart = String(request.headers?.["content-type"]).startsWith(
    "multipart/",
  );
  const body = request.body;
  const curl = `curl -X ${request.method} ${shell(request.url)} \\\n${Object.entries(
    headers,
  )
    .map(
      ([k, v]) =>
        `  -H ${shell(`${k}: ${v === "[REDACTED]" ? "YOUR_JWT" : v}`)}`,
    )
    .join(
      " \\\n",
    )} ${["GET", "DELETE"].includes(request.method) ? "" : multipart ? `\\\n  -F ${shell("file=@" + body.file.name)}` : `\\\n  -H 'Content-Type: application/json' \\\n  --data-raw ${shell(JSON.stringify(body))}`}`;
  const js = `// Keep JWT in memory; use x-auth-token, not x-api-key.\n${multipart ? `const body = new FormData();\nbody.append('file', fileInput.files[0]);\n` : ""}const response = await fetch(${JSON.stringify(request.url)}, {\n  method: ${JSON.stringify(request.method)},\n  headers: ${pretty({ ...headers, ...(!multipart && !["GET", "DELETE"].includes(request.method) ? { "content-type": "application/json" } : {}), ...(headers["x-auth-token"] ? { "x-auth-token": "YOUR_JWT" } : {}) })},\n${["GET", "DELETE"].includes(request.method) ? "" : `  body: ${multipart ? "body" : `JSON.stringify(${pretty(body)})`},\n`}});\nif (!response.ok) throw new Error(await response.text());\nconst result = response.headers.get('content-type')?.includes('json')\n  ? await response.json() : await response.blob();`;
  return { curl, js };
}
export async function resultArtifact(result, expected = {}) {
  let artifact = decodeDocument(result.data, result.contentType);
  if (!artifact) return null;
  const name = /filename="?([^";]+)/i.exec(
    result.headers?.["content-disposition"] || "",
  )?.[1];
  artifact.name =
    name ||
    artifact.name ||
    (artifact.type.includes("pdf") ? "result.pdf" : "result.docx");
  artifact.url = URL.createObjectURL(
    new Blob([artifact.bytes], { type: artifact.type }),
  );
  try {
    artifact.inspection = await inspectDocument(artifact, expected);
  } catch (e) {
    artifact.inspection = { valid: false, error: e.message };
  }
  return artifact;
}
