// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {console2} from "forge-std/console2.sol";
import {Base} from "./Base.t.sol";
import {ControlRequest, Decision} from "../src/IControlFunction.sol";
import {Rules} from "../src/Rules.sol";

/// @title GasReport — decision-isolated hot vs cold path gas.
/// @notice Measures only the decision call, not surrounding test scaffolding. The cold
///         path verifies a SWIFT ECDSA signature and burns a one-shot nonce; the hot
///         path reads a cached standing claim. Run via `pnpm gas`.
contract GasReport is Base {
    function setUp() public {
        _deployStack();
    }

    function test_gasReport() public {
        ControlRequest memory req = _request(seller, buyer, 100e18);

        bytes memory evidence = _opBoundEvidence(req, true, Rules.OK, 1);
        uint256 g0 = gasleft();
        Decision memory cold = controlFunction.evaluateAndConsume(req, evidence);
        uint256 coldGas = g0 - gasleft();
        assertTrue(cold.allowed);

        _publishStanding(seller, BIC_SELLER);
        _publishStanding(buyer, BIC_BUYER);

        uint256 g1 = gasleft();
        Decision memory hot = controlFunction.evaluateAndConsume(req, "");
        uint256 hotGas = g1 - gasleft();
        assertTrue(hot.allowed);

        console2.log("+-----------------------------------------------+");
        console2.log("| DECISION-ISOLATED GAS                         |");
        console2.log("+-----------------------------------------------+");
        console2.log("| HOT  (cached standing claim)     : %s", hotGas);
        console2.log("| COLD (ECDSA verify + nonce burn) : %s", coldGas);
        console2.log("+-----------------------------------------------+");
        assertLt(hotGas, coldGas, "hot path must be cheaper than cold");
    }
}
