import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getAllPlayersSync, givePlayerItemSync } from "../../data/wdfpData";
import { getItemCatalog } from "../../lib/itemCatalog";

interface GrantItemsBody {
    target?: "selected" | "all",
    player_ids?: number[] | string[],
    item_id?: number | string,
    amount?: number | string
}

function normalizePlayerIds(body: GrantItemsBody): number[] {
    if (body.target === "all") {
        return getAllPlayersSync().map((player) => player.id);
    }

    const rawIds = Array.isArray(body.player_ids) ? body.player_ids : [];
    return [...new Set(rawIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))];
}

const routes = async (fastify: FastifyInstance) => {
    fastify.get("/catalog", async (_: FastifyRequest, reply: FastifyReply) => {
        return reply.status(200).send({
            "items": getItemCatalog()
        });
    });

    fastify.post("/grant", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as GrantItemsBody | undefined;
        const playerIds = normalizePlayerIds(body ?? {});
        const itemId = Number(body?.item_id);
        const amount = Number(body?.amount);

        if (playerIds.length === 0 || !Number.isInteger(itemId) || itemId <= 0 || !Number.isInteger(amount) || amount <= 0) {
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "Select at least one player, a valid item, and a positive amount."
            });
        }

        const result = playerIds.map((playerId) => ({
            player_id: playerId,
            item_id: itemId,
            amount: givePlayerItemSync(playerId, itemId, amount)
        }));

        return reply.status(200).send({
            "ok": true,
            "result": result
        });
    });
};

export default routes;
