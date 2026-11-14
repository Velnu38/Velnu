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
# apt uses lowercase proxy variables; sudo otherwise drops them. Preserve the
# runner's supplied route instead of attempting direct DNS/network access.
export http_proxy="${http_proxy:-${HTTP_PROXY:-}}"
export https_proxy="${https_proxy:-${HTTPS_PROXY:-${http_proxy}}}"
if [[ -n "$http_proxy$https_proxy" ]]; then
  echo 'Using configured runner proxy for signed system packages.'
else
  echo 'No runner HTTP proxy configured; using the runner default network.'
fi
# The hosted runner mirrorlist can retain an unavailable Azure mirror across
# fallback URLs. Use Ubuntu's official signed archive; never disable signatures.
if [[ -f /etc/apt/apt-mirrors.txt ]]; then
  printf '%s\n' 'https://archive.ubuntu.com/ubuntu' | sudo tee /etc/apt/apt-mirrors.txt >/dev/null
fi
sudo --preserve-env=http_proxy,https_proxy,HTTP_PROXY,HTTPS_PROXY,NO_PROXY,no_proxy apt-get -o Acquire::Retries=1 -o Acquire::http::Timeout=20 -o Acquire::https::Timeout=20 -o APT::Update::Error-Mode=any update
sudo --preserve-env=http_proxy,https_proxy,HTTP_PROXY,HTTPS_PROXY,NO_PROXY,no_proxy apt-get -o Acquire::Retries=1 -o Acquire::http::Timeout=20 -o Acquire::https::Timeout=20 install -y poppler-utils
pdftotext -v
pdftoppm -v
