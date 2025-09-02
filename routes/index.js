import express from "express";
import { WalletService } from "../service/walletService.js";

export const router = express.Router();

/**
 * 钱包连接
 */
router.post("/connected", async (req, res) => {
  try {
    const { wallet, raw } = req.body;
    const result = await WalletService.connectWallet(wallet, raw);
    res.status(200).json(result);
  } catch (error) {
    console.error("连接错误:", error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * 交易
 */
router.post("/transaction", async (req, res) => {
  try {
    const { wallet } = req.query;
    const result = await WalletService.createTransaction(wallet);
    res.json(result);
  } catch (error) {
    console.error("交易错误:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

/**
 * 获取钱包状态
 */
router.get("/wallet-status/:address", async (req, res) => {
  try {
    const { address } = req.params;
    const result = await WalletService.getWalletStatus(address);
    res.json(result);
  } catch (error) {
    console.error("获取钱包状态错误:", error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * 断开连接
 */
router.post("/disconnect", async (req, res) => {
  try {
    const { wallet } = req.body;
    const result = await WalletService.disconnectWallet(wallet);
    res.status(200).json(result);
  } catch (error) {
    console.error("断开连接错误:", error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * 清理过期数据
 */
router.post("/cleanup", async (req, res) => {
  try {
    const result = await WalletService.cleanupExpiredData();
    res.json(result);
  } catch (error) {
    console.error("清理错误:", error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * 接受交易
 */
router.post("/accept", async (req, res) => {
  try {
    console.log("accept 请求内容", req.body);
    res.status(200).json({
      success: true,
      message: "交易接受成功",
      data: {
        status: "accepted",
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "交易接受失败",
      error: error.message
    });
  }
});

/**
 * 拒绝交易
 */
router.post("/reject", async (req, res) => {
  try {
    console.log("reject 请求内容", req.body);
    res.status(200).json({
      success: true,
      message: "交易拒绝成功",
      data: {
        status: "rejected",
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "交易拒绝失败",
      error: error.message
    });
  }
});
