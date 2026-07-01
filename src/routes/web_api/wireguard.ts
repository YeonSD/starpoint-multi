import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import qrcode from "qrcode";
import {
    buildClientConfig,
    buildServerPeerBlock,
    createWireGuardPeer,
    deleteWireGuardPeer,
    getWireGuardPeer,
    listWireGuardPeers
} from "../../lib/wireguard";

interface PeerParams {
    peerId: string | undefined
}

interface CreatePeerBody {
    name: string | undefined
}

interface CreatePeerQuery {
    name: string | undefined
}

const routes = async (fastify: FastifyInstance) => {
    fastify.get("/peers", async (_: FastifyRequest, reply: FastifyReply) => {
        return reply.status(200).send({
            peers: listWireGuardPeers().map((peer) => ({
                id: peer.id,
                name: peer.name,
                address: peer.address,
                public_key: peer.publicKey,
                created_at: peer.createdAt
            }))
        });
    });

    fastify.post("/peers", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as CreatePeerBody | undefined;
        createWireGuardPeer(body?.name ?? "player");
        return reply.redirect("/player#wireguard");
    });

    fastify.get("/peers/create", async (request: FastifyRequest, reply: FastifyReply) => {
        const query = request.query as CreatePeerQuery;
        createWireGuardPeer(query.name ?? "player");
        return reply.redirect("/player#wireguard");
    });

    fastify.get("/peers/:peerId/config", async (request: FastifyRequest, reply: FastifyReply) => {
        const { peerId } = request.params as PeerParams;
        const peer = peerId === undefined ? undefined : getWireGuardPeer(peerId);
        if (peer === undefined) {
            return reply.status(404).send({
                error: "Not Found",
                message: "WireGuard peer not found."
            });
        }

        reply.header("content-disposition", `attachment; filename="${peer.name}.conf"`);
        return reply.type("text/plain; charset=utf-8").send(buildClientConfig(peer));
    });

    fastify.get("/peers/:peerId/qr", async (request: FastifyRequest, reply: FastifyReply) => {
        const { peerId } = request.params as PeerParams;
        const peer = peerId === undefined ? undefined : getWireGuardPeer(peerId);
        if (peer === undefined) {
            return reply.status(404).send({
                error: "Not Found",
                message: "WireGuard peer not found."
            });
        }

        const png = await qrcode.toBuffer(buildClientConfig(peer), {
            type: "png",
            errorCorrectionLevel: "M",
            margin: 2,
            width: 384
        });
        return reply.type("image/png").send(png);
    });

    fastify.get("/peers/:peerId/server-peer", async (request: FastifyRequest, reply: FastifyReply) => {
        const { peerId } = request.params as PeerParams;
        const peer = peerId === undefined ? undefined : getWireGuardPeer(peerId);
        if (peer === undefined) {
            return reply.status(404).send({
                error: "Not Found",
                message: "WireGuard peer not found."
            });
        }

        return reply.type("text/plain; charset=utf-8").send(buildServerPeerBlock(peer));
    });

    fastify.get("/peers/:peerId/delete", async (request: FastifyRequest, reply: FastifyReply) => {
        const { peerId } = request.params as PeerParams;
        if (peerId !== undefined) deleteWireGuardPeer(peerId);
        return reply.redirect("/player#wireguard");
    });
}

export default routes;
