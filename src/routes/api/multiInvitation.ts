import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { joinRoomByInvitation } from "./multiBattleQuest";

interface JoinBody {
    viewer_id: number,
    k?: string,
    key?: string,
    attention_key?: string,
    room_number?: string
}

interface JoinQuery {
    k?: string,
    key?: string,
    attention_key?: string,
    viewer_id?: string
}

const routes = async (fastify: FastifyInstance) => {
    fastify.post("/join", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as JoinBody
        const result = await joinRoomByInvitation(request, body)

        if (result.statusCode === 200) {
            reply.header("content-type", "application/x-msgpack")
        }
        return reply.status(result.statusCode).send(result.payload)
    })

    fastify.get("/join", async (request: FastifyRequest, reply: FastifyReply) => {
        const query = request.query as JoinQuery
        const viewerId = query.viewer_id === undefined ? NaN : Number.parseInt(query.viewer_id)
        const result = await joinRoomByInvitation(request, {
            viewer_id: viewerId,
            k: query.k,
            key: query.key,
            attention_key: query.attention_key
        })

        if (result.statusCode === 200) {
            reply.header("content-type", "application/x-msgpack")
        }
        return reply.status(result.statusCode).send(result.payload)
    })
}

export default routes;
