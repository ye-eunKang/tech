# 물고기는 어디에 — NFC / 기울기 / TouchDesigner 프로토타입

이 버전은 **GitHub에 올린 뒤 Render Web Service로 배포**할 수 있도록 수정되어 있습니다.
로컬 테스트와 외부 HTTPS/WSS 테스트를 둘 다 같은 코드로 할 수 있습니다.

---

## 전체 흐름

1. 전시용 `display.html`은 기본 영상 ①을 반복 재생합니다.
2. NFC가 `phone.html?fish=fish01`을 열면 서버로 `SESSION_START`가 전송되고 전시 화면이 영상 ②로 바뀝니다.
3. 휴대폰에서 `시작하기`를 누르면 DeviceOrientation 권한을 요청합니다.
4. 휴대폰을 오른쪽으로 12° 이상 기울이면 영상 ②가 재생됩니다.
5. 30° 이상을 1.5초 유지하면 영상 ③이 자동 재생됩니다.
6. 영상 ③ 종료 후 휴대폰에서 물고기를 5번 터치하는 미니게임이 시작됩니다.
7. 성공하면 영상 ④가 자동 재생됩니다.
8. 영상 ④ 종료 후 휴대폰을 β/γ 각각 ±5° 안에서 2초 유지하면 `SPAWN_FISH`가 전송됩니다.
9. TouchDesigner WebSocket DAT가 메시지를 받아 `fishId`에 맞는 물고기 등장 로직을 실행합니다.

---

## 이번 배포 버전에서 추가된 것

- Render의 `PORT` 환경변수 사용
- `0.0.0.0` 바인딩
- `/health` health check endpoint
- HTTPS 페이지에서는 WebSocket 주소를 자동으로 `wss://`로 변경
- 로컬 HTTP에서는 자동으로 `ws://` 사용
- 휴대폰/전시 페이지 WebSocket 자동 재연결
- 재연결 중 중요한 완료 이벤트를 잠시 보관했다가 다시 전송
- 기울기처럼 계속 발생하는 데이터는 연결이 끊겼을 때 버려서 queue가 쌓이지 않게 처리
- Render Blueprint용 `render.yaml`
- 재현 가능한 설치를 위한 `package-lock.json`

---

# 1. 로컬에서 먼저 테스트

Node.js 20 이상을 권장합니다.

```bash
npm ci
npm start
```

브라우저에서:

- 전시 화면: `http://localhost:8080/display.html`
- PC용 휴대폰 시뮬레이션: `http://localhost:8080/phone.html?fish=fish01&debug=1`
- 서버 상태 확인: `http://localhost:8080/health`

`debug=1`에서는 기울기 슬라이더로 전체 흐름을 테스트할 수 있습니다.

---

# 2. GitHub에 올리기

GitHub에서 새 Repository를 하나 만든 뒤 이 폴더의 **내용 전체**를 업로드합니다.

중요한 파일 구조:

```text
fish-interaction-prototype/
├─ public/
│  ├─ assets/
│  │  ├─ video1.mp4
│  │  ├─ video2.mp4
│  │  ├─ video3.mp4
│  │  └─ video4.mp4
│  ├─ display.html
│  ├─ display.js
│  ├─ phone.html
│  ├─ phone.js
│  ├─ ws-client.js
│  └─ styles.css
├─ touchdesigner/
│  └─ websocket_callbacks.py
├─ server.js
├─ package.json
├─ package-lock.json
├─ render.yaml
├─ .nvmrc
└─ .gitignore
```

Git 명령어를 쓰는 경우 예시는 다음과 같습니다.

```bash
git init
git add .
git commit -m "Initial fish interaction prototype"
git branch -M main
git remote add origin https://github.com/YOUR-ID/YOUR-REPO.git
git push -u origin main
```

---

# 3. Render에 배포

## 가장 간단한 방법 — render.yaml 사용

1. Render에 로그인합니다.
2. **New → Blueprint**를 선택합니다.
3. 방금 만든 GitHub Repository를 연결합니다.
4. Repository 안의 `render.yaml`을 Render가 읽습니다.
5. 배포를 시작합니다.

현재 `render.yaml`은 테스트를 쉽게 하기 위해 `plan: free`로 되어 있습니다.
실제 전시에서는 sleep/재시작에 민감할 수 있으므로 유료 인스턴스로 변경하는 것을 권장합니다.

배포가 완료되면 예를 들어 다음과 같은 주소가 생깁니다.

```text
https://fish-interaction-prototype.onrender.com
```

실제 주소는 Render가 부여한 주소를 사용하세요.

---

# 4. 배포 후 테스트 주소

Render 주소가 아래라고 가정하면:

```text
https://YOUR-SERVICE.onrender.com
```

전시 화면:

```text
https://YOUR-SERVICE.onrender.com/display.html
```

휴대폰/NFC:

```text
https://YOUR-SERVICE.onrender.com/phone.html?fish=fish01
```

PC에서 휴대폰 센서 대신 slider로 테스트:

```text
https://YOUR-SERVICE.onrender.com/phone.html?fish=fish01&debug=1
```

서버 상태:

```text
https://YOUR-SERVICE.onrender.com/health
```

`/health`에서 다음과 비슷한 JSON이 나오면 서버가 실행 중입니다.

```json
{
  "ok": true,
  "clients": 2,
  "time": 1780000000000
}
```

---

# 5. NFC에 넣을 주소

물고기마다 페이지를 복사할 필요는 없습니다.
NFC마다 `fish` 값만 다르게 넣으면 됩니다.

```text
https://YOUR-SERVICE.onrender.com/phone.html?fish=fish01
https://YOUR-SERVICE.onrender.com/phone.html?fish=fish02
https://YOUR-SERVICE.onrender.com/phone.html?fish=fish03
https://YOUR-SERVICE.onrender.com/phone.html?fish=fish04
```

웹페이지는 주소의 `fish` 값을 그대로 TouchDesigner까지 전달합니다.

---

# 6. TouchDesigner를 Render 서버에 연결

TouchDesigner에서 **WebSocket DAT**를 추가합니다.

Render 주소가

```text
https://YOUR-SERVICE.onrender.com
```

이라면 WebSocket DAT를 다음처럼 설정합니다.

### Network Address

```text
wss://YOUR-SERVICE.onrender.com/ws?role=touchdesigner
```

### Network Port

```text
443
```

### Active

```text
On
```

### Callbacks DAT

`touchdesigner/websocket_callbacks.py`의 내용을 Text DAT에 넣고 그 DAT를 Callbacks DAT로 지정합니다.

로컬 테스트라면:

```text
Network Address: localhost/ws?role=touchdesigner
Network Port: 8080
```

마지막 수평 유지 성공 시 TouchDesigner가 받는 메시지는 다음과 비슷합니다.

```json
{
  "type": "SPAWN_FISH",
  "fishId": "fish01",
  "beta": 1.24,
  "gamma": -0.82,
  "source": "phone",
  "serverTime": 1780000000000
}
```

현재 callback은 `/project1/fish_spawn` Table DAT가 있으면 수신 결과를 기록합니다.
실제 물고기를 나타나게 하는 부분은 `spawn_fish()` 안에 네 TouchDesigner 노드 경로를 연결하면 됩니다.

---

# 7. 실제 영상으로 바꾸기

`public/assets/`의 파일을 같은 이름의 실제 영상으로 교체합니다.

- `video1.mp4` — 기본 대기 영상
- `video2.mp4` — 기울기 인터랙션 영상
- `video3.mp4` — 기울기 성공 후 영상
- `video4.mp4` — 미니게임 성공 후 영상

GitHub에 새 영상을 push하면 Render의 자동 배포가 켜져 있는 경우 새 버전으로 다시 배포됩니다.

> 영상 파일이 매우 커지면 GitHub 저장소에 직접 넣는 방식이 불편해질 수 있습니다. 최종 영상 용량이 커지면 영상 호스팅/스토리지 구조를 따로 분리하는 것을 고려하세요.

---

# 8. 인터랙션 수치 바꾸기

`public/phone.js` 상단:

```js
const TILT_PLAY_DEG = 12;
const TILT_TARGET_DEG = 30;
const TILT_HOLD_MS = 1500;
const LEVEL_TOLERANCE = 5;
const LEVEL_HOLD_MS = 2000;
```

- `TILT_PLAY_DEG`: 영상 ②가 재생되기 시작하는 기울기
- `TILT_TARGET_DEG`: 다음 단계 성공 판정 기울기
- `TILT_HOLD_MS`: 그 각도를 유지할 시간
- `LEVEL_TOLERANCE`: 수평으로 인정하는 ±각도
- `LEVEL_HOLD_MS`: 수평 유지 시간

---

# 9. iPhone 센서 테스트 주의사항

실제 DeviceOrientation 센서는 HTTPS에서 테스트하는 것이 안전합니다.
특히 iPhone/Safari에서는 센서 권한 요청이 사용자 버튼 클릭과 연결되어야 하므로 `시작하기` 버튼을 없애지 않는 것을 권장합니다.

따라서 실제 휴대폰 테스트는 로컬 IP의 `http://...`보다 Render의

```text
https://YOUR-SERVICE.onrender.com/phone.html?fish=fish01
```

주소를 사용하는 편이 편합니다.

---

# 10. 전시 전에 반드시 할 테스트

1. 전시 PC에서 `display.html`을 띄웁니다.
2. TouchDesigner WebSocket DAT가 Render에 Connected인지 확인합니다.
3. 휴대폰 데이터/Wi-Fi를 바꿔가며 NFC 주소를 엽니다.
4. 영상 ② 기울기 재생을 확인합니다.
5. 영상 ③ → 미니게임 → 영상 ④를 확인합니다.
6. 마지막 수평 유지 후 TouchDesigner Textport에 아래 로그가 뜨는지 확인합니다.

```text
[fish-websocket] SPAWN_FISH: fish01
```

7. 실제 물고기 생성 노드까지 연결되어 있는지 확인합니다.

