# macOS 打包签名与公证指南

本文档介绍 nuwax-agent 在 macOS 上的打包、签名和公证流程。

## 打包产物

| 产物格式 | 说明 | 适用场景 |
|----------|------|----------|
| `.dmg` | 磁盘映像，安装更直观 | 分发给终端用户 |
| `.pkg` | 安装包，支持命令行安装 | 企业部署 |
| `.zip` | 压缩包，解压即用 | 开发者测试 |

## 前置要求

### 系统要求

- macOS 10.15+ (推荐 12+)
- Xcode Command Line Tools: `xcode-select --install`
- Apple Developer Account (付费开发者)

### 证书要求

| 证书类型 | 用途 | 获取方式 |
|----------|------|----------|
| Apple Development | 开发调试 | Xcode 自动管理 |
| Apple Distribution | 分发签名 | Apple Developer Portal |
| Developer ID Application | 独立应用签名 | Apple Developer Portal |
| Developer ID Installer | 安装包签名 | Apple Developer Portal |

### 安装证书

```bash
# 查看已安装证书
security find-identity -v -p codesigning

# 导入证书（从 .p12 文件）
security import developer.p12 -P your_password -A -t cert -f pkcs12 -k ~/Library/Keychains/login.keychain

# 或者使用 Xcode 自动管理
xcodebuild -list
```

## 签名配置

### tauri.conf.json 配置

```json
{
  "bundle": {
    "active": true,
    "targets": "all",
    "identifier": "com.nuwax.agent-tauri-client",
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ],
    "macOS": {
      "entitlements": "entitlements.plist",
      "frameworks": [],
      "providerShortName": null,
      "signingIdentity": null,
      "hardenedRuntime": true
    }
  }
}
```

### entitlements.plist

创建 `src-tauri/entitlements.plist`：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <!-- 辅助功能权限 -->
    <key>com.apple.security.app-sandbox</key>
    <true/>
    <key>com.apple.security.application-groups</key>
    <array/>
    <key>com.apple.security.assets-library.read-only</key>
    <true/>
    <key>com.apple.security.automatic-background-purposes</key>
    <string>All</string>
    <key>com.apple.security.device.audio-input</key>
    <true/>
    <key>com.apple.security.device.camera</key>
    <true/>
    <key>com.apple.security.files.user-selected.read-only</key>
    <true/>
    <key>com.apple.security.network.client</key>
    <true/>
    <key>com.apple.security.persistent-information</key>
    <true/>
    <key>com.apple.security.print</key>
    <true/>
    <key>com.apple.security.screen-capture</key>
    <true/>
</dict>
</plist>
```

## 签名命令

### 方式 1：使用 Tauri CLI（推荐）

```bash
# 开发构建并签名
pnpm tauri build --debug

# 生产构建并签名
pnpm tauri build

# 指定签名身份
pnpm tauri build --signing-identity "Developer ID Application: Your Name (TEAMID)"
```

### 方式 2：手动签名

```bash
# 1. 构建应用
pnpm tauri build

# 2. 找到产物
ls -la src-tauri/target/release/bundle/

# 3. 签名应用
codesign --sign "Developer ID Application: Your Name (TEAMID)" \
  --entitlements src-tauri/entitlements.plist \
  --timestamp \
  --options runtime \
  "src-tauri/target/release/bundle/macos/nuwax-agent.app"

# 4. 验证签名
codesign --verify --deep --strict --verbose=2 \
  "src-tauri/target/release/bundle/macos/nuwax-agent.app"

# 5. 查看签名信息
codesign --display --entitlements - \
  "src-tauri/target/release/bundle/macos/nuwax-agent.app"
```

### 常用签名选项

```bash
# 签名并移除签名信息中的开发团队ID（用于公证）
codesign --sign "Developer ID Application: Your Name (TEAMID)" \
  --entitlements entitlements.plist \
  --timestamp \
  --options runtime \
  --remove-signature \
  your-app.app

# 仅签名，不覆盖已有签名
codesign --sign "Developer ID Application: Your Name (TEAMID)" \
  --preserve-metadata=identifier,entitlements,flags,info.plist \
  your-app.app

# 深度签名（包含所有嵌套二进制）
codesign --sign "Developer ID Application: Your Name (TEAMID)" \
  --deep \
  your-app.app
```

## 公证流程

### 为什么需要公证？

从 macOS Catalina (10.15) 开始，所有分发给用户的应用都需要：
- 经过 Apple 公证 (Notarization)
- 或来自 Mac App Store

未公证的应用：
- 首次运行时会显示"无法验证开发者"警告
- Gatekeeper 会阻止运行

### 公证步骤

#### 方式 1：使用 Tauri CLI

```bash
# 构建后自动公证
pnpm tauri build

# 或手动上传公证
pnpm tauri build && \
xcrun notarytool submit "src-tauri/target/release/bundle/dmg/nuwax-agent_x.x.x_x64.dmg" \
  --apple-api-key ~/.apple_api/AuthKey_XXXXXXXXXX.p8 \
  --apple-api-key-id XXXXXXXXXX \
  --apple-team-id YOURTEAMID \
  --wait
```

#### 方式 2：手动公证

```bash
# 1. 上传公证
xcrun altool --notarize-app \
  --primary-bundle-id com.nuwax.agent \
  --username "your@email.com" \
  --password "@keychain:AC_PASSWORD" \
  --file "nuwax-agent_x.x.x_x64.dmg"

# 记录返回的 RequestUUID
# 例如：2e7d1234-5678-90ab-cdef-1234567890ab

# 2. 检查公证状态
xcrun altool --notarization-info 2e7d1234-5678-90ab-cdef-1234567890ab \
  --username "your@email.com" \
  --password "@keychain:AC_PASSWORD"

# 3. 等待完成（可能需要几分钟到几小时）
# 状态变为 "Success" 后继续

# 4. 绑定公证票据
xcrun stapler staple "nuwax-agent_x.x.x_x64.dmg"

# 5. 验证
xcrun stapler validate -b com.nuwax.agent "nuwax-agent_x.x.x_x64.dmg"
```

### Apple API Key 配置（推荐）

使用 API Key 进行公证，无需输入密码：

```bash
# 创建 API Key（需要 Apple Developer Portal 管理员权限）
# 位置：https://developer.apple.com/account/resources/authkeys

# 下载 .p8 文件，保存到 ~/.apple_api/AuthKey_XXXXXXXXXX.p8

# 设置权限
chmod 600 ~/.apple_api/AuthKey_XXXXXXXXXX.p8

# 使用 notarytool
xcrun notarytool submit your-app.dmg \
  --apple-api-key ~/.apple_api/AuthKey_XXXXXXXXXX.p8 \
  --apple-api-key-id XXXXXXXXXX \
  --apple-api-issuer YOUR-ISSUER-ID \
  --wait
```

### 公证问题排查

#### 公证失败：签名问题

```bash
# 检查签名
codesign --verify --deep --strict your-app.app

# 查看详细错误
codesign --verify --verbose=your-app.app
```

#### 公证失败：权限问题

```bash
# 检查 entitlements
codesign --display --entitlements - your-app.app

# 常见问题
# 1. 缺少 hardened runtime
# 2. 权限配置错误
# 3. 禁止的 API 调用
```

#### 公证状态查询

```bash
# 使用 altool
xcrun altool --notarization-info REQUEST_UUID \
  --username "your@email.com" \
  --password "@keychain:AC_PASSWORD"

# 使用 notarytool（推荐）
xcrun notarytool info REQUEST_UUID \
  --apple-api-key ~/.apple_api/AuthKey_XXXXXXXXXX.p8 \
  --apple-api-key-id XXXXXXXXXX \
  --apple-api-issuer YOUR-ISSUER-ID
```

## 打包命令

### 完整打包流程

```bash
#!/bin/bash
set -e

APP_NAME="nuwax-agent"
VERSION=$(node -p "require('./package.json').version")
TEAMID="YOURTEAMID"
SIGNING_ID="Developer ID Application: Your Name ($TEAMID)"

echo "Building $APP_NAME v$VERSION..."

# 1. 构建
cd crates/agent-tauri-client
pnpm tauri build --release

# 2. 签名
echo "Signing..."
codesign --sign "$SIGNING_ID" \
  --entitlements src-tauri/entitlements.plist \
  --timestamp \
  --options runtime \
  "src-tauri/target/release/bundle/macos/$APP_NAME.app"

# 3. 验证签名
codesign --verify --deep --strict \
  "src-tauri/target/release/bundle/macos/$APP_NAME.app"

# 4. 创建 DMG
echo "Creating DMG..."
cd src-tauri/target/release/bundle/macos
mkdir -p tmp_dmg
cp -R "$APP_NAME.app" tmp_dmg/
hdiutil create -volname "$APP_NAME $VERSION" \
  -srcfolder tmp_dmg \
  -ov -format UDBZ \
  "$APP_NAME\_$VERSION.dmg"
rm -rf tmp_dmg

# 5. 签名 DMG
codesign --sign "$SIGNING_ID" \
  --timestamp \
  "$APP_NAME\_$VERSION.dmg"

# 6. 上传公证
echo "Submitting for notarization..."
cd ..
xcrun notarytool submit "$APP_NAME\_$VERSION.dmg" \
  --apple-api-key ~/.apple_api/AuthKey_XXXXXXXXXX.p8 \
  --apple-api-key-id XXXXXXXXXX \
  --apple-api-issuer YOUR-ISSUER-ID \
  --wait

# 7. 绑定票据
xcrun stapler staple "$APP_NAME\_$VERSION.dmg"

# 8. 最终验证
xcrun stapler validate -b com.nuwax.agent "$APP_NAME\_$VERSION.dmg"

echo "Done! Output: bundle/macos/$APP_NAME\_$VERSION.dmg"
```

### CI/CD 中的使用

```yaml
# .github/workflows/release.yml
name: Release

on:
  release:
    types: [created]

jobs:
  macos:
    runs-on: macos-14
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Rust
        uses: dtolnay/rust-toolchain@stable
        with:
          target: aarch64-apple-darwin
      
      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: '20'
      
      - name: Install dependencies
        run: pnpm install
      
      - name: Build and Sign
        env:
          APPLE_API_KEY: ${{ secrets.APPLE_API_KEY }}
          APPLE_API_KEY_ID: ${{ secrets.APPLE_API_KEY_ID }}
          APPLE_API_ISSUER: ${{ secrets.APPLE_API_ISSUER }}
          MACOS_CERTIFICATE: ${{ secrets.MACOS_CERTIFICATE }}
          MACOS_CERTIFICATE_P12: ${{ secrets.MACOS_CERTIFICATE_P12 }}
          MACOS_CERTIFICATE_PASSWORD: ${{ secrets.MACOS_CERTIFICATE_PASSWORD }}
          TEAM_ID: ${{ secrets.TEAM_ID }}
        run: |
          # 导入证书
          echo "$MACOS_CERTIFICATE_P12" | base64 -d > certificate.p12
          security create-keychain -p "$MACOS_CERTIFICATE_PASSWORD" build.keychain
          security default-keychain -s build.keychain
          security unlock-keychain -p "$MACOS_CERTIFICATE_PASSWORD" build.keychain
          security import certificate.p12 -P "$MACOS_CERTIFICATE_PASSWORD" -A -t cert -f pkcs12 -k build.keychain
          
          # 构建
          pnpm tauri build --release
          
          # 签名
          codesign --sign "Developer ID Application: Your Name ($TEAM_ID)" \
            --entitlements src-tauri/entitlements.plist \
            --timestamp \
            --options runtime \
            "src-tauri/target/release/bundle/macos/Nuwax Agent.app"
          
          # 公证
          xcrun notarytool submit "src-tauri/target/release/bundle/dmg/Nuwax Agent_x.x.x_x64.dmg" \
            --apple-api-key ~/.apple_api/AuthKey_XXXXXXXXXX.p8 \
            --apple-api-key-id "$APPLE_API_KEY_ID" \
            --apple-api-issuer "$APPLE_API_ISSUER" \
            --wait
          
          xcrun stapler staple "src-tauri/target/release/bundle/dmg/Nuwax Agent_x.x.x_x64.dmg"
      
      - name: Upload Asset
        uses: actions/upload-release-asset@v1
        with:
          upload_url: ${{ github.event.release.upload_url }}
          asset_path: crates/agent-tauri-client/src-tauri/target/release/bundle/dmg/Nuwax Agent_x.x.x_x64.dmg
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

## 验证最终产物

```bash
# 1. 检查签名
spctl --assess --type execute --verbose=4 your-app.app
# 期望输出：your-app.app: accepted
#          source=Developer ID

# 2. 检查公证
spctl --assess --type open --context context:primary-signature -v your-app.dmg
# 期望输出：your-app.dmg: accepted
#          source=Notarized Developer ID

# 3. 检查 Gatekeeper 状态
system_profiler SPSoftwareDataType | grep "Gatekeeper"

# 4. 完整验证
codesign --verify --deep --strict --verbose=2 your-app.app
codesign --display --entitlements - your-app.app
```

## 常见问题

### Q1: 签名时 "resource fork" 错误

```bash
# 清理并重新签名
xattr -cr your-app.app
codesign --sign --force --deep your-app.app
```

### Q2: 公证时 "The binary is not signed" 错误

```bash
# 确保先签名再公证
codesign --sign "Developer ID Application: Your Name (TEAMID)" your-app.app
# 然后公证
xcrun notarytool submit your-app.dmg ...
```

### Q3: "App cannot be identified" 错误

```bash
# 检查签名
codesign --verify your-app.app

# 可能原因：
# 1. 未签名
# 2. 签名过期
# 3. 证书不受信任
```

### Q4: 公证时间过长

```bash
# 检查队列状态
xcrun altool --notarization-info REQUEST_UUID --username "your@email.com" --password "@keychain:AC_PASSWORD"

# 通常需要：
# - 新账户：几天到几周
# - 活跃开发者：几分钟到几小时
```

### Q5: DMG 安装后应用无法打开

```bash
# 检查应用签名
codesign --verify --deep --strict your-app.app

# 如果签名无效，重新签名
codesign --sign "Developer ID Application: Your Name (TEAMID)" \
  --entitlements entitlements.plist \
  --timestamp \
  --options runtime \
  your-app.app
```

## 相关链接

- [Apple Code Signing Guide](https://developer.apple.com/library/archive/documentation/Security/Conceptual/CodeSigningGuide/)
- [Tauri Bundler Guide](https://tauri.app/v1/guides/distribution/publishing/linux/)
- [Notarization Guide](https://developer.apple.com/documentation/security/notarizing_macos_software_before_distribution)
- [Notarytool Reference](https://developer.apple.com/documentation/security/notarizing_macos_software_using_the_notarytool)
- [Hardened Runtime Requirements](https://developer.apple.com/documentation/security/hardened_runtime_entitlements)
