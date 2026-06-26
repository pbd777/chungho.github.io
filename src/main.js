import './style.css'
import * as THREE from 'three'
import { createScene } from './scene.js'
import { BUILDINGS, loadBuildings, loadHDR } from './loader.js'
import { createEditor } from './editor.js'
import { createAnnotationSystem } from './annotation.js'
import { initCCTVInteraction } from './cctv.js'
import { createDebugGUI } from './debug-gui.js'
import { createCameraGizmo } from './camera-gizmo.js'
import { createFloatPanel } from './float-panel.js'

const canvas   = document.getElementById('c')
const sceneRef = createScene(canvas)
const { scene, renderer, controls, addAnimCallback, setCam, setCenter, assignBloomLayer, focusObject, switchProjection } = sceneRef

window.__ivas = { scene, renderer, controls, sceneRef, THREE, get camera() { return sceneRef.camera } }

// ── 플로팅 패널 생성 ──────────────────────────────────────────────────────

// Inspector 패널
const inspContentEl = document.createElement('div')
inspContentEl.id = 'inspector-panel'
inspContentEl.innerHTML = '<div class="insp-empty">오브젝트를 클릭해 선택하세요</div>'
const inspPanel = createFloatPanel({
  id: 'panel-inspector',
  title: 'Inspector',
  defaultPos:  { x: 10, y: 56 },
  defaultSize: { w: 200, h: 300 },
  contentEl:   inspContentEl,
})
inspPanel.setVisible(false)

// Debug GUI 패널
const debugMountEl = document.createElement('div')
debugMountEl.id = 'debug-gui-mount'
const debugPanel = createFloatPanel({
  id: 'panel-debug',
  title: 'IVAS Debug',
  defaultPos:  { x: 220, y: 56 },
  defaultSize: { w: 240, h: 360 },
  contentEl:   debugMountEl,
})
debugPanel.setVisible(false)

// Annotation 패널
const annoContentEl = document.createElement('div')
annoContentEl.innerHTML = `
  <div id="anno-list"><div class="anno-list-empty">annotation이 없습니다</div></div>
  <div class="anno-sidebar-divider"></div>
  <div id="anno-panel"><div class="insp-empty">annotation을 클릭해 선택하세요</div></div>
`
const annoPanel = createFloatPanel({
  id: 'panel-annotations',
  title: 'Annotations',
  defaultPos:  { x: -210, y: 56 },   // 음수 = 우측에서 offset (JS에서 처리)
  defaultSize: { w: 200, h: 420 },
  contentEl:   annoContentEl,
})
annoPanel.setVisible(false)

// Annotations 패널 기본 우측 배치 (저장된 pos 없을 때)
;(function positionAnnoPanel() {
  const saved = JSON.parse(localStorage.getItem('ivas-float-panels') ?? '{}')
  if (!saved['panel-annotations']) {
    const vp = document.getElementById('viewport')
    if (vp) {
      annoPanel.el.style.left = (vp.clientWidth - 210) + 'px'
      annoPanel.el.style.top  = '56px'
    }
  }
})()

// ── Debug GUI ──────────────────────────────────────────────────────────────
createDebugGUI(scene, sceneRef)

// ── 에디터 초기화 ──────────────────────────────────────────────────────────
const editor = createEditor(scene, sceneRef.camera, renderer, controls)

// ── Annotation 시스템 ─────────────────────────────────────────────────────
const annoSystem = createAnnotationSystem(scene, sceneRef.camera, controls, renderer, editor.tc, editor.editorState)

// ── 카메라 기즈모 (전환 콜백 포함) ─────────────────────────────────────────
function onSwitchProjection(toOrtho) {
  switchProjection(toOrtho)
  const cam = sceneRef.camera
  editor.setCamera(cam)
  annoSystem.setCamera(cam)
}
const camGizmo = createCameraGizmo(sceneRef.camera, controls, onSwitchProjection)
window.__ivas.annoSystem = annoSystem

editor.setOnSelectObject(() => annoSystem.deselectAnnotation())

// ── 로딩 오버레이 ──────────────────────────────────────────────────────────
const loadingEl    = document.getElementById('loading-overlay')
const loadingFiles = document.getElementById('loading-files')
let loadedCount = 0
let totalCount  = 0
loadingFiles.textContent = '모델 목록 확인 중…'

loadHDR(renderer, scene, '/models/base.hdr')
  .catch(() => {
    console.warn('[IVAS] HDR 로드 실패 — 기본 배경 유지')
    scene.background = new THREE.Color(0x1a2235)
  })
  .finally(() => {
    loadBuildings(scene, (id, status) => {
      if (status === 'loading') {
        totalCount++
        loadingFiles.textContent = `총 ${totalCount}개 파일 로드 중…`
      } else {
        loadedCount++
        if (totalCount > 0) loadingFiles.textContent = `${loadedCount} / ${totalCount} 완료`
      }
    }).then(() => {
      requestAnimationFrame(() => {
        const roots = scene.children
          .filter(c => c.userData?.label && !c.userData?.isPivot && !c.userData?.skipWrap && !c.isTransformControls)
          .slice()
        roots.forEach(fbxRoot => editor.wrapWithPivot(fbxRoot))

        initCCTVInteraction(scene, sceneRef.camera, renderer, [], editor)

        const box = new THREE.Box3()
        scene.children.forEach(c => { if (c.userData?.isPivot) box.expandByObject(c) })
        if (!box.isEmpty()) {
          const center = new THREE.Vector3()
          box.getCenter(center)
          setCenter(center)
        }

        // wrapWithPivot 완료 후 씬 전체의 emissive 메시를 bloom 레이어에 등록
        assignBloomLayer(scene)

        loadingEl.classList.add('hidden')
        initEditorUI()

        editor.loadLayout().then(data => {
          if (data?.annotations?.length) annoSystem.deserialize(data.annotations)
        }).catch(() => {})
      })
    }).catch(() => loadingEl.classList.add('hidden'))
  })

// ── 매 프레임 ──────────────────────────────────────────────────────────────
let lastTime = performance.now()
addAnimCallback(() => {
  const now = performance.now()
  const dt  = Math.min((now - lastTime) / 1000, 0.1)
  lastTime  = now
  annoSystem.tick(dt)
  annoSystem.updatePositions()
  camGizmo.update()
  camGizmo.tick(dt)
})

function initEditorUI() {
  document.getElementById('editor-toggle-btn').addEventListener('click', () => {
    const app  = document.getElementById('app')
    const isOn = !app.classList.contains('editor-active')
    app.classList.toggle('editor-active', isOn)
    document.getElementById('hint-normal').classList.toggle('hidden', isOn)
    document.getElementById('hint-editor').classList.toggle('hidden', !isOn)
    editor.setActive(isOn)

    // 패널 표시/숨김
    inspPanel.setVisible(isOn)
    debugPanel.setVisible(isOn)
    annoPanel.setVisible(isOn)

    if (!isOn) {
      annoSystem.setAddMode(false)
      annoSystem.deselectAnnotation()
    }
  })

  document.querySelectorAll('.mode-btn[data-mode]').forEach(btn => {
    btn.addEventListener('click', () => {
      editor.tc.setMode(btn.dataset.mode)
      editor.updateModeUI(btn.dataset.mode)
    })
  })

  document.getElementById('anno-add-btn')?.addEventListener('click', () => {
    annoSystem.toggleAddMode()
  })

  document.getElementById('snap-btn').addEventListener('click',  () => editor.toggleSnap())
  document.getElementById('undo-btn').addEventListener('click',  () => editor.undo())

  document.getElementById('save-btn').addEventListener('click', async () => {
    const memo = prompt('저장 메모 (선택사항):', '') ?? ''
    await editor.saveLayout(memo, annoSystem.serialize())
  })
  document.getElementById('load-btn').addEventListener('click', async () => {
    const data = await editor.loadLayout()
    if (data?.annotations?.length) annoSystem.deserialize(data.annotations)
  })
}

document.querySelectorAll('.view-btn[data-cam]').forEach(btn => {
  btn.addEventListener('click', () => setCam(btn.dataset.cam))
})

// F키: 선택된 오브젝트 포커스 (유니티 씬뷰 동일)
window.addEventListener('keydown', e => {
  if (e.key !== 'f' && e.key !== 'F') return
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
  const sel = editor.getSelected?.()
  if (sel) focusObject(sel)
})
