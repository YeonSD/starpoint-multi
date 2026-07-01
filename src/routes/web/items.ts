import { FastifyInstance, FastifyReply } from "fastify";
import { readFileSync } from "fs";
import path from "path";
import { staticPagesDir } from ".";
import { getAllPlayersSync } from "../../data/wdfpData";
import { getItemCatalog } from "../../lib/itemCatalog";

function escapeHtml(value: string | number): string {
    return value.toString()
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

const routes = async (fastify: FastifyInstance) => {
    fastify.get("/", async (_, reply: FastifyReply) => {
        let html = readFileSync(path.join(__dirname, staticPagesDir, "items.html")).toString("utf-8");
        const players = getAllPlayersSync();
        const itemCatalog = getItemCatalog();

        html = html
            .replace("{{playerOptions}}", players.map((player) => `
                <label class="flex items-center gap-3 px-4 py-3 border border-outline-variant rounded-2xl bg-surface">
                    <input type="checkbox" name="player_ids" value="${player.id}" class="w-5 h-5">
                    <span class="font-semibold">${escapeHtml(player.name)}</span>
                    <span class="text-on-surface-variant">#${player.id}</span>
                </label>
            `).join("") || `<p class="text-on-surface-variant">No players found.</p>`)
            .replace("{{itemOptions}}", itemCatalog.map((item) => `
                <option value="${item.id}">${escapeHtml(item.label)}</option>
            `).join(""));

        reply.header("content-type", "text/html; charset=utf-8");
        reply.send(html);
    });
};

export default routes;
