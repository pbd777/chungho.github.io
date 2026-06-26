import * as THREE from 'three'
import { state } from './sensor.js'

const MARKER_DEFS = [
  { id: 'temp',  pos: [9,  1.8, -7],   color: 0xef9f27, label: '변압기 온도' },
  { id: 'noise', pos: [-8, 2.2,  0],   color: 0x5dcaa5, label: '소음' },
  { id: 'light', pos: [0,  0.5,  8],   color: 0x85b7eb, label: '조도' },
  { id: 'laser', pos: [-1, 1.3, -5.5], color: 0xe24b4a, label: '레이저 커튼' },
]

export function addSensorMarkers(scene) {
  const markers = MARKER_DEFS.map(def => {
    const mat = new THREE.MeshStandardMaterial({
      color: def.color, emissive: def.color, emissiveIntensity: 0.5,
    })
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.22, 14, 14), mat)
    mesh.position.set(...def.pos)
    mesh.userData = { id: def.id, label: def.label }
    scene.add(mesh)
    return { mesh, mat, id: def.id }
  })

  // 레이저 커튼 라인
  const laserGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-1, 1.2, -8),
    new THREE.Vector3(-1, 1.2, -3),
  ])
  const laserLine = new THREE.Line(
    laserGeo,
    new THREE.LineBasicMaterial({ color: 0xff2222, linewidth: 2 })
  )
  laserLine.visible = false
  scene.add(laserLine)

  // 애니메이션 tick (main.js에서 호출)
  function tick() {
    const t = state.temp, n = state.noise

    markers.forEach(sm => {
      const isAlert =
        (sm.id === 'temp'  && t > 80)   ||
        (sm.id === 'noise' && n > 95)   ||
        (sm.id === 'laser' && state.laser)

      sm.mat.emissiveIntensity = isAlert
        ? 1.0 + Math.sin(Date.now() * 0.008) * 0.5
        : 0.5
    })

    laserLine.visible = state.laser
  }

  return { markers, laserLine, tick }
}
