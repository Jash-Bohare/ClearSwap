# 04 — Smart Contract Specification
### Project: ClearSwap — MEV-Resistant Batch Auction DEX

> This doc defines exact contract-level interfaces — structs, function signatures, events, errors, storage — implementing the rules fixed in `03 - Protocol Specification`. Function bodies/logic are intentionally omitted; that's the AI IDE's job during coding, not this document's. Every function/error here traces back to a specific `03` section, noted inline.

---

## 1. Contracts

### `OrderBook.sol`
Responsibilities:
- accept orders
- store orders
- expose orders
- batch management (lifecycle transitions `OPEN → CLOSED`)

### `Settlement.sol`
Responsibilities:
- settle valid clearing results
- transfer tokens
- update balances

### `ClearingAdapter.sol`
Responsibilities:
- communicate with the Stylus clearing contract
- encode input (orders → Stylus call format)
- decode result (Stylus output → `ClearingResult`)
- validate result (sanity-check before it's trusted by `Settlement.sol`)

**Why three contracts and not one:** this split maps 1:1 onto the trust/responsibility boundaries from `02 §3` — `OrderBook` never touches funds, `Settlement` is the only contract that moves tokens, and `ClearingAdapter` isolates all Stylus-call encoding/decoding so a bug in that boundary can't accidentally corrupt order storage or custody logic. It also lets the Solidity and Rust workstreams build against a single narrow interface (`ClearingAdapter`) without either side needing to understand the other's internals.

---

## 2. Core Structs

```solidity
struct Order {
    uint256 id;
    address trader;
    bool isBuy;
    uint256 amount;       // base-asset wei (see 03 §2, §3)
    uint256 limitPrice;   // quote-smallest-units per whole base token (see 03 §11)
    uint256 batchId;
    uint8 status;         // 0=PENDING, 1=PARTIALLY_FILLED, 2=FILLED, 3=CANCELLED
}

struct Batch {
    uint256 id;
    uint8 status;          // 0=OPEN, 1=CLOSED, 2=CLEARING, 3=SETTLED
    uint256 startTime;
    uint256 endTime;       // startTime + BATCH_WINDOW_SECONDS  (03 §6)
    uint256[] orderIds;
}

struct Fill {
    uint256 orderId;
    address trader;
    bool isBuy;
    uint256 filledAmount;  // base-asset wei
    uint256 clearingPrice; // == batch's single P* for every fill in the batch (03 §9)
}

struct ClearingResult {
    uint256 batchId;
    uint256 clearingPrice; // P*  (03 §8). If no trade occurred, set to 0 and fills.length == 0.
    Fill[] fills;
}
```

Status enums are represented as `uint8` rather than Solidity `enum` types at the ABI boundary specifically because `ClearingResult` crosses the Stylus/Solidity boundary (`ClearingAdapter`) — plain integers avoid any enum-encoding ambiguity between the two languages/toolchains. Internal Solidity code may still wrap these in a Solidity `enum` for readability as long as the underlying values match this table.

---

## 3. Constants

Defined once (e.g., in a shared `Constants.sol` or as immutables set at deploy time — pick one during coding, doesn't matter which, but it must be **one single source**, not duplicated across contracts):

```solidity
uint256 constant BASE_DECIMALS = 18;                    // 03 §2
uint256 constant QUOTE_DECIMALS = 6;                     // 03 §2
uint256 constant BATCH_WINDOW_SECONDS = 45;              // 03 §6 (owner-adjustable per 02 §10)
uint256 constant MIN_ORDER_SIZE = 1e15;                  // 0.001 WETH, 03 §12
address constant BASE_TOKEN = <mock WETH address>;       // set at deploy
address constant QUOTE_TOKEN = <mock USDC address>;      // set at deploy
```

`BATCH_WINDOW_SECONDS` should be a mutable, owner-settable storage variable (not a hardcoded `constant`) despite being listed here for completeness — see `02 §10`, it needs to be tunable without redeploying during demo prep.

---

## 4. `OrderBook.sol` — Interface

```solidity
interface IOrderBook {
    // --- Order submission & management ---

    /// @notice Submits a new order into the currently OPEN batch.
    /// @dev MUST revert if amount < MIN_ORDER_SIZE (03 §12).
    /// @dev MUST revert if no batch is currently OPEN (should not happen given
    ///      back-to-back batching per 03 §6, but must be defensively checked).
    function submitOrder(bool isBuy, uint256 amount, uint256 limitPrice) external returns (uint256 orderId);

    /// @notice Cancels an order. MUST revert unless the order's current batch is OPEN (03 §14).
    function cancelOrder(uint256 orderId) external;

    function getOrder(uint256 orderId) external view returns (Order memory);

    /// @notice Returns all order IDs currently attached to a batch (used by ClearingAdapter to build Stylus input).
    function getBatchOrderIds(uint256 batchId) external view returns (uint256[] memory);

    // --- Batch lifecycle ---

    function getCurrentBatch() external view returns (Batch memory);

    /// @notice Transitions the current batch OPEN → CLOSED once currentTime >= endTime,
    ///         and immediately opens the next batch (03 §6 — no gap between batches).
    /// @dev MUST revert if called before endTime, or if current batch is not OPEN (03 §5).
    function closeBatch() external returns (uint256 closedBatchId);

    // --- Rollover (called by Settlement after a batch is SETTLED, or directly for the
    //     zero-liquidity case per 03 §13) ---

    /// @notice Moves an unfilled/partially-unfilled order's remaining amount into the
    ///         current OPEN batch. Only callable by Settlement.sol.
    function rollOrder(uint256 orderId, uint256 newBatchId) external;
}
```

**Events**

```solidity
event OrderSubmitted(uint256 indexed orderId, address indexed trader, bool isBuy, uint256 amount, uint256 limitPrice, uint256 indexed batchId);
event OrderCancelled(uint256 indexed orderId);
event OrderRolled(uint256 indexed orderId, uint256 indexed fromBatchId, uint256 indexed toBatchId);
event BatchOpened(uint256 indexed batchId, uint256 startTime, uint256 endTime);
event BatchClosed(uint256 indexed batchId, uint256 orderCount);
```

**Custom Errors**

```solidity
error OrderTooSmall(uint256 amount, uint256 minimum);          // 03 §12
error BatchNotOpen(uint256 batchId);                            // 03 §5
error BatchWindowNotElapsed(uint256 currentTime, uint256 endTime); // 03 §6
error NotOrderOwner(uint256 orderId, address caller);
error OrderNotCancellable(uint256 orderId, uint8 batchStatus);   // 03 §14
error Unauthorized(address caller);                              // rollOrder / closeBatch access control
```

---

## 5. `ClearingAdapter.sol` — Interface

```solidity
interface IClearingAdapter {
    /// @notice Encodes the batch's orders, calls the Stylus clearing contract,
    ///         decodes and validates the result, and returns it.
    /// @dev MUST revert (not silently pass through) if the Stylus contract returns
    ///      a result that fails validation (see below) — a bad clearing result must
    ///      never reach Settlement.sol.
    function requestClearing(uint256 batchId, Order[] calldata orders) external returns (ClearingResult memory);

    /// @notice Address of the deployed Stylus clearing contract. Owner-settable so the
    ///         Stylus contract can be redeployed/upgraded during the hackathon without
    ///         redeploying the whole Solidity stack.
    function setStylusEngine(address engine) external;
}
```

**Result validation performed by `ClearingAdapter` before returning (this is the "validate result" responsibility from §1 — these checks encode the invariants from `03 §15` at the contract boundary):**

1. `clearingPrice == 0` is valid **only if** `fills.length == 0` (empty-batch / no-liquidity case, `03 §8`, `03 §13`) — any other combination reverts.
2. Every `Fill.clearingPrice` in the result **must equal** the single top-level `clearingPrice` — no fill may carry a different price (`03 §9`, invariant 3 in `03 §15`).
3. `Σ filledAmount` for `isBuy == true` fills must not exceed the sum of `amount` for all buy orders in the batch, and likewise for sell — sanity bound against the "no user receives more than entitled" invariant (`03 §15` invariant 1).
4. Every `orderId` referenced in `fills` must belong to the `orders` array passed in for that `batchId` — no fill may reference an order from a different batch.

If any check fails: `revert InvalidClearingResult(...)`. This is the single most important defensive boundary in the whole contract set — it's what makes it safe to trust a result computed in a separate (and less battle-tested, hackathon-timeline) Rust contract.

**Events**

```solidity
event ClearingRequested(uint256 indexed batchId, uint256 orderCount);
event ClearingReceived(uint256 indexed batchId, uint256 clearingPrice, uint256 fillCount);
```

**Custom Errors**

```solidity
error InvalidClearingResult(uint256 batchId, string reason);
error StylusCallFailed(uint256 batchId);
```

---

## 6. `Settlement.sol` — Interface

```solidity
interface ISettlement {
    /// @notice Applies a validated ClearingResult: pulls tokens from filled traders,
    ///         credits counter-tokens, updates each order's status, and rolls forward
    ///         any order left PENDING or PARTIALLY_FILLED with remaining amount.
    /// @dev MUST only be callable with a ClearingResult that has already passed
    ///      ClearingAdapter validation (03 §15, 04 §5) — Settlement does not re-derive
    ///      the clearing price itself, only applies the result it's given.
    function settleBatch(uint256 batchId, ClearingResult calldata result) external;
}
```

**Token movement rule (per `03 §11`):** for each `Fill`, compute `quoteAmount = (filledAmount * clearingPrice) / 10**BASE_DECIMALS` **exactly once**, then:
- if `isBuy`: pull `quoteAmount` of `QUOTE_TOKEN` from `trader`, credit `filledAmount` of `BASE_TOKEN` to `trader`.
- if `!isBuy` (sell): pull `filledAmount` of `BASE_TOKEN` from `trader`, credit `quoteAmount` of `QUOTE_TOKEN` to `trader`.

Because both sides of a matched pair are settled from the *same* computed `quoteAmount` for that fill, there is no path where a buyer pays a different number than a seller receives for corresponding volume (`03 §11`, invariant 2 in `03 §15`).

**Rollover trigger:** for any order with `status` still `PENDING` after settlement (fully unmatched, `03 §9`) or `PARTIALLY_FILLED` with `amount - filledAmount > 0` (`03 §10`), `Settlement.sol` calls `OrderBook.rollOrder(orderId, currentOpenBatchId)`.

**Events**

```solidity
event BatchSettled(uint256 indexed batchId, uint256 clearingPrice, uint256 fillCount, uint256 totalVolume);
event OrderFilled(uint256 indexed orderId, address indexed trader, bool isBuy, uint256 filledAmount, uint256 clearingPrice, uint256 quoteAmount);
```

**Custom Errors**

```solidity
error BatchNotInClearingState(uint256 batchId, uint8 status);   // 03 §5
error TransferFailed(address token, address from, address to, uint256 amount);
error UnrecognizedOrderInResult(uint256 orderId, uint256 batchId); // defense-in-depth, mirrors 04 §5 check 4
```

---

## 7. Stylus Clearing Contract — Interface Boundary

The Stylus contract exposes a single externally-callable entry point, ABI-compatible with Solidity per `02 §7`:

```
function computeClearing(Order[] orders) returns (ClearingResult)
```

Implements exactly the algorithm fixed in `03 §7–§10`:
1. Build the candidate price set from the union of `orders[i].limitPrice`.
2. For each candidate, compute `BuyQty`, `SellQty`, `Volume` (`03 §7`).
3. Select `P*` via argmax-volume → minimize-imbalance → lowest-price (`03 §8`).
4. Determine eligibility per side (`03 §9`).
5. Allocate fills: exact match on one side, pro-rata + ascending-`orderId` remainder distribution on the excess side (`03 §10`).
6. Return the populated `ClearingResult` (with `clearingPrice = 0`, empty `fills` if `Volume(P*) == 0` per `03 §8`/`§13`).

This contract is **stateless across batches** (`02 §3.4`) — it receives one batch's order array and returns one result; it holds no persistent batch/order storage of its own. All persistence lives in `OrderBook.sol`.

---

## 8. Access Control Summary

| Function | Caller |
|---|---|
| `OrderBook.submitOrder` | any address |
| `OrderBook.cancelOrder` | must be `order.trader` |
| `OrderBook.closeBatch` | any address (permissionless — anyone can trigger once the window has elapsed; avoids a single-keeper bottleneck/failure point during the live demo) |
| `OrderBook.rollOrder` | `Settlement.sol` only |
| `ClearingAdapter.requestClearing` | `OrderBook.sol` only (invoked as part of the close→clear flow) |
| `ClearingAdapter.setStylusEngine` | contract owner only |
| `Settlement.settleBatch` | `ClearingAdapter.sol` only (or a designated orchestrator — pick one caller and enforce it) |

Keeping `closeBatch` permissionless is a deliberate choice: it removes any dependency on a specific keeper/bot being online during the live demo, and it costs nothing extra to implement (`03 §6` conditions are checked either way).

---

## 9. Full Call Sequence (Contract-Level)

```
1. trader → OrderBook.submitOrder(...)                         [any time batch is OPEN]
2. anyone → OrderBook.closeBatch()                              [once endTime reached]
     → internally: OrderBook opens next batch immediately
     → internally: OrderBook calls ClearingAdapter.requestClearing(batchId, orders)
3. ClearingAdapter → Stylus.computeClearing(orders)
4. ClearingAdapter validates result (04 §5) → reverts whole tx if invalid
5. ClearingAdapter → Settlement.settleBatch(batchId, result)
6. Settlement: for each fill, pull/credit tokens (04 §6)
7. Settlement: for each PENDING/PARTIALLY_FILLED remainder → OrderBook.rollOrder(...)
8. Settlement emits BatchSettled + OrderFilled events → Indexer/Frontend pick up
```

Steps 2–7 happen within a single transaction triggered by `closeBatch()` — there is no async gap, no separate "someone must call settle later" step, which matters both for correctness (no window where a stale `ClearingResult` could be replayed) and for demo pacing (one visible transaction produces the whole clear-and-settle result on screen).

---

## 10. Foundry Test Plan

Map directly onto `03 §15` invariants and the `03 §17` worked example. Suggested test files:

**`OrderBook.t.sol`**
- `test_RevertsOnOrderBelowMinSize()` — `03 §12`
- `test_RevertsSubmitWhenBatchNotOpen()` — `03 §5`
- `test_CancelSucceedsWhileOpen_RevertsAfterClose()` — `03 §14`
- `test_CloseBatchRevertsBeforeWindowElapsed()` — `03 §6`
- `test_CloseBatchOpensNextBatchImmediately()` — `03 §6`

**`ClearingAdapter.t.sol`**
- `test_ClearingResult_MatchesWorkedExample()` — feed the exact `03 §17` order set, assert `P* == 3010`, assert `S1.filledAmount == 1.285714285714285715e18`, `S2.filledAmount == 1.714285714285714285e18`, `B1`/`B2` fully filled, `B3`/`S3` unfilled.
- `test_RevertsOnMismatchedFillPrice()` — construct a malformed result with a fill at a different price than the top-level `clearingPrice`, assert revert (`04 §5` check 2).
- `test_RevertsOnOverAllocation()` — malformed result where `Σ filledAmount` exceeds available quantity, assert revert (`04 §5` check 3).
- `test_EmptyBatch_ReturnsZeroPriceZeroFills()` — `03 §8`/`§13`.

**`Settlement.t.sol`**
- `test_TokenConservation()` — after settlement, assert quote paid by buyers == quote received by sellers exactly (`03 §15` invariant 2).
- `test_UnfilledOrdersRollForward()` — assert `batchId` updates and `status` stays `PENDING`, no token movement occurs for unmatched orders (`03 §13`).
- `test_NoLiquidityBatch_NoTransfersAllOrdersRoll()` — one-sided batch, assert zero `Transfer` events fired and all orders rolled (`03 §13`).

**`Determinism.t.sol`**
- `test_SameInputsProduceSameClearingResult()` — call `computeClearing` twice with an identical order array, assert byte-identical `ClearingResult` (`03 §16`).

These tests should be written *before* or alongside the implementation, directly against this document and `03` — that's the point of spec-based coding with an AI IDE: the spec is the source of truth the tests check against, not the other way around.

---

## 11. Deployment & Initialization Parameters

- Deploy order: mock `WETH`/`USDC` tokens → Stylus clearing contract → `ClearingAdapter` (constructor takes Stylus engine address) → `OrderBook` (constructor takes `BATCH_WINDOW_SECONDS`, `MIN_ORDER_SIZE`, token addresses) → `Settlement` (constructor takes `OrderBook` and `ClearingAdapter` addresses) → wire `ClearingAdapter`'s authorized caller to `OrderBook`, and `Settlement`'s authorized caller to `ClearingAdapter` (per `04 §8`).
- Immediately after deployment: call whatever function opens the very first batch (`Batch 0`, `status = OPEN`, `startTime = block.timestamp`) — the system must not require a separate manual "start" step beyond this.
