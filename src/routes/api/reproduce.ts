import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { generateDataHeaders } from "../../utils";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import path from "path";

interface PostBody {
    create_time: string,
    device_log_sequence_number: number,
    viewer_id: number | null,
    device_id: number,
    info: string,
    os_name: string,
    device_name: string
}

const routes = async (fastify: FastifyInstance) => {
    fastify.post("/post", (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as PostBody

        try {
            const logDir = path.join(__dirname, "..", "..", "..", ".logs", "reproduce")
            if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true })

            const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
            const viewerId = body.viewer_id === null ? "no-viewer" : body.viewer_id
            writeFileSync(
                path.join(logDir, `${timestamp}-${viewerId}.json`),
                JSON.stringify(body, null, 2),
                "utf8"
            )
        } catch (error) {
            console.log(`Failed to save reproduce log: ${error}`)
        }

        reply.header("content-type", "application/x-msgpack")
        reply.status(200).send({
            "data_headers": generateDataHeaders({
                viewer_id: body.viewer_id || undefined
            }),
            "data": []
        })
    })
}

export default routes;
