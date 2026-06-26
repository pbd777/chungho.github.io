# IVAS-Factory 개발 컨텍스트

> 작성일: 2026-06-26  
> 프로젝트 경로: `D:\Docs\Project\2026\청호나이스\프로토타입\ivas15_ssao`

---

## 프로젝트 개요

Three.js 기반 디지털 트윈 3D 에디터. 청호나이스 공장 모델링을 웹에서 시각화하고 주석(Annotation), CCTV 연동, 에디터 기능을 제공한다.

- **프론트엔드**: Vite + Three.js (ES Module)
- **백엔드**: Express (`server.js`) — 모델 파일 업로드/관리, CCTV HLS 스트리밍 프록시
- **포트**: Vite `5173`, Express `3001`
- **실행**: `npm start` (concurrently로 두 서버 동시 기동)

---

## 파일 구조

```
ivas15_ssao/
├── index.html          # 진입점, 힌트바 텍스트
├── server.js           # Express 백엔드 (모델 업로드/삭제, CCTV HLS)
├── vite.config.js
├── public/
│   ├── models/         # GLB, FBX, HDR, 텍스처 (git 포함 중, 추후 외부 저장소 전환 예정)
│   └── hls/            # CCTV 스트리밍 세그먼트 (git 제외, 런타임 생성)
├── data/
│   ├── layout.json     # 에디터 저장 데이터 (오브젝트 배치 + 주석)
│   └── backups/        # 저장 이력
└── src/
    ├── main.js         # 진입점, 시스템 조립
    ├── scene.js        # Three.js 씬, 카메라, 렌더러, 컨트롤, 포스트프로세싱
    ├── loader.js       # FBX/GLB/HDR 로더, 동적 BUILDINGS 목록
    ├── editor.js       # TransformControls 기반 오브젝트 에디터
    ├── annotation.js   # 주석 포인트 시스템 (추가/편집/카메라 이동/CCTV 연동)
    ├── cctv.js         # CCTV 스트림 열기 (모달/PIP), 3D 아이콘
    ├── cctv-config.js  # CCTV 목록 정의 (id, label, rtsp, position)
    ├── camera-gizmo.js # 우상단 방향 큐브 기즈모
    ├── debug-gui.js    # lil-gui 디버그 패널 (조명, SSAO, Bloom, 오브젝트 배치)
    ├── float-panel.js  # 드래그 가능한 플로팅 패널 컴포넌트
    ├── markers.js      # (센서 마커 관련)
    ├── sensor.js       # (센서 데이터 관련)
    └── style.css
```

---

## 주요 기능 및 구현 내용

### 카메라 컨트롤 (Unity Scene View 스타일)
`src/scene.js`

| 조작 | 동작 |
|------|------|
| 우클릭 드래그 | 카메라 자체 회전 (FPS look — yaw/pitch) |
| 중클릭 드래그 | 패닝 (OrbitControls PAN) |
| 마우스 휠 | 줌 |
| 우클릭 + WASD | 비행 이동 (카메라 시점 기준 3D 방향) |
| F키 | 선택된 오브젝트로 포커스 |

**구현 포인트**:
- OrbitControls `RIGHT: null`로 비활성화 후 `mousemove`에서 `Euler(YXZ)`로 직접 `camera.quaternion` 조작
- `controls.target`을 카메라 앞 100단위로 실시간 갱신 → 중클릭 패닝/휠 줌과 충돌 없이 공존
- WASD는 `_lookActive`(우클릭 누른 상태) 플래그 확인 후에만 동작
- `camera.near = 0.5` (기존 20 → 변경, GLB 근거리 클리핑 방지)

### 모델 로딩 (`src/loader.js`)
- `/api/models` API로 서버에서 파일 목록을 가져와 `BUILDINGS` 동적 구성
- 확장자 분기: `.fbx` → FBXLoader, `.gltf/.glb` → GLTFLoader
- 텍스처 경로 리매핑: FBX 절대경로 → `/models/textures/{파일명}`
- **GLB 라이트맵 우회**: Blender는 glTF에 lightMap 슬롯이 없어 `emissiveMap`에 라이트맵을 넣어 export함. 로드 후 `emissiveMap → lightMap`으로 이동, `emissive = #000000` 초기화
- `window.location.hostname` 사용 (localhost 하드코딩 제거 → 다른 기기에서 접근 가능)

### 포스트프로세싱 (`src/scene.js`)
- **N8AOPass** (SSAO): 씬 전체 ambient occlusion
- **Selective Bloom**: emissive 재질 메시만 별도 레이어(layer 1)에서 렌더 후 additive blend. 비emissive 메시는 검정 재질로 임시 교체 후 bloom composer 렌더
- **SMAAPass**: 소프트웨어 안티앨리어싱 (EffectComposer 사용 시 MSAA 비활성화되므로)
- Bloom은 기본 비활성 (`bloom.enabled = false`), Debug GUI에서 토글

### Annotation 시스템 (`src/annotation.js`)
- 씬에 3D 마커 배치, 카메라 시점 저장/복원
- 주석별 이름 자유 편집 가능
- **CCTV 연동**: 주석에 CCTV ID 연결 → 마커 클릭 시 PIP 창으로 해당 CCTV 스트림 표시
- 카메라 이동 애니메이션 완료 후 `camera.up`, `orbitControls.object.up`을 `(0,1,0)`으로 리셋 (기즈모 top/bottom 뷰 후 up 벡터 오염 방지)

### CCTV (`src/cctv.js`, `src/cctv-config.js`)
- 공용 함수 `openCCTVStream(cctv, mode)`: `'modal'` 또는 `'pip'` 모드
- PIP: `#viewport` 안에 280px 오버레이, 같은 CCTV 재클릭 시 닫힘
- hls.js 동적 로드 (`cdn.jsdelivr.net`)
- CCTV 3D 아이콘(`createCCTVObjects`)은 제거됨 — 주석 포인트로 CCTV 연동이 이전되었으므로

### 에디터 (`src/editor.js`)
- TransformControls로 오브젝트 이동/회전/스케일
- Undo 히스토리
- `getSelected()` 메서드로 현재 선택 오브젝트 노출 (F키 포커스에 사용)
- 레이아웃 저장/불러오기: `POST /api/layout`, `GET /api/layout`

### 관리 페이지 (`/admin`, `server.js`)
- 업로드된 모델 파일 목록 표시
- 파일별 삭제 버튼
- 지원 확장자: `.fbx`, `.gltf`, `.glb`

---

## 알려진 이슈 / 미해결 사항

### GLB 모델 흰색 문제 (`_1_test_test.glb`)
- `AlphaGround`, `G1`, `Material.001` 메시의 `emissive: #ffffff`가 원인
- 라이트맵 우회 코드 적용 후에도 해당 재질은 emissive 값 자체가 흰색이라 bloom에 걸림
- **해결 방법**: Blender에서 해당 재질의 emissive 값을 `#000000`으로 수정 후 재export 필요

### 스케일 규격화
- 자동 정규화(바운딩 박스 기준 200단위) 시도했으나 디자이너가 설정한 상대 크기가 깨져 롤백
- 현재: 모델 원본 스케일 그대로 사용
- 향후 논의: 디자이너와 export 기준 단위 통일 (예: 1unit = 1cm 또는 1m로 약속)

---

## 주요 버그 수정 이력

| 증상 | 원인 | 수정 위치 |
|------|------|-----------|
| 주석 카메라 저장 후 잘못된 위치로 이동 | `controls.update()`가 `animCallbacks`보다 먼저 실행되어 OrbitControls이 카메라 덮어씀 | `scene.js` animate loop 순서 변경 |
| 기즈모 top/bottom 뷰 후 주석 이동 시 카메라 뒤집힘 | 기즈모가 `camera.up`을 `(0,0,-1)`로 변경, 이후 `lookAt` 계산 오염 | 애니메이션 완료 후 `camera.up.set(0,1,0)` 리셋 |
| 다른 기기에서 모델 안 보임 | `loader.js`에 `http://localhost:3001` 하드코딩 | `window.location.hostname` 으로 변경 |
| 에디터 버튼 동작 안 함 | 동적 모델 로딩 후 콜백 카운터 로직 버그로 `initEditorUI` 미호출 | Promise `.then()` 체인으로 변경 |
| GLB 모델 업로드 후 화면에 안 보임 | `BUILDINGS` 배열이 하드코딩되어 신규 파일 미반영 | 서버 `/api/models` 에서 동적으로 목록 fetch |
| 모델 근거리에서 클리핑 | `camera.near = 20` | `camera.near = 0.5` 으로 변경 |
| Bloom 켜면 전체 화면 흰색 | 흰색 emissive 재질에 UnrealBloomPass 전체 적용 | Selective Bloom (layer 분리) 으로 변경 |

---

## 환경 설정

```bash
npm install       # 의존성 설치
npm start         # Vite(5173) + Express(3001) 동시 실행
npm run dev       # Vite만
npm run server    # Express만
npm run build     # dist/ 빌드
```

### 다른 기기에서 접속
```
http://{개발PC IP}:5173
```
Express API도 같은 hostname으로 자동 참조 (`window.location.hostname:3001`).

---

## 의존성

| 패키지 | 용도 |
|--------|------|
| `three` ^0.168 | 3D 렌더링 |
| `n8ao` | SSAO 포스트프로세싱 |
| `lil-gui` | 디버그 GUI |
| `express` | 백엔드 서버 |
| `multer` | 파일 업로드 |
| `cors` | CORS 헤더 |
| `concurrently` | 두 서버 동시 실행 |
| `vite` (dev) | 번들러/개발서버 |
