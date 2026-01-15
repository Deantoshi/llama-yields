import { useCallback, useEffect, useMemo, useState } from "react";
import type { Pool } from "./types";

const CATEGORIES = ["Stablecoins", "ETH", "BTC"] as const;

type Category = (typeof CATEGORIES)[number];

function formatCurrency(value: number | null) {
  if (value == null || Number.isNaN(value)) {
    return "--";
  }
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function formatPercent(value: number | null, digits = 2) {
  if (value == null || Number.isNaN(value)) {
    return "--";
  }
  return `${value.toFixed(digits)}%`;
}

function predictedApy(pool: Pool, allocation: number) {
  if (pool.apy == null) {
    return null;
  }
  const slope = pool.apy_tvl_slope ?? 0;
  const predicted = pool.apy + slope * allocation;
  return Math.max(0, predicted);
}

function App() {
  const [category, setCategory] = useState<Category>("Stablecoins");
  const [pools, setPools] = useState<Pool[]>([]);
  const [selectedPools, setSelectedPools] = useState<Pool[]>([]);
  const [allocations, setAllocations] = useState<Record<string, number>>({});
  const [investment, setInvestment] = useState(100000);
  const [splits, setSplits] = useState(6);
  const [impactPoolId, setImpactPoolId] = useState<string | null>(null);
  const [impactAmount, setImpactAmount] = useState(25000);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recomputeSelection = useCallback(() => {
    if (!pools.length) {
      setSelectedPools([]);
      setAllocations({});
      return;
    }
    const allocation = investment / Math.max(1, splits);
    const scored = pools.map((pool) => ({
      pool,
      predicted: predictedApy(pool, allocation) ?? 0,
    }));
    scored.sort((a, b) => (b.predicted ?? 0) - (a.predicted ?? 0));

    const selected = scored
      .slice(0, Math.min(splits, scored.length))
      .map((item) => item.pool);

    setSelectedPools(selected);
    const nextAllocations: Record<string, number> = {};
    selected.forEach((pool) => {
      nextAllocations[pool.pool_id] = allocation;
    });
    setAllocations(nextAllocations);
  }, [investment, pools, splits]);

  const autoAllocate = useCallback(() => {
    const allocation = investment / Math.max(1, selectedPools.length);
    setAllocations((prev) => {
      const next = { ...prev };
      selectedPools.forEach((pool) => {
        next[pool.pool_id] = allocation;
      });
      return next;
    });
  }, [investment, selectedPools]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    fetch(`/api/pools?category=${encodeURIComponent(category)}`)
      .then((response) => response.json())
      .then((payload) => {
        if (!active) {
          return;
        }
        setPools(payload.data || []);
      })
      .catch((err) => {
        if (!active) {
          return;
        }
        console.error(err);
        setError("Unable to load pools.");
        setPools([]);
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [category]);

  useEffect(() => {
    if (!pools.length) {
      setSelectedPools([]);
      setAllocations({});
      return;
    }
    recomputeSelection();
  }, [pools, recomputeSelection]);

  useEffect(() => {
    if (!pools.length) {
      setImpactPoolId(null);
      return;
    }
    setImpactPoolId((prev) => {
      if (prev && pools.some((pool) => pool.pool_id === prev)) {
        return prev;
      }
      return pools[0].pool_id;
    });
  }, [pools]);

  const totalAllocated = useMemo(() => {
    return Object.values(allocations).reduce((sum, value) => sum + value, 0);
  }, [allocations]);

  const blendedApy = useMemo(() => {
    let weightedSum = 0;
    selectedPools.forEach((pool) => {
      const allocation = allocations[pool.pool_id] || 0;
      const predicted = predictedApy(pool, allocation);
      if (predicted != null) {
        weightedSum += predicted * allocation;
      }
    });
    return totalAllocated > 0 ? weightedSum / totalAllocated : 0;
  }, [allocations, selectedPools, totalAllocated]);

  const annualYield = useMemo(() => {
    return (blendedApy / 100) * totalAllocated;
  }, [blendedApy, totalAllocated]);

  const allocationStatus = useMemo(() => {
    const delta = totalAllocated - investment;
    if (delta === 0) {
      return "Fully allocated";
    }
    if (delta > 0) {
      return `Over by ${formatCurrency(delta)}`;
    }
    return `Unallocated ${formatCurrency(Math.abs(delta))}`;
  }, [investment, totalAllocated]);

  const impactPool = useMemo(() => {
    return pools.find((pool) => pool.pool_id === impactPoolId) || null;
  }, [impactPoolId, pools]);

  const impactCurrent = impactPool?.apy ?? null;
  const impactPredicted = impactPool
    ? predictedApy(impactPool, impactAmount)
    : null;
  const impactDelta =
    impactCurrent != null && impactPredicted != null
      ? impactPredicted - impactCurrent
      : null;

  return (
    <div>
      <div className="backdrop" aria-hidden="true">
        <div className="orb orb-one"></div>
        <div className="orb orb-two"></div>
        <div className="grain"></div>
      </div>

      <header className="hero">
        <div className="hero-text">
          <p className="eyebrow">DefiLlama data, strategy-grade insights</p>
          <h1>Llama Yield Studio</h1>
          <p className="hero-sub">
            Model how your own capital shifts TVL and APY, then split allocations
            across stablecoin, ETH, and BTC strategies.
          </p>
        </div>
        <div className="hero-panel">
          <div className="hero-metric">
            <span className="metric-label">Data scope</span>
            <span className="metric-value">Historical TVL + APY</span>
          </div>
          <div className="hero-metric">
            <span className="metric-label">Model</span>
            <span className="metric-value">TVL elasticity</span>
          </div>
          <div className="hero-metric">
            <span className="metric-label">Planner</span>
            <span className="metric-value">Smart split builder</span>
          </div>
        </div>
      </header>

      <main className="content">
        <section className="panel" id="strategy-panel">
          <div className="panel-head">
            <div>
              <h2>Strategy Builder</h2>
              <p className="panel-sub">
                Find the best yield split for your allocation and category.
              </p>
            </div>
            <div className="tabs" role="tablist">
              {CATEGORIES.map((item) => (
                <button
                  key={item}
                  className={`tab ${category === item ? "is-active" : ""}`}
                  data-category={item}
                  role="tab"
                  onClick={() => setCategory(item)}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>

          <div className="panel-body">
            <div className="controls-grid">
              <label className="control">
                <span>Total investment (USD)</span>
                <input
                  id="investment"
                  type="number"
                  min="0"
                  step="100"
                  value={investment}
                  onChange={(event) =>
                    setInvestment(Number(event.target.value) || 0)
                  }
                />
              </label>
              <label className="control">
                <span>Split count</span>
                <input
                  id="split-count"
                  type="number"
                  min="1"
                  max="25"
                  step="1"
                  value={splits}
                  onChange={(event) =>
                    setSplits(Math.max(1, Number(event.target.value) || 1))
                  }
                />
              </label>
              <div className="control">
                <span>Allocation tools</span>
                <div className="control-actions">
                  <button className="ghost" onClick={autoAllocate}>
                    Auto-allocate
                  </button>
                  <button className="solid" onClick={recomputeSelection}>
                    Recompute ranking
                  </button>
                </div>
              </div>
            </div>

            <div className="summary-grid">
              <div className="summary-card">
                <span className="summary-label">Projected blended APY</span>
                <span className="summary-value">
                  {formatPercent(blendedApy, 2)}
                </span>
              </div>
              <div className="summary-card">
                <span className="summary-label">Projected annual yield</span>
                <span className="summary-value">
                  {formatCurrency(annualYield)}
                </span>
              </div>
              <div className="summary-card">
                <span className="summary-label">Allocation status</span>
                <span className="summary-value">
                  {formatCurrency(totalAllocated)} allocated - {allocationStatus}
                </span>
              </div>
            </div>

            <div className="allocation-header">
              <span>Pool</span>
              <span>Current APY</span>
              <span>TVL</span>
              <span>Allocation</span>
              <span>Predicted APY</span>
              <span>Weight</span>
            </div>

            <div className="allocation-rows">
              {loading && (
                <div className="allocation-row">Loading pools...</div>
              )}
              {!loading && error && (
                <div className="allocation-row">{error}</div>
              )}
              {!loading && !error && !selectedPools.length && (
                <div className="allocation-row">
                  No data yet. Run the sync command.
                </div>
              )}
              {!loading &&
                !error &&
                selectedPools.map((pool) => {
                  const allocation = allocations[pool.pool_id] || 0;
                  const predicted = predictedApy(pool, allocation);
                  const weight =
                    totalAllocated > 0
                      ? (allocation / totalAllocated) * 100
                      : 0;
                  return (
                    <div
                      className="allocation-row"
                      data-id={pool.pool_id}
                      key={pool.pool_id}
                    >
                      <div className="pool-meta">
                        <span className="pool-title">
                          {pool.project} - {pool.symbol}
                        </span>
                        <span className="pool-sub">{pool.chain}</span>
                      </div>
                      <div data-role="current-apy">
                        {formatPercent(pool.apy)}
                      </div>
                      <div data-role="tvl">{formatCurrency(pool.tvl_usd)}</div>
                      <div>
                        <input
                          type="number"
                          min="0"
                          step="100"
                          value={allocation}
                          onChange={(event) => {
                            const value = Number(event.target.value) || 0;
                            setAllocations((prev) => ({
                              ...prev,
                              [pool.pool_id]: value,
                            }));
                          }}
                        />
                      </div>
                      <div data-role="predicted">
                        {formatPercent(predicted)}
                      </div>
                      <div data-role="weight">{formatPercent(weight, 1)}</div>
                    </div>
                  );
                })}
            </div>
          </div>
        </section>

        <section className="panel" id="impact-panel">
          <div className="panel-head">
            <div>
              <h2>Single-Pool Impact</h2>
              <p className="panel-sub">See how your capital shifts APY for any pool.</p>
            </div>
          </div>
          <div className="panel-body impact">
            <label className="control">
              <span>Pool</span>
              <select
                id="impact-pool"
                value={impactPoolId ?? ""}
                onChange={(event) => setImpactPoolId(event.target.value)}
              >
                {pools.slice(0, 200).map((pool) => (
                  <option key={pool.pool_id} value={pool.pool_id}>
                    {pool.project} - {pool.symbol} ({pool.chain})
                  </option>
                ))}
              </select>
            </label>
            <label className="control">
              <span>Investment (USD)</span>
              <input
                id="impact-amount"
                type="number"
                min="0"
                step="100"
                value={impactAmount}
                onChange={(event) =>
                  setImpactAmount(Number(event.target.value) || 0)
                }
              />
            </label>
            <div className="impact-card">
              <div>
                <span className="impact-label">Current APY</span>
                <span className="impact-value">
                  {formatPercent(impactCurrent)}
                </span>
              </div>
              <div>
                <span className="impact-label">Predicted APY</span>
                <span className="impact-value">
                  {formatPercent(impactPredicted)}
                </span>
              </div>
              <div>
                <span className="impact-label">Delta</span>
                <span className="impact-value">
                  {impactDelta == null ? "--" : formatPercent(impactDelta)}
                </span>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="footer">
        <span>Powered by DefiLlama API data.</span>
        <span>Model uses a linear APY vs TVL elasticity on recent history.</span>
      </footer>
    </div>
  );
}

export default App;
