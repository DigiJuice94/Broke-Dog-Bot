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
REPORT_INTERVAL_MINUTES=60
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
