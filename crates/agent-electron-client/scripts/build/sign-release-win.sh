#!/bin/bash
#
# Windows Release Signing Script (Bash/Git Bash)
#
# Downloads, signs, verifies, and uploads Windows installers for a release.
# Handles file naming: unsigned files have "-unsigned" suffix, signed files use original names.
#
# Usage:
#   ./sign-release-win.sh <version> [--skip-download] [--skip-upload]
#
# Examples:
#   ./sign-release-win.sh 0.9.2
#   ./sign-release-win.sh 0.9.2 --skip-download
#   ./sign-release-win.sh 0.9.2 --skip-upload
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
REPO="nuwax-ai/nuwaclaw"
WORK_DIR="/c/tmp/nuwaclaw-sign"
UNSIGNED_DIR="$WORK_DIR/unsigned"
SIGNED_DIR="$WORK_DIR/signed"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Defaults
VERSION=""
SKIP_DOWNLOAD=false
SKIP_UPLOAD=false

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
    echo "Usage: $0 <version> [--skip-download] [--skip-upload]"
    echo ""
    echo "Examples:"
    echo "  $0 0.9.2"
    echo "  $0 0.9.2 --skip-download"
    echo "  $0 0.9.2 --skip-upload"
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

# File names
# CI builds: NuwaClaw-Setup-{version}-unsigned.exe, NuwaClaw-{version}-unsigned.msi
# Signed:    NuwaClaw.Setup.{version}.exe,         NuwaClaw.{version}.msi
UNSIGNED_EXE="NuwaClaw-Setup-$VERSION-unsigned.exe"
UNSIGNED_MSI="NuwaClaw-$VERSION-unsigned.msi"
SIGNED_EXE="NuwaClaw.Setup.$VERSION.exe"
SIGNED_MSI="NuwaClaw.$VERSION.msi"

echo ""
echo "==> Setting up directories"
mkdir -p "$UNSIGNED_DIR" "$SIGNED_DIR"
echo "  Unsigned: $UNSIGNED_DIR"
echo "  Signed:   $SIGNED_DIR"

# Download unsigned files
if [[ "$SKIP_DOWNLOAD" == "false" ]]; then
    echo ""
    echo "==> Downloading unsigned files from release electron-v$VERSION"

    rm -f "$UNSIGNED_DIR/$UNSIGNED_EXE" "$UNSIGNED_DIR/$UNSIGNED_MSI"

    # Download only Windows installers with -unsigned suffix
    if [[ "$GH_BIN" == __POWERSHELL_GH__:* ]]; then
        UNSIGNED_DIR_WIN="$(cygpath -w "$UNSIGNED_DIR")"
        gh_release "gh release download \"electron-v$VERSION\" --repo \"$REPO\" --dir \"$UNSIGNED_DIR_WIN\" --pattern \"NuwaClaw-Setup-*-unsigned.exe\" --pattern \"NuwaClaw-*-unsigned.msi\""
    else
        gh_release "" release download "electron-v$VERSION" \
            --repo "$REPO" \
            --dir "$UNSIGNED_DIR" \
            --pattern "NuwaClaw-Setup-*-unsigned.exe" \
            --pattern "NuwaClaw-*-unsigned.msi"
    fi

    echo "  Downloaded: $UNSIGNED_EXE, $UNSIGNED_MSI"
else
    echo ""
    echo "==> Skipping download (using existing unsigned files)"
fi

# Verify files exist
UNSIGNED_EXE_PATH="$UNSIGNED_DIR/$UNSIGNED_EXE"
UNSIGNED_MSI_PATH="$UNSIGNED_DIR/$UNSIGNED_MSI"

if [[ ! -f "$UNSIGNED_EXE_PATH" ]]; then
    echo "Error: Unsigned EXE file not found: $UNSIGNED_EXE_PATH"
    exit 1
fi
if [[ ! -f "$UNSIGNED_MSI_PATH" ]]; then
    echo "Error: Unsigned MSI file not found: $UNSIGNED_MSI_PATH"
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

echo "  Signing: $UNSIGNED_MSI"
node "$SIGN_SCRIPT" "$UNSIGNED_MSI_PATH"

# Verify signatures
echo ""
echo "==> Verifying signatures"

signtool verify //pa //all "$UNSIGNED_EXE_PATH"
echo "  Verified: $UNSIGNED_EXE ✓"

signtool verify //pa //all "$UNSIGNED_MSI_PATH"
echo "  Verified: $UNSIGNED_MSI ✓"

# Rename to signed names and copy to signed directory
echo ""
echo "==> Renaming and copying signed files"
cp "$UNSIGNED_EXE_PATH" "$SIGNED_DIR/$SIGNED_EXE"
cp "$UNSIGNED_MSI_PATH" "$SIGNED_DIR/$SIGNED_MSI"
echo "  $UNSIGNED_EXE -> $SIGNED_EXE"
echo "  $UNSIGNED_MSI -> $SIGNED_MSI"
echo "  Copied to: $SIGNED_DIR"

# Upload to GitHub
if [[ "$SKIP_UPLOAD" == "false" ]]; then
    echo ""
    echo "==> Uploading signed files to release electron-v$VERSION"

    # Delete unsigned files from release
    if [[ "$GH_BIN" == __POWERSHELL_GH__:* ]]; then
        gh_release "gh release delete-asset \"electron-v$VERSION\" \"$UNSIGNED_EXE\" --yes --repo \"$REPO\"" 2>/dev/null || true
        gh_release "gh release delete-asset \"electron-v$VERSION\" \"$UNSIGNED_MSI\" --yes --repo \"$REPO\"" 2>/dev/null || true
    else
        gh_release "" release delete-asset "electron-v$VERSION" "$UNSIGNED_EXE" --yes --repo "$REPO" 2>/dev/null || true
        gh_release "" release delete-asset "electron-v$VERSION" "$UNSIGNED_MSI" --yes --repo "$REPO" 2>/dev/null || true
    fi

    # Upload signed files with original names
    if [[ "$GH_BIN" == __POWERSHELL_GH__:* ]]; then
        SIGNED_EXE_WIN="$(cygpath -w "$SIGNED_DIR/$SIGNED_EXE")"
        SIGNED_MSI_WIN="$(cygpath -w "$SIGNED_DIR/$SIGNED_MSI")"
        gh_release "gh release upload \"electron-v$VERSION\" \"$SIGNED_EXE_WIN\" \"$SIGNED_MSI_WIN\" --clobber --repo \"$REPO\""
    else
        gh_release "" release upload "electron-v$VERSION" \
            "$SIGNED_DIR/$SIGNED_EXE" \
            "$SIGNED_DIR/$SIGNED_MSI" \
            --clobber \
            --repo "$REPO"
    fi

    echo "  Uploaded successfully!"
else
    echo ""
    echo "==> Skipping upload (files kept locally only)"
fi

# Summary
echo ""
echo "========================================"
echo " Signing Complete!"
echo "========================================"
echo ""
echo "Version:     $VERSION"
echo "Unsigned:    $UNSIGNED_DIR"
echo "Signed:      $SIGNED_DIR"
echo ""
echo "Files:"
echo "  - $SIGNED_EXE"
echo "  - $SIGNED_MSI"

if [[ "$SKIP_UPLOAD" == "false" ]]; then
    echo ""
    echo "Release URL: https://github.com/$REPO/releases/tag/electron-v$VERSION"
fi
