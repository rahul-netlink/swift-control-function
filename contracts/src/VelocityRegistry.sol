// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Administered} from "./Administered.sol";

/// @title VelocityRegistry
/// @notice PIP — rolling-window settlement velocity per (asset, party). Real AML policy
///         caps not just the size of a single transfer but the cumulative notional a
///         party moves over a window (e.g. €5m/24h). That is inherently stateful, so it
///         lives in its own component: the PDP reads it on the view path to predict
///         whether a transfer would breach the cap, and records the settled amount on the
///         consuming path. The window is a simple tumbling window — the first settlement
///         after the window elapses starts a fresh one.
contract VelocityRegistry is Administered {
    /// @dev One slot: a tumbling-window accumulator. `spent` is uint192 so it co-packs
    ///      with `start` (64 + 192 = 256 bits) — one cold SSTORE per window instead of two.
    ///      uint192 caps cumulative notional at ~6.3e57, far beyond any real settlement sum.
    struct Window {
        uint64 start;
        uint192 spent;
    }

    mapping(bytes32 => mapping(address => Window)) internal _windows;
    mapping(address => bool) public isRecorder;

    event RecorderSet(address indexed recorder, bool allowed);
    event VelocityRecorded(bytes32 indexed assetId, address indexed party, uint256 amount, uint256 windowSpent);

    error NotRecorder();
    error AmountOverflow();

    constructor(address admin_) Administered(admin_) {}

    function setRecorder(address recorder, bool allowed) external onlyAdmin {
        isRecorder[recorder] = allowed;
        emit RecorderSet(recorder, allowed);
    }

    /// @notice Cumulative notional `party` has settled inside the live window. Returns 0
    ///         once the window has elapsed (a fresh window will open on the next record).
    function spent(bytes32 assetId, address party, uint64 window, uint64 nowTs) public view returns (uint256) {
        if (window == 0) return 0;
        Window storage w = _windows[assetId][party];
        if (w.start == 0 || nowTs >= w.start + window) return 0;
        return uint256(w.spent);
    }

    /// @notice True when settling `amount` now would push `party` over `cap` for the window.
    function wouldExceed(bytes32 assetId, address party, uint256 amount, uint64 window, uint256 cap, uint64 nowTs)
        external
        view
        returns (bool)
    {
        if (window == 0 || cap == 0) return false;
        return spent(assetId, party, window, nowTs) + amount > cap;
    }

    /// @notice Record a settled transfer against `party`'s window. Opens a fresh window
    ///         if none is live. Restricted to authorised PDP instances.
    function record(bytes32 assetId, address party, uint256 amount, uint64 window, uint64 nowTs) external {
        if (!isRecorder[msg.sender]) revert NotRecorder();
        if (window == 0) return;
        if (amount > type(uint192).max) revert AmountOverflow();
        Window storage w = _windows[assetId][party];
        uint192 amt = uint192(amount);
        if (w.start == 0 || nowTs >= w.start + window) {
            w.start = nowTs;
            w.spent = amt;
        } else {
            w.spent += amt;
        }
        emit VelocityRecorded(assetId, party, amount, uint256(w.spent));
    }
}
