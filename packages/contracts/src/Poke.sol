// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.13;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title An experiment in collaborative gaming
/// @author olias.eth
/// @notice This is experimental software, use at your own risk.
contract Poke is ERC20, Ownable {
    /* -------------------------------------------------------------------------- */
    /*                                   STORAGE                                  */
    /* -------------------------------------------------------------------------- */

    /// @notice Address of the current game contract
    address public gameAddress;

    /* -------------------------------------------------------------------------- */
    /*                                   EVENTS                                   */
    /* -------------------------------------------------------------------------- */

    event SetGameAddress(address gameAddress);

    /* -------------------------------------------------------------------------- */
    /*                                   ERRORS                                   */
    /* -------------------------------------------------------------------------- */

    error NotAuthorized();

    /* -------------------------------------------------------------------------- */
    /*                                 MODIFIERS                                  */
    /* -------------------------------------------------------------------------- */

    /// @notice Requires the sender to be the game contract
    modifier onlyGameAddress() {
        if (msg.sender != gameAddress) {
            revert NotAuthorized();
        }
        _;
    }

    /* -------------------------------------------------------------------------- */
    /*                               INITIALIZATION                               */
    /* -------------------------------------------------------------------------- */

    constructor() ERC20("ethplays", "POKE") {}

    /* -------------------------------------------------------------------------- */
    /*                                   GAME                                     */
    /* -------------------------------------------------------------------------- */

    /// @notice Mint new tokens to an account. Can only be called by the game contract.
    /// @param account The account to mint tokens to
    /// @param amount The amount of tokens to mint
    function gameMint(address account, uint256 amount)
        external
        onlyGameAddress
    {
        _mint(account, amount);
    }

    /// @notice Burn existing tokens belonging to an account. Can only be called by the game contract.
    /// @param account The account to burn tokens for
    /// @param amount The amount of tokens to burn
    function gameBurn(address account, uint256 amount)
        external
        onlyGameAddress
    {
        _burn(account, amount);
    }

    /// @notice Transfer tokens without approval. Can only be called by the game contract.
    /// @param from The account to transfer tokens from
    /// @param to The account to transfer tokens to
    /// @param amount The amount of tokens to transfer
    function gameTransfer(
        address from,
        address to,
        uint256 amount
    ) external onlyGameAddress {
        _transfer(from, to, amount);
    }

    /* -------------------------------------------------------------------------- */
    /*                                   OWNER                                    */
    /* -------------------------------------------------------------------------- */

    /// @notice Update the game contract address. Only owner.
    /// @param _gameAddress The address of the active game
    function setGameAddress(address _gameAddress) external onlyOwner {
        gameAddress = _gameAddress;
        emit SetGameAddress(_gameAddress);
    }
}
