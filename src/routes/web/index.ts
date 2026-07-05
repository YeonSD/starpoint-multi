import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { readFileSync } from "fs";
import path from "path";
import playerRoutePlugin from "./player"
import { getServerDate, getServerTimeSettings } from "../../utils";
import { registerAdminAuth } from "./auth";
import roomsRoutePlugin from "./rooms";
import itemsRoutePlugin from "./items";
import sourceRoutePlugin from "./source";
import { isDefaultAdminPasswordActive } from "../../lib/adminAuth";
import { getGachaScheduleOptions } from "../../lib/gachaSchedule";

export const staticPagesDir = "../../../web/pages"

const routes = async (fastify: FastifyInstance) => {
    registerAdminAuth(fastify)

    fastify.get("/", async (_: FastifyRequest, reply: FastifyReply) => {
        const currentServerTime = getServerDate().toISOString().replace(/\.\d\d\dZ/, "")
        const serverTimeSettings = getServerTimeSettings()
        const gachaOptions = getGachaScheduleOptions()
        let html = readFileSync(path.join(__dirname, staticPagesDir, "index.html")).toString("utf-8")

        // replace values
        html = html.replace("{{currentServerTime}}", currentServerTime)
        html = html.replace("{{serverTimeMode}}", serverTimeSettings.mode)
        html = html.replace("{{gachaOptions}}", gachaOptions.map((option) => `
            <option value="${option.id}" ${option.id === "1" ? "selected" : ""}>${option.label}</option>
        `).join(""))
        html = html.replace("{{adminPasswordNotice}}", isDefaultAdminPasswordActive()
            ? "Default admin password is active. Change it before exposing this server."
            : "Admin password has been changed.")

        reply.header("content-type", "text/html; charset=utf-8")
        reply.send(html)
    })

    fastify.register(playerRoutePlugin, { prefix: "/player" })
    fastify.register(roomsRoutePlugin, { prefix: "/rooms" })
    fastify.register(itemsRoutePlugin, { prefix: "/items" })
    fastify.register(sourceRoutePlugin, { prefix: "/source" })
}

export default routes;
