import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { readFileSync } from "fs";
import path from "path";
import playerRoutePlugin from "./player"
import { formatServerDateForTimeZone, getServerDate, getServerTimeSettings, getServerTimeZone } from "../../utils";
import { registerAdminAuth } from "./auth";
import roomsRoutePlugin from "./rooms";
import itemsRoutePlugin from "./items";
import sourceRoutePlugin from "./source";
import { isDefaultAdminPasswordActive } from "../../lib/adminAuth";
import { GachaScheduleOption, getGachaScheduleOptions } from "../../lib/gachaSchedule";

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
        html = html.replace("{{currentServerLocalTime}}", formatServerDateForTimeZone())
        html = html.replace("{{serverTimeZone}}", getServerTimeZone())
        html = html.replace("{{serverTimeMode}}", serverTimeSettings.mode)
        html = html.replace("{{fixedSelected}}", serverTimeSettings.mode === "fixed" ? "selected" : "")
        html = html.replace("{{liveSelected}}", serverTimeSettings.mode === "live" ? "selected" : "")
        html = html.replace("{{gachaOptions}}", gachaOptions.map((option) => renderGachaOption(option)).join(""))
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

function renderGachaOption(option: GachaScheduleOption): string {
    return `
            <option value="${escapeHtml(option.id)}"
                data-title="${escapeHtml(option.title)}"
                data-subtitle="${escapeHtml(option.subtitle ?? "")}"
                data-type="${escapeHtml(option.typeLabel)}"
                data-start="${escapeHtml(option.startDate)}"
                data-end="${escapeHtml(option.endDate)}"
                data-banner="${escapeHtml(option.bannerPath ?? "")}"
                ${option.id === "1" ? "selected" : ""}>${escapeHtml(option.label)}</option>
        `;
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

export default routes;
