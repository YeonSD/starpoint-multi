# 멀티플레이 미해결 이슈 분석 (2026-06-29)

> 이 문서는 Codex가 다음 작업을 이어갈 때 참고하도록 Claude가 로그와 소스코드를 분석해서 작성한 것입니다.
> **코드를 수정하지 않고 분석만 진행했습니다.**

---

## 1. 룸 넘버가 표시되지 않는 근본 원인

### 실제 이벤트 흐름 (`.logs/` 기반)

```
03:09:21  POST /multi_battle_quest/create_room  → room_number: "842780" ✅
03:09:21  POST /multi_battle_quest/prepare       → 정상 ✅
03:09:22  POST /multi_battle_quest/select_room   → ip, port, room_sequence:98171846 ✅
03:09:22  TCP 연결 #1 (port 9375): 클라이언트 → roomNumber:"842780" ✅
03:09:22  TCP Welcome 응답: roomNumber:"842780" 포함 ✅
03:09:27~37  하트비트 정상 ✅
03:09:42  클라이언트 → [0,[5]] 전송 후 TCP 연결 #1 종료
              → 서버: "unhandled_client_message notifyKind=5"
03:09:44  POST /multi_battle_quest/restore_room  body: {room_number:"", room_sequence:98171846}
              → 서버 응답: room_number:"" ← ★ 문제 발생
03:09:44  TCP 연결 #2 (port 9382): 클라이언트 → roomNumber:"" (빈 값)
              → 서버 핸드셰이크 응답: [0,"room:290468015",""]
              → Welcome: roomNumber:"" ← ★ UI에 빈 칸 표시됨
```

### 원인 분석

클라이언트는 `[0,[5]]` (Notify kind=5)를 전송하고 TCP를 종료한 뒤, **`restore_room` API로 room_number를 서버에 다시 물어봅니다.** 이때 body에 `room_number: ""`(빈 값)과 `room_sequence: 98171846`을 함께 전송합니다.

현재 `src/routes/api/multiBattleQuest.ts`의 `restore_room` 핸들러 코드:

```typescript
// line 327
const room = body.room_number ? rooms.get(body.room_number) : undefined
```

`body.room_number`가 빈 문자열 `""`이면 falsy이므로 `room`이 `undefined`가 되고,
응답에도 `room_number: ""` 그대로 반환됩니다.

클라이언트는 `restore_room`이 돌려준 `room_number: ""`를 가지고 TCP에 재접속하므로,
두 번째 TCP 세션의 Welcome 메시지도 `roomNumber: ""`가 되어 **UI에 룸 넘버가 표시되지 않습니다.**

### 해결 방법

`rooms` Map에 `room_sequence`를 인덱스로 추가해서, `room_number`가 비어 있을 때 `room_sequence`로 룸을 찾을 수 있게 해야 합니다.

구체적으로:
1. `Map<string, MultiRoom>` 외에 `Map<number, MultiRoom>` (roomSequence → room) 인덱스 추가
2. `create_room`, `select_room`에서 룸을 등록할 때 두 인덱스 모두 업데이트
3. `restore_room`에서 `body.room_number`가 없으면 `body.room_sequence`로 룸 조회

```typescript
// 변경 예시 (실제 구현은 Codex가 판단)
const room = body.room_number
    ? rooms.get(body.room_number)
    : (body.room_sequence ? roomsBySequence.get(body.room_sequence) : undefined)
```

---

## 2. TCP Notify kind=5 미처리

로그에서 클라이언트가 `[0,[5]]`를 보내면 서버가 "unhandled_client_message"를 기록하고 연결이 끊깁니다.

이 이벤트가 발생하는 상황: 방 생성 직후 약 20초 후에 자동으로 발생 (타이머 기반으로 추정). 정확한 의미는 APK 분석 필요하지만, 가능한 의미:

- `kind=5` = `MeetingNotifyMessage.Leave` (방 나가기)
- `kind=5` = `MeetingNotifyMessage.ShareRoom` (방 공개)
- `kind=5` = 다른 상태 동기화 메시지

현재 서버는 이걸 무시하고 있어서 클라이언트가 TCP를 종료 후 `restore_room`→재접속 루프에 들어갑니다.

**최소 대응:** kind=5를 수신하면 서버가 적절한 응답 없이 로그만 남기더라도, 연결이 끊기지 않도록 처리하거나, `restore_room`에서 `room_sequence` 조회를 먼저 고쳐야 함.

---

## 3. `disband_room` 엔드포인트 없음 (404)

로그 확인:
```
POST /multi_battle_quest/disband_room → 404
body: { viewer_id, room_number: "", api_count: 7 }
```

`src/routes/api/multiBattleQuest.ts`에 `/disband_room` 라우트가 존재하지 않습니다.

실서버 응답 (`docs/routes/multi_battle_quest_disband_room.md` 참조):
```json
{
  "data_headers": { ... },
  "data": []
}
```

구현이 간단합니다. `select_room`이나 `share_room`처럼 최소 구현만 추가하면 됩니다.
해산 시 `rooms` Map에서 해당 룸을 삭제하는 처리도 포함시키면 좋습니다.

---

## 4. `room_url`이 localhost를 가리킴

`create_room` 응답:
```json
"room_url": "http://localhost:8000/latest/api/index.php/multi_invitation/join?k=..."
```

`buildInvitationUrl` 함수가 `STARPOINT_PUBLIC_HOST` 환경변수를 사용하는데, 미설정 시 `request.headers.host` → `"localhost:8000"`으로 fallback됩니다.

멀티플레이 테스트(다른 기기에서 참가)를 위해서는:
- 환경변수 `STARPOINT_PUBLIC_HOST`를 실제 WireGuard IP (예: `10.0.0.1:8000`)로 설정해야 함
- `.env` 파일 또는 `start.bat`에서 설정

---

## 5. `multi_invitation/join` 엔드포인트 없음

`room_url`을 통해 참가할 때 호출되는 엔드포인트:
```
GET /latest/api/index.php/multi_invitation/join?k={invitationKey}
```

현재 서버에 이 라우트가 없습니다. 다른 기기에서 URL로 참가하려면 구현이 필요합니다.

예상 동작:
1. `invitationKey`로 룸을 조회
2. 해당 룸의 `room_number`, `quest_id`, `category_id` 등을 클라이언트에 반환
3. 클라이언트가 `select_room`을 호출해서 정식 참가

---

## 6. TCP Notify kind=10 미처리

로그에서 클라이언트가 `summon` HTTP 응답을 받은 직후 TCP로 다음을 전송:
```
[0,[10,[{mate1 data...},{mate2 data...}]]]
```

이 메시지는 소환된 NPC 파티원 정보를 방 전체에 브로드캐스트하는 것으로 추정됩니다.
현재 서버는 이를 무시합니다. 나중에 실제 멀티(다른 기기 참가) 구현 시 필요할 수 있습니다.

---

## 현재까지 정상 동작 확인된 것들

- `create_room` → room_number 생성 및 반환 ✅
- `prepare`, `select_room` → 정상 ✅  
- TCP 핸드셰이크 (cooperation_room + `[0,"roomNum:viewerId",""]`) ✅
- TCP Welcome/Mates 전송 ✅
- 하트비트 (kind=4) 왕복 ✅
- `share_room` → 200 정상 응답 ✅
- `summon` → mate1, mate2 반환 ✅ (Codex가 최근 추가)

---

## 다음 작업 우선순위 (권장)

| 우선순위 | 항목 | 파일 |
|---------|------|------|
| 1 | `restore_room`에서 `room_sequence`로 룸 조회 추가 | `src/routes/api/multiBattleQuest.ts` |
| 2 | `disband_room` 라우트 추가 | `src/routes/api/multiBattleQuest.ts` |
| 3 | TCP notify kind=5 처리 | `scripts/dummy-multi-server.js` |
| 4 | `STARPOINT_PUBLIC_HOST` 설정 가이드 확인 후 테스트 | `.env` 또는 `start.bat` |
| 5 | `multi_invitation/join` 라우트 구현 | `src/routes/api/` 또는 server.ts |

---

## 분석에 사용한 주요 로그 파일

- `.logs/http/2026-06-29T03-09-21-522Z-200-POST-latest_api_index.php_multi_battle_quest_create_room.json`
- `.logs/http/2026-06-29T03-09-44-271Z-200-POST-latest_api_index.php_multi_battle_quest_restore_room.json`
- `.logs/multi-realtime/dummy-2026-06-29T02-57-13-339Z.log`
- `.logs/http/2026-06-29T03-24-10-632Z-404-POST-latest_api_index.php_multi_battle_quest_disband_room.json`
