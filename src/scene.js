import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { EffectComposer }   from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass }      from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { ShaderPass }      from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { SMAAPass }        from 'three/examples/jsm/postprocessing/SMAAPass.js'
import { N8AOPass } from 'n8ao'

export function createScene(canvas) {
  // ── Renderer ──
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setClearColor(0x000000, 0)
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.8

  // ── Scene ──
  const scene = new THREE.Scene()
  scene.background = null   // CSS 그라데이션으로 처리
  scene.fog = null

  // ── Camera ──
  const perspCamera = new THREE.PerspectiveCamera(55, 1, 0.5, 60000)
  perspCamera.position.set(20, 14, 20)

  // 오소그래픽 카메라는 viewport 크기 기반으로 초기화 — resize()에서 갱신
  const orthoCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.5, 60000)
  orthoCamera.position.set(20, 14, 20)

  let _isOrtho = false
  let camera = perspCamera   // 항상 현재 활성 카메라를 가리키는 참조

  // ── Lights ──
  // 1. 전체 ambient — 크게 높임
  const ambient = new THREE.AmbientLight(0xffffff, 2.5)   // ← 기존 0x334466 / 1.5
  scene.add(ambient)

  // 2. 주 태양광 (낮 느낌)
  const sun = new THREE.DirectionalLight(0xfff5e0, 3.5)   // ← 기존 0x8899dd / 2.0
  sun.position.set(30, 60, 20)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  sun.shadow.camera.near = 0.5
  sun.shadow.camera.far = 400
  sun.shadow.camera.left  = -80
  sun.shadow.camera.right =  80
  sun.shadow.camera.top   =  80
  sun.shadow.camera.bottom = -80
  sun.shadow.bias = -0.001
  scene.add(sun)

  // 3. 보조 fill (반대편 그림자 완화)
  const fill = new THREE.DirectionalLight(0xaaccff, 1.2)  // ← 기존 0x223366 / 0.6
  fill.position.set(-20, 20, -15)
  scene.add(fill)

  // 4. 위에서 내려오는 헤미 라이트 (하늘/지면 색)
  const hemi = new THREE.HemisphereLight(0x8ab0e0, 0x445533, 1.5)
  scene.add(hemi)

  // 바닥/지형은 Ground.fbx 사용 — PlaneGeometry/GridHelper 제거 (Z-fighting 방지)

  // ── Controls (Unity Scene View style) ──
  // 중클릭=패닝, 좌클릭=없음, 우클릭=FPS look (OrbitControls에서 분리 처리)
  const controls = new OrbitControls(perspCamera, canvas)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.minDistance = 3
  controls.maxDistance = 2000
  // maxPolarAngle 제거 — FPS look 모드에서 target이 하늘에 위치할 때
  // OrbitControls가 polar 제한을 집행하며 카메라 position을 위로 밀어올리는 버그 방지
  // 지면 아래 진입은 FPS look의 pitch 클램핑(-π/2 ~ π/2)으로 이미 차단됨
  controls.target.set(0, 0, 0)
  controls.mouseButtons = {
    LEFT:   null,
    MIDDLE: THREE.MOUSE.PAN,
    RIGHT:  null,   // 우클릭은 아래 FPS look 핸들러가 직접 처리
  }

  // ── FPS Look (우클릭 드래그 = 카메라 자체 회전) ──
  // yaw(좌우), pitch(상하)를 직접 관리, controls.target을 카메라 앞으로 갱신
  const _euler = new THREE.Euler(0, 0, 0, 'YXZ')
  let _lookActive = false

  // 초기 euler를 현재 카메라 방향에서 계산
  function _syncEulerFromCamera() {
    _euler.setFromQuaternion(camera.quaternion, 'YXZ')
  }
  _syncEulerFromCamera()

  canvas.addEventListener('mousedown', e => {
    if (e.button !== 2) return
    _syncEulerFromCamera()
    _lookActive = true
    canvas.style.cursor = 'none'
  })
  window.addEventListener('mouseup', e => {
    if (e.button !== 2) return
    _lookActive = false
    canvas.style.cursor = ''
    // 우클릭을 놓을 때 WASD 상태 초기화 — 키를 누른 채 우클릭을 놓으면
    // keyup이 발생하지 않아 wasd 플래그가 true로 남는 반전 버그 방지
    wasd.w = wasd.a = wasd.s = wasd.d = false
    _syncTargetFromCamera()
    // damping 잔류값 초기화 — 그대로 두면 controls.update()가 카메라를 이동시킴
    controls._sphericalDelta.set(0, 0, 0)
    controls._panOffset.set(0, 0, 0)
  })
  window.addEventListener('mousemove', e => {
    if (!_lookActive) return
    const sens = 0.003
    _euler.y -= e.movementX * sens
    _euler.x -= e.movementY * sens
    _euler.x = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, _euler.x))
    camera.quaternion.setFromEuler(_euler)
    // 드래그 중에는 controls.target을 건드리지 않음 —
    // target 갱신 시 OrbitControls 내부 spherical이 어긋나 다음 update()에서 position이 튐
  })

  const _lookDir = new THREE.Vector3()
  function _syncTargetFromCamera() {
    camera.getWorldDirection(_lookDir)
    controls.target.copy(camera.position).addScaledVector(_lookDir, 100)
  }

  // ── Resize helper (N8AO 생성 전에 크기를 알아야 함) ──
  const vp = canvas.parentElement
  const initW = vp.clientWidth  || 800
  const initH = vp.clientHeight || 600

  renderer.setSize(initW, initH)
  perspCamera.aspect = initW / initH
  perspCamera.updateProjectionMatrix()
  _updateOrthoSize(initW, initH)

  // ── Post-processing: N8AOPass + EffectComposer ──
  // N8AOPass는 RenderPass를 겸함 — EffectComposer에 첫 번째 pass로 추가
  // aoRadius: 월드 단위(m) 기준
  const composer = new EffectComposer(renderer)
  const n8ao = new N8AOPass(scene, camera, initW, initH)
  n8ao.configuration.aoRadius          = 20.5
  n8ao.configuration.distanceFalloff   = 1.5
  n8ao.configuration.intensity         = 7.5
  n8ao.configuration.color             = new THREE.Color(0, 0, 0)
  n8ao.configuration.aoSamples         = 24
  n8ao.configuration.denoiseSamples    = 6
  n8ao.configuration.denoiseRadius     = 11
  n8ao.configuration.biasOffset        = 0.3
  n8ao.configuration.biasMultiplier    = 0.51
  n8ao.configuration.accumulate        = true
  n8ao.configuration.screenSpaceRadius = false
  n8ao.configuration.halfRes           = false
  n8ao.configuration.gammaCorrection   = true
  composer.addPass(n8ao)

  // ── Selective Bloom ──────────────────────────────────────────────────────
  // emissive 재질 메시만 bloom 레이어(1)에 등록 → bloom composer로 분리 렌더
  // 최종 합성: finalComposer = N8AO(씬 전체) + bloomTexture overlay
  const BLOOM_LAYER = 1
  const bloomLayer  = new THREE.Layers()
  bloomLayer.set(BLOOM_LAYER)

  // bloom 전용 composer: RenderPass(씬) → UnrealBloomPass
  const bloomComposer = new EffectComposer(renderer)
  bloomComposer.renderToScreen = false
  const bloomRenderPass = new RenderPass(scene, camera)
  bloomComposer.addPass(bloomRenderPass)

  const bloom = new UnrealBloomPass(
    new THREE.Vector2(initW, initH),
    0.8,   // strength
    0.4,   // radius
    0.0    // threshold=0 — 레이어로 분리했으므로 threshold 불필요
  )
  bloom.enabled = false
  bloomComposer.addPass(bloom)

  // 합성 셰이더: n8ao 결과 + bloom 텍스처를 additive blend
  const mixShader = {
    uniforms: {
      baseTexture:  { value: null },
      bloomTexture: { value: bloomComposer.renderTarget2.texture },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
    `,
    fragmentShader: `
      uniform sampler2D baseTexture;
      uniform sampler2D bloomTexture;
      varying vec2 vUv;
      void main() {
        gl_FragColor = texture2D(baseTexture, vUv) + vec4(texture2D(bloomTexture, vUv).rgb, 0.0);
      }
    `,
  }
  const mixPass = new ShaderPass(new THREE.ShaderMaterial(mixShader), 'baseTexture')
  mixPass.needsSwap = true
  composer.addPass(mixPass)

  const smaa = new SMAAPass(initW, initH)
  composer.addPass(smaa)

  // bloom 렌더 시 non-emissive 메시를 임시로 검정으로 만들었다가 복원하는 헬퍼
  const _darkMat  = new THREE.MeshBasicMaterial({ color: 0x000000 })
  const _savedMat = new Map()

  function _darkenNonBloom() {
    scene.traverse(obj => {
      if (!obj.isMesh) return
      if (obj.layers.test(bloomLayer)) return  // bloom 대상은 그대로
      _savedMat.set(obj, obj.material)
      obj.material = _darkMat
    })
  }
  function _restoreMat() {
    _savedMat.forEach((mat, obj) => { obj.material = mat })
    _savedMat.clear()
  }

  // bloom 레이어 등록/해제 유틸 (loader.js applyModel 이후 main.js에서 호출)
  function assignBloomLayer(object) {
    object.traverse(obj => {
      if (!obj.isMesh) return
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
      const hasEmissive = mats.some(m =>
        m && (m.emissiveMap || (m.emissive && m.emissive.r + m.emissive.g + m.emissive.b > 0.01))
      )
      if (hasEmissive) obj.layers.enable(BLOOM_LAYER)
    })
  }

  // ── 오소그래픽 frustum 크기 계산 ──
  // target까지의 거리를 FOV 기반으로 오소 크기로 환산해 원근/오소 전환 시 씬 크기가 동일하게 보임
  function _updateOrthoSize(w, h) {
    const dist = camera.position.distanceTo(controls.target)
    const halfH = dist * Math.tan(THREE.MathUtils.degToRad(perspCamera.fov / 2))
    const halfW = halfH * (w / h)
    orthoCamera.left   = -halfW
    orthoCamera.right  =  halfW
    orthoCamera.top    =  halfH
    orthoCamera.bottom = -halfH
    orthoCamera.updateProjectionMatrix()
  }

  // ── 퍼스펙티브 ↔ 오소그래픽 전환 ──
  function switchProjection(toOrtho) {
    if (toOrtho === _isOrtho) return
    _isOrtho = toOrtho

    const w = vp.clientWidth
    const h = vp.clientHeight

    if (_isOrtho) {
      // persp → ortho: 현재 카메라 위치·방향을 ortho에 복사 후 frustum 맞춤
      orthoCamera.position.copy(perspCamera.position)
      orthoCamera.quaternion.copy(perspCamera.quaternion)
      _updateOrthoSize(w, h)
      camera = orthoCamera
    } else {
      // ortho → persp: ortho 위치·방향을 persp에 복사
      perspCamera.position.copy(orthoCamera.position)
      perspCamera.quaternion.copy(orthoCamera.quaternion)
      perspCamera.aspect = w / h
      perspCamera.updateProjectionMatrix()
      camera = perspCamera
    }

    // OrbitControls·N8AO·bloomRenderPass 카메라 교체
    controls.object = camera
    n8ao.camera = camera
    bloomRenderPass.camera = camera
    controls._sphericalDelta.set(0, 0, 0)
    controls._panOffset.set(0, 0, 0)
    controls.update()
  }

  // ── Resize ──
  function resize() {
    const w = vp.clientWidth
    const h = vp.clientHeight
    renderer.setSize(w, h)
    composer.setSize(w, h)
    n8ao.setSize(w, h)
    bloomComposer.setSize(w, h)
    bloom.resolution.set(w, h)
    smaa.setSize(w, h)
    perspCamera.aspect = w / h
    perspCamera.updateProjectionMatrix()
    if (_isOrtho) _updateOrthoSize(w, h)
  }
  window.addEventListener('resize', resize)

  // ── WASD 카메라 이동 (Unity Fly mode: 우클릭 누른 상태, 카메라 시점 기준) ──
  const wasd = { w: false, a: false, s: false, d: false }
  const WASD_SPEED = 0.2

  window.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
    if (!_lookActive) return
    if (e.key === 'w' || e.key === 'W') wasd.w = true
    if (e.key === 'a' || e.key === 'A') wasd.a = true
    if (e.key === 's' || e.key === 'S') wasd.s = true
    if (e.key === 'd' || e.key === 'D') wasd.d = true
  })
  window.addEventListener('keyup', e => {
    if (e.key === 'w' || e.key === 'W') wasd.w = false
    if (e.key === 'a' || e.key === 'A') wasd.a = false
    if (e.key === 's' || e.key === 'S') wasd.s = false
    if (e.key === 'd' || e.key === 'D') wasd.d = false
  })

  // ── 카메라 위치 HUD ──
  const camHUD = document.createElement('div')
  camHUD.id = 'cam-hud'
  camHUD.style.cssText = [
    'position:fixed', 'bottom:40px', 'left:12px',
    'font-family:IBM Plex Mono,monospace', 'font-size:10px',
    'color:rgba(180,200,255,0.55)', 'pointer-events:none',
    'line-height:1.6', 'z-index:100'
  ].join(';')
  document.body.appendChild(camHUD)

  // ── Render loop ──
  const animCallbacks = []
  function addAnimCallback(fn) { animCallbacks.push(fn) }

  // WASD 이동 벡터 계산용 (카메라 시점 기준 3D 이동)
  const _fwd   = new THREE.Vector3()
  const _rgt   = new THREE.Vector3()
  const _camUp = new THREE.Vector3(0, 1, 0)
  const _delta = new THREE.Vector3()

  function applyWASD() {
    if (!_lookActive) return
    const anyKey = wasd.w || wasd.a || wasd.s || wasd.d
    if (!anyKey) return

    // 카메라가 실제 바라보는 방향 (3D, Y 고정 없음)
    camera.getWorldDirection(_fwd)
    _rgt.crossVectors(_fwd, _camUp).normalize()

    _delta.set(0, 0, 0)
    if (wasd.w) _delta.addScaledVector(_fwd,  WASD_SPEED)
    if (wasd.s) _delta.addScaledVector(_fwd, -WASD_SPEED)
    if (wasd.d) _delta.addScaledVector(_rgt,  WASD_SPEED)
    if (wasd.a) _delta.addScaledVector(_rgt, -WASD_SPEED)

    camera.position.add(_delta)
    _syncTargetFromCamera()
  }

  function updateHUD() {
    const p = camera.position
    const t = controls.target
    camHUD.innerHTML =
      `CAM  ${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}<br>` +
      `TGT  ${t.x.toFixed(1)}, ${t.y.toFixed(1)}, ${t.z.toFixed(1)}`
  }

  function animate() {
    requestAnimationFrame(animate)
    applyWASD()
    animCallbacks.forEach(fn => fn())
    // FPS look 중에는 OrbitControls.update()를 호출하지 않음 —
    // enabled=false여도 update() 내부의 damping 소진 코드가 카메라 position을 건드리기 때문
    if (!_lookActive) controls.update()
    updateHUD()
    if (bloom.enabled) {
      _darkenNonBloom()
      bloomComposer.render()
      _restoreMat()
    }
    if (n8ao.enabled) composer.render()
    else renderer.render(scene, camera)   // camera는 항상 현재 활성 카메라
  }
  animate()

  // ── Camera presets (로드 후 center 기준으로 main.js에서 재설정) ──
  let sceneCenter = new THREE.Vector3(0, 0, 0)

  function setCenter(v3) {
    sceneCenter.copy(v3)
    controls.target.copy(v3)
    camera.position.set(
      v3.x + 400, v3.y + 280, v3.z + 400
    )
    controls.update()
  }

  function setCam(preset) {
    const c = sceneCenter
    const targets = {
      top:   { pos: [c.x,       c.y + 800, c.z + 0.1],  tgt: [c.x, c.y, c.z] },
      front: { pos: [c.x,       c.y + 200, c.z + 600],  tgt: [c.x, c.y, c.z] },
      iso:   { pos: [c.x + 400, c.y + 280, c.z + 400],  tgt: [c.x, c.y, c.z] },
    }
    const t = targets[preset]
    if (!t) return
    camera.position.set(...t.pos)
    controls.target.set(...t.tgt)
    controls.update()
  }

  // ── F키 포커스: 선택된 오브젝트를 화면 중앙으로 ──
  function focusObject(object) {
    if (!object) return
    const box = new THREE.Box3().setFromObject(object)
    if (box.isEmpty()) return
    const center = new THREE.Vector3()
    const size   = new THREE.Vector3()
    box.getCenter(center)
    box.getSize(size)
    const dist = Math.max(size.x, size.y, size.z) * 1.8

    // 현재 카메라 방향 유지한 채 적절한 거리로 물러남
    camera.getWorldDirection(_lookDir)
    camera.position.copy(center).addScaledVector(_lookDir, -dist)
    controls.target.copy(center)
    _syncEulerFromCamera()
  }

  return {
    scene, renderer, composer, n8ao, bloom,
    assignBloomLayer, controls,
    addAnimCallback, setCam, setCenter, focusObject,
    switchProjection,
    get camera() { return camera },
    get isOrtho() { return _isOrtho },
  }
}
