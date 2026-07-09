# 멀티플레이 매칭 타임아웃 및 봇 채우기 조사

## 확인한 근거

- `MeetingServerMessage`에는 매칭 카운트다운용 메시지가 이미 존재한다.
  - `RemainingTime(int)` = constructor index `7`
  - `StartRemainingTime(int)` = constructor index `9`
- `MeetingNotifyMessage`에는 클라이언트가 보내는 자동 출발 토글이 존재한다.
  - `ChangeAutoStart(Boolean)` = constructor index `8`
- 기존 realtime 서버 구현은 `StartRemainingTime`, `RemainingTime`, `ChangeAutoStart`를 처리하지 않았다.
- 기존 battle 시작 대기 조건은 `session.mates.size` 전체를 기준으로 했다. 이 상태에서 가짜 참가자를 단순히 `mates`에 넣으면 가짜 참가자의 battle socket은 절대 연결되지 않으므로 로딩 또는 `대기 중...`에서 멈출 수 있다.

## 이번 구현 방향

- 서버가 `ChangeAutoStart`를 받으면 룸 상태의 자동 출발 여부를 저장한다.
- 자동 출발이 켜져 있고 방이 가득 차지 않았으면 `StartRemainingTime`과 `RemainingTime`을 보낸다.
- 제한 시간이 끝나면 빈 슬롯을 서버 측 가짜 참가자로 채우고 `Start`를 전송한다.
- 가짜 참가자는 룸 UI와 `Start` payload에는 포함하지만, battle socket 대기 인원에는 포함하지 않는다.
- 전투 종료 후 룸으로 돌아갈 때 가짜 참가자는 제거한다.
- `RemainingTime`은 클라이언트가 기존 해산 카운트다운 UI로 표시한다. 서버 메시지에는 초 값만 있고 문구 문자열이 없으므로 서버만 수정해서 "NPC와 함께 자동으로 시작됩니다" 같은 문구로 바꿀 수는 없다.
- 화면 알림이 너무 자주 뜨지 않도록 `RemainingTime`은 30, 10, 5, 4, 3, 2, 1초에만 전송한다.

## 테스트할 항목

1. 호스트 혼자 방을 만든 뒤 AUTO가 켜져 있을 때 남은 시간 UI가 표시되는지 확인한다.
2. 설정된 시간이 지나면 빈 슬롯이 NPC 형태로 채워지는지 확인한다.
3. 자동으로 로딩 화면으로 넘어가는지 확인한다.
4. 로딩이 `0%`, `15.15%`, `대기 중...`에서 멈추지 않고 전투 시작까지 가는지 확인한다.
5. 전투 후 `룸으로 돌아가기`를 눌렀을 때 가짜 참가자가 룸에 남지 않는지 확인한다.
6. 실제 게스트가 중간에 들어오면 카운트다운이 유지되거나 방이 가득 찼을 때 중단되는지 확인한다.
7. AUTO를 끄면 countdown이 멈추는지 확인한다.

## 환경변수

- `STARPOINT_DUMMY_MULTI_AUTOFILL_BOTS`
  - `1`: 기능 활성화
  - `0`: 기능 비활성화
- `STARPOINT_DUMMY_MULTI_AUTOFILL_SECONDS`
  - countdown 초 단위 값
  - Docker 기본값은 `60`

## 주의점

- 현재 가짜 참가자 payload는 실제 참가자 payload를 복제한 뒤 connection/viewer 식별자와 이름, ready state만 바꾼다.
- 클라이언트가 별도의 NPC 전용 필드를 요구하는지 아직 확인되지 않았다.
- 따라서 이 기능은 우선 실험 기능으로 취급하고, 실제 화면 표시와 전투 진입 결과를 기준으로 payload를 좁혀야 한다.

## NPC 파티 구성 개선 후보

현재 방식은 호스트가 선택한 파티를 복제하기 때문에, 강한 호스트가 혼자 방을 만든 뒤 NPC와 출발하는 것이 실제 3인 파티보다 과하게 효율적일 수 있다.

개선 방향:

- realtime 서버가 host viewer id를 기준으로 Starpoint HTTP 서버의 내부 API를 호출한다.
- HTTP 서버는 해당 플레이어의 저장 데이터에서 보유 캐릭터 목록을 반환한다.
- realtime 서버는 보유 캐릭터 중 12개를 뽑아 두 개의 NPC 파티를 만든다.
- 장비/어빌리티 소울은 우선 비우거나 낮은 효율로 구성한다.
- 추후 옵션으로 NPC 강도 배율을 둘 수 있다.

이 방향이 안전한 이유는 클라이언트 변조 없이 서버가 이미 보내는 mate/start payload만 조정하기 때문이다. 다만 실제 mate payload에서 어떤 필드가 파티 표시와 전투 성능에 관여하는지 추가 로그로 확인해야 한다.
