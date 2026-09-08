import { ethers } from 'ethers';
import { LOCAL_CHAIN_CONFIG } from './contractsConfig';
import type { OrderItem } from './types';

// Complete ABIs matching deployed contracts
const ORDERBOOK_ABI = [
  'function submitOrder(bool isBuy, uint256 amount, uint256 limitPrice) external returns (uint256 orderId)',
  'function cancelOrder(uint256 orderId) external',
  'function closeBatch() external returns (uint256 closedBatchId)',
  'function currentBatchId() external view returns (uint256)',
  'function getBatchOrderIds(uint256 batchId) external view returns (uint256[])',
  'function getOrder(uint256 orderId) external view returns (tuple(uint256 id, address trader, bool isBuy, uint256 amount, uint256 limitPrice, uint256 batchId, uint8 status))',
  'function getCurrentBatch() external view returns (tuple(uint256 id, uint8 status, uint256 startTime, uint256 endTime, uint256[] orderIds))',
  'function getBatch(uint256 batchId) external view returns (tuple(uint256 id, uint8 status, uint256 startTime, uint256 endTime, uint256[] orderIds))',
  'event OrderSubmitted(uint256 indexed orderId, address indexed trader, bool isBuy, uint256 amount, uint256 limitPrice, uint256 currentBatchId)',
  'event OrderCancelled(uint256 indexed orderId)',
  'event BatchClosed(uint256 indexed batchId, uint256 orderCount)'
];

const ERC20_ABI = [
  'function mint(address to, uint256 amount) external',
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function balanceOf(address account) external view returns (uint256)',
  'function allowance(address owner, address spender) external view returns (uint256)'
];

export interface OnChainReceipt {
  txHash: string;
  blockNumber: number;
  gasUsed: string;
}

export class OnChainClient {
  private provider: ethers.JsonRpcProvider;
  private signer: ethers.Signer;
  private orderBook: ethers.Contract;
  private weth: ethers.Contract;
  private usdc: ethers.Contract;

  constructor(signer?: ethers.Signer) {
    this.provider = new ethers.JsonRpcProvider(LOCAL_CHAIN_CONFIG.rpcUrl);
    // Use provided signer or default Anvil funded account 0
    this.signer =
      signer ||
      new ethers.Wallet('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', this.provider);

    this.orderBook = new ethers.Contract(LOCAL_CHAIN_CONFIG.addresses.orderBook, ORDERBOOK_ABI, this.signer);
    this.weth = new ethers.Contract(LOCAL_CHAIN_CONFIG.addresses.weth, ERC20_ABI, this.signer);
    this.usdc = new ethers.Contract(LOCAL_CHAIN_CONFIG.addresses.usdc, ERC20_ABI, this.signer);
  }

  async isChainAlive(): Promise<boolean> {
    try {
      const net = await this.provider.getNetwork();
      return Number(net.chainId) === LOCAL_CHAIN_CONFIG.chainId;
    } catch {
      return false;
    }
  }

  async getBlockNumber(): Promise<number> {
    return await this.provider.getBlockNumber();
  }

  async getBalances(account: string): Promise<{ weth: string; usdc: string }> {
    try {
      const wethBal = await this.weth.balanceOf(account);
      const usdcBal = await this.usdc.balanceOf(account);
      return {
        weth: ethers.formatEther(wethBal),
        usdc: ethers.formatUnits(usdcBal, 6)
      };
    } catch {
      return { weth: '0.0', usdc: '0.0' };
    }
  }

  async mintAndApprove(account: string): Promise<OnChainReceipt> {
    const wethAmount = ethers.parseEther('100.0');
    const usdcAmount = ethers.parseUnits('300000.0', 6);
    const signerAddr = await this.signer.getAddress();

    let currentNonce = await this.provider.getTransactionCount(signerAddr, 'pending');

    // 1. Mint WETH
    const tx1 = await this.weth.mint(account, wethAmount, { nonce: currentNonce++ });
    await tx1.wait();

    // 2. Mint USDC
    const tx2 = await this.usdc.mint(account, usdcAmount, { nonce: currentNonce++ });
    await tx2.wait();

    // 3. Approve WETH if needed
    const wethAllowance = await this.weth.allowance(account, LOCAL_CHAIN_CONFIG.addresses.settlement);
    if (wethAllowance < ethers.parseEther('10000')) {
      const tx3 = await this.weth.approve(LOCAL_CHAIN_CONFIG.addresses.settlement, ethers.MaxUint256, { nonce: currentNonce++ });
      await tx3.wait();
    }

    // 4. Approve USDC if needed
    const usdcAllowance = await this.usdc.allowance(account, LOCAL_CHAIN_CONFIG.addresses.settlement);
    let receipt;
    if (usdcAllowance < ethers.parseUnits('1000000', 6)) {
      const tx4 = await this.usdc.approve(LOCAL_CHAIN_CONFIG.addresses.settlement, ethers.MaxUint256, { nonce: currentNonce++ });
      receipt = await tx4.wait();
    } else {
      receipt = await tx2.wait();
    }

    return {
      txHash: receipt ? receipt.hash : tx2.hash,
      blockNumber: receipt ? receipt.blockNumber : await this.provider.getBlockNumber(),
      gasUsed: receipt ? receipt.gasUsed.toString() : '68000'
    };
  }

  async submitOrder(
    isBuy: boolean,
    amountWETH: number,
    limitPriceUSDC: number
  ): Promise<{ orderId: number; receipt: OnChainReceipt }> {
    const amountWei = ethers.parseEther(amountWETH.toString());
    const limitPriceScaled = BigInt(Math.round(limitPriceUSDC * 1e8));
    const signerAddr = await this.signer.getAddress();
    const nonce = await this.provider.getTransactionCount(signerAddr, 'pending');

    const tx = await this.orderBook.submitOrder(isBuy, amountWei, limitPriceScaled, { nonce });
    const receipt = await tx.wait();

    // Extract OrderSubmitted event
    let orderId = 1;
    for (const log of receipt.logs) {
      try {
        const parsed = this.orderBook.interface.parseLog(log);
        if (parsed && parsed.name === 'OrderSubmitted') {
          orderId = Number(parsed.args[0]);
          break;
        }
      } catch {
        // ignore other logs
      }
    }

    return {
      orderId,
      receipt: {
        txHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString()
      }
    };
  }

  async cancelOrder(orderId: number): Promise<OnChainReceipt> {
    const signerAddr = await this.signer.getAddress();
    const nonce = await this.provider.getTransactionCount(signerAddr, 'pending');
    const tx = await this.orderBook.cancelOrder(orderId, { nonce });
    const receipt = await tx.wait();
    return {
      txHash: receipt.hash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString()
    };
  }

  async forwardTimeAndCloseBatch(): Promise<{ closedBatchId: number; receipt: OnChainReceipt }> {
    // Forward Anvil EVM timestamp by 46 seconds to satisfy batchWindowSeconds
    await this.provider.send('evm_increaseTime', [46]);
    await this.provider.send('evm_mine', []);

    const signerAddr = await this.signer.getAddress();
    const nonce = await this.provider.getTransactionCount(signerAddr, 'pending');
    const tx = await this.orderBook.closeBatch({ nonce });
    const receipt = await tx.wait();

    let closedBatchId = 1;
    for (const log of receipt.logs) {
      try {
        const parsed = this.orderBook.interface.parseLog(log);
        if (parsed && parsed.name === 'BatchClosed') {
          closedBatchId = Number(parsed.args[0]);
          break;
        }
      } catch {
        // ignore
      }
    }

    return {
      closedBatchId,
      receipt: {
        txHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString()
      }
    };
  }

  async fetchOnChainOrders(batchId: number): Promise<OrderItem[]> {
    try {
      const orderIds: bigint[] = await this.orderBook.getBatchOrderIds(batchId);
      const orders: OrderItem[] = [];

      for (const id of orderIds) {
        const o = await this.orderBook.getOrder(id);
        const statusNum = Number(o.status);
        const statusStr: 'PENDING' | 'CANCELLED' | 'FILLED' =
          statusNum === 2 ? 'CANCELLED' : statusNum === 1 ? 'FILLED' : 'PENDING';

        orders.push({
          id: Number(o.id),
          trader: o.trader,
          isBuy: o.isBuy,
          amount: parseFloat(ethers.formatEther(o.amount)),
          limitPrice: Number(o.limitPrice) / 1e8,
          batchId: Number(o.batchId),
          status: statusStr
        });
      }

      return orders;
    } catch {
      return [];
    }
  }
}
