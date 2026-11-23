'use client'

import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { FRAGMENT_SHADER, VERTEX_SHADER } from './hillsShader'
import type { ShaderTier } from './deviceCapability'

/**
 * WebGL layer of the auth backdrop. Only ever mounted through `next/dynamic`
 * from `AuthBackdrop`, and only after `detectBackdropTier()` clears it — so on
 * a device that cannot run it, this module (and three.js with it) is never
 * downloaded.
 *
 * The upstream 21st.dev component leaked its animation frame, its WebGL
 * context and its GPU buffers on unmount. Everything here is torn down.
 */

/**
 * Plane world size, in scene units. FIXED — the vertex shader hardcodes 128.0
 * (half of this) to derive the ridge silhouette, so changing it warps the
 * shape. Cost is tuned through SUBDIVISIONS instead.
 */
const PLANE_SIZE = 256

/**
 * Vertices are the expensive axis here: mobile GPUs are tile-based and must
 * write every transformed vertex out to memory for binning, and this vertex
 * shader runs three Perlin noise evaluations per vertex.
 *
 * The original used 256 subdivisions => 257x257 = ~66k vertices.
 */
const SUBDIVISIONS: Record<ShaderTier, number> = {
  medium: 96, //  ~9.4k vertices — touch devices
  high: 176, // ~31k vertices — desktop
}

/** Skip the first frames: shader compilation and the initial buffer upload
 *  are slow on every device and would poison the measurement. */
const WARMUP_MS = 350

/** Measurement window. Kept time-based, not frame-based, so a genuinely slow
 *  device is caught in ~1.5s total instead of taking many seconds to reach a
 *  fixed frame count. */
const SAMPLE_MS = 1200

/** Below this the animation reads as stutter rather than motion. */
const MIN_FPS = 28

/**
 * Backstop on the frame delta. `Timer.connect(document)` already suppresses
 * the huge gap produced by a backgrounded tab via the Page Visibility API;
 * this also covers the stalls it does not see (a long GC pause, a throttled
 * frame), which would otherwise teleport the animation.
 */
const MAX_DELTA = 1 / 20

/** Design token driving the ridge colour, resolved live from the theme. */
const INK_TOKEN = '--dim'
const FALLBACK_INK: [number, number, number] = [0.6, 0.6, 0.6]

interface HillsCanvasProps {
  tier: ShaderTier
  /** Called once the first frame is on screen, to fade the canvas in. */
  onReady: () => void
  /** Called if the device turns out not to cope, or the context is lost. */
  onDegraded: () => void
}

export function HillsCanvas({ tier, onReady, onDegraded }: HillsCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  // Held in refs so changing callback identity never restarts the renderer.
  // Synced in an effect rather than during render — writing a ref while
  // rendering is not safe under concurrent React.
  const onReadyRef = useRef(onReady)
  const onDegradedRef = useRef(onDegraded)

  useEffect(() => {
    onReadyRef.current = onReady
    onDegradedRef.current = onDegraded
  })

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    // The canvas is created here rather than rendered by React on purpose.
    // Teardown calls `forceContextLoss()`, which permanently prevents that
    // canvas element from ever getting another WebGL context — so a React 19
    // StrictMode remount would find a dead canvas if we reused one from a ref.
    // A fresh element per mount sidesteps that entirely.
    const canvas = document.createElement('canvas')
    canvas.style.display = 'block'
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    container.appendChild(canvas)

    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: false,
        // The upstream component omitted this while calling setClearColor with
        // alpha 0 — with no alpha channel in the drawing buffer that yields an
        // opaque BLACK page, not a transparent one. We need the themed page
        // background to show through.
        alpha: true,
        powerPreference: 'low-power',
      })
    } catch {
      // Driver refused a context. Nothing to clean up; hand back to the static
      // backdrop rather than letting this bubble into the login error boundary.
      canvas.remove()
      onDegradedRef.current()
      return
    }

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(45, 1, 1, 10000)

    // `Timer`, not the deprecated `Clock`: it takes the rAF timestamp directly,
    // and `connect` lets it use the Page Visibility API so a backgrounded tab
    // does not come back with one enormous delta.
    const timer = new THREE.Timer()
    timer.connect(document)

    const uniforms = {
      time: { value: 0 },
      uColor: { value: new THREE.Vector3(...readInk(container)) },
      uOpacity: { value: 0.6 },
    }

    const geometry = new THREE.PlaneGeometry(
      PLANE_SIZE,
      PLANE_SIZE,
      SUBDIVISIONS[tier],
      SUBDIVISIONS[tier],
    )
    const material = new THREE.RawShaderMaterial({
      uniforms,
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      // 130k transparent triangles with depth writes on produce sorting
      // artefacts. This is a soft additive haze; it does not need the z-buffer.
      depthWrite: false,
    })
    const mesh = new THREE.Mesh(geometry, material)
    scene.add(mesh)

    renderer.setClearColor(0x000000, 0)
    // Retina tablets would otherwise quadruple the fill-rate cost of a
    // full-screen transparent pass. Soft haze hides the lower resolution.
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, tier === 'high' ? 1.5 : 1))
    camera.position.set(0, 16, 125)
    camera.lookAt(0, 28, 0)

    let rafId = 0
    let disposed = false
    let startedAt = 0
    let sampleStart = 0
    let sampleFrames = 0
    let judged = false
    let announced = false

    const resize = () => {
      const { clientWidth, clientHeight } = container
      if (clientWidth === 0 || clientHeight === 0) return
      camera.aspect = clientWidth / clientHeight
      camera.updateProjectionMatrix()
      // `false` => three must not write inline styles; the CSS above owns them.
      renderer.setSize(clientWidth, clientHeight, false)
    }

    const degrade = () => {
      if (disposed) return
      teardown()
      onDegradedRef.current()
    }

    const handleContextLost = (event: Event) => {
      // Android drops WebGL contexts under memory pressure — app switching is
      // enough. Without preventDefault the browser will not even try to
      // restore. We do not attempt a restore: this is a login screen, so we
      // just fall back permanently and keep it boring.
      event.preventDefault()
      degrade()
    }

    const loop = (now: number) => {
      rafId = requestAnimationFrame(loop)

      timer.update(now)
      uniforms.time.value += Math.min(timer.getDelta(), MAX_DELTA) * 0.5
      renderer.render(scene, camera)

      if (!announced) {
        announced = true
        onReadyRef.current()
      }

      if (judged) return
      if (startedAt === 0) {
        startedAt = now
        return
      }
      if (now - startedAt < WARMUP_MS) return
      if (sampleStart === 0) {
        sampleStart = now
        return
      }

      sampleFrames++
      const elapsed = now - sampleStart
      if (elapsed >= SAMPLE_MS) {
        judged = true
        if ((sampleFrames * 1000) / elapsed < MIN_FPS) degrade()
      }
    }

    // The ridge colour follows the theme toggle, which flips `data-theme` on
    // the root element.
    const themeObserver = new MutationObserver(() => {
      uniforms.uColor.value.set(...readInk(container))
    })
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    })

    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(container)
    canvas.addEventListener('webglcontextlost', handleContextLost)

    resize()
    rafId = requestAnimationFrame(loop)

    function teardown() {
      if (disposed) return
      disposed = true
      cancelAnimationFrame(rafId)
      canvas.removeEventListener('webglcontextlost', handleContextLost)
      resizeObserver.disconnect()
      themeObserver.disconnect()
      timer.dispose()
      geometry.dispose()
      material.dispose()
      renderer.dispose()
      // Releases the GPU context immediately instead of waiting for GC.
      renderer.forceContextLoss()
      canvas.remove()
    }

    return teardown
  }, [tier])

  return <div ref={containerRef} className="h-full w-full" aria-hidden="true" />
}

/**
 * Resolves a design token to a linear-ish RGB triple for the shader. Read from
 * the canvas container, not <html>: the auth surface re-seats its own palette.
 * Falls back to neutral grey if the token is missing or not a plain hex —
 * `color-mix()` values, for instance, are not parsed here.
 */
function readInk(el: Element): [number, number, number] {
  const raw = getComputedStyle(el).getPropertyValue(INK_TOKEN).trim()
  const match = /^#([0-9a-f]{6})$/i.exec(raw)
  if (!match) return FALLBACK_INK

  const value = parseInt(match[1], 16)
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255]
}
