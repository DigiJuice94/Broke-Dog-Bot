const price=(n?:number)=>n==null?"?":n>=1?`$${n.toFixed(4)}`:`$${n.toPrecision(5)}`;
const scoreEmoji=(score:number)=>score>=92?"🔥":score>=84?"🟢":score>=70?"🟡":score>=55?"🟠":"🔴";
export const log={
  info:(...x:unknown[])=>console.log(new Date().toISOString(),...x),warn:(...x:unknown[])=>console.warn(new Date().toISOString(),...x),error:(...x:unknown[])=>console.error(new Date().toISOString(),...x),
  scan(data:{name:string;symbol:string;priceUsd?:number;score:number;confidence:number;status:string;reason?:string;sources?:string[];rankText?:string;details?:{
    buys1m?:number;sells1m?:number;buys5m?:number;sells5m?:number;volume1mUsd?:number;volume5mUsd?:number;liquidityUsd?:number;holderCount?:number;uniqueWallet1m?:number;
    top10HolderPct?:number;top1HolderPct?:number;top5HolderPct?:number;bundleClass?:string;devRisk?:string;holderRisk?:string;linkedSupply?:number;socialScore?:number;socialAccounts?:string;meta?:string;smart?:string;metaRunner?:boolean;microState?:string;microScore?:number;runnerProbability?:number;lateEntryRisk?:number;exhaustionRisk?:number;scoreVelocity?:number;buyerAccel?:number;volumeAccel?:number;structureBreak?:boolean;deep?:string}}){
    const src=data.sources?.length?` Sources:${data.sources.join("+")}`:"",rank=data.rankText?` Trend:${data.rankText}`:"",d=data.details;
    const buys=d?.buys1m??d?.buys5m,sells=d?.sells1m??d?.sells5m,flowWindow=(d?.buys1m!=null||d?.sells1m!=null)?"1m":"5m";
    const vol=d?.volume1mUsd??d?.volume5mUsd;
    const social=d?.socialScore!=null?` Social:${Math.round(d.socialScore)}/100${d.socialAccounts?` [${d.socialAccounts}]`:""}${d.meta?` Meta:${d.meta}`:""}${d.metaRunner?" 🟣META RUNNER":""}`:"";
    const smart=d?.smart?` Smart:${d.smart}`:"";
    const micro=d?.microState?` 🐕Cycle:${d.microState} ${Math.round(d.microScore??0)} RP:${Math.round(d.runnerProbability??0)} Late:${Math.round(d.lateEntryRisk??0)} Exh:${Math.round(d.exhaustionRisk??0)} Vel:${(d.scoreVelocity??0).toFixed(1)}/m BuyΔ:${(d.buyerAccel??0).toFixed(0)}% VolΔ:${(d.volumeAccel??0).toFixed(0)}%${d.structureBreak?" BOS":""}`:"";
    const safety=d?.bundleClass?` Safety:B:${d.bundleClass} H:${d.holderRisk??"?"} D:${d.devRisk??"?"} Top1:${d.top1HolderPct==null?"?":d.top1HolderPct.toFixed(1)+"%"} Top5:${d.top5HolderPct==null?"?":d.top5HolderPct.toFixed(1)+"%"} Top10:${d.top10HolderPct==null?"?":d.top10HolderPct.toFixed(1)+"%"}${d.linkedSupply==null?"":` Linked:${d.linkedSupply.toFixed(1)}%`}`:"";
    const detail=d?` | B/S(${flowWindow}):${buys??"?"}/${sells??"?"} Vol:${vol==null?"?":`$${Math.round(vol)}`} Liq:${d.liquidityUsd==null?"?":`$${Math.round(d.liquidityUsd)}`} Holders:${d.holderCount??"?"}${safety?` ${safety}`:` Top10:${d.top10HolderPct==null?"?":`${d.top10HolderPct.toFixed(1)}%`}`}${d.deep?` Deep:${d.deep}`:""}${social}${smart}${micro}`:"";
    console.log(`${new Date().toISOString()} [SCAN] ${data.name} ($${data.symbol}) | Price:${price(data.priceUsd)} | Score:${scoreEmoji(data.score)} ${Math.round(data.score)}/100 | Data:${Math.round(data.confidence)}% | ${data.status}${src}${rank}${detail}${data.reason?` | ${data.reason}`:""}`);
  }
};
