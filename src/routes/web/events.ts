import { FastifyInstance, FastifyReply } from "fastify";
import { readFileSync } from "fs";
import path from "path";
import { staticPagesDir } from ".";
import {
    EventBannerCandidate,
    EventCatalogGroup,
    getEventBannerCandidates,
    getEventCatalogGroups,
    getEventQuestTableSummaries
} from "../../lib/eventCatalog";

function escapeHtml(input: string | number): string {
    return input.toString()
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function formatDays(days: EventCatalogGroup["days"]): string {
    const labels: Record<string, string> = {
        mon: "Mon",
        tue: "Tue",
        wed: "Wed",
        thu: "Thu",
        fri: "Fri",
        sat: "Sat",
        sun: "Sun",
    };
    const enabled = Object.entries(days)
        .filter(([, value]) => value)
        .map(([key]) => labels[key] ?? key);

    return enabled.length === 7 ? "Every day" : enabled.join(", ");
}

function renderEventRows(groups: EventCatalogGroup[]): string {
    if (groups.length === 0) {
        return `
            <tr>
                <td colspan="7" class="px-4 py-8 text-center text-on-surface-variant">
                    No extracted event groups found. Run python scripts/extract_event_catalog.py after placing CDN files under .cdn.
                </td>
            </tr>
        `;
    }

    return groups.map((group) => `
        <tr class="border-b border-outline-variant last:border-b-0">
            <td class="px-4 py-3 font-bold">${escapeHtml(group.name || group.id)}</td>
            <td class="px-4 py-3">
                <div class="font-semibold">${escapeHtml(group.id)}</div>
                <div class="text-sm text-on-surface-variant">${escapeHtml(group.eventType)}</div>
            </td>
            <td class="px-4 py-3">${escapeHtml(formatDays(group.days))}</td>
            <td class="px-4 py-3 tabular-nums">${escapeHtml(group.availableFrom)}</td>
            <td class="px-4 py-3 tabular-nums">${escapeHtml(group.availableUntil ?? "-")}</td>
            <td class="px-4 py-3 text-sm text-on-surface-variant break-all">
                <div>${escapeHtml(group.bannerPath)}</div>
                <div>${escapeHtml(group.backgroundPath)}</div>
            </td>
            <td class="px-4 py-3 text-xs text-on-surface-variant break-all">${escapeHtml(group.sourceArchive)}</td>
        </tr>
    `).join("");
}

function renderQuestTableRows(): string {
    return getEventQuestTableSummaries().map((summary) => `
        <tr class="border-b border-outline-variant last:border-b-0">
            <td class="px-4 py-3 font-bold">${escapeHtml(summary.label)}</td>
            <td class="px-4 py-3 text-on-surface-variant">${escapeHtml(summary.file)}</td>
            <td class="px-4 py-3 tabular-nums">${escapeHtml(summary.questCount)}</td>
        </tr>
    `).join("");
}

function renderBannerCards(banners: EventBannerCandidate[]): string {
    if (banners.length === 0) {
        return `<p class="text-on-surface-variant">No event banner candidates found. Run python scripts/extract_event_catalog.py after placing CDN files under .cdn.</p>`;
    }

    return banners.map((banner) => `
        <article class="overflow-hidden rounded-2xl border border-outline-variant bg-surface">
            <img src="${escapeHtml(banner.file)}" alt="Event banner candidate ${escapeHtml(banner.index)}" class="w-full bg-surface-container-high">
            <div class="grid gap-1 p-3 text-sm">
                <strong class="text-on-background">#${escapeHtml(banner.index)}</strong>
                <span>${escapeHtml(banner.width)}x${escapeHtml(banner.height)}</span>
                <span class="break-all text-xs text-on-surface-variant">${escapeHtml(banner.sourceArchive)}</span>
                <span class="break-all text-xs text-on-surface-variant">${escapeHtml(banner.sha1)}</span>
            </div>
        </article>
    `).join("");
}

const routes = async (fastify: FastifyInstance) => {
    fastify.get("/", async (_, reply: FastifyReply) => {
        let html = readFileSync(path.join(__dirname, staticPagesDir, "events.html")).toString("utf-8");
        html = html
            .replace("{{eventRows}}", renderEventRows(getEventCatalogGroups()))
            .replace("{{questTableRows}}", renderQuestTableRows())
            .replace("{{bannerCards}}", renderBannerCards(getEventBannerCandidates()));

        reply.header("content-type", "text/html; charset=utf-8");
        reply.send(html);
    });
};

export default routes;
