# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-02-04

### Added

#### Authentication (登录认证) [dc9e212](https://github.com/nuwax-ai/nuwax-agent/commit/dc9e212)
- Login functionality with username/password
- Client registration via `POST /api/sandbox/config/reg`
- Token/configKey persistence to localStorage
- User session management
- Login form with success state display
- Logout functionality

#### Multi-environment Support (多场景配置) [f9954b4](https://github.com/nuwax-ai/nuwax-agent/commit/f9954b4)
- Scene switching component (local/dev/prod environments)
- Custom configuration editor modal
- Settings page with full configuration management
- Server configuration (API URL, timeout)
- Local services configuration (Agent, VNC, FileServer, WebSocket)
- Add/Edit/Delete/Switch configurations
- Export/Import configurations

#### Dependency Management (依赖管理)
- System dependency detection via Rust backend ([6bb241a](https://github.com/nuwax-ai/nuwax-agent/commit/6bb241a))
- Supported dependencies:
  - Core: Node.js, Git, npm
  - Runtime: Python, Docker, Rust
  - CLI Tools: cURL, jq, Pandoc, FFmpeg
  - npm Packages: OpenCode, Claude Code
- Installation and uninstallation of global npm/pnpm packages ([de8e55a](https://github.com/nuwax-ai/nuwax-agent/commit/de8e55a))
- Dependency status tracking (installed/missing/outdated)
- Install all missing dependencies at once
- Dependency summary statistics

#### User Interface (用户界面) [f3f211b](https://github.com/nuwax-ai/nuwax-agent/commit/f3f211b)
- Scene switcher in client page header
- Settings page redesign with configuration management
- Dependency page with real data service
- Login form component
- Tag markers for npm packages
- Confirmation dialogs for destructive actions
- Tauri + React + Ant Design client UI ([d923976](https://github.com/nuwax-ai/nuwax-agent/commit/d923976))

#### Permissions (权限管理)
- macOS permission request types and UI design ([cba1ffd](https://github.com/nuwax-ai/nuwax-agent/commit/cba1ffd))
- System permissions monitoring ([11d6560](https://github.com/nuwax-ai/nuwax-agent/commit/11d6560))
  - Camera, Microphone, Screen Recording
  - Accessibility, Full Disk Access
  - NuwaxCode/Claude Code specific permissions
- Permission status tracking (granted/denied/pending)
- Open system preferences for permission settings
- Permission refresh functionality
- Tauri multi-platform permission management plan ([ae41658](https://github.com/nuwax-ai/nuwax-agent/commit/ae41658))

#### Core Framework (核心框架)
- nuwax-agent-core public core library ([837b8c5](https://github.com/nuwax-ai/nuwax-agent/commit/837b8c5))
- agent-tauri-client module ([444a8c5](https://github.com/nuwax-ai/nuwax-agent/commit/444a8c5))
- AgentRunnerApi Trait interface ([da67507](https://github.com/nuwax-ai/nuwax-agent/commit/da67507))
- Cross-platform system permissions library ([11d6560](https://github.com/nuwax-ai/nuwax-agent/commit/11d6560))
- HTTP server support ([cedbe91](https://github.com/nuwax-ai/nuwax-agent/commit/cedbe91))
- SQLx compile-time verification ([dfb380a](https://github.com/nuwax-ai/nuwax-agent/commit/dfb380a))

### Changed
- Refactored settings page to use new configuration service
- Updated dependency page with real data service
- Unified HTTP Server error handling ([e8c5e3d](https://github.com/nuwax-ai/nuwax-agent/commit/e8c5e3d))
- Refactored API module and ViewModel architecture ([39efc1e](https://github.com/nuwax-ai/nuwax-agent/commit/39efc1e), [edb1fee](https://github.com/nuwax-ai/nuwax-agent/commit/edb1fee))
- Fixed system permissions and migrated to objc2 ([d2f048b](https://github.com/nuwax-ai/nuwax-agent/commit/d2f048b))
- Fixed BusinessEnvelope and BusinessMessageType compilation errors ([8887647](https://github.com/nuwax-ai/nuwax-agent/commit/8887647))
- Removed unused Layout component import ([a29005c](https://github.com/nuwax-ai/nuwax-agent/commit/a29005c))
- Removed title bar and fixed UI layout ([8ae481b](https://github.com/nuwax-ai/nuwax-agent/commit/8ae481b))
- Refactored chat component for multi-line input ([7516f16](https://github.com/nuwax-ai/nuwax-agent/commit/7516f16))
- Enhanced chat component UI and message handling ([3bed47a](https://github.com/nuwax-ai/nuwax-agent/commit/3bed47a))
- Added logging functionality ([7e3b031](https://github.com/nuwax-ai/nuwax-agent/commit/7e3b031))

### Fixed
- Fixed permission system and migrated to objc2 ([d2f048b](https://github.com/nuwax-ai/nuwax-agent/commit/d2f048b))
- Fixed compilation errors in BusinessEnvelope ([8887647](https://github.com/nuwax-ai/nuwax-agent/commit/8887647))
- Fixed UI layout issues ([8ae481b](https://github.com/nuwax-ai/nuwax-agent/commit/8ae481b))

### Security
- TODO: Heartbeat mechanism for session persistence

### Documentation (文档)
- Added project guide documentation and process records ([8c9919a](https://github.com/nuwax-ai/nuwax-agent/commit/8c9919a))
- Agent permissions plan (6-week implementation) ([16fc674](https://github.com/nuwax-ai/nuwax-agent/commit/16fc674))
- Updated agent permissions plan ([f088b5b](https://github.com/nuwax-ai/nuwax-agent/commit/f088b5b))
- Removed local paths from reference projects ([9d45829](https://github.com/nuwax-ai/nuwax-agent/commit/9d45829))
- Updated permission plan with GitHub links ([86da7c2](https://github.com/nuwax-ai/nuwax-agent/commit/86da7c2))
- Tauri multi-platform permission management plan ([ae41658](https://github.com/nuwax-ai/nuwax-agent/commit/ae41658))
- Permission management comprehensive plan ([3c35227](https://github.com/nuwax-ai/nuwax-agent/commit/3c35227))
-紧密结全现有实现的新plan ([1f0e51d](https://github.com/nuwax-ai/nuwax-agent/commit/1f0e51d))

### Chore (维护)
- Updated Cargo.lock ([d12c494](https://github.com/nuwax-ai/nuwax-agent/commit/d12c494), [6e9aaec](https://github.com/nuwax-ai/nuwax-agent/commit/6e9aaec))
- Temporarily excluded data-server module ([d99f1a6](https://github.com/nuwax-ai/nuwax-agent/commit/d99f1a6))
- Updated rustdesk-server submodule ([8095826](https://github.com/nuwax-ai/nuwax-agent/commit/8095826))
- Changed rustdesk-server default address to public IP ([7591816](https://github.com/nuwax-ai/nuwax-agent/commit/7591816))
- Makefile: enable all features by default ([8ae481b](https://github.com/nuwax-ai/nuwax-agent/commit/8ae481b))

---

## Previous Planning Versions

### v3.0 - New Implementation Plan [1f0e51d](https://github.com/nuwax-ai/nuwax-agent/commit/1f0e51d)
-紧密结合现有实现的新plan

### v2.0 - Permission Management Plan [3c35227](https://github.com/nuwax-ai/nuwax-agent/commit/3c35227)
- Comprehensive permission management design
- macOS permission request types

---

## Version Naming Convention

This project follows **Semantic Versioning**:
- **Major** (X.0.0): Breaking changes
- **Minor** (0.X.0): New features, backward compatible
- **Patch** (0.0.X): Bug fixes, backward compatible

---

[Unreleased]: https://github.com/nuwax-ai/nuwax-agent/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/nuwax-ai/nuwax-agent/releases/tag/v0.1.0
