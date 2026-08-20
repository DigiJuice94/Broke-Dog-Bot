import { Candidate, Snapshot } from "./types.ts";
import { dogBrain } from "./dogBrain.ts";
import { analyzeMicroCycle } from "./microCycle.ts";
import { config } from "./config.ts";

const clamp=(v:number,a=0,b=100)=>Math.max(a,Math.min(b,v));
const gain=(a?:number,b?:number)=>(a!=null&&b!=null&&a!==0)?((b-a)/Math.abs(a))*100:0;

function safetyMetrics(s:Snapshot){
  const r=s.onChainRisk;
  const top10=r?.top10Pct??s.top10HolderPct;
  const holderKnown=(r?.holderRisk!=null&&r.holderRisk!=="unknown") || top10!=null;
  const devKnown=r?.devRisk!=null&&r.devRisk!=="unknown";
  const bundleKnown=(r?.bundleRisk!=null&&r.bundleRisk!=="unknown") || s.bundleStatus==="ok";
  // Five independent safety-evidence families. Route evidence is useful even when
  // Helius/deep-holder enrichment is unavailable, so the bot can still learn safely.
  const completeness=clamp(([s.buyRoute,s.sellRoute,holderKnown,devKnown,bundleKnown].filter(Boolean).length/5)*100);
  let score=85;
  if(s.buyRoute)score+=3; else score-=12;
  if(s.sellRoute)score+=3; else score-=12;
  if(top10!=null){ if(top10>=65)score-=35; else if(top10>=50)score-=14; else if(top10>=35)score-=5; else score+=4; }
  if(r?.bundleRisk==="low")score+=3; else if(r?.bundleRisk==="medium")score-=15; else if(r?.bundleRisk==="high")score-=45;
  if(r?.holderRisk==="low")score+=3; else if(r?.holderRisk==="medium")score-=12; else if(r?.holderRisk==="high")score-=40;
  if(r?.devRisk==="low")score+=4; else if(r?.devRisk==="medium")score-=18; else if(r?.devRisk==="high")score-=55;
  if(r?.checked)score+=2;
  // Incompleteness is primarily represented separately, with only a modest score penalty.
  score-=Math.max(0,40-completeness)*0.15;
  return {score:clamp(score),completeness};
}

export function scoreCandidate(c:Candidate){
  const s=c.snapshots.at(-1),prev=c.snapshots.length>=2?c.snapshots.at(-2):undefined;
  if(!s)return{score:0,runnerScore:0,qualityScore:0,confidence:0,reason:"waiting for first snapshot"};

  const core=[s.priceUsd,s.liquidityUsd,s.marketCapUsd,s.volume1mUsd??s.volume5mUsd,s.buys1m??s.buys5m,s.sells1m??s.sells5m,s.priceChange1mPct??s.priceChange5mPct];
  const deep=[s.holderCount,s.onChainRisk?.top1Pct,s.onChainRisk?.top5Pct,s.onChainRisk?.top10Pct,s.buyVolume1mUsd,s.sellVolume1mUsd,s.uniqueWallet1m];
  let confidence=clamp(core.filter(v=>v!==undefined).length/core.length*68+deep.filter(v=>v!==undefined).length/deep.length*20+(c.snapshots.length>=2?4:0)+(c.snapshots.length>=3?4:0)+(s.onChainRisk?.checked?4:0));

  const buys=s.buys1m??s.buys5m??0,sells=s.sells1m??s.sells5m??0;
  const ratio=buys/Math.max(1,sells);
  const unique=Number(s.uniqueWallet1m??0);
  const flow=s.buyVolume1mUsd!=null&&s.sellVolume1mUsd!=null?s.buyVolume1mUsd/Math.max(1,s.sellVolume1mUsd):0;
  const priceMomentum=s.priceChange1mPct??((s.priceChange5mPct??0)/3);
  const volumeNow=s.volume1mUsd??((s.volume5mUsd??0)/5);
  const volAccel=gain(prev?.volume1mUsd??prev?.volume5mUsd,s.volume1mUsd??s.volume5mUsd);
  const priceAccel=gain(prev?.priceUsd,s.priceUsd);
  const buyAccel=gain(prev?.buys1m??prev?.buys5m,s.buys1m??s.buys5m);
  const walletAccel=gain(prev?.uniqueWallet1m,s.uniqueWallet1m);
  const holderAccel=gain(prev?.holderCount,s.holderCount);

  // Breadth rewards distinct participants and dollar flow; raw tx ratio is only a small input.
  let breadth=20;
  breadth+=clamp(unique*1.1,0,35);
  breadth+=clamp(walletAccel*0.10,-10,15);
  if(flow>1.2)breadth+=6;if(flow>2)breadth+=7;if(flow>4)breadth+=5;
  if(buys>=8 && unique>0) breadth+=clamp((unique/buys)*18,0,18);
  breadth=clamp(breadth);

  let runner=22;
  runner+=clamp((ratio-1)*3,-8,10); // deliberately lower than v1.13 raw B/S weighting
  runner+=clamp(priceMomentum*.65,-15,16);
  runner+=breadth*.20;
  if(volumeNow>=500)runner+=3;if(volumeNow>=2500)runner+=4;if(volumeNow>=10000)runner+=4;
  if(flow>0)runner+=clamp((flow-1)*3,-6,9);
  runner+=clamp(volAccel*.08,-8,12)+clamp(priceAccel*.55,-8,10)+clamp(buyAccel*.05,-5,8)+clamp(holderAccel*.15,-4,6);
  if(c.sources.has("axiom"))runner+=5;if(c.sources.has("fomo"))runner+=5;if(c.sources.has("mobula-axiom-volume")||c.sources.has("mobula-axiom-price"))runner+=5;if(c.sources.has("birdeye-trending"))runner+=4;if(c.sources.has("dex-momentum"))runner+=4;if(c.sources.has("social-watchlist"))runner+=2;
  runner=clamp(runner);

  const ageMin=(Date.now()-(c.token.listedAt??c.firstSeenAt))/60000;
  const liq=s.liquidityUsd??0,vol5=s.volume5mUsd??((s.volume1mUsd??0)*5),vol1h=s.volume1hUsd??0;
  const accel=vol1h>0?vol5/(vol1h/12):(prev?.volume5mUsd?vol5/Math.max(1,prev.volume5mUsd):1);
  let quality=10;
  // Liquidity is Dog Brain's strongest positive predictor, so it has meaningful authority.
  if(liq>=1_000_000)quality+=30; else if(liq>=250_000)quality+=26; else if(liq>=75_000)quality+=22; else if(liq>=30_000)quality+=15; else if(liq>=15_000)quality+=6; else quality-=18;
  if(vol5>=10000)quality+=12;if(accel>=1.5)quality+=8;
  if(breadth>=60)quality+=12;else if(breadth>=45)quality+=7;else if(breadth<30)quality-=8;
  if((s.priceChange5mPct??0)>0&&(s.priceChange5mPct??0)<=35)quality+=8;
  if((s.marketCapUsd??0)>=50_000&&(s.marketCapUsd??0)<=5_000_000)quality+=8;
  if(vol5>0&&liq>0&&vol5/liq<=3)quality+=6;
  if(ageMin<0.75)quality-=22; else if(ageMin<2)quality-=12; else if(ageMin<=30)quality+=5;
  const sm=safetyMetrics(s);
  quality+=clamp((sm.score-70)*0.18,-12,6);
  quality=clamp(quality);

  let score=clamp(quality*.60+runner*.40);
  if(!s.buyRoute)score-=8;if(!s.sellRoute)score-=6;
  if(sm.completeness<50)score-=8;
  score=clamp(score);
  c.runnerScore=runner;c.qualityScore=quality;c.marketScore=runner;c.socialScore=s.social?.enabled?s.social.score:0;c.safetyScore=sm.score;c.safetyCompleteness=sm.completeness;c.demandBreadthScore=breadth;

  const learned=dogBrain.scoreAdjustment(c);score=clamp(score+learned);
  const history=c.scoreHistory??[];history.push({at:Date.now(),score});c.scoreHistory=history.slice(-8);
  if(config.microCycleEnabled){
    c.microCycle=analyzeMicroCycle(c);
    // A rising score with collapsing acceleration is a warning, not a bonus.
    let microAdj=c.microCycle.adjustment;
    if(c.microCycle.scoreAcceleration<=-40)microAdj-=6;
    else if(c.microCycle.scoreAcceleration<=-20)microAdj-=4;
    else if(c.microCycle.scoreAcceleration>=5)microAdj+=2;
    score=clamp(score+microAdj);
    c.scoreHistory[c.scoreHistory.length-1]={at:Date.now(),score};
  }
  let reason=`quality ${quality.toFixed(0)} / runner ${runner.toFixed(0)} | safety ${sm.score.toFixed(0)} (${sm.completeness.toFixed(0)}% complete) | breadth ${breadth.toFixed(0)}${Math.abs(learned)>=0.1?` | 🧠 ${learned>=0?"+":""}${learned.toFixed(1)}`:""}`;
  if(c.microCycle)reason+=` | 🐕 ${c.microCycle.state} ${c.microCycle.score.toFixed(0)} RP:${c.microCycle.runnerProbability.toFixed(0)} accel:${c.microCycle.scoreAcceleration.toFixed(1)} late:${c.microCycle.lateEntryRisk.toFixed(0)}`;
  return{score,runnerScore:runner,qualityScore:quality,confidence,reason};
}
