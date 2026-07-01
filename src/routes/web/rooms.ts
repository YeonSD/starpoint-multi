import { FastifyInstance, FastifyReply } from "fastify";
import { readFileSync } from "fs";
import path from "path";
import { getMultiRoomAdminList } from "../api/multiBattleQuest";
import { staticPagesDir } from ".";

function escapeHtml(input: string | number): string {
    return input.toString()
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function formatServerTime(timestamp: number): string {
    if (!timestamp) return "-";

    return new Date(timestamp * 1000).toISOString().replace("T", " ").slice(0, 19);
}

function renderRows(): string {
    const rooms = getMultiRoomAdminList();
    if (rooms.length === 0) {
        return `
            <tr>
                <td colspan="7" class="px-4 py-8 text-center text-on-surface-variant">No active multiplayer rooms.</td>
            </tr>
        `;
    }

    return rooms.map((room) => `
        <tr class="border-b border-outline-variant last:border-b-0">
            <td class="px-4 py-3 font-bold tabular-nums">${escapeHtml(room.roomNumber)}</td>
            <td class="px-4 py-3">
                <div class="font-semibold">${escapeHtml(room.questName || "-")}</div>
                <div class="text-sm text-on-surface-variant">Quest ${escapeHtml(room.questId)} / Category ${escapeHtml(room.categoryId)}</div>
            </td>
            <td class="px-4 py-3">
                <span class="inline-flex px-3 py-1 rounded-full text-sm font-bold ${room.status === "playing" ? "bg-tertiary-container text-on-tertiary-container" : "bg-secondary-container text-on-secondary-container"}">
                    ${room.status === "playing" ? "Playing" : "Waiting"}
                </span>
            </td>
            <td class="px-4 py-3 tabular-nums">${escapeHtml(room.participantCount)} / 3</td>
            <td class="px-4 py-3 tabular-nums">${escapeHtml(room.viewerId)}</td>
            <td class="px-4 py-3 tabular-nums">${escapeHtml(room.roomSequence)}</td>
            <td class="px-4 py-3 text-on-surface-variant">${escapeHtml(formatServerTime(room.hostEntryTime))}</td>
        </tr>
    `).join("");
}

const routes = async (fastify: FastifyInstance) => {
    fastify.get("/", async (_, reply: FastifyReply) => {
        let html = readFileSync(path.join(__dirname, staticPagesDir, "rooms.html")).toString("utf-8");
        html = html.replace("{{roomsContent}}", renderRows());

        reply.header("content-type", "text/html; charset=utf-8");
        reply.send(html);
    });
};

export default routes;
