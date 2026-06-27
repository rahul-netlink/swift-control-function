// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
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

/// @notice Deploys the full control-function topology and seeds the demo policy.
///         Roles (admin, SWIFT signer, orchestrator, freeze operator) are read from the
///         environment so the off-chain services bind to the same keys. Writes an
///         address book to out/deployments.json for the services and UI.
contract Deploy is Script {
    bytes32 internal constant ASSET_ID = keccak256("BOND-DE-2031");
    bytes32 internal constant POLICY_ID = keccak256("eu-mifid-sec-token-v3");
    bytes32 internal constant POLICY_VERSION = keccak256("eu-mifid-sec-token-v3@1");
    bytes32 internal constant JUR_FR = bytes32(bytes("FR"));
    bytes32 internal constant JUR_DE = bytes32(bytes("DE"));
    bytes32 internal constant JUR_LU = bytes32(bytes("LU"));
    bytes32 internal constant JUR_GB = bytes32(bytes("GB"));

    bytes32 internal constant CAT_BANK = bytes32("BANK");
    bytes32 internal constant CAT_FUND = bytes32("FUND");
    bytes32 internal constant CAT_CORP = bytes32("CORP");

    uint32 internal constant MAX_HOLDERS = 3;
    uint64 internal constant VELOCITY_WINDOW = 1 days;
    uint256 internal constant VELOCITY_CAP = 20_000_000 ether;

    uint16 internal constant FULL_RULESET = Rules.KYC | Rules.SANCTIONS | Rules.JURISDICTION | Rules.LOCKUP
        | Rules.HOLDER_CAP | Rules.FREEZE | Rules.TRANSFER_LIMIT | Rules.VELOCITY | Rules.COUNTERPARTY;

    bytes32 internal constant DEPOSIT_ASSET_ID = keccak256("DEPOSIT-EUR-V1");
    bytes32 internal constant DEPOSIT_POLICY_ID = keccak256("eu-emoney-deposit-v1");
    bytes32 internal constant DEPOSIT_POLICY_VERSION = keccak256("eu-emoney-deposit-v1@1");
    uint64 internal constant DEPOSIT_VELOCITY_WINDOW = 1 days;
    uint256 internal constant DEPOSIT_VELOCITY_CAP = 5_000_000 ether;
    uint16 internal constant DEPOSIT_RULESET = Rules.KYC | Rules.SANCTIONS | Rules.JURISDICTION | Rules.FREEZE
        | Rules.TRANSFER_LIMIT | Rules.VELOCITY;

    bytes32 internal constant EQUITY_ASSET_ID = keccak256("EQUITY-EU-2026");
    bytes32 internal constant EQUITY_POLICY_ID = keccak256("eu-mifid-equity-v1");
    bytes32 internal constant EQUITY_POLICY_VERSION = keccak256("eu-mifid-equity-v1@1");
    uint32 internal constant EQUITY_MAX_HOLDERS = 5;
    uint64 internal constant EQUITY_VELOCITY_WINDOW = 1 days;
    uint256 internal constant EQUITY_VELOCITY_CAP = 30_000_000 ether;
    uint16 internal constant EQUITY_RULESET = FULL_RULESET;

    bytes32 internal constant FUND_ASSET_ID = keccak256("FUND-MMF-EUR-V1");
    bytes32 internal constant FUND_POLICY_ID = keccak256("eu-aifmd-fund-v1");
    bytes32 internal constant FUND_POLICY_VERSION = keccak256("eu-aifmd-fund-v1@1");
    uint32 internal constant FUND_MAX_HOLDERS = 4;
    uint64 internal constant FUND_VELOCITY_WINDOW = 1 days;
    uint256 internal constant FUND_VELOCITY_CAP = 10_000_000 ether;
    uint16 internal constant FUND_RULESET = Rules.KYC | Rules.SANCTIONS | Rules.JURISDICTION | Rules.FREEZE
        | Rules.HOLDER_CAP | Rules.TRANSFER_LIMIT | Rules.VELOCITY | Rules.COUNTERPARTY;

    function run() external {
        uint256 deployerPk = vm.envUint("DEPLOYER_PK");
        address admin = vm.addr(deployerPk);
        address swiftSigner = vm.envAddress("SWIFT_SIGNER");
        address orchestrator = vm.envAddress("ORCHESTRATOR");
        address operator = vm.envAddress("FREEZE_OPERATOR");

        vm.startBroadcast(deployerPk);

        RuleRegistry ruleRegistry = new RuleRegistry(admin);
        ClaimCache claimCache = new ClaimCache(admin);
        FreezeRegistry freezeRegistry = new FreezeRegistry(admin);
        AttestationVerifier verifier = new AttestationVerifier(admin);
        ListRegistry listRegistry = new ListRegistry(admin);
        VelocityRegistry velocityRegistry = new VelocityRegistry(admin);
        ControlFunction controlFunction = new ControlFunction(
            admin, ruleRegistry, claimCache, freezeRegistry, verifier, listRegistry, velocityRegistry
        );

        verifier.setConsumer(address(controlFunction), true);
        verifier.setIssuer(swiftSigner, true);
        claimCache.setPublisher(orchestrator, true);
        freezeRegistry.setOperator(operator, true);
        listRegistry.setOperator(orchestrator, true);
        velocityRegistry.setRecorder(address(controlFunction), true);

        _seedBondPolicy(ruleRegistry);
        _seedDepositPolicy(ruleRegistry);

        DemoERC20 erc20 = new DemoERC20("Tokenised Bond", "BOND");
        ERC20Adapter erc20Adapter = new ERC20Adapter(admin, controlFunction, erc20, ASSET_ID, POLICY_ID);

        PermissionedTokenAdapter permAdapter =
            new PermissionedTokenAdapter(admin, controlFunction, ASSET_ID, POLICY_ID);
        DemoPermissionedToken permToken =
            new DemoPermissionedToken("Tokenised Bond (3643)", "BOND3", ICompliance(address(permAdapter)));

        MockExternalLedgerAdapter externalLedger =
            new MockExternalLedgerAdapter(admin, controlFunction, ASSET_ID, POLICY_ID);

        DemoERC20 depositErc20 = new DemoERC20("Tokenised Deposit", "DEP");
        ERC20Adapter depositAdapter =
            new ERC20Adapter(admin, controlFunction, depositErc20, DEPOSIT_ASSET_ID, DEPOSIT_POLICY_ID);

        _seedEquityPolicy(ruleRegistry);
        _seedFundPolicy(ruleRegistry);

        DemoERC20 equityErc20 = new DemoERC20("Tokenised Equity", "EQTY");
        ERC20Adapter equityAdapter =
            new ERC20Adapter(admin, controlFunction, equityErc20, EQUITY_ASSET_ID, EQUITY_POLICY_ID);

        DemoERC20 fundErc20 = new DemoERC20("Tokenised Fund Unit", "FUND");
        ERC20Adapter fundAdapter =
            new ERC20Adapter(admin, controlFunction, fundErc20, FUND_ASSET_ID, FUND_POLICY_ID);

        vm.stopBroadcast();

        _writeAddressBook(
            AddressBook({
                ruleRegistry: address(ruleRegistry),
                claimCache: address(claimCache),
                freezeRegistry: address(freezeRegistry),
                verifier: address(verifier),
                listRegistry: address(listRegistry),
                velocityRegistry: address(velocityRegistry),
                controlFunction: address(controlFunction),
                erc20: address(erc20),
                erc20Adapter: address(erc20Adapter),
                permToken: address(permToken),
                permAdapter: address(permAdapter),
                externalLedger: address(externalLedger),
                depositErc20: address(depositErc20),
                depositAdapter: address(depositAdapter),
                equityErc20: address(equityErc20),
                equityAdapter: address(equityAdapter),
                fundErc20: address(fundErc20),
                fundAdapter: address(fundAdapter)
            })
        );
    }

    /// @dev Seeds the security-token policy: conditional tiered limits, a jurisdiction
    ///      matrix (home markets open, LU capped, GB third-country always-EDD), a
    ///      counterparty-class matrix, and a rolling velocity window. Policy is data.
    function _seedBondPolicy(RuleRegistry rr) internal {
        rr.upsertPolicy(POLICY_ID, POLICY_VERSION, 0, MAX_HOLDERS, FULL_RULESET, VELOCITY_WINDOW, VELOCITY_CAP);

        uint256[] memory thresholds = new uint256[](3);
        uint8[] memory actions = new uint8[](3);
        thresholds[0] = 1_000_000 ether;
        actions[0] = Rules.ACTION_ALLOW;
        thresholds[1] = 10_000_000 ether;
        actions[1] = Rules.ACTION_REVIEW;
        thresholds[2] = type(uint256).max;
        actions[2] = Rules.ACTION_DENY;
        rr.setBands(POLICY_ID, thresholds, actions);

        rr.setJurisdictionRule(POLICY_ID, JUR_FR, true, 0, false);
        rr.setJurisdictionRule(POLICY_ID, JUR_DE, true, 0, false);
        rr.setJurisdictionRule(POLICY_ID, JUR_LU, true, 5_000_000 ether, false);
        rr.setJurisdictionRule(POLICY_ID, JUR_GB, true, 500_000 ether, true);

        rr.setCategoryRule(POLICY_ID, CAT_BANK, true, 0, false);
        rr.setCategoryRule(POLICY_ID, CAT_FUND, true, 0, false);
        rr.setCategoryRule(POLICY_ID, CAT_CORP, true, 2_000_000 ether, true);
    }

    /// @dev Deposit asset class: same engine, smaller ruleset (no cap/lock-up/counterparty),
    ///      lower bands and a tighter velocity window.
    function _seedDepositPolicy(RuleRegistry rr) internal {
        rr.upsertPolicy(
            DEPOSIT_POLICY_ID, DEPOSIT_POLICY_VERSION, 0, 0, DEPOSIT_RULESET, DEPOSIT_VELOCITY_WINDOW, DEPOSIT_VELOCITY_CAP
        );

        uint256[] memory thresholds = new uint256[](3);
        uint8[] memory actions = new uint8[](3);
        thresholds[0] = 500_000 ether;
        actions[0] = Rules.ACTION_ALLOW;
        thresholds[1] = 2_000_000 ether;
        actions[1] = Rules.ACTION_REVIEW;
        thresholds[2] = type(uint256).max;
        actions[2] = Rules.ACTION_DENY;
        rr.setBands(DEPOSIT_POLICY_ID, thresholds, actions);

        rr.setJurisdictionRule(DEPOSIT_POLICY_ID, JUR_FR, true, 0, false);
        rr.setJurisdictionRule(DEPOSIT_POLICY_ID, JUR_DE, true, 0, false);
    }

    /// @dev Equity asset class: the full security ruleset like the bond, but a wider
    ///      holder register and higher bands — a transfer-restricted share line.
    function _seedEquityPolicy(RuleRegistry rr) internal {
        rr.upsertPolicy(
            EQUITY_POLICY_ID, EQUITY_POLICY_VERSION, 0, EQUITY_MAX_HOLDERS, EQUITY_RULESET, EQUITY_VELOCITY_WINDOW, EQUITY_VELOCITY_CAP
        );

        uint256[] memory thresholds = new uint256[](3);
        uint8[] memory actions = new uint8[](3);
        thresholds[0] = 2_000_000 ether;
        actions[0] = Rules.ACTION_ALLOW;
        thresholds[1] = 20_000_000 ether;
        actions[1] = Rules.ACTION_REVIEW;
        thresholds[2] = type(uint256).max;
        actions[2] = Rules.ACTION_DENY;
        rr.setBands(EQUITY_POLICY_ID, thresholds, actions);

        rr.setJurisdictionRule(EQUITY_POLICY_ID, JUR_FR, true, 0, false);
        rr.setJurisdictionRule(EQUITY_POLICY_ID, JUR_DE, true, 0, false);
        rr.setJurisdictionRule(EQUITY_POLICY_ID, JUR_LU, true, 5_000_000 ether, false);
        rr.setJurisdictionRule(EQUITY_POLICY_ID, JUR_GB, true, 500_000 ether, true);

        rr.setCategoryRule(EQUITY_POLICY_ID, CAT_BANK, true, 0, false);
        rr.setCategoryRule(EQUITY_POLICY_ID, CAT_FUND, true, 0, false);
        rr.setCategoryRule(EQUITY_POLICY_ID, CAT_CORP, true, 2_000_000 ether, true);
    }

    /// @dev Fund asset class: eligible-investor gated (banks and funds only; corporates
    ///      refused), an investor cap, but freely redeemable so no lock-up module.
    function _seedFundPolicy(RuleRegistry rr) internal {
        rr.upsertPolicy(
            FUND_POLICY_ID, FUND_POLICY_VERSION, 0, FUND_MAX_HOLDERS, FUND_RULESET, FUND_VELOCITY_WINDOW, FUND_VELOCITY_CAP
        );

        uint256[] memory thresholds = new uint256[](3);
        uint8[] memory actions = new uint8[](3);
        thresholds[0] = 1_000_000 ether;
        actions[0] = Rules.ACTION_ALLOW;
        thresholds[1] = 5_000_000 ether;
        actions[1] = Rules.ACTION_REVIEW;
        thresholds[2] = type(uint256).max;
        actions[2] = Rules.ACTION_DENY;
        rr.setBands(FUND_POLICY_ID, thresholds, actions);

        rr.setJurisdictionRule(FUND_POLICY_ID, JUR_FR, true, 0, false);
        rr.setJurisdictionRule(FUND_POLICY_ID, JUR_DE, true, 0, false);
        rr.setJurisdictionRule(FUND_POLICY_ID, JUR_LU, true, 2_000_000 ether, false);

        rr.setCategoryRule(FUND_POLICY_ID, CAT_BANK, true, 0, false);
        rr.setCategoryRule(FUND_POLICY_ID, CAT_FUND, true, 0, false);
        rr.setCategoryRule(FUND_POLICY_ID, CAT_CORP, false, 0, false);
    }

    struct AddressBook {
        address ruleRegistry;
        address claimCache;
        address freezeRegistry;
        address verifier;
        address listRegistry;
        address velocityRegistry;
        address controlFunction;
        address erc20;
        address erc20Adapter;
        address permToken;
        address permAdapter;
        address externalLedger;
        address depositErc20;
        address depositAdapter;
        address equityErc20;
        address equityAdapter;
        address fundErc20;
        address fundAdapter;
    }

    function _writeAddressBook(AddressBook memory a) internal {
        string memory key = "deployments";
        vm.serializeAddress(key, "ruleRegistry", a.ruleRegistry);
        vm.serializeAddress(key, "claimCache", a.claimCache);
        vm.serializeAddress(key, "freezeRegistry", a.freezeRegistry);
        vm.serializeAddress(key, "attestationVerifier", a.verifier);
        vm.serializeAddress(key, "listRegistry", a.listRegistry);
        vm.serializeAddress(key, "velocityRegistry", a.velocityRegistry);
        vm.serializeAddress(key, "controlFunction", a.controlFunction);
        vm.serializeAddress(key, "erc20", a.erc20);
        vm.serializeAddress(key, "erc20Adapter", a.erc20Adapter);
        vm.serializeAddress(key, "permissionedToken", a.permToken);
        vm.serializeAddress(key, "permissionedTokenAdapter", a.permAdapter);
        vm.serializeBytes32(key, "assetId", ASSET_ID);
        vm.serializeBytes32(key, "policyId", POLICY_ID);
        vm.serializeBytes32(key, "policyVersion", POLICY_VERSION);
        vm.serializeAddress(key, "externalLedgerAdapter", a.externalLedger);
        vm.serializeAddress(key, "depositErc20", a.depositErc20);
        vm.serializeAddress(key, "depositAdapter", a.depositAdapter);
        vm.serializeBytes32(key, "depositAssetId", DEPOSIT_ASSET_ID);
        vm.serializeBytes32(key, "depositPolicyId", DEPOSIT_POLICY_ID);
        vm.serializeBytes32(key, "depositPolicyVersion", DEPOSIT_POLICY_VERSION);
        vm.serializeAddress(key, "equityErc20", a.equityErc20);
        vm.serializeAddress(key, "equityAdapter", a.equityAdapter);
        vm.serializeBytes32(key, "equityAssetId", EQUITY_ASSET_ID);
        vm.serializeBytes32(key, "equityPolicyId", EQUITY_POLICY_ID);
        vm.serializeBytes32(key, "equityPolicyVersion", EQUITY_POLICY_VERSION);
        vm.serializeAddress(key, "fundErc20", a.fundErc20);
        vm.serializeAddress(key, "fundAdapter", a.fundAdapter);
        vm.serializeBytes32(key, "fundAssetId", FUND_ASSET_ID);
        vm.serializeBytes32(key, "fundPolicyId", FUND_POLICY_ID);
        string memory json = vm.serializeBytes32(key, "fundPolicyVersion", FUND_POLICY_VERSION);

        vm.writeJson(json, "../fixtures/deployments.json");
        console2.log("Address book written to fixtures/deployments.json");
    }
}
