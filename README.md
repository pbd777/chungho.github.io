# IVAS-Factory — Three.js 디지털 트윈 프로토타입

## 빠른 시작

```bash
npm install
npm run dev
# → http://localhost:5173 자동 오픈
```

---

## FBX 파일 연동 방법

### 1단계 — 파일 배치
```
public/
  models/
    building_prod.fbx       ← 생산동
    building_office.fbx     ← 사무동
    building_warehouse.fbx  ← 창고동
```

### 2단계 — 파일명/위치 조정 (선택)
`src/loader.js` 의 `BUILDINGS` 배열에서 각 동의 설정을 수정합니다:

```js
{
  id: 'building-prod',
  label: '생산동',
  file: 'building_prod.fbx',   // ← public/models/ 아래 파일명
  position: [0, 0, 0],          // ← 씬 배치 위치 (x, y, z)  단위: m
  scale: 0.01,                  // ← FBX 단위가 cm이면 0.01, mm이면 0.001
  color: 0x1a3050,              // ← FBX 없을 때 폴백 박스 색상
  placeholderSize: [14, 6, 20], // ← 폴백 박스 크기 [w, h, d]
}
```

> **FBX 파일이 없으면** 자동으로 반투명 박스로 대체됩니다 (개발 중에도 씬 구성 가능).

### 3단계 — 동 추가
`BUILDINGS` 배열에 항목을 추가하면 자동으로 로드됩니다.

---

## 텍스처 임베드 FBX 주의사항

- FBX Media Embed 옵션으로 export된 파일은 별도 텍스처 파일 불필요
- 텍스처가 **외부 파일**로 분리된 경우 `public/models/textures/` 에 함께 배치

---

## MQTT 연결 (실서버 연동 시)

`src/sensor.js` 하단의 주석 처리된 `connectMQTT()` 함수를 활성화하고,
`main.js` 에서 `simulate(dt)` 대신 호출합니다.

```js
// main.js
import { connectMQTT } from './sensor.js'
connectMQTT('ws://서버IP:9001')
```

---

## 파일 구조

```
ivas-factory/
├── index.html
├── vite.config.js
├── package.json
├── public/
│   └── models/          ← FBX 파일 여기에 배치
└── src/
    ├── main.js          ← 진입점
    ├── scene.js         ← Three.js 씬·카메라·조명·컨트롤
    ├── loader.js        ← FBX 로딩 + 폴백 박스
    ├── sensor.js        ← 센서 시뮬레이션 + UI 업데이트
    ├── markers.js       ← 센서 마커 3D 오브젝트
    └── style.css
```

---

## 직접 수정하기 (GUI + DevTools)

### 오브젝트 위치/스케일 — lil-gui 패널

`npm run dev` 후 화면 우측 상단에 **IVAS Debug** 패널이 뜹니다.

1. **오브젝트** 드롭다운에서 건물 선택
2. X / Y / Z 슬라이더로 위치 조정
3. Scale 슬라이더로 크기 조정
4. 브라우저 콘솔(F12)에 변경값 자동 출력
5. 확정되면 **📋 전체 좌표 콘솔 출력** 클릭 → 출력값을 `src/loader.js`의 BUILDINGS 배열에 복사

### UI 색상/레이아웃 — 브라우저 DevTools

1. **F12** → Elements 탭
2. 수정할 요소 클릭 (우측 Styles 패널에 CSS 표시)
3. `--bg`, `--accent` 같은 CSS 변수 값 직접 수정
4. 마음에 들면 `src/style.css`에 복사
