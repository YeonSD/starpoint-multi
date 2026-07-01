import { FastifyInstance, FastifyReply } from "fastify";
import { readFileSync } from "fs";
import path from "path";
import { staticPagesDir } from ".";

const routes = async (fastify: FastifyInstance) => {
    fastify.get("/", async (_, reply: FastifyReply) => {
        const html = readFileSync(path.join(__dirname, staticPagesDir, "source.html")).toString("utf-8");
        reply.header("content-type", "text/html; charset=utf-8");
        reply.send(html);
    });
};

export default routes;
