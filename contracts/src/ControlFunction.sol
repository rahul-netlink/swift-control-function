// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {
    IControlFunction,
    ControlRequest,
    Decision,
    Attestation,
    SCOPE_OPERATION_BOUND,
    OUTCOME_ALLOW,
    OUTCOME_DENY,
    OUTCOME_REVIEW
} from "./IControlFunction.sol";
import {Administered} from "./Administered.sol";
import {Rules} from "./Rules.sol";
import {RuleRegistry} from "./RuleRegistry.sol";
import {ClaimCache} from "./ClaimCache.sol";
import {FreezeRegistry} from "./FreezeRegistry.sol";
import {AttestationVerifier} from "./AttestationVerifier.sol";
import {ListRegistry} from "./ListRegistry.sol";
import {VelocityRegistry} from "./VelocityRegistry.sol";

/// @title ControlFunction
/// @notice PDP — Policy Decision Point. One asset-agnostic decision component reached
///         through IControlFunction. It combines rules deny-overrides over four
///         information sources: live on-chain state (FreezeRegistry, VelocityRegistry),
///         cached standing claims (ClaimCache, the hot path), a SWIFT-signed attestation
///         supplied as evidence (AttestationVerifier, the cold path), and the conditional
///         policy held as data (RuleRegistry). The decision is a deterministic function
///         of (request, state), which is why it is byte-identical across adapters.
///
///         The verb is three-valued: ALLOW, DENY, or REVIEW. REVIEW is the
///         enhanced-due-diligence hold — a transfer that policy will not auto-clear and
///         will not refuse, parked until a higher-assurance EDD attestation is presented.
contract ControlFunction is IControlFunction, Administered {
    RuleRegistry public immutable ruleRegistry;
    ClaimCache public immutable claimCache;
    FreezeRegistry public immutable freezeRegistry;
    AttestationVerifier public immutable attestationVerifier;
    ListRegistry public immutable listRegistry;
    VelocityRegistry public immutable velocityRegistry;

    event ControlDecisionLogged(
        bytes32 indexed assetId,
        bytes32 operation,
        bool allowed,
        bytes32 reasonCode,
        bytes32 policyVersion,
        bytes32 evidenceHash
    );

    constructor(
        address admin_,
        RuleRegistry ruleRegistry_,
        ClaimCache claimCache_,
        FreezeRegistry freezeRegistry_,
        AttestationVerifier attestationVerifier_,
        ListRegistry listRegistry_,
        VelocityRegistry velocityRegistry_
    ) Administered(admin_) {
        ruleRegistry = ruleRegistry_;
        claimCache = claimCache_;
        freezeRegistry = freezeRegistry_;
        attestationVerifier = attestationVerifier_;
        listRegistry = listRegistry_;
        velocityRegistry = velocityRegistry_;
    }

    /// @inheritdoc IControlFunction
    function evaluate(ControlRequest calldata req, bytes calldata evidence)
        external
        view
        returns (Decision memory)
    {
        (Decision memory decision,,) = _decide(req, evidence);
        return decision;
    }

    /// @inheritdoc IControlFunction
    function evaluateAndConsume(ControlRequest calldata req, bytes calldata evidence)
        external
        returns (Decision memory decision)
    {
        uint256 nonceToConsume;
        RuleRegistry.Policy memory p;
        (decision, nonceToConsume, p) = _decide(req, evidence);
        if (decision.allowed && nonceToConsume != 0) {
            attestationVerifier.consumeNonce(nonceToConsume);
        }
        if (decision.allowed && _active(p, Rules.VELOCITY)) {
            velocityRegistry.record(req.assetId, req.from, req.amount, p.velocityWindow, uint64(block.timestamp));
        }
        emit ControlDecisionLogged(
            req.assetId, req.operation, decision.allowed, decision.reasonCode, p.version, decision.evidenceHash
        );
    }

    /// @notice Canonical hash an OPERATION_BOUND attestation commits to. The off-chain
    ///         signer reproduces this exactly so subject binding is verifiable on-chain.
    function canonicalRequestHash(ControlRequest calldata req) public pure returns (bytes32) {
        return keccak256(
            abi.encode(req.assetId, req.operation, req.from, req.to, req.amount, keccak256(req.context))
        );
    }


    /// @dev Deterministic decision. Returns the Decision, the OPERATION_BOUND nonce the
    ///      decision relied upon (0 when none) so the stateful caller can burn it, and the
    ///      resolved Policy so the caller can reuse it without a second registry fetch.
    function _decide(ControlRequest calldata req, bytes calldata evidence)
        internal
        view
        returns (Decision memory, uint256 nonceToConsume, RuleRegistry.Policy memory p)
    {
        (bytes32 policyId, bytes32 jurisdiction) = _decodeContext(req.context);
        p = ruleRegistry.policy(policyId);
        uint64 nowTs = uint64(block.timestamp);
        bytes32 evidenceHash = keccak256(evidence);

        if (_active(p, Rules.FREEZE)) {
            if (freezeRegistry.isFrozen(req.from) || freezeRegistry.isFrozen(req.to)) {
                return (_deny(Rules.DENY_FREEZE, evidenceHash), 0, p);
            }
        }

        if (_active(p, Rules.KYC) || _active(p, Rules.SANCTIONS)) {
            (bool fromOk, bytes32 fromReason) = _bindingLive(req.from);
            if (!fromOk) return (_deny(fromReason, evidenceHash), 0, p);
            (bool toOk, bytes32 toReason) = _bindingLive(req.to);
            if (!toOk) return (_deny(toReason, evidenceHash), 0, p);
        }

        uint64 standingUntil = type(uint64).max;
        bool eddProven;
        if (_active(p, Rules.KYC) || _active(p, Rules.SANCTIONS)) {
            (bool ok, bytes32 reason, uint64 validUntil, uint256 nonce, bool edd) =
                _partyStanding(req, evidence, p.version, nowTs);
            if (!ok) return (_deny(reason, evidenceHash), 0, p);
            standingUntil = validUntil;
            nonceToConsume = nonce;
            eddProven = edd;
        }

        bool eddRequired;

        if (_active(p, Rules.JURISDICTION)) {
            RuleRegistry.ConditionRule memory jr = ruleRegistry.jurisdictionRule(policyId, jurisdiction);
            if (!jr.allowed) return (_deny(Rules.DENY_JURISDICTION, evidenceHash), 0, p);
            if (jr.maxAmount != 0 && req.amount > jr.maxAmount) {
                return (_deny(Rules.DENY_JURISDICTION_LIMIT, evidenceHash), 0, p);
            }
            if (jr.requireEdd) eddRequired = true;
        }

        if (_active(p, Rules.COUNTERPARTY) && req.to != address(0)) {
            bytes32 category = claimCache.categoryOf(req.to);
            if (category == bytes32(0)) return (_deny(Rules.DENY_COUNTERPARTY, evidenceHash), 0, p);
            RuleRegistry.ConditionRule memory cr = ruleRegistry.categoryRule(policyId, category);
            if (!cr.allowed) return (_deny(Rules.DENY_COUNTERPARTY, evidenceHash), 0, p);
            if (cr.maxAmount != 0 && req.amount > cr.maxAmount) {
                return (_deny(Rules.DENY_COUNTERPARTY_LIMIT, evidenceHash), 0, p);
            }
            if (cr.requireEdd) eddRequired = true;
        }

        if (_active(p, Rules.LOCKUP)) {
            if (nowTs < p.lockupEnd) return (_deny(Rules.DENY_LOCKUP, evidenceHash), 0, p);
        }

        if (_active(p, Rules.HOLDER_CAP) && req.to != address(0)) {
            if (!freezeRegistry.canAcquire(req.assetId, req.to, p.maxHolders)) {
                return (_deny(Rules.DENY_HOLDER_CAP, evidenceHash), 0, p);
            }
        }

        if (_active(p, Rules.TRANSFER_LIMIT)) {
            uint8 band = ruleRegistry.bandAction(policyId, req.amount);
            if (band == Rules.ACTION_DENY) return (_deny(Rules.DENY_BAND_LIMIT, evidenceHash), 0, p);
            if (band == Rules.ACTION_REVIEW) eddRequired = true;
        }

        if (_active(p, Rules.VELOCITY)) {
            if (
                velocityRegistry.wouldExceed(
                    req.assetId, req.from, req.amount, p.velocityWindow, p.velocityCap, nowTs
                )
            ) {
                return (_deny(Rules.DENY_VELOCITY, evidenceHash), 0, p);
            }
        }

        if (eddRequired && !eddProven) {
            return (_review(evidenceHash), 0, p);
        }

        return (_permit(standingUntil, evidenceHash), nonceToConsume, p);
    }

    /// @dev Resolves KYC + sanctions standing. Evidence (an EIP-712 attestation) takes
    ///      precedence as the cold path; an unusable attestation falls through to the
    ///      cached claims so a stale blob never silently grants access. Returns the
    ///      OPERATION_BOUND nonce to burn when the grant rested on such an attestation,
    ///      and whether that attestation carried an enhanced-due-diligence grant.
    function _partyStanding(
        ControlRequest calldata req,
        bytes calldata evidence,
        bytes32 policyVersion,
        uint64 nowTs
    ) internal view returns (bool ok, bytes32 reason, uint64 validUntil, uint256 nonceToConsume, bool edd) {
        if (evidence.length > 0) {
            (Attestation memory att, bytes memory signature) = abi.decode(evidence, (Attestation, bytes));
            if (
                att.assetId == req.assetId && att.policyVersion == policyVersion
                    && attestationVerifier.isValidNow(att, signature, nowTs)
            ) {
                if (att.allowed && !listRegistry.listFresh(att.listEpoch)) {
                    return (false, Rules.DENY_STALE_LIST, 0, 0, false);
                }
                if (att.allowed && !listRegistry.registryFresh(att.registryEpoch)) {
                    return (false, Rules.DENY_STALE_REGISTRY, 0, 0, false);
                }
                bool usable;
                if (att.scope == SCOPE_OPERATION_BOUND) {
                    if (att.subject == canonicalRequestHash(req) && !attestationVerifier.isNonceUsed(att.nonce)) {
                        usable = true;
                        nonceToConsume = att.nonce;
                    }
                } else {
                    usable = true;
                }
                if (usable) {
                    return att.allowed
                        ? (true, Rules.OK, att.validUntil, nonceToConsume, att.edd)
                        : (false, att.reasonCode, 0, 0, false);
                }
            }
        }

        uint64 fromUntil;
        uint64 toUntil;
        (ok, reason, fromUntil) = _cacheStanding(req.from, nowTs);
        if (!ok) return (false, reason, 0, 0, false);
        (ok, reason, toUntil) = _cacheStanding(req.to, nowTs);
        if (!ok) return (false, reason, 0, 0, false);
        return (true, Rules.OK, fromUntil < toUntil ? fromUntil : toUntil, 0, false);
    }

    /// @dev Binding liveness for one leg. The mint/burn counterparty (address(0)) has no
    ///      binding to check. A revoked binding denies with its stored reason, defaulting
    ///      to BND13 — a sticky identity kill that dominates both the hot and cold paths.
    function _bindingLive(address party) internal view returns (bool ok, bytes32 reason) {
        if (party == address(0)) return (true, Rules.OK);
        (bool revoked,, bytes32 stored) = claimCache.binding(party);
        if (revoked) return (false, stored == bytes32(0) ? Rules.DENY_BINDING_REVOKED : stored);
        return (true, Rules.OK);
    }

    function _cacheStanding(address party, uint64 nowTs)
        internal
        view
        returns (bool ok, bytes32 reason, uint64 validUntil)
    {
        if (party == address(0)) return (true, Rules.OK, type(uint64).max);
        (bool exists, bool revoked, uint64 claimValidUntil, uint64 listEpoch, uint64 registryEpoch, bytes32 claimReason) =
            claimCache.standing(party);
        if (!exists) return (false, Rules.DENY_KYC, 0);
        if (revoked) return (false, claimReason, 0);
        if (claimValidUntil < nowTs) return (false, Rules.DENY_KYC, 0);
        if (!listRegistry.listFresh(listEpoch)) return (false, Rules.DENY_STALE_LIST, 0);
        if (!listRegistry.registryFresh(registryEpoch)) return (false, Rules.DENY_STALE_REGISTRY, 0);
        return (true, Rules.OK, claimValidUntil);
    }

    function _decodeContext(bytes calldata context) internal pure returns (bytes32 policyId, bytes32 jurisdiction) {
        (policyId, jurisdiction) = abi.decode(context, (bytes32, bytes32));
    }

    function _active(RuleRegistry.Policy memory p, uint16 rule) internal pure returns (bool) {
        return p.ruleMask & rule != 0;
    }

    function _permit(uint64 validUntil, bytes32 evidenceHash) internal pure returns (Decision memory) {
        return Decision({
            outcome: OUTCOME_ALLOW,
            allowed: true,
            reasonCode: Rules.OK,
            validUntil: validUntil,
            evidenceHash: evidenceHash
        });
    }

    function _deny(bytes32 reason, bytes32 evidenceHash) internal pure returns (Decision memory) {
        return Decision({
            outcome: OUTCOME_DENY,
            allowed: false,
            reasonCode: reason,
            validUntil: 0,
            evidenceHash: evidenceHash
        });
    }

    function _review(bytes32 evidenceHash) internal pure returns (Decision memory) {
        return Decision({
            outcome: OUTCOME_REVIEW,
            allowed: false,
            reasonCode: Rules.REVIEW_EDD,
            validUntil: 0,
            evidenceHash: evidenceHash
        });
    }
}
