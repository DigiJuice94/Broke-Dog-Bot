# Broke Dog Bot Hybrid v1.0

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
