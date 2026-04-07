# nuwax-agent Makefile
# 用于 Electron 客户端本地开发、测试和打包

# ============================================================================
# 变量配置
# ============================================================================

# 默认目标平台
UNAME_S := $(shell uname -s)
UNAME_M := $(shell uname -m)

# 是否在 Windows 宿主上执行 make（Git Bash / MSYS / Cygwin，或 OS=Windows_NT）
ELECTRON_ON_WINDOWS := $(strip $(filter Windows_NT,$(OS)) $(findstring MINGW,$(UNAME_S)) $(findstring MSYS,$(UNAME_S)) $(findstring CYGWIN,$(UNAME_S)))

# Electron 客户端目录
ELECTRON_CLIENT := agent-electron-client

# ============================================================================
# 帮助信息
# ============================================================================

.PHONY: help
help:
	@echo "nuwax-agent Makefile"
	@echo ""
	@echo "Usage: make [target]"
	@echo ""
	@echo "=== Sidecar ==="
	@echo "  sidecar-prepare      - Prepare sidecar binaries for current platform (mcp-proxy/node-runtime)"
	@echo "  sidecar-download     - Download sidecar to local cache (default: current platform, use TARGET=...)"
	@echo "  sidecar-download-all - Download sidecar for common platforms to local cache (Win/macOS/Linux)"
	@echo "  sidecar-clean         - Clean sidecar download cache and artifacts"
	@echo "  sidecar-check         - Check if sidecar downloads are complete"
	@echo "  sidecar-check-all     - Check sidecar downloads for common platforms"
	@echo "  npm-prefetch-tarballs - Prefetch npm tarballs to local cache (default: npmmirror)"
	@echo ""
	@echo "=== Electron App Build ==="
	@echo "  electron-install-deps       - Install Electron client npm dependencies"
	@echo "  electron-rebuild            - Rebuild native modules (better-sqlite3) for Electron"
	@echo "  electron-prepare-lanproxy   - Prepare lanproxy binary for Electron"
	@echo "  electron-prepare-node      - Prepare bundled Node.js for Electron"
	@echo "  electron-prepare-uv        - Prepare bundled uv for Electron"
	@echo "  electron-prepare-mcp-proxy - Prepare nuwax-mcp-stdio-proxy for Electron"
	@echo "  electron-prepare-nuwaxcode  - Prepare bundled nuwaxcode for Electron"
	@echo "  electron-prepare-gui-server - Prepare agent-gui-server for Electron"
	@echo "  electron-prepare-sandbox-runtime - Sync Windows sandbox helper (skipped on non-Windows hosts)"
	@echo "  electron-prepare-windows-mcp - Bundle windows-mcp into resources (Windows only, skipped elsewhere)"
	@echo "  electron-prepare            - Full prepare (install + rebuild + all binaries)"
	@echo "  electron-bundle             - Build Electron app (unsigned, current platform)"
	@echo "  electron-dev                - Run Electron dev mode"
	@echo ""
	@echo "=== Dependencies ==="
	@echo "  setup-repo     - No-op (repository does not use Git submodules)"
	@echo ""
	@echo "=== Clean ==="
	@echo "  clean-electron - Clean Electron build artifacts"
	@echo ""
	@echo "Environment Variables:"
	@echo "  APPLE_SIGNING_IDENTITY - macOS signing identity for build/notarization"
	@echo "  TARGET                 - Target platform for sidecar download (e.g. x86_64-apple-darwin)"

# ============================================================================
# Sidecar 目标
# ============================================================================

.PHONY: sidecar-check
sidecar-check:
	@echo ">>> Checking sidecar download cache for current platform..."
	./scripts/check-sidecars.sh --downloaded-only --dir .cache/sidecars

.PHONY: sidecar-check-all
sidecar-check-all:
	@echo ">>> Checking sidecar download cache for common platforms..."
	./scripts/check-sidecars.sh --downloaded-only --all-common --dir .cache/sidecars

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
	./scripts/download-sidecars.sh $(if $(TARGET),--target $(TARGET),)

.PHONY: sidecar-download-all
sidecar-download-all:
	@echo ">>> Downloading sidecar for common platforms to local cache..."
	./scripts/download-sidecars.sh --all-common

.PHONY: sidecar-clean
sidecar-clean:
	@echo ">>> Cleaning downloaded sidecar artifacts..."
	./scripts/clean-downloaded-sidecars.sh

# ============================================================================
# Electron 应用开发目标
# ============================================================================

# electron-dev 通过 .env.development 配置（INJECT_GUI_MCP=true, NUWAX_AGENT_LOG_FULL_SECRETS=true）
# 生产构建通过 .env.production 配置（INJECT_GUI_MCP=false, NUWAX_AGENT_LOG_FULL_SECRETS=false）
.PHONY: electron-install-deps
electron-install-deps:
	@echo ">>> Installing Electron client dependencies (via pnpm workspace)..."
	@echo ">>> nuwax-mcp-stdio-proxy will be auto-built via prepare script"
	pnpm install --filter @nuwax-ai/nuwaclaw...

.PHONY: electron-rebuild
electron-rebuild:
	@echo ">>> Rebuilding native modules for Electron..."
	cd crates/$(ELECTRON_CLIENT) && npx electron-rebuild -f -w better-sqlite3

.PHONY: electron-prepare-lanproxy
electron-prepare-lanproxy:
	@echo ">>> Preparing lanproxy binary for Electron..."
	cd crates/$(ELECTRON_CLIENT) && npm run prepare:lanproxy

.PHONY: electron-prepare-node
electron-prepare-node:
	@echo ">>> Preparing bundled Node.js for Electron..."
	cd crates/$(ELECTRON_CLIENT) && npm run prepare:node

.PHONY: electron-prepare-uv
electron-prepare-uv:
	@echo ">>> Preparing bundled uv for Electron..."
	cd crates/$(ELECTRON_CLIENT) && npm run prepare:uv

.PHONY: electron-prepare-mcp-proxy
electron-prepare-mcp-proxy:
	@echo ">>> Preparing nuwax-mcp-stdio-proxy for Electron..."
	cd crates/$(ELECTRON_CLIENT) && npm run prepare:mcp-proxy

.PHONY: electron-prepare-nuwaxcode
electron-prepare-nuwaxcode:
	@echo ">>> Preparing bundled nuwaxcode for Electron..."
	cd crates/$(ELECTRON_CLIENT) && npm run prepare:nuwaxcode

.PHONY: electron-prepare-gui-server
electron-prepare-gui-server:
	@echo ">>> Preparing agent-gui-server for Electron..."
	cd crates/$(ELECTRON_CLIENT) && npm run prepare:gui-server

# prepare:sandbox-runtime 仅同步 Windows helper（非 Windows 开发机跳过）
ifneq ($(ELECTRON_ON_WINDOWS),)
.PHONY: electron-prepare-sandbox-runtime
electron-prepare-sandbox-runtime:
	@echo ">>> Preparing sandbox runtime for Electron (Windows, prepare:sandbox-runtime)..."
	cd crates/$(ELECTRON_CLIENT) && npm run prepare:sandbox-runtime
else
.PHONY: electron-prepare-sandbox-runtime
electron-prepare-sandbox-runtime:
	@echo ">>> Skipping electron-prepare-sandbox-runtime (Windows-only step, host=$(UNAME_S))"
endif

# prepare:windows-mcp 将 windows-mcp 安装到 resources/windows-mcp（非 Windows 开发机跳过）
ifneq ($(ELECTRON_ON_WINDOWS),)
.PHONY: electron-prepare-windows-mcp
electron-prepare-windows-mcp:
	@echo ">>> Preparing bundled windows-mcp for Electron (prepare:windows-mcp)..."
	cd crates/$(ELECTRON_CLIENT) && npm run prepare:windows-mcp
else
.PHONY: electron-prepare-windows-mcp
electron-prepare-windows-mcp:
	@echo ">>> Skipping electron-prepare-windows-mcp (Windows-only step, host=$(UNAME_S))"
endif

.PHONY: electron-prepare
electron-prepare: electron-install-deps electron-rebuild electron-prepare-lanproxy electron-prepare-node electron-prepare-uv electron-prepare-mcp-proxy electron-prepare-nuwaxcode electron-prepare-gui-server electron-prepare-sandbox-runtime electron-prepare-windows-mcp
	@echo ">>> Electron client prepared successfully"

.PHONY: electron-bundle
electron-bundle: electron-prepare
	@echo ">>> Building Electron app (unsigned, current platform, 使用 .env.production 配置)..."
	cd crates/$(ELECTRON_CLIENT) && npm run dist:unsigned:local

.PHONY: electron-dev
electron-dev: electron-prepare
	@echo ">>> Starting Electron dev mode..."
	@echo ">>> 日志通过 .env.development 配置 (NUWAX_AGENT_LOG_FULL_SECRETS=true)"
	@echo ">>> INJECT_GUI_MCP=true（通过 .env.development 配置，向 ACP 注入 gui-agent MCP）"
	@echo ">>> Logs will be written to logs/electron-dev.log"
	mkdir -p logs
	@echo "=== Electron Dev Started at $$(date) ===" > logs/electron-dev.log
	cd crates/$(ELECTRON_CLIENT) && npm run dev 2>&1 | tee -a $(CURDIR)/logs/electron-dev.log

# ============================================================================
# 依赖管理
# ============================================================================

.PHONY: setup-repo
setup-repo:
	@echo ">>> setup-repo: skipped — this repository no longer uses Git submodules (vendors/ removed)."

# ============================================================================
# 清理目标
# ============================================================================

.PHONY: clean-electron
clean-electron:
	@echo ">>> Cleaning Electron build artifacts..."
	cd crates/$(ELECTRON_CLIENT) && rm -rf dist release .next node_modules/.cache

# 默认目标
.DEFAULT_GOAL := help
