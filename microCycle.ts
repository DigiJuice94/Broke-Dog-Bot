import { Candidate, MicroCycleAnalysis, MicroCycleState, Snapshot } from "./types.ts";
import { config } from "./config.ts";

const clamp=(v:number,a=0,b=100)=>Math.max(a,Math.min(b,v));
const pctChange=(a?:number,b?:number)=>a!=null&&b!=null&&a!==0?((b-a)/Math.abs(a))*100:0;
const avg=(xs:number[])=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:0;
const val=(s:Snapshot|undefined,k:keyof Snapshot)=>Number(s?.[k]??0);

function stateFor(score:number, momentum:number, late:number, exhaustion:number):MicroCycleState{
  if(exhaustion>=70) return "EXHAUSTING";
  if(momentum<=25) return score<35?"DEAD":"WAKING";
  if(late>=72) return "RUNNING";
  if(score>=82) return "BREAKOUT";
  if(score>=62) return "BUILDING";
  return "WAKING";
}

export function analyzeMicroCycle(c:Candidate):MicroCycleAnalysis{
  const snaps=c.snapshots.slice(-6);
  const s=snaps.at(-1);
  const prev=snaps.at(-2);
  if(!s) return {state:"DEAD",score:0,runnerProbability:0,lateEntryRisk:0,exhaustionRisk:0,scoreVelocity:0,scoreAcceleration:0,buyerAccelerationPct:0,volumeAccelerationPct:0,priceVelocityPct:0,buySellRatio:0,moneyFlowRatio:0,structureBreak:false,higherLow:false,antiFomoBlocked:false,adjustment:0,reasons:["no snapshot"]};

  const buys=Number(s.buys1m??s.buys5m??0), sells=Number(s.sells1m??s.sells5m??0);
  const pbuys=Number(prev?.buys1m??prev?.buys5m??0), psells=Number(prev?.sells1m??prev?.sells5m??0);
  const volume=Number(s.volume1mUsd??((s.volume5mUsd??0)/5));
  const prevVolume=Number(prev?.volume1mUsd??((prev?.volume5mUsd??0)/5));
  const buyAccel=pctChange(pbuys,buys);
  const volumeAccel=pctChange(prevVolume,volume);
  const priceVelocity=Number(s.priceChange1mPct??s.priceChange5mPct??pctChange(prev?.priceUsd,s.priceUsd));
  const ratio=buys/Math.max(1,sells);
  const moneyFlow=Number(s.buyVolume1mUsd??0)/Math.max(1,Number(s.sellVolume1mUsd??0));
  const unique=Number(s.uniqueWallet1m??0);
  const ageMin=(Date.now()-(c.token.listedAt??c.firstSeenAt))/60000;

  const prices=snaps.map(x=>Number(x.priceUsd??0)).filter(x=>x>0);
  const recentHigh=prices.length>=2?Math.max(...prices.slice(0,-1)):0;
  const structureBreak=!!s.priceUsd && recentHigh>0 && s.priceUsd>recentHigh*1.003 && ratio>=1.25;
  const higherLow=prices.length>=4 && prices.at(-2)!>Math.min(...prices.slice(0,-2));

  let momentum=25;
  momentum += Math.min(24,Math.max(-10,(ratio-1)*10));
  momentum += Math.min(18,Math.max(-12,buyAccel*0.10));
  momentum += Math.min(18,Math.max(-12,volumeAccel*0.08));
  momentum += Math.min(16,Math.max(-10,priceVelocity*0.65));
  if(moneyFlow>1.3) momentum+=5;
  if(moneyFlow>2) momentum+=5;
  if(unique>=10) momentum+=3;
  if(unique>=25) momentum+=3;
  if(structureBreak) momentum+=8;
  if(higherLow) momentum+=4;
  momentum=clamp(momentum);

  const scoreHistory=(c as any).scoreHistory as {at:number;score:number}[]|undefined;
  const sh=(scoreHistory??[]).slice(-5);
  const scoreVelocity=sh.length>=2?(sh.at(-1)!.score-sh[0].score)/Math.max(1,(sh.at(-1)!.at-sh[0].at)/60000):0;
  const firstVel=sh.length>=3?(sh[1].score-sh[0].score)/Math.max(.05,(sh[1].at-sh[0].at)/60000):0;
  const lastVel=sh.length>=3?(sh.at(-1)!.score-sh.at(-2)!.score)/Math.max(.05,(sh.at(-1)!.at-sh.at(-2)!.at)/60000):scoreVelocity;
  const scoreAcceleration=lastVel-firstVel;

  let late=0;
  const p5=Number(s.priceChange5mPct??0);
  if(p5>25) late+=(p5-25)*0.8;
  if(p5>60) late+=18;
  if(priceVelocity>18) late+=12;
  if(volumeAccel<0 && p5>20) late+=12;
  if(buyAccel<0 && p5>20) late+=14;
  if(ageMin>config.flameMaxAgeMin && p5>35) late+=8;
  late=clamp(late);

  let exhaustion=0;
  if(p5>15 && buyAccel<-20) exhaustion+=25;
  if(p5>15 && volumeAccel<-20) exhaustion+=20;
  if(priceVelocity<0 && p5>10) exhaustion+=25;
  if(ratio<1 && p5>10) exhaustion+=20;
  if(moneyFlow>0 && moneyFlow<0.8 && p5>10) exhaustion+=15;
  exhaustion=clamp(exhaustion);

  let runner=momentum*0.62 + Number(c.runnerScore??50)*0.23 + Number(c.qualityScore??50)*0.15;
  runner += Math.min(10,Math.max(-6,scoreVelocity*0.4));
  runner -= late*0.20;
  runner -= exhaustion*0.25;
  runner=clamp(runner);

  const antiFomoBlocked=config.microCycleAntiFomoEnabled && snaps.length>=config.microCycleMinSnapshots && late>=config.microCycleLateEntryBlockRisk;
  let adjustment=(momentum-50)/10 + Math.max(-3,Math.min(3,scoreVelocity/8)) - late/20 - exhaustion/18;
  adjustment=Math.max(-config.microCycleMaxScoreAdjustment,Math.min(config.microCycleMaxScoreAdjustment,adjustment));
  if(snaps.length<config.microCycleMinSnapshots) adjustment=0;

  const state=stateFor(momentum,momentum,late,exhaustion);
  const reasons:string[]=[];
  if(structureBreak) reasons.push("bullish structure break");
  if(buyAccel>=40) reasons.push(`buyers +${buyAccel.toFixed(0)}%`);
  if(volumeAccel>=40) reasons.push(`volume +${volumeAccel.toFixed(0)}%`);
  if(ratio>=2) reasons.push(`B/S ${ratio.toFixed(1)}x`);
  if(scoreVelocity>=5) reasons.push(`score velocity +${scoreVelocity.toFixed(1)}/min`);
  if(late>=60) reasons.push(`late-entry risk ${late.toFixed(0)}`);
  if(exhaustion>=50) reasons.push(`exhaustion ${exhaustion.toFixed(0)}`);
  return {state,score:momentum,runnerProbability:runner,lateEntryRisk:late,exhaustionRisk:exhaustion,scoreVelocity,scoreAcceleration,buyerAccelerationPct:buyAccel,volumeAccelerationPct:volumeAccel,priceVelocityPct:priceVelocity,buySellRatio:ratio,moneyFlowRatio:moneyFlow,structureBreak,higherLow,antiFomoBlocked,adjustment,reasons};
}
