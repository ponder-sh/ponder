// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

interface CounterEvents {
    event Incremented(uint256 value);
}

contract Counter is CounterEvents {
    uint256 public number;

    function increment() public {
        number++;
        emit Incremented(number);
    }
}
