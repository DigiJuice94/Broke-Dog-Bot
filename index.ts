import { Birdeye } from "./birdeye.ts";
import { Jupiter } from "./jupiter.ts";
import { config } from "./config.ts";
import { Scanner } from "./scanner.ts";
import { Trader } from "./trader.ts";
import { WalletService } from "./wallet.ts";
import { log } from "./log.ts";
import { dogBrain } from "./dogBrain.ts";
import { aiBrain } from "./aiBrain.ts";
import { EmailReporter } from "./reporting.ts";
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));

async function main(){
  dogBrain.boot();
  const wallet=new WalletService(),birdeye=new Birdeye(),jupiter=new Jupiter(wallet),trader=new Trader(wallet,jupiter);
  const scanner=new Scanner(birdeye,jupiter,c=>trader.buy(c));
  const emailReporter=new EmailReporter(trader);
  log.info("🐶 BROKE DOG BOT v1.18.0 — OMO-STYLE OPERATING MODEL");
  log.info(`Mode: ${config.liveTrading?"🔴 LIVE":"🧪 PAPER TRADING"}`);
  log.info(`🐕 OMO STYLE: ${config.omoStyleEnabled?"ON":"OFF"} | scan → quick safety → BUY EARLY/STALK → ADD/HOLD/EXIT | score is advisory, hard danger + routes still gate`); log.info(`Wallet: ${wallet.address??"NOT CONFIGURED"}`);
  const adaptive=dogBrain.adaptiveSnapshot();
  log.info(`Entries: NORMAL base ≥${config.buyScore} / adaptive ≥${adaptive.buyScore} | ELITE ≥${config.eliteScore} | 🔥 FLAME ≥${config.flameMinScore} + early-runner pressure | observation ${(!config.liveTrading&&config.paperFastSafety?config.paperMinObservationMs:config.minObservationMs)/1000}-${config.maxObservationMs/1000}s`);
  if(!config.liveTrading&&config.paperFastSafety)log.info(`🛡️ PAPER FAST SAFETY: ONE gate | timeout ${config.safetyTimeoutMs}ms | cache ${Math.round(config.safetyCacheMs/1000)}s | hard veto only on explicit danger | route/deep enrichment do not block paper entries`);
  log.info(`Discovery rotation: active cap ${config.maxActiveCandidates} | fresh target ${config.freshCandidatesPerCycle}/cycle | rotate stale score <${config.staleEvictScore} after ${Math.round(config.staleEvictAgeMs/1000)}s | Mobula ranked pool ${config.mobulaTrendingLimit}`);
  log.info(`Discovery: Social watchlist + Mobula/Axiom-style + Birdeye + DEX/FOMO | v8.3-style Helius launch/holder safety added`);
  log.info(`Social: ${config.xBearerToken?"OPTIONAL X CONFIGURED":"OFF"} | discovery/confirmation only — never a mandatory normal-buy trigger`);
  log.info(`Exits: ADAPTIVE runner-aware | base normal TP +${config.takeProfitPct}% / adaptive hard -${adaptive.hardStop}% / soft -${adaptive.softStop}% | 🔥 TP +${config.flameTakeProfitPct}% / stop -${config.flameStopLossPct}% | 🛡️ peak ratchet arms +${config.peakProfitArmPct}% → floor +${config.peakProfitFloorPct}% / exit at ${config.peakGivebackExitPct}% peak giveback`);
  log.info(`Mobula Axiom-style: ${config.mobulaApiKey?"ON":"OFF — add MOBULA_API_KEY"} | interval ${Math.round(config.mobulaTrendingIntervalMs/1000)}s`);
  log.info(`Birdeye: new ${Math.round(config.birdeyeNewIntervalMs/60000)}m | trending ${Math.round(config.birdeyeTrendingIntervalMs/60000)}m | deep top ${config.birdeyeDeepCandidates} at score ≥${config.birdeyeDeepMinScore} | CU budget ${config.birdeyeCuBudgetPerHour}/hr`);
  log.info(`Positions: 2 normal slots + reserved 3rd slot for score ${config.thirdPositionScore}+ | trade AMOUNTS remain configuration-locked (AI cannot change sizing) | paper daily loss brake $${config.paperMaxDailyLossUsd} | live daily loss brake $${config.liveMaxDailyLossUsd}`);
  log.info(`🧠🔧 Autonomous learning: ${config.dogBrainAutonomous?"ON":"OFF"} | runner patience ${adaptive.runnerPatience.toFixed(1)} | adaptations ${adaptive.adaptations} | memory persistence required:${config.dogBrainRequirePersistence?"YES":"NO"}`);
  if(!config.liveTrading)log.info(`💰🐶 Paper wallet: starts $${config.paperStartBalanceUsd.toFixed(2)} | sizing caps EARLY $${config.paperEarlyMaxUsd} / NORMAL $${config.paperNormalMaxUsd} / ELITE $${config.paperEliteMaxUsd} / FLAME $${config.paperFlameMaxUsd} | simulated costs ${(config.paperTrackFees?config.paperFeePct:0)+(config.paperTrackSlippage?config.paperSlippagePct:0)}% | persistent ledger ${config.paperLedgerFile}`);
  log.info(`🧠 ${dogBrain.startupText()} | checkpoints 1m/5m/15m/30m/1h | max learned score ±${config.dogBrainMaxScoreAdjustment}`);
  log.info(`🤖 ${aiBrain.startupText()} | emails every ${Math.round(config.reportIntervalMs/60000)}m | hard safety always wins`);
  log.info(`📧 Reports: ${emailReporter.enabled()?`ON → ${config.reportEmail} every ${Math.round(config.reportIntervalMs/60000)}m | PAPER:${config.hourlyPaperReport?"ON":"OFF"} LIVE:${config.hourlyLiveReport?"ON":"OFF"} | daily:${config.dailyEmailReport?"ON":"OFF"}`:"OFF — add RESEND_API_KEY + REPORT_EMAIL + EMAIL_REPORT_ENABLED=true"}`);
  log.info(`SOL/USD: background cache | Coinbase → DEX Screener → Jupiter emergency fallback | refresh ${Math.round(config.solUsdRefreshMs/1000)}s`);
  if(!config.xBearerToken)log.warn("X_BEARER_TOKEN missing — expected/OK. Social/meta discovery is skipped; market + on-chain scoring continue normally.");
  if(!config.mobulaApiKey)log.warn("MOBULA_API_KEY missing — popular Axiom-style runner discovery unavailable; bot will use fallbacks.");
  if(!config.birdeyeApiKey)log.warn("BIRDEYE_API_KEY missing — Birdeye discovery/deep enrichment unavailable.");
  if(!config.heliusApiKey)log.warn(config.liveTrading?"HELIUS_API_KEY missing — strict live NORMAL/ELITE safety cannot verify entries.":"HELIUS_API_KEY missing — fast safety cannot verify; PAPER learning mode can still simulate entries when no hard-danger evidence is available.");
  if(!config.jupiterApiKey)log.warn("JUPITER_API_KEY missing — route verification/trading unavailable.");
  if(config.liveTrading&&!wallet.address)throw new Error("LIVE_TRADING=true but wallet private key is missing");
  await trader.warmSolPrice();
  await trader.initialize();
  let lastPositionPoll=0,lastEmailReport=Date.now();
  while(true){try{await scanner.tick();}catch(e){log.error("[LOOP]",e);}if(Date.now()-lastPositionPoll>=config.positionPollMs){lastPositionPoll=Date.now();try{await trader.monitorPositions();}catch(e){log.error("[POSITIONS]",e);}}if(emailReporter.enabled()&&Date.now()-lastEmailReport>=config.reportIntervalMs){lastEmailReport=Date.now();void emailReporter.sendHourly();}void emailReporter.maybeDaily();await sleep(config.observationTickMs);}
}
main().catch(e=>{console.error(e);process.exit(1);});
