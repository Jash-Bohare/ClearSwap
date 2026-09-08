# 06 — Frontend Specification
### Project: ClearSwap — MEV-Resistant Batch Auction DEX

> This spec defines screens, states, data bindings, and exact user-facing copy. It does not prescribe component library or file structure — that's an implementation choice for whoever builds it, constrained only by `02 §14`'s format requirement (must run reliably in a screen-shared, virtual demo).

---

## 1. Screens

### Screen 1 — Trading

**Components:**
- Wallet connection (connect/disconnect, connected address)
- Trading pair display (`WETH/USDC`, hardcoded per `03 §2` — no pair selector, this is a deliberate scope cut, not a missing feature)
- Buy/Sell toggle
- Amount input (base asset, WETH)
- Limit price input (quote per base, USDC/WETH)
- Submit order button
- Current batch status strip (batch ID, countdown — a compact preview of Screen 2, always visible so the trader never loses context while filling out an order)

**Data bindings:**
- Amount/price inputs validate client-side against `MIN_ORDER_SIZE` (`03 §12`) *before* submission is enabled — don't let the user discover the revert only after signing.
- Submit button is disabled (not hidden) with an inline reason whenever the current batch is not `OPEN` (should be rare given back-to-back batching per `03 §6`, but must be handled — see §4 Error States).

### Screen 2 — Current Batch

**Show:**
- Batch ID
- Time remaining (live countdown, updates at least once per second)
- Orders (list — side, amount, limit price; trader identity can be abbreviated address, full anonymity isn't required for the demo)
- Aggregate demand (running total buy quantity in the open batch)
- Aggregate supply (running total sell quantity in the open batch)

**Purpose beyond information display:** this screen is where the audience visually sees orders accumulating before anything clears — it's the setup for the payoff on Screen 3, so pacing matters more than density here. Keep it legible from across a room / on a screen-share at low resolution.

### Screen 3 — Clearing

**Show, in this exact sequence:**
1. `CLEARING...` (brief transitional state — even if the actual on-chain call resolves in well under a second, hold this state for a beat, e.g. ~1–2 seconds, purely so a human audience can register that something is happening; see `02 §11` on latency being technically instant but needing to be demo-watchable)
2. Then, once resolved:
   - **Clearing Price** (`P*`, in large, unmissable type — this number is the whole thesis of the product)
   - **Total Volume** (executed volume at `P*`)
   - **Number of Orders** (how many were in the batch, how many filled vs. rolled)
   - **Order Fill Results** — per-order table: side, requested amount, filled amount, and **the same clearing price repeated on every single row**

**This last point is not a formatting nitpick — it is the entire UX mechanism for §2's rule below.** Repeating the identical price value on every row, visually, is what makes "everyone traded at the same price" self-evident rather than something the presenter has to explain.

### Screen 4 — Settlement

**Show (per the connected trader's own order):**
- Your Order (side, original request)
- Requested Quantity
- Filled Quantity (with a visual distinction if partial — e.g. a progress-bar-style fill indicator, not just two numbers)
- Clearing Price
- Amount Paid/Received (the actual quote-token amount, computed per `04 §6`)

If the trader's order was fully or partially rolled forward (`03 §13`), this screen states that plainly: *"X WETH rolled into Batch #N+1 — no funds were taken, your order is still live and cancellable."* This directly reassures on the custody model (`01`/`02 §12`: no pre-funding, nothing was ever at risk) — worth saying explicitly, not just implying.

---

## 2. The Pitch-Critical Panels (beyond the 4 core screens)

These aren't part of the ordinary trading flow — they exist specifically to make the argument in `01 §4` land visually, per `02 §9`. Treat them as first-class screens for demo purposes, not an afterthought bolted onto Screen 3.

**Sandwich Comparison Panel** — triggered from Screen 3 (e.g., a "Compare to a standard DEX" button appearing right next to the clearing result). Takes the exact same order set just cleared and replays it against a simulated sequential-execution AMM, showing: the price a victim order would have received, the price a sandwich bot would have captured, and the resulting dollar-value loss — displayed side-by-side against ClearSwap's actual uniform-price outcome for the identical orders. This is the single highest-leverage visual in the entire demo; it should never be more than one click away from Screen 3.

**Gas Comparison Panel** — displays the real, measured gas cost of the Stylus `computeClearing` call for the batch just cleared, next to a benchmarked/estimated cost for an equivalent pure-Solidity implementation of the same computation (per `05 §9` — get this number early, not at the last minute). This substantiates the "Stylus makes this newly possible" claim with a concrete figure instead of an assertion.

---

## 3. Important UX Rule

**The user must understand "everyone in the batch trades at the same clearing price" within 5 seconds of viewing the Screen 3 result — with zero narration required.**

Concrete mechanisms to hit this (not just an aspiration — these are the actual design requirements that satisfy it):
- The clearing price is the single largest, most visually dominant number on Screen 3.
- Every row in the Order Fill Results table repeats that exact same price value — the repetition itself is the proof, not a caption explaining it.
- Suggested microcopy directly under the price: **"1 price for every trade in this batch — no one paid more or got more just by going first."** This single sentence should do the explanatory work; nothing more elaborate is needed and more text works against the 5-second target.
- Avoid burying the clearing price inside a table or a secondary panel — it must be the first thing the eye lands on.

---

## 4. Transaction States

| State | User-facing copy |
|---|---|
| Wallet not connected | "Connect your wallet to trade." |
| Waiting for signature | "Confirm in your wallet…" |
| Transaction pending | "Submitting your order…" (show a spinner tied to actual pending-tx status, not a fixed timer) |
| Transaction confirmed | "Order placed in Batch #N." |
| Transaction failed | "Order failed — [reason]." (reason sourced from §5 error mapping below, not a raw revert string) |

---

## 5. Error States

Each maps to a specific contract-level condition from `04` so the copy is accurate, not generic:

| Error State | User-facing copy | Maps to |
|---|---|---|
| Insufficient balance | "You don't have enough [WETH/USDC] to cover this order if it fills." | See **Known Limitation** below — this is a client-side check, not something the contract enforces at submission. |
| Invalid order | "Enter a valid amount and price." | Client-side validation before submission; also `OrderTooSmall` (`04 §4`) if amount is below `MIN_ORDER_SIZE`. |
| Batch closed | "This batch just closed — your order will go into the next one." | `BatchNotOpen` (`04 §4`) — per `03 §6`, this should route into the next batch rather than truly failing; frame the copy accordingly, not as a failure. |
| Order too large | *(not a protocol-enforced condition per `03`/`04` — no max order size is specified)* — if a soft UI cap is desired for demo stability (e.g., to keep clearing-price math legible on screen), state it here explicitly as a UI-only limit, not a contract error. |
| No liquidity | "No matching orders this round — your order rolled into Batch #N+1, untouched." | `03 §13` — frame as expected/normal, not an error, since no funds were ever at risk. |
| Network error | "Lost connection to the network — reconnecting…" | RPC/indexer failure; per `02 §12`, the frontend should be able to fall back to reading on-chain state directly if the Indexer lags. |

**Known Limitation (important context):** because ClearSwap never pre-pulls funds at order submission (`02 §3.2`, `03`'s no-pre-funding custody design), there is no contract-level check that a trader actually holds enough balance until `Settlement.settleBatch` tries to pull tokens at clearing time (`04 §6`). If a trader submits an order they can't cover, that pull fails — and depending on how `Settlement.sol`'s loop is written, this could revert the **entire batch's settlement**, affecting every other trader in that batch, not just the underfunded one. This is worth a decision, not an assumption:
- **Recommended for the hackathon timeline:** perform a client-side balance check before allowing submission (covers the honest-mistake case), and separately ensure all demo wallets are pre-funded and controlled for demo execution so this path is never exercised live. Document this as an explicit known limitation if a judge asks — "the settlement loop should use try/catch-per-fill rather than an all-or-nothing loop, that's the correct production fix, out of scope for the MVP" is a strong, credible answer, versus being caught by surprise by the question.

---

## 6. Demo Mode

**Provide deterministic demo data.** Concretely:

- The demo's primary order sequence should be **exactly the `03 §17` worked example** (the same 6 orders — B1, B2, B3, S1, S2, S3 — used throughout the protocol spec, the Foundry tests, and the Rust unit tests). Reusing one canonical fixture everywhere means the presenter can predict and narrate the outcome (*"watch — this is going to clear at 3010"*) with total confidence, and any discrepancy between the live demo and the spec is instantly obvious beforehand, not discovered live.
- Demo wallets are pre-funded dedicated test accounts (per §5's Known Limitation) submitting the scripted orders in sequence, ideally via a simple "run demo sequence" control the presenter can trigger rather than manually typing each order live — reduces live-typing risk without faking anything on-chain (every order is still a real transaction).
- A **manual "close batch now" trigger** should be available to the presenter (calling the permissionless `closeBatch()` from `04 §8`) rather than waiting out the full `BATCH_WINDOW_SECONDS` on stage — pacing control matters more during a live pitch than realism of the timer.
- Keep a **pre-recorded backup video** of the full flow (per `02 §10`) in case of live network issues — treated as a required deliverable, not an optional nice-to-have, given the stakes of a live demo over a network you don't control.

---

## 7. Format Constraints

Per `01 §14`, the showcase is virtual/online. The frontend must be legible over a screen-share at typical video-call resolution: large type for the clearing price and key numbers (§3), high contrast, and no critical information conveyed only through small text or subtle color differences that could be lost to video compression.

---

## 8. Explicit Non-Goals

Consistent with `01 §8`: no general-purpose polish, no responsive/mobile optimization beyond what's needed for a laptop screen-share, no multi-pair selector, no wallet options beyond whatever single connector is fastest to integrate (e.g. injected/MetaMask), no persisted user preferences or account history beyond the current session.
