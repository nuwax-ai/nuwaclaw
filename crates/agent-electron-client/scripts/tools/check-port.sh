#!/usr/bin/env bash
# 检查端口是否被占用，输出占用进程 PID（若有），exit 0=占用 exit 1=未占用
# 与 main 进程 startupPorts.ts 内嵌逻辑一致；Windows 依赖集成 Git Bash (prepare-git) 或系统 PATH 中的 netstat/findstr
# 用法: bash check-port.sh PORT

port="$1"
if [[ -z "$port" ]]; then
  echo "usage: check-port.sh PORT" >&2
  exit 2
fi

if [[ "$OSTYPE" == msys* ]] || [[ "$OSTYPE" == cygwin* ]]; then
  # Windows (Git Bash / MSYS2): 使用 cmd 的 netstat + findstr
  out=$(cmd //c "netstat -ano 2>nul | findstr \":${port} \"" 2>/dev/null)
else
  # macOS / Linux
  out=$(lsof -t -i ":${port}" 2>/dev/null)
fi

if [[ -n "$out" ]]; then
  # 取首行最后一列作为 PID（netstat 最后一列是 PID；lsof -t 整行即 PID）
  pid=$(echo "$out" | head -1 | awk '{print $NF}')
  if [[ -n "$pid" && "$pid" =~ ^[0-9]+$ ]]; then
    echo "$pid"
  fi
  exit 0
fi
exit 1
