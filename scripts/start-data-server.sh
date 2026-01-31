#!/bin/bash
# 启动 data-server 本地开发环境
#
# 用法:
#   ./scripts/start-data-server.sh                    # 使用默认配置
#   ./scripts/start-data-server.sh --config my.toml   # 指定配置文件

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

CONFIG_FILE="${PROJECT_ROOT}/config/data-server.toml"

# 解析参数
while [[ $# -gt 0 ]]; do
    case $1 in
        --config)
            CONFIG_FILE="$2"
            shift 2
            ;;
        --help)
            echo "Usage: $0 [--config <path>]"
            echo ""
            echo "Options:"
            echo "  --config <path>  Path to config file (default: config/data-server.toml)"
            echo "  --help           Show this help message"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

echo "========================================"
echo "  data-server 本地开发环境"
echo "========================================"
echo ""
echo "Config: ${CONFIG_FILE}"
echo ""

# 检查配置文件
if [ ! -f "$CONFIG_FILE" ]; then
    echo "Warning: Config file not found, using defaults"
fi

# 构建 data-server
echo "Building data-server..."
cargo build --package data-server

# 运行
echo ""
echo "Starting data-server..."
echo "  hbbs (signaling): 0.0.0.0:21116"
echo "  hbbr (relay):     0.0.0.0:21117"
echo ""
echo "Press Ctrl+C to stop"
echo "========================================"
echo ""

RUST_LOG="${RUST_LOG:-info}" DATABASE_URL="${DATABASE_URL:-sqlite://db_v2.sqlite3}" cargo run --package data-server -- --config "$CONFIG_FILE"
