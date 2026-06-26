// 센서 상태
export const state = {
  temp: 52,
  noise: 72,
  light: 420,
  laser: false,
}

const alerts = []
let simT = 0

export function simulate(dt) {
  simT += dt
  state.temp   = 52  + 18 * Math.sin(simT * 0.07)  + (Math.random() - 0.5) * 3
  state.noise  = 72  + 15 * Math.abs(Math.sin(simT * 0.13)) + (Math.random() - 0.5) * 4
  state.light  = 420 - 80 * Math.abs(Math.sin(simT * 0.04)) + (Math.random() - 0.5) * 20

  const prevLaser = state.laser
  state.laser = Math.sin(simT * 0.31) > 0.88

  if (!prevLaser && state.laser)
    pushAlert('danger', '레이저 커튼 감지: 지게차-작업자 충돌 위험')
  if (state.temp > 80 && Math.random() < 0.02)
    pushAlert('danger', `변압기 온도 임계 초과: ${state.temp.toFixed(1)}°C`)
  if (state.noise > 95 && Math.random() < 0.02)
    pushAlert('warn', `소음 경고: ${state.noise.toFixed(0)} dB`)
}

function pushAlert(type, msg) {
  alerts.push({ type, msg, ts: Date.now() })
  if (alerts.length > 3) alerts.shift()
  renderAlerts()
}

function renderAlerts() {
  document.getElementById('alert-box').innerHTML = alerts
    .map(a => `<div class="alert ${a.type}"><div class="alert-dot"></div><span>${a.msg}</span></div>`)
    .join('')
}

export function updateUI() {
  const { temp: t, noise: n, light: l } = state

  // 온도
  set('sv-temp', t.toFixed(1))
  fillBar('sf-temp', (t / 100) * 100, t > 80 ? '#e24b4a' : t > 65 ? '#ef9f27' : '#5dcaa5')
  card('sc-temp', t > 80 ? 'danger' : t > 65 ? 'warn' : '')

  // 소음
  set('sv-noise', n.toFixed(0))
  fillBar('sf-noise', ((n - 40) / 60) * 100, n > 95 ? '#e24b4a' : n > 85 ? '#ef9f27' : '#5dcaa5')
  card('sc-noise', n > 95 ? 'danger' : n > 85 ? 'warn' : '')

  // 조도
  set('sv-light', l.toFixed(0))
  fillBar('sf-light', (l / 600) * 100, l < 100 ? '#ef9f27' : '#5dcaa5')
  card('sc-light', l < 100 ? 'warn' : '')

  // 레이저
  const lEl = document.getElementById('sv-laser')
  lEl.textContent  = state.laser ? '⚠ 감지됨' : '정상'
  lEl.style.color  = state.laser ? '#f09595' : '#6fcf97'
  card('sc-laser', state.laser ? 'danger' : '')

  // 타임스탬프
  document.getElementById('ts').textContent =
    new Date().toLocaleTimeString('ko-KR')
}

function set(id, val) {
  const el = document.getElementById(id)
  if (el) el.textContent = val
}

function fillBar(id, pct, color) {
  const el = document.getElementById(id)
  if (!el) return
  el.style.width      = Math.min(100, Math.max(0, pct)).toFixed(1) + '%'
  el.style.background = color
}

function card(id, level) {
  const el = document.getElementById(id)
  if (!el) return
  el.classList.remove('alert-warn', 'alert-danger')
  if (level === 'warn')   el.classList.add('alert-warn')
  if (level === 'danger') el.classList.add('alert-danger')
}

/* ── MQTT 실제 연결 시 아래 주석 해제 ──
import mqtt from 'mqtt'
export function connectMQTT(brokerUrl = 'ws://서버IP:9001') {
  const client = mqtt.connect(brokerUrl)
  client.subscribe(['ivas/sensor/#', 'ivas/event/alert'])
  client.on('message', (topic, payload) => {
    const data = JSON.parse(payload.toString())
    if (topic.includes('temp'))   state.temp  = data.value
    if (topic.includes('noise'))  state.noise = data.value
    if (topic.includes('light'))  state.light = data.value
    if (topic.includes('laser'))  state.laser = data.value
    if (topic === 'ivas/event/alert') pushAlert(data.level, data.message)
  })
  return client
}
*/
