import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import {
  DEFAULT_DB,
  initDb,
  listPools,
  normalizeCategory,
  openDb,
  searchPools,
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
const DEFAULT_TMP_DB = path.join(os.tmpdir(), "llama.sqlite");

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
const dbPath =
  args.db || process.env.DB_PATH || (process.env.NODE_ENV === "production"
    ? DEFAULT_TMP_DB
    : DEFAULT_DB);
const host =
  args.host ||
  process.env.HOST ||
  (process.env.NODE_ENV === "production" ? "0.0.0.0" : DEFAULT_HOST);
const port = Number.parseInt(
  args.port || process.env.PORT || String(DEFAULT_PORT),
  10
);
const webDir = path.resolve(args.web || DEFAULT_WEB_DIR);
const isDev = Boolean(args.dev) || process.env.NODE_ENV === "development";

async function copyDbIfNeeded() {
  if (dbPath !== DEFAULT_TMP_DB) {
    return;
  }
  const sourceDb = DEFAULT_DB;
  try {
    await fs.access(sourceDb);
  } catch {
    return;
  }
  try {
    await fs.access(dbPath);
    return;
  } catch {
    // Continue to copy seed DB.
  }
  await fs.copyFile(sourceDb, dbPath);
  for (const suffix of ["-wal", "-shm"]) {
    const src = `${sourceDb}${suffix}`;
    const dest = `${dbPath}${suffix}`;
    try {
      await fs.access(src);
      await fs.copyFile(src, dest);
    } catch {
      // Ignore missing WAL/SHM files.
    }
  }
}

await copyDbIfNeeded();
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

  app.get("/api/pools/search", (req, res) => {
    try {
      const query = String(req.query.query || "").trim();
      const limit = Number.parseInt(req.query.limit || "20", 10);
      if (!query) {
        res.json({ status: "ok", data: [] });
        return;
      }
      const data = searchPools(db, query, limit);
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
