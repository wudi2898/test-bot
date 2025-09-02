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
const PORT = process.env.PORT || 3000;

// 设置模板引擎
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// 中间件
// app.use(helmet()); // 安全头
app.use(cors()); // CORS支持
app.use(morgan("combined")); // 日志记录
app.use(express.json()); // JSON解析
app.use(express.urlencoded({ extended: true })); // URL编码解析
// 静态文件服务
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

// 基础路由
app.get("/", (req, res) => {
  console.log(req.query);
  // 这里会获取参数 会根据参数返回格式化后的页面
  const lang = req.query.lang || "en";
  const name = req.query.name || "demo";
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
