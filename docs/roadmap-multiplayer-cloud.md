# Starpoint 멀티플레이 완성 + 클라우드 배포 로드맵

> 이 문서는 Claude가 프로젝트 전체를 분석해서 작성한 **아이디어 제안 문서**입니다.  
> Codex는 이 구조를 참고하되, 사용자와 협의해 더 나은 방향이 있다면 자유롭게 변경해도 됩니다.  
> 핵심 목표: **친구 10명 이내가 WireGuard QR 하나로 접속해서 멀티플레이 가능한 서버**

---

## 목차

1. [현재 프로젝트 구조](#1-현재-프로젝트-구조)
2. [리소스 추정 및 클라우드 선택](#2-리소스-추정-및-클라우드-선택)
3. [WireGuard DNS 리다이렉트 — mitmproxy 없이 가능한가?](#3-wireguard-dns-리다이렉트--mitmproxy-없이-가능한가)
4. [Phase 1 — 즉시 수정 (룸 넘버·해산)](#4-phase-1--즉시-수정)
5. [Phase 2 — 멀티플레이 완성](#5-phase-2--멀티플레이-완성)
6. [Phase 3 — 관리 기능 강화](#6-phase-3--관리-기능-강화)
7. [Phase 4 — Docker 컨테이너화 (제안)](#7-phase-4--docker-컨테이너화-제안)
8. [Phase 5 — 클라우드 배포](#8-phase-5--클라우드-배포)
9. [미구현 API 목록](#9-미구현-api-목록)
10. [실시간 서버(18888) 프로토콜 현황](#10-실시간-서버18888-프로토콜-현황)

---

## 1. 현재 프로젝트 구조

```
안드로이드 기기
  ↓ WireGuard VPN
mitmproxy(:8081)        ← DNS 스푸핑 + HTTPS 인터셉트
  ↓ HTTP 리다이렉트
Starpoint HTTP(:8000)   ← Node.js/Fastify + TypeScript
  ├── /latest/api/index.php/*   게임 API (msgpack)
  ├── /patch/Live/2.0.0/*       CDN 정적 파일 (.cdn/ 폴더)
  ├── /openapi/*, /infodesk/*   카카오 인증
  └── /                         웹 관리 패널
Dummy Realtime(:18888)  ← scripts/dummy-multi-server.js (TCP/UDP)
SQLite                  ← .database/ 폴더
```

**현재 .env:**
```env
CDN_DIR=".cdn"
LISTEN_HOST="localhost"
LISTEN_PORT="8000"
STARPOINT_MULTI_HOST="192.168.0.134"
STARPOINT_MULTI_PORT="18888"
# 아직 없는 것:
# STARPOINT_PUBLIC_HOST  ← room_url 생성에 필요
# STARPOINT_PUBLIC_SCHEME
```

---

## 2. 리소스 추정 및 클라우드 선택

### 10명 동시 접속 시 예상 메모리 사용량

| 프로세스 | 예상 RAM |
|---------|---------|
| Node.js — Starpoint HTTP 서버 | ~100–150 MB |
| Node.js — Realtime 서버(18888) | ~30–50 MB |
| nginx (HTTPS 프록시) | ~20–30 MB |
| dnsmasq | ~5 MB |
| WireGuard (커널 모듈) | 무시 가능 |
| OS 오버헤드 (Ubuntu) | ~200–300 MB |
| **합계** | **~400–550 MB** |

SQLite는 파일 기반이라 RAM에 큰 영향 없음. 10명이 동시에 게임을 진행해도 게임 API는 DB read/write가 주라 CPU도 여유로움.

**결론: 1 OCPU + 1 GB도 이론상 가능하지만 OS + 서버 합산이 아슬아슬. 1 OCPU + 2–4 GB면 충분히 여유로움.**

### Oracle Cloud Free Tier — 비용 없음

Oracle Cloud의 **Always Free** 티어는 영구 무료입니다. 과금이 없어요.

| 인스턴스 종류 | Always Free 한도 |
|-------------|----------------|
| AMD x86 Micro | 1/8 OCPU + 1 GB RAM × 2대 |
| **ARM Ampere A1** | **4 OCPU + 24 GB RAM (총량, 자유롭게 분배)** |

Ampere A1 할당량에서 **1 OCPU + 6 GB** 인스턴스 1대를 만드는 것만으로도 이 프로젝트에 충분하며, 비용은 0원입니다.

**CDN 파일이 변수**: 게임 CDN은 수 GB 될 수 있음. 부트볼륨 50 GB 기본 제공으로 대부분 커버 가능.

### AWS 대안 (비용 발생)

| 인스턴스 | 스펙 | 월 비용 (On-Demand) |
|---------|------|-------------------|
| t3.micro | 2 vCPU, 1 GB | ~$8–10 |
| t3.small | 2 vCPU, 2 GB | ~$15–18 |

한두 달 운영 목적이라면 Oracle Free Tier로 충분. 비용 절감 차원에서 Oracle 우선 시도 권장.

---

## 3. WireGuard DNS 리다이렉트 — mitmproxy 없이 가능한가?

### 3-1. 현재 흐름 (mitmproxy 방식)

```
기기 → WireGuard 터널
    → mitmproxy (DNS 인터셉트 + HTTPS MITM)
        ↳ DNS: na.wdfp.kakaogames.com → 198.51.100.140 (블랙홀)
        ↳ HTTP: 해당 트래픽을 localhost:8000으로 리다이렉트
    → Starpoint(:8000)
```

mitmproxy가 **두 가지 역할**을 동시에 합니다:
1. DNS 스푸핑 (도메인 → 서버 IP 변환)
2. HTTPS 인터셉트 (SSL 복호화 후 HTTP로 변환) ← 여기에 mitmproxy CA 설치 필요

### 3-2. mitmproxy 없는 방식의 가능성 분석

사실 `deployment/` 폴더를 보면 이미 mitmproxy 없이 동작할 인프라가 준비되어 있습니다:
- `deployment/linux/dns/starpoint_proxy_dnsmasq.conf` — DNS 리다이렉트
- `deployment/nginx/starpoint_proxy.nginx` — HTTPS 종료 + HTTP 프록시
- `deployment/ssl/ssl_gen_self_sign_certs.sh` — 자체 서명 CA 인증서 생성

**즉, dnsmasq + nginx + 자체 CA를 사용하면 mitmproxy 없이도 동일한 동작이 가능합니다.**

#### 제안 흐름 (mitmproxy 제거)

```
기기 → WireGuard 터널 (DNS = 서버 IP 설정)
    → dnsmasq (서버 위에서 실행)
        ↳ DNS 쿼리: na.wdfp.kakaogames.com → 서버 IP
    → nginx (서버 위에서 실행)
        ↳ 포트 443 수신, 자체 서명 SSL 종료
        ↳ → localhost:8000 HTTP 프록시
    → Starpoint(:8000)
```

#### WireGuard 피어 설정에서 DNS 자동 지정

WireGuard 피어 conf의 `[Interface]` 섹션에 `DNS` 항목을 추가하면, 해당 VPN이 활성화될 때 기기의 DNS가 자동으로 지정한 서버로 바뀝니다:

```ini
[Interface]
PrivateKey = <자동 생성>
Address = 10.13.13.2/32
DNS = 10.13.13.1          ← 서버 IP (WireGuard 내부 주소)

[Peer]
PublicKey = <서버 공개키>
Endpoint = <서버 공인 IP>:51820
AllowedIPs = 10.13.13.0/24, 198.51.100.140/32
```

`AllowedIPs`에 `198.51.100.140/32` (기존 mitmproxy가 DNS로 지정한 블랙홀 IP)를 추가하면, 게임 도메인이 dnsmasq에 의해 198.51.100.140으로 해석된 뒤 WireGuard 터널을 통해 서버로 도달합니다. 그러면 nginx가 이를 받아 starpoint로 프록시합니다.

또는 dnsmasq에서 게임 도메인을 서버의 WireGuard 내부 IP(`10.13.13.1`)로 직접 응답해도 됩니다.

### 3-3. 유일한 장벽 — Android SSL 인증서 신뢰 문제

nginx가 자체 서명 인증서를 사용하면, Android 기기가 해당 CA를 신뢰해야 HTTPS 연결이 됩니다.

Android API 24+는 사용자가 수동 설치한 CA(user CA)를 기본적으로 신뢰하지 않습니다. 이를 해결하는 방법은 두 가지입니다:

#### 방법 A — APK 수정 (Codex가 이미 APK를 다룰 수 있으므로 현실적)

`apktool`로 APK를 디컴파일해서 `network_security_config.xml`을 추가하는 방식:

1. APK 디컴파일:
   ```bash
   apktool d worldflipper_android_release.apk -o wdfp_src
   ```

2. `wdfp_src/res/xml/network_security_config.xml` 생성:
   ```xml
   <?xml version="1.0" encoding="utf-8"?>
   <network-security-config>
       <base-config>
           <trust-anchors>
               <certificates src="system"/>
               <certificates src="user"/>   <!-- user CA도 신뢰 -->
           </trust-anchors>
       </base-config>
   </network-security-config>
   ```

3. `wdfp_src/AndroidManifest.xml`에 속성 추가:
   ```xml
   <application
       android:networkSecurityConfig="@xml/network_security_config"
       ...>
   ```

4. 재패키징 및 서명:
   ```bash
   apktool b wdfp_src -o wdfp_patched.apk
   zipalign -v 4 wdfp_patched.apk wdfp_aligned.apk
   apksigner sign --ks my.keystore wdfp_aligned.apk
   ```

이후 유저 흐름:
1. 서버에서 발급한 CA 인증서(`.crt`) 파일을 기기에 다운로드
2. Android 설정 → 보안 → 인증서 설치 → CA 인증서
3. WireGuard QR 스캔 및 VPN 활성화
4. 수정된 APK 설치 후 게임 실행

#### 방법 B — 기존 mitmproxy 방식 유지

복잡성은 높지만 APK 수정 없이 동작. 현재 Nox 앱플레이어로 테스트하는 상황에선 mitmproxy CA를 Nox 시스템 인증서 저장소에 설치할 수 있어서 문제없이 사용 가능.

### 3-4. 결론 및 권장안

**단기 (지금 테스트 중)**: 방법 B (mitmproxy) 유지. 구조 변경보다 멀티플레이 기능 개발이 우선.

**중기 (클라우드 배포 시)**: 방법 A (APK 수정 + dnsmasq + nginx) 채택을 검토.  
이렇게 하면 유저는 WireGuard QR 스캔 + CA 인증서 설치 두 단계만 하면 됩니다.  
`deployment/` 폴더에 이미 dnsmasq 설정과 nginx 설정, SSL 스크립트가 모두 있어서 코드 자체는 많이 추가할 필요 없음.

mitmproxy 유지 vs APK 수정 선택은 Codex와 사용자가 판단하세요. 이 문서에서는 양쪽 모두 실현 가능함을 확인한 것으로 마칩니다.

---

## 4. Phase 1 — 즉시 수정

> 상세 원인 분석: [multiplayer-issues-analysis.md](multiplayer-issues-analysis.md)

### 4-1. restore_room에서 room_sequence로 룸 조회

**파일**: `src/routes/api/multiBattleQuest.ts`

클라이언트가 TCP 연결 후 약 20초 뒤 `[0,[5]]`를 보내고 TCP를 종료합니다. 그 뒤 `restore_room`을 `room_number: ""`, `room_sequence: 98171846`로 호출하는데, 현재 서버는 빈 `room_number`를 그대로 돌려줘서 UI에 빈칸이 표시됩니다.

**필요한 변경 포인트**:
- `rooms` Map 외에 `room_sequence → MultiRoom` 역방향 Map 추가
- `create_room`, `select_room`에서 룸 생성 시 두 Map 모두 등록
- `restore_room`에서 `room_number`가 없으면 `room_sequence`로 조회

### 4-2. disband_room 라우트 추가

**파일**: `src/routes/api/multiBattleQuest.ts`

`POST /multi_battle_quest/disband_room` 가 404입니다. 실서버 응답은 `data: []`(빈 배열) 입니다 (docs/routes/multi_battle_quest_disband_room.md 참조).

추가할 내용:
- 인터페이스: `{ viewer_id: number, room_number: string, api_count: number }`
- 처리: rooms Map에서 해당 룸 삭제
- 응답: `data: []`

### 4-3. TCP Notify kind=5 graceful 처리

**파일**: `scripts/dummy-multi-server.js`

`[0,[5]]` 수신 시 현재 "unhandled_client_message"로 기록되고 무시됩니다. kind=5의 정확한 의미는 APK 분석이 필요하지만, 당장은 로그 후 조용히 처리하면 됩니다. 연결이 끊기지 않도록 처리하거나, 이미 끊기는 동작이 의도적이라면 그대로 두어도 됩니다.

---

## 5. Phase 2 — 멀티플레이 완성

### 5-1. start / finish / abort 라우트 추가

**파일**: `src/routes/api/multiBattleQuest.ts`

세 엔드포인트 모두 아직 미구현입니다. 각각의 실서버 응답이 `docs/routes/`에 있습니다.

**최소 구현 우선순위**: start → abort → finish 순서 권장  
(start가 없으면 전투 자체를 시작 못하고, finish의 보상 계산은 나중에 정교화 가능)

**finish 보상 계산 참고**: `src/routes/api/singleBattleQuest.ts`의 finish 구현에서 경험치·아이템 처리 로직을 참고할 것.

#### start 최소 응답 (docs/routes/multi_battle_quest_start.md 기준)

```json
{
  "data_headers": { "result_code": 1, "viewer_id": ..., "servertime": ... },
  "data": {
    "user_info": { "stamina": 50, "stamina_heal_time": <servertime> },
    "category_id": <body.category>,
    "is_multi": "multi",
    "start_time": <servertime>,
    "quest_name": "Multi Quest",
    "mail_arrived": false
  }
}
```

#### finish 최소 응답 (docs/routes/multi_battle_quest_finish.md 기준)

```json
{
  "data_headers": { "result_code": 1, ... },
  "data": {
    "user_info": { "free_mana": 0, "exp_pool": 0, "free_vmoney": 0, "stamina": 50, "max_stamina": 50 },
    "add_exp_list": [],
    "character_list": [],
    "rewards": { "overflow_pool_exp": 0, "reward_pool_exp": 1000, "reward_mana": 500 },
    "item_list": {},
    "drop_score_reward_ids": [],
    "drop_rare_reward_ids": [],
    "mission_info": [],
    "is_multi": "multi",
    "category_id": <body.category>
  }
}
```

### 5-2. multi_invitation/join 라우트 추가

**목적**: `room_url`로 접근한 유저가 방에 참가하는 흐름

클라이언트가 `GET /multi_invitation/join?k={invitationKey}`를 호출하면 방 정보를 반환해야 합니다. 현재 `create_room`에서 생성되는 `invitationKey`로 역방향 조회가 필요합니다.

**필요한 것**:
- `invitationKey → MultiRoom` 역방향 Map 추가 (또는 기존 rooms Map에서 순회 검색)
- 신규 파일 또는 multiBattleQuest.ts에 `/multi_invitation/join` 라우트 추가
- server.ts에 `/multi_invitation` prefix로 등록

### 5-3. 실시간 서버 — 다중 유저 브로드캐스트

**파일**: `scripts/dummy-multi-server.js`

현재 각 TCP 연결이 독립적으로 상태를 관리합니다. 두 번째 유저가 같은 방에 들어올 때를 위해:

1. `roomNumber → Set<socket>` 맵을 서버 수준에서 관리
2. Enter(kind=0) 수신 시: 기존 멤버 전원에게 새 Mates 목록 브로드캐스트
3. Leave(kind=5) 수신 시: 나머지 멤버에게 업데이트된 Mates 브로드캐스트
4. Notify kind=10 (summon 결과 공유): 같은 방 멤버 전원에게 브로드캐스트

---

## 6. Phase 3 — 관리 기능 강화

### 6-1. 가챠 이벤트 선택기

**현재**: `web/pages/index.html`에서 `datetime-local` 입력으로 날짜/시간 직접 입력  
**개선**: 어떤 가챠 이벤트가 언제 열리는지 CDN 데이터에서 파싱해서 드롭다운으로 제공

**구현 포인트**:
1. `.cdn/` 폴더 내 가챠 이벤트 스케줄 데이터 파일 찾기 (Codex가 CDN 구조를 이미 알고 있으니 확인 부탁)
2. `GET /api/server/gacha-events` API 추가 — 이벤트 이름, 시작/종료 시간 반환
3. `web/pages/index.html`에 드롭다운 추가 — 선택 시 해당 시각으로 자동 입력

### 6-2. 전체 유저 아이템/재화 일괄 지급

**추가할 API**: `POST /api/admin/grant`

```typescript
interface GrantBody {
  playerIds: number[] | "all",
  type: "item" | "vmoney" | "free_vmoney" | "mana",
  itemId?: number,   // type이 "item"일 때
  amount: number
}
```

기존 `src/data/wdfpData.ts`의 플레이어 업데이트 함수 활용. 관리 패널 UI도 함께 추가.

### 6-3. 관리 패널 인증

클라우드 배포 시 `/` 접근이 공개되므로 최소한의 인증 추가 권장:

```env
STARPOINT_ADMIN_TOKEN="임의의 긴 토큰"
```

미들웨어에서 `Authorization: Bearer <token>` 헤더 또는 쿠키 확인.

### 6-4. WireGuard QR 코드 배포 페이지

Docker로 linuxserver/wireguard를 사용할 경우, 피어별 QR이 `/config/peer1/peer1.png` 등으로 자동 생성됩니다.

**추가할 것**:
- `GET /api/wireguard/peer/{n}/qr` — 해당 피어 QR 이미지 반환
- `web/pages/` 에 WireGuard 배포 페이지 추가

---

## 7. Phase 4 — Docker 컨테이너화 (제안)

이 섹션은 Claude의 제안입니다. Codex가 더 적합한 구조를 알고 있다면 바꿔도 됩니다.

### 7-1. 목표

```
CDN 파일만 준비하면 docker-compose up 한 줄로 어느 리눅스 서버에든 배포 가능
```

### 7-2. 컨테이너 구성

```yaml
# docker-compose.yml (제안)
services:
  starpoint:       # Node.js HTTP 서버
  realtime:        # TCP/UDP 18888 실시간 서버
  wireguard:       # VPN 서버 + QR 자동 생성
  dns:             # dnsmasq (게임 도메인 → 서버 IP)
  nginx:           # HTTPS 종료 (선택, mitmproxy 없이 가려면 필요)
```

### 7-3. Dockerfile 기본 설계

```dockerfile
# 빌드 스테이지
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# 실행 스테이지
FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/out ./out
COPY --from=builder /app/web ./web
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json .

# CDN과 DB는 볼륨 마운트 (이미지 크기 방지)
VOLUME ["/app/.cdn", "/app/.database"]
EXPOSE 8000
CMD ["node", "--env-file=.env", "out/server.js"]
```

### 7-4. 핵심 볼륨 구조

```
호스트 디렉토리
├── cdn-data/           → /app/.cdn (starpoint 컨테이너)
├── db-data/            → /app/.database (starpoint 컨테이너)
├── wireguard-config/   → /config (wireguard 컨테이너, QR 자동 생성)
├── .env                → 공통 환경변수
└── docker-compose.yml
```

### 7-5. .env 구조 (배포용)

```env
# 필수
SERVER_PUBLIC_IP=서버공인IP

# Starpoint
LISTEN_HOST=0.0.0.0
LISTEN_PORT=8000
CDN_DIR=/app/.cdn
STARPOINT_MULTI_HOST=${SERVER_PUBLIC_IP}
STARPOINT_MULTI_PORT=18888
STARPOINT_PUBLIC_HOST=${SERVER_PUBLIC_IP}:8000
STARPOINT_PUBLIC_SCHEME=http

# WireGuard
PEERS=10
WG_SERVERPORT=51820
WG_INTERNAL_SUBNET=10.13.13.0

# 관리자 인증 (선택)
STARPOINT_ADMIN_TOKEN=임의의긴토큰
```

---

## 8. Phase 5 — 클라우드 배포

### 8-1. Oracle Cloud Ampere A1 (무료) 절차

```
Oracle Cloud 계정 생성
→ Compute Instance 생성
  → Shape: Ampere A1 (ARM64)
  → OCPU: 1, Memory: 6 GB  (무료 한도 내)
  → OS: Ubuntu 22.04 ARM64
→ VCN Security List 포트 오픈:
  TCP: 8000 (starpoint), 18888 (realtime), 80, 443 (nginx 선택)
  UDP: 51820 (WireGuard), 18888 (realtime)

→ SSH 접속 후:
  curl -fsSL https://get.docker.com | sh
  git clone <starpoint 저장소> /opt/starpoint
  cd /opt/starpoint
  rsync -avz 로컬/.cdn/ ubuntu@서버:/opt/starpoint/cdn-data/   # CDN 파일 업로드
  cp .env.example .env && 편집
  docker-compose up -d
```

### 8-2. 포트 방화벽 요약

Oracle Cloud에서는 **VCN Security List**(인바운드 규칙)와 **서버 내 iptables** 양쪽을 모두 열어야 합니다.

| 포트 | 프로토콜 | 용도 |
|------|---------|------|
| 8000 | TCP | Starpoint HTTP API |
| 18888 | TCP+UDP | 실시간 멀티 서버 |
| 51820 | UDP | WireGuard VPN |
| 80, 443 | TCP | nginx (mitmproxy 제거 방식 선택 시) |

---

## 9. 미구현 API 목록

### 404 발생 중인 엔드포인트

| 엔드포인트 | 상태 | 우선순위 | 참조 |
|-----------|------|---------|------|
| `POST /multi_battle_quest/disband_room` | 404 | ★★★ | docs/routes/multi_battle_quest_disband_room.md |
| `POST /multi_battle_quest/start` | 미구현 | ★★★ | docs/routes/multi_battle_quest_start.md |
| `POST /multi_battle_quest/finish` | 미구현 | ★★★ | docs/routes/multi_battle_quest_finish.md |
| `POST /multi_battle_quest/abort` | 미구현 | ★★ | docs/routes/multi_battle_quest_abort.md |
| `GET /multi_invitation/join` | 미구현 | ★★ | 실서버 캡처 없음, 추정 필요 |

---

## 10. 실시간 서버(18888) 프로토콜 현황

### 확인된 메시지 형식 (JSON over TCP, `\0` 구분자)

#### 핸드셰이크

```
클라이언트 → {"socklet":"cooperation_room","questId":1001001,"questCategory":2,"viewerId":290468015,"roomNumber":"842780","reconnected":0}
서버       ← [0, "842780:290468015", ""]
```

#### 클라이언트 → 서버: `[0, [kind, ...args]]`

| kind | 추정 의미 | 내용 | 서버 현재 처리 |
|------|---------|------|-------------|
| 0 | Enter | `[0, [0, {mate 데이터}, 1]]` | Welcome + Mates 전송 |
| 4 | Heartbeat | `[0, [4]]` | AckHeartbeat 전송 |
| 5 | Leave/Unknown | `[0, [5]]` | ❌ 미처리 |
| 10 | UpdateMates | `[0, [10, [{mate1}, {mate2}]]]` | ❌ 미처리 |

#### 서버 → 클라이언트: `[1, [kind, ...args]]`

| kind | 의미 | 형식 | 구현 여부 |
|------|------|------|---------|
| 0 | Welcome | `[1, [0, roomObj, [mate...]]]` | ✅ |
| 1 | Mates | `[1, [1, [mate...]]]` | ✅ |
| 10 | AckHeartbeat | `[1, [10, connectionId]]` | ✅ |

#### Welcome roomObj (현재 서버 전송 형식)

```json
{
  "roomNumber": "842780",   "room_number": "842780",
  "questId": 1001001,       "quest_id": 1001001,
  "questCategory": 2,       "quest_category": 2,  "category_id": 2
}
```

camelCase와 snake_case 양쪽 포함 중 (클라이언트가 어느 쪽을 읽는지 미확정이므로 유지).

### 확인이 더 필요한 것 (APK 분석 유효)

- Notify kind=5의 정확한 의미 (MeetingNotifyMessage enum 역추적)
- start 이후 전투 중 TCP 메시지 흐름
- 2인 이상 접속 시 물리/피버 동기화 방식 (P2P vs 서버 경유)

---

## 작업 체크리스트

### Phase 1 (즉시)
- [ ] `restore_room`: room_sequence 인덱스 + 조회 로직
- [ ] `disband_room`: 라우트 추가
- [ ] TCP kind=5: graceful 처리

### Phase 2 (멀티 완성)
- [ ] `start`, `finish`, `abort` 라우트 추가
- [ ] `multi_invitation/join` 라우트 추가
- [ ] 실시간 서버: 방별 소켓 관리 + 브로드캐스트

### Phase 3 (관리)
- [ ] 가챠 이벤트 선택기 (CDN 파싱 필요)
- [ ] 전체 유저 아이템/재화 지급 API + UI
- [ ] 관리 패널 인증

### Phase 4 (Docker)
- [ ] `Dockerfile`, `Dockerfile.realtime` 작성
- [ ] `docker-compose.yml` 작성
- [ ] `.env.example` 작성

### Phase 5 (클라우드)
- [ ] Oracle Cloud A1 인스턴스 + 방화벽 설정
- [ ] CDN 업로드 + docker-compose up
- [ ] WireGuard QR로 두 번째 기기 접속 테스트
- [ ] 실제 멀티플레이 테스트 (start → finish 전체 흐름)

---

## 참고

- 즉시 수정 이슈 상세: [multiplayer-issues-analysis.md](multiplayer-issues-analysis.md)
- 멀티 API 실서버 캡처: `docs/routes/multi_battle_quest_*.md`
- 단일 전투 완성 예시: `src/routes/api/singleBattleQuest.ts`
- 기존 배포 스크립트: `deployment/linux/install_starpoint.sh`
- DNS 설정: `deployment/linux/dns/starpoint_proxy_dnsmasq.conf`
- nginx 설정: `deployment/nginx/starpoint_proxy.nginx`
- SSL 인증서 생성: `deployment/ssl/ssl_gen_self_sign_certs.sh`
