// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ITIP20} from "./interfaces/ITIP20.sol";

/// @title Reach Payout Vault
/// @notice One exact TIP-20 payout per ID with one-time EIP-712 claim authorization.
/// @dev Non-upgradeable v1. No owner, admin, rescue, pause, or pooled balance authority.
contract ReachPayoutVault is EIP712, ReentrancyGuard {
    enum Status { NONE, FUNDED, CLAIMED, RECLAIMED }

    struct Payout {
        address sender;
        uint256 amount;
        uint64 expiresAt;
        address claimSigner;
        Status status;
        address claimant;
    }

    string private constant EIP712_NAME = "Reach Payout Vault";
    string private constant EIP712_VERSION = "1";
    bytes32 public constant CLAIM_ACTION = keccak256("ReachPayoutVault.claim");
    uint256 public constant CLAIM_AUTHORIZATION_VERSION = 1;
    bytes32 public constant CLAIM_TYPEHASH = keccak256(
        "Claim(uint256 payoutId,address recipient,bytes32 action,uint256 version)"
    );

    ITIP20 public immutable token;
    uint256 public totalFundedAmount;
    mapping(uint256 payoutId => Payout payout) private _payouts;

    error InvalidPayoutId();
    error PayoutAlreadyExists();
    error ZeroAmount();
    error ZeroAddress();
    error InvalidExpiry();
    error InvalidStatus();
    error PayoutExpired();
    error PayoutNotExpired();
    error OnlySender();
    error InvalidClaimAuthorization();
    error TokenTransferFailed();

    event PayoutCreated(uint256 indexed payoutId, address indexed sender, uint256 amount, uint64 expiresAt, address claimSigner, bytes32 indexed memo);
    event PayoutClaimed(uint256 indexed payoutId, address indexed recipient, uint256 amount, bytes32 indexed memo);
    event PayoutReclaimed(uint256 indexed payoutId, address indexed sender, uint256 amount, bytes32 indexed memo);

    constructor(address tokenAddress) EIP712(EIP712_NAME, EIP712_VERSION) {
        if (tokenAddress == address(0)) revert ZeroAddress();
        token = ITIP20(tokenAddress);
    }

    function createPayout(uint256 payoutId, uint256 amount, address claimSigner, uint64 expiresAt) external nonReentrant {
        if (payoutId == 0) revert InvalidPayoutId();
        if (_payouts[payoutId].status != Status.NONE) revert PayoutAlreadyExists();
        if (amount == 0) revert ZeroAmount();
        if (claimSigner == address(0)) revert ZeroAddress();
        if (expiresAt <= block.timestamp) revert InvalidExpiry();

        Payout storage payout = _payouts[payoutId];
        payout.sender = msg.sender;
        payout.amount = amount;
        payout.expiresAt = expiresAt;
        payout.claimSigner = claimSigner;
        payout.status = Status.FUNDED;
        totalFundedAmount += amount;
        _callToken(abi.encodeWithSelector(ITIP20.transferFromWithMemo.selector, msg.sender, address(this), amount, _memo(payoutId)));
        emit PayoutCreated(payoutId, msg.sender, amount, expiresAt, claimSigner, _memo(payoutId));
    }

    function claim(uint256 payoutId, address recipient, bytes calldata claimAuthorizationSignature) external nonReentrant {
        if (recipient == address(0)) revert ZeroAddress();
        Payout storage payout = _payouts[payoutId];
        if (payout.status != Status.FUNDED) revert InvalidStatus();
        if (block.timestamp >= payout.expiresAt) revert PayoutExpired();
        if (ECDSA.recover(hashClaimAuthorization(payoutId, recipient), claimAuthorizationSignature) != payout.claimSigner) {
            revert InvalidClaimAuthorization();
        }
        payout.status = Status.CLAIMED;
        payout.claimant = recipient;
        totalFundedAmount -= payout.amount;
        _callToken(abi.encodeWithSelector(ITIP20.transferWithMemo.selector, recipient, payout.amount, _memo(payoutId)));
        emit PayoutClaimed(payoutId, recipient, payout.amount, _memo(payoutId));
    }

    function reclaim(uint256 payoutId) external nonReentrant {
        Payout storage payout = _payouts[payoutId];
        if (payout.status != Status.FUNDED) revert InvalidStatus();
        if (msg.sender != payout.sender) revert OnlySender();
        if (block.timestamp < payout.expiresAt) revert PayoutNotExpired();
        payout.status = Status.RECLAIMED;
        totalFundedAmount -= payout.amount;
        _callToken(abi.encodeWithSelector(ITIP20.transferWithMemo.selector, msg.sender, payout.amount, _memo(payoutId)));
        emit PayoutReclaimed(payoutId, msg.sender, payout.amount, _memo(payoutId));
    }

    function getPayout(uint256 payoutId) external view returns (Payout memory) { return _payouts[payoutId]; }

    function hashClaimAuthorization(uint256 payoutId, address recipient) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(CLAIM_TYPEHASH, payoutId, recipient, CLAIM_ACTION, CLAIM_AUTHORIZATION_VERSION)));
    }

    /// @dev Current live Moderato TIP-20 memo calls can succeed with empty return data even though
    ///      the published interface declares bool. Accept empty success or explicit true, reject
    ///      reverts and explicit false. The immutable token is the only low-level-call target.
    function _callToken(bytes memory callData) private {
        (bool success, bytes memory returnData) = address(token).call(callData);
        if (!success) revert TokenTransferFailed();
        if (returnData.length != 0 && !abi.decode(returnData, (bool))) revert TokenTransferFailed();
    }

    function _memo(uint256 payoutId) private pure returns (bytes32) { return bytes32(payoutId); }
}
