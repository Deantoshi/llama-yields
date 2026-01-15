import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import {
  DEFAULT_DB,
  initDb,
  listPools,
  normalizeCategory,
  openDb,
} from "./db.js";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8000;
const ROOT_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  ".."
);
const DEFAULT_WEB_DIR = path.join(ROOT_DIR, "frontend", "dist");
const FRONTEND_ROOT = path.join(ROOT_DIR, "frontend");

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      result[key] = next;
      i += 1;
    } else {
      result[key] = true;
    }
  }
  return result;
}

const args = parseArgs(process.argv.slice(2));
const dbPath = args.db || DEFAULT_DB;
const host = args.host || DEFAULT_HOST;
const port = Number.parseInt(args.port || String(DEFAULT_PORT), 10);
const webDir = path.resolve(args.web || DEFAULT_WEB_DIR);
const isDev = Boolean(args.dev) || process.env.NODE_ENV === "development";

const db = openDb(dbPath);
initDb(db);

async function startServer() {
  const app = express();

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/api/pools", (req, res) => {
    try {
      const category = normalizeCategory(req.query.category) || "Stablecoins";
      const limit = Number.parseInt(req.query.limit || "200", 10);
      const data = listPools(db, category, limit);
      res.json({ status: "ok", data });
    } catch (error) {
      res.status(500).json({ status: "error", message: error.message });
    }
  });

  if (isDev) {
    const httpServer = http.createServer(app);
    const { createServer } = await import("vite");
    const vite = await createServer({
      root: FRONTEND_ROOT,
      appType: "custom",
      server: {
        middlewareMode: true,
        hmr: { server: httpServer },
      },
    });

    app.use(vite.middlewares);

    app.get("*", async (req, res, next) => {
      if (req.originalUrl.startsWith("/api/")) {
        return next();
      }
      try {
        const indexPath = path.join(FRONTEND_ROOT, "index.html");
        let html = await fs.readFile(indexPath, "utf-8");
        html = await vite.transformIndexHtml(req.originalUrl, html);
        res.status(200).set({ "Content-Type": "text/html" }).end(html);
      } catch (error) {
        vite.ssrFixStacktrace(error);
        next(error);
      }
    });

    httpServer.listen(port, host, () => {
      console.log(
        `Dev server with db ${dbPath} on http://${host}:${port} (Vite dev)`
      );
    });
    return;
  }

  app.use(express.static(webDir));
  app.get("*", (req, res) => {
    res.sendFile(path.join(webDir, "index.html"));
  });

  app.listen(port, host, () => {
    console.log(`Serving ${webDir} with db ${dbPath} on http://${host}:${port}`);
  });
}

startServer().catch((error) => {
  console.error(error);
  process.exit(1);
});
