// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Administered} from "./Administered.sol";

/// @title ClaimCache
/// @notice PIP — Policy Information Point for reusable PARTY_STANDING claims.
///         The orchestrator publishes a claim once a wallet->BIC binding is backed
///         by valid KYC and a clear screen. Reading a cached claim is the hot path:
///         it replaces a cold ECDSA verification with a couple of storage reads.
///
///         Storage is the recurring on-chain cost: one claim is written per counterparty
///         and re-read on every settled transfer. Like a boarding-pass barcode, a claim
///         stores dense codes, not prose. The bulky fields — the controlling institution
///         (`bic`), its KYC record reference (`registryRef`) and counterparty `category` —
///         are not per-wallet; they repeat across every wallet an institution controls.
///         They are therefore *interned* once into an institution profile addressed by a
///         small `uint32` id (the "airline code"), and each claim stores just that id plus
///         its own per-wallet data. A claim is one 32-byte slot; the shared profile is
///         written once and amortised across all its wallets. {getClaim} is the decoder:
///         it reconstructs the full public `Claim` losslessly, so the off-chain ABI is
///         unchanged. Nothing readable is lost — only the redundancy.
contract ClaimCache is Administered {
    /// @notice Public claim shape returned by {getClaim}. Full-width fields for ABI
    ///         stability; on-chain the data lives in a packed claim slot plus a shared
    ///         institution profile.
    struct Claim {
        bool exists;
        bool revoked;
        bytes11 bic;
        bytes32 registryRef;
        uint64 validUntil;
        uint64 listEpoch;
        uint64 registryEpoch;
        bytes32 revocationReason;
        bytes32 category;
    }

    /// @dev The interned, shared part of a claim — written once per distinct institution
    ///      profile and pointed at by every claim that carries it. `bic` and `category`
    ///      co-pack; `registryRef` is a full keccak reference.
    struct Profile {
        bytes11 bic;
        bytes16 category;
        bytes32 registryRef;
    }

    /// @dev The per-wallet part of a claim — one 32-byte slot. `profileId` references the
    ///      shared profile; everything else is genuinely per-wallet.
    struct _Stored {
        bool exists;
        bool revoked;
        uint32 profileId;
        uint64 validUntil;
        uint32 listEpoch;
        uint32 registryEpoch;
        bytes8 revocationReason;
    }

    /// @dev Lifecycle of the wallet->BIC binding itself — the one new primitive — kept
    ///      separate from the screened standing it backs. A claim (the standing) is a
    ///      transient screening result that a re-screen refreshes; the binding is the
    ///      institution's signed assertion that it controls the wallet, and its
    ///      revocation must be STICKY: a background re-screen must not be able to
    ///      resurrect a wallet whose controlling institution was offboarded, whose
    ///      3SKey/PKI credential was revoked, or which lost key control. Only a governed
    ///      {rebind} — a freshly signed binding at a higher epoch — clears it.
    struct Binding {
        bool revoked;
        uint32 epoch;
        bytes8 reason;
    }

    mapping(address => _Stored) internal _claims;
    mapping(address => Binding) internal _bindings;
    mapping(uint32 => Profile) internal _profiles;
    mapping(bytes32 => uint32) internal _profileId;
    uint32 internal _profileCount;
    mapping(address => bool) public isPublisher;

    event ClaimPublished(address indexed wallet, bytes11 bic, uint64 validUntil, uint64 listEpoch, uint64 registryEpoch);
    event ClaimRevoked(address indexed wallet, bytes32 reason);
    event BindingPublished(address indexed wallet, uint64 bindingEpoch);
    event BindingRevoked(address indexed wallet, bytes32 reason);
    event PublisherSet(address indexed publisher, bool allowed);

    error NotPublisher();
    error EpochOverflow();
    error LabelTooLong();
    error BindingNotAdvanced();

    constructor(address admin_) Administered(admin_) {}

    modifier onlyPublisher() {
        if (!isPublisher[msg.sender]) revert NotPublisher();
        _;
    }

    /// @notice Authorise an orchestrator to publish and revoke claims (PAP action).
    function setPublisher(address publisher, bool allowed) external onlyAdmin {
        isPublisher[publisher] = allowed;
        emit PublisherSet(publisher, allowed);
    }

    function publishClaim(
        address wallet,
        bytes11 bic,
        bytes32 registryRef,
        uint64 validUntil,
        uint64 listEpoch,
        uint64 registryEpoch,
        bytes32 category
    ) external onlyPublisher {
        if (listEpoch > type(uint32).max || registryEpoch > type(uint32).max) revert EpochOverflow();
        _claims[wallet] = _Stored({
            exists: true,
            revoked: false,
            profileId: _intern(bic, registryRef, category),
            validUntil: validUntil,
            listEpoch: uint32(listEpoch),
            registryEpoch: uint32(registryEpoch),
            revocationReason: bytes8(0)
        });
        Binding storage b = _bindings[wallet];
        if (b.epoch == 0) {
            b.epoch = 1;
            emit BindingPublished(wallet, 1);
        }
        emit ClaimPublished(wallet, bic, validUntil, listEpoch, registryEpoch);
    }

    /// @notice Revoke a cached claim. Drives the sanctions / KYC-withdrawn story:
    ///         revocation latency collapses to "next notification". This revokes the
    ///         transient screening standing; a re-screen at a fresh epoch can re-publish.
    ///         For a sticky identity kill that survives re-screening, use {revokeBinding}.
    function revokeClaim(address wallet, bytes32 reason) external onlyPublisher {
        if (bytes32(bytes8(reason)) != reason) revert LabelTooLong();
        _Stored storage c = _claims[wallet];
        c.revoked = true;
        c.revocationReason = bytes8(reason);
        emit ClaimRevoked(wallet, reason);
    }

    /// @notice Revoke the wallet->BIC binding itself (the one new primitive). Unlike a
    ///         claim revocation this is STICKY: it survives a re-screen, because the
    ///         binding — not the screening result — is what failed (institution
    ///         offboarded, 3SKey/PKI credential revoked, wallet control lost). The PDP
    ///         denies BND13 for any leg whose binding is revoked, on hot and cold paths
    ///         alike. Cleared only by {rebind}.
    function revokeBinding(address wallet, bytes32 reason) external onlyPublisher {
        if (bytes32(bytes8(reason)) != reason) revert LabelTooLong();
        Binding storage b = _bindings[wallet];
        if (b.epoch == 0) b.epoch = 1;
        b.revoked = true;
        b.reason = bytes8(reason);
        emit BindingRevoked(wallet, reason);
    }

    /// @notice Restore (or rotate) a binding with a freshly signed assertion. A governed
    ///         action: the controlling institution re-signs a WalletBinding at a strictly
    ///         higher binding epoch, which clears any revocation. A re-screen cannot do
    ///         this; only a new institution-signed binding can.
    function rebind(address wallet, uint64 newBindingEpoch) external onlyPublisher {
        if (newBindingEpoch > type(uint32).max) revert EpochOverflow();
        Binding storage b = _bindings[wallet];
        if (newBindingEpoch <= b.epoch) revert BindingNotAdvanced();
        b.epoch = uint32(newBindingEpoch);
        b.revoked = false;
        b.reason = bytes8(0);
        emit BindingPublished(wallet, newBindingEpoch);
    }

    /// @notice Binding lifecycle for a wallet: whether it is revoked, its monotonic
    ///         binding epoch, and the revocation reason (zero when live). The PDP reads
    ///         this before standing so a fresh screen cannot mask a dead binding.
    function binding(address wallet) external view returns (bool revoked, uint64 bindingEpoch, bytes32 reason) {
        Binding storage b = _bindings[wallet];
        return (b.revoked, uint64(b.epoch), bytes32(b.reason));
    }

    /// @notice Full decoder: reconstruct the public `Claim` from the packed claim slot and
    ///         its shared profile. Lossless — callers see exactly what was published.
    function getClaim(address wallet) external view returns (Claim memory) {
        _Stored storage c = _claims[wallet];
        Profile storage pr = _profiles[c.profileId];
        return Claim({
            exists: c.exists,
            revoked: c.revoked,
            bic: pr.bic,
            registryRef: pr.registryRef,
            validUntil: c.validUntil,
            listEpoch: uint64(c.listEpoch),
            registryEpoch: uint64(c.registryEpoch),
            revocationReason: bytes32(c.revocationReason),
            category: bytes32(pr.category)
        });
    }

    /// @notice Hot-path standing fields — reads only the single packed claim slot, no
    ///         profile lookup. The PDP uses this for the KYC/sanctions standing check.
    function standing(address wallet)
        external
        view
        returns (bool exists, bool revoked, uint64 validUntil, uint64 listEpoch, uint64 registryEpoch, bytes32 revocationReason)
    {
        _Stored storage c = _claims[wallet];
        return (
            c.exists,
            c.revoked,
            c.validUntil,
            uint64(c.listEpoch),
            uint64(c.registryEpoch),
            bytes32(c.revocationReason)
        );
    }

    /// @notice The counterparty category code for a wallet (claim slot + profile), widened
    ///         to bytes32 to match the RuleRegistry category keys.
    function categoryOf(address wallet) external view returns (bytes32) {
        return bytes32(_profiles[_claims[wallet].profileId].category);
    }

    /// @notice Hot-path predicate: a usable standing claim exists and is in-window.
    function isStanding(address wallet, uint64 nowTs) external view returns (bool) {
        _Stored storage c = _claims[wallet];
        return c.exists && !c.revoked && c.validUntil >= nowTs;
    }

    /// @dev Intern an institution profile, returning a stable small id. Identical triples
    ///      collapse to one stored profile shared by every wallet that carries it.
    function _intern(bytes11 bic, bytes32 registryRef, bytes32 category) internal returns (uint32 id) {
        if (bytes32(bytes16(category)) != category) revert LabelTooLong();
        bytes32 key = keccak256(abi.encode(bic, category, registryRef));
        id = _profileId[key];
        if (id == 0) {
            id = ++_profileCount;
            _profileId[key] = id;
            _profiles[id] = Profile({bic: bic, category: bytes16(category), registryRef: registryRef});
        }
    }
}
