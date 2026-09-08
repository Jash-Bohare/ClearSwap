// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ISettlement} from "./interfaces/ISettlement.sol";
import {IOrderBook} from "./interfaces/IOrderBook.sol";
import {ClearingResult, Fill, OrderStatus} from "./types/DataTypes.sol";
import {Constants} from "./Constants.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title Settlement Skeleton
/// @notice The only contract that holds/transfers user funds for settled fills (Spec 04 §6)
contract Settlement is ISettlement {
    using SafeERC20 for IERC20;

    address public owner;
    address public baseToken;
    address public quoteToken;
    address public orderBook;
    address public clearingAdapter;

    mapping(uint256 => bool) public settledBatches;

    modifier onlyAuthorized() {
        if (msg.sender != clearingAdapter && msg.sender != owner) {
            revert Unauthorized(msg.sender);
        }
        _;
    }

    constructor(
        address _baseToken,
        address _quoteToken,
        address _orderBook,
        address _clearingAdapter
    ) {
        owner = msg.sender;
        baseToken = _baseToken;
        quoteToken = _quoteToken;
        orderBook = _orderBook;
        clearingAdapter = _clearingAdapter;
    }

    function setClearingAdapter(address _clearingAdapter) external {
        if (msg.sender != owner) revert Unauthorized(msg.sender);
        clearingAdapter = _clearingAdapter;
    }

    function setOrderBook(address _orderBook) external {
        if (msg.sender != owner) revert Unauthorized(msg.sender);
        orderBook = _orderBook;
    }

    /// @inheritdoc ISettlement
    function settleBatch(uint256 batchId, ClearingResult calldata result) external override onlyAuthorized {
        if (settledBatches[batchId]) revert BatchAlreadySettled(batchId);
        settledBatches[batchId] = true;

        uint256 totalVolume = 0;

        for (uint256 i = 0; i < result.fills.length; i++) {
            Fill memory fill = result.fills[i];
            // Compute quoteAmount once per fill using floor division (Spec 03 §11, ADR-007)
            uint256 quoteAmount = (fill.filledAmount * fill.clearingPrice) / (10 ** Constants.BASE_DECIMALS);

            if (fill.isBuy) {
                // Buyer pays quote token, receives base token
                IERC20(quoteToken).safeTransferFrom(fill.trader, address(this), quoteAmount);
                IERC20(baseToken).safeTransfer(fill.trader, fill.filledAmount);
                totalVolume += fill.filledAmount;
            } else {
                // Seller pays base token, receives quote token
                IERC20(baseToken).safeTransferFrom(fill.trader, address(this), fill.filledAmount);
                IERC20(quoteToken).safeTransfer(fill.trader, quoteAmount);
            }

            emit OrderFilled(fill.orderId, fill.trader, fill.isBuy, fill.filledAmount, fill.clearingPrice, quoteAmount);
        }

        emit BatchSettled(batchId, result.clearingPrice, result.fills.length, totalVolume);
    }
}
