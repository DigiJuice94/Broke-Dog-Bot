import { Birdeye } from "./birdeye.ts";
import { Jupiter } from "./jupiter.ts";
import { config } from "./config.ts";
import { Scanner } from "./scanner.ts";
import { Trader } from "./trader.ts";
import { WalletService } from "./wallet.ts";
import { log } from "./log.ts";
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));

async function main(){
  const wallet=new WalletService(),birdeye=new Birdeye(),jupiter=new Jupiter(wallet),trader=new Trader(wallet,jupiter);
  const scanner=new Scanner(birdeye,jupiter,c=>trader.buy(c));
  log.info("🐱 BROKE CAT BOT HYBRID v1.0 — v8.3 SAFETY × NEW RUNNER DISCOVERY");
  log.info(`Mode: ${config.liveTrading?"🔴 LIVE":"🟡 PAPER / SCAN"}`); log.info(`Wallet: ${wallet.address??"NOT CONFIGURED"}`);
  log.info(`Entries: NORMAL ≥${config.buyScore} | ELITE ≥${config.eliteScore} | 🔥 FLAME ≥${config.flameMinScore} + early-runner pressure | observation ${config.minObservationMs/1000}-${config.maxObservationMs/1000}s`);
  log.info(`Discovery: Social watchlist + Mobula/Axiom-style + Birdeye + DEX/FOMO | v8.3-style Helius launch/holder safety added`);
  log.info(`Social: ${config.xBearerToken?"OPTIONAL X CONFIGURED":"OFF"} | discovery/confirmation only — never a mandatory normal-buy trigger`);
  log.info(`Exits: Jupiter executable P/L | normal TP +${config.takeProfitPct}% / hard -${config.hardStopLossPct}% | 🔥 TP +${config.flameTakeProfitPct}% / stop -${config.flameStopLossPct}%`);
  log.info(`Mobula Axiom-style: ${config.mobulaApiKey?"ON":"OFF — add MOBULA_API_KEY"} | interval ${Math.round(config.mobulaTrendingIntervalMs/1000)}s`);
  log.info(`Birdeye: new ${Math.round(config.birdeyeNewIntervalMs/60000)}m | trending ${Math.round(config.birdeyeTrendingIntervalMs/60000)}m | deep top ${config.birdeyeDeepCandidates} at score ≥${config.birdeyeDeepMinScore} | CU budget ${config.birdeyeCuBudgetPerHour}/hr`);
  log.info(`Positions: 2 normal slots + reserved 3rd slot for score ${config.thirdPositionScore}+ | max allocation ${config.maxPositionWalletPct}% | daily loss brake $${config.maxDailyLossUsd}`);
  log.info(`SOL/USD: background cache | Coinbase → DEX Screener → Jupiter emergency fallback | refresh ${Math.round(config.solUsdRefreshMs/1000)}s`);
  if(!config.xBearerToken)log.warn("X_BEARER_TOKEN missing — expected/OK. Social/meta discovery is skipped; market + on-chain scoring continue normally.");
  if(!config.mobulaApiKey)log.warn("MOBULA_API_KEY missing — popular Axiom-style runner discovery unavailable; bot will use fallbacks.");
  if(!config.birdeyeApiKey)log.warn("BIRDEYE_API_KEY missing — Birdeye discovery/deep enrichment unavailable.");
  if(!config.heliusApiKey)log.warn("HELIUS_API_KEY missing — v8.3-style holder/launch/dev safety cannot verify NORMAL/ELITE buys. FLAME can still use its calculated-risk exception if no hard veto is known.");
  if(!config.jupiterApiKey)log.warn("JUPITER_API_KEY missing — route verification/trading unavailable.");
  if(config.liveTrading&&!wallet.address)throw new Error("LIVE_TRADING=true but wallet private key is missing");
  await trader.warmSolPrice();
  await trader.initialize();
  let lastPositionPoll=0;
  while(true){try{await scanner.tick();}catch(e){log.error("[LOOP]",e);}if(Date.now()-lastPositionPoll>=config.positionPollMs){lastPositionPoll=Date.now();try{await trader.monitorPositions();}catch(e){log.error("[POSITIONS]",e);}}await sleep(config.observationTickMs);}
}
main().catch(e=>{console.error(e);process.exit(1);});
