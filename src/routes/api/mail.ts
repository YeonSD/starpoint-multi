// Handles mail.

import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getAccountPlayers, getSession } from "../../data/wdfpData";
import { listPlayerMailPage, receivePlayerMail, receivePlayerMails } from "../../lib/mail";
import { generateDataHeaders } from "../../utils";

interface IndexBody {
    api_count: number,
    viewer_id: number,
    app_secret: string,
    current_page: number,
    app_admin: string
}

interface ReceiveBody {
    api_count: number,
    viewer_id: number,
    app_secret: string,
    app_admin: string,
    mail_id: number
}

interface ReceiveAllBody {
    api_count: number,
    viewer_id: number,
    app_secret: string,
    app_admin: string,
    mail_ids: number[]
}

async function getPlayerIdForViewer(viewerId: number): Promise<number | null> {
    const viewerIdSession = await getSession(viewerId.toString())
    if (!viewerIdSession) return null

    const playerIds = await getAccountPlayers(viewerIdSession.accountId)
    return playerIds[0] ?? null
}

const routes = async (fastify: FastifyInstance) => {
    fastify.post("/index", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as IndexBody

        const viewerId = body.viewer_id
        if (!viewerId || isNaN(viewerId)) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid request body."
        })

        const playerId = await getPlayerIdForViewer(viewerId)
        if (playerId === null) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid viewer id."
        })

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({
                viewer_id: viewerId
            }),
            "data": listPlayerMailPage(playerId, body.current_page)
        })
    })

    fastify.post("/receive", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as ReceiveBody
        const viewerId = body.viewer_id
        const mailId = Number(body.mail_id)
        if (!viewerId || isNaN(viewerId) || !Number.isInteger(mailId)) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid request body."
        })

        const playerId = await getPlayerIdForViewer(viewerId)
        if (playerId === null) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid viewer id."
        })

        const data = receivePlayerMail(playerId, mailId)
        if (data === null) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid mail id."
        })

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({
                viewer_id: viewerId
            }),
            "data": data
        })
    })

    fastify.post("/receive_all", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as ReceiveAllBody
        const viewerId = body.viewer_id
        if (!viewerId || isNaN(viewerId) || !Array.isArray(body.mail_ids)) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid request body."
        })

        const playerId = await getPlayerIdForViewer(viewerId)
        if (playerId === null) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid viewer id."
        })

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({
                viewer_id: viewerId
            }),
            "data": receivePlayerMails(playerId, body.mail_ids.map((id) => Number(id)).filter(Number.isInteger))
        })
    })
}

export default routes;
