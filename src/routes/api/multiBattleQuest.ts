import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getAccountPlayers, getPlayerCharacterSync, getPlayerSingleQuestProgressSync, getPlayerSync, getSession, insertPlayerQuestProgressSync, updatePlayerQuestProgressSync, updatePlayerSync } from "../../data/wdfpData";
import { generateDataHeaders, getServerTime } from "../../utils";
import { randomBytes, randomInt } from "crypto";
import { networkInterfaces } from "os";
import { givePlayerCharactersExpSync } from "../../lib/character";
import { getQuestFromCategorySync } from "../../lib/assets";
import { givePlayerRewardSync, givePlayerScoreRewardsSync } from "../../lib/quest";
import { serializeInfiniteStamina } from "../../lib/stamina";
import { BattleQuest } from "../../lib/types";

interface GetRoomsBody {
    event_id: number,
    viewer_id: number,
    category_id: number
}

interface CreateRoomBody {
    party_id: number,
    viewer_id: number,
    quest_id: number,
    category: number,
    api_count: number,
    retry_count?: number
}

interface RoomNumberBody {
    viewer_id: number,
    quest_id: number,
    category: number,
    room_number: string,
    api_count: number
}

interface SearchRoomBody {
    viewer_id: number,
    room_number: string,
    retry_count?: number
}

interface SelectRoomBody extends RoomNumberBody {
    party_id: number,
    accepted_type?: number
}

interface ShareRoomBody extends RoomNumberBody {
    share_type_list?: number[]
}

interface MultiInvitationJoinBody {
    viewer_id: number,
    k?: string,
    key?: string,
    attention_key?: string,
    room_number?: string
}

interface RestoreRoomBody {
    viewer_id: number,
    room_number: string,
    room_sequence: number,
    quest_id?: number,
    category?: number,
    category_id?: number,
    retry_count?: number
}

interface SummonBody {
    viewer_id: number,
    quest_id: number,
    category_id: number,
    room_number: string,
    api_count: number,
    retry_count?: number
}

interface StartBody {
    category: number,
    play_id?: string,
    mate_player_ids?: number[],
    use_boost_point: boolean,
    use_boss_boost_point: boolean,
    is_auto_start_mode: boolean,
    client_battle_party?: unknown,
    party_id: number,
    viewer_id: number,
    quest_id: number,
    room_number: string,
    api_count: number,
    retry_count?: number
}

interface MultiFinishBody {
    is_restored?: boolean,
    continue_count?: number,
    elapsed_time_ms?: number,
    quest_id: number,
    category: number,
    score?: number,
    viewer_id: number,
    add_mana?: number,
    is_accomplished?: boolean,
    play_id?: string,
    room_number?: string,
    room_sequence?: number,
    mate_player_result?: unknown[],
    statistics?: {
        is_host?: boolean,
        party?: {
            characters?: ({ id?: number | null } | null)[],
            unison_characters?: ({ id?: number | null } | null)[]
        }
    },
    api_count: number,
    retry_count?: number,
    reproduce_log_data?: unknown
}

interface AbortBody {
    viewer_id: number,
    quest_id: number,
    category: number,
    play_id?: string,
    finish_kind?: number,
    api_count: number,
    retry_count?: number,
    reproduce_log_data?: unknown
}

interface DebugRoomQuery {
    viewer_id?: string
}

interface RealtimeRoomEventBody {
    event?: "leave" | "disband" | "empty",
    room_number?: string,
    viewer_id?: number
}

interface MultiRoom {
    roomNumber: string,
    viewerId: number,
    playerId: number,
    questId: number,
    categoryId: number,
    partyId: number,
    roomSequence: number,
    hostEntryTime: number,
    invitationKey: string,
    status: "waiting" | "playing",
    participants: Map<number, number>,
    sharedAt?: number
}

const rooms: Map<string, MultiRoom> = new Map()
const roomsBySequence: Map<number, MultiRoom> = new Map()
const roomsByViewer: Map<number, MultiRoom> = new Map()
const internalToken = process.env.STARPOINT_INTERNAL_TOKEN ?? ""

function generateRoomNumber(): string {
    let roomNumber = randomInt(0, 1000000).toString().padStart(6, "0")
    while (rooms.has(roomNumber)) {
        roomNumber = randomInt(0, 1000000).toString().padStart(6, "0")
    }
    return roomNumber
}

function rememberRoom(room: MultiRoom): MultiRoom {
    if (!room.roomNumber) {
        throw new Error("Cannot register a multiplayer room without a room number.")
    }
    rooms.set(room.roomNumber, room)
    roomsBySequence.set(room.roomSequence, room)
    roomsByViewer.set(room.viewerId, room)
    return room
}

function forgetRoom(room: MultiRoom): void {
    rooms.delete(room.roomNumber)
    roomsBySequence.delete(room.roomSequence)
    for (const [viewerId, mappedRoom] of roomsByViewer.entries()) {
        if (mappedRoom.roomNumber === room.roomNumber) {
            roomsByViewer.delete(viewerId)
        }
    }
}

function addRoomParticipant(room: MultiRoom, viewerId: number, playerId: number): void {
    room.participants.set(viewerId, playerId)
    roomsByViewer.set(viewerId, room)
}

function removeRoomParticipant(room: MultiRoom, viewerId: number): void {
    room.participants.delete(viewerId)
    if (roomsByViewer.get(viewerId)?.roomNumber === room.roomNumber) {
        roomsByViewer.delete(viewerId)
    }

    if (room.participants.size === 0) {
        forgetRoom(room)
        return
    }

    if (room.viewerId === viewerId) {
        const [nextViewerId, nextPlayerId] = room.participants.entries().next().value as [number, number]
        room.viewerId = nextViewerId
        room.playerId = nextPlayerId
    }
}

function resetRoomForNextRecruitment(room: MultiRoom): void {
    room.status = "waiting"
    room.sharedAt = undefined
    room.participants.clear()
    room.participants.set(room.viewerId, room.playerId)
    for (const [viewerId, mappedRoom] of roomsByViewer.entries()) {
        if (mappedRoom.roomNumber === room.roomNumber && viewerId !== room.viewerId) {
            roomsByViewer.delete(viewerId)
        }
    }
    roomsByViewer.set(room.viewerId, room)
}

function markRoomWaitingAfterBattle(room: MultiRoom): void {
    room.status = "waiting"
    for (const viewerId of room.participants.keys()) {
        roomsByViewer.set(viewerId, room)
    }
}

function findRoomForRealtimeEvent(body: RealtimeRoomEventBody): MultiRoom | undefined {
    if (body.room_number) return rooms.get(body.room_number)
    if (body.viewer_id !== undefined) return roomsByViewer.get(body.viewer_id)
    return undefined
}

function findRoomForBody(body: { viewer_id: number, room_number?: string, room_sequence?: number }): MultiRoom | undefined {
    if (body.room_number) return rooms.get(body.room_number)
    if (body.room_sequence !== undefined) return roomsBySequence.get(body.room_sequence)
    return roomsByViewer.get(body.viewer_id)
}

function getMultiServerHost(request: FastifyRequest): string {
    const fallbackAddress = Object.values(networkInterfaces())
        .flatMap((interfaces) => interfaces ?? [])
        .find((networkInterface) => networkInterface.family === "IPv4" && !networkInterface.internal)?.address

    return process.env.STARPOINT_MULTI_HOST
        ?? process.env.MULTI_SERVER_HOST
        ?? fallbackAddress
        ?? request.hostname
        ?? "127.0.0.1"
}

function getMultiServerPort(): number {
    const envPort = process.env.STARPOINT_MULTI_PORT ?? process.env.MULTI_SERVER_PORT
    const port = envPort === undefined ? 18888 : Number.parseInt(envPort)
    return Number.isNaN(port) ? 18888 : port
}

function buildInvitationUrl(request: FastifyRequest, room: MultiRoom): string {
    const scheme = process.env.STARPOINT_PUBLIC_SCHEME ?? "http"
    const host = process.env.STARPOINT_PUBLIC_HOST ?? request.headers.host ?? "localhost:8000"
    return `${scheme}://${host}/latest/api/index.php/multi_invitation/join?k=${room.invitationKey}`
}

function serializeDebugRoom(request: FastifyRequest, room: MultiRoom) {
    const questData = getQuestFromCategorySync(room.categoryId, room.questId) as BattleQuest | null
    return {
        "room_number": room.roomNumber,
        "viewer_id": room.viewerId,
        "player_id": room.playerId,
        "quest_id": room.questId,
        "quest_name": questData?.name ?? "",
        "category_id": room.categoryId,
        "party_id": room.partyId,
        "room_sequence": room.roomSequence,
        "host_entry_time": room.hostEntryTime,
        "status": room.status,
        "participant_count": room.participants.size,
        "participants": [...room.participants.keys()],
        "room_url": buildInvitationUrl(request, room),
        "multi_server": {
            "ip_address": getMultiServerHost(request),
            "port": getMultiServerPort()
        }
    }
}

export function getMultiRoomAdminList() {
    return [...rooms.values()].map((room) => {
        const questData = getQuestFromCategorySync(room.categoryId, room.questId) as BattleQuest | null
        return {
            roomNumber: room.roomNumber,
            viewerId: room.viewerId,
            playerId: room.playerId,
            questId: room.questId,
            questName: questData?.name ?? "",
            categoryId: room.categoryId,
            roomSequence: room.roomSequence,
            status: room.status,
            participantCount: room.participants.size,
            participants: [...room.participants.keys()],
            hostEntryTime: room.hostEntryTime
        }
    })
}

function getPlayerRank(player: { rankPoint: number } | null | undefined): number {
    if (player === null || player === undefined) return 1

    const rankPoint = Math.max(0, player.rankPoint)
    // Temporary approximation until the client/master rank threshold table is restored.
    // Current server observations: rank_point 3636 -> rank 32, 5344 -> rank 37.
    if (rankPoint >= 4500) return Math.max(1, Math.floor(Math.sqrt(rankPoint / 4)) + 1)
    return Math.max(1, Math.floor(Math.sqrt(rankPoint / 4)) + 2)
}

function serializeSelectedRoom(request: FastifyRequest, room: MultiRoom) {
    return {
        "room_number": room.roomNumber,
        "category_id": room.categoryId,
        "quest_id": room.questId,
        "ip_address": getMultiServerHost(request),
        "port": getMultiServerPort(),
        "application_update_url": "",
        "host_entry_time": room.hostEntryTime,
        "raising_state": 1,
        "is_pickup": false,
        "room_sequence": room.roomSequence
    }
}

function serializeRoomSearchResult(request: FastifyRequest, room: MultiRoom) {
    const establisherFollow = Number.parseInt(process.env.STARPOINT_MULTI_SEARCH_ESTABLISHER_FOLLOW ?? "0")
    const establisher = getPlayerSync(room.playerId)
    const leaderCharacterId = (establisher?.leaderCharacterId ?? 0) >= 100000
        ? establisher!.leaderCharacterId
        : 111003
    const leaderCharacter = getPlayerCharacterSync(room.playerId, leaderCharacterId)

    return {
        "room_number": room.roomNumber,
        "quest_id": room.questId,
        "establisher_follow": Number.isNaN(establisherFollow) ? 0 : establisherFollow,
        "category_id": room.categoryId,
        "ip_address": getMultiServerHost(request),
        "port": getMultiServerPort(),
        "application_update_url": "",
        "host_entry_time": room.hostEntryTime,
        "raising_state": 1,
        "is_pickup": false,
        "room_sequence": room.roomSequence,
        "establisher": room.viewerId,
        "establisher_name": establisher?.name ?? "",
        "establisher_rank": getPlayerRank(establisher),
        "establisher_character": leaderCharacterId,
        "establisher_character_evolution_img_level": leaderCharacter?.evolutionLevel ?? 0
    }
}

function getEstablisherCharacter(room: MultiRoom) {
    const establisher = getPlayerSync(room.playerId)
    const leaderCharacterId = (establisher?.leaderCharacterId ?? 0) >= 100000
        ? establisher!.leaderCharacterId
        : 111003
    const leaderCharacter = getPlayerCharacterSync(room.playerId, leaderCharacterId)

    return {
        player: establisher,
        characterId: leaderCharacterId,
        evolutionLevel: leaderCharacter?.evolutionLevel ?? 0
    }
}

export function getAttentionMultiRecruitments(viewerId: number) {
    return [...rooms.values()]
        .filter((room) =>
            room.sharedAt !== undefined
            && room.status === "waiting"
            && room.viewerId !== viewerId
            && !room.participants.has(viewerId)
            && room.participants.size < 3
        )
        .map((room) => {
            const establisher = getEstablisherCharacter(room)

            return {
                "attention_key": room.invitationKey,
                "quest_info": {
                    "category_id": room.categoryId,
                    "establisher_character": establisher.characterId,
                    "establisher_character_evolution_img_level": establisher.evolutionLevel,
                    "establisher_follow": 0,
                    "establisher_rank": getPlayerRank(establisher.player),
                    "host_entry_time": room.hostEntryTime,
                    "quest_id": room.questId,
                    "room_number": room.roomNumber
                }
            }
        })
}

function serializeSearchRoomData(request: FastifyRequest, room: MultiRoom | undefined) {
    if (process.env.STARPOINT_MULTI_SEARCH_RESPONSE_MODE === "force_not_found") {
        return {
            "room_exists": false
        }
    }
    if (room === undefined) {
        return {
            "room_exists": false
        }
    }

    const result = serializeRoomSearchResult(request, room)
    if (process.env.STARPOINT_MULTI_SEARCH_RESPONSE_MODE === "not_playable") {
        return [2]
    }
    if (process.env.STARPOINT_MULTI_SEARCH_RESPONSE_MODE === "plain_object") {
        return result
    }
    if (process.env.STARPOINT_MULTI_SEARCH_RESPONSE_MODE === "wrapped_params") {
        return [1, [result]]
    }
    if (process.env.STARPOINT_MULTI_SEARCH_RESPONSE_MODE === "legacy_enum") {
        return [1, result]
    }

    return {
        "room_exists": true,
        ...result
    }
}

function buildSummonMate(comId: number, rank: number, degreeId: number) {
    return {
        "com_id": comId,
        "rank": rank,
        "party": {
            "characters": [
                {
                    "id": 111003,
                    "mana_node_ids": [],
                    "evolution_level": 0,
                    "exp": 70,
                    "over_limit_step": 0
                },
                {
                    "id": 311005,
                    "mana_node_ids": [],
                    "evolution_level": 0,
                    "exp": 70,
                    "over_limit_step": 0
                },
                {
                    "id": 311009,
                    "mana_node_ids": [],
                    "evolution_level": 0,
                    "exp": 70,
                    "over_limit_step": 0
                }
            ],
            "unison_characters": [
                null,
                null,
                null
            ],
            "equipments": [
                {
                    "equipment_id": 4030003,
                    "level": 1,
                    "enhancement_level": 0
                },
                {
                    "equipment_id": 3070006,
                    "level": 1,
                    "enhancement_level": 0
                },
                {
                    "equipment_id": 4030009,
                    "level": 1,
                    "enhancement_level": 0
                }
            ],
            "ability_soul_ids": [
                null,
                null,
                null
            ]
        },
        "degree_id": degreeId
    }
}

function getFinishPartyCharacterIds(body: MultiFinishBody): number[] {
    const party = body.statistics?.party
    const characterIds = [
        ...(party?.characters ?? []),
        ...(party?.unison_characters ?? [])
    ]
        .map((character) => character?.id)
        .filter((characterId): characterId is number => characterId !== undefined && characterId !== null)

    return [...new Set(characterIds)]
}

function buildFinishCharacterExpData(playerId: number, characterIds: number[]) {
    const now = new Date().toISOString().replace("T", " ").slice(0, 19)
    const bondTokenStatusList: Record<string, { before: { mana_board_index: number, status: number }[], after: { mana_board_index: number, status: number }[] }> = {}
    const addExpList = characterIds.map((characterId) => {
        const character = getPlayerCharacterSync(playerId, characterId)
        const bondTokenStatus = (character?.bondTokenList ?? [
            { manaBoardIndex: 1, status: 0 },
            { manaBoardIndex: 2, status: 0 }
        ]).map((entry) => ({
            "mana_board_index": entry.manaBoardIndex,
            "status": entry.status
        }))
        bondTokenStatusList[characterId] = {
            "before": bondTokenStatus,
            "after": bondTokenStatus
        }

        return {
            "character_id": characterId,
            "add_exp": 0,
            "after_exp": character?.exp ?? 0,
            "add_exp_pool": 0
        }
    })
    const characterList = characterIds.map((characterId) => {
        const character = getPlayerCharacterSync(playerId, characterId)
        return {
            "character_id": characterId,
            "exp": character?.exp ?? 0,
            "create_time": now,
            "update_time": now,
            "join_time": now,
            "exp_total": character?.exp ?? 0
        }
    })

    return { addExpList, characterList, bondTokenStatusList }
}

async function requireViewerSession(viewerId: number, reply: FastifyReply): Promise<boolean> {
    if (!viewerId || isNaN(viewerId)) {
        reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid request body."
        })
        return false
    }

    const viewerIdSession = await getSession(viewerId.toString())
    if (!viewerIdSession) {
        reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid viewer id."
        })
        return false
    }

    return true
}

async function getPlayerIdForViewer(viewerId: number): Promise<number | undefined> {
    const viewerIdSession = await getSession(viewerId.toString())
    if (!viewerIdSession) return undefined

    return (await getAccountPlayers(viewerIdSession.accountId))[0]
}

export async function joinRoomByInvitation(request: FastifyRequest, body: MultiInvitationJoinBody) {
    const viewerId = body.viewer_id
    if (!viewerId || isNaN(viewerId)) return {
        statusCode: 400,
        payload: {
            "error": "Bad Request",
            "message": "Invalid request body."
        }
    }

    const playerId = await getPlayerIdForViewer(viewerId)
    if (playerId === undefined) return {
        statusCode: 400,
        payload: {
            "error": "Bad Request",
            "message": "Invalid viewer id."
        }
    }

    const key = body.attention_key ?? body.key ?? body.k
    const room = key !== undefined
        ? [...rooms.values()].find((candidate) => candidate.invitationKey === key)
        : body.room_number !== undefined
            ? rooms.get(body.room_number)
            : undefined

    if (room === undefined || room.status !== "waiting" || room.participants.size >= 3) {
        return {
            statusCode: 404,
            payload: {
                "error": "Not Found",
                "message": "Invitation room not found."
            }
        }
    }

    addRoomParticipant(room, viewerId, playerId)

    return {
        statusCode: 200,
        payload: {
            "data_headers": generateDataHeaders({
                viewer_id: viewerId
            }),
            "data": serializeSelectedRoom(request, room)
        }
    }
}

const routes = async (fastify: FastifyInstance) => {
    fastify.post("/internal_room_event", async (request: FastifyRequest, reply: FastifyReply) => {
        const token = request.headers["x-starpoint-internal-token"]
        if (internalToken === "" || token !== internalToken) {
            return reply.status(403).send({
                "error": "Forbidden",
                "message": "Invalid internal token."
            })
        }

        const body = request.body as RealtimeRoomEventBody
        const room = findRoomForRealtimeEvent(body)
        if (room === undefined) {
            return reply.status(200).send({
                "ok": true,
                "found": false
            })
        }

        if (body.event === "disband" || body.event === "empty") {
            forgetRoom(room)
        } else if (body.event === "leave" && body.viewer_id !== undefined) {
            removeRoomParticipant(room, body.viewer_id)
        } else {
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "Invalid room event."
            })
        }

        return reply.status(200).send({
            "ok": true,
            "found": true,
            "remaining": room.participants.size
        })
    })

    fastify.get("/debug_rooms", async (request: FastifyRequest, reply: FastifyReply) => {
        reply.header("content-type", "application/json; charset=utf-8")
        return reply.status(200).send({
            "rooms": [...rooms.values()].map((room) => serializeDebugRoom(request, room))
        })
    })

    fastify.get("/debug_room", async (request: FastifyRequest, reply: FastifyReply) => {
        const query = request.query as DebugRoomQuery
        const viewerId = query.viewer_id === undefined ? undefined : Number.parseInt(query.viewer_id)
        const room = viewerId === undefined || Number.isNaN(viewerId) ? undefined : roomsByViewer.get(viewerId)

        reply.header("content-type", "application/json; charset=utf-8")
        return reply.status(room ? 200 : 404).send(room
            ? serializeDebugRoom(request, room)
            : {
                "error": "Not Found",
                "message": "No active room for viewer_id."
            })
    })

    fastify.post("/get_rooms", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as GetRoomsBody

        const viewerId = body.viewer_id
        if (!await requireViewerSession(viewerId, reply)) return

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({
                viewer_id: viewerId
            }),
            "data": {
                "rooms": []
            }   
        })
    })

    fastify.post("/create_room", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as CreateRoomBody

        const viewerId = body.viewer_id
        if (!await requireViewerSession(viewerId, reply)) return
        const playerId = await getPlayerIdForViewer(viewerId)
        if (playerId === undefined) return reply.status(500).send({
            "error": "Internal Server Error",
            "message": "No players bound to account."
        })

        const existingRoom = roomsByViewer.get(viewerId)
        if (
            existingRoom !== undefined
            && existingRoom.viewerId === viewerId
            && existingRoom.questId === body.quest_id
            && existingRoom.categoryId === body.category
        ) {
            existingRoom.partyId = body.party_id
            resetRoomForNextRecruitment(existingRoom)

            reply.header("content-type", "application/x-msgpack")
            return reply.status(200).send({
                "data_headers": generateDataHeaders({
                    viewer_id: viewerId
                }),
                "data": {
                    "room_number": existingRoom.roomNumber,
                    "room_url": buildInvitationUrl(request, existingRoom)
                }
            })
        }

        const roomNumber = generateRoomNumber()
        const room: MultiRoom = {
            roomNumber,
            viewerId,
            playerId,
            questId: body.quest_id,
            categoryId: body.category,
            partyId: body.party_id,
            roomSequence: randomInt(10000000, 99999999),
            hostEntryTime: getServerTime(),
            invitationKey: randomBytes(32).toString("base64url"),
            status: "waiting",
            participants: new Map([[viewerId, playerId]])
        }
        rememberRoom(room)

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({
                viewer_id: viewerId
            }),
            "data": {
                "room_number": room.roomNumber,
                "room_url": buildInvitationUrl(request, room)
            }
        })
    })

    fastify.post("/prepare", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as RoomNumberBody

        const viewerId = body.viewer_id
        if (!await requireViewerSession(viewerId, reply)) return

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({
                viewer_id: viewerId
            }),
            "data": []
        })
    })

    fastify.post("/search_room", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as SearchRoomBody

        const viewerId = body.viewer_id
        if (!await requireViewerSession(viewerId, reply)) return

        const room = rooms.get(body.room_number)

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({
                viewer_id: viewerId
            }),
            "data": serializeSearchRoomData(request, room)
        })
    })

    fastify.post("/select_room", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as SelectRoomBody

        const viewerId = body.viewer_id
        if (!await requireViewerSession(viewerId, reply)) return
        const playerId = await getPlayerIdForViewer(viewerId)
        if (playerId === undefined) return reply.status(500).send({
            "error": "Internal Server Error",
            "message": "No players bound to account."
        })

        const existingRoom = body.room_number
            ? rooms.get(body.room_number)
            : roomsByViewer.get(viewerId)
        if (body.room_number === "" && existingRoom === undefined) {
            return reply.status(404).send({
                "error": "Not Found",
                "message": "No active room for viewer."
            })
        }

        const room = existingRoom ?? {
            roomNumber: body.room_number,
            viewerId,
            playerId,
            questId: body.quest_id,
            categoryId: body.category,
            partyId: body.party_id,
            roomSequence: randomInt(10000000, 99999999),
            hostEntryTime: getServerTime(),
            invitationKey: randomBytes(32).toString("base64url"),
            status: "waiting",
            participants: new Map()
        }

        rememberRoom(room)
        addRoomParticipant(room, viewerId, playerId)

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({
                viewer_id: viewerId
            }),
            "data": {
                ...serializeSelectedRoom(request, room)
            }
        })
    })

    fastify.post("/share_room", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as ShareRoomBody

        const viewerId = body.viewer_id
        if (!await requireViewerSession(viewerId, reply)) return

        const room = findRoomForBody(body)
        const roomNumber = room?.roomNumber ?? body.room_number
        const roomUrl = room ? buildInvitationUrl(request, room) : ""
        if (room !== undefined) {
            room.sharedAt = getServerTime()
        }

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({
                viewer_id: viewerId
            }),
            "data": {
                // Experimental: the real response only includes config, but the KR client currently
                // keeps the host room number blank unless another path refreshes it.
                "room_number": roomNumber,
                "room_url": roomUrl,
                "room_sequence": room?.roomSequence,
                "config": {
                    "attention_recruitment_interval_seconds": 15,
                    "attention_recruitment_redeliver_limit": 20,
                    "attention_polling_interval_seconds_normal": 10,
                    "attention_polling_interval_seconds_battle": 15,
                    "multi_attention_lifetime_seconds": 30,
                    "contribution_score_rate_to_parasite": 0.25,
                    "attention_log_interval_seconds": 600,
                    "disable_finish_duration_seconds": 5,
                    "disable_decline_count_seconds": 60,
                    "disable_decline_count_limit": 14,
                    "disable_decline_duration_seconds": 30,
                    "disable_intent_disconnect_duration_seconds": 300,
                    "disable_unintent_disconnect_duration_seconds": 5,
                    "disable_remote_error_duration_seconds": 300,
                    "attention_animation_time_seconds": 6,
                    "disable_expire_count_limit": 4,
                    "disable_expire_duration_seconds": 180,
                    "polling_delay_normal_seconds_range_min": 1,
                    "polling_delay_normal_seconds_range_max": 10,
                    "polling_delay_battle_seconds_range_min": 1,
                    "polling_delay_battle_seconds_range_max": 15,
                    "return_attention_max_num": 3
                }
            }
        })
    })

    fastify.post("/restore_room", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as RestoreRoomBody

        const viewerId = body.viewer_id
        if (!await requireViewerSession(viewerId, reply)) return

        const room = findRoomForBody(body)
        const playerId = await getPlayerIdForViewer(viewerId)
        if (room !== undefined && playerId !== undefined && !isNaN(playerId)) {
            addRoomParticipant(room, viewerId, playerId)
        }

        const questId = body.quest_id ?? room?.questId ?? 1001001
        const categoryId = body.category_id ?? body.category ?? room?.categoryId ?? 2
        const roomSequence = body.room_sequence ?? room?.roomSequence ?? randomInt(10000000, 99999999)
        const roomNumber = room?.roomNumber ?? body.room_number

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({
                viewer_id: viewerId
            }),
            "data": {
                "room_number": roomNumber,
                "category_id": categoryId,
                "quest_id": questId,
                "ip_address": getMultiServerHost(request),
                "port": getMultiServerPort(),
                "application_update_url": "",
                "host_entry_time": room?.hostEntryTime ?? getServerTime(),
                "raising_state": 1,
                "is_pickup": false,
                "room_sequence": roomSequence
            }
        })
    })

    fastify.post("/disband_room", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as RoomNumberBody

        const viewerId = body.viewer_id
        if (!await requireViewerSession(viewerId, reply)) return

        const room = findRoomForBody(body)
        if (room) forgetRoom(room)

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({
                viewer_id: viewerId
            }),
            "data": []
        })
    })

    fastify.post("/summon", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as SummonBody

        const viewerId = body.viewer_id
        if (!await requireViewerSession(viewerId, reply)) return

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({
                viewer_id: viewerId
            }),
            "data": {
                "mate1": buildSummonMate(randomInt(10000000, 99999999), 4, 1),
                "mate2": buildSummonMate(randomInt(10000000, 99999999), 4, 1)
            }
        })
    })

    fastify.post("/start", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as StartBody

        const viewerId = body.viewer_id
        const partyId = body.party_id
        const questId = body.quest_id
        const category = body.category
        if (
            isNaN(viewerId)
            || isNaN(partyId)
            || isNaN(questId)
            || isNaN(category)
            || body.use_boost_point === undefined
            || body.use_boss_boost_point === undefined
            || body.is_auto_start_mode === undefined
        ) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid request body."
        })

        if (!await requireViewerSession(viewerId, reply)) return

        const room = findRoomForBody(body)
        if (room === undefined) return reply.status(404).send({
            "error": "Not Found",
            "message": "Room not found."
        })
        room.status = "playing"

        const dataHeaders = generateDataHeaders({
            viewer_id: viewerId
        })

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": dataHeaders,
            "data": {
                "user_info": {
                    "last_main_quest_id": questId
                },
                "category_id": category,
                "is_multi": "multi",
                "room_number": room.roomNumber,
                "room_sequence": room.roomSequence,
                "play_id": body.play_id ?? "",
                "start_time": dataHeaders["servertime"],
                "quest_name": ""
            }
        })
    })

    fastify.post("/finish", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as MultiFinishBody

        const viewerId = body.viewer_id
        const questId = body.quest_id
        const category = body.category
        if (isNaN(viewerId) || isNaN(questId) || isNaN(category)) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid request body."
        })

        if (!await requireViewerSession(viewerId, reply)) return

        const playerId = await getPlayerIdForViewer(viewerId)
        if (playerId === undefined || isNaN(playerId)) return reply.status(500).send({
            "error": "Internal Server Error",
            "message": "No player bound to account."
        })

        const playerData = getPlayerSync(playerId)
        if (playerData === null) return reply.status(500).send({
            "error": "Internal Server Error",
            "message": "No player bound to account."
        })

        const room = findRoomForBody(body)
        if (room !== undefined) {
            if (body.is_accomplished === false) {
                removeRoomParticipant(room, viewerId)
            } else {
                markRoomWaitingAfterBattle(room)
            }
        }

        const dataHeaders = generateDataHeaders({
            viewer_id: viewerId
        })
        const addMana = body.add_mana ?? 0
        const questData = getQuestFromCategorySync(category, questId) as BattleQuest | null
        if (questData === null || !("rankPointReward" in questData)) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Quest doesn't exist."
        })

        const clearTime = body.elapsed_time_ms ?? Number.MAX_SAFE_INTEGER
        const clearRank = questData.sPlusRankTime >= clearTime ? 5
            : questData.sRankTime >= clearTime ? 4
                : questData.aRankTime >= clearTime ? 3
                    : questData.bRankTime >= clearTime ? 2
                        : 1
        const questProgress = getPlayerSingleQuestProgressSync(playerId, category, questId)
        const questProgressExists = questProgress !== null
        const questPreviouslyCompleted = questProgress?.finished === true
        const beforeRankPoint = playerData.rankPoint
        const newRankPoint = beforeRankPoint + questData.rankPointReward
        const newMana = playerData.freeMana + questData.manaReward + addMana
        const questAccomplished = body.is_accomplished !== false

        if (questAccomplished) {
            if (questProgressExists) {
                updatePlayerQuestProgressSync(playerId, category, {
                    questId,
                    finished: true,
                    bestElapsedTimeMs: questProgress.bestElapsedTimeMs === undefined || questProgress.bestElapsedTimeMs === null
                        ? clearTime
                        : Math.min(clearTime, questProgress.bestElapsedTimeMs),
                    clearRank: questProgress.clearRank === undefined ? clearRank : Math.max(clearRank, questProgress.clearRank),
                    highScore: questProgress.highScore === undefined ? body.score : Math.max(body.score ?? 0, questProgress.highScore)
                })
            } else {
                insertPlayerQuestProgressSync(playerId, category, {
                    questId,
                    finished: true,
                    bestElapsedTimeMs: clearTime,
                    clearRank,
                    highScore: body.score
                })
            }
        }

        const expPooledTime = new Date()

        updatePlayerSync({
            id: playerId,
            freeMana: newMana,
            expPool: playerData.expPool + questData.poolExpReward,
            expPooledTime,
            rankPoint: newRankPoint
        })

        const clearReward = questAccomplished && !questPreviouslyCompleted && questData.clearReward !== undefined
            ? givePlayerRewardSync(playerId, questData.clearReward)
            : null
        const sPlusClearReward = questAccomplished && clearRank === 5 && questProgress?.clearRank !== 5 && questData.sPlusReward !== undefined
            ? givePlayerRewardSync(playerId, questData.sPlusReward)
            : null

        const finishCharacterIds = getFinishPartyCharacterIds(body)
        const expReward = givePlayerCharactersExpSync(playerId, finishCharacterIds, questData.characterExpReward, false)
        const fallbackExpData = buildFinishCharacterExpData(playerId, finishCharacterIds)
        const addExpList = expReward.add_exp_list.length > 0 ? expReward.add_exp_list : fallbackExpData.addExpList
        const scoreRewardsResult = givePlayerScoreRewardsSync(playerId, questData.scoreRewardGroupId, questData.scoreRewardGroup, false)
        const characterList = [
            ...(expReward.character_list.length > 0 ? expReward.character_list : fallbackExpData.characterList),
            ...(clearReward?.character_list ?? []),
            ...(sPlusClearReward?.character_list ?? []),
            ...scoreRewardsResult.character_list
        ]
        const bondTokenStatusList = Object.keys(expReward.bond_token_status_list).length > 0
            ? expReward.bond_token_status_list
            : fallbackExpData.bondTokenStatusList
        const finalPlayerData = getPlayerSync(playerId) ?? playerData

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": dataHeaders,
            "data": {
                "user_info": {
                    "free_mana": finalPlayerData.freeMana,
                    "exp_pool": finalPlayerData.expPool,
                    "exp_pooled_time": getServerTime(expPooledTime),
                    "free_vmoney": finalPlayerData.freeVmoney,
                    "rank_point": newRankPoint,
                    "max_stamina": finalPlayerData.stamina,
                    ...serializeInfiniteStamina(finalPlayerData),
                    "boost_point": finalPlayerData.boostPoint,
                    "boss_boost_point": finalPlayerData.bossBoostPoint
                },
                "add_exp_list": addExpList,
                "character_list": characterList,
                "bond_token_status_list": bondTokenStatusList,
                "rewards": {
                    "overflow_pool_exp": 0,
                    "converted_pool_exp": 0,
                    "reward_pool_exp": questData.poolExpReward,
                    "reward_mana": questData.manaReward,
                    "field_mana": addMana
                },
                "old_high_score": questProgress === null ? 0 : questProgress.highScore || 0,
                "joined_character_id_list": [
                    ...(clearReward?.joined_character_id_list ?? []),
                    ...(sPlusClearReward?.joined_character_id_list ?? []),
                    ...scoreRewardsResult.joined_character_id_list
                ],
                "before_rank_point": beforeRankPoint,
                "clear_rank": clearRank,
                "drop_score_reward_ids": scoreRewardsResult.drop_score_reward_ids,
                "drop_rare_reward_ids": scoreRewardsResult.drop_rare_reward_ids,
                "drop_additional_reward_ids": [],
                "drop_periodic_reward_ids": [],
                "equipment_list": [
                    ...(clearReward?.equipment_list ?? []),
                    ...(sPlusClearReward?.equipment_list ?? []),
                    ...scoreRewardsResult.equipment_list
                ],
                "follow_info": [],
                "category_id": category,
                "start_time": dataHeaders["servertime"],
                "is_multi": "multi",
                "quest_name": questData.name ?? "",
                "item_list": {
                    ...(clearReward?.items ?? {}),
                    ...(sPlusClearReward?.items ?? {}),
                    ...scoreRewardsResult.items
                },
                "mission_info": [],
                "mail_arrived": false,
                "rush_event": null,
                "mate_player_result": body.mate_player_result ?? []
            }
        })
    })

    fastify.post("/abort", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as AbortBody

        const viewerId = body.viewer_id
        if (!await requireViewerSession(viewerId, reply)) return
        const category = body.category
        const questId = body.quest_id

        const playerId = await getPlayerIdForViewer(viewerId)
        const playerData = playerId === undefined || isNaN(playerId) ? null : getPlayerSync(playerId)
        const questData = !isNaN(category) && !isNaN(questId)
            ? getQuestFromCategorySync(category, questId) as BattleQuest | null
            : null
        const room = findRoomForBody(body)
        if (room !== undefined) removeRoomParticipant(room, viewerId)

        const dataHeaders = generateDataHeaders({
            viewer_id: viewerId
        })

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": dataHeaders,
            "data": {
                "user_info": {
                    ...serializeInfiniteStamina(playerData)
                },
                "category_id": category,
                "is_multi": "multi",
                "start_time": dataHeaders["servertime"],
                "quest_name": questData?.name ?? "",
                "mail_arrived": false
            }
        })
    })
}

export default routes;
