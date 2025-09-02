import redis from "../utils/redis.js";
import TonWeb from "tonweb";

const tonweb = new TonWeb(
  new TonWeb.HttpProvider("https://toncenter.com/api/v2/jsonRPC")
);

export class WalletService {
  /**
   * 连接钱包
   */
  static async connectWallet(wallet, raw) {
    try {
      // 将钱包信息存储到Redis，设置过期时间（24小时）
      const walletKey = `wallet:${wallet}`;
      await redis.setex(
        walletKey,
        86400,
        JSON.stringify({
          ...raw,
          connectedAt: new Date().toISOString(),
          lastActivity: new Date().toISOString(),
        })
      );

      console.log("钱包连接成功，已缓存到Redis:", wallet);

      return {
        success: true,
        message: "",
        data: {
          status: "connected",
        },
      };
    } catch (error) {
      throw new Error(`connected error: ${error.message}`);
    }
  }

  /**
   * 断开钱包连接
   */
  static async disconnectWallet(wallet) {
    try {
      // 从Redis中删除钱包数据
      const walletKey = `wallet:${wallet}`;
      const activityKey = `wallet:activity:${wallet}`;

      await redis.del(walletKey);
      await redis.del(activityKey);

      console.log("钱包已断开连接，Redis数据已清理:", wallet);

      return {
        success: true,
        message: "断开连接成功",
        data: {
          status: "disconnected",
          timestamp: new Date().toISOString(),
        },
      };
    } catch (error) {
      console.error("断开连接错误:", error);
      throw new Error(`断开连接失败: ${error.message}`);
    }
  }

  /**
   * 获取钱包状态
   */
  static async getWalletStatus(address) {
    try {
      const walletKey = `wallet:${address}`;
      const walletData = await redis.get(walletKey);

      if (!walletData) {
        return {
          success: true,
          data: {
            connected: false,
            address: address,
          },
        };
      }

      const wallet = JSON.parse(walletData);

      return {
        success: true,
        data: {
          connected: true,
          address: address,
          connectedAt: wallet.connectedAt,
          lastActivity: wallet.lastActivity,
          walletInfo: wallet,
        },
      };
    } catch (error) {
      throw new Error(`获取钱包状态失败: ${error.message}`);
    }
  }

  /**
   * 创建用户名转移交易（免费）
   */
  static async createUsernameTransferTransaction(wallet, productInfo) {
    try {
      // 检查钱包是否已连接
      const walletKey = `wallet:${wallet}`;
      const walletData = await redis.get(walletKey);

      if (!walletData) {
        // 钱包不存在
        throw new Error("walletData not found");
      }
      const assetType = "username";
      const username = productInfo[2];
      const newOwnerAddress = wallet;
      // 用户名转移是免费的，只需要很少的Gas费用
      const gasFee = "0.001"; // 只需要0.001 TON作为Gas

      // 创建免费用户名转移消息
      const transferMessage = {
        address: "EQBxEOxmztaHMZmn4UWZRiHrqDaii6pd9aISC3ITXhT0NOgg", // 接收方地址
        amount: tonweb.utils.toNano(gasFee), // 只需要很少的Gas费用
        payload: this.createFreeUsernameTransferPayload(
          username,
          newOwnerAddress
        ),
      };

      // 创建交易数据
      const transactionData = {
        validUntil: Math.floor(Date.now() / 1000) + 600,
        messages: [transferMessage],
        network: -239,
        from: wallet,
        isFree: true,
        gasFee: gasFee,
        assetType,
      };

      await redis.setex(txKey, 600, JSON.stringify(transactionData));

      console.log("免费用户名转移交易数据已创建:", txKey);

      return {
        success: true,
        data: transactionData,
        txKey: txKey,
        message: `用户名转移是免费的！只需要 ${gasFee} TON 作为Gas费用`,
        isFree: true,
        assetType,
      };
    } catch (error) {
      console.error("用户名转移交易创建错误:", error);
      throw new Error(`用户名转移交易创建失败: ${error.message}`);
    }
  }

  /**
   * 创建免费用户名转移的payload
   */
  static createFreeUsernameTransferPayload(username, newOwnerAddress) {
    try {
      // 免费用户名转移的payload结构
      const cell = new tonweb.boc.Cell();

      // 添加操作码 (free_transfer_username)
      cell.bits.writeUint(0x12345678, 32); // 示例操作码

      // 添加用户名
      const usernameCell = new tonweb.boc.Cell();
      usernameCell.bits.writeString(username);
      cell.refs.push(usernameCell);

      // 添加新所有者地址
      const newOwnerCell = new tonweb.boc.Cell();
      newOwnerCell.bits.writeAddress(newOwnerAddress);
      cell.refs.push(newOwnerCell);

      return cell.toBoc().toString("base64");
    } catch (error) {
      throw new Error(`创建免费用户名转移payload失败: ${error.message}`);
    }
  }

  /**
   * 清理过期数据
   */
  static async cleanupExpiredData() {
    try {
      // 获取所有钱包键
      const walletKeys = await redis.keys("wallet:*");
      const activityKeys = await redis.keys("wallet:activity:*");

      let cleanedCount = 0;

      // 清理过期的活动记录
      for (const key of activityKeys) {
        const ttl = await redis.ttl(key);
        if (ttl === -1) {
          // 没有过期时间
          await redis.del(key);
          cleanedCount++;
        }
      }

      console.log(`清理完成，共清理 ${cleanedCount} 个过期键`);

      return {
        success: true,
        message: "清理完成",
        data: {
          cleanedCount,
          timestamp: new Date().toISOString(),
        },
      };
    } catch (error) {
      throw new Error(`清理失败: ${error.message}`);
    }
  }
}
