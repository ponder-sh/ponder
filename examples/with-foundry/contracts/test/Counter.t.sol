// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import {Test, console2} from "forge-std/Test.sol";
import {Counter, CounterEvents} from "../src/Counter.sol";

contract CounterTest is Test, CounterEvents {
    Counter public counter;

    function setUp() public {
        counter = new Counter();
    }

    function test_Increment() public {
        vm.expectEmit(address(counter));
        emit Incremented(counter.number() + 1);

        counter.increment();
    }
}
