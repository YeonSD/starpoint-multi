import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { verifyAdminCredentials } from "../../lib/adminAuth";

function parseBasicAuth(header: string | undefined): { username: string, password: string } | null {
    if (!header?.startsWith("Basic ")) return null;

    const decoded = Buffer.from(header.slice("Basic ".length), "base64").toString("utf-8");
    const separator = decoded.indexOf(":");
    if (separator === -1) return null;

    return {
        username: decoded.slice(0, separator),
        password: decoded.slice(separator + 1)
    };
}

function reject(reply: FastifyReply) {
    reply
        .header("www-authenticate", 'Basic realm="Starpoint Admin"')
        .status(401)
        .send("Authentication required.");
}

export function registerAdminAuth(fastify: FastifyInstance) {
    fastify.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
        const credentials = parseBasicAuth(request.headers.authorization);
        if (
            credentials === null
            || !verifyAdminCredentials(credentials.username, credentials.password)
        ) {
            return reject(reply);
        }
    });
}
