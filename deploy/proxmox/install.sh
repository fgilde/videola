#!/usr/bin/env bash
# Videola inside a Debian container: Node, the server bundle, a token, a systemd unit.
#
# Runs on its own as well as from videola.sh, which is what makes it testable by hand -- on a plain
# Debian VM, on a Raspberry Pi, in a container somebody made themselves:
#
#   curl -fsSL https://raw.githubusercontent.com/fgilde/videola/main/deploy/proxmox/install.sh | bash
#
# Idempotent: run it again and it fetches the current release, keeps the token and the storage root it
# already wrote, and restarts the service.
set -euo pipefail

PORT="${VIDEOLA_PORT:-7331}"
DATA_DIR="${VIDEOLA_STORAGE_ROOT:-/var/lib/videola}"
INSTALL_DIR="/opt/videola"
ENV_FILE="/etc/videola.env"
REPO="fgilde/videola"

note() { echo "==> $*"; }

export DEBIAN_FRONTEND=noninteractive
note "packages"
apt-get update -qq
# `nodejs` from Debian 13 is Node 22, which is what the bundle targets. NodeSource would be one more
# apt source to trust and to keep working; the archive that ships the container is already trusted.
apt-get install -y -qq --no-install-recommends nodejs curl ca-certificates tar openssl jq >/dev/null

node_major="$(node --version | sed 's/^v\([0-9]*\).*/\1/')"
[ "$node_major" -ge 22 ] || {
  echo "videola: needs Node 22 or later, found $(node --version)" >&2
  exit 1
}

note "fetching the latest release"
asset="$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" \
  | jq -r '.assets[] | select(.name | test("^videola-server-.*\\.tar\\.gz$")) | .browser_download_url' \
  | head -n 1)"
[ -n "$asset" ] || {
  echo "videola: the latest release carries no server bundle" >&2
  exit 1
}

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
curl -fsSL "$asset" -o "$tmp/videola.tar.gz"
tar -xzf "$tmp/videola.tar.gz" -C "$tmp"
unpacked="$(find "$tmp" -maxdepth 1 -type d -name 'videola-server-*' | head -n 1)"
[ -n "$unpacked" ] || { echo "videola: the bundle did not unpack as expected" >&2; exit 1; }

note "installing to ${INSTALL_DIR}"
# Replaced wholesale rather than merged: a leftover file from an older release is a file nobody knows
# is there. The storage root is somewhere else entirely, so nothing anybody made is in the way.
rm -rf "$INSTALL_DIR"
mkdir -p "$INSTALL_DIR"
cp -a "$unpacked/." "$INSTALL_DIR/"

id -u videola >/dev/null 2>&1 || useradd --system --home "$DATA_DIR" --shell /usr/sbin/nologin videola
mkdir -p "$DATA_DIR"
chown -R videola:videola "$DATA_DIR"

if [ ! -f "$ENV_FILE" ]; then
  note "generating a token"
  # Written once and kept: regenerating it on every run would lock out every client that stored it,
  # which is the sort of helpfulness nobody asked for.
  cat >"$ENV_FILE" <<EOF
# Videola. Every /api call needs the token as \`Authorization: Bearer <token>\`.
# The server refuses to listen on anything but loopback without one.
VIDEOLA_TOKEN=$(openssl rand -hex 24)
VIDEOLA_HOST=0.0.0.0
VIDEOLA_PORT=${PORT}
VIDEOLA_STORAGE_ROOT=${DATA_DIR}
VIDEOLA_WEB_ROOT=${INSTALL_DIR}/web
VIDEOLA_WASM=${INSTALL_DIR}/videola_core_bg.wasm
EOF
  chmod 600 "$ENV_FILE"
fi

note "systemd unit"
cat >/etc/systemd/system/videola.service <<EOF
[Unit]
Description=Videola
Documentation=https://fgilde.github.io/videola/guide/self-hosting
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=videola
Group=videola
EnvironmentFile=${ENV_FILE}
WorkingDirectory=${INSTALL_DIR}
ExecStart=/usr/bin/node ${INSTALL_DIR}/serve.mjs
Restart=on-failure
RestartSec=2
# One process that reads and writes one directory, and needs nothing else. Every line below is a thing
# it cannot do rather than a thing it can: the storage root is the only writable path, and a video
# editor has no business with a device, a kernel module or somebody else's home directory.
NoNewPrivileges=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectSystem=strict
ProtectHome=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
RestrictSUIDSGID=yes
RestrictNamespaces=yes
LockPersonality=yes
ReadWritePaths=${DATA_DIR}

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now videola >/dev/null

note "waiting for the server"
token="$(sed -n 's/^VIDEOLA_TOKEN=//p' "$ENV_FILE")"
for _ in $(seq 1 30); do
  if curl -fsS -H "Authorization: Bearer ${token}" "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
    note "up on port ${PORT}"
    exit 0
  fi
  sleep 1
done

echo "videola: the service did not answer /api/health within thirty seconds" >&2
systemctl --no-pager --full status videola || true
exit 1
