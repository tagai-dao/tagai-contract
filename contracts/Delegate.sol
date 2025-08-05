// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IERC20 {
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);
    function transfer(address recipient, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
}

contract Delegate is ReentrancyGuard {
    // 代理人结构
    struct DelegateInfo {
        address delegateAddress;
        uint256 commissionRate; // 佣金比例，单位：百分比
        address token; // 代币地址
        bool exists;
    }

    // 委托记录结构
    struct Delegation {
        address delegator;
        address delegate;
        address token; // 代币地址
        uint256 amount;
        uint256 cancelTimestamp; // 取消委托时间戳
        uint256 canceledAmount; // 已取消金额
        bool exists;
    }

    // 代理人映射
    mapping(address => DelegateInfo) public delegates;

    // 委托记录映射（仅存储代理人侧的记录，按地址+代币分类）
    // delegate => token =》 Delegate[]
    mapping(address => mapping(address => Delegation[])) public delegationsByDelegate;

    // delegator => delegate => token =》 index，方便检索记录
    mapping(address => mapping(address => mapping(address => uint256))) public delegationIndexs;

    // 事件定义
    event DelegateCreated(address indexed delegate, uint256 commissionRate, address);
    event Delegated(address indexed delegator, address indexed delegate, address indexed token, uint256 amount);
    event DelegationCanceled(address indexed delegator, address indexed delegate, address indexed token, uint256 amount);
    event CommissionRateChanged(address indexed delegate, uint256 newRate);

    uint256 lockTime = 36 hours;

    // 创建代理人
    function createDelegate(uint256 _commissionRate, address _token) external {
        require(!delegates[msg.sender].exists, "Already a delegate");
        require(_commissionRate <= 10000, "Commission rate too high");

        delegates[msg.sender] = DelegateInfo({delegateAddress: msg.sender, commissionRate: _commissionRate, token: _token, exists: true});

        emit DelegateCreated(msg.sender, _commissionRate, _token);
    }

    // 修改佣金比例
    function changeCommissionRate(uint256 _newRate) external {
        require(delegates[msg.sender].exists, "Not a delegate");
        require(_newRate <= 100, "Commission rate too high");

        delegates[msg.sender].commissionRate = _newRate;
        emit CommissionRateChanged(msg.sender, _newRate);
    }

    // 委托代币
    function delegate(address _delegate, address _token, uint256 _amount) external {
        require(_amount > 0, "Amount must be greater than 0");
        require(IERC20(_token).transferFrom(msg.sender, address(this), _amount), "Transfer failed");

        if (delegates[_delegate].exists == false) {
            delegates[_delegate] = DelegateInfo({delegateAddress: _delegate, commissionRate: 2000, token: _token, exists: true});
            emit DelegateCreated(_delegate, delegates[_delegate].commissionRate, _token);
        }

        uint index = delegationIndexs[msg.sender][_delegate][_token];
        if (delegationsByDelegate[_delegate][_token].length > 0 && delegationsByDelegate[_delegate][_token][index].delegator == msg.sender) {
            delegationsByDelegate[_delegate][_token][index].amount += _amount;
        } else {
            index = delegationsByDelegate[_delegate][_token].length;
            delegationIndexs[msg.sender][_delegate][_token] = index;
            Delegation memory newDelegation = Delegation({
                delegator: msg.sender,
                delegate: _delegate,
                token: _token,
                amount: _amount,
                cancelTimestamp: 0,
                canceledAmount: 0,
                exists: true
            });
            delegationsByDelegate[_delegate][_token].push(newDelegation);
        }

        emit Delegated(msg.sender, _delegate, _token, _amount);
    }

    // 取消委托
    function cancelDelegation(address _delegate, address _token, uint256 _amount) external {
        bool found = false;

        uint index = delegationIndexs[msg.sender][_delegate][_token];

        if (
            delegationsByDelegate[_delegate][_token][index].delegator == msg.sender &&
            delegationsByDelegate[_delegate][_token][index].canceledAmount < delegationsByDelegate[_delegate][_token][index].amount
        ) {
            uint256 remainingAmount = delegationsByDelegate[_delegate][_token][index].amount - delegationsByDelegate[_delegate][_token][index].canceledAmount;
            uint256 cancelAmount = _amount > remainingAmount ? remainingAmount : _amount;

            delegationsByDelegate[_delegate][_token][index].canceledAmount += cancelAmount;
            delegationsByDelegate[_delegate][_token][index].amount -= cancelAmount;
            delegationsByDelegate[_delegate][_token][index].cancelTimestamp = block.timestamp;

            emit DelegationCanceled(msg.sender, _delegate, _token, cancelAmount);
            found = true;
        }

        require(found, "No active delegation found");
    }

    // 领取取消委托的代币
    function claimCanceledDelegation(address _delegate, address _token) external nonReentrant {
        bool found = false;
        uint256 amountToClaim = 0;
        uint index = delegationIndexs[msg.sender][_delegate][_token];

        if (
            delegationsByDelegate[_delegate][_token][index].delegator == msg.sender &&
            delegationsByDelegate[_delegate][_token][index].cancelTimestamp > 0 &&
            block.timestamp >= delegationsByDelegate[_delegate][_token][index].cancelTimestamp + lockTime &&
            delegationsByDelegate[_delegate][_token][index].canceledAmount > 0
        ) {
            amountToClaim += delegationsByDelegate[_delegate][_token][index].canceledAmount;
            delegationsByDelegate[_delegate][_token][index].canceledAmount = 0;
            delegationsByDelegate[_delegate][_token][index].cancelTimestamp = 0;

            if (delegationsByDelegate[_delegate][_token][index].amount == 0) {
                removeDelegation(msg.sender, _delegate, _token, index);
            }
            found = true;
        }

        require(found, "No claimable delegation found");
        require(amountToClaim > 0, "No amount to claim");

        require(IERC20(_token).transfer(msg.sender, amountToClaim), "Transfer failed");
    }

    function removeDelegation(address _delegator, address _delegate, address _token, uint256 index) internal {
        uint256 lastIndex = delegationsByDelegate[_delegate][_token].length - 1;
        Delegation storage delegation = delegationsByDelegate[_delegate][_token][index];
        Delegation storage lastDelegation = delegationsByDelegate[_delegate][_token][lastIndex];

        delete delegationIndexs[_delegator][_delegate][_token];
        delegationIndexs[lastDelegation.delegator][lastDelegation.delegate][_token] = index;

        delegation.delegator = lastDelegation.delegator;
        delegation.delegate = lastDelegation.delegate;
        delegation.token = lastDelegation.token;
        delegation.amount = lastDelegation.amount;
        delegation.cancelTimestamp = lastDelegation.cancelTimestamp;
        delegation.canceledAmount = lastDelegation.canceledAmount;
        delegation.exists = lastDelegation.exists;

        delegationsByDelegate[_delegate][_token].pop();
    }

    // 查询代理人下的所有委托
    // 查询代理人下的委托（按代币，支持分页）
    function getDelegationsByDelegate(address _delegate, address _token, uint256 offset, uint256 limit) external view returns (Delegation[] memory) {
        if (offset == 0 && limit == 0) {
            return delegationsByDelegate[_delegate][_token];
        }
        Delegation[] storage all = delegationsByDelegate[_delegate][_token];
        uint256 total = all.length;

        if (offset >= total) {
            return new Delegation[](0);
        }

        uint256 end = offset + limit;
        if (end > total) {
            end = total;
        }

        Delegation[] memory result = new Delegation[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            result[i - offset] = all[i];
        }
        return result;
    }
}
