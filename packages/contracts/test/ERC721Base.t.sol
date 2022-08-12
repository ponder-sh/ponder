// SPDX-License-Identifier: CC0-1.0
pragma solidity >=0.8.10 <0.9.0;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../src/ERC721Base.sol";
import "../src/IRenderer.sol";

contract CustomNFT is ERC721Base {
    constructor() ERC721Base("Custom NFT", "NFT", 0.1 ether, 100) {}

    function mint(uint numToBeMinted)
        external
        payable
        hasExactPayment(numToBeMinted)
        withinMintLimit(4, numToBeMinted)
    {
        _mintMany(_msgSender(), numToBeMinted);
    }

    function uncappedMint(uint numToBeMinted)
        external
        payable
        hasExactPayment(numToBeMinted)
    {
        _mintMany(_msgSender(), numToBeMinted);
    }

    function startTimestamp(uint256 tokenId)
        public
        view
        returns (uint256)
    {
        return _ownershipOf(tokenId).startTimestamp;
    }
}

contract CustomRenderer is IRenderer {
    function tokenURI(uint tokenId) public pure returns (string memory) {
        return string.concat("{\"tokenId\":", Strings.toString(tokenId), "}");
    }
}

contract CustomCoin is ERC20 {
    constructor() ERC20("Dummy ERC20", "DUMMY") {}

    function mint() public {
        _mint(_msgSender(), 100);
    }
}

contract ERC721BaseTest is Test {
    CustomNFT private nft;

    address private owner = vm.addr(uint256(keccak256(abi.encodePacked("owner"))));
    address private minter = vm.addr(uint256(keccak256(abi.encodePacked("minter"))));


    function setUp() public {
        nft = new CustomNFT();
        nft.transferOwnership(owner);
        vm.deal(owner, 100 ether);
        vm.deal(minter, 100 ether);
    }

    function testMintPayment() public {
        vm.startPrank(minter);
        vm.expectRevert(abi.encodeWithSelector(ERC721Base.WrongPayment.selector));
        nft.mint(2);
        nft.mint{value: 0.2 ether}(2);
    }

    function testMintLimit() public {
        vm.startPrank(minter);
        nft.mint{value: 0.2 ether}(2);
        nft.mint{value: 0.1 ether}(1);
        vm.expectRevert(abi.encodeWithSelector(ERC721Base.MintLimitExceeded.selector, 4));
        nft.mint{value: 0.2 ether}(2);
        nft.mint{value: 0.1 ether}(1);
        vm.expectRevert(abi.encodeWithSelector(ERC721Base.MintLimitExceeded.selector, 4));
        nft.mint{value: 0.1 ether}(1);
    }

    function testMaxSupply() public {
        vm.startPrank(minter);
        nft.uncappedMint{value: 6 ether}(60);
        vm.expectRevert(abi.encodeWithSelector(ERC721Base.MintSupplyExceeded.selector, 100));
        nft.uncappedMint{value: 6 ether}(60);
        nft.uncappedMint{value: 4 ether}(40);
        vm.expectRevert(abi.encodeWithSelector(ERC721Base.MintSupplyExceeded.selector, 100));
        nft.uncappedMint{value: 0.1 ether}(1);
    }

    function testBaseTokenURI() public {
        vm.prank(owner);
        nft.setBaseTokenURI("ipfs://example/");
        vm.prank(minter);
        nft.mint{value: 0.1 ether}(1);
        assertEq(nft.tokenURI(1), "ipfs://example/1");
    }

    function testRenderer() public {
        CustomRenderer renderer = new CustomRenderer();
        vm.prank(owner);
        nft.setRenderer(renderer);
        vm.prank(minter);
        nft.mint{value: 0.1 ether}(1);
        assertEq(nft.tokenURI(1), "{\"tokenId\":1}");
    }

    function testWithdrawAll() public {
        assertEq(address(nft).balance, 0);
        assertEq(owner.balance, 100 ether);
        vm.expectRevert("Zero balance");
        nft.withdrawAll();
        vm.prank(minter);
        nft.mint{value: 0.2 ether}(2);
        assertEq(address(nft).balance, 0.2 ether);
        nft.withdrawAll();
        assertEq(owner.balance, 100.2 ether);
    }

    function testWithdrawAllERC20() public {
        CustomCoin coin = new CustomCoin();
        vm.prank(minter);
        coin.mint();
        vm.prank(minter);
        coin.transfer(address(nft), 50);
        assertEq(coin.balanceOf(address(nft)), 50);
        assertEq(coin.balanceOf(address(owner)), 0);
        nft.withdrawAllERC20(coin);
        assertEq(coin.balanceOf(address(nft)), 0);
        assertEq(coin.balanceOf(address(owner)), 50);
    }

    function testOwnershipGas() public {
        vm.prank(minter);
        nft.uncappedMint{value: 10 ether}(100);

        uint256 startGas = gasleft();
        nft.ownerOf(1);
        assertLt(startGas - gasleft(), 1400);
        startGas = gasleft();
        nft.ownerOf(100);
        assertGt(startGas - gasleft(), 20_000);
        assertLt(startGas - gasleft(), 22_000);

        nft.normalizeOwnership(1, 100);
        startGas = gasleft();
        nft.ownerOf(1);
        assertLt(startGas - gasleft(), 1400);
        startGas = gasleft();
        nft.ownerOf(50);
        assertLt(startGas - gasleft(), 1400);
    }

    // Test to make sure ERC721A returns normalized startTimestamp
    function testStartTimestamp() public {
        vm.warp(3600);
        vm.prank(minter);
        nft.uncappedMint{value: 10 ether}(100);

        assertEq(nft.startTimestamp(1), 3600);
        assertEq(nft.startTimestamp(50), 3600);
        assertEq(nft.startTimestamp(100), 3600);
    }
}
