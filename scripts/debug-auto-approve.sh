#!/bin/bash
# 监控 NuwaClaw 日志，检测到 permission pending 后自动 curl 审批
LOGFILE="$HOME/.nuwaclaw/logs/latest.log"
echo "🔍 监控 permission pending 事件..."
tail -f "$LOGFILE" | while read -r line; do
  if echo "$line" | grep -q "Permission pending (ask mode).*itv_"; then
    ITV_ID=$(echo "$line" | grep -oE 'itv_[a-f0-9]+')
    echo ""
    echo "🎯 捕获 permission pending: $ITV_ID"
    echo "⏳ 等待 1s 后自动审批..."
    sleep 1
    RESP=$(curl -s -X POST http://127.0.0.1:60006/computer/notify-resolved \
      -H "Content-Type: application/json" \
      -d "{\"interventionId\":\"$ITV_ID\",\"optionId\":\"approve\"}")
    echo "✅ 审批结果: $RESP"
  fi
done
