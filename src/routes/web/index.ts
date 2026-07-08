import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { existsSync, readFileSync } from "fs";
import path from "path";
import playerRoutePlugin from "./player"
import { formatServerDateForTimeZone, getServerDate, getServerTimeSettings, getServerTimeZone } from "../../utils";
import { registerAdminAuth } from "./auth";
import roomsRoutePlugin from "./rooms";
import itemsRoutePlugin from "./items";
import sourceRoutePlugin from "./source";
import eventsRoutePlugin from "./events";
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

    fastify.get("/gacha-banners", async (_: FastifyRequest, reply: FastifyReply) => {
        let html = readFileSync(path.join(__dirname, staticPagesDir, "gacha-banners.html")).toString("utf-8")
        html = html.replace("{{bannerCards}}", renderGachaBannerCards())

        reply.header("content-type", "text/html; charset=utf-8")
        reply.send(html)
    })

    fastify.register(playerRoutePlugin, { prefix: "/player" })
    fastify.register(roomsRoutePlugin, { prefix: "/rooms" })
    fastify.register(eventsRoutePlugin, { prefix: "/events" })
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

interface GachaBannerCandidate {
    index: number
    file: string
    width: number
    height: number
    sourceArchive: string
    sourceEntry: string
    sha1: string
}

function renderGachaBannerCards(): string {
    const manifestPath = path.join(__dirname, "../../../.generated/gacha-banners.json")
    if (!existsSync(manifestPath)) {
        return `<p class="text-on-surface-variant">No extracted gacha banner candidates were found.</p>`
    }

    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as GachaBannerCandidate[]
    if (manifest.length === 0) {
        return `<p class="text-on-surface-variant">No extracted gacha banner candidates were found.</p>`
    }

    return manifest.map((candidate) => `
        <article class="overflow-hidden rounded-2xl border border-outline-variant bg-surface-container-low">
            <img src="${escapeHtml(candidate.file)}" alt="Gacha banner candidate ${candidate.index}" class="w-full bg-surface-container-high">
            <div class="grid gap-1 p-3 text-sm">
                <strong class="text-on-background">#${candidate.index}</strong>
                <span>${candidate.width}x${candidate.height}</span>
                <span class="break-all text-xs text-on-surface-variant">${escapeHtml(candidate.sourceArchive)}</span>
                <span class="break-all text-xs text-on-surface-variant">${escapeHtml(candidate.sha1)}</span>
            </div>
        </article>
    `).join("")
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

export default routes;
