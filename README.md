# ClearSwap — MEV-Resistant Batch Auction DEX

> **Next-Generation Decentralized Exchange built with Arbitrum Stylus (Rust) and Solidity.**  
> Eliminates front-running, sandwich attacks, and MEV extraction by construction through **discrete uniform-price batch auctions**.

---

## 📑 Table of Contents
1. [Executive Overview](#1-executive-overview)
2. [A Beginner's Guide to MEV & Sandwich Attacks](#2-a-beginners-guide-to-mev--sandwich-attacks)
   - [What is MEV?](#what-is-mev)
   - [How Traditional AMMs Work (Sequential Execution)](#how-traditional-amms-work-sequential-execution)
   - [The Anatomy of a Sandwich Attack](#the-anatomy-of-a-sandwich-attack)
3. [How ClearSwap Solves MEV by Construction](#3-how-clearswap-solves-mev-by-construction)
   - [What is a Discrete Batch Auction?](#what-is-a-discrete-batch-auction)
   - [The Uniform Clearing Price ($P^*$)](#the-uniform-clearing-price-p)
   - [Non-Prefunding & Custody Safety](#non-prefunding--custody-safety)
4. [Why Arbitrum Stylus (Rust WASM)?](#4-why-arbitrum-stylus-rust-wasm)
   - [The Computation Bottleneck in Solidity](#the-computation-bottleneck-in-solidity)
   - [Gas Benchmarks: Stylus vs Solidity (~82% Reduction)](#gas-benchmarks-stylus-vs-solidity-82-reduction)
5. [System Architecture & Data Flow](#5-system-architecture--data-flow)
   - [Smart Contract Components](#smart-contract-components)
   - [End-to-End Trade Lifecycle](#end-to-end-trade-lifecycle)
6. [The Clearing Algorithm Explained (With Worked Example)](#6-the-clearing-algorithm-explained-with-worked-example)
7. [Getting Started & Local Setup Guide](#7-getting-started--local-setup-guide)
   - [Prerequisites](#prerequisites)
   - [1. Running Rust Engine Unit Tests](#1-running-rust-engine-unit-tests)
   - [2. Running Foundry Smart Contract Tests](#2-running-foundry-smart-contract-tests)
   - [3. Running the Interactive Frontend](#3-running-the-interactive-frontend)
8. [Repository Structure](#8-repository-structure)
9. [Security & Safety Invariants](#9-security--safety-invariants)

---

## 1. Executive Overview

In decentralized finance (DeFi), billions of dollars are lost every year to predatory algorithmic trading bots that front-run and "sandwich" everyday users. Standard DEXs (like Uniswap or SushiSwap) process trades **sequentially** (one transaction after another in chronological order). This creates an unfair race where whoever pays higher gas fees can insert their transaction *ahead* of yours to manipulate the price and steal your value.

**ClearSwap** solves this problem permanently.

Instead of processing transactions one by one, ClearSwap collects orders over a short time window (a **batch**) and executes all matching trades at the **exact same uniform clearing price ($P^*$)** simultaneously. By removing transaction sequence priority, front-running and sandwich attacks become **mathematically impossible**.

To make complex batch-clearing algorithms affordable on-chain, ClearSwap utilizes **Arbitrum Stylus**, running high-performance compiled **Rust WebAssembly (WASM)** directly alongside EVM smart contracts, slashing clearing gas costs by up to **82%**.

---

## 2. A Beginner's Guide to MEV & Sandwich Attacks

If you are new to DeFi, here is a simple explanation of why traditional DEXs are vulnerable and why ClearSwap was built.

### What is MEV?
**MEV** stands for **Maximal Extractable Value** (formerly *Miner Extractable Value*). In blockchain networks, miners/validators (or searcher bots watching the pending transaction pool, known as the *mempool*) can choose the order in which transactions get packaged into a block. When they see a profitable opportunity, they reorder, insert, or delay transactions to extract profit from regular users.

### How Traditional AMMs Work (Sequential Execution)
Traditional Automated Market Makers (AMMs) use an $x \cdot y = k$ bonding curve where:
- Every trade moves the market price slightly.
- Trades execute one after another in a straight line: `Tx 1` $\rightarrow$ `Tx 2` $\rightarrow$ `Tx 3`.

```
Traditional DEX:
Time --->  [Tx 1 (Bot)] ===> [Tx 2 (User Victim)] ===> [Tx 3 (Bot)]
           Buys low          Pushed to buy high        Sells high (Dumps)
```

### The Anatomy of a Sandwich Attack

Imagine you want to buy **2.0 WETH** on a DEX. You set a maximum slippage tolerance of **$3,050 USDC/WETH** when the current market price is **$3,000**.

1. **Step 1 (The Front-Run)**: An MEV bot detects your transaction in the public mempool before it is confirmed. The bot quickly broadcasts a buy order with a higher gas fee. The validator places the bot's trade *first*. The bot buys 5 WETH at $3,000, which artificially pushes the pool price up to **$3,085.40**.
2. **Step 2 (The Victim Trade)**: Your trade executes next. Because the pool price was pushed up, you receive significantly less WETH than expected (paying an inflated price of **$3,085.40** per WETH).
3. **Step 3 (The Back-Run)**: In the exact same block, the bot immediately sells its 5 WETH back into the pool at the elevated price, locking in an instant risk-free profit.

**The Result**: You lost **$150.80 USDC** ($75.40/WETH) to the bot without ever realizing why your trade got such a bad fill!

---

## 3. How ClearSwap Solves MEV by Construction

ClearSwap replaces sequential execution with **Discrete Uniform-Price Batch Auctions**.

```
ClearSwap Batch Auction:
Batch Window (e.g. 45s):
  ┌─────────────────────────────────────────────────────────┐
  │ [User Order 1]  [Bot Order]  [User Order 2]  [User 3]    │
  └──────────────────────────┬──────────────────────────────┘
                             ▼
  ┌─────────────────────────────────────────────────────────┐
  │         Arbitrum Stylus Rust Clearing Engine            │
  │     Calculates Uniform Market Clearing Price (P*)       │
  └──────────────────────────┬──────────────────────────────┘
                             ▼
  ┌─────────────────────────────────────────────────────────┐
  │   ALL MATCHED ORDERS EXECUTE AT EXACTLY P* = $3,010     │
  │          Front-running advantage: 0.00%                 │
  └─────────────────────────────────────────────────────────┘
```

### What is a Discrete Batch Auction?
1. **Accumulation Phase**: While a batch is open (e.g., 45 seconds), traders submit limit buy and sell orders. No orders execute yet.
2. **Batch Closure**: When the timer expires, the batch is closed. No new orders can enter this batch.
3. **Uniform Clearing**: An optimization algorithm analyzes all buy and sell curves together to find the single price $P^*$ that maximizes trade volume.
4. **Simultaneous Settlement**: All eligible trades execute at **$P^*$**. 

### The Uniform Clearing Price ($P^*$)
The **5-Second UX Rule** of ClearSwap is simple:
> *"1 price for every trade in this batch — no one paid more or got more just by going first."*

If an MEV bot tries to place an order before or after you, it makes no difference: **every single buyer and seller in the batch receives the exact same clearing price $P^*$**. A sandwich bot cannot buy low and sell high against you within the same batch because it receives the identical price as you!

### Non-Prefunding & Custody Safety
- **Zero Token Lock-in**: Traders do not need to deposit or lock tokens into the contract when placing an order. You simply sign an ERC20 allowance.
- **Instant Cancellation**: Any open order can be cancelled at zero cost before the batch closes.
- **Automatic Rollovers**: If your limit price was not matched in Batch #1, your order automatically rolls forward to Batch #2 without any token transfer fees or gas penalties.

---

## 4. Why Arbitrum Stylus (Rust WASM)?

### The Computation Bottleneck in Solidity
To calculate the uniform clearing price $P^*$, an exchange must:
1. Collect and deduplicate all price points.
2. Sort candidate prices ($O(N \log N)$).
3. Compute cumulative demand and supply across all price levels.
4. Resolve two-stage tie-breaking conditions.
5. Allocate pro-rata fractional fills and distribute single-wei remainders.

In standard EVM Solidity, dynamic arrays, sorting, and intensive loops are extremely expensive in gas. For $N=10$ orders, Solidity requires **>100,000 gas** just for clearing arithmetic!

### Gas Benchmarks: Stylus vs Solidity (~82% Reduction)
By executing the heavy math inside an **Arbitrum Stylus WebAssembly (WASM)** contract compiled from high-performance Rust, ClearSwap achieves massive gas savings:

| Batch Size ($N$) | Pure Solidity Gas | Stylus Rust WASM Gas | Gas Reduction |
|:---:|:---:|:---:|:---:|
| **$N = 2$ Orders** | 17,104 gas | 4,200 gas | **75.4%** |
| **$N = 6$ Orders** | 57,195 gas | 11,500 gas | **79.9%** |
| **$N = 10$ Orders** | 102,982 gas | 18,400 gas | **82.1%** |

---

## 5. System Architecture & Data Flow

ClearSwap is architected cleanly with separation of concerns:

```
                      ┌─────────────────────────────────┐
                      │          React Frontend         │
                      │  (Vite + TypeScript + CSS)      │
                      └────────────────┬────────────────┘
                                       │ submitOrder()
                                       ▼
                      ┌─────────────────────────────────┐
                      │         OrderBook.sol           │
                      │   - Collects batch orders       │
                      │   - Tracks batch lifecycle      │
                      │   - Permissionless closeBatch() │
                      └────────────────┬────────────────┘
                                       │ closeBatch()
                                       ▼
                      ┌─────────────────────────────────┐
                      │       ClearingAdapter.sol       │
                      │   - Prepares input calldata     │
                      │   - Calls Stylus WASM Engine    │
                      │   - Enforces 4 Safety Checks    │
                      └────────────────┬────────────────┘
                                       │ computeClearing()
                                       ▼
                      ┌─────────────────────────────────┐
                      │    Stylus Rust Engine (WASM)    │
                      │   - Candidate Price Sweep       │
                      │   - Argmax Volume P* Selection  │
                      │   - Pro-Rata & Remainder Math   │
                      └────────────────┬────────────────┘
                                       │ ClearingResult
                                       ▼
                      ┌─────────────────────────────────┐
                      │         Settlement.sol          │
                      │   - Pulls tokens (ERC20 transfer)│
                      │   - Credits traders atomically  │
                      │   - Triggers order rollovers    │
                      └─────────────────────────────────┘
```

### Smart Contract Components

1. **`OrderBook.sol`**:
   - Manages order submissions, cancellations, and batch states (`OPEN`, `CLOSED`).
   - Automatically opens Batch `N+1` when Batch `N` closes.
   - `closeBatch()` is 100% permissionless—any user or bot can trigger it once the time window expires.

2. **`ClearingAdapter.sol`**:
   - Dispatches batch orders to the Stylus Rust Engine.
   - **4 Mandatory Safety Checks**:
     - *Check 1*: $P^* > 0 \iff \text{fills.length} > 0$.
     - *Check 2*: Every fill's `clearingPrice` must exactly match $P^*$.
     - *Check 3*: Fills cannot contain unrecognized `orderId`s.
     - *Check 4*: Allocated fill volume must not exceed submitted order amounts.

3. **`Settlement.sol`**:
   - Calculates the exact quote amount: $\lfloor (\text{filledAmount} \times P^*) / 10^8 \rfloor$.
   - Transfers Base (WETH) and Quote (USDC) tokens atomically between matched buyers and sellers.
   - Updates order statuses (`FILLED`, `PARTIALLY_FILLED`, or rolls unmatched forward).

4. **`stylus-engine/src/lib.rs` (Rust WASM)**:
   - Uses sorted `Vec<u64>` candidate price arrays (**zero `HashMap`/`HashSet`** for deterministic execution).
   - Resolves ties: 1) Maximize Volume $\rightarrow$ 2) Minimize Imbalance $\rightarrow$ 3) Lowest candidate price.

---

## 6. The Clearing Algorithm Explained (With Worked Example)

Let's walk through the canonical **Spec 03 §17** worked example implemented in the protocol:

### Submitted Orders in Batch #1:
- **Buy Orders**:
  - `B1`: Buy 2.0 WETH @ max limit **$3,050**
  - `B2`: Buy 1.0 WETH @ max limit **$3,020**
  - `B3`: Buy 3.0 WETH @ max limit **$2,990**
- **Sell Orders**:
  - `S1`: Sell 1.5 WETH @ min limit **$2,980**
  - `S2`: Sell 2.0 WETH @ min limit **$3,010**
  - `S3`: Sell 1.0 WETH @ min limit **$3,040**

### Candidate Price Sweep:
The engine builds candidate price levels and computes supply/demand:

| Candidate Price ($P$) | Eligible Buy Demand | Eligible Sell Supply | Cleared Volume $\min(\text{Buy}, \text{Sell})$ | Imbalance $|\text{Buy} - \text{Sell}|$ |
|:---:|:---:|:---:|:---:|:---:|
| **$2,980** | 6.0 WETH (B1+B2+B3) | 1.5 WETH (S1) | 1.5 WETH | 4.5 WETH |
| **$2,990** | 6.0 WETH (B1+B2+B3) | 1.5 WETH (S1) | 1.5 WETH | 4.5 WETH |
| **$3,010** | **3.0 WETH** (B1+B2) | **3.5 WETH** (S1+S2) | **3.0 WETH (MAX)** | **0.5 WETH** |
| **$3,020** | 3.0 WETH (B1+B2) | 3.5 WETH (S1+S2) | 3.0 WETH (MAX) | 0.5 WETH |
| **$3,040** | 2.0 WETH (B1) | 4.5 WETH (S1+S2+S3) | 2.0 WETH | 2.5 WETH |
| **$3,050** | 2.0 WETH (B1) | 4.5 WETH (S1+S2+S3) | 2.0 WETH | 2.5 WETH |

### Selection of $P^* = 3010$:
- Both **$3,010** and **$3,020** tie on maximum volume (3.0 WETH) and minimum imbalance (0.5 WETH).
- **Tie-Break Rule**: The engine chooses the **lowest price** $\rightarrow$ **$P^* = \$3,010$**.

### Fill Allocations:
- **Buy Side (Total 3.0 WETH demand @ $P^* \ge 3010$)**:
  - `B1` is 100% filled: **2.0 WETH**
  - `B2` is 100% filled: **1.0 WETH**
  - `B3` limit price ($2,990) is below $P^* \rightarrow$ **0 filled (rolls to Batch #2)**
- **Sell Side (Total 3.5 WETH supply @ $P^* \le 3010$)**:
  - Pro-rata rationing factor: $3.0 / 3.5 = 85.714\%$
  - `S1` filled: **1.285714 WETH** (Unfilled 0.214286 rolls to Batch #2)
  - `S2` filled: **1.714286 WETH** (Unfilled 0.285714 rolls to Batch #2)
  - `S3` limit price ($3,040) is above $P^* \rightarrow$ **0 filled (rolls to Batch #2)**

---

## 7. Getting Started & Local Setup Guide

Follow these steps to run ClearSwap on your local machine.

### Prerequisites
Make sure you have the following installed:
- **Rust & Cargo** (1.75+): [Install Rust](https://www.rust-lang.org/tools/install)
- **Foundry** (`forge` & `anvil`): [Install Foundry](https://getfoundry.sh/)
- **Node.js** (v18+) & `npm`: [Install Node.js](https://nodejs.org/)

---

### 1. Running Rust Engine Unit Tests
Test the core discrete clearing engine, candidate price sweeps, tie-breakers, and overflow checks:

```bash
cd stylus-engine
cargo test
```

Expected output:
```text
running 8 tests
test tests::test_determinism_repeated_calls ... ok
test tests::test_empty_batch_returns_zero_result ... ok
test tests::test_exact_match_no_rationing ... ok
test tests::test_one_sided_batch_returns_zero_result ... ok
test tests::test_overflow_reverts_not_wraps ... ok
test tests::test_rejects_mixed_batch_ids ... ok
test tests::test_tie_break_minimizes_imbalance_then_lowest_price ... ok
test tests::test_worked_example_matches_spec ... ok

test result: ok. 8 passed; 0 failed; 0 ignored; finished in 0.00s
```

---

### 2. Running Foundry Smart Contract Tests
Test all Solidity contracts, access control, 4-point safety verification, gas benchmarks, and end-to-end integration:

```bash
cd contracts
forge test -vvv
```

Expected output:
```text
Ran 7 test suites: 44 tests passed, 0 failed, 0 skipped (44 total tests)
- Phase0SanityTest: 3 passed
- Phase1SkeletonTest: 4 passed
- OrderBookTest: 9 passed
- ClearingAdapterTest: 6 passed
- SettlementTest: 10 passed
- GasBenchmarkTest: 3 passed
- IntegrationTest: 9 passed
```

---

### 3. Running the Interactive Frontend
Launch the dark-mode React application with the live batch auction dashboard, sandwich simulator, and demo controls:

```bash
cd frontend
npm install
npm run dev
```

Open your browser at **`http://localhost:5173/`** (or the port indicated in the terminal).

#### Exploring the Interactive UI:
1. **Run MEV Demo Button**: Injects the canonical 6-order worked example into the current batch.
2. **Current Batch Live Book**: Watch the countdown timer and live Buy/Sell liquidity meter.
3. **Close Batch & Clear**: Triggers the Stylus clearing calculation and reveals the uniform $P^* = \$3,010$ hero card.
4. **Sandwich Protection Modal**: View side-by-side math comparing sequential AMM slippage loss vs ClearSwap's 0% frontrun advantage.
5. **Gas Benchmark Modal**: View real measured gas comparisons between Stylus WASM and pure Solidity.

---

## 8. Repository Structure

```
ClearSwap/
├── README.md                          # Comprehensive project documentation
├── Specs/                             # Engineering & Product Specifications (01 - 09)
│   ├── 01-Product-Business-Specification.md
│   ├── 02-Stylus-Architecture-Specification.md
│   ├── 03-Clearing-Algorithm-Specification.md
│   ├── 04-Solidity-Contracts-Specification.md
│   ├── 05-Rust-Stylus-Engine-Specification.md
│   ├── 06-Frontend-Pitch-UI-Specification.md
│   ├── 07-Testing-Specification.md
│   ├── 08-Development-Plan.md
│   └── 09-Stylus-Environment-Reference.md
│
├── stylus-engine/                     # Arbitrum Stylus Rust Clearing Engine
│   ├── Cargo.toml
│   └── src/
│       ├── lib.rs                     # Full discrete clearing algorithm & Rust tests
│       └── types.rs                   # Shared Rust order, fill, and result structs
│
├── contracts/                         # Solidity Smart Contracts (Foundry)
│   ├── foundry.toml
│   ├── src/
│   │   ├── OrderBook.sol              # Non-prefunding order book & batch lifecycle
│   │   ├── ClearingAdapter.sol        # Stylus dispatch & 4 safety validation checks
│   │   ├── Settlement.sol             # Atomic multi-token transfers & rollovers
│   │   ├── interfaces/                # IOrderBook, IClearingAdapter, ISettlement
│   │   └── mocks/                     # MockWETH, MockUSDC, MockClearingEngine
│   ├── script/
│   │   └── DeploySystem.s.sol         # 7-step deploy & authorization sequence
│   └── test/
│       ├── Phase0Sanity.t.sol
│       ├── Phase1Skeleton.t.sol
│       ├── OrderBook.t.sol
│       ├── ClearingAdapter.t.sol
│       ├── Settlement.t.sol
│       ├── Integration.t.sol          # Cases 1-5, invariants, rollovers, sandwich tests
│       └── benchmarks/
│           ├── SolidityClearingBenchmark.sol
│           └── GasBenchmark.t.sol     # Measured Stylus vs Solidity gas comparison
│
└── frontend/                          # Interactive React / TypeScript Web Application
    ├── index.html
    ├── package.json
    ├── vite.config.ts
    └── src/
        ├── App.tsx                    # Main state machine & layout controller
        ├── index.css                  # Custom dark luxury crypto Vanilla CSS design system
        ├── types.ts
        └── components/
            ├── Header.tsx             # Sticky navbar, brand badge, live status
            ├── OrderForm.tsx          # Limit order submission & quick price presets
            ├── CurrentBatchPanel.tsx  # Live auction book, countdown timer, liquidity meter
            ├── ClearingResultPanel.tsx# 5-Second UX hero card & settlement fills table
            ├── SandwichComparisonModal.tsx # Side-by-side MEV extraction breakdown
            ├── GasComparisonModal.tsx # Stylus vs EVM gas savings visualization
            └── DemoControlBar.tsx     # 1-click worked example replay controller
```

---

## 9. Security & Safety Invariants

ClearSwap is designed with defensive programming and strict security guarantees:

1. **Deterministic Single-Price Guarantee**: All fills in a settled batch execute at the identical uniform price $P^*$. No trader receives priority pricing based on transaction position.
2. **Token Conservation Invariant**: In every settlement, $\sum \text{WETH Received by Buyers} = \sum \text{WETH Delivered by Sellers}$.
3. **Non-Prefunding Custody Safety**: Unfilled orders do not hold or lock user tokens. If an order does not execute, tokens remain safely in the user's wallet.
4. **Adapter Safety Checks**: `ClearingAdapter.sol` actively verifies results returned by Stylus to prevent over-allocation, price divergence, or injection of unauthorized order IDs.
5. **Deterministic Remainder Rounding**: Single-wei remainders from pro-rata integer division are awarded deterministically in ascending order of `orderId`, eliminating ambiguity.

---

## 📄 License
This project is open-source and available under the **MIT License**.
