// SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.9;

import {ERC721A} from "erc721a/contracts/ERC721A.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC2981, IERC165} from "@openzeppelin/contracts/interfaces/IERC2981.sol";
import {IRenderer} from "./IRenderer.sol";

/// @author frolic.eth
/// @title  ERC721 base contract
/// @notice ERC721-specific functionality to keep the actual NFT contract more
///         readable and focused on the mint/project mechanics.
abstract contract ERC721Base is ERC721A, Ownable, IERC2981 {
    uint256 public immutable PRICE;
    uint256 public immutable MAX_SUPPLY;
    uint256 public immutable ROYALTY = 500;

    IRenderer public renderer;
    string public baseTokenURI;

    event Initialized();
    event RendererUpdated(IRenderer previousRenderer, IRenderer newRenderer);
    event BaseTokenURIUpdated(
        string previousBaseTokenURI,
        string newBaseTokenURI
    );

    // ****************** //
    // *** INITIALIZE *** //
    // ****************** //

    constructor(
        string memory name,
        string memory symbol,
        uint256 price,
        uint256 maxSupply
    ) ERC721A(name, symbol) {
        PRICE = price;
        MAX_SUPPLY = maxSupply;
        emit Initialized();
    }

    function _startTokenId() internal pure override returns (uint256) {
        return 1;
    }

    function totalMinted() public view returns (uint256) {
        return _totalMinted();
    }

    // ****************** //
    // *** CONDITIONS *** //
    // ****************** //

    error MintLimitExceeded(uint256 limit);
    error MintSupplyExceeded(uint256 supply);
    error WrongPayment();

    modifier withinMintLimit(uint256 limit, uint256 numToBeMinted) {
        if (_numberMinted(_msgSender()) + numToBeMinted > limit) {
            revert MintLimitExceeded(limit);
        }
        _;
    }

    modifier withinSupply(
        uint256 supply,
        uint256 numMinted,
        uint256 numToBeMinted
    ) {
        if (numMinted + numToBeMinted > supply) {
            revert MintSupplyExceeded(supply);
        }
        _;
    }

    modifier withinMaxSupply(uint256 numToBeMinted) {
        if (_totalMinted() + numToBeMinted > MAX_SUPPLY) {
            revert MintSupplyExceeded(MAX_SUPPLY);
        }
        _;
    }

    modifier hasExactPayment(uint256 numToBeMinted) {
        if (msg.value != PRICE * numToBeMinted) {
            revert WrongPayment();
        }
        _;
    }

    // ************ //
    // *** MINT *** //
    // ************ //

    function _mintMany(address to, uint256 numToBeMinted) internal {
        _mintMany(to, numToBeMinted, "");
    }

    function _mintMany(
        address to,
        uint256 numToBeMinted,
        bytes memory data
    ) internal withinMaxSupply(numToBeMinted) {
        uint256 batchSize = 10;
        uint256 length = numToBeMinted / batchSize;
        for (uint256 i = 0; i < length; ) {
            _safeMint(to, batchSize, data);
            unchecked {
                ++i;
            }
        }
        if (numToBeMinted % batchSize > 0) {
            _safeMint(to, numToBeMinted % batchSize, data);
        }
    }

    // ****************** //
    // *** AFTER MINT *** //
    // ****************** //

    function _baseURI() internal view override returns (string memory) {
        return baseTokenURI;
    }

    function tokenURI(uint256 tokenId)
        public
        view
        override
        returns (string memory)
    {
        if (address(renderer) != address(0)) {
            return renderer.tokenURI(tokenId);
        }
        return super.tokenURI(tokenId);
    }

    // ***************** //
    // *** ROYALTIES *** //
    // ***************** //

    function supportsInterface(bytes4 _interfaceId)
        public
        view
        override(ERC721A, IERC165)
        returns (bool)
    {
        return
            _interfaceId == type(IERC2981).interfaceId ||
            super.supportsInterface(_interfaceId);
    }

    function royaltyInfo(uint256, uint256 salePrice)
        external
        view
        returns (address, uint256)
    {
        return (address(this), (salePrice * ROYALTY) / 10000);
    }

    // ************* //
    // *** ADMIN *** //
    // ************* //

    function setRenderer(IRenderer _renderer) external onlyOwner {
        emit RendererUpdated(renderer, _renderer);
        renderer = _renderer;
    }

    function setBaseTokenURI(string calldata _baseTokenURI) external onlyOwner {
        emit BaseTokenURIUpdated(baseTokenURI, _baseTokenURI);
        baseTokenURI = _baseTokenURI;
    }

    function withdrawAll() external {
        require(address(this).balance > 0, "Zero balance");
        (bool sent, ) = owner().call{value: address(this).balance}("");
        require(sent, "Failed to withdraw");
    }

    function withdrawAllERC20(IERC20 token) external {
        token.transfer(owner(), token.balanceOf(address(this)));
    }

    // Can be run any time after mint to optimize gas for future transfers
    function normalizeOwnership(uint256 startTokenId, uint256 quantity)
        external
    {
        for (uint256 i = 0; i < quantity; i++) {
            _initializeOwnershipAt(startTokenId + i);
        }
    }
}
