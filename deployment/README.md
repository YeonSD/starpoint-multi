# Deployment Files

The runtime deployment path is Docker Compose.

Files used by the current stack:

- `wireguard-dnsmasq.Dockerfile`
- `wireguard-entrypoint.sh`
- `nginx/wg-proxy.conf`

The WireGuard container provides VPN and DNS redirection. The nginx container terminates HTTPS for the game domains and proxies traffic to the Starpoint HTTP server.

VPN clients can download the root CA certificate from:

- `http://10.13.13.1/rootca.cer` (DER, recommended for Android)
- `http://10.13.13.1/rootca.crt` (PEM)
