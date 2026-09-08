// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Order, ClearingResult} from "../types/DataTypes.sol";

/// @notice Interface for Stylus Clearing Engine (Spec 04 §7, Spec 05)
interface IClearingEngine {
    function computeClearing(Order[] calldata orders) external view returns (ClearingResult memory);
}
