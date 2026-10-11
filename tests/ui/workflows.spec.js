import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { PDFDocument } from "pdf-lib";
import { mappingValues, parseXml } from "../../shared/data.js";
const asset = (name) =>
  fs.readFileSync(new URL("../../public/assets/" + name, import.meta.url));
test.beforeEach(async ({ page }) => {
  const templates = new Map();
  let session = { authenticated: false };
  let index = 0;
  await page.route("**/demo/**", async (route) => {
    const request = route.request(),
      endpoint = request.url().split("/demo/")[1],
      body = request.postDataJSON();
    let result;
    if (endpoint === "config")
      result = {
        auth: "http://localhost:11000",
        render: "http://localhost:11100",
        instance: "test-instance",
        email: "alex@example.test",
        mode: "live",
      };
    else if (endpoint === "session") result = session;
    else if (endpoint === "login") {
      session = { authenticated: true, expires: 2000000000000 };
      result = {
        request: {
          method: "POST",
          url: "http://localhost:11000/api/v1/auth",
          headers: { instance: body.instance },
          body: { email: body.email, password: "[REDACTED]" },
        },
        status: 200,
        data: { token: "[REDACTED]" },
        session,
        headers: {},
        contentType: "application/json",
        elapsedMs: 1,
      };
    } else if (endpoint === "logout") {
      session = { authenticated: false };
      result = { success: true };
    } else if (endpoint === "execute") {
      let data = { success: true },
        type = "application/json";
      if (body.operationId === "render_post_templates") {
        const uuid = `template-${++index}`;
        templates.set(uuid, body.body);
        data = { ...body.body, uuid, content: undefined };
      }
      if (body.operationId === "render_post_datasets")
        data = { success: true, item: { uuid: "dataset-1" } };
      if (body.operationId === "render_post_pdfFormsFields") {
        const pdf = await PDFDocument.load(
          Buffer.from(body.body.form, "base64"),
        );
        data = {
          success: true,
          fields: pdf
            .getForm()
            .getFields()
            .map((f) => ({ name: f.getName(), type: f.constructor.name })),
        };
      }
      if (body.operationId === "render_post_xml") {
        // Stub the upstream transformation with equivalent XPath values. Real Saxon is
        // qualified by tests/data.test.js, independently of browser interception.
        const doc = parseXml(body.body.xsl),
          nodes = Array.from(
            doc.getElementsByTagNameNS(
              "http://www.w3.org/2005/xpath-functions",
              "string",
            ),
          );
        const mappings = nodes.map((n) => ({
          name: n.getAttribute("key"),
          kind: n.getElementsByTagName("xsl:value-of").length
            ? "xpath"
            : "literal",
          value:
            n.getElementsByTagName("xsl:value-of")[0]?.getAttribute("select") ||
            n.textContent,
        }));
        data = {
          result: JSON.stringify(mappingValues(body.body.xml, mappings)),
        };
      }
      if (body.operationId === "render_post_pdfForms") {
        const template = templates.get(body.body.uuid),
          doc = parseXml(template.content),
          encoded = doc.getElementsByTagName("file")[0].textContent,
          pdf = await PDFDocument.load(Buffer.from(encoded, "base64"));
        const nodes = Array.from(
            doc.getElementsByTagNameNS(
              "http://www.w3.org/2005/xpath-functions",
              "string",
            ),
          ),
          mappings = nodes.map((n) => ({
            name: n.getAttribute("key"),
            kind: n.getElementsByTagName("xsl:value-of").length
              ? "xpath"
              : "literal",
            value:
              n
                .getElementsByTagName("xsl:value-of")[0]
                ?.getAttribute("select") || n.textContent,
          }));
        const values = mappingValues(body.body.xml, mappings);
        for (const [name, value] of Object.entries(values)) {
          const f = pdf.getForm().getField(name);
          if (f.setText) f.setText(value);
          else if (f.check) {
            if (value === "true") f.check();
            else f.uncheck();
          } else if (f.select) f.select(value);
        }
        data = {
          success: true,
          Base64: Buffer.from(await pdf.save()).toString("base64"),
        };
      }
      if (body.operationId === "render_post_docx")
        data = {
          success: true,
          contentBase64: asset("literal.docx").toString("base64"),
          name: "invoice.docx",
          contentType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        };
      if (body.operationId === "render_post_pdfDocument")
        data = asset("populated.pdf").toString("base64");
      if (body.operationId === "render_get_templates")
        data = {
          success: true,
          items: [...templates].map(([uuid, t]) => ({ uuid, ...t })),
        };
      result = {
        request: {
          method: "POST",
          url: "http://localhost:11100/" + body.operationId,
          headers: { instance: "test-instance", "x-auth-token": "[REDACTED]" },
          body: body.body,
        },
        status: 200,
        headers: {},
        contentType: type,
        elapsedMs: 3,
        data,
      };
    } else result = { token: "own-session-token" };
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(result),
    });
  });
  await page.goto("/");
  await page.getByLabel("Password", { exact: true }).fill("private-secret");
  await page.getByRole("button", { name: "Authenticate", exact: true }).click();
  await expect(page.getByText("Session connected")).toBeVisible();
});
test("authentication, dataset XPath, all section navigation and reference", async ({
  page,
}) => {
  await expect(page.getByText("private-secret", { exact: false })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "02 JSON Datasets and XML" }).click();
  await page
    .getByRole("button", { name: "Resolve XPath", exact: true })
    .click();
  await expect(
    page.getByText('"Alex Rivera"', { exact: false }).first(),
  ).toBeVisible();
  for (const label of [
    "03 Template Management",
    "04 DOCX Rendering",
    "05 PDF Rendering",
    "06 PDF Form Fields",
    "07 Template Components and Compilation",
    "08 Field Mappings",
    "09 Advanced API Explorer",
    "10 Troubleshooting and API Reference",
  ]) {
    await page.getByRole("button", { name: label, exact: true }).click();
    await expect(page.locator("h1")).toBeVisible();
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: "docs/studio-reference.png", fullPage: false });
});
test("DOCX and PDF full walkthroughs capture resource IDs and artifacts", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Run Full Demonstration ↗" }).click();
  for (let i = 0; i < 5; i++)
    await page.getByRole("button", { name: /^Continue ·/ }).click();
  await expect(
    page.getByRole("button", { name: "Completed", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Download invoice.docx" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Expected substituted/filled values verified in the artifact.",
    ),
  ).toBeVisible();
  await page.getByLabel("Walkthrough type").selectOption("pdf");
  for (let i = 0; i < 5; i++)
    await page.getByRole("button", { name: /^Continue ·/ }).click();
  await expect(
    page.getByRole("link", { name: "Download result.pdf" }),
  ).toBeVisible();
});
test("fillable PDF discovery, visual mapping, save, populated fields and unchanged-template rerender", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "06 PDF Form Fields", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Load working sample PDF", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Discover form fields", exact: true })
    .click();
  await expect(page.getByLabel("Mapping mode Customer name")).toBeVisible();
  await page
    .getByRole("button", { name: "Test mapping → Save Template", exact: true })
    .click();
  await expect(page.getByText("Saved form template UUID:")).toContainText(
    "template-1",
  );
  await page
    .getByRole("button", { name: "Render populated PDF", exact: true })
    .click();
  await expect(
    page.getByText(
      "Expected substituted/filled values verified in the artifact.",
    ),
  ).toBeVisible();
  const dataset = JSON.parse(
    await page.getByLabel("Input · JSON dataset").inputValue(),
  );
  dataset.Person.Name = "Morgan Example";
  await page
    .getByLabel("Input · JSON dataset")
    .fill(JSON.stringify(dataset, null, 2));
  await page
    .getByRole("button", { name: "Render populated PDF", exact: true })
    .click();
  await expect(
    page.getByText(
      "Expected substituted/filled values verified in the artifact.",
    ),
  ).toBeVisible();
  await expect(page.getByText("Saved form template UUID:")).toContainText(
    "template-1",
  );
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: "docs/studio-pdf-forms.png", fullPage: false });
});
