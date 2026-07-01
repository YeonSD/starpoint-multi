import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getAllPlayersSync, getPlayerSync, updatePlayerSync } from "../../data/wdfpData";

type GrantCurrency = "free_vmoney" | "free_mana";

interface GrantCurrencyBody {
    target?: "selected" | "all",
    player_ids?: number[] | string[],
    currency?: GrantCurrency,
    amount?: number | string
}

function normalizePlayerIds(body: GrantCurrencyBody): number[] {
    if (body.target === "all") {
        return getAllPlayersSync(0, 100000).map((player) => player.id);
    }

    const rawIds = Array.isArray(body.player_ids) ? body.player_ids : [];
    return [...new Set(rawIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))];
}

function isGrantCurrency(value: unknown): value is GrantCurrency {
    return value === "free_vmoney" || value === "free_mana";
}

const routes = async (fastify: FastifyInstance) => {
    fastify.post("/grant", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as GrantCurrencyBody | undefined;
        const playerIds = normalizePlayerIds(body ?? {});
        const amount = Number(body?.amount);
        const currency = body?.currency;

        if (playerIds.length === 0 || !isGrantCurrency(currency) || !Number.isInteger(amount) || amount <= 0) {
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "Select at least one player, a supported currency, and a positive amount."
            });
        }

        const result = playerIds.map((playerId) => {
            const player = getPlayerSync(playerId);
            if (player === null) {
                return {
                    player_id: playerId,
                    skipped: true,
                    reason: "Player not found."
                };
            }

            const total = currency === "free_vmoney"
                ? player.freeVmoney + amount
                : player.freeMana + amount;

            updatePlayerSync(currency === "free_vmoney"
                ? { id: playerId, freeVmoney: total }
                : { id: playerId, freeMana: total });

            return {
                player_id: playerId,
                currency: currency,
                amount: amount,
                total: total
            };
        });

        return reply.status(200).send({
            "ok": true,
            "result": result
        });
    });
};

export default routes;
