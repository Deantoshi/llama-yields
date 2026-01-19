export type Pool = {
  pool_id: string;
  project: string;
  chain: string;
  symbol: string;
  url: string | null;
  protocol_url: string | null;
  protocol_logo: string | null;
  category: string;
  tvl_usd: number | null;
  apy: number | null;
  apy_base: number | null;
  apy_reward: number | null;
  apy_30d: number | null;
  apy_tvl_slope: number | null;
  sample_count: number;
};
