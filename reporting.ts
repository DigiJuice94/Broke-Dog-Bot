import { config } from "./config.ts";
import { log } from "./log.ts";
import { Trader } from "./trader.ts";
import { dogBrain } from "./dogBrain.ts";

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

  private paperLines(s:any,brain:any,windowLabel:string){
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
    if(s.openPositions.length){lines.push("","👀 PAPER OPEN POSITIONS");for(const p of s.openPositions)lines.push(`• ${p.name} ($${p.symbol}) | $${p.entryUsd.toFixed(2)} | ${pct(p.pnlPct)} | ${p.lane}`);}
    lines.push("",...this.brainLines("PAPER",brain));
    return lines;
  }

  private liveLines(s:any,brain:any,windowLabel:string){
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

  private combinedFormat(paper:any,live:any,paperBrain:any,liveBrain:any,windowLabel:string){
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
      await this.send(`🐶 BROKE DOG — PAPER + LIVE — ${this.localStamp()}`,this.combinedFormat(paper,live,paperBrain,liveBrain,"hour"));
      log.info("📧🐶 Combined dual-wallet hourly email sent | PAPER + LIVE kept separate");
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
      await this.send(`🐶 BROKE DOG DAILY — PAPER + LIVE — ${d}`,this.combinedFormat(paper,live,paperBrain,liveBrain,"day"));
      log.info("📧🐶 Combined dual-wallet daily email sent");
    }catch(e){log.warn(`[EMAIL REPORT] daily send failed: ${e instanceof Error?e.message:String(e)}`);}
  }
}
