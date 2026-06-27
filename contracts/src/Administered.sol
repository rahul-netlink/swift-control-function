// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/// @title Administered
/// @notice Minimal administration primitive backing the PAP (Policy Administration
///         Point) role. A single administrator manages policy and trusted operators;
///         in production this maps to SWIFT governance, not an EOA.
abstract contract Administered {
    address public admin;

    event AdminTransferred(address indexed previousAdmin, address indexed newAdmin);

    error NotAdmin();
    error ZeroAddress();

    constructor(address admin_) {
        if (admin_ == address(0)) revert ZeroAddress();
        admin = admin_;
        emit AdminTransferred(address(0), admin_);
    }

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    function transferAdmin(address newAdmin) external onlyAdmin {
        if (newAdmin == address(0)) revert ZeroAddress();
        emit AdminTransferred(admin, newAdmin);
        admin = newAdmin;
    }
}
