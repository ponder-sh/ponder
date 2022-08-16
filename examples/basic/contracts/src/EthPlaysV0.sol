// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.13;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {Poke} from "./Poke.sol";
import {RegistryReceiverV0} from "./RegistryReceiverV0.sol";

/// @title An experiment in collaborative gaming
/// @author olias.eth
/// @notice This is experimental software, use at your own risk.
contract EthPlaysV0 is Ownable {
    /* -------------------------------------------------------------------------- */
    /*                                   STRUCTS                                  */
    /* -------------------------------------------------------------------------- */

    struct EthPlaysV0Config {
        /// @notice [Parameter] Indicates if the game is currently active
        bool isActive;
        /// @notice [Parameter] The fraction of alignment to persist upon decay, out of 1000
        uint256 alignmentDecayRate;
        /// @notice [Parameter] Number of seconds between alignment votes for each account
        uint256 alignmentVoteCooldown;
        /// @notice [Parameter] The current reward (in POKE) for voting for chaos
        uint256 chaosVoteReward;
        /// @notice [Parameter] Number of seconds in the order vote period
        uint256 orderDuration;
        /// @notice [Parameter] Number of seconds of cooldown between chaos rewards
        uint256 chaosInputRewardCooldown;
        /// @notice [Parameter] The current reward (in POKE) for chaos inputs, subject to cooldown
        uint256 chaosInputReward;
        /// @notice [Parameter] The current reward (in POKE) for order input votes
        uint256 orderInputReward;
        /// @notice [Parameter] The current cost (in POKE) to submit a chat message
        uint256 chatCost;
        /// @notice [Parameter] The current cost (in POKE) to buy a rare candy
        uint256 rareCandyCost;
        /// @notice [Parameter] The number of seconds that the control auction lasts
        uint256 controlAuctionDuration;
        /// @notice [Parameter] The number of seconds that control lasts
        uint256 controlDuration;
    }

    struct ControlBid {
        address from;
        uint256 amount;
    }

    /* -------------------------------------------------------------------------- */
    /*                                   STORAGE                                  */
    /* -------------------------------------------------------------------------- */

    EthPlaysV0Config private config;

    /// @notice [Contract] The POKE token contract
    Poke public poke;
    /// @notice [Contract] The EthPlays registry contract
    RegistryReceiverV0 public registryReceiver;

    /// @notice [State] The index of the last executed input
    uint256 public inputIndex;
    /// @notice [State] The block timestamp of the previous input
    uint256 private inputTimestamp;

    /// @notice [State] Timestamp of latest alignment vote by account address
    mapping(address => uint256) private alignmentVoteTimestamps;
    /// @notice [State] The current alignment value
    int256 public alignment;

    /// @notice [State] Count of order votes for each button index, by input index
    uint256[8] private orderVotes;
    /// @notice [State] Most recent inputIndex an account submitted an order vote
    mapping(address => uint256) private inputIndices;

    /// @notice [State] Timestamp of the most recent chaos input for each account
    mapping(address => uint256) private chaosInputTimestamps;

    /// @notice [State] The best bid for the current control auction
    ControlBid private bestControlBid;
    /// @notice [State] The block timestamp of the start of the latest control auction
    uint256 public controlAuctionStartTimestamp;
    /// @notice [State] The block timestamp of the end of the latest control auction
    uint256 public controlAuctionEndTimestamp;
    /// @notice [State] The account that has (or most recently had) control
    address public controlAddress;

    /* -------------------------------------------------------------------------- */
    /*                                   EVENTS                                   */
    /* -------------------------------------------------------------------------- */

    // Gameplay events
    event AlignmentVote(address from, bool vote, int256 alignment);
    event InputVote(uint256 inputIndex, address from, uint256 buttonIndex);
    event ButtonInput(uint256 inputIndex, address from, uint256 buttonIndex);
    event Chat(address from, string message);
    event RareCandy(address from, uint256 count);

    // Auction events
    event NewControlBid(address from, uint256 amount);
    event Control(address from);

    // Parameter update events
    event SetConfig(EthPlaysV0Config config);

    /* -------------------------------------------------------------------------- */
    /*                                   ERRORS                                   */
    /* -------------------------------------------------------------------------- */

    // Gameplay errors
    error GameNotActive();
    error AccountNotRegistered();
    error InvalidButtonIndex();
    error AnotherPlayerHasControl();
    error AlreadyVotedForThisInput();
    error AlignmentVoteCooldown();

    // Redeem errors
    error InsufficientBalanceForRedeem();

    // Auction errors
    error InsufficientBalanceForBid();
    error InsufficientBidAmount();
    error AuctionInProgress();
    error AuctionIsOver();
    error AuctionHasNoBids();

    /* -------------------------------------------------------------------------- */
    /*                                 MODIFIERS                                  */
    /* -------------------------------------------------------------------------- */

    /// @notice Requires the game to be active.
    modifier onlyActive() {
        if (!config.isActive) {
            revert GameNotActive();
        }
        _;
    }

    /// @notice Requires the sender to be a registered account.
    modifier onlyRegistered() {
        if (!registryReceiver.isRegistered(msg.sender)) {
            revert AccountNotRegistered();
        }
        _;
    }

    /* -------------------------------------------------------------------------- */
    /*                               INITIALIZATION                               */
    /* -------------------------------------------------------------------------- */

    constructor(Poke _poke, RegistryReceiverV0 _registryReceiver) {
        poke = _poke;
        registryReceiver = _registryReceiver;

        config = EthPlaysV0Config(
            true, // bool isActive;
            985, // uint256 alignmentDecayRate;
            60, // uint256 alignmentVoteCooldown;
            40e18, // uint256 chaosVoteReward;
            20, // uint256 orderDuration;
            30, // uint256 chaosInputRewardCooldown;
            20e18, // uint256 chaosInputReward;
            20e18, // uint256 orderInputReward;
            20e18, // uint256 chatCost;
            200e18, // uint256 rareCandyCost;
            90, // uint256 controlAuctionDuration;
            30 // uint256 controlDuration;
        );

        bestControlBid = ControlBid(address(0), 0);
    }

    /* -------------------------------------------------------------------------- */
    /*                                  GAMEPLAY                                  */
    /* -------------------------------------------------------------------------- */

    /// @notice Submit an alignment vote.
    /// @param _alignmentVote The alignment vote. True corresponds to order, false to chaos.
    function submitAlignmentVote(bool _alignmentVote)
        external
        onlyActive
        onlyRegistered
    {
        if (
            block.timestamp <
            alignmentVoteTimestamps[msg.sender] + config.alignmentVoteCooldown
        ) {
            revert AlignmentVoteCooldown();
        }

        // Mint tokens to the sender if the vote is for Chaos.
        if (!_alignmentVote) {
            poke.gameMint(msg.sender, config.chaosVoteReward);
        }

        // Apply alignment decay.
        alignment *= int256(config.alignmentDecayRate);
        alignment /= int256(1000);

        // Apply sender alignment update.
        alignment += _alignmentVote ? int256(1000) : -1000;

        alignmentVoteTimestamps[msg.sender] = block.timestamp;
        emit AlignmentVote(msg.sender, _alignmentVote, alignment);
    }

    /// @notice Submit a button input.
    /// @param buttonIndex The index of the button input. Must be between 0 and 7.
    function submitButtonInput(uint256 buttonIndex)
        external
        onlyActive
        onlyRegistered
    {
        if (buttonIndex > 7) {
            revert InvalidButtonIndex();
        }

        if (
            block.timestamp <=
            controlAuctionEndTimestamp + config.controlDuration
        ) {
            // Control
            if (msg.sender != controlAddress) {
                revert AnotherPlayerHasControl();
            }

            inputTimestamp = block.timestamp;
            emit ButtonInput(inputIndex, msg.sender, buttonIndex);
            inputIndex++;
        } else if (alignment > 0) {
            // Order

            orderVotes[buttonIndex]++;

            // If orderDuration seconds have passed since the previous input, execute.
            // This path could/should be broken out into an external "executeOrderVote"
            // function that rewards the sender in POKE.
            if (block.timestamp >= inputTimestamp + config.orderDuration) {
                uint256 bestButtonIndex = 0;
                uint256 bestButtonIndexVoteCount = 0;

                for (uint256 i = 0; i < 8; i++) {
                    if (orderVotes[i] > bestButtonIndexVoteCount) {
                        bestButtonIndex = i;
                        bestButtonIndexVoteCount = orderVotes[i];
                    }
                    orderVotes[i] = 0;
                }

                inputTimestamp = block.timestamp;
                emit ButtonInput(inputIndex, msg.sender, bestButtonIndex);
                inputIndex++;
            } else {
                if (inputIndex == inputIndices[msg.sender]) {
                    revert AlreadyVotedForThisInput();
                }
                inputIndices[msg.sender] = inputIndex;

                poke.gameMint(msg.sender, config.orderInputReward);
                emit InputVote(inputIndex, msg.sender, buttonIndex);
            }
        } else {
            // Chaos
            if (
                block.timestamp >
                chaosInputTimestamps[msg.sender] +
                    config.chaosInputRewardCooldown
            ) {
                chaosInputTimestamps[msg.sender] = block.timestamp;
                poke.gameMint(msg.sender, config.chaosInputReward);
            }

            inputTimestamp = block.timestamp;
            emit ButtonInput(inputIndex, msg.sender, buttonIndex);
            inputIndex++;
        }
    }

    /* -------------------------------------------------------------------------- */
    /*                                  REDEEMS                                   */
    /* -------------------------------------------------------------------------- */

    /// @notice Submit an message to the chat.
    /// @param message The chat message.
    function submitChat(string memory message)
        external
        onlyActive
        onlyRegistered
    {
        if (poke.balanceOf(msg.sender) < config.chatCost) {
            revert InsufficientBalanceForRedeem();
        }

        poke.gameBurn(msg.sender, config.chatCost);
        emit Chat(msg.sender, message);
    }

    /// @notice Submit a request to purchase rare candies.
    /// @param count The number of rare candies to be purchased.
    function submitRareCandies(uint256 count)
        external
        onlyActive
        onlyRegistered
    {
        uint256 totalCost = config.rareCandyCost * count;

        if (poke.balanceOf(msg.sender) < totalCost) {
            revert InsufficientBalanceForRedeem();
        }

        poke.gameBurn(msg.sender, totalCost);
        emit RareCandy(msg.sender, count);
    }

    /* -------------------------------------------------------------------------- */
    /*                                  AUCTIONS                                  */
    /* -------------------------------------------------------------------------- */

    /// @notice Submit a bid in the active control auction.
    /// @param amount The bid amount in POKE
    function submitControlBid(uint256 amount)
        external
        onlyActive
        onlyRegistered
    {
        // This is the first bid in the auction, so set controlAuctionStartTimestamp.
        if (bestControlBid.from == address(0)) {
            controlAuctionStartTimestamp = block.timestamp;
        }

        // The auction is over (it must be ended).
        if (
            block.timestamp >
            controlAuctionStartTimestamp + config.controlAuctionDuration
        ) {
            revert AuctionIsOver();
        }

        if (poke.balanceOf(msg.sender) < amount) {
            revert InsufficientBalanceForBid();
        }

        if (amount <= bestControlBid.amount) {
            revert InsufficientBidAmount();
        }

        // If there was a previous best bid, return the bid amount to the account that submitted it.
        if (bestControlBid.from != address(0)) {
            poke.gameMint(bestControlBid.from, bestControlBid.amount);
        }
        poke.gameBurn(msg.sender, amount);
        bestControlBid = ControlBid(msg.sender, amount);
        emit NewControlBid(msg.sender, amount);
    }

    /// @notice End the current control auction and start the cooldown for the next one.
    function endControlAuction() external onlyActive {
        if (
            block.timestamp <
            controlAuctionStartTimestamp + config.controlAuctionDuration
        ) {
            revert AuctionInProgress();
        }

        if (bestControlBid.from == address(0)) {
            revert AuctionHasNoBids();
        }

        emit Control(bestControlBid.from);
        controlAddress = bestControlBid.from;
        bestControlBid = ControlBid(address(0), 0);
        controlAuctionEndTimestamp = block.timestamp;
    }

    /* -------------------------------------------------------------------------- */
    /*                                   ADMIN                                    */
    /* -------------------------------------------------------------------------- */

    /// @notice Set the game configuration. Owner only.
    /// @return _config Current EthPlaysV0Config struct
    function getConfig() public view returns (EthPlaysV0Config memory _config) {
        return config;
    }

    /// @notice Set the game configuration. Owner only.
    /// @param _config New EthPlaysV0Config struct
    function setConfig(EthPlaysV0Config calldata _config) external onlyOwner {
        config = _config;

        emit SetConfig(_config);
    }
}
