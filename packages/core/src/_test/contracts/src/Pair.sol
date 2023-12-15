// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.8.0;

import { ERC20 } from "./ERC20.sol";

/// @author Modified from Uniswap (https://github.com/Uniswap/uniswap-v2-core/blob/master/contracts/UniswapV2Pair.sol)
contract Pair is ERC20("Pair Token", "PAIR", 18) {

    address public factory;
    address public token0;
    address public token1;

    uint256 public reserve0;
    uint256 public reserve1;

    event Swap(
        address indexed sender,
        uint256 amount0In,
        uint256 amount1In,
        uint256 amount0Out,
        uint256 amount1Out,
        address indexed to
    );

    function initialize(address _token0, address _token1) external {
        require(msg.sender == factory);
        token0 = _token0;
        token1 = _token1;
    }

    constructor() {
        factory = msg.sender;
    }

    function swap(uint256 amount0Out, uint256 amount1Out, address to) external {
        require(amount0Out > 0 || amount1Out > 0);
        require(amount0Out < reserve0 && amount1Out < reserve1);

        uint256 balance0;
        uint256 balance1;
        { // scope for _token{0,1}, avoids stack too deep errors
          address _token0 = token0;
          address _token1 = token1;
          require(to != _token0 && to != _token1);
          if (amount0Out > 0) ERC20(_token0).transfer(to, amount0Out);
          if (amount1Out > 0) ERC20(_token1).transfer(to, amount1Out);
          balance0 = ERC20(_token0).balanceOf(address(this));
          balance1 = ERC20(_token1).balanceOf(address(this));
        }
        uint256 amount0In = balance0 > reserve0 - amount0Out ? balance0 - (reserve0 - amount0Out) : 0;
        uint256 amount1In = balance1 > reserve1 - amount1Out ? balance1 - (reserve1 - amount1Out) : 0;
        require(amount0In > 0 || amount1In > 0);

        reserve0 = balance0;
        reserve1 = balance1;

        emit Swap(msg.sender, amount0In, amount1In, amount0Out, amount1Out, to);
    }
}