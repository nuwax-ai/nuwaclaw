# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-02-04

### Added

#### Authentication (登录认证)
- Login functionality with username/password ([dc9e212](https://github.com/nuwax-ai/nuwax-agent/commit/dc9e212))
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

#### User Interface (用户界面)
- Scene switcher in client page header
- Settings page redesign with configuration management
- Dependency page with real data service ([f3f211b](https://github.com/nuwax-ai/nuwax-agent/commit/f3f211b))
- Login form component
- Tag markers for npm packages
- Confirmation dialogs for destructive actions

#### Permissions (权限管理)
- macOS permission request types and UI design
- System permissions monitoring (Camera, Microphone, Screen Recording, etc.)
- Permission status tracking (granted/denied/pending)
- Open system preferences for permission settings
- Permission refresh functionality

### Changed
- Refactored settings page to use new configuration service
- Updated dependency page with real data service

### Security
- TODO: Heartbeat mechanism for session persistence

---

## Previous Versions

### v2.0 - Permission Management Plan [3c35227](https://github.com/nuwax-ai/nuwax-agent/commit/3c35227)
- Comprehensive permission management design

### v3.0 - New Implementation Plan [1f0e51d](https://github.com/nuwax-ai/nuwax-agent/commit/1f0e51d)
-紧密结合现有实现的新plan

---

[Unreleased]: https://github.com/nuwax-ai/nuwax-agent/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/nuwax-ai/nuwax-agent/releases/tag/v0.1.0
