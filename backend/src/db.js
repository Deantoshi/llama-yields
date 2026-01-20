import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

export const POOLS_URL = "https://yields.llama.fi/pools";
export const PROTOCOLS_URL = "https://api.llama.fi/protocols";
export const CHART_URL = "https://yields.llama.fi/chart/{}";

const ROOT_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  ".."
);
export const DEFAULT_DB = path.join(ROOT_DIR, "data", "llama.sqlite");

const STABLE_TOKENS = new Set([
  "USD", "USDC", "USDT", "DAI", "FRAX", "USDE", "USDS", "TUSD", "USDP",
  "GUSD", "LUSD", "MIM", "USDD", "SUSD", "EUR", "EURO", "USDBC", "PYUSD",
  "SFRAX", "CRVUSD", "GHO", "FDUSD", "USTC", "USDD",
]);
const ETH_TOKENS = new Set([
  "ETH", "WETH", "STETH", "WSTETH", "RETH", "FRXETH", "SFRXETH", "CBETH",
  "WEETH", "EZETH", "OETH", "OSETH", "METH", "SETH", "ETHX",
]);
const BTC_TOKENS = new Set([
  "BTC", "WBTC", "TBTC", "FBTC", "CBBTC", "BTCB", "WBTCET",
]);

const TOKEN_SPLIT_RE = /[\s/\-+,_]+/g;
const TOKEN_CLEAN_RE = /[^A-Z0-9]/g;

export async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": "llama-yields/0.1" },
  });
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${url}`);
  }
  return response.json();
}

export function normalizeToken(token) {
  return token.toUpperCase().replace(TOKEN_CLEAN_RE, "");
}

export function splitSymbol(symbol) {
  if (!symbol) {
    return [];
  }
  const rawTokens = symbol.toUpperCase().split(TOKEN_SPLIT_RE).filter(Boolean);
  return rawTokens.map(normalizeToken).filter(Boolean);
}

function isSingleAsset(underlyingTokensJson, symbol) {
  if (underlyingTokensJson) {
    try {
      const tokens = JSON.parse(underlyingTokensJson);
      if (Array.isArray(tokens) && tokens.length > 0) {
        return tokens.length === 1;
      }
    } catch {
      // Fall back to symbol parsing when underlying tokens are invalid JSON.
    }
  }
  return splitSymbol(symbol).length === 1;
}

function filterSingleAssetRows(rows) {
  return rows
    .filter((row) => isSingleAsset(row.underlying_tokens, row.symbol))
    .map(({ underlying_tokens, ...rest }) => rest);
}

export function categorizePool(symbol, stablecoinFlag = null) {
  const tokens = splitSymbol(symbol);
  if (!tokens.length) {
    return "Other";
  }

  const stableLike = tokens.filter((tok) => STABLE_TOKENS.has(tok));
  if (stableLike.length && stableLike.length === tokens.length) {
    return "Stablecoins";
  }
  if (tokens.some((tok) => BTC_TOKENS.has(tok) || tok.includes("BTC"))) {
    return "BTC";
  }
  if (tokens.some((tok) => ETH_TOKENS.has(tok) || tok.includes("ETH"))) {
    return "ETH";
  }
  return "Other";
}

export function parseTimestamp(value) {
  if (value == null) {
    return null;
  }
  if (typeof value === "number") {
    return Math.trunc(value);
  }
  if (typeof value === "string") {
    let stamp = value;
    if (stamp.endsWith("Z")) {
      stamp = `${stamp.slice(0, -1)}+00:00`;
    }
    const date = new Date(stamp);
    if (Number.isNaN(date.getTime())) {
      return null;
    }
    return Math.floor(date.getTime() / 1000);
  }
  return null;
}

export function openDb(dbPath = DEFAULT_DB) {
  const resolved = path.resolve(dbPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const db = new Database(resolved);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}

export function normalizeCategory(category) {
  if (!category) {
    return null;
  }
  const value = String(category).trim().toLowerCase();
  return {
    stablecoins: "Stablecoins",
    stablecoin: "Stablecoins",
    eth: "ETH",
    btc: "BTC",
    other: "Other",
  }[value] || category;
}

export function initDb(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS pools (
      pool_id TEXT PRIMARY KEY,
      project TEXT NOT NULL,
      chain TEXT NOT NULL,
      symbol TEXT NOT NULL,
      pool_meta TEXT,
      url TEXT,
      underlying_tokens TEXT,
      reward_tokens TEXT,
      category TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pool_history (
      pool_id TEXT NOT NULL,
      ts INTEGER NOT NULL,
      tvl_usd REAL,
      apy REAL,
      apy_base REAL,
      apy_reward REAL,
      apy_30d REAL,
      source TEXT NOT NULL,
      PRIMARY KEY (pool_id, ts),
      FOREIGN KEY (pool_id) REFERENCES pools(pool_id)
    );

    CREATE INDEX IF NOT EXISTS idx_pool_history_pool_ts
      ON pool_history (pool_id, ts);
    CREATE INDEX IF NOT EXISTS idx_pools_category
      ON pools (category);

    CREATE TABLE IF NOT EXISTS pool_metrics (
      pool_id TEXT PRIMARY KEY,
      last_ts INTEGER NOT NULL,
      tvl_usd REAL,
      apy REAL,
      apy_base REAL,
      apy_reward REAL,
      apy_30d REAL,
      apy_tvl_slope REAL NOT NULL,
      sample_count INTEGER NOT NULL,
      tvl_min REAL,
      tvl_max REAL,
      model_window_days INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (pool_id) REFERENCES pools(pool_id)
    );

    CREATE TABLE IF NOT EXISTS protocols (
      slug TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      url TEXT,
      logo TEXT,
      updated_at INTEGER NOT NULL
    );
  `);
}

export function upsertProtocols(db, protocols) {
  const now = Math.floor(Date.now() / 1000);
  const rows = [];
  for (const protocol of protocols) {
    const slug = protocol?.slug;
    if (!slug) {
      continue;
    }
    rows.push([
      slug,
      protocol?.name || slug,
      protocol?.url || null,
      protocol?.logo || null,
      now,
    ]);
  }

  const stmt = db.prepare(`
    INSERT INTO protocols (slug, name, url, logo, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(slug) DO UPDATE SET
      name=excluded.name,
      url=excluded.url,
      logo=excluded.logo,
      updated_at=excluded.updated_at
  `);

  const transaction = db.transaction((items) => {
    for (const row of items) {
      stmt.run(...row);
    }
  });

  transaction(rows);
}

export function upsertPools(db, pools) {
  const now = Math.floor(Date.now() / 1000);
  const rows = [];
  for (const pool of pools) {
    const poolId = pool?.pool;
    if (!poolId) {
      continue;
    }
    const symbol = pool?.symbol || "";
    rows.push([
      poolId,
      pool?.project || "",
      pool?.chain || "",
      symbol,
      pool?.poolMeta || null,
      pool?.url || null,
      pool?.underlyingTokens != null ? JSON.stringify(pool.underlyingTokens) : null,
      pool?.rewardTokens != null ? JSON.stringify(pool.rewardTokens) : null,
      categorizePool(symbol, pool?.stablecoin ?? null),
      now,
      now,
    ]);
  }

  const stmt = db.prepare(`
    INSERT INTO pools (
      pool_id, project, chain, symbol, pool_meta, url,
      underlying_tokens, reward_tokens, category, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(pool_id) DO UPDATE SET
      project=excluded.project,
      chain=excluded.chain,
      symbol=excluded.symbol,
      pool_meta=excluded.pool_meta,
      url=excluded.url,
      underlying_tokens=excluded.underlying_tokens,
      reward_tokens=excluded.reward_tokens,
      category=excluded.category,
      updated_at=excluded.updated_at
  `);

  const transaction = db.transaction((items) => {
    for (const row of items) {
      stmt.run(...row);
    }
  });

  transaction(rows);
}

export function upsertPoolMetricsFromSnapshot(
  db,
  pools,
  { windowDays = 30 } = {}
) {
  const now = Math.floor(Date.now() / 1000);
  const rows = [];

  for (const pool of pools) {
    const poolId = pool?.pool;
    if (!poolId) {
      continue;
    }
    const tvlUsd = pool?.tvlUsd ?? null;
    const apy30d =
      pool?.apyPct30D ??
      pool?.apyPct30d ??
      pool?.apy30d ??
      null;
    const hasSample = tvlUsd != null ? 1 : 0;

    rows.push([
      poolId,
      now,
      tvlUsd,
      pool?.apy ?? null,
      pool?.apyBase ?? null,
      pool?.apyReward ?? null,
      apy30d,
      0,
      hasSample,
      tvlUsd,
      tvlUsd,
      windowDays,
      now,
    ]);
  }

  const stmt = db.prepare(`
    INSERT INTO pool_metrics (
      pool_id, last_ts, tvl_usd, apy, apy_base, apy_reward, apy_30d,
      apy_tvl_slope, sample_count, tvl_min, tvl_max, model_window_days, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(pool_id) DO UPDATE SET
      last_ts=excluded.last_ts,
      tvl_usd=excluded.tvl_usd,
      apy=excluded.apy,
      apy_base=excluded.apy_base,
      apy_reward=excluded.apy_reward,
      apy_30d=excluded.apy_30d,
      apy_tvl_slope=excluded.apy_tvl_slope,
      sample_count=excluded.sample_count,
      tvl_min=excluded.tvl_min,
      tvl_max=excluded.tvl_max,
      model_window_days=excluded.model_window_days,
      updated_at=excluded.updated_at
  `);

  const transaction = db.transaction((items) => {
    for (const row of items) {
      stmt.run(...row);
    }
  });

  transaction(rows);
}

export function computeRolling30d(rows) {
  const window = [];
  let head = 0;
  let sumApy = 0;
  let count = 0;
  const windowSeconds = 30 * 24 * 60 * 60;

  for (const row of rows) {
    const ts = row.ts;
    const apy = row.apy;
    while (head < window.length && window[head].ts < ts - windowSeconds) {
      const old = window[head];
      if (old.apy != null) {
        sumApy -= old.apy;
        count -= 1;
      }
      head += 1;
    }
    window.push(row);
    if (apy != null) {
      sumApy += apy;
      count += 1;
    }
    row.apy_30d = count ? sumApy / count : null;
  }
}

export function ingestHistory(db, poolId, chartData) {
  const rows = [];
  for (const item of chartData || []) {
    const ts = parseTimestamp(item?.timestamp);
    if (ts == null) {
      continue;
    }
    rows.push({
      pool_id: poolId,
      ts,
      tvl_usd: item?.tvlUsd ?? null,
      apy: item?.apy ?? null,
      apy_base: item?.apyBase ?? null,
      apy_reward: item?.apyReward ?? null,
      apy_30d: null,
      source: "chart",
    });
  }

  rows.sort((a, b) => a.ts - b.ts);
  computeRolling30d(rows);

  const stmt = db.prepare(`
    INSERT INTO pool_history (
      pool_id, ts, tvl_usd, apy, apy_base, apy_reward, apy_30d, source
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(pool_id, ts) DO UPDATE SET
      tvl_usd=excluded.tvl_usd,
      apy=excluded.apy,
      apy_base=excluded.apy_base,
      apy_reward=excluded.apy_reward,
      apy_30d=excluded.apy_30d,
      source=excluded.source
  `);

  const transaction = db.transaction((items) => {
    for (const row of items) {
      stmt.run(
        row.pool_id,
        row.ts,
        row.tvl_usd,
        row.apy,
        row.apy_base,
        row.apy_reward,
        row.apy_30d,
        row.source
      );
    }
  });

  transaction(rows);
}

export function recomputeMetrics(db, { poolId = null, windowDays = 90 } = {}) {
  const poolIds = poolId
    ? [poolId]
    : db.prepare("SELECT pool_id FROM pools").all().map((row) => row.pool_id);

  const windowSeconds = windowDays * 24 * 60 * 60;
  const now = Math.floor(Date.now() / 1000);

  const lastTsStmt = db.prepare(
    "SELECT MAX(ts) AS max_ts FROM pool_history WHERE pool_id = ?"
  );
  const latestStmt = db.prepare(`
    SELECT tvl_usd, apy, apy_base, apy_reward, apy_30d
    FROM pool_history
    WHERE pool_id = ? AND ts = ?
  `);
  const samplesStmt = db.prepare(`
    SELECT tvl_usd, apy_reward
    FROM pool_history
    WHERE pool_id = ?
      AND ts >= ?
      AND tvl_usd IS NOT NULL
      AND apy_reward IS NOT NULL
  `);
  const upsertStmt = db.prepare(`
    INSERT INTO pool_metrics (
      pool_id, last_ts, tvl_usd, apy, apy_base, apy_reward, apy_30d,
      apy_tvl_slope, sample_count, tvl_min, tvl_max, model_window_days, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(pool_id) DO UPDATE SET
      last_ts=excluded.last_ts,
      tvl_usd=excluded.tvl_usd,
      apy=excluded.apy,
      apy_base=excluded.apy_base,
      apy_reward=excluded.apy_reward,
      apy_30d=excluded.apy_30d,
      apy_tvl_slope=excluded.apy_tvl_slope,
      sample_count=excluded.sample_count,
      tvl_min=excluded.tvl_min,
      tvl_max=excluded.tvl_max,
      model_window_days=excluded.model_window_days,
      updated_at=excluded.updated_at
  `);

  const transaction = db.transaction((pid) => {
    const row = lastTsStmt.get(pid);
    if (!row || row.max_ts == null) {
      return;
    }
    const lastTs = row.max_ts;

    const latest = latestStmt.get(pid, lastTs);
    const startTs = lastTs - windowSeconds;
    const samples = samplesStmt.all(pid, startTs);

    if (!samples.length) {
      return;
    }

    const xs = samples.map((sample) => sample.tvl_usd);
    const ys = samples.map((sample) => sample.apy_reward);
    const meanX = xs.reduce((sum, value) => sum + value, 0) / xs.length;
    const meanY = ys.reduce((sum, value) => sum + value, 0) / ys.length;
    const varX = xs.reduce((sum, value) => sum + (value - meanX) ** 2, 0);
    const slope = varX === 0
      ? 0
      : xs.reduce(
          (sum, value, index) => sum + (value - meanX) * (ys[index] - meanY),
          0
        ) / varX;

    upsertStmt.run(
      pid,
      lastTs,
      latest?.tvl_usd ?? null,
      latest?.apy ?? null,
      latest?.apy_base ?? null,
      latest?.apy_reward ?? null,
      latest?.apy_30d ?? null,
      slope,
      samples.length,
      Math.min(...xs),
      Math.max(...xs),
      windowDays,
      now
    );
  });

  for (const pid of poolIds) {
    transaction(pid);
  }
}

export function listPools(db, category, limit) {
  const rows = db.prepare(`
    SELECT p.pool_id, p.project, p.chain, p.symbol, p.url, p.category,
           p.underlying_tokens,
           m.tvl_usd, m.apy, m.apy_base, m.apy_reward, m.apy_30d,
           m.apy_tvl_slope, m.sample_count,
           pr.url AS protocol_url, pr.logo AS protocol_logo
    FROM pools p
    JOIN pool_metrics m ON p.pool_id = m.pool_id
    LEFT JOIN protocols pr ON pr.slug = p.project
    WHERE p.category = ?
    ORDER BY m.apy DESC
    LIMIT ?
  `).all(category, limit);

  return filterSingleAssetRows(rows);
}

export function searchPools(db, query, limit) {
  const term = `%${query.toLowerCase()}%`;
  const rows = db.prepare(`
    SELECT p.pool_id, p.project, p.chain, p.symbol, p.url, p.category,
           p.underlying_tokens,
           m.tvl_usd, m.apy, m.apy_base, m.apy_reward, m.apy_30d,
           m.apy_tvl_slope, m.sample_count,
           pr.url AS protocol_url, pr.logo AS protocol_logo
    FROM pools p
    JOIN pool_metrics m ON p.pool_id = m.pool_id
    LEFT JOIN protocols pr ON pr.slug = p.project
    WHERE lower(p.project) LIKE ?
       OR lower(p.symbol) LIKE ?
       OR lower(pr.name) LIKE ?
    ORDER BY m.apy DESC
    LIMIT ?
  `).all(term, term, term, limit);

  return filterSingleAssetRows(rows);
}
