# 02 — System Architecture Specification
### Project: ClearSwap — MEV-Resistant Batch Auction DEX

> This doc defines *how the system is structured* — components, boundaries, data flow, interfaces. It does not contain business rationale (see `01`) or line-level implementation (see `03 - Technical/API Spec`). Function signatures below are conceptual contracts between components, not final code.

---

## 1. System Overview

ClearSwap consists of the following components:

1. **Frontend** — order entry, batch status, clearing visualization, demo comparison view.
2. **Solidity contracts** — order intake, batch lifecycle management, settlement, custody.
3. **Stylus clearing engine** — the compute-heavy uniform clearing-price solver, written in Rust.
4. **Backend/indexer** *(demo-support only, not a trust-critical component)* — reads on-chain events and feeds the frontend so the UI doesn't have to poll raw chain state directly.

**High-level flow:**

```
User
 ↓
Frontend
 ↓
Order Submission Contract
 ↓
Batch
 ↓
Stylus Clearing Engine
 ↓
Settlement Contract
 ↓
User balances
```

---

## 2. Architecture Diagram

```text
                    ┌──────────────────┐
                    │    Frontend      │
                    │ React/TypeScript │
                    └────────┬─────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │ Solidity Router  │
                    └────────┬─────────┘
                             │
                    Order Submission
                             │
                             ▼
                    ┌──────────────────┐
                    │   Batch Manager  │
                    └────────┬─────────┘
                             │
                       Batch Closes
                             │
                             ▼
                    ┌──────────────────┐
                    │ Stylus Clearing  │
                    │     Engine       │
                    └────────┬─────────┘
                             │
                     Clearing Result
                             │
                             ▼
                    ┌──────────────────┐
                    │   Settlement     │
                    └────────┬─────────┘
                             │
                             ▼
                         Users
```

A read-only **Indexer** listens to events from all four on-chain components in parallel and pushes state to the Frontend — it sits beside this pipeline, not inside it, and is never on the critical path for correctness.

---

## 3. Component Responsibilities

### 3.1 Frontend (React/TypeScript)
- Order entry form (side, price limit, amount).
- Live batch countdown/status (Open / Locked / Clearing / Settled).
- Post-clearing visualization: the single uniform clearing price plotted against each order's original limit price, and each user's fill.
- **Demo comparison view**: replays the same order set through a simulated standard sequential-AMM execution and shows the value a sandwich bot would have extracted — this is the single most important frontend surface for the pitch.
- Gas-cost panel: displays the real measured gas cost of the Stylus clearing call next to an equivalent Solidity-implementation estimate.
- Does **not** perform any pricing or matching logic itself — purely reads/writes on-chain state.

### 3.2 Order Submission / Router Contract (Solidity)
- Accepts new orders for the currently open batch (side, limit price, amount, trader address).
- Validates basic order well-formedness (non-zero amount, valid side, batch currently open).
- Does **not** hold user funds at submission time — funds are only pulled at settlement, so an unmatched or rolled-over order never leaves user custody. This is a deliberate difference from a typical order-book/escrow model.
- Forwards a reference to the current batch's order set to the Batch Manager; does not itself decide when a batch closes.

### 3.3 Batch Manager (Solidity)
- Owns batch lifecycle state: current batch ID, open/locked/clearing/settled status, batch start/end timestamps.
- Enforces the batch window (time-based or block-based cutoff — see §11).
- On batch close, freezes the order set for that batch (no further submissions accepted into it) and triggers the call into the Stylus Clearing Engine.
- Receives the clearing result back and hands it to Settlement.
- Opens the next batch and makes it available for new order submissions immediately, so the system is continuously live rather than stalling between batches.

### 3.4 Stylus Clearing Engine (Rust)
- Pure computation component: given the frozen order set for a batch (all buy orders and sell orders with their limit prices and amounts), computes:
  - The single uniform clearing price for the batch.
  - The fill amount for each order (full or partial) at that price.
  - Any unfilled remainder to roll into the next batch.
- Stateless with respect to batches beyond the one it's given — it does not manage lifecycle, custody, or persistence; it receives an order set and returns a clearing result. This keeps the Solidity/Stylus boundary clean and testable independently.
- This is the component that would be gas-prohibitive to implement as an equivalent iterative algorithm in pure Solidity — see `01 §4` and `01 §12` for why this exists on Stylus specifically.

### 3.5 Settlement Contract (Solidity)
- Takes the clearing result from the Batch Manager and executes actual token movements: pulls the correct amount from each filled buyer/seller and credits the counter-asset, all at the single clearing price.
- This is the *only* point at which user funds move — no pre-funding, no escrow window where funds sit exposed.
- Emits settlement events per order (fill amount, price, side) that the Indexer consumes for the frontend.
- Handles rollover: any order with an unfilled remainder is re-submitted into the next open batch automatically, without requiring the user to resubmit.

### 3.6 Backend / Indexer (demo-support only)
- Subscribes to on-chain events from Order Submission, Batch Manager, and Settlement.
- Maintains a simple in-memory or lightweight DB view for the frontend (current batch state, order list, fill history) so the UI isn't hammering RPC calls directly during the live demo.
- **Not part of the trust boundary** — if it goes down, the protocol still functions correctly on-chain; only the live visualization degrades. This is an important distinction to be able to state clearly to judges if asked.

---

## 4. Core Data Entities

| Entity | Key Fields | Owned By |
|---|---|---|
| **Order** | orderId, trader, side (buy/sell), limitPrice, amount, batchId, status (pending/filled/partial/rolled) | Order Submission Contract |
| **Batch** | batchId, status (open/locked/clearing/settled), openedAt, closesAt, orderIds[] | Batch Manager |
| **ClearingResult** | batchId, clearingPrice, fills[] (orderId → filledAmount) | Produced by Stylus, consumed by Settlement |
| **Fill** | orderId, trader, filledAmount, price, side | Settlement Contract (emitted as event) |

---

## 5. Batch Lifecycle (State Machine)

```
   ┌────────┐   window elapses   ┌────────┐   Stylus call   ┌───────────┐   settled   ┌──────────┐
   │  OPEN  │ ──────────────────▶│ LOCKED │ ───────────────▶│ CLEARING  │ ───────────▶│  SETTLED │
   └────────┘                    └────────┘                 └───────────┘              └──────────┘
        ▲                                                                                    │
        │                              unfilled remainder rolls forward                      │
        └────────────────────────────────────────────────────────────────────────────────────┘
```

- **OPEN** — accepting new orders.
- **LOCKED** — window closed, order set frozen, awaiting the Stylus call. No new orders accepted into this batch; new orders now target the *next* batch (which can already be OPEN — see §3.3).
- **CLEARING** — Stylus Clearing Engine has been called and is computing the result. (On-chain this is effectively a single atomic call, but modeled as a distinct state for clarity and for demo UI purposes.)
- **SETTLED** — clearing result applied, funds moved, events emitted, unfilled remainders rolled to the next batch.

---

## 6. Contract Interfaces (Conceptual)

These define the boundaries between components. Exact types/encoding belong in `03`.

**IOrderSubmission**
```
submitOrder(side, limitPrice, amount) → orderId
cancelOrder(orderId)              // only while batch is OPEN
getOrder(orderId) → Order
```

**IBatchManager**
```
getCurrentBatch() → Batch
closeBatch(batchId)               // called internally once window elapses
onClearingResult(batchId, ClearingResult)   // callback from Stylus path
```

**IClearingEngine** (Stylus)
```
computeClearing(orders: Order[]) → ClearingResult
```

**ISettlement**
```
settleBatch(batchId, ClearingResult)
```

This is intentionally a narrow set of boundaries — the fewer cross-component calls, the less there is to get wrong under time pressure.

---

## 7. Solidity ↔ Stylus Interaction Pattern

Stylus contracts on Arbitrum expose Solidity-ABI-compatible interfaces, so from the Batch Manager's perspective, calling the Clearing Engine is an ordinary external contract call — no special bridging layer is needed. The practical implications for this build:

- The order set passed into `computeClearing` must be encoded in a form both sides agree on (an array of structs with side/price/amount) — this is the single most important interface to lock early so Solidity and Rust workstreams can build in parallel without blocking each other.
- The call is synchronous within the same transaction: Batch Manager calls Clearing Engine, gets the result back, and immediately hands it to Settlement — all within the flow triggered by the batch closing. There is no async/off-chain step.
- Because this call is the computationally expensive part of the whole system, it's also the part we specifically want to gas-benchmark against a hypothetical pure-Solidity equivalent for the demo's cost-comparison panel (see `01 §12`).

---

## 8. Sequence Diagram — Full Batch Cycle

```
User(s)      Frontend      OrderSubmission    BatchManager     ClearingEngine(Stylus)   Settlement    Indexer
  │             │                  │                │                    │                 │            │
  │──submit────▶│                  │                │                    │                 │            │
  │             │──submitOrder()──▶│                │                    │                 │            │
  │             │                  │──register─────▶│                    │                 │            │
  │             │◀───event─────────┤                │                    │                 │            │
  │             │                                    │                    │                 │            │
  │             │            [window elapses]        │                    │                 │            │
  │             │                                    │──closeBatch()─────▶│                 │            │
  │             │                                    │                    │─computeClearing─│            │
  │             │                                    │◀───ClearingResult──┤                 │            │
  │             │                                    │──settleBatch()───────────────────────▶│            │
  │             │                                    │                    │                 │──events───▶│
  │             │◀────────────────────────────────── batch status / fills ───────────────────────────────┤
```

---

## 9. Frontend Views (Demo-Critical)

1. **Order entry** — minimal form: side, limit price, amount, submit.
2. **Live batch panel** — current batch ID, countdown to close, list of orders currently in the open batch (anonymized enough to feel "live," not necessarily fully private).
3. **Clearing result panel** — the moment the batch clears: show the single uniform clearing price and each order's fill, visually emphasizing that every filled order got the *same* price regardless of submission order.
4. **Sandwich-comparison panel** *(highest priority for the pitch)* — same order set replayed against a simulated sequential-execution AMM, showing the price degradation a victim trade would experience and the value a bot would extract. This is what makes the "why this matters" argument land without requiring the audience to trust a claim.
5. **Gas comparison panel** — real measured gas for the Stylus `computeClearing` call vs. an estimated/benchmarked pure-Solidity equivalent for the same order set size.

---

## 10. Deployment Architecture

- **Network:** Arbitrum Stylus-enabled testnet (per current Stylus tooling availability at build time — confirm exact testnet in `03`).
- **Deployment order:** mock ERC20 pair (test tokens) → Stylus Clearing Engine → Order Submission → Batch Manager → Settlement (Batch Manager and Settlement need the Clearing Engine and each other's addresses wired at deploy time).
- **Test liquidity:** synthetic — demo-controlled wallets seeded with mock tokens submitting orders live during the demo; no real market liquidity required (per `01` assumptions).
- **Config surface:** batch window duration and max orders per batch should be deploy-time or owner-adjustable parameters, not hardcoded, so they can be tuned for demo pacing without redeploying.

---

## 11. Non-Functional Requirements (Architecture-Level)

- **Batch window duration:** short enough that a live demo doesn't stall (target: seconds-to-low-minutes range, tuned during testing), long enough to visibly collect multiple orders on screen.
- **Max orders per batch:** bounded for the MVP (small, fixed cap) to keep the Stylus computation simple and the demo legible — this is a deliberate scope limiter, not a technical ceiling of the approach itself.
- **Latency:** the full close→clear→settle sequence should complete within a single demo-watchable timeframe (well under the time it takes the presenter to finish a sentence describing what's happening).
- **Reliability for demo:** the Indexer/frontend path should degrade gracefully — if it lags, the on-chain state is still the source of truth and can be shown directly via block explorer as a fallback.

---

## 12. Security & Trust Boundaries (Architecture-Level Only)

- **No pre-funding custody:** funds move only at Settlement, at the moment fills are known — never held in escrow while a batch is open. This directly removes an entire class of custody risk that a naive implementation might introduce.
- **Trust-minimized clearing:** the clearing price is computed entirely on-chain (Stylus), not by an off-chain solver — there is no party whose honesty the system depends on for correctness of the price.
- **Explicit non-hardening for this build:** this architecture is an MVP for a hackathon demo, not an audited production system. Known deferred concerns (front-running the *batch boundary itself*, sequencer-level ordering assumptions on Arbitrum, oracle-free pricing meaning the clearing price is purely endogenous to the batch's own orders) should be stated plainly if asked by judges, not glossed over — credibility matters more than pretending the MVP is bulletproof.

---

## 13. Out-of-Scope / Deferred Architecture Decisions

- Multi-pair / multi-market support (single hardcoded pair only).
- Continuous or dynamically-sized batching (fixed window only).
- Any oracle or external price feed integration.
- Order types beyond simple limit orders (no stop-loss, TWAP, etc.).
- Cross-chain messaging or settlement.
- Production-grade upgradeability/proxy patterns — direct deployment is sufficient for a testnet demo.

---

## 14. Key Technical Decisions & Configurations (pinned for implementation)

- Exact batch window length (proposal: start at 30–60 seconds for demo pacing, adjust after a dry run).
- Max orders per batch cap (proposal: small fixed number, e.g. 6–10, enough to look "real" without complicating the Stylus solver under time pressure).
- Whether the Indexer is a genuinely separate service or just frontend polling of events directly for the demo — given the timeline, direct event polling may be sufficient and removes an entire component to build/host.
- Exact Stylus-enabled testnet and RPC endpoints to target, confirmed against current availability at build time.
- Mock token setup: pre-mint to demo wallets vs. an in-UI faucet button — pre-mint is simpler and lower-risk for the timeline.
