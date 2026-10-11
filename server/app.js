import express from "express";
import crypto from "node:crypto";
import operations from "../shared/operations.json" with { type: "json" };
import { redact } from "../shared/data.js";
import { validateUpload } from "../shared/documents.js";

const limit = 30 * 1024 * 1024;
async function checkedUpload(bytes, name) {
  try {
    await validateUpload(bytes, name);
  } catch (error) {
    throw Object.assign(error, { status: 400 });
  }
}
export function safeBase(value) {
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !["http:", "https:"].includes(url.protocol)
  )
    throw Error("Invalid API base URL");
  if (
    url.protocol !== "https:" &&
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  )
    throw Error("Remote APIs must use HTTPS");
  return url.href.replace(/\/$/, "");
}
export function createApp({ config, fetchImpl = fetch } = {}) {
  config ||= {
    auth: process.env.AUTH_API_URL || "http://localhost:11000",
    render: process.env.RENDER_API_URL || "http://localhost:11100",
    instance: process.env.INSTANCE_UUID || "",
    email: process.env.DEMO_EMAIL || "",
  };
  const allowed = new Set(
    [
      config.auth,
      config.render,
      ...(process.env.ALLOWED_API_URLS || "").split(",").filter(Boolean),
    ].map(safeBase),
  );
  const sessions = new Map();
  const app = express();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.set({
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    });
    if (req.path.startsWith("/demo/")) {
      const host = req.headers.host || "";
      if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host))
        return res
          .status(403)
          .json({ message: "Demo must be accessed through localhost." });
      if (
        req.headers.origin &&
        req.headers.origin !== `${req.protocol}://${host}`
      )
        return res
          .status(403)
          .json({ message: "Cross-origin requests are not allowed." });
      if (req.method !== "GET" && req.headers["x-demo-request"] !== "1")
        return res
          .status(403)
          .json({ message: "Missing request protection header." });
    }
    const id = /(?:^|;\s*)fera_session=([^;]+)/.exec(
      req.headers.cookie || "",
    )?.[1];
    let session = sessions.get(id);
    if (session && session.last < Date.now() - 60 * 60 * 1000) {
      sessions.delete(id);
      session = null;
    }
    if (session) session.last = Date.now();
    req.session = session;
    req.sessionId = id;
    next();
  });
  app.use(express.json({ limit }));
  app.get("/demo/config", (_req, res) =>
    res.json({ ...config, mode: "live", allowed: [...allowed] }),
  );
  app.get("/demo/session", (req, res) =>
    res.json({
      authenticated: Boolean(req.session?.token),
      expires: req.session?.expires || null,
      instance: req.session?.instance,
    }),
  );
  app.post("/demo/token", (req, res) =>
    req.session?.token
      ? res.json({ token: req.session.token })
      : res.status(401).json({ message: "Not authenticated" }),
  );
  app.post("/demo/logout", (req, res) => {
    sessions.delete(req.sessionId);
    res.clearCookie("fera_session");
    res.json({ success: true });
  });
  async function transmit({ base, route, method, body, headers, multipart }) {
    base = safeBase(base);
    if (!allowed.has(base))
      throw Object.assign(
        Error(
          "API URL is not in the configured allowlist. Edit ALLOWED_API_URLS and restart.",
        ),
        { status: 403 },
      );
    const url = `${base}${route}`;
    let sentBody;
    let summary = body;
    if (multipart) {
      const bytes = Buffer.from(multipart.base64 || "", "base64");
      if (
        !/\.docx$/i.test(multipart.name || "") ||
        bytes.length > 20 * 1024 * 1024 ||
        bytes[0] !== 80 ||
        bytes[1] !== 75
      )
        throw Object.assign(Error("Invalid DOCX upload (20 MiB maximum)."), {
          status: 400,
        });
      await checkedUpload(bytes, multipart.name);
      sentBody = new FormData();
      sentBody.append(
        "file",
        new Blob([bytes], {
          type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        }),
        multipart.name,
      );
      const prepared = new Request(url, { method, headers, body: sentBody });
      headers = Object.fromEntries(prepared.headers);
      sentBody = await prepared.arrayBuffer();
      summary = {
        file: {
          name: multipart.name,
          size: bytes.length,
          type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        },
      };
    } else if (!["GET", "DELETE"].includes(method)) {
      headers["content-type"] = "application/json";
      sentBody = JSON.stringify(body ?? {});
    }
    const start = performance.now();
    const upstream = await fetchImpl(url, {
      method,
      headers,
      body: sentBody,
      redirect: "manual",
      signal: AbortSignal.timeout(120000),
    });
    const responseHeaders = Object.fromEntries(upstream.headers);
    let size = 0;
    const chunks = [];
    for await (const chunk of upstream.body || []) {
      size += chunk.length;
      if (size > limit)
        throw Object.assign(Error("Response exceeds 30 MiB demo limit"), {
          status: 413,
        });
      chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks),
      type = upstream.headers.get("content-type") || "";
    let data;
    if (type.includes("json")) {
      try {
        data = JSON.parse(bytes.toString());
      } catch {
        data = bytes.toString();
      }
    } else if (
      type.includes("pdf") ||
      type.includes("officedocument") ||
      type.includes("octet-stream")
    )
      data = {
        binary: true,
        base64: bytes.toString("base64"),
        contentType: type,
        size: bytes.length,
      };
    else data = bytes.toString();
    return {
      request: { method, url, headers: redact(headers), body: redact(summary) },
      status: upstream.status,
      headers: redact(responseHeaders),
      elapsedMs: Math.round(performance.now() - start),
      contentType: type,
      data,
    };
  }
  app.post("/demo/login", async (req, res, next) => {
    try {
      const { auth, render, instance, email, password, apiKey } = req.body;
      if (!instance || (!apiKey && (!email || !password)))
        return res
          .status(400)
          .json({ message: "Instance and credentials are required." });
      if (!allowed.has(safeBase(render)))
        return res.status(403).json({ message: "Render URL is not allowed." });
      const result = await transmit({
        base: auth,
        route: "/api/v1/auth",
        method: "POST",
        headers: { instance, ...(apiKey ? { "x-api-key": apiKey } : {}) },
        body: apiKey ? {} : { email, password },
      });
      if (
        result.status >= 200 &&
        result.status < 300 &&
        typeof result.data?.token === "string"
      ) {
        const token = result.data.token;
        let expires = null;
        try {
          expires =
            JSON.parse(Buffer.from(token.split(".")[1], "base64url")).exp *
              1000 || null;
        } catch {}
        sessions.delete(req.sessionId);
        const id = crypto.randomBytes(32).toString("hex");
        sessions.set(id, {
          token,
          instance,
          auth: safeBase(auth),
          render: safeBase(render),
          expires,
          last: Date.now(),
        });
        res.cookie("fera_session", id, {
          httpOnly: true,
          sameSite: "strict",
          secure: req.secure,
          path: "/",
          maxAge: 60 * 60 * 1000,
        });
        result.session = { authenticated: true, expires, instance };
      }
      result.data = redact(result.data);
      res.json(result);
    } catch (e) {
      next(e);
    }
  });
  app.post("/demo/execute", async (req, res, next) => {
    try {
      const {
        operationId,
        params = {},
        query = {},
        body = {},
        multipart,
        accept = "application/json",
        failureMode,
      } = req.body;
      const op = operations.find((o) => o.id === operationId && !o.internal);
      if (!op)
        return res
          .status(403)
          .json({ message: "Operation is not public/allowlisted." });
      const session = req.session;
      if (!session)
        return res
          .status(401)
          .json({ message: "Sign in to establish a transient session." });
      for (const key of ["xml", "xsl", "content", "package"])
        if (
          typeof body[key] === "string" &&
          /<!DOCTYPE|<!ENTITY|xsl:(?:include|import|result-document)|(?:doc|document|collection|unparsed-text|environment-variable)\s*\(/i.test(
            body[key],
          )
        )
          return res.status(400).json({
            message:
              "Demo XML/XSLT input must be self-contained: external resources, DTDs and result documents are prohibited.",
          });
      if (op.route === "/api/v1/pdf/forms/fields" && (body.form || body.pdf))
        await checkedUpload(
          Buffer.from(body.form || body.pdf, "base64"),
          "form.pdf",
        );
      let route = op.route.replace(/\{([^}]+)\}/g, (_, key) => {
        if (
          !params[key] ||
          String(params[key]).includes("/") ||
          [".", ".."].includes(String(params[key]))
        )
          throw Object.assign(Error(`Set path parameter ${key}`), {
            status: 400,
          });
        return encodeURIComponent(params[key]);
      });
      const search = new URLSearchParams(query).toString();
      if (search) route += `?${search}`;
      let token = session.token,
        instance = session.instance;
      if (failureMode === "missing") token = "";
      if (failureMode === "invalid") token = "deliberately-invalid-demo-token";
      if (failureMode === "instance")
        instance = "00000000-0000-0000-0000-000000000000";
      if (failureMode === "expired")
        return res.status(400).json({
          message:
            "A genuine expired signed token must expire naturally. The demo cannot forge one.",
        });
      res.json(
        await transmit({
          base: session.render,
          route,
          method: op.method,
          body,
          multipart,
          headers: {
            instance,
            ...(token ? { "x-auth-token": token } : {}),
            accept,
          },
        }),
      );
    } catch (e) {
      next(e);
    }
  });
  app.use((error, _req, res, _next) =>
    res
      .status(error.status || (error.type === "entity.too.large" ? 413 : 502))
      .json({ message: error.message || "Request failed" }),
  );
  const timer = setInterval(() => {
    for (const [id, s] of sessions)
      if (s.last < Date.now() - 60 * 60 * 1000) sessions.delete(id);
  }, 60000);
  timer.unref();
  app.locals.close = () => {
    clearInterval(timer);
    sessions.clear();
  };
  return app;
}
