#!/usr/bin/env bash
set -euo pipefail
# Only ephemeral GitHub runners may change their package-mirror preference.
if command -v pdftotext >/dev/null && command -v pdftoppm >/dev/null; then
  pdftotext -v
  pdftoppm -v
  exit 0
fi
if [[ "${GITHUB_ACTIONS:-}" != "true" ]]; then
  echo 'Install poppler-utils in your development environment before PDF tests.' >&2
  exit 1
fi
# The hosted runner mirrorlist can retain an unavailable Azure mirror across
# fallback URLs. Use Ubuntu's official signed archive; never disable signatures.
if [[ -f /etc/apt/apt-mirrors.txt ]]; then
  printf '%s\n' 'https://archive.ubuntu.com/ubuntu' | sudo tee /etc/apt/apt-mirrors.txt >/dev/null
fi
sudo apt-get -o Acquire::Retries=1 -o Acquire::http::Timeout=20 -o Acquire::https::Timeout=20 update
sudo apt-get -o Acquire::Retries=1 -o Acquire::http::Timeout=20 -o Acquire::https::Timeout=20 install -y poppler-utils
pdftotext -v
pdftoppm -v
