import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";
import { parseXml } from "./data.js";

export function decodeDocument(body, contentType = "") {
  if (body instanceof Uint8Array) return { bytes: body, type: contentType };
  const encoded =
    typeof body === "string"
      ? body
      : body?.contentBase64 || body?.base64 || body?.Base64;
  if (!encoded) return null;
  const bytes =
    typeof Buffer !== "undefined"
      ? new Uint8Array(Buffer.from(encoded, "base64"))
      : Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
  if (!bytes.length) return null;
  const pdf = String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-";
  const docx = bytes[0] === 80 && bytes[1] === 75;
  if (!pdf && !docx) return null;
  return {
    bytes,
    type:
      body?.contentType ||
      (pdf
        ? "application/pdf"
        : "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    name: body?.name || (pdf ? "result.pdf" : "result.docx"),
  };
}
export async function inspectDocument(document, expected = {}) {
  if (document.type.includes("pdf")) {
    const pdf = await PDFDocument.load(document.bytes);
    const fields = pdf
      .getForm()
      .getFields()
      .map((f) => ({
        name: f.getName(),
        type: f.constructor.name,
        value: f.getText?.() ?? f.getSelected?.() ?? f.isChecked?.() ?? null,
      }));
    const checks = Object.entries(expected).map(([name, value]) => {
      const field = fields.find((f) => f.name === name);
      const actual = field?.value;
      const matches =
        typeof actual === "boolean"
          ? actual ===
            ["true", "yes", "on", "1"].includes(String(value).toLowerCase())
          : String(actual ?? "") === String(value);
      return {
        name,
        expected: value,
        actual,
        matches: Boolean(field && matches),
      };
    });
    return {
      valid: true,
      pages: pdf.getPageCount(),
      fields,
      interactive: fields.length > 0,
      checks,
      verified: checks.length ? checks.every((c) => c.matches) : null,
    };
  }
  const zip = await JSZip.loadAsync(document.bytes, { checkCRC32: true });
  for (const path of [
    "[Content_Types].xml",
    "_rels/.rels",
    "word/document.xml",
  ])
    if (!zip.file(path)) throw Error(`Invalid DOCX: missing ${path}`);
  const xml = await zip.file("word/document.xml").async("string");
  const dom = parseXml(xml);
  const paragraphs = Array.from(
    dom.getElementsByTagNameNS(
      "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
      "p",
    ),
  ).map((p) => p.textContent);
  const text = paragraphs.join("\n");
  const checks = Object.values(expected).map((value) => ({
    expected: value,
    matches: text.includes(String(value)),
  }));
  return {
    valid: true,
    parts: Object.keys(zip.files).length,
    text,
    checks,
    verified: checks.length ? checks.every((c) => c.matches) : null,
  };
}
export async function validateUpload(bytes, name, limit = 20 * 1024 * 1024) {
  if (!bytes.length || bytes.length > limit)
    throw Error("File is empty or exceeds the 20 MiB demo limit.");
  if (/\.pdf$/i.test(name)) {
    if (String.fromCharCode(...bytes.slice(0, 5)) !== "%PDF-")
      throw Error("File is not a PDF.");
    await PDFDocument.load(bytes);
  } else if (/\.docx$/i.test(name))
    await inspectDocument({
      bytes,
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
  else throw Error("Only PDF or DOCX uploads are supported.");
}
