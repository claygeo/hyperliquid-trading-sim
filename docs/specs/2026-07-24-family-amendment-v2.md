# Amendment v2 to the four-hour family

**Status:** PRE-DATA. Must be committed before any canonical H2-H4 snapshot is fetched.

**Amends:** `docs/specs/2026-07-22-independent-4h-trials.md` (commit `a3c871d`)

**Basis:** `docs/analysis/2026-07-24-family-power-analysis.md`

No canonical H2-H4 market data has been fetched, no H2-H4 return has been calculated,
and no H2-H4 artifact exists. Every change below is made without any knowledge of an
H2-H4 result. H1's result is known and rejected, and nothing here alters H1.

## Why amend rather than run

The frozen design has near-zero power. The binding gate is the one-sided bootstrap bound
at `alpha = 0.05/3`, which on a 365-day daily series requires roughly 2.13 annualized
Sharpe; the advertised `Sharpe >= 1.0` threshold never binds. Separately, a strategy
exposed `k` of `n` days has annualized Sharpe capped near `sqrt(k)`, and H3/H4 hold
positions for twelve hours, giving roughly 10-20 active days.

Running the family as frozen therefore has a high probability of returning a verdict
driven by sample size rather than economics, while adjudication simultaneously fires the
stop-mining clause and consumes the only history available.

That `alpha = 0.05/3` is the figure in the frozen specification. A4 below tightens it to
`0.05/5` to match the corrected selection count, which raises the operative hurdle from
roughly 2.13 to roughly 2.33 annualized Sharpe. **This amendment makes advancing harder,
not easier.** That is stated plainly because the reverse is the obvious suspicion
whenever a preregistration is amended before its result is known.

Amending is not a licence to keep amending. This document fixes a stated run commitment
in the final section.

## A1 — Add `UNDERPOWERED`, ranked BELOW `REJECT`

The current taxonomy collapses "the economics were measured and found wanting" into the
same outcome as "this design could never have detected the effect". Only the first should
close a mechanism.

New precedence, replacing the precedence block in the frozen specification:

```text
ERROR > REJECT > UNDERPOWERED > INSUFFICIENT > ADVANCE_TO_FORWARD_PAPER
```

`UNDERPOWERED` ranks **below** `REJECT`, not above it. An earlier draft of this amendment
placed it above, which was wrong: low power does not erase a negative point estimate. If a
predeclared economic reject condition is met on non-null evidence — negative base episode
expectancy, drawdown above 8%, negative adverse-boundary expectancy, or a negative
required-sleeve PnL — that is a measured economic failure and it closes the mechanism
regardless of how few episodes produced it. Insufficient power means you cannot claim a
precise alternative; it does not entitle you to ignore an adverse measurement.

`UNDERPOWERED` therefore applies only when **no** economic `REJECT` condition holds and
the trial would otherwise fail a power-sensitive or sample-size gate (the bootstrap bound,
the Sharpe floor, or the episode floor), and additionally:

- the trial's realized exposure implies a `sqrt(activeDays)` Sharpe ceiling below the
  operative bootstrap hurdle, **or**
- a pre-declared power simulation at the trial's target effect size and realized episode
  count yields detection probability below 50%.

Both inputs are activity statistics. Neither reads realized PnL, so this classification
cannot be steered by an observed result.

`UNDERPOWERED` records the mechanism as **not tested**. It does not close the trial and
does not authorize anything.

## A2 — Retain the doubled-cost gate; record the design flaw instead

An earlier draft of this amendment demoted H2's doubled-cost episode expectancy from a
terminal `REJECT` condition to a reported diagnostic, on the grounds that the entry
threshold `F7 > 0.0086` was itself derived as the stressed round-trip cost, making the
gate self-referential.

**That reasoning was wrong and the demotion is withdrawn.** The threshold constrains
*trailing* 168-hour funding at the decision bar; the gate evaluates *realized* funding
over the subsequent 168-hour holding period net of doubled costs. These are different
quantities, and the relationship between them is precisely the economic question a carry
strategy exists to answer: does elevated trailing funding persist far enough forward to
cover costs? Removing that gate would remove the single most informative test in the
trial.

The doubled-cost episode expectancy gate is therefore **retained unchanged** as a terminal
`REJECT` condition.

What is genuinely true, and is recorded here rather than acted upon, is that setting the
entry threshold equal to the stressed round-trip cost means the strategy is designed to
enter at stressed break-even. That is a weakness in the *strategy*, not in the gate. If
the trial rejects on this condition, the finding is real and should be reported plainly:
carry entered at this threshold does not survive doubled costs at this size. Raising the
threshold to buy headroom is not permitted, because it would reduce trigger frequency and
episode count is already the binding constraint, and because it would be a post-hoc
economic edit.

## A3 — Withdraw H3 and H4 without running them

`H3-SHOCK-REVERSAL-4H-20260722-001` and `H4-BTC-LAG-4H-20260722-001` are withdrawn as
`WITHDRAWN_UNDERPOWERED`. At their frozen 12-hour hold, realistic episode counts give
10-20 active days and a realized Sharpe near 1.4-2.0 against a ~2.13 hurdle, before also
having to clear DSR, drawdown, profit factor, both stability halves and concentration
simultaneously.

They are withdrawn rather than deleted. Their specifications remain frozen in the record,
and they **still count toward the selection count** because they were designed from the
same candidate pool.

Withdrawal is not a judgement that these mechanisms are absent. It is a statement that
this panel cannot test them. Testing them requires either a materially longer sample or a
cross-sectional panel, and either is a new preregistration against data not yet observed.

## A4 — New trial identity, selection count, and a fully specified DSR

Adjudication rules have changed, so the amended carry trial receives a new identity:

```text
H2B-CARRY-4H-20260724-001
```

Its economic rule is byte-identical to `H2-CARRY-4H-20260722-001`. Only the verdict
mapping differs. The original H2 identity is retired unrun.

**Effective selection count `N = 5`**: H1, H2, H3, H4, H2B. All five are counted even
though three were never evaluated on data, because all five were drawn from one candidate
pool and counting them is the conservative direction.

`N = 5` alone is not an estimator. The Bailey-style deflated Sharpe needs both `N` and a
vector of trial Sharpes for `sigmaSR`, and withdrawing H3/H4 leaves only two observed
daily series. The following is therefore locked here rather than left to implementation:

1. **`sigmaSR` is computed over OBSERVED daily series only** — H1 and H2B. A trial that
   was never evaluated has no Sharpe. Assigning it `SR = 0` would fabricate an
   observation and would bias `sigmaSR` downward, which loosens the gate. Unrun trials
   are excluded from `sigmaSR` and counted only in `N`.
2. **`expectedMaxSR` uses `N = 5`** with the frozen coefficient formula, so the
   multiplicity burden of the full search is retained even though only two series exist.
3. **With fewer than three observed series, `sigmaSR` is not reliably estimable.** DSR is
   therefore computed and reported but becomes **advisory**, not a gate. `familyDsrGating`
   is recorded as `false` with reason `INSUFFICIENT_OBSERVED_SERIES`. A DSR below 0.95
   under this condition does not by itself produce `INSUFFICIENT`.
4. **Multiplicity control moves to the bootstrap, where it is well defined.** The
   one-sided circular block bootstrap bound tightens from `alpha = 0.05/3` to
   **`alpha = 0.05/5 = 0.01`**, matching `N = 5`. This is a stricter gate than the frozen
   specification, not a looser one, and it becomes the binding multiplicity correction.
5. If a future family again has three or more observed series, DSR returns to being a
   gate at the frozen 0.95 threshold with `N` equal to the then-current selection count.

Point 3 is a demotion and is called one. It is paired with point 4, which tightens the
gate that actually binds, so the net effect on the probability of advancing is negative.

## A5 — Analytic correctness fixtures are required before the fetch

Content addressing and byte-identical replay prove a computation is *reproducible*, not
that it is *correct*. H2B's PnL is a sum of up to 167 hourly funding cashflows under a
half-open interval convention with a boundary-ownership rule. A one-hour misalignment or
a sign error would replay byte-identically forever and pass every existing gate.

Before the canonical fetch, the following must exist as closed-form fixtures whose
expected values are derived by hand rather than from the implementation:

1. A single 168-hour position with constant funding rate `r`, verifying the position owns
   exactly 167 events and total funding equals `-signedUnits * proxy * r * 167`.
2. Sign correctness for a short perpetual under positive and negative funding.
3. Boundary exclusion: events stamped exactly at entry and exactly at exit are excluded.
4. The conservative proxy selecting the containing bar's low for a credit and high for a
   debit.
5. A full round trip whose spot principal, perpetual price PnL, fees and slippage tie to
   an independently hand-computed NAV to the cent.

## A6 — Reconcile the forward-paper contract without self-scaling it

The frozen contract requires at least 180 calendar days **and** at least 50 effective
episodes. At H2B's 172-hour minimum cycle, 50 episodes is 358 days at a 100% duty cycle
and several years at realistic duty cycles, so the two floors cannot both be met by any
strategy this family can produce.

An earlier draft scaled the episode floor by the forward run's own realized duty cycle.
That was wrong: a strategy that traded less would face a lower bar, so sparsity would
purchase its own approval. The target must not be estimated on the sample used to pass.

**Change:**

- The expected duty cycle is **frozen in advance** from H2B's historical result, recorded
  in the admission manifest before the forward job starts. It is never re-estimated from
  forward data.
- The forward floor is 180 calendar days **and at least 30 effective exposure episodes**.
- If the frozen duty cycle implies 30 episodes will take longer than 180 days, the
  forward period **extends** until 30 episodes accrue. The bar is never lowered to fit
  the calendar.
- 30 is below the historical 40-episode floor and is stated as such: forward paper at 30
  episodes remains underpowered by the same arithmetic this amendment is built on. It is
  a feasibility floor, not a claim of statistical sufficiency, and the resulting evidence
  is explicitly labelled as such in the admission manifest.

The 60-consecutive-day incident-free requirement is unchanged.

## A7 — Scope of this amendment

This amendment does **not** restore statistical power to H2B. It adds no data, no assets,
and no history. The operative bootstrap hurdle is now stricter, not looser. `UNDERPOWERED`
or an outright failure remains the most likely outcome, and that expectation is recorded
here so the eventual result cannot be presented as a surprise.

No further edit to any H2B gate, threshold, or verdict mapping is permitted after this
document is committed. That prohibition is absolute and is not subject to a further
amendment.

## Run commitment

Delay without a dated commitment is indistinguishable from avoidance. Therefore:

1. A5's analytic fixtures are implemented and committed.
2. The canonical snapshot is fetched.
3. H2B is evaluated once and its verdict published unchanged, whatever it is.

No further amendment to H2B's economics or gates is permitted after this document is
committed. If H2B returns `UNDERPOWERED`, the correct response is prospective data
collection, not another retrospective variant on this snapshot.

## Unchanged

Everything not named above remains as frozen at `a3c871d`: the source contract, paging,
chronology, the admission controller, funding proxy and ownership, cost schedule, episode
definitions, drawdown construction, the bootstrap procedure, HYPE quarantine, the
stop-mining clause, and every capital and authorization boundary. Live trading, wallet
creation, and key generation remain prohibited.
