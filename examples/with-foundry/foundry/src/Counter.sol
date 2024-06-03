// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

contract Counter {
 event Incremented(uint256 value);

    uint256 public number;

    function increment() public {
        number++;
        emit Incremented(number);
    }
}
