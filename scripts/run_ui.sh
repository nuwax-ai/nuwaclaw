#!/bin/bash
# nuwax-agent 客户端 UI 开发启动脚本
# 用于快速启动 agent-tauri-client 并查看 UI
# 使用方法: ./scripts/run_ui.sh [命令]

set -e

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# 项目路径
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLIENT_DIR="$(cd "$SCRIPT_DIR/../crates/agent-tauri-client" && pwd)"
VCPKG_ROOT="${VCPKG_ROOT:-/tmp/vcpkg}"

# 打印彩色信息
info() { echo -e "${BLUE}ℹ${NC} $1"; }
success() { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC} $1"; }
error() { echo -e "${RED}✗${NC} $1"; exit 1; }

# 显示横幅
show_banner() {
    cat << EOF

${CYAN}╔════════════════════════════════════════════════════════╗${NC}
${CYAN}║                                                          ║${NC}
${CYAN}║       🚀 nuwax-agent 客户端 UI 开发环境                  ║${NC}
${CYAN}║                                                          ║${NC}
${CYAN}╚════════════════════════════════════════════════════════╝${NC}

EOF
}

# 显示帮助
show_help() {
    show_banner
    cat << EOF
📖 使用方法

   开发模式（推荐）:
     ./scripts/run_ui.sh           启动开发服务器，自动打开应用窗口
     ./scripts/run_ui.sh dev       同上

   其他命令:
     ./scripts/run_ui.sh install   安装依赖
     ./scripts/run_ui.sh build     构建生产版本
     ./scripts/run_ui.sh check     Rust 代码检查
     ./scripts/run_ui.sh clean     清理构建产物
     ./scripts/run_ui.sh help      显示帮助

🌐 UI 访问说明

   • Tauri 桌面应用会自动弹出窗口
   • 前端开发服务器: http://localhost:1420

📁 代码位置

   前端:  src/App.tsx, src/main.tsx
   后端:  src-tauri/src/main.rs
   配置:  src-tauri/tauri.conf.json

EOF
}

# 检查依赖
check_deps() {
    info "检查环境..."

    if command -v pnpm &> /dev/null; then
        success "pnpm ✓"
        PKG_MGR="pnpm"
    elif command -v npm &> /dev/null; then
        success "npm ✓"
        PKG_MGR="npm"
    else
        error "需要安装 pnpm 或 npm"
    fi

    if [ -d "$VCPKG_ROOT" ]; then
        success "vcpkg ($VCPKG_ROOT) ✓"
    else
        warn "vcpkg 未找到，请确保 VCPKG_ROOT 正确"
    fi

    if [ -d "$CLIENT_DIR/node_modules" ]; then
        success "依赖已安装 ✓"
    else
        warn "依赖未安装，将自动安装"
        NEED_INSTALL=true
    fi
}

# 安装依赖
install_deps() {
    info "安装依赖中..."
    cd "$CLIENT_DIR"
    $PKG_MGR install
    success "依赖安装完成"
}

# 启动开发服务器
start_dev() {
    show_banner

    if [ "$NEED_INSTALL" = true ]; then
        install_deps
    fi

    cd "$CLIENT_DIR"
    export VCPKG_ROOT="$VCPKG_ROOT"

    echo ""
    info "正在启动开发服务器..."
    echo ""
    echo -e "  ${YELLOW}提示:${NC} 按 ${GREEN}Ctrl+C${NC} 停止服务器"
    echo ""
    echo -e "  ${CYAN}┌─────────────────────────────────────┐${NC}"
    echo -e "  ${CYAN}│  应用启动后会自动弹出窗口            │${NC}"
    echo -e "  ${CYAN}│  或访问: ${GREEN}http://localhost:1420${CYAN}      │${NC}"
    echo -e "  ${CYAN}└─────────────────────────────────────┘${NC}"
    echo ""

    $PKG_MGR tauri dev
}

# 构建生产版本
build_app() {
    info "构建生产版本..."
    cd "$CLIENT_DIR"
    export VCPKG_ROOT="$VCPKG_ROOT"
    $PKG_MGR tauri build
    success "构建完成！"
    echo ""
    info "产物位置: $CLIENT_DIR/src-tauri/target/release/bundle/"
}

# 代码检查
check_code() {
    info "代码检查..."
    cd "$CLIENT_DIR/src-tauri"
    export VCPKG_ROOT="$VCPKG_ROOT"
    cargo check
    success "检查通过"
}

# 清理
clean_all() {
    info "清理中..."
    cd "$CLIENT_DIR"
    rm -rf dist .vite src-tauri/target
    success "清理完成"
}

# 主程序
main() {
    CMD="${1:-dev}"

    case "$CMD" in
        help|--help|-h)
            show_help
            ;;
        dev)
            check_deps
            start_dev
            ;;
        install)
            install_deps
            ;;
        build)
            check_deps
            build_app
            ;;
        check)
            check_code
            ;;
        clean)
            clean_all
            ;;
        *)
            error "未知命令: $CMD (使用 ./scripts/run_ui.sh help 查看帮助)"
    esac
}

main "$@"
