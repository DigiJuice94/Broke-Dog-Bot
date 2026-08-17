import { Jupiter } from "./jupiter.ts";
import { config, LAMPORTS_PER_SOL, SOL_MINT } from "./config.ts";
import { Candidate, Position } from "./types.ts";
import { log } from "./log.ts";
import { choosePositionUsd } from "./sizing.ts";
import { WalletService } from "./wallet.ts";
import { Notifier } from "./notifier.ts";
import { DexScreener } from "./dexscreener.ts";
import { SolPriceService } from "./solPrice.ts";
import { socialPerformance } from "./socialPerformance.ts";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

type ClosedTrack={mint:string;name:string;symbol:string;entryPriceUsd:number;exitPriceUsd:number;exitPnlPct:number;closedAt:number;logged:Set<number>;socialAccounts:string[]};

type ExecutableExit = {
  amountRaw: bigint;
  outSol: number;
  outUsd: number;
  pnlPct: number;
  dexImpliedUsd: number;
  valueRatio: number;
};

export class Trader {
  readonly positions = new Map<string, Position>();
  private busy = new Set<string>();
  private lastStatusAt = 0;
  private lastIdleStatusAt = 0;
  private notifier = new Notifier();
  private dex = new DexScreener();
  private solPrice: SolPriceService;
  private closedTracks:ClosedTrack[]=[];
  private lastReconcileAt=0;
  private realizedToday=0;
  private pnlDay=new Date().toISOString().slice(0,10);
  private paperCashUsd=config.paperStartBalanceUsd;
  private paperRealizedUsd=0;
  private paperWins=0;
  private paperLosses=0;
  private paperBestPct=-Infinity;
  private paperWorstPct=Infinity;
  private paperTradeCount=0;
  private paperDayRealizedUsd=0;
  private paperDay=new Date().toISOString().slice(0,10);
  private lastPaperWalletLogAt=0;

  constructor(private wallet: WalletService, private jupiter: Jupiter) {
    this.solPrice = new SolPriceService(this.dex, this.jupiter);
    this.solPrice.start();
  }

  async warmSolPrice() { await this.solPrice.warm(); }

  private saveState(){
    try {
      const data={
        day:this.pnlDay,realizedToday:this.realizedToday,
        paper:{cashUsd:this.paperCashUsd,realizedUsd:this.paperRealizedUsd,wins:this.paperWins,losses:this.paperLosses,bestPct:Number.isFinite(this.paperBestPct)?this.paperBestPct:null,worstPct:Number.isFinite(this.paperWorstPct)?this.paperWorstPct:null,tradeCount:this.paperTradeCount,dayRealizedUsd:this.paperDayRealizedUsd,day:this.paperDay},
        positions:[...this.positions.values()].map(p=>({...p,tokenAmountRaw:p.tokenAmountRaw.toString(),entrySolLamports:p.entrySolLamports.toString()}))
      };
      writeFileSync(config.stateFile,JSON.stringify(data,null,2));
    } catch(e){ log.warn(`[STATE] save failed: ${e instanceof Error?e.message:String(e)}`); }
  }
  private loadState(){
    if(!existsSync(config.stateFile))return;
    try {
      const raw=JSON.parse(readFileSync(config.stateFile,"utf8"));
      this.pnlDay=raw.day??this.pnlDay; this.realizedToday=Number(raw.realizedToday??0);
      if(raw.paper){
        this.paperCashUsd=Number(raw.paper.cashUsd??config.paperStartBalanceUsd);
        this.paperRealizedUsd=Number(raw.paper.realizedUsd??0);
        this.paperWins=Number(raw.paper.wins??0); this.paperLosses=Number(raw.paper.losses??0);
        this.paperBestPct=raw.paper.bestPct==null?-Infinity:Number(raw.paper.bestPct);
        this.paperWorstPct=raw.paper.worstPct==null?Infinity:Number(raw.paper.worstPct);
        this.paperTradeCount=Number(raw.paper.tradeCount??(this.paperWins+this.paperLosses));
        this.paperDayRealizedUsd=Number(raw.paper.dayRealizedUsd??0); this.paperDay=raw.paper.day??this.paperDay;
      }
      for(const x of raw.positions??[]){this.positions.set(x.mint,{...x,tokenAmountRaw:BigInt(x.tokenAmountRaw),entrySolLamports:BigInt(x.entrySolLamports)});}
      log.info(`[STATE] restored ${this.positions.size} persisted position(s)`);
    } catch(e){ log.warn(`[STATE] restore failed: ${e instanceof Error?e.message:String(e)}`); }
  }
  private resetDailyIfNeeded(){
    const d=new Date().toISOString().slice(0,10);
    if(d!==this.pnlDay){this.pnlDay=d;this.realizedToday=0;}
    if(d!==this.paperDay){this.paperDay=d;this.paperDayRealizedUsd=0;}
  }
  private paperCostsPct(){ return (config.paperTrackFees?config.paperFeePct:0)+(config.paperTrackSlippage?config.paperSlippagePct:0); }
  private paperOpenValueUsd(prices?:Map<string,number>){
    let total=0;
    for(const p of this.positions.values()){ if(!p.paper)continue; const price=prices?.get(p.mint)??p.entryPriceUsd; total += p.entryUsd*(price/p.entryPriceUsd)*(1-this.paperCostsPct()/100); }
    return total;
  }
  private logPaperWallet(prices?:Map<string,number>,force=false){
    if(config.liveTrading)return;
    const now=Date.now(); if(!force&&now-this.lastPaperWalletLogAt<config.paperWalletLogIntervalMs)return; this.lastPaperWalletLogAt=now;
    const openValue=this.paperOpenValueUsd(prices); const equity=this.paperCashUsd+openValue;
    const totalPnl=equity-config.paperStartBalanceUsd; const totalReturn=config.paperStartBalanceUsd>0?(totalPnl/config.paperStartBalanceUsd)*100:0;
    const unrealized=equity-this.paperCashUsd-this.positionsArrayPaperCost();
    const closed=this.paperWins+this.paperLosses; const winRate=closed?this.paperWins/closed*100:0;
    const sign=(n:number)=>n>=0?"+":"";
    log.info(`💰🐶 PAPER WALLET 🐶💰 | 💵 Equity:$${equity.toFixed(2)} | 🏦 Cash:$${this.paperCashUsd.toFixed(2)} | 📈 Open:$${openValue.toFixed(2)} | ${totalPnl>=0?"🟢":"🔴"} Total P&L:${sign(totalPnl)}$${totalPnl.toFixed(2)} (${sign(totalReturn)}${totalReturn.toFixed(1)}%) | ✅ Realized:${sign(this.paperRealizedUsd)}$${this.paperRealizedUsd.toFixed(2)} | 👀 Unrealized:${sign(unrealized)}$${unrealized.toFixed(2)} | 📅 Today:${sign(this.paperDayRealizedUsd)}$${this.paperDayRealizedUsd.toFixed(2)} | 🏆 W:${this.paperWins} 💀 L:${this.paperLosses} 🎯 WR:${winRate.toFixed(1)}%${Number.isFinite(this.paperBestPct)?` | 🔥 Best:${sign(this.paperBestPct)}${this.paperBestPct.toFixed(1)}%`:""}${Number.isFinite(this.paperWorstPct)?` | 🧊 Worst:${sign(this.paperWorstPct)}${this.paperWorstPct.toFixed(1)}%`:""}`);
  }
  private positionsArrayPaperCost(){ let total=0; for(const p of this.positions.values())if(p.paper)total+=p.entryUsd; return total; }
  private appendPaperLedger(entry:any){
    try{ let ledger:any[]=[]; if(existsSync(config.paperLedgerFile))ledger=JSON.parse(readFileSync(config.paperLedgerFile,"utf8")); if(!Array.isArray(ledger))ledger=[]; ledger.push(entry); writeFileSync(config.paperLedgerFile,JSON.stringify(ledger,null,2)); }
    catch(e){ log.warn(`[PAPER LEDGER] save failed: ${e instanceof Error?e.message:String(e)}`); }
  }
  async initialize(){ this.loadState(); await this.reconcileWallet(true); if(!config.liveTrading)this.logPaperWallet(undefined,true); }
  private async reconcileWallet(force=false){
    if(!config.liveTrading||!this.wallet.address)return; const now=Date.now(); if(!force&&now-this.lastReconcileAt<config.reconcileIntervalMs)return; this.lastReconcileAt=now;
    try{
      const walletTokens=await this.wallet.tokenAccounts(); const walletMap=new Map(walletTokens.map(x=>[x.mint,x]));
      for(const [mint,p] of [...this.positions]){const w=walletMap.get(mint);if(!w||w.amount===0n){this.positions.delete(mint);log.warn(`[RECONCILE] ✅ ${p.name} ($${p.symbol}) wallet balance is zero — stale position closed`);}else{p.tokenAmountRaw=w.amount;p.decimals=w.decimals;}}
      const orphans=walletTokens.filter(w=>!this.positions.has(w.mint));
      if(orphans.length){const market=await this.dex.batch(orphans.map(x=>x.mint));const solUsd=await this.solPrice.get();for(const w of orphans){try{const d:any=market.get(w.mint),price=d?.priceUsd??0;const q=await this.jupiter.sellQuoteSol(w.mint,w.amount);const value=q.outSol*solUsd;if(value<0.10)continue;const name=d?.tokenName??"Recovered Token",symbol=d?.tokenSymbol??"?";this.positions.set(w.mint,{mint:w.mint,name,symbol,decimals:w.decimals,tokenAmountRaw:w.amount,entrySolLamports:0n,entryUsd:value,entryPriceUsd:price>0?price:1,openedAt:Date.now(),highPriceUsd:price>0?price:1,paper:false,lane:"NORMAL",basisUnknown:true});log.warn(`[♻️ RECOVERED POSITION] ${name} ($${symbol}) | Wallet amount raw:${w.amount.toString()} | executable≈$${value.toFixed(2)} | basis reset at recovery | CA:${w.mint}`);}catch(e){log.warn(`[RECONCILE] orphan ${w.mint} could not be valued: ${e instanceof Error?e.message:String(e)}`);}}
      }
      this.saveState();
    }catch(e){log.warn(`[RECONCILE] wallet sync failed: ${e instanceof Error?e.message:String(e)}`);}
  }

  async buy(c: Candidate) {
    if (this.busy.has(c.token.address) || this.positions.has(c.token.address)) return;
    this.resetDailyIfNeeded(); await this.reconcileWallet();
    const open=this.positions.size, lane=c.entryLane??(c.score>=config.eliteScore?"ELITE":"NORMAL");
    const dailyPnl=config.liveTrading?this.realizedToday:this.paperDayRealizedUsd;
    if(dailyPnl<=-config.maxDailyLossUsd){c.state="FAILED";c.decisionReason=`NO BUY: daily loss limit reached $${dailyPnl.toFixed(2)}`;log.warn(`[🛑 DAILY LOSS] ${c.token.name} skipped | ${c.decisionReason}`);return;}
    if(open>=3){c.state="FAILED";c.decisionReason="NO BUY: 3 position hard cap reached";log.warn(`[NO BUY] ${c.token.name} | ${c.decisionReason}`);return;}
    if(open>=config.maxOpenPositions && c.score<config.thirdPositionScore){c.state="FAILED";c.decisionReason=`NO BUY: 2 slots full; third slot requires score ${config.thirdPositionScore}+`;log.warn(`[NO BUY] ${c.token.name} | Score:${Math.round(c.score)} | ${c.decisionReason}`);return;}
    this.busy.add(c.token.address);
    try {
      const snap = c.snapshots.at(-1)!;
      const solUsd = await this.solPrice.get();
      const solBalance = config.liveTrading ? await this.wallet.solBalance() : this.paperCashUsd / Math.max(solUsd,0.000001);
      const spendableSol = config.liveTrading ? Math.max(0, solBalance - config.solFeeReserve) : solBalance;
      const spendableUsd = config.liveTrading ? spendableSol * solUsd : this.paperCashUsd;
      const usd = choosePositionUsd({
        score: c.score, confidence: c.dataConfidence, spendableUsd,
        routeQuality: snap.routeQuality ?? 50,
        multiTrend: c.sources.has("axiom") && c.sources.has("fomo"), lane, openPositions:open
      });
      if (usd < config.minPositionUsd) {
        c.state = "FAILED"; c.decisionReason = `NO BUY: spendable balance below $${config.minPositionUsd}`;
        log.scan({ name:c.token.name,symbol:c.token.symbol,priceUsd:snap.priceUsd,score:c.score,confidence:c.dataConfidence,status:"❌ NO BUY",reason:c.decisionReason });
        return;
      }
      const sol = Math.min(spendableSol, usd / solUsd);
      const lamports = BigInt(Math.floor(sol * LAMPORTS_PER_SOL));
      const entryPrice = snap.priceUsd;
      if (!entryPrice || entryPrice <= 0) throw new Error("entry price unavailable");

      if (!config.liveTrading) {
        const walletBefore=this.paperCashUsd;
        this.paperCashUsd=Math.max(0,this.paperCashUsd-usd);
        this.positions.set(c.token.address, {
          mint:c.token.address,name:c.token.name,symbol:c.token.symbol,decimals:c.token.decimals || 6,
          tokenAmountRaw:0n,entrySolLamports:lamports,entryUsd:usd,entryPriceUsd:entryPrice,paperEntryCostUsd:usd,
          openedAt:Date.now(),highPriceUsd:entryPrice,scoreAtBuy:c.score,confidenceAtBuy:c.dataConfidence,paper:true,socialAccountsAtBuy:snap.social?.keyAccounts??[],metaRunnerAtBuy:c.metaRunner,lane
        });
        c.state = "BOUGHT"; this.saveState();
        log.scan({ name:c.token.name,symbol:c.token.symbol,priceUsd:snap.priceUsd,score:c.score,confidence:c.dataConfidence,status:lane==="FLAME"?"🔥🐶 PAPER FLAME BUY":"🧪🐶 PAPER BUY",reason:`${lane} | 💵 Invested:$${usd.toFixed(2)} | 🏦 Cash:$${walletBefore.toFixed(2)}→$${this.paperCashUsd.toFixed(2)} | 📍 Entry:$${entryPrice.toPrecision(6)} | CA:${c.token.address}` });
        this.appendPaperLedger({type:"BUY",at:new Date().toISOString(),mint:c.token.address,name:c.token.name,symbol:c.token.symbol,lane,entryPriceUsd:entryPrice,investedUsd:usd,cashBeforeUsd:walletBefore,cashAfterUsd:this.paperCashUsd,score:c.score,confidence:c.dataConfidence});
        this.logPaperWallet(undefined,true);
        void this.notifier.send({
          title: `🐶 PAPER BUY $${c.token.symbol}`,
          message: `${c.token.name} ($${c.token.symbol}) | $${usd.toFixed(2)} | Score ${c.score}/100 | Entry $${entryPrice.toPrecision(6)} | Contract ${c.token.address}`,
          priority: "default", tags: ["chart_with_upwards_trend"]
        });
        return;
      }

      const result = await this.jupiter.swap(SOL_MINT, c.token.address, lamports);
      const tokenInfo = await this.wallet.tokenBalanceRaw(c.token.address);
      const raw = tokenInfo.amount > 0n ? tokenInfo.amount : result.outRaw;
      const decimals = tokenInfo.decimals || c.token.decimals || 6;
      const actualEntryPrice = snap.priceUsd ?? (usd / (Number(raw) / 10 ** decimals));
      this.positions.set(c.token.address, {
        mint:c.token.address,name:c.token.name,symbol:c.token.symbol,decimals,tokenAmountRaw:raw,
        entrySolLamports:result.inRaw,entryUsd:usd,entryPriceUsd:actualEntryPrice,openedAt:Date.now(),highPriceUsd:actualEntryPrice,
        signature:result.signature,scoreAtBuy:c.score,confidenceAtBuy:c.dataConfidence,paper:false,socialAccountsAtBuy:snap.social?.keyAccounts??[],metaRunnerAtBuy:c.metaRunner,lane
      });
      c.state = "BOUGHT"; this.saveState();
      log.scan({ name:c.token.name,symbol:c.token.symbol,priceUsd:snap.priceUsd,score:c.score,confidence:c.dataConfidence,status:lane==="FLAME"?"🔥 FLAME BOUGHT":"🟢 BOUGHT",reason:`${lane} | $${usd.toFixed(2)} | Contract:${c.token.address} | tx ${result.signature}` });
      void this.notifier.send({
        title: `🐶 BOUGHT $${c.token.symbol}`,
        message: `${c.token.name} ($${c.token.symbol}) | $${usd.toFixed(2)} | Score ${c.score}/100 | Entry $${actualEntryPrice.toPrecision(6)} | Contract ${c.token.address}`,
        priority: "high", tags: ["chart_with_upwards_trend"]
      });
    } catch (e) {
      c.state = "FAILED"; c.decisionReason = `BUY FAILED: ${e instanceof Error ? e.message : String(e)}`;
      log.error(c.entryLane==="FLAME"?`[🔥 FLAME BUY FAILED] ${c.token.name} | Score:${Math.round(c.score)} | Reason:${c.decisionReason}`:`[BUY FAILED] ${c.token.name} | ${c.decisionReason}`);
    } finally { this.busy.delete(c.token.address); }
  }

  /**
   * The chart price is not the exit price on a thin meme coin. This quotes the ENTIRE
   * wallet position through Jupiter and treats that value as the real P/L used by exits.
   */
  private async executableExit(p: Position, dexPrice: number): Promise<ExecutableExit | null> {
    if (p.paper) return null;
    const bal = await this.wallet.tokenBalanceRaw(p.mint);
    const amountRaw = bal.amount > 0n ? bal.amount : p.tokenAmountRaw;
    if (amountRaw <= 0n) return null;

    const [quote, solUsd] = await Promise.all([
      this.jupiter.sellQuoteSol(p.mint, amountRaw),
      this.solPrice.get()
    ]);
    const outUsd = quote.outSol * solUsd;
    const pnlPct = p.entryUsd > 0 ? ((outUsd - p.entryUsd) / p.entryUsd) * 100 : 0;
    const dexImpliedUsd = p.entryUsd * (dexPrice / p.entryPriceUsd);
    const valueRatio = dexImpliedUsd > 0 ? outUsd / dexImpliedUsd : 1;

    p.highExecutablePnlPct = Math.max(p.highExecutablePnlPct ?? pnlPct, pnlPct);
    p.lastExecutablePnlPct = pnlPct;
    p.lastExecutableUsd = outUsd;
    p.lastExecutableQuoteAt = Date.now();

    return { amountRaw, outSol: quote.outSol, outUsd, pnlPct, dexImpliedUsd, valueRatio };
  }

  private rememberExit(p:Position, price:number, pnlPct:number){
    this.resetDailyIfNeeded(); const realizedUsd=p.entryUsd*(pnlPct/100); if(!p.paper)this.realizedToday+=realizedUsd; this.saveState();
    this.closedTracks.push({mint:p.mint,name:p.name,symbol:p.symbol,entryPriceUsd:p.entryPriceUsd,exitPriceUsd:price,exitPnlPct:pnlPct,closedAt:Date.now(),logged:new Set(),socialAccounts:p.socialAccountsAtBuy??[]});
    this.closedTracks=this.closedTracks.filter(x=>Date.now()-x.closedAt<=65*60000);
  }

  private async trackClosedTrades(){
    if(!this.closedTracks.length)return; const due=this.closedTracks.filter(x=>[5,15,30,60].some(m=>Date.now()-x.closedAt>=m*60000&&!x.logged.has(m))); if(!due.length)return;
    const market=await this.dex.batch([...new Set(due.map(x=>x.mint))]);
    for(const x of due){const price=market.get(x.mint)?.priceUsd;if(!price)continue;for(const m of [5,15,30,60]){if(Date.now()-x.closedAt>=m*60000&&!x.logged.has(m)){x.logged.add(m);const fromEntry=((price-x.entryPriceUsd)/x.entryPriceUsd)*100;const afterExit=((price-x.exitPriceUsd)/x.exitPriceUsd)*100;const cls=x.exitPnlPct<0&&afterExit>20?"EARLY EXIT":x.exitPnlPct<0&&afterExit<0?"GOOD STOP":"FOLLOW-UP";if([15,30,60].includes(m)&&x.socialAccounts.length)socialPerformance.record(x.socialAccounts,fromEntry);log.info(`[EXIT REVIEW ${m}m] ${x.name} ($${x.symbol}) | exit P/L ${x.exitPnlPct>=0?"+":""}${x.exitPnlPct.toFixed(1)}% | now vs entry ${fromEntry>=0?"+":""}${fromEntry.toFixed(1)}% | since exit ${afterExit>=0?"+":""}${afterExit.toFixed(1)}% | ${cls}${x.socialAccounts.length?` | Social:${x.socialAccounts.join(",")}`:""}`);}}}
  }

  private async sell(p: Position, reason: string, currentPrice?: number, expected?: ExecutableExit | null) {
    if (this.busy.has(p.mint)) return;
    this.busy.add(p.mint);
    try {
      if (p.paper) {
        this.resetDailyIfNeeded();
        const price = currentPrice ?? p.entryPriceUsd;
        const grossUsd = p.entryUsd * (price / p.entryPriceUsd);
        const costPct=this.paperCostsPct();
        const outUsd = grossUsd * (1-costPct/100);
        const pnlUsd=outUsd-p.entryUsd;
        const pnlPct = p.entryUsd>0 ? (pnlUsd/p.entryUsd)*100 : 0;
        const walletBefore=this.paperCashUsd;
        this.paperCashUsd += outUsd; this.paperRealizedUsd += pnlUsd; this.paperDayRealizedUsd += pnlUsd; this.paperTradeCount++;
        if(pnlUsd>=0)this.paperWins++; else this.paperLosses++;
        this.paperBestPct=Math.max(this.paperBestPct,pnlPct); this.paperWorstPct=Math.min(this.paperWorstPct,pnlPct);
        this.positions.delete(p.mint);
        this.rememberExit(p,price,pnlPct); this.saveState();
        const icon=pnlUsd>=0?"✅💰":"🛑💀";
        log.info(`${icon} PAPER SELL COMPLETE | 🪙 ${p.name} ($${p.symbol}) | ${reason} | 💵 Invested:$${p.entryUsd.toFixed(2)} | 💰 Returned:$${outUsd.toFixed(2)} | ${pnlUsd>=0?"🟢 PROFIT":"🔴 LOSS"}:${pnlUsd>=0?"+":""}$${pnlUsd.toFixed(2)} | ${pnlPct>=0?"🚀":"📉"} ROI:${pnlPct>=0?"+":""}${pnlPct.toFixed(1)}% | 🏦 Cash:$${walletBefore.toFixed(2)}→$${this.paperCashUsd.toFixed(2)} | sim costs:${costPct.toFixed(2)}%`);
        this.appendPaperLedger({type:"SELL",at:new Date().toISOString(),mint:p.mint,name:p.name,symbol:p.symbol,lane:p.lane,entryPriceUsd:p.entryPriceUsd,exitPriceUsd:price,investedUsd:p.entryUsd,returnedUsd:outUsd,pnlUsd,pnlPct,reason,cashBeforeUsd:walletBefore,cashAfterUsd:this.paperCashUsd,simulatedCostsPct:costPct});
        this.logPaperWallet(undefined,true);
        void this.notifier.send({
          title: `💰 PAPER SOLD $${p.symbol}`,
          message: `${p.name} ($${p.symbol}) | ${reason} | Value $${outUsd.toFixed(2)} | P/L ${pnlPct>=0?"+":""}${pnlPct.toFixed(1)}%`,
          priority: "default", tags: [pnlPct >= 0 ? "moneybag" : "warning"]
        });
        return;
      }

      // Re-read the actual wallet amount immediately before execution; never sell a stale stored amount.
      const before = await this.wallet.tokenBalanceRaw(p.mint);
      const amount = before.amount > 0n ? before.amount : (expected?.amountRaw ?? p.tokenAmountRaw);
      if (amount <= 0n) {
        log.warn(`[SELL] ${p.name} ($${p.symbol}) | token balance already zero; removing stale position`);
        this.positions.delete(p.mint); this.saveState();
        return;
      }

      const result = await this.jupiter.swap(p.mint, SOL_MINT, amount);
      const solOut = Number(result.outRaw) / LAMPORTS_PER_SOL;
      const solUsd = await this.solPrice.get();
      const outUsd = solOut * solUsd;
      const pnlPct = ((outUsd - p.entryUsd) / p.entryUsd) * 100;

      // Verify the token actually left the wallet before declaring SOLD.
      const after = await this.wallet.tokenBalanceRaw(p.mint);
      const soldRaw = before.amount > after.amount ? before.amount - after.amount : result.inRaw;
      const soldFraction = before.amount > 0n ? Number(soldRaw * 10_000n / before.amount) / 100 : 100;
      const effectivelyClosed = after.amount === 0n || soldFraction >= 99.5;

      if (effectivelyClosed) { this.positions.delete(p.mint); this.rememberExit(p,currentPrice??p.entryPriceUsd,pnlPct); this.saveState(); }
      else {
        p.tokenAmountRaw = after.amount; this.saveState();
        log.warn(`[SELL] ${p.name} ($${p.symbol}) | ⚠️ PARTIAL EXIT ${soldFraction.toFixed(2)}% | ${reason} | remaining raw ${after.amount.toString()} | tx ${result.signature}`);
      }

      const rugLike = pnlPct <= -config.rugExitPct || (expected && expected.valueRatio < config.minExecutableValueRatio);
      const label = rugLike ? "🚨 RUG/LIQUIDITY EXIT" : "💰 SOLD";
      log.info(`[SELL] ${p.name} ($${p.symbol}) | ${label} | ${reason} | received≈$${outUsd.toFixed(2)} (${solOut.toFixed(6)} SOL) | REAL P/L ${pnlPct>=0?"+":""}${pnlPct.toFixed(1)}% | sold ${soldFraction.toFixed(2)}% | tx ${result.signature}`);
      void this.notifier.send({
        title: `${rugLike ? "🚨 RUG EXIT" : "💰 SOLD"} $${p.symbol}`,
        message: `${p.name} ($${p.symbol}) | ${reason} | Received $${outUsd.toFixed(2)} | REAL P/L ${pnlPct>=0?"+":""}${pnlPct.toFixed(1)}%`,
        priority: "max", tags: [pnlPct >= 0 ? "moneybag" : "warning"]
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Critical: a failed sell NEVER removes the position. It remains live for the next retry.
      log.error(`[SELL] ${p.name} ($${p.symbol}) | ⚠️ SELL FAILED — POSITION RETAINED | ${msg}`);
      void this.notifier.send({
        title: `⚠️ SELL FAILED $${p.symbol}`,
        message: `${p.name} ($${p.symbol}) | Position retained + will retry | ${msg} | Contract ${p.mint}`,
        priority: "max", tags: ["warning"]
      });
    }
    finally { this.busy.delete(p.mint); }
  }

  private logCurrentTrade(p: Position, price: number, index: number, total: number, executable?: ExecutableExit | null) {
    const chartPnl = ((price-p.entryPriceUsd)/p.entryPriceUsd)*100;
    const peakPnl = ((p.highPriceUsd-p.entryPriceUsd)/p.entryPriceUsd)*100;
    const ageSec = Math.floor((Date.now()-p.openedAt)/1000);
    const mm = Math.floor(ageSec/60).toString().padStart(2,"0");
    const ss = (ageSec%60).toString().padStart(2,"0");
    const chartValue = p.entryUsd * (price/p.entryPriceUsd);
    const status = p.paper ? (chartPnl>=0?"👀🟢 PAPER POSITION":"👀🔴 PAPER POSITION") : "🟢 HOLDING";
    const score = p.scoreAtBuy == null ? "?" : `${p.scoreAtBuy}/100`;
    const real = executable
      ? ` | ExitNow:$${executable.outUsd.toFixed(2)} | REAL P/L:${executable.pnlPct>=0?"+":""}${executable.pnlPct.toFixed(1)}% | Exit/Dex:${(executable.valueRatio*100).toFixed(0)}%`
      : "";
    if(p.paper){
      const netValue=chartValue*(1-this.paperCostsPct()/100); const pnlUsd=netValue-p.entryUsd;
      log.info(`👀🐶 PAPER POSITION ${index}/${total} | 🪙 ${p.name} ($${p.symbol}) | 📍 Entry:$${p.entryPriceUsd.toPrecision(6)} | 💲 Current:$${price.toPrecision(6)} | 💵 Invested:$${p.entryUsd.toFixed(2)} | 💰 Value:$${netValue.toFixed(2)} | ${pnlUsd>=0?"🟢":"🔴"} P&L:${pnlUsd>=0?"+":""}$${pnlUsd.toFixed(2)} | ${chartPnl>=0?"🚀":"📉"} ROI:${chartPnl>=0?"+":""}${chartPnl.toFixed(1)}% | 👑 Peak:${peakPnl>=0?"+":""}${peakPnl.toFixed(1)}% | ⏱️ Held:${mm}:${ss} | ${p.lane==="FLAME"?"🔥":"🎯"} Lane:${p.lane??"NORMAL"} | Score:${score} | CA:${p.mint}`);
    } else {
      log.info(`[CURRENT TRADE ${index}/${total}] ${status} | ${p.name} ($${p.symbol}) | Entry:$${p.entryPriceUsd.toPrecision(6)} | Current:$${price.toPrecision(6)} | Position:$${p.entryUsd.toFixed(2)} | ChartValue≈$${chartValue.toFixed(2)} | Chart P/L:${chartPnl>=0?"+":""}${chartPnl.toFixed(1)}%${real} | Peak:${peakPnl>=0?"+":""}${peakPnl.toFixed(1)}% | Held:${mm}:${ss} | Lane:${p.lane??"NORMAL"}${p.basisUnknown?"/RECOVERED":""} | BuyScore:${score} | CA:${p.mint}`);
    }
  }

  async monitorPositions() {
    const now = Date.now();
    await this.reconcileWallet();
    await this.trackClosedTrades();
    const positions = [...this.positions.values()];
    if (!positions.length) {
      if (now-this.lastIdleStatusAt >= config.idlePositionStatusIntervalMs) {
        this.lastIdleStatusAt = now;
        log.info(`[OPEN POSITIONS] 0 | 💤 Waiting for runner`);
        if(!config.liveTrading)this.logPaperWallet(undefined);
      }
      return;
    }

    const shouldLogStatus = now-this.lastStatusAt >= config.positionStatusIntervalMs;
    if (shouldLogStatus) this.lastStatusAt = now;

    const market = await this.dex.batch(positions.map(p=>p.mint));
    if(!config.liveTrading){const prices=new Map<string,number>(); for(const p of positions){const px=market.get(p.mint)?.priceUsd;if(px)prices.set(p.mint,px);} this.logPaperWallet(prices);}
    let index = 0;
    for (const p of positions) {
      index++;
      try {
        const s = market.get(p.mint);
        const price = s?.priceUsd;
        if (!price) continue;
        p.highPriceUsd = Math.max(p.highPriceUsd, price);
        const chartPnl = ((price-p.entryPriceUsd)/p.entryPriceUsd)*100;
        const chartDrawdown = ((price-p.highPriceUsd)/p.highPriceUsd)*100;
        const ageMin = (Date.now()-p.openedAt)/60000;
        const buys=s?.buys1m??s?.buys5m??0, sells=s?.sells1m??s?.sells5m??0;
        const momentumRatio=buys/Math.max(1,sells);
        const momentumPrice=s?.priceChange1mPct??s?.priceChange5mPct??0;
        const momentumStrong=momentumRatio>=config.strongMomentumBuySellRatio && momentumPrice>=config.strongMomentumMinPrice5mPct;
        const isFlame=p.lane==="FLAME";
        const takeProfit=isFlame?config.flameTakeProfitPct:config.takeProfitPct;
        const hardStop=isFlame?config.flameStopLossPct:config.hardStopLossPct;
        const protectArm=isFlame?config.flameProfitProtectArmPct:config.profitProtectArmPct;
        const trail=isFlame?config.flameTrailingStopPct:config.trailingStopPct;

        if (p.paper) {
          if (shouldLogStatus) this.logCurrentTrade(p, price, index, positions.length);
          if (chartPnl >= takeProfit) await this.sell(p, `TAKE PROFIT ${chartPnl.toFixed(1)}%`, price);
          else if (chartPnl <= -hardStop) await this.sell(p, `HARD STOP ${chartPnl.toFixed(1)}%`, price);
          else if (chartPnl <= -config.softStopLossPct && !momentumStrong) await this.sell(p, `MOMENTUM STOP ${chartPnl.toFixed(1)}% | B/S ${momentumRatio.toFixed(2)}x`, price);
          else if (chartPnl >= protectArm && chartDrawdown <= -trail) await this.sell(p, `PROFIT PROTECT ${chartDrawdown.toFixed(1)}% from high`, price);
          else if (ageMin >= config.maxPositionAgeMin) await this.sell(p, `TIME EXIT ${ageMin.toFixed(1)}m`, price);
          continue;
        }

        // LIVE positions: Jupiter's full-position sell quote is the source of truth for exit P/L.
        const previousExecutableUsd = p.lastExecutableUsd;
        const executable = await this.executableExit(p, price);
        if (!executable) {
          if (shouldLogStatus) this.logCurrentTrade(p, price, index, positions.length, null);
          continue;
        }

        const peakExecutable = p.highExecutablePnlPct ?? executable.pnlPct;
        const executableDrawdown = peakExecutable - executable.pnlPct;
        const quoteDropPct = previousExecutableUsd && previousExecutableUsd > 0
          ? ((previousExecutableUsd - executable.outUsd) / previousExecutableUsd) * 100
          : 0;
        if (shouldLogStatus) this.logCurrentTrade(p, price, index, positions.length, executable);

        // 1) The route has detached from the chart: treat this as a rug/liquidity emergency.
        if (executable.valueRatio < config.minExecutableValueRatio) {
          await this.sell(p, `LIQUIDITY COLLAPSE | executable ${(executable.valueRatio*100).toFixed(0)}% of chart value | chart ${chartPnl>=0?"+":""}${chartPnl.toFixed(1)}% vs REAL ${executable.pnlPct>=0?"+":""}${executable.pnlPct.toFixed(1)}%`, price, executable);
        }
        // 2) A very fast drop in actual sellable value gets out before the normal stop catches up.
        else if (quoteDropPct >= config.executableQuoteDropPct) {
          await this.sell(p, `FAST EXIT | executable value dropped ${quoteDropPct.toFixed(1)}% since last poll | REAL ${executable.pnlPct>=0?"+":""}${executable.pnlPct.toFixed(1)}%`, price, executable);
        }
        // 3) Take profit earlier, using what Jupiter can actually return—not the displayed token price.
        else if (executable.pnlPct >= takeProfit) {
          await this.sell(p, `TAKE PROFIT REAL +${executable.pnlPct.toFixed(1)}%`, price, executable);
        }
        // 4) Cut losers earlier on executable value.
        else if (executable.pnlPct <= -hardStop) {
          const rug = executable.pnlPct <= -config.rugExitPct ? "RUG/LIQUIDITY " : "";
          await this.sell(p, `${rug}HARD STOP REAL ${executable.pnlPct.toFixed(1)}%`, price, executable);
        }
        else if (executable.pnlPct <= -config.softStopLossPct && !momentumStrong) {
          await this.sell(p, `MOMENTUM STOP REAL ${executable.pnlPct.toFixed(1)}% | B/S ${momentumRatio.toFixed(2)}x | price momentum ${momentumPrice.toFixed(1)}%`, price, executable);
        }
        // 5) Once +15% real profit exists, allow only an 8-point giveback from the executable peak.
        else if (peakExecutable >= protectArm && executableDrawdown >= trail) {
          await this.sell(p, `PROFIT PROTECT | REAL peak +${peakExecutable.toFixed(1)}% → +${executable.pnlPct.toFixed(1)}%`, price, executable);
        }
        else if (ageMin >= config.maxPositionAgeMin) {
          await this.sell(p, `TIME EXIT ${ageMin.toFixed(1)}m | REAL ${executable.pnlPct>=0?"+":""}${executable.pnlPct.toFixed(1)}%`, price, executable);
        }
      } catch (e) { log.warn(`[POSITION ERROR] ${p.name}: ${e instanceof Error ? e.message : String(e)}`); }
    }
  }
}
