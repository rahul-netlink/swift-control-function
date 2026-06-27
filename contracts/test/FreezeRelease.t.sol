// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Base} from "./Base.t.sol";
import {Rules} from "../src/Rules.sol";
import {ControlRequest, Decision} from "../src/IControlFunction.sol";

/// @title FreezeRelease — lifecycle coverage the invariant suite leaves out.
/// @notice I5_freezeDominance only proves a live freeze overrides a clear; it never
///         releases. These tests restore the deleted Freeze.t.sol coverage: the full
///         freeze -> release -> re-allow cycle, and a revoked claim surfacing its reason
///         on the hot path.
contract FreezeReleaseTest is Base {
    function setUp() public {
        _deployStack();
        _publishStanding(buyer, BIC_BUYER);
        _publishStanding(seller, BIC_SELLER);
    }

    /// Freeze denies the next operation; a release restores transferability. The freeze
    /// is mutable break-glass state, not a terminal kill, so the party transacts again
    /// once the operator lifts it.
    function test_freezeReleaseRestoresTransfer() public {
        ControlRequest memory req = _request(seller, buyer, 100e18);
        assertTrue(controlFunction.evaluate(req, "").allowed, "permits before freeze");

        vm.prank(operator);
        freezeRegistry.freeze(seller);
        Decision memory frozen = controlFunction.evaluate(req, "");
        assertFalse(frozen.allowed, "freeze must deny");
        assertEq(frozen.reasonCode, Rules.DENY_FREEZE, "FRZ06 while frozen");

        vm.prank(operator);
        freezeRegistry.release(seller);
        Decision memory released = controlFunction.evaluate(req, "");
        assertTrue(released.allowed, "release restores transferability");
        assertEq(released.reasonCode, Rules.OK, "OK00 once released");
    }

    /// A revoked claim (sanctions hit / KYC withdrawn) denies the hot path and the PDP
    /// surfaces the exact reason stamped at revocation, not a generic deny-by-default.
    function test_revokeClaimSurfacesReason() public {
        ControlRequest memory req = _request(seller, buyer, 100e18);
        assertTrue(controlFunction.evaluate(req, "").allowed, "permits with standing");

        // The seller's standing is revoked with a sanctions reason after publication.
        claimCache.revokeClaim(seller, Rules.DENY_SANCTIONS);
        Decision memory d = controlFunction.evaluate(req, "");
        assertFalse(d.allowed, "revoked claim must deny");
        assertEq(d.reasonCode, Rules.DENY_SANCTIONS, "hot path surfaces the revocation reason");
    }
}
