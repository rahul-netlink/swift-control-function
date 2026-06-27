// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {console2} from "forge-std/console2.sol";
import {Base} from "./Base.t.sol";
import {Rules} from "../src/Rules.sol";
import {ControlRequest, Decision, OUTCOME_ALLOW, OUTCOME_DENY, OUTCOME_REVIEW} from "../src/IControlFunction.sol";

/// @title AdvancedPolicy — conditional, three-valued policy enforced on-chain.
/// @notice These pin the advanced engine: tiered notional bands (allow/review/deny), the
///         EDD review hold cleared by an enhanced attestation, per-jurisdiction and
///         per-counterparty-category conditions, and a rolling velocity window. The verb
///         is three-valued and remains byte-identical across token types.
contract AdvancedPolicyTest is Base {
    bytes32 internal constant JUR_GB = bytes32(bytes("GB"));
    bytes32 internal constant CAT_FUND = bytes32("FUND");
    bytes32 internal constant CAT_CORP = bytes32("CORP");
    bytes32 internal constant CAT_OTHER = bytes32("OTHER");

    uint16 internal constant ADV_MASK = Rules.KYC | Rules.SANCTIONS | Rules.JURISDICTION | Rules.FREEZE
        | Rules.TRANSFER_LIMIT | Rules.VELOCITY | Rules.COUNTERPARTY;

    function setUp() public {
        _deployStack();
        ruleRegistry.upsertPolicy(POLICY_ID, POLICY_VERSION, 0, 0, ADV_MASK, 1 days, 100_000_000 ether);
        _setBands(1_000_000 ether, 10_000_000 ether);

        ruleRegistry.setJurisdictionRule(POLICY_ID, JUR_FR, true, 0, false);
        ruleRegistry.setJurisdictionRule(POLICY_ID, JUR_GB, true, 500_000 ether, true);

        ruleRegistry.setCategoryRule(POLICY_ID, CAT_BANK, true, 0, false);
        ruleRegistry.setCategoryRule(POLICY_ID, CAT_FUND, true, 0, false);
        ruleRegistry.setCategoryRule(POLICY_ID, CAT_CORP, true, 2_000_000 ether, true);

        _publishStanding(buyer, BIC_BUYER, CAT_BANK);
        _publishStanding(seller, BIC_SELLER, CAT_BANK);
    }

    function _setBands(uint256 allowUpTo, uint256 reviewUpTo) internal {
        uint256[] memory t = new uint256[](3);
        uint8[] memory a = new uint8[](3);
        t[0] = allowUpTo;
        a[0] = Rules.ACTION_ALLOW;
        t[1] = reviewUpTo;
        a[1] = Rules.ACTION_REVIEW;
        t[2] = type(uint256).max;
        a[2] = Rules.ACTION_DENY;
        ruleRegistry.setBands(POLICY_ID, t, a);
    }

    function _reqJur(address from, address to, uint256 amount, bytes32 jur)
        internal
        pure
        returns (ControlRequest memory)
    {
        return ControlRequest({
            assetId: ASSET_ID,
            operation: keccak256("TRANSFER"),
            from: from,
            to: to,
            amount: amount,
            context: abi.encode(POLICY_ID, jur)
        });
    }

    /// Tiered bands: an amount maps to allow / review / deny purely by its size.
    function test_tieredBands() public {
        Decision memory small = controlFunction.evaluate(_request(seller, buyer, 500_000 ether), "");
        assertEq(small.outcome, OUTCOME_ALLOW, "<=1m auto-clears");

        Decision memory mid = controlFunction.evaluate(_request(seller, buyer, 5_000_000 ether), "");
        assertEq(mid.outcome, OUTCOME_REVIEW, "1m-10m holds for EDD");
        assertEq(mid.reasonCode, Rules.REVIEW_EDD);
        assertFalse(mid.allowed, "a review never moves value");

        Decision memory big = controlFunction.evaluate(_request(seller, buyer, 11_000_000 ether), "");
        assertEq(big.outcome, OUTCOME_DENY, ">10m refused");
        assertEq(big.reasonCode, Rules.DENY_BAND_LIMIT);
    }

    /// The EDD hold is cleared only by an attestation carrying the enhanced grant; an
    /// ordinary (edd = false) attestation leaves the transfer in review.
    function test_eddAttestationClearsReview() public {
        ControlRequest memory req = _request(seller, buyer, 5_000_000 ether);
        assertEq(controlFunction.evaluate(req, "").outcome, OUTCOME_REVIEW, "hot path holds for EDD");

        bytes memory ordinary = _opBoundEvidence(req, true, Rules.OK, 101, false);
        assertEq(controlFunction.evaluate(req, ordinary).outcome, OUTCOME_REVIEW, "ordinary attestation does not clear EDD");

        bytes memory enhanced = _opBoundEvidence(req, true, Rules.OK, 102, true);
        Decision memory cleared = controlFunction.evaluate(req, enhanced);
        assertEq(cleared.outcome, OUTCOME_ALLOW, "enhanced EDD attestation clears the hold");
        assertTrue(cleared.allowed);
    }

    /// Per-jurisdiction conditions: GB is allowed but capped and always-EDD.
    function test_jurisdictionConditions() public {
        Decision memory held = controlFunction.evaluate(_reqJur(seller, buyer, 400_000 ether, JUR_GB), "");
        assertEq(held.outcome, OUTCOME_REVIEW, "GB forces enhanced due diligence");

        Decision memory denied = controlFunction.evaluate(_reqJur(seller, buyer, 600_000 ether, JUR_GB), "");
        assertEq(denied.outcome, OUTCOME_DENY);
        assertEq(denied.reasonCode, Rules.DENY_JURISDICTION_LIMIT, "GB cap breach refused");

        Decision memory blocked = controlFunction.evaluate(_reqJur(seller, buyer, 100_000 ether, bytes32(bytes("RU"))), "");
        assertEq(blocked.reasonCode, Rules.DENY_JURISDICTION);
    }

    /// Per-counterparty-category conditions, read from the recipient's claim.
    function test_counterpartyCategory() public {
        _publishStanding(unknown, bytes11("ACMECORP"), CAT_CORP);
        _setJurisdiction(unknown, JUR_FR);
        Decision memory corpSmall = controlFunction.evaluate(_request(seller, unknown, 500_000 ether), "");
        assertEq(corpSmall.outcome, OUTCOME_REVIEW, "corporate counterparty forces EDD");

        Decision memory corpBig = controlFunction.evaluate(_request(seller, unknown, 3_000_000 ether), "");
        assertEq(corpBig.reasonCode, Rules.DENY_COUNTERPARTY_LIMIT, "corporate cap breach refused");

        _publishStanding(unknown, bytes11("MYSTERY0"), CAT_OTHER);
        Decision memory other = controlFunction.evaluate(_request(seller, unknown, 100_000 ether), "");
        assertEq(other.reasonCode, Rules.DENY_COUNTERPARTY, "unlisted category fails closed");
    }

    /// Rolling velocity window: cumulative per-party cap, not just per-operation.
    function test_velocityWindow() public {
        ruleRegistry.upsertPolicy(POLICY_ID, POLICY_VERSION, 0, 0, ADV_MASK, 1 days, 800_000 ether);

        ControlRequest memory r = _request(seller, buyer, 500_000 ether);
        Decision memory first = controlFunction.evaluateAndConsume(r, "");
        assertEq(first.outcome, OUTCOME_ALLOW, "first within window");

        Decision memory second = controlFunction.evaluate(r, "");
        assertEq(second.outcome, OUTCOME_DENY, "cumulative breach");
        assertEq(second.reasonCode, Rules.DENY_VELOCITY);

        vm.warp(block.timestamp + 1 days + 1);
        assertEq(controlFunction.evaluate(r, "").outcome, OUTCOME_ALLOW, "window reset restores headroom");
    }

    /// The three-valued decision is byte-identical across token types — a REVIEW on the
    /// ERC-20 adapter is the same REVIEW on the ERC-3643 adapter.
    function test_reviewConformance() public {
        ControlRequest memory req = _request(seller, buyer, 5_000_000 ether);
        Decision memory viaErc20 = erc20Adapter.screen(req, "");
        Decision memory viaPerm = permAdapter.screen(req, "");
        assertEq(viaErc20.outcome, OUTCOME_REVIEW);
        assertEq(_decisionHash(viaErc20), _decisionHash(viaPerm), "REVIEW must be identical across adapters");
        console2.log("THREE-VALUED CONFORMANCE: REVIEW identical across ERC-20 and ERC-3643");
    }
}
