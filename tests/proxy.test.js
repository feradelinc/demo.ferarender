import test from "node:test";
import assert from "node:assert/strict";
import { createApp, safeBase } from "../server/app.js";
import operations from "../shared/operations.json" with { type: "json" };
import fs from "node:fs";
import { decodeDocument, inspectDocument } from "../shared/documents.js";
import { business, serialize } from "../shared/data.js";
const docx = fs.readFileSync(
  new URL("../public/assets/literal.docx", import.meta.url),
);
const pdf = fs.readFileSync(
  new URL("../public/assets/populated.pdf", import.meta.url),
);
const config = {
  auth: "http://localhost:11000",
  render: "http://localhost:11100",
  instance: "test-instance",
};
async function harness(fn, fetchImpl) {
  const app = createApp({ config, fetchImpl }),
    server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const url = "http://127.0.0.1:" + server.address().port;
  let cookie = "";
  const call = async (path, body, extra = {}) => {
    const r = await fetch(url + "/demo/" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "content-type": "application/json",
        "x-demo-request": "1",
        ...(cookie ? { cookie } : {}),
        ...extra,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (r.headers.get("set-cookie"))
      cookie = r.headers.get("set-cookie").split(";")[0];
    return { status: r.status, data: await r.json() };
  };
  try {
    await fn(call);
  } finally {
    app.locals.close();
    await new Promise((r) => server.close(r));
  }
}
const token =
  "eyJhbGciOiJIUzI1NiJ9." +
  Buffer.from(JSON.stringify({ exp: 2000000000 })).toString("base64url") +
  ".signature";
test("successful login extracts JWT, reuses correct headers, masks traces, exposes own token explicitly and logs out", async () => {
  const sent = [];
  await harness(
    async (call) => {
      const result = await call("login", {
        ...config,
        email: "alex@example.test",
        password: "private",
      });
      assert.equal(result.data.session.authenticated, true);
      assert.equal(result.data.data.token, "[REDACTED]");
      assert.equal(result.data.request.body.password, "[REDACTED]");
      const response = await call("execute", {
        operationId: "render_get_templates",
      });
      assert.equal(response.data.status, 200);
      assert.equal(sent[1].headers["x-auth-token"], token);
      assert.equal(sent[1].headers.instance, config.instance);
      assert.equal((await call("token", {})).data.token, token);
      await call("logout", {});
      assert.equal((await call("token", {})).status, 401);
    },
    async (url, options) => {
      sent.push(options);
      return Response.json(
        url.includes("/auth") ? { token } : { success: true, items: [] },
      );
    },
  );
});
test("invalid credentials preserve upstream 401 without session", async () =>
  harness(
    async (call) => {
      const result = await call("login", {
        ...config,
        email: "x",
        password: "bad",
      });
      assert.equal(result.data.status, 401);
      assert.equal((await call("session")).data.authenticated, false);
    },
    async () =>
      Response.json({ message: "Invalid credentials" }, { status: 401 }),
  ));
test("expired token / wrong instance / permissions / product restrictions preserve API errors and details", async () => {
  for (const status of [400, 401, 403, 404, 406, 413, 429, 500, 502])
    await harness(
      async (call) => {
        await call("login", { ...config, email: "x", password: "p" });
        const r = await call("execute", {
          operationId: "render_get_templates",
        });
        assert.equal(r.data.status, status);
        assert.equal(r.data.data.code, "UPSTREAM");
      },
      async (url) =>
        url.endsWith("/auth")
          ? Response.json({ token })
          : Response.json(
              {
                code: "UPSTREAM",
                message:
                  "Expired token, incorrect instance or authorization failure",
                validation: { errors: ["specific detail"] },
              },
              { status },
            ),
    );
});
test("failure demonstrations change only intended headers", async () => {
  const sent = [];
  await harness(
    async (call) => {
      await call("login", { ...config, email: "x", password: "p" });
      for (const failureMode of ["missing", "invalid", "instance"])
        await call("execute", {
          operationId: "render_get_templates",
          failureMode,
        });
      assert.equal(sent[1].headers["x-auth-token"], undefined);
      assert.equal(
        sent[2].headers["x-auth-token"],
        "deliberately-invalid-demo-token",
      );
      assert.equal(
        sent[3].headers.instance,
        "00000000-0000-0000-0000-000000000000",
      );
    },
    async (url, o) => {
      sent.push(o);
      return Response.json(url.endsWith("/auth") ? { token } : { items: [] });
    },
  );
});
test("all 42 public operations dispatch canonical routes; four internal operations are blocked", async () => {
  const routes = [];
  await harness(
    async (call) => {
      await call("login", { ...config, email: "x", password: "p" });
      for (const op of operations) {
        const response = await call("execute", {
          operationId: op.id,
          params: { uuid: "chosen-resource", name: "sample" },
          body: op.example,
          ...(op.multipart
            ? {
                multipart: {
                  name: "sample.docx",
                  base64: docx.toString("base64"),
                },
              }
            : {}),
        });
        assert.equal(response.status, op.internal ? 403 : 200, op.id);
      }
      assert.equal(routes.filter((x) => !x.endsWith("/auth")).length, 42);
      assert.ok(routes.includes(config.render + "/api/v1/pdf/docx/docx/pdf"));
    },
    async (url) => {
      routes.push(url);
      return Response.json(
        url.endsWith("/auth") ? { token } : { success: true },
      );
    },
  );
});
test("binary response includes metadata and exact uploaded multipart file and boundary", async () =>
  harness(
    async (call) => {
      await call("login", { ...config, email: "x", password: "p" });
      const r = await call("execute", {
        operationId: "render_post_pdfDocxDocxPdf",
        multipart: { name: "input.docx", base64: docx.toString("base64") },
        accept: "application/pdf",
      });
      assert.equal(r.data.data.binary, true);
      assert.equal(
        Buffer.from(r.data.data.base64, "base64").toString(),
        "%PDF-fixture",
      );
      assert.equal(r.data.request.body.file.name, "input.docx");
      assert.match(
        r.data.request.headers["content-type"],
        /boundary=----formdata/,
      );
    },
    async (url, o) => {
      if (url.endsWith("/auth")) return Response.json({ token });
      const data = await new Response(o.body, {
        headers: o.headers,
      }).formData();
      assert.deepEqual(Buffer.from(await data.get("file").arrayBuffer()), docx);
      return new Response("%PDF-fixture", {
        headers: {
          "content-type": "application/pdf",
          "content-disposition": 'attachment; filename="input.pdf"',
        },
      });
    },
  ));
test("safe URLs, origin protection, URL allowlist, internal/path injection and missing sessions", async () => {
  assert.throws(() => safeBase("http://remote.example"));
  assert.throws(() => safeBase("https://user:pass@example.test"));
  assert.throws(() => safeBase("file:///etc/passwd"));
  await harness(
    async (call) => {
      assert.equal(
        (
          await call("login", {
            ...config,
            auth: "https://evil.example",
            email: "x",
            password: "p",
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await call(
            "login",
            { ...config, email: "x", password: "p" },
            { origin: "https://evil.example" },
          )
        ).status,
        403,
      );
      assert.equal(
        (await call("execute", { operationId: "render_get_templates" })).status,
        401,
      );
      await call("login", { ...config, email: "x", password: "p" });
      assert.equal(
        (
          await call("execute", {
            operationId: "render_get_templatesIUuid}",
            params: { uuid: "../internal" },
          })
        ).status,
        400,
      );
    },
    async () => Response.json({ token }),
  );
});

test("template create/retrieve/update/scan/validate/compile and explicit scoped deletion preserve real payloads", async () => {
  const sent = [];
  let saved;
  await harness(
    async (call) => {
      await call("login", { ...config, email: "x", password: "p" });
      const body = {
        owner: config.instance,
        name: "demo-owned-template",
        output: "RTF",
        content: "<root/>",
        mode: "FULL",
      };
      const create = await call("execute", {
        operationId: "render_post_templates",
        body,
      });
      assert.equal(create.data.data.uuid, "created-only");
      const updated = { ...body, uuid: "created-only", caption: "Changed" };
      await call("execute", {
        operationId: "render_post_templates",
        body: updated,
      });
      const get = await call("execute", {
        operationId: "render_get_templatesIUuid}",
        params: { uuid: "created-only" },
      });
      assert.equal(get.data.data.items[0].caption, "Changed");
      for (const suffix of ["Scan", "Validate", "Compile"])
        await call("execute", {
          operationId: "render_post_templatesIUuid" + suffix,
          params: { uuid: "created-only" },
          body: {},
        });
      await call("execute", {
        operationId: "render_delete_templatesIUuid}",
        params: { uuid: "created-only" },
      });
      assert.equal(sent.filter((x) => x.method === "DELETE").length, 1);
      assert.ok(sent.every((x) => !x.url.includes("unselected-resource")));
    },
    async (url, options) => {
      sent.push({ url, ...options });
      if (url.endsWith("/auth")) return Response.json({ token });
      if (url.endsWith("/templates") && options.method === "POST") {
        saved = { ...JSON.parse(options.body), uuid: "created-only" };
        return Response.json({ ...saved, success: true });
      }
      if (options.method === "GET")
        return Response.json({ success: true, items: [saved] });
      return Response.json({ success: true, status: "READY", fields: [] });
    },
  );
});
test("dataset create/infer/tree/validation dispatch actual sampleData and schema payloads", async () => {
  await harness(
    async (call) => {
      await call("login", { ...config, email: "x", password: "p" });
      const created = await call("execute", {
        operationId: "render_post_datasets",
        body: {
          name: "demo-dataset",
          rootPath: "/data",
          sampleData: business,
          schema: {},
        },
      });
      assert.equal(created.data.data.item.uuid, "dataset-id");
      const inferred = await call("execute", {
        operationId: "render_post_datasetsIUuidInfer",
        params: { uuid: "dataset-id" },
        body: { sampleData: business },
      });
      assert.equal(inferred.data.data.schema.path, "/data");
      await call("execute", {
        operationId: "render_get_datasetsIUuidTree",
        params: { uuid: "dataset-id" },
      });
      const check = await call("execute", {
        operationId: "render_post_datasetsIUuidValidate",
        params: { uuid: "dataset-id" },
        body: {},
      });
      assert.equal(check.data.data.validation.valid, true);
    },
    async (url, options) => {
      if (url.endsWith("/auth")) return Response.json({ token });
      if (url.endsWith("/infer")) {
        assert.deepEqual(JSON.parse(options.body).sampleData, business);
        return Response.json({
          success: true,
          schema: { name: "data", path: "/data", type: "object" },
        });
      }
      if (url.endsWith("/validate")) {
        assert.deepEqual(JSON.parse(options.body), {});
        return Response.json({
          success: true,
          validation: { valid: true, errors: [] },
        });
      }
      if (url.endsWith("/tree"))
        return Response.json({ success: true, tree: { path: "/data" } });
      assert.equal(JSON.parse(options.body).rootPath, "/data");
      return Response.json({ success: true, item: { uuid: "dataset-id" } });
    },
  );
});
test("render integrations preserve binary/base64 document modes, XML transforms, and genuine PDF/DOCX contents", async () => {
  await harness(
    async (call) => {
      await call("login", { ...config, email: "x", password: "p" });
      for (const operationId of [
        "render_post_docx",
        "render_post_pdfDocument",
        "render_post_pdfHtml",
        "render_post_pdfForms",
        "render_post_pdfDocxDocxPdf",
        "render_post_docxPackage",
      ]) {
        const response = await call("execute", {
          operationId,
          body: {
            owner: config.instance,
            uuid: "chosen",
            xml: serialize(business),
            html: "<html><body>Invoice</body></html>",
            metadata: true,
            contentType: "application/json",
          },
          ...(operationId === "render_post_pdfDocxDocxPdf"
            ? {
                multipart: {
                  name: "sample.docx",
                  base64: docx.toString("base64"),
                },
              }
            : {}),
        });
        const document = decodeDocument(
          response.data.data,
          response.data.contentType,
        );
        assert.ok(document, operationId);
        const inspection = await inspectDocument(
          document,
          document.type.includes("pdf")
            ? { "Customer name": "Alex Rivera" }
            : { customer: "Alex Rivera" },
        );
        assert.equal(inspection.verified, true, operationId);
      }
      const transformed = await call("execute", {
        operationId: "render_post_xml",
        body: {
          xml: serialize(business),
          xsl: '<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="3.0"/>',
        },
      });
      assert.equal(
        transformed.data.data.result,
        "Invoice DEMO-1042 for Alex Rivera",
      );
    },
    async (url, options) => {
      if (url.endsWith("/auth")) return Response.json({ token });
      if (url.endsWith("/xml"))
        return Response.json({ result: "Invoice DEMO-1042 for Alex Rivera" });
      if (url.endsWith("/docx") || url.endsWith("/docx/package")) {
        const body = JSON.parse(options.body);
        assert.equal(body.owner, config.instance);
        return Response.json({
          success: true,
          contentBase64: docx.toString("base64"),
          contentType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        });
      }
      if (url.endsWith("/pdf/document"))
        return Response.json(pdf.toString("base64"));
      if (url.endsWith("/pdf/docx/docx/pdf"))
        return new Response(pdf, {
          headers: { "content-type": "application/pdf" },
        });
      return Response.json({ success: true, Base64: pdf.toString("base64") });
    },
  );
});
test("proxy refuses malformed uploads, external XML/XSLT resources and requests without protection header", async () => {
  let forwarded = 0;
  await harness(
    async (call) => {
      await call("login", { ...config, email: "x", password: "p" });
      assert.equal(
        (
          await call("execute", {
            operationId: "render_post_pdfFormsFields",
            body: { form: Buffer.from("malformed").toString("base64") },
          })
      ).status,
      400,
      );
      assert.equal(
        (
          await call("execute", {
            operationId: "render_post_xml",
            body: { xml: "<!DOCTYPE data><data/>", xsl: "<xsl/>" },
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await call(
            "execute",
            { operationId: "render_get_templates" },
            { "x-demo-request": "" },
          )
        ).status,
        403,
      );
      assert.equal(forwarded, 1);
    },
    async () => {
      forwarded++;
      return Response.json({ token });
    },
  );
});
