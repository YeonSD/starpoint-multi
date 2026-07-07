import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
    createScheduledCurrencyGrant,
    deleteScheduledCurrencyGrant,
    getAllPlayerIdsForGrant,
    grantCurrencyToPlayers,
    isGrantCurrency,
    isGrantTarget,
    isScheduledGrantInterval,
    listScheduledCurrencyGrants,
    runScheduledCurrencyGrantNow,
    sendCurrencyMailGrantToPlayers,
    setScheduledCurrencyGrantEnabled
} from "../../lib/itemGrantSchedules";

interface GrantCurrencyBody {
    target?: "selected" | "all",
    player_ids?: number[] | string[],
    currency?: unknown,
    grant_key?: unknown,
    amount?: number | string,
    delivery?: "direct" | "mail",
    subject?: string,
    description?: string
}

interface CreateScheduleBody {
    currency?: unknown,
    grant_key?: unknown,
    amount?: number | string,
    interval?: unknown,
    next_run_at?: string,
    subject?: string,
    description?: string
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
        const currency = body?.grant_key ?? body?.currency;
        const delivery = body?.delivery === "direct" ? "direct" : "mail";
        const subject = normalizeOptionalText(body?.subject, 80);
        const description = normalizeOptionalText(body?.description, 300);

        if (playerIds.length === 0 || !isGrantTarget(currency) || !Number.isInteger(amount) || amount === 0) {
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "Select at least one player, a supported grant target, and a non-zero amount."
            });
        }

        if (delivery === "mail" && amount <= 0) {
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "Mail grants must use a positive amount. Use Direct to remove currency."
            });
        }

        const result = delivery === "direct"
            ? grantCurrencyToPlayers(playerIds, currency, amount)
            : sendCurrencyMailGrantToPlayers(playerIds, currency, amount, subject, description);

        return reply.status(200).send({
            "ok": true,
            "result": result
        });
    });

    fastify.post("/schedules", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as CreateScheduleBody | undefined;
        const amount = Number(body?.amount);
        const currency = body?.grant_key ?? body?.currency;
        const interval = body?.interval;
        const subject = normalizeOptionalText(body?.subject, 80);
        const description = normalizeOptionalText(body?.description, 300);
        const nextRunAt = body?.next_run_at === undefined || body.next_run_at.trim() === ""
            ? undefined
            : new Date(body.next_run_at);

        if (!isGrantTarget(currency) || !isScheduledGrantInterval(interval) || !Number.isInteger(amount) || amount <= 0) {
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "Select a supported grant target, period, and positive amount."
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
            nextRunAt,
            subject,
            description
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

function normalizeOptionalText(value: unknown, maxLength: number): string | undefined {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    return trimmed === "" ? undefined : trimmed.slice(0, maxLength);
}

export default routes;
