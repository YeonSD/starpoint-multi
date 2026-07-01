# World Flipper Starpoint Multiplayer Room Disconnect Analysis Request

## Context

We are implementing missing multiplayer support for the open-source World Flipper server emulator Starpoint.

Current client environment:

- World Flipper Korean Android client, app version `0.0.81`
- Adobe AIR client (`worldflipper_android_release.swf`), not Unity/IL2CPP
- Traffic is routed through WireGuard + mitmproxy to local Starpoint
- HTTP API base: `http://localhost:8000/latest/api/index.php`
- Realtime room server: local dummy TCP/UDP server on port `18888`

Current goal is not full battle implementation yet. The immediate blocker is keeping a host-created multiplayer room open long enough for another client to join.

## Confirmed Working

The following flow now works:

1. `POST /multi_battle_quest/create_room` returns 200 and creates a room number.
2. `POST /multi_battle_quest/prepare` returns 200.
3. `POST /multi_battle_quest/select_room` returns 200 with:
   - `room_number`
   - `ip_address`
   - `port: 18888`
   - `room_sequence`
4. Client opens TCP connection to port `18888`.
5. Client sends an initial JSON handshake frame terminated by `\0`.
6. Dummy realtime server responds with `HandshakeResult.Accept`.
7. Client sends `MeetingNotifyMessage.Enter`.
8. Dummy server sends `MeetingServerMessage.Welcome` and `MeetingServerMessage.Mates`.
9. Client enters the multiplayer room UI.
10. Room number is visible correctly.

## Important Protocol Facts

The realtime protocol at this stage is TCP, JSON frames terminated by NUL (`\0`).

Initial client handshake example:

```json
{"questId":1001001,"reconnected":0,"roomNumber":"867252","viewerId":290468015,"questCategory":2,"socklet":"cooperation_room"}
```

Current working hypothesis for `HandshakeResult.Accept` response shape:

```json
[0,"867252:290468015",""]
```

Evidence from SWF pcode:

- `HandshakeResult.__constructs__ = ["Accept","Denied","Reconnect","Exception","Complete"]`
- `Accept` index is `0`
- `Accept` has two params. TypePacker labels them `(ConnectionId, RoomNumber)`, but runtime log comparison indicates the second param must be `""` for host-created room entry to start the heartbeat loop.

Relevant message enums from extracted AS3:

```as3
MeetingServer2Client.__constructs__ = ["Error","Message","Messages"];
MeetingServerMessage.__constructs__ = [
  "Welcome",
  "Mates",
  "StateChanged",
  "AutoplayModeChanged",
  "AutoStartChanged",
  "Start",
  "Disbanded",
  "RemainingTime",
  "Update",
  "StartRemainingTime",
  "AckHeartbeat"
];
MeetingNotifyMessage.__constructs__ = [
  "Enter",
  "Bye",
  "ChangeParty",
  "Ready",
  "Heartbeat",
  "Suspend",
  "StartBattle",
  "ChangeAutoplayMode",
  "ChangeAutoStart",
  "Log",
  "EnterComs"
];
```

Observed client `Enter` notify:

```json
[0,[0,{...mate object...},1]]
```

Observed `mate` contains:

```json
{
  "rank":4,
  "name":"aaa",
  "viewerId":290468015,
  "autoStart":false,
  "party":{...},
  "playerRoleKind":1,
  "autoplayMode":true,
  "connectionId":"867252:290468015",
  "state":[0],
  "entryTime":1627540143166.6667
}
```

Current dummy server sends after `Enter`:

```json
[1,[0, roomObject, [mate]]]
[1,[1, [mate]]]
```

That means:

- `MeetingServer2Client.Message`
- `MeetingServerMessage.Welcome(room, mates)`
- `MeetingServerMessage.Mates(mates)`

## Current Failure

The room UI opens and the room number is visible, but after approximately 30 seconds the client displays:

```text
룸과 연결이 끊겨
룸이 해산되었습니다.
```

Realtime log evidence from latest test:

```text
06:44:16.212 client handshake roomNumber="867252"
06:44:16.214 server sends Accept [0,"867252:290468015","867252"]
06:44:16.232 client sends Enter [0,[0,{mate},1]]
06:44:16.233 server sends Welcome
06:44:16.234 server sends Mates
06:44:46.207 client sends [0,[1]]
06:44:46.209 notify kind=1 name=Bye
06:44:46.211 TCP close
```

Important: in this latest test the server did **not** send `Disbanded`. The client sent `Bye` first after 30 seconds, then closed the socket.

Follow-up log comparison found a likely regression:

```text
old working room session: server Accept [0,"842780:290468015",""]      -> client starts Heartbeat after about 5 seconds
new failing room session: server Accept [0,"867252:290468015","867252"] -> client sends Bye after about 30 seconds
```

The second `Accept` parameter being set to the room number appears to put the host client into the wrong room lifecycle branch. The dummy server has been changed back to always send an empty second parameter while preserving the room number in HTTP `select_room`/`restore_room` and in `Welcome(roomObject, mates)`.

## Failed Experiments

### Experiment 1: Send `MeetingServerMessage.Update`

We tried periodically sending:

```json
[1,[8,"867252:290468015"]]
```

Result:

The client showed a store update popup:

```text
가까운 시일 내로 앱 업데이트가 실행됩니다
스토어를 확인하세요
```

Conclusion:

`MeetingServerMessage.Update` is not a room-state keepalive. It triggers application update behavior. Do not use it as keepalive.

### Experiment 2: Send `MeetingServerMessage.RemainingTime`

We tried periodically sending:

```json
[1,[7,900]]
[1,[7,895]]
[1,[7,890]]
...
```

Result:

The client displayed periodic room expiration countdown text:

```text
앞으로 885초 후 해산됩니다
```

But it still sent `[0,[1]]` (`Bye`) after about 30 seconds and disconnected.

Conclusion:

`RemainingTime` only updates the visible room expiration countdown. It is not sufficient to keep the room session alive.

## Current Hypotheses To Analyze

Please analyze the extracted SWF/AS3/pcode and Starpoint implementation to identify the missing room lifecycle message or malformed payload.

Most likely areas:

1. The dummy `roomObject` in `Welcome(room, mates)` is too sparse.
   - Current room object only has:
     - `roomNumber`
     - `room_number`
     - `questId`
     - `quest_id`
     - `questCategory`
     - `quest_category`
     - `category_id`
   - The client may require additional fields for room state, host state, countdown timers, or recruitment state.

2. The server may need to echo/broadcast `StateChanged(connectionId, ReadyState)` after `Enter`.
   - The entering mate has `state:[0]`.
   - We have not yet confirmed the `ReadyState` enum constructors/indices.
   - Need determine whether initial state should be broadcast as:
     - `[1,[2, connectionId, [0]]]`
     - or another `ReadyState` value.

3. The client may expect a `Messages(roomNumber, [MeetingServerMessage...])` envelope instead of multiple `Message(...)` frames for some state updates.
   - `MeetingServer2Client.Messages(param1:String, param2:Array)` exists.
   - Current implementation only uses `Message`.

4. The client may start heartbeat only after a specific server-side state transition.
   - In current logs, after `Welcome/Mates`, the client does not send `Heartbeat`.
   - It sends `Bye` after 30 seconds.

5. The 30-second timeout may come from an HTTP config value, not TCP.
   - `share_room` config currently includes:
     - `multi_attention_lifetime_seconds: 30`
     - `disable_decline_duration_seconds: 30`
   - But this disconnect also happens without an obvious HTTP error.
   - Need determine whether room UI has a 30-second “attention/recruitment” watchdog that requires polling or server-side event updates.

## Files To Inspect

Primary local files:

```text
scripts/dummy-multi-server.js
src/routes/api/multiBattleQuest.ts
docs/multiplayer-issues-analysis.md
docs/roadmap-multiplayer-cloud.md
.analysis/ffdec-src/scripts/pinball/online/meeting/message/MeetingServerMessage.as
.analysis/ffdec-src/scripts/pinball/online/meeting/message/MeetingServer2Client.as
.analysis/ffdec-socket-pcode/scripts/pinball/online/meeting/message/MeetingNotifyMessage.pcode
.analysis/ffdec-typepacker-resource/scripts/TypePackerResource2.pcode
```

Useful commands:

```powershell
rg -n "MeetingServerMessage|MeetingNotifyMessage|RemainingTime|StateChanged|AckHeartbeat|Welcome|Mates|Bye|Heartbeat" .analysis\ffdec-src .analysis\ffdec-socket-pcode
rg -n "ReadyState|roomNumber|room_sequence|multi_attention_lifetime_seconds|disable_decline_duration_seconds" .analysis\ffdec-src .analysis\ffdec-socket-pcode src docs
```

Be careful with:

```text
.analysis/ffdec-typepacker-resource/scripts/TypePackerResource2.pcode
```

It is very large, so use `rg` and narrow `Get-Content` windows only.

## Requested Output

Please produce:

1. The most likely missing server message or malformed payload causing the 30-second `Bye`.
2. Evidence from SWF AS3/pcode or logs.
3. A minimal next experiment to run, preferably one isolated change to `scripts/dummy-multi-server.js`.
4. Exact JSON frame(s) to send if a protocol experiment is recommended.
