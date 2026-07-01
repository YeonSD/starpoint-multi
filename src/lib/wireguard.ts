import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { generateKeyPairSync, randomUUID } from "crypto";

const rootDir = path.join(__dirname, "../..");
const databaseDir = path.join(rootDir, ".database");
const generatedDir = path.join(rootDir, ".generated", "wireguard");
const registryPath = path.join(databaseDir, "wireguard.json");
const serverConfigPath = path.join(generatedDir, "wireguard-server.conf");

const pkcs8PrivatePrefix = Buffer.from("302e020100300506032b656e04220420", "hex");
const spkiPublicPrefix = Buffer.from("302a300506032b656e032100", "hex");

export interface WireGuardPeer {
    id: string,
    name: string,
    address: string,
    privateKey: string,
    publicKey: string,
    createdAt: string
}

interface WireGuardRegistry {
    serverPrivateKey: string,
    serverPublicKey: string,
    peers: WireGuardPeer[]
}

function ensureDirs(): void {
    mkdirSync(databaseDir, { recursive: true });
    mkdirSync(generatedDir, { recursive: true });
}

function generateWireGuardKeyPair(): { privateKey: string, publicKey: string } {
    const keyPair = generateKeyPairSync("x25519");
    const privateDer = keyPair.privateKey.export({ format: "der", type: "pkcs8" });
    const publicDer = keyPair.publicKey.export({ format: "der", type: "spki" });

    if (!privateDer.subarray(0, pkcs8PrivatePrefix.length).equals(pkcs8PrivatePrefix)) {
        throw new Error("Unexpected X25519 private key format.");
    }

    if (!publicDer.subarray(0, spkiPublicPrefix.length).equals(spkiPublicPrefix)) {
        throw new Error("Unexpected X25519 public key format.");
    }

    return {
        privateKey: privateDer.subarray(pkcs8PrivatePrefix.length).toString("base64"),
        publicKey: publicDer.subarray(spkiPublicPrefix.length).toString("base64")
    };
}

function readRegistry(): WireGuardRegistry {
    ensureDirs();

    if (existsSync(registryPath)) {
        return JSON.parse(readFileSync(registryPath, "utf-8")) as WireGuardRegistry;
    }

    const serverKeys = generateWireGuardKeyPair();
    const registry: WireGuardRegistry = {
        serverPrivateKey: serverKeys.privateKey,
        serverPublicKey: serverKeys.publicKey,
        peers: []
    };
    writeRegistry(registry);
    return registry;
}

function writeRegistry(registry: WireGuardRegistry): void {
    ensureDirs();
    writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`, "utf-8");
    writeFileSync(serverConfigPath, buildServerConfig(registry), "utf-8");
}

function parseCidr(value: string): { base: string, prefix: number } {
    const [base, prefixText] = value.split("/");
    const prefix = Number.parseInt(prefixText ?? "24");
    if (!base || Number.isNaN(prefix)) return { base: "10.13.13.0", prefix: 24 };
    return { base, prefix };
}

function allocatePeerAddress(peers: WireGuardPeer[]): string {
    const network = parseCidr(process.env.STARPOINT_WG_NETWORK ?? "10.13.13.0/24");
    const octets = network.base.split(".").map((part) => Number.parseInt(part));
    if (octets.length !== 4 || octets.some((part) => Number.isNaN(part))) {
        throw new Error(`Invalid STARPOINT_WG_NETWORK: ${network.base}/${network.prefix}`);
    }

    const used = new Set(peers.map((peer) => peer.address.split("/")[0]));
    for (let host = 2; host < 255; host++) {
        const address = `${octets[0]}.${octets[1]}.${octets[2]}.${host}`;
        if (!used.has(address)) return `${address}/32`;
    }

    throw new Error("No WireGuard peer addresses left.");
}

function getServerAddress(): string {
    return process.env.STARPOINT_WG_SERVER_ADDRESS ?? "10.13.13.1/24";
}

function getServerDns(): string {
    return process.env.STARPOINT_WG_DNS ?? getServerAddress().split("/")[0];
}

function getEndpoint(): string {
    const host = process.env.STARPOINT_WG_ENDPOINT_HOST
        ?? process.env.STARPOINT_MULTI_HOST
        ?? process.env.STARPOINT_PUBLIC_HOST
        ?? "127.0.0.1";
    return process.env.STARPOINT_WG_ENDPOINT ?? `${host}:${getListenPort()}`;
}

function getListenPort(): number {
    const port = Number.parseInt(process.env.STARPOINT_WG_PORT ?? "51820");
    return Number.isNaN(port) ? 51820 : port;
}

function getAllowedIps(): string {
    return process.env.STARPOINT_WG_ALLOWED_IPS ?? "0.0.0.0/0";
}

function sanitizeName(name: string): string {
    return name.trim().replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "player";
}

export function listWireGuardPeers(): WireGuardPeer[] {
    return readRegistry().peers;
}

export function getWireGuardPeer(id: string): WireGuardPeer | undefined {
    return readRegistry().peers.find((peer) => peer.id === id);
}

export function createWireGuardPeer(name: string): WireGuardPeer {
    const registry = readRegistry();
    const keys = generateWireGuardKeyPair();
    const peer: WireGuardPeer = {
        id: randomUUID(),
        name: sanitizeName(name),
        address: allocatePeerAddress(registry.peers),
        privateKey: keys.privateKey,
        publicKey: keys.publicKey,
        createdAt: new Date().toISOString()
    };

    registry.peers.push(peer);
    writeRegistry(registry);
    writeFileSync(path.join(generatedDir, `${peer.name}-${peer.id}.conf`), buildClientConfig(peer), "utf-8");
    return peer;
}

export function deleteWireGuardPeer(id: string): boolean {
    const registry = readRegistry();
    const previousLength = registry.peers.length;
    registry.peers = registry.peers.filter((peer) => peer.id !== id);
    if (registry.peers.length === previousLength) return false;

    writeRegistry(registry);
    return true;
}

export function buildClientConfig(peer: WireGuardPeer): string {
    const registry = readRegistry();
    return `[Interface]
PrivateKey = ${peer.privateKey}
Address = ${peer.address}
DNS = ${getServerDns()}

[Peer]
PublicKey = ${registry.serverPublicKey}
AllowedIPs = ${getAllowedIps()}
Endpoint = ${getEndpoint()}
PersistentKeepalive = 25
`;
}

export function buildServerPeerBlock(peer: WireGuardPeer): string {
    return `[Peer]
# ${peer.name} (${peer.id})
PublicKey = ${peer.publicKey}
AllowedIPs = ${peer.address}
`;
}

export function buildServerConfig(registry = readRegistry()): string {
    return `[Interface]
PrivateKey = ${registry.serverPrivateKey}
Address = ${getServerAddress()}
ListenPort = ${getListenPort()}

${registry.peers.map(buildServerPeerBlock).join("\n")}`;
}

export function getWireGuardServerConfigPath(): string {
    readRegistry();
    return serverConfigPath;
}
