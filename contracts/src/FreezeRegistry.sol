// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Administered} from "./Administered.sol";

/// @title FreezeRegistry
/// @notice PIP — live, mutable on-chain state: account freezes and holder
///         membership/caps. This is the break-glass surface: a freeze applied here
///         denies the next operation even when a fresh "clear" attestation exists,
///         because the PDP combines rules deny-overrides.
contract FreezeRegistry is Administered {
    bytes32 internal constant SCOPE_ACCOUNT = "ACCOUNT";

    mapping(address => bool) internal _frozen;
    mapping(address => bool) public isOperator;

    mapping(bytes32 => uint256) internal _holderCount;
    mapping(bytes32 => mapping(address => bool)) internal _isHolder;

    event FreezeApplied(address indexed target, bytes32 scope, address operator, uint64 ts);
    event FreezeReleased(address indexed target, bytes32 scope, address operator, uint64 ts);
    event OperatorSet(address indexed operator, bool allowed);
    event HolderRegistered(bytes32 indexed assetId, address indexed holder, uint256 holderCount);

    error NotOperator();

    constructor(address admin_) Administered(admin_) {}

    modifier onlyOperator() {
        if (!isOperator[msg.sender]) revert NotOperator();
        _;
    }

    function setOperator(address operator, bool allowed) external onlyAdmin {
        isOperator[operator] = allowed;
        emit OperatorSet(operator, allowed);
    }

    function freeze(address target) external onlyOperator {
        _frozen[target] = true;
        emit FreezeApplied(target, SCOPE_ACCOUNT, msg.sender, uint64(block.timestamp));
    }

    function release(address target) external onlyOperator {
        _frozen[target] = false;
        emit FreezeReleased(target, SCOPE_ACCOUNT, msg.sender, uint64(block.timestamp));
    }

    function isFrozen(address account) external view returns (bool) {
        return _frozen[account];
    }

    /// @notice Record a holder once a transfer settles. Idempotent per (asset, holder).
    function registerHolder(bytes32 assetId, address holder) external onlyOperator {
        if (!_isHolder[assetId][holder]) {
            _isHolder[assetId][holder] = true;
            _holderCount[assetId] += 1;
            emit HolderRegistered(assetId, holder, _holderCount[assetId]);
        }
    }

    function holderCount(bytes32 assetId) external view returns (uint256) {
        return _holderCount[assetId];
    }

    function isHolder(bytes32 assetId, address holder) external view returns (bool) {
        return _isHolder[assetId][holder];
    }

    /// @notice holderCap predicate: an existing holder always passes; a new holder
    ///         passes only while headroom remains.
    function canAcquire(bytes32 assetId, address holder, uint32 maxHolders) external view returns (bool) {
        if (_isHolder[assetId][holder]) return true;
        return _holderCount[assetId] < maxHolders;
    }
}
