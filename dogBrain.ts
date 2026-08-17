import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { config } from "./config.ts";
import { Candidate, EntryLane, Position } from "./types.ts";
import { DexScreener } from "./dexscreener.ts";
import { log } from "./log.ts";

type LaneProfile="NORMAL"|"FLAME";
type FeatureName="buyPressure"|"volumeMomentum"|"priceMomentum"|"liquidity"|"earlyAge"|"multiSource"|"socialHeat"|"routeQuality"|"bundleSafety";
type FeatureVector=Record<FeatureName,number>;
type OutcomePoint={minute:number;at:number;priceUsd:number;returnPct:number};
type LearningRecord={
  mint:string;name:string;symbol:string;lane:LaneProfile;mode?:"PAPER"|"LIVE";decision:"WATCHING"|"REJECTED"|"BOUGHT";
  decisionReason?:string;firstSeenAt:number;decisionAt:number;baselinePriceUsd:number;score:number;confidence:number;
  features:FeatureVector;outcomes:OutcomePoint[];maxReturnPct:number;minReturnPct:number;resolved:boolean;
  tradeExitPct?:number;tradeExitReason?:string;tradeClosedAt?:number;
};
type BrainState={version:number;day:string;weights:Record<LaneProfile,Record<FeatureName,number>>;dailyMovement:Record<LaneProfile,Record<FeatureName,number>>;samples:Record<LaneProfile,number>;records:LearningRecord[];lastReportAt:number;lastLearnAt:number;rollbacks:number;baselinePaperMetric?:number;};

const FEATURES:FeatureName[]=["buyPressure","volumeMomentum","priceMomentum","liquidity","earlyAge","multiSource","socialHeat","routeQuality","bundleSafety"];
const zeroWeights=()=>Object.fromEntries(FEATURES.map(k=>[k,0])) as Record<FeatureName,number>;
const clamp=(v:number,a=-1,b=1)=>Math.max(a,Math.min(b,v));
const day=()=>new Date().toISOString().slice(0,10);

class DogBrain {
  private dex=new DexScreener();
  private state:BrainState=this.blank();
  private loaded=false;
  private busy=false;

  private blank():BrainState{return {version:1,day:day(),weights:{NORMAL:zeroWeights(),FLAME:zeroWeights()},dailyMovement:{NORMAL:zeroWeights(),FLAME:zeroWeights()},samples:{NORMAL:0,FLAME:0},records:[],lastReportAt:0,lastLearnAt:0,rollbacks:0};}
  private ensureLoaded(){if(this.loaded)return;this.loaded=true;try{if(existsSync(config.dogBrainFile)){const x=JSON.parse(readFileSync(config.dogBrainFile,"utf8"));this.state={...this.blank(),...x,weights:{NORMAL:{...zeroWeights(),...(x.weights?.NORMAL??{})},FLAME:{...zeroWeights(),...(x.weights?.FLAME??{})}},dailyMovement:{NORMAL:{...zeroWeights(),...(x.dailyMovement?.NORMAL??{})},FLAME:{...zeroWeights(),...(x.dailyMovement?.FLAME??{})}}};}}catch(e){log.warn(`[🧠 DOG BRAIN] state load failed: ${e instanceof Error?e.message:String(e)}`);}this.resetDay();}
  private save(){try{writeFileSync(config.dogBrainFile,JSON.stringify(this.state,null,2));}catch(e){log.warn(`[🧠 DOG BRAIN] state save failed: ${e instanceof Error?e.message:String(e)}`);}}
  private resetDay(){const d=day();if(this.state.day!==d){this.state.day=d;this.state.dailyMovement={NORMAL:zeroWeights(),FLAME:zeroWeights()};this.save();}}
  private lane(c:Candidate):LaneProfile{const age=(Date.now()-(c.token.listedAt??c.firstSeenAt))/60000;return c.entryLane==="FLAME"||(age<=config.flameMaxAgeMin&&(c.runnerScore??0)>=75)?"FLAME":"NORMAL";}
  private vector(c:Candidate):FeatureVector{const s=c.snapshots.at(-1);const prev=c.snapshots.length>1?c.snapshots.at(-2):undefined;const buys=Number(s?.buys1m??s?.buys5m??0),sells=Number(s?.sells1m??s?.sells5m??0),ratio=buys/Math.max(1,sells);const vol=Number(s?.volume1mUsd??((s?.volume5mUsd??0)/5));const prevVol=Number(prev?.volume1mUsd??((prev?.volume5mUsd??0)/5));const volAccel=prevVol>0?(vol/prevVol-1):0;const p=Number(s?.priceChange1mPct??s?.priceChange5mPct??0);const liq=Number(s?.liquidityUsd??0);const age=(Date.now()-(c.token.listedAt??c.firstSeenAt))/60000;const risk=s?.onChainRisk;const bundle=risk?.bundleRisk==="low"?1:risk?.bundleRisk==="medium"?-0.35:risk?.bundleRisk==="high"?-1:0;return {
    buyPressure:clamp((ratio-1)/3),volumeMomentum:clamp(volAccel/2),priceMomentum:clamp(p/25),liquidity:clamp((Math.log10(Math.max(100,liq))-3.5)/2),earlyAge:clamp(1-age/30),multiSource:clamp((c.sources.size-1)/4),socialHeat:clamp(Number(s?.social?.score??0)/100),routeQuality:clamp(((s?.routeQuality??50)-50)/50),bundleSafety:bundle
  };}
  observe(c:Candidate){if(!config.dogBrainEnabled)return;this.ensureLoaded();const s=c.snapshots.at(-1);if(!s?.priceUsd||s.priceUsd<=0)return;let r=this.state.records.find(x=>x.mint===c.token.address&&!x.resolved);if(!r){r={mint:c.token.address,name:c.token.name,symbol:c.token.symbol,lane:this.lane(c),mode:config.liveTrading?"LIVE":"PAPER",decision:"WATCHING",firstSeenAt:c.firstSeenAt,decisionAt:Date.now(),baselinePriceUsd:s.priceUsd,score:c.score,confidence:c.dataConfidence,features:this.vector(c),outcomes:[],maxReturnPct:0,minReturnPct:0,resolved:false};this.state.records.push(r);if(this.state.records.length>config.dogBrainMaxRecords)this.state.records=this.state.records.slice(-config.dogBrainMaxRecords);}else if(r.decision==="WATCHING"){r.name=c.token.name;r.symbol=c.token.symbol;r.lane=this.lane(c);r.score=c.score;r.confidence=c.dataConfidence;r.features=this.vector(c);}this.save();}
  markDecision(c:Candidate,decision:"REJECTED"|"BOUGHT"){if(!config.dogBrainEnabled)return;this.observe(c);const r=this.state.records.find(x=>x.mint===c.token.address&&!x.resolved);if(!r)return;r.decision=decision;r.mode=config.liveTrading?"LIVE":"PAPER";r.decisionAt=Date.now();r.decisionReason=c.decisionReason;r.lane=this.lane(c);r.score=c.score;r.confidence=c.dataConfidence;r.features=this.vector(c);this.save();}
  recordTradeClose(p:Position,pnlPct:number,reason:string){if(!config.dogBrainEnabled)return;this.ensureLoaded();const r=[...this.state.records].reverse().find(x=>x.mint===p.mint&&x.decision==="BOUGHT"&&!x.resolved);if(!r)return;r.tradeExitPct=pnlPct;r.tradeExitReason=reason;r.tradeClosedAt=Date.now();this.save();}
  scoreAdjustment(c:Candidate){if(!config.dogBrainEnabled)return 0;this.ensureLoaded();this.resetDay();const lane=this.lane(c);if(this.state.samples[lane]<config.dogBrainMinSamples)return 0;const v=this.vector(c),w=this.state.weights[lane];let d=0;for(const f of FEATURES)d+=v[f]*w[f];return Math.max(-config.dogBrainMaxScoreAdjustment,Math.min(config.dogBrainMaxScoreAdjustment,d));}
  private learn(r:LearningRecord){const lane=r.lane;const runner=r.maxReturnPct>=config.dogBrainRunnerPct;const rug=r.minReturnPct<=-config.dogBrainRugPct;const success=runner?1:rug?-1:r.maxReturnPct>=10?0.35:r.maxReturnPct<=-10?-0.35:0;this.state.samples[lane]++;
    if(this.state.samples[lane]<config.dogBrainMinSamples||success===0)return;
    for(const f of FEATURES){const desired=config.dogBrainLearnRate*success*r.features[f];const moved=this.state.dailyMovement[lane][f];const room=Math.max(0,config.dogBrainMaxDailyWeightMove-Math.abs(moved));const delta=Math.sign(desired)*Math.min(Math.abs(desired),room);if(!delta)continue;this.state.weights[lane][f]=Math.max(-config.dogBrainMaxFeatureWeight,Math.min(config.dogBrainMaxFeatureWeight,this.state.weights[lane][f]+delta));this.state.dailyMovement[lane][f]+=delta;}
    this.state.lastLearnAt=Date.now();
  }
  private maybeRollback(){const recent=this.state.records.filter(r=>r.resolved&&r.decision==="BOUGHT"&&r.tradeExitPct!=null).slice(-config.dogBrainRollbackWindow);if(recent.length<config.dogBrainRollbackWindow)return;const avg=recent.reduce((a,r)=>a+(r.tradeExitPct??0),0)/recent.length;if(this.state.baselinePaperMetric==null){this.state.baselinePaperMetric=avg;return;}if(avg<this.state.baselinePaperMetric-config.dogBrainRollbackDropPct){this.state.weights={NORMAL:zeroWeights(),FLAME:zeroWeights()};this.state.dailyMovement={NORMAL:zeroWeights(),FLAME:zeroWeights()};this.state.rollbacks++;this.state.baselinePaperMetric=avg;log.warn(`🧠↩️ DOG BRAIN ROLLBACK | recent trade avg ${avg.toFixed(1)}% deteriorated beyond guardrail — learned score weights reset; safety rules unchanged`);}else this.state.baselinePaperMetric=this.state.baselinePaperMetric*.8+avg*.2;}
  async tick(){if(!config.dogBrainEnabled||this.busy)return;this.ensureLoaded();this.resetDay();this.busy=true;try{const now=Date.now(),mins=[1,5,15,30,60];const due=this.state.records.filter(r=>!r.resolved&&r.decision!=="WATCHING"&&mins.some(m=>now-r.decisionAt>=m*60000&&!r.outcomes.some(o=>o.minute===m)));if(due.length){const market=await this.dex.batch([...new Set(due.map(r=>r.mint))]);for(const r of due){const px=market.get(r.mint)?.priceUsd;if(!px||px<=0)continue;for(const m of mins){if(now-r.decisionAt>=m*60000&&!r.outcomes.some(o=>o.minute===m)){const ret=(px/r.baselinePriceUsd-1)*100;r.outcomes.push({minute:m,at:now,priceUsd:px,returnPct:ret});r.maxReturnPct=Math.max(r.maxReturnPct,ret);r.minReturnPct=Math.min(r.minReturnPct,ret);if(m===60){r.resolved=true;this.learn(r);const label=r.decision==="REJECTED"&&r.maxReturnPct>=config.dogBrainRunnerPct?"🤦 MISSED RUNNER":r.minReturnPct<=-config.dogBrainRugPct?"🛡️ RUG/DUMP":"📚 LEARNED";log.info(`🧠🐶 ${label} | ${r.name} ($${r.symbol}) | ${r.decision} | 1h:${ret>=0?"+":""}${ret.toFixed(1)}% | max:${r.maxReturnPct>=0?"+":""}${r.maxReturnPct.toFixed(1)}% | min:${r.minReturnPct.toFixed(1)}% | lane:${r.lane}`);}}}}this.maybeRollback();this.save();}
      if(now-this.state.lastReportAt>=config.dogBrainReportIntervalMs){this.state.lastReportAt=now;this.logReport();this.save();}
    }catch(e){log.warn(`[🧠 DOG BRAIN] follow-up error: ${e instanceof Error?e.message:String(e)}`);}finally{this.busy=false;}}
  logReport(){if(!config.dogBrainEnabled)return;this.ensureLoaded();const done=this.state.records.filter(r=>r.resolved);const bought=done.filter(r=>r.decision==="BOUGHT"&&r.tradeExitPct!=null);const rejected=done.filter(r=>r.decision==="REJECTED");const wins=bought.filter(r=>(r.tradeExitPct??0)>0).length;const missed=rejected.filter(r=>r.maxReturnPct>=config.dogBrainRunnerPct).length;const avoided=rejected.filter(r=>r.minReturnPct<=-config.dogBrainRugPct).length;const all=[...FEATURES].map(f=>({f,w:Math.abs(this.state.weights.NORMAL[f])+Math.abs(this.state.weights.FLAME[f])})).sort((a,b)=>b.w-a.w);const top=all[0];log.info(`🧠🐶 DOG BRAIN DAILY | resolved:${done.length} | trades:${bought.length} | W:${wins} L:${Math.max(0,bought.length-wins)} WR:${bought.length?(wins/bought.length*100).toFixed(1):"0.0"}% | missed runners:${missed} | rejected dumps/rugs:${avoided} | samples N:${this.state.samples.NORMAL} F:${this.state.samples.FLAME} | strongest learned:${top?.f??"none"} | rollbacks:${this.state.rollbacks}`);}

  reportSnapshot(mode:"PAPER"|"LIVE",sinceMs=3600000){
    if(!config.dogBrainEnabled)return {enabled:false,observations:0,resolved:0,bought:0,rejected:0,missedRunners:0,avoidedDumps:0,wins:0,losses:0,strongest:"none",weakest:"none",recentLessons:[] as string[]};
    this.ensureLoaded(); const now=Date.now();
    const matching=this.state.records.filter(r=>(r.mode??(config.liveTrading?"LIVE":"PAPER"))===mode);
    const recent=matching.filter(r=>now-r.decisionAt<=sinceMs); const resolved=recent.filter(r=>r.resolved);
    const bought=recent.filter(r=>r.decision==="BOUGHT"); const rejected=recent.filter(r=>r.decision==="REJECTED");
    const closed=bought.filter(r=>r.tradeExitPct!=null); const wins=closed.filter(r=>(r.tradeExitPct??0)>0).length;
    const missed=rejected.filter(r=>r.maxReturnPct>=config.dogBrainRunnerPct).length; const avoided=rejected.filter(r=>r.minReturnPct<=-config.dogBrainRugPct).length;
    const weights=FEATURES.map(f=>({f,w:(this.state.weights.NORMAL[f]+this.state.weights.FLAME[f])/2})).sort((a,b)=>b.w-a.w);
    const lessons=recent.filter(r=>r.resolved).slice(-5).reverse().map(r=>`${r.name} ($${r.symbol}) ${r.decision}: max ${r.maxReturnPct>=0?"+":""}${r.maxReturnPct.toFixed(1)}%, min ${r.minReturnPct.toFixed(1)}%${r.tradeExitPct!=null?`, exit ${r.tradeExitPct>=0?"+":""}${r.tradeExitPct.toFixed(1)}%`:""}`);
    return {enabled:true,observations:recent.length,resolved:resolved.length,bought:bought.length,rejected:rejected.length,missedRunners:missed,avoidedDumps:avoided,wins,losses:Math.max(0,closed.length-wins),strongest:weights[0]?.f??"none",weakest:weights.at(-1)?.f??"none",recentLessons:lessons};
  }
  startupText(){this.ensureLoaded();return `Dog Brain v1 ${config.dogBrainEnabled?`ON (always learning: ${config.liveTrading?"LIVE":"PAPER"})`:"OFF"} | samples N:${this.state.samples.NORMAL} F:${this.state.samples.FLAME} | file ${config.dogBrainFile}`;}
}
export const dogBrain=new DogBrain();
