import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { Pool } from "./types";

const CATEGORIES = ["Stablecoins", "ETH", "BTC"] as const;
const PIE_COLORS = [
  "#ff8f3d",
  "#2ab3a6",
  "#f1c453",
  "#e4572e",
  "#59c3c3",
  "#f3d34a",
  "#f79d65",
  "#7bdff2",
  "#fbb13c",
];

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

function formatNumber(value: number) {
  return value.toLocaleString("en-US");
}

function predictedApy(pool: Pool, allocation: number) {
  if (pool.apy == null) {
    return null;
  }
  const slope = pool.apy_tvl_slope ?? 0;
  const predicted = pool.apy + slope * allocation;
  return Math.max(0, predicted);
}

function describeArc(
  cx: number,
  cy: number,
  radius: number,
  startAngle: number,
  endAngle: number
) {
  const start = polarToCartesian(cx, cy, radius, endAngle);
  const end = polarToCartesian(cx, cy, radius, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";
  return [
    `M ${cx} ${cy}`,
    `L ${start.x} ${start.y}`,
    `A ${radius} ${radius} 0 ${largeArcFlag} 0 ${end.x} ${end.y}`,
    "Z",
  ].join(" ");
}

function polarToCartesian(
  cx: number,
  cy: number,
  radius: number,
  angleInDegrees: number
) {
  const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180.0;
  return {
    x: cx + radius * Math.cos(angleInRadians),
    y: cy + radius * Math.sin(angleInRadians),
  };
}

function App() {
  const [category, setCategory] = useState<Category>("Stablecoins");
  const [pools, setPools] = useState<Pool[]>([]);
  const [selectedPools, setSelectedPools] = useState<Pool[]>([]);
  const [allocations, setAllocations] = useState<Record<string, number>>({});
  const [investment, setInvestment] = useState(100000);
  const [investmentDisplay, setInvestmentDisplay] = useState(
    formatNumber(100000)
  );
  const [splits, setSplits] = useState(6);
  const [impactPoolId, setImpactPoolId] = useState<string | null>(null);
  const [impactAmount, setImpactAmount] = useState(25000);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    title: string;
    value: string;
  } | null>(null);

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

  const chartSlices = useMemo(() => {
    if (totalAllocated <= 0) {
      return [];
    }
    let startAngle = 0;
    return selectedPools
      .map((pool, index) => {
        const allocation = allocations[pool.pool_id] || 0;
        if (allocation <= 0) {
          return null;
        }
        const weight = allocation / totalAllocated;
        const angle = weight * 360;
        const endAngle = startAngle + angle;
        const predicted = predictedApy(pool, allocation);
        const expectedYield =
          predicted != null ? (predicted / 100) * allocation : null;
        const slice = {
          pool,
          allocation,
          weight,
          predicted,
          expectedYield,
          startAngle,
          endAngle,
          color: PIE_COLORS[index % PIE_COLORS.length],
        };
        startAngle = endAngle;
        return slice;
      })
      .filter(Boolean) as Array<{
      pool: Pool;
      allocation: number;
      weight: number;
      predicted: number | null;
      expectedYield: number | null;
      startAngle: number;
      endAngle: number;
      color: string;
    }>;
  }, [allocations, selectedPools, totalAllocated]);

  const handleSliceHover = (
    slice: (typeof chartSlices)[number],
    event: React.MouseEvent<SVGPathElement | SVGCircleElement>
  ) => {
    const wrapper = (event.currentTarget as Element).closest(".chart-wrap");
    if (!wrapper) {
      return;
    }
    const rect = (wrapper as HTMLElement).getBoundingClientRect();
    const expected = slice.expectedYield;
    setTooltip({
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      title: `${slice.pool.project} - ${slice.pool.symbol}`,
      value:
        expected == null
          ? "Expected yield: --"
          : `Expected yield: ${formatCurrency(expected)}`,
    });
  };

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
                  type="text"
                  inputMode="numeric"
                  value={investmentDisplay}
                  onChange={(event) => {
                    const raw = event.target.value.replace(/[^\d]/g, "");
                    if (!raw) {
                      setInvestment(0);
                      setInvestmentDisplay("");
                      return;
                    }
                    const nextValue = Number(raw);
                    setInvestment(nextValue);
                    setInvestmentDisplay(formatNumber(nextValue));
                  }}
                  onBlur={() => {
                    setInvestmentDisplay(formatNumber(investment));
                  }}
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
              <span>Current / Expected APY</span>
              <span>TVL</span>
              <span>Allocation</span>
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
                  const allocationPercent =
                    investment > 0
                      ? Math.min(100, Math.max(0, (allocation / investment) * 100))
                      : 0;
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
                      <div className="apy-cell" data-role="apy">
                        <div
                          className="apy-item"
                          data-tooltip={`Base: ${formatPercent(
                            pool.apy_base
                          )} • Rewards: ${formatPercent(pool.apy_reward)}`}
                        >
                          <span className="apy-label">Current</span>
                          <span className="apy-value">
                            {formatPercent(pool.apy)}
                          </span>
                        </div>
                        <span className="apy-sep" aria-hidden="true">
                          |
                        </span>
                        <div
                          className="apy-item"
                          data-tooltip={`Base: ${formatPercent(
                            pool.apy_base
                          )} • Rewards: ${formatPercent(pool.apy_reward)}`}
                        >
                          <span className="apy-label">Expected</span>
                          <span className="apy-value">
                            {formatPercent(predicted)}
                          </span>
                        </div>
                      </div>
                      <div data-role="tvl">{formatCurrency(pool.tvl_usd)}</div>
                      <div className="allocation-cell">
                        <input
                          type="text"
                          inputMode="numeric"
                          value={formatNumber(allocation)}
                          onChange={(event) => {
                            const raw = event.target.value.replace(/[^\d]/g, "");
                            const value = raw ? Number(raw) : 0;
                            setAllocations((prev) => ({
                              ...prev,
                              [pool.pool_id]: value,
                            }));
                          }}
                        />
                        <div className="allocation-slider-row">
                          <div className="allocation-slider-wrap">
                            <input
                              className="allocation-slider"
                              type="range"
                              min="0"
                              max="100"
                              step="1"
                              value={allocationPercent}
                              onChange={(event) => {
                                const percent = Number(event.target.value) || 0;
                                const value = Math.round(
                                  (investment * percent) / 100
                                );
                                setAllocations((prev) => ({
                                  ...prev,
                                  [pool.pool_id]: value,
                                }));
                              }}
                            />
                            <div className="allocation-ticks" aria-hidden="true">
                              <span />
                              <span />
                              <span />
                              <span />
                            </div>
                            <div className="allocation-tick-labels">
                              {[25, 50, 75, 100].map((percent) => (
                                <button
                                  key={percent}
                                  type="button"
                                  className="allocation-tick"
                                  onClick={() => {
                                    const value = Math.round(
                                      (investment * percent) / 100
                                    );
                                    setAllocations((prev) => ({
                                      ...prev,
                                      [pool.pool_id]: value,
                                    }));
                                  }}
                                >
                                  {percent}%
                                </button>
                              ))}
                            </div>
                          </div>
                          <span className="allocation-percent">
                            {Math.round(allocationPercent)}%
                          </span>
                        </div>
                      </div>
                      <div data-role="weight">{formatPercent(weight, 1)}</div>
                    </div>
                  );
                })}
            </div>


            <div className="chart-section">
              <div className="chart-header">
                <h3>Allocation Mix</h3>
                <p>Hover a slice to see expected yield per allocation.</p>
              </div>
              <div className="chart-grid">
                <div
                  className="chart-wrap"
                  onMouseLeave={() => setTooltip(null)}
                >
                  {totalAllocated > 0 ? (
                    <svg
                      className="pie-chart"
                      viewBox="0 0 200 200"
                      role="img"
                      aria-label="Allocation pie chart"
                    >
                      {chartSlices.length === 1 ? (
                        <circle
                          className="pie-slice"
                          cx="100"
                          cy="100"
                          r="90"
                          fill={chartSlices[0].color}
                          onMouseMove={(event) =>
                            handleSliceHover(chartSlices[0], event)
                          }
                        />
                      ) : (
                        chartSlices.map((slice) => (
                          <path
                            key={slice.pool.pool_id}
                            className="pie-slice"
                            d={describeArc(
                              100,
                              100,
                              90,
                              slice.startAngle,
                              slice.endAngle
                            )}
                            fill={slice.color}
                            onMouseMove={(event) =>
                              handleSliceHover(slice, event)
                            }
                          />
                        ))
                      )}
                    </svg>
                  ) : (
                    <div className="chart-empty">
                      Allocate capital to see the mix.
                    </div>
                  )}
                  {tooltip && (
                    <div
                      className="chart-tooltip"
                      style={{ left: tooltip.x, top: tooltip.y }}
                    >
                      <span className="tooltip-title">{tooltip.title}</span>
                      <span className="tooltip-value">{tooltip.value}</span>
                    </div>
                  )}
                </div>
                <div className="pie-legend">
                  {chartSlices.map((slice) => (
                    <div className="legend-row" key={slice.pool.pool_id}>
                      <span
                        className="legend-swatch"
                        style={{ backgroundColor: slice.color }}
                        aria-hidden="true"
                      ></span>
                      <div className="legend-meta">
                        <span className="legend-title">
                          {slice.pool.project} - {slice.pool.symbol}
                        </span>
                        <span className="legend-sub">
                          {formatPercent(slice.weight * 100, 1)} ·{" "}
                          {formatCurrency(slice.allocation)}
                        </span>
                      </div>
                    </div>
                  ))}
                  {!chartSlices.length && (
                    <div className="legend-row">No allocation data yet.</div>
                  )}
                </div>
              </div>
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
