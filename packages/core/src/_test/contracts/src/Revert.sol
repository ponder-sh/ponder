// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.8.0;


contract Revert {
    error e();
    function revert(bool revert) external {
        if (revert) revert e();
    }
}