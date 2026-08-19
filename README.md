# Broke Dog Bot v1.9.0 — Peak-Profit Ratchet

**v1.9.0 changes:**
- Adds the approved **peak-profit ratchet** to PAPER and LIVE exits.
- Once a position has reached **+10% peak profit**, the bot protects a **+2% profit floor**.
- After the +10% arm point, the bot exits if the trade gives back **70% of its peak gain**. Example: a +13.3% peak triggers the giveback exit around +4.0%, instead of allowing the trade to turn into a normal stop-loss.
- LIVE mode uses **Jupiter executable P/L** for the ratchet; PAPER mode uses tracked market P/L. Existing hard stops, momentum stops, take-profit, liquidity-collapse protection, and lane-specific trailing exits are preserved.
- Position logs now show **peak giveback %** so it is obvious when a winner is fading.
- Dog Brain now records **entry/exit, max peak, percent of peak surrendered, exit reason**, plus **1m / 5m / 15m / 30m / 60m post-exit outcomes**.
- Adds configurable `PEAK_PROFIT_ARM_PCT=10`, `PEAK_PROFIT_FLOOR_PCT=2`, and `PEAK_GIVEBACK_EXIT_PCT=70`.

# Broke Dog Bot v1.8.0 — Dog Brain Self-Critique Email

**v1.8.0 changes:**
- Adds a dedicated **🛠️🐶 WHAT I WANT MY CREATOR TO IMPROVE ABOUT ME** section to hourly and daily email reports.
- Dog Brain now critiques system-level weaknesses separately from strategy settings: discovery/source attribution, bundle/holder coverage, sell-route intelligence, entry-timing history, exit counterfactual analysis, and durable learning/audit data.
- Each self-improvement request includes evidence, exact feature/code/data improvement requested, expected benefit, priority, and confidence.
- Keeps precise strategy recommendations, more-data requests, dual PAPER/LIVE wallet sections, and suggested tweet.
- Recommendations remain advisory only; no automatic code/strategy rewrites.
- Keeps v1.7.1 quiet safety logs.

# Broke Dog Bot v1.4.2 — DEX Rate-Limit + $1,000 Paper Bankroll

**v1.4.2 changes:**
- Paper wallet default starting bankroll is now **$1,000**.
- Existing v1.4.x paper state is funded from the legacy $25 base to the new $1,000 base **once**, preserving existing P&L and open paper positions.
- Paper sizing stays controlled: **NORMAL max $25, ELITE max $35, FLAME max $50** by default.
- Keeps all v1.4.1 DEX Screener 429 / Cloudflare 1015 rate-limit protection.
- Override with `PAPER_START_BALANCE_USD`, `PAPER_NORMAL_MAX_USD`, `PAPER_ELITE_MAX_USD`, and `PAPER_FLAME_MAX_USD`.

This is a new bot codebase built to combine the strongest behavior of two prior bots:

- **v8.3-style trade quality and safety data**
- **new-bot discovery, runner tracking, Jupiter executable exits, wallet control, and emoji logs**

## Entry lanes

### NORMAL — score 75–89
Requires v8.3-style on-chain safety verification through Helius. Unknown launch/bundle risk is not accepted for normal entries.

### ELITE — score 90+
Uses the same strict safety gate. ELITE candidates may use the reserved third position when the first two slots are occupied.

### 🔥 FLAME — calculated-risk early runner
FLAME is intentionally not the conservative lane. It is for rare, very high-scoring early runners with exceptional momentum, multiple discovery signals, high data confidence, strong buy/sell pressure, and confirmed Jupiter buy/sell routes. It may accept incomplete/medium risk data, but explicit high bundle risk, extreme holder concentration, or dangerous mint/freeze authority is a hard veto.

Default FLAME exit: **+25% take profit / -12% stop**, with profit protection armed at +12% and a 6-point trailing giveback.

## v8.3 safety data restored

The Helius risk module collects:

- top 1 / top 5 / top 10 holder concentration
- mint authority
- freeze authority
- crowded launch slots
- repeated early actors
- shared funding wallets
- estimated linked supply
- bundle/launch risk classification
- holder risk classification
- dev authority risk classification

The market-quality score also uses the v8.3 ideas of liquidity, 5m volume, volume acceleration, buy/sell ratio, momentum, market-cap range, and volume/liquidity sanity.

## Discovery kept from the newer bot

- DexScreener profiles / boosts / momentum
- Birdeye new + trending enrichment
- Mobula/Axiom-style runner discovery
- optional Axiom/FOMO feeds
- social/meta discovery if X is configured
- repeat snapshots and acceleration tracking

## Position rules

- 2 standard open positions
- third position only for score 90+
- dynamic wallet sizing with a default 30% maximum allocation per trade
- third slot default allocation ceiling 20%
- $5 default daily realized-loss brake

## Position recovery

Positions are persisted to `broke-dog-hybrid-state.json` and the live wallet is reconciled every 30 seconds. If a token exists in the wallet but is missing from memory/state, the bot creates a recovered position and logs `♻️ RECOVERED POSITION`. A sell does not remove the position until the wallet balance is effectively zero. Failed sells retain the position.

## Important deployment variables

For the full hybrid behavior, configure at minimum:

- `JUPITER_API_KEY`
- `HELIUS_API_KEY`
- `BIRDEYE_API_KEY`
- `BS58_PRIVATE_KEY` and `LIVE_TRADING=true` only when ready for live execution

Without Helius, NORMAL/ELITE entries intentionally cannot pass the v8.3-style safety gate. FLAME remains the controlled early-runner exception.

## Railway

The included `railway.json`, `Procfile`, and `package.json` use `npm start` / `tsx index.ts`.

Start in paper mode first:

```bash
LIVE_TRADING=false
npm start
```


## v1.9.2 — Dog Brain Persistent Memory Guard

This update prevents Dog Brain learning from depending on Railway's disposable deployment filesystem. If a Railway Volume is mounted, the bot automatically uses `RAILWAY_VOLUME_MOUNT_PATH` (or `DOG_BRAIN_DATA_DIR` if set) for Dog Brain memory, trading state, and the paper ledger.

Dog Brain writes JSON atomically and keeps two rolling backup copies (`.bak1` and `.bak2`). On startup it can recover from a backup if the primary JSON is damaged. It also attempts a one-time migration from legacy local files when those files are still visible. Startup logs now print `MEMORY RESTORED`, NORMAL/FLAME sample counts, record count, and whether storage is `PERSISTENT` or `LOCAL/EPHEMERAL`.

**Railway setup:** add a persistent Volume to the service (recommended mount path `/data`). No strategy setting changes are required. Once the startup log says `PERSISTENT (/data)` and shows the expected sample/record counts, future code redeploys can reuse the same learning files. The bot cannot recover a legacy ephemeral file after Railway has already destroyed that old deployment, so make the first migration before intentionally deleting/resetting the service.

Paper sizing defaults in this build are also updated to NORMAL $75 / ELITE $85 / FLAME $100. Railway environment variables still override these defaults.

## v1.1 Paper Wallet Tracker

When `LIVE_TRADING=false`, the bot now uses a dedicated simulated cash wallet instead of the real SOL balance for position sizing. Set `PAPER_START_BALANCE_USD` to choose the starting bankroll.

Railway logs show high-visibility emoji summaries for equity, cash, open-position value, lifetime P&L, realized/unrealized P&L, daily P&L, wins, losses, win rate, best trade and worst trade. Paper buys and sells are also written to `PAPER_LEDGER_FILE`.

Optional simulated costs are controlled with `PAPER_TRACK_FEES`, `PAPER_TRACK_SLIPPAGE`, `PAPER_FEE_PCT`, and `PAPER_SLIPPAGE_PCT`. Defaults total 1.00% on paper exits so paper results are less optimistic.

Important: Railway's normal filesystem may not survive redeploys. For long-term paper-wallet history, mount a Railway persistent volume and point `STATE_FILE` and `PAPER_LEDGER_FILE` into that mounted path.


## 🧠 Dog Brain v1 (v1.2)
Dog Brain is a controlled self-learning layer that stays ON in both PAPER and LIVE modes. It records every evaluated candidate, freezes the decision-time feature vector, then follows bought and rejected coins at 1m, 5m, 15m, 30m and 1h. It learns separate NORMAL and FLAME feature weights from runner/dump outcomes.

Guardrails: learning stays enabled in live and paper modes, requires a minimum sample count, feature weights and daily movement are capped, total learned score adjustment is capped, hard route/on-chain/rug gates remain outside the learner, and a recent-performance deterioration window resets learned weights automatically. State persists in `broke-dog-brain-v1.json` by default.

Logs use `🧠🐶`, including missed runners, avoided rugs/dumps, learned outcomes and the daily learning report.

## v1.2.2 buy threshold

The standard NORMAL buy threshold is now **75/100** by default (`BUY_SCORE=75`). Scores at or above 75 are buy-eligible only after the existing route, data-confidence, observation, and hard safety/rug checks pass. Dog Brain learned score adjustments continue to operate within their configured caps.


## v1.3.0 — Fresh Discovery Rotation

Dog Bot no longer lets a full 24-coin watch pool starve new discoveries. The active pool now defaults to 36, discovery targets up to 18 fresh candidates per cycle, Mobula rotates through a 50-token ranked result set, and stale sub-50 candidates older than 90 seconds can be rotated out to make room. Logs now show `fresh-cycle` and `unique-today` so you can see how many different coins the bot is actually trying. Promising/READY candidates are never evicted by the freshness rotation, and normal safety gates remain unchanged.


## v1.4.1 — Faster Safety + More Learning Data

Paper mode now uses a deliberately simpler decision path so Dog Brain can collect enough real examples to learn from:

1. Discover + score the candidate.
2. Start one cached Helius fast-safety check in parallel.
3. In paper mode, hard-block only explicit dangerous mint/freeze authority, extreme holder concentration, or an explicit high bundle/launch signal.
4. Buy or reject and keep tracking the outcome at 1m / 5m / 15m / 30m / 1h.

The fast safety check defaults to a 3.5-second timeout and 90-second cache. Strong candidates are prechecked early so they should reach the buy threshold with safety already finished. Railway logs now show `🛡️ SAFETY VERIFIED in ...ms`.

Extra Birdeye, bundle, route, smart-money and deep launch/funder work is still useful data, but it is no longer allowed to become another paper-mode veto layer. When a finalist appears in paper mode, those enrichments can finish in the background while the single fast-safety result controls the safety decision.

Paper-mode route availability is recorded but does not block a simulated trade. Live mode remains stricter: executable Jupiter routes and the strict on-chain safety gate are still required.

Paper defaults are also tuned to create more learning samples: `PAPER_MIN_OBSERVATION_MS=10000` and `PAPER_MIN_DATA_CONFIDENCE=60`. Candidates skipped because the wallet/position cap, daily loss brake, insufficient paper cash, or a failed buy are now explicitly recorded as rejected decisions so Dog Brain can follow them counterfactually instead of losing the sample.

### v1.11.1 daily-loss split
Paper and live trading now have independent daily loss brakes. Use `PAPER_MAX_DAILY_LOSS_USD` (default `$50`) for paper data collection and `LIVE_MAX_DAILY_LOSS_USD` (default `$7`) for live capital protection. `MAX_DAILY_LOSS_USD` remains as a legacy live fallback only. A paper loss no longer locks the live wallet, and the live loss brake no longer stops paper learning.


## v1.4.1 — DEX Rate-Limit Protection
- Scanner and Trader now share one DEX Screener request throttle and cache.
- DEX calls are spaced by default at least 1.2s apart.
- Discovery feeds run every 60s by default instead of every 15s.
- Token enrichment is cached for 30s by default.
- HTTP 429 / Cloudflare 1015 triggers a 90s DEX cooldown instead of repeated hammering.
- Error logs truncate HTML bodies so Railway logs stay readable.
- Dog Brain and paper trading continue using cached/other-source data during DEX cooldowns.

## v1.5.0 — Separate Hourly Paper + Live Email Reports

This release adds Resend-powered email reporting without mixing paper results with live results.

### Railway variables

```env
EMAIL_REPORT_ENABLED=true
RESEND_API_KEY=re_xxxxxxxxx
REPORT_EMAIL=you@example.com
REPORT_FROM=Broke Dog Bot <onboarding@resend.dev>
REPORT_INTERVAL_MINUTES=30
REPORT_TIMEZONE=America/Denver
HOURLY_PAPER_REPORT=true
HOURLY_LIVE_REPORT=true
DAILY_EMAIL_REPORT=true
```

The bot sends distinct `PAPER DOG REPORT` and `LIVE DOG REPORT` emails. Paper reports include paper equity/cash/open value, paper P&L, paper trades, wins/losses, open positions, and PAPER Dog Brain observations. Live reports use live wallet/position data and LIVE-labeled Dog Brain observations. Daily summaries are also kept separate.

Dog Brain records created by v1.5.0 are tagged `PAPER` or `LIVE`. Older records remain readable and are assigned to the mode of the process that loads them for backward compatibility.

Resend's default `onboarding@resend.dev` sender is intended for testing. For broader production delivery, configure a verified sender/domain in Resend and set `REPORT_FROM` accordingly.


## v1.7.1 — Dual-wallet email + Dog Brain insights

Hourly and daily email reporting now sends one combined report with two clearly isolated sections: PAPER WALLET and LIVE WALLET. Paper P&L/trades never count toward live P&L/trades, and live history never counts toward paper results.

Dog Brain reporting now explains what it has learned from the current report window and produces guarded improvement ideas based on resolved samples, missed runners, avoided dumps/rugs, learned feature weights, and recent win rate. These are advisory only; Dog Brain's existing bounded-weight/rollback safety controls remain unchanged.


## v1.7.1 Email Paper Wallet Performance
Hourly and daily email reports now include the same full PAPER WALLET performance block shown in Railway logs: starting balance, equity, cash, open value, total P&L/return, realized/unrealized/today P&L, lifetime wins/losses/win rate, best trade, and worst trade. Last-hour trade counts remain separate below the lifetime stats.


## v1.7.1 Creator Intelligence Email
Hourly/daily email now includes exact creator-facing parameter tests with current/proposed values, evidence, upside/risk, confidence and sample size; a What Dog Brain Wants More Data On section; and a <=280-character suggested tweet at the very bottom. Suggested changes are advisory only and are never auto-applied. Tweets are draft-only and never auto-posted.


## v1.9.2 Quiet rate-limit retries
Routine provider `429` retry/backoff messages are silent by default so Railway logs are not flooded. Retries still happen exactly as before. Set `RATE_LIMIT_VERBOSE=true` temporarily if you need to debug throttling. Final request failures are not converted into successes or ignored by this change.

## v1.10.0 — Free AI Brain (OpenRouter)

This version adds an optional external AI analyst that reviews Dog Brain's 2-hour report data as a profit-focused co-analyst. It is intentionally **advisor-only**: it cannot place trades, alter environment variables, rewrite strategy code, bypass safety, or change risk settings.

Railway variables:

- `AI_BRAIN_ENABLED=true`
- `OPENROUTER_API_KEY=<your OpenRouter key>`
- `AI_BRAIN_MODEL=openrouter/free`
- `AI_BRAIN_TIMEOUT_MS=30000`
- `AI_BRAIN_MAX_TOKENS=1200`
- `AI_BRAIN_MAX_CHARS=8000`

If OpenRouter is unavailable, rate-limited, times out, or returns an error, Broke Dog Bot continues normally and the regular Dog Brain keeps learning. Paper and live evidence are kept separate; when live trading is off, the live AI review is skipped.


## v1.10.2 — 30-Minute Profit Coach
- Default email cadence is now 2 hours (`REPORT_INTERVAL_MINUTES=30`).
- Each 2-hour email uses one combined OpenRouter AI call to conserve the free request quota while keeping PAPER and LIVE evidence explicitly separate.
- AI now reports: what is working, what is hurting profitability, how Dog Brain should improve, highest-impact parameter tests, entry/coin-selection quality, exit/profit-protection quality, and a path toward better expected profitability.
- AI is still advisor-only: it cannot place trades, change environment variables, rewrite code, bypass safety, or change risk settings.
- The daily summary does not make a separate AI request, preserving the free-model request budget for the 2-hour reports.


## v1.10.2 — Credit-Smart AI Buy Gate
- Deep AI profit-coach email every 2 hours (12/day if continuously running).
- AI coin review only in the near-buy score window (default 72–78).
- Scores 75–78: confident AI PASS can veto; AI unavailable falls back to normal Dog Bot rules.
- Scores 72–74: AI can promote only with >=90% BUY confidence AND all deterministic observation/data/route/safety gates already pass.
- Scores above 78 and FLAME candidates do not spend AI calls by default.
- Hard safety always wins; AI cannot override a safety failure.
- Daily cap defaults: 30 coin reviews, 44 total AI calls. This leaves headroom beyond the normal 12 report calls.
- AI call usage is persisted via AI_USAGE_FILE / Railway Volume so redeploys do not reset the day's counter.
- If OpenRouter is unavailable, rate-limited, or the budget is exhausted, normal Dog Bot trading continues.

## v1.11.0 — Micro-Cycle + Trade Forensics
- Adds Dog Brain Micro-Cycle states: DEAD → WAKING → BUILDING → BREAKOUT → RUNNING → EXHAUSTING.
- Tracks score velocity/acceleration, buyer acceleration, volume acceleration, price velocity, buy/sell pressure, money flow, structure breaks and higher lows.
- Adds a bounded micro-cycle score adjustment (default ±8) on top of the existing scoring system.
- Adds Anti-FOMO blocking for very late/extended entries (default late-entry risk >=82).
- FLAME now additionally requires strong Micro-Cycle + Runner Probability when the engine has enough data.
- Every new position persists its full entry-analysis snapshot so restarts do not erase trade context.
- Paper SELL ledger records hold time, peak P&L, peak giveback, exit reason and full entry-analysis data.
- Email reports add a per-trade Trade Forensics section for comparing winners vs losers.
- Existing Dog Brain memory file/path is unchanged; this upgrade does not intentionally reset learned history.
