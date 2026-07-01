# 전투 시작("대기 중...") 미해결 이슈 분석 (2026-06-30)

> 이 문서는 Codex가 다음 작업을 이어갈 때 참고하도록 Claude가 pcode(디컴파일된 클라이언트 바이트코드)와
> 실제 TCP 로그를 대조 분석해서 작성한 것입니다. **코드를 수정하지 않고 분석만 진행했습니다.**

증상: HTTP API(방 생성/검색/참가/준비/시작)는 정상 동작하고, 호스트/게스트 모두 전투 씬에 진입해
필드/배경/HP바까지 렌더링되지만 "대기 중..." 오버레이가 사라지지 않고, 약 2분 후 클라이언트 쪽에서
조용히 TCP 연결을 끊습니다.

---

## 1. 확인된 사실 (pcode 인용 포함)

### 1.1 "대기 중..." 오버레이를 띄우고 닫는 코드

클라이언트 상태 클래스 `pinball.scene.battle.state.BattleSceneWaitForMateStateImpl`
(`.analysis/ffdec-boot-full/scripts/§–§/§‒§/ￚ/ￚ/§‑§/§㆒§/§㇐§/ｰ/§–§/§‒§/§㇐§/§−§/ー/§‒§/§㆒§/int.pcode`,
686줄, 디버그 메타데이터로 클래스명 확인됨)가 이 오버레이를 전담합니다.

- `run()` (생성자가 `addRunHandler(this.run)`로 등록) → 씬 진입 시
  `ProcessingDialogKind.WaitingMate`로 다이얼로그를 생성하고
  `scene.dialog.startBattleDialog(this.dialog)`를 호출 — **이게 "대기 중..." 오버레이를 띄우는 코드.**
- `serverMessage_BattleStart()` → `this.dialog.closeThen(this.startPlaying)` 호출 후 `true` 반환.
  **이게 오버레이를 닫고 `scene.startPlaying()`으로 넘어가는, 유일하게 확인된 해제 경로입니다.**
- `socketInput_serverMessage(BattleServerMessage)` 디스패치 (index 0~4):
  - 0 `Leave` → `false` (무시)
  - 1 `BattleStart` → `serverMessage_BattleStart()` 호출 (위 함수)
  - 2 `Finalized` → **에러 5708 `"バトルが開始される前に終了されました。"`(전투 시작 전 종료됨)를 throw**
  - 3 `Measurement` → `true` 반환만 하고 아무 동작 없음
  - 4 `LineSpeedWarning` → `false`
- `socketInput(BattleSocketInput)` 디스패치 (index 0~5):
  - 0 `Error` → 다이얼로그 닫고 에러 처리
  - 1 `Denied`, 2 `Connected` → 둘 다 `socketInput_connected()` 호출
  - 3 `ServerMessage` → 위 `socketInput_serverMessage` 호출
  - **4 `BroadcastMessage`, 5 `SendMessage` → 둘 다 그냥 `false`, 즉 이 상태에서는 완전히 무시됨**
- `update()`: 매 프레임 `currentFrame`을 증가시키며, `currentFrame >= <TIMEOUT_CONST>`이면
  `dialog.closeThen(this.openTimeoutErrorDialog)` 호출 → 이게 약 2분 후 발생하는 타임아웃입니다.

### 1.2 메시지 포맷 검증 — 우리 서버가 보내는 것은 형식상 100% 정확함

- `BattleServerMessage` enum (`pinball/online/battle/message/BattleServerMessage.pcode`):
  `Leave=0, BattleStart=1, Finalized=2, Measurement=3, LineSpeedWarning=4`.
  `BattleStart`는 파라미터 없음(`pushnull`) → wire 표현은 `[1]`.
- `BattleSocketInput` enum: `ServerMessage=3` → wire 표현은 `[3, innerArray]`.
- 결론: 서버가 보내는 `[3,[1]]`은 정확히
  `BattleSocketInput.ServerMessage(BattleServerMessage.BattleStart)`이고,
  `BattleSceneWaitForMateStateImpl.serverMessage_BattleStart()`로 정확히 라우팅되어야 하는 형태입니다.
  **포맷 문제가 아닙니다.**
- 서버의 `sendToBattleSession()` (`scripts/dummy-multi-server.js:51`)도 `session.battleSockets`
  전체를 순회하며 양쪽 모두에 전송하는 것을 확인했습니다 — 한쪽에만 보내는 버그도 아닙니다.

### 1.3 실제 로그 재검증 (`.logs/multi-realtime/dummy-2026-06-30T11-10-00-949Z.log`)

```
11:11:08.586  battle_connected 직후, 두 소켓에 [3,[1]] 1차 전송 (씬 로딩 전 — 의미 없을 가능성 높음)
11:11:14.427  게스트 SceneReady [0,[0]] 수신 (ready=1/2, 아직 BattleStart 안 보냄)
11:11:17.785  호스트 SceneReady [0,[0]] 수신 (ready=2/2) → 즉시 [3,[1]] 2차 전송 (양쪽)
11:11:18.787 ~ 11:11:25.787  1초 간격으로 [3,[1]] 8회 재전송 (count=1~8)
11:11:26.786  battle_scene_start_retry_done — 이후로는 heartbeat/Measurement만 반복
```

**핵심 관찰:** 호스트의 SceneReady(11:11:17.785) 이후에 보낸 9번의 `[3,[1]]`은 모두
"양쪽이 이미 대기 다이얼로그를 띄운 상태"에서 타이밍상 정확히 도달했어야 합니다.
그런데도 전혀 반응이 없습니다.

---

## 2. 사용자 질문 7개에 대한 답변

1. **어떤 함수가 오버레이를 해제하는가?**
   `BattleSceneWaitForMateStateImpl.serverMessage_BattleStart()` (위 1.1 참조). 이 함수가
   `dialog.closeThen(startPlaying)`을 호출하는 게 유일한 해제 경로입니다.

2. **SceneReady 이후 정확한 메시지 순서는?**
   pcode상으로는 추가 핸드셰이크가 필요 없습니다. 이 상태가 실제로 처리하는 서버 메시지는
   `BattleStart`/`Finalized`/`Measurement`/`Leave`/`LineSpeedWarning` 뿐이고, 그중
   `BattleStart` 단 하나만 와도 충분히 다이얼로그가 닫혀야 합니다. **"순서"가 문제가 아니라
   "도달 여부"가 문제로 보입니다.**

3. **`SendMessage`/`BroadcastMessage`/`BattleSceneCommand` 등 추가 메시지가 필요한가?**
   아니오. 이 상태(WaitForMate)는 `BroadcastMessage`(4)와 `SendMessage`(5)를
   **명시적으로 무시(`return false`)** 합니다. 지금 단계에서는 보내봐야 효과가 없습니다.
   (단, `BattleSceneCommand.OpenWaitingMateDialog`는 별도 용도 — 아래 4.1 참고)

4. **서버가 `BattleUserCommand`를 강제로 보내야 하는가?**
   아니오. `BattleSendMessage`는 `ForceUserCommand(BattleUserCommand)` 단일 케이스뿐이고,
   `distributeUserCommand()`로 가는 경로는 **Playing 상태**(WaitForMate 이후 상태)에서만
   의미가 있습니다. WaitForMate에서는 무시됩니다.

5. **공/좌표 공유는 어떤 타입으로 이루어지는가?**
   `BattleSocketCommand.User(BattleUserCommand)` (클라이언트 송신측, index=0)과,
   서버가 한쪽의 입력을 다른 쪽에 중계하는 `BattleBroadcastMessage.Command(int,int,int,int,String)`
   → `otherBattleDerailleurs.get(connectionId).addSocketCommand(frame, commandString)` 경로
   (Playing 상태 전용 — `otherBattleDerailleurs`를 보유한 파일에서 확인).
   **둘 다 WaitForMate 단계에서는 무관합니다.**

6. **`BattleBroadcastMessage`의 5번째 파라미터(String) 직렬화 포맷은?**
   아직 미해결입니다 (`TypePackerResource2.pcode`가 24만 줄이라 전수 검색 못함).
   다만 현재 막힌 지점이 WaitForMate 단계이므로 **지금 당장은 우선순위가 낮습니다.**

7. **클라이언트가 heartbeat만 보내는 이유는?**
   "로컬 배틀 드라이버가 아직 시작 안 해서" 쪽이 맞습니다 — `BattleSceneWaitForMateStateImpl`에는
   `BattleSocketCommand.User`를 내보내는 코드가 전혀 없고, 오직 `sendHeartBeat()`만 호출합니다.
   서버가 무언가를 "빠뜨려서" 막힌 게 아니라, **클라이언트가 아직 이 상태를 벗어나지 못해서**
   입력 송신 자체가 시작되지 않는 것으로 보입니다.

---

## 3. 남은 미스터리 — 왜 형식이 맞는 `BattleStart`가 효과가 없는가

포맷·라우팅 로직·서버의 양쪽 전송까지 전부 pcode상으로는 맞는데도 동작하지 않습니다.
가능성 순으로 정리하면:

1. **(가능성 높음) 서버→클라이언트 방향 메시지가 battle 소켓에서 실제로는 전혀
   파싱/디스패치되지 않고 있을 가능성.** 지금까지 서버가 battle 소켓으로 보낸 건
   `[0,connId,""]`(핸드셰이크, 작동 확인됨 — 다이얼로그가 뜨는 것 자체가 증거),
   `BattleStart`(반응 없음), `Measurement`(반응 없음, 하지만 **이 메시지는 원래 아무 동작도
   안 하므로 "반응 없음"이 "도달 안 함"의 증거가 되지 못함**) 뿐입니다.
   즉 BattleStart와 Measurement 둘 다 "효과 없음"인데, Measurement는 애초에 효과가 없는
   메시지라서 지금까지의 로그만으로는 **"서버 메시지가 클라이언트에 도달하긴 하는지"
   자체를 검증할 방법이 없었습니다.**

2. **(가능성 낮음) 다이얼로그가 실제로는 `BattleSceneWaitForMateStateImpl`이 아닌 다른 코드가
   띄운 것.** `BattleSceneCommand.OpenWaitingMateDialog`를 사용하는 별도 경로도 발견했으나
   (아래 4.1), 이건 "존 전환 중 파트너 대기" 용도라 실제 게임플레이가 시작된 *이후*에만
   발생합니다. 로그상 클라이언트가 `BattleSocketCommand.User`/조작 패킷을 한 번도 보낸 적이
   없으므로(즉 실제 플레이가 시작된 적이 없으므로), 이 가능성은 낮다고 판단합니다.

3. **(가능성 낮음) 상태 전환 타이밍 문제.** 호스트 SceneReady 이후 9번이나 재전송했는데도
   효과가 없으므로, "아직 상태에 진입 전이라 놓쳤다"는 설명은 1~2번째 전송에는 맞을 수
   있어도 8번 재시도 전체를 설명하지 못합니다.

**결론: 다음 단계는 "BattleStart가 막힌 이유를 더 추측하는 것"이 아니라, 서버→클라이언트
메시지가 battle 소켓에서 애초에 처리되긴 하는지를 직접 확인하는 진단 실험입니다.** (4.2 참고)

---

## 4. 다음 실험

### 4.1 위험한 실험 (하지 말 것 — 이미 실패 확인됨)

- `BattleSocketInput.Connected [2, connectionId]`를 SceneReady **이후**에 재전송 →
  C5602 크래시 발생 확인됨. (`socketInput_connected()`가 재진입을 가정하지 않은 초기화
  로직일 가능성이 높음 — 핸드셰이크 직후 1회만 의미가 있을 수 있음, 검증 안 됨)
- `BattleBroadcastMessage.Command(...)` (`PrimarySquadLaunched` 등)를 WaitForMate 단계에서
  전송 → pcode 확인 결과 **이 상태에서는 애초에 무시되는 메시지**이므로 효과가 없고,
  실제 크래시 원인은 다른 곳(아마 직렬화 포맷 불일치)일 가능성. 직렬화 포맷(Q6)을
  먼저 확인하기 전까지는 재시도하지 말 것.

### 4.2 안전한 진단 실험 (추천 — 1회성 수동 테스트로)

**`BattleServerMessage.Finalized` (index=2)를 battle 소켓 연결 직후 1회만 보내보는 테스트.**

```json
[3,[2]]
```

이 메시지는 `BattleSceneWaitForMateStateImpl.socketInput_serverMessage`에서
**무조건 에러 5708 ("バトルが開始される前に終了されました。")를 throw**하도록 되어 있습니다
(1.1 참고). 이게 핵심 진단 포인트입니다:

- **클라이언트 화면에 해당 일본어 에러 다이얼로그/크래시가 뜨면** → `ServerMessage`가
  battle 소켓에서 정상적으로 파싱·디스패치되고 있다는 확실한 증거. 그러면 문제는
  `BattleStart`(index=1) 자체나 `serverMessage_BattleStart()` 내부 로직(예: `startPlaying()`
  진입 조건)으로 좁혀집니다.
- **아무 반응도 없으면** → `ServerMessage` 디스패치 자체가 battle 소켓에서 전혀 작동하지
  않는다는 뜻이므로, 조사 방향을 전송 계층(프레이밍, 소켓 read 루프)이나 상태 진입 여부
  쪽으로 돌려야 합니다.

주의: 이 테스트는 해당 배틀 세션을 의도적으로 에러로 종료시킵니다. 운영 중인 재시도
루프에 넣지 말고, 별도의 1회성 디버그 빌드/플래그로 격리해서 테스트하는 것을 권장합니다
(예: 환경변수로 켜고 끌 수 있는 디버그 전용 분기).

### 4.3 추가로 확인하면 좋은 것 (우선순위 낮음)

- `TypePackerResource2.pcode`에서 Haxe `Serializer`/`Unserializer` 호출부를 찾아
  `BattleBroadcastMessage.Command`의 5번째 파라미터(String) 포맷 확인 (Q6) — 지금 막힌
  지점과 무관하므로 4.2 실험 이후로 미뤄도 됩니다.
- `otherBattleDerailleurs`가 채워지는 시점과 키 포맷 — 역시 Playing 상태 진입 이후에나
  의미 있음.

---

## 5. 분석에 사용한 파일

- `.analysis/ffdec-boot-full/scripts/§–§/§‒§/ￚ/ￚ/§‑§/§㆒§/§㇐§/ｰ/§–§/§‒§/§㇐§/§−§/ー/§‒§/§㆒§/int.pcode`
  (`BattleSceneWaitForMateStateImpl`, 686줄, 전체 확인)
- `.analysis/ffdec-socket-pcode/scripts/pinball/online/battle/message/BattleServerMessage.pcode`
- `.analysis/ffdec-socket-pcode/scripts/pinball/online/battle/message/BattleNotifyMessage.pcode`
- `.analysis/ffdec-socket-pcode/scripts/pinball/online/battle/message/BattleSocketCommand.pcode`
- `.analysis/ffdec-socket-pcode/scripts/pinball/online/battle/message/BattleSendMessage.pcode`
- `.analysis/ffdec-socket-pcode/scripts/pinball/online/battle/message/BattleSocketInput.pcode`
- `.analysis/ffdec-socket-pcode/scripts/pinball/online/HandshakeResult.pcode`
- `.analysis/ffdec-boot-full/scripts/pinball/online/BattleZoneCoopCommand.pcode`
- `.analysis/ffdec-boot-full/scripts/pinball/scene/battle/command/BattleSceneCommand.pcode`
- `.analysis/ffdec-boot-full/scripts/§⎯§/§−§/§‒§/§‒§/§‑§/§㇐§/§㆒§/§—§/§—§/§—§/ー/ー/§㇐§/§⼀§/§⎯§/int.pcode`
  (`ZoneState`/`waitForTransition()` — OpenWaitingMateDialog의 *다른* 트리거 경로, 무관함으로 판단)
- `scripts/dummy-multi-server.js` (`sendToBattleSession`, battle 소켓 핸드셰이크/재시도 로직)
- `.logs/multi-realtime/dummy-2026-06-30T11-10-00-949Z.log` (실제 이벤트 타임라인)
