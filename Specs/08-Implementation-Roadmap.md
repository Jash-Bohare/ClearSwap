# 08 — Implementation Roadmap
### Project: ClearSwap — MEV-Resistant Batch Auction DEX
### Arbitrum Builder Pods Showcase | Docs 01–07 are the source of truth this roadmap executes against

> **How to use this document:** every task below cites the doc/section that defines its exact behavior. If you hit a decision this roadmap does not answer, the answer lives in `01`–`07` and `09` (Architecture Decision Log) — do not improvise a new rule mid-build; check the specs and decision log to maintain architectural integrity. Timestamps below are **relative** (`Hour 0` = the moment you start writing code, right now) — use them to track phase boundaries and stay on schedule.

---

## 1. Solo Builder Execution Tracks & Phase Allocation

As a solo builder with AI pair programming, work is organized into structured, modular tracks executed across milestone phases:

| Track | Key Deliverables | Primary docs |
|---|---|---|
| **Stylus Engine Track** | `clearing-engine` Stylus crate, discrete clearing algorithm, Rust unit tests | `05`, `03 §7–§10` |
| **Smart Contracts Track** | `OrderBook.sol`, `Settlement.sol`, `ClearingAdapter.sol`, Mock tokens, interfaces | `04`, `03` |
| **Integration & Testing Track** | Foundry unit & integration tests, deployment scripts, end-to-end batch lifecycle | `04 §10`, `07 §5` |
| **Frontend & Visualizer Track** | React app, wallet integration, demo panels (sandwich replay + gas comparison) | `06`, `02 §9` |
| **Demo & Showcase Track** | Deterministic demo sequence, pitch narrative, timing, judge Q&A prep | `01`, `06 §6` |
---

## 2. Phase Overview

| Phase | Goal | Target duration |
|---|---|---|
| 0 | Environment & interface freeze | Hour 0 → Hour 2 |
| 1 | Contract & engine skeletons (no logic yet) | Hour 2 → Hour 4 |
| 2 | Clearing engine logic + Rust unit tests | Hour 4 → Hour 12 |
| 3 | Solidity contract logic + Foundry unit tests | Hour 4 → Hour 14 (parallel with Phase 2) |
| 4 | End-to-end wiring & integration tests | Hour 14 → Hour 20 |
| 5 | Frontend build | Hour 6 → Hour 22 (parallel, starts once interfaces are frozen) |
| 6 | Gas benchmarking artifact | Hour 12 → Hour 18 (parallel) |
| 7 | Demo prep, rehearsal, backup recording | Hour 22 → Hour 30 |
| 8 | Freeze, buffer, submission | Hour 30 → showcase |

Phases 2, 3, 5, and 6 overlap deliberately — that overlap is the whole point of freezing interfaces early in Phase 0/1. If any phase is running long, the buffer in Phase 8 is what absorbs it, not the phases before it.

---

## Phase 0 — Environment & Interface Freeze
**Goal:** all toolchains and scaffolding are verified against frozen interfaces — ready to implement core engine and contracts.

**Tasks:**
- [ ] Confirm and pin: Arbitrum Stylus-enabled testnet + RPC endpoint (`02 §10`) — verify local deployment capability before writing contract logic.
- [ ] Set up repo structure: `/contracts` (Solidity, Foundry), `/stylus-engine` (Rust, Stylus SDK), `/frontend` (React/TS), `/test/benchmarks` (per `07 §6`'s throwaway Solidity benchmark contract).
- [ ] Install and verify toolchains: Foundry, Stylus CLI/SDK (`cargo stylus`), Node/frontend tooling. Run a test deploy of a trivial contract to confirm the toolchain pipeline works **before** writing complex logic.
- [ ] Deploy mock `WETH` (18 decimals) and mock `USDC` (6 decimals) ERC20 test tokens (`03 §2`) with a mint function, and pre-mint balances to the demo wallets that will be used in Phase 7 — do this now so nobody is blocked on it later.
- [ ] **Interface freeze:** Lock and confirm the exact struct definitions in `04 §2` (`Order`, `Batch`, `Fill`, `ClearingResult`) and the function signatures in `04 §4–§7`. This is a **hard freeze** — no struct field renaming, reordering, or type changes after this point without immediately notifying every workstream, since both Solidity and Rust code will be written against these exact shapes in parallel.
- [ ] Lock constants (`04 §3`): confirm `BATCH_WINDOW_SECONDS = 45`, `MIN_ORDER_SIZE = 1e15`, token addresses from the mock deploy above.

**Exit criteria (Definition of Done for Phase 0):**
- Successfully verified deploy and test pipelines on the target environment.
- Mock tokens exist on-chain with addresses recorded and shared.
- Every struct/interface in `04 §2–§7` has zero open questions — if there's a disagreement, resolve it now, it gets exponentially more expensive to change later.

---

## Phase 1 — Skeletons (No Logic Yet)
**Goal:** every contract and the Rust engine exist as empty, compiling shells with the correct signatures — this proves the interfaces from Phase 0 actually compile and wire together before anyone invests time in logic that might sit behind a broken interface.

**Solidity Lead tasks:**
- [ ] Write `OrderBook.sol`, `Settlement.sol`, `ClearingAdapter.sol` with all structs (`04 §2`), function signatures (`04 §4–§6`), events, and custom errors declared — function bodies can be `revert("TODO")` or empty stubs.
- [ ] Confirm the contracts compile together and constructor wiring (`04 §11`'s deploy order) is at least stubbed out in a deploy script.

**Rust/Stylus Lead tasks:**
- [ ] Write the Rust `Order`, `Fill`, `ClearingResult` structs (`05 §2–§3`) and the `computeClearing` entry point stub (`05 §10`) — body can return an empty/placeholder result initially.
- [ ] Confirm the Stylus contract compiles and deploys to testnet as an empty shell, and confirm it's externally callable with the correct ABI-compatible signature from a throwaway Solidity test call — **this specific check (can Solidity call Stylus with the agreed struct shapes at all) is the highest-risk unknown in the whole project and must be de-risked this early**, not discovered at Hour 16.

**Exit criteria:**
- All contracts compile.
- A trivial cross-language call (Solidity → Stylus stub, returning a hardcoded/empty result) succeeds on testnet.
- Plumbing and interfaces verified; proceed to core engine and contract implementation.

---

## Phase 2 — Clearing Engine Logic (Rust)
**Goal:** the Stylus contract correctly implements the full algorithm from `03 §7–§10` and passes every Rust unit test in `05 §11` / `07 §2`, in isolation, before ever touching Solidity again.

**Tasks (Rust/Stylus Lead):**
- [ ] Implement candidate price set construction (`05 §4` step 3) — sorted `Vec`, deduplicated, **never `HashMap`/`HashSet`** (`05 §5` — this is a hard rule, not a suggestion).
- [ ] Implement the price sweep (`BuyQty`, `SellQty`, `Volume` per candidate — `05 §4` step 4).
- [ ] Implement `P*` selection: argmax volume → minimize imbalance → lowest price (`05 §4` step 5, `03 §8`).
- [ ] Implement eligibility determination and exact-match/pro-rata fill allocation, including the ascending-`orderId` remainder distribution (`05 §4` steps 6–7, `03 §10`).
- [ ] Implement all revert conditions from `05 §7` (mixed `batch_id`, overflow, zero-amount defensive check).
- [ ] Write and pass, **in this order**, the tests from `05 §11` / `07 §2`:
  1. `test_worked_example_matches_spec()` (Case 2 / `03 §17`) — **do not proceed to other tests until this passes**, it's the ground-truth fixture everything else is judged against.
  2. `test_empty_batch_returns_zero_result()` (Case 3/4 shape)
  3. `test_one_sided_batch_returns_zero_result()` (Case 3, Case 4)
  4. `test_exact_match_no_rationing()` (Case 1)
  5. `test_tie_break_minimizes_imbalance_then_lowest_price()` (Case 5)
  6. `test_determinism_repeated_calls()`
  7. `test_rejects_mixed_batch_ids()`
  8. `test_overflow_reverts_not_wraps()`

**Exit criteria:**
- All 8 tests above pass in `cargo test`, run at least twice consecutively to catch any latent non-determinism (`05 §5`).
- Rust Lead can hand off a working, tested `computeClearing` to Solidity Lead with confidence — this is the gate before Phase 4 integration begins.

---

## Phase 3 — Solidity Contract Logic (parallel with Phase 2)
**Goal:** `OrderBook.sol`, `Settlement.sol`, `ClearingAdapter.sol` are fully implemented per `04` and pass all applicable Foundry unit tests from `07 §1` and `07 §3`, using a **mocked** `ClearingAdapter`/Stylus response (don't wait on the real Stylus contract to test Solidity logic — stub the clearing result and swap in the real Stylus call in Phase 4).

**Tasks (Solidity Lead):**
- [ ] Implement `OrderBook.submitOrder`, `cancelOrder`, `closeBatch`, `rollOrder`, batch lifecycle state (`04 §4`, `03 §5–§6`).
- [ ] Implement `ClearingAdapter.requestClearing` and the full result-validation logic from `04 §5` (this is the most safety-critical function in the codebase — do not shortcut the 4 checks listed there).
- [ ] Implement `Settlement.settleBatch`: per-fill `quoteAmount` computation (`04 §6`, `03 §11`), token pulls/credits, order status updates, rollover triggering.
- [ ] Wire access control per `04 §8` (permissionless `closeBatch`, restricted `rollOrder`/`requestClearing`/`settleBatch` callers).
- [ ] Write and pass Foundry tests:
  - `07 §1` order validation checklist (all 5 applicable items — remember "insufficient balance" is **not** an `OrderBook` test, see `07 §1`'s note).
  - `07 §3` settlement tests, using a **mock** `ClearingAdapter` that returns hand-crafted `ClearingResult`s matching each of the 5 clearing cases from `07 §2` (you don't need the real Stylus contract wired in yet to test this logic — inject known-good/known-bad results directly).
  - `07 §4` invariant tests, run against the mocked results.

**Exit criteria:**
- All Solidity contracts pass unit tests with a mocked clearing result.
- `test_settlement_handles_underfunded_trader` (`07 §3`) has been run and the behavior matches the documented MVP specification (per `06 §5`'s Known Limitation).

---

## Phase 4 — End-to-End Wiring & Integration
**Goal:** replace the mocked `ClearingAdapter` response with the real, deployed Stylus contract from Phase 2, and prove the full flow works end to end on testnet exactly as specified in `04 §9`'s call sequence.

**Tasks (Solidity Lead + Rust Lead + Integration Lead together — this phase is inherently collaborative, not parallelizable):**
- [ ] Deploy the real Stylus clearing contract to testnet; wire its address into `ClearingAdapter` (`04 §11` deploy order).
- [ ] Run the full deploy sequence from `04 §11` end to end on a clean testnet deployment.
- [ ] Re-run every clearing case from `07 §2` **through the real, deployed system** (submit real orders via `OrderBook`, close the batch, let the real `ClearingAdapter` call the real Stylus contract, let `Settlement` apply the result) — confirm results match the mocked-test expectations exactly. Any discrepancy here means either the Rust implementation or the Solidity encoding/decoding has a bug; the `03 §17` fixture's exact numbers make this discrepancy immediately diagnosable.
- [ ] Run the full `07 §5` integration test list: end-to-end happy path, rollover round-trip, permissionless `closeBatch` from an arbitrary address, sandwich comparison accuracy.
- [ ] Confirm all `07 §4` invariant tests still hold against the **real** (not mocked) clearing results.

**Exit criteria:**
- Every test from `07 §2` passes through the real, fully-wired, deployed system on testnet.
- Verified at least one full `submit → close → clear → settle` cycle completes successfully start to finish with real transactions.
- This is the point at which the protocol itself is considered **feature-complete** — everything after this is frontend, benchmarking, and demo polish, not new contract logic.

---

## Phase 5 — Frontend Build (parallel, starts once Phase 0's interfaces are frozen)
**Goal:** all 4 screens + the 2 pitch-critical panels from `06` are built and can read live on-chain state, initially against Phase 1's skeleton contracts (or Phase 3's mocked-clearing Solidity), then swapped to the real deployed system once Phase 4 completes.

**Tasks (Frontend Lead):**
- [ ] Build wallet connection + Screen 1 (Trading) — order form with client-side `MIN_ORDER_SIZE` validation (`06 §1`, `03 §12`).
- [ ] Build Screen 2 (Current Batch) — live batch state, countdown, aggregate demand/supply, sourced from contract events or direct reads (`06 §1`, `02 §3.6`).
- [ ] Build Screen 3 (Clearing) — the `CLEARING...` transitional state, then the clearing price display satisfying the 5-second UX rule (`06 §3`) exactly as specified (dominant price, repeated per-row, exact microcopy).
- [ ] Build Screen 4 (Settlement) — per-trader fill/payment display, including the "rolled forward, no funds at risk" messaging for unfilled orders (`06 §1`).
- [ ] Build the **Sandwich Comparison Panel** and **Gas Comparison Panel** (`06 §2`) — these are not optional polish, they are core to the pitch and should be prioritized at the same level as the 4 core screens, not left until the end.
- [ ] Implement all transaction/error states from `06 §4–§5` with the specified copy, including the `BatchNotOpen` → "will go into the next one" reframing (not a scary failure message).
- [ ] Implement demo mode (`06 §6`): scripted `03 §17` order sequence, manual "run demo" and "close batch now" presenter controls.
- [ ] Verify format constraints (`06 §7`) — test the actual UI over a real screen-share at typical video-call resolution before Phase 7, not for the first time during the live demo.

**Exit criteria:**
- Full flow navigable end to end in the UI against the real deployed contracts from Phase 4.
- Sandwich and gas comparison panels display real, accurate numbers (gas numbers depend on Phase 6 completing first).
- A non-team-member can watch the demo sequence run and, unprompted, state back "everyone traded at the same price" — this is the actual acceptance test for the 5-second UX rule (`06 §3`), not a subjective judgment call by the builder.

---

## Phase 6 — Gas Benchmarking Artifact (parallel)
**Goal:** produce the real numbers the Gas Comparison Panel needs, per `07 §6`'s methodology.

**Tasks (Rust Lead or Integration Lead, once Phase 2's algorithm is stable):**
- [ ] Implement the throwaway benchmark Solidity contract (`test/benchmarks/SolidityClearingBenchmark.sol`) — the identical `03 §7–§10` algorithm, in Solidity, used **only** for gas measurement, never wired into production settlement (`07 §6`).
- [ ] Measure gas for both the Stylus path (through `ClearingAdapter`) and the Solidity benchmark at `N = 2, 6, 10` orders, using Foundry's gas reporting.
- [ ] Fill in the `07 §6` table with real numbers.
- [ ] **Decision checkpoint:** if the gas delta at the demo's actual order count isn't visually compelling, decide now whether to increase the demo's order count (`02 §14`'s "small fixed cap" was chosen for UI legibility, not fixed in stone) — this needs to be resolved before Phase 7 rehearsal, not discovered live.

**Exit criteria:**
- Real, verified gas numbers exist for at least 2 values of N.
- The numbers are favorable enough to support the pitch's central technical claim, or adjusted `N` to make the comparison clear and representative.

---

## Phase 7 — Demo Prep, Rehearsal, Backup
**Goal:** the pitch is rehearsed, timed, and has a recorded fallback — this phase is not optional buffer, it's load-bearing for the actual scoring.

**Tasks (Demo & Pitch Preparation):**
- [ ] Write the ~90-second live-demo script around the `03 §17` fixture, matching the sequence and pacing implied by `06 §6`.
- [ ] Rehearse the full pitch at least twice: problem statement (`01 §1`) → mechanism (`01 §4`) → live demo → sandwich comparison reveal → gas comparison reveal → close.
- [ ] Record a full backup video of a successful end-to-end run (`02 §10`, `06 §6`) — treat this as a required deliverable, not a nice-to-have.
- [ ] Prepare answers for the likely judge questions surfaced by this doc set: "what happens if a batch has no liquidity" (`03 §13`), "what happens if someone can't cover their trade" (`06 §5` Known Limitation — answer honestly and confidently), "why does this need Stylus specifically" (`01 §4`, `05 §9`), "is this audited/production-ready" (`02 §12` — no, and say so plainly).
- [ ] Time the full pitch against whatever slot length the showcase gives you, and cut ruthlessly if over.

**Exit criteria:**
- At least one full, successful, timed dry run completed end-to-end.
- Backup video exists and has been verified start to finish to confirm the complete flow is recorded accurately.

---

## Phase 8 — Freeze, Buffer, Submission
**Goal:** nothing changes except what's broken; ready for live presentation and judging.

**Tasks:**
- [ ] Code freeze — no new features, only fixing anything that broke during Phase 7 rehearsal.
- [ ] Final testnet health check: confirm contracts are still live, RPC still responsive, demo wallets still funded.
- [ ] Submit per showcase requirements (repo link, any required write-up, deployed addresses).
- [ ] Sleep/rest before presenting if the schedule allows even a little — a well-delivered good demo beats a frantic great one.

**Exit criteria:** you're standing in front of the judges with a working link, a rehearsed script, and a backup video. Everything upstream of this phase exists to make this moment boring instead of stressful.
