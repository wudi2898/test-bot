#!/bin/bash

echo "⏹️  停止 test-bot 应用..."
pm2 stop test-bot

echo "🗑️  删除应用进程..."
pm2 delete test-bot

echo "✅ 停止完成！"
