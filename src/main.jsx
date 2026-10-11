import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import operations from "../shared/operations.json";
import {
  business,
  serialize,
  resolve,
  dataPaths,
  formTemplate,
  mappingValues,
  errors,
  redact,
  parseXml,
} from "../shared/data.js";
import { validateUpload } from "../shared/documents.js";
import { local, pretty, visualBody, snippets, resultArtifact } from "./api.js";
import "./style.css";

const pages = [
  "Getting Started and Authentication",
  "JSON Datasets and XML",
  "Template Management",
  "DOCX Rendering",
  "PDF Rendering",
  "PDF Form Fields",
  "Template Components and Compilation",
  "Field Mappings",
  "Advanced API Explorer",
  "Troubleshooting and API Reference",
];
const opFor = (method, route) =>
  operations.find((o) => o.method === method && o.route === route);
const unique = (prefix) => `demo-${prefix}-${Date.now().toString(36)}`;
const asset = (name) => fetch(`/assets/${name}`).then((r) => r.text());
const copy = (value) =>
  navigator.clipboard.writeText(
    typeof value === "string" ? value : pretty(value),
  );
const download = (name, value, type = "application/json") => {
  const url = URL.createObjectURL(new Blob([value], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
const bytes64 = (bytes) => {
  let text = "";
  for (let i = 0; i < bytes.length; i += 8192)
    text += String.fromCharCode(...bytes.slice(i, i + 8192));
  return btoa(text);
};
function Editor({ label, value, onChange, rows = 10, readOnly = false }) {
  return (
    <label className="editor">
      <span>{label}</span>
      <textarea
        spellCheck="false"
        rows={rows}
        value={value}
        readOnly={readOnly}
        onChange={(e) => onChange?.(e.target.value)}
      />
    </label>
  );
}
function Input({ label, value, onChange, type = "text", ...rest }) {
  return (
    <label>
      <span>{label}</span>
      <input
        type={type}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        {...rest}
      />
    </label>
  );
}
function Code({ value }) {
  const text = typeof value === "string" ? value : pretty(value);
  const tokens = String(text ?? "").split(
    /(<[^>]+>|"(?:[^"\\]|\\.)*"|\b(?:true|false|null|\d+(?:\.\d+)?)\b)/g,
  );
  return (
    <pre>
      <code>
        {tokens.map((token, i) =>
          /^<|^"|^(?:true|false|null|\d)/.test(token) ? (
            <span
              className={
                token.startsWith("<")
                  ? "syntax-tag"
                  : token.startsWith('"')
                    ? "syntax-string"
                    : "syntax-value"
              }
              key={i}
            >
              {token}
            </span>
          ) : (
            token
          ),
        )}
      </code>
    </pre>
  );
}
function App() {
  const [page, setPage] = useState(0),
    [config, setConfig] = useState(null),
    [session, setSession] = useState({ authenticated: false }),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [trace, setTrace] = useState(null),
    [history, setHistory] = useState([]),
    [artifact, setArtifact] = useState(null),
    [json, setJson] = useState(pretty(business)),
    [xml, setXml] = useState(serialize(business)),
    [datasetUuid, setDatasetUuid] = useState(""),
    [templateUuid, setTemplateUuid] = useState(""),
    [resources, setResources] = useState([]),
    [walk, setWalk] = useState(null),
    [formState, setFormState] = useState({
      pdf: null,
      fields: [],
      mappings: [],
      filter: "",
      name: unique("form"),
      saved: "",
      savedMap: null,
      content: "",
      metadata: false,
      mappingCheck: null,
      previous: null,
    });
  useEffect(() => {
    Promise.all([local("config"), local("session")])
      .then(([c, s]) => {
        setConfig(c);
        setSession(s);
      })
      .catch((e) => setNotice(e.message));
  }, []);
  useEffect(
    () => () => {
      if (artifact?.url) URL.revokeObjectURL(artifact.url);
    },
    [artifact],
  );
  function convert() {
    const data = JSON.parse(json),
      value = serialize(data);
    setXml(value);
    return value;
  }
  function capture(result) {
    const id =
      result.data?.uuid || result.data?.item?.uuid || result.data?.data?.uuid;
    if (id) {
      setResources((old) => [
        ...old.filter((x) => x.uuid !== id),
        {
          uuid: id,
          route: result.request.url,
          name: result.data?.name || result.data?.item?.name,
        },
      ]);
      if (result.request.url.includes("/datasets")) setDatasetUuid(id);
      if (result.request.url.match(/\/templates(?:\?|$)/)) setTemplateUuid(id);
    }
    return id;
  }
  async function execute(method, route, body = {}, params = {}, options = {}) {
    const op = opFor(method, route);
    if (!op) throw Error("Unknown canonical operation");
    const request = {
      method,
      url:
        (config?.render || "") +
        route.replace(/\{([^}]+)\}/g, (_, k) =>
          encodeURIComponent(params[k] || `{${k}}`),
        ) +
        (options.query && Object.keys(options.query).length
          ? "?" + new URLSearchParams(options.query)
          : ""),
      headers: {
        instance: config?.instance || "",
        "x-auth-token": "[REDACTED]",
        accept: options.accept || "application/json",
        ...(!["GET", "DELETE"].includes(method)
          ? {
              "content-type": options.multipart
                ? "multipart/form-data; boundary=<generated by fetch>"
                : "application/json",
            }
          : {}),
      },
      body: options.multipart
        ? {
            file: {
              name: options.multipart.name,
              size: Math.round((options.multipart.base64.length * 3) / 4),
            },
          }
        : body,
    };
    setTrace({ request: redact(request), pending: true });
    setNotice("");
    const result = await local("execute", {
      operationId: op.id,
      params,
      body,
      ...options,
    });
    setTrace(result);
    setHistory((old) => [
      ...old.slice(-39),
      redact({ ...result, data: visualBody(result.data) }),
    ]);
    if (result.status < 200 || result.status >= 300)
      throw Error(
        `${result.status}: ${errors[result.status] || "API request failed"} ${pretty(result.data)}`,
      );
    if (result.data?.success === false)
      throw Error(`API returned success=false: ${pretty(result.data)}`);
    capture(result);
    const output = await resultArtifact(result, options.expected || {});
    setArtifact(output);
    return result;
  }
  async function run(action) {
    setBusy(true);
    setNotice("");
    try {
      return await action();
    } catch (e) {
      setNotice(e.message);
      setTrace((old) =>
        old?.pending
          ? {
              ...old,
              pending: false,
              status: 0,
              contentType: "application/json",
              data: { message: e.message },
              headers: {},
            }
          : old,
      );
    } finally {
      setBusy(false);
    }
  }
  const common = {
    formState,
    setFormState,
    config,
    session,
    busy,
    run,
    execute,
    json,
    setJson,
    xml,
    setXml,
    convert,
    datasetUuid,
    setDatasetUuid,
    templateUuid,
    setTemplateUuid,
    resources,
    setResources,
    artifact,
    setArtifact,
    setNotice,
  };
  if (!config)
    return (
      <main className="loading">
        Loading FeraRender Developer Studio…{notice}
      </main>
    );
  return (
    <div className="shell">
      <aside>
        <img className="brand" src="/assets/feradel.svg" alt="Feradel" />
        <div className="product">
          FeraRender <small>DEVELOPER STUDIO</small>
        </div>
        <nav>
          {pages.map((name, i) => (
            <button
              key={name}
              className={page === i ? "active" : ""}
              onClick={() => setPage(i)}
            >
              <span>{String(i + 1).padStart(2, "0")}</span>
              {name}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <i className={session.authenticated ? "connected" : ""} />
          {session.authenticated ? "Session connected" : "Connect your API"}
          <small>Live requests · local workspace</small>
        </div>
      </aside>
      <div className="content">
        <header>
          <div>FERA / RENDER / LEARN</div>
          <span className="pill">LIVE API MODE</span>
        </header>
        <main>
          <div className="heading">
            <div>
              <p className="eyebrow">EXPLORE. RENDER. UNDERSTAND.</p>
              <h1>{pages[page]}</h1>
              <p className="subtitle">
                Real API calls, editable inputs, inspectable results.
              </p>
            </div>
            <button
              className="primary"
              onClick={() =>
                setWalk({
                  kind: page === 5 ? "form" : page === 4 ? "pdf" : "docx",
                  step: 0,
                  done: [],
                })
              }
            >
              Run Full Demonstration ↗
            </button>
          </div>
          {notice && (
            <div role="alert" className="alert">
              {notice}
            </div>
          )}
          {walk && (
            <Walkthrough
              {...common}
              walk={walk}
              setWalk={setWalk}
              setPage={setPage}
            />
          )}
          {page === 0 && (
            <Auth
              {...common}
              setConfig={setConfig}
              setSession={setSession}
              setTrace={setTrace}
            />
          )}
          {page === 1 && <Datasets {...common} />}
          {page === 2 && <Templates {...common} />}
          {page === 3 && <RenderDocx {...common} />}
          {page === 4 && <RenderPdf {...common} />}
          {page === 5 && <PdfForms {...common} />}
          {page === 6 && <Components {...common} />}
          {page === 7 && <Mappings {...common} />}
          {page === 8 && <Explorer {...common} />}
          {page === 9 && <Reference />}
          <Inspector trace={trace} artifact={artifact} history={history} />
        </main>
        <footer>
          Feradel · FeraRender API learning environment{" "}
          <span>42 public operations · 4 infrastructure contracts</span>
        </footer>
      </div>
    </div>
  );
}
function Auth({
  config,
  setConfig,
  session,
  setSession,
  run,
  busy,
  execute,
  setTrace,
  setNotice,
}) {
  const [email, setEmail] = useState(config.email),
    [password, setPassword] = useState(""),
    [key, setKey] = useState(""),
    [method, setMethod] = useState("credentials"),
    [revealed, setRevealed] = useState(""),
    [failure, setFailure] = useState("missing");
  async function login() {
    setRevealed("");
    const result = await local("login", {
      auth: config.auth,
      render: config.render,
      instance: config.instance,
      email,
      password,
      ...(method === "key" ? { apiKey: key } : {}),
    });
    setPassword("");
    setKey("");
    setTrace(result);
    if (!result.session)
      throw Error(`${result.status}: ${pretty(result.data)}`);
    setSession(result.session);
  }
  return (
    <>
      <section className="card">
        <h2>01 / Connect to FerAuth</h2>
        <p>
          Send credentials to <code>POST /api/v1/auth</code> with the{" "}
          <code>instance</code> header. The returned <code>token</code> is a JWT
          for <code>x-auth-token</code> on subsequent calls.
        </p>
        <div className="grid">
          <Input
            label="Auth API URL"
            value={config.auth}
            onChange={(auth) => setConfig({ ...config, auth })}
          />
          <Input
            label="Render API URL"
            value={config.render}
            onChange={(render) => setConfig({ ...config, render })}
          />
          <Input
            label="Instance UUID"
            value={config.instance}
            onChange={(instance) => setConfig({ ...config, instance })}
          />
          <label>
            <span>Authentication method</span>
            <select value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="credentials">Email + password</option>
              <option value="key">
                API-key account login (if provisioned)
              </option>
            </select>
          </label>
          {method === "credentials" ? (
            <>
              <Input
                label="Email"
                type="email"
                value={email}
                onChange={setEmail}
              />
              <Input
                label="Password"
                type="password"
                autoComplete="off"
                value={password}
                onChange={setPassword}
              />
            </>
          ) : (
            <Input
              label="Account API key (exchanged for a JWT)"
              type="password"
              value={key}
              onChange={setKey}
            />
          )}
        </div>
        <div className="actions">
          <button
            className="primary"
            disabled={busy}
            onClick={() => run(login)}
          >
            Authenticate
          </button>
          <button
            disabled={!session.authenticated || busy}
            onClick={() => run(() => execute("GET", "/api/v1/templates"))}
          >
            Use JWT · List templates
          </button>
          <button
            onClick={() =>
              run(async () => {
                await local("logout", {});
                setSession({ authenticated: false });
                setRevealed("");
                setPassword("");
                setKey("");
                setTrace(null);
              })
            }
          >
            Disconnect / clear session
          </button>
        </div>
        <h3>HTTP Request</h3>
        <Code
          value={{
            method: "POST",
            url: config.auth + "/api/v1/auth",
            headers: {
              instance: config.instance,
              ...(method === "key" ? { "x-api-key": "[REDACTED]" } : {}),
            },
            body: method === "key" ? {} : { email, password: "[REDACTED]" },
          }}
        />
      </section>
      <section className="card">
        <h2>02 / Session token</h2>
        <p>
          {session.authenticated
            ? "Authenticated. Token kept in server memory behind an HttpOnly, SameSite cookie."
            : "No authenticated session."}{" "}
          Passwords and tokens are never stored in localStorage.
        </p>
        <p>
          Expiration:{" "}
          {session.expires
            ? new Date(session.expires).toLocaleString()
            : "Not available"}{" "}
          ·{" "}
          {session.expires && session.expires < Date.now()
            ? "Expired — authenticate again"
            : "JWT expiration is enforced upstream."}
        </p>
        <Code value={revealed || "••••••••••••••••••••••••"} />
        <div className="actions">
          <button
            disabled={!session.authenticated}
            onClick={() =>
              run(async () => setRevealed((await local("token", {})).token))
            }
          >
            Reveal my token
          </button>
          <button
            disabled={!session.authenticated}
            onClick={() =>
              run(async () => copy((await local("token", {})).token))
            }
          >
            Copy my token
          </button>
          <button onClick={() => setRevealed("")}>Hide</button>
        </div>
      </section>
      <section className="card">
        <h2>03 / Understand failures</h2>
        <p>
          Exercise missing/invalid tokens and incorrect instance context against
          the real template list. Invalid credentials use the login form. To
          observe 403, use an account without the required permission or product
          access. For expiry, wait for your own signed JWT to expire; this demo
          cannot forge an expired signed token.
        </p>
        <div className="actions">
          <select value={failure} onChange={(e) => setFailure(e.target.value)}>
            <option value="missing">Missing token</option>
            <option value="invalid">Invalid token</option>
            <option value="instance">Incorrect instance</option>
          </select>
          <button
            disabled={busy || !session.authenticated}
            onClick={() =>
              run(() =>
                execute(
                  "GET",
                  "/api/v1/templates",
                  {},
                  {},
                  { failureMode: failure },
                ),
              )
            }
          >
            Execute failure example
          </button>
        </div>
      </section>
    </>
  );
}
function DatasetEditor({ json, setJson, xml, setXml, convert, run }) {
  const [path, setPath] = useState("/data/Person/Name"),
    [values, setValues] = useState(null);
  return (
    <>
      <div className="grid">
        <Editor
          label="Input · JSON dataset"
          value={json}
          onChange={setJson}
          rows={15}
        />
        <Editor
          label="Result · compatible XML"
          value={xml}
          onChange={setXml}
          rows={15}
        />
      </div>
      <div className="actions">
        <button className="primary" onClick={() => run(() => convert())}>
          Validate JSON → XML
        </button>
        <button
          onClick={() => {
            setJson(pretty(business));
            setXml(serialize(business));
          }}
        >
          Reset business sample
        </button>
        <button onClick={() => download("dataset.json", json)}>
          Save dataset
        </button>
        <label className="file">
          Load JSON
          <input
            type="file"
            accept=".json"
            onChange={(e) => {
              const file = e.target.files[0];
              if (file)
                run(async () => {
                  if (file.size > 2 * 1024 * 1024)
                    throw Error("Dataset exceeds 2 MiB");
                  const text = await file.text();
                  JSON.parse(text);
                  setJson(text);
                });
            }}
          />
        </label>
      </div>
      <p>
        Serialization runs locally with Feradel’s <code>object-to-xml</code>{" "}
        conventions: a <code>&lt;data&gt;</code> root, repeated elements for
        arrays and empty elements for null values. UTF-8 preserves Unicode.{" "}
        <code>POST /api/v1/xml</code> runs XML/XSLT transformation; it does not
        convert JSON to XML.
      </p>
      <details>
        <summary>Syntax-highlighted XML output</summary>
        <Code value={xml} />
      </details>
      <h3>XPath explorer</h3>
      <div className="actions">
        <input
          aria-label="XPath expression"
          list="dataset-paths"
          value={path}
          onChange={(e) => setPath(e.target.value)}
        />
        <datalist id="dataset-paths">
          {(() => {
            try {
              return dataPaths(JSON.parse(json)).map((p) => (
                <option key={p.path} value={p.path} />
              ));
            } catch {
              return null;
            }
          })()}
        </datalist>
        <button onClick={() => run(() => setValues(resolve(xml, path)))}>
          Resolve XPath
        </button>
      </div>
      {values !== null && <Code value={values} />}
    </>
  );
}
function Datasets(props) {
  const { name } = props;
  return (
    <>
      <section className="card">
        <h2>Build your source data</h2>
        <DatasetEditor {...props} />
        <div className="actions">
          <button
            disabled={props.busy}
            onClick={() =>
              props.run(() =>
                props.execute("POST", "/api/v1/datasets", {
                  name: unique("dataset"),
                  rootPath: "/data",
                  sampleData: JSON.parse(props.json),
                  schema: {},
                  active: true,
                }),
              )
            }
          >
            Create dataset definition
          </button>
          <span>
            Dataset UUID: <code>{props.datasetUuid || "not created"}</code>
          </span>
        </div>
        <p className="note">
          Backend validation currently parses stored schema/sample JSON only. It
          does not validate arbitrary submitted samples against a schema. Infer
          returns a tree without persisting it; update the dataset with that
          tree through the explorer.
        </p>
      </section>
      <Explorer {...props} group="datasets" />
    </>
  );
}
function Templates(props) {
  const [mode, setMode] = useState("docx"),
    [name, setName] = useState(unique("invoice")),
    [caption, setCaption] = useState("Demonstration invoice"),
    [category, setCategory] = useState("DEMO"),
    [output, setOutput] = useState("RTF"),
    [fileName, setFileName] = useState("invoice.docx"),
    [source, setSource] = useState(""),
    [meta, setMeta] = useState("{}"),
    [selected, setSelected] = useState(""),
    [items, setItems] = useState([]);
  useEffect(() => {
    asset("invoice-docx.xml").then(setSource);
  }, []);
  async function loadMode(value) {
    setMode(value);
    setOutput(value === "docx" ? "RTF" : value === "pdf" ? "PDF" : "PDF");
    setFileName(value === "docx" ? "invoice.docx" : "invoice.pdf");
    setSource(
      value === "form"
        ? ""
        : await asset(
            value === "docx" ? "invoice-docx.xml" : "invoice-pdf.xsl",
          ),
    );
  }
  async function save() {
    parseXml(source);
    const body = {
      name,
      caption,
      category,
      output,
      fileName,
      content: source,
      meta: JSON.parse(meta),
      owner: props.config.instance,
      mode: "FULL",
      datasetUuid: props.datasetUuid || null,
      ...(selected ? { uuid: selected } : {}),
    };
    const result = await props.execute("POST", "/api/v1/templates", body);
    setSelected(result.data.uuid);
    await props.execute(
      "POST",
      "/api/v1/templates/i/{uuid}/validate",
      {},
      { uuid: result.data.uuid },
    );
  }
  return (
    <>
      <section className="card">
        <h2>Save a real template</h2>
        <p>
          DOCX uses a <code>&lt;root&gt;&lt;file&gt;</code> package manifest
          with transformable OpenXML parts. PDF reports use XSLT producing
          XSL-FO. AcroForm templates use encoded PDF plus mapping XSLT; create
          these on the PDF Form Fields page.
        </p>
        <div className="grid">
          <label>
            <span>Source format</span>
            <select
              value={mode}
              onChange={(e) => props.run(() => loadMode(e.target.value))}
            >
              <option value="docx">DOCX / OpenXML package</option>
              <option value="pdf">PDF / XSLT → XSL-FO</option>
              <option value="form">PDF form XML wrapper</option>
            </select>
          </label>
          <Input label="Template name" value={name} onChange={setName} />
          <Input label="Caption" value={caption} onChange={setCaption} />
          <Input label="Category" value={category} onChange={setCategory} />
          <Input label="Output" value={output} onChange={setOutput} />
          <Input
            label="Suggested filename"
            value={fileName}
            onChange={setFileName}
          />
          <Input
            label="Associated dataset UUID"
            value={props.datasetUuid}
            onChange={props.setDatasetUuid}
          />
          <Input
            label="Update selected template UUID (empty creates)"
            value={selected}
            onChange={setSelected}
          />
        </div>
        <Editor
          label="Source content"
          value={source}
          onChange={setSource}
          rows={16}
        />
        <Editor
          label="Metadata JSON"
          value={meta}
          onChange={setMeta}
          rows={3}
        />
        <div className="actions">
          <button
            className="primary"
            disabled={props.busy}
            onClick={() => props.run(save)}
          >
            Save Template · validate
          </button>
          <button
            onClick={() =>
              props.run(async () =>
                setItems(
                  (await props.execute("GET", "/api/v1/templates")).data
                    .items || [],
                ),
              )
            }
          >
            List / select existing
          </button>
          <label className="file">
            Import source XML/XSLT
            <input
              type="file"
              accept=".xml,.xsl,.xslt"
              onChange={(e) => {
                const f = e.target.files[0];
                if (f)
                  props.run(async () => {
                    if (f.size > 20 * 1024 * 1024)
                      throw Error("Source exceeds 20 MiB");
                    setSource(await f.text());
                  });
              }}
            />
          </label>
        </div>
        {items.length > 0 && (
          <label>
            <span>Existing template</span>
            <select
              value={selected}
              onChange={(e) => {
                const t = items.find((x) => x.uuid === e.target.value);
                if (t) {
                  setSelected(t.uuid);
                  props.setTemplateUuid(t.uuid);
                  setName(t.name);
                  setCaption(t.caption || "");
                  setCategory(t.category || "");
                  setOutput(t.output);
                  setFileName(t.fileName || "");
                  setSource(t.content || "");
                  setMeta(
                    typeof t.meta === "string" ? t.meta : pretty(t.meta || {}),
                  );
                }
              }}
            >
              <option value="">Select a template</option>
              {items.map((t) => (
                <option key={t.uuid} value={t.uuid}>
                  {t.name} · {t.uuid}
                </option>
              ))}
            </select>
          </label>
        )}
      </section>
      <Explorer {...props} group="templates" />
    </>
  );
}
function RenderDocx(props) {
  const [metadata, setMetadata] = useState(false),
    [asPdf, setAsPdf] = useState(false);
  async function create() {
    const source = await asset("invoice-docx.xml");
    return props.execute("POST", "/api/v1/templates", {
      owner: props.config.instance,
      name: unique("docx"),
      caption: "Demo invoice",
      category: "DEMO",
      output: "RTF",
      fileName: "invoice.docx",
      content: source,
      mode: "FULL",
      datasetUuid: props.datasetUuid || null,
    });
  }
  return (
    <section className="card">
      <h2>JSON → XML → Template → DOCX</h2>
      <p>
        The sample contains dynamic customer values, repeated line items, a
        table, formatted date/currency, and an optional notes paragraph. Full
        package templates render directly; composite templates must be compiled
        after edits.
      </p>
      <DatasetEditor {...props} />
      <div className="actions">
        <button disabled={props.busy} onClick={() => props.run(create)}>
          Create sample DOCX template
        </button>
        <a href="/assets/invoice-docx.xml" download>
          Download template source
        </a>
      </div>
      <Input
        label="Saved template UUID"
        value={props.templateUuid}
        onChange={props.setTemplateUuid}
      />
      <div className="actions">
        <label className="check">
          <input
            type="checkbox"
            checked={metadata}
            onChange={(e) => setMetadata(e.target.checked)}
          />{" "}
          metadata=true (JSON/base64)
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={asPdf}
            onChange={(e) => setAsPdf(e.target.checked)}
          />{" "}
          asPdf (separate conversion)
        </label>
        <button
          className="primary"
          disabled={props.busy}
          onClick={() =>
            props.run(() =>
              props.execute(
                "POST",
                "/api/v1/docx",
                {
                  owner: props.config.instance,
                  uuid: props.templateUuid,
                  xml: props.convert(),
                  metadata,
                  asPdf,
                },
                {},
                {
                  accept: metadata
                    ? "application/json"
                    : asPdf
                      ? "application/pdf"
                      : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                  expected: asPdf
                    ? {}
                    : {
                        customer: JSON.parse(props.json).Person?.Name,
                        invoice: JSON.parse(props.json).Invoice?.Number,
                      },
                },
              ),
            )
          }
        >
          Render document
        </button>
      </div>
    </section>
  );
}
function RenderPdf(props) {
  const [html, setHtml] = useState(
      "<!doctype html><html><head><style>body{font-family:sans-serif;color:#152331}h1{color:#1f6f8b}</style></head><body><h1>Northstar Studio</h1><p>Invoice DEMO-1042 for Alex Rivera</p><p>Total: $1,250.50</p></body></html>",
    ),
    [xsl, setXsl] = useState(""),
    [docx, setDocx] = useState(null);
  useEffect(() => {
    asset("transform.xsl").then(setXsl);
  }, []);
  return (
    <>
      <section className="card">
        <h2>A / XML + XSLT → PDF report</h2>
        <DatasetEditor {...props} />
        <div className="actions">
          <button
            onClick={() =>
              props.run(async () =>
                props.execute("POST", "/api/v1/templates", {
                  owner: props.config.instance,
                  name: unique("pdf"),
                  output: "PDF",
                  caption: "Demo report",
                  category: "DEMO",
                  content: await asset("invoice-pdf.xsl"),
                  fileName: "invoice.pdf",
                }),
              )
            }
          >
            Save sample XSLT report
          </button>
          <button
            className="primary"
            disabled={props.busy}
            onClick={() =>
              props.run(() =>
                props.execute("POST", "/api/v1/pdf/document", {
                  owner: props.config.instance,
                  uuid: props.templateUuid,
                  xml: props.convert(),
                }),
              )
            }
          >
            Render PDF
          </button>
        </div>
        <Input
          label="PDF template UUID"
          value={props.templateUuid}
          onChange={props.setTemplateUuid}
        />
        <p>
          The renderer consumes XSL-FO, rather than arbitrary HTML. Result
          inspection verifies PDF structure; visible dynamic report content
          needs preview/live qualification.
        </p>
      </section>
      <section className="card">
        <h2>B / HTML → PDF</h2>
        <p>
          No scripts, external resources, images, embedded objects, forms, event
          handlers, URLs or CSS imports. Limits and content validation are
          enforced upstream.
        </p>
        <Editor label="HTML document" value={html} onChange={setHtml} />
        <button
          className="primary"
          disabled={props.busy}
          onClick={() =>
            props.run(() =>
              props.execute("POST", "/api/v1/pdf/html", {
                html,
                name: "report.pdf",
              }),
            )
          }
        >
          Render HTML
        </button>
      </section>
      <section className="card">
        <h2>C / Direct XML/XSLT transformation</h2>
        <Editor label="Source XML" value={props.xml} onChange={props.setXml} />
        <Editor label="XSLT" value={xsl} onChange={setXsl} />
        <button
          disabled={props.busy}
          onClick={() =>
            props.run(() =>
              props.execute("POST", "/api/v1/xml", { xml: props.xml, xsl }),
            )
          }
        >
          Transform XML
        </button>
      </section>
      <section className="card">
        <h2>D / DOCX → PDF</h2>
        <input
          aria-label="DOCX conversion file"
          type="file"
          accept=".docx"
          onChange={(e) => {
            const file = e.target.files[0];
            if (file)
              props.run(async () => {
                const bytes = new Uint8Array(await file.arrayBuffer());
                await validateUpload(bytes, file.name);
                setDocx({ name: file.name, base64: bytes64(bytes) });
              });
          }}
        />
        <p>
          Confirmed multipart route: <code>/api/v1/pdf/docx/docx/pdf</code>. The
          upload field is <code>file</code>.
        </p>
        <button
          disabled={!docx || props.busy}
          onClick={() =>
            props.run(() =>
              props.execute(
                "POST",
                "/api/v1/pdf/docx/docx/pdf",
                {},
                {},
                { multipart: docx, accept: "application/pdf" },
              ),
            )
          }
        >
          Convert DOCX
        </button>
      </section>
      <section className="card">
        <h2>E / Literal DOCX package</h2>
        <p>
          This endpoint packages safe, literal OpenXML parts. It rejects
          transformations and external/executable content.
        </p>
        <button
          onClick={() =>
            props.run(async () =>
              props.execute("POST", "/api/v1/docx/package", {
                package: await asset("literal-package.xml"),
                xml: "<data/>",
                name: "literal.docx",
              }),
            )
          }
        >
          Generate literal package
        </button>
      </section>
    </>
  );
}
function PdfForms(props) {
  const field = (key) => [
    props.formState[key],
    (value) =>
      props.setFormState((old) => ({
        ...old,
        [key]: typeof value === "function" ? value(old[key]) : value,
      })),
  ];
  const [pdf, setPdf] = field("pdf"),
    [fields, setFields] = field("fields"),
    [mappings, setMappings] = field("mappings"),
    [filter, setFilter] = field("filter"),
    [name, setName] = field("name"),
    [saved, setSaved] = field("saved"),
    [savedMap, setSavedMap] = field("savedMap"),
    [content, setContent] = field("content"),
    [metadata, setMetadata] = field("metadata"),
    [mappingCheck, setMappingCheck] = field("mappingCheck"),
    [previous, setPrevious] = field("previous");
  async function loadFile(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    await validateUpload(bytes, file.name);
    setPdf({ name: file.name, base64: bytes64(bytes) });
    setFields([]);
    setMappings([]);
    setSaved("");
    setSavedMap(null);
    setContent("");
    setMappingCheck(null);
  }
  async function discover() {
    const result = await props.execute("POST", "/api/v1/pdf/forms/fields", {
      form: pdf.base64,
    });
    if (!Array.isArray(result.data.fields) || !result.data.fields.length)
      throw Error(
        "No supported fields returned. The PDF may be flat, XFA, malformed, or the renderer may be unavailable.",
      );
    const fieldRows = result.data.fields.map((f) =>
      typeof f === "string"
        ? { name: f }
        : {
            ...f,
            name: f.name ?? f.Name ?? f.fieldName ?? f.FieldName,
            type: f.type ?? f.Type ?? f.fieldType ?? f.FieldType,
          },
    );
    if (fieldRows.some((f) => !f.name))
      throw Error(
        "Renderer returned a field without an identifiable name; inspect the raw response.",
      );
    setFields(fieldRows);
    const sample = JSON.parse(await asset("form-mappings.json"));
    setMappings(
      fieldRows.map(
        (f) =>
          sample.find((m) => m.name === f.name) || {
            name: f.name,
            kind: "literal",
            value: String(f.value ?? f.Value ?? "Sample value"),
          },
      ),
    );
  }
  function build() {
    const output = formTemplate(pdf.base64, mappings);
    setContent(output.content);
    return output;
  }
  async function testMapping() {
    const output = build(),
      result = await props.execute("POST", "/api/v1/xml", {
        xml: props.convert(),
        xsl: output.xsl,
      });
    const actual = JSON.parse(result.data.result),
      expected = mappingValues(props.xml, mappings);
    if (pretty(actual) !== pretty(expected))
      throw Error(
        "Mapping output differs from resolved values. Inspect the transformation.",
      );
    setMappingCheck(actual);
    return output;
  }
  async function save() {
    const output = await testMapping();
    const result = await props.execute("POST", "/api/v1/templates", {
      owner: props.config.instance,
      name,
      caption: "Mapped PDF form",
      category: "DEMO",
      output: "PDF",
      fileName: "completed.pdf",
      content: output.content,
      datasetUuid: props.datasetUuid || null,
    });
    setSaved(result.data.uuid);
    setSavedMap(structuredClone(mappings));
  }
  function update(index, key, value) {
    setMappings((old) =>
      old.map((m, i) => (i === index ? { ...m, [key]: value } : m)),
    );
    setMappingCheck(null);
  }
  let paths = [];
  try {
    paths = dataPaths(JSON.parse(props.json));
  } catch {}
  return (
    <>
      <section className="card">
        <h2>01 / Upload an AcroForm PDF</h2>
        <p>
          Use an ordinary fillable AcroForm PDF. Discovery sends encoded PDF in
          a JSON <code>form</code> property, without multipart upload.
        </p>
        <div
          className="dropzone"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files[0];
            if (f) props.run(() => loadFile(f));
          }}
        >
          <strong>Drop your fillable PDF here</strong>
          <input
            aria-label="Fillable PDF"
            type="file"
            accept=".pdf"
            onChange={(e) => {
              const f = e.target.files[0];
              if (f) props.run(() => loadFile(f));
            }}
          />
          <small>PDF · maximum 20 MiB</small>
        </div>
        <div className="actions">
          <button
            onClick={() =>
              props.run(async () =>
                loadFile(
                  new File(
                    [await (await fetch("/assets/fillable.pdf")).arrayBuffer()],
                    "fillable.pdf",
                    { type: "application/pdf" },
                  ),
                ),
              )
            }
          >
            Load working sample PDF
          </button>
          <a href="/assets/fillable.pdf" download>
            Download sample
          </a>
          <button
            className="primary"
            disabled={!pdf || props.busy}
            onClick={() => props.run(discover)}
          >
            Discover form fields
          </button>
        </div>
        <p>
          {pdf?.name} · {fields.length} discovered fields
        </p>
      </section>
      {fields.length > 0 && (
        <>
          <section className="card">
            <h2>02 / Dataset and values</h2>
            <DatasetEditor {...props} />
            <button
              onClick={() => {
                const data = { FormValues: {} };
                fields.forEach(
                  (f, i) =>
                    (data.FormValues["Field" + (i + 1)] = String(
                      f.value ?? f.Value ?? "Sample value",
                    )),
                );
                props.setJson(pretty(data));
                props.setXml(serialize(data));
                setMappings(
                  fields.map((f, i) => ({
                    name: f.name,
                    kind: "json",
                    value: `/data/FormValues/Field${i + 1}`,
                  })),
                );
              }}
            >
              Create dataset with one value per discovered field
            </button>
            <button
              onClick={() =>
                props.run(() =>
                  props.execute("POST", "/api/v1/datasets", {
                    name: unique("form-data"),
                    rootPath: "/data",
                    sampleData: JSON.parse(props.json),
                    schema: {},
                    active: true,
                  }),
                )
              }
            >
              Save dataset definition
            </button>
          </section>
          <section className="card">
            <h2>03 / Map the original PDF fields</h2>
            <p>
              PDF field names and source paths are independent. Choose a JSON
              property (represented by its equivalent XPath), enter an XPath,
              use a fixed literal, or leave a value empty. Choice values must
              match options returned by your renderer. Checkbox values depend on
              the connected renderer; the sample uses <code>true</code> and
              verifies the populated field after rendering.
            </p>
            <Input
              label="Search field names"
              value={filter}
              onChange={setFilter}
            />
            <div className="mapping-list">
              {mappings.map(
                (m, i) =>
                  m.name.toLowerCase().includes(filter.toLowerCase()) && (
                    <div className="mapping" key={m.name}>
                      <div>
                        <strong>{m.name}</strong>
                        <small>{fields[i]?.type || "Type not returned"}</small>
                        <details>
                          <summary>Actual field metadata</summary>
                          <Code value={fields[i]} />
                        </details>
                      </div>
                      <select
                        aria-label={`Mapping mode ${m.name}`}
                        value={m.kind}
                        onChange={(e) => update(i, "kind", e.target.value)}
                      >
                        <option value="json">JSON property</option>
                        <option value="xpath">XML XPath</option>
                        <option value="literal">Fixed literal</option>
                        <option value="empty">Intentionally empty</option>
                      </select>
                      {m.kind === "json" ? (
                        <select
                          aria-label={`Data source ${m.name}`}
                          value={m.value}
                          onChange={(e) => update(i, "value", e.target.value)}
                        >
                          <option value="">Choose property</option>
                          {paths.map((p) => (
                            <option key={p.path} value={p.path}>
                              {p.path} = {String(p.value)}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          aria-label={`Value ${m.name}`}
                          disabled={m.kind === "empty"}
                          value={m.value}
                          onChange={(e) => update(i, "value", e.target.value)}
                        />
                      )}
                      <output>
                        {(() => {
                          try {
                            return mappingValues(props.xml, [m])[m.name];
                          } catch {
                            return "Unresolved XPath";
                          }
                        })()}
                      </output>
                    </div>
                  ),
              )}
            </div>
            <div className="actions">
              <button onClick={() => props.run(() => build())}>
                Build template XML
              </button>
              <button
                disabled={props.busy}
                onClick={() => props.run(testMapping)}
              >
                Test mapping via real XSLT endpoint
              </button>
            </div>
            {mappingCheck && <Code value={mappingCheck} />}
          </section>
          <section className="card">
            <h2>04 / Save the mapped template</h2>
            <Input
              label="Distinctive template name"
              value={name}
              onChange={setName}
            />
            <p>
              The template stores the original PDF in <code>&lt;file&gt;</code>{" "}
              and XSLT in <code>&lt;mapping&gt;</code>. XSLT 3.0{" "}
              <code>xml-to-json</code> safely escapes runtime JSON values.
            </p>
            {content && (
              <details>
                <summary>Generated XML (contains encoded PDF)</summary>
                <Editor
                  label="Generated template source"
                  value={content}
                  rows={10}
                  readOnly
                />
              </details>
            )}
            <button
              className="primary"
              disabled={props.busy}
              onClick={() => props.run(save)}
            >
              Test mapping → Save Template
            </button>
            <p>
              Saved form template UUID: <code>{saved || "not saved"}</code>
            </p>
          </section>
          <section className="card">
            <h2>05 / Render, inspect and rerender</h2>
            <p>
              Edit dataset values above and rerender with the same saved
              template. Mapping changes require saving a new template; rerender
              uses the assignments captured at save time. The inspector verifies
              populated values through the PDF’s actual fields. Flattening is
              not requested.
            </p>
            <label className="check">
              <input
                type="checkbox"
                checked={metadata}
                onChange={(e) => setMetadata(e.target.checked)}
              />{" "}
              JSON/Base64 response (otherwise PDF bytes)
            </label>
            <button
              className="primary"
              disabled={!saved || props.busy}
              onClick={() =>
                props.run(async () => {
                  if (props.artifact) {
                    if (previous?.url) URL.revokeObjectURL(previous.url);
                    setPrevious({
                      ...props.artifact,
                      url: URL.createObjectURL(
                        new Blob([props.artifact.bytes], {
                          type: props.artifact.type,
                        }),
                      ),
                    });
                  }
                  const source = props.convert();
                  await props.execute(
                    "POST",
                    "/api/v1/pdf/forms",
                    {
                      owner: props.config.instance,
                      uuid: saved,
                      xml: source,
                      contentType: metadata
                        ? "application/json"
                        : "application/pdf",
                    },
                    {},
                    {
                      accept: metadata ? "application/json" : "application/pdf",
                      expected: mappingValues(source, savedMap),
                    },
                  );
                })
              }
            >
              Render populated PDF
            </button>
            {previous && (
              <a href={previous.url} download="previous-result.pdf">
                Download previous result
              </a>
            )}
          </section>
        </>
      )}
    </>
  );
}
function Components(props) {
  const [component, setComponent] = useState(""),
    [fragment, setFragment] = useState("");
  useEffect(() => {
    asset("preamble.xsl").then(setFragment);
  }, []);
  async function create() {
    await props.execute("POST", "/api/v1/template-components/validate", {
      type: "PREAMBLE",
      content: fragment,
    });
    const result = await props.execute("POST", "/api/v1/template-components", {
      owner: props.config.instance,
      type: "PREAMBLE",
      contentFormat: "XSLT_OPENXML_FRAGMENT",
      name: unique("preamble"),
      content: fragment,
      active: true,
    });
    setComponent(result.data.item.uuid);
  }
  return (
    <>
      <section className="card">
        <h2>Compose a report</h2>
        <p>
          The current compiler supports PREAMBLE and POSTAMBLE assignments
          around the package body. It does not implement header/footer placement
          or independent BODY/BASE_PACKAGE assignment through this route. Native
          XSLT requires <code>EDIT.TEMPLATE.XSLT</code>.
        </p>
        <Editor
          label="Preamble XSLT fragment"
          value={fragment}
          onChange={setFragment}
        />
        <div className="actions">
          <button onClick={() => props.run(create)}>
            Validate → Create component
          </button>
          <button
            onClick={() =>
              props.run(async () =>
                props.execute("POST", "/api/v1/templates", {
                  owner: props.config.instance,
                  name: unique("composite"),
                  output: "RTF",
                  caption: "Composite demo",
                  content: await asset("invoice-docx.xml"),
                  mode: "COMPOSITE",
                  fileName: "composite.docx",
                }),
              )
            }
          >
            Create base package template
          </button>
        </div>
        <div className="grid">
          <Input
            label="Component UUID"
            value={component}
            onChange={setComponent}
          />
          <Input
            label="Template UUID"
            value={props.templateUuid}
            onChange={props.setTemplateUuid}
          />
        </div>
        <div className="actions">
          <button
            disabled={props.busy || !component || !props.templateUuid}
            onClick={() =>
              props.run(() =>
                props.execute(
                  "PUT",
                  "/api/v1/templates/i/{uuid}/assignments",
                  {
                    assignments: [
                      {
                        componentUuid: component,
                        placement: "PREAMBLE",
                        sortOrder: 0,
                        enabled: true,
                      },
                    ],
                  },
                  { uuid: props.templateUuid },
                ),
              )
            }
          >
            Replace assignments with this preamble
          </button>
          <button
            disabled={props.busy}
            onClick={() =>
              props.run(() =>
                props.execute(
                  "POST",
                  "/api/v1/templates/i/{uuid}/compile",
                  {},
                  { uuid: props.templateUuid },
                ),
              )
            }
          >
            Compile package
          </button>
          <button
            onClick={() =>
              props.run(() =>
                props.execute(
                  "GET",
                  "/api/v1/templates/i/{uuid}/compilation",
                  {},
                  { uuid: props.templateUuid },
                ),
              )
            }
          >
            Compilation status
          </button>
          <button
            className="primary"
            onClick={() =>
              props.run(() =>
                props.execute("POST", "/api/v1/docx", {
                  owner: props.config.instance,
                  uuid: props.templateUuid,
                  xml: props.convert(),
                }),
              )
            }
          >
            Render compiled DOCX
          </button>
        </div>
        <p>
          Draft → compiling → ready; edits invalidate compiled resources. API
          errors expose stale, invalid and mapping-required states.
        </p>
      </section>
      <Explorer {...props} group="template-components" />
    </>
  );
}
function Mappings(props) {
  const [placeholder, setPlaceholder] = useState("customer.name"),
    [path, setPath] = useState("/data/Person/Name");
  let paths = [];
  try {
    paths = dataPaths(JSON.parse(props.json));
  } catch {}
  return (
    <>
      <section className="card">
        <h2>Placeholder → XPath → Value</h2>
        <p>
          General field mappings resolve <code>[[placeholder]]</code> references
          when compiling template components. AcroForm assignments belong to the
          saved PDF template mapping and use original PDF field names instead.
        </p>
        <div className="grid">
          <Input
            label="Placeholder (without brackets)"
            value={placeholder}
            onChange={setPlaceholder}
          />
          <label>
            <span>Dataset tree path</span>
            <select value={path} onChange={(e) => setPath(e.target.value)}>
              {paths.map((p) => (
                <option key={p.path}>{p.path}</option>
              ))}
            </select>
          </label>
        </div>
        <Input label="XPath" value={path} onChange={setPath} />
        <Code
          value={(() => {
            try {
              return {
                placeholder: `[[${placeholder}]]`,
                xpath: path,
                values: resolve(props.xml, path),
              };
            } catch (e) {
              return { error: e.message };
            }
          })()}
        />
        <div className="actions">
          <button
            className="primary"
            onClick={() =>
              props.run(() =>
                props.execute("POST", "/api/v1/field-mappings", {
                  placeholder,
                  xpath: path,
                  datasetUuid: props.datasetUuid || null,
                }),
              )
            }
          >
            Create mapping
          </button>
          <button
            onClick={() =>
              props.run(() =>
                props.execute("POST", "/api/v1/field-mappings/resolve", {
                  placeholders: [placeholder],
                }),
              )
            }
          >
            Resolve placeholder
          </button>
          <button
            onClick={() =>
              props.run(() =>
                props.execute("POST", "/api/v1/field-mappings/suggest", {
                  placeholders: [placeholder],
                }),
              )
            }
          >
            Suggest (current resolver)
          </button>
        </div>
        <p>
          The current resolve/suggest endpoints return stored mapping records;
          value preview above evaluates XPath locally. Missing matches are
          unresolved; selecting a unique XPath removes ambiguity.
        </p>
      </section>
      <Explorer {...props} group="field-mappings" />
    </>
  );
}
function Explorer(props) {
  const eligible = operations.filter(
      (o) => !o.internal && (!props.group || o.group === props.group),
    ),
    [id, setId] = useState(eligible[0]?.id),
    [body, setBody] = useState("{}"),
    [params, setParams] = useState({}),
    [query, setQuery] = useState("{}"),
    [file, setFile] = useState(null),
    [accept, setAccept] = useState("application/json"),
    [confirm, setConfirm] = useState(false);
  const op = eligible.find((o) => o.id === id) || eligible[0];
  useEffect(() => {
    const value = { ...op.example };
    if ("owner" in value) value.owner = props.config.instance;
    if ("xml" in value) value.xml = props.xml;
    if ("uuid" in value) value.uuid = props.templateUuid;
    if ("sampleData" in value) {
      try {
        value.sampleData = JSON.parse(props.json);
      } catch {}
    }
    if ("content" in value && value.content === "")
      asset("preamble.xsl").then((content) =>
        setBody(pretty({ ...value, content })),
      );
    else setBody(pretty(value));
    setParams({
      uuid: op.group === "datasets" ? props.datasetUuid : props.templateUuid,
      name: "",
    });
    setConfirm(false);
    setFile(null);
  }, [op.id]);
  const intended = {
    method: op.method,
    url:
      props.config.render +
      op.route.replace(/\{([^}]+)\}/g, (_, key) =>
        encodeURIComponent(params[key] || `{${key}}`),
      ),
    headers: {
      instance: props.config.instance,
      "x-auth-token": "[REDACTED]",
      accept,
      ...(!["GET", "DELETE"].includes(op.method)
        ? {
            "content-type": op.multipart
              ? "multipart/form-data; boundary=<generated by fetch>"
              : "application/json",
          }
        : {}),
    },
    body: op.multipart
      ? { file: { name: file?.name || "input.docx" } }
      : (() => {
          try {
            return JSON.parse(body);
          } catch {
            return body;
          }
        })(),
  };
  const example = snippets(intended);
  return (
    <section className="card">
      <h2>
        {props.group
          ? "All " + props.group + " operations"
          : "Advanced API explorer"}
      </h2>
      <label>
        <span>Canonical public operation</span>
        <select value={op.id} onChange={(e) => setId(e.target.value)}>
          {eligible.map((o) => (
            <option key={o.id} value={o.id}>
              {o.method} {o.route}
            </option>
          ))}
        </select>
      </label>
      <h3>Explanation</h3>
      <p>{op.summary}</p>
      <p className="note">
        Permission: {op.permission}. Owner/instance scoping and product access
        remain enforced by the API.
      </p>
      <details>
        <summary>Contract parameters, schemas and response media</summary>
        <Code
          value={{
            parameters: op.parameters,
            requestSchema: op.schema,
            responses: op.responses,
          }}
        />
      </details>
      <h3>Input</h3>
      <div className="grid">
        {op.parameters
          .filter((p) => p.in === "path")
          .map((p) => (
            <Input
              key={p.name}
              label={`Required path parameter · ${p.name}`}
              value={params[p.name]}
              onChange={(value) => setParams({ ...params, [p.name]: value })}
            />
          ))}
        <Input
          label="Response Accept header"
          value={accept}
          onChange={setAccept}
        />
        <Editor
          label="Query parameters JSON (e.g. metadata, type, active)"
          value={query}
          onChange={setQuery}
          rows={2}
        />
      </div>
      {op.multipart ? (
        <input
          aria-label="Explorer DOCX upload"
          type="file"
          accept=".docx"
          onChange={(e) => {
            const f = e.target.files[0];
            if (f)
              props.run(async () => {
                const bytes = new Uint8Array(await f.arrayBuffer());
                await validateUpload(bytes, f.name);
                setFile({ name: f.name, base64: bytes64(bytes) });
              });
          }}
        />
      ) : (
        !["GET", "DELETE"].includes(op.method) && (
          <Editor
            label="Editable JSON request body"
            value={body}
            onChange={setBody}
          />
        )
      )}
      {op.method === "DELETE" && (
        <label className="check">
          <input
            type="checkbox"
            checked={confirm}
            onChange={(e) => setConfirm(e.target.checked)}
          />{" "}
          I expressly select this resource UUID for deletion.
        </label>
      )}
      <h3>HTTP Request (before execution)</h3>
      <Code value={visualBody(intended)} />
      <div className="actions">
        <button
          className="primary"
          disabled={
            props.busy ||
            !props.session.authenticated ||
            (op.method === "DELETE" && !confirm) ||
            (op.multipart && !file)
          }
          onClick={() =>
            props.run(() =>
              props.execute(op.method, op.route, JSON.parse(body), params, {
                query: JSON.parse(query),
                accept,
                ...(file ? { multipart: file } : {}),
              }),
            )
          }
        >
          Execute {op.method}
        </button>
        <button onClick={() => copy(example.curl)}>Copy cURL</button>
        <button onClick={() => copy(example.js)}>
          Copy JavaScript / TypeScript
        </button>
      </div>
      <details>
        <summary>Copyable developer examples</summary>
        <Code value={example.curl} />
        <Code value={example.js} />
      </details>
      <p className="note">
        Legacy <code>/api</code> aliases are deprecated. This explorer executes
        canonical routes only. Internal lifecycle endpoints are
        documentation-only.
      </p>
    </section>
  );
}
function Inspector({ trace, artifact, history }) {
  const [encoded, setEncoded] = useState(false);
  useEffect(() => setEncoded(false), [trace]);
  const example = snippets(trace?.request);
  return (
    <section className="card inspector">
      <div className="section-title">
        <h2>Request & response inspector</h2>
        <span className="pill">ACTUAL TRANSMISSION</span>
      </div>
      {!trace ? (
        <p>
          Execute an operation to inspect the real request and response here.
        </p>
      ) : (
        <>
          <h3>HTTP Request</h3>
          <Code value={visualBody(trace.request)} />
          <div className="actions">
            <button onClick={() => copy(example.curl)}>Copy actual cURL</button>
            <button onClick={() => copy(example.js)}>
              Copy actual JavaScript / TypeScript
            </button>
          </div>
          <h3>API Response</h3>
          {trace.pending ? (
            <p>Sending request…</p>
          ) : (
            <>
              <div className="response-meta">
                <b className={trace.status < 300 ? "success" : "failure"}>
                  HTTP {trace.status}
                </b>
                <span>{trace.elapsedMs} ms</span>
                <span>{trace.contentType}</span>
              </div>
              <details>
                <summary>Response headers</summary>
                <Code value={trace.headers} />
              </details>
              <Code value={visualBody(trace.data)} />
              <button onClick={() => setEncoded(!encoded)}>
                {encoded ? "Hide" : "Explicitly view"} encoded/raw response
              </button>
              {encoded && (
                <>
                  <Code value={redact(trace.data)} />
                  <button onClick={() => copy(redact(trace.data))}>
                    Copy encoded/raw response (secrets redacted)
                  </button>
                </>
              )}
            </>
          )}
        </>
      )}
      <h3>Result</h3>
      {artifact ? (
        <>
          <div className="actions">
            <a
              className="primary button"
              href={artifact.url}
              download={artifact.name}
            >
              Download {artifact.name}
            </a>
            <span>
              {artifact.bytes.length.toLocaleString()} bytes · {artifact.type}
            </span>
          </div>
          {artifact.type.includes("pdf") ? (
            <iframe title="Generated PDF preview" src={artifact.url} />
          ) : (
            <Code
              value={
                artifact.inspection?.text ||
                "DOCX preview unavailable; inspect the validation result and download."
              }
            />
          )}
          <details open>
            <summary>Artifact validation</summary>
            <Code value={artifact.inspection} />
          </details>
          <p>
            {artifact.inspection?.verified === false
              ? "Expected values did not match. Do not treat this render as verified."
              : artifact.inspection?.verified === true
                ? "Expected substituted/filled values verified in the artifact."
                : "Structure checked. Content substitution needs live preview/qualification."}{" "}
            {artifact.type.includes("pdf")
              ? artifact.inspection?.interactive
                ? "Interactive form fields remain."
                : "No interactive fields detected; the API did not receive a flatten option."
              : ""}
          </p>
        </>
      ) : (
        <p>No document returned yet.</p>
      )}
      <details>
        <summary>
          Session request history ({history.length}; secrets and encoded
          documents redacted)
        </summary>
        <Code value={history} />
        <button
          onClick={() =>
            download("ferarender-trace.json", pretty(redact(history)))
          }
        >
          Export redacted trace
        </button>
      </details>
    </section>
  );
}
function Walkthrough(props) {
  const { walk, setWalk } = props;
  const steps =
    walk.kind === "form"
      ? [
          "Authenticate",
          "Upload PDF / discover fields",
          "Edit dataset / map fields",
          "Test mapping / save template",
          "Render / inspect / download",
        ]
      : [
          "Authenticate",
          "Create dataset / convert XML",
          "Save sample template",
          "Validate template",
          "Render / inspect / download",
        ];
  async function next() {
    const s = walk.step;
    if (s === 0) {
      if (!props.session.authenticated) {
        props.setPage(0);
        throw Error("Authenticate first, then continue this walkthrough.");
      }
    } else if (walk.kind === "form") {
      props.setPage(5);
      if (s === 1 && !props.formState.fields.length)
        throw Error("Upload a PDF and discover its fields first.");
      if (s === 2 && !props.formState.mappings.length)
        throw Error("Complete the visual field mappings first.");
      if (s === 3 && !props.formState.saved)
        throw Error("Test the mapping and save the form template first.");
      if (s === 4 && props.artifact?.inspection?.verified !== true)
        throw Error(
          "Render the form and verify populated field values before completing.",
        );
    } else if (s === 1) {
      props.convert();
      await props.execute("POST", "/api/v1/datasets", {
        name: unique("walk-data"),
        rootPath: "/data",
        schema: {},
        sampleData: JSON.parse(props.json),
      });
    } else if (s === 2) {
      await props.execute("POST", "/api/v1/templates", {
        owner: props.config.instance,
        name: unique("walk-" + walk.kind),
        output: walk.kind === "docx" ? "RTF" : "PDF",
        fileName: "invoice." + walk.kind,
        content: await asset(
          walk.kind === "docx" ? "invoice-docx.xml" : "invoice-pdf.xsl",
        ),
        datasetUuid: props.datasetUuid,
        mode: "FULL",
      });
    } else if (s === 3) {
      await props.execute(
        "POST",
        "/api/v1/templates/i/{uuid}/validate",
        {},
        { uuid: props.templateUuid },
      );
    } else if (s === 4) {
      await props.execute(
        "POST",
        walk.kind === "docx" ? "/api/v1/docx" : "/api/v1/pdf/document",
        {
          owner: props.config.instance,
          uuid: props.templateUuid,
          xml: props.convert(),
        },
        {},
        {
          expected:
            walk.kind === "docx"
              ? {
                  customer: JSON.parse(props.json).Person.Name,
                  invoice: JSON.parse(props.json).Invoice.Number,
                }
              : {},
        },
      );
    }
    setWalk({
      ...walk,
      step: Math.min(s + 1, steps.length),
      done: [...new Set([...walk.done, s])],
    });
  }
  return (
    <section className="card walkthrough">
      <div className="section-title">
        <h2>Run Full Demonstration</h2>
        <button onClick={() => setWalk(null)}>Close</button>
      </div>
      <div className="actions">
        <select
          aria-label="Walkthrough type"
          value={walk.kind}
          onChange={(e) => {
            setWalk({ kind: e.target.value, step: 0, done: [] });
            props.setPage(
              e.target.value === "form" ? 5 : e.target.value === "pdf" ? 4 : 3,
            );
          }}
        >
          <option value="docx">A · DOCX document</option>
          <option value="pdf">B · PDF report</option>
          <option value="form">C · PDF form</option>
        </select>
      </div>
      <ol>
        {steps.map((s, i) => (
          <li key={s} className={i === walk.step ? "current" : ""}>
            <button
              onClick={() =>
                setWalk({
                  ...walk,
                  step: i,
                  done: walk.done.filter((x) => x < i),
                })
              }
            >
              {walk.done.includes(i) ? "✓ " : ""}
              {s}
            </button>
          </li>
        ))}
      </ol>
      <p>
        Dataset <code>{props.datasetUuid || "—"}</code> · Template{" "}
        <code>{props.templateUuid || "—"}</code>
      </p>
      <p>
        {walk.kind === "form"
          ? "Use the numbered PDF Form Fields panels below for uploads, field mapping and saved template state. Continue after completing each panel."
          : "Each continue action executes its step against the configured live API. Select an earlier step to edit inputs and rerun subsequent operations."}
      </p>
      <button
        className="primary"
        disabled={props.busy || walk.step >= steps.length}
        onClick={() => props.run(next)}
      >
        {walk.step >= steps.length
          ? "Completed"
          : "Continue · " + steps[walk.step]}
      </button>
    </section>
  );
}
function Reference() {
  return (
    <>
      <section className="card">
        <h2>API reference & troubleshooting</h2>
        <p>
          <a href="/assets/openapi.json" download>
            Download repository OpenAPI contract
          </a>{" "}
          ·{" "}
          <a href="/assets/business.json" download>
            Business dataset
          </a>{" "}
          ·{" "}
          <a href="/assets/invoice-docx.xml" download>
            DOCX source
          </a>{" "}
          ·{" "}
          <a href="/assets/invoice-pdf.xsl" download>
            PDF report XSLT
          </a>
        </p>
        <p>
          Check URL allowlists, instance context, JWT expiration, licensed
          product access, and render/edit permissions. A renderer, PDF engine
          and DOCX conversion service must be configured by the API operator.
          Never substitute mock results for a live error.
        </p>
        <table>
          <thead>
            <tr>
              <th>Status</th>
              <th>What to check</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(errors).map(([code, message]) => (
              <tr key={code}>
                <td>{code}</td>
                <td>{message}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <h3>Verified source discrepancies</h3>
        <ul>
          <li>
            PDF document response is a JSON string containing base64 PDF, not
            the generic object example.
          </li>
          <li>
            PDF form discovery accepts <code>form</code>/<code>pdf</code>;
            rendering selects response mode through body{" "}
            <code>contentType</code>.
          </li>
          <li>
            XML transformation uses <code>xsl</code>; imported edit permission
            is not checked in its service.
          </li>
          <li>
            Dataset validation parses stored JSON only; infer returns a tree and
            does not require an existing dataset.
          </li>
          <li>Mapping suggest shares the resolve handler.</li>
          <li>
            Compilation/scan/validate use path UUID, not the render payload
            shown in the generic OpenAPI example.
          </li>
          <li>
            Compiler assignments accept PREAMBLE/POSTAMBLE. Header/footer
            placement is unavailable in this route.
          </li>
        </ul>
      </section>
      <section className="card">
        <h2>Infrastructure contracts — internal only</h2>
        <p>
          Lifecycle requests require exact-body HMAC and privileged
          infrastructure context. No execution controls are provided.
        </p>
        {operations
          .filter((o) => o.internal)
          .map((o) => (
            <p key={o.id}>
              <code>
                {o.method} {o.route}
              </code>
            </p>
          ))}
      </section>
    </>
  );
}

createRoot(document.getElementById("root")).render(<App />);
