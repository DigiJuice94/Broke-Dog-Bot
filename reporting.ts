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
    const html=`<div style="font-family:Arial,sans-serif;white-space:pre-wrap;line-height:1.45">${esc(text)}</div>`;
    const r=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${config.resendApiKey}`,"Content-Type":"application/json"},body:JSON.stringify({from:config.reportFrom,to:[config.reportEmail],subject,text,html})});
    if(!r.ok)throw new Error(`Resend ${r.status}: ${(await r.text()).slice(0,300)}`);
  }
  private format(mode:"PAPER"|"LIVE",s:any,brain:any,windowLabel:string){
    const lines=[`🐶 BROKE DOG ${mode} REPORT — ${this.localStamp()}`,`Window: ${windowLabel}`,""];
    if(mode==="PAPER") lines.push(`💰 Equity: $${s.equityUsd.toFixed(2)} | Cash: $${s.cashUsd.toFixed(2)} | Open: $${s.openValueUsd.toFixed(2)}`,`📊 Total P&L: ${money(s.totalPnlUsd)} (${pct(s.totalReturnPct)}) | Realized: ${money(s.realizedUsd)} | Unrealized: ${money(s.unrealizedUsd)}`);
    else lines.push(`💰 Live wallet SOL: ${s.solBalance.toFixed(5)} SOL ≈ $${s.walletSolUsd.toFixed(2)}`,`📊 Realized today: ${money(s.realizedTodayUsd)} | Open positions: ${s.openPositions.length}`);
    lines.push(`🏆 Last ${windowLabel}: ${s.wins} wins / ${s.losses} losses | Closed: ${s.closedTrades.length}`,`📥 Buys: ${s.buys.length} | 📤 Sells: ${s.sells.length}`,"");
    if(s.closedTrades.length){lines.push("📈 CLOSED TRADES");for(const t of s.closedTrades.slice(-10))lines.push(`• ${t.name} ($${t.symbol}) ${pct(t.pnlPct)} — ${t.reason??"exit"}`);lines.push("");}
    if(s.openPositions.length){lines.push("👀 OPEN POSITIONS");for(const p of s.openPositions)lines.push(`• ${p.name} ($${p.symbol}) | $${p.entryUsd.toFixed(2)} | ${pct(p.pnlPct)} | ${p.lane}`);lines.push("");}
    lines.push("🧠 DOG BRAIN",`Observations: ${brain.observations} | Bought: ${brain.bought} | Rejected: ${brain.rejected} | Resolved: ${brain.resolved}`,`Missed runners: ${brain.missedRunners} | Avoided dumps/rugs: ${brain.avoidedDumps}`,`Strongest learned signal: ${brain.strongest} | Weakest: ${brain.weakest}`);
    if(brain.recentLessons.length){for(const x of brain.recentLessons)lines.push(`• ${x}`);}
    lines.push("",`🤖 Bot mode now: ${config.liveTrading?"LIVE":"PAPER"}`);
    if((mode==="LIVE")!==config.liveTrading)lines.push(`ℹ️ ${mode} trading is not active in this Railway instance; this report shows the separate ${mode.toLowerCase()} wallet/history available to this process.`);
    return lines.join("\n");
  }
  async sendHourly(){
    if(!this.enabled())return;
    try{
      if(config.hourlyPaperReport){const s=await this.trader.reportSnapshot("PAPER",config.reportIntervalMs);const b=dogBrain.reportSnapshot("PAPER",config.reportIntervalMs);await this.send(`🐶 PAPER DOG REPORT — ${this.localStamp()}`,this.format("PAPER",s,b,"hour"));}
      if(config.hourlyLiveReport){const s=await this.trader.reportSnapshot("LIVE",config.reportIntervalMs);const b=dogBrain.reportSnapshot("LIVE",config.reportIntervalMs);await this.send(`💰 LIVE DOG REPORT — ${this.localStamp()}`,this.format("LIVE",s,b,"hour"));}
      log.info(`📧🐶 Hourly email report sent | paper:${config.hourlyPaperReport?"ON":"OFF"} live:${config.hourlyLiveReport?"ON":"OFF"}`);
    }catch(e){log.warn(`[EMAIL REPORT] hourly send failed: ${e instanceof Error?e.message:String(e)}`);}
  }
  async maybeDaily(){
    if(!this.enabled()||!config.dailyEmailReport)return; const d=new Date().toLocaleDateString("en-CA",{timeZone:config.reportTimezone}); if(d===this.lastDaily)return;
    const h=Number(new Intl.DateTimeFormat("en-US",{timeZone:config.reportTimezone,hour:"2-digit",hour12:false}).format(new Date())); if(h!==23)return; this.lastDaily=d;
    try{for(const mode of ["PAPER","LIVE"] as const){const s=await this.trader.reportSnapshot(mode,24*3600000),b=dogBrain.reportSnapshot(mode,24*3600000);await this.send(`${mode==="PAPER"?"🐶":"💰"} ${mode} DOG DAILY — ${d}`,this.format(mode,s,b,"day"));}log.info("📧🐶 Separate paper/live daily reports sent");}catch(e){log.warn(`[EMAIL REPORT] daily send failed: ${e instanceof Error?e.message:String(e)}`);}
  }
}
