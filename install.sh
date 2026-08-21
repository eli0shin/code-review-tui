#!/bin/bash
set -euo pipefail

REPO="eli0shin/code-review-tui"
INSTALL_DIR="${HOME}/.local/bin"
BINARY_NAME="review"
DESTINATION="${INSTALL_DIR}/${BINARY_NAME}"

require_file_destination() {
  if [[ -d "$DESTINATION" ]]; then
    echo "Cannot install ${BINARY_NAME}: ${DESTINATION} is a directory" >&2
    exit 1
  fi
}

OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
case "$OS" in
  darwin) OS="darwin" ;;
  linux) OS="linux" ;;
  *)
    echo "Unsupported OS: $OS"
    exit 1
    ;;
esac

if [[ "$OS" == "linux" ]]; then
  LIBC_INFO="$(ldd --version 2>&1 || true)"
  LIBC_INFO_LOWER="$(printf '%s' "$LIBC_INFO" | tr '[:upper:]' '[:lower:]')"
  if [[ "$LIBC_INFO_LOWER" == *musl* ]]; then
    echo "Unsupported Linux libc: musl"
    exit 1
  fi
  if [[ "$LIBC_INFO_LOWER" != *glibc* && "$LIBC_INFO_LOWER" != *"gnu libc"* ]]; then
    echo "Unsupported Linux libc: unable to detect glibc"
    exit 1
  fi
fi

ARCH="$(uname -m)"
case "$ARCH" in
  x86_64) ARCH="x64" ;;
  aarch64|arm64) ARCH="arm64" ;;
  *)
    echo "Unsupported architecture: $ARCH"
    exit 1
    ;;
esac

ARTIFACT="review-${OS}-${ARCH}"
DOWNLOAD_URL="https://github.com/${REPO}/releases/latest/download/${ARTIFACT}"

mkdir -p "$INSTALL_DIR"
require_file_destination

TEMP_FILE="$(mktemp "${INSTALL_DIR}/.${BINARY_NAME}.XXXXXX")"
trap 'rm -f "$TEMP_FILE"' EXIT
curl -fsSL "$DOWNLOAD_URL" -o "$TEMP_FILE"
chmod +x "$TEMP_FILE"
require_file_destination
mv -f "$TEMP_FILE" "$DESTINATION"
if [[ -d "$DESTINATION" ]]; then
  rm -f "${DESTINATION}/${TEMP_FILE##*/}"
  require_file_destination
fi
trap - EXIT

echo "Installed ${BINARY_NAME} to ${DESTINATION}"

if [[ ":$PATH:" != *":${INSTALL_DIR}:"* ]]; then
  echo ""
  echo "Add this to your shell profile to use review:"
  echo "  export PATH=\"\$HOME/.local/bin:\$PATH\""
fi
