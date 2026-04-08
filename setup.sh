#!/bin/bash
set -euo pipefail

# ─── RTSP Viewer - Setup Script ───────────────────────────
echo ""
echo "  ⬡  RTSP VIEWER - SETUP"
echo "  ─────────────────────────────"

ARCH="$(uname -m)"
echo "  Detected architecture: $ARCH"

# Map arch to mediamtx filename
case "$ARCH" in
  x86_64)   MTX_ARCH="linux_amd64" ;;
  aarch64)  MTX_ARCH="linux_arm64v8" ;;
  armv7l)   MTX_ARCH="linux_armv7" ;;
  armv6l)   MTX_ARCH="linux_armv6" ;;
  *)        echo "  ✗ Unsupported arch: $ARCH"; exit 1 ;;
esac

VERSION="v1.9.1"
ARCHIVE="mediamtx_${VERSION}_${MTX_ARCH}.tar.gz"
URL="https://github.com/bluenviron/mediamtx/releases/download/${VERSION}/${ARCHIVE}"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

echo "  Downloading mediamtx $VERSION for $MTX_ARCH..."
wget -q --show-progress "$URL" -O "$TMP_DIR/$ARCHIVE"

echo "  Extracting package..."
tar -xzf "$TMP_DIR/$ARCHIVE" -C "$TMP_DIR"

if [ ! -f "$TMP_DIR/mediamtx" ]; then
  echo "  ✗ mediamtx binary not found in archive"
  exit 1
fi

# Always update binary
install -m 755 "$TMP_DIR/mediamtx" ./mediamtx

# Preserve existing config to avoid breaking camera setup
if [ -f ./mediamtx.yml ]; then
  echo "  ✓ Keeping existing mediamtx.yml (not overwritten)"
  if [ -f "$TMP_DIR/mediamtx.yml" ]; then
    cp "$TMP_DIR/mediamtx.yml" ./mediamtx.default.yml
    echo "  ✓ Saved new default config as mediamtx.default.yml"
  fi
else
  cp "$TMP_DIR/mediamtx.yml" ./mediamtx.yml
  echo "  ✓ Installed mediamtx.yml"
fi

chmod +x start.sh

echo ""
echo "  ✓ Setup complete!"
echo "  Run: ./start.sh"
echo "  ─────────────────────────────"