# 05 — Clearing Engine Specification
### Project: ClearSwap — MEV-Resistant Batch Auction DEX (Stylus / Rust component)

> This is the spec for the single Stylus contract that is the entire reason this project needs Stylus at all (`01 §4`, `01 §12`). It implements exactly the algorithm fixed in `03 §7–§10` and exposes the interface boundary fixed in `04 §7`. Nothing here should introduce a rule that isn't already decided in `03` — this doc is about *how to implement it correctly and deterministically in Rust*, not about deciding new behavior.

---

## 1. Purpose

Calculate the deterministic uniform clearing price and fills for a batch of orders, per `03 §7–§10`, as a single stateless, externally-callable Stylus contract function.

---

## 2. Input

```text
Batch {
    orders[]
}
```

**Rust representation** (field order and types must exactly mirror the Solidity `Order` struct in `04 §2` for ABI compatibility per `02 §7`):

```rust
#[derive(Clone, Debug)]
pub struct Order {
    pub id: U256,
    pub trader: Address,
    pub is_buy: bool,
    pub amount: U256,       // base-asset wei (03 §2)
    pub limit_price: U256,  // quote-smallest-units per whole base token (03 §11)
    pub batch_id: U256,
    pub status: u8,
}
```

**Input constraints (validated on entry, before any computation begins):**
- `orders` may be empty (valid — maps to `03 §8` empty-batch case, produces a zero-price/zero-fills result, not a revert).
- Every order in `orders` MUST belong to the same `batch_id` — the Stylus contract does not trust the caller blindly; it re-checks this itself rather than assuming `ClearingAdapter` filtered correctly (defense in depth — see §7 Revert Conditions).
- All arithmetic in this contract uses `U256` (or Stylus SDK's fixed-width unsigned integer types) exclusively. **No floating-point types (`f32`/`f64`) may appear anywhere in this contract.** Floats are non-deterministic across platforms/compilers in ways integers are not, and the entire determinism guarantee in `03 §16` depends on this.

---

## 3. Output

```rust
#[derive(Clone, Debug)]
pub struct Fill {
    pub order_id: U256,
    pub trader: Address,
    pub is_buy: bool,
    pub filled_amount: U256,
    pub clearing_price: U256,   // identical across every Fill in one result — 03 §9
}

#[derive(Clone, Debug)]
pub struct ClearingResult {
    pub batch_id: U256,
    pub clearing_price: U256,  // P*. Zero iff fills.is_empty() — 03 §8, §13.
    pub fills: Vec<Fill>,
}
```

Field order/types mirror `04 §2`'s `ClearingResult`/`Fill` structs exactly — this struct is what crosses back over the Stylus→Solidity boundary and gets validated by `ClearingAdapter` (`04 §5`).

---

## 4. Algorithm (Step-by-Step)

This is a direct, literal implementation of `03 §7–§10` — no step here introduces new behavior; each step cites the protocol-spec section it implements.

```
1. VALIDATE: all orders share the same batch_id. If not, revert (see §7).

2. PARTITION: split orders into buys[] and sells[] by is_buy.                      (03 §3)

3. BUILD CANDIDATE PRICE SET:
   candidates = sorted, deduplicated set of limit_price across buys[] ∪ sells[]    (03 §7)
   — use a sorted Vec<U256> with dedup, NOT a HashMap/HashSet, to guarantee
     deterministic iteration order (see §5).
   — if candidates is empty (orders.is_empty()), return ClearingResult{ batch_id,
     clearing_price: 0, fills: vec![] } immediately.                              (03 §8, §13)

4. FOR EACH candidate price P (ascending order, deterministic):
     buy_qty(P)  = sum of amount for b in buys  where b.limit_price >= P
     sell_qty(P) = sum of amount for s in sells where s.limit_price <= P
     volume(P)   = min(buy_qty(P), sell_qty(P))
   — accumulate these into a Vec<(price, buy_qty, sell_qty, volume)>, iterated
     in ascending price order throughout, never re-ordered later.                 (03 §7)

5. SELECT P*:
   a. max_volume = max of volume(P) across all candidates
   b. tied = all candidates where volume(P) == max_volume
   c. if tied.len() > 1: keep only those minimizing |buy_qty(P) - sell_qty(P)|
   d. if still tied: P* = the smallest price among the remaining set
      (trivial given step 4's ascending iteration — take the first survivor)       (03 §8)
   — if max_volume == 0 (no liquidity overlap at any price): return
     ClearingResult{ batch_id, clearing_price: 0, fills: vec![] }.                 (03 §13)

6. DETERMINE ELIGIBILITY at P*:
   eligible_buys  = { b in buys  : b.limit_price >= P* }
   eligible_sells = { s in sells : s.limit_price <= P* }
   V = min(sum(eligible_buys.amount), sum(eligible_sells.amount))                  (03 §9)

7. ALLOCATE FILLS:
   — the side whose eligible sum == V fills every eligible order in full.
   — the side whose eligible sum > V (the excess side) is rationed pro-rata:
       for each eligible order i on excess side:
         raw_fill_i = (order_i.amount * V) / excess_side_eligible_sum   (integer division, floors)
       shortfall R = V - sum(raw_fill_i)
       distribute R, one unit at a time, to eligible excess-side orders
         sorted ascending by order_id, until R == 0.                               (03 §10)

8. EMIT Fill entries only for orders with filled_amount > 0. Orders with
   filled_amount == 0 (ineligible / rolled) are NOT included in fills[] —
   Settlement.sol / OrderBook.sol handle rollover for anything absent here,
   this contract does not need to enumerate non-fills.

9. RETURN ClearingResult{ batch_id, clearing_price: P*, fills }.
```

---

## 5. Determinism & Ordering Guarantees (Rust-Specific)

This section exists because Rust's standard collections make it easy to accidentally break the determinism guaranteed in `03 §16` without realizing it. Explicit rules for implementation:

- **Never use `HashMap` or `HashSet` for anything that affects the result.** Rust's default hasher is randomized per-process specifically to prevent HashDoS — this means iteration order over a `HashMap` is *not* guaranteed stable across calls, which would silently violate `03 §16`. Use `Vec` with explicit `.sort()` (or `BTreeMap`, which has deterministic ordering by key) everywhere a "set" or "grouped" structure is needed.
- **All sorting must use a total, stable order.** Sort candidate prices ascending by value. Where two orders tie on a sort key relevant to allocation (§4 step 7), the tie-break key is always `order_id` ascending — never insertion order into an internal `Vec` unless that `Vec` was itself built by iterating orders in their original, stable input array order (which it is, per step 2).
- **No wall-clock time, block randomness, or any external/non-input data may influence any step.** The only inputs to this function are the `orders` array; the result must be a pure function of that array.
- **No floating point** (already stated in §2, repeated here because it's a determinism rule, not just a style rule).

---

## 6. Numerical Precision & Overflow Handling

- All arithmetic (`amount`, `limit_price`, sums, products) uses `U256`. Use checked arithmetic (`checked_add`, `checked_mul`, `checked_div`) rather than raw operators — an overflow here should be an explicit, loud revert (§7), never silent wraparound.
- `quoteAmount` conversion (`filled_amount * price / 10^BASE_DECIMALS`) is **not** computed in this contract — per `04 §6`, that conversion is `Settlement.sol`'s responsibility. This contract only ever outputs `filled_amount` in base-asset units and the single `clearing_price`; it does not compute or reason about quote-token amounts at all. Keeping this conversion out of the Stylus contract keeps its interface and testing surface minimal.
- Multiplication before division is mandatory in the pro-rata formula (`amount * V / eligible_sum`, never `amount / eligible_sum * V`) to preserve precision — dividing first would introduce needless truncation error beyond what `03 §10`'s remainder-distribution rule already accounts for.

---

## 7. Revert Conditions

The Stylus contract MUST revert (panic / return an error causing the outer call to revert — whichever the Stylus SDK's convention is, applied consistently) on:

| Condition | Reason |
|---|---|
| `orders` contains more than one distinct `batch_id` | Defense-in-depth against a caller bug in `ClearingAdapter` — this contract never trusts batch homogeneity, it verifies it (`§2`). |
| Any arithmetic operation overflows `U256` | Never silently wrap; an overflow means either malformed input or a bug, and either way settling on bad numbers is worse than reverting the batch (it can be retried). |
| Any order's `amount == 0` | Should be unreachable given `OrderBook`'s `MIN_ORDER_SIZE` check (`03 §12`, `04 §4`), but this contract does not trust that upstream check blindly — it re-validates. |

Conditions that must **NOT** revert (these are valid, expected outcomes, not errors):
- Empty `orders` array → valid zero-price/zero-fills result (`03 §8`, `§13`).
- No price at which `volume(P) > 0` → valid zero-price/zero-fills result (`03 §13`).
- Any degree of partial fill / rationing → valid, expected, not an error condition.

---

## 8. State & Storage

This contract holds **no persistent state**. It is a pure function from `(orders) → ClearingResult`, called once per batch by `ClearingAdapter` (`04 §7`, `02 §3.4`). It does not store batches, orders, or prior results across calls. All persistence (order storage, batch lifecycle, settlement state) lives in the Solidity contracts per `04`. If the implementation finds itself wanting to add a storage variable to this contract, that's a signal something has drifted from the architecture in `02` and should be re-checked against it before proceeding.

---

## 9. Performance & Gas Considerations

- **Complexity:** building the candidate set and sorting is `O(n log n)` in the number of orders; the price sweep (§4 step 4) is `O(n × k)` naively (n orders, k candidates, k ≤ n) or `O(n log n)` with a proper cumulative-sum sweep over sorted orders — implement the latter if time allows, but the naive version is acceptable for the MVP's bounded batch size (`02 §14`: small fixed cap, e.g. 6–10 orders) and should not be prematurely optimized under time pressure.
- **This is precisely the computation this whole project's Stylus argument rests on** (`01 §4`, `01 §12`): iterative numeric aggregation across an order set, with sorting and per-candidate summation, is the class of workload that's gas-prohibitive to do as Solidity storage-loop operations but cheap as compiled Rust. The gas-comparison demo panel (`02 §9`) depends on this contract's real, measured gas cost being meaningfully lower than a hypothetical/benchmarked pure-Solidity equivalent doing the same `O(n log n)` work — this is worth actually measuring early (a rough benchmark on day one, not left until the final hours), since it's a claim the whole pitch leans on.
- Avoid unnecessary heap allocation/cloning inside the hot loop (step 4/7) — the Stylus/WASM cost model still charges for this, even if less than equivalent EVM storage operations.

---

## 10. Interop / ABI Encoding

- Struct field order, names, and types in Rust (§2, §3) must byte-for-byte match the Solidity structs in `04 §2` — use the Stylus SDK's Solidity ABI type derivation (e.g. `alloy-sol-types` / Stylus SDK equivalents) rather than hand-rolled encoding, to eliminate an entire class of boundary bugs.
- The externally-exposed entry point signature must match `04 §7` exactly: `computeClearing(Order[] orders) returns (ClearingResult)`.
- No custom error types need to cross the ABI boundary for the MVP — a revert with no structured error data is sufficient; `ClearingAdapter` already treats any Stylus call failure as `StylusCallFailed` (`04 §5`) regardless of the underlying reason.

---

## 11. Testing Plan (Rust unit tests, `cargo test`)

Mirror the Foundry test plan in `04 §10`, but exercised directly against the Rust function (faster iteration than round-tripping through Solidity while developing the algorithm):

- **`test_worked_example_matches_spec()`** — feed the exact 6-order batch from `03 §17`, assert `clearing_price == 3010`, assert `S1.filled_amount == 1_285714285714285715` and `S2.filled_amount == 1_714285714285714285` (wei), assert `B1`/`B2` fully filled and appear in `fills`, assert `B3`/`S3` do **not** appear in `fills` at all. This is the single most important test in the whole project — if this doesn't pass, nothing downstream can be trusted.
- **`test_empty_batch_returns_zero_result()`** — `orders = vec![]` → `clearing_price == 0`, `fills.is_empty()`.
- **`test_one_sided_batch_returns_zero_result()`** — all buys, no sells (or vice versa) → `clearing_price == 0`, `fills.is_empty()` (`03 §13`).
- **`test_exact_match_no_rationing()`** — construct a batch where `buy_qty(P*) == sell_qty(P*)` exactly, assert every eligible order is fully filled, no rounding/remainder logic triggered.
- **`test_determinism_repeated_calls()`** — call the function twice with a cloned, identically-ordered input, assert byte-identical output structs (`03 §16`).
- **`test_tie_break_minimizes_imbalance_then_lowest_price()`** — construct a batch with a deliberate multi-price volume tie, assert the imbalance-minimizing price is chosen, and a second case where imbalance also ties, asserting the lowest price wins (`03 §8`).
- **`test_rejects_mixed_batch_ids()`** — pass orders with two different `batch_id` values, assert revert (`§7`).
- **`test_overflow_reverts_not_wraps()`** — construct amounts/prices near `U256::MAX` designed to overflow the pro-rata multiplication, assert a revert rather than a wrapped/incorrect result (`§6`, `§7`).

These tests should exist and pass **before** wiring `ClearingAdapter`'s Solidity-side call to this contract — validate the Rust logic in isolation first, since debugging a wrong clearing price is far faster in a `cargo test` loop than in a full Foundry integration test with real token transfers.

---

## 12. Invariants (Restated for This Component)

Everything in `03 §15` applies; the subset this contract is directly responsible for producing correctly:

- **Invariant 3 (single-price guarantee):** every `Fill.clearing_price` in the returned `ClearingResult` is identical, and equal to the top-level `clearing_price`.
- **Invariant 5 (determinism):** identical `orders` input always produces byte-identical `ClearingResult` output (§5, §11).
- **Invariant 6 (pro-rata fairness):** within the excess side, allocation is proportional to `amount`, with only the bounded, deterministic remainder distribution as an exception (§4 step 7).

This contract does **not** own invariants 1, 2, or 4 from `03 §15` (no-over-allocation-beyond-availability across the whole system, quote-value conservation, custody safety) — those are enforced by `ClearingAdapter`'s validation (`04 §5`) and `Settlement.sol` (`04 §6`), since they involve token movement and cross-contract state this contract has no visibility into. This contract's job is to be *correct*; the Solidity boundary's job is to *not blindly trust it anyway*.

---

## 13. Explicit Non-Goals for This Component

- No event emission (Stylus contract has no events relevant to the demo indexer — those are emitted by `OrderBook.sol`/`Settlement.sol` per `04 §4`/`§6`).
- No token transfers, balance checks, or custody logic of any kind.
- No batch lifecycle management (open/close timing) — this contract only ever sees a batch's frozen order set after the fact.
- No persistent storage (§8).
- No knowledge of `MIN_ORDER_SIZE` enforcement — that's `OrderBook.sol`'s job (`04 §4`); this contract's zero-amount check (§7) is a defensive backstop, not the primary enforcement point.
