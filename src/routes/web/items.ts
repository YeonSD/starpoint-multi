import { FastifyInstance, FastifyReply } from "fastify";
import { readFileSync } from "fs";
import path from "path";
import { staticPagesDir } from ".";
import { getAllPlayersSync } from "../../data/wdfpData";
import { listScheduledCurrencyGrants, ScheduledCurrencyGrant } from "../../lib/itemGrantSchedules";

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

function scheduleCurrencyLabel(currency: ScheduledCurrencyGrant["currency"]): string {
    if (currency === "free_vmoney") return "Lodestar Beads";
    if (currency === "free_mana") return "Mana";
    return "Experience";
}

function renderScheduleRows(schedules: ScheduledCurrencyGrant[]): string {
    if (schedules.length === 0) {
        return `<tr><td colspan="8" class="px-4 py-5 text-on-surface-variant text-center">No scheduled grants.</td></tr>`;
    }

    return schedules.map((schedule) => `
        <tr class="border-t border-outline-variant">
            <td class="px-4 py-3 font-semibold">${escapeHtml(scheduleCurrencyLabel(schedule.currency))}</td>
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
            .replace("{{scheduleRows}}", renderScheduleRows(schedules))
            .replace("{{defaultFirstRun}}", formatDateTimeLocal(defaultFirstRun));

        reply.header("content-type", "text/html; charset=utf-8");
        reply.send(html);
    });
};

export default routes;
