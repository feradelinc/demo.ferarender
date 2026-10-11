import fs from "node:fs";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import JSZip from "jszip";
import { business, serialize } from "../shared/data.js";
const directory = new URL("../public/assets/", import.meta.url);
const write = (name, value) =>
  fs.writeFileSync(new URL(name, directory), value);
write("business.json", JSON.stringify(business, null, 2));
write("business.xml", serialize(business));
const xslHeader =
  '<xsl:stylesheet version="3.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform"';
const pdfXsl = `${xslHeader} xmlns:fo="http://www.w3.org/1999/XSL/Format"><xsl:output method="xml"/><xsl:template match="/"><fo:root><fo:layout-master-set><fo:simple-page-master master-name="page" page-height="11in" page-width="8.5in" margin="0.7in"><fo:region-body/></fo:simple-page-master></fo:layout-master-set><fo:page-sequence master-reference="page"><fo:flow flow-name="xsl-region-body"><fo:block font-size="24pt" color="#1f6f8b">Invoice <xsl:value-of select="/data/Invoice/Number"/></fo:block><fo:block><xsl:value-of select="/data/Firm/Name"/></fo:block><fo:block>Prepared for <xsl:value-of select="/data/Person/Name"/></fo:block><fo:block>Date: <xsl:value-of select="/data/Invoice/Date"/></fo:block><xsl:for-each select="/data/LineItems"><fo:block><xsl:value-of select="Description"/> — <xsl:value-of select="Quantity"/> × $<xsl:value-of select="format-number(Price,'0.00')"/></fo:block></xsl:for-each><fo:block font-weight="bold">Total: $<xsl:value-of select="format-number(/data/Invoice/Total,'#,##0.00')"/></fo:block><xsl:if test="/data/Person/Notes != ''"><fo:block><xsl:value-of select="/data/Person/Notes"/></fo:block></xsl:if></fo:flow></fo:page-sequence></fo:root></xsl:template></xsl:stylesheet>`;
write("invoice-pdf.xsl", pdfXsl);
write(
  "transform.xsl",
  `${xslHeader}><xsl:output method="text"/><xsl:template match="/">Invoice <xsl:value-of select="/data/Invoice/Number"/> for <xsl:value-of select="/data/Person/Name"/></xsl:template></xsl:stylesheet>`,
);
const ns = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const paragraph = (content) => `<w:p><w:r><w:t>${content}</w:t></w:r></w:p>`;
const docXsl = `${xslHeader} xmlns:w="${ns}"><xsl:output method="xml" omit-xml-declaration="yes"/><xsl:template match="/"><w:document><w:body>${paragraph("Northstar Studio — Invoice")}${paragraph('<xsl:value-of select="/data/Firm/Name"/>')}${paragraph('Customer: <xsl:value-of select="/data/Person/Name"/>')}${paragraph('Invoice <xsl:value-of select="/data/Invoice/Number"/> — <xsl:value-of select="format-date(xs:date(/data/Invoice/Date),\'[MNn] [D], [Y]\')" xmlns:xs="http://www.w3.org/2001/XMLSchema"/>')}<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="4500"/><w:gridCol w:w="4500"/></w:tblGrid><w:tr><w:tc>${paragraph("Description")}</w:tc><w:tc>${paragraph("Amount")}</w:tc></w:tr><xsl:for-each select="/data/LineItems"><w:tr><w:tc>${paragraph('<xsl:value-of select="Description"/>')}</w:tc><w:tc>${paragraph("$<xsl:value-of select=\"format-number(Quantity * Price,'#,##0.00')\"/>")}</w:tc></w:tr></xsl:for-each></w:tbl>${paragraph("Total: $<xsl:value-of select=\"format-number(/data/Invoice/Total,'#,##0.00')\"/>")}<xsl:if test="/data/Person/Notes != ''">${paragraph('<xsl:value-of select="/data/Person/Notes"/>')}</xsl:if><w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080"/></w:sectPr></w:body></w:document></xsl:template></xsl:stylesheet>`;
const parts = {
  "[Content_Types].xml":
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  "_rels/.rels":
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  "word/document.xml": docXsl,
  "word/_rels/document.xml.rels":
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>',
};
const wrap = (entries) =>
  "<root>" +
  Object.entries(entries)
    .map(([path, content]) => {
      const index = path.lastIndexOf("/");
      return `<file name="${path.slice(index + 1)}" folder="${index < 0 ? "" : path.slice(0, index)}" transform="${path === "word/document.xml" && content === docXsl ? "true" : "false"}">${content}</file>`;
    })
    .join("\n") +
  "</root>";
write("invoice-docx.xml", wrap(parts));
write(
  "preamble.xsl",
  `${xslHeader} xmlns:w="${ns}"><xsl:template match="/">${paragraph('Demonstration report — <xsl:value-of select="/data/Invoice/Number"/>')}</xsl:template></xsl:stylesheet>`,
);
const literal = {
  ...parts,
  "word/document.xml": `<w:document xmlns:w="${ns}"><w:body>${paragraph("Northstar Studio — Alex Rivera — DEMO-1042")}<w:sectPr/></w:body></w:document>`,
};
write("literal-package.xml", wrap(literal));
const zip = new JSZip();
Object.entries(literal).forEach(([name, content]) => zip.file(name, content));
write("literal.docx", await zip.generateAsync({ type: "nodebuffer" }));
const pdf = await PDFDocument.create(),
  font = await pdf.embedFont(StandardFonts.Helvetica),
  page = pdf.addPage([612, 792]),
  form = pdf.getForm();
page.drawText("Northstar — Demo Customer Form", {
  x: 48,
  y: 735,
  size: 20,
  font,
  color: rgb(0.12, 0.43, 0.54),
});
for (const [i, name] of [
  "Customer name",
  "Invoice date",
  "Invoice number",
  "Notes",
].entries()) {
  page.drawText(name, { x: 48, y: 680 - i * 85, size: 12, font });
  const field = form.createTextField(name);
  field.addToPage(page, { x: 48, y: 642 - i * 85, width: 490, height: 28 });
}
page.drawText("Invoice paid", { x: 78, y: 320, size: 12, font });
form
  .createCheckBox("Invoice paid")
  .addToPage(page, { x: 48, y: 316, width: 20, height: 20 });
const choice = form.createDropdown("Delivery");
choice.addOptions(["Email", "Post"]);
choice.select("Email");
choice.addToPage(page, { x: 48, y: 245, width: 240, height: 28 });
form.updateFieldAppearances(font);
write("fillable.pdf", await pdf.save());
write(
  "expected-fields.json",
  JSON.stringify(
    form
      .getFields()
      .map((f) => ({ name: f.getName(), type: f.constructor.name })),
    null,
    2,
  ),
);
const mappings = [
  { name: "Customer name", kind: "xpath", value: "/data/Person/Name" },
  { name: "Invoice date", kind: "xpath", value: "/data/Invoice/Date" },
  { name: "Invoice number", kind: "xpath", value: "/data/Invoice/Number" },
  { name: "Notes", kind: "xpath", value: "/data/Person/Notes" },
  { name: "Invoice paid", kind: "literal", value: "true" },
  { name: "Delivery", kind: "literal", value: "Email" },
];
write("form-mappings.json", JSON.stringify(mappings, null, 2));
for (const m of mappings) {
  const f = form.getField(m.name);
  if (f.setText)
    f.setText(
      m.name === "Customer name"
        ? "Alex Rivera"
        : m.name === "Invoice date"
          ? "2026-10-11"
          : m.name === "Invoice number"
            ? "DEMO-1042"
            : "Sample notes",
    );
  else if (f.check) f.check();
}
write("populated.pdf", await pdf.save());
console.log(
  "Inspectable AcroForm, DOCX package, XML/XSLT and dataset fixtures written.",
);
