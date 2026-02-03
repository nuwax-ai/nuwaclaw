# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-02-04

### Added
- **Authentication**: Login functionality with username/password
  - Client registration via `POST /api/sandbox/config/reg`
  - Token/configKey persistence to localStorage
  - User session management
- **Multi-environment Support**: Configuration management for different deployment scenarios
  - Scene switching component (local/dev/prod environments)
  - Custom configuration editor
  - Server and local services configuration (Agent, VNC, FileServer, WebSocket)
- **Dependency Management**: System dependency detection and installation
  - Node.js, Git, Python, Docker, Rust, npm tools support
  - Installation and uninstallation of global npm/pnpm packages
  - Dependency status tracking
- **User Interface**
  - Login form with success state display
  - Scene switcher in client page header
  - Settings page with full configuration management

### Changed
- Refactored settings page to use new configuration service
- Updated dependency page with real data service

### Security
- TODO: Heartbeat mechanism for session persistence

[Unreleased]: https://github.com/nuwax-ai/nuwax-agent/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/nuwax-ai/nuwax-agent/releases/tag/v0.1.0
