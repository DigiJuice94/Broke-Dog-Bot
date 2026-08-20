import { Candidate, DogThesis, Position, Snapshot, SupplyAnalysis } from "./types.ts";
import { config } from "./config.ts";
const clamp=(v:number,a=0,b=100)=>Math.max(a,Math.min(b,v));

export function analyzeSupply(c:Candidate):SupplyAnalysis{
  const s=c.snapshots.at(-1)!; const m=c.microCycle;
  const age=(Date.now()-(c.token.listedAt??c.firstSeenAt))/60000;
  const liq=Number(s.liquidityUsd??0), vol=Number(s.volume1mUsd??((s.volume5mUsd??0)/5));
  const buys=Number(s.buys1m??s.buys5m??0), sells=Number(s.sells1m??s.sells5m??0), ratio=buys/Math.max(1,sells);
  const flow=Number(s.buyVolume1mUsd??0)/Math.max(1,Number(s.sellVolume1mUsd??0));
  const unique=Number(s.uniqueWallet1m??0), breadth=Number(c.demandBreadthScore??0);
  const top10=Number(s.onChainRisk?.top10Pct??s.top10HolderPct??0), linked=Number(s.onChainRisk?.estimatedLinkedSupplyPct??0);
  const snipers=Number(s.smartMoney?.snipers??0), insiders=Number(s.smartMoney?.insiders??0), bundlers=Number(s.smartMoney?.bundlers??0);
  const cohortRisk=Number(s.sniperHoldingPct??0)+Number(s.insiderHoldingPct??0)+Number(s.bundlerHoldingPct??0)+Number(s.devHoldingPct??0);
  const distribution=Number(s.smartMoney?.distributionScore??0);
  const organic1hBuy=Number(s.organicBuyers1h??0), organic1hSell=Number(s.organicSellers1h??0);
  let pressure=15; const reasons:string[]=[];
  if(age>7*24*60){pressure+=22;reasons.push("legacy-holder overhead");} else if(age>24*60){pressure+=15;reasons.push("older holder supply");} else if(age>60)pressure+=7;
  if(top10>=50){pressure+=25;reasons.push(`top10 ${top10.toFixed(0)}% concentrated`);} else if(top10>=35){pressure+=13;reasons.push(`top10 ${top10.toFixed(0)}% elevated`);}
  if(linked>=20){pressure+=20;reasons.push(`linked supply ${linked.toFixed(0)}%`);} else if(linked>=10)pressure+=10;
  if(snipers+insiders+bundlers>=4){pressure+=14;reasons.push("early-wallet distribution risk");}
  if(cohortRisk>=20){pressure+=18;reasons.push(`sniper/insider/bundler/dev supply ${cohortRisk.toFixed(1)}%`);} else if(cohortRisk>=10)pressure+=9;
  if(distribution>=65){pressure+=18;reasons.push(`top-trader distribution ${distribution.toFixed(0)}/100`);} else if(distribution>=45)pressure+=8;
  if(organic1hSell>organic1hBuy && organic1hSell>0){pressure+=8;reasons.push("organic 1h sellers exceed buyers");}
  if(ratio<1){pressure+=15;reasons.push("sellers leading");}
  if(flow>0&&flow<0.8){pressure+=12;reasons.push("sell dollars leading");}
  if((s.priceChange5mPct??0)>25){pressure+=8;reasons.push("extended 5m move");}
  if(unique>0&&unique<5){pressure+=8;reasons.push("narrow buyer participation");}
  pressure=clamp(pressure);

  let demand=20;
  if(liq>=250_000)demand+=22;else if(liq>=75_000)demand+=17;else if(liq>=30_000)demand+=11;
  if(ratio>=1.5)demand+=8;if(ratio>=2.5)demand+=6;
  if(flow>=1.3)demand+=8;if(flow>=2)demand+=6;
  demand+=Math.min(20,breadth*.20);
  if(m?.buyerAccelerationPct!=null&&m.buyerAccelerationPct>=10)demand+=7;
  if(m?.volumeAccelerationPct!=null&&m.volumeAccelerationPct>=0)demand+=5;
  if(organic1hBuy>organic1hSell && organic1hBuy>=5)demand+=7;
  if(Number(s.smartTraderHoldingPct??0)>0)demand+=Math.min(6,Number(s.smartTraderHoldingPct));
  demand=clamp(demand);
  const turnover=liq>0?vol/liq:0;
  let absorption=demand-pressure*.45;
  if(turnover>=0.03)absorption+=8;if(turnover>=0.10)absorption+=8;
  absorption=clamp(absorption);
  const paidAttention=c.sources.has("dex-boost")||c.sources.has("dex-boost-top");
  const organicAttention=Number(s.social?.mentions??0)>0 || Number(s.social?.weightedMentions??0)>0 || (s.social?.keyAccounts?.length??0)>0;
  if(paidAttention&&!organicAttention){pressure=clamp(pressure+5);absorption=clamp(absorption-5);reasons.push("paid attention without organic confirmation");}
  return {supplyPressure:pressure,absorptionScore:absorption,demandScore:demand,paidAttention,organicAttention,reasons};
}

export function buildDogThesis(c:Candidate):DogThesis{
  const s=c.snapshots.at(-1)!; const m=c.microCycle; const supply=analyzeSupply(c);
  const safety=Number(c.safetyScore??0), complete=Number(c.safetyCompleteness??0), quality=Number(c.qualityScore??0), liq=Number(s.liquidityUsd??0);
  const intel=c.intelligence??{mode:"CORE" as const,coverage:40,birdeye:"OFF" as const,mobula:"OFF" as const,birdeyeBudgetPct:0,notes:[]};
  const minAbsorption=intel.mode==="CORE"?Math.max(config.thesisMinAbsorption,config.coreMinAbsorption):config.thesisMinAbsorption;
  const maxSupply=intel.mode==="CORE"?Math.min(config.thesisMaxSupplyPressure,config.coreMaxSupplyPressure):config.thesisMaxSupplyPressure;
  const minThesisConfidence=intel.mode==="CORE"?config.coreMinThesisConfidence:intel.mode==="DEGRADED"?config.degradedMinThesisConfidence:0;
  const buys=Number(s.buys1m??s.buys5m??0), sells=Number(s.sells1m??s.sells5m??0), ratio=buys/Math.max(1,sells);
  const reclaim=!!(m?.structureBreak||m?.higherLow||(Number(m?.scoreAcceleration??-999)>=0&&Number(m?.buyerAccelerationPct??0)>=10&&Number(m?.volumeAccelerationPct??-1)>=0));
  const bull:string[]=[], counter:string[]=[], triggers:string[]=[], invalid:string[]=[];
  if(supply.absorptionScore>=55)bull.push(`demand absorption ${supply.absorptionScore.toFixed(0)}/100`);else counter.push(`absorption only ${supply.absorptionScore.toFixed(0)}/100`);
  if(ratio>=1.5)bull.push(`buyers lead ${ratio.toFixed(2)}x`);else counter.push(`buyer/seller ratio ${ratio.toFixed(2)}x`);
  if(Number(c.demandBreadthScore??0)>=50)bull.push(`buyer breadth ${Number(c.demandBreadthScore).toFixed(0)}/100`);else counter.push(`buyer breadth ${Number(c.demandBreadthScore??0).toFixed(0)}/100`);
  if(reclaim)bull.push("reclamation/structure confirmation present");else counter.push("reclamation not confirmed");
  if(supply.supplyPressure>=60)counter.push(`supply pressure ${supply.supplyPressure.toFixed(0)}/100`);else bull.push(`supply pressure controlled ${supply.supplyPressure.toFixed(0)}/100`);
  if(supply.paidAttention&&!supply.organicAttention)counter.push("paid promotion lacks organic confirmation");
  if(supply.organicAttention)bull.push("organic/social confirmation present");
  if(Number(m?.scoreAcceleration??0)<0)counter.push(`score acceleration ${Number(m?.scoreAcceleration??0).toFixed(1)}/min²`);
  if(safety>=80&&complete>=60)bull.push(`safety ${safety.toFixed(0)} with ${complete.toFixed(0)}% coverage`);else counter.push(`safety evidence ${safety.toFixed(0)} / ${complete.toFixed(0)}% coverage`);

  if(!reclaim)triggers.push("print a higher low, structure reclaim, or renewed positive acceleration");
  if(Number(m?.scoreAcceleration??0)<0)triggers.push("score acceleration turns non-negative or structure confirms despite deceleration");
  if(supply.absorptionScore<minAbsorption)triggers.push(`absorption rises to ${minAbsorption}+`);
  if(intel.mode!=="FULL")triggers.push(`intelligence improves from ${intel.mode} or market confirmation strengthens enough to compensate`);
  if(ratio<config.thesisMinBuySellRatio)triggers.push(`buyers lead at least ${config.thesisMinBuySellRatio.toFixed(1)}x`);
  triggers.push(`liquidity holds above $${Math.round(Math.max(config.normalMinLiquidityUsd,liq*.75))}`);
  invalid.push(`liquidity falls below $${Math.round(Math.max(config.normalMinLiquidityUsd*.7,liq*.55))}`);
  invalid.push(`supply pressure rises above ${maxSupply}`);
  invalid.push(`buyers fall below ${config.thesisInvalidationBuySellRatio.toFixed(2)}x with negative short-term price action`);

  const hardRefuse=s.onChainRisk?.devRisk==="high"||s.onChainRisk?.holderRisk==="high"||s.onChainRisk?.bundleRisk==="high"||supply.supplyPressure>=85;
  const buyReady=!hardRefuse&&s.buyRoute&&(!config.requireSellRoute||s.sellRoute)&&safety>=config.normalMinSafetyScore&&complete>=config.normalMinSafetyCompleteness&&quality>=config.normalMinQualityScore&&liq>=config.normalMinLiquidityUsd&&supply.absorptionScore>=minAbsorption&&supply.supplyPressure<=maxSupply&&ratio>=config.thesisMinBuySellRatio&&reclaim;
  const stalkable=!hardRefuse&&(c.score>=config.thesisStalkMinScore||(c.runnerScore??0)>=config.thesisStalkMinRunner)&&safety>=70&&supply.absorptionScore>=30;
  const decision:DogThesis["decision"]=buyReady?"BUY":stalkable?"STALK":"REFUSE";
  let confidence=clamp((safety*.18)+(complete*.10)+(quality*.16)+(supply.absorptionScore*.24)+((100-supply.supplyPressure)*.16)+(Number(c.demandBreadthScore??0)*.16));
  confidence=clamp(confidence-(100-intel.coverage)*.20);
  let finalDecision:DogThesis["decision"]=decision;
  if(finalDecision==="BUY"&&minThesisConfidence>0&&confidence<minThesisConfidence)finalDecision="STALK";
  if(finalDecision==="STALK")confidence=Math.min(confidence,79);
  return {decision:finalDecision,intelligenceMode:intel.mode,dataCoverage:intel.coverage,confidence,createdAt:c.thesis?.createdAt??Date.now(),updatedAt:Date.now(),bullCase:bull,counterCase:counter,entryTriggers:triggers,invalidations:invalid,triggerValues:{minLiquidityUsd:Math.max(config.normalMinLiquidityUsd,liq*.75),minAbsorption,maxSupplyPressure:maxSupply,minBuySellRatio:config.thesisMinBuySellRatio,requireReclaim:true,minScoreAcceleration:0},supply};
}

export function evaluateThesisExit(p:Position,s:Partial<Snapshot>){
  const a=p.entryAnalysis; const t=a?.thesis;if(!a||!t)return {failed:false,failures:[] as string[]};
  const failures:string[]=[]; const liq=Number(s.liquidityUsd??0), buys=Number(s.buys1m??s.buys5m??0), sells=Number(s.sells1m??s.sells5m??0), ratio=buys/Math.max(1,sells), pc=Number(s.priceChange1mPct??s.priceChange5mPct??0);
  if(liq>0&&liq<t.triggerValues.minLiquidityUsd*.75)failures.push(`liquidity $${Math.round(liq)} broke thesis floor`);
  if(ratio<config.thesisInvalidationBuySellRatio&&pc<0)failures.push(`buyers lost control ${ratio.toFixed(2)}x with red price action`);
  if(Number(s.volume5mUsd??0)>0&&Number(a.volume5mUsd??0)>0&&Number(s.volume5mUsd)<Number(a.volume5mUsd)*config.thesisVolumeDecayRatio)failures.push("turnover decayed below thesis requirement");
  return {failed:failures.length>=config.thesisExitFailureCount,failures};
}

export function evaluateStalkInvalidation(c:Candidate){
  if(!config.opportunityStalkInvalidationEnabled || c.state!=="STALKING" || !c.snapshots.length) return {invalid:false,reasons:[] as string[]};
  const s=c.snapshots.at(-1)!;
  const supply=analyzeSupply(c);
  const reasons:string[]=[];
  const liq=Number(s.liquidityUsd??0);
  const buys=Number(s.buys1m??s.buys5m??0), sells=Number(s.sells1m??s.sells5m??0);
  const ratio=buys/Math.max(1,sells);
  const pc=Number(s.priceChange1mPct??s.priceChange5mPct??0);
  const m=c.microCycle;
  if(liq>0 && liq<Math.max(5000,config.opportunityMinLiquidityUsd*0.55)) reasons.push(`liquidity collapsed to $${Math.round(liq)}`);
  if(supply.supplyPressure>Math.max(82,config.opportunityMaxSupplyPressure+10)) reasons.push(`supply pressure ${Math.round(supply.supplyPressure)}/100`);
  if(ratio<config.thesisInvalidationBuySellRatio && pc<-5) reasons.push(`sellers control ${ratio.toFixed(2)}x with ${pc.toFixed(1)}% short-term price action`);
  if(m?.state==="REVERSING" && m.scoreAcceleration<config.maxCollapseAcceleration) reasons.push(`micro-cycle reversing (${m.scoreAcceleration.toFixed(1)}/min²)`);
  if(s.onChainRisk?.devRisk==="high"||s.onChainRisk?.holderRisk==="high"||s.onChainRisk?.bundleRisk==="high") reasons.push("hard on-chain risk turned high");
  if(s.buyRoute===false && s.sellRoute===false && c.snapshots.length>=2) reasons.push("execution route unavailable");
  return {invalid:reasons.length>0,reasons};
}
