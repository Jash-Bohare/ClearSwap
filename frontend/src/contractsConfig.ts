import { ethers } from 'ethers';

export const LOCAL_CHAIN_CONFIG = {
  rpcUrl: 'http://127.0.0.1:8545',
  chainId: 31337,
  chainName: 'Anvil Localhost',
  addresses: {
    weth: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
    usdc: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
    orderBook: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
    clearingAdapter: '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9',
    settlement: '0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9'
  }
};

export const ORDERBOOK_ABI = [
  'function submitOrder(bool isBuy, uint128 amount, uint64 limitPrice) external returns (uint64 orderId)',
  'function cancelOrder(uint64 orderId) external',
  'function closeBatch() external',
  'function currentBatchId() external view returns (uint64)',
  'function getBatchStatus(uint64 batchId) external view returns (uint8)',
  'function getBatchOrders(uint64 batchId) external view returns (tuple(uint64 id, address trader, bool isBuy, uint128 amount, uint64 limitPrice, uint64 batchId, uint8 status, uint128 filledAmount)[])',
  'event OrderSubmitted(uint64 indexed orderId, uint64 indexed batchId, address indexed trader, bool isBuy, uint128 amount, uint64 limitPrice)',
  'event OrderCancelled(uint64 indexed orderId, uint64 indexed batchId, address indexed trader)',
  'event BatchClosed(uint64 indexed batchId, uint256 timestamp)'
];

export const SETTLEMENT_ABI = [
  'event BatchSettled(uint64 indexed batchId, uint64 clearingPrice, uint256 totalVolume, uint256 fillsCount)',
  'event OrderRolled(uint64 indexed oldOrderId, uint64 indexed newOrderId, uint64 indexed fromBatchId, uint64 toBatchId, uint128 rolledAmount)'
];

export const ERC20_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function mint(address to, uint256 amount) external',
  'function balanceOf(address account) external view returns (uint256)'
];

export async function checkAnvilNode(): Promise<boolean> {
  try {
    const provider = new ethers.JsonRpcProvider(LOCAL_CHAIN_CONFIG.rpcUrl);
    const network = await provider.getNetwork();
    return Number(network.chainId) === LOCAL_CHAIN_CONFIG.chainId;
  } catch {
    return false;
  }
}
