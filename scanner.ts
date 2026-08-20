import { Birdeye } from "./birdeye.ts";
import { getAxiomTrending, getFomoTrending } from "./trendingFeed.ts";
import { bundleRisk } from "./bundle.ts";
import { Jupiter } from "./jupiter.ts";
import { config } from "./config.ts";
import { Candidate, DiscoveredToken, Snapshot } from "./types.ts";
import { log } from "./log.ts";
import { scoreCandidate } from "./scoring.ts";
import { DexScreener } from "./dexscreener.ts";
import { MobulaAxiomDiscovery } from "./mobula.ts";
import { SocialIntel } from "./social.ts";
import { SmartMoneyIntel } from "./smartMoney.ts";
import { analyzeRisk, fastSafetyCheck, paperRiskGate, normalRiskGate, flameRiskGate } from "./risk.ts";
import { dogBrain } from "./dogBrain.ts";
import { aiBrain } from "./aiBrain.ts";
import { buildDogThesis, evaluateStalkInvalidation } from "./thesis.ts";

export class Scanner {
  readonly candidates = new Map<string, Candidate>();
  private lastDiscovery = 0;
  private lastDexDiscovery = 0;
  private lastBirdeyeNew = 0;
  private lastBirdeyeTrending = 0;
  private lastBirdeyeMeme = 0;
  private dex = new DexScreener();
  private mobula = new MobulaAxiomDiscovery();
  private social = new SocialIntel();
  private smartMoney: SmartMoneyIntel;
  private scannedToday = new Set<string>();
  private scannedDay = "";
  private mobulaCursor = 0;
  constructor(private birdeye: Birdeye, private jupiter: Jupiter, private onReady: (c: Candidate) => Promise<void>) { this.smartMoney=new SmartMoneyIntel(birdeye); }

  private activeCount() {
    return [...this.candidates.values()].filter(c=>!["DROPPED","BOUGHT","FAILED"].includes(c.state)).length;
  }

  private resetDailyUnique(now=Date.now()) {
    const day=new Date(now).toISOString().slice(0,10);
    if(this.scannedDay!==day){ this.scannedDay=day; this.scannedToday.clear(); }
  }

  private evictForFresh(now:number) {
    const eligible=[...this.candidates.values()].filter(c=>
      !["DROPPED","BOUGHT","FAILED","READY"].includes(c.state) &&
      now-c.firstSeenAt>=config.staleEvictAgeMs &&
      c.score<config.staleEvictScore
    ).sort((a,b)=>this.priority(a)-this.priority(b) || a.firstSeenAt-b.firstSeenAt);
    const victim=eligible[0];
    if(!victim)return false;
    victim.state="DROPPED";
    victim.lastDroppedAt=now;
    victim.decisionReason=`ROTATED OUT: stale score ${Math.round(victim.score)} to make room for fresh discovery`;
    log.info(`[ROTATE] ${victim.token.name} ($${victim.token.symbol}) out | score:${Math.round(victim.score)} age:${Math.round((now-victim.firstSeenAt)/1000)}s | fresh slot opened`);
    return true;
  }

  private add(t: DiscoveredToken, forceFresh=false): "new"|"existing"|"blocked" {
    const now = Date.now();
    const existing = this.candidates.get(t.address);
    if (existing) {
      const previousSeen = existing.lastSeenAt;
      existing.sources.add(t.source); existing.sourceFirstSeenAt ??= {}; if(existing.sourceFirstSeenAt[t.source]==null) existing.sourceFirstSeenAt[t.source]=now; existing.lastSeenAt=now;
      if (t.rank != null) {
        const oldRank=existing.trendingRanks[t.source];
        existing.previousTrendingRanks ??= {};
        existing.rankMovement ??= {};
        if(oldRank!=null){
          existing.previousTrendingRanks[t.source]=oldRank;
          existing.rankMovement[t.source]=oldRank-t.rank; // positive = climbing
        }
        existing.trendingRanks[t.source]=t.rank;
      }
      if (existing.token.name==="Unknown" && t.name!=="Unknown") existing.token.name=t.name;
      if (existing.token.symbol==="?" && t.symbol!=="?") existing.token.symbol=t.symbol;
      if (existing.token.decimals==null && t.decimals!=null) existing.token.decimals=t.decimals;
      if (t.seed) existing.token.seed={...(existing.token.seed??{}),...Object.fromEntries(Object.entries(t.seed).filter(([,v])=>v!==undefined))};

      // Critical starvation fix: a token that was dropped can become interesting
      // again. If DEX/Birdeye rediscover it after a cooldown and there is room in
      // the watch pool, start a fresh observation window instead of leaving it
      // permanently DROPPED.
      if (existing.state === "DROPPED" && this.activeCount() < config.maxActiveCandidates && now >= (existing.invalidatedUntil??0)) {
        const droppedAt = existing.lastDroppedAt ?? previousSeen;
        const isTrending = ["fomo","axiom","mobula-axiom-volume","mobula-axiom-price","birdeye-trending","dex-momentum"].includes(t.source);
        const cooldown = isTrending ? config.trendingRewatchCooldownMs : (this.activeCount() < config.minActiveCandidates ? Math.min(config.rewatchCooldownMs, 15_000) : config.rewatchCooldownMs);
        if (now - droppedAt >= cooldown) {
          existing.firstSeenAt = now;
          existing.snapshots = [];
          existing.score = 0;
          existing.dataConfidence = 0;
          existing.state = "WATCHING";
          existing.decisionReason = "rediscovered — fresh observation";
          existing.collecting = false;
          existing.watchCycles = (existing.watchCycles ?? 1) + 1;
          log.info(`[REWATCH] ${existing.token.name} ($${existing.token.symbol}) | fresh 30-90s observation | source:${t.source}`);
        }
      }
      return "existing";
    }
    if (this.activeCount()>=config.maxActiveCandidates) {
      if(!forceFresh || !this.evictForFresh(now) || this.activeCount()>=config.maxActiveCandidates) return "blocked";
    }
    this.candidates.set(t.address,{token:t,firstSeenAt:now,lastSeenAt:now,sources:new Set([t.source]),sourceFirstSeenAt:{[t.source]:now},
      trendingRanks:t.rank==null?{}:{[t.source]:t.rank},previousTrendingRanks:{},rankMovement:{},snapshots:[],score:0,dataConfidence:0,state:"WATCHING",collecting:false,watchCycles:1});
    return "new";
  }

  private pruneKnown() {
    const now = Date.now();
    for (const [address,c] of this.candidates) {
      if (["DROPPED","FAILED"].includes(c.state) && now-c.lastSeenAt > config.knownRetentionMs) this.candidates.delete(address);
    }
  }

  private async birdeyeFeed(label:string, due:boolean, fn:()=>Promise<DiscoveredToken[]>, adder:(t:DiscoveredToken)=>unknown=(t)=>this.add(t)) {
    if (!due || !this.birdeye.isCuAvailable() || this.birdeye.status().budgetPctRemaining<=config.intelligenceDegradedBirdeyeReservePct) return;
    try { for (const t of await fn()) adder(t); }
    catch(e) {
      const m=e instanceof Error?e.message:String(e);
      if (!m.toLowerCase().includes("cooldown")) log.warn(`[DISCOVERY ${label}] ${m}`);
    }
  }

  private async discover() {
    await this.social.poll();
    let freshThisCycle=0;
    const tryAdd=(t:DiscoveredToken)=>{
      const isFresh=!this.candidates.has(t.address);
      const force=isFresh && freshThisCycle<config.freshCandidatesPerCycle;
      const result=this.add(t,force);
      if(result==="new")freshThisCycle++;
      return result;
    };
    for(const t of this.social.discoveredTokens()) tryAdd(t);
    const now=Date.now();
    this.resetDailyUnique(now);
    // PRIMARY trending lane: rotate through a larger Mobula result set instead of
    // hammering the same top 12 every cycle. This keeps hot coins while continuously
    // exposing Dog Brain to fresh runners deeper in the ranking.
    try {
      const rows=await this.mobula.trending();
      if(rows.length){
        const take=Math.min(config.mobulaActiveSlots,rows.length);
        for(let i=0;i<take;i++) tryAdd(rows[(this.mobulaCursor+i)%rows.length]);
        this.mobulaCursor=(this.mobulaCursor+take)%rows.length;
      }
    } catch(e){ log.warn(`[MOBULA DISCOVERY] ${e instanceof Error?e.message:String(e)}`); }

    // Optional direct/custom adapters remain supported if the user later obtains a supported feed.
    const external = await Promise.allSettled([getAxiomTrending(),getFomoTrending()]);
    for(const r of external) if(r.status==="fulfilled") for(const t of r.value) tryAdd(t);

    // Birdeye Trending gets second priority behind the Axiom-style lane.
    const trendDue=now-this.lastBirdeyeTrending>=config.birdeyeTrendingIntervalMs;
    if(trendDue){this.lastBirdeyeTrending=now; await this.birdeyeFeed("BIRDEYE TREND",true,()=>this.birdeye.trending(),tryAdd);}

    // DEX Screener is the always-on, no-key fallback/enrichment discovery source.
    if(now-this.lastDexDiscovery>=config.dexDiscoveryIntervalMs){
      this.lastDexDiscovery=now;
      try { for(const t of await this.dex.discover()) tryAdd(t); }
      catch(e){ log.warn(`[DEX DISCOVERY] ${e instanceof Error?e.message:String(e)}`); }
    }

    // New listings remain a separate early-runner lane after trending capacity is reserved.
    const newDue=now-this.lastBirdeyeNew>=config.birdeyeNewIntervalMs;
    if(newDue){this.lastBirdeyeNew=now; await this.birdeyeFeed("BIRDEYE NEW",true,()=>this.birdeye.newListings(),tryAdd);}
    if(config.birdeyeMemeIntervalMs>0){
      const memeDue=now-this.lastBirdeyeMeme>=config.birdeyeMemeIntervalMs;
      if(memeDue){this.lastBirdeyeMeme=now; await this.birdeyeFeed("BIRDEYE MEME",true,()=>this.birdeye.memeMomentum(),tryAdd);}
    }
    this.pruneKnown();
    const active=this.activeCount();
    const poolState=active<config.minActiveCandidates?"REFILLING":"HEALTHY";
    const trending=[...this.candidates.values()].filter(c=>!["DROPPED","BOUGHT","FAILED"].includes(c.state) && (["fomo","axiom","mobula-axiom-volume","mobula-axiom-price","birdeye-trending","dex-momentum","social-watchlist"] as const).some(x=>c.sources.has(x))).length;
    const early=Math.max(0,active-trending);
    log.info(`[DISCOVERY] active=${active} 🔥trending=${trending} 🐣early=${early} | fresh-cycle=${freshThisCycle}/${config.freshCandidatesPerCycle} unique-today=${this.scannedToday.size} total-known=${this.candidates.size} pool:${poolState} | AXIOM-STYLE:${this.mobula.enabled()?"Mobula:on":"off"} DEX:on Birdeye:${this.birdeye.isCuAvailable()?"available":"CU cooldown"} | ${this.birdeye.budgetText()}`);
  }
  private rankText(c:Candidate){return Object.entries(c.trendingRanks).map(([k,v])=>{
    const move=(c.rankMovement as any)?.[k]??0;
    return `${k}#${v}${move>0?`↑${move}`:move<0?`↓${Math.abs(move)}`:""}`;
  }).join(",");}
  private priority(c:Candidate){
    // Trending lane always gets first shot at scanner/deep-check capacity.
    const axiomStyle=(c.sources.has("mobula-axiom-volume")||c.sources.has("mobula-axiom-price"))?12:0;
    const bestClimb=Math.max(0,...Object.values(c.rankMovement??{}).map(Number));
    return axiomStyle+(c.sources.has("fomo")?10:0)+(c.sources.has("axiom")?10:0)+(c.sources.has("birdeye-trending")?7:0)+(c.sources.has("dex-momentum")?5:0)+(c.sources.has("social-watchlist")?14:0)+(c.sources.has("birdeye-new")?2:0)+(c.sources.has("dex-profile")?0.5:0)+(c.sources.has("dex-boost-top")?0.25:0)+(c.sources.has("dex-boost")?0:0)+Math.min(4,bestClimb*0.5)+c.score/100;
  }

  private async collect(c:Candidate,index:number) {
    if(c.collecting||["DROPPED","BOUGHT","FAILED"].includes(c.state))return;
    this.resetDailyUnique();
    this.scannedToday.add(c.token.address);
    c.collecting=true;
    try{
      const seed=c.token.seed??{};
      // Birdeye overview is only for already-promising finalists. DEX data builds the first score.
      const doBirdeye=this.birdeye.status().available && this.birdeye.status().budgetPctRemaining>10 && index<config.birdeyeDeepCandidates && c.score>=config.birdeyeDeepMinScore;
      const age=Date.now()-c.firstSeenAt;
      const doRoute=(index<config.routeDeepCandidates && age>=Math.min(20_000,config.minObservationMs/2)) || c.score>=config.promoteScore;
      const doHolder=this.birdeye.canUseDeep() && index<config.birdeyeHolderCandidates && c.score>=config.birdeyeHolderMinScore;
      const doBundle=index<config.bundleDeepCandidates || c.score>=70;

      const marketPromise=doBirdeye?this.birdeye.snapshot(c.token.address,seed):Promise.resolve(seed);
      const bundlePromise=doBundle?bundleRisk(c.token.address):Promise.resolve({risk:undefined,status:"unknown" as const});
      const routePromise=doRoute?this.jupiter.canBuyAndSell(c.token.address):Promise.resolve({buy:false,sell:false,quality:undefined,quotedAt:Date.now(),roundTripPct:undefined,router:undefined,mode:undefined,feeBps:undefined});
      const holderPromise=doHolder?this.birdeye.holderStats(c.token.address):Promise.resolve({});
      const doSmart=index<config.smartMoneyCandidates && c.score>=config.smartMoneyMinScore;
      const smartPromise=doSmart?this.smartMoney.inspect(c.token.address):Promise.resolve({checked:false,smartTraders:0,snipers:0,insiders:0,bundlers:0,devs:0,score:0});
      // v1.4: start ONE fast safety precheck early and in parallel with scoring/enrichment.
      // This is cached in risk.ts, so strong candidates normally reach the buy threshold
      // with safety already finished instead of entering WAITING SAFETY.
      const doSafety=!!config.heliusApiKey && (index<config.safetyPrecheckCandidates || c.score>=config.promoteScore);
      const safetyPromise=doSafety?fastSafetyCheck(c.token.address):Promise.resolve(undefined);
      const social=this.social.scoreToken(c.token.name,c.token.symbol);
      const [market,bundle,route,holder,smartMoney,onChainRisk]=await Promise.all([marketPromise,bundlePromise,routePromise,holderPromise,smartPromise,safetyPromise]);

      const snap:Snapshot={at:Date.now(),...market,...holder, social, smartMoney,onChainRisk,
        bundleRisk:bundle.risk,bundleStatus:doBundle?(bundle.status==="ok"?"ok":bundle.status==="error"?"error":"unknown"):"skipped",
        buyRoute:route.buy,sellRoute:route.sell,routeQuality:route.quality,routeQuotedAt:route.quotedAt,routeRoundTripPct:route.roundTripPct,routeRouter:route.router,routeMode:route.mode,routeFeeBps:route.feeBps};
      c.snapshots.push(snap); if(c.snapshots.length>12)c.snapshots.shift();
      const be=this.birdeye.status(), mo=this.mobula.status();
      const beState=!be.enabled?"OFF":!be.available?"COOLDOWN":doBirdeye||doHolder?"LIVE":"CACHED";
      const moState=!mo.enabled?"OFF":!mo.available?"COOLDOWN":mo.lastSuccessAt&&Date.now()-mo.lastSuccessAt<=Math.max(config.mobulaTrendingIntervalMs*3,60000)?"LIVE":mo.cached?"CACHED":"OFF";
      const liveCount=(beState==="LIVE"?1:0)+(moState==="LIVE"?1:0), usableCount=((beState==="LIVE"||beState==="CACHED")?1:0)+((moState==="LIVE"||moState==="CACHED")?1:0);
      const mode=liveCount===2?"FULL":usableCount>=1?"DEGRADED":"CORE";
      const coverage=Math.max(35,Math.min(100,45+(beState==="LIVE"?25:beState==="CACHED"?12:0)+(moState==="LIVE"?20:moState==="CACHED"?10:0)+(snap.onChainRisk?.checked?10:0)));
      c.intelligence={mode,coverage,birdeye:beState as any,mobula:moState as any,birdeyeBudgetPct:be.budgetPctRemaining,notes:[...(beState!=="LIVE"?[`Birdeye ${beState.toLowerCase()}`]:[]),...(moState!=="LIVE"?[`Mobula ${moState.toLowerCase()}`]:[])]};
      let scored=scoreCandidate(c); c.score=scored.score;c.dataConfidence=scored.confidence;c.decisionReason=scored.reason; let learnedThresholds=dogBrain.entryThresholds(); if(c.score>=learnedThresholds.buyScore&&c.firstBuyScoreAt==null)c.firstBuyScoreAt=Date.now(); dogBrain.observe(c);

      // Same-cycle finalist escalation: if the NEW data collected above pushes a
      // candidate across the buy threshold, do not wait for the next scanner tick.
      // Immediately fetch any missing high-value checks, then recalculate the score
      // and READY state using those results.
      let finalBirdeye=doBirdeye, finalHolder=doHolder, finalBundle=doBundle, finalRoute=doRoute;
      if(c.score>=learnedThresholds.buyScore){
        log.info(`[FINALIST NOW] ${c.token.name} ($${c.token.symbol}) | fresh score ${Math.round(c.score)}/100 crossed buy threshold — verifying now`);

        const tasks:Promise<void>[]=[];
        const background:Promise<void>[]=[];
        const queue=(p:Promise<void>)=>{
          if(!config.liveTrading&&config.paperFastSafety) background.push(p); else tasks.push(p);
        };
        if(!finalRoute){
          finalRoute=true;
          tasks.push(this.jupiter.canBuyAndSell(c.token.address).then(r=>{snap.buyRoute=r.buy;snap.sellRoute=r.sell;snap.routeQuality=r.quality;snap.routeQuotedAt=r.quotedAt;snap.routeRoundTripPct=r.roundTripPct;snap.routeRouter=r.router;snap.routeMode=r.mode;snap.routeFeeBps=r.feeBps;}));
        }
        // Finalist price integrity check: DEX Screener is the canonical cross-check before a buy.
        // This prevents source-unit/decimal anomalies (for example a $0.x token appearing as $xxx).
        tasks.push(this.dex.batch([c.token.address]).then(m=>{
          const d=m.get(c.token.address); const old=Number(snap.priceUsd??0), fresh=Number(d?.priceUsd??0);
          if(fresh>0){
            if(old>0){const diff=Math.abs(old-fresh)/fresh*100;if(diff>=config.marketPriceDisagreementPct){snap.dataErrors??=[];snap.dataErrors.push(`price source mismatch ${diff.toFixed(1)}% — DEX canonicalized`);log.warn(`[PRICE INTEGRITY] ${c.token.name} | source $${old} vs DEX $${fresh} | ${diff.toFixed(1)}% mismatch — using DEX`);}}
            snap.priceUsd=fresh;
          }
          if(Number(d?.marketCapUsd)>0)snap.marketCapUsd=Number(d?.marketCapUsd);
          if(Number(d?.liquidityUsd)>0)snap.liquidityUsd=Number(d?.liquidityUsd);
          if(Number(d?.volume5mUsd)>=0)snap.volume5mUsd=Number(d?.volume5mUsd);
          if(Number(d?.buys5m)>=0)snap.buys5m=Number(d?.buys5m);
          if(Number(d?.sells5m)>=0)snap.sells5m=Number(d?.sells5m);
        }));
        if(!finalBirdeye && this.birdeye.status().available && this.birdeye.status().budgetPctRemaining>10){
          finalBirdeye=true;
          queue(this.birdeye.snapshot(c.token.address,c.token.seed??{}).then(m=>{Object.assign(snap,m);}));
        }
        if(!finalHolder && this.birdeye.canUseDeep()){
          finalHolder=true;
          queue(this.birdeye.holderStats(c.token.address).then(h=>{Object.assign(snap,h);}));
        }
        if(!finalBundle){
          finalBundle=true;
          queue(bundleRisk(c.token.address).then(b=>{snap.bundleRisk=b.risk;snap.bundleStatus=b.status==="ok"?"ok":b.status==="error"?"error":"unknown";}));
        }
        // Safety is the only paper-mode finalist check we wait on. Everything else
        // above keeps enriching the snapshot in the background for Dog Brain.
        if(!snap.onChainRisk && config.heliusApiKey){
          tasks.push(fastSafetyCheck(c.token.address).then(r=>{snap.onChainRisk=r;}));
        }
        if(background.length) void Promise.allSettled(background);
        if(tasks.length) await Promise.all(tasks);

        // Deep launch/funder analysis is learning enrichment now, not a paper-mode
        // decision gate. Let it finish in the background and feed later scans.
        if(config.heliusApiKey && c.score>=config.riskDeepMinScore){
          void analyzeRisk(c.token.address,c.token.listedAt).then(r=>{
            if(r.devRisk==="high"||r.holderRisk==="high"||r.bundleRisk==="high"||r.confidence==="high") snap.onChainRisk=r;
          }).catch(()=>{});
        }
        scored=scoreCandidate(c); c.score=scored.score;c.dataConfidence=scored.confidence;c.decisionReason=scored.reason; learnedThresholds=dogBrain.entryThresholds(); if(c.score>=learnedThresholds.buyScore&&c.firstBuyScoreAt==null)c.firstBuyScoreAt=Date.now(); dogBrain.observe(c);
      }

      // Hybrid entry lanes: strict v8.3-style normal entries plus a calculated-risk early-runner FLAME exception.
      const buys1m=Number(snap.buys1m??snap.buys5m??0), sells1m=Number(snap.sells1m??snap.sells5m??0);
      const buySellRatio=buys1m/Math.max(1,sells1m);
      const sourceCount=c.sources.size;
      const volume1m=Number(snap.volume1mUsd??((snap.volume5mUsd??0)/5));
      const routesVerified=!!snap.buyRoute&&(!config.requireSellRoute||!!snap.sellRoute);
      // v1.14: paper and live use the same route gate. We still learn from rejected candidates,
      // but we no longer create fake paper trades that could not actually be bought/sold.
      const routesOK=routesVerified;
      const tokenAgeMin=(Date.now()-(c.token.listedAt??c.firstSeenAt))/60000;
      const strictRisk=normalRiskGate(snap.onChainRisk);
      const paperSafety=paperRiskGate(snap.onChainRisk);
      const entryRisk=(!config.liveTrading&&config.paperFastSafety)?paperSafety:strictRisk;
      const flameRisk=(!config.liveTrading&&config.paperFastSafety)?paperSafety:flameRiskGate(snap.onChainRisk);
      const micro=c.microCycle;
      const liq=Number(snap.liquidityUsd??0);
      const safetyScore=Number(c.safetyScore??0), safetyComplete=Number(c.safetyCompleteness??0), qualityScore=Number(c.qualityScore??0);
      const confirmationOK=!config.microCycleEnabled || !micro || (
        micro.scoreAcceleration>=config.minScoreAcceleration &&
        micro.scoreAcceleration>config.maxCollapseAcceleration &&
        (micro.structureBreak || micro.higherLow || (micro.buyerAccelerationPct>=10 && micro.volumeAccelerationPct>=0))
      );
      const veryYoung=tokenAgeMin<config.veryYoungAgeMin, young=tokenAgeMin<config.youngAgeMin;
      const ageSafetyOK=veryYoung
        ? safetyScore>=config.veryYoungMinSafetyScore && safetyComplete>=config.veryYoungMinSafetyCompleteness && liq>=config.veryYoungMinLiquidityUsd
        : young ? safetyScore>=config.youngMinSafetyScore : true;
      const componentGates=safetyScore>=config.normalMinSafetyScore && safetyComplete>=config.normalMinSafetyCompleteness && qualityScore>=config.normalMinQualityScore && liq>=config.normalMinLiquidityUsd;
      const microFlameOK=!config.microCycleEnabled || !micro || (micro.score>=config.microCycleFlameMinScore && micro.runnerProbability>=config.microCycleFlameMinRunnerProbability && !micro.antiFomoBlocked && micro.scoreAcceleration>config.maxCollapseAcceleration);
      const requiredObservationMs=(!config.liveTrading&&config.paperFastSafety)?config.paperMinObservationMs:config.minObservationMs;
      const requiredConfidence=(!config.liveTrading&&config.paperFastSafety)?learnedThresholds.paperConfidence:learnedThresholds.confidence;
      const antiFomoBlocked=!!(config.microCycleEnabled && micro?.antiFomoBlocked);
      if(config.thesisEnabled){const prior=c.thesis;c.thesis=buildDogThesis(c);c.thesisHistory=[...(c.thesisHistory??[]),c.thesis].slice(-12);if(prior?.decision!==c.thesis.decision)log.info(`[🐶 THESIS] ${c.token.name} ($${c.token.symbol}) | ${prior?.decision??"NEW"} → ${c.thesis.decision} | confidence ${c.thesis.confidence.toFixed(0)} | absorption ${c.thesis.supply.absorptionScore.toFixed(0)} | supply ${c.thesis.supply.supplyPressure.toFixed(0)}`);}

      // v1.17 OPPORTUNITY-FIRST lane: meme runners often move before every signal can "prove" itself.
      // Hard danger, route and basic liquidity/safety still gate entries, but normal-score perfection,
      // full structure confirmation and AI approval are NOT required for a small early paper entry.
      const opportunityLaneEnabled=config.opportunityFirstEnabled && ((!config.liveTrading&&config.opportunityEarlyPaperEnabled)||(config.liveTrading&&config.opportunityEarlyLiveEnabled));
      const opportunitySupply=c.thesis?.supply ?? undefined;
      const opportunitySignals=[
        buySellRatio>=config.opportunityMinBuySellRatio,
        volume1m>=config.opportunityMinVolume1mUsd,
        Number(c.demandBreadthScore??0)>=config.opportunityMinDemandBreadth,
        !!micro && (micro.state==="WAKING"||micro.state==="BUILDING"||micro.state==="BREAKOUT"||micro.state==="RUNNING"||micro.buyerAccelerationPct>0||micro.volumeAccelerationPct>0||micro.structureBreak||micro.higherLow),
        Number(snap.priceChange1mPct??snap.priceChange5mPct??0)>0,
        Number(c.runnerScore??0)>=config.opportunityMinRunnerScore
      ].filter(Boolean).length;
      const opportunityHardRisk= snap.onChainRisk?.devRisk==="high" || snap.onChainRisk?.holderRisk==="high" || snap.onChainRisk?.bundleRisk==="high";
      const opportunityEntry=opportunityLaneEnabled
        && age>=Math.min(requiredObservationMs,config.paperMinObservationMs)
        && tokenAgeMin<=config.opportunityMaxAgeMin
        && c.score>=config.opportunityMinScore
        && Number(c.runnerScore??0)>=config.opportunityMinRunnerScore
        && c.dataConfidence>=config.opportunityMinDataConfidence
        && routesOK
        && entryRisk.ok
        && !opportunityHardRisk
        && safetyScore>=config.opportunityMinSafetyScore
        && safetyComplete>=config.opportunityMinSafetyCompleteness
        && qualityScore>=config.opportunityMinQualityScore
        && liq>=config.opportunityMinLiquidityUsd
        && (!opportunitySupply || opportunitySupply.supplyPressure<=config.opportunityMaxSupplyPressure)
        && (!opportunitySupply || opportunitySupply.absorptionScore>=config.opportunityMinAbsorption)
        && opportunitySignals>=config.opportunityRequireSignals
        && (!micro || micro.lateEntryRisk<=config.opportunityMaxLateEntryRisk)
        && (!micro || micro.scoreAcceleration>config.maxCollapseAcceleration);
      const flame=config.flameEnabled
        && c.score>=config.flameMinScore
        && (c.runnerScore??0)>=config.flameMinRunnerScore
        && c.dataConfidence>=config.flameMinConfidence
        && sourceCount>=config.flameMinSources
        && buySellRatio>=config.flameMinBuySellRatio
        && volume1m>=config.flameMinVolume1mUsd
        && tokenAgeMin<=config.flameMaxAgeMin
        && routesOK
        && flameRisk.ok
        && safetyScore>=(veryYoung?config.veryYoungMinSafetyScore:config.normalMinSafetyScore)
        && safetyComplete>=(veryYoung?config.veryYoungMinSafetyCompleteness:config.normalMinSafetyCompleteness)
        && (veryYoung ? liq>=config.veryYoungMinLiquidityUsd : true)
        && (c.intelligence?.mode!=="CORE" || (c.dataConfidence>=90 && safetyComplete>=85 && liq>=Math.max(config.veryYoungMinLiquidityUsd,50000)))
        && microFlameOK;
      const aiEligibleBase=age>=requiredObservationMs
        && c.score>=config.aiCoinMinScore
        && c.score<=config.aiCoinMaxScore
        && c.dataConfidence>=requiredConfidence
        && routesOK
        && entryRisk.ok
        && !flame;
      let aiDecision: Awaited<ReturnType<typeof aiBrain.reviewCoin>> | undefined;
      if(aiEligibleBase) aiDecision=await aiBrain.reviewCoin(c);

      // AI is a constrained second opinion, not a replacement for deterministic safety.
      // 75-78: a confident PASS can veto; unavailable/no-opinion falls back to normal Dog Bot.
      // 72-74: AI may promote ONLY with very high confidence and all normal non-score gates already passed.
      const aiVeto=!!aiDecision?.ok && aiDecision.verdict==="PASS" && aiDecision.confidence>=config.aiCoinPassConfidence;
      const aiPromote=c.score<learnedThresholds.buyScore
        && !!aiDecision?.ok && aiDecision.verdict==="BUY" && aiDecision.confidence>=config.aiCoinPromoteConfidence;
      const scoreApproved=c.score>=learnedThresholds.buyScore || aiPromote;
      const thesisBuy=!config.thesisEnabled||c.thesis?.decision==="BUY";
      const normalEntry=age>=requiredObservationMs
        && scoreApproved
        && c.dataConfidence>=requiredConfidence
        && routesOK
        && entryRisk.ok
        && componentGates
        && ageSafetyOK
        && confirmationOK
        && thesisBuy
        && !aiVeto
        && !antiFomoBlocked;

      if(aiPromote) log.info(`[🤖 AI PROMOTE] ${c.token.name} ($${c.token.symbol}) | Score:${Math.round(c.score)} below adaptive normal ${learnedThresholds.buyScore}, but AI BUY ${aiDecision!.confidence}% | all hard gates passed`);
      if(aiVeto) log.warn(`[🤖 AI PASS] ${c.token.name} ($${c.token.symbol}) | Score:${Math.round(c.score)} | AI PASS ${aiDecision!.confidence}% | ${aiDecision!.reason}`);

      if(flame){
        c.state="READY"; c.entryLane="FLAME";
        c.decisionReason=`🔥 FLAME AUTO BUY | score ${Math.round(c.score)} | runner ${Math.round(c.runnerScore??0)} | micro ${Math.round(micro?.score??0)} | RP ${Math.round(micro?.runnerProbability??0)} | B/S ${buySellRatio.toFixed(1)}x | vol $${Math.round(volume1m)} | ${flameRisk.why}`;
        log.info(`[🔥 FLAME] ${c.token.name} ($${c.token.symbol}) | AUTO BUY | Score:${Math.round(c.score)} Runner:${Math.round(c.runnerScore??0)} Quality:${Math.round(c.qualityScore??0)} Data:${Math.round(c.dataConfidence)}% B/S:${buySellRatio.toFixed(1)}x Vol:$${Math.round(volume1m)} Sources:${sourceCount}`);
      } else if(opportunityEntry){
        c.state="READY"; c.entryLane="EARLY";
        c.decisionReason=`⚡ EARLY RUNNER BUY | opportunity-first | score ${Math.round(c.score)} | runner ${Math.round(c.runnerScore??0)} | signals ${opportunitySignals}/${6} | B/S ${buySellRatio.toFixed(2)}x | vol $${Math.round(volume1m)} | breadth ${Math.round(c.demandBreadthScore??0)} | liq $${Math.round(liq)} | hard safety clear`;
        log.info(`[⚡ EARLY RUNNER] ${c.token.name} ($${c.token.symbol}) | BUY BEFORE PERFECT | Score:${Math.round(c.score)} Runner:${Math.round(c.runnerScore??0)} Signals:${opportunitySignals}/6 Safety:${Math.round(safetyScore)}/${Math.round(safetyComplete)} Quality:${Math.round(qualityScore)} Liq:$${Math.round(liq)} B/S:${buySellRatio.toFixed(2)}x`);
      } else if(normalEntry){
        c.state="READY"; c.entryLane=c.score>=config.eliteScore?"ELITE":"NORMAL";
        const aiNote=aiDecision?.ok?` | 🤖 AI ${aiDecision.verdict} ${aiDecision.confidence}%${aiPromote?" PROMOTED":""}`:aiDecision?.budgetReason?` | 🤖 AI FALLBACK (${aiDecision.budgetReason})`:"";
        c.decisionReason=`${c.entryLane} APPROVED | score ${Math.round(c.score)} | quality ${Math.round(c.qualityScore??0)} | runner ${Math.round(c.runnerScore??0)} | micro ${Math.round(micro?.score??0)} RP ${Math.round(micro?.runnerProbability??0)} late ${Math.round(micro?.lateEntryRisk??0)} | ${entryRisk.why}${aiNote}`;
      } else if(config.thesisEnabled && c.state==="STALKING" && evaluateStalkInvalidation(c).invalid){
        const invalid=evaluateStalkInvalidation(c);
        c.state="DROPPED"; c.lastDroppedAt=Date.now(); c.invalidatedUntil=Date.now()+config.opportunityStalkCooldownMs;
        c.decisionReason=`❌ STALK INVALIDATED | ${invalid.reasons.join("; ")} | abandoned to save scans/API`;
        dogBrain.markDecision(c,"REJECTED");
        log.info(`[❌ STALK INVALIDATED] ${c.token.name} ($${c.token.symbol}) | ${invalid.reasons.join("; ")} | no more active scans`);
      } else if(config.thesisEnabled && c.thesis?.decision==="STALK" && (Date.now()-(c.stalkingSince??Date.now()))<config.thesisMaxStalkMs){
        c.state="STALKING";c.stalkingSince??=Date.now();
        c.decisionReason=`🐕 STALKING | thesis ${c.thesis.confidence.toFixed(0)}% | absorption ${c.thesis.supply.absorptionScore.toFixed(0)} | supply ${c.thesis.supply.supplyPressure.toFixed(0)} | WAIT: ${c.thesis.entryTriggers.slice(0,2).join("; ")}`;
        dogBrain.markDecision(c,"STALKING");
      } else if(antiFomoBlocked){
        c.state="DROPPED"; c.lastDroppedAt=Date.now(); c.decisionReason=`NO BUY: 🧯 ANTI-FOMO late-entry risk ${Math.round(micro?.lateEntryRisk??0)}/100 | cycle ${micro?.state??"?"} | runner probability ${Math.round(micro?.runnerProbability??0)}`; dogBrain.markDecision(c,"REJECTED");
      } else if(aiVeto){
        c.state="DROPPED"; c.lastDroppedAt=Date.now(); c.decisionReason=`NO BUY: 🤖 AI PASS ${aiDecision!.confidence}% | ${aiDecision!.reason}`; dogBrain.markDecision(c,"REJECTED");
      } else if(age>=config.maxObservationMs){
        c.state="DROPPED";c.lastDroppedAt=Date.now();
        const why=!routesOK?"buy/sell route unavailable":safetyScore<config.normalMinSafetyScore?`safety ${Math.round(safetyScore)} < ${config.normalMinSafetyScore}`:safetyComplete<config.normalMinSafetyCompleteness?`safety completeness ${Math.round(safetyComplete)}% < ${config.normalMinSafetyCompleteness}%`:qualityScore<config.normalMinQualityScore?`quality ${Math.round(qualityScore)} < ${config.normalMinQualityScore}`:liq<config.normalMinLiquidityUsd?`liquidity $${Math.round(liq)} < $${config.normalMinLiquidityUsd}`:!ageSafetyOK?"very-young/young token requires stronger safety + liquidity":!confirmationOK?`momentum not confirmed / decelerating (${micro?.scoreAcceleration?.toFixed(1)??"N/A"}/min²)`:c.score<learnedThresholds.buyScore?`score ${Math.round(c.score)} < adaptive ${learnedThresholds.buyScore}`:c.dataConfidence<requiredConfidence?`data ${Math.round(c.dataConfidence)}% < ${requiredConfidence}%`:!entryRisk.ok?entryRisk.why:"observation ended";
        c.decisionReason=`NO BUY: ${why}`; dogBrain.markDecision(c,"REJECTED");
      } else {
        c.state=c.score>=config.promoteScore?"DEVELOPING":"WATCHING";
        if(c.score>=learnedThresholds.buyScore&&!entryRisk.ok)c.decisionReason=`WAITING SAFETY: ${entryRisk.why}`;
        else if(c.score>=learnedThresholds.buyScore&&!routesOK)c.decisionReason="WAITING EXECUTION: buy/sell route not verified";
        else if(c.score>=learnedThresholds.buyScore&&age<requiredObservationMs)c.decisionReason=`READYING ENTRY: observation ${Math.round(age/1000)}s/${Math.round(requiredObservationMs/1000)}s`;
      }

      if(snap.dataErrors?.length&&snap.priceUsd==null&&!snap.dataErrors.some(x=>x.includes("cooldown")))log.warn(`[DATA] ${c.token.name} ($${c.token.symbol}) | ${snap.dataErrors.join(" | ")}`);
      log.scan({name:c.token.name,symbol:c.token.symbol,priceUsd:snap.priceUsd,score:c.score,confidence:c.dataConfidence,
        status:c.state==="READY"?"✅ READY":c.state==="STALKING"?"🐕 STALKING":c.state==="DROPPED"?"❌ NO BUY":`⏳ ${c.state}`,reason:c.decisionReason,sources:[...c.sources],rankText:this.rankText(c),
        details:{buys1m:snap.buys1m,sells1m:snap.sells1m,buys5m:snap.buys5m,sells5m:snap.sells5m,volume1mUsd:snap.volume1mUsd,volume5mUsd:snap.volume5mUsd,
          liquidityUsd:snap.liquidityUsd,holderCount:snap.holderCount,uniqueWallet1m:snap.uniqueWallet1m,
          top10HolderPct:snap.onChainRisk?.top10Pct??snap.top10HolderPct,top1HolderPct:snap.onChainRisk?.top1Pct,top5HolderPct:snap.onChainRisk?.top5Pct,bundleClass:snap.onChainRisk?.bundleRisk,devRisk:snap.onChainRisk?.devRisk,holderRisk:snap.onChainRisk?.holderRisk,linkedSupply:snap.onChainRisk?.estimatedLinkedSupplyPct,socialScore:snap.social?.score,socialAccounts:snap.social?.keyAccounts?.join(","),meta:snap.social?.dominantMeta?.slice(0,3).join("/"),smart:snap.smartMoney?.checked?`S:${snap.smartMoney.smartTraders} Sn:${snap.smartMoney.snipers} In:${snap.smartMoney.insiders} B:${snap.smartMoney.bundlers}`:undefined,metaRunner:c.metaRunner,microState:micro?.state,microScore:micro?.score,runnerProbability:micro?.runnerProbability,lateEntryRisk:micro?.lateEntryRisk,exhaustionRisk:micro?.exhaustionRisk,scoreVelocity:micro?.scoreVelocity,buyerAccel:micro?.buyerAccelerationPct,volumeAccel:micro?.volumeAccelerationPct,structureBreak:micro?.structureBreak,thesis:c.thesis?`${c.thesis.decision} A:${c.thesis.supply.absorptionScore.toFixed(0)} SP:${c.thesis.supply.supplyPressure.toFixed(0)}`:undefined,intelligence:c.intelligence?`${c.intelligence.mode} ${c.intelligence.coverage}% BE:${c.intelligence.birdeye} MO:${c.intelligence.mobula}`:undefined,deep:`S:${snap.onChainRisk?.checked?"Y":snap.onChainRisk?"~":"-"} BE:${finalBirdeye?"Y":"-"} H:${finalHolder?"Y":"-"} B:${finalBundle?"Y":"-"} R:${finalRoute?"Y":"-"}`}});
      if(c.state==="READY")await this.onReady(c);
    }catch(e){log.warn(`[SCAN ERROR] ${c.token.name} ${c.token.address}: ${e instanceof Error?e.message:String(e)}`);}finally{c.collecting=false;}
  }

  async tick(){
    await dogBrain.tick();
    const now=Date.now(); if(now-this.lastDiscovery>=config.discoveryIntervalMs){this.lastDiscovery=now;await this.discover();}
    const active=[...this.candidates.values()].filter(c=>!["DROPPED","BOUGHT","FAILED"].includes(c.state)).sort((a,b)=>this.priority(b)-this.priority(a));
    const dex=await this.dex.batch(active.map(c=>c.token.address));
    for(const c of active){const d=dex.get(c.token.address) as any;if(d){
      c.token.seed={...(c.token.seed??{}),...Object.fromEntries(Object.entries(d).filter(([k,v])=>v!==undefined&&!k.startsWith("token")))};
      if(c.token.name==="Unknown"&&d.tokenName)c.token.name=d.tokenName;
      if(c.token.symbol==="?"&&d.tokenSymbol)c.token.symbol=d.tokenSymbol;
      if(c.token.listedAt==null&&d.pairCreatedAt)c.token.listedAt=Number(d.pairCreatedAt);
      // Organic momentum lane: an already-known token can become a runner even if
      // it is no longer new. This is deliberately independent of paid DEX boosts.
      const buys=Number(d.buys5m??0), sells=Number(d.sells5m??0);
      const ratio=buys/Math.max(1,sells), p5=Number(d.priceChange5mPct??0);
      if(buys>=config.momentumMinBuys5m && ratio>=config.momentumMinBuySellRatio && p5>=config.momentumMinPrice5mPct){
        c.sources.add("dex-momentum");
        c.trendingRanks["dex-momentum"]=1;
      }
    }}
    // Re-sort after DEX data can promote an older token into the trending lane.
    const ordered=[...active].sort((a,b)=>this.priority(b)-this.priority(a));
    await Promise.all(ordered.map((c,i)=>this.collect(c,i)));
  }
}
