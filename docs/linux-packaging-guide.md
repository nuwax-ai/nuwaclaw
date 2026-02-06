# Linux 打包与分发指南

本文档介绍 nuwax-agent 在 Linux 上的打包、分发和签名流程。

## 打包格式

### 常见格式对比

| 格式 | 适用场景 | 优点 | 缺点 |
|------|----------|------|------|
| **DEB** | Debian/Ubuntu | 官方仓库支持 | 只支持 Debian 系 |
| **RPM** | RedHat/Fedora | 企业广泛使用 | 只支持 RedHat 系 |
| **AppImage** | 通用 | 单文件，兼容广 | 无沙箱，更新复杂 |
| **Flatpak** | 通用 | 沙箱，安全 | 需要运行时 |
| **Snap** | Ubuntu | 自动更新 | 体积大，权限复杂 |

### 推荐策略

- **DEB + RPM**：适合官方仓库分发
- **AppImage**：适合官网下载
- **Flatpak**：适合 Flathub 分发

## DEB 打包

### 前置要求

```bash
# 安装打包工具
sudo apt install build-essential devscripts debhelper dh-make patch

# 安装 Tauri CLI 需要的依赖
sudo apt install libwebkit2gtk-4.0-37 \
  libjavascriptcoregtk-4.0-18 \
  libgtk-3-0 \
  libayatana-appindicator3-1
```

### 创建 DEB 包

#### 方式 1：使用 dpkg-deb

```bash
#!/bin/bash
set -e

APP_NAME="nuwax-agent"
VERSION="1.0.0"
ARCH="amd64"
MAINTAINER="Your Name <your@email.com>"

# 创建目录结构
mkdir -p "$APP_NAME-$VERSION/DEBIAN"
mkdir -p "$APP_NAME-$VERSION/usr/bin"
mkdir -p "$APP_NAME-$VERSION/usr/share/applications"
mkdir -p "$APP_NAME-$VERSION/usr/share/icons/hicolor/256x256/apps"
mkdir -p "$APP_NAME-$VERSION/usr/share/pixmaps"

# 复制应用
cp nuwax-agent "$APP_NAME-$VERSION/usr/bin/"
cp nuwax-agent.desktop "$APP_NAME-$VERSION/usr/share/applications/"
cp icons/icon.png "$APP_NAME-$VERSION/usr/share/icons/hicolor/256x256/apps/"
cp icons/icon.png "$APP_NAME-$VERSION/usr/share/pixmaps/nuwax-agent.png"

# 创建 DEBIAN/control
cat > "$APP_NAME-$VERSION/DEBIAN/control" <<EOF
Package: $APP_NAME
Version: $VERSION
Section: utils
Priority: optional
Architecture: $ARCH
Depends: libgtk-3-0, libappindicator3-1, libwebkit2gtk-4.0-37
Maintainer: $MAINTAINER
Description: NuWax Agent Desktop Client
 A intelligent agent desktop client for remote connections and automation.
EOF

# 创建 DEBIAN/postinst（安装后脚本）
cat > "$APP_NAME-$VERSION/DEBIAN/postinst" <<EOF
#!/bin/bash
set -e

# 注册图标
update-alternatives --install /usr/share/pixmaps/nuwax-agent.png nuwax-agent.png /usr/share/pixmaps/nuwax-agent.png 100

# 清理
exit 0
EOF
chmod +x "$APP_NAME-$VERSION/DEBIAN/postinst"

# 打包
dpkg-deb --build "$APP_NAME-$VERSION"
```

#### 方式 2：使用 cargo-deb（推荐）

```bash
# 安装 cargo-deb
cargo install cargo-deb

# 在 Cargo.toml 中配置
[package.metadata.deb]
name = "nuwax-agent"
maintainer = "Your Name <your@email.com>"
depends = "libgtk-3-0, libappindicator3-1, libwebkit2gtk-4.0-37"
section = "utils"
priority = "optional"
change-log = "changelog"
icon = "icons/256x256.png"

# 构建
cargo deb
```

### DEB 签名

```bash
# 创建 GPG 密钥（如果没有）
gpg --full-generate-key

# 导出密钥
gpg --armor --export your@email.com > public.key

# 对 DEB 包签名
dpkg-sig --sign builder nuwax-agent_1.0.0_amd64.deb

# 验证
dpkg-sig --verify nuwax-agent_1.0.0_amd64.deb
```

## RPM 打包

### 前置要求

```bash
# 安装工具
sudo dnf install rpmdevtools rpm-build
```

### 创建 RPM 包

```bash
# 创建 rpmbuild 目录结构
rpmdev-setuptree

# 复制源码到 SOURCES
cp nuwax-agent-1.0.0.tar.gz ~/rpmbuild/SOURCES/

# 创建 spec 文件 ~/rpmbuild/SPECS/nuwax-agent.spec
```

```spec
Name:           nuwax-agent
Version:        1.0.0
Release:        1%{?dist}
Summary:        NuWax Agent Desktop Client
License:        MIT
URL:            https://nuwax.com
Source0:        %{name}-%{version}.tar.gz

BuildRequires:  gtk3-devel, webkit2gtk4.0-devel
Requires:       hicolor-data, desktop-file-utils

%description
A intelligent agent desktop client for remote connections and automation.

%install
mkdir -p %{buildroot}%{_bindir}
mkdir -p %{buildroot}%{_datadir}/applications
mkdir -p %{buildroot}%{_datadir}/icons/hicolor/256x256/apps

install -p -m 755 %{_builddir}/%{name}-%{version}/nuwax-agent %{buildroot}%{_bindir}/
install -p -m 644 %{_builddir}/%{name}-%{version}/nuwax-agent.desktop %{buildroot}%{_datadir}/applications/
install -p -m 644 %{_builddir}/%{name}-%{version}/icons/icon.png %{buildroot}%{_datadir}/icons/hicolor/256x256/apps/

%files
%{_bindir}/nuwax-agent
%{_datadir}/applications/nuwax-agent.desktop
%{_datadir}/icons/hicolor/256x256/apps/icon.png

%changelog
* Thu Feb 06 2026 Your Name <your@email.com> - 1.0.0-1
- Initial package
```

```bash
# 构建 RPM
rpmbuild -bb ~/rpmbuild/SPECS/nuwax-agent.spec

# 或使用 cargo-rpm
cargo install cargo-rpm
cargo rpm build
```

### RPM 签名

```bash
# 导入 GPG 密钥
rpm --import public.key

# 对 RPM 签名
rpm --addsign nuwax-agent-1.0.0-1.x86_64.rpm

# 验证
rpm -vK nuwax-agent-1.0.0-1.x86_64.rpm
```

## AppImage 打包

### 前置要求

```bash
# 安装 appimage-builder
pip3 install appimage-builder
```

### 创建 AppImage

#### 使用 Tauri CLI

```bash
# Tauri 默认支持 AppImage
pnpm tauri build --target x86_64-unknown-linux-gnu
```

#### 手动创建

```bash
#!/bin/bash
set -e

APP_NAME="nuwax-agent"
VERSION="1.0.0"
ARCH="x86_64"

# 创建目录结构
mkdir -p "$APP_NAME.AppDir/usr/bin"
mkdir -p "$APP_NAME.AppDir/usr/lib"
mkdir -p "$APP_NAME.AppDir/usr/share/applications"
mkdir -p "$APP_NAME.AppDir/usr/share/icons/hicolor/256x256/apps"

# 复制应用和依赖
cp nuwax-agent "$APP_NAME.AppDir/usr/bin/"
cp nuwax-agent.desktop "$APP_NAME.AppDir/usr/share/applications/"
cp icons/icon.png "$APP_NAME.AppDir/usr/share/icons/hicolor/256x256/apps/"

# 使用 linuxdeploy 处理依赖
wget https://github.com/linuxdeploy/linuxdeploy/releases/latest/download/linuxdeploy-x86_64.AppImage
chmod +x linuxdeploy-x86_64.AppImage

./linuxdeploy-x86_64.AppImage \
  --appdir "$APP_NAME.AppDir" \
  --plugin qt \
  --output appimage

# 下载 AppImageTool
wget https://github.com/AppImage/AppImageKit/releases/download/13/AppImageTool-x86_64.AppImage
chmod +x AppImageTool-x86_64.AppImage

# 创建 AppImage
./AppImageTool-x86_64.AppImage "$APP_NAME.AppDir" "$APP_NAME-$VERSION-$ARCH.AppImage"
```

### AppImage 签名

```bash
# 创建签名密钥
gpg --full-generate-key

# 对 AppImage 签名
gpg --armor --detach-sign "$APP_NAME-$VERSION-$ARCH.AppImage"

# 创建自校验脚本
cat > verify.sh <<'EOF'
#!/bin/bash
APPIMAGE="$1"
SIGNATURE="${APPIMAGE}.asc"

if [ ! -f "$SIGNATURE" ]; then
    echo "Signature not found!"
    exit 1
fi

gpg --verify "$SIGNATURE" "$APPIMAGE"
if [ $? -eq 0 ]; then
    echo "Verification successful!"
else
    echo "Verification failed!"
    exit 1
fi
EOF
chmod +x verify.sh
```

## Flatpak 打包

### 前置要求

```bash
# 安装 Flatpak
flatpak install flathub org.freedesktop.Platform org.freedesktop.Sdk

# 安装 builder
flatpak install flathub org.flatpak.Builder
```

### 创建 Flatpak

#### 1. 创建清单

创建 `com.nuwax.agent.yaml`：

```yaml
app-id: com.nuwax.agent
runtime: org.freedesktop.Platform
runtime-version: '23.08'
sdk: org.freedesktop.Sdk
command: nuwax-agent
finish-args:
  - --share=network
  - --socket=wayland
  - --socket=x11
  - --device=dri
  - --filesystem=host
  - --talk-name=org.freedesktop.portal.Desktop
modules:
  - name: nuwax-agent
    buildsystem: simple
    build-commands:
      - install -D nuwax-agent /app/bin/nuwax-agent
      - install -D nuwax-agent.desktop /app/share/applications/nuwax-agent.desktop
      - install -D icons/icon.png /app/share/icons/hicolor/256x256/apps/nuwax-agent.png
    sources:
      - type: file
        path: nuwax-agent
      - type: file
        path: nuwax-agent.desktop
      - type: file
        path: icons/icon.png
```

#### 2. 构建 Flatpak

```bash
# 初始化构建目录
flatpak-builder build-dir com.nuwax.agent.yaml --user --install

# 构建并导出
flatpak-builder --repo=repo build-dir com.nuwax.agent.yaml --repo=repo
flatpak build-export repo build-dir

# 测试运行
flatpak run com.nuwax.agent
```

#### 3. 发布到 Flathub

```yaml
# flathub/com.nuwax.agent.yaml
app-id: com.nuwax.agent
runtime: org.freedesktop.Platform
runtime-version: '23.08'
sdk: org.freedesktop.Sdk
command: nuwax-agent
separate-locales: false
finish-args:
  - --share=network
  - --socket=wayland
  - --socket=x11
  - --device=dri
  - --filesystem=host:rw
  - --talk-name=org.freedesktop.portal.*
cleanup:
  - /include
  - /lib/pkgconfig
  - /share/vala
modules:
  - shared-modules
  - name: nuwax-agent
    buildsystem: simple
    build-commands:
      - install -D nuwax-agent /app/bin/nuwax-agent
      - install -D nuwax-agent.desktop /app/share/applications/nuwax-agent.desktop
    sources:
      - type: file
        url: https://nuwax.com/downloads/nuwax-agent.tar.gz
        sha256: YOUR_SHA256
```

## 分发平台

### 官方仓库

| 平台 | 链接 | 要求 |
|------|------|------|
| Debian/Ubuntu | packages.debian.org | 维护者或赞助 |
| Fedora | https://packages.fedoraproject.org/ | 打包贡献 |
| Arch (AUR) | aur.archlinux.org | 任何用户可提交 |

### 第三方仓库

| 平台 | 链接 | 备注 |
|------|------|------|
| Flathub | https://flathub.org/ | 需要 GitHub PR |
| Snap Store | https://snapcraft.io/ | 需要 Canonical 账户 |
| Homebrew | brew.sh | Linux 子系统支持 |

## CI/CD 集成

### GitHub Actions - 打包

```yaml
# .github/workflows/linux-build.yml
name: Linux Build

on:
  push:
    branches: [main]
  release:
    types: [created]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Rust
        uses: dtolnay/rust-toolchain@stable
        with:
          targets: x86_64-unknown-linux-gnu
          
      - name: Build AppImage
        run: |
          cargo build --release --target x86_64-unknown-linux-gnu
          
          # 打包为 AppImage
          # 使用 docker 或本地构建
          
      - name: Upload Artifact
        uses: actions/upload-artifact@v4
        with:
          name: nuwax-agent-linux
          path: |
            *.AppImage
            *.deb
            *.rpm
```

## 常见问题

### Q1: 依赖缺失

```bash
# 检查依赖
ldd nuwax-agent

# 常见缺失：
# - libwebkit2gtk-4.0.so.37
# - libgtk-3.so.0
# - libappindicator3.so.1

# 安装缺失依赖
sudo apt install libwebkit2gtk-4.0-37 libgtk-3-0 libappindicator3-1
```

### Q2: AppImage 无法运行

```bash
# 检查是否可执行
chmod +x YourApp.AppImage

# 检查动态链接
ldd YourApp.AppImage

# 可能问题：
# 1. 缺少 glibc 版本
# 2. 缺少共享库
# 3. FUSE 权限问题
```

### Q3: DEB/RPM 安装失败

```bash
# DEB 依赖检查
dpkg -I nuwax-agent.deb

# RPM 依赖检查
rpm -qpR nuwax-agent.rpm

# 强制安装（不推荐）
sudo dpkg --force-depends -i nuwax-agent.deb
```

### Q4: 权限问题

```bash
# 应用需要权限但无法获取
# 检查 AppArmor
aa-status

# 或使用 flatpak（沙箱权限更清晰）
```

### Q5: 图标不显示

```bash
# 刷新图标缓存
sudo update-icon-caches /usr/share/icons/*
# 或
gtk-update-icon-cache /usr/share/icons/hicolor/

# 检查 desktop 文件
desktop-file-validate nuwax-agent.desktop
```

## 与 macOS/Windows 对比

| 特性 | macOS | Windows | Linux |
|------|-------|---------|-------|
| 签名 | codesign | signtool | GPG/dpkg-sig |
| 公证 | Apple Notarization | SmartScreen | 依赖仓库 |
| 包格式 | DMG/PKG | MSI/EXE | DEB/RPM/AppImage |
| 自动更新 | Sparkle | Windows Update | 仓库更新 |
| 沙箱 | App Sandbox | UWP | Flatpak/Snap |

## 相关链接

- [Debian Packaging](https://www.debian.org/doc/debian-policy/)
- [RPM Guide](https://rpm.org/documentation.html)
- [AppImage Documentation](https://docs.appimage.org/)
- [Flatpak Documentation](https://docs.flatpak.org/)
- [Flathub Submission](https://github.com/flathub/io.flathub.Submitter)
