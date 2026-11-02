#!/bin/bash
# Electron Linux post-install script
# Set SUID bit on chrome-sandbox to enable proper sandboxing
#
# Security considerations:
# - Validates file type to prevent symlink attacks
# - Only sets SUID on valid ELF executables
# - Provides clear error messages for troubleshooting
#
# Note: This script runs as root during package installation

set -e

# Possible chrome-sandbox locations based on electron-builder defaults
# deb installs to /opt/{productName}/
# rpm installs to /opt/{productName}/ or /usr/lib/{packageName}/
SANDBOX_PATHS=(
    "/opt/NuwaClaw/chrome-sandbox"
    "/opt/NuwaClaw/resources/chrome-sandbox"
    "/opt/nuwaclaw/chrome-sandbox"
    "/opt/nuwaclaw/resources/chrome-sandbox"
    "/usr/lib/nuwaclaw/chrome-sandbox"
    "/usr/lib64/nuwaclaw/chrome-sandbox"
)

SANDBOX_FOUND=false
# Check if 'file' command is available (most systems have it, but be safe)
HAS_FILE_CMD=$(command -v file >/dev/null 2>&1 && echo "yes" || echo "no")

for SANDBOX_PATH in "${SANDBOX_PATHS[@]}"; do
    if [ -e "$SANDBOX_PATH" ]; then
        # Security: Skip symlinks to prevent symlink attacks
        if [ -L "$SANDBOX_PATH" ]; then
            echo "Warning: $SANDBOX_PATH is a symlink, skipping for security"
            continue
        fi

        # Security: Verify it's a regular file
        if [ ! -f "$SANDBOX_PATH" ]; then
            echo "Warning: $SANDBOX_PATH is not a regular file, skipping"
            continue
        fi

        # Security: Verify file type is ELF executable (if 'file' command is available)
        if [ "$HAS_FILE_CMD" = "yes" ]; then
            if ! file "$SANDBOX_PATH" 2>/dev/null | grep -qE "ELF.*(executable|shared object)"; then
                echo "Warning: $SANDBOX_PATH is not a valid ELF binary, skipping"
                continue
            fi
        else
            # Fallback: Check file magic bytes for ELF header (0x7f ELF)
            ELF_HEADER=$(head -c 4 "$SANDBOX_PATH" 2>/dev/null | od -A n -t x1 | tr -d ' ')
            if [ "$ELF_HEADER" != "7f454c46" ]; then
                echo "Warning: $SANDBOX_PATH does not have valid ELF header, skipping"
                continue
            fi
        fi

        echo "Found chrome-sandbox at $SANDBOX_PATH"

        # Set ownership and SUID bit
        if chown root:root "$SANDBOX_PATH" 2>/dev/null; then
            if chmod 4755 "$SANDBOX_PATH" 2>/dev/null; then
                echo "SUID sandbox enabled successfully."
                SANDBOX_FOUND=true
                break
            else
                echo "Warning: Failed to set permissions on $SANDBOX_PATH"
            fi
        else
            echo "Warning: Failed to change ownership of $SANDBOX_PATH"
        fi
    fi
done

if [ "$SANDBOX_FOUND" = false ]; then
    echo "Warning: chrome-sandbox not found or validation failed."
    echo "The application may need to run with ELECTRON_DISABLE_SANDBOX=1"
fi

exit 0
