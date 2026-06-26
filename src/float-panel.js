/**
 * float-panel.js
 * 드래그 이동 + 리사이즈 가능한 플로팅 패널
 *
 * createFloatPanel(options) → { el, setVisible, isVisible }
 *   options: { id, title, defaultPos:{x,y}, defaultSize:{w,h}, minSize:{w,h}, content }
 */

const STORAGE_KEY = 'ivas-float-panels'

function loadState() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') } catch { return {} }
}
function saveState(id, data) {
  const all = loadState()
  all[id] = data
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all))
}

export function createFloatPanel({ id, title, defaultPos, defaultSize, minSize = { w: 160, h: 80 }, contentEl }) {
  const saved = loadState()[id] ?? {}
  const pos  = saved.pos  ?? defaultPos
  const size = saved.size ?? defaultSize

  // ── 패널 DOM ──────────────────────────────────────────────────────────────
  const panel = document.createElement('div')
  panel.className = 'float-panel'
  panel.id = id
  panel.style.left   = pos.x + 'px'
  panel.style.top    = pos.y + 'px'
  panel.style.width  = size.w + 'px'
  panel.style.height = size.h + 'px'

  // 타이틀바
  const titlebar = document.createElement('div')
  titlebar.className = 'float-panel-titlebar'

  const titleText = document.createElement('span')
  titleText.className = 'float-panel-title'
  titleText.textContent = title

  const closeBtn = document.createElement('button')
  closeBtn.className = 'float-panel-close'
  closeBtn.innerHTML = '×'
  closeBtn.title = '닫기'

  titlebar.appendChild(titleText)
  titlebar.appendChild(closeBtn)

  // 본문
  const body = document.createElement('div')
  body.className = 'float-panel-body'
  if (contentEl) body.appendChild(contentEl)

  // 리사이즈 핸들 (우하단)
  const resizeHandle = document.createElement('div')
  resizeHandle.className = 'float-panel-resize'

  panel.appendChild(titlebar)
  panel.appendChild(body)
  panel.appendChild(resizeHandle)

  // 뷰포트에 추가
  document.getElementById('viewport')?.appendChild(panel)

  // ── 드래그 이동 ────────────────────────────────────────────────────────────
  let dragging = false
  let dragOX = 0, dragOY = 0   // 클릭 시점의 (마우스 - 패널 좌상단) 오프셋, 뷰포트 기준

  titlebar.addEventListener('pointerdown', e => {
    if (e.target === closeBtn) return
    const vp  = document.getElementById('viewport')
    const vpR = vp ? vp.getBoundingClientRect() : { left: 0, top: 0 }
    dragging = true
    // 마우스의 뷰포트 상대 좌표 - 패널의 현재 위치 = 패널 내 클릭 offset
    dragOX = (e.clientX - vpR.left) - panel.offsetLeft
    dragOY = (e.clientY - vpR.top)  - panel.offsetTop
    panel.style.transition = 'none'
    panel.setPointerCapture(e.pointerId)
    bringToFront(panel)
    e.preventDefault()
  })

  panel.addEventListener('pointermove', e => {
    if (!dragging) return
    const vp  = document.getElementById('viewport')
    const vpR = vp ? vp.getBoundingClientRect() : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight }
    const x = Math.max(0, Math.min((e.clientX - vpR.left) - dragOX, vpR.width  - 40))
    const y = Math.max(0, Math.min((e.clientY - vpR.top)  - dragOY, vpR.height - 40))
    panel.style.left = x + 'px'
    panel.style.top  = y + 'px'
  })

  panel.addEventListener('pointerup', e => {
    if (!dragging) return
    dragging = false
    saveState(id, { pos: { x: panel.offsetLeft, y: panel.offsetTop }, size: { w: panel.offsetWidth, h: panel.offsetHeight } })
  })

  // ── 리사이즈 ──────────────────────────────────────────────────────────────
  let resizing = false
  let resOX = 0, resOY = 0, resW0 = 0, resH0 = 0

  resizeHandle.addEventListener('pointerdown', e => {
    resizing = true
    resOX = e.clientX
    resOY = e.clientY
    resW0 = panel.offsetWidth
    resH0 = panel.offsetHeight
    panel.style.transition = 'none'
    resizeHandle.setPointerCapture(e.pointerId)
    bringToFront(panel)
    e.preventDefault()
    e.stopPropagation()
  })

  resizeHandle.addEventListener('pointermove', e => {
    if (!resizing) return
    const w = Math.max(minSize.w, resW0 + (e.clientX - resOX))
    const h = Math.max(minSize.h, resH0 + (e.clientY - resOY))
    panel.style.width  = w + 'px'
    panel.style.height = h + 'px'
  })

  resizeHandle.addEventListener('pointerup', () => {
    if (!resizing) return
    resizing = false
    saveState(id, { pos: { x: panel.offsetLeft, y: panel.offsetTop }, size: { w: panel.offsetWidth, h: panel.offsetHeight } })
  })

  // 패널 클릭 시 최상위로
  panel.addEventListener('pointerdown', () => bringToFront(panel))

  // ── 닫기 ──────────────────────────────────────────────────────────────────
  let visible = true
  closeBtn.addEventListener('click', () => setVisible(false))

  function setVisible(v) {
    visible = v
    panel.style.display = v ? '' : 'none'
  }

  function isVisible() { return visible }

  return { el: panel, body, setVisible, isVisible }
}

// ── z-index 최상위 관리 ────────────────────────────────────────────────────
let zTop = 100
function bringToFront(panel) {
  zTop++
  panel.style.zIndex = zTop
}
