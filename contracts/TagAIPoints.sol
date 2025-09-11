// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.20;

import {ERC20} from "./solady/src/tokens/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title TagAIPoints
 * @dev 一个不可转账但可铸造的代币合约
 * 
 * 特性：
 * - 代币一旦铸造给用户，就不能再转移给其他人
 * - 只有管理员可以铸造代币
 * - 支持批量铸造给多个地址
 * - 支持暂停/恢复功能
 * - 支持管理员权限管理
 */
contract TagAIPoints is ERC20, Ownable, Pausable {
    
    // 代币名称和符号
    string private _name;
    string private _symbol;
    
    // 管理员地址
    address public admin;
    
    // 是否允许转账的标志
    bool public transferEnabled = false;
    
    // 事件定义
    event AdminChanged(address indexed oldAdmin, address indexed newAdmin);
    event BatchMint(address indexed minter, address[] recipients, uint256[] amounts);
    
    // 错误定义
    error TransferNotAllowed();
    error OnlyAdmin();
    error InvalidAddress();
    error ArrayLengthMismatch();
    error ZeroAmount();
    error MaxSupplyReached();

    constructor(
    ) ERC20() Ownable(msg.sender) {
        _name = "TagAI Points";
        _symbol = "TAG-POINTS";
        admin = msg.sender;
    }
    
    /**
     * @dev 返回代币名称
     */
    function name() public view override returns (string memory) {
        return _name;
    }
    
    /**
     * @dev 返回代币符号
     */
    function symbol() public view override returns (string memory) {
        return _symbol;
    }
    
    /**
     * @dev 返回代币精度（小数位数）
     */
    function decimals() public pure override returns (uint8) {
        return 18;
    }
    
    /**
     * @dev 修改器：只有管理员可以调用
     */
    modifier onlyAdmin() {
        if (msg.sender != admin) {
            revert OnlyAdmin();
        }
        _;
    }
    
    /**
     * @dev 重写转账函数，禁止转账
     */
    function transfer(address /* to */, uint256 /* amount */) public pure override returns (bool) {
        revert TransferNotAllowed();
    }
    
    /**
     * @dev 重写转账函数，禁止转账
     */
    function transferFrom(
        address /* from */, 
        address /* to */, 
        uint256 /* amount */
    ) public pure override returns (bool) {
        revert TransferNotAllowed();
    }

    function _mint(address to, uint256 amount) internal override {
        if (totalSupply() + amount > 5000000 ether) {
            revert MaxSupplyReached();
        }
        super._mint(to, amount);
    }
    
    /**
     * @dev 铸造代币给指定地址
     * @param to 接收地址
     * @param amount 铸造数量
     */
    function mint(address to, uint256 amount) public onlyAdmin whenNotPaused {
        if (to == address(0)) {
            revert InvalidAddress();
        }
        if (amount == 0) {
            revert ZeroAmount();
        }
        
        _mint(to, amount);
    }
    
    /**
     * @dev 批量铸造代币给多个地址
     * @param recipients 接收地址数组
     * @param amounts 对应的铸造数量数组
     */
    function batchMint(address[] calldata recipients, uint256[] calldata amounts) 
        external 
        onlyAdmin  
    {
        if (recipients.length != amounts.length) {
            revert ArrayLengthMismatch();
        }
        if (recipients.length == 0) {
            revert ArrayLengthMismatch();
        }
        
        for (uint256 i = 0; i < recipients.length; i++) {
            if (recipients[i] == address(0)) {
                revert InvalidAddress();
            }
            if (amounts[i] == 0) {
                revert ZeroAmount();
            }
            
            _mint(recipients[i], amounts[i]);
        }
        
        emit BatchMint(msg.sender, recipients, amounts);
    }
    
    /**
     * @dev 设置新的管理员（仅所有者可调用）
     * @param newAdmin 新管理员地址
     */
    function setAdmin(address newAdmin) external onlyOwner {
        if (newAdmin == address(0)) {
            revert InvalidAddress();
        }
        
        address oldAdmin = admin;
        admin = newAdmin;
        
        emit AdminChanged(oldAdmin, newAdmin);
    }
    
    /**
     * @dev 重写转账检查函数
     * 如果转账未启用，则禁止所有转账
     */
    function _beforeTokenTransfer(address from, address to, uint256 amount) internal override {
        super._beforeTokenTransfer(from, to, amount);
        
        // 如果转账未启用，禁止所有转账（除了铸造）
        if (from != address(0)) {
            revert TransferNotAllowed();
        }
    }
    
    /**
     * @dev 获取管理员地址
     */
    function getAdmin() external view returns (address) {
        return admin;
    }
    
    /**
     * @dev 检查地址是否为管理员
     */
    function isAdmin(address account) external view returns (bool) {
        return account == admin;
    }
    
    /**
     * @dev 获取代币总供应量
     */
    function totalSupply() public view override returns (uint256) {
        return super.totalSupply();
    }
    
    /**
     * @dev 获取指定地址的代币余额
     */
    function balanceOf(address account) public view override returns (uint256) {
        return super.balanceOf(account);
    }
}
