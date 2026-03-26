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
# Documentation: ../../../docs/windows-signing.md
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

# File names
# CI builds: NuwaClaw-Setup-{version}-unsigned.exe, NuwaClaw-{version}-unsigned.msi
# Signed:    NuwaClaw-Setup-{version}.exe,         NuwaClaw-{version}.msi
UNSIGNED_EXE="NuwaClaw-Setup-$VERSION-unsigned.exe"
UNSIGNED_MSI="NuwaClaw-$VERSION-unsigned.msi"
SIGNED_EXE="NuwaClaw-Setup-$VERSION.exe"
SIGNED_MSI="NuwaClaw-$VERSION.msi"

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
    gh release download "electron-v$VERSION" \
        --repo "$REPO" \
        --dir "$UNSIGNED_DIR" \
        --pattern "NuwaClaw-Setup-*-unsigned.exe" \
        --pattern "NuwaClaw-*-unsigned.msi"

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
    gh release delete-asset "electron-v$VERSION" "$UNSIGNED_EXE" --yes --repo "$REPO" 2>/dev/null || true
    gh release delete-asset "electron-v$VERSION" "$UNSIGNED_MSI" --yes --repo "$REPO" 2>/dev/null || true

    # Upload signed files with original names
    gh release upload "electron-v$VERSION" \
        "$SIGNED_DIR/$SIGNED_EXE" \
        "$SIGNED_DIR/$SIGNED_MSI" \
        --clobber \
        --repo "$REPO"

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
