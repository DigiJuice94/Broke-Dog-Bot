import { config } from "./config.ts";
import { log } from "./log.ts";
import { readJsonRecovered, writeJsonAtomic } from "./persistence.ts";
import { Candidate } from "./types.ts";

export type AiBrainReview={ enabled:boolean; ok:boolean; model?:string; text:string; };
export type AiCoinReview={ enabled:boolean; ok:boolean; usedCall:boolean; verdict:"BUY"|"PASS"|"NO_OPINION"; confidence:number; reason:string; model?:string; budgetReason?:string; };
type Usage={day:string; total:number; reports:number; coins:number};

const compact=(value:any)=>JSON.stringify(value,(k,v)=>{
  if(k==="recentLessons"&&Array.isArray(v))return v.slice(-8);
  if(Array.isArray(v)&&v.length>12)return v.slice(-12);
  if(v instanceof Set)return [...v];
  return v;
});

class AiBrain {
  private usage:Usage=this.loadUsage();
  private coinCache=new Map<string,{at:number;review:AiCoinReview}>();

  private day(){return new Date().toISOString().slice(0,10);}
  private loadUsage():Usage{
    const d=this.day();
    const raw=readJsonRecovered<Usage>(config.aiUsageFile);
    if(raw?.day===d)return {day:d,total:Number(raw.total||0),reports:Number(raw.reports||0),coins:Number(raw.coins||0)};
    return {day:d,total:0,reports:0,coins:0};
  }
  private resetIfNeeded(){if(this.usage.day!==this.day()){this.usage={day:this.day(),total:0,reports:0,coins:0};this.saveUsage();}}
  private saveUsage(){try{writeJsonAtomic(config.aiUsageFile,this.usage);}catch(e){log.warn(`🤖 AI usage counter save failed: ${e instanceof Error?e.message:String(e)}`);}}
  private canSpend(kind:"report"|"coin"){
    this.resetIfNeeded();
    if(this.usage.total>=config.aiTotalMaxPerDay)return {ok:false,why:`daily total AI budget ${this.usage.total}/${config.aiTotalMaxPerDay} reached`};
    if(kind==="coin"&&this.usage.coins>=config.aiCoinMaxPerDay)return {ok:false,why:`daily coin-review budget ${this.usage.coins}/${config.aiCoinMaxPerDay} reached`};
    return {ok:true,why:""};
  }
  private spend(kind:"report"|"coin"){this.resetIfNeeded();this.usage.total++;if(kind==="report")this.usage.reports++;else this.usage.coins++;this.saveUsage();}

  enabled(){return config.aiBrainEnabled&&!!config.openRouterApiKey;}
  usageText(){this.resetIfNeeded();return `${this.usage.total}/${config.aiTotalMaxPerDay} total | ${this.usage.coins}/${config.aiCoinMaxPerDay} coin reviews | ${this.usage.reports} reports`; }
  startupText(){
    if(!config.aiBrainEnabled)return "AI Brain OFF (AI_BRAIN_ENABLED=false)";
    if(!config.openRouterApiKey)return "AI Brain READY but no OPENROUTER_API_KEY — Dog Bot continues normally without AI";
    return `AI Brain ON | ${config.aiBrainModel} | near-buy second opinion ${config.aiCoinMinScore}-${config.aiCoinMaxScore} | fallback trading ON | budget ${this.usageText()}`;
  }

  shouldReviewCoin(c:Candidate){return config.aiCoinReviewEnabled&&c.score>=config.aiCoinMinScore&&c.score<=config.aiCoinMaxScore;}

  async reviewCoin(c:Candidate):Promise<AiCoinReview>{
    if(!this.enabled()||!config.aiCoinReviewEnabled)return {enabled:false,ok:false,usedCall:false,verdict:"NO_OPINION",confidence:0,reason:"AI coin review disabled"};
    if(!this.shouldReviewCoin(c))return {enabled:true,ok:false,usedCall:false,verdict:"NO_OPINION",confidence:0,reason:`score ${Math.round(c.score)} outside AI review window ${config.aiCoinMinScore}-${config.aiCoinMaxScore}`};
    const cached=this.coinCache.get(c.token.address);
    if(cached&&Date.now()-cached.at<config.aiCoinCacheMs)return {...cached.review,usedCall:false,reason:`${cached.review.reason} (cached)`};
    const budget=this.canSpend("coin");
    if(!budget.ok)return {enabled:true,ok:false,usedCall:false,verdict:"NO_OPINION",confidence:0,reason:`AI unavailable: ${budget.why}; use normal Dog Bot rules`,budgetReason:budget.why};

    const snap=c.snapshots.at(-1);
    if(!snap)return {enabled:true,ok:false,usedCall:false,verdict:"NO_OPINION",confidence:0,reason:"No snapshot available; use normal Dog Bot rules"};
    const payload={
      token:{name:c.token.name,symbol:c.token.symbol,address:c.token.address,ageMin:(Date.now()-(c.token.listedAt??c.firstSeenAt))/60000},
      scores:{overall:c.score,runner:c.runnerScore,quality:c.qualityScore,dataConfidence:c.dataConfidence,market:c.marketScore,social:c.socialScore,safety:c.safetyScore},
      signals:{sources:[...c.sources],priceUsd:snap.priceUsd,liquidityUsd:snap.liquidityUsd,marketCapUsd:snap.marketCapUsd,volume1mUsd:snap.volume1mUsd,volume5mUsd:snap.volume5mUsd,buys1m:snap.buys1m,sells1m:snap.sells1m,buys5m:snap.buys5m,sells5m:snap.sells5m,uniqueWallet1m:snap.uniqueWallet1m,priceChange1mPct:snap.priceChange1mPct,priceChange5mPct:snap.priceChange5mPct,bundleRisk:snap.bundleRisk,bundleStatus:snap.bundleStatus,routeQuality:snap.routeQuality,buyRoute:snap.buyRoute,sellRoute:snap.sellRoute,top10HolderPct:snap.onChainRisk?.top10Pct??snap.top10HolderPct,onChainRisk:snap.onChainRisk,social:snap.social,smartMoney:snap.smartMoney,metaRunner:c.metaRunner},
      rules:{normalBuyScore:config.buyScore,reviewWindow:[config.aiCoinMinScore,config.aiCoinMaxScore],hardSafetyAlreadyPassed:true}
    };
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),config.aiBrainTimeoutMs);
    try{
      this.spend("coin");
      const system=`You are the real-time second-opinion analyst for Broke Dog Bot, a Solana memecoin bot. A deterministic safety gate has already passed. Evaluate ONLY whether this near-threshold candidate has enough evidence to justify entry. Return strict JSON only: {"verdict":"BUY"|"PASS"|"NO_OPINION","confidence":0-100,"reason":"one concise evidence-based sentence"}. Never override a hard safety rule. Penalize weak data, fake momentum, poor buy/sell balance, concentrated/bundled risk, bad route quality, thin liquidity relative to intended trade, late entries, and conflicting signals. Reward accelerating organic buying, multiple independent sources, strong unique-wallet participation, favorable buy/sell pressure, healthy holder structure, and coherent momentum. If evidence is ambiguous use NO_OPINION. Do not promise profit.`;
      const r=await fetch("https://openrouter.ai/api/v1/chat/completions",{method:"POST",signal:controller.signal,headers:{Authorization:`Bearer ${config.openRouterApiKey}`,"Content-Type":"application/json","HTTP-Referer":"https://railway.app","X-Title":"Broke Dog Bot AI Brain"},body:JSON.stringify({model:config.aiBrainModel,messages:[{role:"system",content:system},{role:"user",content:compact(payload)}],temperature:0.1,max_tokens:220,response_format:{type:"json_object"}})});
      if(!r.ok)throw new Error(`OpenRouter ${r.status}: ${(await r.text()).slice(0,220)}`);
      const data:any=await r.json();const raw=String(data?.choices?.[0]?.message?.content??"").trim();
      const match=raw.match(/\{[\s\S]*\}/);if(!match)throw new Error("AI returned non-JSON coin review");
      const parsed=JSON.parse(match[0]);
      const verdict=["BUY","PASS","NO_OPINION"].includes(parsed?.verdict)?parsed.verdict:"NO_OPINION";
      const confidence=Math.max(0,Math.min(100,Number(parsed?.confidence)||0));
      const reason=String(parsed?.reason??"No reason supplied").slice(0,280);const model=String(data?.model??config.aiBrainModel);
      const review:AiCoinReview={enabled:true,ok:true,usedCall:true,verdict,confidence,reason,model};
      this.coinCache.set(c.token.address,{at:Date.now(),review});
      log.info(`🤖🪙 AI COIN ${verdict} ${confidence}% | ${c.token.name} ($${c.token.symbol}) | Score:${Math.round(c.score)} | ${reason} | budget ${this.usageText()}`);
      return review;
    }catch(e){
      const msg=e instanceof Error?e.message:String(e);
      log.warn(`🤖🪙 AI COIN unavailable | ${c.token.name} | ${msg} | normal Dog Bot rules remain active`);
      return {enabled:true,ok:false,usedCall:true,verdict:"NO_OPINION",confidence:0,reason:`AI unavailable (${msg.slice(0,140)}); use normal Dog Bot rules`};
    }finally{clearTimeout(timer);}
  }

  async reviewCombined(paper:any,live:any,paperBrain:any,liveBrain:any,windowLabel:string):Promise<AiBrainReview>{
    if(!this.enabled())return {enabled:false,ok:false,text:""};
    const budget=this.canSpend("report");
    if(!budget.ok)return {enabled:true,ok:false,text:`🤖 AI report skipped to preserve trading continuity (${budget.why}). Dog Brain and trading continued normally.`};
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),config.aiBrainTimeoutMs);
    try{
      this.spend("report");
      const settings={BUY_SCORE:config.buyScore,ELITE_SCORE:config.eliteScore,FLAME_MIN_SCORE:config.flameMinScore,HARD_STOP_LOSS_PCT:config.hardStopLossPct,SOFT_STOP_LOSS_PCT:config.softStopLossPct,TRAILING_STOP_PCT:config.trailingStopPct,TAKE_PROFIT_PCT:config.takeProfitPct,PROFIT_PROTECT_ARM_PCT:config.profitProtectArmPct,PEAK_PROFIT_ARM_PCT:config.peakProfitArmPct,PEAK_PROFIT_FLOOR_PCT:config.peakProfitFloorPct,PEAK_GIVEBACK_EXIT_PCT:config.peakGivebackExitPct,PAPER_NORMAL_MAX_USD:config.paperNormalMaxUsd,PAPER_ELITE_MAX_USD:config.paperEliteMaxUsd,PAPER_FLAME_MAX_USD:config.paperFlameMaxUsd,LIVE_TRADING:config.liveTrading};
      const slimWallet=(wallet:any)=>({equityUsd:wallet?.equityUsd,cashUsd:wallet?.cashUsd,openValueUsd:wallet?.openValueUsd,totalPnlUsd:wallet?.totalPnlUsd,totalReturnPct:wallet?.totalReturnPct,realizedUsd:wallet?.realizedUsd,unrealizedUsd:wallet?.unrealizedUsd,wins:wallet?.wins,losses:wallet?.losses,lifetimeWins:wallet?.lifetimeWins,lifetimeLosses:wallet?.lifetimeLosses,lifetimeWinRatePct:wallet?.lifetimeWinRatePct,bestTradePct:wallet?.bestTradePct,worstTradePct:wallet?.worstTradePct,closedTrades:wallet?.closedTrades?.slice?.(-10),openPositions:wallet?.openPositions?.slice?.(-10)});
      const payload={window:windowLabel,activeMode:config.liveTrading?"LIVE":"PAPER",currentSettings:settings,aiUsage:this.usage,paper:{wallet:slimWallet(paper),dogBrain:paperBrain},live:{wallet:slimWallet(live),dogBrain:liveBrain}};
      const system=`You are the profit-focused external AI co-analyst for Broke Dog Bot, a Solana memecoin trading bot. Help the creator improve expected profitability using ONLY supplied evidence. Never promise profit. Keep PAPER and LIVE evidence separate. Challenge weak Dog Brain conclusions. Return creator-facing text with these headings exactly:
🤖💰 AI PROFIT VERDICT
✅ WHAT DOG BOT IS DOING WELL
❌ WHAT IS HURTING PROFITABILITY
🧠 HOW I WOULD HELP DOG BRAIN GET SMARTER
🎯 HIGHEST-IMPACT CHANGES TO TEST
📈 ENTRY / COIN-SELECTION TAKEAWAY
🚪 EXIT / PROFIT-PROTECTION TAKEAWAY
🔬 DATA I NEED BEFORE GETTING MORE AGGRESSIVE
💵 PATH TO BETTER EXPECTED PROFIT
For parameter changes include current value, proposed test, evidence/sample size, expected upside, downside, and confidence. Say NO CHANGE if evidence is insufficient. Never recommend disabling hard safety or chasing losses.`;
      const r=await fetch("https://openrouter.ai/api/v1/chat/completions",{method:"POST",signal:controller.signal,headers:{Authorization:`Bearer ${config.openRouterApiKey}`,"Content-Type":"application/json","HTTP-Referer":"https://railway.app","X-Title":"Broke Dog Bot AI Brain"},body:JSON.stringify({model:config.aiBrainModel,messages:[{role:"system",content:system},{role:"user",content:`Review this combined ${windowLabel} report. PAPER and LIVE must remain analytically separate:\n${compact(payload)}`}],temperature:0.2,max_tokens:config.aiBrainMaxTokens})});
      if(!r.ok)throw new Error(`OpenRouter ${r.status}: ${(await r.text()).slice(0,240)}`);
      const data:any=await r.json();const text=String(data?.choices?.[0]?.message?.content??"").trim();if(!text)throw new Error("OpenRouter returned an empty analysis");
      const model=String(data?.model??config.aiBrainModel);log.info(`🤖🧠 AI BRAIN combined profit review complete | ${windowLabel} | ${model} | budget ${this.usageText()}`);
      return {enabled:true,ok:true,model,text:text.slice(0,config.aiBrainMaxChars)};
    }catch(e){const msg=e instanceof Error?e.message:String(e);log.warn(`🤖🧠 AI BRAIN unavailable | combined ${windowLabel} | ${msg} | Dog Bot continues normally`);return {enabled:true,ok:false,text:`🤖 AI Brain unavailable for this report (${msg.slice(0,160)}). Dog Brain and trading continued normally; no strategy setting was changed.`};}
    finally{clearTimeout(timer);}
  }
}

export const aiBrain=new AiBrain();
