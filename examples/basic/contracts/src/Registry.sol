// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.13;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title Registration contract for ethplays
/// @author olias.eth
/// @notice This is experimental software, use at your own risk.
contract Registry is Ownable {
    /* -------------------------------------------------------------------------- */
    /*                                   STORAGE                                  */
    /* -------------------------------------------------------------------------- */

    /// @notice Boolean indicating if registration is currently active
    bool public isActive = true;
    /// @notice Registration fee amount in ether
    uint256 public registrationFee = 0.1 ether;

    /// @notice Registered account addresses by burner account address
    mapping(address => address) public accounts;
    /// @notice Burner account addresses by registered account address
    mapping(address => address) public burnerAccounts;

    /* -------------------------------------------------------------------------- */
    /*                                   EVENTS                                   */
    /* -------------------------------------------------------------------------- */

    event NewRegistration(address account, address burnerAccount);
    event UpdatedRegistration(address account, address burnerAccount);

    /* -------------------------------------------------------------------------- */
    /*                                   ERRORS                                   */
    /* -------------------------------------------------------------------------- */

    error RegistrationNotActive();
    error BurnerAccountAlreadyRegistered();
    error AccountAlreadyRegistered();
    error AccountNotRegistered();
    error IncorrectRegistrationFee();

    /* -------------------------------------------------------------------------- */
    /*                                 MODIFIERS                                  */
    /* -------------------------------------------------------------------------- */

    /// @notice Requires the game to be active
    modifier onlyActive() {
        if (!isActive) {
            revert RegistrationNotActive();
        }
        _;
    }

    /* -------------------------------------------------------------------------- */
    /*                                REGISTRATION                                */
    /* -------------------------------------------------------------------------- */

    /// @notice Register for ethplays!
    /// @param burnerAccount The address of the burner account to be registered
    function register(address burnerAccount) external payable onlyActive {
        if (accounts[burnerAccount] != address(0)) {
            revert BurnerAccountAlreadyRegistered();
        }

        if (burnerAccounts[msg.sender] != address(0)) {
            revert AccountAlreadyRegistered();
        }

        if (msg.value != registrationFee) {
            revert IncorrectRegistrationFee();
        }

        accounts[burnerAccount] = msg.sender;
        burnerAccounts[msg.sender] = burnerAccount;

        emit NewRegistration(msg.sender, burnerAccount);
    }

    /// @notice Update the burner account address for a registered account
    /// @param burnerAccount The address of the new burner account to be registered
    function updateBurnerAccount(address burnerAccount) external onlyActive {
        if (accounts[burnerAccount] != address(0)) {
            revert BurnerAccountAlreadyRegistered();
        }

        if (burnerAccounts[msg.sender] == address(0)) {
            revert AccountNotRegistered();
        }

        accounts[burnerAccount] = msg.sender;
        burnerAccounts[msg.sender] = burnerAccount;

        emit UpdatedRegistration(msg.sender, burnerAccount);
    }

    /* -------------------------------------------------------------------------- */
    /*                                   ADMIN                                    */
    /* -------------------------------------------------------------------------- */

    function setIsActive(bool _isActive) external onlyOwner {
        isActive = _isActive;
    }

    function setRegistrationFee(uint256 _registrationFee) external onlyOwner {
        registrationFee = _registrationFee;
    }

    /* -------------------------------------------------------------------------- */
    /*                                 WITHDRAWAL                                 */
    /* -------------------------------------------------------------------------- */

    function withdrawAll(address withdrawTo) external onlyOwner {
        payable(withdrawTo).transfer(address(this).balance);
    }

    function withdrawAllERC20(address withdrawTo, IERC20 erc20Token)
        external
        onlyOwner
    {
        erc20Token.transfer(withdrawTo, erc20Token.balanceOf(address(this)));
    }
}
