import * as THREE from 'three'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'

const API = `http://${window.location.hostname}:3001/api/layout`
const UNDO_LIMIT = 20

export function createEditor(scene, camera, renderer, orbitControls) {

  // ── Undo 스택 ──────────────────────────────────────────────────────────
  const undoStack = []

  function pushUndo(entry) {
    undoStack.push(entry)
    if (undoStack.length > UNDO_LIMIT) undoStack.shift()
    updateUndoUI()
  }

  function undo() {
    if (!undoStack.length) { showToast('더 이상 되돌릴 수 없습니다', 'warn'); return }
    const entry = undoStack.pop()
    updateUndoUI()

    if (entry.type === 'transform') {
      const { obj, position, rotation, scale } = entry.payload
      obj.position.fromArray(position)
      obj.rotation.set(...rotation)
      obj.scale.fromArray(scale)
      if (selected === obj) updateInspector(obj)
      showToast('Undo: 트랜스폼 복원', 'ok')

    } else if (entry.type === 'save') {
      entry.payload.forEach(({ obj, position, rotation, scale }) => {
        obj.position.fromArray(position)
        obj.rotation.set(...rotation)
        obj.scale.fromArray(scale)
      })
      if (selected) updateInspector(selected)
      showToast('Undo: 저장 전 상태로 복원', 'ok')
    }
  }

  function updateUndoUI() {
    const btn = document.getElementById('undo-btn')
    if (!btn) return
    btn.disabled = undoStack.length === 0
    btn.title    = undoStack.length ? `실행 취소 (${undoStack.length}단계)` : '되돌릴 내용 없음'
  }

  window.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo() }
  })

  // ── TransformControls ──────────────────────────────────────────────────
  const tc = new TransformControls(camera, renderer.domElement)
  tc.setSize(0.8)
  scene.add(tc)

  tc.addEventListener('dragging-changed', e => { orbitControls.enabled = !e.value })

  let dragSnapshot = null
  tc.addEventListener('mouseDown', () => {
    if (selected) dragSnapshot = snapshotTransform(selected)
  })
  tc.addEventListener('mouseUp', () => {
    if (!selected || !dragSnapshot) return
    const cur = snapshotTransform(selected)
    if (!transformEqual(dragSnapshot, cur)) pushUndo({ type: 'transform', payload: dragSnapshot })
    dragSnapshot = null
  })
  tc.addEventListener('change', () => { if (selected) updateInspector(selected) })

  function snapshotTransform(obj) {
    return {
      obj,
      position: obj.position.toArray(),
      rotation: [obj.rotation.x, obj.rotation.y, obj.rotation.z],
      scale:    obj.scale.toArray(),
    }
  }
  function transformEqual(a, b) {
    return JSON.stringify([a.position, a.rotation, a.scale]) ===
           JSON.stringify([b.position, b.rotation, b.scale])
  }

  // ── 피벗 래핑 ──────────────────────────────────────────────────────────
  // Box3 계산은 scene에 add된 뒤 updateWorldMatrix 강제 호출 후 수행
  function wrapWithPivot(fbxRoot) {
    // 월드 행렬 강제 업데이트 (타이밍 버그 핵심 수정)
    fbxRoot.updateWorldMatrix(true, true)

    const box    = new THREE.Box3().setFromObject(fbxRoot)
    const center = new THREE.Vector3()

    // Box가 비어있으면 원점 사용 (mesh 없는 빈 FBX 방어)
    if (!box.isEmpty()) box.getCenter(center)

    const pivot = new THREE.Object3D()
    pivot.name     = (fbxRoot.userData.label ?? 'object') + '_pivot'
    pivot.userData = { ...fbxRoot.userData, isPivot: true }
    pivot.position.copy(center)

    scene.remove(fbxRoot)

    // fbxRoot를 pivot 기준으로 오프셋 이동
    fbxRoot.position.sub(center)
    pivot.add(fbxRoot)
    scene.add(pivot)

    return pivot
  }

  // ── 선택 / 해제 ────────────────────────────────────────────────────────
  let selected = null
  const raycaster = new THREE.Raycaster()
  const mouse     = new THREE.Vector2()

  // pointerdown 위치 기록 — 드래그 판별용
  let _downX = 0, _downY = 0

  renderer.domElement.addEventListener('pointerdown', e => {
    _downX = e.clientX
    _downY = e.clientY
  })

  renderer.domElement.addEventListener('pointerup', e => {
    if (!editorState.active || e.button !== 0 || tc.dragging) return

    // 5px 이상 이동하면 드래그로 간주 — 클릭 처리 안 함
    const dx = e.clientX - _downX
    const dy = e.clientY - _downY
    if (Math.sqrt(dx * dx + dy * dy) > 5) return

    const rect = renderer.domElement.getBoundingClientRect()
    mouse.x =  ((e.clientX - rect.left) / rect.width)  * 2 - 1
    mouse.y = -((e.clientY - rect.top)  / rect.height) * 2 + 1
    raycaster.setFromCamera(mouse, camera)

    const meshes = []
    scene.children.forEach(c => {
      if (c.userData?.isPivot) c.traverse(n => { if (n.isMesh) meshes.push(n) })
    })

    const hits = raycaster.intersectObjects(meshes, false)
    if (hits.length > 0) {
      let node = hits[0].object
      while (node && !node.userData?.isPivot) node = node.parent
      if (node?.userData?.isPivot) { selectObject(node); return }
    }
    deselectObject()
  })

  function selectObject(pivot) {
    if (selected) highlightObject(selected, false)
    selected = pivot
    onSelectObject?.()   // annotation TC detach 먼저
    tc.attach(pivot)
    updateInspector(pivot)
    highlightObject(pivot, true)
  }

  function deselectObject() {
    if (selected) highlightObject(selected, false)
    selected = null
    tc.detach()
    updateInspector(null)
  }

  const origEmissive = new Map()
  function highlightObject(pivot, on) {
    pivot.traverse(child => {
      if (!child.isMesh) return
      const mats = Array.isArray(child.material) ? child.material : [child.material]
      mats.forEach(mat => {
        if (!mat) return
        if (on) {
          origEmissive.set(mat, mat.emissive?.clone() ?? new THREE.Color(0))
          mat.emissive?.set(0x223355)
        } else {
          if (origEmissive.has(mat)) { mat.emissive = origEmissive.get(mat); origEmissive.delete(mat) }
        }
      })
    })
  }

  // ── 단축키 ────────────────────────────────────────────────────────────
  window.addEventListener('keydown', e => {
    if (!editorState.active || e.ctrlKey || e.metaKey) return
    const map = { w:'translate', W:'translate', e:'rotate', E:'rotate', r:'scale', R:'scale' }
    if (map[e.key]) { tc.setMode(map[e.key]); updateModeUI(map[e.key]) }
    if (e.key === 'Escape') deselectObject()
    if (e.key === 'x' || e.key === 'X') toggleSnap()
  })

  // ── Inspector ─────────────────────────────────────────────────────────
  function updateInspector(pivot) {
    const panel = document.getElementById('inspector-panel')
    if (!panel) return
    if (!pivot) { panel.innerHTML = `<div class="insp-empty">오브젝트를 클릭해 선택하세요</div>`; return }

    const p = pivot.position, r = pivot.rotation, s = pivot.scale

    panel.innerHTML = `
      <div class="insp-name">${pivot.userData.label}</div>
      <div class="insp-section">Position</div>
      <div class="insp-row"><span class="ax x">X</span><input class="insp-input" id="px" type="number" step="0.5"   value="${p.x.toFixed(2)}"></div>
      <div class="insp-row"><span class="ax y">Y</span><input class="insp-input" id="py" type="number" step="0.5"   value="${p.y.toFixed(2)}"></div>
      <div class="insp-row"><span class="ax z">Z</span><input class="insp-input" id="pz" type="number" step="0.5"   value="${p.z.toFixed(2)}"></div>
      <div class="insp-section">Rotation (deg)</div>
      <div class="insp-row"><span class="ax x">X</span><input class="insp-input" id="rx" type="number" step="1"     value="${(r.x*180/Math.PI).toFixed(1)}"></div>
      <div class="insp-row"><span class="ax y">Y</span><input class="insp-input" id="ry" type="number" step="1"     value="${(r.y*180/Math.PI).toFixed(1)}"></div>
      <div class="insp-row"><span class="ax z">Z</span><input class="insp-input" id="rz" type="number" step="1"     value="${(r.z*180/Math.PI).toFixed(1)}"></div>
      <div class="insp-section">Scale</div>
      <div class="insp-row"><span class="ax x">X</span><input class="insp-input" id="sx" type="number" step="0.001" value="${s.x.toFixed(4)}"></div>
      <div class="insp-row"><span class="ax y">Y</span><input class="insp-input" id="sy" type="number" step="0.001" value="${s.y.toFixed(4)}"></div>
      <div class="insp-row"><span class="ax z">Z</span><input class="insp-input" id="sz" type="number" step="0.001" value="${s.z.toFixed(4)}"></div>
    `

    const bind = (id, fn) => {
      document.getElementById(id)?.addEventListener('change', e => {
        const snap = snapshotTransform(pivot)
        fn(parseFloat(e.target.value))
        pushUndo({ type: 'transform', payload: snap })
        updateInspector(pivot)
      })
    }
    bind('px', v => pivot.position.x = v)
    bind('py', v => pivot.position.y = v)
    bind('pz', v => pivot.position.z = v)
    bind('rx', v => pivot.rotation.x = v * Math.PI / 180)
    bind('ry', v => pivot.rotation.y = v * Math.PI / 180)
    bind('rz', v => pivot.rotation.z = v * Math.PI / 180)
    bind('sx', v => pivot.scale.x = v)
    bind('sy', v => pivot.scale.y = v)
    bind('sz', v => pivot.scale.z = v)
  }

  // ── 스냅 ─────────────────────────────────────────────────────────────
  let snapOn = false
  function toggleSnap() {
    snapOn = !snapOn
    tc.setTranslationSnap(snapOn ? 1.0 : null)
    tc.setRotationSnap(snapOn ? THREE.MathUtils.degToRad(15) : null)
    tc.setScaleSnap(snapOn ? 0.1 : null)
    document.getElementById('snap-btn')?.classList.toggle('active', snapOn)
  }

  function updateModeUI(mode) {
    document.querySelectorAll('.mode-btn[data-mode]').forEach(b =>
      b.classList.toggle('active', b.dataset.mode === mode)
    )
  }

  // ── 저장 ─────────────────────────────────────────────────────────────
  async function saveLayout(memo = '', annotations = []) {
    const snapshot = []
    const objects  = []

    scene.children.forEach(child => {
      if (!child.userData?.isPivot) return
      snapshot.push(snapshotTransform(child))
      objects.push({
        id:       child.userData.id ?? child.userData.label,
        label:    child.userData.label,
        position: child.position.toArray(),
        rotation: [child.rotation.x, child.rotation.y, child.rotation.z],
        scale:    child.scale.toArray(),
      })
    })
    if (snapshot.length) pushUndo({ type: 'save', payload: snapshot })

    try {
      const res  = await fetch(API, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ objects, savedBy: 'editor', memo, annotations }),
      })
      const data = await res.json()
      data.ok
        ? showToast(`저장 완료 (${new Date(data.savedAt).toLocaleTimeString('ko-KR')})`, 'ok')
        : showToast('저장 실패', 'danger')
    } catch { showToast('서버 연결 실패 — npm start 확인', 'danger') }
  }

  // ── 불러오기 ─────────────────────────────────────────────────────────
  async function loadLayout() {
    try {
      const res  = await fetch(API)
      const data = await res.json()
      if (data.objects?.length) {
      data.objects.forEach(item => {
        const pivot = scene.children.find(c =>
          c.userData?.isPivot &&
          (c.userData?.id === item.id || c.userData?.label === item.label)
        )
        if (!pivot) return
        pivot.position.fromArray(item.position)
        pivot.rotation.set(...item.rotation)
        pivot.scale.fromArray(item.scale)
      })
        if (selected) updateInspector(selected)
        showToast(`불러오기 완료 — ${data.objects.length}개`, 'ok')
      }
      return data
    } catch { /* 서버 미실행 시 무시 */ }
  }

  // ── 토스트 ───────────────────────────────────────────────────────────
  function showToast(msg, type = 'ok') {
    const box = document.getElementById('alert-box')
    if (!box) return
    const el = document.createElement('div')
    el.className = `alert ${type}`
    el.innerHTML = `<div class="alert-dot"></div><span>${msg}</span>`
    box.appendChild(el)
    setTimeout(() => el.remove(), 3500)
  }

  // ── 에디터 활성화 ─────────────────────────────────────────────────────
  const editorState = { active: false }

  function setActive(on) {
    editorState.active = on
    if (!on) deselectObject()
    document.getElementById('editor-bar')?.classList.toggle('hidden', !on)
    document.getElementById('viewport')?.classList.toggle('editor-mode', on)
    const btn = document.getElementById('editor-toggle-btn')
    if (btn) { btn.textContent = on ? '✕ 에디터 종료' : '✎ 에디터'; btn.classList.toggle('active', on) }
    updateUndoUI()
  }

  let onSelectObject = null
  function setOnSelectObject(fn) { onSelectObject = fn }

  function setCamera(cam) {
    camera = cam
    tc.camera = cam
  }

  return { tc, wrapWithPivot, saveLayout, loadLayout, setActive, editorState, setOnSelectObject,
           deselectObject, updateModeUI, toggleSnap, showToast, undo, setCamera,
           getSelected: () => selected }
}
