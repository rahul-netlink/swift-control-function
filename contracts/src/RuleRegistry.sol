// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Administered} from "./Administered.sol";
import {Rules} from "./Rules.sol";

/// @title RuleRegistry
/// @notice PAP — Policy Administration Point. Holds policy as data so the PDP logic
///         stays fixed while rules vary by asset class. Rule combination is
///         deny-overrides: the PDP short-circuits on the first failing rule.
///
///         A real settlement policy is not a set of on/off switches. It is conditional:
///         the *outcome* of a transfer depends on its amount, its destination, and the
///         category of the counterparty, and the verb is three-valued (allow / hold for
///         enhanced due diligence / refuse). This registry stores that structure as data:
///
///         - tiered notional bands       : amount → {allow, review, deny}
///         - per-jurisdiction rules       : destination → {allowed, cap, requireEdd}
///         - per-counterparty-category    : recipient class → {allowed, cap, requireEdd}
///         - rolling velocity window      : cumulative per-party cap over a time window
///
///         The PDP composes these deny-overrides; the contract here only stores and
///         resolves them, so the decision component remains asset-agnostic.
contract RuleRegistry is Administered {
    struct Policy {
        bool exists;
        bytes32 version;
        uint64 lockupEnd;
        uint32 maxHolders;
        uint16 ruleMask;
        uint64 velocityWindow;
        uint256 velocityCap;
    }

    /// @dev A notional tier. `threshold` is the inclusive upper bound of the band; the
    ///      catch-all top band uses type(uint256).max. `action` is one of Rules.ACTION_*.
    struct LimitBand {
        uint256 threshold;
        uint8 action;
    }

    /// @dev A conditional rule for a destination jurisdiction or counterparty category.
    ///      `maxAmount` of 0 means "no extra cap"; `requireEdd` forces the REVIEW verb.
    struct ConditionRule {
        bool configured;
        bool allowed;
        uint256 maxAmount;
        bool requireEdd;
    }

    mapping(bytes32 => Policy) internal _policies;
    mapping(bytes32 => LimitBand[]) internal _bands;
    mapping(bytes32 => mapping(bytes32 => ConditionRule)) internal _jurisdiction;
    mapping(bytes32 => mapping(bytes32 => ConditionRule)) internal _category;

    event PolicyUpserted(bytes32 indexed policyId, bytes32 version, uint16 ruleMask);
    event BandsSet(bytes32 indexed policyId, uint256 count);
    event JurisdictionRuleSet(bytes32 indexed policyId, bytes32 jurisdiction, bool allowed, uint256 maxAmount, bool requireEdd);
    event CategoryRuleSet(bytes32 indexed policyId, bytes32 category, bool allowed, uint256 maxAmount, bool requireEdd);

    error UnknownPolicy(bytes32 policyId);
    error BandsMisordered();

    constructor(address admin_) Administered(admin_) {}

    function upsertPolicy(
        bytes32 policyId,
        bytes32 version,
        uint64 lockupEnd,
        uint32 maxHolders,
        uint16 ruleMask,
        uint64 velocityWindow,
        uint256 velocityCap
    ) external onlyAdmin {
        _policies[policyId] = Policy({
            exists: true,
            version: version,
            lockupEnd: lockupEnd,
            maxHolders: maxHolders,
            ruleMask: ruleMask,
            velocityWindow: velocityWindow,
            velocityCap: velocityCap
        });
        emit PolicyUpserted(policyId, version, ruleMask);
    }

    /// @notice Replace the tiered notional bands for a policy. `thresholds` must be
    ///         strictly ascending; pair each with an action (Rules.ACTION_*). The final
    ///         threshold should be type(uint256).max to act as the catch-all band.
    function setBands(bytes32 policyId, uint256[] calldata thresholds, uint8[] calldata actions) external onlyAdmin {
        require(thresholds.length == actions.length, "length mismatch");
        delete _bands[policyId];
        uint256 prev;
        for (uint256 i = 0; i < thresholds.length; i++) {
            if (i > 0 && thresholds[i] <= prev) revert BandsMisordered();
            prev = thresholds[i];
            _bands[policyId].push(LimitBand({threshold: thresholds[i], action: actions[i]}));
        }
        emit BandsSet(policyId, thresholds.length);
    }

    function setJurisdictionRule(bytes32 policyId, bytes32 jurisdiction, bool allowed, uint256 maxAmount, bool requireEdd)
        external
        onlyAdmin
    {
        _jurisdiction[policyId][jurisdiction] =
            ConditionRule({configured: true, allowed: allowed, maxAmount: maxAmount, requireEdd: requireEdd});
        emit JurisdictionRuleSet(policyId, jurisdiction, allowed, maxAmount, requireEdd);
    }

    function setCategoryRule(bytes32 policyId, bytes32 category, bool allowed, uint256 maxAmount, bool requireEdd)
        external
        onlyAdmin
    {
        _category[policyId][category] =
            ConditionRule({configured: true, allowed: allowed, maxAmount: maxAmount, requireEdd: requireEdd});
        emit CategoryRuleSet(policyId, category, allowed, maxAmount, requireEdd);
    }

    function policy(bytes32 policyId) external view returns (Policy memory p) {
        p = _policies[policyId];
        if (!p.exists) revert UnknownPolicy(policyId);
    }

    function jurisdictionRule(bytes32 policyId, bytes32 jurisdiction) external view returns (ConditionRule memory) {
        return _jurisdiction[policyId][jurisdiction];
    }

    function categoryRule(bytes32 policyId, bytes32 category) external view returns (ConditionRule memory) {
        return _category[policyId][category];
    }

    function getBands(bytes32 policyId) external view returns (LimitBand[] memory) {
        return _bands[policyId];
    }

    /// @notice Resolve the tiered-band action for an amount. With no bands configured the
    ///         band rule is a no-op (ALLOW). Otherwise return the action of the lowest band
    ///         whose inclusive threshold covers `amount`; an amount above every band is DENY.
    function bandAction(bytes32 policyId, uint256 amount) external view returns (uint8) {
        LimitBand[] storage bands = _bands[policyId];
        if (bands.length == 0) return Rules.ACTION_ALLOW;
        for (uint256 i = 0; i < bands.length; i++) {
            if (amount <= bands[i].threshold) return bands[i].action;
        }
        return Rules.ACTION_DENY;
    }
}
