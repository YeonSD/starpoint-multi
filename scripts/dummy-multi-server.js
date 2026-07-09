const fs = require("fs");
const net = require("net");
const dgram = require("dgram");
const path = require("path");

const host = process.env.STARPOINT_DUMMY_MULTI_HOST || "0.0.0.0";
const port = Number.parseInt(process.env.STARPOINT_MULTI_PORT || process.env.MULTI_SERVER_PORT || "18888", 10);
const responseMode = process.env.STARPOINT_DUMMY_MULTI_RESPONSE_MODE || "basic";
const acceptRoomNumber = process.env.STARPOINT_DUMMY_MULTI_ACCEPT_ROOM_NUMBER !== "0";
const pushHeartbeatMs = Number.parseInt(process.env.STARPOINT_DUMMY_MULTI_PUSH_HEARTBEAT_MS || "0", 10);
const debugBattleFinalizedAfterSceneReady = process.env.STARPOINT_DUMMY_MULTI_DEBUG_FINALIZED === "1";
const debugBattleConnectedAfterSceneReady = process.env.STARPOINT_DUMMY_MULTI_DEBUG_CONNECTED === "1";
const wrapBattleSocketInputInSectionCommand = process.env.STARPOINT_DUMMY_MULTI_WRAP_BATTLE_SOCKET === "1";
const skipEarlyBattleStart = process.env.STARPOINT_DUMMY_MULTI_SKIP_EARLY_BATTLE_START !== "0";
const sendEarlyBattleConnected = process.env.STARPOINT_DUMMY_MULTI_EARLY_CONNECTED === "1";
const starpointHttpBase = process.env.STARPOINT_HTTP_BASE || "http://127.0.0.1:8000";
const internalToken = process.env.STARPOINT_INTERNAL_TOKEN || "";
const logDir = path.join(process.cwd(), ".logs", "multi-realtime");
fs.mkdirSync(logDir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const logPath = path.join(logDir, `dummy-${stamp}.log`);
const roomsByViewer = new Map();
const roomsByNumber = new Map();
const roomSessionsByNumber = new Map();

function log(line) {
    const text = `${new Date().toISOString()} ${line}`;
    console.log(text);
    fs.appendFileSync(logPath, `${text}\n`);
}

function hex(data) {
    return data.toString("hex").replace(/(.{2})/g, "$1 ").trim();
}

function sendJson(socket, peer, value) {
    const payload = `${JSON.stringify(value)}\0`;
    socket.write(payload);
    log(`[tcp] send ${peer} len=${Buffer.byteLength(payload)} json=${JSON.stringify(value)}`);
}

function getMateKey(mate) {
    return String(mate?.connectionId || mate?.viewerId || mate?.comId || "");
}

function getSessionMateList(session) {
    return [...session.mates.values()];
}

function sendToSession(session, value) {
    for (const client of session.sockets) {
        if (client.socket.destroyed) continue;
        sendJson(client.socket, client.peer, value);
    }
}

function sendToBattleSession(session, value) {
    for (const client of session.battleSockets) {
        if (client.socket.destroyed) continue;
        sendJson(client.socket, client.peer, value);
    }
}

function sendToOtherBattleClients(session, sender, value) {
    let sent = 0;
    for (const client of session.battleSockets) {
        if (client === sender || client.socket.destroyed) continue;
        sendJson(client.socket, client.peer, value);
        sent++;
    }
    return sent;
}

function getClientConnectionId(client) {
    return client.connectionId || client.roomState?.connectionId || "";
}

function getViewerIdFromRoomState(roomState) {
    const direct = Number.parseInt(String(roomState?.viewerId || ""), 10);
    if (Number.isFinite(direct) && direct > 0) return direct;

    const connectionId = String(roomState?.connectionId || "");
    const viewerPart = connectionId.split(":")[1] || "";
    const parsed = Number.parseInt(viewerPart, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function notifyHttpRoomEvent(event, session, viewerId) {
    if (!internalToken) {
        log(`[http] internal_event_skipped_no_token event=${event} room=${session?.roomNumber || ""} viewer=${viewerId || ""}`);
        return;
    }

    const body = {
        event,
        room_number: session?.roomNumber || "",
        viewer_id: viewerId
    };

    fetch(`${starpointHttpBase}/latest/api/index.php/multi_battle_quest/internal_room_event`, {
        method: "POST",
        headers: {
            "content-type": "application/json",
            "x-starpoint-internal-token": internalToken
        },
        body: JSON.stringify(body)
    }).then(async (response) => {
        const text = await response.text().catch(() => "");
        log(`[http] internal_event event=${event} room=${body.room_number} viewer=${viewerId || ""} status=${response.status} body=${text.slice(0, 200)}`);
    }).catch((error) => {
        log(`[http] internal_event_error event=${event} room=${body.room_number} viewer=${viewerId || ""} error=${error.message}`);
    });
}

function broadcastMates(session) {
    sendToSession(session, mates(getSessionMateList(session)));
}

function isRoomFull(session) {
    return session.mates.size >= 3;
}

function isReadyStateReady(state) {
    return Array.isArray(state) && state[0] === 1;
}

function sameReadyState(left, right) {
    return Array.isArray(left)
        && Array.isArray(right)
        && left.length === right.length
        && left.every((value, index) => value === right[index]);
}

function syncHostReadyState(session) {
    const hostKey = session.hostMateKey;
    if (!hostKey) return false;

    const hostMate = session.mates.get(hostKey);
    if (!hostMate) return false;

    const participantMates = [...session.mates.entries()]
        .filter(([mateKey]) => mateKey !== hostKey)
        .map(([, mate]) => mate);
    const allParticipantsReady = participantMates.length > 0
        && participantMates.every((mate) => isReadyStateReady(mate.state));
    const nextState = allParticipantsReady ? [1] : [0];

    if (sameReadyState(hostMate.state, nextState)) return false;

    hostMate.state = nextState;
    session.mates.set(hostKey, hostMate);
    sendToSession(session, stateChanged(hostMate.connectionId, nextState));
    log(`[tcp] host_ready_sync room=${session.roomNumber} host=${hostMate.connectionId} state=${JSON.stringify(nextState)}`);
    return true;
}

function resetBattleState(session) {
    if (session.battleSceneStartRetryTimer) {
        clearInterval(session.battleSceneStartRetryTimer);
        session.battleSceneStartRetryTimer = undefined;
    }
    if (session.battleFinalizedProbeTimer) {
        clearTimeout(session.battleFinalizedProbeTimer);
        session.battleFinalizedProbeTimer = undefined;
    }
    if (session.battleConnectedProbeTimer) {
        clearTimeout(session.battleConnectedProbeTimer);
        session.battleConnectedProbeTimer = undefined;
    }

    session.battleStarted = false;
    session.battleStartSent = false;
    session.battleSceneReady.clear();
    session.battleSceneStartSent = false;
    session.battleSceneStartRetryCount = 0;
    session.battleFinalizedProbeSent = false;
    session.battleConnectedProbeSent = false;
    session.battleLoadingConnectedSent = false;
    session.battleSockets.clear();
}

function resetRoomAfterBattle(session) {
    resetBattleState(session);
    session.returningFromBattle = true;
    session.returnPendingMates = new Set(session.mates.keys());

    for (const [mateKey, mate] of session.mates.entries()) {
        mate.state = [0];
        session.mates.set(mateKey, mate);
    }

    broadcastMates(session);
    log(`[tcp] room_reset_after_battle room=${session.roomNumber} host=${session.hostMateKey || ""} mates=${session.mates.size}`);
}

function getOrCreateRoomSession(roomNumber, defaults = {}) {
    const key = roomNumber || "";
    let session = key ? roomSessionsByNumber.get(key) : undefined;
    if (session) {
        session.questId = session.questId || defaults.questId;
        session.questCategory = session.questCategory || defaults.questCategory;
        return session;
    }

    session = {
        roomNumber: key,
        questId: defaults.questId,
        questCategory: defaults.questCategory,
        hostMateKey: undefined,
        battleStarted: false,
        battleStartSent: false,
        battleSceneReady: new Set(),
        battleSceneStartSent: false,
        battleSceneStartRetryTimer: undefined,
        battleSceneStartRetryCount: 0,
        battleFinalizedProbeTimer: undefined,
        battleFinalizedProbeSent: false,
        battleConnectedProbeTimer: undefined,
        battleConnectedProbeSent: false,
        battleLoadingConnectedSent: false,
        returningFromBattle: false,
        returnPendingMates: new Set(),
        mates: new Map(),
        sockets: new Set(),
        battleSockets: new Set()
    };

    if (key) roomSessionsByNumber.set(key, session);
    return session;
}

function buildRoomPayload(session) {
    return {
        roomNumber: session?.roomNumber,
        room_number: session?.roomNumber,
        questId: session?.questId,
        quest_id: session?.questId,
        questCategory: session?.questCategory,
        quest_category: session?.questCategory,
        category_id: session?.questCategory
    };
}

function isPendingBattleReturn(session, mateKey) {
    return Boolean(session?.returningFromBattle && mateKey && session.returnPendingMates?.has(mateKey));
}

function removeMateFromSession(session, roomState, reason) {
    if (!session || !roomState?.mateKey || !session.mates.has(roomState.mateKey)) return false;

    const viewerId = getViewerIdFromRoomState(roomState);
    session.mates.delete(roomState.mateKey);
    roomsByViewer.delete(roomState.viewerId);

    if (session.hostMateKey === roomState.mateKey) {
        session.hostMateKey = session.mates.keys().next().value;
    }

    if (session.mates.size === 0) {
        notifyHttpRoomEvent("empty", session, viewerId);
        roomSessionsByNumber.delete(session.roomNumber || "");
        session.sockets.clear();
        session.battleSockets.clear();
        log(`[tcp] room_empty room=${session.roomNumber} reason=${reason} viewer=${viewerId || ""}`);
    } else {
        notifyHttpRoomEvent("leave", session, viewerId);
        syncHostReadyState(session);
        broadcastMates(session);
        log(`[tcp] room_mate_removed room=${session.roomNumber} reason=${reason} connectionId=${roomState.connectionId} remaining=${session.mates.size}`);
    }

    return true;
}

function message(serverMessage) {
    return [1, serverMessage];
}

function welcome(room, mates) {
    return message([0, room, mates]);
}

function mates(mateList) {
    return message([1, mateList]);
}

function ackHeartbeat(connectionId) {
    return message([10, connectionId || ""]);
}

function stateChanged(connectionId, readyState) {
    return message([2, connectionId || "", readyState]);
}

function startBattle(payload) {
    return message([5, payload]);
}

function disbanded() {
    return message([6, "room_state_disbanded"]);
}

function battleSocketInput(input) {
    return wrapBattleSocketInputInSectionCommand ? [2, input] : input;
}

function battleConnected(connectionId) {
    return [0, connectionId || "", ""];
}

function battleSocketConnected(connectionId) {
    return battleSocketInput([2, connectionId || ""]);
}

function battleServerMessage(serverMessage) {
    // Battle TCP uses BattleServer2Client as its wire root. The client then
    // converts Message(serverMessage) into BattleSocketInput.ServerMessage.
    return [1, serverMessage];
}

function battleStart() {
    return battleServerMessage([1]);
}

function battleFinalized() {
    return battleServerMessage([2]);
}

function battleMeasurement(frame = 0) {
    const nowSeconds = Date.now() / 1000;
    return battleServerMessage([3, frame, nowSeconds, 30]);
}

function maybeSendBattleStart(session) {
    if (skipEarlyBattleStart) {
        log(`[tcp] battle_start_wait_scene_ready room=${session.roomNumber}`);
        return;
    }

    if (!session.battleStarted || session.battleStartSent) return;

    const expectedPlayers = Math.max(1, session.mates.size);
    if (session.battleSockets.size < expectedPlayers) return;

    sendToBattleSession(session, battleStart());
    session.battleStartSent = true;
    log(`[tcp] battle_start_sent room=${session.roomNumber} sockets=${session.battleSockets.size} expected=${expectedPlayers}`);
}

function maybeSendBattleLoadingConnected(session) {
    if (!sendEarlyBattleConnected || !session.battleStarted || session.battleLoadingConnectedSent) return;

    const expectedPlayers = Math.max(1, session.mates.size);
    if (session.battleSockets.size < expectedPlayers) return;

    session.battleLoadingConnectedSent = true;
    for (const client of session.battleSockets) {
        if (client.socket.destroyed) continue;
        sendJson(client.socket, client.peer, battleSocketConnected(getClientConnectionId(client)));
    }
    log(`[tcp] battle_loading_connected_sent room=${session.roomNumber} sockets=${session.battleSockets.size} expected=${expectedPlayers}`);
}

function scheduleBattleSceneStartRetries(session) {
    if (session.battleSceneStartRetryTimer) return;

    session.battleSceneStartRetryCount = 0;
    session.battleSceneStartRetryTimer = setInterval(() => {
        if (!session.battleStarted || session.battleSockets.size === 0) {
            clearInterval(session.battleSceneStartRetryTimer);
            session.battleSceneStartRetryTimer = undefined;
            return;
        }

        session.battleSceneStartRetryCount += 1;
        if (session.battleSceneStartRetryCount > 8) {
            clearInterval(session.battleSceneStartRetryTimer);
            session.battleSceneStartRetryTimer = undefined;
            log(`[tcp] battle_scene_start_retry_done room=${session.roomNumber}`);
            return;
        }

        sendToBattleSession(session, battleStart());
        log(`[tcp] battle_scene_start_retry room=${session.roomNumber} count=${session.battleSceneStartRetryCount}`);
    }, 1000);
}

function scheduleBattleFinalizedProbe(session) {
    if (session.battleFinalizedProbeSent || session.battleFinalizedProbeTimer) return;

    session.battleFinalizedProbeTimer = setTimeout(() => {
        session.battleFinalizedProbeTimer = undefined;

        if (!session.battleStarted || session.battleSockets.size === 0) return;

        session.battleFinalizedProbeSent = true;
        sendToBattleSession(session, battleFinalized());
        log(`[tcp] battle_finalized_probe_sent room=${session.roomNumber}`);
    }, 1000);
}

function scheduleBattleConnectedProbe(session) {
    if (session.battleConnectedProbeSent || session.battleConnectedProbeTimer) return;

    session.battleConnectedProbeTimer = setTimeout(() => {
        session.battleConnectedProbeTimer = undefined;

        if (!session.battleStarted || session.battleSockets.size === 0) return;

        session.battleConnectedProbeSent = true;
        for (const client of session.battleSockets) {
            if (client.socket.destroyed) continue;
            sendJson(client.socket, client.peer, battleSocketConnected(getClientConnectionId(client)));
        }
        log(`[tcp] battle_connected_probe_sent room=${session.roomNumber}`);
    }, 1000);
}

function maybeSendBattleSceneStart(session) {
    if (!session.battleStarted || session.battleSceneStartSent) return;

    const expectedPlayers = Math.max(1, session.mates.size);
    if (session.battleSceneReady.size < expectedPlayers) {
        log(`[tcp] battle_scene_start_wait room=${session.roomNumber} ready=${session.battleSceneReady.size} expected=${expectedPlayers}`);
        return;
    }

    if (session.battleStartSent) {
        session.battleSceneStartSent = true;
        log(`[tcp] battle_scene_start_already_sent room=${session.roomNumber} ready=${session.battleSceneReady.size} expected=${expectedPlayers}`);
        return;
    }

    sendToBattleSession(session, battleStart());
    session.battleSceneStartSent = true;
    if (debugBattleFinalizedAfterSceneReady) {
        scheduleBattleFinalizedProbe(session);
    } else if (debugBattleConnectedAfterSceneReady) {
        scheduleBattleConnectedProbe(session);
    }
    log(`[tcp] battle_scene_start_sent room=${session.roomNumber} ready=${session.battleSceneReady.size} expected=${expectedPlayers}`);
}

const meetingNotifyNames = new Map([
    [0, "Enter"],
    [1, "Bye"],
    [2, "ChangeParty"],
    [3, "Ready"],
    [4, "Heartbeat"],
    [5, "Suspend"],
    [6, "StartBattle"],
    [7, "ChangeAutoplayMode"],
    [8, "ChangeAutoStart"],
    [9, "Log"],
    [10, "EnterComs"]
]);

const battleNotifyNames = new Map([
    [0, "SceneReady"],
    [1, "Finalize"],
    [2, "Measurement"],
    [3, "LineSpeedWarning"],
    [4, "Heartbeat"]
]);

function buildBasicRoomResponse(request) {
    return {
        result: 1,
        socklet: request.socklet,
        viewerId: request.viewerId,
        roomNumber: request.roomNumber,
        questId: request.questId,
        questCategory: request.questCategory
    };
}

function buildEnvelopeRoomResponse(request) {
    return {
        socklet: request.socklet,
        data: buildBasicRoomResponse(request)
    };
}

function buildRoomStateResponse(request) {
    return {
        roomNumber: request.roomNumber,
        questId: request.questId,
        questCategory: request.questCategory,
        members: [
            {
                viewerId: request.viewerId,
                isHost: true,
                ready: false
            }
        ]
    };
}

function buildAcceptArrayWithParams(request) {
    const connectionId = `${request.roomNumber || "room"}:${request.viewerId || "viewer"}`;
    return [0, connectionId, acceptRoomNumber ? request.roomNumber || "" : ""];
}

function buildHaxeEnumObject(enumName, construct, index, params = []) {
    const value = {
        "__enum__": enumName,
        "_hx_index": index
    };

    if (params.length > 0) {
        value[construct] = params;
    }

    return value;
}

const tcpServer = net.createServer((socket) => {
    const peer = `${socket.remoteAddress}:${socket.remotePort}`;
    let buffered = Buffer.alloc(0);
    let handledInitialRequest = false;
    let roomState = null;
    let roomClientRef = null;
    let pushHeartbeatTimer = null;
    log(`[tcp] connect ${peer}`);

    function clearPushHeartbeat() {
        if (pushHeartbeatTimer !== null) {
            clearInterval(pushHeartbeatTimer);
            pushHeartbeatTimer = null;
        }
    }

    function startPushHeartbeat() {
        if (!Number.isFinite(pushHeartbeatMs) || pushHeartbeatMs <= 0 || pushHeartbeatTimer !== null) return;

        pushHeartbeatTimer = setInterval(() => {
            if (socket.destroyed) {
                clearPushHeartbeat();
                return;
            }

            sendJson(socket, peer, ackHeartbeat(roomState?.connectionId));
        }, pushHeartbeatMs);

        log(`[tcp] push_heartbeat_start ${peer} intervalMs=${pushHeartbeatMs}`);
    }

    socket.on("data", (data) => {
        log(`[tcp] recv ${peer} len=${data.length} hex=${hex(data.slice(0, 256))}`);
        buffered = Buffer.concat([buffered, data]);

        let frameEnd = buffered.indexOf(0);
        while (frameEnd !== -1) {
            const frame = buffered.slice(0, frameEnd);
            buffered = buffered.slice(frameEnd + 1);

            const text = frame.toString("utf8");
            log(`[tcp] frame ${peer} text=${text}`);

            try {
                const message = JSON.parse(text);
                log(`[tcp] json ${peer} ${JSON.stringify(message)}`);

                if (!handledInitialRequest && message.socklet === "cooperation_battle") {
                    handledInitialRequest = true;
                    const connectionId = message.connectionId || "";
                    const [connectionRoomNumber, connectionViewerId] = connectionId.split(":");
                    const roomNumber = message.roomNumber || connectionRoomNumber || "";
                    const session = getOrCreateRoomSession(roomNumber);
                    roomState = {
                        socklet: "cooperation_battle",
                        roomNumber,
                        viewerId: Number.parseInt(connectionViewerId || "0", 10),
                        connectionId,
                        session,
                        mateKey: connectionId
                    };
                    roomClientRef = roomClientRef || { socket, peer, roomState };
                    roomClientRef.roomState = roomState;
                    session.battleSockets.add(roomClientRef);
                    sendJson(socket, peer, battleConnected(connectionId));
                    log(`[tcp] battle_connected room=${roomNumber} connectionId=${connectionId}`);
                    maybeSendBattleLoadingConnected(session);
                    maybeSendBattleStart(session);
                } else if (!handledInitialRequest && message.socklet === "cooperation_room") {
                    handledInitialRequest = true;
                    const restoredRoom = message.roomNumber
                        ? roomsByNumber.get(message.roomNumber)
                        : roomsByViewer.get(message.viewerId);
                    const roomNumber = message.roomNumber || restoredRoom?.roomNumber || "";
                    const session = getOrCreateRoomSession(roomNumber, {
                        questId: message.questId || restoredRoom?.questId,
                        questCategory: message.questCategory || restoredRoom?.questCategory
                    });
                    roomState = {
                        socklet: "cooperation_room",
                        roomNumber,
                        questId: session.questId,
                        questCategory: session.questCategory,
                        viewerId: message.viewerId,
                        connectionId: `${roomNumber || "room"}:${message.viewerId || "viewer"}`,
                        session,
                        mateKey: undefined
                    };
                    roomClientRef = roomClientRef || { socket, peer, roomState };
                    roomClientRef.roomState = roomState;
                    session.sockets.add(roomClientRef);
                    roomsByViewer.set(message.viewerId, roomState);
                    if (roomNumber) roomsByNumber.set(roomNumber, roomState);

                    if (responseMode === "basic") {
                        sendJson(socket, peer, buildBasicRoomResponse({ ...message, roomNumber }));
                    } else if (responseMode === "envelope") {
                        sendJson(socket, peer, buildEnvelopeRoomResponse(message));
                    } else if (responseMode === "room_state") {
                        sendJson(socket, peer, buildRoomStateResponse(message));
                    } else if (responseMode === "result0") {
                        sendJson(socket, peer, { result: 0 });
                    } else if (responseMode === "result1") {
                        sendJson(socket, peer, { result: 1 });
                    } else if (responseMode === "accept_string") {
                        sendJson(socket, peer, "Accept");
                    } else if (responseMode === "accept_array_name") {
                        sendJson(socket, peer, ["Accept"]);
                    } else if (responseMode === "accept_array_index") {
                        sendJson(socket, peer, [3]);
                    } else if (responseMode === "accept_array_params") {
                        sendJson(socket, peer, buildAcceptArrayWithParams({ ...message, roomNumber }));
                    } else if (responseMode === "accept_index") {
                        sendJson(socket, peer, 3);
                    } else if (responseMode === "accept_haxe_object") {
                        sendJson(socket, peer, buildHaxeEnumObject("pinball.online.HandshakeResult", "Accept", 3));
                    } else if (responseMode === "accept_object_name") {
                        sendJson(socket, peer, { name: "Accept", args: [] });
                    } else if (responseMode === "accept_constructor") {
                        sendJson(socket, peer, { constructor: "Accept", params: [] });
                    } else {
                        log(`[tcp] response disabled mode=${responseMode}`);
                    }
                } else if (Array.isArray(message) && responseMode === "accept_array_params" && roomState?.socklet === "cooperation_battle") {
                    const clientMessageKind = message[0];
                    const notify = message[1];
                    const notifyKind = Array.isArray(notify) ? notify[0] : undefined;
                    const notifyName = battleNotifyNames.get(notifyKind) || "Unknown";

                    if (clientMessageKind === 0 && notifyKind === 0) {
                        roomState.session.battleSceneReady.add(roomState.connectionId);
                        maybeSendBattleSceneStart(roomState.session);
                        log(`[tcp] battle_scene_ready room=${roomState.roomNumber} connectionId=${roomState.connectionId}`);
                    } else if (clientMessageKind === 0 && notifyKind === 4) {
                        sendJson(socket, peer, battleMeasurement(0));
                        log(`[tcp] battle_heartbeat ${peer} connectionId=${roomState?.connectionId}`);
                    } else if (clientMessageKind === 0 && notifyKind === 1) {
                        sendToBattleSession(roomState.session, battleServerMessage([2]));
                        resetRoomAfterBattle(roomState.session);
                        log(`[tcp] battle_finalize room=${roomState.roomNumber} connectionId=${roomState.connectionId}`);
                    } else if (clientMessageKind === 1 && Array.isArray(notify)) {
                        const sent = sendToOtherBattleClients(
                            roomState.session,
                            roomClientRef,
                            [2, roomState.connectionId, notify]
                        );
                        log(`[tcp] battle_broadcast_relay room=${roomState.roomNumber} from=${roomState.connectionId} messages=${notify.length} recipients=${sent}`);
                    } else {
                        log(`[tcp] unhandled_battle_message ${peer} kind=${clientMessageKind} notifyKind=${notifyKind} notifyName=${notifyName}`);
                    }
                } else if (Array.isArray(message) && responseMode === "accept_array_params") {
                    const clientMessageKind = message[0];
                    const notify = message[1];
                    const notifyKind = Array.isArray(notify) ? notify[0] : undefined;

                    const notifyName = meetingNotifyNames.get(notifyKind) || "Unknown";

                    if (clientMessageKind === 0 && notifyKind === 0) {
                        const mate = notify[1];
                        roomState = roomState || {};
                        const session = roomState.session || getOrCreateRoomSession(roomState.roomNumber, {
                            questId: roomState.questId,
                            questCategory: roomState.questCategory
                        });
                        roomState.session = session;
                        roomClientRef = roomClientRef || { socket, peer, roomState };
                        roomClientRef.roomState = roomState;
                        session.sockets.add(roomClientRef);
                        roomState.connectionId = mate?.connectionId || roomState.connectionId;
                        roomState.mateKey = getMateKey(mate);
                        if (roomState.mateKey && !session.mates.has(roomState.mateKey) && isRoomFull(session)) {
                            sendJson(socket, peer, [1, "room_full"]);
                            session.sockets.delete(roomClientRef);
                            log(`[tcp] enter_denied_room_full room=${session.roomNumber} peer=${peer} mate=${roomState.connectionId}`);
                            socket.end();
                            return;
                        }
                        if (roomState.mateKey) {
                            if (!session.hostMateKey) {
                                session.hostMateKey = roomState.mateKey;
                                log(`[tcp] host_assigned room=${session.roomNumber} host=${roomState.connectionId}`);
                            }
                            session.mates.set(roomState.mateKey, mate);
                        }
                        if (isPendingBattleReturn(session, roomState.mateKey)) {
                            session.returnPendingMates.delete(roomState.mateKey);
                            log(`[tcp] room_return_mate room=${session.roomNumber} connectionId=${roomState.connectionId} pending=${session.returnPendingMates.size}`);
                            if (session.returnPendingMates.size === 0) {
                                session.returningFromBattle = false;
                                log(`[tcp] room_return_complete room=${session.roomNumber}`);
                            }
                        }
                        roomsByViewer.set(roomState.viewerId, roomState);
                        if (roomState.roomNumber) roomsByNumber.set(roomState.roomNumber, roomState);
                        sendJson(socket, peer, welcome(buildRoomPayload(session), getSessionMateList(session)));
                        syncHostReadyState(session);
                        broadcastMates(session);
                        startPushHeartbeat();
                    } else if (clientMessageKind === 0 && notifyKind === 1) {
                        if (roomState?.session && roomState.mateKey) {
                            const session = roomState.session;
                            if (session.battleStarted) {
                                // The client normally closes the room socket while moving
                                // into the battle socket. HTTP abort/finish handles real
                                // battle exits; removing the mate here prevents BattleStart.
                                log(`[tcp] lobby_bye_during_battle room=${session.roomNumber} connectionId=${roomState.connectionId}`);
                            } else if (isPendingBattleReturn(session, roomState.mateKey)) {
                                log(`[tcp] lobby_bye_ignored_after_battle room=${session.roomNumber} connectionId=${roomState.connectionId}`);
                            } else if (session.hostMateKey === roomState.mateKey) {
                                sendToSession(session, disbanded(roomState.connectionId));
                                notifyHttpRoomEvent("disband", session, getViewerIdFromRoomState(roomState));
                                roomSessionsByNumber.delete(session.roomNumber || "");
                                for (const client of session.sockets) {
                                    if (!client.socket.destroyed) client.socket.end();
                                }
                                session.sockets.clear();
                                session.mates.clear();
                                log(`[tcp] room_disbanded room=${session.roomNumber} host=${roomState.connectionId}`);
                            } else {
                                removeMateFromSession(session, roomState, "lobby_bye");
                            }
                        }
                        log(`[tcp] notify ${peer} kind=${notifyKind} name=${notifyName}`);
                    } else if (clientMessageKind === 0 && notifyKind === 2) {
                        const mate = notify[1];
                        if (roomState?.session && mate) {
                            const mateKey = getMateKey(mate) || roomState.mateKey;
                            if (mateKey) {
                                roomState.mateKey = mateKey;
                                roomState.session.mates.set(mateKey, mate);
                                syncHostReadyState(roomState.session);
                                broadcastMates(roomState.session);
                            }
                        }
                    } else if (clientMessageKind === 0 && notifyKind === 3) {
                        const readyState = notify[1];
                        if (roomState?.session && roomState.mateKey) {
                            const mate = roomState.session.mates.get(roomState.mateKey);
                            if (mate) {
                                mate.state = readyState;
                                roomState.session.mates.set(roomState.mateKey, mate);
                                sendToSession(roomState.session, stateChanged(roomState.connectionId, readyState));
                                syncHostReadyState(roomState.session);
                                broadcastMates(roomState.session);
                            }
                        }
                    } else if (clientMessageKind === 0 && notifyKind === 4) {
                        sendJson(socket, peer, ackHeartbeat(roomState?.connectionId));
                    } else if (clientMessageKind === 0 && notifyKind === 5) {
                        log(`[tcp] notify ${peer} kind=${notifyKind} name=${notifyName}`);
                    } else if (clientMessageKind === 0 && notifyKind === 6) {
                        if (roomState?.session && roomState.mateKey === roomState.session.hostMateKey) {
                            const startPayload = getSessionMateList(roomState.session);
                            roomState.session.battleStarted = true;
                            roomState.session.battleStartSent = false;
                            roomState.session.returningFromBattle = false;
                            roomState.session.returnPendingMates.clear();
                            sendToSession(roomState.session, startBattle(startPayload));
                            log(`[tcp] start_battle room=${roomState.session.roomNumber} host=${roomState.connectionId} mates=${startPayload.length}`);
                            maybeSendBattleLoadingConnected(roomState.session);
                            maybeSendBattleStart(roomState.session);
                        } else {
                            log(`[tcp] start_battle_denied_non_host ${peer} connectionId=${roomState?.connectionId}`);
                        }
                    } else {
                        log(`[tcp] unhandled_client_message ${peer} kind=${clientMessageKind} notifyKind=${notifyKind} notifyName=${notifyName}`);
                    }
                }
            } catch (error) {
                log(`[tcp] json_error ${peer} ${error.message}`);
            }

            frameEnd = buffered.indexOf(0);
        }
    });

    socket.on("end", () => {
        clearPushHeartbeat();
        log(`[tcp] end ${peer}`);
    });
    socket.on("close", (hadError) => {
        clearPushHeartbeat();
        if (roomState?.session && roomClientRef) {
            const session = roomState.session;
            if (roomState.socklet === "cooperation_battle") {
                session.battleSockets.delete(roomClientRef);
                if (session.battleStarted) {
                    removeMateFromSession(session, roomState, "battle_close");
                }
                log(`[tcp] battle_close room=${session.roomNumber} connectionId=${roomState.connectionId}`);
                log(`[tcp] close ${peer} error=${hadError}`);
                return;
            }
            session.sockets.delete(roomClientRef);
            if (session.battleStarted) {
                log(`[tcp] lobby_close_during_battle room=${session.roomNumber} connectionId=${roomState.connectionId}`);
                log(`[tcp] close ${peer} error=${hadError}`);
                return;
            }
            if (isPendingBattleReturn(session, roomState.mateKey)) {
                log(`[tcp] lobby_close_ignored_after_battle room=${session.roomNumber} connectionId=${roomState.connectionId}`);
                log(`[tcp] close ${peer} error=${hadError}`);
                return;
            }
            if (roomState.mateKey && session.mates.has(roomState.mateKey)) {
                if (session.hostMateKey === roomState.mateKey) {
                    sendToSession(session, disbanded(roomState.connectionId));
                    notifyHttpRoomEvent("disband", session, getViewerIdFromRoomState(roomState));
                    roomSessionsByNumber.delete(session.roomNumber || "");
                    session.mates.clear();
                    session.sockets.clear();
                    log(`[tcp] room_disbanded_by_close room=${session.roomNumber} host=${roomState.connectionId}`);
                } else {
                    removeMateFromSession(session, roomState, "lobby_close");
                }
            }
        }
        log(`[tcp] close ${peer} error=${hadError}`);
    });
    socket.on("error", (error) => log(`[tcp] error ${peer} ${error.message}`));
});

tcpServer.listen(port, host, () => {
    log(`[tcp] listening ${host}:${port} responseMode=${responseMode} acceptRoomNumber=${acceptRoomNumber} pushHeartbeatMs=${pushHeartbeatMs} skipEarlyBattleStart=${skipEarlyBattleStart}`);
});

const udpServer = dgram.createSocket("udp4");

udpServer.on("message", (data, remote) => {
    log(`[udp] recv ${remote.address}:${remote.port} len=${data.length} hex=${hex(data.slice(0, 256))}`);
});

udpServer.on("error", (error) => {
    log(`[udp] error ${error.message}`);
});

udpServer.bind(port, host, () => {
    log(`[udp] listening ${host}:${port} responseMode=${responseMode} acceptRoomNumber=${acceptRoomNumber} pushHeartbeatMs=${pushHeartbeatMs} skipEarlyBattleStart=${skipEarlyBattleStart}`);
});
