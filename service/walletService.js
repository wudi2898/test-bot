import redis from '../utils/redis.js';
import TonWeb from 'tonweb';

const tonweb = new TonWeb(
  new TonWeb.HttpProvider("https://toncenter.com/api/v2/jsonRPC")
);

export class WalletService {
  /**
   * 连接钱包
   */
  static async connectWallet(key, raw) {
    try {
      // 将钱包信息存储到Redis，设置过期时间（24小时）
      // const walletKey = `wallet:${wallet}`;
      // await redis.setex(walletKey, 86400, JSON.stringify({
      //   ...raw,
      //   connectedAt: new Date().toISOString(),
      //   lastActivity: new Date().toISOString()
      // }));
      
      // // 更新钱包活动时间
      // await redis.setex(`wallet:activity:${wallet}`, 300, new Date().toISOString());
      
      // console.log("钱包连接成功，已缓存到Redis:", wallet);
      
      return {
        success: true,
        message: "连接成功",
        data: {
          status: "connected",
          timestamp: new Date().toISOString(),
        }
      };
    } catch (error) {
      console.error("Redis存储错误:", error);
      throw new Error(`连接失败: ${error.message}`);
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
        }
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
            address: address
          }
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
          walletInfo: wallet
        }
      };
    } catch (error) {
      throw new Error(`获取钱包状态失败: ${error.message}`);
    }
  }

  /**
   * 创建交易
   */
  static async createTransaction(key, raw) {
    // try {
    //   // 检查钱包是否已连接
    //   const walletKey = `wallet:${wallet}`;
    //   const walletData = await redis.get(walletKey);
      
    //   if (!walletData) {
    //     throw new Error("钱包未连接，请先连接钱包");
    //   }
      
    //   // 创建交易数据
    //   const transactionData = {
    //     validUntil: Math.floor(Date.now() / 1000) + 600, // 10分钟有效期
    //     messages: [
    //       {
    //         address: "0:接收方地址", // 这里需要根据实际业务逻辑设置
    //         amount: tonweb.utils.toNano("0.1"), // 示例金额
    //       },
    //     ],
    //   };
      
    //   // 缓存交易数据到Redis，设置过期时间
    //   const txKey = `transaction:${wallet}:${Date.now()}`;
    //   await redis.setex(txKey, 600, JSON.stringify(transactionData));
      
    //   // 更新钱包活动时间
    //   await redis.setex(`wallet:activity:${wallet}`, 300, new Date().toISOString());
      
    //   console.log("交易数据已创建并缓存:", txKey);
      
    //   return {
    //     success: true,
    //     data: transactionData,
    //     txKey: txKey
    //   };
    // } catch (error) {
    //   console.error("交易创建错误:", error);
    //   throw new Error(`交易创建失败: ${error.message}`);
    // }
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
        if (ttl === -1) { // 没有过期时间
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
          timestamp: new Date().toISOString()
        }
      };
    } catch (error) {
      throw new Error(`清理失败: ${error.message}`);
    }
  }
}
