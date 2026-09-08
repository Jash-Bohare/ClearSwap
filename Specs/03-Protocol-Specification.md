# 03 — Protocol Specification
### Project: ClearSwap — MEV-Resistant Batch Auction DEX

> This document defines the exact economic and mathematical behavior of the protocol — precisely enough that an AI IDE or a human engineer can implement the clearing engine with zero ambiguity left to interpretation. Every rule below is a decision, not a placeholder. Language-specific implementation (Rust/Solidity code, storage layout, gas optimization) belongs in `04`, not here.

---

## 1. Purpose

Define the exact economic and mathematical behavior of ClearSwap: how a clearing price is selected, how fills and partial fills are allocated, how rounding and dust are handled, and what invariants must hold in every batch — with no room for two correct implementations to disagree on the result given the same inputs.

---

## 2. Trading Pair

- **Base asset:** `WETH` (mock, 18 decimals) — `BASE_DECIMALS = 18`
- **Quote asset:** `USDC` (mock, 6 decimals) — `QUOTE_DECIMALS = 6`
- Pair: **WETH/USDC**, single hardcoded pair for the MVP (per `02 §13`, no multi-pair support).

All order amounts are denominated in **base asset smallest units** (wei). All prices are denominated in **quote smallest units per one whole base token** (see §11 for the precision convention — this single convention removes all floating-point ambiguity from the system).

---

## 3. Order Model

Each order contains:

| Field | Type | Notes |
|---|---|---|
| `orderId` | `uint256` | Assigned sequentially at submission; used as the deterministic tie-break key everywhere below. |
| `trader` | `address` | |
| `side` | `enum { BUY, SELL }` | |
| `amount` | `uint256` | In base-asset wei. This is the *original requested amount*; it never changes — fills are tracked separately as `filledAmount`. |
| `limitPrice` | `uint256` | In quote-smallest-units per whole base token (see §11). |
| `batchId` | `uint256` | Which batch this order currently belongs to. Updated on rollover (§13). |
| `status` | `enum { PENDING, PARTIALLY_FILLED, FILLED, CANCELLED }` | |

---

## 4. Order Semantics

- **BUY order:** trader wants to acquire `amount` of BASE, paying at most `limitPrice` (quote per base). Willing to transact at any clearing price `P ≤ limitPrice`.
- **SELL order:** trader wants to dispose of `amount` of BASE, receiving at least `limitPrice` (quote per base). Willing to transact at any clearing price `P ≥ limitPrice`.

There are no market orders in the MVP — every order carries an explicit `limitPrice` (per `02 §13`, only simple limit orders are in scope).

---

## 5. Batch Lifecycle

**States:** `OPEN → CLOSED → CLEARING → SETTLED`

**Transitions:**
```
OPEN     → CLOSED     (batch window elapses; no external trigger required beyond time check)
CLOSED   → CLEARING   (Batch Manager invokes the Stylus clearing call)
CLEARING → SETTLED    (Settlement Contract applies the ClearingResult)
```

Any transition attempted outside this exact sequence **MUST revert**. Specifically:
- No order may be submitted into a batch that is not `OPEN`.
- `closeBatch` may only be called on a batch currently `OPEN`, and only after `currentTime ≥ batchEnd`.
- `computeClearing` may only be invoked on a batch currently `CLOSED`.
- `settleBatch` may only be invoked with a `ClearingResult` for a batch currently `CLEARING`.

---

## 6. Batch Window

- **Batch duration:** `BATCH_WINDOW_SECONDS = 45` (default for demo; owner-configurable per `02 §10`, tune after a dry run — 30-60s range per `02 §14`).
- A batch accepts orders while `currentTime < batchEnd`, where `batchEnd = batchStart + BATCH_WINDOW_SECONDS`.
- After `currentTime ≥ batchEnd`: no new orders accepted into that batch. Any submission arriving after expiry is automatically routed into the **next** batch (which opens immediately — batches are back-to-back with zero gap, per `02 §3.3`), rather than reverting. This keeps the system continuously live and removes an entire class of "why did my transaction fail" demo failure modes.

---

## 7. Clearing Algorithm

**Given**, for a closed batch:
- Buy orders `B = {B1, B2, ..., Bn}`, each with `(amount_i, limitPrice_i)`.
- Sell orders `S = {S1, S2, ..., Sm}`, each with `(amount_j, limitPrice_j)`.

**Candidate price set.** The clearing price is always one of the submitted limit prices (a standard result for uniform-price call auctions with discrete orders — the true equilibrium price sits at a marginal order's limit, so searching outside the submitted price set is unnecessary and wasteful). Define:

```
CandidatePrices = the set of all distinct limitPrice values across B ∪ S
```

**For each candidate price `P` in `CandidatePrices`:**

```
BuyQty(P)  = Σ amount_i   for all Bi where limitPrice_i ≥ P     (demand willing to pay at least P)
SellQty(P) = Σ amount_j   for all Sj where limitPrice_j ≤ P     (supply willing to accept at most P)
Volume(P)  = min(BuyQty(P), SellQty(P))
```

This produces a step function of executable volume over the candidate price set. The clearing price is the `P` that maximizes `Volume(P)` (see §8 for full selection + tie-break rule).

---

## 8. Clearing Price Selection

**Primary rule:** select `P*` that maximizes `Volume(P)`:

```
P* ∈ argmax_{P ∈ CandidatePrices} Volume(P)
```

**Tie-break rule 1 — minimize imbalance.** If multiple candidate prices achieve the same maximum volume, select the one minimizing the absolute order-flow imbalance at that price:

```
Imbalance(P) = |BuyQty(P) - SellQty(P)|
P* ∈ argmin_{P ∈ argmax-set} Imbalance(P)
```

**Tie-break rule 2 — lowest price wins.** If still tied after rule 1 (identical volume *and* identical imbalance across multiple candidate prices), select the **lowest** such price:

```
P* = min(remaining tied candidates)
```

This two-stage tie-break is fully deterministic, requires no randomness or external input, and mirrors the maximum-volume / minimum-imbalance methodology used by real exchange opening-auction mechanisms — a credible, explainable answer if a judge asks "how did you pick the price."

**Empty batch edge case:** if `CandidatePrices` is empty (no orders in the batch at all), there is no clearing price — the batch transitions `CLOSED → SETTLED` with an empty `ClearingResult` and zero fills. No revert; this is a valid, uneventful outcome.

---

## 9. Fill Rules

Given `P*` from §8, an order is **eligible** to execute if and only if:

- **BUY order eligible** iff `limitPrice ≥ P*`
- **SELL order eligible** iff `limitPrice ≤ P*`

Every eligible order that executes does so **at `P*`, with no exceptions** — this is the uniform-price guarantee the entire protocol exists to provide (`01 §4`). An order's own limit price is used only to determine *eligibility*, never as the price it actually receives.

Orders that are not eligible (e.g., a buy order whose limit was below `P*`) remain fully unfilled and roll forward per §13.

---

## 10. Partial Fills

Let `V = Volume(P*)` (the executable volume from §7/§8). Two cases:

**Case A — exact match.** `BuyQty(P*) == SellQty(P*) == V`. Every eligible order fills completely. No partial fills, no rationing needed.

**Case B — excess on one side.** One side's eligible quantity exceeds `V`. That side must be **rationed pro-rata**; the other side (whose eligible quantity equals `V`) fills completely.

**Pro-rata allocation rule (the excess side):**

For each eligible order `i` on the excess side, with eligible quantity `EligibleQty` = `BuyQty(P*)` or `SellQty(P*)` (whichever is the excess side):

```
rawFill_i = amount_i * V / EligibleQty        (integer division, floored — see §11)
```

**Why pro-rata, not price-time priority:** allocating by submission order/time would reintroduce exactly the kind of "being first matters" incentive that batch auctions exist to eliminate (`01 §4`). Pro-rata sizing means no trader gains anything by racing to submit within an open batch — this is a direct extension of the protocol's MEV-resistance property, not an arbitrary implementation choice, and is worth stating explicitly in the demo pitch.

**Remainder distribution (handling floor-division leftovers):** because `rawFill_i` is floored per order, `Σ rawFill_i` will generally be slightly less than `V`. The shortfall `R = V - Σ rawFill_i` (guaranteed `0 ≤ R < number of eligible orders on the excess side`) is distributed **one wei-equivalent unit at a time**, in ascending `orderId` order, to eligible orders on the excess side, until `R` is exhausted. This is fully deterministic (orderId is a stable, unique, monotonic key) and never over-allocates.

---

## 11. Rounding & Precision

- **Price precision:** `limitPrice` and `P*` are integers denominated as **quote-smallest-units per one whole base token** (i.e., for WETH/USDC, a price of `3000_000000` means 3000 USDC per 1 WETH, expressed in USDC's 6-decimal smallest units).
- **Converting a fill to a quote amount owed/received**, given a `filledAmount` (base wei) at price `P*`:

```
quoteAmount = (filledAmount * P*) / 10^BASE_DECIMALS      // floored, integer division
```

  `10^BASE_DECIMALS` (`= 1e18`) is the scaling constant because `filledAmount` is expressed in base-wei (18 decimals) while `P*` is expressed per *whole* base token.

- **Rounding direction: always floor (round down), always computed once per fill and applied identically to both counterparties.** Because a single `quoteAmount` value is computed once per matched fill and used for *both* the buyer's payment and the seller's receipt, there is no possibility of asymmetric rounding leakage between the two sides of the same fill — both parties see exactly the same number. This is a deliberate design choice, not an oversight: never compute the buyer's owed amount and the seller's owed amount separately.
- Any dust from floor-division (sub-smallest-unit remainders) is economically negligible (fractions of a wei-equivalent) and is simply **not settled** — it is not tracked, refunded, or accumulated anywhere. This is acceptable and should be stated plainly as a known, intentional MVP simplification if asked.

---

## 12. Dust (Minimum Order Size)

- **`MIN_ORDER_SIZE = 0.001 WETH` (`1e15` wei)**, defined as a protocol constant.
- Orders below `MIN_ORDER_SIZE` **REVERT at submission** (not "remain unfilled" — rejecting at the door is strictly simpler, avoids an entire category of tiny-order edge cases in the clearing math, and gives the submitter immediate, actionable feedback rather than a silently-ignored order). This is a deliberate simplification decision for the MVP.

---

## 13. No Liquidity

If, at batch close, either side has zero total quantity (`BuyQty(P) = 0` for all `P`, or equivalently `SellQty(P) = 0` for all `P`), then `Volume(P) = 0` for every candidate price, and:

- **No execution occurs** for this batch — no fills, no settlement transfers.
- **Orders roll forward automatically**: every order in the batch has its `batchId` updated to point at the newly-opened next batch, and its `status` remains `PENDING`.
- **No refunds are issued or needed**, because — per the no-pre-funding custody principle (`02 §12`) — funds were never pulled from any trader in the first place. "Refund" is not a meaningful concept in this design; nothing left the user's wallet.
- **Rolled orders remain cancellable** once their new batch is `OPEN` (see §14) — a trader is never stuck.
- This same rollover mechanism also applies to any individual order left unfilled after a partial-fill batch (§10) — it is one general rule, not a special case just for zero-liquidity batches.

---

## 14. Cancellation

- An order **may be cancelled if and only if its current `batchId`'s batch status is `OPEN`.**
- Once a batch transitions to `CLOSED` (window elapsed), orders belonging to it **cannot** be cancelled — they are locked in for that batch's clearing computation, full stop.
- If an order rolls forward into a new batch (§13) and that new batch is `OPEN`, the order becomes cancellable again, because it is now, by definition, an order in an `OPEN` batch. There is exactly one cancellation rule in the system; rollover doesn't require a special exception to it.

---

## 15. Economic Invariants

These must hold for **every** batch, and are the properties Foundry tests in `04` should assert directly:

1. **No user receives more tokens than they are entitled to.** `Σ filledAmount_i` across all fills on one side of a batch never exceeds `V` (Volume at `P*`).
2. **Value conservation.** For every batch, `Σ quoteAmount paid by filled buyers == Σ quoteAmount received by filled sellers` (both computed from the same `quoteAmount` per fill, per §11 — this invariant is true by construction, not something that needs reconciling after the fact).
3. **Single-price guarantee.** Every executed fill within one batch uses the identical `P*` — there is no code path in the system that settles two orders in the same batch at different prices.
4. **Custody safety.** Unfilled or rolled-forward order balances are never pulled from the user's wallet and therefore always remain fully in the user's own custody and withdrawable/cancellable per §14 — the protocol never "holds" a balance it hasn't just settled.
5. **Determinism.** Given identical order sets and identical batch configuration, the clearing engine always produces an identical `P*` and identical fill allocation (see §16 — this is what makes the algorithm testable and auditable at all).
6. **Pro-rata fairness.** Within the excess side of any partially-filled batch, no two orders of equal `amount` ever receive different `filledAmount` (aside from the single-wei-equivalent remainder distribution in §10, which is bounded and deterministic, not arbitrary).

---

## 16. Determinism

Given identical:
- orders (same set, same fields, same `orderId`s),
- batch configuration (`BATCH_WINDOW_SECONDS`, `MIN_ORDER_SIZE`),
- and contract state,

the clearing engine **MUST always produce**:
- an identical clearing price `P*` (guaranteed by the fully-specified argmax + two-stage tie-break in §8 — there is no step in this algorithm that depends on iteration order, wall-clock time, or any other non-reproducible input),
- identical fills (guaranteed by the pro-rata formula + deterministic remainder distribution by ascending `orderId` in §10),
- identical settlement results (guaranteed by the single-`quoteAmount`-per-fill rule in §11, which admits no rounding-direction ambiguity).

Determinism is not an aspiration here — every rule in §7–§11 was specifically written to close off the ambiguity that would otherwise break it (candidate-price search instead of continuous search, explicit two-stage tie-break instead of "pick one," floor-only rounding instead of "round appropriately," ascending-`orderId` remainder distribution instead of "distribute fairly"). This is what makes it safe to hand this document to an AI IDE and expect one correct implementation rather than N plausible ones.

---

## 17. Worked Example (for implementation + test-case seeding)

A concrete run-through, useful both for sanity-checking any implementation and as a ready-made Foundry test fixture.

**Batch contents:**

| Order | Side | Amount (WETH) | Limit Price (USDC/WETH) |
|---|---|---|---|
| B1 | BUY | 2.0 | 3050 |
| B2 | BUY | 1.0 | 3020 |
| B3 | BUY | 3.0 | 2990 |
| S1 | SELL | 1.5 | 2980 |
| S2 | SELL | 2.0 | 3010 |
| S3 | SELL | 1.0 | 3040 |

**Candidate prices:** `{2980, 2990, 3010, 3020, 3040, 3050}`

**Step through each candidate** (`BuyQty(P)` = sum of buy amounts with `limitPrice ≥ P`; `SellQty(P)` = sum of sell amounts with `limitPrice ≤ P`):

| P | BuyQty(P) | SellQty(P) | Volume(P) |
|---|---|---|---|
| 2980 | 6.0 (B1+B2+B3) | 1.5 (S1) | 1.5 |
| 2990 | 6.0 | 1.5 | 1.5 |
| 3010 | 3.0 (B1+B2) | 3.5 (S1+S2) | 3.0 |
| 3020 | 3.0 (B1+B2) | 3.5 | 3.0 |
| 3040 | 2.0 (B1) | 4.5 (S1+S2+S3) | 2.0 |
| 3050 | 2.0 (B1) | 4.5 | 2.0 |

**Max volume = 3.0, achieved at both P=3010 and P=3020 (tied).**

**Tie-break rule 1 (minimize imbalance):**
- At P=3010: `Imbalance = |3.0 - 3.5| = 0.5`
- At P=3020: `Imbalance = |3.0 - 3.5| = 0.5`
- Still tied.

**Tie-break rule 2 (lowest price wins):** `P* = 3010`.

**Fill eligibility at P\* = 3010:**
- Buys eligible (`limitPrice ≥ 3010`): B1 (3050), B2 (3020) → eligible qty = 3.0 WETH.
- Sells eligible (`limitPrice ≤ 3010`): S1 (2980), S2 (3010) → eligible qty = 3.5 WETH.
- B3 (limit 2990 < 3010) is **not eligible** — rolls forward unfilled.
- S3 (limit 3040 > 3010) is **not eligible** — rolls forward unfilled.

**Volume V = min(3.0, 3.5) = 3.0.** Buy side is the exact match (fills fully); sell side is the excess side (rationed).

**Buy side (exact match):** B1 fills 2.0 WETH, B2 fills 1.0 WETH — both fully filled.

**Sell side (pro-rata, excess qty = 3.5, V = 3.0):**
```
S1: rawFill = 1.5 * 3.0 / 3.5 = 1.2857...  → floor → 1.285714285714285714 WETH (18 decimals)
S2: rawFill = 2.0 * 3.0 / 3.5 = 1.7142...  → floor → 1.714285714285714285 WETH
Σ rawFill = 2.999999999999999999 WETH   →  shortfall R = 1 wei
```
Remainder distribution: 1 wei goes to the lowest `orderId` among {S1, S2} — say S1 was created first → **S1 final fill = 1.285714285714285715 WETH**, S2 unchanged.

**Settlement at P\* = 3010 USDC/WETH:**
- B1 pays `2.0 WETH * 3010 / 1e0` → quoteAmount computed per §11 scaling, receives 2.0 WETH.
- B2 pays for 1.0 WETH at 3010, receives 1.0 WETH.
- S1 receives quote for ~1.2857 WETH sold at 3010, sends that WETH.
- S2 receives quote for ~1.7143 WETH sold at 3010, sends that WETH.
- B3 and S3 roll forward into the next batch, fully intact, still cancellable once that batch is `OPEN`.

This example should be encoded directly as a Foundry test fixture in `04` — if an implementation doesn't reproduce `P* = 3010` and these exact fill amounts, it's non-conformant.
