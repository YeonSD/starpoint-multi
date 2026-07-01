import { FastifyInstance } from "fastify";
import playerApiPlugin from "./player"
import serverApiPlugin from "./server"
import wireGuardApiPlugin from "./wireguard"
import { registerAdminAuth } from "../web/auth"

const routes = async (fastify: FastifyInstance) => {
    registerAdminAuth(fastify)

    fastify.register(require('@fastify/multipart'), {
        limits: {
            fieldNameSize: 100, // Max field name size in bytes
            fieldSize: 100,     // Max field value size in bytes
            fields: 10,         // Max number of non-file fields
            fileSize: 5000000,  // For multipart forms, the max file size in bytes
            files: 1,           // Max number of file fields
            headerPairs: 2000,  // Max number of header key=>value pairs
            parts: 1000         // For multipart forms, the max number of parts (fields + files)
        }
    })

    fastify.register(playerApiPlugin, { prefix: "/player" })
    fastify.register(serverApiPlugin, { prefix: "/server" })
    fastify.register(wireGuardApiPlugin, { prefix: "/wireguard" })
}

export default routes;
