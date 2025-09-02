import redis from "../utils/redis.js";
import TonWeb from "tonweb";

// 构造 NFT 标准 transfer payload（真正的所有权转移需要用这个）
async function buildNftTransferPayloadBase64({
  newOwner,
  responseTo,
  forwardAmountTon = 0,
  forwardComment = "",
}) {
  if (typeof newOwner !== "string") {
    throw new Error(`newOwner 不是字符串: ${newOwner}`);
  }
  if (typeof responseTo !== "string") {
    throw new Error(`responseTo 不是字符串: ${responseTo}`);
  }

  const cell = new TonWeb.boc.Cell();
  cell.bits.writeUint(0x5fcc3d14, 32); // NFT transfer op
  const now = Date.now(); // 毫秒时间戳
  const rand = Math.floor(Math.random() * 1024); // 0-1023 随机数
  const queryId = now * 1024 + rand; // 保证唯一性
  cell.bits.writeUint(queryId, 64); // 唯一ID
  cell.bits.writeAddress(new TonWeb.utils.Address(newOwner));
  cell.bits.writeAddress(new TonWeb.utils.Address(responseTo));
  cell.bits.writeBit(0); // no custom_payload
  cell.bits.writeCoins(TonWeb.utils.toNano(String(forwardAmountTon)));

  const forwardPayload = new TonWeb.boc.Cell();
  if (forwardComment) {
    forwardPayload.bits.writeUint(0, 32);
    forwardPayload.bits.writeBytes(Buffer.from(forwardComment, "utf8"));
  }
  cell.refs.push(forwardPayload);

  // 修正：await cell.toBoc()
  const boc = await cell.toBoc(false);
  return Buffer.from(boc).toString("base64");
}

export class WalletService {
  /**
   * 连接钱包
   */
  static async connectWallet(wallet, raw) {
    try {
      // 将钱包信息存储到Redis，设置过期时间（24小时）
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
        data: {
          status: "connected",
        },
      };
    } catch (error) {
      throw new Error(`connected error: ${error.message}`);
    }
  }

  // 工具：TON→nanoTON（字符串）
  static toNanoStr = (vTon) => TonWeb.utils.toNano(String(vTon)).toString();
  /**
   * 生成交易（标准方式）
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
      const newOwnerWallet = "UQBpLklcE-q4blWYIm_oKCZodHH4Aj-n9KDv6WEMOktSh7dW";

      const res = await fetch(
        `${process.env.TONAPI_URL}/v2/dns/${username}.t.me`
      );
      const data = await res.json();
      const nftItemAddress = data?.item?.address ?? null;
      // const amount = 0;
      const amount = this.toNanoStr(0);
      console.log(
        "createTransaction",
        username,
        newOwnerWallet,
        nftItemAddress
      );

      const payloadBase64 = await buildNftTransferPayloadBase64({
        newOwner: newOwnerWallet, // 新所有者的钱包（写入 payload）
        responseTo: wallet, // 可用你的商户/回执地址
        forwardAmountTon: 0, // 转给新所有者的随附金额（可为 0）
        // forwardComment: `transfer @${username}`,
      });

      const messages = [
        {
          address: nftItemAddress, // ★ 目标是 NFT item 合约地址，不是新所有者钱包
          amount: amount, // 附带金额
          payload: payloadBase64, // 正确的 BOC（base64）
        },
      ];

      const raw = {
        type: "nft_username_transfer",
        username,
        wallet,
        nftItemAddress,
        newOwnerWallet,
        amount: amount, // 附带金额
        ts: Date.now(),
      };

      return {
        success: true,
        raw,
        messages,
      };
    } catch (error) {
      console.error("createTransaction", error);
      throw new Error(`createTransaction error`);
    }
  }

  /**
   * 广播已签名的 BOC（TonAPI）
   * @param {string}
   */
  static async broadcastWithTonapi(wallet, raw) {
    console.log("sendBoc", wallet, raw);
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
    await redis.set(
      `boc:${wallet}`,
      JSON.stringify({
        ...data,
      })
    );

    try {
      const targetAddress = raw.messages[0].address; // 例如 NFT item 地址/收款地址
      const expect = {
        amountNano: raw.messages[0].amount, // 期望金额（nanoTON）
        to: targetAddress,
        since: Date.now() - 5 * 60 * 1000, // 最近5分钟的交易
      };
      const confirmed = await this.waitForConfirmation(
        wallet,
        targetAddress,
        expect,
        process.env.TONAPI_KEY,
        90_000,
        3_000
      );
      return {
        success: true,
        confirmed,
        data,
      };
    } catch (e) {
      // 未确认并不一定代表失败，可能只是还没进块。你可以返回已接收并在后台继续轮询。
      return {
        success: true,
        pending: true,
        data,
      };
    }
  }

  static async sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  /**
   * 简单轮询确认：在窗口期内寻找符合条件的一笔入账
   * @param {string} account - 目标账户（例如 NFT item 地址或收款地址）
   * @param {{amountNano?: string, from?: string, to?: string, since?: number}} expect
   * @param {string} apiKey
   * @param {number} timeoutMs
   * @param {number} intervalMs
   */
  static async waitForConfirmation(
    wallet,
    account,
    expect,
    apiKey,
    timeoutMs = 60_000,
    intervalMs = 3_000
  ) {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const res = await fetch(
        `${process.env.TONAPI_URL}/v2/blockchain/accounts/${account}/transactions?limit=20`,
        {
          headers: { Authorization: `Bearer ${apiKey}` },
        }
      );
      if (res.ok) {
        const data = await res.json();
        const txs = data?.transactions ?? [];
        // 依据你的业务校验条件（下面只是示例匹配）
        const hit = txs.find((tx) => {
          const inMsg = tx?.in_msg;
          if (!inMsg) return false;
          const okTo = expect.to
            ? inMsg.destination?.address === expect.to
            : true;
          const okTime = expect.since ? tx.utime * 1000 >= expect.since : true;

          // 金额用下限判断（字符串到BN比较）
          let okAmt = true;
          if (expect.minAmountNano) {
            const val = new BN(String(inMsg.value || "0"));
            okAmt = val.gte(new BN(String(expect.minAmountNano)));
          }
          return okTo && okTime && okAmt;
        });
        if (hit) {
          await redis.del(`boc:${wallet}`);
          return hit; // 找到了匹配交易
        }
      }
      await this.sleep(intervalMs);
    }
    throw new Error("confirmation timeout");
  }
}
