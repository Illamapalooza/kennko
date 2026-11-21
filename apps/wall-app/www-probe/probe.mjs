import { createScene } from './scene/scene.mjs'

const verdictEl = document.getElementById('verdict')
const statusEl = document.getElementById('status')
const detailsEl = document.getElementById('details')
const overlayBtn = document.getElementById('overlay-btn')
const canvas = document.getElementById('wall')
const stage = document.getElementById('stage')

const tagLayer = document.createElement('div')
tagLayer.className = 'tags'
stage.appendChild(tagLayer)

const errors = []
window.addEventListener('error', (e) => errors.push(`error: ${e.message}`))
window.addEventListener('unhandledrejection', (e) => errors.push(`rejection: ${e.reason}`))

let frames = 0
let sseFrames = 0
let discovered = null
let probeInfo = null
let audioBeeped = false

const origRaf = window.requestAnimationFrame.bind(window)
window.requestAnimationFrame = (cb) => origRaf((ts) => {
  frames++
  cb(ts)
})

const scene = createScene(canvas, tagLayer, {})
const stages = ['queued', 'preparing', 'serving']
let tick = 0
function pushSample() {
  const s1 = stages[tick % 3]
  const s2 = stages[(tick + 1) % 3]
  scene.sync({
    baristas: 2,
    orders: [
      { id: 1, label: '#1', status: s1, items: [{ name: 'Café Latte', qty: 1 }], name: 'Maya', createdAt: Date.now() - 10_000 },
      { id: 2, label: '#2', status: s2, items: [{ name: 'Matcha', qty: 2 }], name: 'Leo', createdAt: Date.now() - 5_000 },
    ],
  }, [], Date.now())
  tick++
}
pushSample()
setInterval(pushSample, 5000)

function playBeep() {
  try {
    const Ctor = window.AudioContext || window.webkitAudioContext
    const ctx = new Ctor()
    if (ctx.state === 'suspended') ctx.resume()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.frequency.value = 440
    gain.gain.value = 0.2
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.18)
    audioBeeped = true
  } catch (e) {
    errors.push(`audio: ${e.message}`)
  }
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') playBeep()
})
window.addEventListener('click', (e) => {
  if (e.target !== overlayBtn) playBeep()
})

const features = {
  EventSource: typeof EventSource === 'function',
  ESModules: true,
  OptionalNullish: (() => { const x = { a: 1 }; return (x?.a ?? 0) === 1 })(),
  ArrayAt: typeof Array.prototype.at === 'function',
  StructuredClone: typeof structuredClone === 'function',
  AudioContext: Boolean(window.AudioContext || window.webkitAudioContext),
  IntlManila: (() => {
    try { return new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila' }).format(0).length > 0 } catch { return false }
  })(),
}

const KennkoProbe = window.Capacitor?.Plugins?.KennkoProbe

async function runDiscovery() {
  if (!KennkoProbe) {
    discovered = { error: 'KennkoProbe plugin missing' }
    return
  }
  probeInfo = await KennkoProbe.info().catch((e) => ({ error: String(e) }))
  if (probeInfo && probeInfo.canDrawOverlays === false) {
    overlayBtn.style.display = 'inline-block'
    overlayBtn.onclick = () => KennkoProbe.requestOverlay()
  }
  discovered = await KennkoProbe.discover({ type: '_kennko-pos._tcp.' }).catch((e) => ({ error: String(e) }))
  if (discovered && discovered.host) {
    const es = new EventSource(`http://${discovered.host}:${discovered.port}/api/wall/events`)
    es.onmessage = () => { sseFrames++ }
    es.onerror = () => {}
  }
}

runDiscovery()

function majorWebView(ver) {
  const m = /^\d+/.exec(String(ver || ''))
  return m ? Number(m[0]) : 0
}

const startedAt = Date.now()
function render() {
  const elapsed = Math.floor((Date.now() - startedAt) / 1000)
  const remaining = Math.max(0, 60 - elapsed)
  const wvMajor = majorWebView(probeInfo?.webViewVersion)

  statusEl.textContent = `Frames: ${frames} | SSE frames: ${sseFrames} | Beep (press OK): ${audioBeeped ? 'yes' : 'tap OK'}`
  detailsEl.textContent = JSON.stringify({
    info: probeInfo,
    features,
    discovered,
    errors: errors.slice(0, 5),
  }, null, 2)

  if (remaining > 0) {
    verdictEl.textContent = `PROBING… ${remaining}s`
  } else {
    const reasons = []
    if (frames < 30) reasons.push(`low frames (${frames})`)
    if (errors.length > 0) reasons.push(...errors)
    if (wvMajor > 0 && wvMajor < 90) reasons.push(`WebView ${probeInfo?.webViewVersion} < 90`)
    for (const [k, v] of Object.entries(features)) if (!v) reasons.push(`missing ${k}`)
    if (!discovered?.host) reasons.push(`discovery: ${discovered?.error ?? 'failed'}`)
    if (sseFrames === 0) reasons.push('no SSE frames')

    if (reasons.length === 0) {
      verdictEl.className = 'pass'
      verdictEl.textContent = 'PASS'
    } else {
      verdictEl.className = 'fail'
      verdictEl.textContent = `FAIL: ${reasons.join('; ')}`
    }
  }
}

setInterval(render, 500)
render()
