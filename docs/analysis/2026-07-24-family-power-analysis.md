# Power analysis of the frozen H1-H4 family

**Status:** PRE-DATA. Committed before any canonical H2-H4 snapshot is fetched.

**Reproduce:** `node server/scripts/familyPowerAnalysis.mjs`

This document exists so that a decision made *before* seeing any result cannot later be
mistaken for a reaction to one. No market data was read, no snapshot was fetched, and no
strategy return was calculated to produce any number below. Everything here is synthetic
simulation of the gate arithmetic that `docs/specs/2026-07-22-independent-4h-trials.md`
already froze.

## Question

If H2, H3, or H4 had a genuine edge, would the frozen gates detect it?

This is a different question from "does the edge exist", and it has to be answered first.
A test that cannot return "yes" produces no information when it returns "no".

## Finding 1 — the advertised Sharpe gate never binds

The specification lists `base annualized daily Sharpe is null or below 1.0` as an
`INSUFFICIENT` condition. That threshold is not the operative one.

The binding constraint is the circular block bootstrap: its one-sided lower bound at
`alpha = 0.05/3` must be strictly greater than zero. For a daily series of length `n`,
the t-statistic of the mean is

```
t = mean / (sd / sqrt(n)) = (mean/sd) * sqrt(n)
```

and the annualized Sharpe is `(mean/sd) * sqrt(365)`. At `n = 365` those coincide, so the
bootstrap gate is approximately `annualized Sharpe > z_alpha`, with `z_(0.05/3) ~= 2.128`.

Simulated detection rates at `n = 365`:

| true annualized Sharpe | clears the bound |
|---:|---:|
| 0.5 | 5% |
| 1.0 | 13% |
| 1.5 | 27% |
| 2.0 | 46% |
| 2.128 | 49% |
| 2.5 | 62% |
| 3.0 | 83% |

A strategy with a true Sharpe of 1.0 — which would be a genuinely good strategy — is
rejected 87% of the time. The operative hurdle is roughly 2.1 and above, and the stated
1.0 gate is decorative.

This is not an argument for lowering the bar. It is an argument that the bar was never
where the document implied, which matters when deciding what the family can prove.

## Finding 2 — short holds cannot accumulate significance

Zero-exposure days remain in the daily series by specification. A strategy active on only
`k` of `n` days is therefore diluted:

```
mean_full = (k/n) * mean_active
sd_full  ~= sqrt(k/n) * sd_active
=> SR_full = sqrt(k/n) * SR_active   =>  annualized ~= sqrt(k) * SR_active_daily
```

`sqrt(k)` is a hard ceiling no edge quality can exceed. Hold horizons are frozen: H2 holds
168h, H3 and H4 hold 12h.

| trial | episodes | hold | active days | sqrt(k) ceiling | realised at SR_active = 0.5 |
|---|---:|---:|---:|---:|---:|
| H2 | 25 | 168h | 175.0 | 13.23 | 6.29 |
| H2 | 40 | 168h | 280.0 | 16.73 | 8.07 |
| H3 | 25 | 12h | 12.5 | 3.54 | 1.65 |
| H3 | 40 | 12h | 20.0 | 4.47 | 2.02 |
| H4 | 20 | 12h | 10.0 | 3.16 | 1.38 |
| H4 | 40 | 12h | 20.0 | 4.47 | 1.97 |

H3 and H4 land at roughly 1.4-2.0 against a ~2.13 hurdle, and that already assumes a
per-active-day Sharpe of 0.5, which is strong for a 12-hour reversal trade. They are not
strictly impossible, but they are underpowered: at best a coin flip on the bootstrap gate
alone, before also having to clear DSR >= 0.95, drawdown, profit factor, both stability
halves, and concentration simultaneously.

## Finding 3 — H2's threshold is set to its own break-even

H2 requires trailing 168h funding above `0.0086`, and the specification derives that
number as the *stressed round-trip cost* (43bp base, 86bp doubled). Entry therefore occurs
where doubled-cost gross profit approximately equals doubled-cost expense.

Since `REJECT` is evaluated before `INSUFFICIENT`, and `REJECT` fires on non-positive
doubled-cost episode expectancy, H2's most likely verdict is `REJECT` rather than
`INSUFFICIENT`. That distinction is consequential: `REJECT` permanently closes the trial,
and H2 is the only member of the family with a well-established economic mechanism.

Separately, H2's episode ceiling is `floor(2190 / 43) = 50` entries in the holdout even
under perfectly spaced non-overlapping entries, against a 40-episode floor. Because
high-funding regimes cluster and exposure episodes merge when they overlap, the realistic
count is materially lower.

## Consequence

Running the family as frozen has a high probability of returning "no" for reasons
unrelated to whether the underlying economics work. Because the specification's
stop-mining clause fires on adjudication, that outcome also consumes the snapshot and
forces the next hypothesis to wait for prospectively collected data.

The decision therefore expires at the moment of the fetch, which is why it is recorded now.

## Recommended amendments

These are design changes made before observing any result. Each increments the effective
selection count and must be declared as such.

1. **Cross-sectional universe for estimation.** Run the same economic mechanisms across
   the full Hyperliquid perpetual universe rather than BTC/ETH alone. Episodes and active
   days rise by roughly an order of magnitude, which is the only thing that fixes power.
   The *trading* universe stays BTC/ETH/HYPE: the cross-section establishes whether a
   mechanism exists, deployment stays inside the frozen risk ceilings. Survivorship bias
   is unrecoverable retrospectively for delisted instruments and must be bounded and
   disclosed; the collector should record point-in-time listings going forward.

2. **Separate UNDERPOWERED from REJECT.** A trial that fails only because the design
   cannot detect an effect of the size in question is not the same as a trial whose
   economics were measured and found wanting. Collapsing them permanently closes
   mechanisms on the strength of a sample-size limitation.

3. **Analytic correctness controls.** Content addressing and byte-identical replay prove
   a computation is *reproducible*, not that it is *correct*. H2's PnL is a sum of up to
   167 hourly funding cashflows under a half-open interval convention with a boundary
   ownership rule; a one-hour misalignment or a sign error would reproduce byte-identically
   forever and pass every existing gate. Closed-form fixtures where the answer is known
   analytically are required.

4. **Forward-paper contract.** 50 effective episodes at H2's 172h minimum cycle is 358
   days at a 100% duty cycle and several years at realistic duty cycles, against a stated
   180-day minimum. The two floors are mutually inconsistent and no strategy can currently
   graduate.
