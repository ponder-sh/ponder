// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import {Script} from "forge-std/Script.sol";
import {Counter} from "../src/Counter.sol";

contract CounterScript is Script {
    function setUp() public {}

    function run() external {
        vm.broadcast();
        Counter counter = new Counter();

        vm.broadcast();
        counter.increment();

        vm.broadcast();
        counter.increment();

        vm.broadcast();
        counter.increment();
    }
}
