import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getServerDate, getServerTimeSettings, ServerTimeMode, setServerTime, setServerTimeSettings } from "../../utils";
import { setAdminPassword, verifyAdminCredentials } from "../../lib/adminAuth";
import { getGachaScheduleOption } from "../../lib/gachaSchedule";

interface TimeQuery {
    time: string | undefined
}

interface GachaTimeQuery {
    gacha_id: string | undefined
    time_mode?: string
}

interface AdminPasswordBody {
    current_password?: string,
    new_password?: string,
    confirm_password?: string
}

const routes = async (fastify: FastifyInstance) => {
    fastify.get("/timeState", async () => {
        return {
            ok: true,
            server_time: getServerDate().toISOString(),
            settings: getServerTimeSettings()
        };
    })

    fastify.get("/resetTime", async (request: FastifyRequest, reply: FastifyReply) => {
        try {
            // convert string to date
            setServerTime(null)
        } catch (error) { }

        return reply.redirect(`/`);
    })

    fastify.get("/time", async (request: FastifyRequest, reply: FastifyReply) => {
        const newTime = (request.query as TimeQuery).time
        if (!newTime) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid query parameters."
        })

        try {
            const hasTimezone = /(?:Z|[+-]\d\d:\d\d)$/i.test(newTime)
            const normalizedTime = hasTimezone
                ? newTime
                : /^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(newTime)
                    ? `${newTime}:00.000Z`
                    : `${newTime}.000Z`
            const time = new Date(normalizedTime)

            setServerTime(time)

        } catch (error) {
            return reply.status(400).send({
                "error": "Bad Request",
                "message": error instanceof Error ? error.message : "Invalid server time."
            })
        }

        return reply.redirect(`/`);
    })

    fastify.get("/gachaTime", async (request: FastifyRequest, reply: FastifyReply) => {
        const { gacha_id: gachaId, time_mode: timeMode } = request.query as GachaTimeQuery;
        if (gachaId === undefined) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid query parameters."
        });

        const option = getGachaScheduleOption(gachaId);
        if (option === null) return reply.status(404).send({
            "error": "Not Found",
            "message": "Gacha table not found."
        });

        const selectedMode = normalizeGachaTimeMode(timeMode);
        const serverTime = new Date(`${option.serverTime}.000Z`);
        if (selectedMode === "fixed") {
            setServerTimeSettings({
                mode: "fixed",
                fixedTime: serverTime
            });
        } else if (selectedMode === "ticking") {
            setServerTimeSettings({
                mode: "ticking",
                baseServerTime: serverTime
            });
        } else {
            setServerTimeSettings({
                mode: "date_override",
                overrideDate: option.serverTime.slice(0, 10)
            });
        }
        return reply.redirect(`/`);
    })

    fastify.post("/adminPassword", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as AdminPasswordBody | undefined;
        const currentPassword = body?.current_password ?? "";
        const newPassword = body?.new_password ?? "";
        const confirmPassword = body?.confirm_password ?? "";

        if (!verifyAdminCredentials("admin", currentPassword)) {
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "Current password is incorrect."
            });
        }

        if (newPassword !== confirmPassword) {
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "New password confirmation does not match."
            });
        }

        try {
            setAdminPassword(newPassword);
        } catch (error) {
            return reply.status(400).send({
                "error": "Bad Request",
                "message": error instanceof Error ? error.message : "Invalid password."
            });
        }

        return reply.status(200).send({
            "ok": true
        });
    })
}

function normalizeGachaTimeMode(value: string | undefined): Extract<ServerTimeMode, "fixed" | "ticking" | "date_override"> {
    if (value === "ticking" || value === "date_override") return value;
    return "fixed";
}

export default routes;
