import { DiscoveredToken, Snapshot } from "./types.ts";
import { config, SOL_MINT } from "./config.ts";
import { getJson } from "./http.ts";
import { log } from "./log.ts";

interface CacheEntry { at: number; value: Partial<Snapshot> }

const n = (...xs: unknown[]): number | undefined => {
  for (const x of xs) {
    if (x === null || x === undefined || x === "") continue;
    const v = Number(x);
    if (Number.isFinite(v)) return v;
  }
  return undefined;
};

export class DexScreener {
  // Shared across Scanner + Trader instances so they do not independently hammer
  // DEX Screener from the same Railway service/IP.
  private static cache = new Map<string, CacheEntry>();
  private static solUsdCache?: { at:number; value:number };
  private static requestChain: Promise<void> = Promise.resolve();
  private static lastRequestAt = 0;
  private static blockedUntil = 0;

  private async dexJson(url:string): Promise<any> {
    let release!:()=>void;
    const prior = DexScreener.requestChain;
    DexScreener.requestChain = new Promise<void>(r=>{ release=r; });
    await prior;
    try {
      const now=Date.now();
      if(now < DexScreener.blockedUntil) throw new Error(`rate-limit cooldown ${Math.ceil((DexScreener.blockedUntil-now)/1000)}s`);
      const wait=Math.max(0,config.dexMinIntervalMs-(now-DexScreener.lastRequestAt));
      if(wait) await new Promise(r=>setTimeout(r,wait));
      DexScreener.lastRequestAt=Date.now();
      try { return await getJson(url,{"accept":"application/json","user-agent":"BrokeDogBot/1.4.1"},config.dexTimeoutMs); }
      catch(e){
        const msg=e instanceof Error?e.message:String(e);
        if(/\b429\b|1015|rate limit/i.test(msg)){
          DexScreener.blockedUntil=Date.now()+config.dexRateLimitBackoffMs;
          throw new Error(`rate limited — cooling down DEX Screener for ${Math.round(config.dexRateLimitBackoffMs/1000)}s`);
        }
        throw e;
      }
    } finally { release(); }
  }

  private choosePair(pairs: any[], address?: string) {
    const relevant = address ? pairs.filter(p => p?.baseToken?.address === address || p?.quoteToken?.address === address) : pairs;
    return relevant.sort((a, b) => (n(b?.liquidity?.usd) ?? 0) - (n(a?.liquidity?.usd) ?? 0))[0];
  }

  /**
   * Always-on, no-key discovery. DEX Screener's latest profiles/boost feeds are
   * intentionally used as attention signals, not automatic buy signals.
   */
  async discover(): Promise<DiscoveredToken[]> {
    const feeds: Array<{url:string; source:DiscoveredToken["source"]; cap:number}> = [
      { url:"https://api.dexscreener.com/token-profiles/latest/v1", source:"dex-profile", cap:16 },
      // Boosts are paid attention signals, so they are supplemental only.
      { url:"https://api.dexscreener.com/token-boosts/latest/v1", source:"dex-boost", cap:5 },
      { url:"https://api.dexscreener.com/token-boosts/top/v1", source:"dex-boost-top", cap:5 },
    ];
    const settled = await Promise.allSettled(feeds.map(f => this.dexJson(f.url)));
    const byAddress = new Map<string, DiscoveredToken>();

    // Take a balanced slice from every feed. Previously the first feed could fill
    // the entire 30-token batch, starving boosted/trending candidates.
    for (let fi=0; fi<settled.length; fi++) {
      const r = settled[fi]; if (r.status !== "fulfilled") continue;
      const rows = Array.isArray(r.value) ? r.value : [];
      let rank = 0, accepted = 0;
      for (const row of rows) {
        if (row?.chainId !== "solana") continue;
        const address = row?.tokenAddress;
        if (!address || address === SOL_MINT) continue;
        rank++;
        const existing = byAddress.get(address);
        if (existing) {
          // Keep the stronger feed as the canonical source; Scanner will still
          // see rediscovery frequently enough to re-watch momentum.
          const strength = (src:string) => src === "dex-boost-top" ? 3 : src === "dex-boost" ? 2 : 1;
          if (strength(feeds[fi].source) > strength(existing.source)) {
            existing.source = feeds[fi].source;
            existing.rank = rank;
          }
          continue;
        }
        byAddress.set(address, { address, name:"Unknown", symbol:"?", source:feeds[fi].source, rank, discoveredAt:Date.now() });
        accepted++;
        if (accepted >= feeds[fi].cap) break;
      }
    }

    const tokens = [...byAddress.values()].slice(0, 30);
    if (tokens.length) {
      const enriched = await this.batch(tokens.map(t=>t.address));
      for (const t of tokens) {
        const e = enriched.get(t.address) as any;
        if (!e) continue;
        if (e.tokenName) t.name = e.tokenName;
        if (e.tokenSymbol) t.symbol = e.tokenSymbol;
        t.seed = e;
      }
    }
    return tokens;
  }

  async batch(addresses: string[]): Promise<Map<string, Partial<Snapshot> & {tokenName?:string;tokenSymbol?:string}>> {
    const out = new Map<string, Partial<Snapshot> & {tokenName?:string;tokenSymbol?:string}>();
    const now = Date.now();
    const unique = [...new Set(addresses)].slice(0, 30);
    const missing: string[] = [];

    for (const address of unique) {
      const cached = DexScreener.cache.get(address);
      if (cached && now - cached.at < config.dexCacheMs) out.set(address, cached.value as any);
      else missing.push(address);
    }
    if (!missing.length) return out;

    try {
      const url = `https://api.dexscreener.com/tokens/v1/solana/${missing.map(encodeURIComponent).join(",")}`;
      const raw = await this.dexJson(url);
      const pairs = Array.isArray(raw) ? raw : Array.isArray(raw?.pairs) ? raw.pairs : [];
      const grouped = new Map<string, any[]>();
      for (const p of pairs) {
        for (const address of [p?.baseToken?.address, p?.quoteToken?.address]) {
          if (!address || !missing.includes(address)) continue;
          const a = grouped.get(address) ?? []; a.push(p); grouped.set(address, a);
        }
      }

      for (const address of missing) {
        const pair = this.choosePair(grouped.get(address) ?? [], address);
        if (!pair) continue;
        const token = pair?.baseToken?.address === address ? pair.baseToken : pair?.quoteToken?.address === address ? pair.quoteToken : undefined;
        // priceUsd describes the base token. For discovered candidates we normally
        // expect the candidate as base. Avoid assigning the wrong price if it is quote.
        const priceUsd = pair?.baseToken?.address === address ? n(pair.priceUsd) : undefined;
        const value: Partial<Snapshot> & {tokenName?:string;tokenSymbol?:string} = {
          priceUsd,
          liquidityUsd: n(pair.liquidity?.usd),
          marketCapUsd: pair?.baseToken?.address === address ? n(pair.marketCap, pair.fdv) : undefined,
          volume5mUsd: n(pair.volume?.m5),
          volume1hUsd: n(pair.volume?.h1),
          buys5m: n(pair.txns?.m5?.buys),
          sells5m: n(pair.txns?.m5?.sells),
          priceChange5mPct: pair?.baseToken?.address === address ? n(pair.priceChange?.m5) : undefined,
          dexPairAddress: pair.pairAddress,
          dexId: pair.dexId,
          tokenName: token?.name,
          tokenSymbol: token?.symbol,
          pairCreatedAt: n(pair.pairCreatedAt),
        } as any;
        DexScreener.cache.set(address, { at: now, value });
        out.set(address, value);
      }
    } catch (e) {
      const msg=e instanceof Error ? e.message : String(e);
      if(/cooldown|rate limited/i.test(msg)) log.warn(`[DEX] enrichment paused: ${msg}`);
      else log.warn(`[DEX] batch enrichment failed: ${msg}`);
    }
    return out;
  }

  getCachedSolPrice(maxAgeMs = config.solUsdStaleMs): number | undefined {
    if (!DexScreener.solUsdCache || Date.now()-DexScreener.solUsdCache.at > maxAgeMs) return undefined;
    return DexScreener.solUsdCache.value;
  }

  /** Free SOL/USD fallback so position sizing/exits do not consume Birdeye CUs. */
  async solPriceUsd(): Promise<number> {
    if (DexScreener.solUsdCache && Date.now()-DexScreener.solUsdCache.at < 60_000) return DexScreener.solUsdCache.value;
    const raw = await this.dexJson("https://api.dexscreener.com/latest/dex/search?q=SOL%2FUSDC");
    const pairs = Array.isArray(raw?.pairs) ? raw.pairs : [];
    const candidates = pairs.filter((p:any)=>p?.chainId==="solana" && p?.baseToken?.address===SOL_MINT && n(p?.priceUsd));
    const pair = this.choosePair(candidates);
    const price = n(pair?.priceUsd);
    if (!price) throw new Error("Could not read SOL/USD from DEX Screener");
    DexScreener.solUsdCache={at:Date.now(),value:price};
    return price;
  }
}
