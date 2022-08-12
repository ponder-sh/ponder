// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.13;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title Child registry for EthPlays
/// @author olias.eth
/// @notice This is experimental software, use at your own risk.
contract RegistryReceiverV0 is Ownable {
    /* -------------------------------------------------------------------------- */
    /*                                   STORAGE                                  */
    /* -------------------------------------------------------------------------- */

    /// @notice [State] Registered account addresses by burner account address
    mapping(address => address) public accounts;
    /// @notice [State] Burner account addresses by registered account address
    mapping(address => address) public burnerAccounts;

    /* -------------------------------------------------------------------------- */
    /*                                   EVENTS                                   */
    /* -------------------------------------------------------------------------- */

    event NewRegistration(address account, address burnerAccount);
    event UpdatedRegistration(
        address account,
        address burnerAccount,
        address previousBurnerAccount
    );

    /* -------------------------------------------------------------------------- */
    /*                                REGISTRATION                                */
    /* -------------------------------------------------------------------------- */

    /// @notice Returns true if the specified burner account is registered.
    /// @param burnerAccount The address of the players burner account
    /// @return isRegistered True if the burner account is registered
    function isRegistered(address burnerAccount) public view returns (bool) {
        return accounts[burnerAccount] != address(0);
    }

    /* -------------------------------------------------------------------------- */
    /*                                REGISTRATION                                */
    /* -------------------------------------------------------------------------- */

    /// @notice Registers a new account to burner account mapping. Owner only.
    /// @param account The address of the players main account
    /// @param burnerAccount The address of the players burner account
    function submitRegistration(address account, address burnerAccount)
        external
        onlyOwner
    {
        address previousBurnerAccount = burnerAccounts[account];

        if (previousBurnerAccount != address(0)) {
            emit UpdatedRegistration(
                account,
                burnerAccount,
                previousBurnerAccount
            );
        } else {
            emit NewRegistration(account, burnerAccount);
        }

        accounts[burnerAccount] = account;
        burnerAccounts[account] = burnerAccount;
    }
}
