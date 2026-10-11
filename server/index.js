import "dotenv/config";
import express from "express";
import { createApp } from "./app.js";
const app = createApp();
if (process.argv.includes("--production")) app.use(express.static("dist"));
else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
}
const port = Number(process.env.PORT || 4178);
const server = app.listen(port, "127.0.0.1", () =>
  console.log(
    `FeraRender Developer Studio: http://127.0.0.1:${port} (live API mode)`,
  ),
);
for (const event of ["SIGINT", "SIGTERM"])
  process.on(event, () => {
    app.locals.close();
    server.close(() => process.exit(0));
  });
