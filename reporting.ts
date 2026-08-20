import { config } from "./config.ts";
import { log } from "./log.ts";
import { Trader } from "./trader.ts";
import { dogBrain } from "./dogBrain.ts";
import { aiBrain, AiBrainReview } from "./aiBrain.ts";

const money=(n:number)=>`${n>=0?"+":"-"}$${Math.abs(n).toFixed(2)}`;
const pct=(n:number)=>`${n>=0?"+":""}${n.toFixed(1)}%`;
const esc=(s:string)=>s.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));

export class EmailReporter {
  private lastDaily="";
  constructor(private trader:Trader){}
  enabled(){return config.emailReportsEnabled&&!!config.resendApiKey&&!!config.reportEmail;}
  private localStamp(){try{return new Intl.DateTimeFormat("en-US",{timeZone:config.reportTimezone,dateStyle:"medium",timeStyle:"short"}).format(new Date());}catch{return new Date().toLocaleString();}}
  private async send(subject:string,text:string){
    if(!this.enabled())return;
    const html=`<div style="font-family:Arial,sans-serif;white-space:pre-wrap;line-height:1.5">${esc(text)}</div>`;
    const r=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${config.resendApiKey}`,"Content-Type":"application/json"},body:JSON.stringify({from:config.reportFrom,to:[config.reportEmail],subject,text,html})});
    if(!r.ok)throw new Error(`Resend ${r.status}: ${(await r.text()).slice(0,300)}`);
  }

  private brainLines(label:string,brain:any){
    const lines=[
      `🧠🐶 ${label} DOG BRAIN`,
      `👀 Observations: ${brain.observations} | ✅ Resolved: ${brain.resolved} | 🛒 Bought: ${brain.bought} | 🚫 Rejected: ${brain.rejected}`,
      `🏆 Brain trades: ${brain.wins}W / ${brain.losses}L | 🤦 Missed runners: ${brain.missedRunners} | 🛡️ Avoided dumps/rugs: ${brain.avoidedDumps}`,
      `📈 Strongest positive predictor: ${brain.strongestPositive}`,
      `⚠️ Strongest warning signal: ${brain.strongestWarning}`,
      `🎯 Most learned overall: ${brain.strongest}`
    ];
    if(brain.learnedSummary?.length){
      lines.push("","📚 WHAT DOG BRAIN LEARNED");
      for(const x of brain.learnedSummary)lines.push(`• ${x}`);
    }
    if(brain.improvements?.length){
      lines.push("","🔧 HOW DOG BRAIN THINKS WE CAN IMPROVE");
      for(const x of brain.improvements)lines.push(`• ${x}`);
    }
    if(brain.preciseRecommendations?.length){
      lines.push("","🎯🔧 PRECISE CHANGES DOG BRAIN WANTS THE CREATOR TO TEST");
      lines.push(`📊 Recommendation confidence: ${brain.recommendationConfidence??"LOW"} | Resolved sample size: ${brain.resolvedSampleSize??brain.resolved??0}`);
      for(const x of brain.preciseRecommendations)lines.push(`• ${x}`);
      lines.push("⚠️ These are test recommendations only. Dog Brain does NOT automatically rewrite these strategy settings.");
    }
    if(brain.moreDataNeeded?.length){
      lines.push("","🔬🐶 WHAT DOG BRAIN WANTS MORE DATA ON");
      for(const x of brain.moreDataNeeded)lines.push(`• ${x}`);
    }
    if(brain.selfImprovementRequests?.length){
      lines.push("","🛠️🐶 WHAT I WANT MY CREATOR TO IMPROVE ABOUT ME");
      lines.push("These are system/code/data improvements I want — separate from trading-strategy parameter changes.");
      for(const x of brain.selfImprovementRequests)lines.push(`• ${x}`);
    }
    if(brain.recentLessons?.length){
      lines.push("","🧪 RECENT LEARNING EXAMPLES");
      for(const x of brain.recentLessons)lines.push(`• ${x}`);
    }
    return lines;
  }

  private forensicLines(label:string,s:any){
    if(!config.tradeForensicsEnabled)return [];
    const trades=[...(s.closedTrades??[])].slice(-config.tradeForensicsMaxEmailTrades);
    const lines=["","━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",`🔬📊 ${label} TRADE FORENSICS — WHY DID WE TAKE THESE TRADES?`,`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`];
    if(!trades.length){lines.push("No trades closed in this report window. Entry snapshots will appear here after each trade closes.");return lines;}
    const n=(v:any,d=1)=>Number.isFinite(Number(v))?Number(v).toFixed(d):"N/A";
    const sign=(v:any)=>Number(v)>=0?"+":"";
    for(const [i,t] of trades.entries()){
      const a=t.analysis??{},m=a.microCycle??{};
      lines.push("",`#${i+1} ${Number(t.pnlPct)>=0?"✅":"❌"} ${t.name} ($${t.symbol}) | ${t.lane??"NORMAL"} | P&L ${pct(Number(t.pnlPct??0))}`);
      lines.push(`CA: ${t.mint??"N/A"}`);
      lines.push(`💵 Invested $${n(t.investedUsd,2)} | Entry $${n(t.entryPriceUsd,8)} → Exit $${n(t.exitPriceUsd,8)} | Returned ${t.returnedUsd==null?"N/A":`$${n(t.returnedUsd,2)}`}`);
      lines.push(`⏱️ Held ${Math.floor(Number(t.heldSeconds??0)/60)}m ${Math.round(Number(t.heldSeconds??0)%60)}s | Exit: ${t.reason??"N/A"} | 👑 Peak ${sign(t.peakPnlPct)}${n(t.peakPnlPct)}% | ↩️ Peak giveback ${n(t.peakGivebackPct)}%`);
      lines.push(`🎯 Entry scores — Dog ${n(a.score,0)}/100 | Quality ${n(a.qualityScore,0)} | Runner ${n(a.runnerScore,0)} | Confidence ${n(a.confidence,0)}% | Safety ${n(a.safetyScore,0)} | Safety data ${n(a.safetyCompleteness,0)}% | Breadth ${n(a.demandBreadthScore,0)} | Social ${n(a.socialScore,0)}`);
      lines.push(`🐕 Micro-cycle — ${m.state??"N/A"} ${n(m.score,0)}/100 | Runner probability ${n(m.runnerProbability,0)} | Late-entry ${n(m.lateEntryRisk,0)} | Exhaustion ${n(m.exhaustionRisk,0)} | Adj ${sign(m.adjustment)}${n(m.adjustment)}`);
      lines.push(`⚡ Acceleration — Score ${sign(m.scoreVelocity)}${n(m.scoreVelocity)}/min | Score accel ${sign(m.scoreAcceleration)}${n(m.scoreAcceleration)}/min² | Buyers ${sign(m.buyerAccelerationPct)}${n(m.buyerAccelerationPct)}% | Volume ${sign(m.volumeAccelerationPct)}${n(m.volumeAccelerationPct)}% | Price velocity ${sign(m.priceVelocityPct)}${n(m.priceVelocityPct)}%`);
      lines.push(`💸 Flow — B/S ${n(m.buySellRatio,2)}x | Buy$/Sell$ ${n(m.moneyFlowRatio,2)}x | Structure break ${m.structureBreak?"YES":"no"} | Higher low ${m.higherLow?"YES":"no"}`);
      lines.push(`📊 Market — Liq $${n(a.liquidityUsd,0)} | MC $${n(a.marketCapUsd,0)} | Vol1m $${n(a.volume1mUsd,0)} | Vol5m $${n(a.volume5mUsd,0)} | Buys/Sells ${n(a.buys1m,0)}/${n(a.sells1m,0)} | Unique wallets ${n(a.uniqueWallet1m,0)} | Age ${n(a.tokenAgeMin)}m`);
      lines.push(`🛡️ Risk — Bundle ${a.bundleRisk??"unknown"} | Holder ${a.holderRisk??"unknown"} | Dev ${a.devRisk??"unknown"} | Top1 ${n(a.top1Pct)}% | Top5 ${n(a.top5Pct)}% | Top10 ${n(a.top10Pct)}% | Linked ${n(a.linkedSupplyPct)}%`);
      lines.push(`📣 Social/meta — ${a.metaRunner?"META RUNNER | ":""}accounts ${(a.socialAccounts??[]).join(",")||"none"} | meta ${(a.dominantMeta??[]).slice(0,3).join("/")||"none"} | smart-money ${n(a.smartMoneyScore,0)}`);
      lines.push(`📡 Sources — ${(a.sources??[]).join(", ")||"N/A"} | Route quality ${n(a.routeQuality,0)} | Buy route ${a.buyRoute?"Y":"N"} / Sell route ${a.sellRoute?"Y":"N"}`);
      if(a.thesis){lines.push(`🐶 Thesis — ${a.thesis.decision} ${n(a.thesis.confidence,0)}% | Intel ${a.thesis.intelligenceMode??"N/A"} ${n(a.thesis.dataCoverage,0)}% coverage | Absorption ${n(a.thesis.supply?.absorptionScore,0)} | Supply pressure ${n(a.thesis.supply?.supplyPressure,0)} | Paid:${a.thesis.supply?.paidAttention?"Y":"N"} Organic:${a.thesis.supply?.organicAttention?"Y":"N"}`);lines.push(`🎯 Trigger — ${(a.thesis.entryTriggers??[]).slice(0,2).join(" | ")||"N/A"}`);lines.push(`🛑 Invalidation — ${(a.thesis.invalidations??[]).slice(0,2).join(" | ")||"N/A"}`);}
      if(m.reasons?.length)lines.push(`🧠 Signal reasons — ${m.reasons.join(" | ")}`);
    }
    lines.push("","🧪 ANALYSIS GOAL: compare winners vs losers on entry timing, acceleration, structure, flow, risk, peak giveback and exit reason. Dog Brain keeps learning from the same persistent history; this section does not reset prior memory.");
    return lines;
  }

  private aiLines(label:string,review?:AiBrainReview){
    if(!review?.enabled)return [`🤖🧠 ${label} AI BRAIN: OFF — add OPENROUTER_API_KEY to enable the free external analyst.`];
    if(!review.ok)return [review.text];
    return [`🤖🧠 ${label} AI BRAIN PROFIT REVIEW — ${review.model??config.aiBrainModel}`,review.text,"🔒 ADVISOR ONLY — AI Brain can recommend tests but cannot place trades, alter strategy settings, or rewrite bot code."];
  }

  private paperLines(s:any,brain:any,windowLabel:string,ai?:AiBrainReview){
    const lines=[
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      "🧪💰 PAPER WALLET",
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      `💵 Starting balance: $${config.paperStartBalanceUsd.toFixed(2)}`,
      `💵 Equity: $${s.equityUsd.toFixed(2)} | 🏦 Cash: $${s.cashUsd.toFixed(2)} | 📈 Open value: $${s.openValueUsd.toFixed(2)}`,
      `${s.totalPnlUsd>=0?"🟢":"🔴"} Total P&L: ${money(s.totalPnlUsd)} (${pct(s.totalReturnPct)})`,
      `✅ Realized: ${money(s.realizedUsd)} | 👀 Unrealized: ${money(s.unrealizedUsd)}`,
      `📅 Today P&L: ${money(s.todayPnlUsd??0)}`,
      `🏆 Wins: ${s.lifetimeWins??0} | 💀 Losses: ${s.lifetimeLosses??0} | 🎯 Win Rate: ${(s.lifetimeWinRatePct??0).toFixed(1)}%`,
      `🔥 Best Trade: ${s.bestTradePct==null?"N/A":pct(s.bestTradePct)} | 🧊 Worst Trade: ${s.worstTradePct==null?"N/A":pct(s.worstTradePct)}`,
      `⏱️ LAST ${windowLabel.toUpperCase()}: ${s.wins} wins / ${s.losses} losses | Closed: ${s.closedTrades.length}`,
      `📥 Paper buys: ${s.buys.length} | 📤 Paper sells: ${s.sells.length}`
    ];
    if(s.closedTrades.length){lines.push("","📈 PAPER CLOSED TRADES");for(const t of s.closedTrades.slice(-10))lines.push(`• ${t.name} ($${t.symbol}) ${pct(t.pnlPct)} — ${t.reason??"paper exit"}`);}
    if(s.openPositions.length){lines.push("","👀 PAPER OPEN POSITIONS");for(const p of s.openPositions)lines.push(`• ${p.name} ($${p.symbol}) | $${p.entryUsd.toFixed(2)} | ${pct(p.pnlPct)} | ${p.lane}${p.entryAnalysis?.microCycle?` | 🐕 ${p.entryAnalysis.microCycle.state} ${Math.round(p.entryAnalysis.microCycle.score)} RP:${Math.round(p.entryAnalysis.microCycle.runnerProbability)}`:""}`);}
    lines.push(...this.forensicLines("PAPER",s));
    lines.push("",...this.brainLines("PAPER",brain));
    return lines;
  }

  private liveLines(s:any,brain:any,windowLabel:string,ai?:AiBrainReview){
    const lines=[
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      "🔴💰 LIVE WALLET",
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      `💰 Wallet: ${s.solBalance.toFixed(5)} SOL ≈ $${s.walletSolUsd.toFixed(2)}`,
      `📊 Realized today: ${money(s.realizedTodayUsd)} | 👀 Open live positions: ${s.openPositions.length}`,
      `🏆 Last ${windowLabel}: ${s.wins} wins / ${s.losses} losses | Closed: ${s.closedTrades.length}`,
      `📥 Live buys: ${s.buys.length} | 📤 Live sells: ${s.sells.length}`
    ];
    if(!config.liveTrading)lines.push("🧪 LIVE TRADING OFF — wallet balance/history is shown for reference only; no new live buys are being placed.");
    if(s.closedTrades.length){lines.push("","📈 LIVE CLOSED TRADES");for(const t of s.closedTrades.slice(-10))lines.push(`• ${t.name} ($${t.symbol}) ${pct(t.pnlPct)} — ${t.reason??"live exit"}`);}
    if(s.openPositions.length){lines.push("","👀 LIVE OPEN POSITIONS");for(const p of s.openPositions)lines.push(`• ${p.name} ($${p.symbol}) | $${p.entryUsd.toFixed(2)} | ${pct(p.pnlPct)} | ${p.lane}`);}
    lines.push(...this.forensicLines("LIVE",s));
    lines.push("",...this.brainLines("LIVE",brain));
    return lines;
  }

  private suggestedTweet(paper:any,paperBrain:any,windowLabel:string){
    const closed=Number(paper?.closedTrades?.length??0);
    const wins=Number(paper?.wins??0),losses=Number(paper?.losses??0);
    const pnl=Number(paper?.totalPnlUsd??0);
    const ret=Number(paper?.totalReturnPct??0);
    const learned=paperBrain?.learnedSummary?.[0]??"Still collecting data and learning what separates runners from traps.";
    const clean=String(learned).replace(/\s+/g," ").replace(/[•]/g,"").trim();
    const base=`🐶 Dog Brain ${windowLabel}ly report: paper wallet ${pnl>=0?"+":"-"}$${Math.abs(pnl).toFixed(2)} (${ret>=0?"+":""}${ret.toFixed(1)}%). ${closed} trades closed this ${windowLabel}: ${wins}W/${losses}L. ${clean} Still paper trading. Still learning. 🧠📈`;
    return base.length<=280?base:base.slice(0,277).trimEnd()+"…";
  }

  private combinedFormat(paper:any,live:any,paperBrain:any,liveBrain:any,windowLabel:string,combinedAi?:AiBrainReview){
    return [
      `🐶 BROKE DOG DUAL-WALLET REPORT — ${this.localStamp()}`,
      `⏱️ Window: ${windowLabel}`,
      `🤖 Active trading mode: ${config.liveTrading?"🔴 LIVE":"🧪 PAPER"}`,
      "",
      ...this.paperLines(paper,paperBrain,windowLabel),
      "",
      ...this.liveLines(live,liveBrain,windowLabel),
      "",
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      "🧠🐶 OVERALL DOG BRAIN TAKEAWAY",
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      config.liveTrading
        ? "Dog Brain is currently learning from LIVE decisions. Paper history stays separate above."
        : "Dog Brain is currently learning from PAPER decisions. Live wallet/history stays separate above.",
      "Paper and live trades are never combined when calculating wallet P&L, trade counts, or Brain outcomes.",
      "",
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      "🤖💰 AI BRAIN — PROFIT COACH",
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      ...this.aiLines("COMBINED",combinedAi),
      "",
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      "🐦🐶 DOG BRAIN'S SUGGESTED TWEET",
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      this.suggestedTweet(paper,paperBrain,windowLabel),
      "🔒 DRAFT ONLY — never auto-posted; creator approval required."
    ].join("\n");
  }

  async sendHourly(){
    if(!this.enabled())return;
    try{
      const [paper,live]=await Promise.all([
        this.trader.reportSnapshot("PAPER",config.reportIntervalMs),
        this.trader.reportSnapshot("LIVE",config.reportIntervalMs)
      ]);
      const paperBrain=dogBrain.reportSnapshot("PAPER",config.reportIntervalMs);
      const liveBrain=dogBrain.reportSnapshot("LIVE",config.reportIntervalMs);
      const combinedAi=await aiBrain.reviewCombined(paper,live,paperBrain,liveBrain,"2-hour");
      await this.send(`🐶 BROKE DOG — 2-HOUR PROFIT REPORT — ${this.localStamp()}`,this.combinedFormat(paper,live,paperBrain,liveBrain,"2 hours",combinedAi));
      log.info("📧🐶 Combined 2-hour profit email sent | one AI call | PAPER + LIVE kept separate");
    }catch(e){log.warn(`[EMAIL REPORT] hourly send failed: ${e instanceof Error?e.message:String(e)}`);}
  }

  async maybeDaily(){
    if(!this.enabled()||!config.dailyEmailReport)return;
    const d=new Date().toLocaleDateString("en-CA",{timeZone:config.reportTimezone}); if(d===this.lastDaily)return;
    const h=Number(new Intl.DateTimeFormat("en-US",{timeZone:config.reportTimezone,hour:"2-digit",hour12:false}).format(new Date())); if(h!==23)return;
    this.lastDaily=d;
    try{
      const [paper,live]=await Promise.all([
        this.trader.reportSnapshot("PAPER",24*3600000),
        this.trader.reportSnapshot("LIVE",24*3600000)
      ]);
      const paperBrain=dogBrain.reportSnapshot("PAPER",24*3600000);
      const liveBrain=dogBrain.reportSnapshot("LIVE",24*3600000);
      const dailyAi:AiBrainReview={enabled:aiBrain.enabled(),ok:false,text:"🤖 Daily AI call skipped to preserve the free OpenRouter request budget. The 2-hour AI profit reviews remain active; Dog Brain daily data is shown above."};
      await this.send(`🐶 BROKE DOG DAILY — PAPER + LIVE — ${d}`,this.combinedFormat(paper,live,paperBrain,liveBrain,"day",dailyAi));
      log.info("📧🐶 Combined dual-wallet daily email sent");
    }catch(e){log.warn(`[EMAIL REPORT] daily send failed: ${e instanceof Error?e.message:String(e)}`);}
  }
}
