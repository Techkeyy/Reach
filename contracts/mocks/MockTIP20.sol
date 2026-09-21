// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ITIP20} from "../interfaces/ITIP20.sol";

/// @dev Deterministic local TIP-20 double. It exposes a switch for false-return transfer failures
///      so tests can prove the vault does not leave terminal state after a failed token operation.
contract MockTIP20 is ITIP20 {
    string public constant name = "Mock USD";
    string public constant symbol = "mUSD";
    uint8 public constant decimals = 6;

    mapping(address account => uint256 balance) private _balances;
    mapping(address owner => mapping(address spender => uint256 amount)) private _allowances;
    bool public returnFalseOnTransfer;

    error InsufficientAllowance();
    error InsufficientBalance();

    function mint(address to, uint256 amount) external {
        _balances[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function setReturnFalseOnTransfer(bool value) external {
        returnFalseOnTransfer = value;
    }

    function allowance(address owner, address spender) external view returns (uint256) {
        return _allowances[owner][spender];
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        _allowances[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function balanceOf(address account) external view returns (uint256) {
        return _balances[account];
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        return _move(msg.sender, to, amount, bytes32(0), false);
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        if (_allowances[from][msg.sender] < amount) revert InsufficientAllowance();
        if (!returnFalseOnTransfer) _allowances[from][msg.sender] -= amount;
        return _move(from, to, amount, bytes32(0), false);
    }

    function transferFromWithMemo(
        address from,
        address to,
        uint256 amount,
        bytes32 memo
    ) external returns (bool) {
        if (returnFalseOnTransfer) return false;
        if (_allowances[from][msg.sender] < amount) revert InsufficientAllowance();
        _allowances[from][msg.sender] -= amount;
        return _move(from, to, amount, memo, true);
    }

    function transferWithMemo(address to, uint256 amount, bytes32 memo) external returns (bool) {
        if (returnFalseOnTransfer) return false;
        return _move(msg.sender, to, amount, memo, true);
    }

    function _move(
        address from,
        address to,
        uint256 amount,
        bytes32 memo,
        bool withMemo
    ) private returns (bool) {
        if (_balances[from] < amount) revert InsufficientBalance();
        _balances[from] -= amount;
        _balances[to] += amount;
        emit Transfer(from, to, amount);
        if (withMemo) emit TransferWithMemo(from, to, amount, memo);
        return true;
    }
}
