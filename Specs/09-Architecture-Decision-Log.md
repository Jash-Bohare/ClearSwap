# 11 — Architecture Decision Log
### Project: ClearSwap — MEV-Resistant Batch Auction DEX

> Each ADR below is a decision already made and locked in docs `01`–`08` — this log exists so decisions remain settled and transparent throughout the build, and so an AI coding agent or builder can see *why* a rule exists, not just what it is. If a decision needs to change, that change must update this log **and** the source specification document it originated from — never one without the other.

---

## ADR-001
**Decision:** ClearSwap uses periodic batch auctions instead of continuous AMM execution.
**Context:** Sequential, price-impact-based execution (standard AMMs) makes sandwich attacks structurally possible — there is always a "before" and "after" a victim's trade that an attacker can occupy (`01 §1–§2`).
**Alternatives considered:** Continuous AMM with tighter slippage settings (rejected — damage limitation, not prevention, `01 §10`); off-chain solver/private-mempool MEV protection (rejected — reintroduces a trusted intermediary, `01 §10`).
**Reason:** MEV resistance — uniform-price batch clearing removes any "first" or "last" order to front-run or back-run (`01 §4`).
**Consequences:** Trades are not instant — users wait for the batch window to close (`03 §6`). This trade-off is accepted as core to the value proposition, not a limitation to hide.
**Status:** Accepted

---

## ADR-002
**Decision:** Clearing computation runs in Stylus (Rust), not Solidity.
**Context:** The uniform clearing-price computation requires iterating over an order set, sorting, and summing across candidate prices — numerically heavier than typical EVM storage-loop operations, historically gas-prohibitive to do fully on-chain (`01 §4`).
**Alternatives considered:** Off-chain solver computing the price, submitted with a validity proof (rejected — reintroduces a trusted/semi-trusted off-chain party, defeats the differentiation in `01 §11`); pure-Solidity implementation (kept only as a throwaway gas benchmark, `07 §6` — never as the production path).
**Reason:** Compute-heavy numerical processing that Stylus makes newly practical to run fully on-chain (`01 §4`, `05 §9`).
**Consequences:** Introduces a second language/toolchain and a cross-VM call boundary (`02 §7`) that must be defensively validated (`04 §5`) — accepted because the alternative (no on-chain clearing at all) doesn't achieve the trust-minimization goal.
**Status:** Accepted

---

## ADR-003
**Decision:** Only one trading pair (WETH/USDC) is supported in the MVP.
**Context:** Full generality (arbitrary pairs, dynamic pair registration) adds real implementation and testing surface area with no benefit to the demo's core argument.
**Alternatives considered:** Generic multi-pair architecture (rejected outright for this timeline — explicitly listed as a non-goal in `01 §8`, `02 §13`).
**Reason:** Hackathon scope — a single hardcoded pair is sufficient to prove the mechanism and keeps `03`'s entire protocol spec free of pair-parameterization complexity.
**Consequences:** Not production-generalizable as shipped; explicitly acceptable per `01 §8`.
**Status:** Accepted

---

## ADR-004
**Decision:** Partial fills on the excess side are allocated **pro-rata by order size**, not by price-time priority.
**Context:** A natural alternative for rationing excess demand/supply is "first come, first served" among eligible orders at the margin.
**Alternatives considered:** Price-time priority (rejected — reintroduces a "being first matters" incentive within a batch, directly undermining the MEV-resistance thesis this entire protocol is built on).
**Reason:** Pro-rata allocation means no trader gains anything from racing to submit within an open batch window — this is a direct extension of the batch auction's core property, not an arbitrary implementation choice (`03 §10`).
**Consequences:** Requires a deterministic remainder-distribution rule to handle floor-division leftovers (`03 §10`'s ascending-`orderId` rule) — a small added complexity, accepted because it closes the last gap in the MEV-resistance argument.
**Status:** Accepted

---

## ADR-005
**Decision:** No pre-funding — user funds are pulled only at settlement, never held in escrow while a batch is open.
**Context:** A naive order-book design might lock funds at order submission to guarantee settlement can always succeed.
**Alternatives considered:** Pre-funded escrow at submission (rejected — reintroduces exactly the custody-risk pattern the user explicitly asked to avoid, and sits idle/exposed for no benefit `02 §3.2`, `02 §12`).
**Reason:** Removes an entire class of custody risk and lets unmatched/rolled-forward orders remain trivially safe with zero refund logic needed (`03 §13`).
**Consequences:** Introduces the underfunded-trader risk documented in `06 §5` / `07 §3` — a trader can submit an order they can't cover, and depending on `Settlement.sol`'s loop design, this could revert an entire batch's settlement. **Accepted as a known, explicitly documented MVP limitation**, mitigated operationally (client-side balance check + pre-funded demo wallets) rather than architecturally, given the timeline.
**Status:** Accepted (with documented limitation — see also ADR-010)

---

## ADR-006
**Decision:** `closeBatch()` is permissionless — any address can trigger it once the window has elapsed.
**Context:** A keeper-bot or owner-only design is more typical for batch-triggered systems.
**Alternatives considered:** Owner-only or dedicated-keeper-only close (rejected — introduces a single point of failure/liveness dependency, and costs nothing extra to avoid since the time-check condition is identical either way).
**Reason:** Removes any dependency on a specific bot/address being online, both for production liveness and specifically for live-demo reliability (`04 §8`).
**Consequences:** None material — the time-window check already fully gates when the call can succeed regardless of caller.
**Status:** Accepted

---

## ADR-007
**Decision:** All fills use floor (round-down) division, and a single `quoteAmount` is computed once per fill and applied identically to both counterparties.
**Context:** Rounding direction and whether buyer/seller amounts are computed independently are both easy places for asymmetric leakage to creep in.
**Alternatives considered:** Rounding each side "in its own favor" independently (rejected — creates a path where a buyer's payment and a seller's receipt for the same fill could differ, breaking value conservation, `03 §15` invariant 2).
**Reason:** A single computed value per fill, applied to both sides, makes asymmetric rounding leakage structurally impossible rather than merely unlikely (`03 §11`).
**Consequences:** Sub-smallest-unit dust is simply not settled (economically negligible) — explicitly accepted as a stated MVP simplification, not silently ignored (`03 §11`).
**Status:** Accepted

---

## ADR-008
**Decision:** Orders below `MIN_ORDER_SIZE` (0.001 WETH) revert at submission rather than being accepted and left permanently unfillable.
**Context:** Very small orders complicate pro-rata rounding math for negligible economic benefit.
**Alternatives considered:** Accept all order sizes and let tiny orders simply "remain unfilled" if uneconomical (rejected — adds edge cases to the clearing algorithm's rounding logic, `03 §12`, for orders too small to matter anyway).
**Reason:** Rejecting at the door is strictly simpler, gives the submitter immediate actionable feedback, and removes an entire category of tiny-order edge cases from `05`'s implementation.
**Consequences:** A legitimate need for genuinely tiny trades is unmet in the MVP — acceptable, out of scope per `01 §8`.
**Status:** Accepted

---

## ADR-009
**Decision:** The Stylus clearing engine must never use `HashMap`/`HashSet` for anything affecting the result, and must never use floating-point types.
**Context:** Rust's default `HashMap` hasher is randomized per-process (a HashDoS mitigation), meaning iteration order is not guaranteed stable across calls — this can silently violate the determinism invariant.
**Alternatives considered:** None seriously — this isn't a trade-off decision so much as a correctness guardrail once the determinism requirement (`03 §16`) was fixed.
**Reason:** Determinism (`03 §16`, invariant 5 in `03 §15`) requires that identical inputs always produce byte-identical outputs; both unordered hash collections and floating-point arithmetic can break this in ways that are easy to miss in casual testing and only surface intermittently (`05 §5`).
**Consequences:** Slightly more verbose Rust (explicit sorted `Vec`/`BTreeMap` instead of `HashMap`) — a trivial cost for closing off a category of hard-to-debug, intermittent bugs.
**Status:** Accepted

---

## ADR-010
**Decision:** The MVP does not implement per-fill try/catch in `Settlement.sol`'s token-transfer loop — an underfunded trader's failed pull may revert the entire batch's settlement.
**Context:** The production-correct fix (isolate each fill's transfer so one failure doesn't cascade) is meaningfully more implementation and testing effort than the timeline supports.
**Alternatives considered:** Per-fill isolated try/catch with partial batch settlement (identified as the correct production fix, explicitly deferred — `06 §5`, `07 §3`).
**Reason:** Given the no-pre-funding design (ADR-005), this exposure is real but fully mitigated operationally for the hackathon context: demo wallets are pre-funded and controlled, so the failure path is never exercised live.
**Consequences:** This is a genuine, named limitation the builder should be ready to explain plainly and confidently if asked by a judge — not a gap to hope nobody notices.
**Status:** Accepted (documented limitation, deferred fix)

---

## ADR-011
**Decision:** The clearing price search space is restricted to the set of submitted limit prices, not a continuous search.
**Context:** In discrete uniform-price call auctions, the equilibrium price always sits at a marginal order's own limit — searching a continuous price range would be both unnecessary and computationally wasteful.
**Alternatives considered:** Continuous/binary-search over an arbitrary price range (rejected — no correctness benefit, real gas/complexity cost).
**Reason:** Standard result for discrete-order call auctions (`03 §7`) — restricting the candidate set to actual submitted prices loses no correctness while bounding the computation to `O(n)` candidates.
**Consequences:** None negative identified.
**Status:** Accepted

---

## ADR-012
**Decision:** Clearing-price ties are broken by a fixed two-stage rule: maximize volume → minimize imbalance → lowest price wins.
**Context:** Multiple candidate prices can tie on executable volume; without a rule, price selection would be ambiguous or implementation-dependent.
**Alternatives considered:** Midpoint-of-tying-range pricing (rejected — more complex, and the resulting price might not correspond to any actual submitted limit, complicating eligibility checks); highest-price-wins tie-break (rejected arbitrarily in favor of lowest — either is defensible, but one had to be chosen and documented, not left ambiguous).
**Reason:** Mirrors real exchange opening-auction methodology (max volume, then min imbalance) and closes off all remaining ambiguity deterministically (`03 §8`).
**Consequences:** None negative — this is purely a determinism-closing rule.
**Status:** Accepted

---

## ADR-013
**Decision:** The Stylus clearing contract is fully stateless — it holds no persistent storage of batches, orders, or prior results.
**Context:** A stateful design could theoretically cache or index prior batches.
**Alternatives considered:** Stateful Stylus contract owning batch/order storage directly (rejected — would blur the architecture boundary in `02 §3`, duplicate state already owned by `OrderBook.sol`, and complicate testing the algorithm in isolation).
**Reason:** Keeps the Solidity/Stylus boundary clean, keeps the Rust engine independently unit-testable (`05 §11`) without any contract-state setup, and keeps all persistence in one place (`04`'s Solidity contracts) as the single source of truth.
**Consequences:** Every call must pass the full relevant order set in — acceptable given the MVP's small, bounded batch sizes.
**Status:** Accepted

---

## ADR-014
**Decision:** The system is split into three Solidity contracts (`OrderBook`, `Settlement`, `ClearingAdapter`) rather than one monolithic contract.
**Context:** A single contract could technically hold all order storage, batch lifecycle, Stylus-calling, and settlement logic.
**Alternatives considered:** Monolithic single contract (rejected — would mix custody logic with order storage and cross-VM-call encoding in one place, making the most safety-critical code — token movement — harder to isolate and audit even informally).
**Reason:** Maps 1:1 onto trust/responsibility boundaries (`02 §3`, `04 §1`) — `OrderBook` never touches funds, `Settlement` is the only contract that moves tokens, `ClearingAdapter` isolates all Stylus-call encoding/validation. This also lets Solidity and Rust workstreams build against one narrow interface without either needing to understand the other's internals (`08` Phase 0/1 parallelization).
**Consequences:** Slightly more deployment/wiring complexity (`04 §11`) — accepted for the isolation and parallelization benefits.
**Status:** Accepted
