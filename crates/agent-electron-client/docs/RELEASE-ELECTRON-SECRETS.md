# Release Electron — GitHub Actions Secrets 说明

推送 `electron-v*` tag 触发的 **Release Electron App** workflow 会使用以下 Secrets。可与 Tauri 共用 Apple 相关项。

## 必填（否则对应功能不可用）

| Secret | 说明 | 示例/格式 |
|--------|------|-----------|
| **GH_PAT** | GitHub Personal Access Token，用于创建 Release、上传安装包 | 需勾选 `contents: write` |
| **APPLE_CERTIFICATE** | Developer ID Application 证书（.p12）的 **Base64 编码** | `base64 -i YourApp.p12 \| pbcopy` |
| **APPLE_CERTIFICATE_PASSWORD** | 导出 .p12 时设置的密码 | 字符串 |
| **APPLE_SIGNING_IDENTITY** | 钥匙串中证书的**完整名称**，用于签名与 `CSC_NAME` | 如 `Developer ID Application: Your Name (TEAM_ID)` |

未配置 **APPLE_CERTIFICATE** 时，Mac 会打**无签名包**，用户打开会提示「已损坏」，需配置上述四项并重新构建。

## 公证（强烈建议，否则 Gatekeeper 可能仍拦）

| Secret | 说明 | 示例/格式 |
|--------|------|-----------|
| **APPLE_API_KEY** | App Store Connect 的 **API Key（.p8）文件内容的 Base64**，**不是**文件路径 | `base64 -i AuthKey_xxx.p8 \| pbcopy` |
| **APPLE_API_KEY_ID** | 该 .p8 的 Key ID（10 位） | 如 `ABCD1234EF` |
| **APPLE_ISSUER_ID** 或 **APPLE_API_ISSUER** | App Store Connect → Users and Access → Integrations 中的 **Issuer ID** | UUID 格式 |

- Workflow 会把 **APPLE_API_KEY** 的 Base64 解码为临时 .p8 文件，再设 `APPLE_API_KEY` 为该文件路径供 electron-builder 公证。
- 若只配置了 **APPLE_ISSUER_ID** 而未配置 **APPLE_API_ISSUER**，workflow 会使用 **APPLE_ISSUER_ID** 作为 Issuer。

## 你仓库中与 Electron 无关的 Secret（workflow 未使用）

以下由 Tauri 或其他流程使用，Release Electron **不会读取**：

- `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID` — 公证可用 .p8 方式，不必须
- `APPLE_API_KEY_PATH` — 本 workflow 使用 **APPLE_API_KEY**（Base64 内容），不用路径
- `TAURI_SIGNING_*` / `OSS_*` — Tauri 与 OSS 用

## 快速核对

1. **APPLE_SIGNING_IDENTITY** 必须与钥匙串里证书名称**完全一致**（可在钥匙串访问中复制）。
2. **APPLE_API_KEY** 的值必须是「把整个 .p8 文件用 base64 编码」后的字符串，不能是文件路径或 Key ID。
3. 重新跑一次 Release（重新打 tag），在 Actions 里看 macOS 任务日志，确认有签名与公证成功、无 “signing will be skipped” / “notarization will be skipped”。
