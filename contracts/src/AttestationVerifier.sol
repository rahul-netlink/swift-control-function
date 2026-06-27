// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Administered} from "./Administered.sol";
import {Attestation} from "./IControlFunction.sol";

/// @title AttestationVerifier
/// @notice On-chain trust anchor for the off-chain SWIFT signer. The signer is an
///         M-of-N threshold quorum that emits a single group EIP-712 signature; the
///         contract verifies it with one ecrecover, so the threshold is invisible
///         here. Manages the trusted-issuer set (the SWIFT signer key) and one-shot
///         nonces for OPERATION_BOUND attestations.
contract AttestationVerifier is Administered {
    bytes32 private constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    bytes32 private constant ATTESTATION_TYPEHASH = keccak256(
        "Attestation(bytes32 assetId,bytes32 policyVersion,uint8 scope,bytes32 subject,bool allowed,bytes32 reasonCode,uint64 notBefore,uint64 validUntil,uint64 listEpoch,uint64 registryEpoch,bool edd,uint256 nonce)"
    );

    bytes32 public immutable domainSeparator;

    mapping(address => bool) public isTrustedIssuer;
    mapping(address => bool) public isConsumer;
    mapping(uint256 => bool) public isNonceUsed;

    event IssuerSet(address indexed issuer, bool trusted);
    event ConsumerSet(address indexed consumer, bool allowed);
    event NonceConsumed(uint256 indexed nonce, address indexed consumer);

    error NotConsumer();
    error NonceAlreadyUsed(uint256 nonce);

    constructor(address admin_) Administered(admin_) {
        domainSeparator = keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH,
                keccak256("SwiftControlFunction"),
                keccak256("1"),
                block.chainid,
                address(this)
            )
        );
    }

    function setIssuer(address issuer, bool trusted) external onlyAdmin {
        isTrustedIssuer[issuer] = trusted;
        emit IssuerSet(issuer, trusted);
    }

    function setConsumer(address consumer, bool allowed) external onlyAdmin {
        isConsumer[consumer] = allowed;
        emit ConsumerSet(consumer, allowed);
    }

    /// @notice EIP-712 digest the SWIFT signer commits to. Exposed for off-chain
    ///         parity checks and tests.
    function hashAttestation(Attestation calldata att) public view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                ATTESTATION_TYPEHASH,
                att.assetId,
                att.policyVersion,
                att.scope,
                att.subject,
                att.allowed,
                att.reasonCode,
                att.notBefore,
                att.validUntil,
                att.listEpoch,
                att.registryEpoch,
                att.edd,
                att.nonce
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
    }

    /// @notice Recover the signer of an attestation. Returns address(0) on a
    ///         malformed signature rather than reverting, so the PDP can treat an
    ///         unusable attestation as "no evidence" and deny by default.
    function recoverSigner(Attestation calldata att, bytes calldata signature) internal view returns (address) {
        if (signature.length != 65) return address(0);
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        if (v < 27) v += 27;
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) {
            return address(0);
        }
        return ecrecover(hashAttestation(att), v, r, s);
    }

    /// @notice True when the attestation is signed by a trusted issuer and the
    ///         current time is within its validity window.
    function isValidNow(Attestation calldata att, bytes calldata signature, uint64 nowTs)
        external
        view
        returns (bool)
    {
        address signer = recoverSigner(att, signature);
        if (signer == address(0) || !isTrustedIssuer[signer]) return false;
        return nowTs >= att.notBefore && nowTs <= att.validUntil;
    }

    /// @notice Burn an OPERATION_BOUND nonce. Restricted to authorised PDP instances.
    function consumeNonce(uint256 nonce) external {
        if (!isConsumer[msg.sender]) revert NotConsumer();
        if (isNonceUsed[nonce]) revert NonceAlreadyUsed(nonce);
        isNonceUsed[nonce] = true;
        emit NonceConsumed(nonce, msg.sender);
    }
}
