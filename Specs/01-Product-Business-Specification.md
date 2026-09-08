# 01 — Product & Business Specification
### Project: ClearSwap — MEV-Resistant Batch Auction DEX
**Event:** Arbitrum Builder Pods Showcase | **Date:** Sept 9, 2026 | **Stack:** Solidity + Arbitrum Stylus (Rust)

> Working name only. This document defines *what* we're building and *why*. No implementation detail lives here; see `02 - Technical Architecture Spec` for that.

---

## 1. Problem Statement

Every swap executed on an AMM-based DEX today is exposed to Miner/Maximal Extractable Value (MEV) — specifically **sandwich attacks**, where a bot detects a pending swap in the mempool, front-runs it with a buy, lets the victim's trade push the price further, then back-runs it with a sell. The victim gets objectively worse execution than the quoted price, and never sees it happen — it's invisible value extraction baked into how sequential, price-impact-based execution works.

This isn't a theoretical or edge-case problem. It happens on essentially **every trade of meaningful size**, on every EVM chain, every block. It is one of the largest sources of retail value loss in DeFi, and it persists because the standard AMM execution model (sequential trades against a shared liquidity curve) makes it structurally possible — not because of any single bad actor, but because of *how the market clears*.

## 2. Current Workflow (Status Quo)

1. User opens a DEX frontend (Uniswap, etc.) and requests a swap.
2. Frontend quotes a price based on the current AMM curve state.
3. User signs and broadcasts the transaction to the public mempool.
4. Searcher bots scan the mempool, identify profitable sandwich opportunities, and submit front-run/back-run transactions with higher gas to bracket the user's trade.
5. User's trade executes at a worse price than quoted; the extracted value goes to the bot (and often the block builder), not the user or the protocol.
6. User has no visibility into this happening and no recourse — "slippage tolerance" is the only lever, and it's a blunt instrument that just caps the damage rather than preventing it.

Some mitigations exist off-chain today (private RPCs, off-chain solver-based systems like CoW Swap), but these rely on trusting an off-chain party to route/solve fairly, and are not native, verifiable, on-chain guarantees.

## 3. Pain Points

- **Silent value loss** — users lose money on trades with no clear indication it happened, so the problem is underappreciated relative to its actual cost.
- **Structural, not incidental** — the vulnerability exists because of *how* AMM execution ordering works, not because of a fixable bug. Any sequential-execution AMM is exposed by design.
- **Off-chain "fixes" require trust** — existing MEV-protection solutions (private mempools, off-chain solvers) reintroduce a trusted intermediary, which conflicts with DeFi's core value proposition.
- **Blunt tooling** — slippage tolerance settings force users to choose between "likely to get sandwiched a little" and "trade might just fail."
- **Compute cost is the real blocker** — the actual fix (clearing multiple orders at one fair price, rather than sequentially) requires solving a supply/demand equilibrium across many orders, which is computationally expensive — expensive enough that doing it fully on-chain in the EVM has historically been impractical. This is *why* nobody has shipped this as a fully on-chain primitive.

## 4. Proposed Solution

**ClearSwap replaces sequential AMM execution with periodic on-chain batch auctions.**

Instead of executing each trade the instant it arrives (and thus against a price an attacker can manipulate first), ClearSwap collects orders submitted within a fixed batch window and clears **all of them simultaneously at a single uniform clearing price**, computed from the aggregate supply and demand in that batch.

Because every order in the batch fills at the *same* price:
- There is no "first" or "last" order to front-run or back-run — sandwiching requires being able to move the price *between* a victim's order and its execution, and there is no such gap here.
- Price-time priority games and gas-bidding wars for execution priority become irrelevant, since ordering within the batch doesn't change the clearing price.
- Funds are only pulled from users at the moment of clearing (no pre-funded escrow sitting idle or exposed).

The clearing-price computation — walking cumulative supply/demand curves across N orders to find the equilibrium price and fill amounts — is exactly the kind of iterative numerical computation that Arbitrum Stylus exists to make viable on-chain: work that's gas-prohibitive in the EVM but cheap in compiled Rust. That's what makes this buildable as a real on-chain primitive in a hackathon timeframe rather than a research paper.

## 5. Target Users / Personas

- **Retail DeFi traders** — anyone swapping meaningful size who is currently losing value to sandwich attacks without realizing it. Primary beneficiary.
- **DeFi-native power users / degens** — already aware MEV exists, actively seeking MEV-protected venues, and will understand and value the mechanism immediately (this is also our most credible hackathon-demo audience — judges fall into this bucket).
- **Protocol/DAO treasuries and market makers** — parties executing large trades where sandwich losses are a real line-item cost, not just an annoyance.
- **Arbitrum ecosystem / Stylus program itself** — as a secondary "persona," this project is exactly the kind of compute-heavy, previously-impractical use case Stylus was built to unlock, which matters for a showcase built around Arbitrum + Stylus specifically.

## 6. Value Proposition & Innovation

- **For users:** provably fair execution — the price you get is the price everyone in that batch gets, with no possible mechanism for someone to move the price against you first.
- **For the ecosystem:** a fully on-chain, trust-minimized alternative to off-chain solver/private-mempool MEV mitigation — no intermediary to trust, verifiable on-chain.
- **The innovation is the *feasibility*, not just the idea:** batch auctions as an MEV mitigation aren't a new concept (CoW Swap does this off-chain today). What's novel here is doing the clearing-price computation itself **on-chain**, which is only realistically achievable because Stylus makes the numerical solve cheap enough to be worth doing in a smart contract instead of an off-chain solver network.

## 7. Goals (for the hackathon build)

- Ship a working end-to-end flow: submit orders → batch window closes → on-chain clearing price computed via Stylus → settlement executes → users receive correct fills.
- Make the mechanism **visibly, demonstrably** MEV-resistant — the demo must make the "why this can't be sandwiched" argument obvious without requiring the audience to trust our claims.
- Produce a clear, real gas/cost comparison showing why this wasn't practical without Stylus.
- Deliver a complete, coherent narrative in under 3 minutes: problem → mechanism → live demo → proof.

## 8. Non-Goals (explicitly out of scope for this build)

- Supporting more than one trading pair / asset in the initial version.
- Continuous multi-batch, production-grade order book depth or advanced order types (stop-loss, TWAP, etc.) — limit orders only.
- Cross-chain functionality.
- Production-grade security hardening, formal verification, or audit-readiness (this is a hackathon MVP, not a mainnet-ready protocol — see Constraints).
- A polished, general-purpose trading UI — the frontend exists to make the demo legible, not to be a shippable product.
- Governance, tokenomics, fee-switch design, or any token/DAO layer.
- Solving general MEV categories beyond sandwich attacks (e.g., liquidation MEV, arbitrage MEV) — sandwich resistance on swaps is the whole scope.

## 9. Key Use Cases

1. **Happy path swap:** A user submits a buy order and a seller submits a matching sell order within the same batch window; batch clears; both parties receive fills at the single computed clearing price.
2. **Partial fill:** Aggregate demand and supply in a batch don't match 1:1 in size; the clearing mechanism allocates partial fills fairly at the uniform price.
3. **No counter-liquidity:** A batch closes with only one-sided orders (e.g., all buys, no sells); orders roll into the next batch or are returned, with no execution at a manipulated price.
4. **The "proof" demo:** identical order flow is run once through ClearSwap and, side-by-side, through a simulated standard sequential-AMM sandwich scenario, showing the value a bot would have extracted in the second case and didn't in the first.
5. **Cost proof:** the same clearing-price computation is shown costed in Stylus vs. an equivalent pure-Solidity implementation, to substantiate why this is a Stylus-native use case and not just "an idea that happens to also run on Stylus."

## 10. Competitive / Alternative Solutions

- **CoW Swap / CoW Protocol** — off-chain solver competition finds batch-clearing solutions off-chain, settled on-chain. Proven model, but the actual matching/solving is off-chain and trust is placed in the solver network and its incentive design.
- **Private mempools / MEV-protected RPCs (Flashbots Protect, MEV Blocker, etc.)** — hide transactions from the public mempool to prevent bots from seeing them pre-execution. Effective, but relies on trusting the private relay/builder, and doesn't change the underlying sequential-execution vulnerability — it just hides the target.
- **Standard AMMs with tighter slippage settings** — not a real solution, just damage-limitation; doesn't address the root cause.
- **Other on-chain batch auction attempts** — largely theoretical or gas-prohibitive on the EVM historically, which is precisely the gap Stylus's compute cost reduction opens up.

## 11. Differentiation

ClearSwap is the only approach in this list where **the fairness-guaranteeing computation itself happens on-chain**, verifiably, with no off-chain solver, no private relay, and no trusted intermediary — and it's specifically the compute cost profile of Arbitrum Stylus that makes this practical rather than merely theoretical. We are not pitching "a DEX with a new UI" — we're pitching a previously gas-infeasible on-chain mechanism made real by the exact tech stack this showcase is built around.

## 12. Success Metrics (for judging / demo purposes)

- End-to-end flow works live: orders submitted → batch clears → correct settlement, on Arbitrum (testnet).
- The clearing price is demonstrably a single uniform price across all fills in a batch (verifiable on-chain, visible in the demo UI).
- A concrete, real (not estimated) gas-cost figure for the Stylus clearing computation, shown against an equivalent Solidity implementation.
- A judge or bystander can, unprompted, articulate back "so nobody can front-run this because everyone gets the same price" after watching the demo — i.e., the mechanism is self-evidently understandable, not just technically true.

## 13. Assumptions

- Arbitrum Stylus testnet tooling and RPC access will be available and stable through the build window.
- A single trading pair with simulated/test liquidity is sufficient for a convincing demo — no real market liquidity is required.
- Modular development of Solidity (order/settlement) and Rust/Stylus (clearing computation) work streams against clear, decoupled interfaces allows rapid, focused execution by a solo builder with AI pair programming.
- Judges are evaluating for problem significance, technical ambition, and demo clarity — not production readiness.

## 14. Constraints & Hackathon-Specific Requirements

- **Timebox:** build window is roughly Sept 7, ~10pm through the Sept 9 showcase — under 36 hours total, including sleep, testing, and demo prep. Scope must stay ruthlessly minimal (see Non-Goals).
- **Builder model:** Solo builder project.
- **Tech focus requirement:** must use Web3 / Arbitrum with Rust-based smart contracts (Stylus) — this is a hard requirement of the showcase, not optional.
- **Format:** virtual/online showcase — demo must work reliably over a screen-share, with a recorded backup in case of live network issues.
- **Prize structure:** $1,000 total pool (1st: $400, 2nd: $300, 3rd: $200, Special Mention: $100) — single showcase, single presentation slot; no partial credit for "would have worked if we had more time," so the demo must be real and complete, not simulated.
- No requirement (from us) for mainnet deployment — testnet deployment is sufficient and expected given the timeframe.
