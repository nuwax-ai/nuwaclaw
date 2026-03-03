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
	@echo "Usage: make [target]"
	@echo ""
	@echo "=== Build ==="
	@echo "  build          - Build client (debug)"
	@echo "  build-release  - Build client (release)"
	@echo "  build-all      - Build client with all features (debug)"
	@echo "  build-all-release - Build client with all features (release)"
	@echo ""
	@echo "=== Run ==="
	@echo "  run            - Run client (debug, all features)"
	@echo "  run-release    - Run client (release, all features)"
	@echo "  run-dev        - Run client (dev mode)"
	@echo ""
	@echo "=== Test ==="
	@echo "  test           - Run unit tests"
	@echo "  test-all       - Run all tests (including integration tests)"
	@echo "  test-e2e       - Run e2e tests (requires data-server)"
	@echo "  test-e2e-quick - Quick connection test (requires data-server)"
	@echo "  test-admin     - Admin communication test (requires admin-server)"
	@echo "  test-admin-full- Admin full flow test"
	@echo ""
	@echo "=== Code Check ==="
	@echo "  check          - Code check (cargo check)"
	@echo "  sidecar-prepare - Prepare sidecar binaries for current platform (mcp-proxy/node-runtime)"
	@echo "  sidecar-download - Download sidecar to local cache (default: current platform, use TARGET=...)"
	@echo "  sidecar-download-all - Download sidecar for common platforms to local cache (Win/macOS/Linux)"
	@echo "  sidecar-clean - Clean sidecar download cache and artifacts (mcp-proxy/node-runtime)"
	@echo "  sidecar-check  - Check if sidecar downloads are complete (mcp-proxy/node-runtime)"
	@echo "  sidecar-check-all - Check sidecar downloads for common platforms"
	@echo "  sidecar-check-full - Check complete sidecar (including nuwax-lanproxy)"
	@echo "  npm-prefetch-tarballs - Prefetch npm tarballs to local cache (default: npmmirror)"
	@echo "  clippy         - Clippy code analysis"
	@echo "  fmt            - Format code"
	@echo "  fmt-check      - Check code format"
	@echo ""
	@echo "=== Package ==="
	@echo "  package        - Package client (current platform)"
	@echo "  package-dmg    - Package macOS DMG"
	@echo "  package-msi    - Package Windows MSI"
	@echo "  package-deb    - Package Linux DEB"
	@echo ""
	@echo "=== Tauri App Build ==="
	@echo "  node-download      - Download Node.js runtime to resources (skip if exists)"
	@echo "  tauri-install-deps - Download sidecar/Node/uv, then install frontend deps"
	@echo "  tauri-bundle       - Build Tauri app (default: production)"
	@echo "  tauri-bundle-test  - Build Tauri app (test environment)"
	@echo "  tauri-bundle-prod  - Build Tauri app (production environment)"
	@echo "  tauri-bundle-all   - Build Tauri app for all platforms (macOS/Windows/Linux)"
	@echo "  tauri-dev          - Run Tauri dev mode"
	@echo ""
	@echo "=== Electron App Build ==="
	@echo "  electron-install-deps    - Install Electron client npm dependencies"
	@echo "  electron-rebuild         - Rebuild native modules (better-sqlite3) for Electron"
	@echo "  electron-prepare-lanproxy - Prepare lanproxy binary for Electron"
	@echo "  electron-prepare         - Full prepare (install + rebuild + lanproxy)"
	@echo "  electron-dev             - Run Electron dev mode (one-click start)"
	@echo ""
	@echo "=== Dependencies ==="
	@echo "  setup-repo     - Initialize Git submodules (including nested hbb_common)"
	@echo "  setup-vcpkg    - Install vcpkg and dependencies"
	@echo "  update-deps    - Update Cargo dependencies"
	@echo "  update         - Pull code + update Cargo deps + update submodules (git pull, cargo update, submodule)"
	@echo ""
	@echo "=== Clean ==="
	@echo "  clean          - Clean build artifacts"
	@echo "  clean-all      - Clean all (including vcpkg)"
	@echo ""
	@echo "=== Services (Docker) ==="
	@echo "  start-server   - Start RustDesk server (Docker)"
	@echo "  stop-server    - Stop RustDesk server"
	@echo "  restart-server - Restart RustDesk server"
	@echo "  server-logs    - View server logs"
	@echo "  server-status  - View server status"
	@echo "  server-key     - Display server public key"
	@echo "  start-admin    - Start agent-server-admin"
	@echo "  start-all      - Display steps to start all services"
	@echo ""
	@echo "Environment Variables:"
	@echo "  VCPKG_ROOT     - vcpkg path (current: $(VCPKG_ROOT))"
	@echo "  RUST_LOG       - Log level (e.g. debug, info, warn)"
	@echo "  APPLE_SIGNING_IDENTITY - macOS signing identity for build/notarization (e.g. Developer ID Application: Name (TEAM_ID))"

# ============================================================================
# 构建目标
# ============================================================================

.PHONY: build
build:
	@echo ">>> Building client (debug)..."
	$(CARGO) build -p $(CLIENT)

.PHONY: build-release
build-release:
	@echo ">>> Building client (release)..."
	$(CARGO) build -p $(CLIENT) $(RELEASE_FLAGS)

.PHONY: build-all
build-all:
	@echo ">>> Building client - all features (debug)..."
	$(CARGO) build -p $(CLIENT) --all-features

.PHONY: build-all-release
build-all-release:
	@echo ">>> Building client - all features (release)..."
	$(CARGO) build -p $(CLIENT) --all-features $(RELEASE_FLAGS)

.PHONY: build-workspace
build-workspace:
	@echo ">>> Building entire workspace..."
	$(CARGO) build --workspace

# ============================================================================
# 运行目标
# ============================================================================

.PHONY: run
run:
	@echo ">>> Running client (debug, all features)..."
	$(CARGO) run -p $(CLIENT) --all-features

.PHONY: run-release
run-release:
	@echo ">>> Running client (release)..."
	$(CARGO) run -p $(CLIENT) --all-features $(RELEASE_FLAGS)

.PHONY: run-dev
run-dev:
	@echo ">>> Running client (dev mode)..."
	RUST_LOG=debug $(CARGO) run -p $(CLIENT) --all-features

# ============================================================================
# 测试目标
# ============================================================================

.PHONY: test
test:
	@echo ">>> Running unit tests..."
	$(CARGO) test -p $(CLIENT)

.PHONY: test-verbose
test-verbose:
	@echo ">>> Running unit tests (verbose)..."
	$(CARGO) test -p $(CLIENT) -- --nocapture

.PHONY: test-all
test-all:
	@echo ">>> Running all tests..."
	$(CARGO) test --workspace

.PHONY: test-e2e
test-e2e:
	@echo ">>> Running e2e tests (requires data-server running)..."
	@echo ">>> Hint: Start server first: make start-server"
	$(CARGO) test -p $(CLIENT) --test communication_test -- --ignored --nocapture

.PHONY: test-e2e-quick
test-e2e-quick:
	@echo ">>> Quick connection test (requires data-server running)..."
	$(CARGO) test -p $(CLIENT) --test communication_test quick_connection_test -- --ignored --nocapture

.PHONY: test-admin
test-admin:
	@echo ">>> Admin communication test (requires admin-server running)..."
	@echo ">>> Hint: Start admin first: make start-admin"
	$(CARGO) test -p $(CLIENT) --test communication_test admin_tests -- --ignored --nocapture

.PHONY: test-admin-full
test-admin-full:
	@echo ">>> Admin full flow test (requires admin-server running)..."
	$(CARGO) test -p $(CLIENT) --test communication_test test_full_admin_communication_flow -- --ignored --nocapture

.PHONY: test-integration
test-integration:
	@echo ">>> Running integration tests..."
	$(CARGO) test --test '*' -p $(CLIENT)

# ============================================================================
# 代码检查
# ============================================================================

.PHONY: check
check:
	@echo ">>> Checking code..."
	$(CARGO) check -p $(CLIENT)

.PHONY: sidecar-check
sidecar-check:
	@echo ">>> Checking sidecar download cache for current platform..."
	./scripts/check-sidecars.sh --downloaded-only --dir .cache/sidecars

.PHONY: sidecar-check-all
sidecar-check-all:
	@echo ">>> Checking sidecar download cache for common platforms..."
	./scripts/check-sidecars.sh --downloaded-only --all-common --dir .cache/sidecars

.PHONY: sidecar-check-full
sidecar-check-full:
	@echo ">>> Checking complete sidecar (binaries, including nuwax-lanproxy)..."
	./scripts/check-sidecars.sh

.PHONY: npm-prefetch-tarballs
npm-prefetch-tarballs:
	@echo ">>> Prefetching npm tarballs to local..."
	./scripts/prefetch-npm-tarballs.sh

.PHONY: sidecar-prepare
sidecar-prepare:
	@echo ">>> Preparing sidecar binaries for current platform..."
	./scripts/prepare-sidecars.sh

.PHONY: sidecar-download
sidecar-download:
	@echo ">>> Downloading sidecar to local cache..."
	./scripts/download-sidecars.sh $(if $(TARGET),--target $(TARGET),) $(if $(MATERIALIZE),--materialize,)

.PHONY: sidecar-download-all
sidecar-download-all:
	@echo ">>> Downloading sidecar for common platforms to local cache..."
	./scripts/download-sidecars.sh --all-common

.PHONY: sidecar-clean
sidecar-clean:
	@echo ">>> Cleaning downloaded sidecar artifacts..."
	./scripts/clean-downloaded-sidecars.sh

.PHONY: check-all
check-all:
	@echo ">>> Checking all features..."
	$(CARGO) check -p $(CLIENT) --all-features

.PHONY: check-workspace
check-workspace:
	@echo ">>> Checking entire workspace..."
	$(CARGO) check --workspace

.PHONY: clippy
clippy:
	@echo ">>> Running Clippy..."
	$(CARGO) clippy -p $(CLIENT) -- -D warnings

.PHONY: clippy-all
clippy-all:
	@echo ">>> Running Clippy on all features..."
	$(CARGO) clippy -p $(CLIENT) --all-features -- -D warnings

.PHONY: fmt
fmt:
	@echo ">>> Formatting code..."
	$(CARGO) fmt --all

.PHONY: fmt-check
fmt-check:
	@echo ">>> Checking code format..."
	$(CARGO) fmt --all -- --check

.PHONY: lint
lint: fmt-check clippy
	@echo ">>> Code check completed"

# ============================================================================
# 打包目标
# ============================================================================

.PHONY: package
package: build-release
	@echo ">>> Packaging client..."
	@if command -v cargo-packager >/dev/null 2>&1; then \
		cargo packager --config crates/agent-gpui-client/packager.toml --release; \
	else \
		echo "Error: Please install cargo-packager first: cargo install cargo-packager"; \
		exit 1; \
	fi

.PHONY: package-dmg
package-dmg: build-release
	@echo ">>> Packaging macOS DMG..."
ifeq ($(UNAME_S),Darwin)
	cd crates/agent-gpui-client && cargo packager --release --formats dmg
else
	@echo "Error: DMG packaging only supported on macOS"
	@exit 1
endif

.PHONY: package-msi
package-msi: build-release
	@echo ">>> Packaging Windows MSI..."
	@echo "Note: MSI packaging requires Windows environment"
	cd crates/agent-gpui-client && cargo packager --release --formats msi

.PHONY: package-deb
package-deb: build-release
	@echo "Packaging Linux DEB..."
ifeq ($(UNAME_S),Linux)
	cd crates/agent-gpui-client && cargo packager --release --formats deb
else
	@echo "Error: DEB packaging only supported on Linux"
	@exit 1
endif

.PHONY: package-appimage
package-appimage: build-release
	@echo ">>> Packaging Linux AppImage..."
ifeq ($(UNAME_S),Linux)
	cd crates/agent-gpui-client && cargo packager --release --formats appimage
else
	@echo "Error: AppImage packaging only supported on Linux"
	@exit 1
endif

# ============================================================================
# Tauri 应用打包目标
# ============================================================================

# Tauri 客户端 crate 名称
TAURI_CLIENT := agent-tauri-client

# 构建环境: prod (默认) 或 test
BUILD_ENV ?= prod
HOST_TRIPLE := $(shell rustc -vV | awk '/^host:/ {print $$2}')

# Node.js 资源目录
NODE_RESOURCE_DIR := crates/$(TAURI_CLIENT)/src-tauri/resources/node

.PHONY: node-download
node-download:
	@echo ">>> Downloading Node.js runtime (skip if exists)..."
	./scripts/download-node.sh

.PHONY: uv-download
uv-download:
	@echo ">>> Downloading uv runtime (skip if exists)..."
	./scripts/download-uv.sh

# macOS 打包前对 resources 下的 node 与 uv/uvx 做 codesign，否则公证会因“未签名/无时间戳/无硬化运行时”失败。
# node 与 uv 均会签名，不隐藏。需设置 APPLE_SIGNING_IDENTITY；非 macOS 或未设置时脚本内部会直接退出 0。
.PHONY: sign-macos-resource-bins
sign-macos-resource-bins:
	@./scripts/sign-macos-resource-bins.sh

.PHONY: tauri-build
tauri-build: tauri-install-deps sign-macos-resource-bins
	@echo ">>> Building Tauri app (env: $(BUILD_ENV))..."
	cd crates/$(TAURI_CLIENT) && VITE_BUILD_ENV=$(BUILD_ENV) pnpm build
	cd crates/$(TAURI_CLIENT)/src-tauri && cargo build --release

.PHONY: post-sign-macos-app
post-sign-macos-app:
	@./scripts/post-sign-macos-app.sh

.PHONY: tauri-bundle
tauri-bundle: tauri-install-deps sign-macos-resource-bins
	@echo ">>> Bundling Tauri app (env: $(BUILD_ENV))..."
	cd crates/$(TAURI_CLIENT) && VITE_BUILD_ENV=$(BUILD_ENV) pnpm build
	cd crates/$(TAURI_CLIENT)/src-tauri && cargo tauri build
	@$(MAKE) post-sign-macos-app

.PHONY: tauri-bundle-test
tauri-bundle-test:
	@echo ">>> Bundling Tauri app (test env)..."
	$(MAKE) tauri-bundle BUILD_ENV=test

.PHONY: tauri-bundle-prod
tauri-bundle-prod:
	@echo ">>> Bundling Tauri app (production env)..."
	$(MAKE) tauri-bundle BUILD_ENV=prod

.PHONY: tauri-bundle-all
tauri-bundle-all: sidecar-download-all sidecar-check-all tauri-build
	@echo ">>> Bundling Tauri app (all platforms)..."
ifeq ($(UNAME_S),Darwin)
	@echo "Note: Cross-compilation requires toolchain (brew install mingw-w64 cargo-xar)" || true
endif
	cd crates/$(TAURI_CLIENT)/src-tauri && cargo tauri build --bundles all
	@$(MAKE) post-sign-macos-app

.PHONY: tauri-dev
tauri-dev: tauri-install-deps
	@echo ">>> Running Tauri dev mode (env: $(BUILD_ENV))..."
	@echo ">>> Logs will be written to logs/tauri-dev.log"
	mkdir -p logs
	@echo "=== Tauri Dev Started at $$(date) ===" > logs/tauri-dev.log
	@echo ">>> Frontend deps installed, starting tauri dev..."
	cd crates/$(TAURI_CLIENT) && RUST_LOG=trace AGENT_RUST_LOG=trace VITE_BUILD_ENV=$(BUILD_ENV) cargo tauri dev 2>&1 | tee -a $(CURDIR)/logs/tauri-dev.log

# ============================================================================
# Electron 应用开发目标
# ============================================================================

# Electron 客户端 crate 名称
ELECTRON_CLIENT := agent-electron-client

.PHONY: electron-install-deps
electron-install-deps:
	@echo ">>> Installing Electron client dependencies..."
	cd crates/$(ELECTRON_CLIENT) && npm install

.PHONY: electron-rebuild
electron-rebuild:
	@echo ">>> Rebuilding native modules for Electron..."
	cd crates/$(ELECTRON_CLIENT) && npx electron-rebuild -f -w better-sqlite3

.PHONY: electron-prepare-lanproxy
electron-prepare-lanproxy:
	@echo ">>> Preparing lanproxy binary for Electron..."
	cd crates/$(ELECTRON_CLIENT) && npm run prepare:lanproxy

.PHONY: electron-prepare
electron-prepare: electron-install-deps electron-rebuild electron-prepare-lanproxy
	@echo ">>> Electron client prepared successfully"

.PHONY: electron-dev
electron-dev: electron-prepare
	@echo ">>> Starting Electron dev mode..."
	@echo ">>> Logs will be written to logs/electron-dev.log"
	mkdir -p logs
	@echo "=== Electron Dev Started at $$(date) ===" > logs/electron-dev.log
	cd crates/$(ELECTRON_CLIENT) && npm run dev 2>&1 | tee -a $(CURDIR)/logs/electron-dev.log

.PHONY: tauri-info
tauri-info:
	@echo ">>> Tauri app info..."
	@cd crates/$(TAURI_CLIENT)/src-tauri && cargo tauri info

.PHONY: sidecar-preload
sidecar-preload:
	@echo ">>> Pre-downloading and materializing sidecar for current platform (target: $(HOST_TRIPLE))..."
	./scripts/download-sidecars.sh --target $(HOST_TRIPLE) --materialize

.PHONY: tauri-install-deps
tauri-install-deps: sidecar-preload node-download uv-download
	@echo ">>> Installing Tauri frontend deps (ensure sidecar is downloaded first)..."
	cd crates/$(TAURI_CLIENT) && pnpm install

# ============================================================================
# 依赖管理
# ============================================================================

.PHONY: setup-repo
setup-repo:
	@echo ">>> Initializing Git submodules..."
	@echo ">>> 1/2 Pulling top-level submodules (nuwax-rustdesk, rcoder, etc.)..."
	git submodule update --init
	@echo ">>> 2/2 Pulling nested submodules of nuwax-rustdesk (hbb_common)..."
	git submodule update --init --recursive vendors/nuwax-rustdesk
	@echo ">>> Submodules initialized (Note: rcoder etc not recursive to avoid optional submodule errors)"

.PHONY: setup-vcpkg
setup-vcpkg:
	@echo ">>> Installing vcpkg..."
	@if [ ! -d "$(VCPKG_ROOT)" ]; then \
		git clone https://github.com/microsoft/vcpkg $(VCPKG_ROOT); \
		cd $(VCPKG_ROOT) && ./bootstrap-vcpkg.sh; \
	else \
		echo "vcpkg already exists at $(VCPKG_ROOT)"; \
	fi
	@echo ">>> Installing vcpkg dependencies (triplet: $(VCPKG_TRIPLET))..."
	@if [ -z "$(VCPKG_TRIPLET)" ]; then \
		cd $(VCPKG_ROOT) && ./vcpkg install libvpx libyuv opus aom; \
	else \
		cd $(VCPKG_ROOT) && ./vcpkg install libvpx libyuv opus aom --triplet $(VCPKG_TRIPLET); \
	fi
	@if [ ! -e vcpkg ]; then ln -s "$(VCPKG_ROOT)" vcpkg && echo ">>> Created symlink vcpkg -> $(VCPKG_ROOT), cargo build ready"; fi
	@echo ">>> Done. Use make build or cargo build to build"

.PHONY: update-deps
update-deps:
	@echo ">>> Updating Cargo dependencies..."
	$(CARGO) update

# One-click update: pull main repo, update Cargo deps, update submodules to latest remote and merge
.PHONY: update
update:
	@echo ">>> 0/4 Pre-downloading sidecar for current platform to local cache (target: $(HOST_TRIPLE))..."
	./scripts/download-sidecars.sh --target $(HOST_TRIPLE)
	@echo ">>> 1/4 git pull..."
	git pull
	@echo ">>> 2/4 cargo update..."
	$(CARGO) update
	@echo ">>> 3/4 git submodule update --remote --merge..."
	git submodule update --remote --merge
	@echo ">>> update completed"

.PHONY: vendor
vendor:
	@echo ">>> Downloading dependencies to vendor directory..."
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
	@echo ">>> Starting data-server (Docker - $(DOCKER_COMPOSE_FILE))..."
	cd $(DOCKER_RUSTDESK_DIR) && docker compose -f $(DOCKER_COMPOSE_FILE) up -d
	@echo ""
	@echo "Services started:"
	@echo "  hbbs (signaling): 127.0.0.1:21116"
	@echo "  hbbr (relay): 127.0.0.1:21117"
	@echo ""
	@echo "View logs: make server-logs"

.PHONY: stop-server
stop-server:
	@echo ">>> Stopping data-server..."
	cd $(DOCKER_RUSTDESK_DIR) && docker compose -f $(DOCKER_COMPOSE_FILE) down

.PHONY: restart-server
restart-server:
	@echo ">>> Restarting data-server..."
	cd $(DOCKER_RUSTDESK_DIR) && docker compose -f $(DOCKER_COMPOSE_FILE) restart

.PHONY: server-logs
server-logs:
	@echo ">>> data-server logs..."
	cd $(DOCKER_RUSTDESK_DIR) && docker compose -f $(DOCKER_COMPOSE_FILE) logs -f

.PHONY: server-status
server-status:
	@echo ">>> data-server status..."
	cd $(DOCKER_RUSTDESK_DIR) && docker compose -f $(DOCKER_COMPOSE_FILE) ps
	@echo ""
	@echo ">>> Public key info:"
	@cat $(DOCKER_RUSTDESK_DIR)/data/id_ed25519.pub 2>/dev/null || echo "Public key not yet generated, please start service first"

.PHONY: server-key
server-key:
	@echo ">>> data-server public key:"
	@cat $(DOCKER_RUSTDESK_DIR)/data/id_ed25519.pub 2>/dev/null || echo "Public key not yet generated, please start service first: make start-server"

.PHONY: start-admin
start-admin:
	@echo ">>> Starting agent-server-admin..."
	$(CARGO) run -p agent-server-admin

.PHONY: start-all
start-all:
	@echo ">>> Starting all services..."
	@echo ""
	@echo "Please run in different terminals in order:"
	@echo ""
	@echo "  1. make start-server    # Start RustDesk server (Docker)"
	@echo "  2. make start-admin     # Start admin API"
	@echo "  3. make run             # Start client"
	@echo ""
	@echo "Or start server with one command:"
	@make start-server

# ============================================================================
# 清理目标
# ============================================================================

.PHONY: clean
clean:
	@echo ">>> Cleaning build artifacts..."
	$(CARGO) clean

.PHONY: clean-client
clean-client:
	@echo ">>> Cleaning client build artifacts..."
	$(CARGO) clean -p $(CLIENT)

.PHONY: clean-all
clean-all: clean
	@echo ">>> Cleaning all..."
	@rm -rf $(VCPKG_ROOT)/buildtrees
	@rm -rf $(VCPKG_ROOT)/packages
	@echo "Clean completed"

# ============================================================================
# 文档
# ============================================================================

.PHONY: doc
doc:
	@echo ">>> Generating docs..."
	$(CARGO) doc -p $(CLIENT) --no-deps --open

.PHONY: doc-all
doc-all:
	@echo ">>> Generating all docs..."
	$(CARGO) doc --workspace --no-deps --open

# ============================================================================
# CI/CD 相关
# ============================================================================

.PHONY: ci
ci: fmt-check check test
	@echo ">>> CI check completed"

.PHONY: ci-full
ci-full: fmt-check check-all clippy-all test-all
	@echo ">>> Full CI check completed"

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
	@echo "=== System Info ==="
	@echo "OS: $(UNAME_S)"
	@echo "Arch: $(UNAME_M)"
	@echo "VCPKG_ROOT: $(VCPKG_ROOT)"
	@echo ""
	@echo "=== Rust Version ==="
	@rustc --version
	@cargo --version
	@echo ""
	@echo "=== Project Info ==="
	@$(CARGO) metadata --format-version 1 --no-deps 2>/dev/null | grep -o '"name":"nuwax-agent"[^}]*' | head -1 || echo "Unable to get project info"

.PHONY: version
version:
	@$(CARGO) pkgid -p $(CLIENT) 2>/dev/null | sed 's/.*#//' || echo "0.0.0"

# 默认目标
.DEFAULT_GOAL := help
