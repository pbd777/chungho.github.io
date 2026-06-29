import * as THREE from 'three'
import { CCTVS } from './cctv-config.js'

const API_BASE = () => ''  // Vite proxy가 /api, /hls를 Express(3001)로 포워딩

// ── CCTV 3D 아이콘 생성 ────────────────────────────────────────────────
export function createCCTVObjects(scene) {
  const objects = []

  CCTVS.forEach(def => {
    const group = new THREE.Group()
    group.position.set(...def.position)
    group.userData = { id: def.id, label: def.label, rtsp: def.rtsp, isCCTV: true, isPivot: true, skipWrap: true }

    // FBX가 0.01 스케일(cm 단위) 기준이므로 CCTV도 동일 스케일로 제작
    // 실제 카메라 크기: 몸체 약 60cm × 35cm × 30cm → Three.js 단위 그대로 사용

    // 몸체 (박스) — 60×35×30cm
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(6, 3.5, 3),
      new THREE.MeshStandardMaterial({ color: 0x222831, roughness: 0.4, metalness: 0.6 })
    )
    body.castShadow = true

    // 렌즈 (원통)
    const lens = new THREE.Mesh(
      new THREE.CylinderGeometry(0.8, 1.0, 2.5, 12),
      new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.2, metalness: 0.8 })
    )
    lens.rotation.z = Math.PI / 2
    lens.position.set(3.5, 0, 0)

    // 상태 표시등 (녹색 점)
    const led = new THREE.Mesh(
      new THREE.SphereGeometry(0.5, 8, 8),
      new THREE.MeshStandardMaterial({
        color: 0x00ff88, emissive: 0x00ff88, emissiveIntensity: 1.0
      })
    )
    led.position.set(-2.0, 1.0, 1.6)

    // 마운트 폴
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.4, 0.4, 12, 8),
      new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.6, metalness: 0.4 })
    )
    pole.position.set(0, -7.5, 0)

    group.add(body, lens, led, pole)
    scene.add(group)
    objects.push({ def, group })
  })

  return objects
}

// ── 클릭 감지 + 모달 ───────────────────────────────────────────────────
export function initCCTVInteraction(scene, camera, renderer, cctvObjects, editor) {
  const raycaster = new THREE.Raycaster()
  const mouse     = new THREE.Vector2()
  let   activeId  = null   // 현재 재생 중인 CCTV id

  renderer.domElement.addEventListener('pointerdown', e => {
    if (e.button !== 0) return
    if (editor?.editorState?.active) return  // 에디터 모드에서는 기즈모 우선

    const rect = renderer.domElement.getBoundingClientRect()
    mouse.x =  ((e.clientX - rect.left) / rect.width)  * 2 - 1
    mouse.y = -((e.clientY - rect.top)  / rect.height) * 2 + 1
    raycaster.setFromCamera(mouse, camera)

    const meshes = []
    cctvObjects.forEach(({ group }) =>
      group.traverse(c => { if (c.isMesh) meshes.push(c) })
    )
    const hits = raycaster.intersectObjects(meshes, false)
    if (!hits.length) return

    let node = hits[0].object
    while (node && !node.userData?.isCCTV) node = node.parent
    if (!node?.userData?.isCCTV) return

    openModal(node.userData)
  })

  // ── 모달 ──────────────────────────────────────────────────────────────
  function openModal(cctv) {
    closeModal()
    activeId = cctv.id
    openCCTVStream(cctv, 'modal')
  }

  function closeModal() {
    const modal = document.getElementById('cctv-modal')
    if (!modal) return
    const video = document.getElementById('cctv-video')
    if (video?._hls) { video._hls.destroy(); video._hls = null }
    if (activeId) {
      fetch(`${API_BASE()}/api/cctv/${activeId}/stop`, { method: 'POST' }).catch(() => {})
    }
    modal.remove()
    activeId = null
  }

  // ESC로 닫기
  window.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal() })

  return { closeModal }
}

// ── PIP 닫기 ──────────────────────────────────────────────────────────────
export function closeCCTVPip() {
  const pip = document.getElementById('cctv-pip')
  if (!pip) return
  const video = pip.querySelector('video')
  if (video?._hls) { video._hls.destroy() }
  if (pip.dataset.cctvId) {
    fetch(`${API_BASE()}/api/cctv/${pip.dataset.cctvId}/stop`, { method: 'POST' }).catch(() => {})
  }
  pip.remove()
}

// ── PIP 강제 교체 (annotation 선택 시 사용 — 토글 없이 항상 열기) ──────────
export function switchCCTVPip(cctv) {
  closeCCTVPip()           // 기존 PIP가 있으면 먼저 닫고
  openCCTVStream(cctv, 'pip')  // 새 CCTV로 열기
}

// ── 공용 스트림 열기 (모달 or PIP) ────────────────────────────────────────
export async function openCCTVStream(cctv, mode = 'pip') {
  const isPip = mode === 'pip'
  const existingId = isPip ? 'cctv-pip' : 'cctv-modal'

  // 같은 CCTV를 다시 누르면 닫기
  const existing = document.getElementById(existingId)
  if (existing) {
    const video = existing.querySelector('video')
    if (video?._hls) { video._hls.destroy() }
    if (existing.dataset.cctvId) {
      fetch(`${API_BASE()}/api/cctv/${existing.dataset.cctvId}/stop`, { method: 'POST' }).catch(() => {})
    }
    existing.remove()
    return
  }

  const hlsUrl = `${API_BASE()}/hls/${cctv.id}/stream.m3u8`
  const wrap = document.createElement('div')
  wrap.id = existingId
  wrap.dataset.cctvId = cctv.id

  if (isPip) {
    wrap.innerHTML = `
      <div class="cctv-pip-header">
        <span class="cctv-pip-title">${cctv.label}</span>
        <button class="cctv-pip-close">✕</button>
      </div>
      <div class="cctv-pip-body">
        <video autoplay muted playsinline></video>
        <div class="cctv-pip-status">스트림 연결 중…</div>
      </div>
    `
    document.getElementById('viewport')?.appendChild(wrap)
    wrap.querySelector('.cctv-pip-close').addEventListener('click', () => {
      const v = wrap.querySelector('video')
      if (v?._hls) v._hls.destroy()
      fetch(`${API_BASE()}/api/cctv/${cctv.id}/stop`, { method: 'POST' }).catch(() => {})
      wrap.remove()
    })
  } else {
    wrap.innerHTML = `
      <div class="cctv-modal-inner">
        <div class="cctv-modal-header">
          <span class="cctv-modal-title">${cctv.label}</span>
          <button class="cctv-modal-close" id="cctv-close">✕</button>
        </div>
        <div class="cctv-video-wrap">
          <video id="cctv-video" autoplay muted playsinline controls></video>
          <div class="cctv-status" id="cctv-status">스트림 연결 중…</div>
        </div>
        <div class="cctv-modal-footer">
          <span class="cctv-rtsp-label">${cctv.rtsp}</span>
        </div>
      </div>
    `
    document.body.appendChild(wrap)
    document.getElementById('cctv-close').addEventListener('click', () => {
      const v = document.getElementById('cctv-video')
      if (v?._hls) v._hls.destroy()
      fetch(`${API_BASE()}/api/cctv/${cctv.id}/stop`, { method: 'POST' }).catch(() => {})
      wrap.remove()
    })
  }

  const video  = wrap.querySelector('video')
  const status = wrap.querySelector('.cctv-pip-status, #cctv-status, .cctv-status')

  // HLS 스트림 시작
  try {
    const res  = await fetch(`${API_BASE()}/api/cctv/${cctv.id}/start`, { method: 'POST' })
    const data = await res.json()
    if (!data.ok) throw new Error(data.error ?? 'start 실패')
  } catch (e) {
    if (status) status.textContent = `스트림 시작 실패: ${e.message}`
    return
  }

  // hls.js 동적 로드
  if (!window.Hls) {
    const script = document.createElement('script')
    script.src = 'https://cdn.jsdelivr.net/npm/hls.js@latest'
    document.head.appendChild(script)
    await new Promise(r => { script.onload = r })
  }

  if (window.Hls.isSupported()) {
    const hls = new window.Hls({ liveSyncDurationCount: 2 })
    hls.loadSource(hlsUrl)
    hls.attachMedia(video)
    hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
      video.play()
      if (status) status.style.display = 'none'
    })
    hls.on(window.Hls.Events.ERROR, (_, data) => {
      if (data.fatal && status) status.textContent = '스트림 연결 실패'
    })
    video._hls = hls
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = hlsUrl
    video.play()
    if (status) status.style.display = 'none'
  }
}

// ── 에디터용: CCTV pivot도 저장/불러오기 대상에 포함 ──
// editor.js의 saveLayout/loadLayout은 isPivot 플래그로 탐지하므로
// group.userData.isPivot = true 만 설정하면 자동 포함됨
