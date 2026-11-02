#!/bin/bash
#
# Windows Release Signing Script (Bash/Git Bash)
#
# Downloads, signs, verifies, and uploads Windows NSIS installer (EXE) for a release.
# MSI（NuwaClaw.<ver>.msi）由 CI 直出最终文件名，不再签名。
#
# Usage:
#   ./sign-release-win.sh <version> [--skip-download] [--skip-upload] [--upload-only]
#
# Examples:
#   ./sign-release-win.sh 0.9.2
#   ./sign-release-win.sh 0.9.2 --skip-download
#   ./sign-release-win.sh 0.9.2 --skip-upload
#   ./sign-release-win.sh 0.9.2 --upload-only   # 仅上传（$SIGNED_DIR 下已有 NuwaClaw.Setup.x.exe）
#
# Required Environment Variables:
#   WINDOWS_CERTIFICATE_SHA1  - Certificate thumbprint
#   WINDOWS_TIMESTAMP_URL     - Timestamp server URL (default: http://timestamp.sectigo.com)
#   WINDOWS_PUBLISHER_NAME    - Publisher name (optional)
#
# Documentation: ../docs/windows-signing.md
# Related: sign-win.js
#

set -e

# Configuration
REPO="${SIGN_RELEASE_REPO:-nuwax-ai/nuwaclaw}"
WORK_DIR="${SIGN_WORK_DIR:-/c/tmp/nuwaclaw-sign}"
UNSIGNED_DIR="$WORK_DIR/unsigned"
SIGNED_DIR="$WORK_DIR/signed"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Defaults
VERSION=""
SKIP_DOWNLOAD=false
SKIP_UPLOAD=false
SKIP_CACHE_CHECK=false
UPLOAD_ONLY=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --skip-download)
            SKIP_DOWNLOAD=true
            shift
            ;;
        --skip-upload)
            SKIP_UPLOAD=true
            shift
            ;;
        --skip-cache-check)
            SKIP_CACHE_CHECK=true
            shift
            ;;
        --upload-only)
            UPLOAD_ONLY=true
            SKIP_DOWNLOAD=true
            shift
            ;;
        -*)
            echo "Unknown option: $1"
            exit 1
            ;;
        *)
            VERSION="$1"
            shift
            ;;
    esac
done

if [[ -z "$VERSION" ]]; then
    echo "Usage: $0 <version> [--skip-download] [--skip-upload] [--skip-cache-check] [--upload-only]"
    echo ""
    echo "Options:"
    echo "  --skip-download     Skip downloading unsigned files, use existing ones"
    echo "  --skip-upload       Skip uploading signed files to GitHub"
    echo "  --skip-cache-check  Disable SHA256 cache check, always re-download"
    echo "  --upload-only       Skip download/签名；仅将 \$SIGNED_DIR 下已签名的 EXE/MSI 上传到 Release"
    echo ""
    echo "Examples:"
    echo "  $0 0.9.2                      # Download with cache check"
    echo "  $0 0.9.2 --skip-download      # Use existing unsigned files"
    echo "  $0 0.9.2 --skip-upload        # Keep signed files locally only"
    echo "  $0 0.9.2 --skip-cache-check   # Force re-download even if cache exists"
    echo "  $0 0.9.2 --upload-only        # 仅上传（需 NuwaClaw.Setup.0.9.2.exe 与 NuwaClaw.0.9.2.msi 已在 signed 目录）"
    exit 1
fi

if [[ "$UPLOAD_ONLY" == "true" ]] && [[ "$SKIP_UPLOAD" == "true" ]]; then
    echo "错误: --upload-only 与 --skip-upload 不能同时使用"
    exit 1
fi

resolve_gh() {
    # Allow manual override: GH_BIN can be set to a gh executable path
    if [[ -n "${GH_BIN:-}" ]]; then
        echo "$GH_BIN"
        return 0
    fi

    if command -v gh >/dev/null 2>&1; then
        echo "gh"
        return 0
    fi

    local gh_win_path=""
    gh_win_path="$(where.exe gh 2>/dev/null | awk 'NR==1{print;exit}' | tr -d '\r')"
    if [[ -n "$gh_win_path" ]] && command -v cygpath >/dev/null 2>&1; then
        cygpath -u "$gh_win_path"
        return 0
    fi

    # Common GitHub CLI install locations (when PATH isn't propagated to Git Bash)
    # - winget default (machine): C:\Program Files\GitHub CLI\gh.exe
    # - user install:            %LOCALAPPDATA%\Programs\GitHub CLI\gh.exe
    # - scoop:                   %USERPROFILE%\scoop\apps\gh\current\bin\gh.exe
    local candidate_win_paths=(
        "C:\\Program Files\\GitHub CLI\\gh.exe"
        "C:\\Program Files (x86)\\GitHub CLI\\gh.exe"
        "${LOCALAPPDATA:-}\\Programs\\GitHub CLI\\gh.exe"
        "${USERPROFILE:-}\\scoop\\apps\\gh\\current\\bin\\gh.exe"
    )
    local p=""
    for p in "${candidate_win_paths[@]}"; do
        if [[ -z "$p" ]]; then
            continue
        fi
        # Normalize any bash-style env expansions that might be empty
        p="$(echo "$p" | tr -d '\r')"
        if [[ -n "$p" ]] && [[ -f "$(cygpath -u "$p" 2>/dev/null)" ]]; then
            cygpath -u "$p"
            return 0
        fi
    done

    # As a last resort, try to run gh via PowerShell (may rely on user's profile/alias)
    local ps_bin=""
    ps_bin="$(resolve_powershell || true)"
    if [[ -n "$ps_bin" ]]; then
        if "$ps_bin" -Command "gh --version" >/dev/null 2>&1; then
            echo "__POWERSHELL_GH__:$ps_bin"
            return 0
        fi
    fi

    return 1
}

resolve_powershell() {
    # Prefer pwsh (PowerShell 7) if available, else Windows PowerShell.
    if command -v pwsh.exe >/dev/null 2>&1; then
        echo "pwsh.exe"
        return 0
    fi
    if command -v pwsh >/dev/null 2>&1; then
        echo "pwsh"
        return 0
    fi
    if command -v powershell.exe >/dev/null 2>&1; then
        echo "powershell.exe"
        return 0
    fi
    if command -v powershell >/dev/null 2>&1; then
        echo "powershell"
        return 0
    fi

    # Absolute fallback path for Windows PowerShell
    local win_ps="/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe"
    if [[ -x "$win_ps" ]]; then
        echo "$win_ps"
        return 0
    fi

    return 1
}

GH_BIN=""
# 仅在需要 download 或 upload 时才依赖 gh
if [[ "$SKIP_DOWNLOAD" == "false" || "$SKIP_UPLOAD" == "false" ]]; then
    GH_BIN="$(resolve_gh || true)"
    if [[ -z "$GH_BIN" ]]; then
        echo "Error: GitHub CLI (gh) not found in this shell."
        echo "Diagnostics:"
        echo "  - which gh:        $(command -v gh 2>/dev/null || echo 'N/A')"
        echo "  - which where.exe: $(command -v where.exe 2>/dev/null || echo 'N/A')"
        echo "  - which cygpath:   $(command -v cygpath 2>/dev/null || echo 'N/A')"
        local ps_diag=""
        ps_diag="$(resolve_powershell || true)"
        echo "  - powershell:      ${ps_diag:-N/A}"
        if [[ -n "$ps_diag" ]]; then
            echo ""
            echo "Diagnostics (PowerShell Get-Command gh):"
            "$ps_diag" -Command "Get-Command gh -ErrorAction SilentlyContinue | Format-List CommandType,Source,Definition"
        fi
        echo ""
        echo "Fix options:"
        echo "  - Install GitHub CLI (gh.exe) and restart Git Bash"
        echo "  - Or run with GH_BIN pointing to gh.exe, e.g.:"
        echo "      GH_BIN=\"/c/Program Files/GitHub CLI/gh.exe\" $0 $VERSION"
        exit 127
    fi
fi

gh_release_ps() {
    local ps_bin="$1"
    local cmd="$2"
    "$ps_bin" -Command "$cmd"
}

gh_release() {
    if [[ "$GH_BIN" == __POWERSHELL_GH__:* ]]; then
        local ps_bin="${GH_BIN#__POWERSHELL_GH__:}"
        gh_release_ps "$ps_bin" "$1"
        return $?
    fi
    "$GH_BIN" "${@:2}"
}

# 下载失败时对照：Release 上实际资源名 vs 脚本期望的 CI 产物名（package.json nsis/msi artifactName）
print_release_download_hint() {
    local tag="electron-v$VERSION"
    echo ""
    echo "诊断: Release $tag（$REPO）当前资源名如下；若列表为空或没有下面文件名，说明 tag 不存在、Windows 构建未跑完或未上传。"
    if [[ "$GH_BIN" == __POWERSHELL_GH__:* ]]; then
        local ps_bin="${GH_BIN#__POWERSHELL_GH__:}"
        "$ps_bin" -NoProfile -Command "gh release view \"$tag\" --repo \"$REPO\" --json assets --jq '.assets[].name'" 2>/dev/null || echo "  (无法列出，请检查 tag / gh 权限)"
    else
        "$GH_BIN" release view "$tag" --repo "$REPO" --json assets --jq '.assets[].name' 2>/dev/null || echo "  (无法列出，请检查 tag / gh 权限)"
    fi
    echo ""
    echo "本脚本期望的未签名 EXE 文件名:"
    echo "  $UNSIGNED_EXE"
}

# Calculate SHA256 hash of a local file
calculate_local_sha256() {
    local file_path="$1"
    local hash=""

    if command -v sha256sum >/dev/null 2>&1; then
        hash=$(sha256sum "$file_path" 2>/dev/null | awk '{print $1}')
    elif command -v certutil >/dev/null 2>&1; then
        # Windows certutil fallback
        hash=$(certutil -hashfile "$file_path" SHA256 2>/dev/null | grep -E '^[a-fA-F0-9]{64}$' | tr -d '\r\n')
    else
        # PowerShell fallback
        local ps_bin=""
        ps_bin="$(resolve_powershell || true)"
        if [[ -n "$ps_bin" ]]; then
            local win_path=""
            if command -v cygpath >/dev/null 2>&1; then
                win_path="$(cygpath -w "$file_path")"
            else
                win_path="$file_path"
            fi
            hash=$("$ps_bin" -Command "(Get-FileHash -Path '$win_path' -Algorithm SHA256).Hash" 2>/dev/null)
        fi
    fi

    echo "$hash"
}

# Get SHA256 hash of a release asset from GitHub
get_remote_sha256() {
    local tag="$1"
    local asset_name="$2"
    local hash=""

    if [[ "$GH_BIN" == __POWERSHELL_GH__:* ]]; then
        local ps_bin="${GH_BIN#__POWERSHELL_GH__:}"
        # Prefer GitHub's asset digest field (e.g. "sha256:abcd...")
        hash=$("$ps_bin" -Command "gh api repos/$REPO/releases/tags/$tag --jq '.assets[] | select(.name == \"$asset_name\") | .digest' 2>\$null" 2>/dev/null | tr -d '\r\n')
    else
        # Prefer GitHub's asset digest field (e.g. "sha256:abcd...")
        hash=$("$GH_BIN" api "repos/$REPO/releases/tags/$tag" --jq '.assets[] | select(.name == "'"$asset_name"'") | .digest' 2>/dev/null | tr -d '\r\n')
    fi

    # Normalize "sha256:<hex>" to "<hex>"
    if [[ -n "$hash" ]]; then
        hash="${hash#sha256:}"
    fi

    # If we couldn't get it from API, try to download checksums file
    if [[ -z "$hash" ]]; then
        local checksums_file="$WORK_DIR/checksums.txt"
        if [[ "$GH_BIN" == __POWERSHELL_GH__:* ]]; then
            local ps_bin="${GH_BIN#__POWERSHELL_GH__:}"
            local work_dir_win=""
            if command -v cygpath >/dev/null 2>&1; then
                work_dir_win="$(cygpath -w "$WORK_DIR")"
            else
                work_dir_win="$WORK_DIR"
            fi
            "$ps_bin" -Command "gh release download \"$tag\" --repo \"$REPO\" --dir \"$work_dir_win\" --pattern 'checksums*' --skip-existing 2>\$null" 2>/dev/null || true
        else
            "$GH_BIN" release download "$tag" --repo "$REPO" --dir "$WORK_DIR" --pattern "checksums*" --skip-existing 2>/dev/null || true
        fi

        # Parse checksums file for our asset
        for checksum_file in "$WORK_DIR"/checksums*; do
            if [[ -f "$checksum_file" ]]; then
                hash=$(grep -E "\s${asset_name}$" "$checksum_file" 2>/dev/null | awk '{print $1}')
                if [[ -n "$hash" ]]; then
                    break
                fi
            fi
        done
    fi

    echo "$hash"
}

# Check if local file matches remote by SHA256
check_cache_valid() {
    local local_file="$1"
    local remote_tag="$2"
    local asset_name="$3"

    # If local file doesn't exist, cache is invalid
    if [[ ! -f "$local_file" ]]; then
        echo "missing"
        return 1
    fi

    # Get remote hash
    local remote_hash=""
    remote_hash=$(get_remote_sha256 "$remote_tag" "$asset_name")

    # If we couldn't get remote hash, assume cache is invalid
    if [[ -z "$remote_hash" ]]; then
        echo "no_remote_hash"
        return 1
    fi

    # Calculate local hash
    local local_hash=""
    local_hash=$(calculate_local_sha256 "$local_file")

    if [[ -z "$local_hash" ]]; then
        echo "no_local_hash"
        return 1
    fi

    # Compare hashes
    if [[ "${local_hash,,}" == "${remote_hash,,}" ]]; then
        echo "valid"
        return 0
    else
        echo "mismatch"
        return 1
    fi
}

# File names
# CI builds: NuwaClaw-Setup-{version}-unsigned.exe（待签名）
#            NuwaClaw.{version}.msi（最终名，CI 直出，不签名）
# Signed:    NuwaClaw.Setup.{version}.exe
UNSIGNED_EXE="NuwaClaw-Setup-$VERSION-unsigned.exe"
SIGNED_EXE="NuwaClaw.Setup.$VERSION.exe"
LEGACY_UNSIGNED_MSI="NuwaClaw-$VERSION-unsigned.msi"
UNSIGNED_BLOCKMAP="${UNSIGNED_EXE}.blockmap"
SIGNED_BLOCKMAP="${SIGNED_EXE}.blockmap"
BLOCKMAP_SCRIPT="$SCRIPT_DIR/generate-blockmap.js"

echo ""
echo "==> Setting up directories"
mkdir -p "$UNSIGNED_DIR" "$SIGNED_DIR"
echo "  Unsigned: $UNSIGNED_DIR"
echo "  Signed:   $SIGNED_DIR"

# Download unsigned EXE
UNSIGNED_EXE_PATH="$UNSIGNED_DIR/$UNSIGNED_EXE"

if [[ "$SKIP_DOWNLOAD" == "false" ]]; then
    echo ""
    echo "==> Checking unsigned files cache"

    NEED_DOWNLOAD_EXE=true
    CACHE_HIT=false

    # Check cache for EXE
    if [[ "$SKIP_CACHE_CHECK" == "false" ]] && [[ -f "$UNSIGNED_EXE_PATH" ]]; then
        CACHE_LOCAL_HASH=""
        CACHE_REMOTE_HASH=""
        CACHE_LOCAL_HASH=$(calculate_local_sha256 "$UNSIGNED_EXE_PATH")
        echo "  Local EXE SHA256:  $CACHE_LOCAL_HASH"

        # Try to get checksum from release
        CACHE_REMOTE_HASH=$(get_remote_sha256 "electron-v$VERSION" "$UNSIGNED_EXE")

        if [[ -n "$CACHE_REMOTE_HASH" ]]; then
            echo "  Remote EXE SHA256: $CACHE_REMOTE_HASH"
            if [[ "${CACHE_LOCAL_HASH,,}" == "${CACHE_REMOTE_HASH,,}" ]]; then
                echo "  ✓ EXE cache hit - SHA256 matches, skipping download"
                NEED_DOWNLOAD_EXE=false
            else
                echo "  ✗ EXE cache miss - SHA256 mismatch"
            fi
        else
            echo "  ? Remote hash not available, will re-download"
        fi
    fi

    # Download if needed
    if [[ "$NEED_DOWNLOAD_EXE" == "true" ]]; then
        echo ""
        echo "==> Downloading unsigned EXE from release electron-v$VERSION"

        rm -f "$UNSIGNED_EXE_PATH"

        # 使用精确文件名（与 package.json nsis artifactName 一致）
        TAG_R="electron-v$VERSION"
        DOWNLOAD_OK=true
        UNSIGNED_DIR_WIN=""
        if [[ "$GH_BIN" == __POWERSHELL_GH__:* ]]; then
            UNSIGNED_DIR_WIN="$(cygpath -w "$UNSIGNED_DIR")"
        fi

        echo "  Fetching: $UNSIGNED_EXE"
        if [[ "$GH_BIN" == __POWERSHELL_GH__:* ]]; then
            gh_release "gh release download \"$TAG_R\" --repo \"$REPO\" --dir \"$UNSIGNED_DIR_WIN\" --pattern \"$UNSIGNED_EXE\"" || DOWNLOAD_OK=false
        else
            gh_release "" release download "$TAG_R" \
                --repo "$REPO" \
                --dir "$UNSIGNED_DIR" \
                --pattern "$UNSIGNED_EXE" || DOWNLOAD_OK=false
        fi

        if [[ "$DOWNLOAD_OK" != "true" ]]; then
            echo ""
            echo "错误: gh release download 失败（no assets match / 未找到资源）。"
            print_release_download_hint
            exit 1
        fi

        echo "  Downloaded: $UNSIGNED_EXE"
    else
        echo ""
        echo "==> EXE cached - skipping download"
        CACHE_HIT=true
    fi
else
    echo ""
    if [[ "$UPLOAD_ONLY" == "true" ]]; then
        echo "==> Skipping download (--upload-only)"
    else
        echo "==> Skipping download (using existing unsigned files)"
    fi
fi

generate_signed_blockmap() {
    echo ""
    # 默认与客户端行为一致：Windows 默认关闭差分更新时，可跳过 blockmap 生成
    # - SIGN_SKIP_BLOCKMAP=true  显式跳过
    # - SIGN_SKIP_BLOCKMAP=false 显式生成（用于 MinIO 修好后验证差分）
    if [[ -z "${SIGN_SKIP_BLOCKMAP:-}" ]]; then
        if [[ "${NUWAX_DISABLE_DIFF_UPDATE:-}" != "0" ]]; then
            SIGN_SKIP_BLOCKMAP=true
        else
            SIGN_SKIP_BLOCKMAP=false
        fi
    fi

    if [[ "$SIGN_SKIP_BLOCKMAP" == "true" ]]; then
        echo "==> Skipping blockmap generation (SIGN_SKIP_BLOCKMAP=true)"
        return 0
    fi

    echo "==> Generating blockmap for differential updates"
    node "$BLOCKMAP_SCRIPT" "$SIGNED_DIR/$SIGNED_EXE"
    if [[ ! -f "$SIGNED_DIR/$SIGNED_BLOCKMAP" ]]; then
        echo "错误: blockmap 未生成: $SIGNED_DIR/$SIGNED_BLOCKMAP"
        exit 1
    fi
}

if [[ "$UPLOAD_ONLY" == "true" ]]; then
    echo ""
    echo "==> Upload-only：跳过未签名包校验与签名，仅上传 Release"
    if [[ ! -f "$SIGNED_DIR/$SIGNED_EXE" ]]; then
        echo "错误: 请在 signed 目录放置已签名的 EXE（与完整流程输出命名一致）:"
        echo "  $SIGNED_DIR/$SIGNED_EXE"
        echo "（可用环境变量 SIGN_WORK_DIR 覆盖工作目录，默认 $WORK_DIR）"
        exit 1
    fi
    if [[ ! -f "$SIGNED_DIR/$SIGNED_BLOCKMAP" ]]; then
        generate_signed_blockmap
    fi
    echo "  将上传: $SIGNED_DIR/$SIGNED_EXE"
    if [[ -f "$SIGNED_DIR/$SIGNED_BLOCKMAP" ]]; then
        echo "  将上传: $SIGNED_DIR/$SIGNED_BLOCKMAP"
    else
        echo "  将跳过: $SIGNED_DIR/$SIGNED_BLOCKMAP"
    fi
else
    # Verify files exist
    if [[ ! -f "$UNSIGNED_EXE_PATH" ]]; then
        echo "Error: Unsigned EXE file not found: $UNSIGNED_EXE_PATH"
        exit 1
    fi

    # Setup signtool
    echo ""
    echo "==> Setting up signtool"

    SIGNTOOL_PATH=""
    for path in \
        "/c/Program Files (x86)/Windows Kits/10/bin/10.0.26100.0/x64" \
        "/c/Program Files (x86)/Windows Kits/10/bin/x64"
    do
        if [[ -f "$path/signtool.exe" ]]; then
            SIGNTOOL_PATH="$path"
            break
        fi
    done

    if [[ -z "$SIGNTOOL_PATH" ]]; then
        # Try to find any version
        SIGNTOOL_PATH=$(find "/c/Program Files (x86)/Windows Kits/10/bin" -name "signtool.exe" 2>/dev/null | head -1 | xargs dirname)
    fi

    if [[ -z "$SIGNTOOL_PATH" ]]; then
        echo "Error: signtool.exe not found. Please install Windows SDK."
        exit 1
    fi

    export PATH="$SIGNTOOL_PATH:$PATH"
    echo "  Using signtool from: $SIGNTOOL_PATH"

    # Set default timestamp URL
    export WINDOWS_TIMESTAMP_URL="${WINDOWS_TIMESTAMP_URL:-http://timestamp.sectigo.com}"

    # Sign files
    echo ""
    echo "==> Signing files"

    SIGN_SCRIPT="$SCRIPT_DIR/sign-win.js"

    echo "  Signing: $UNSIGNED_EXE"
    node "$SIGN_SCRIPT" "$UNSIGNED_EXE_PATH"

    # Verify signatures
    echo ""
    echo "==> Verifying signatures"

    signtool verify //pa //all "$UNSIGNED_EXE_PATH"
    echo "  Verified: $UNSIGNED_EXE ✓"

    # Rename to signed names and copy to signed directory
    echo ""
    echo "==> Renaming and copying signed files"
    cp "$UNSIGNED_EXE_PATH" "$SIGNED_DIR/$SIGNED_EXE"
    echo "  $UNSIGNED_EXE -> $SIGNED_EXE"
    echo "  Copied to: $SIGNED_DIR"
    generate_signed_blockmap
fi

# Upload to GitHub（已签名安装包 + 差分更新 blockmap）
if [[ "$SKIP_UPLOAD" == "false" ]]; then
    echo ""
    echo "==> Uploading signed files to release electron-v$VERSION"

    # Delete unsigned EXE from release（MSI 由 CI 直出最终名，保留在 Release 上）
    if [[ "$GH_BIN" == __POWERSHELL_GH__:* ]]; then
        gh_release "gh release delete-asset \"electron-v$VERSION\" \"$UNSIGNED_EXE\" --yes --repo \"$REPO\"" 2>/dev/null || true
        gh_release "gh release delete-asset \"electron-v$VERSION\" \"$UNSIGNED_BLOCKMAP\" --yes --repo \"$REPO\"" 2>/dev/null || true
        gh_release "gh release delete-asset \"electron-v$VERSION\" \"$LEGACY_UNSIGNED_MSI\" --yes --repo \"$REPO\"" 2>/dev/null || true
    else
        gh_release "" release delete-asset "electron-v$VERSION" "$UNSIGNED_EXE" --yes --repo "$REPO" 2>/dev/null || true
        gh_release "" release delete-asset "electron-v$VERSION" "$UNSIGNED_BLOCKMAP" --yes --repo "$REPO" 2>/dev/null || true
        gh_release "" release delete-asset "electron-v$VERSION" "$LEGACY_UNSIGNED_MSI" --yes --repo "$REPO" 2>/dev/null || true
    fi

    # Upload signed EXE with original names
    if [[ "$GH_BIN" == __POWERSHELL_GH__:* ]]; then
        SIGNED_EXE_WIN="$(cygpath -w "$SIGNED_DIR/$SIGNED_EXE")"
        if [[ -f "$SIGNED_DIR/$SIGNED_BLOCKMAP" ]]; then
            SIGNED_BLOCKMAP_WIN="$(cygpath -w "$SIGNED_DIR/$SIGNED_BLOCKMAP")"
            gh_release "gh release upload \"electron-v$VERSION\" \"$SIGNED_EXE_WIN\" \"$SIGNED_BLOCKMAP_WIN\" --clobber --repo \"$REPO\""
        else
            gh_release "gh release upload \"electron-v$VERSION\" \"$SIGNED_EXE_WIN\" --clobber --repo \"$REPO\""
        fi
    else
        if [[ -f "$SIGNED_DIR/$SIGNED_BLOCKMAP" ]]; then
            gh_release "" release upload "electron-v$VERSION" \
                "$SIGNED_DIR/$SIGNED_EXE" \
                "$SIGNED_DIR/$SIGNED_BLOCKMAP" \
                --clobber \
                --repo "$REPO"
        else
            gh_release "" release upload "electron-v$VERSION" \
                "$SIGNED_DIR/$SIGNED_EXE" \
                --clobber \
                --repo "$REPO"
        fi
    fi

    echo "  Uploaded successfully!"
else
    echo ""
    echo "==> Skipping upload (files kept locally only)"
fi

# Summary
echo ""
echo "========================================"
if [[ "$UPLOAD_ONLY" == "true" ]]; then
    echo " Upload-only 完成!"
else
    echo " Signing Complete!"
fi
echo "========================================"
echo ""
echo "Version:     $VERSION"
echo "Unsigned:    $UNSIGNED_DIR"
echo "Signed:      $SIGNED_DIR"
echo ""
echo "Files:"
echo "  - $SIGNED_EXE"
echo "  - $SIGNED_BLOCKMAP"
echo "（MSI 不签名，由 CI 产出 NuwaClaw.$VERSION.msi 并保留在 Release 上）"

if [[ "$SKIP_UPLOAD" == "false" ]]; then
    echo ""
    echo "Release URL: https://github.com/$REPO/releases/tag/electron-v$VERSION"
fi
