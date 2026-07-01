# World Flipper Starpoint Multiplayer Room Number Display Analysis Request

## Current State

We are implementing World Flipper multiplayer support in Starpoint.

The host can now enter a multiplayer room and stay connected. The remaining UI issue is that the room number field is blank.

Client:

- Korean Android World Flipper `0.0.81`
- Adobe AIR / SWF client, not Unity
- Realtime protocol: TCP JSON frames terminated by NUL (`\0`)
- Realtime dummy server: `scripts/dummy-multi-server.js`
- HTTP API route implementation: `src/routes/api/multiBattleQuest.ts`

## Confirmed Working Behavior

Latest room test:

```text
room_number from HTTP create/select: 906283
TCP handshake client -> server:
{"questCategory":2,"reconnected":0,"roomNumber":"906283","viewerId":290468015,"questId":1001001,"socklet":"cooperation_room"}

server Accept:
[0,"906283:290468015",""]

client Enter:
[0,[0,{mate object...},1]]

server Welcome:
[1,[0,{"roomNumber":"906283","room_number":"906283","questId":1001001,"quest_id":1001001,"questCategory":2,"quest_category":2,"category_id":2},[mate]]]

server Mates:
[1,[1,[mate]]]

client Heartbeat:
[0,[4]]

server AckHeartbeat:
[1,[10,"906283:290468015"]]
```

Heartbeat continues every 5 seconds. The 30-second room disband problem is fixed.

## Critical Discovery

`HandshakeResult.Accept` has two string params:

```as3
public static function Accept(param1:String, param2:String) : HandshakeResult
{
   return new HandshakeResult("Accept",0,[param1,param2]);
}
```

Runtime behavior proves:

```json
[0,"906283:290468015",""]
```

is required for host room session lifecycle. If the second param is set to the room number:

```json
[0,"906283:290468015","906283"]
```

the client does not start heartbeat and sends `Bye` after about 30 seconds.

So do **not** use the second `Accept` param for displaying the room number.

## Current Problem

The host remains in the room and heartbeat works, but the UI room number field is blank.

Screenshot symptom:

```text
룸 넘버
[ blank ]
```

The copy/share buttons exist, but the visible 6-digit room number is missing.

## Failed Experiments

### Failed: Put room number in `Accept` second param

Result:

- Room number became visible in an earlier test.
- But heartbeat did not start.
- Client sent `[0,[1]]` (`Bye`) after about 30 seconds.

Conclusion:

This path is wrong for host room lifecycle.

### Failed: Send `MeetingServer2Client.Messages(roomNumber, [Welcome, Mates])`

We tried adding:

```json
[2,"191118",[[0,room,[mate]],[1,[mate]]]]
```

immediately after normal `Welcome` and `Mates`.

Result:

- Client closed the TCP socket almost immediately.
- Client entered a `restore_room` loop and later showed `C5602`.

Conclusion:

This `Messages` envelope was malformed, wrong for this phase, or not accepted by this socklet state. Do not repeat without stronger evidence.

### Failed/irrelevant: `RemainingTime`

`[1,[7,900]]` only displays:

```text
앞으로 900초 후 해산됩니다
```

It does not affect room number display or heartbeat.

### Failed/irrelevant: `Update`

`[1,[8,connectionId]]` triggers app update/store popup. Do not use.

## HTTP Responses Are Correct

Latest `create_room` response:

```json
{
  "data": {
    "room_number": "906283",
    "room_url": "http://localhost:8000/latest/api/index.php/multi_invitation/join?k=..."
  }
}
```

Latest `select_room` response:

```json
{
  "data": {
    "room_number": "906283",
    "category_id": 2,
    "quest_id": 1001001,
    "ip_address": "192.168.0.134",
    "port": 18888,
    "application_update_url": "",
    "host_entry_time": 1627540143,
    "raising_state": 1,
    "is_pickup": false,
    "room_sequence": 33178772
  }
}
```

`room_number_hidden` user option is defaulted to `false` in Starpoint seed data:

```text
src/data/wdfpData.ts -> "room_number_hidden": false
```

So this does not appear to be a simple HTTP response omission or user option issue.

## Files To Inspect

Primary:

```text
scripts/dummy-multi-server.js
src/routes/api/multiBattleQuest.ts
.analysis/ffdec-src/scripts/pinball/online/HandshakeResult.as
.analysis/ffdec-src/scripts/pinball/online/meeting/message/MeetingServerMessage.as
.analysis/ffdec-src/scripts/pinball/online/meeting/message/MeetingServer2Client.as
.analysis/ffdec-socket-pcode/scripts/pinball/online/meeting/message/MeetingNotifyMessage.pcode
.analysis/ffdec-typepacker-resource/scripts/TypePackerResource2.pcode
```

Useful search commands:

```powershell
rg -n "roomNumber|room_number|RoomNumber|roomUrl|multiQuestId|room_number_hidden" .analysis\ffdec-src .analysis\ffdec-socket-pcode src docs
rg -n "MeetingServerMessage|MeetingServer2Client|HandshakeResult|Accept|Welcome|Mates" .analysis\ffdec-src .analysis\ffdec-socket-pcode
rg -n "roomNumber|room_number|RoomNumber|roomUrl|multiQuestId" .analysis\ffdec-typepacker-resource\scripts\TypePackerResource2.pcode
```

Be careful:

```text
.analysis/ffdec-typepacker-resource/scripts/TypePackerResource2.pcode
```

is huge. Use `rg` and narrow line windows only.

## Question

What is the correct source/path for the host room UI to display the room number while keeping `Accept(connectionId, "")`?

Please provide:

1. The most likely missing field or message.
2. Evidence from SWF AS3/pcode or TypePacker.
3. One minimal safe experiment to run in `scripts/dummy-multi-server.js` or `src/routes/api/multiBattleQuest.ts`.
4. Exact JSON frame or HTTP response shape if applicable.

