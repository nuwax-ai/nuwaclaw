# Windows 代码签名流程

本文档说明如何在本地对 Windows 安装包进行代码签名。

> ⚠️ **重要说明**：当前 Windows 客户端签名**仅支持本地手签方案**，不支持 CI/CD 自动化签名。
>
> 原因：使用 Certum SimplySign 云证书，需要通过手机 APP 获取动态 token 进行二次验证，无法在无人值守的 CI 环境中完成。

## 相关文件

| 文件 | 说明 |
|------|------|
| [sign-release-win.sh](./sign-release-win.sh) | 完整签名流程脚本 |
| [sign-win.js](./sign-win.js) | 签名工具模块 |

## 签名流程概览

```
┌──────────────────────────────────────────────────────────────────────────┐
│                        Windows 客户端签名流程                              │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   GitHub CI                                                              │
│   ┌─────────┐                                                            │
│   │  Build  │ ─── 构建 unsigned 安装包 ───▶ GitHub Release               │
│   └─────────┘                                (未签名)                     │
│                                                                            │
│   本地手签                                                                 │
│   ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐              │
│   │Download │───▶│  Sign   │───▶│ Verify  │───▶│ Upload  │              │
│   │ (gh cli)│    │(signtool)│    │(signtool)│    │ (gh cli)│              │
│   └─────────┘    └─────────┘    └─────────┘    └─────────┘              │
│        │              │              │              │                     │
│        ▼              ▼              ▼              ▼                     │
│    unsigned/      unsigned/      signed/       GitHub Release            │
│                                  (copy)        (已签名)                  │
│                                                                            │
└──────────────────────────────────────────────────────────────────────────┘
```

## 前置要求

### 1. SimplySign Desktop 客户端

Certum 云代码签名证书需要安装 SimplySign Desktop 客户端来加载证书。

**下载地址：**
- Windows 64 位: https://www.certum.eu/data/other/SimplySign/SimplySignDesktop_x64.exe
- Windows 32 位: https://www.certum.eu/data/other/SimplySign/SimplySignDesktop_x86.exe
- Mac OS X: https://www.certum.eu/data/other/SimplySign/SimplySignDesktop.dmg

**安装步骤：**
1. 运行安装程序，语言选择 **English**
2. 安装路径可自定义
3. 组件选择时，仅勾选 **SimplySign Desktop**（不需要 proCertum SmartSign）

**登录配置：**
1. 输入注册邮箱
2. 打开手机 SimplySign APP 获取 token 密码
3. 输入 token 完成登录

**获取证书指纹：**
1. 登录后软件最小化到系统托盘
2. 右键图标 → Manage certificates → Certificate list
3. 双击证书查看指纹 (Thumbprint)

### 2. Windows SDK

包含 `signtool.exe` 签名工具。

- 安装路径: `C:\Program Files (x86)\Windows Kits\10\bin\{version}\x64\`
- 下载: https://developer.microsoft.com/en-us/windows/downloads/windows-sdk/

### 3. GitHub CLI

用于下载和上传 release 文件：
```bash
gh auth status
```

## 环境变量配置

在签名前需要设置以下环境变量：

```bash
# 必需 - 证书指纹（从 SimplySign Desktop 中获取）
export WINDOWS_CERTIFICATE_SHA1="<your-certificate-thumbprint>"

# 可选（有默认值）
export WINDOWS_TIMESTAMP_URL="http://timestamp.sectigo.com"
export WINDOWS_PUBLISHER_NAME="成都第二空间智能科技有限公司"
```

> 💡 建议将环境变量添加到 `~/.bashrc` 或 `~/.bash_profile` 中持久化保存。

## 检查签名状态

在签名前，建议先检查 release 的签名状态，避免重复操作。

### 方法一：检查 Release 文件列表

```bash
# 查看 release 中的 Windows 安装包
gh release view electron-v0.9.2 --repo nuwax-ai/nuwaclaw --json assets \
  --jq '.assets[] | select(.name | test("NuwaClaw.*\\.(exe|msi)$")) | .name'
```

**判断标准：**
| 文件名模式 | 签名状态 | 操作 |
|-----------|---------|------|
| `*-unsigned.exe` / `*-unsigned.msi` | 未签名 | 需要执行签名 |
| `NuwaClaw-Setup-x.x.x.exe` / `NuwaClaw-x.x.x.msi` | 已签名 | 无需操作 |

### 方法二：下载并验证签名

```bash
# 下载文件到临时目录
mkdir -p /c/tmp/nuwaclaw-sign/check && cd /c/tmp/nuwaclaw-sign/check
gh release download electron-v0.9.2 --repo nuwax-ai/nuwaclaw \
  --pattern "NuwaClaw-Setup-*.exe" --pattern "NuwaClaw-*.msi"

# 验证签名
"/c/Program Files (x86)/Windows Kits/10/bin/10.0.26100.0/x64/signtool.exe" \
  verify //pa //all NuwaClaw-Setup-0.9.2.exe
```

**输出解读：**
- `Successfully verified` → 已签名 ✓
- `SignerTool does not support...` 或错误 → 未签名或签名无效

## 使用方法

### 完整流程（推荐）

下载 → 签名 → 验证 → 上传：

```bash
cd crates/agent-electron-client
./scripts/build/sign-release-win.sh 0.9.2
```

### 跳过下载

如果已有未签名的文件：

```bash
./scripts/build/sign-release-win.sh 0.9.2 --skip-download
```

### 跳过上传

仅本地签名，不上传到 GitHub：

```bash
./scripts/build/sign-release-win.sh 0.9.2 --skip-upload
```

### 组合使用

```bash
./scripts/build/sign-release-win.sh 0.9.2 --skip-download --skip-upload
```

## 多次构建/签名场景

### 场景一：同一版本重新打包后签名

如果 CI 重新构建了同一版本（修复构建问题等），release 中会出现新的 `-unsigned` 文件：

```
Release 资产列表:
├── NuwaClaw-Setup-0.9.2.exe          # 旧的已签名文件
├── NuwaClaw-0.9.2.msi                # 旧的已签名文件
├── NuwaClaw-Setup-0.9.2-unsigned.exe # 新的未签名文件 (CI 重新构建)
└── NuwaClaw-0.9.2-unsigned.msi       # 新的未签名文件 (CI 重新构建)
```

**处理方式：** 直接运行签名脚本，它会：
1. 下载新的 `-unsigned` 文件
2. 签名后覆盖旧的已签名文件
3. 删除 `-unsigned` 文件

```bash
./scripts/build/sign-release-win.sh 0.9.2  # 正常执行即可
```

### 场景二：重新签名已签名的文件

如果需要重新签名（证书更新等），需要先让 CI 重新构建：

```bash
# 1. 触发 CI 重新构建（推送 tag 或手动触发）
# 2. CI 会生成新的 -unsigned 文件
# 3. 然后执行签名脚本
./scripts/build/sign-release-win.sh 0.9.2
```

> ⚠️ **注意**：不能直接对已签名的文件再次签名，需要从 CI 获取新的未签名文件。

### 场景三：检查是否需要签名

```bash
# 快速检查 release 中是否有 -unsigned 文件
gh release view electron-v0.9.2 --repo nuwax-ai/nuwaclaw --json assets \
  --jq '.assets[] | select(.name | test("-unsigned\\.(exe|msi)$")) | .name'

# 有输出 → 需要签名
# 无输出 → 已签名或无 Windows 构建
```

## 目录结构

```
C:\tmp\nuwaclaw-sign\
├── unsigned/                              # 从 GitHub 下载的未签名文件
│   ├── NuwaClaw-Setup-0.9.2-unsigned.exe
│   └── NuwaClaw-0.9.2-unsigned.msi
│
└── signed/                                # 已签名文件（重命名为正式名称）
    ├── NuwaClaw-Setup-0.9.2.exe
    └── NuwaClaw-0.9.2.msi
```

## 文件命名规则

| 阶段 | EXE 文件名 | MSI 文件名 |
|------|-----------|-----------|
| CI 构建 | `NuwaClaw-Setup-{version}-unsigned.exe` | `NuwaClaw-{version}-unsigned.msi` |
| 本地签名后 | `NuwaClaw-Setup-{version}.exe` | `NuwaClaw-{version}.msi` |

## 流程步骤说明

| 步骤 | 命令/工具 | 说明 |
|------|-----------|------|
| Download | `gh release download` | 从 GitHub Release 下载 `.exe` 和 `.msi` 到 `unsigned/` |
| Sign | `signtool sign` | 使用证书进行代码签名（需要 SimplySign token） |
| Verify | `signtool verify` | 验证签名有效性 |
| Copy | `cp` | 复制已签名文件到 `signed/` |
| Upload | `gh release upload` | 上传到 GitHub Release（覆盖未签名文件） |

## 手动签名（可选）

如果需要单独签名某个文件：

```bash
# 设置 PATH（包含 signtool）
export PATH="/c/Program Files (x86)/Windows Kits/10/bin/10.0.26100.0/x64:$PATH"

# 设置环境变量
export WINDOWS_CERTIFICATE_SHA1="<your-certificate-thumbprint>"
export WINDOWS_TIMESTAMP_URL="http://timestamp.sectigo.com"

# 签名
node scripts/build/sign-win.js /path/to/file.exe

# 验证
signtool verify //pa //all /path/to/file.exe
```

## 常见问题

### Q: 为什么不支持 CI 自动签名？

Certum SimplySign 是云证书方案，需要通过手机 APP 获取动态 token 进行二次验证（2FA），这要求必须有人工参与，无法在无人值守的 CI 环境中完成。

### Q: signtool 找不到？

确保已安装 Windows SDK，脚本会自动搜索以下路径：
- `C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0\x64`
- `C:\Program Files (x86)\Windows Kits\10\bin\x64`

### Q: 证书未找到？

检查证书是否正确加载：
```powershell
# PowerShell - 列出所有代码签名证书
Get-ChildItem Cert:\CurrentUser\My | Where-Object { $_.EnhancedKeyUsageList -match "Code Signing" }
```

确保 SimplySign Desktop 已登录且证书已加载。

### Q: 网络超时？

下载或上传可能因网络问题超时，可以：
1. 使用 `--skip-download` 跳过下载
2. 使用 `--skip-upload` 跳过上传，稍后手动上传

### Q: MSI 签名失败？

确保下载的 MSI 文件完整（未截断）。检查文件大小是否合理（通常 > 100MB）。

### Q: NSIS 安装包完整性错误？

如果签名后的安装包运行时出现 "Installer integrity check has failed" 错误：
1. 验证下载文件 SHA256 是否正确
2. 重新下载原始文件
3. 检查原始 CI 构建是否有问题

## 参考链接

- [Certum SimplySign 使用教程](https://ssldun.net/html/guide_cn/show-1703.html)
- [SimplySign 证书提取](https://ssldun.net/html/guide_cn/show-1702.html)

## 更新日志

| 日期 | 说明 |
|------|------|
| 2026-03-26 | 添加签名状态检查和多次构建/签名场景说明 |
| 2026-03-26 | 创建签名流程文档，明确仅支持本地手签方案 |
