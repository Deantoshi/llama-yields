import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

function formatCurrency(value: number | null, digits = 0) {
  if (value == null || Number.isNaN(value)) {
    return "--";
  }
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatPercent(value: number | null, digits = 2) {
  if (value == null || Number.isNaN(value)) {
    return "--";
  }
  return `${value.toFixed(digits)}%`;
}

function formatBaseRewardPercent(value: number | null) {
  if (value == null || Number.isNaN(value)) {
    return "0%";
  }
  if (value === 0) {
    return "0%";
  }
  return formatPercent(value);
}

function estimateApyBreakdownFromTotal(
  total: number | null,
  base: number,
  reward: number
) {
  if (total == null || Number.isNaN(total)) {
    return { base: null, reward: null };
  }
  const currentTotal = base + reward;
  if (currentTotal <= 0) {
    return { base: total, reward: 0 };
  }
  const baseShare = base / currentTotal;
  const rewardShare = reward / currentTotal;
  return { base: total * baseShare, reward: total * rewardShare };
}

function formatNumber(value: number) {
  return value.toLocaleString("en-US");
}

function predictedApy(pool: Pool, allocation: number, includeRewards: boolean) {
  if (pool.apy == null && pool.apy_base == null && pool.apy_reward == null) {
    return null;
  }
  const fallbackBase = includeRewards ? 0 : pool.apy ?? 0;
  const slope = pool.apy_tvl_slope ?? 0;
  const base = pool.apy_base ?? fallbackBase;
  if (!includeRewards) {
    return Math.max(0, base);
  }
  const reward = pool.apy_reward ?? Math.max(0, (pool.apy ?? 0) - base);
  const predictedReward = Math.max(0, reward + slope * allocation);
  return Math.max(0, base + predictedReward);
}

function predictedApyBreakdown(
  pool: Pool,
  allocation: number,
  includeRewards: boolean
) {
  const predicted = predictedApy(pool, allocation, includeRewards);
  if (predicted == null) {
    return { base: null, reward: null };
  }
  const fallbackBase = includeRewards ? 0 : pool.apy ?? 0;
  const base = pool.apy_base ?? fallbackBase;
  const reward = includeRewards ? Math.max(0, predicted - base) : 0;
  return { base, reward };
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
  const [tvlMin, setTvlMin] = useState(1000000);
  const [tvlMinDisplay, setTvlMinDisplay] = useState(formatNumber(1000000));
  const [splits, setSplits] = useState(6);
  const [includeRewards, setIncludeRewards] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removedPoolIds, setRemovedPoolIds] = useState<string[]>([]);
  const [manualPools, setManualPools] = useState<Pool[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState<Pool[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    title: string;
    value: string;
  } | null>(null);
  const lastWeightsRef = useRef<Record<string, number>>({});
  const removedPoolSet = useMemo(
    () => new Set(removedPoolIds),
    [removedPoolIds]
  );

  useEffect(() => {
    if (!selectedPools.length) {
      return;
    }
    const total = selectedPools.reduce(
      (sum, pool) => sum + (allocations[pool.pool_id] || 0),
      0
    );
    const nonZero = selectedPools.filter(
      (pool) => (allocations[pool.pool_id] || 0) > 0
    );
    if (total <= 0 || nonZero.length < 2) {
      return;
    }
    const maxShare = Math.max(
      ...selectedPools.map((pool) => (allocations[pool.pool_id] || 0) / total)
    );
    if (maxShare >= 0.98) {
      return;
    }
    const nextWeights: Record<string, number> = {};
    selectedPools.forEach((pool) => {
      const value = allocations[pool.pool_id] || 0;
      nextWeights[pool.pool_id] = value / total;
    });
    lastWeightsRef.current = nextWeights;
  }, [allocations, selectedPools]);

  const updateAllocationByPercent = useCallback(
    (poolId: string, percent: number) => {
      setAllocations((prev) => {
        const poolIds = selectedPools.map((pool) => pool.pool_id);
        if (!poolIds.includes(poolId)) {
          return prev;
        }

        const totalCurrent = poolIds.reduce(
          (sum, id) => sum + (prev[id] || 0),
          0
        );
        const totalTarget = totalCurrent > 0 ? totalCurrent : investment;
        const clampedPercent = Math.min(100, Math.max(0, percent));
        const nextAllocation = Math.round(
          (totalTarget * clampedPercent) / 100
        );
        const otherIds = poolIds.filter((id) => id !== poolId);
        if (clampedPercent >= 100 && totalCurrent > 0) {
          const stored = lastWeightsRef.current;
          const hasStoredForOthers = otherIds.some((id) => (stored[id] || 0) > 0);
          if (!hasStoredForOthers) {
            const snapshot: Record<string, number> = {};
            poolIds.forEach((id) => {
              snapshot[id] = (prev[id] || 0) / totalCurrent;
            });
            lastWeightsRef.current = snapshot;
          }
        }
        const next = { ...prev, [poolId]: nextAllocation };
        const remaining = totalTarget - nextAllocation;

        if (!otherIds.length) {
          return next;
        }

        if (remaining <= 0) {
          otherIds.forEach((id) => {
            next[id] = 0;
          });
          return next;
        }

        const storedWeights = lastWeightsRef.current;
        const storedTotal = otherIds.reduce(
          (sum, id) => sum + (storedWeights[id] || 0),
          0
        );
        const currentOthersTotal = otherIds.reduce(
          (sum, id) => sum + (prev[id] || 0),
          0
        );

        const weights = otherIds.map((id) => {
          if (storedTotal > 0) {
            return storedWeights[id] || 0;
          }
          if (currentOthersTotal > 0) {
            return prev[id] || 0;
          }
          return 1;
        });
        const weightTotal =
          storedTotal > 0
            ? storedTotal
            : currentOthersTotal > 0
              ? currentOthersTotal
              : weights.length;

        const allocationsById: Record<string, number> = {};
        const remainders = weights
          .map((weight, index) => {
            const raw = (remaining * weight) / weightTotal;
            const base = Math.floor(raw);
            allocationsById[otherIds[index]] = base;
            return { index, frac: raw - base };
          })
          .sort((a, b) => b.frac - a.frac);

        let remainder = remaining - Object.values(allocationsById).reduce(
          (sum, value) => sum + value,
          0
        );
        for (let i = 0; i < remainders.length && remainder > 0; i += 1) {
          const id = otherIds[remainders[i].index];
          allocationsById[id] += 1;
          remainder -= 1;
        }

        otherIds.forEach((id) => {
          next[id] = allocationsById[id] || 0;
        });

        return next;
      });
    },
    [investment, selectedPools]
  );

  const recomputeSelection = useCallback(() => {
    if (!pools.length) {
      const filteredManualPools = manualPools.filter(
        (pool) => (pool.tvl_usd ?? 0) >= tvlMin
      );
      setSelectedPools(filteredManualPools);
      const allocation = investment / Math.max(1, filteredManualPools.length);
      const nextAllocations: Record<string, number> = {};
      filteredManualPools.forEach((pool) => {
        nextAllocations[pool.pool_id] = allocation;
      });
      setAllocations(nextAllocations);
      return;
    }
    const filteredManualPools = manualPools.filter(
      (pool) =>
        !removedPoolSet.has(pool.pool_id) && (pool.tvl_usd ?? 0) >= tvlMin
    );
    const manualIds = new Set(
      filteredManualPools.map((pool) => pool.pool_id)
    );
    const targetCount = Math.max(splits, filteredManualPools.length);
    const allocation = investment / Math.max(1, targetCount);
    const scored = pools
      .filter(
        (pool) =>
          !removedPoolSet.has(pool.pool_id) &&
          !manualIds.has(pool.pool_id) &&
          (pool.tvl_usd ?? 0) >= tvlMin
      )
      .map((pool) => ({
        pool,
        predicted: predictedApy(pool, allocation, includeRewards) ?? 0,
      }));
    scored.sort((a, b) => (b.predicted ?? 0) - (a.predicted ?? 0));

    const selected = [
      ...filteredManualPools,
      ...scored
        .slice(0, Math.min(targetCount - filteredManualPools.length, scored.length))
        .map((item) => item.pool),
    ];

    setSelectedPools(selected);
    const nextAllocations: Record<string, number> = {};
    selected.forEach((pool) => {
      nextAllocations[pool.pool_id] = allocation;
    });
    setAllocations(nextAllocations);
  }, [
    investment,
    pools,
    removedPoolSet,
    splits,
    includeRewards,
    manualPools,
    tvlMin,
  ]);

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

  const removeSelectedPool = useCallback(
    (poolId: string) => {
      setManualPools((prev) => prev.filter((pool) => pool.pool_id !== poolId));
      setSelectedPools((prev) => {
        const remaining = prev.filter((pool) => pool.pool_id !== poolId);
        const existingIds = new Set(remaining.map((pool) => pool.pool_id));
        const nextManualPools = manualPools.filter(
          (pool) => pool.pool_id !== poolId
        );
        const targetCount = Math.max(splits, nextManualPools.length);
        const allocation = investment / Math.max(1, targetCount);
        const nextRemoved = new Set(removedPoolSet);
        nextRemoved.add(poolId);
        const scored = pools
          .filter(
            (pool) =>
              !existingIds.has(pool.pool_id) &&
              !nextRemoved.has(pool.pool_id) &&
              !nextManualPools.some((item) => item.pool_id === pool.pool_id)
          )
          .map((pool) => ({
            pool,
            predicted: predictedApy(pool, allocation, includeRewards) ?? 0,
          }))
          .sort((a, b) => (b.predicted ?? 0) - (a.predicted ?? 0));
        const replacement =
          remaining.length < targetCount ? scored[0]?.pool ?? null : null;

        if (replacement) {
          remaining.push(replacement);
        }

        setAllocations((prevAlloc) => {
          const next = { ...prevAlloc };
          const removedAllocation = next[poolId] ?? 0;
          delete next[poolId];
          if (replacement) {
            next[replacement.pool_id] = removedAllocation || allocation;
          }
          return next;
        });

        const nextWeights = { ...lastWeightsRef.current };
        delete nextWeights[poolId];
        lastWeightsRef.current = nextWeights;

        return remaining;
      });
      setRemovedPoolIds((prev) => {
        if (prev.includes(poolId)) {
          return prev;
        }
        return [...prev, poolId];
      });
    },
    [investment, pools, removedPoolSet, splits, includeRewards, manualPools]
  );

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setRemovedPoolIds([]);

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
      const filteredManualPools = manualPools.filter(
        (pool) => (pool.tvl_usd ?? 0) >= tvlMin
      );
      setSelectedPools(filteredManualPools);
      const allocation = investment / Math.max(1, filteredManualPools.length);
      const nextAllocations: Record<string, number> = {};
      filteredManualPools.forEach((pool) => {
        nextAllocations[pool.pool_id] = allocation;
      });
      setAllocations(nextAllocations);
      return;
    }
    recomputeSelection();
  }, [pools, recomputeSelection, investment, manualPools, tvlMin]);

  const filteredSearchResults = useMemo(() => {
    if (!searchResults.length) {
      return [];
    }
    return searchResults.filter((pool) => (pool.tvl_usd ?? 0) >= tvlMin);
  }, [searchResults, tvlMin]);

  const totalAllocated = useMemo(() => {
    return Object.values(allocations).reduce((sum, value) => sum + value, 0);
  }, [allocations]);

  const blendedApy = useMemo(() => {
    let weightedSum = 0;
    selectedPools.forEach((pool) => {
      const allocation = allocations[pool.pool_id] || 0;
      const predicted = predictedApy(pool, allocation, includeRewards);
      if (predicted != null) {
        weightedSum += predicted * allocation;
      }
    });
    return totalAllocated > 0 ? weightedSum / totalAllocated : 0;
  }, [allocations, selectedPools, totalAllocated, includeRewards]);
  const blendedApyBreakdown = useMemo(() => {
    if (totalAllocated <= 0) {
      return { base: 0, reward: 0 };
    }
    let baseSum = 0;
    let rewardSum = 0;
    selectedPools.forEach((pool) => {
      const allocation = allocations[pool.pool_id] || 0;
      if (allocation <= 0) {
        return;
      }
      const breakdown = predictedApyBreakdown(
        pool,
        allocation,
        includeRewards
      );
      if (breakdown.base == null && breakdown.reward == null) {
        return;
      }
      baseSum += (breakdown.base ?? 0) * allocation;
      rewardSum += (breakdown.reward ?? 0) * allocation;
    });
    return {
      base: baseSum / totalAllocated,
      reward: rewardSum / totalAllocated,
    };
  }, [allocations, selectedPools, totalAllocated, includeRewards]);

  const annualYield = useMemo(() => {
    return (blendedApy / 100) * totalAllocated;
  }, [blendedApy, totalAllocated]);
  const annualYieldBreakdown = useMemo(() => {
    if (totalAllocated <= 0) {
      return { base: 0, reward: 0 };
    }
    return {
      base: (blendedApyBreakdown.base / 100) * totalAllocated,
      reward: (blendedApyBreakdown.reward / 100) * totalAllocated,
    };
  }, [blendedApyBreakdown.base, blendedApyBreakdown.reward, totalAllocated]);
  const monthlyYield = useMemo(() => {
    return annualYield / 12;
  }, [annualYield]);
  const dailyYield = useMemo(() => {
    return annualYield / 365;
  }, [annualYield]);
  const projectedYields = useMemo(
    () => [
      {
        label: "Annual",
        value: formatCurrency(annualYield, 2),
        helper: "Yearly",
        tooltip: `Base: ${formatCurrency(
          annualYieldBreakdown.base,
          2
        )} • Rewards: ${formatCurrency(annualYieldBreakdown.reward, 2)}`,
      },
      {
        label: "Monthly",
        value: formatCurrency(monthlyYield, 2),
        helper: "Month",
        tooltip: `Base: ${formatCurrency(
          annualYieldBreakdown.base / 12,
          2
        )} • Rewards: ${formatCurrency(annualYieldBreakdown.reward / 12, 2)}`,
      },
      {
        label: "Daily",
        value: formatCurrency(dailyYield, 2),
        helper: "Day",
        tooltip: `Base: ${formatCurrency(
          annualYieldBreakdown.base / 365,
          2
        )} • Rewards: ${formatCurrency(annualYieldBreakdown.reward / 365, 2)}`,
      },
    ],
    [
      annualYield,
      annualYieldBreakdown.base,
      annualYieldBreakdown.reward,
      monthlyYield,
      dailyYield,
    ]
  );

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
        const predicted = predictedApy(pool, allocation, includeRewards);
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

  const addPoolToSelection = useCallback(
    (pool: Pool) => {
      setSelectedPools((prev) => {
        if (prev.some((item) => item.pool_id === pool.pool_id)) {
          return prev;
        }
        return [...prev, pool];
      });
      setManualPools((prev) => {
        if (prev.some((item) => item.pool_id === pool.pool_id)) {
          return prev;
        }
        return [...prev, pool];
      });
      setAllocations((prev) => {
        if (prev[pool.pool_id] != null) {
          return prev;
        }
        const targetCount = Math.max(1, Math.max(splits, selectedPools.length + 1));
        const allocation = Math.round(investment / targetCount);
        return { ...prev, [pool.pool_id]: allocation };
      });
      setRemovedPoolIds((prev) => prev.filter((id) => id !== pool.pool_id));
      setSearchTerm("");
      setSearchResults([]);
    },
    [investment, splits, selectedPools.length]
  );

  useEffect(() => {
    const query = searchTerm.trim();
    if (query.length < 2) {
      setSearchResults([]);
      setSearchLoading(false);
      setSearchError(null);
      return;
    }

    const controller = new AbortController();
    const handle = window.setTimeout(() => {
      setSearchLoading(true);
      setSearchError(null);
      fetch(
        `/api/pools/search?query=${encodeURIComponent(query)}&limit=20`,
        { signal: controller.signal }
      )
        .then((response) => {
          if (!response.ok) {
            throw new Error(`Search failed (${response.status})`);
          }
          return response.json();
        })
        .then((payload) => {
          setSearchResults(payload.data || []);
        })
        .catch((err) => {
          if (controller.signal.aborted) {
            return;
          }
          console.error(err);
          setSearchError("Search failed. Try again.");
          setSearchResults([]);
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setSearchLoading(false);
          }
        });
    }, 250);

    return () => {
      controller.abort();
      window.clearTimeout(handle);
      setSearchLoading(false);
    };
  }, [searchTerm]);

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
                <span>Minimum TVL (USD)</span>
                <input
                  id="tvl-min"
                  type="text"
                  inputMode="numeric"
                  value={tvlMinDisplay}
                  onChange={(event) => {
                    const raw = event.target.value.replace(/[^\d]/g, "");
                    if (!raw) {
                      setTvlMin(0);
                      setTvlMinDisplay("");
                      return;
                    }
                    const nextValue = Number(raw);
                    setTvlMin(nextValue);
                    setTvlMinDisplay(formatNumber(nextValue));
                  }}
                  onBlur={() => {
                    setTvlMinDisplay(formatNumber(tvlMin));
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
                <span>Rewards APY</span>
                <div className="control-actions">
                  <button
                    className={includeRewards ? "solid" : "ghost"}
                    aria-pressed={includeRewards}
                    onClick={() => setIncludeRewards((prev) => !prev)}
                  >
                    {includeRewards ? "Rewards on" : "Rewards off"}
                  </button>
                  <button className="ghost" onClick={autoAllocate}>
                    Auto-allocate
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
                <span className="summary-label">Projected yield</span>
                <div className="yield-row">
                  {projectedYields.map((yieldItem) => (
                    <div
                      className="yield-item has-tooltip"
                      data-tooltip={yieldItem.tooltip}
                      key={yieldItem.label}
                    >
                      <span className="summary-value">{yieldItem.value}</span>
                      <span className="yield-helper">
                        {yieldItem.label} · {yieldItem.helper}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="summary-card">
                <span className="summary-label">Allocation status</span>
                <span className="summary-value">
                  {formatCurrency(totalAllocated)} allocated - {allocationStatus}
                </span>
              </div>
            </div>

            <div className="allocation-search">
              <label className="allocation-search-label">
                <span>Search opportunities</span>
                <div className="allocation-search-box">
                  <input
                    type="search"
                    value={searchTerm}
                    placeholder="Search app or symbol"
                    onChange={(event) => setSearchTerm(event.target.value)}
                    aria-label="Search pools by protocol or symbol"
                  />
                  {searchTerm.trim().length > 0 && (
                    <div
                      className="allocation-search-results"
                      role="listbox"
                    >
                      {searchTerm.trim().length < 2 && (
                        <div className="search-result is-empty">
                          Type at least 2 characters to search.
                        </div>
                      )}
                      {searchTerm.trim().length >= 2 && searchLoading && (
                        <div className="search-result is-empty">
                          Searching pools...
                        </div>
                      )}
                      {searchTerm.trim().length >= 2 &&
                        !searchLoading &&
                        searchError && (
                          <div className="search-result is-empty">
                            {searchError}
                          </div>
                        )}
                      {searchTerm.trim().length >= 2 &&
                        !searchLoading &&
                        !searchError &&
                        filteredSearchResults.length === 0 && (
                          <div className="search-result is-empty">
                            No matching pools found.
                          </div>
                        )}
                      {searchTerm.trim().length >= 2 &&
                        !searchLoading &&
                        !searchError &&
                        filteredSearchResults.map((pool) => {
                          const isSelected = selectedPools.some(
                            (item) => item.pool_id === pool.pool_id
                          );
                          return (
                            <button
                              className="search-result"
                              type="button"
                              key={pool.pool_id}
                              onClick={() => addPoolToSelection(pool)}
                              disabled={isSelected}
                            >
                              <div className="search-result-meta">
                                {pool.protocol_logo && (
                                  <img
                                    src={pool.protocol_logo}
                                    alt={`${pool.project} logo`}
                                    loading="lazy"
                                  />
                                )}
                                <div className="search-result-info">
                                  <span className="search-result-title">
                                    {pool.project} · {pool.symbol}
                                  </span>
                                  <span className="search-result-sub">
                                    {pool.chain} • {pool.category}
                                  </span>
                                  <span className="search-result-stats">
                                    TVL {formatCurrency(pool.tvl_usd)} · APY{" "}
                                    {formatPercent(pool.apy)}
                                  </span>
                                </div>
                              </div>
                              <span className="search-result-cta">
                                {isSelected ? "Added" : "Add"}
                              </span>
                            </button>
                          );
                        })}
                    </div>
                  )}
                </div>
              </label>
              <span className="allocation-search-meta">
                {filteredSearchResults.length
                  ? `${filteredSearchResults.length} results`
                  : `${selectedPools.length} pools in table`}
              </span>
            </div>

            <div className="allocation-header">
              <span>Pool</span>
              <span>Expected / Current / 30D APY</span>
              <span>TVL</span>
              <span>Allocation</span>
              <span>Weight</span>
              <span>Remove</span>
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
                  const predicted = predictedApy(
                    pool,
                    allocation,
                    includeRewards
                  );
                  const predictedBreakdown = predictedApyBreakdown(
                    pool,
                    allocation,
                    includeRewards
                  );
                  const baseCurrent =
                    pool.apy_base ?? (includeRewards ? 0 : pool.apy ?? 0);
                  const rewardCurrent = includeRewards
                    ? pool.apy_reward ??
                      Math.max(0, (pool.apy ?? 0) - baseCurrent)
                    : 0;
                  const currentApy = includeRewards
                    ? pool.apy
                    : pool.apy_base ?? pool.apy;
                  const thirtyDayBreakdown = estimateApyBreakdownFromTotal(
                    pool.apy_30d,
                    baseCurrent,
                    rewardCurrent
                  );
                  const totalTarget =
                    totalAllocated > 0 ? totalAllocated : investment;
                  const allocationPercent =
                    totalTarget > 0
                      ? Math.min(
                          100,
                          Math.max(0, (allocation / totalTarget) * 100)
                        )
                      : 0;
                  const poolUrl =
                    pool.url?.trim() || pool.protocol_url?.trim() || "";
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
                        <div className="pool-meta-row">
                          {pool.protocol_logo && (
                            <img
                              className="pool-logo"
                              src={pool.protocol_logo}
                              alt={`${pool.project} logo`}
                              loading="lazy"
                            />
                          )}
                          <div className="pool-meta-text">
                            <span className="pool-title">
                              {pool.project} - {pool.symbol}
                            </span>
                            <span className="pool-sub">
                              {pool.chain}
                              {poolUrl ? (
                                <a
                                  className="pool-link"
                                  href={poolUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  aria-label={`Open ${pool.project} ${pool.symbol} link`}
                                >
                                  <svg viewBox="0 0 24 24" aria-hidden="true">
                                    <path
                                      d="M14 3h7v7h-2V6.41l-9.29 9.3-1.42-1.42 9.3-9.29H14V3zM5 5h6V3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-6h-2v6H5V5z"
                                    />
                                  </svg>
                                </a>
                              ) : (
                                <span
                                  className="pool-link is-disabled"
                                  aria-disabled="true"
                                  aria-label={`No link available for ${pool.project} ${pool.symbol}`}
                                >
                                  <svg viewBox="0 0 24 24" aria-hidden="true">
                                    <path
                                      d="M14 3h7v7h-2V6.41l-9.29 9.3-1.42-1.42 9.3-9.29H14V3zM5 5h6V3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-6h-2v6H5V5z"
                                    />
                                  </svg>
                                </span>
                              )}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="apy-cell" data-role="apy">
                        <div
                          className="apy-item"
                          data-tooltip={`Base: ${formatBaseRewardPercent(
                            predictedBreakdown.base
                          )} • Rewards: ${formatBaseRewardPercent(
                            predictedBreakdown.reward
                          )}`}
                        >
                          <span className="apy-label">Expected</span>
                          <span className="apy-value">
                            {formatPercent(predicted)}
                          </span>
                        </div>
                        <span className="apy-sep" aria-hidden="true">
                          |
                        </span>
                        <div
                          className="apy-item"
                          data-tooltip={`Base: ${formatBaseRewardPercent(
                            baseCurrent
                          )} • Rewards: ${formatBaseRewardPercent(
                            rewardCurrent
                          )}`}
                        >
                          <span className="apy-label">Current</span>
                          <span className="apy-value">
                            {formatPercent(currentApy)}
                          </span>
                        </div>
                        <span className="apy-sep" aria-hidden="true">
                          |
                        </span>
                        <div
                          className="apy-item"
                          data-tooltip={`Base: ${formatBaseRewardPercent(
                            thirtyDayBreakdown.base
                          )} • Rewards: ${formatBaseRewardPercent(
                            thirtyDayBreakdown.reward
                          )}`}
                        >
                          <span className="apy-label">30D</span>
                          <span className="apy-value">
                            {formatPercent(pool.apy_30d)}
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
                                updateAllocationByPercent(pool.pool_id, percent);
                              }}
                            />
                            <div className="allocation-ticks" aria-hidden="true">
                              {[0, 25, 50, 75, 100].map((percent) => (
                                <span
                                  key={percent}
                                  className="allocation-tick-mark"
                                  style={{
                                    left: `${percent}%`,
                                    transform:
                                      percent === 0
                                        ? "translateX(0)"
                                        : percent === 100
                                          ? "translateX(-100%)"
                                        : "translateX(-50%)",
                                  }}
                                />
                              ))}
                            </div>
                            <div className="allocation-tick-labels">
                              {[0, 25, 50, 75, 100].map((percent) => (
                                <button
                                  key={percent}
                                  type="button"
                                  className="allocation-tick"
                                  style={{
                                    left: `${percent}%`,
                                    transform:
                                      percent === 0
                                        ? "translateX(0)"
                                        : percent === 100
                                          ? "translateX(-100%)"
                                          : "translateX(-50%)",
                                  }}
                                  onClick={() => {
                                    updateAllocationByPercent(
                                      pool.pool_id,
                                      percent
                                    );
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
                      <button
                        className="row-remove"
                        type="button"
                        onClick={() => removeSelectedPool(pool.pool_id)}
                        aria-label={`Remove ${pool.project} ${pool.symbol}`}
                      >
                        x
                      </button>
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

      </main>

      <footer className="footer">
        <span>Powered by DefiLlama API data.</span>
        <span>Model uses a linear APY vs TVL elasticity on recent history.</span>
      </footer>
    </div>
  );
}

export default App;
