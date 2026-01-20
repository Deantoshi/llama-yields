import {
  CHART_URL,
  DEFAULT_DB,
  PROTOCOLS_URL,
  POOLS_URL,
  categorizePool,
  fetchJson,
  ingestHistory,
  initDb,
  listPools,
  normalizeCategory,
  openDb,
  recomputeMetrics,
  upsertPoolMetricsFromSnapshot,
  upsertPools,
  upsertProtocols,
} from "./db.js";

function parseArgs(argv) {
  const result = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        result[key] = next;
        i += 1;
      } else {
        result[key] = true;
      }
    } else {
      result._.push(arg);
    }
  }
  return result;
}

function toInt(value, fallback = null) {
  if (value == null) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function printUsage() {
  console.log(`Usage: node src/cli.js <command> [options]

Commands:
  init-db
  ingest-pools
  ingest-history
  recompute-metrics
  sync
  sync-top-history
  read

Options:
  --db <path>
  --category <Stablecoins|ETH|BTC|Other>
  --pool-id <poolId>
  --limit <n>
  --top <n>
  --window-days <n>
  --verbose
`);
}

async function cmdInitDb(args) {
  const db = openDb(args.db || DEFAULT_DB);
  initDb(db);
  db.close();
  console.log(`Initialized database at ${args.db || DEFAULT_DB}`);
}

async function cmdIngestPools(args) {
  const data = await fetchJson(POOLS_URL);
  const pools = Array.isArray(data) ? data : data?.data || [];
  const protocolData = await fetchJson(PROTOCOLS_URL);
  const protocols = Array.isArray(protocolData) ? protocolData : [];
  const db = openDb(args.db || DEFAULT_DB);
  initDb(db);
  upsertProtocols(db, protocols);
  upsertPools(db, pools);
  db.close();
  console.log(`Upserted ${pools.length} pools and ${protocols.length} protocols`);
}

async function cmdIngestHistory(args) {
  const db = openDb(args.db || DEFAULT_DB);
  initDb(db);

  let poolIds = [];
  if (args["pool-id"]) {
    poolIds = [args["pool-id"]];
  } else {
    const category = normalizeCategory(args.category);
    if (category) {
      poolIds = db
        .prepare("SELECT pool_id FROM pools WHERE category = ?")
        .all(category)
        .map((row) => row.pool_id);
    } else {
      poolIds = db
        .prepare("SELECT pool_id FROM pools")
        .all()
        .map((row) => row.pool_id);
    }

    const limit = toInt(args.limit, null);
    if (limit) {
      poolIds = poolIds.slice(0, limit);
    }
  }

  for (let i = 0; i < poolIds.length; i += 1) {
    const pid = poolIds[i];
    const chart = await fetchJson(CHART_URL.replace("{}", pid));
    const data = Array.isArray(chart) ? chart : chart?.data || [];
    ingestHistory(db, pid, data);
    if (args.verbose) {
      console.log(`[${i + 1}/${poolIds.length}] Ingested history for ${pid}`);
    }
  }

  db.close();
  console.log("History ingestion complete");
}

async function cmdRecomputeMetrics(args) {
  const db = openDb(args.db || DEFAULT_DB);
  initDb(db);
  recomputeMetrics(db, {
    poolId: args["pool-id"] || null,
    windowDays: toInt(args["window-days"], 90),
  });
  db.close();
  console.log("Metrics updated");
}

async function cmdSync(args) {
  const data = await fetchJson(POOLS_URL);
  const pools = Array.isArray(data) ? data : data?.data || [];
  const protocolData = await fetchJson(PROTOCOLS_URL);
  const protocols = Array.isArray(protocolData) ? protocolData : [];

  const db = openDb(args.db || DEFAULT_DB);
  initDb(db);
  upsertProtocols(db, protocols);
  upsertPools(db, pools);

  const category = normalizeCategory(args.category);
  let filteredPools = pools;
  if (category) {
    const poolIds = new Set(
      db
        .prepare("SELECT pool_id FROM pools WHERE category = ?")
        .all(category)
        .map((row) => row.pool_id)
    );
    filteredPools = pools.filter((pool) => poolIds.has(pool?.pool));
  }

  const limit = toInt(args.limit, null);
  if (limit) {
    filteredPools = filteredPools.slice(0, limit);
  }

  upsertPoolMetricsFromSnapshot(db, filteredPools, {
    windowDays: toInt(args["window-days"], 30),
  });
  db.close();
  console.log("Sync complete");
}

async function cmdSyncTopHistory(args) {
  const data = await fetchJson(POOLS_URL);
  const pools = Array.isArray(data) ? data : data?.data || [];
  const protocolData = await fetchJson(PROTOCOLS_URL);
  const protocols = Array.isArray(protocolData) ? protocolData : [];

  const db = openDb(args.db || DEFAULT_DB);
  initDb(db);
  upsertProtocols(db, protocols);
  upsertPools(db, pools);

  const topN = toInt(args.top, 250);
  const categories = ["Stablecoins", "ETH", "BTC", "Other"];
  const buckets = new Map(categories.map((cat) => [cat, []]));

  for (const pool of pools) {
    const category = categorizePool(pool?.symbol || "", pool?.stablecoin ?? null);
    const tvlUsd = pool?.tvlUsd ?? 0;
    if (!buckets.has(category)) {
      buckets.set(category, []);
    }
    buckets.get(category).push({ id: pool?.pool, tvlUsd });
  }

  const poolIds = [];
  for (const category of categories) {
    const items = buckets.get(category) || [];
    items.sort((a, b) => b.tvlUsd - a.tvlUsd);
    for (const item of items.slice(0, topN)) {
      if (item.id) {
        poolIds.push(item.id);
      }
    }
  }

  const delayMs = 1500;
  for (let i = 0; i < poolIds.length; i += 1) {
    const pid = poolIds[i];
    const chart = await fetchJson(CHART_URL.replace("{}", pid));
    const chartData = Array.isArray(chart) ? chart : chart?.data || [];
    ingestHistory(db, pid, chartData);
    if (args.verbose) {
      console.log(`[${i + 1}/${poolIds.length}] Ingested history for ${pid}`);
    }
    if (i < poolIds.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  recomputeMetrics(db, {
    windowDays: toInt(args["window-days"], 90),
  });
  db.close();
  console.log("Top history sync complete");
}

async function cmdRead(args) {
  const db = openDb(args.db || DEFAULT_DB);
  initDb(db);
  const category = normalizeCategory(args.category || "Stablecoins");
  const limit = toInt(args.limit, 25);
  const rows = listPools(db, category, limit);
  db.close();
  console.log(
    JSON.stringify({ category, count: rows.length, data: rows }, null, 2)
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];

  if (!command) {
    printUsage();
    process.exit(1);
  }

  switch (command) {
    case "init-db":
      await cmdInitDb(args);
      break;
    case "ingest-pools":
      await cmdIngestPools(args);
      break;
    case "ingest-history":
      await cmdIngestHistory(args);
      break;
    case "recompute-metrics":
      await cmdRecomputeMetrics(args);
      break;
    case "sync":
      await cmdSync(args);
      break;
    case "sync-top-history":
      await cmdSyncTopHistory(args);
      break;
    case "read":
      await cmdRead(args);
      break;
    default:
      printUsage();
      process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
