/**
 * annotation.js
 * Sketchfab 스타일 Annotation 시스템
 *
 * - 에디터 모드에서 씬 클릭 → annotation 생성
 * - 생성 시 카메라 시점 자동 캡처 (오버라이드 가능)
 * - 클릭 시 부드러운 카메라 애니메이션으로 이동
 * - layout.json에 포함되어 저장/불러오기
 */
import * as THREE from 'three'
import { CCTVS } from './cctv-config.js'
import { openCCTVStream } from './cctv.js'

const ANNO_API = `http://${window.location.hostname}:3001/api/annotations`

const ANNO_TYPES = [
  { value: 'default', label: '기본',   color: '#4d7eff' },
  { value: 'cctv',    label: 'CCTV',   color: '#5dcaa5' },
  { value: 'sensor',  label: '센서',   color: '#ef9f27' },
  { value: 'redzone', label: '레드존', color: '#e24b4a' },
]

function typeColor(type) {
  return ANNO_TYPES.find(t => t.value === type)?.color ?? '#4d7eff'
}

export function createAnnotationSystem(scene, camera, orbitControls, renderer, editorTC = null, editorState = null) {

  const annotations = []   // { id, label, type, title, position, camPos, camTarget, element }

  // ── editor의 TransformControls 재활용 ────────────────────────────────
  // annotation 선택 시 editorTC를 annotation helper에 attach
  let tcHelper = null   // 현재 attached Object3D
  let tcAnno   = null   // 현재 편집 중인 annotation

  function setupTCListener() {
    if (!editorTC) return
    editorTC.addEventListener('change', onTCChange)
  }
  setupTCListener()

  function onTCChange() {
    if (!tcHelper || !tcAnno) return
    tcAnno.position.copy(tcHelper.position)
    tcAnno.camTarget.copy(tcHelper.position)
    updatePanel(tcAnno)
  }
  let   nextIndex   = 1
  let   addMode     = false // 에디터에서 "annotation 추가" 모드
  let   selected    = null  // 현재 선택된 annotation (편집용)

  // ── 카메라 애니메이션 ──────────────────────────────────────────────────
  let   camAnim     = null  // { fromPos, fromTgt, toPos, toTgt, t, duration }

  function animateCameraTo(toPos, toTgt, duration = 1.0) {
    camAnim = {
      fromPos:  camera.position.clone(),
      fromTgt:  orbitControls.target.clone(),
      toPos:    toPos.clone(),
      toTgt:    toTgt.clone(),
      t:        0,
      duration,
    }
  }

  // 매 프레임 호출 — scene.js의 addAnimCallback에 등록
  function tick(dt = 0.016) {
    if (!camAnim) return
    camAnim.t = Math.min(camAnim.t + dt / camAnim.duration, 1)
    const k   = easeInOut(camAnim.t)

    // OrbitControls 비활성화 후 직접 이동 — update()가 내부 spherical로 덮어쓰는 것 방지
    orbitControls.enabled = false
    camera.position.lerpVectors(camAnim.fromPos, camAnim.toPos, k)
    orbitControls.target.lerpVectors(camAnim.fromTgt, camAnim.toTgt, k)
    camera.lookAt(orbitControls.target)

    if (camAnim.t >= 1) {
      // 정확한 최종값으로 스냅
      camera.position.copy(camAnim.toPos)
      orbitControls.target.copy(camAnim.toTgt)
      camera.up.set(0, 1, 0)
      orbitControls.object.up.set(0, 1, 0)  // OrbitControls up 동기화
      camera.lookAt(camAnim.toTgt)

      // sphericalDelta 잔류 제거 후 재활성화
      orbitControls._sphericalDelta.set(0, 0, 0)
      orbitControls._panOffset.set(0, 0, 0)
      orbitControls.enabled = true

      camAnim = null
    }
  }

  function easeInOut(t) {
    return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t
  }

  // ── DOM 레이어 ─────────────────────────────────────────────────────────
  const container = document.createElement('div')
  container.id = 'annotation-layer'
  container.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:5'
  document.getElementById('viewport')?.appendChild(container)

  // ── annotation 생성 ────────────────────────────────────────────────────
  function createAnnotation({ id, label, type, title, position, camPos, camTarget, cctvId }) {
    const anno = {
      id:        id ?? `anno-${Date.now()}`,
      label:     label ?? `${nextIndex}`,
      type:      type  ?? 'default',
      title:     title ?? '',
      cctvId:    cctvId ?? null,
      position:  new THREE.Vector3(...position),
      camPos:    camPos    ? new THREE.Vector3(...camPos)    : null,
      camTarget: camTarget ? new THREE.Vector3(...camTarget) : null,
      element:   null,
    }

    // 자동 시점 계산 — camPos 없으면 annotation 위치 기준으로 생성
    if (!anno.camPos) {
      const offset = new THREE.Vector3(15, 10, 15)
      anno.camPos    = anno.position.clone().add(offset)
      anno.camTarget = anno.position.clone()
    }

    // DOM 요소 생성
    const el = document.createElement('div')
    el.className   = 'anno-marker'
    el.dataset.id  = anno.id
    el.textContent = anno.label
    el.style.setProperty('--anno-color', typeColor(anno.type))
    el.style.pointerEvents = 'auto'

    el.addEventListener('click', e => {
      e.stopPropagation()
      if (addMode) return
      if (!editorState?.active) {
        animateCameraTo(anno.camPos, anno.camTarget)
        if (anno.cctvId) {
          const cctv = CCTVS.find(c => c.id === anno.cctvId)
          if (cctv) openCCTVStream(cctv, 'pip')
        }
      }
      selectAnnotation(anno)
    })

    container.appendChild(el)
    anno.element = el
    annotations.push(anno)
    nextIndex = annotations.length + 1
    updateList()

    return anno
  }

  // ── annotation 삭제 ────────────────────────────────────────────────────
  function removeAnnotation(id) {
    const idx = annotations.findIndex(a => a.id === id)
    if (idx === -1) return
    annotations[idx].element?.remove()
    annotations.splice(idx, 1)
    renumberLabels()
    if (selected?.id === id) { selected = null; updatePanel(null) }
    updateList()
  }

  function renumberLabels() {
    // 레이블은 사용자가 직접 편집할 수 있으므로 덮어쓰지 않음 — nextIndex만 갱신
    nextIndex = annotations.length + 1
  }

  // ── Annotation 리스트 UI 업데이트 ───────────────────────────────────────
  function updateList() {
    const listEl = document.getElementById('anno-list')
    if (!listEl) return
    if (annotations.length === 0) {
      listEl.innerHTML = '<div class="anno-list-empty">annotation이 없습니다</div>'
      return
    }
    listEl.innerHTML = annotations.map(a => `
      <div class="anno-list-item${selected?.id === a.id ? ' selected' : ''}" data-id="${a.id}">
        <div class="anno-list-badge" style="--anno-color:${typeColor(a.type)}">${a.label}</div>
        <div class="anno-list-label">${a.title || a.label}</div>
      </div>
    `).join('')


    listEl.querySelectorAll('.anno-list-item').forEach(el => {
      el.addEventListener('click', () => {
        const anno = annotations.find(a => a.id === el.dataset.id)
        if (!anno) return
        if (!editorState?.active) {
          animateCameraTo(anno.camPos, anno.camTarget)
          if (anno.cctvId) {
            const cctv = CCTVS.find(c => c.id === anno.cctvId)
            if (cctv) openCCTVStream(cctv, 'pip')
          }
        }
        selectAnnotation(anno)
      })
    })
  }

  // ── 선택 / 패널 업데이트 ────────────────────────────────────────────────
  function selectAnnotation(anno) {
    annotations.forEach(a => a.element?.classList.remove('selected'))
    anno.element?.classList.add('selected')
    selected = anno
    updatePanel(anno)
    updateList()

    // 에디터 모드일 때만 기즈모 attach
    if (editorTC) editorTC.detach()
    if (tcHelper) { scene.remove(tcHelper); tcHelper = null }
    tcAnno = anno
    if (editorState?.active && editorTC) {
      tcHelper = new THREE.Object3D()
      tcHelper.position.copy(anno.position)
      scene.add(tcHelper)
      editorTC.attach(tcHelper)
    }
  }

  function deselectAnnotation() {
    annotations.forEach(a => a.element?.classList.remove('selected'))
    selected = null
    updatePanel(null)
    updateList()
    if (tcHelper) { scene.remove(tcHelper); tcHelper = null }
    tcAnno = null
    if (editorTC) editorTC.detach()
  }

  function updatePanel(anno) {
    const panel = document.getElementById('anno-panel')
    if (!panel) return
    if (!anno) { panel.innerHTML = '<div class="insp-empty">annotation을 클릭해 선택하세요</div>'; return }

    panel.innerHTML = `
      <div class="insp-section">타입</div>
      <div class="insp-row">
        <select class="insp-input" id="ap-type" style="width:100%;background:var(--bg2);color:var(--text);border:1px solid var(--border);border-radius:4px;padding:4px 6px">
          ${ANNO_TYPES.map(t => `<option value="${t.value}"${anno.type === t.value ? ' selected' : ''}>${t.label}</option>`).join('')}
        </select>
      </div>
      <div class="insp-section">레이블</div>
      <div class="insp-row">
        <input class="insp-input" id="ap-label" type="text" maxlength="4" placeholder="${anno.label}" value="${anno.label}" style="width:100%">
      </div>
      <div class="insp-section">이름</div>
      <div class="insp-row">
        <input class="insp-input" id="ap-title" type="text" placeholder="Annotation ${anno.label}" value="${anno.title ?? ''}">
      </div>
      <div class="insp-section">CCTV 연결</div>
      <div class="insp-row">
        <select class="insp-input" id="ap-cctv" style="width:100%;background:var(--bg2);color:var(--text);border:1px solid var(--border);border-radius:4px;padding:4px 6px">
          <option value="">— 없음 —</option>
          ${CCTVS.map(c => `<option value="${c.id}"${anno.cctvId === c.id ? ' selected' : ''}>${c.label}</option>`).join('')}
        </select>
      </div>
      <div class="insp-section">위치</div>
      <div class="insp-row"><span class="ax x">X</span><input class="insp-input" id="ap-x" type="number" step="0.5" value="${anno.position.x.toFixed(2)}"></div>
      <div class="insp-row"><span class="ax y">Y</span><input class="insp-input" id="ap-y" type="number" step="0.5" value="${anno.position.y.toFixed(2)}"></div>
      <div class="insp-row"><span class="ax z">Z</span><input class="insp-input" id="ap-z" type="number" step="0.5" value="${anno.position.z.toFixed(2)}"></div>
      <div class="insp-section">카메라 시점</div>
      <div class="insp-row" style="font-size:10px;color:var(--text-dim);padding:2px 0">
        CAM (${anno.camPos.x.toFixed(1)}, ${anno.camPos.y.toFixed(1)}, ${anno.camPos.z.toFixed(1)})
      </div>
      <div class="insp-row" style="font-size:10px;color:var(--text-dim);padding:2px 0 6px">
        TGT (${anno.camTarget.x.toFixed(1)}, ${anno.camTarget.y.toFixed(1)}, ${anno.camTarget.z.toFixed(1)})
      </div>
      <button class="anno-goto-btn"    id="anno-goto">📍 시점 이동</button>
      <button class="anno-capture-btn" id="anno-capture">📷 현재 시점 저장</button>
      <button class="anno-delete-btn"  id="anno-delete">🗑 삭제</button>
    `

    document.getElementById('ap-type')?.addEventListener('change', e => {
      anno.type = e.target.value
      const color = typeColor(anno.type)
      anno.element?.style.setProperty('--anno-color', color)
      updateList()
    })

    document.getElementById('ap-label')?.addEventListener('input', e => {
      const val = e.target.value.trim()
      if (!val) return
      anno.label = val
      if (anno.element) anno.element.textContent = val
      updateList()
    })

    document.getElementById('ap-title')?.addEventListener('input', e => {
      anno.title = e.target.value.trim()
      updateList()
    })

    document.getElementById('ap-cctv')?.addEventListener('change', e => {
      anno.cctvId = e.target.value || null
    })

    const bindPos = (id, axis) => {
      document.getElementById(id)?.addEventListener('input', e => {
        const v = parseFloat(e.target.value)
        if (isNaN(v)) return
        anno.position[axis] = v
        // TransformControls 헬퍼와 camTarget을 새 위치에 동기화
        if (tcHelper && tcAnno === anno) tcHelper.position.copy(anno.position)
        anno.camTarget.copy(anno.position)
      })
    }
    bindPos('ap-x', 'x')
    bindPos('ap-y', 'y')
    bindPos('ap-z', 'z')

    document.getElementById('anno-goto')?.addEventListener('click', () => {
      animateCameraTo(anno.camPos, anno.camTarget)
    })

    document.getElementById('anno-capture')?.addEventListener('click', () => {
      anno.camPos    = camera.position.clone()
      anno.camTarget = orbitControls.target.clone()
      // updatePanel 전체 재렌더 없이 표시만 갱신 — 재렌더 시 input 이벤트가 발생해
      // bindPos의 camTarget.copy(position)이 방금 저장한 camTarget을 덮어쓰는 버그 방지
      const camDiv = panel.querySelector('.insp-row:nth-of-type(1)')
      const tgtDiv = panel.querySelector('.insp-row:nth-of-type(2)')
      if (camDiv) camDiv.style.display = ''  // 표시 유지 (내용 갱신은 아래서)
      panel.querySelectorAll('.insp-row').forEach(el => {
        if (el.textContent.startsWith('CAM'))
          el.textContent = `CAM (${anno.camPos.x.toFixed(1)}, ${anno.camPos.y.toFixed(1)}, ${anno.camPos.z.toFixed(1)})`
        if (el.textContent.startsWith('TGT'))
          el.textContent = `TGT (${anno.camTarget.x.toFixed(1)}, ${anno.camTarget.y.toFixed(1)}, ${anno.camTarget.z.toFixed(1)})`
      })
      showToast('현재 시점 저장됨', 'ok')
    })

    document.getElementById('anno-delete')?.addEventListener('click', () => {
      removeAnnotation(anno.id)
    })
  }

  // ── 3D → 2D 프로젝션 (매 프레임) ──────────────────────────────────────
  const _proj    = new THREE.Vector3()
  const viewport = document.getElementById('viewport')

  function updatePositions() {
    if (!viewport) return
    const W = viewport.clientWidth
    const H = viewport.clientHeight

    annotations.forEach(anno => {
      const el = anno.element
      if (!el) return

      // 에디터 모드에서 선택된 annotation은 기즈모가 위치를 표시하므로 마커 숨김
      if (anno === selected && tcHelper && editorState?.active) {
        el.style.display = 'none'
        return
      }

      _proj.copy(anno.position)
      _proj.project(camera)

      // frustum 밖이면 숨김
      if (_proj.z > 1 || Math.abs(_proj.x) > 1.1 || Math.abs(_proj.y) > 1.1) {
        el.style.display = 'none'
        return
      }

      el.style.display = 'flex'
      const x = (_proj.x *  0.5 + 0.5) * W
      const y = (_proj.y * -0.5 + 0.5) * H
      el.style.left = `${x}px`
      el.style.top  = `${y}px`
      el.style.transform = 'translate(-50%,-50%)'
    })
  }

  // ── 추가 모드 (에디터에서 클릭 시 annotation 생성) ───────────────────
  const raycaster = new THREE.Raycaster()
  const mouse     = new THREE.Vector2()

  function setAddMode(on) {
    addMode = on
    container.style.cursor = on ? 'crosshair' : ''
    const btn = document.getElementById('anno-add-btn')
    btn?.classList.toggle('active', on)

    // 항상 제거 후 필요 시 재등록 (중복 등록 방지)
    renderer.domElement.removeEventListener('pointerdown', onAddClick)
    if (on) {
      renderer.domElement.addEventListener('pointerdown', onAddClick)
    }
  }

  function toggleAddMode() {
    setAddMode(!addMode)
  }

  function onAddClick(e) {
    if (!addMode || e.button !== 0) return
    e.stopPropagation()

    const rect = renderer.domElement.getBoundingClientRect()
    mouse.x =  ((e.clientX - rect.left) / rect.width)  * 2 - 1
    mouse.y = -((e.clientY - rect.top)  / rect.height) * 2 + 1
    raycaster.setFromCamera(mouse, camera)

    // 씬의 모든 mesh에 raycast
    const meshes = []
    scene.traverse(n => { if (n.isMesh) meshes.push(n) })
    const hits = raycaster.intersectObjects(meshes, false)

    let pos
    if (hits.length > 0) {
      pos = hits[0].point.clone().add(hits[0].face.normal.clone().multiplyScalar(0.5))
    } else {
      // 건물이 안 맞으면 카메라 앞 20m 지점
      pos = new THREE.Vector3()
      raycaster.ray.at(20, pos)
    }

    const anno = createAnnotation({
      position:  pos.toArray(),
      camPos:    camera.position.toArray(),
      camTarget: orbitControls.target.toArray(),
    })
    selectAnnotation(anno)
    showToast(`Annotation ${anno.label} 추가됨`, 'ok')
  }

  // ── 직렬화 (layout.json 저장/불러오기용) ─────────────────────────────
  function serialize() {
    return annotations.map(a => ({
      id:        a.id,
      label:     a.label,
      type:      a.type   ?? 'default',
      title:     a.title  ?? '',
      cctvId:    a.cctvId ?? null,
      position:  a.position.toArray(),
      camPos:    a.camPos?.toArray()    ?? null,
      camTarget: a.camTarget?.toArray() ?? null,
    }))
  }

  function deserialize(items) {
    // 기존 annotation 모두 제거
    annotations.forEach(a => a.element?.remove())
    annotations.length = 0
    nextIndex = 1

    items.forEach(item => createAnnotation(item))
    updateList()
  }

  // ── 토스트 (editor.js의 showToast와 동일 DOM 공유) ────────────────────
  function showToast(msg, type = 'ok') {
    const box = document.getElementById('alert-box')
    if (!box) return
    const el = document.createElement('div')
    el.className = `alert ${type}`
    el.innerHTML = `<div class="alert-dot"></div><span>${msg}</span>`
    box.appendChild(el)
    setTimeout(() => el.remove(), 3000)
  }

  return {
    tick,
    updatePositions,
    createAnnotation,
    removeAnnotation,
    setAddMode,
    toggleAddMode,
    selectAnnotation,
    deselectAnnotation,
    serialize,
    deserialize,
    get addMode() { return addMode },
    get list() { return annotations },
    setCamera(cam) { camera = cam },
  }
}
