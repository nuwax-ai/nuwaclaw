# Windows 签名配置指南

本文档介绍 nuwax-agent 在 Windows 上的代码签名和 MSIX 打包流程。

## 签名概述

### 为什么需要签名？

- **SmartScreen 信任**：未签名的应用会被 Windows SmartScreen 标记为风险
- **企业部署**：许多企业要求代码签名才能部署
- **用户信任**：签名证书证明应用来源可信

### 签名类型

| 类型 | 用途 | 价格 |
|------|------|------|
| OV Code Signing | 基础签名（组织验证） | $200-400/年 |
| EV Code Signing | 高级签名（硬件令牌） | $300-600/年 |
| Microsoft Store | Store 分发 | 免费 |

**推荐**：EV Code Signing（立即获得 SmartScreen 信任）

## 证书获取

### OV 证书（推荐个人/小团队）

购买途径：
- DigiCert: $370/年
- GlobalSign: $250/年
- Sectigo: $180/年

### EV 证书（推荐企业）

购买途径：
- DigiCert: $440/年
- GlobalSign: $400/年
- SSL.com: $250/年

### Microsoft Store 证书

在 Microsoft Partner Center 创建：
1. 注册 Microsoft Partner Center
2. 创建应用提交
3. 创建 Store 证书（免费）

## 证书格式

### PFX/P12 文件

```bash
# 证书通常提供为 .pfx 或 .p12 文件
# 包含：
# - 代码签名证书
# - 私钥
# - 证书链

# 查看证书信息
openssl pkcs12 -in certificate.pfx -info -noout

# 提取证书
openssl pkcs12 -in certificate.pfx -nokeys -out certificate.cer

# 提取私钥
openssl pkcs12 -in certificate.pfx -nocerts -out private.key
```

### Windows 证书存储

```powershell
# 安装到本地存储
certutil -importPFX certificate.pfx

# 查看已安装证书
Get-ChildItem -Path Cert:\LocalMachine\My

# 导出证书指纹
$thumbprint = (Get-ChildItem -Path Cert:\LocalMachine\My | Where-Object {$_.Subject -like "*nuwax*"}).Thumbprint
```

## 签名配置

### tauri.conf.json 配置

```json
{
  "bundle": {
    "active": true,
    "targets": "all",
    "windows": {
      "certificateThumbprint": "XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
      "certificateStore": "LocalMachine",
      "digestAlgorithm": "sha256",
      "timestampUrl": "http://timestamp.digicert.com",
      "skipUpdateIcon": false
    }
  }
}
```

### 使用 signtool 签名

#### 基础签名

```powershell
# 签名 EXE
& "C:\Program Files (x86)\Windows Kits\10\bin\10.0.22621.0\x64\signtool.exe" sign /fd SHA256 `
  /f certificate.pfx `
  /p your_password `
  /tr http://timestamp.digicert.com `
  /td SHA256 `
  nuwax-agent.exe

# 签名 MSI
& "C:\Program Files (x86)\Windows Kits\10\bin\10.0.22621.0\x64\signtool.exe" sign /fd SHA256 `
  /f certificate.pfx `
  /p your_password `
  /tr http://timestamp.digicert.com `
  /td SHA256 `
  installer.msi
```

#### 批量签名

```powershell
# 签名目录下所有 EXE
Get-ChildItem -Path .\*.exe -Recurse | ForEach-Object {
    & "C:\Program Files (x86)\Windows Kits\10\bin\10.0.22621.0\x64\signtool.exe" sign /fd SHA256 `
        /f certificate.pfx `
        /p your_password `
        /tr http://timestamp.digicert.com `
        /td SHA256 `
        $_.FullName
}

# 签名 MSIX 包
& "C:\Program Files (x86)\Windows Kits\10\bin\10.0.22621.0\x64\msix\msix.exe" sign `
  /f certificate.pfx `
  /p your_password `
  /sha1 thumbprint `
  YourApp.msix
```

#### 双签名（SHA1 + SHA2）

```powershell
# SHA1 签名（兼容旧版 Windows）
& "C:\Program Files (x86)\Windows Kits\10\bin\10.0.22621.0\x64\signtool.exe" sign /f certificate.pfx `
  /p your_password `
  /tr http://timestamp.digicert.com `
  /td SHA1 `
  /fd SHA1 `
  your-app.exe

# SHA2 签名（现代 Windows）
& "C:\Program Files (x86)\Windows Kits\10\bin\10.0.22621.0\x64\signtool.exe" sign /f certificate.pfx `
  /p your_password `
  /tr http://timestamp.digicert.com `
  /td SHA256 `
  /fd SHA256 `
  your-app.exe
```

## 签名验证

### 使用 signtool 验证

```powershell
# 验证签名
& "C:\Program Files (x86)\Windows Kits\10\bin\10.0.22621.0\x64\signtool.exe" verify /pa /v your-app.exe

# 验证并显示详细信息
& "C:\Program Files (x86)\Windows Kits\10\bin\10.0.22621.0\x64\signtool.exe" verify /all /v your-app.exe
```

### PowerShell 验证

```powershell
# 获取签名信息
Get-AuthenticodeSignature -FilePath your-app.exe | Format-List

# 检查证书有效期
$cert = Get-AuthenticodeSignature -FilePath your-app.exe
$cert.SignerCertificate | Format-List
```

### 在线验证

- [SSL Labs SSL Test](https://www.ssllabs.com/ssltest/)（可用于检查证书链）
- [VirusTotal](https://www.virustotal.com/)（检查 SmartScreen 状态）

## MSIX 打包

### MSIX 配置

在 `src-tauri/capabilities/desktop.json` 中配置：

```json
{
  "name": "nuwax-agent",
  "displayName": "NuWax Agent",
  "description": "智能 Agent 桌面客户端",
  "backgroundColor": "#333333",
  "logo": "icons/icon.ico",
  "vs-generateVsParams": true,
  "allowElevation": false,
  "allowPreInstalledAppsReInvocation": true,
  "store": true,
  "images": {
    "smallTile": {
      "file": "icons/SmallTile.png",
      "scale": "100",
      "lang": "en-us"
    },
    "mediumTile": {
      "file": "icons/MediumTile.png",
      "scale": "100",
      "lang": "en-us"
    },
    "wideTile": {
      "file": "icons/WideTile.png",
      "scale": "100",
      "lang": "en-us"
    },
    "largeTile": {
      "file": "icons/LargeTile.png",
      "scale": "100",
      "lang": "en-us"
    },
    "splashScreen": {
      "file": "icons/SplashScreen.png",
      "scale": "100",
      "lang": "en-us"
    }
  }
}
```

### 签名 MSIX

```powershell
# 签名 MSIX 包
& "C:\Program Files (x86)\Windows Kits\10\bin\10.0.22621.0\x64\msix\msix.exe" sign `
  /f certificate.pfx `
  /p your_password `
  /sha1 certificate_thumbprint `
  YourApp_1.0.0.0_x64.msix

# 签名 MSIX Bundle
& "C:\Program Files (x86)\Windows Kits\10\bin\10.0.22621.0\x64\msix\msix.exe" sign `
  /f certificate.pfx `
  /p your_password `
  YourApp_1.0.0.0_x64_x86_x64.msixbundle
```

## CI/CD 集成

### GitHub Actions

```yaml
# .github/workflows/sign-windows.yml
name: Sign Windows

on:
  workflow_call:
    inputs:
      version:
        required: true
        type: string
    secrets:
      CERTIFICATE_PFX:
        required: true
      CERTIFICATE_PASSWORD:
        required: true
      WINDOWS_CERT_THUMBPRINT:
        required: true

jobs:
  sign:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Certificate
        run: |
          echo "${{ secrets.CERTIFICATE_PFX }}" | base64 -d > certificate.pfx
      
      - name: Sign EXE
        shell: pwsh
        run: |
          $signtool = "C:\Program Files (x86)\Windows Kits\10\bin\10.0.22621.0\x64\signtool.exe"
          
          & $signtool sign /f certificate.pfx /p "${{ secrets.CERTIFICATE_PASSWORD }}" `
            /fd SHA256 `
            /tr http://timestamp.digicert.com `
            /td SHA256 `
            /sha1 "${{ secrets.WINDOWS_CERT_THUMBPRINT }}" `
            ".\src-tauri\target\release\bundle\windows\nuwax-agent.exe"
          
          & $signtool verify /pa /v ".\src-tauri\target\release\bundle\windows\nuwax-agent.exe"
```

### Azure SignTool（适用于企业）

```powershell
# 安装 Azure SignTool
dotnet tool install --global AzureSignTool

# 使用 Azure Key Vault 签名
azuresigntool sign `
  -fdv sha256 `
  -kvu https://your-keyvault.vault.azure.net `
  -kvi your-app-id `
  -kvc your-certificate-name `
  -tr http://timestamp.digicert.com `
  -td sha256 `
  your-app.exe
```

## 常见问题

### Q1: SmartScreen 仍显示警告

**可能原因**：
- EV 证书刚绑定，需要时间
- 累积声誉需要时间

**解决方法**：
- 使用 EV 证书（立即信任）
- 避免频繁更改签名
- 保持版本递增

### Q2: 签名验证失败

```powershell
# 检查证书链
certutil -verify your-app.exe

# 常见问题：
# 1. 证书链不完整
# 2. 证书已过期
# 3. 时间戳问题
```

### Q3: 证书存储访问被拒绝

```powershell
# 以管理员身份运行 PowerShell
Start-Process pwsh -Verb RunAs

# 或导入到用户存储
certutil -importPFX -user certificate.pfx
```

### Q4: 双重签名问题

```powershell
# 检查所有签名
signtool verify /all /v your-app.exe

# 如果有重复签名，重新签名
signtool sign /f certificate.pfx /p password /tr timestamp /td sha256 /fd sha256 your-app.exe
```

### Q5: MSIX 签名失败

```powershell
# 确保使用 MSIX 专用证书
# 或 Microsoft Store 证书

# 检查 MSIX 包内容
makeappx unpack /p YourApp.msix /d ./extracted

# 重新签名
makeappx pack /d ./extracted /p NewApp.msix
signtool sign /f certificate.pfx /p password /sha1 thumbprint NewApp.msix
```

## 最佳实践

### 证书管理

```powershell
# 1. 备份证书
certutil -store My thumbprint cert.cer

# 2. 设置私钥权限
icacls private.key /grant Administrators:F

# 3. 使用硬件令牌（EV 证书）
# 私钥存储在硬件设备中，更安全
```

### 签名策略

1. **始终添加时间戳**：允许签名在证书过期后继续有效
2. **使用 SHA256**：现代 Windows 推荐
3. **保持签名一致**：避免频繁更换证书
4. **测试环境**：先在测试证书上验证签名流程

### 安全建议

- 私钥不要提交到代码仓库
- 使用 CI/CD 密钥管理
- 定期更新证书
- EV 证书优先于 OV

## 与 macOS 签名对比

| 功能 | macOS | Windows |
|------|-------|---------|
| 签名工具 | codesign | signtool |
| 公证要求 | Apple Notarization | Microsoft SmartScreen |
| 证书类型 | Developer ID | Code Signing |
| 硬件令牌 | 可选（推荐） | EV 必须 |
| 时间戳 | 自动嵌入 | 手动指定 |
| 重新签名 | codesign --sign | signtool sign |

## 相关链接

- [Windows Code Signing](https://docs.microsoft.com/windows-hardware/drivers/install/code-signing)
- [SignTool Documentation](https://docs.microsoft.com/windows/win32/secbp/signtool)
- [MSIX Signing](https://docs.microsoft.com/windows/msix/packaging-tool/sign-an-msix-package)
- [SmartScreen Reputation](https://docs.microsoft.com/windows/security/threat-protection/microsoft-defender-smartscreen/microsoft-defender-smartscreen-overview)
- [Azure SignTool](https://github.com/vcsjones/AzureSignTool)
