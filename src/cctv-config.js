/**
 * CCTV 목록 정의
 * - position: 3D 씬 배치 좌표 (에디터에서 수정 후 저장하면 layout.json에 반영)
 * - rtsp: 실제 RTSP URL (서버에서 HLS로 변환)
 * - label: 화면 표시명
 *
 * ※ 건물(CH.fbx) 원점 정렬 후 크기: 약 454(X) × 5.8(Y) × 469(Z)
 *   실제 CCTV 설치 위치는 에디터 모드에서 조정 후 저장 권장
 */
export const CCTVS = [
  {
    id:       'cctv-01',
    label:    'CCTV 01 · cctv003',
    rtsp:     'rtsp://210.99.70.120:1935/live/cctv003.stream',
    position: [100, 8, 150],   // 건물 내부 임시 위치 — 에디터에서 조정
  },
  {
    id:       'cctv-02',
    label:    'CCTV 02 · cctv004',
    rtsp:     'rtsp://210.99.70.120:1935/live/cctv004.stream',
    position: [-100, 8, 150],  // 건물 내부 임시 위치 — 에디터에서 조정
  },
]
