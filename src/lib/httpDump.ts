import fs from "fs";
import path from "path";
import { FastifyReply, FastifyRequest } from "fastify";

const maxSerializedLength = 1024 * 1024;

function sanitizePath(value: string): string {
    return value
        .replace(/^https?:\/\//, "")
        .replace(/[^a-zA-Z0-9._-]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 140) || "root";
}

function safeJson(value: unknown): unknown {
    if (value === undefined) return undefined;
    if (Buffer.isBuffer(value)) {
        return {
            type: "Buffer",
            length: value.length,
            base64: value.length > maxSerializedLength ? undefined : value.toString("base64")
        };
    }
    if (typeof value === "string") {
        return value.length > maxSerializedLength
            ? { type: "string", length: value.length, preview: value.slice(0, 4096) }
            : value;
    }

    try {
        const serialized = JSON.stringify(value);
        if (serialized.length <= maxSerializedLength) return value;
        return {
            type: typeof value,
            length: serialized.length,
            preview: serialized.slice(0, 4096)
        };
    } catch (error) {
        return {
            type: typeof value,
            error: error instanceof Error ? error.message : String(error)
        };
    }
}

export function shouldDumpHttpFlow(request: FastifyRequest, reply: FastifyReply): boolean {
    const url = request.url;
    if (url.includes("/multi_battle_quest/")) return true;
    if (reply.statusCode >= 400) return true;
    return false;
}

export function dumpHttpFlow(request: FastifyRequest, reply: FastifyReply, payload: unknown): void {
    if (process.env.STARPOINT_HTTP_DUMP === "0") return;
    if (!shouldDumpHttpFlow(request, reply)) return;

    const timestamp = new Date().toISOString();
    const logDir = path.join(process.cwd(), ".logs", "http");
    fs.mkdirSync(logDir, { recursive: true });

    const fileTimestamp = timestamp.replace(/[:.]/g, "-");
    const filename = `${fileTimestamp}-${reply.statusCode}-${request.method}-${sanitizePath(request.url)}.json`;
    const filePath = path.join(logDir, filename);

    const entry = {
        timestamp,
        request: {
            method: request.method,
            url: request.url,
            route: request.routeOptions.url,
            host: request.headers.host,
            contentType: request.headers["content-type"],
            headers: request.headers,
            body: safeJson(request.body)
        },
        response: {
            statusCode: reply.statusCode,
            contentType: reply.getHeader("content-type"),
            payload: safeJson(payload)
        }
    };

    fs.writeFileSync(filePath, JSON.stringify(entry, null, 2));
}
