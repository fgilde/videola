#!/usr/bin/env bash
# Videola in an LXC container on Proxmox VE, from the host.
#
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/fgilde/videola/main/deploy/proxmox/videola.sh)"
#
# Self-contained on purpose. The community helper scripts source a shared `build.func` from another
# repository at run time, which is convenient and means this script would break whenever that file
# moved. Everything it needs is `pct`, which every PVE host has.
#
# What it makes: a Debian 13 container, unprivileged, with Node from Debian's own archive, the server
# bundle from the latest release, a systemd unit, and a token generated on the spot. What it does not
# make: a reverse proxy, a certificate or a backup job -- those are decisions about somebody's network
# and this script has no business guessing at them.
set -euo pipefail

CTID="${CTID:-}"
HOSTNAME="${HOSTNAME_:-videola}"
DISK_GB="${DISK_GB:-8}"
CORES="${CORES:-2}"
RAM_MB="${RAM_MB:-2048}"
BRIDGE="${BRIDGE:-vmbr0}"
STORAGE="${STORAGE:-local-lvm}"
TEMPLATE_STORAGE="${TEMPLATE_STORAGE:-local}"
TEMPLATE="${TEMPLATE:-debian-13-standard_13.1-2_amd64.tar.zst}"
PORT="${PORT:-7331}"
# Where the projects live inside the container, and the one path worth backing up.
DATA_DIR="/var/lib/videola"

die() { echo "videola: $*" >&2; exit 1; }
note() { echo "==> $*"; }

command -v pct >/dev/null || die "this runs on a Proxmox VE host: pct was not found"
[ "$(id -u)" -eq 0 ] || die "run as root"

if [ -z "$CTID" ]; then
  CTID="$(pvesh get /cluster/nextid)"
  note "no CTID given, taking the next free one: $CTID"
fi

if ! pveam list "$TEMPLATE_STORAGE" 2>/dev/null | grep -q "$TEMPLATE"; then
  note "fetching the container template"
  pveam update >/dev/null
  pveam download "$TEMPLATE_STORAGE" "$TEMPLATE"
fi

note "creating container $CTID"
# Unprivileged, with nesting off: the server is one Node process and needs neither root in the host's
# namespace nor a container runtime inside itself.
pct create "$CTID" "${TEMPLATE_STORAGE}:vztmpl/${TEMPLATE}" \
  --hostname "$HOSTNAME" \
  --cores "$CORES" \
  --memory "$RAM_MB" \
  --rootfs "${STORAGE}:${DISK_GB}" \
  --net0 "name=eth0,bridge=${BRIDGE},ip=dhcp" \
  --unprivileged 1 \
  --features nesting=0 \
  --onboot 1 \
  --start 1

note "waiting for the network"
for _ in $(seq 1 30); do
  pct exec "$CTID" -- getent hosts deb.debian.org >/dev/null 2>&1 && break
  sleep 2
done

note "installing"
# The installer travels in as a file rather than as a here-string: a shell inside a shell inside pct is
# three levels of quoting, and the level that gets it wrong is always the innermost.
pct push "$CTID" "$(dirname "$0")/install.sh" /root/install.sh --perms 755 2>/dev/null \
  || pct exec "$CTID" -- bash -c "curl -fsSL https://raw.githubusercontent.com/fgilde/videola/main/deploy/proxmox/install.sh -o /root/install.sh && chmod +x /root/install.sh"
pct exec "$CTID" -- env "VIDEOLA_PORT=$PORT" "VIDEOLA_STORAGE_ROOT=$DATA_DIR" /root/install.sh

IP="$(pct exec "$CTID" -- hostname -I | awk '{print $1}')"
TOKEN="$(pct exec "$CTID" -- sed -n 's/^VIDEOLA_TOKEN=//p' /etc/videola.env)"

cat <<EOF

Videola is running in container $CTID.

  Editor   http://${IP}:${PORT}/
  API      http://${IP}:${PORT}/api/health
  Token    ${TOKEN}

The token is not decoration: every /api call needs it as \`Authorization: Bearer\`, and the server
refuses to listen on anything but loopback without one. It is in /etc/videola.env inside the container,
which is also where you would change the port or the storage root.

  pct exec $CTID -- systemctl status videola
  pct exec $CTID -- journalctl -u videola -f

Projects live in ${DATA_DIR} inside the container. That is the directory to back up.
EOF
