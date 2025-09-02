import Redis from "ioredis";

// Redis配置
const redisConfig = {
  host: process.env.REDIS_HOST,
  port: process.env.REDIS_PORT,
  password: process.env.REDIS_PASSWORD,
  db: process.env.REDIS_DB,
  retryDelayOnFailover: 100,
  maxRetriesPerRequest: 3,
};

// 创建Redis客户端
const redis = new Redis(redisConfig);

// 连接事件处理
redis.on("connect", () => {
  console.log("✅ Redis连接成功");
});

redis.on("error", (err) => {
  console.error("❌ Redis连接错误:", err);
});

redis.on("close", () => {
  console.log("�� Redis连接关闭");
});

export default redis;
