// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Rules} from "../src/Rules.sol";
import {RuleRegistry} from "../src/RuleRegistry.sol";
import {ClaimCache} from "../src/ClaimCache.sol";
import {FreezeRegistry} from "../src/FreezeRegistry.sol";
import {AttestationVerifier} from "../src/AttestationVerifier.sol";
import {ListRegistry} from "../src/ListRegistry.sol";
import {VelocityRegistry} from "../src/VelocityRegistry.sol";
import {ControlFunction} from "../src/ControlFunction.sol";
import {ERC20Adapter} from "../src/adapters/ERC20Adapter.sol";
import {PermissionedTokenAdapter} from "../src/adapters/PermissionedTokenAdapter.sol";
import {MockExternalLedgerAdapter} from "../src/adapters/MockExternalLedgerAdapter.sol";
import {DemoERC20} from "../src/mocks/DemoERC20.sol";
import {DemoPermissionedToken, ICompliance} from "../src/mocks/DemoPermissionedToken.sol";
import {
    ControlRequest,
    Decision,
    Attestation,
    SCOPE_PARTY_STANDING,
    SCOPE_OPERATION_BOUND
} from "../src/IControlFunction.sol";

/// @dev Shared deployment and helpers. Mirrors the on-chain topology the Deploy script
///      and the off-chain services wire up, so tests exercise the production graph.
abstract contract Base is Test {
    bytes32 internal constant ASSET_ID = keccak256("BOND-DE-2031");
    bytes32 internal constant POLICY_ID = keccak256("eu-mifid-sec-token-v3");
    bytes32 internal constant POLICY_VERSION = keccak256("eu-mifid-sec-token-v3@1");
    bytes32 internal constant JUR_FR = bytes32(bytes("FR"));

    uint16 internal constant FULL_RULESET =
        Rules.KYC | Rules.SANCTIONS | Rules.JURISDICTION | Rules.LOCKUP | Rules.HOLDER_CAP | Rules.FREEZE;

    bytes32 internal constant CAT_BANK = bytes32("BANK");

    RuleRegistry internal ruleRegistry;
    ClaimCache internal claimCache;
    FreezeRegistry internal freezeRegistry;
    AttestationVerifier internal verifier;
    ListRegistry internal listRegistry;
    VelocityRegistry internal velocityRegistry;
    ControlFunction internal controlFunction;

    ERC20Adapter internal erc20Adapter;
    PermissionedTokenAdapter internal permAdapter;
    MockExternalLedgerAdapter internal ledgerAdapter;
    DemoERC20 internal erc20;
    DemoPermissionedToken internal permToken;

    uint256 internal signerPk = 0xA11CE;
    address internal swiftSigner;
    address internal operator;
    address internal buyer;
    address internal seller;
    address internal unknown;

    bytes11 internal constant BIC_BUYER = bytes11("BNPAFRPP");
    bytes11 internal constant BIC_SELLER = bytes11("SOGEFRPP");

    function _deployStack() internal {
        swiftSigner = vm.addr(signerPk);
        operator = makeAddr("operator");
        buyer = makeAddr("buyer");
        seller = makeAddr("seller");
        unknown = makeAddr("unknown");

        ruleRegistry = new RuleRegistry(address(this));
        claimCache = new ClaimCache(address(this));
        freezeRegistry = new FreezeRegistry(address(this));
        verifier = new AttestationVerifier(address(this));
        listRegistry = new ListRegistry(address(this));
        velocityRegistry = new VelocityRegistry(address(this));
        controlFunction = new ControlFunction(
            address(this), ruleRegistry, claimCache, freezeRegistry, verifier, listRegistry, velocityRegistry
        );

        verifier.setConsumer(address(controlFunction), true);
        verifier.setIssuer(swiftSigner, true);
        claimCache.setPublisher(address(this), true);
        freezeRegistry.setOperator(operator, true);
        listRegistry.setOperator(operator, true);
        velocityRegistry.setRecorder(address(controlFunction), true);

        ruleRegistry.upsertPolicy(POLICY_ID, POLICY_VERSION, 0, 100, FULL_RULESET, 0, 0);
        ruleRegistry.setJurisdictionRule(POLICY_ID, JUR_FR, true, 0, false);

        erc20 = new DemoERC20("Tokenised Bond", "BOND");
        erc20Adapter = new ERC20Adapter(address(this), controlFunction, erc20, ASSET_ID, POLICY_ID);

        permAdapter = new PermissionedTokenAdapter(address(this), controlFunction, ASSET_ID, POLICY_ID);
        permToken = new DemoPermissionedToken("Tokenised Bond (3643)", "BOND3", ICompliance(address(permAdapter)));

        ledgerAdapter = new MockExternalLedgerAdapter(address(this), controlFunction, ASSET_ID, POLICY_ID);

        _setJurisdiction(buyer, JUR_FR);
        _setJurisdiction(seller, JUR_FR);
    }

    function _setJurisdiction(address account, bytes32 jur) internal {
        erc20Adapter.setJurisdiction(account, jur);
        permAdapter.setJurisdiction(account, jur);
        ledgerAdapter.setJurisdiction(account, jur);
    }

    function _publishStanding(address wallet, bytes11 bic) internal {
        _publishStanding(wallet, bic, CAT_BANK);
    }

    function _publishStanding(address wallet, bytes11 bic, bytes32 category) internal {
        claimCache.publishClaim(
            wallet,
            bic,
            keccak256(abi.encode(bic)),
            uint64(block.timestamp + 365 days),
            listRegistry.listEpoch(),
            listRegistry.registryEpoch(),
            category
        );
    }

    function _request(address from, address to, uint256 amount) internal pure returns (ControlRequest memory) {
        return ControlRequest({
            assetId: ASSET_ID,
            operation: keccak256("TRANSFER"),
            from: from,
            to: to,
            amount: amount,
            context: abi.encode(POLICY_ID, JUR_FR)
        });
    }

    function _sign(Attestation memory att) internal view returns (bytes memory) {
        bytes32 digest = verifier.hashAttestation(att);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPk, digest);
        return abi.encodePacked(r, s, v);
    }

    /// @dev Build a cold-path evidence blob: a SWIFT-signed OPERATION_BOUND attestation
    ///      bound to the canonical request, plus its signature.
    function _opBoundEvidence(ControlRequest memory req, bool allowed, bytes32 reason, uint256 nonce)
        internal
        view
        returns (bytes memory)
    {
        return _opBoundEvidence(req, allowed, reason, nonce, false);
    }

    /// @dev As above, with control over the enhanced-due-diligence grant flag. An EDD
    ///      attestation (edd = true) is what the higher SWIFT quorum signs to clear a
    ///      transfer that policy would otherwise hold for review.
    function _opBoundEvidence(ControlRequest memory req, bool allowed, bytes32 reason, uint256 nonce, bool edd)
        internal
        view
        returns (bytes memory)
    {
        Attestation memory att = Attestation({
            assetId: req.assetId,
            policyVersion: POLICY_VERSION,
            scope: SCOPE_OPERATION_BOUND,
            subject: controlFunction.canonicalRequestHash(req),
            allowed: allowed,
            reasonCode: reason,
            notBefore: uint64(block.timestamp - 1),
            validUntil: uint64(block.timestamp + 1 hours),
            listEpoch: listRegistry.listEpoch(),
            registryEpoch: listRegistry.registryEpoch(),
            edd: edd,
            nonce: nonce
        });
        return abi.encode(att, _sign(att));
    }

    function _decisionHash(Decision memory d) internal pure returns (bytes32) {
        return keccak256(abi.encode(d.outcome, d.allowed, d.reasonCode, d.validUntil, d.evidenceHash));
    }
}
