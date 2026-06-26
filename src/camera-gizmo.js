/**
 * camera-gizmo.js
 * 뷰포트 우측 상단 카메라 방향 기즈모
 */
import * as THREE from 'three'

const SIZE = 96
const R    = 28

const FACES = [
  { id: 'top',    label: '상',  normal: [ 0,  1,  0], color: '#5dcaa5', textColor: '#fff' },
  { id: 'bottom', label: '하',  normal: [ 0, -1,  0], color: '#334466', textColor: '#8ab' },
  { id: 'front',  label: '전',  normal: [ 0,  0,  1], color: '#4d7eff', textColor: '#fff' },
  { id: 'back',   label: '후',  normal: [ 0,  0, -1], color: '#2a3a5e', textColor: '#7af' },
  { id: 'right',  label: '우',  normal: [ 1,  0,  0], color: '#e05050', textColor: '#fff' },
  { id: 'left',   label: '좌',  normal: [-1,  0,  0], color: '#5a2a2a', textColor: '#f99' },
]

export function createCameraGizmo(camera, orbitControls, onSwitchProjection = null) {
  // ── DOM ──────────────────────────────────────────────────────────────────
  const wrap = document.createElement('div')
  wrap.id = 'cam-gizmo'
  wrap.style.cssText = [
    'position:absolute',
    'top:12px',
    'width:' + SIZE + 'px',
    'z-index:6',
    'user-select:none',
    'cursor:pointer',
  ].join(';')
  wrap.style.right = '12px'

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('width',   SIZE)
  svg.setAttribute('height',  SIZE)
  svg.setAttribute('viewBox', `0 0 ${SIZE} ${SIZE}`)
  svg.style.overflow = 'visible'
  svg.style.pointerEvents = 'none'   // 이벤트는 wrap div에서만 받음
  wrap.appendChild(svg)

  const axisGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g')
  svg.appendChild(axisGroup)
  const faceGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g')
  svg.appendChild(faceGroup)

  // ── Persp / Ortho 토글 버튼 (기즈모 아래) ──────────────────────────────
  const projBtn = document.createElement('button')
  projBtn.id = 'proj-toggle-btn'
  projBtn.textContent = 'Persp'
  projBtn.style.cssText = [
    'display:block',
    'margin:4px auto 0',
    'width:56px',
    'padding:2px 0',
    'font-size:9px',
    'font-family:IBM Plex Mono,monospace',
    'color:rgba(180,200,255,0.6)',
    'background:rgba(13,20,40,0.7)',
    'border:1px solid rgba(90,130,255,0.25)',
    'border-radius:3px',
    'cursor:pointer',
    'letter-spacing:.04em',
    'transition:color .15s,border-color .15s',
  ].join(';')
  projBtn.addEventListener('mouseenter', () => {
    projBtn.style.color = 'rgba(180,200,255,0.95)'
    projBtn.style.borderColor = 'rgba(90,130,255,0.6)'
  })
  projBtn.addEventListener('mouseleave', () => {
    projBtn.style.color = 'rgba(180,200,255,0.6)'
    projBtn.style.borderColor = 'rgba(90,130,255,0.25)'
  })
  projBtn.addEventListener('click', () => {
    const toOrtho = projBtn.textContent === 'Persp'
    projBtn.textContent = toOrtho ? 'Ortho' : 'Persp'
    onSwitchProjection?.(toOrtho)
  })
  wrap.appendChild(projBtn)

  document.getElementById('viewport')?.appendChild(wrap)

  // ── 투영 ─────────────────────────────────────────────────────────────────
  const cx = SIZE / 2
  const cy = SIZE / 2
  const mat = new THREE.Matrix4()

  function project(x, y, z) {
    const v = new THREE.Vector3(x, y, z).applyMatrix4(mat)
    return { x: cx + v.x * R, y: cy - v.y * R, z: v.z }
  }

  // ── 면 요소 생성 (SVG 렌더용만 — 이벤트 없음) ───────────────────────────
  const faceEls = {}
  FACES.forEach(f => {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g')

    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon')
    poly.setAttribute('stroke', 'rgba(255,255,255,0.18)')
    poly.setAttribute('stroke-width', '0.8')

    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text')
    text.setAttribute('text-anchor', 'middle')
    text.setAttribute('dominant-baseline', 'middle')
    text.setAttribute('font-size', '9')
    text.setAttribute('font-family', 'Inter, sans-serif')
    text.setAttribute('font-weight', '600')
    text.textContent = f.label

    g.appendChild(poly)
    g.appendChild(text)
    faceGroup.appendChild(g)

    faceEls[f.id] = { g, poly, text, face: f, pts2d: [] }
  })

  // ── 클릭: wrap div에서 point-in-polygon으로 최상위 face 판별 ─────────────
  // z-sort 후 앞면(높은 avgZ)부터 검사 → 가장 앞에 보이는 면 선택
  let sortedFaceIds = []   // update()에서 매 프레임 갱신 (앞→뒤 순)

  wrap.addEventListener('click', e => {
    const rect = wrap.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top

    // 앞에서부터 검사해서 가장 먼저 hit된 면 선택
    for (const id of sortedFaceIds) {
      const el = faceEls[id]
      if (pointInPolygon(mx, my, el.pts2d)) {
        goToFace(el.face)
        // hover 효과
        el.poly.setAttribute('stroke', 'rgba(255,255,255,0.7)')
        setTimeout(() => el.poly.setAttribute('stroke', 'rgba(255,255,255,0.18)'), 200)
        return
      }
    }
  })

  wrap.addEventListener('mousemove', e => {
    const rect = wrap.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    let hit = false
    for (const id of sortedFaceIds) {
      const el = faceEls[id]
      if (!hit && pointInPolygon(mx, my, el.pts2d)) {
        el.poly.setAttribute('stroke', 'rgba(255,255,255,0.7)')
        hit = true
      } else {
        el.poly.setAttribute('stroke', 'rgba(255,255,255,0.18)')
      }
    }
  })

  wrap.addEventListener('mouseleave', () => {
    FACES.forEach(f => faceEls[f.id].poly.setAttribute('stroke', 'rgba(255,255,255,0.18)'))
  })

  // ── 2D point-in-polygon (ray casting) ────────────────────────────────────
  function pointInPolygon(px, py, pts) {
    if (!pts || pts.length < 3) return false
    let inside = false
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i].x, yi = pts[i].y
      const xj = pts[j].x, yj = pts[j].y
      if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) {
        inside = !inside
      }
    }
    return inside
  }

  // ── 축 선 ────────────────────────────────────────────────────────────────
  const AXES = [
    { dir: [1,0,0], color: '#e05050', label: 'X' },
    { dir: [0,1,0], color: '#50c050', label: 'Y' },
    { dir: [0,0,1], color: '#4d90ff', label: 'Z' },
  ]
  const axisLineEls = AXES.map(a => {
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line')
    line.setAttribute('stroke', a.color)
    line.setAttribute('stroke-width', '1.5')
    line.setAttribute('stroke-linecap', 'round')
    const lbl = document.createElementNS('http://www.w3.org/2000/svg', 'text')
    lbl.setAttribute('font-size', '8')
    lbl.setAttribute('font-family', 'IBM Plex Mono, monospace')
    lbl.setAttribute('font-weight', '700')
    lbl.setAttribute('fill', a.color)
    lbl.setAttribute('text-anchor', 'middle')
    lbl.setAttribute('dominant-baseline', 'middle')
    lbl.textContent = a.label
    axisGroup.appendChild(line)
    axisGroup.appendChild(lbl)
    return { line, lbl }
  })

  // ── 큐브 ────────────────────────────────────────────────────────────────
  const corners = [
    [-1,-1,-1],[ 1,-1,-1],[ 1, 1,-1],[-1, 1,-1],
    [-1,-1, 1],[ 1,-1, 1],[ 1, 1, 1],[-1, 1, 1],
  ]
  const edges = [
    [0,1],[1,2],[2,3],[3,0],
    [4,5],[5,6],[6,7],[7,4],
    [0,4],[1,5],[2,6],[3,7],
  ]
  const edgeEls = edges.map(() => {
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line')
    line.setAttribute('stroke', 'rgba(180,200,255,0.15)')
    line.setAttribute('stroke-width', '0.6')
    axisGroup.appendChild(line)
    return line
  })
  const FACE_VERTS = {
    top:    [7,6,2,3],
    bottom: [0,1,5,4],
    front:  [4,5,6,7],
    back:   [3,2,1,0],
    right:  [5,1,2,6],
    left:   [4,0,3,7],
  }

  // ── 매 프레임 큐브 렌더 ──────────────────────────────────────────────────
  function update() {
    const viewMat = new THREE.Matrix4()
    viewMat.lookAt(camera.position, orbitControls.target, camera.up)
    mat.copy(viewMat).invert()
    mat.setPosition(0, 0, 0)

    const pts = corners.map(([x,y,z]) => project(x, y, z))

    edges.forEach(([a, b], i) => {
      edgeEls[i].setAttribute('x1', pts[a].x)
      edgeEls[i].setAttribute('y1', pts[a].y)
      edgeEls[i].setAttribute('x2', pts[b].x)
      edgeEls[i].setAttribute('y2', pts[b].y)
    })

    const faceData = FACES.map(f => {
      const vi = FACE_VERTS[f.id]
      const fp = vi.map(i => pts[i])
      const avgZ = fp.reduce((s, p) => s + p.z, 0) / 4
      const mx = fp.reduce((s, p) => s + p.x, 0) / 4
      const my = fp.reduce((s, p) => s + p.y, 0) / 4
      const n = new THREE.Vector3(...f.normal).applyMatrix4(mat)
      return { f, fp, avgZ, mx, my, nz: n.z }
    })

    // 뒤→앞 순 정렬 (DOM 순서 = 뒤가 먼저 그려져야 앞이 위에 표시됨)
    faceData.sort((a, b) => a.avgZ - b.avgZ)

    // 클릭 판별용: 앞→뒤 순 (높은 avgZ가 앞)
    sortedFaceIds = faceData.map(d => d.f.id).reverse()

    faceData.forEach(({ f, fp, mx, my, nz }) => {
      const el = faceEls[f.id]
      // pts2d 업데이트 (클릭 hit-test용)
      el.pts2d = fp
      el.poly.setAttribute('points', fp.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '))
      const alpha = Math.max(0.12, nz * 0.6 + 0.45)
      el.poly.setAttribute('fill', hexAlpha(f.color, alpha))
      el.text.setAttribute('x', mx.toFixed(1))
      el.text.setAttribute('y', my.toFixed(1))
      el.text.setAttribute('fill', nz > 0.2 ? f.textColor : 'rgba(180,200,255,0.3)')
      el.text.setAttribute('opacity', nz > -0.3 ? 1 : 0.3)
      faceGroup.appendChild(el.g)
    })

    AXES.forEach(({ dir }, i) => {
      const o = project(0, 0, 0)
      const e = project(dir[0] * 1.4, dir[1] * 1.4, dir[2] * 1.4)
      axisLineEls[i].line.setAttribute('x1', o.x); axisLineEls[i].line.setAttribute('y1', o.y)
      axisLineEls[i].line.setAttribute('x2', e.x); axisLineEls[i].line.setAttribute('y2', e.y)
      axisLineEls[i].lbl.setAttribute('x', e.x + (e.x - o.x) * 0.18)
      axisLineEls[i].lbl.setAttribute('y', e.y + (e.y - o.y) * 0.18)
    })
  }

  // ── 카메라 이동 ──────────────────────────────────────────────────────────
  let camAnim = null

  function goToFace(face) {
    const target = orbitControls.target.clone()
    const dist   = camera.position.distanceTo(target)
    const n      = new THREE.Vector3(...face.normal)

    const toPos = target.clone().addScaledVector(n, dist)
    const toUp  = Math.abs(n.y) > 0.9
      ? new THREE.Vector3(0, 0, -1)
      : new THREE.Vector3(0, 1,  0)

    camAnim = {
      fromPos: camera.position.clone(),
      toPos,
      target,
      toUp,
      fromUp: camera.up.clone(),
      t: 0,
      duration: 0.5,
    }
  }

  function tick(dt) {
    if (!camAnim) return

    camAnim.t = Math.min(camAnim.t + dt / camAnim.duration, 1)
    const k   = easeInOut(camAnim.t)

    orbitControls.enabled = false
    camera.position.lerpVectors(camAnim.fromPos, camAnim.toPos, k)
    camera.up.lerpVectors(camAnim.fromUp, camAnim.toUp, k).normalize()
    camera.lookAt(camAnim.target)

    if (camAnim.t >= 1) {
      camera.position.copy(camAnim.toPos)
      camera.up.copy(camAnim.toUp)
      orbitControls.object.up.copy(camAnim.toUp)  // OrbitControls up 동기화
      camera.lookAt(camAnim.target)

      orbitControls._sphericalDelta.set(0, 0, 0)
      orbitControls._panOffset.set(0, 0, 0)
      orbitControls.target.copy(camAnim.target)
      orbitControls.enabled = true

      camAnim = null
    }
  }

  function easeInOut(t) {
    return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t
  }

  function hexAlpha(hex, alpha) {
    const r = parseInt(hex.slice(1,3), 16)
    const g = parseInt(hex.slice(3,5), 16)
    const b = parseInt(hex.slice(5,7), 16)
    return `rgba(${r},${g},${b},${alpha.toFixed(2)})`
  }

  return { update, tick }
}
