# nuwax-agent Makefile
# 用于本地开发、测试和打包

# ============================================================================
# 变量配置
# ============================================================================

# vcpkg 路径（可通过环境变量覆盖）
VCPKG_ROOT ?= $(HOME)/vcpkg

# 默认目标平台
UNAME_S := $(shell uname -s)
UNAME_M := $(shell uname -m)
# scrap 期望的 vcpkg triplet：macOS arm64 -> arm64-osx，x86_64 -> x64-osx
ifeq ($(UNAME_S),Darwin)
  ifeq ($(UNAME_M),arm64)
    VCPKG_TRIPLET ?= arm64-osx
  else
    VCPKG_TRIPLET ?= x64-osx
  endif
endif

# Cargo 命令（必须带 VCPKG_ROOT，否则 scrap 会退回到 Homebrew 找 libyuv 并失败）
CARGO := VCPKG_ROOT=$(VCPKG_ROOT) cargo

# 客户端 crate 名称
CLIENT := nuwax-gpui-agent

# 构建模式
RELEASE_FLAGS := --release
DEBUG_FLAGS :=

# 默认 features
DEFAULT_FEATURES := tray,auto-launch,dependency-management
ALL_FEATURES := tray,auto-launch,dependency-management,remote-desktop,chat-ui,file-transfer,dev-mode

# ============================================================================
# 帮助信息
# ============================================================================

.PHONY: help
help:
	@echo "nuwax-agent Makefile"
	@echo ""
	@echo "使用方法: make [target]"
	@echo ""
	@echo "=== 构建 ==="
	@echo "  build          - 构建客户端 (debug)"
	@echo "  build-release  - 构建客户端 (release)"
	@echo "  build-all      - 构建所有功能 (debug)"
	@echo "  build-all-release - 构建所有功能 (release)"
	@echo ""
	@echo "=== 运行 ==="
	@echo "  run            - 运行客户端 (debug, 所有功能)"
	@echo "  run-release    - 运行客户端 (release, 所有功能)"
	@echo "  run-dev        - 运行客户端 (开发模式)"
	@echo ""
	@echo "=== 测试 ==="
	@echo "  test           - 运行单元测试"
	@echo "  test-all       - 运行所有测试（含集成测试）"
	@echo "  test-e2e       - 运行端到端测试（需要 data-server）"
	@echo "  test-e2e-quick - 快速连接测试（需要 data-server）"
	@echo "  test-admin     - 管理端通信测试（需要 admin-server）"
	@echo "  test-admin-full- 管理端完整流程测试"
	@echo ""
	@echo "=== 代码检查 ==="
	@echo "  check          - 代码检查 (cargo check)"
	@echo "  clippy         - Clippy 代码分析"
	@echo "  fmt            - 格式化代码"
	@echo "  fmt-check      - 检查代码格式"
	@echo ""
	@echo "=== 打包 ==="
	@echo "  package        - 打包客户端 (当前平台)"
	@echo "  package-dmg    - 打包 macOS DMG"
	@echo "  package-msi    - 打包 Windows MSI"
	@echo "  package-deb    - 打包 Linux DEB"
	@echo ""
	@echo "=== Tauri 应用打包 ==="
	@echo "  tauri-bundle       - 打包 Tauri 应用 (默认生产环境)"
	@echo "  tauri-bundle-test  - 打包 Tauri 应用 (测试环境)"
	@echo "  tauri-bundle-prod  - 打包 Tauri 应用 (生产环境)"
	@echo "  tauri-bundle-all   - 打包 Tauri 所有平台 (macOS/Windows/Linux)"
	@echo "  tauri-dev          - 运行 Tauri 开发模式"
	@echo ""
	@echo "=== 依赖 ==="
	@echo "  setup-repo     - 初始化 Git 子模块（含嵌套的 hbb_common）"
	@echo "  setup-vcpkg    - 安装 vcpkg 和依赖"
	@echo "  update-deps    - 更新 Cargo 依赖"
	@echo ""
	@echo "=== 清理 ==="
	@echo "  clean          - 清理构建产物"
	@echo "  clean-all      - 清理所有（含 vcpkg）"
	@echo ""
	@echo "=== 服务 (Docker) ==="
	@echo "  start-server   - 启动 RustDesk 服务器 (Docker)"
	@echo "  stop-server    - 停止 RustDesk 服务器"
	@echo "  restart-server - 重启 RustDesk 服务器"
	@echo "  server-logs    - 查看服务器日志"
	@echo "  server-status  - 查看服务器状态"
	@echo "  server-key     - 显示服务器公钥"
	@echo "  start-admin    - 启动 agent-server-admin"
	@echo "  start-all      - 显示启动所有服务的步骤"
	@echo ""
	@echo "环境变量:"
	@echo "  VCPKG_ROOT     - vcpkg 路径 (当前: $(VCPKG_ROOT))"
	@echo "  RUST_LOG       - 日志级别 (例: debug, info, warn)"

# ============================================================================
# 构建目标
# ============================================================================

.PHONY: build
build:
	@echo ">>> 构建客户端 (debug)..."
	$(CARGO) build -p $(CLIENT)

.PHONY: build-release
build-release:
	@echo ">>> 构建客户端 (release)..."
	$(CARGO) build -p $(CLIENT) $(RELEASE_FLAGS)

.PHONY: build-all
build-all:
	@echo ">>> 构建客户端 - 所有功能 (debug)..."
	$(CARGO) build -p $(CLIENT) --all-features

.PHONY: build-all-release
build-all-release:
	@echo ">>> 构建客户端 - 所有功能 (release)..."
	$(CARGO) build -p $(CLIENT) --all-features $(RELEASE_FLAGS)

.PHONY: build-workspace
build-workspace:
	@echo ">>> 构建整个 workspace..."
	$(CARGO) build --workspace

# ============================================================================
# 运行目标
# ============================================================================

.PHONY: run
run:
	@echo ">>> 运行客户端 (debug, 所有功能)..."
	$(CARGO) run -p $(CLIENT) --all-features

.PHONY: run-release
run-release:
	@echo ">>> 运行客户端 (release)..."
	$(CARGO) run -p $(CLIENT) --all-features $(RELEASE_FLAGS)

.PHONY: run-dev
run-dev:
	@echo ">>> 运行客户端 (开发模式)..."
	RUST_LOG=debug $(CARGO) run -p $(CLIENT) --all-features

# ============================================================================
# 测试目标
# ============================================================================

.PHONY: test
test:
	@echo ">>> 运行单元测试..."
	$(CARGO) test -p $(CLIENT)

.PHONY: test-verbose
test-verbose:
	@echo ">>> 运行单元测试 (详细输出)..."
	$(CARGO) test -p $(CLIENT) -- --nocapture

.PHONY: test-all
test-all:
	@echo ">>> 运行所有测试..."
	$(CARGO) test --workspace

.PHONY: test-e2e
test-e2e:
	@echo ">>> 运行端到端测试 (需要 data-server 运行中)..."
	@echo ">>> 提示: 请先启动服务器: make start-server"
	$(CARGO) test -p $(CLIENT) --test communication_test -- --ignored --nocapture

.PHONY: test-e2e-quick
test-e2e-quick:
	@echo ">>> 快速连接测试 (需要 data-server 运行中)..."
	$(CARGO) test -p $(CLIENT) --test communication_test quick_connection_test -- --ignored --nocapture

.PHONY: test-admin
test-admin:
	@echo ">>> 管理端通信测试 (需要 admin-server 运行中)..."
	@echo ">>> 提示: 请先启动管理端: make start-admin"
	$(CARGO) test -p $(CLIENT) --test communication_test admin_tests -- --ignored --nocapture

.PHONY: test-admin-full
test-admin-full:
	@echo ">>> 管理端完整流程测试 (需要 admin-server 运行中)..."
	$(CARGO) test -p $(CLIENT) --test communication_test test_full_admin_communication_flow -- --ignored --nocapture

.PHONY: test-integration
test-integration:
	@echo ">>> 运行集成测试..."
	$(CARGO) test --test '*' -p $(CLIENT)

# ============================================================================
# 代码检查
# ============================================================================

.PHONY: check
check:
	@echo ">>> 代码检查..."
	$(CARGO) check -p $(CLIENT)

.PHONY: check-all
check-all:
	@echo ">>> 检查所有功能..."
	$(CARGO) check -p $(CLIENT) --all-features

.PHONY: check-workspace
check-workspace:
	@echo ">>> 检查整个 workspace..."
	$(CARGO) check --workspace

.PHONY: clippy
clippy:
	@echo ">>> Clippy 代码分析..."
	$(CARGO) clippy -p $(CLIENT) -- -D warnings

.PHONY: clippy-all
clippy-all:
	@echo ">>> Clippy 分析所有功能..."
	$(CARGO) clippy -p $(CLIENT) --all-features -- -D warnings

.PHONY: fmt
fmt:
	@echo ">>> 格式化代码..."
	$(CARGO) fmt --all

.PHONY: fmt-check
fmt-check:
	@echo ">>> 检查代码格式..."
	$(CARGO) fmt --all -- --check

.PHONY: lint
lint: fmt-check clippy
	@echo ">>> 代码检查完成"

# ============================================================================
# 打包目标
# ============================================================================

.PHONY: package
package: build-release
	@echo ">>> 打包客户端..."
	@if command -v cargo-packager >/dev/null 2>&1; then \
		cargo packager --config crates/agent-gpui-client/packager.toml --release; \
	else \
		echo "错误: 请先安装 cargo-packager: cargo install cargo-packager"; \
		exit 1; \
	fi

.PHONY: package-dmg
package-dmg: build-release
	@echo ">>> 打包 macOS DMG..."
ifeq ($(UNAME_S),Darwin)
	cd crates/agent-gpui-client && cargo packager --release --formats dmg
else
	@echo "错误: DMG 打包仅支持 macOS"
	@exit 1
endif

.PHONY: package-msi
package-msi: build-release
	@echo ">>> 打包 Windows MSI..."
	@echo "注意: MSI 打包需要在 Windows 环境下执行"
	cd crates/agent-gpui-client && cargo packager --release --formats msi

.PHONY: package-deb
package-deb: build-release
	@echo "打包 Linux DEB..."
ifeq ($(UNAME_S),Linux)
	cd crates/agent-gpui-client && cargo packager --release --formats deb
else
	@echo "错误: DEB 打包仅支持 Linux"
	@exit 1
endif

.PHONY: package-appimage
package-appimage: build-release
	@echo ">>> 打包 Linux AppImage..."
ifeq ($(UNAME_S),Linux)
	cd crates/agent-gpui-client && cargo packager --release --formats appimage
else
	@echo "错误: AppImage 打包仅支持 Linux"
	@exit 1
endif

# ============================================================================
# Tauri 应用打包目标
# ============================================================================

# Tauri 客户端 crate 名称
TAURI_CLIENT := agent-tauri-client

# 构建环境: prod (默认) 或 test
BUILD_ENV ?= prod

.PHONY: tauri-build
tauri-build:
	@echo ">>> 构建 Tauri 应用 (环境: $(BUILD_ENV))..."
	cd crates/$(TAURI_CLIENT) && pnpm install
	cd crates/$(TAURI_CLIENT) && VITE_BUILD_ENV=$(BUILD_ENV) pnpm build
	cd crates/$(TAURI_CLIENT)/src-tauri && cargo build --release

.PHONY: tauri-bundle
tauri-bundle:
	@echo ">>> 打包 Tauri 应用 (环境: $(BUILD_ENV))..."
	cd crates/$(TAURI_CLIENT) && pnpm install
	cd crates/$(TAURI_CLIENT) && VITE_BUILD_ENV=$(BUILD_ENV) pnpm build
	cd crates/$(TAURI_CLIENT)/src-tauri && cargo tauri build

.PHONY: tauri-bundle-test
tauri-bundle-test:
	@echo ">>> 打包 Tauri 应用 (测试环境)..."
	$(MAKE) tauri-bundle BUILD_ENV=test

.PHONY: tauri-bundle-prod
tauri-bundle-prod:
	@echo ">>> 打包 Tauri 应用 (生产环境)..."
	$(MAKE) tauri-bundle BUILD_ENV=prod

.PHONY: tauri-bundle-all
tauri-bundle-all: tauri-build
	@echo ">>> 打包 Tauri 应用 (所有平台)..."
ifeq ($(UNAME_S),Darwin)
	@echo "注意: 交叉编译需要安装工具链 (brew install mingw-w64 cargo-xar)" || true
endif
	cd crates/$(TAURI_CLIENT)/src-tauri && cargo tauri build --bundles all

.PHONY: tauri-dev
tauri-dev:
	@echo ">>> 运行 Tauri 开发模式 (环境: $(BUILD_ENV))..."
	@echo ">>> 检查并安装前端依赖..."
	cd crates/$(TAURI_CLIENT) && pnpm install
	cd crates/$(TAURI_CLIENT) && VITE_BUILD_ENV=$(BUILD_ENV) cargo tauri dev

.PHONY: tauri-info
tauri-info:
	@echo ">>> Tauri 应用信息..."
	@cd crates/$(TAURI_CLIENT)/src-tauri && cargo tauri info

# ============================================================================
# 依赖管理
# ============================================================================

.PHONY: setup-repo
setup-repo:
	@echo ">>> 初始化 Git 子模块..."
	@echo ">>> 1/2 拉取顶层子模块 (nuwax-rustdesk, rcoder, 等)..."
	git submodule update --init
	@echo ">>> 2/2 拉取 nuwax-rustdesk 的嵌套子模块 (hbb_common)..."
	git submodule update --init --recursive vendors/nuwax-rustdesk
	@echo ">>> 子模块初始化完成 (注: 未递归 rcoder 等，避免 temp/duckdb 等可选子模块错误)"

.PHONY: setup-vcpkg
setup-vcpkg:
	@echo ">>> 安装 vcpkg..."
	@if [ ! -d "$(VCPKG_ROOT)" ]; then \
		git clone https://github.com/microsoft/vcpkg $(VCPKG_ROOT); \
		cd $(VCPKG_ROOT) && ./bootstrap-vcpkg.sh; \
	else \
		echo "vcpkg 已存在于 $(VCPKG_ROOT)"; \
	fi
	@echo ">>> 安装 vcpkg 依赖 (triplet: $(VCPKG_TRIPLET))..."
	@if [ -z "$(VCPKG_TRIPLET)" ]; then \
		cd $(VCPKG_ROOT) && ./vcpkg install libvpx libyuv opus aom; \
	else \
		cd $(VCPKG_ROOT) && ./vcpkg install libvpx libyuv opus aom --triplet $(VCPKG_TRIPLET); \
	fi
	@if [ ! -e vcpkg ]; then ln -s "$(VCPKG_ROOT)" vcpkg && echo ">>> 已创建软链接 vcpkg -> $(VCPKG_ROOT)，cargo build 可直接使用"; fi
	@echo ">>> 完成。可使用 make build 或 cargo build 构建"

.PHONY: update-deps
update-deps:
	@echo ">>> 更新 Cargo 依赖..."
	$(CARGO) update

.PHONY: vendor
vendor:
	@echo ">>> 下载依赖到 vendor 目录..."
	$(CARGO) vendor

# ============================================================================
# 服务启动
# ============================================================================

# Docker RustDesk Server 目录
DOCKER_RUSTDESK_DIR := docker/rustdesk-server

# 根据操作系统选择 docker-compose 文件
# Linux: host 模式 (默认)
# macOS/Windows: bridge 模式
ifeq ($(UNAME_S),Linux)
    DOCKER_COMPOSE_FILE := docker-compose.yml
else
    DOCKER_COMPOSE_FILE := docker-compose.bridge.yml
endif

.PHONY: start-server
start-server:
	@echo ">>> 启动 data-server (Docker - $(DOCKER_COMPOSE_FILE))..."
	cd $(DOCKER_RUSTDESK_DIR) && docker compose -f $(DOCKER_COMPOSE_FILE) up -d
	@echo ""
	@echo "服务已启动:"
	@echo "  hbbs (信令): 127.0.0.1:21116"
	@echo "  hbbr (中继): 127.0.0.1:21117"
	@echo ""
	@echo "查看日志: make server-logs"

.PHONY: stop-server
stop-server:
	@echo ">>> 停止 data-server..."
	cd $(DOCKER_RUSTDESK_DIR) && docker compose -f $(DOCKER_COMPOSE_FILE) down

.PHONY: restart-server
restart-server:
	@echo ">>> 重启 data-server..."
	cd $(DOCKER_RUSTDESK_DIR) && docker compose -f $(DOCKER_COMPOSE_FILE) restart

.PHONY: server-logs
server-logs:
	@echo ">>> data-server 日志..."
	cd $(DOCKER_RUSTDESK_DIR) && docker compose -f $(DOCKER_COMPOSE_FILE) logs -f

.PHONY: server-status
server-status:
	@echo ">>> data-server 状态..."
	cd $(DOCKER_RUSTDESK_DIR) && docker compose -f $(DOCKER_COMPOSE_FILE) ps
	@echo ""
	@echo ">>> 公钥信息:"
	@cat $(DOCKER_RUSTDESK_DIR)/data/id_ed25519.pub 2>/dev/null || echo "公钥尚未生成，请先启动服务"

.PHONY: server-key
server-key:
	@echo ">>> data-server 公钥:"
	@cat $(DOCKER_RUSTDESK_DIR)/data/id_ed25519.pub 2>/dev/null || echo "公钥尚未生成，请先启动服务: make start-server"

.PHONY: start-admin
start-admin:
	@echo ">>> 启动 agent-server-admin..."
	$(CARGO) run -p agent-server-admin

.PHONY: start-all
start-all:
	@echo ">>> 启动所有服务..."
	@echo ""
	@echo "请按以下顺序在不同终端运行:"
	@echo ""
	@echo "  1. make start-server    # 启动 RustDesk 服务器 (Docker)"
	@echo "  2. make start-admin     # 启动管理端 API"
	@echo "  3. make run             # 启动客户端"
	@echo ""
	@echo "或者一键启动服务器:"
	@make start-server

# ============================================================================
# 清理目标
# ============================================================================

.PHONY: clean
clean:
	@echo ">>> 清理构建产物..."
	$(CARGO) clean

.PHONY: clean-client
clean-client:
	@echo ">>> 清理客户端构建产物..."
	$(CARGO) clean -p $(CLIENT)

.PHONY: clean-all
clean-all: clean
	@echo ">>> 清理所有..."
	@rm -rf $(VCPKG_ROOT)/buildtrees
	@rm -rf $(VCPKG_ROOT)/packages
	@echo "清理完成"

# ============================================================================
# 文档
# ============================================================================

.PHONY: doc
doc:
	@echo ">>> 生成文档..."
	$(CARGO) doc -p $(CLIENT) --no-deps --open

.PHONY: doc-all
doc-all:
	@echo ">>> 生成所有文档..."
	$(CARGO) doc --workspace --no-deps --open

# ============================================================================
# CI/CD 相关
# ============================================================================

.PHONY: ci
ci: fmt-check check test
	@echo ">>> CI 检查完成"

.PHONY: ci-full
ci-full: fmt-check check-all clippy-all test-all
	@echo ">>> 完整 CI 检查完成"

# ============================================================================
# 开发快捷命令
# ============================================================================

.PHONY: dev
dev: check run-dev

.PHONY: rebuild
rebuild: clean build

.PHONY: fresh
fresh: clean-all setup-vcpkg build

# ============================================================================
# 信息输出
# ============================================================================

.PHONY: info
info:
	@echo "=== 系统信息 ==="
	@echo "操作系统: $(UNAME_S)"
	@echo "架构: $(UNAME_M)"
	@echo "VCPKG_ROOT: $(VCPKG_ROOT)"
	@echo ""
	@echo "=== Rust 版本 ==="
	@rustc --version
	@cargo --version
	@echo ""
	@echo "=== 项目信息 ==="
	@$(CARGO) metadata --format-version 1 --no-deps 2>/dev/null | grep -o '"name":"nuwax-agent"[^}]*' | head -1 || echo "无法获取项目信息"

.PHONY: version
version:
	@$(CARGO) pkgid -p $(CLIENT) 2>/dev/null | sed 's/.*#//' || echo "0.0.0"

# 默认目标
.DEFAULT_GOAL := help
