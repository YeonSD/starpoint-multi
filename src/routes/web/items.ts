import { FastifyInstance, FastifyReply } from "fastify";
import { readFileSync } from "fs";
import path from "path";
import { staticPagesDir } from ".";
import { getAllPlayersSync, getPlayerItemsSync } from "../../data/wdfpData";
import { grantTargetToItemId, listScheduledCurrencyGrants, ScheduledCurrencyGrant } from "../../lib/itemGrantSchedules";
import { getItemCatalogEntries, ItemCatalogEntry } from "../../lib/itemCatalog";

function escapeHtml(value: string | number): string {
    return value.toString()
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function formatDateTimeLocal(date: Date): string {
    const pad = (value: number) => value.toString().padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatScheduleDate(value: string | null): string {
    if (value === null) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "-";
    return date.toLocaleString();
}

function grantTargetLabel(target: ScheduledCurrencyGrant["currency"]): string {
    if (target === "free_vmoney") return "Lodestar Beads";
    if (target === "free_mana") return "Mana";
    if (target === "exp_pool") return "Experience";

    const itemId = grantTargetToItemId(target);
    const item = itemId === null ? undefined : getItemCatalogEntries().find((entry) => entry.kind === "item" && entry.id === itemId);
    return item === undefined
        ? `Item ${itemId ?? target}`
        : `${item.nameKo} (${item.nameEn}, #${item.id})`;
}

function renderGrantOptions(): string {
    return getItemCatalogEntries()
        .filter((entry) => entry.kind === "currency" || entry.id !== null)
        .map((entry) => {
            const value = entry.kind === "currency" ? entry.key : `item:${entry.id}`;
            const label = entry.kind === "currency"
                ? `${entry.nameEn} (${entry.key})`
                : `${entry.nameKo} / ${entry.nameEn} #${entry.id}`;
            return `<option value="${escapeHtml(`${value} | ${label}`)}"></option>`;
        })
        .join("");
}

function renderScheduleRows(schedules: ScheduledCurrencyGrant[]): string {
    if (schedules.length === 0) {
        return `<tr><td colspan="8" class="px-4 py-5 text-on-surface-variant text-center">No scheduled grants.</td></tr>`;
    }

    return schedules.map((schedule) => `
        <tr class="border-t border-outline-variant">
            <td class="px-4 py-3 font-semibold">${escapeHtml(grantTargetLabel(schedule.currency))}</td>
            <td class="px-4 py-3">${escapeHtml(schedule.amount)}</td>
            <td class="px-4 py-3">${escapeHtml(schedule.subject ?? "-")}</td>
            <td class="px-4 py-3 capitalize">${escapeHtml(schedule.interval)}</td>
            <td class="px-4 py-3">${schedule.enabled ? "Enabled" : "Paused"}</td>
            <td class="px-4 py-3">${escapeHtml(formatScheduleDate(schedule.nextRunAt))}</td>
            <td class="px-4 py-3">${escapeHtml(formatScheduleDate(schedule.lastRunAt))}</td>
            <td class="px-4 py-3">
                <div class="flex flex-wrap gap-2">
                    <button type="button" data-schedule-action="toggle" data-schedule-id="${escapeHtml(schedule.id)}" data-enabled="${schedule.enabled ? "false" : "true"}"
                        class="px-3 py-2 rounded-full border border-outline-variant hover:bg-surface-container-high">
                        ${schedule.enabled ? "Pause" : "Enable"}
                    </button>
                    <button type="button" data-schedule-action="run-now" data-schedule-id="${escapeHtml(schedule.id)}"
                        class="px-3 py-2 rounded-full bg-primary text-on-primary font-semibold hover:opacity-90">
                        Run Now
                    </button>
                    <button type="button" data-schedule-action="delete" data-schedule-id="${escapeHtml(schedule.id)}"
                        class="px-3 py-2 rounded-full border border-red-600 text-red-700 hover:bg-red-50">
                        Delete
                    </button>
                </div>
            </td>
        </tr>
    `).join("");
}

function confidenceClass(confidence: ItemCatalogEntry["confidence"]): string {
    if (confidence === "confirmed") return "bg-green-100 text-green-800";
    if (confidence === "inferred") return "bg-yellow-100 text-yellow-800";
    return "bg-surface-container-high text-on-surface-variant";
}

function renderCatalogRows(playerId: number | null): string {
    const ownedItems = playerId === null ? {} : getPlayerItemsSync(playerId);
    const entries = getItemCatalogEntries().filter((entry) => entry.kind === "item");

    return entries.map((entry) => {
        const amount = entry.id === null ? "-" : (ownedItems[String(entry.id)] ?? 0);
        const iconContent = entry.iconPath
            ? `<img src="${escapeHtml(entry.iconPath)}" class="w-12 h-12 object-contain image-render-pixel" alt="">`
            : `<span class="text-xs text-on-surface-variant">No icon</span>`;

        return `
            <tr class="border-t border-outline-variant">
                <td class="px-4 py-3">
                    <div class="w-14 h-14 rounded-xl border border-outline-variant bg-surface-container flex items-center justify-center overflow-hidden">
                        ${iconContent}
                    </div>
                </td>
                <td class="px-4 py-3 tabular-nums font-bold">${escapeHtml(entry.id ?? "-")}</td>
                <td class="px-4 py-3">
                    <div class="font-bold">${escapeHtml(entry.nameKo)}</div>
                    <div class="text-sm text-on-surface-variant">${escapeHtml(entry.nameEn)}</div>
                    ${entry.thumbnailId ? `<div class="text-xs text-on-surface-variant break-all mt-1">${escapeHtml(entry.thumbnailId)}</div>` : ""}
                    ${entry.descriptionKo ? `<div class="text-xs text-on-surface-variant mt-2 max-w-md">${escapeHtml(entry.descriptionKo)}</div>` : ""}
                </td>
                <td class="px-4 py-3">${escapeHtml(entry.categoryKo)}</td>
                <td class="px-4 py-3 tabular-nums">${escapeHtml(amount)}</td>
                <td class="px-4 py-3 tabular-nums">${escapeHtml(entry.screenOrder ?? "-")}</td>
                <td class="px-4 py-3">
                    <span class="inline-flex px-3 py-1 rounded-full text-sm font-bold ${confidenceClass(entry.confidence)}">
                        ${escapeHtml(entry.confidence)}
                    </span>
                </td>
                <td class="px-4 py-3 text-sm text-on-surface-variant">${escapeHtml(entry.sources.join(", "))}</td>
            </tr>
        `;
    }).join("");
}

const routes = async (fastify: FastifyInstance) => {
    fastify.get("/", async (_, reply: FastifyReply) => {
        let html = readFileSync(path.join(__dirname, staticPagesDir, "items.html")).toString("utf-8");
        const players = getAllPlayersSync();
        const schedules = listScheduledCurrencyGrants();
        const defaultFirstRun = new Date(Date.now() + 5 * 60 * 1000);

        html = html
            .replace("{{playerOptions}}", players.map((player) => `
                <label class="flex items-center gap-3 px-4 py-3 border border-outline-variant rounded-2xl bg-surface">
                    <input type="checkbox" name="player_ids" value="${player.id}" class="w-5 h-5">
                    <span class="font-semibold">${escapeHtml(player.name)}</span>
                    <span class="text-on-surface-variant">#${player.id}</span>
                </label>
            `).join("") || `<p class="text-on-surface-variant">No players found.</p>`)
            .replace("{{grantOptions}}", renderGrantOptions())
            .replace("{{scheduleRows}}", renderScheduleRows(schedules))
            .replace("{{defaultFirstRun}}", formatDateTimeLocal(defaultFirstRun));

        reply.header("content-type", "text/html; charset=utf-8");
        reply.send(html);
    });

    fastify.get("/table", async (request, reply: FastifyReply) => {
        const players = getAllPlayersSync();
        const query = request.query as { player_id?: string };
        const requestedPlayerId = Number.parseInt(query.player_id ?? "", 10);
        const selectedPlayerId = Number.isFinite(requestedPlayerId)
            ? requestedPlayerId
            : (players[0]?.id ?? null);

        let html = readFileSync(path.join(__dirname, staticPagesDir, "item_table.html")).toString("utf-8");
        html = html
            .replace("{{playerOptions}}", players.map((player) => `
                <option value="${escapeHtml(player.id)}" ${player.id === selectedPlayerId ? "selected" : ""}>
                    ${escapeHtml(player.name)} #${escapeHtml(player.id)}
                </option>
            `).join(""))
            .replace("{{catalogRows}}", renderCatalogRows(selectedPlayerId));

        reply.header("content-type", "text/html; charset=utf-8");
        reply.send(html);
    });
};

export default routes;
