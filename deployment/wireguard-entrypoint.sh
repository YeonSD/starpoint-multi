#!/bin/sh
set -eu

WG_CONFIG_SOURCE="${WG_CONFIG_SOURCE:-/config/wireguard-server.conf}"
WG_CONFIG_TARGET="/etc/wireguard/wg0.conf"
WG_NETWORK="${STARPOINT_WG_NETWORK:-10.13.13.0/24}"
WG_SERVER_ADDRESS="${STARPOINT_WG_SERVER_ADDRESS:-10.13.13.1/24}"
WG_SERVER_IP="${WG_SERVER_ADDRESS%%/*}"
DNS_UPSTREAM="${STARPOINT_DNS_UPSTREAM:-1.1.1.1}"

mkdir -p /etc/wireguard /run/dnsmasq

echo "[wireguard] waiting for ${WG_CONFIG_SOURCE}"
while [ ! -s "${WG_CONFIG_SOURCE}" ]; do
    sleep 1
done

cp "${WG_CONFIG_SOURCE}" "${WG_CONFIG_TARGET}"
chmod 600 "${WG_CONFIG_TARGET}"

cat >/tmp/dnsmasq.conf <<EOF
no-resolv
server=${DNS_UPSTREAM}
listen-address=${WG_SERVER_IP}
bind-interfaces
domain-needed
bogus-priv
address=/na.wdfp.kakaogames.com/${WG_SERVER_IP}
address=/patch.wdfp.kakaogames.com/${WG_SERVER_IP}
address=/gc-openapi-zinny3.kakaogames.com/${WG_SERVER_IP}
address=/gc-infodesk-zinny3.kakaogames.com/${WG_SERVER_IP}
EOF

sysctl -w net.ipv4.ip_forward=1 >/dev/null
iptables -t nat -C POSTROUTING -s "${WG_NETWORK}" -o eth0 -j MASQUERADE 2>/dev/null \
    || iptables -t nat -A POSTROUTING -s "${WG_NETWORK}" -o eth0 -j MASQUERADE
iptables -t nat -C PREROUTING -i wg0 -p tcp --dport 80 -j REDIRECT --to-ports 8000 2>/dev/null \
    || iptables -t nat -A PREROUTING -i wg0 -p tcp --dport 80 -j REDIRECT --to-ports 8000

wg-quick up wg0

reload_wireguard() {
    cp "${WG_CONFIG_SOURCE}" "${WG_CONFIG_TARGET}"
    chmod 600 "${WG_CONFIG_TARGET}"
    wg-quick strip wg0 > /tmp/wg0-stripped.conf
    wg syncconf wg0 /tmp/wg0-stripped.conf
    echo "[wireguard] synced peers from ${WG_CONFIG_SOURCE}"
}

(
    last_hash="$(sha256sum "${WG_CONFIG_SOURCE}" | awk '{print $1}')"
    while true; do
        sleep 5
        current_hash="$(sha256sum "${WG_CONFIG_SOURCE}" | awk '{print $1}')"
        if [ "${current_hash}" != "${last_hash}" ]; then
            reload_wireguard || true
            last_hash="${current_hash}"
        fi
    done
) &
WATCHER_PID="$!"

cleanup() {
    kill "${WATCHER_PID}" 2>/dev/null || true
    wg-quick down wg0 || true
}
trap cleanup INT TERM EXIT

echo "[wireguard] serving DNS on ${WG_SERVER_IP}:53 and VPN on UDP ${STARPOINT_WG_PORT:-51820}"
dnsmasq --no-daemon --conf-file=/tmp/dnsmasq.conf
