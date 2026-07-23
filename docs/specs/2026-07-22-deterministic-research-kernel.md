# Deterministic Trading Research Kernel

**Status:** PRE-REGISTERED — written before the first result is run
**Branch:** `feat/deterministic-trading-research-kernel`
**Capital model:** $3,000 paper NAV; no live-order capability
**Trial ID:** `H1-TREND-DAILY-20260722-001`
**Evaluation as-of:** `2026-07-22T00:00:00.000Z`
**Input begins:** `2023-04-10T00:00:00.000Z`
**Holdout begins:** `2025-07-27T00:00:00.000Z`

## Decision

Build a strict, read-only research kernel beside the existing simulator. Do not route
strategy decisions through the current Supabase ledger because its close path appears
to double-count realized PnL and its production liquidation/exit controls are incomplete.

The first hypothesis is BTC/ETH long-or-cash time-series momentum. It is a screening
test, not evidence of profitability and not authorization to paper-deploy or trade live.

## Why this hypothesis

- It can be stated before seeing results and replayed exactly.
- It does not require news timing, market-making latency, private order flow, or wallet
  identity persistence.
- It matches the operator's useful observation that large crypto trends are sometimes
  directionally obvious while removing the impulse to keep adding risk.
- It is low turnover, so fees and slippage are less likely to dominate by construction.

## Frozen hypothesis H1

Universe: BTC and ETH perpetual markets only.

The canonical input is frozen from `2023-04-10T00:00:00.000Z` inclusive through
`asOfMs = 1784678400000` (`2026-07-22T00:00:00.000Z`) exclusive: 1,199 completed
UTC daily candles ending on 2026-07-21. This reachable common start was selected from
an availability-only API probe; no returns, indicators, or strategy results were
calculated from that probe. The normalized BTC/ETH input is persisted as a
content-addressed snapshot; the report records its SHA-256 and the git commit. The
first 839 calendar days are development history and the final 360 days are holdout.

For each asset, using completed UTC daily candles:

1. At day `t` close, calculate `r28[t] = close[t] / close[t-28] - 1`.
2. Calculate the 84-day exponential moving average using only data through `t`.
   Use `alpha = 2 / 85`, seed index 83 with the simple mean of closes 0–83, and
   recursively update from index 84 onward.
3. Enter or remain long when the 28-day return is positive **and** close is above the
   84-day EMA. Otherwise remain in cash or exit.
4. A changed signal may fill only at day `t+2` open. This deliberate full-day latency
   makes the fill causal without pretending the first print after the UTC boundary was
   observable after the candle had been received and processed.
5. Trailing volatility uses the 20 log returns ending at `t`, sample standard deviation
   (`n-1`), annualized by `sqrt(365)`. Zero or non-finite volatility means no entry.
6. Position notional is frozen on entry and equals:

   `min($750, $750 × min(1, 20% / trailing-20d annualized volatility))`

7. BTC and ETH each have a $750 entry cap. The doubled-cost ledger is the allocation
   controller so base and stress runs receive byte-identical quantities. At an execution
   open, process exits first and value retained positions at that reference open. Let
   `stressEntryRate = 2 × (feeRate + slippageRate)`, `retainedGross` be retained marked
   notional, and `controllerNAV` be doubled-cost NAV after exits. New-entry budget is:

   `max(0, min($1,500 - retainedGross, (controllerNAV - retainedGross) / (1 + stressEntryRate)))`

   Desired entries are scaled pro rata to that budget and assigned in alphabetical asset
   order, with the last assignment receiving the exact floating-point remainder. If the
   budget is zero, both ledgers skip the entries. Quantity is frozen until exit; marked
   notional may drift with price and is reported explicitly. The formula guarantees that
   retained gross plus new gross plus worst-case entry costs cannot exceed controller NAV.
   If either ledger reaches non-positive NAV, force-close and return `PRICE_EDGE_REJECT`.
8. Execution units are `targetNotional / referenceOpen`. Buy/sell slippage is charged as
   a separate adverse cash cost on reference notional; the 4.5-bps fee is charged
   separately on actual reference notional on every entry and exit. This
   ordering is fixed and every cost is applied exactly once.
9. Charge 4.5 bps taker fee plus 5 bps conservative slippage on every execution.
10. Run a second price-edge result with both fee and slippage doubled. Generate the
    position schedule once using that doubled-cost controller and replay its exact entry
    and exit quantities in the base-cost ledger; signals and allocations must therefore
    be identical by construction.
11. At the final completed candle, mark open positions from that day's open to close,
   force-close at the close, charge exit costs, and record `dataset_end` as the reason.
12. No entry leverage, shorting, averaging down, discretionary entry, parameter tuning,
   or manual trade insertion is permitted. Frozen quantity can make marked exposure
   drift above its entry ratio; that drift is reported and never triggers a risk trim.

The first eligible signal is index 83 (the EMA seed); the first possible execution is
index 85 after the full-day delay. All comparisons use only observations through the
named signal index.

Funding and intraday stop execution are not modeled in this price-edge screen. Reports
must not call its PnL or expectancy "net"; every result is preliminary and forces
`promotionEligible = false` regardless of performance.

## Data contract

Only Hyperliquid's official `candleSnapshot` response is accepted. The adapter must:

- reject HTTP failures, malformed rows, duplicates, non-finite/zero prices, and gaps;
- validate symbol, `1d` interval, `t`/`T`, UTC alignment, OHLC ordering, and volume;
- paginate deterministically because time-range responses contain at most 500 elements:
  `startTime` is inclusive, the next page starts at `last T + 1`, `endTime` remains
  `asOfMs - 1`, and empty/non-advancing pages fail the run;
- enforce `maxPages = ceil(expectedCandles / 500) + 1`, reject requested ranges above the
  official 5,000-candle history ceiling, and detect duplicates across page joins;
- require exactly 1,199 candles spanning the frozen start through 2026-07-21; BTC and ETH
  must have an identical calendar;
- sort and validate exact daily spacing and require `T < asOfMs`;
- discard the still-open current candle;
- preserve source, endpoint, requested window, and as-of boundary in the canonical input;
- never call the simulator's CryptoCompare/Binance sources or random candle fallback.

Fetch time is non-canonical metadata. The canonical snapshot and result use stable key
ordering; identical frozen input and config must produce byte-identical canonical JSON
and the same SHA-256.

The snapshot writer records raw-response SHA-256 values and refuses to overwrite an
existing trial snapshot. The report records trial ID, specification commit, code commit,
snapshot SHA-256, exact requested/received windows, endpoint, and parameters. Refreshing
or replacing an input requires a new trial ID rather than a force flag.

## Evaluation

The aligned BTC/ETH calendar is split at the pre-registered timestamp above. Full-history
and holdout are separate portfolio runs. Holdout may use pre-split observations only for
indicator warmup; it starts flat with $3,000 cash, ignores pre-split decisions, and the
first possible holdout execution comes from a signal at or after the split. The
pre-registered terminal close makes any final holdout position a completed raw trade.

The CLI reports full-history and final-30%-holdout metrics for the frozen strategy and
the doubled-cost price-edge stress:

- ending NAV and execution-cost-adjusted price PnL (funding excluded);
- daily return `NAV[t] / NAV[t-1] - 1`; annualized sample volatility and Sharpe use
  `sqrt(365)` and a zero cash rate; CAGR is
  `(endingNAV / startingNAV)^(365.25 / elapsedDays) - 1`;
- NAV-based maximum drawdown;
- completed trades, win rate, profit factor, and average execution-cost-adjusted trade PnL;
- raw asset trades and effective independent exposure episodes; overlapping BTC/ETH
  long exposure is one effective episode whose PnL is the NAV change while any position
  is open, including all modeled costs;
- exposure and turnover;
- largest-trade concentration; top-five concentration is the sum of the five largest
  positive completed-trade PnLs divided by all positive completed-trade PnL;
- per-asset positive-PnL concentration, with an 80% single-asset ceiling;
- a same-capital BTC/ETH buy-and-hold reference: $750 per asset at the first eligible
  execution open, identical costs, terminal close, and clearly not volatility matched.

Profit factor is positive effective-episode PnL divided by the absolute value of negative
effective-episode PnL. Undefined Sharpe or profit factor is serialized as `null`, never
`Infinity` or `NaN`.
Ledger equality checks use a one-cent tolerance; indicator comparisons use `1e-12`.

### H1 screen verdict

- **ERROR:** invalid/missing data, non-finite ledger state, or artifact collision.
- **PRICE_EDGE_REJECT:** holdout effective-episode execution-cost-adjusted expectancy is
  non-positive, holdout NAV Sharpe is non-positive, or doubled costs make effective-
  episode expectancy non-positive.
- **PRICE_EDGE_INSUFFICIENT:** fewer than 30 holdout effective episodes, top-five
  concentration exceeds 50%, or one asset contributes over 80% of positive trade PnL.
- **PRICE_EDGE_CANDIDATE:** positive base and stressed holdout price expectancy with at
  least 30 effective episodes and no concentration failure. This status still cannot
  authorize paper deployment; it only justifies the next funding/ledger-integrity slice.

Verdict precedence is exactly `ERROR > PRICE_EDGE_REJECT > PRICE_EDGE_INSUFFICIENT >
PRICE_EDGE_CANDIDATE`. `screenVerdict`, `promotionEligible`, and `limitations` are
orthogonal fields. `promotionEligible` is always false in this trial.

No neighboring parameter variant may replace H1 after results are seen. A different
horizon is a new pre-registered hypothesis and must be counted as another trial.

## Data flow

```text
Hyperliquid /info candleSnapshot (read only)
                    |
                    v
       strict parse + closed-bar filter
                    |
                    v
          BTC + ETH daily series
                    |
                    v
   signal at close(t), fill at open(t+2)
                    |
                    v
 deterministic futures PnL + exact costs
                    |
        +-----------+------------+
        |                        |
        v                        v
  base-cost run            doubled-cost run
        |                        |
        +-----------+------------+
                    v
 content-addressed snapshot + JSON evidence +
 reject/insufficient/price-edge-candidate verdict
```

## Test diagram

```text
[market adapter]
  + valid, ordered closed candles ----------------------> accepted
  + malformed/duplicate/gapped/open candle ------------> rejected/filtered

[signal]
  + positive 28d return AND close > EMA84 -------------> long
  + either condition false -----------------------------> cash
  + mutate close(t) ------------------------------------> cannot alter fill before t+2

[ledger]
  + entry/exit -----------------------------------------> exact fee + slippage once
  + mark movement --------------------------------------> NAV = prior NAV + units * dPrice
  + all-losing path ------------------------------------> non-zero NAV max drawdown
  + same-time entries ----------------------------------> deterministic pro-rata allocation
  + quantity after entry -------------------------------> fixed; exposure drift reported
  + severe loss ----------------------------------------> non-positive NAV rejects + flattens

[report]
  + base and doubled costs -----------------------------> separate immutable results
  + missing funding/book execution ---------------------> promotionEligible = false
  + insufficient/reject thresholds --------------------> deterministic screen verdict
```

## Failure modes and handling

| Failure | Handling |
|---|---|
| Hyperliquid is unavailable or rate-limited | Fail the run; never substitute data. |
| Current daily bar is incomplete | Remove it before signal evaluation. |
| Candle gap or duplicate | Fail loudly with asset and timestamp. |
| Signal/fill lookahead | Unit test the full-day-delayed `t+2` execution boundary. |
| Costs silently omitted | Require explicit fee/slippage config and emit them in JSON. |
| Attractive result on too few trades | Return `PRICE_EDGE_INSUFFICIENT`, never promote. |
| Existing simulator ledger contaminates result | Research kernel has no Supabase dependency. |
| Artifact path already exists | Fail; a rerun must use the committed snapshot or new trial ID. |

## What already exists

- Reuse: Node/TypeScript toolchain, Jest, Hyperliquid API URL configuration, and CI.
- Do not reuse for research: mixed-venue candle service, random candle fallback, current
  Supabase trade RPCs, current drawdown metric, tracker suggestions, or UI order flow.

## NOT in scope

- Live exchange keys, signing, or order submission.
- Automated forward paper scheduling or Supabase persistence.
- Repairing the existing account/RPC/liquidation system; that is the next slice only if
  H1 is not rejected.
- Funding-aware overlay, breakout, carry, liquidation/order-flow, or wallet-copy rules.
- UI changes, deploy changes, leverage, shorts, or interpretation of the IamNomad image.

## Implementation surface

1. `server/src/research/kernel.ts` — pure indicators, signal, deterministic portfolio,
   metrics, stress run, and verdict.
2. `server/src/research/hyperliquid.ts` — strict paginated official candle adapter plus
   canonical snapshot read/write and SHA-256.
3. `server/src/research/cli.ts` — frozen H1 runner, snapshot command, and JSON report.
4. `server/src/__tests__/researchKernel.test.ts` — chronology, math, split isolation,
   terminal close, costs, exposure drift, effective episodes, verdict precedence,
   serialization, no-clobber, truncation, calendar, and isolation tests.
5. `server/jest.config.cjs` — include `src/research/**` with explicit research coverage
   thresholds; exclude only the thin CLI shell.
6. Root/server package scripts — snapshot and reproducible run commands.
7. `server/research-data/` — content-addressed canonical input snapshot for this trial.

Sequential implementation is intentional. All files share the same small research
contract, so parallel edits would create more merge risk than speed.
