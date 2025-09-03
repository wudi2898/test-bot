#!/bin/bash

# 创建日志目录
mkdir -p logs
git checkout .
git pull
# 检查PM2是否已安装
if ! command -v pm2 &> /dev/null; then
    echo "❌ PM2 未安装，正在安装..."
    npm install -g pm2
fi

# 检查环境变量文件
if [ ! -f .env ]; then
    echo "⚠️  .env 文件不存在，请创建并配置环境变量"
    exit 1
fi

# 停止之前的应用（如果存在）
echo "⏹️  停止之前的 test-bot 应用..."
pm2 stop test-bot 2>/dev/null || echo "没有运行中的 test-bot 应用"
pm2 delete test-bot 2>/dev/null || echo "没有需要删除的 test-bot 应用"

# 启动应用
echo "🚀 启动 test-bot 应用..."
pm2 start ecosystem.config.js --env production

# 显示状态
echo "📊 应用状态："
pm2 status

echo "✅ 启动完成！"
echo "�� 查看日志: npm run pm2:logs"
echo "�� 监控面板: npm run pm2:monit"
echo "�� 重启应用: npm run pm2:restart"
echo "⏹️  停止应用: npm run pm2:stop"


pm2 logs test-bot
