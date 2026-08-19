import { config } from "./config.ts";
import { log } from "./log.ts";

type Mode="PAPER"|"LIVE";

export type AiBrainReview={
  enabled:boolean;
  ok:boolean;
  model?:string;
  text:string;
};

const compact=(value:any)=>JSON.stringify(value,(k,v)=>{
  if(k==="recentLessons"&&Array.isArray(v))return v.slice(-8);
  if(Array.isArray(v)&&v.length>12)return v.slice(-12);
  return v;
});

class AiBrain {
  enabled(){return config.aiBrainEnabled&&!!config.openRouterApiKey;}
  startupText(){
    if(!config.aiBrainEnabled)return "AI Brain OFF (AI_BRAIN_ENABLED=false)";
    if(!config.openRouterApiKey)return "AI Brain READY but no OPENROUTER_API_KEY — Dog Bot continues normally without AI";
    return `AI Brain ON | ${config.aiBrainModel} | advisor-only / no trade control`;
  }

  async review(mode:Mode,wallet:any,brain:any,windowLabel:string):Promise<AiBrainReview>{
    if(!this.enabled())return {enabled:false,ok:false,text:""};
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),config.aiBrainTimeoutMs);
    try{
      const payload={
        mode,window:windowLabel,
        wallet:{
          equityUsd:wallet?.equityUsd,cashUsd:wallet?.cashUsd,openValueUsd:wallet?.openValueUsd,
          totalPnlUsd:wallet?.totalPnlUsd,totalReturnPct:wallet?.totalReturnPct,
          realizedUsd:wallet?.realizedUsd,unrealizedUsd:wallet?.unrealizedUsd,
          wins:wallet?.wins,losses:wallet?.losses,lifetimeWins:wallet?.lifetimeWins,lifetimeLosses:wallet?.lifetimeLosses,
          lifetimeWinRatePct:wallet?.lifetimeWinRatePct,bestTradePct:wallet?.bestTradePct,worstTradePct:wallet?.worstTradePct,
          closedTrades:wallet?.closedTrades?.slice?.(-10),openPositions:wallet?.openPositions?.slice?.(-10)
        },
        dogBrain:brain,
        currentSettings:{
          BUY_SCORE:config.buyScore,ELITE_SCORE:config.eliteScore,FLAME_MIN_SCORE:config.flameMinScore,
          FLAME_MIN_CONFIDENCE:config.flameMinConfidence,FLAME_MIN_SOURCES:config.flameMinSources,
          FLAME_MIN_BUY_SELL_RATIO:config.flameMinBuySellRatio,HARD_STOP_LOSS_PCT:config.hardStopLossPct,
          SOFT_STOP_LOSS_PCT:config.softStopLossPct,TRAILING_STOP_PCT:config.trailingStopPct,
          TAKE_PROFIT_PCT:config.takeProfitPct,PROFIT_PROTECT_ARM_PCT:config.profitProtectArmPct,
          PEAK_PROFIT_ARM_PCT:config.peakProfitArmPct,PEAK_PROFIT_FLOOR_PCT:config.peakProfitFloorPct,
          PEAK_GIVEBACK_EXIT_PCT:config.peakGivebackExitPct,PAPER_NORMAL_MAX_USD:config.paperNormalMaxUsd,
          PAPER_ELITE_MAX_USD:config.paperEliteMaxUsd,PAPER_FLAME_MAX_USD:config.paperFlameMaxUsd
        }
      };
      const system=`You are the external AI analyst for Broke Dog Bot, a Solana memecoin trading bot. Analyze only the supplied data. You are an advisor, never a trade executor and never a code rewriter. Do not claim certainty from small samples. Never recommend disabling hard safety, sell-route checks, rug protection, wallet controls, or loss limits. Keep PAPER and LIVE evidence separate. Challenge Dog Brain when its conclusion is weak. Return concise creator-facing text with these headings exactly:\n🤖 AI BRAIN VERDICT\n📊 EVIDENCE I TRUST\n⚠️ EVIDENCE I DO NOT TRUST YET\n🎯 CHANGES WORTH TESTING\n🔬 WHAT TO COLLECT NEXT\nFor every proposed parameter test include current value, proposed test value/range, evidence/sample size, expected upside, downside, and confidence. If evidence is insufficient, explicitly recommend NO CHANGE.`;
      const r=await fetch("https://openrouter.ai/api/v1/chat/completions",{
        method:"POST",signal:controller.signal,
        headers:{Authorization:`Bearer ${config.openRouterApiKey}`,"Content-Type":"application/json","HTTP-Referer":"https://railway.app","X-Title":"Broke Dog Bot AI Brain"},
        body:JSON.stringify({model:config.aiBrainModel,messages:[{role:"system",content:system},{role:"user",content:`Review this ${mode} ${windowLabel} dataset:\n${compact(payload)}`}],temperature:0.2,max_tokens:config.aiBrainMaxTokens})
      });
      if(!r.ok)throw new Error(`OpenRouter ${r.status}: ${(await r.text()).slice(0,240)}`);
      const data:any=await r.json();
      const text=String(data?.choices?.[0]?.message?.content??"").trim();
      if(!text)throw new Error("OpenRouter returned an empty analysis");
      const model=String(data?.model??config.aiBrainModel);
      log.info(`🤖🧠 AI BRAIN review complete | ${mode} | ${model}`);
      return {enabled:true,ok:true,model,text:text.slice(0,config.aiBrainMaxChars)};
    }catch(e){
      const msg=e instanceof Error?e.message:String(e);
      log.warn(`🤖🧠 AI BRAIN unavailable | ${mode} | ${msg} | Dog Bot continues normally`);
      return {enabled:true,ok:false,text:`🤖 AI Brain unavailable for this report (${msg.slice(0,160)}). Dog Brain and trading continued normally; no strategy setting was changed.`};
    }finally{clearTimeout(timer);}
  }
}

export const aiBrain=new AiBrain();
