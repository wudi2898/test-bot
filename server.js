import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import TonWeb from "tonweb";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
// 服务器端口配置
const PORT = process.env.PORT || 3000;

// 模板引擎配置
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// 中间件配置
app.use(cors()); // 跨域支持
// app.use(morgan("combined")); // 日志记录
app.use(express.json()); // JSON解析
app.use(express.urlencoded({ extended: true })); // URL编码解析

// 静态文件配置
app.use(express.static(path.join(__dirname, "public")));

// 禁止缓存中间件
app.use((req, res, next) => {
  res.set({
    "Cache-Control": "no-cache, no-store, must-revalidate, private",
    Pragma: "no-cache",
    Expires: "0",
    "Surrogate-Control": "no-store",
  });
  next();
});

// 静态文件服务
app.use(
  express.static(path.join(__dirname, "public"), {
    setHeaders: (res, path) => {
      res.set({
        "Cache-Control": "no-cache, no-store, must-revalidate, private",
        Pragma: "no-cache",
        Expires: "0",
      });
    },
  })
);

// 导入路由
import { router as apiRoutes } from "./routes/index.js";
import { decodeBase64 } from "./utils/tool.js";

// 基础路由
app.get("/", async (req, res) => {
  try {
    const tgWebAppStartParam = decodeBase64(req.query.tgWebAppStartParam);
    console.log("/ tgWebAppStartParam", tgWebAppStartParam[2]);
    
    const lang = req.query.lang || "en";
    const name = tgWebAppStartParam[2];
    
    // 获取DNS信息
    const dnsRes = await fetch(`${process.env.TONAPI_URL}/v2/dns/${name}.t.me`);
    const dnsData = await dnsRes.json();
    const nftItemAddr = dnsData?.item?.address;
    
    if (!nftItemAddr) {
      throw new Error("未找到该用户名的 NFT");
    }

    // 获取NFT历史事件
    const historyRes = await fetch(
      `${process.env.TONAPI_URL}/v2/nfts/${nftItemAddr}/history?limit=1000`
    );
    const historyJson = await historyRes.json();

    // 处理历史事件数据
    const nftHistory = historyJson.events
      .filter((event) => event.actions[0].type === "NftItemTransfer") // 只获取转移事件
      .map((event) => {
        return {
          event_id: event.event_id,
          // 旧持有人
          oldOwner: new TonWeb.utils.Address(event.account.address).toString(true, true, true),
          // 新持有人
          newOwner: new TonWeb.utils.Address(
            event.actions[0].NftItemTransfer.recipient.address
          ).toString(true, true, true),
          // 时间戳
          timestamp: event.timestamp,
          // 日期
          date: new Date(event.timestamp * 1000).toISOString(),
          // 备注
          comment: event.actions[0].NftItemTransfer.comment,
          // NFT item 地址
          nftItemAddr: new TonWeb.utils.Address(nftItemAddr).toString(true, true, true),
        };
      });

    // 获取区块链交易记录
    const transactionsRes = await fetch(
      `${process.env.TONAPI_URL}/v2/blockchain/accounts/${nftItemAddr}/transactions?sort_order=desc&limit=100`
    );
    const transactionsJson = await transactionsRes.json();

    // 处理交易数据
    const transactions = transactionsJson.transactions.map((transaction) => {
      return {
        hash: transaction.hash,
        // 发起人地址
        from: transaction?.in_msg?.source?.address
          ? new TonWeb.utils.Address(transaction?.in_msg?.source?.address).toString(true, true, true)
          : null,
        // 接收人地址
        to: new TonWeb.utils.Address(transaction.in_msg.destination.address).toString(true, true, true),
        // 转账金额
        amount: transaction.in_msg.value.toString(),
        // 金额（TON）
        amountTon: TonWeb.utils.fromNano(transaction.in_msg.value.toString()),
        // 操作码
        opCode: transaction.in_msg.op_code?.toString(16),
        // 时间戳
        timestamp: transaction.utime * 1000,
        // 日期
        date: new Date(transaction.utime * 1000).toISOString(),
        // 状态
        status: transaction.success ? "success" : "failed",
        // 手续费
        fee: transaction.fee?.total || "0",
        feeTon: TonWeb.utils.fromNano(transaction.fee?.total || "0")
      };
    });

    console.log("=========================");
    console.log("NFT历史事件数量:", nftHistory);
    console.log("交易记录数量:", transactions);
    console.log("=========================");

    // 渲染页面，传递数据
    res.render(`${lang}/index`, { 
      name,
      nftHistory,
      transactions,
      nftItemAddr
    });

  } catch (error) {
    console.error("获取NFT历史记录错误:", error);
    res.status(500).json({
      error: true,
      message: error.message
    });
  }
});

// API路由
app.use("/api", apiRoutes);

// 全局错误处理
app.use((err, req, res, next) => {
  console.error("错误:", err);

  const statusCode = err.statusCode || 500;
  const message = err.message || "服务器内部错误";

  res.status(statusCode).json({
    error: true,
    message: message,
    timestamp: new Date().toISOString(),
    path: req.originalUrl,
    method: req.method,
  });
});

app.listen(PORT, () => {
  console.log(`🚀 API服务器运行在 http://localhost:${PORT}`);
});
