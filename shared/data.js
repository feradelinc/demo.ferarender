import objectToXml from "object-to-xml";
import { DOMParser } from "@xmldom/xmldom";
import xpath from "xpath";

export const business = {
  Firm: {
    Name: "Northstar Studio",
    Address: { Street: "42 Example Lane", City: "Boston", PostalCode: "02110" },
  },
  Person: {
    Name: "Alex Rivera",
    Email: "alex@example.test",
    MailingAddress: { Street: "7 Sample Avenue", City: "Cambridge" },
    Notes: "Design & delivery — “thank you”",
    Optional: null,
  },
  Invoice: {
    Number: "DEMO-1042",
    Date: "2026-10-11",
    Total: 1250.5,
    Paid: true,
    Currency: "USD",
  },
  LineItems: [
    { Description: "Discovery", Quantity: 2, Price: 250 },
    { Description: "Implementation", Quantity: 3, Price: 250.1666667 },
  ],
};
export const xmlEscape = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
const xmlAttribute = (value) =>
  xmlEscape(value)
    .replace(/\n/g, "&#10;")
    .replace(/\r/g, "&#13;")
    .replace(/\t/g, "&#9;");
export function serialize(data) {
  const check = (value) => {
    if (value && typeof value === "object")
      for (const [key, child] of Object.entries(value)) {
        if (!Array.isArray(value) && !/^[A-Za-z_][\w.-]*$/.test(key))
          throw Error(`JSON key cannot be an XML element name: ${key}`);
        check(child);
      }
    else if (
      typeof value === "string" &&
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)
    )
      throw Error("XML 1.0 prohibits this control character.");
  };
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw Error("Dataset must be a JSON object.");
  check(data);
  // Same object-to-xml element/repeated-array conventions as support/serialize.js.
  // UTF-8 corrects its legacy ISO declaration for actual Unicode request bytes.
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + objectToXml({ data });
}
export function parseXml(source) {
  if (/<!DOCTYPE|<!ENTITY/i.test(source))
    throw Error("DTD/entity declarations are not allowed.");
  let error = "";
  const doc = new DOMParser({
    errorHandler: {
      warning: (x) => {
        error = x;
      },
      error: (x) => {
        error = x;
      },
      fatalError: (x) => {
        error = x;
      },
    },
  }).parseFromString(source, "application/xml");
  if (error || !doc.documentElement) throw Error(error || "Invalid XML");
  return doc;
}
export function resolve(xml, expression) {
  const result = xpath.select(expression, parseXml(xml));
  return Array.isArray(result)
    ? result.map((node) =>
        node.nodeType === 2 ? node.value : node.textContent,
      )
    : result;
}
export function dataPaths(value, path = "/data") {
  return Object.entries(value || {}).flatMap(([key, child]) => {
    const next = `${path}/${key}`;
    return Array.isArray(child)
      ? child.flatMap((v, i) =>
          typeof v === "object" && v !== null
            ? dataPaths(v, `${next}[${i + 1}]`)
            : [{ path: `${next}[${i + 1}]`, value: v }],
        )
      : child && typeof child === "object"
        ? dataPaths(child, next)
        : [{ path: next, value: child }];
  });
}
export function formTemplate(base64, mappings) {
  if (!base64 || !mappings.length)
    throw Error("Upload a PDF and discover its fields first.");
  // XSLT 3.0 JSON serializer escapes runtime values, field names, quotes, slashes,
  // newlines and Unicode. No string-concatenated JSON or hand-written escaping.
  const body = mappings
    .map((m) => {
      const key = xmlAttribute(m.name)
        .replace(/\{/g, "{{")
        .replace(/\}/g, "}}");
      if (m.kind === "empty") return `<fn:string key="${key}"/>`;
      if (m.kind === "literal")
        return `<fn:string key="${key}">${xmlEscape(m.value)}</fn:string>`;
      if (
        !m.value ||
        /(?:doc|document|collection|unparsed-text|transform|environment-variable)\s*\(|[{}]/i.test(
          m.value,
        )
      )
        throw Error("Use a dataset XPath without external resources.");
      return `<fn:string key="${key}"><xsl:value-of select="${xmlEscape(m.value)}"/></fn:string>`;
    })
    .join("\n");
  const xsl = `<xsl:stylesheet version="3.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:fn="http://www.w3.org/2005/xpath-functions"><xsl:output method="text"/><xsl:template match="/"><xsl:variable name="assignments"><fn:map>${body}</fn:map></xsl:variable><xsl:value-of select="fn:xml-to-json($assignments/*)"/></xsl:template></xsl:stylesheet>`;
  return {
    xsl,
    content: `<root><file>${base64}</file><mapping>${xsl}</mapping></root>`,
  };
}
export function mappingValues(xml, mappings) {
  return Object.fromEntries(
    mappings.map((m) => [
      m.name,
      m.kind === "empty"
        ? ""
        : m.kind === "literal"
          ? m.value
          : String([resolve(xml, m.value)].flat()[0] ?? ""),
    ]),
  );
}
export function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        /^(password|token|x-auth-token|x-api-key|authorization|cookie|set-cookie)$/i.test(
          k,
        )
          ? "[REDACTED]"
          : redact(v),
      ]),
    );
  return value;
}
export const errors = {
  400: "The request is invalid. Inspect the validation details.",
  401: "Missing, invalid or expired JWT. Sign in again and check the instance.",
  403: "The account lacks permission or licensed product access.",
  404: "Resource not found in the selected owner/instance.",
  406: "Unsupported return content type.",
  409: "Template changed; compile it again.",
  413: "Request/file exceeds the upload limit.",
  429: "Rate limited. Observe Retry-After before retrying.",
  500: "Service error. Inspect stage details and renderer configuration.",
  502: "Upstream renderer unavailable or returned invalid content.",
};
