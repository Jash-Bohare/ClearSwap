# 07 — Test Specification
### Project: ClearSwap — MEV-Resistant Batch Auction DEX

> Every test case below has concrete numbers and exact expected output — no test in this doc should require the implementer to guess what "correct" means. Where a case reuses a fixture from earlier docs, that's deliberate (see `06 §6`): one canonical set of numbers running through the protocol spec, the Rust unit tests, the Foundry tests, and the live demo means a failure anywhere is immediately comparable to everywhere else.

---

## 1. Unit Tests — Order Validation

- [ ] **Zero amount rejected** — `submitOrder(_, 0, _)` reverts with `OrderTooSmall` (`04 §4`).
- [ ] **Amount below `MIN_ORDER_SIZE`** (`1e15` wei / 0.001 WETH per `03 §12`) rejected — `submitOrder(_, 5e14, _)` reverts with `OrderTooSmall`.
- [ ] **Invalid price rejected** — `submitOrder(_, _, 0)` reverts (a zero limit price is never valid for either side per `03 §4`; treat as malformed input, not a legitimate "sell for free" order).
- [ ] **Closed batch rejects direct submission into it** — attempting to submit against a `batchId` whose status is not `OPEN` reverts with `BatchNotOpen` (`04 §4`); note this should be effectively unreachable through the normal `submitOrder(...)` path since it always targets "whatever the current batch is" (`03 §6`), but must still be tested directly against the internal check.
- [ ] **Cancellation only while `OPEN`** — cancel succeeds pre-close, reverts with `OrderNotCancellable` post-close (`03 §14`, `04 §4`).
- [ ] ~~Insufficient balance rejected~~ — **see Known Limitation below; this exact test does not apply to `submitOrder` as specified.**

> **Known Limitation (carried from `06 §5`):** ClearSwap does not pre-pull funds at submission (`02 §12`, `03` custody model) — there is no on-chain balance check in `OrderBook.submitOrder` at all, by design. "Insufficient balance" can only be observed at **settlement time**, when `Settlement.sol` attempts the token pull (`04 §6`). The correct test for this behavior lives in **§3 Settlement Tests** below (`test_settlement_handles_underfunded_trader`), not here. Do not implement or expect an on-chain balance check inside `OrderBook.sol` — that would silently contradict the no-pre-funding design in `03`.

---

## 2. Clearing Tests

All five cases below should be implemented as both Rust unit tests (`05 §11`) and Foundry integration tests (`04 §10`) — the Rust tests validate the algorithm in isolation, the Foundry tests validate it through the full `ClearingAdapter` → `Settlement` path.

### Case 1 — Perfect Match

| Order | Side | Amount (WETH) | Limit Price |
|---|---|---|---|
| B1 | BUY | 2.0 | 3000 |
| S1 | SELL | 2.0 | 3000 |

**Expected:**
- `clearing_price = 3000` (only one candidate price exists)
- `B1.filled_amount = 2.0`, `S1.filled_amount = 2.0` — both fully filled, no rationing logic exercised at all.
- Purpose: baseline sanity case with zero ambiguity, exercises none of the tie-break or pro-rata machinery — if this fails, the bug is fundamental, not an edge case.

### Case 2 — Partial Fill

**This is the exact `03 §17` worked example** — reused verbatim, not restated here in full (see `03 §17` for the full 6-order table and step-by-step derivation).

**Expected:**
- `clearing_price = 3010`
- `B1.filled_amount = 2.0`, `B2.filled_amount = 1.0` (buy side, exact match)
- `S1.filled_amount = 1.285714285714285715` WETH, `S2.filled_amount = 1.714285714285714285` WETH (sell side, pro-rata + 1-wei remainder to `S1` per its lower `orderId`)
- `B3` and `S3` do **not** appear in `fills` at all (ineligible, roll forward per `03 §13`)

### Case 3 — Only Buys

| Order | Side | Amount (WETH) | Limit Price |
|---|---|---|---|
| B1 | BUY | 1.0 | 3000 |
| B2 | BUY | 2.0 | 3050 |

**Expected:**
- No sell orders exist, so `SellQty(P) = 0` for every candidate price → `Volume(P) = 0` everywhere.
- `clearing_price = 0`, `fills = []` (`03 §8`, `§13`).
- Both `B1` and `B2` roll forward into the next batch, `status` remains `PENDING`, no tokens move.

### Case 4 — Only Sells

Symmetric to Case 3 — one or more sell orders, zero buy orders.

**Expected:** identical shape to Case 3 — `clearing_price = 0`, `fills = []`, all sell orders roll forward untouched.

### Case 5 — Multiple Prices (Tie-Break Exercise)

| Order | Side | Amount (WETH) | Limit Price |
|---|---|---|---|
| B1 | BUY | 1.0 | 3050 |
| B2 | BUY | 1.0 | 3000 |
| S1 | SELL | 1.0 | 2990 |
| S2 | SELL | 1.0 | 3010 |

**Walkthrough** (all four candidate prices — 2990, 3000, 3010, 3050 — produce `Volume(P) = 1`, and every one of them also produces `Imbalance(P) = 1` — a full tie on both stages of `03 §8`'s tie-break):

| P | BuyQty | SellQty | Volume | Imbalance |
|---|---|---|---|---|
| 2990 | 2.0 | 1.0 | 1.0 | 1.0 |
| 3000 | 2.0 | 1.0 | 1.0 | 1.0 |
| 3010 | 1.0 | 2.0 | 1.0 | 1.0 |
| 3050 | 1.0 | 2.0 | 1.0 | 1.0 |

**Expected:**
- Tie-break rule 1 (minimize imbalance) does not break the tie — all four candidates tie at `Imbalance = 1.0`.
- Tie-break rule 2 (lowest price) resolves it: **`clearing_price = 2990`**.
- Eligible buys at 2990: `B1`, `B2` (both `limitPrice ≥ 2990`) → eligible qty = 2.0. Eligible sells: `S1` only (`limitPrice ≤ 2990`) → eligible qty = 1.0. `V = 1.0`.
- Sell side exact match: `S1.filled_amount = 1.0`.
- Buy side rationed pro-rata (excess qty = 2.0, V = 1.0): `B1.filled_amount = 0.5`, `B2.filled_amount = 0.5` — this divides evenly, **no remainder distribution triggered**, which is deliberate: this case isolates the tie-break logic without also exercising the §10 remainder rule (that's already covered by Case 2), so a failure here points specifically at tie-break code, not rounding code.

---

## 3. Settlement Tests

- [ ] **Balances correct** — after settlement, every filled trader's on-chain token balance changes by exactly the amount computed per `04 §6`'s `quoteAmount` formula; verify both legs (base and quote) for both a buyer and a seller in the same batch.
- [ ] **Fills correct** — each `Order.status` updates to `FILLED` (fully matched) or `PARTIALLY_FILLED` (per `03 §10`) accurately reflecting the `ClearingResult` applied.
- [ ] **Unfilled funds preserved** — for any order left `PENDING`/`PARTIALLY_FILLED` with remainder, assert **zero** token transfer occurred for that order's unfilled portion, and that it rolled forward per `03 §13` (`OrderBook.rollOrder` called with the correct new `batchId`).
- [ ] **No double settlement** — calling `settleBatch` twice on the same `batchId` reverts with `BatchNotInClearingState` the second time (batch is already `SETTLED`, not `CLEARING`) — see Invariant Tests below, this is also asserted there as a protocol-level invariant, not just a function-level check.
- [ ] **`test_settlement_handles_underfunded_trader`** *(replaces the inapplicable "insufficient balance rejected" unit test from §1)* — construct a batch where one filled trader does not hold sufficient token balance/allowance to cover their settlement pull. Assert the actual behavior matches the documented MVP behavior per `06 §5`'s Known Limitation (for the MVP: this may legitimately revert the whole batch's settlement — acceptable and should be **explicitly asserted and documented as expected**, not discovered as a surprise). This test exists to make the limitation visible and intentional, not to pretend it doesn't exist.

---

## 4. Invariant Tests

These should run against **every** clearing test case in §2, not just as one-off tests — implement as a shared assertion helper invoked at the end of each case.

**Invariant: `sum(user debits) == sum(user credits)`**
For every settled batch, the total quote-token amount pulled from filled buyers must equal the total quote-token amount credited to filled sellers, and symmetrically for the base-token leg (`03 §15` invariant 2). Assert this exactly, not within a tolerance — per `03 §11`, both legs of a fill are computed from the same single `quoteAmount`, so this should hold with zero drift.

**Invariant: `executionPrice identical for all fills`**
Every `Fill.clearing_price` within one `ClearingResult` equals the top-level `clearing_price`, with no exceptions (`03 §15` invariant 3, `03 §9`). Assert this across every case in §2, including the tie-break case — the tie-break logic must never leak into per-fill pricing.

**Invariant: `settling twice impossible`**
Once a `batchId` reaches `SETTLED`, any subsequent `settleBatch` call for that `batchId` reverts (`04 §6`, `03 §5`'s state machine). Assert both that the second call reverts, and that no token transfers occur as a side effect of the reverted attempt (i.e., the revert happens before any transfer, not mid-way through a partial re-settlement).

**Additional invariants from `03 §15` worth their own explicit tests** (not restated by the three above):
- **No over-allocation** — `Σ filled_amount` on either side of any batch never exceeds that side's eligible quantity at `P*` (invariant 1).
- **Custody safety** — for any order that never appears in a batch's `fills`, assert zero balance change occurred for its trader as a result of that batch (invariant 4).
- **Determinism** — running clearing on the identical order set twice (independent calls, not relying on any prior state) produces byte-identical `ClearingResult`s (invariant 5) — this is `05 §11`'s `test_determinism_repeated_calls`, restated here as a protocol-level invariant so it's tracked at this level too, not just in the Rust test suite.

---

## 5. Integration Tests

Full path: **Frontend → contract → batch → Stylus → settlement.**

- [ ] **End-to-end happy path** — submit orders via the frontend's actual transaction flow (not a direct contract call bypassing the UI), advance/close the batch, confirm the Stylus call fires, confirm settlement executes, confirm the frontend's Screen 3/4 (`06`) render the correct clearing price and fill amounts read from on-chain events — this is the test that validates the whole doc stack (`01`–`06`) agrees with itself.
- [ ] **Rollover round-trip** — submit an order that goes unfilled in Batch N (e.g., via Case 3/4's only-one-side scenario), confirm it appears correctly in Batch N+1's order list on the frontend, confirm it's still cancellable there (`03 §14`).
- [ ] **Permissionless `closeBatch()` from a non-owner address** — confirm any address (not just a designated keeper) can successfully trigger batch close once the window elapses (`04 §8`), since the demo's manual "close batch now" trigger (`06 §6`) depends on this working from whatever address is driving the demo.
- [ ] **Sandwich comparison panel accuracy** — feed the same order set through both ClearSwap and the simulated sequential-AMM comparison (`06 §2`), confirm the displayed "value extracted" figure is computed consistently and doesn't silently drift from the actual clearing result being compared against.

---

## 6. Gas Tests

**Record:**

| Number of Orders (N) | Solidity clearing gas (benchmark) | Stylus clearing gas (actual) |
|---|---|---|
| 2 | ? | ? |
| 6 | ? | ? |
| 10 | ? | ? |

**Methodology note — this requires one new artifact not yet specified elsewhere:** the "Solidity clearing gas" column cannot be measured from the production system, because ClearSwap's production clearing logic only exists in Stylus (`02`, `05`) — there is no Solidity implementation of the algorithm anywhere in the real contract set, by design. To produce this comparison number, build a **throwaway, test-only Solidity contract** implementing the identical algorithm from `03 §7–§10` (same candidate-price sweep, same tie-break, same pro-rata allocation), used *exclusively* for gas benchmarking — never deployed as part of the actual settlement path, never reachable from `ClearingAdapter`. Flag this clearly in the repo (e.g., `test/benchmarks/SolidityClearingBenchmark.sol`) so nobody mistakes it for a real integration point.

- Measure actual gas via Foundry's gas reporting (`forge test --gas-report` or `vm.snapshotGas` equivalents) for the Stylus call through `ClearingAdapter`, and separately for a direct call to the benchmark Solidity contract, at each `N`.
- Run this **early** (`05 §9` already flags this) — it's a number the entire pitch narrative depends on (`01 §12`, `06 §2` Gas Comparison Panel), so it needs to exist and be favorable well before the final hours, not be assumed and discovered wrong live.
- If the Solidity benchmark turns out *not* to be meaningfully worse at the small `N` this MVP uses (plausible — the gas delta widens with `N`, and the demo's order count is deliberately small per `02 §14`), that's important to know immediately: it may mean choosing a larger demo `N` specifically to make the comparison honest and visible, rather than picking `N` for UI tidiness alone.
