# Independent Four-Hour Strategy Trials

**Status:** LOCKED BEFORE EVALUATION, AFTER THE LIMITED RAW-DATA EXPOSURE RECORDED
BELOW — this document must be committed before any H2-H4 snapshot is fetched or any
H2-H4 return is calculated

**Branch:** `feat/deterministic-trading-research-kernel`

**Capital model:** $3,000 paper NAV; no wallet, signing, or live-order capability

**Evaluation cutoff:** `2026-07-22T00:00:00.000Z` exclusive

**Confirmatory holdout:** `2025-07-22T00:00:00.000Z` inclusive through the
evaluation cutoff exclusive

**Family:** H1 plus exactly three new primary trials; no parameter variants

## Decision

Run three independent, fully specified four-hour hypotheses after H1 failed its
holdout gate. The purpose is to test distinct economic mechanisms, not to tune the
rejected trend rule:

1. `H2-CARRY-4H-20260722-001` — spot/perpetual funding carry.
2. `H3-SHOCK-REVERSAL-4H-20260722-001` — short-horizon reversal after an
   unusually large, high-volume return shock.
3. `H4-BTC-LAG-4H-20260722-001` — ETH response after a statistically unusual BTC
   move for which ETH has lagged its frozen rolling relationship to BTC.

The primary universe remains BTC and ETH. HYPE is evaluated only in separately
reported exploratory H3 and H4 sleeves. A historical HYPE result cannot advance a
strategy, change the primary verdict, or authorize paper/live deployment.

H2, H3, and H4 were designed and ranked by a separate strategy-design agent that
did not inspect H1 returns. H1's result is now known: it was rejected. No H1
parameter, H2-H4 rule, threshold, ranking, or gate may be changed in response.

## Research-integrity incident

During an availability-only PowerShell probe, a JSON parsing mistake printed raw BTC
four-hour OHLC rows into an agent tool transcript. No indicator, return series,
strategy signal, PnL, or comparative result was calculated. H3 and H4 rules had
already been produced by the independent strategy-design agent, and H2's 86-bps
threshold had already been corrected from official fee documentation, before that
output appeared.

This is recorded as a research-integrity incident rather than hidden. The rules below
are frozen unchanged. Any economic change after this commit is a new trial and counts
as an additional selection attempt. Pure implementation defects may be fixed only
with an incident log, a regression test, and a rerun that retains the same economic
trial ID and immutable original superseded artifact regardless of its verdict.

## Frozen source contract

Only the official Hyperliquid `POST https://api.hyperliquid.xyz/info` endpoint is
accepted. The relevant official contracts are:

- [`candleSnapshot` and supported intervals](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint)
- [`fundingHistory`](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals)
- [hourly funding mechanics](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/funding)
- [base fee schedules](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/fees)
- [`spotMeta`](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/spot)
- [spot and perpetual asset identifiers](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/asset-ids)

Mixed venues, CryptoCompare, Binance, random candles, interpolation, forward fill,
and silent partial histories are prohibited.

### Availability-only facts frozen before evaluation

No return or strategy calculation was used to select these boundaries:

| Series | Canonical symbol | First complete 4h open | Bars to cutoff |
|---|---:|---:|---:|
| BTC perpetual | `BTC` | `2024-04-10T20:00:00.000Z` | 4,993 |
| ETH perpetual | `ETH` | `2024-04-10T20:00:00.000Z` | 4,993 |
| HYPE perpetual | `HYPE` | `2024-12-05T08:00:00.000Z` | 3,562 |
| UBTC/USDC spot | `@142` | `2025-02-03T00:00:00.000Z` | 3,204 |
| UETH/USDC spot | `@151` | `2025-03-26T12:00:00.000Z` | 2,895 |

The H2 aligned start is `2025-03-26T12:00:00.000Z`, the later of its two
required spot histories. H3 and confirmatory H4 use the common BTC/ETH perpetual
start. Exploratory HYPE runs start at HYPE's first complete bar. All runs end at the
cutoff above.

`spotMeta` identified `@142` as UBTC/USDC and `@151` as UETH/USDC at
preregistration time. Both are non-canonical wrapper markets. The snapshot must store
and hash the relevant token and pair metadata and fail unless each asset ID still maps
to that exact pair. H2 freezes the market-size convention at one UBTC size unit per BTC
unit and one UETH size unit per ETH unit (`wrapperMultiplier = 1`). Hyperliquid metadata
identifies the instruments but does not prove external wrapper redemption parity, so
that assumption and each wrapper's token identifiers/decimal fields must be reported.
H2 can screen an economic mechanism and enter forward paper, but historical success
cannot make these wrappers live-eligible.

### Four-hour candle paging

For every required series, request deterministic non-overlapping windows containing
at most 500 expected bars. With `BAR_MS = 14_400_000`:

```text
pageStart[0] = frozen series start
pageEnd[p]   = min(pageStart[p] + 500 * BAR_MS - 1, cutoff - 1)
pageStart[p+1] = pageEnd[p] + 1
```

The final `+1` moves from the prior inclusive millisecond end to the next aligned
bar open. Every non-final response must contain exactly 500 rows; the final response
must contain the exact remainder. Normalize then sort rows, and reject malformed
JSON, HTTP failures, empty/partial pages, duplicates, gaps, a wrong symbol or
interval, non-integer timestamps, non-positive or non-finite OHLC, invalid OHLC
ordering, negative/non-finite volume, a bar not aligned to four UTC hours, or
`closeTime != openTime + BAR_MS - 1`.

The adapter must also reject any row with `closeTime >= cutoff` and require exact
first/last boundaries and exact calendars for every series combined in a primary
portfolio. It must never invent a page boundary in response to a short server
response.

### Hourly funding paging

Funding is requested for BTC, ETH, and HYPE only where a corresponding perpetual
run needs it. The frozen family funding windows are BTC and ETH from
`2024-04-10T20:00:00.000Z` (19,972 expected hourly records each) and HYPE from
`2024-12-05T08:00:00.000Z` (14,248 expected hourly records), all through
`2026-07-21T23:00:00.000Z` inclusive. Those ranges include H2's required 168-hour
warmup before its first possible signal. Funding records are hourly and both request
endpoints are treated as inclusive. With `HOUR_MS = 3_600_000`:

```text
pageStart[0] = frozen funding start
pageEnd[p]   = min(pageStart[p] + 499 * HOUR_MS, cutoff - HOUR_MS)
pageStart[p+1] = pageEnd[p] + HOUR_MS
```

Every non-final response must contain exactly 500 hourly records and the final page
the exact remainder. Require one unique record at every UTC hour; a gap, duplicate,
wrong coin, out-of-window timestamp, malformed/non-finite rate, or partial page fails
the trial. Funding is never filled or inferred.

### Immutable evidence

The canonical input contains normalized candles, normalized funding, relevant spot
metadata, source/request configuration, and deterministic page evidence. Each raw
response receives its own SHA-256. Fetch timestamps are provenance but are excluded
from the normalized data hash. The stored envelope receives a separate artifact
SHA-256.

Snapshot and result writers use canonical key ordering and atomic no-clobber writes.
They record the trial IDs, preregistration commit, code commit, normalized data hash,
artifact hash, raw-response hashes, exact requested and received windows, and all
parameters. Data or window replacement requires new trial IDs. A report-only mechanical correction
uses the same economic trial ID but a unique positive `reportRevision`, filename, and
artifact hash, and must link `supersedesArtifactSha256` to the retained prior revision.
Revisions start at 1 and use
`<trialId>.r<reportRevision>.<artifactSha256>.json`; increments may not skip or overwrite.

Every canonical snapshot/result/family command fails unless `git status --porcelain`
is empty before execution, including staged and untracked files. The command records
that clean-tree assertion and `HEAD`. It also records an evaluator-source SHA-256 over
the canonical relative paths and bytes of this specification, all files under
`server/src/research/fourHour/`, `server/package.json`, `server/tsconfig.json`, and
`server/jest.config.cjs`. Artifact output dirties the tree only after the preflight;
the snapshot must then be committed before a result command runs.

## Shared chronology and accounting

Let bar `i` have open time `o[i]` and decision time
`d[i] = o[i] + BAR_MS`. A signal uses only a fully completed bar `i` and frozen
observations whose timestamps are strictly earlier than or equal to that decision.
Its earliest permitted execution is the reference open of bar `i+2`. This leaves one
full four-hour bar between observation and fill. An `H`-bar hold entered at
`open[i+2]` exits at `open[i+2+H]`: H2 therefore holds exactly 168 hours and H3/H4
exactly 12 hours. No terminal shortening is allowed.

Once an asset has a pending entry or an open position, later signals for that asset
are ignored until the scheduled position has exited. No-overlap is per asset; BTC and
ETH may overlap inside their combined primary portfolio. A signal observed while the
asset is pending/open cannot be banked for a later re-entry. Exits at a timestamp are
processed before new entries, but only signals observed while the asset was already
flat are eligible, so there is no same-open re-entry sourced from an in-position
signal. HYPE always runs in a separate portfolio and can never consume a primary slot.
The primary portfolio has exactly the number of slots named by its required assets,
so there is no return-based priority rule. An entry is skipped unless its exit open is
strictly before the applicable full, holdout, or half-run exclusive end.

Accepted quantities are generated once by the doubled-cost controller and replayed
byte-identically in base and stress ledgers. Before each simultaneous entry batch, the
controller marks retained gross at the reference opens, processes candidates in frozen
`BTC` then `ETH` order, and admits a complete atomic position only when both conditions
hold after its stressed entry costs:

```text
projectedStressNavAfterCandidateCosts =
  stressNavBeforeBatch - stressedEntryCosts(admittedCandidates + candidate)
nextAdmittedGross = admittedEntryGross + candidateEntryGross
admit iff projectedStressNavAfterCandidateCosts > 0
  and retainedMarkedGross + nextAdmittedGross
      <= min(1500, projectedStressNavAfterCandidateCosts)
```

At a reference open, principal exchange and new perpetual exposure do not themselves
change NAV, so the projection subtracts only the summed stressed entry fees/slippage
for candidates admitted so far plus the candidate under test.
`admittedEntryGross` is updated after each acceptance; `retainedMarkedGross` is fixed
for the batch after exits. Before exits and admission, every retained spot and
perpetual position is revalued from the prior close to the current reference open;
`stressNavBeforeBatch` and retained gross therefore use current-open prices, never the
prior close. This is a no-entry-leverage controller, not a resizing rule.

Rejected candidates are recorded and not resized or queued. HYPE is alone in its
exploratory ledger. Signal thresholds, accepted entries, exits, and units cannot differ
between cost cases. Position units stay fixed until exit; there is no rebalancing,
averaging, stop, discretionary close, or liquidation assumption in these historical screens.
Entry gross means the sum of absolute leg notionals at each reference open; both H2
legs count. The $1,500 cap is an entry-time cap. Marked gross may drift afterward and
is reported without a historical trim.

Perpetual PnL uses signed units:

```text
pricePnl = signedUnits * (markOrExitPrice - entryPrice)
```

Cash is debited/credited for spot purchases/sales, every fee and slippage charge,
realized perpetual PnL, and funding. A perpetual entry creates no principal cash flow.
Its unrealized PnL transfers to cash exactly once on exit and the position is then
removed. Funding is posted directly to cash exactly once, never also carried in a
second balance. Therefore:

```text
NAV = cash + spotMarkValue + unrealizedPerpetualPnl
```

Non-finite input, cash, PnL, or NAV is `ERROR`. All eligible funding events in a
completed four-hour interval are summed/booked in timestamp order before one close-mark
termination check; an individual event cannot truncate other events from that already
completed interval. Finite `NAV <= 0` in either ledger, checked after each completed
close/funding mark, current-open revaluation, and execution batch, terminates both
ledgers at the earliest shared timestamp. At a boundary execution it force-closes at
that boundary's reference opens; at a completed-bar mark it force-closes at that bar's
closes. Normal exit fees/slippage apply, both ledgers use the same timestamp/reference,
future scheduled trades are truncated and recorded, and the verdict is `REJECT`.

At every four-hour boundary `B`, ordering is exact:

1. Complete `[B-BAR_MS, B)`, book eligible funding events from that interval using
   its now-known conservative proxy, and mark all positions at the completed closes.
2. If `B` is 00:00 UTC, record the daily NAV sample. It is before executions stamped
   at `B`; a funding event stamped exactly `B` belongs to the next bar.
3. Evaluate the completed bar's strategy decision for its future `i+2` execution.
   The pre-exit position state applies, so an asset exiting at `B` cannot create a
   same-boundary decision while it was still open.
4. Revalue every retained position to the reference opens at `B`, record the
   pre-execution open NAV, then process scheduled exits there, settling PnL and costs.
5. Run the doubled-cost admission controller, then process accepted entries and costs
   at the same reference opens.
6. Record a post-execution NAV point at `B`.

Four-hour maximum drawdown includes completed-close, current-open pre-execution, and
post-execution NAV points, so gaps and entry/exit costs cannot disappear behind a later close. Hourly funding and price
paths inside a bar are not independently marked; the reported 8% drawdown is explicitly
a four-hour sampled drawdown, not a true intrabar maximum.

### Funding cash flows

For a funding event strictly between entry and exit:

```text
fundingCashflow = -signedPerpUnits * conservativeOracleProxy * fundingRate
```

The public historical funding response does not provide the historical oracle used
for settlement. The conservative proxy is the containing perpetual four-hour bar's
low when the computed funding flow is a credit and its high when it is a debit. Events
exactly at the entry or exit timestamp are excluded. The proxy may use a containing
bar's eventual high/low only for conservative realized accounting; it is never read
by a signal, position size, entry, exit, or contemporaneous risk decision.

A funding timestamp belongs to the half-open candle interval
`[barOpen, barOpen + BAR_MS)`. Its proxy amount is booked after that containing bar
completes and before the completed-bar strategy decision. Zero rate books zero. This
ordering prevents retrospective high/low information from entering a signal.

This boundary convention intentionally assigns neither a funding credit nor debit to
an execution at the identical timestamp because the historical response cannot prove
whether the fill owned that settlement. It is timestamp-symmetric but not PnL-neutral:
omitting a debit can be optimistic. Every trial therefore reports an adverse boundary
sensitivity as a third replay of the identical accepted stress schedule and quantities.
At an entry boundary it uses the entering signed perpetual units; at an exit boundary
it uses the exiting signed units. For each boundary exactly once, calculate
`flow = -signedPerpUnits * containingBarHigh * fundingRate`, add only negative flows,
and replace credits with zero. These hypothetical debits cannot alter admission,
schedule, or units. Non-positive effective-episode expectancy in this replay is
`REJECT`. This limitation is a
reason the result is screening-only. Historical results cannot by themselves
authorize live trading. Forward paper must record the actual oracle/funding inputs and
position ownership available at each event.

### Costs

Base execution costs are frozen from the official base taker schedule:

| Leg | Fee per execution | Slippage per execution |
|---|---:|---:|
| Perpetual | 0.00045 | 0.00050 |
| Spot | 0.00070 | 0.00050 |

Stress doubles both fee and slippage on every execution. Slippage is an adverse cash
cost applied once to reference notional; it does not also shift the execution price.
Fees apply once to actual reference notional at entry and exit. Funding is identical
between cost cases.

For every fill, adverse cash cost is exactly
`abs(units) * referencePrice * (feeRate + slippageRate)` using that leg's rates and
that fill's reference notional. Price PnL and spot principal are accounted separately.

For an equal-unit H2 pair, base round-trip costs are 43 bps relative to one leg's
notional: 24 bps spot plus 19 bps perpetual. Stress is 86 bps. The H2 signal threshold
is therefore fixed at the full stressed round-trip cost before evaluating data.

## H2 — seven-day funding carry

**Trial ID:** `H2-CARRY-4H-20260722-001`

**Primary assets:** BTC and ETH pairs

**Primary ranking:** 1

**Exploratory HYPE sleeve:** none

At the close of each complete four-hour bar `i`, separately for BTC and ETH:

1. Require exactly 168 hourly funding records in
   `[d[i] - 168 * HOUR_MS, d[i])`.
2. Treat every `fundingRate` as a signed decimal rate in Hyperliquid's documented
   convention and calculate `F7[i]` as their arithmetic sum without compounding.
3. Require `F7[i] > 0.0086`.
4. Require `perpClose[i] > alignedSpotClose[i]`, using closes from the identical
   completed four-hour bar.
5. Schedule a delta-neutral entry at bar `i+2` open: buy spot and short the
   corresponding perpetual.

Common base units are frozen at entry as:

```text
units = min(375 / spotReferenceOpen, 375 / perpReferenceOpen)
```

This pre-data accounting correction, together with the frozen multiplier of one,
guarantees each leg is at most $375 and the pair uses identical underlying-size units.
There is no rebalance. Exit both legs at the reference open
exactly 42 bars after entry, a 168-hour holding period.

There may be one pair per asset and at most two pairs. Each pair has at most $750
entry gross and the primary portfolio at most $1,500 entry gross. BTC and ETH must
each be non-negative required sleeves for advancement. UBTC and UETH wrapper risk is
reported separately from market PnL.

The 86-bps comparison is strict and denominated relative to one pair leg; equality is
no signal, and ledger costs are still charged rather than assumed away. Because
funding ownership is strict between entry and exit, the 168-hour H2 position normally
owns 167 hourly funding events. That difference from the 168-hour backward-looking
signal window is intentional.

For audit attribution, an H2 round trip uses these exact principal equations before
costs: spot cash flows are `-units*spotEntry` then `+units*spotExit`; short-perpetual
price PnL is `units*(perpEntry-perpExit)`. Perpetual principal is never credited.

## H3 — high-volume shock reversal

**Trial ID:** `H3-SHOCK-REVERSAL-4H-20260722-001`

**Primary assets:** BTC and ETH perpetuals

**Primary ranking:** 2

**Exploratory asset:** HYPE perpetual, reported in a separate $3,000 flat run

For asset `a`, define the current log return:

```text
r[a,i] = ln(close[a,i] / close[a,i-1])
```

At completed bar `i`, use exactly the prior 180 returns
`r[a,i-180] ... r[a,i-1]`, excluding the current return. Let `m` be their median,
`MAD` the median of `abs(r - m)`, and `scale = 1.4826 * MAD`. Let `volumeMedian`
be the median volume of bars `i-180 ... i-1`, excluding the current bar. Zero or
non-finite scale, volume median, or inputs produce no signal.

For every even-sized median, sort ascending and use the arithmetic mean of the two
central values. MAD uses that same rule. Direction is explicitly
`-sign(r[a,i])`, not the sign of the median-adjusted z-score.

```text
z[a,i] = (r[a,i] - m) / scale
```

A signal requires `abs(z[a,i]) >= 3` and
`volume[a,i] >= 2 * volumeMedian`. Enter a perpetual position opposite the sign of
the current return at bar `i+2` open. A zero current return produces no signal. Exit
at the reference open exactly three bars after entry.

Primary BTC and ETH entries use `units = direction * 750 / referenceOpen`, with at most two
simultaneous primary positions and $1,500 entry gross. The separate exploratory HYPE
run uses `units = direction * 375 / referenceOpen` and one position. BTC and ETH are both required
non-negative primary sleeves.

## H4 — BTC-to-laggard response

**Trial ID:** `H4-BTC-LAG-4H-20260722-001`

**Primary asset:** ETH perpetual

**Driver:** BTC perpetual

**Primary ranking:** 3

**Exploratory asset:** HYPE perpetual, reported in a separate $3,000 flat run

At completed bar `i`, fit an ordinary least-squares regression of the H3-defined log
returns with an intercept over
exactly the prior 180 paired returns, excluding current returns:

```text
rLaggard[j] = alpha + beta * rBTC[j] + residual[j]
for j = i-180 ... i-1
```

Let `xBar` and `yBar` be the two 180-value means. Freeze
`beta = sum((x-xBar)*(y-yBar)) / sum((x-xBar)^2)` and
`alpha = yBar - beta*xBar`; no separate covariance denominator may change the ratio.
Zero/non-finite BTC variance, coefficients, or residual scale produce no signal. The
prior residual scale is the regression standard error
`sigmaResidual = sqrt(sum(residual[j]^2) / (180 - 2))`.

Calculate BTC's robust score from the same prior 180 BTC returns using the H3 median
and `1.4826 * MAD` definitions. Calculate the current laggard residual without
refitting:

```text
currentResidual = rLaggard[i] - (alpha + beta * rBTC[i])
```

A signal requires all of:

```text
abs(zBTC[i]) >= 2
rBTC[i] != 0
sign(rBTC[i]) * currentResidual <= -sigmaResidual
```

Enter the laggard perpetual in the sign of the current BTC return at bar `i+2` open.
Exit at the reference open exactly three bars after entry. The primary ETH run uses
`units = direction * 750 / referenceOpen` and one position. The separate HYPE run uses
`units = direction * 375 / referenceOpen` and one position.

H4's confirmatory portfolio is structurally ETH-only. The cross-asset 80% positive-PnL
concentration gate is therefore not applicable to H4; every report must instead label
the single-asset dependency. Its episode concentration, split stability, cost, and all
other gates remain mandatory.

## Frozen evaluation

Each primary trial emits independent full-history, holdout, doubled-cost, and sleeve
reports. Holdout simulations start flat with $3,000 cash, may use earlier observations
only as indicator/funding warmup, ignore pre-boundary signals and pending entries, and
accept signals only from bars whose decision time satisfies `start <= d[i] < end`.

The holdout is also run as two independently flat stability halves:

1. `[2025-07-22T00:00:00.000Z, 2026-01-20T00:00:00.000Z)`
2. `[2026-01-20T00:00:00.000Z, 2026-07-22T00:00:00.000Z)`

Each half may use prior data only for frozen warmup, accepts no earlier signal or
position, and skips any entry whose scheduled exit would reach or cross its exclusive
end. A trade spanning the midpoint is therefore excluded from both half-runs, so the
two half PnLs need not sum to full-holdout PnL. Both base-cost halves must have
non-negative adjusted PnL.

Four-hour marked NAV, including every funding event accrued since the preceding mark,
is the drawdown source. Daily returns are sampled after the completed 20:00-24:00 UTC
bar at each UTC day boundary and are
`dailyNav[t] / dailyNav[t-1] - 1`. Annualized daily Sharpe uses sample standard
deviation, zero cash rate, and `sqrt(365)`. Zero-exposure days remain in the series.
Each flat simulation includes an explicit $3,000 NAV anchor at its start; the first
return ends at the next UTC boundary. Undefined values serialize as `null`.

With every anchor/mark in chronological order, running peak is
`peak[t] = max(peak[t-1], NAV[t])` and drawdown is
`(peak[t] - NAV[t]) / peak[t]`; maximum drawdown is their maximum. No open/close
substitution or daily-only path may be used for the 8% gate.

An effective exposure episode begins when aggregate primary gross changes from zero
to positive and ends only when an execution batch leaves it at zero. Same-timestamp
exits and entries are one batch, so a rotation remains one episode unless exposure is
zero after the whole batch. All overlapping positions share one episode. H2's atomic
spot/perpetual pair is one position for episode purposes, not two. Episode PnL is the
NAV change including price PnL, funding, fees, and slippage.

Episode expectancy is the arithmetic mean episode PnL. Profit factor is
`sum(positiveEpisodePnl) / abs(sum(negativeEpisodePnl))`; no losing episodes makes it
`null`, never infinity; losses with no wins produce zero. Top-five concentration is the
five largest positive episode PnLs divided by all positive episode PnL; no positive
episode makes it `null`, while fewer than five positive episodes produces 100%. Asset
concentration uses each asset's base net adjusted PnL and denominator
`sum(max(assetNetAdjustedPnl, 0))`; a zero denominator is `null`. All these nulls are
`INSUFFICIENT`. Effective episode count is an activity floor, not
a claim of statistical independence; the block bootstrap is the dependence adjustment.

Reports include at least:

- ending NAV; adjusted PnL; funding; fees; slippage; turnover; four-hour maximum
  drawdown; daily volatility and Sharpe;
- raw legs, completed asset trades, and effective exposure episodes;
- episode expectancy, win rate, profit factor, largest positive episode, and top-five
  positive-episode concentration;
- price, funding, and cost PnL by required asset sleeve;
- marked gross, maximum gross/NAV, long/short exposure, skipped signals, and termination
  state;
- the two flat half-runs, exploratory HYPE result, limitations, and every hash and
  commit needed for byte-identical replay.

### Circular block bootstrap

For each primary trial use its base-cost holdout daily returns. Let `n` be the number
of returns and `B = 10,000`. Seed xorshift32 from the unsigned integer represented by
the first eight hexadecimal characters of `SHA256(UTF8(trialId))`; if it is zero, replace it
with `0x9e3779b9`. Each unsigned draw updates the 32-bit state exactly as follows,
masking to unsigned 32 bits after every operation:

```text
x = x XOR (x << 13)
x = x XOR (x >>> 17)
x = x XOR (x << 5)
nextUint32 = x >>> 0
```

The seed initializes `x` but is never itself emitted; every draw advances once first.

For each replicate, repeatedly choose
`start = floor((nextUint32 / 2^32) * n)`, append
the next seven returns with circular wraparound, and truncate the concatenation to
exactly `n`. Store the arithmetic mean. Keep one continuous deterministic RNG stream
across all replicates. Sort the 10,000 means ascending. With
`alpha = 0.05 / 3`, the one-sided family-adjusted lower bound is the zero-based value
at `floor(alpha * (B - 1))`, index 166. It must be strictly greater than zero.

Fewer than seven daily returns, a non-finite draw, or a non-deterministic replay is an
error rather than a fallback to an independent bootstrap.

### Deflated Sharpe ratio

DSR is calculated only after H2-H4 have all completed, using exactly four observed
base-cost primary holdout series: H1, H2, H3, and H4. H1 uses the base daily series
already frozen in its holdout report; H2-H4 use the full flat-start confirmatory
holdout above. All daily series include zero-exposure days. A fixed economic variant
would increment that count; an incident-logged implementation correction would not.

For each trial, let `SR` be mean daily return divided by sample standard deviation,
without annualization, and `n` the daily-return count. With `mu = sum(x)/n`, define
population central moments `mK = sum((x-mu)^K)/n`, then
`skewness = m3 / m2^(3/2)` and `kurtosis = m4 / m2^2`. The Sharpe denominator remains
the sample standard deviation; this deliberate estimator choice is frozen and reported.
Let `sigmaSR` be
the sample standard deviation of the four per-day Sharpe estimates, `N = 4`, Euler's
constant `gamma = 0.5772156649015329`, standard normal CDF `Phi`, and inverse CDF
`PhiInv`:

```text
expectedMaxSR = sigmaSR * (
  (1 - gamma) * PhiInv(1 - 1 / N)
  + gamma * PhiInv(1 - 1 / (N * e))
)

DSR = Phi(
  (SR - expectedMaxSR) * sqrt(n - 1)
  / sqrt(1 - skewness * SR + ((kurtosis - 1) / 4) * SR^2)
)
```

`Phi` uses a committed double-precision Cephes normal-CDF implementation and
`PhiInv` uses Wichura AS241. Both live in `familyEvaluation.ts`, use Float64 inputs,
and must match preregistered reference fixtures within absolute `1e-12`. DSR gates
compare the unrounded Float64 output directly to `0.95`; canonical JSON stores the
normal JavaScript round-trip decimal without display rounding.

A completed all-zero daily-return series contributes `SR = 0` only to the four-trial
selection distribution; that zero-activity trial's own DSR remains `null` and it is
`INSUFFICIENT`. Any other null/non-finite Sharpe, fewer than three daily returns,
`m2 <= 0`, a non-positive DSR denominator, non-finite moment, or non-finite `sigmaSR`
makes `familyDsrAvailable = false` and every otherwise eligible candidate
`INSUFFICIENT`, not permanently pending. An advancing trial requires `DSR >= 0.95`.

Before any H2-H4 canonical fetch, an H1 family-input preflight extracts the full daily
vector from H1's immutable report and verifies its report/data hashes and pinned H1
specification/code commits. If the vector is absent, it may be regenerated only by the
original pinned H1 code/specification against the immutable H1 snapshot, then stored as
a separately content-addressed family input; current-code reconstruction, rounded
annualized summaries, and refetches are prohibited. H1 retains its original 360-day
span while H2-H4 retain the holdout above; that unequal-span limitation is disclosed.
If this preflight cannot reproduce H1 exactly, `familyDsrAvailable = false` and no
trial can advance.

Each H2-H4 trial first writes an immutable metrics report without a final family
decision. After all three reports exist, one immutable family report references the
exact H1-H4 data/report/code/specification hashes, computes DSR, applies final gates,
and selects at most one candidate. Before that family artifact exists, no report may
claim `ADVANCE_TO_FORWARD_PAPER`.

### Verdict

Verdict precedence is exactly:

```text
ERROR > REJECT > INSUFFICIENT > ADVANCE_TO_FORWARD_PAPER
```

Cost-case ownership is frozen:

| Gate | Input |
|---|---|
| Episode expectancy | Base and stress separately |
| Maximum drawdown | Base and stress four-hour paths separately |
| Adverse boundary-funding expectancy | Stress sensitivity |
| Required-sleeve net PnL | Base |
| Two flat stability halves | Base |
| Sharpe, profit factor, bootstrap, DSR | Base |
| Top-five and cross-asset concentration | Base |
| Doubled-cost total adjusted PnL | Stress |

`ERROR` applies to invalid/missing input, a chronology or calendar failure, a
non-finite ledger, artifact collision, hash mismatch, non-deterministic replay, or an
unclassified runtime failure. All H2-H4 trials must complete; any trial `ERROR` makes
the family report `ERROR` and blocks DSR and advancement.

`REJECT` applies if any primary holdout condition is true:

- a non-null base or doubled-cost episode expectancy is non-positive;
- base or doubled-cost four-hour maximum drawdown exceeds 8%;
- adverse boundary-funding stress episode expectancy is non-positive;
- any required primary asset sleeve has negative adjusted PnL, where sleeve PnL is
  that asset's price PnL plus funding minus its own fees/slippage inside the combined
  primary ledger.

Null expectancy caused by zero episodes is `INSUFFICIENT`, not `REJECT`.

`INSUFFICIENT` applies, after reject checks, if any condition is true:

- fewer than 40 effective holdout episodes;
- base annualized daily Sharpe is null or below 1.0;
- base episode profit factor is null or below 1.25;
- doubled-cost adjusted holdout PnL is non-positive;
- the bootstrap lower mean-return bound is not strictly positive;
- DSR is null or below 0.95;
- either flat base-cost half has negative adjusted PnL;
- base top-five positive-episode concentration exceeds 50%;
- for H2 or H3, one asset supplies over 80% of positive base primary asset PnL;
- a required primary sleeve has no completed exposure.

`ADVANCE_TO_FORWARD_PAPER` requires every numerical/research gate to pass. It means
eligible for the separate pre-forward admission manifest, not permission to start a
paper job immediately. It is not a claim of a live edge and cannot create a wallet,
authorize an agent, or send an order.

All three trials run and are adjudicated even if an earlier-ranked trial fails or
passes. If more than one trial passes, advance the highest pre-ranked passing trial:
`H2 > H3 > H4`. Selection by realized return, Sharpe, or visual appeal is prohibited.
Exploratory HYPE is never considered in this selection.

Precedence applies independently to each trial. The family aggregation is exact: any
trial `ERROR` makes the family `ERROR`; otherwise one or more advancing trials makes
the family `ADVANCE_TO_FORWARD_PAPER` and rank selects the candidate regardless of
other trials being `REJECT` or `INSUFFICIENT`; if none advances, any `REJECT` makes the
family `REJECT`; otherwise the family is `INSUFFICIENT`.

## Stop-mining and forward-paper contract

After H4 is adjudicated, stop mining this historical snapshot. HYPE outputs are
quarantined: they cannot tune H2-H4, select a winner, or inform H5. If an exploratory
HYPE observation is ever used to design or justify a later hypothesis, that hypothesis
must count it as an observed selection attempt and increment its effective trial count.
If none passes, remain
in cash and define H5 only against prospectively collected data before that data is
observed. Do not search neighboring thresholds, horizons, assets, cost assumptions, or
regression variants on this snapshot.

An advancing strategy must run unchanged in autonomous forward paper for at least
180 calendar days **and** at least 50 effective exposure episodes, whichever takes
longer. It must also achieve 60 consecutive days with zero qualifying data, scheduler,
ledger, risk, or execution-model incident occurrences. Forward paper records decision-time market
inputs, actual funding/oracle observations, L2-derived IOC fills including partial
fills, latency, rejections, and all costs. Historical gates are rerun on the forward
record without threshold changes.

Before the first forward-paper job, a hashed admission manifest must verify all of:
official decision-time input capture; exact paper instrument/pair identity; actual
oracle, funding, and settlement-ownership capture; L2/IOC partial-fill and rejection
modeling; byte-identical ledger replay; persistent HALT behavior; and a committed risk
policy. A failed admission item blocks starting forward paper but does not rewrite the
historical numerical verdict.

The incident streak means 60 consecutive UTC days with no qualifying incident
occurrence, even if an incident was later resolved. Every occurrence resets the streak,
which starts only after its repair is deployed and verified. Historical trials do not
apply product daily/weekly halts. Before forward paper, the risk-policy specification
must freeze UTC loss windows, high-water NAV, inclusive threshold comparisons, mark
source/cadence, cancel/flatten actions, persistent manual-resume rules, and irreversible
terminal-floor behavior.

Historical limitations include noncanonical spot liquidity and redemption assumptions,
candle-open fillability, the oracle proxy, and absent L2, partial-fill, margin, and
liquidation modeling. HYPE remains disabled for autonomous risk until its own future confirmatory trial and
forward gate pass. H2 wrapper markets require an additional asset/custody eligibility
decision before any live consideration.

## Product and capital boundary

This research family is only the edge-selection layer. The paper product must still
provide an immutable double-entry ledger, durable idempotent jobs, exact replay within
one cent, persistent HALT state, stale-data rejection, failure injection, operator
audit history, and a presentation-grade evidence package.

Initial paper-risk ceilings are separate, stricter controls:

| Control | Frozen ceiling |
|---|---:|
| Initial NAV | $3,000 |
| BTC entry notional | $750 |
| ETH entry notional | $750 |
| HYPE entry notional | $375, disabled pending promotion |
| Portfolio entry gross | $1,500 |
| Daily loss halt | $45 |
| Weekly loss halt | $90 |
| Drawdown halt | $180 |
| Terminal NAV floor | $2,700 |

No exchange key is needed in paper mode. The private key previously pasted in chat is
permanently treated as compromised and must never be stored, funded, authorized, or
used. Only after every research, forward-paper, software, operational, and explicit
human approval gate passes may the system generate a fresh dedicated agent key locally
for one-time authorization by the operator's master wallet. The master-wallet key is
never requested or stored.

## Implementation isolation

H1 remains immutable. H2-H4 use a separate `server/src/research/fourHour/` subsystem
because H1's types and ledger are intentionally hard-coded to BTC/ETH daily long-only
perpetual research. The new surface is fixed as:

```text
server/src/research/fourHour/
  contracts.ts
  frozenTrials.ts
  hyperliquid.ts
  indicators.ts
  strategies/h2Carry.ts
  strategies/h3ShockReversal.ts
  strategies/h4BtcLag.ts
  schedule.ts
  ledger.ts
  metrics.ts
  familyEvaluation.ts
  artifacts.ts
  runner.ts
  cli.ts
```

`frozenTrials.ts` is the sole production source for economics and exports a deeply
immutable, fixed-order registry. No CLI flag may override an economic parameter.
Network parsing, pure indicators, strategy candidates, scheduling, ledger replay,
metrics/family adjudication, immutable artifacts, pure orchestration, and the thin CLI
remain separate. There is no barrel import. The implementation may reuse H1's tested
canonical JSON and official endpoint constants but not its asset types, futures-only
ledger, snapshot schema, Supabase paths, mixed feeds, or terminal-shortening behavior.

## Required tests before snapshotting

- exact 500-bar and 500-hour page boundaries, final remainders, inclusive endpoints,
  gaps, duplicates, truncation, wrong identity, current-bar filtering, and no-clobber;
- all median/MAD, OLS, residual-scale, funding-window, basis, signal, `t+2`, holding,
  ignored-pending-signal, and terminal-entry chronology boundaries;
- identical base/stress schedules and units, exact fee/slippage once, signed perpetual
  PnL, spot cash accounting, conservative funding credit/debit proxy, and non-positive
  NAV handling;
- primary/exploratory isolation, HYPE non-promotion, required-sleeve accounting,
  effective episodes, half-run isolation, concentration, and verdict precedence;
- xorshift32 reproducibility, circular block wrap, quantile index 166, normal CDF/inverse
  fixtures, DSR invalid states, N=4 family accounting, and canonical serialization;
- source isolation from Supabase, mixed feeds, random data, live signing, and the legacy
  simulator ledger.

All H2-H4 adapters, signals, chronology, admission, ledgers, funding/cost accounting,
statistics, verdict logic, artifact writers, and the tests above must be committed
before any canonical market snapshot fetch. A synthetic family batch covering all
three trials must replay byte-identically. Only then may all frozen trials be
snapshotted and evaluated without early stopping.

An implementation correction after a result never overwrites an artifact. It creates
a new immutable report revision that references the retained original/superseded hash,
the incident, regression test, and correction commit while preserving the economic
trial ID. Any economic rule, input window, accounting convention, or statistic change
requires a new trial ID and increments the selection count.
