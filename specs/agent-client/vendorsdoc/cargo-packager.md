# cargo-packager

## 项目概述

应用打包工具，支持生成多种平台安装包。是从 Tauri 框架剥离出来的独立打包工具。

**本地路径**: `vendors/cargo-packager`

## 目录结构

```
cargo-packager/
├── Cargo.toml                    # workspace 配置
├── packager/                     # 打包核心
│   └── src/
│       ├── lib.rs
│       ├── config.rs             # 配置
│       ├── package.rs            # 打包逻辑
│       └── utils.rs              # 工具函数
├── config/                       # 配置定义
│   └── src/
│       └── lib.rs
├── resource-resolver/            # 资源解析
│   └── src/
│       └── lib.rs
├── updater/                      # 自动更新
│   └── src/
│       └── lib.rs
├── codesign/                     # 代码签名
│   └── src/
│       └── lib.rs
├── package/
│   ├── deb/                      # Debian 包
│   ├── appimage/                 # AppImage
│   ├── dmg/                      # macOS DMG
│   ├── msi/                      # Windows MSI
│   └── nsis/                     # Windows NSIS
└── Cargo.toml
```

## 核心依赖

```toml
[dependencies]
serde = "1.0"
serde_json = "1.0"
toml = "0.7"
clap = { version = "4.0", features = ["derive"] }
schemars = "0.8"
tracing = "0.1"
tar = "0.4"
zip = "0.6"
napi = { version = "2.0", optional = true }
dirs = "5.0"
semver = "1.0"
url = "2.4"
thiserror = "1.0"
```

## 核心 API

### Config

```rust
// config/src/lib.rs

pub struct PackageConfig {
    pub product_name: String,
    pub version: String,
    pub description: Option<String>,
    pub homepage: Option<String>,
    pub default_author: Option<String>,
    pub icons: Vec<IconConfig>,
    pub resources: Vec<ResourceConfig>,
    pub bin: Vec<BinConfig>,
    pub i18n: Vec<I18nConfig>,
}

pub struct Config {
    pub package: PackageConfig,
    pub formats: Vec<PackageFormat>,
    pub signing: Option<SigningConfig>,
    pub windows: Option<WindowsConfig>,
    pub macos: Option<MacosConfig>,
    pub linux: Option<LinuxConfig>,
}
```

### PackageFormat

```rust
pub enum PackageFormat {
    /// Windows MSI
    Msi(WindowsMsiConfig),
    /// Windows NSIS
    Nsis(WindowsNsisConfig),
    /// macOS DMG
    Dmg(MacosDmgConfig),
    /// macOS Bundle
    Bundle(MacosBundleConfig),
    /// Linux Deb
    Deb(DebConfig),
    /// Linux AppImage
    AppImage(AppImageConfig),
}
```

### 使用示例

```rust
use cargo_packager::{Config, PackageFormat};

#[tokio::main]
async fn main() -> Result<()> {
    let config = Config {
        package: PackageConfig {
            product_name: "nuwax-agent".to_string(),
            version: "1.0.0".to_string(),
            description: Some("Agent Client".to_string()),
            homepage: Some("https://example.com".to_string()),
            default_author: Some("Author <author@example.com>".to_string()),
            icons: vec![IconConfig::Path {
                path: "icons/icon.png".into(),
            }],
            resources: vec![ResourceConfig {
                patterns: vec!["assets/**/*".into()],
                target: None,
            }],
            bin: vec![],
            i18n: vec![],
        },
        formats: vec![
            PackageFormat::Msi(WindowsMsiConfig::default()),
            PackageFormat::Dmg(MacosDmgConfig::default()),
            PackageFormat::Deb(DebConfig::default()),
            PackageFormat::AppImage(AppImageConfig::default()),
        ],
        signing: Some(SigningConfig {
            identity: None,
            digest: Some(DigestAlgorithm::Sha256),
            timestamp: Some(TimestampConfig::default()),
            ..Default::default()
        }),
        windows: Some(WindowsConfig {
            signing_config: Some(SigningConfig::default()),
            ..Default::default()
        }),
        macos: Some(MacosConfig {
            signing_config: Some(SigningConfig::default()),
            provider: None,
        }),
        linux: Some(LinuxConfig {
            package: LinuxPackageFormatConfig::default(),
            ..Default::default()
        }),
    };

    // 执行打包
    cargo_packager::package(&config).await?;

    Ok(())
}
```

## 自动更新配置

```rust
pub struct UpdaterConfig {
    /// 启用自动更新
    pub active: bool,
    /// 更新端点 URL 模板
    pub endpoints: Option<Vec<String>>,
    /// 公钥
    pub pubkey: String,
    /// 苹果开发者 ID
    pub apple_id: Option<String>,
    /// Windows 证书
    pub windows: Option<WindowsUpdaterConfig>,
}

impl UpdaterConfig {
    /// 默认端点模板
    pub fn default_endpoints(&self, target: &str) -> Vec<String> {
        vec![
            format!("https://updates.example.com/update/{target}/{version}"),
            format!("https://updates.example.com/update/{target}/{version}-{target}.{extension}"),
        ]
    }
}
```

## 与 agent-client 集成场景

### 场景1：完整的打包配置

```rust
// build.rs 或打包脚本

use cargo_packager::{Config, PackageFormat, PackageConfig};
use cargo_packager::config::{MacosDmgConfig, WindowsMsiConfig, DebConfig, AppImageConfig};

pub async fn build_packages() -> Result<()> {
    let version = env!("CARGO_PKG_VERSION");
    let app_name = "nuwax-agent";

    let config = Config {
        package: PackageConfig {
            product_name: app_name.to_string(),
            version: version.to_string(),
            description: Some("Cross-platform AI Agent Client".to_string()),
            homepage: Some("https://example.com".to_string()),
            default_author: Some("nuwax <support@example.com>".to_string()),
            icons: vec![
                IconConfig::Path {
                    path: "assets/icons/icon.png".into(),
                },
                IconConfig::Path {
                    path: "assets/icons/icon.ico".into(),
                },
                IconConfig::Path {
                    path: "assets/icons/icon.icns".into(),
                },
            ],
            resources: vec![
                ResourceConfig {
                    patterns: vec![
                        "assets/**/*".into(),
                        "locales/**/*".into(),
                    ],
                    target: None,
                },
            ],
            bin: vec![],
            i18n: vec![],
        },
        formats: vec![
            PackageFormat::Msi(WindowsMsiConfig {
                // MSI 配置
                database_path: Some("assets/wix/database.wxs".into()),
                ..Default::default()
            }),
            PackageFormat::Dmg(MacosDmgConfig {
                // DMG 配置
                background: Some("assets/dmg/background.png".into()),
                ..Default::default()
            }),
            PackageFormat::Deb(DebConfig {
                // Debian 包配置
                priority: Some("optional".to_string()),
                section: Some("utils".to_string()),
                ..Default::default()
            }),
            PackageFormat::AppImage(AppImageConfig {
                // AppImage 配置
                ..Default::default()
            }),
        ],
        signing: Some(SigningConfig {
            identity: std::env::var("SIGNING_IDENTITY").ok(),
            digest: Some(DigestAlgorithm::Sha256),
            timestamp: Some(TimestampConfig {
                server: Some("http://timestamp.digicert.com".to_string()),
            }),
            ..Default::default()
        }),
        windows: Some(WindowsConfig {
            signing_config: Some(SigningConfig {
                identity: std::env::var("WINDOWS_CERT").ok(),
                ..Default::default()
            }),
            ..Default::default()
        }),
        macos: Some(MacosConfig {
            signing_config: Some(SigningConfig {
                identity: std::env::var("APPLE_SIGNING_ID").ok(),
                provider: std::env::var("APPLE_PROVIDER").ok(),
            }),
            ..Default::default()
        }),
        linux: Some(LinuxConfig {
            package: LinuxPackageFormatConfig::default(),
            ..Default::default()
        }),
    };

    // 执行打包
    cargo_packager::package(&config).await?;

    Ok(())
}
```

### 场景2：CI/CD 集成

```yaml
# .github/workflows/release.yml

name: Release

on:
  release:
    types: [created]

jobs:
  build:
    strategy:
      matrix:
        include:
          - os: ubuntu-latest
            targets: deb,appimage
          - os: macos-latest
            targets: dmg
          - os: windows-latest
            targets: msi

    runs-on: ${{ matrix.os }}

    steps:
      - uses: actions/checkout@v4

      - name: Setup Rust
        uses: actions-rs/toolchain@v1
        with:
          toolchain: stable
          target: ${{ matrix.target == 'deb' && 'x86_64-unknown-linux-gnu' || 'x86_64-apple-darwin' }}

      - name: Build
        run: cargo build --release

      - name: Package
        run: |
          cargo run --package cargo-packager -- --package-format ${{ matrix.targets }}

      - name: Sign macOS
        if: matrix.os == 'macos-latest'
        run: |
          echo "${{ secrets.APPLE_CERT }}" | base64 -d > certificate.p12
          security create-keychain -p password build.keychain
          security default-keychain -s build.keychain
          security unlock-keychain -p password build.keychain
          security import certificate.p12 -P "" -A -t cert -f pkcs12 -k build.keychain
          codesign --deep --force --sign "${{ secrets.APPLE_SIGNING_ID }}" target/release/nuwax-agent

      - name: Sign Windows
        if: matrix.os == 'windows-latest'
        run: |
          & "C:\Program Files (x86)\Windows Kits\10\bin\10.0.22621.0\x64\signtool.exe" sign /f certificate.pfx /p ${{ secrets.WINDOWS_CERT_PASSWORD }} /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 /v target/release/nuwax-agent-*.msi

      - name: Upload Assets
        uses: softprops/action-gh-release@v1
        with:
          files: |
            target/release/nuwax-agent-*.msi
            target/release/nuwax-agent-*.dmg
            target/release/nuwax-agent-*.deb
            target/release/nuwax-agent-*.AppImage
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### 场景3：自动更新配置

```rust
// 打包时生成更新配置

pub struct UpdaterConfig {
    /// 更新服务器地址
    pub update_url: String,

    /// 公钥（用于签名验证）
    pub public_key: String,

    /// 是否启用自动更新
    pub enable_auto_update: bool,
}

impl UpdaterConfig {
    /// 生成更新配置模板
    pub fn generate_app_config(&self) -> String {
        format!(r#"
[updater]
enabled = {}
url = "{}"
"#, self.enable_auto_update, self.update_url)
    }

    /// 获取更新端点
    pub fn get_update_endpoints(&self, version: &str, target: &str) -> Vec<String> {
        vec![
            format!("{}/{}/{}/nuwax-agent_{}_{}.{}",
                self.update_url, version, target, version, target, self.extension(target)),
        ]
    }

    fn extension(target: &str) -> &str {
        match target {
            _ if target.contains("windows") => "msi",
            _ if target.contains("darwin") => "dmg",
            _ if target.contains("linux") => if target.contains("deb") { "deb" } else { "AppImage" },
            _ => "tar.gz",
        }
    }
}
```

### 场景4：资源文件处理

```rust
// 打包时的资源处理

pub struct ResourceProcessor {
    // 资源目录
    resource_dir: PathBuf,
    // 输出目录
    output_dir: PathBuf,
}

impl ResourceProcessor {
    pub fn new(resource_dir: &str, output_dir: &str) -> Self {
        Self {
            resource_dir: PathBuf::from(resource_dir),
            output_dir: PathBuf::from(output_dir),
        }
    }

    /// 处理所有资源
    pub async fn process(&self) -> Result<Vec<ResourceFile>> {
        let mut resources = Vec::new();

        // 1. 图标资源
        resources.extend(self.process_icons().await?);

        // 2. 翻译文件
        resources.extend(self.process_locales().await?);

        // 3. 配置文件
        resources.extend(self.process_configs().await?);

        Ok(resources)
    }

    async fn process_icons(&self) -> Result<Vec<ResourceFile>> {
        let icons_dir = self.resource_dir.join("icons");
        let mut icons = Vec::new();

        for entry in fs::read_dir(&icons_dir)? {
            let entry = entry?;
            let path = entry.path();

            if path.extension().map(|e| e == "png" || e == "ico" || e == "icns").unwrap_or(false) {
                icons.push(ResourceFile {
                    source: path.clone(),
                    target: format!("icons/{}", path.file_name().unwrap()),
                });
            }
        }

        Ok(icons)
    }

    async fn process_locales(&self) -> Result<Vec<ResourceFile>> {
        let locales_dir = self.resource_dir.join("locales");
        let mut locales = Vec::new();

        for entry in fs::read_dir(&locales_dir)? {
            let entry = entry?;
            let path = entry.path();

            if path.extension().map(|e| e == "json").unwrap_or(false) {
                locales.push(ResourceFile {
                    source: path.clone(),
                    target: format!("locales/{}", path.file_name().unwrap()),
                });
            }
        }

        Ok(locales)
    }
}
```

## 在本项目中的使用

用于打包 agent-client 为各平台安装包：

```
agent-client
    │
    ├── cargo-packager
    │       │
    │       ├── Windows MSI/NSIS 安装包
    │       ├── macOS DMG 磁盘镜像
    │       ├── Linux Deb 包
    │       └── Linux AppImage
    │
    └── 资源文件
            ├── icons/ (应用图标)
            ├── locales/ (多语言)
            └── assets/ (其他资源)
```

## 打包命令

```bash
# CLI 打包
cargo-packager --package-format msi,dmg,deb,appimage

# 代码调用
cargo_packager::package(&config).await?;

# 单独平台打包
cargo-packager --package-format msi          # Windows
cargo-packager --package-format dmg          # macOS
cargo-packager --package-format deb          # Linux Deb
cargo-packager --package-format appimage     # Linux AppImage
```
