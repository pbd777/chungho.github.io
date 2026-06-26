import GUI from 'lil-gui'

/**
 * 디버그 GUI
 * - 오브젝트별 position / scale 슬라이더
 * - 조명 강도 / 색상
 * - 변경값을 콘솔에 출력 → loader.js에 복사해서 확정
 */
export function createDebugGUI(scene, sceneRef) {
  const mount = document.getElementById('debug-gui-mount')
  const gui = new GUI({ title: 'IVAS Debug', container: mount ?? undefined })

  // ── 조명 ──
  const lightFolder = gui.addFolder('조명')

  const lightParams = {
    ambientIntensity: 2.5,
    sunIntensity: 3.5,
    fillIntensity: 1.2,
    exposure: 1.8,
  }

  // scene에서 조명 찾기
  let ambient, sun, fill
  scene.traverse(obj => {
    if (obj.isAmbientLight) ambient = obj
    if (obj.isDirectionalLight && obj.position.x > 0) sun = obj
    if (obj.isDirectionalLight && obj.position.x < 0) fill = obj
  })

  if (ambient) {
    lightFolder.add(lightParams, 'ambientIntensity', 0, 6, 0.1)
      .name('전체 밝기').onChange(v => { ambient.intensity = v })
  }
  if (sun) {
    lightFolder.add(lightParams, 'sunIntensity', 0, 8, 0.1)
      .name('태양광').onChange(v => { sun.intensity = v })
  }
  if (sceneRef?.outputPass) {
    lightFolder.add(lightParams, 'exposure', 0.5, 4, 0.05)
      .name('노출').onChange(v => { sceneRef.outputPass.toneMappingExposure = v })
  }
  lightFolder.close()

  // ── N8AO ──
  if (sceneRef?.n8ao) {
    const cfg = sceneRef.n8ao.configuration
    const aoFolder = gui.addFolder('SSAO (N8AO)')

    const aoToggle = { enabled: true }
    aoFolder.add(aoToggle, 'enabled').name('활성화')
      .onChange(v => { sceneRef.n8ao.enabled = v })
    aoFolder.add(cfg, 'aoRadius', 0.5, 50, 0.5).name('반경 (m)')
    aoFolder.add(cfg, 'distanceFalloff', 0.1, 10, 0.1).name('거리 감쇠')
    aoFolder.add(cfg, 'intensity', 0, 20, 0.5).name('강도')
    aoFolder.add(cfg, 'aoSamples', 4, 64, 4).name('샘플 수')
    aoFolder.add(cfg, 'denoiseSamples', 1, 16, 1).name('디노이즈 샘플')
    aoFolder.add(cfg, 'denoiseRadius', 1, 24, 1).name('디노이즈 반경')
    aoFolder.add(cfg, 'biasOffset', 0, 0.5, 0.01).name('바이어스 오프셋')
    aoFolder.add(cfg, 'biasMultiplier', 0, 1, 0.01).name('바이어스 배율')

    // 디버그 출력 모드 — setDisplayMode는 문자열을 받음
    const debugParams = { mode: 'Combined' }
    aoFolder.add(debugParams, 'mode', ['Combined', 'AO', 'No AO', 'Split', 'Split AO']).name('디버그 모드')
      .onChange(v => { sceneRef.n8ao.setDisplayMode(v) })

    aoFolder.close()
  }

  // ── Bloom ──
  if (sceneRef?.bloom) {
    const b = sceneRef.bloom
    const bloomFolder = gui.addFolder('Bloom')

    const bloomToggle = { enabled: true }
    bloomFolder.add(bloomToggle, 'enabled').name('활성화')
      .onChange(v => { b.enabled = v })
    bloomFolder.add(b, 'strength', 0, 3, 0.05).name('강도')
    bloomFolder.add(b, 'radius',   0, 1, 0.05).name('반경')
    bloomFolder.add(b, 'threshold', 0, 1, 0.01).name('임계값')
    bloomFolder.close()
  }

  // ── 오브젝트 ──
  const objFolder = gui.addFolder('오브젝트 배치')
  objFolder.open()

  // 선택된 오브젝트 상태
  let selectedObj = null
  let selectedFolder = null
  const posParams = { x: 0, y: 0, z: 0, scale: 0.01 }

  // scene에서 FBX 루트 오브젝트 목록 수집
  const fbxObjects = []
  scene.children.forEach(child => {
    if (child.userData?.label) {
      fbxObjects.push(child)
    }
  })

  // 오브젝트 선택 드롭다운
  const selectParams = { target: '(선택)' }
  const nameMap = {}
  fbxObjects.forEach(obj => { nameMap[obj.userData.label] = obj })
  nameMap['(선택)'] = null

  objFolder.add(selectParams, 'target', Object.keys(nameMap))
    .name('오브젝트').onChange(label => {
      selectedObj = nameMap[label]
      if (selectedFolder) selectedFolder.destroy()
      if (!selectedObj) return

      selectedFolder = gui.addFolder(`📦 ${label}`)
      selectedFolder.open()

      posParams.x = +selectedObj.position.x.toFixed(2)
      posParams.y = +selectedObj.position.y.toFixed(2)
      posParams.z = +selectedObj.position.z.toFixed(2)
      posParams.scale = +selectedObj.scale.x.toFixed(4)

      const range = 500
      selectedFolder.add(posParams, 'x', -range, range, 0.5).name('X').onChange(v => {
        selectedObj.position.x = v
        printTransform(label, posParams)
      })
      selectedFolder.add(posParams, 'y', -range, range, 0.5).name('Y').onChange(v => {
        selectedObj.position.y = v
        printTransform(label, posParams)
      })
      selectedFolder.add(posParams, 'z', -range, range, 0.5).name('Z').onChange(v => {
        selectedObj.position.z = v
        printTransform(label, posParams)
      })
      selectedFolder.add(posParams, 'scale', 0.001, 0.1, 0.001).name('Scale').onChange(v => {
        selectedObj.scale.setScalar(v)
        printTransform(label, posParams)
      })

      // 리셋 버튼
      selectedFolder.add({ reset: () => {
        posParams.x = 0; posParams.y = 0; posParams.z = 0; posParams.scale = 0.01
        selectedObj.position.set(0, 0, 0)
        selectedObj.scale.setScalar(0.01)
        selectedFolder.controllers.forEach(c => c.updateDisplay())
      }}, 'reset').name('원점으로 리셋')
    })

  // ── 전체 출력 버튼 ──
  gui.add({
    exportAll: () => {
      console.log('\n===== BUILDINGS 배치 결과 (loader.js에 복사) =====')
      fbxObjects.forEach(obj => {
        const p = obj.position
        const s = obj.scale.x
        console.log(
          `  { label: '${obj.userData.label}', ` +
          `position: [${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}], ` +
          `scale: ${s.toFixed(4)} },`
        )
      })
      console.log('===================================================\n')
    }
  }, 'exportAll').name('📋 전체 좌표 콘솔 출력')

  return gui
}

function printTransform(label, p) {
  console.log(
    `[${label}] position: [${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}]  scale: ${p.scale.toFixed(4)}`
  )
}
