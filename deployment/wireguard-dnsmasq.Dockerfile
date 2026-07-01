FROM debian:bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        dnsmasq \
        iproute2 \
        iptables \
        procps \
        wireguard-tools \
    && rm -rf /var/lib/apt/lists/*

COPY deployment/wireguard-entrypoint.sh /usr/local/bin/wireguard-entrypoint.sh
RUN chmod +x /usr/local/bin/wireguard-entrypoint.sh

EXPOSE 53/udp 51820/udp

CMD ["/usr/local/bin/wireguard-entrypoint.sh"]
