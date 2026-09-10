import { ethers } from 'ethers';

export const ARBITRUM_SEPOLIA_CONFIG = {
  rpcUrl: 'https://arb-sepolia.g.alchemy.com/v2/B9O_PINbPxUHeQq3guVMc',
  chainId: 421614,
  chainName: 'Arbitrum Sepolia',
  blockExplorerUrl: 'https://sepolia.arbiscan.io',
  addresses: {
    weth: '0xFd36a6C073A99895B9f2750Bb8D00dE3f739FaB4',
    usdc: '0xb59C422eAA62016E3ABc7c3C00aa06549b796507',
    orderBook: '0xC78fcb175A6Ca05A837B231254178F609BECB10a',
    clearingAdapter: '0x790DF89a94E00E5177D34f6451da84Dc3085cc1f',
    settlement: '0x099B5dDFa5Ff6682951A9DD1c06b9eA622D89066'
  }
};

export const LOCAL_CHAIN_CONFIG = {
  rpcUrl: 'http://127.0.0.1:8545',
  chainId: 31337,
  chainName: 'Anvil Localhost',
  addresses: {
    weth: '0xFd36a6C073A99895B9f2750Bb8D00dE3f739FaB4',
    usdc: '0xb59C422eAA62016E3ABc7c3C00aa06549b796507',
    orderBook: '0xC78fcb175A6Ca05A837B231254178F609BECB10a',
    clearingAdapter: '0x790DF89a94E00E5177D34f6451da84Dc3085cc1f',
    settlement: '0x099B5dDFa5Ff6682951A9DD1c06b9eA622D89066'
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
    const provider = new ethers.JsonRpcProvider(ARBITRUM_SEPOLIA_CONFIG.rpcUrl);
    const network = await provider.getNetwork();
    return Number(network.chainId) === ARBITRUM_SEPOLIA_CONFIG.chainId || Number(network.chainId) === LOCAL_CHAIN_CONFIG.chainId;
  } catch {
    return false;
  }
}
