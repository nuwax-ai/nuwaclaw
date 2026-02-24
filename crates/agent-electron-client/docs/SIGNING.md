# macOS 签名与公证指南

## 概述

macOS 应用签名和公证是分发给用户的必要步骤，确保应用可以在 Gatekeeper 保护下正常运行。

## 基本概念

### 签名 (Signing)

- **Developer ID Application 证书**: 用于签名分发到 macOS 的应用
- **Hardened Runtime**: 提供额外的安全保护，是公证的必要条件
- **Entitlements**: 声明应用需要的权限

### 公证 (Notarization)

- Apple 的安全服务，验证开发者身份
- 从 macOS 10.15 开始，所有分发应用都需要公证
- 公证后的应用首次打开时不会再显示警告

## 环境变量

| 环境变量 | 说明 | 必需 |
|---------|------|-----|
| `APPLE_SIGNING_IDENTITY` | Developer ID Application 证书 identity | 是 (签名) |
| `APPLE_TEAM_ID` | Apple Developer Team ID (10位字符) | 是 (公证) |
| `APPLE_API_KEY` | 公证用的 API Key (.p8文件) | 否 (推荐) |
| `APPLE_API_KEY_ID` | API Key ID | 否 (与 API Key 一起) |
| `APPLE_API_ISSUER` | API Issuer ID | 否 (与 API Key 一起) |

## 获取证书和 Team ID

### 1. 获取 Developer ID 证书

```bash
# 登录 Apple Developer
# 证书地址: https://developer.apple.com/account/resources/certificates/list

# 创建证书: Developer ID Application
# 下载后双击安装到钥匙串
```

### 2. 查看已安装的证书

```bash
security find-identity -v -p codesigning
```

输出示例:
```
  1) 84A1234567 "Developer ID Application: Your Name (TEAMID)"
  2) 12ABCDEF34 "Apple Development: your.email@example.com (TEAMID)"
```

使用第一个 (Developer ID Application) 的 identity 或名称。

### 3. 获取 Team ID

- 登录 https://developer.apple.com/account
- 在 "Membership" 页面查看 "Team ID"

## 签名配置

项目已配置以下签名相关文件:

### entitlements.mac.plist

独立分发使用的权限配置:

```xml
- com.apple.security.cs.allow-jit              # V8 JIT
- com.apple.security.cs.allow-unsigned-executable-memory
- com.apple.security.cs.disable-library-validation
- com.apple.security.network.client             # 网络访问
- com.apple.security.network.server             # 本地服务器
- com.apple.security.temporary-exception.files.absolute.read-write  # 文件访问
```

### entitlements.mas.plist

App Store 分发使用的权限配置 (更严格)。

### afterSign 钩子

`scripts/after-sign.js` 会在 electron-builder 签名后执行:

1. 签名 better-sqlite3 .node 文件
2. 签名 resources/uv 可执行文件
3. 签名 resources/lanproxy 可执行文件
4. **对主 .app 重新签名**（恢复 seal，否则会报 "a sealed resource is missing or invalid"）
5. 验证整体签名
6. 验证 Gatekeeper 策略

## 构建命令

### 开发构建 (无签名)

```bash
npm run dist:unsigned
```

### 正式构建 (带签名 + 公证)

```bash
# 使用环境变量
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"
export APPLE_TEAM_ID="YOUR_TEAM_ID"
npm run dist:mac

# 或一行命令
APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)" \
APPLE_TEAM_ID="YOUR_TEAM_ID" \
npm run dist:mac
```

### 仅签名不公证

```bash
APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)" \
CSC_IDENTITY_AUTO_DISCOVERY=true \
npm run dist:mac
```

## 验证签名

```bash
# 自动查找并验证最新的 .app
npm run verify:sign

# 或指定路径
npm run verify:sign "release/mac-universal/Nuwax Agent.app"
```

### 本地打包后验证 seal（推荐）

打完包或从 CI 下载安装后，可用下面命令确认签名与 seal 是否完整（无 "file modified" 即正常）:

```bash
# 替换成你机器上的实际路径，例如已安装到应用程序时:
APP_PATH="/Applications/Nuwax Agent.app"

# 严格验证（含 seal）
codesign --verify --deep --strict --verbose=2 "$APP_PATH"
```

若仍提示「已损坏」且验证通过，可去掉隔离属性后再打开:

```bash
xattr -cr "$APP_PATH"
```

验证输出包括:
- 整体签名状态
- bundled 二进制文件签名状态
- Hardened Runtime 状态
- Gatekeeper 验证结果

## 手动签名

如果需要手动对已打包的应用进行签名:

```bash
# 设置变量
APP_PATH="release/mac-universal/Nuwax Agent.app"
IDENTITY="Developer ID Application: Your Name (TEAMID)"

# 签名整个 app
codesign --force --options runtime --timestamp --deep \
  -s "$IDENTITY" "$APP_PATH"

# 验证签名
codesign --verify --deep --strict "$APP_PATH"

# 查看 entitlements
codesign --display --entitlements - "$APP_PATH"
```

## 常见问题

### 签名后应用无法启动

```bash
# 检查签名状态
codesign -dv "$APP_PATH"

# 移除扩展属性 (如果有)
xattr -cr "$APP_PATH"

# 重新签名
codesign --force --deep -s "$IDENTITY" "$APP_PATH"
```

### "code object is not signed at all"

确保:
1. 证书已正确安装
2. `APPLE_SIGNING_IDENTITY` 环境变量正确
3. 证书未过期

### 公证失败

检查:
1. Team ID 是否正确 (10位字符)
2. Apple Developer 账号状态
3. 是否使用了 App Store 专用证书 (应用用 Developer ID Application)

### better-sqlite3 签名问题

`afterSign` 钩子会处理 native 模块签名。如果仍有问题:

```bash
# 手动签名
codesign --force --options runtime -s "$IDENTITY" \
  "$APP_PATH/Contents/Resources/app.asar.unpacked/node_modules/better-sqlite3/build/Release/*.node"
```

## CI/CD 配置

### GitHub Actions

```yaml
- name: Build and sign (macOS)
  if: matrix.os == 'macos-latest'
  env:
    APPLE_SIGNING_IDENTITY: ${{ secrets.APPLE_SIGNING_IDENTITY }}
    APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
    APPLE_API_KEY: ${{ secrets.APPLE_API_KEY }}
    APPLE_API_KEY_ID: ${{ secrets.APPLE_API_KEY_ID }}
    APPLE_API_ISSUER: ${{ secrets.APPLE_API_ISSUER }}
  run: npm run dist:mac
```

### Secrets 配置

在 GitHub Repository Settings > Secrets and variables > Actions 中添加:

| Secret | 值 |
|--------|-----|
| `APPLE_SIGNING_IDENTITY` | Developer ID Application: Your Name (TEAMID) |
| `APPLE_TEAM_ID` | 10位 Team ID |
| `APPLE_API_KEY` | API Key 内容 (.p8文件) |
| `APPLE_API_KEY_ID` | API Key ID |
| `APPLE_API_ISSUER` | Issuer ID (UUID) |

## 参考资源

- [Electron 代码签名](https://www.electronjs.org/docs/latest/tutorial/code-signing)
- [electron-builder 配置](https://www.electron.build/code-signing)
- [Apple 公证文档](https://developer.apple.com/documentation/security/notarizing_macos_software_before_distribution)
