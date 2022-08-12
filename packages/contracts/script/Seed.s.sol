// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.13;

import "forge-std/Script.sol";

import {Poke} from "../src/Poke.sol";
import {RegistryReceiverV0} from "../src/RegistryReceiverV0.sol";
import {EthPlaysV0} from "../src/EthPlaysV0.sol";

contract SeedScript is Script {
    // Contracts
    Poke public poke;
    RegistryReceiverV0 public registryReceiver;
    EthPlaysV0 public ethPlays;

    // Test addresses
    address public deployer =
        address(0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266);
    address public alice = address(0x70997970C51812dc3A010C7d01b50e0d17dc79C8);
    address public bob = address(0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC);
    address public charlie =
        address(0x90F79bf6EB2c4f870365E785982E1f101E93b906);

    // EthPlays config
    EthPlaysV0.EthPlaysV0Config public config;

    function setUp() public {
        poke = new Poke();
        registryReceiver = new RegistryReceiverV0();
        ethPlays = new EthPlaysV0(poke, registryReceiver);
        poke.setGameAddress(address(ethPlays));

        vm.roll(1);
        vm.warp(block.timestamp + 120);

        config = ethPlays.getConfig();
    }

    function registerAccounts() public {
        registryReceiver.submitRegistration(address(10), alice);
        registryReceiver.submitRegistration(address(20), bob);
        registryReceiver.submitRegistration(address(30), charlie);
    }

    function run() external {
        vm.startBroadcast(deployer);

        setUp();
        registerAccounts();

        vm.stopBroadcast();

        vm.startBroadcast(alice);

        ethPlays.submitAlignmentVote(false);
        ethPlays.submitButtonInput(6);
        vm.warp(block.timestamp + 61);

        // ethPlays.submitAlignmentVote(false);
        ethPlays.submitButtonInput(3);
        vm.warp(block.timestamp + 61);

        // ethPlays.submitAlignmentVote(false);
        ethPlays.submitButtonInput(2);
        vm.warp(block.timestamp + 61);

        vm.stopBroadcast();

        vm.startBroadcast(bob);

        ethPlays.submitAlignmentVote(false);
        ethPlays.submitButtonInput(6);
        vm.warp(block.timestamp + 61);

        // ethPlays.submitAlignmentVote(false);
        ethPlays.submitButtonInput(3);
        vm.warp(block.timestamp + 61);

        // ethPlays.submitAlignmentVote(false);
        ethPlays.submitButtonInput(2);
        vm.warp(block.timestamp + 61);

        vm.stopBroadcast();

        vm.startBroadcast(charlie);

        ethPlays.submitAlignmentVote(false);
        ethPlays.submitButtonInput(6);
        vm.warp(block.timestamp + 61);

        // ethPlays.submitAlignmentVote(false);
        ethPlays.submitButtonInput(3);
        vm.warp(block.timestamp + 61);

        // ethPlays.submitAlignmentVote(false);
        ethPlays.submitButtonInput(2);
        vm.warp(block.timestamp + 61);

        vm.stopBroadcast();
    }
}
