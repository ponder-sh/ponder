// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.8.0;

import { Pair } from "./Pair.sol";

contract Factory {
    address[] public allPairs;

    event PairCreated(address indexed pair, uint256 pairIndex);

    function allPairsLength() external view returns (uint256) {
        return allPairs.length;
    }

    function createPair() external returns (address pair) {
        pair = address(new Pair());
     
        allPairs.push(pair);
        emit PairCreated(pair, allPairs.length);
    }
}