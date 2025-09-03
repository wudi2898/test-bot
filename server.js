import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

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
  const tgWebAppStartParam = decodeBase64(req.query.tgWebAppStartParam);
  console.log("/ tgWebAppStartParam", tgWebAppStartParam[2]);
  // 这里会获取参数 会根据参数返回格式化后的页面
  const lang = req.query.lang || "en";
  const name = tgWebAppStartParam[2];
  const dnsRes = await fetch(`${process.env.TONAPI_URL}/v2/dns/${name}.t.me`, {
    headers: { Authorization: `Bearer ${process.env.TONAPI_KEY}` },
  });
  const dnsData = await dnsRes.json();
  console.log("dnsData", JSON.stringify(dnsData, null, 2)); 
  const nftItemAddr = dnsData?.item?.address;
  if (!nftItemAddr) throw new Error("未找到该用户名的 NFT");
  const historyRes = await fetch(
    `${process.env.TONAPI_URL}/v2/nfts/${nftItemAddr}/history`,
    {
      headers: { Authorization: `Bearer ${process.env.TONAPI_KEY}` },
    }
  );
  const historyJson = await historyRes.json();

  // const transactionsRes = await fetch(
  //   `${process.env.TONAPI_URL}/v2/blockchain/accounts/${nftItemAddr}/transactions?sort_order=desc`,
  //   {
  //     headers: { Authorization: `Bearer ${process.env.TONAPI_KEY}` },
  //   }
  // );
  // const transactionsJson = await transactionsRes.json();

  console.log("=========================");

  // console.log("transactionsJson", JSON.stringify(transactionsJson, null, 2));
  console.log("historyJson", JSON.stringify(historyJson, null, 2));
  console.log("=========================");
  res.render(`${lang}/index`, { name });
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
