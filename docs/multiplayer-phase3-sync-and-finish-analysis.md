# 멀티 배틀 동기화 미작동 + 종료 후 "No.H404" 오류 분석 (2026-06-30, Phase 3)

> 이 문서는 Codex의 토큰이 소진되어 대기하는 동안, Claude가 pcode와 실제 TCP/HTTP 로그를 대조
> 분석해서 작성한 것입니다. **코드는 수정하지 않고 분석만 진행했습니다.** Phase 2 문서
> (`docs/multiplayer-battle-start-analysis.md`)의 "대기 중..." 이슈가 해결된 이후 새로 보고된
> 증상 두 가지를 다룹니다.

증상 (사용자 보고):
1. 배틀 자체는 정상 시작되지만, 두 플레이어의 위치/행동이 서로 동기화되지 않고 마치 각자
   자기 방에서 상대 파티의 봇과 플레이하는 느낌으로 진행됨.
2. 배틀이 끝나면 "예기치 않은 오류가 발생했습니다. 타이틀 화면으로 돌아갑니다. (No.H404)"
   오류가 뜨고 타이틀로 돌아감.

두 증상 모두 직접적인 로그 증거로 원인을 특정했습니다.

---

## 1. 위치/행동 동기화 미작동 — 원인: 서버가 실시간 명령 스트림을 완전히 드롭함

### 1.1 직접 증거 (`.logs/multi-realtime/dummy-2026-06-30T12-16-42-073Z.log`)

이 로그 하나에서 `unhandled_battle_message` 라인이 **505회** 발생했습니다:

```
12:17:57.098  battle_connected room=836392 connectionId=836392:290468015  (호스트)
12:17:57.203  battle_connected room=836392 connectionId=836392:891794391  (게스트)
...
12:18:03.041  unhandled_battle_message ... kind=1 notifyKind=0,0,0,0,0,AAAAAA8AEQAAAA
12:18:03.220  unhandled_battle_message ... kind=1 notifyKind=0,1,0,0,9,AAEAABAAODM2MzkyOjI5MDQ2ODAxNQAAAAACAAAA
12:18:03.312  unhandled_battle_message ... kind=1 notifyKind=0,2,0,0,16,AAEAABAAODM2MzkyOjI5MDQ2ODAxNQAAAAACAAAA
12:18:03.335  unhandled_battle_message ... kind=1 notifyKind=0,3,0,0,18,...
...                                          (이런 식으로 ~30~40ms 간격, 두 connectionId 모두에서 계속)
12:18:15.982  unhandled_battle_message ... kind=1 notifyKind=0,250,0,0,494,AAEAABAAODM2MzkyOjg5MTc5NDM5MQAAAAACAAAA
12:18:12.455  battle_close room=836392 connectionId=836392:891794391
12:18:15.983  battle_close room=836392 connectionId=836392:290468015
```

- 매 메시지의 두 번째 숫자(1, 2, 3, ... 250)가 **단조 증가하는 프레임/시퀀스 카운터**이고,
  메시지 전송 간격이 약 16~40ms로 클라이언트 프레임레이트와 일치합니다 → **이건 명백히
  실시간 배틀 입력/액션 커맨드 스트림**이지, 룸/하트비트류의 산발적 메시지가 아닙니다.
- base64 payload를 디코드하면 (`AAEAABAAODM2MzkyOjI5MDQ2ODAxNQAAAAACAAAA` →
  `00 01 00 00 10 00 "836392:290468015" 00 00 00 00 02 00 00 00`) 보낸 쪽의
  **connectionId 문자열이 그대로 포함**되어 있습니다. 즉 클라이언트가 "나(836392:290468015)의
  이번 프레임 커맨드는 이거다"라는 식의 구조화된 패킷을 30~60Hz로 계속 보내고 있는 것입니다.
- 호스트(`290468015`)와 게스트(`891794391`) **양쪽 모두** 이 스트림을 보냅니다 (로그에 두
  connectionId 모두 등장).
- 서버는 이 메시지를 인식하지 못해 **매번 그냥 로그만 찍고 버립니다.** 상대방 소켓으로
  전달(relay)하는 코드가 전혀 없습니다.

### 1.2 서버 코드 확인 (`scripts/dummy-multi-server.js:520-538`)

`cooperation_battle` 소켓에서 클라이언트 메시지를 처리하는 분기는 다음 세 가지뿐입니다:

```js
if (clientMessageKind === 0 && notifyKind === 0) {       // SceneReady
    ...
} else if (clientMessageKind === 0 && notifyKind === 4) { // Heartbeat → Measurement 응답
    ...
} else if (clientMessageKind === 0 && notifyKind === 1) { // Finalize → Finalized 브로드캐스트
    ...
} else {
    log(`[tcp] unhandled_battle_message ...`);             // 그 외 전부 여기로 빠짐
}
```

`clientMessageKind === 1`로 오는 모든 메시지(=실제 게임플레이 중 발생하는 입력/액션 스트림으로
추정)는 무조건 `unhandled_battle_message`로 떨어져서 **아무 동작도 하지 않습니다.** 파일 전체를
검색해도 `BattleBroadcastMessage`나 `otherBattleDerailleurs`에 대응하는 릴레이 로직(한 플레이어가
보낸 액션을 다른 플레이어의 소켓으로 전달하는 코드)은 존재하지 않습니다. `sendToBattleSession()`
(`dummy-multi-server.js:51`)이 실제로 호출되는 곳은 `BattleStart` 전송과 `Finalized` 전송
두 곳뿐입니다.

### 1.3 Phase 2에서 확인했던 클라이언트 측 수신 로직과의 연결 (pcode)

Phase 2 조사에서 이미 확인된 내용입니다 (재인용):

- `BattleSocketInput.BroadcastMessage`(index 4)를 받으면 클라이언트는
  `socketInput_broadcastMessage(connectionId, BattleBroadcastMessage)`를 호출 →
  `param2.params`에서 `frame`, `commandString`을 꺼내 `otherBattleDerailleurs.get(connectionId)`
  (상대방별 렌더링/구동 객체, `Map<String, BattleDerailleur>`)를 찾아
  `.addSocketCommand(frame, commandString)`을 호출합니다.
- `BattleBroadcastMessage`는 단일 케이스 `Command(int,int,int,int,String)=0`로, 정확히
  "프레임 번호 + 커맨드 문자열" 형태의 페이로드를 실어나르도록 설계되어 있습니다.
- 즉 클라이언트는 **상대방의 행동을 받아서 렌더링할 준비(`otherBattleDerailleurs`)가 이미
  되어 있지만**, 서버가 한 번도 `BattleBroadcastMessage.Command`를 보내준 적이 없으므로
  상대방 캐릭터는 클라이언트 로컬의 자동 진행(autoplay) 폴백으로만 움직이는 것으로 보입니다.
  (Phase 2 로그에서 방 설정 페이로드에 `"autoplayMode":true`가 있었던 것과도 일치합니다.)

### 1.4 결론

**근본 원인이 거의 확정적으로 확인되었습니다:** 클라이언트는 실시간 입력 스트림
(`clientMessageKind === 1`, 위 1.1의 형태)을 정상적으로 서버에 전송하고 있지만, 서버는 이를
완전히 무시하고 상대방에게 릴레이하지 않습니다. 따라서 각 클라이언트는 자기 자신의 입력만 보고
상대방은 동기화되지 않습니다.

**Codex가 구현해야 할 작업 방향 (제안, 미구현):**
1. `clientMessageKind === 1`로 들어오는 메시지의 정확한 구조를 추가로 디코딩/확정한다
   (현재 확인된 건 `[1, [subKind, seq, ?, ?, len, base64payload]]` 형태라는 것과, payload
   안에 송신자 connectionId 문자열이 들어있다는 것까지입니다. `BattleSocketCommand` /
   `BattleUserCommand` pcode를 더 정밀하게 따라가면 정확한 필드 의미를 알 수 있을 것입니다).
2. 이 메시지를 수신하면, 송신자를 제외한 같은 세션의 다른 `battleSockets`에게
   `BattleSocketInput.BroadcastMessage(connectionId, BattleBroadcastMessage.Command(...))`
   형태로 그대로(혹은 frame/command만 추출해) 릴레이한다.
   (`sendToBattleSession()`이 이미 세션 내 전체 브로드캐스트를 지원하므로, 송신자 제외 필터만
   추가하면 재사용 가능해 보입니다.)

---

## 2. 종료 후 "No.H404" 오류 — 원인: `/multi_battle_quest/finish` 라우트가 서버에 없음

### 2.1 직접 증거 (`.logs/http/2026-06-30T12-20-4*-404-POST-...multi_battle_quest_finish.json`)

배틀 종료 직후(위 1.1 로그의 `battle_close` 직후) 8초 동안 클라이언트가 같은 엔드포인트를
**12회 연속 재시도**합니다:

```
POST /latest/api/index.php/multi_battle_quest/finish
12:20:40.918Z, 12:20:41.7xx, ... 12:20:48.111Z   (총 12회, 약 0.65초 간격)
```

서버 응답은 매번:

```json
{"statusCode": 404, "payload": "{\"error\":\"Not Found\",\"message\":\"Route POST:/latest/api/index.php/multi_battle_quest/finish not found\"}"}
```

이건 Fastify가 **라우트 자체가 등록되지 않았을 때** 자동으로 내려주는 표준 404이며 (핸들러
내부에서 분기로 떨어진 게 아님), 즉 버그가 아니라 **단순 미구현**입니다.

### 2.2 코드 확인

`src/routes/api/multiBattleQuest.ts`에 등록된 라우트는 다음이 전부입니다:

```
GET  /debug_rooms, /debug_room
POST /get_rooms, /create_room, /prepare, /search_room, /select_room,
     /share_room, /restore_room, /disband_room, /summon, /start, /abort
```

**`/finish`가 없습니다.** 반면 싱글 플레이용 `src/routes/api/singleBattleQuest.ts`에는
`fastify.post("/finish", ...)` (96번 줄~)가 완전히 구현되어 있고, 클리어 랭크 계산 / 보상 지급 /
퀘스트 진행도 갱신 / `rush_event` 처리까지 다 들어 있습니다 — **이게 Codex가 참고할 기존
패턴**입니다.

### 2.3 멀티 전용으로 추가 처리가 필요한 요청 바디 필드 (404 로그에서 확인)

싱글 `/finish`의 `FinishBody`와 비교했을 때, 멀티 클라이언트가 실제로 보내는 바디에는
다음과 같은 **멀티 전용 필드들이 추가**로 있습니다 (`multiBattleQuest.ts`에 아직 타입/처리
없음):

- `play_id` (싱글에도 있지만 `category`는 `2`로 옴 — `category` 필드 자체는 동일)
- `mate_player_result`: 배열, 각 원소가
  `{ "contribution_score": number, "viewer_id": number, "com_id": number, "score": number }`
  → 같이 플레이한 상대방의 결과 데이터. 호스트(`is_host: true`)가 보내는 요청에는 게스트의
  결과가, 게스트가 보내는 요청에는 호스트의 결과가 들어올 것으로 추정됩니다.
- `statistics.is_host`, `statistics.is_mvp`, `statistics.average_rtt`, `statistics.max_rtt`
  → 멀티 한정 통계 필드.
- `statistics.party.unison_characters` / `ability_soul_ids` 등은 싱글의 `QuestStatistics`
  타입과 구조는 같지만, 실제 페이로드가 훨씬 큼 (zone별 상세 통계, 멤버별 상세 통계 등 —
  이 부분은 싱글 `/finish`에서도 안 쓰는 필드이므로 그대로 무시해도 무방해 보입니다).
- `api_count: 6` (싱글은 보통 더 작은 값).
- `reproduce_log_data`: 디버그/로깅용으로 보이며 서버 로직에는 불필요해 보입니다.

응답 포맷은 싱글 `/finish`와 거의 동일한 `data_headers` + `data{user_info, rewards, ...}`
구조일 가능성이 높지만, `"is_multi": "single"` 대신 `"is_multi": "multi"`가 들어가야 할 것으로
보입니다 (`/start`의 멀티 버전인 `multiBattleQuest.ts`의 `/start` 핸들러가 이미
`"is_multi": "multi"`를 응답하고 있어 패턴이 일치합니다 — `multiBattleQuest.ts:640`).

### 2.4 결론

**원인이 100% 확정적으로 확인되었습니다.** `/multi_battle_quest/finish` 라우트가 서버에
아예 등록되어 있지 않아 클라이언트가 배틀 종료 후 결과 제출을 12회 재시도하다 모두 404를 받고,
클라이언트가 이를 치명적 오류로 처리해 "No.H404"를 띄우고 타이틀로 돌아갑니다.

**Codex가 구현해야 할 작업 방향 (제안, 미구현):**
1. `multiBattleQuest.ts`에 `singleBattleQuest.ts`의 `/finish`를 참고해 `POST /finish`를 추가.
2. `category`/퀘스트 조회는 멀티 라우트의 기존 `findRoomForBody`/룸 상태를 활용하거나,
   싱글처럼 `activeQuests`에 준하는 멀티 전용 진행 상태 테이블이 필요할 수 있음 (현재
   `multiBattleQuest.ts`에는 싱글의 `activeQuests` 같은 "현재 진행 중인 멀티 퀘스트" 추적 테이블이
   없어 보입니다 — `/start`가 `activeQuests`에 기록하지 않음).
3. 응답에 `"is_multi": "multi"`를 사용하고, `mate_player_result`는 일단 그대로 받아만 두고
   (보상 계산에 직접 안 써도) 200 응답만 정상적으로 내려주면 클라이언트 쪽 H404는 해소될 것으로
   보입니다 — 보상 정확도는 별도 후속 작업으로 분리 가능.

---

## 3. 두 이슈의 인과관계 메모

두 증상은 **서로 독립적인 원인**입니다 (하나를 고친다고 다른 하나가 같이 고쳐지지 않습니다):
- 동기화 문제는 TCP 배틀 소켓의 실시간 커맨드 릴레이 부재.
- H404는 배틀 종료 후 HTTP 결과 제출 라우트 부재.

다만 우선순위상 **2번(H404)이 막혀 있으면 멀티 플레이를 끝까지 테스트할 수 없으므로** 먼저
고치는 게 검증 사이클을 짧게 만들 것으로 보이고, 1번(동기화)은 실제 동작 확인을 위해
두 클라이언트를 띄워 액션을 주고받아야 하므로 테스트 비용이 더 큽니다.
