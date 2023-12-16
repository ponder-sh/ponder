// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.8.0;

contract Pair {
    address public factory;

    event Swap(
        address indexed sender,
        uint256 amount0Out,
        uint256 amount1Out,
        address indexed to
    );

    constructor() {
        factory = msg.sender;
    }

    function swap(uint256 amount0Out, uint256 amount1Out, address to) external {
        emit Swap(msg.sender, amount0Out, amount1Out, to);
    }
}