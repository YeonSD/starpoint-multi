import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
    createScheduledCurrencyGrant,
    deleteScheduledCurrencyGrant,
    getAllPlayerIdsForGrant,
    grantCurrencyToPlayers,
    isGrantCurrency,
    isScheduledGrantInterval,
    listScheduledCurrencyGrants,
    runScheduledCurrencyGrantNow,
    setScheduledCurrencyGrantEnabled
} from "../../lib/itemGrantSchedules";

interface GrantCurrencyBody {
    target?: "selected" | "all",
    player_ids?: number[] | string[],
    currency?: unknown,
    amount?: number | string
}

interface CreateScheduleBody {
    currency?: unknown,
    amount?: number | string,
    interval?: unknown,
    next_run_at?: string
}

function normalizePlayerIds(body: GrantCurrencyBody): number[] {
    if (body.target === "all") {
        return getAllPlayerIdsForGrant();
    }

    const rawIds = Array.isArray(body.player_ids) ? body.player_ids : [];
    return [...new Set(rawIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))];
}

const routes = async (fastify: FastifyInstance) => {
    fastify.get("/schedules", async () => {
        return {
            ok: true,
            schedules: listScheduledCurrencyGrants()
        };
    });

    fastify.post("/grant", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as GrantCurrencyBody | undefined;
        const playerIds = normalizePlayerIds(body ?? {});
        const amount = Number(body?.amount);
        const currency = body?.currency;

        if (playerIds.length === 0 || !isGrantCurrency(currency) || !Number.isInteger(amount) || amount === 0) {
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "Select at least one player, a supported currency, and a non-zero amount."
            });
        }

        const result = grantCurrencyToPlayers(playerIds, currency, amount);

        return reply.status(200).send({
            "ok": true,
            "result": result
        });
    });

    fastify.post("/schedules", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as CreateScheduleBody | undefined;
        const amount = Number(body?.amount);
        const currency = body?.currency;
        const interval = body?.interval;
        const nextRunAt = body?.next_run_at === undefined || body.next_run_at.trim() === ""
            ? undefined
            : new Date(body.next_run_at);

        if (!isGrantCurrency(currency) || !isScheduledGrantInterval(interval) || !Number.isInteger(amount) || amount <= 0) {
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "Select a supported currency, period, and positive amount."
            });
        }

        if (nextRunAt !== undefined && Number.isNaN(nextRunAt.getTime())) {
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "Invalid first run time."
            });
        }

        const schedule = createScheduledCurrencyGrant({
            currency,
            amount,
            interval,
            nextRunAt
        });

        return reply.status(200).send({
            "ok": true,
            "schedule": schedule
        });
    });

    fastify.post("/schedules/:id/toggle", async (request: FastifyRequest, reply: FastifyReply) => {
        const params = request.params as { id?: string };
        const body = request.body as { enabled?: boolean } | undefined;
        const schedule = setScheduledCurrencyGrantEnabled(params.id ?? "", body?.enabled === true);
        if (schedule === null) {
            return reply.status(404).send({
                "error": "Not Found",
                "message": "Scheduled grant not found."
            });
        }

        return reply.status(200).send({
            "ok": true,
            "schedule": schedule
        });
    });

    fastify.post("/schedules/:id/run-now", async (request: FastifyRequest, reply: FastifyReply) => {
        const params = request.params as { id?: string };
        const result = runScheduledCurrencyGrantNow(params.id ?? "");
        if (result === null) {
            return reply.status(404).send({
                "error": "Not Found",
                "message": "Scheduled grant not found."
            });
        }

        return reply.status(200).send({
            "ok": true,
            "schedule": result.schedule,
            "result": result.result
        });
    });

    fastify.post("/schedules/:id/delete", async (request: FastifyRequest, reply: FastifyReply) => {
        const params = request.params as { id?: string };
        if (!deleteScheduledCurrencyGrant(params.id ?? "")) {
            return reply.status(404).send({
                "error": "Not Found",
                "message": "Scheduled grant not found."
            });
        }

        return reply.status(200).send({
            "ok": true
        });
    });
};

export default routes;
