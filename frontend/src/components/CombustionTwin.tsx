"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

import { clock } from "@/lib/playback";
import type { SeriesKey, Simulation } from "@/lib/types";

export type SensorMode = "optical" | "uv";

const FOV_DEG = 28;
const SOOT_POINTS = 2600;
const STREAKS = 70;

const SHELL_VERTEX = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vLocal;
  void main() {
    vLocal = position;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

// An optically thin emitting shell is brightest at the limb, where the line
// of sight through the reaction zone is longest (path length ~ 1 / cos).
const SHELL_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uCore;
  uniform float uIntensity;
  uniform float uTime;
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vLocal;
  void main() {
    float ndv = abs(dot(normalize(vNormal), normalize(vView)));
    float path = min(1.0 / max(ndv, 0.14), 7.0) / 7.0;
    float ripple = 0.94 + 0.06 * sin(vLocal.y * 9.0 + uTime * 1.7) * sin(vLocal.x * 7.0 - uTime * 1.3);
    float a = uIntensity * (0.26 + 0.74 * pow(path, 1.5)) * ripple;
    vec3 col = mix(uColor, uCore, clamp(uIntensity - 0.85, 0.0, 1.0) * path);
    gl_FragColor = vec4(col * a, a);
  }
`;

const DROPLET_FRAGMENT = /* glsl */ `
  uniform vec3 uRim;
  uniform float uRimGain;
  uniform float uBacklight;
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vLocal;
  void main() {
    vec3 n = normalize(vNormal);
    vec3 v = normalize(vView);
    float ndv = max(dot(n, v), 0.0);
    float fresnel = pow(1.0 - ndv, 3.0);
    vec3 key = normalize(vec3(0.45, 0.6, 0.65));
    float spec = pow(max(dot(n, normalize(key + v)), 0.0), 140.0);
    float window = pow(max(dot(n, normalize(vec3(-0.5, -0.4, 0.6))), 0.0), 14.0);
    // A liquid sphere refracts the backlight toward the side opposite the key light.
    float refracted = smoothstep(-0.5, 1.0, dot(n, normalize(vec3(-0.35, -0.55, 0.45))));
    vec3 body = mix(vec3(0.030, 0.035, 0.044), vec3(0.125, 0.140, 0.170), refracted * refracted) * uBacklight;
    vec3 flameLight = uRim * uRimGain * (0.06 + 0.94 * fresnel);
    vec3 col = body
      + flameLight
      + fresnel * uBacklight * vec3(0.30, 0.34, 0.40)
      + spec * (0.55 * uBacklight + 0.7 * uRimGain)
      + window * 0.07 * uBacklight;
    gl_FragColor = vec4(col, 1.0);
  }
`;

const GLOW_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Camera-facing quad three shell diameters across. Emission fills the shell
// interior faintly and decays exponentially outside it, like bloom on a sensor.
const GLOW_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uIntensity;
  varying vec2 vUv;
  void main() {
    float r = length(vUv - 0.5) * 6.0;
    float g = r < 1.0 ? 0.15 + 0.23 * r * r : 0.38 * exp(-(r - 1.0) * 2.4);
    g *= smoothstep(3.0, 2.0, r);
    float dither = (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
    gl_FragColor = vec4(uColor, g * uIntensity + dither);
  }
`;

const GLOW_SPAN = 3;

/** Horizontal stretch and downstream shift of the flame under forced flow, in mm. */
export function flameExtent(flameD: number, dropletD: number, airflow: number): { cx: number; rx: number; ry: number; stretch: number; diameter: number } {
  const stretch = 1 + Math.min(0.03 * airflow, 0.5);
  const diameter = Math.max(flameD, dropletD * 1.05);
  return { cx: 0.3 * (stretch - 1) * diameter, rx: 0.5 * diameter * stretch, ry: 0.5 * diameter, stretch, diameter };
}

export function sample(sim: Simulation, key: SeriesKey, t: number): number {
  const arr = sim.series[key];
  const x = Math.min(Math.max(t / sim.query.dt_s, 0), arr.length - 1);
  const i = Math.floor(x);
  const j = Math.min(i + 1, arr.length - 1);
  return arr[i] + (arr[j] - arr[i]) * (x - i);
}

export function CombustionTwin({
  sim,
  mode,
  onScale,
}: {
  sim: Simulation | null;
  mode: SensorMode;
  onScale?: (pxPerMm: number) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const simRef = useRef<Simulation | null>(sim);
  const modeRef = useRef<SensorMode>(mode);
  const onScaleRef = useRef(onScale);

  simRef.current = sim;
  modeRef.current = mode;
  onScaleRef.current = onScale;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x050608, 1);
    host.appendChild(renderer.domElement);
    renderer.domElement.style.display = "block";

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(FOV_DEG, 1, 0.1, 2000);

    const fiber = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.04, 400, 8),
      new THREE.MeshBasicMaterial({ color: 0x3a404b, transparent: true, opacity: 0.5 }),
    );
    fiber.rotation.z = Math.PI / 2;
    scene.add(fiber);

    const dropletMat = new THREE.ShaderMaterial({
      vertexShader: SHELL_VERTEX,
      fragmentShader: DROPLET_FRAGMENT,
      uniforms: { uRim: { value: new THREE.Color(0x3b82f6) }, uRimGain: { value: 0 }, uBacklight: { value: 1 } },
    });
    const droplet = new THREE.Mesh(new THREE.SphereGeometry(0.5, 64, 48), dropletMat);
    scene.add(droplet);

    const makeShell = (): THREE.ShaderMaterial =>
      new THREE.ShaderMaterial({
        vertexShader: SHELL_VERTEX,
        fragmentShader: SHELL_FRAGMENT,
        uniforms: {
          uColor: { value: new THREE.Color() },
          uCore: { value: new THREE.Color() },
          uIntensity: { value: 0 },
          uTime: { value: 0 },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });

    const flameGroup = new THREE.Group();
    scene.add(flameGroup);
    const shellGeo = new THREE.SphereGeometry(0.5, 96, 64);
    const flameMat = makeShell();
    const flame = new THREE.Mesh(shellGeo, flameMat);
    flameGroup.add(flame);
    const haloMat = makeShell();
    const halo = new THREE.Mesh(shellGeo, haloMat);
    flameGroup.add(halo);

    const makeGlow = (): THREE.ShaderMaterial =>
      new THREE.ShaderMaterial({
        vertexShader: GLOW_VERTEX,
        fragmentShader: GLOW_FRAGMENT,
        uniforms: { uColor: { value: new THREE.Color() }, uIntensity: { value: 0 } },
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
      });
    const glowGeo = new THREE.PlaneGeometry(1, 1);
    const flameGlowMat = makeGlow();
    const flameGlow = new THREE.Mesh(glowGeo, flameGlowMat);
    flameGlow.renderOrder = 2;
    flameGroup.add(flameGlow);
    const sootGlowMat = makeGlow();
    const sootGlow = new THREE.Mesh(glowGeo, sootGlowMat);
    sootGlow.renderOrder = 2;
    flameGroup.add(sootGlow);

    const sootPositions = new Float32Array(SOOT_POINTS * 3);
    for (let i = 0; i < SOOT_POINTS; i++) {
      // Uniform points on a sphere with a thin radial spread: the soot shell
      // sits where thermophoresis balances the outward Stefan flow.
      const u = Math.random() * 2 - 1;
      const phi = Math.random() * Math.PI * 2;
      const r = 0.5 * (0.94 + 0.12 * Math.random());
      const s = Math.sqrt(1 - u * u);
      sootPositions[3 * i] = r * s * Math.cos(phi);
      sootPositions[3 * i + 1] = r * u;
      sootPositions[3 * i + 2] = r * s * Math.sin(phi);
    }
    const sootGeo = new THREE.BufferGeometry();
    sootGeo.setAttribute("position", new THREE.BufferAttribute(sootPositions, 3));
    const sprite = document.createElement("canvas");
    sprite.width = sprite.height = 32;
    const ctx = sprite.getContext("2d");
    if (ctx) {
      const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
      g.addColorStop(0, "rgba(255,255,255,1)");
      g.addColorStop(0.5, "rgba(255,255,255,0.55)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 32, 32);
    }
    const sootTexture = new THREE.CanvasTexture(sprite);
    const sootMat = new THREE.PointsMaterial({
      map: sootTexture,
      size: 0.22,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      color: 0xffa040,
    });
    const soot = new THREE.Points(sootGeo, sootMat);
    flameGroup.add(soot);

    const streakPositions = new Float32Array(STREAKS * 6);
    const streakSeed = Array.from({ length: STREAKS }, () => ({
      x: Math.random(),
      y: Math.random() * 2 - 1,
      z: Math.random() * 2 - 1,
      v: 0.7 + 0.6 * Math.random(),
    }));
    const streakGeo = new THREE.BufferGeometry();
    streakGeo.setAttribute("position", new THREE.BufferAttribute(streakPositions, 3));
    const streakMat = new THREE.LineBasicMaterial({ color: 0x8b949e, transparent: true, opacity: 0, depthWrite: false });
    const streaks = new THREE.LineSegments(streakGeo, streakMat);
    scene.add(streaks);

    let fieldHeight = 40;

    // Orbit view: drag to rotate about the droplet, wheel to zoom, double-click to reset.
    const view = { yaw: 0, pitch: 0, zoom: 1 };
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    const onPointerDown = (e: PointerEvent): void => {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      host.setPointerCapture(e.pointerId);
      host.style.cursor = "grabbing";
    };
    const onPointerMove = (e: PointerEvent): void => {
      if (!dragging) return;
      view.yaw -= (e.clientX - lastX) * 0.008;
      view.pitch = Math.min(Math.max(view.pitch + (e.clientY - lastY) * 0.008, -1.35), 1.35);
      lastX = e.clientX;
      lastY = e.clientY;
    };
    const onPointerUp = (e: PointerEvent): void => {
      dragging = false;
      if (host.hasPointerCapture(e.pointerId)) host.releasePointerCapture(e.pointerId);
      host.style.cursor = "grab";
    };
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      view.zoom = Math.min(Math.max(view.zoom * Math.exp(-e.deltaY * 0.0012), 0.6), 6);
    };
    const onReset = (): void => {
      view.yaw = 0;
      view.pitch = 0;
      view.zoom = 1;
    };
    host.style.cursor = "grab";
    host.style.touchAction = "none";
    host.addEventListener("pointerdown", onPointerDown);
    host.addEventListener("pointermove", onPointerMove);
    host.addEventListener("pointerup", onPointerUp);
    host.addEventListener("pointercancel", onPointerUp);
    host.addEventListener("wheel", onWheel, { passive: false });
    host.addEventListener("dblclick", onReset);
    let fieldTarget = 40;
    let width = 1;
    let height = 1;
    let lastReportedScale = 0;

    const resize = (): void => {
      width = Math.max(host.clientWidth, 1);
      height = Math.max(host.clientHeight, 1);
      renderer.setSize(width, height, false);
      renderer.domElement.style.width = `${width}px`;
      renderer.domElement.style.height = `${height}px`;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    const optFlame = new THREE.Color(0.22, 0.42, 1.0);
    const optCore = new THREE.Color(0.85, 0.9, 1.0);
    const optSoot = new THREE.Color(1.0, 0.62, 0.22);
    const optSootCore = new THREE.Color(1.0, 0.93, 0.7);
    const uvFlame = new THREE.Color(0.231, 0.51, 0.965);
    const uvCore = new THREE.Color(0.86, 0.93, 1.0);
    const coldSoot = new THREE.Color(0.32, 0.33, 0.36);

    let mix = modeRef.current === "uv" ? 1 : 0;
    let raf = 0;
    let previous = performance.now();
    let wall = 0;
    let streakPhase = 0;

    const frame = (now: number): void => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min((now - previous) / 1000, 0.1);
      previous = now;
      wall += dt;

      const current = simRef.current;
      const target = modeRef.current === "uv" ? 1 : 0;
      mix += (target - mix) * Math.min(dt * 5, 1);

      let d = 3.9;
      let flameD = 0;
      let visible = 0;
      let uv = 0;
      let sootD = 0;
      let sootMass = 0;
      let airflow = 0;
      let hot = 0;

      if (current) {
        const t = clock.time;
        d = sample(current, "d_mm", t);
        flameD = sample(current, "flame_diameter_mm", t);
        visible = sample(current, "visible_luminosity", t);
        uv = sample(current, "uv_intensity", t);
        sootD = sample(current, "soot_shell_diameter_mm", t);
        sootMass = sample(current, "soot_mass_ug", t);
        airflow = sample(current, "airflow_cm_s", t);
        hot = Math.min(visible * 6, 1);

        let maxFlame = 0;
        const fd = current.series.flame_diameter_mm;
        for (let i = 0; i < fd.length; i++) if (fd[i] > maxFlame) maxFlame = fd[i];
        fieldTarget = Math.max(1.55 * maxFlame, 3.2 * current.query.d0_mm, 14);
      }

      fieldHeight += (fieldTarget - fieldHeight) * Math.min(dt * 4, 1);
      const distance = fieldHeight / 2 / Math.tan((FOV_DEG * Math.PI) / 360) / view.zoom;
      camera.position.set(
        distance * Math.sin(view.yaw) * Math.cos(view.pitch),
        distance * Math.sin(view.pitch),
        distance * Math.cos(view.yaw) * Math.cos(view.pitch),
      );
      camera.lookAt(0, 0, 0);
      const pxPerMm = (height / fieldHeight) * view.zoom;
      if (Math.abs(pxPerMm - lastReportedScale) > 0.02 * pxPerMm) {
        lastReportedScale = pxPerMm;
        onScaleRef.current?.(pxPerMm);
      }

      const optical = Math.min(1.25 * Math.pow(Math.max(visible, 0), 0.3), 1.4);
      // The intensified UV channel spans four decades; map log10(I) from
      // 1e-5 (dark signal) to 1 (hot flame) onto display intensity.
      const uvDisplay = uv > 1e-5 ? Math.min(Math.max((Math.log10(uv) + 5) / 3.4, 0), 1.3) : 0;
      const intensity = optical * (1 - mix) + uvDisplay * mix;

      droplet.scale.setScalar(Math.max(d, 0.05));
      dropletMat.uniforms.uBacklight.value = 1 - 0.75 * mix;
      dropletMat.uniforms.uRimGain.value = intensity * 0.9;
      (dropletMat.uniforms.uRim.value as THREE.Color).copy(optFlame).lerp(uvFlame, mix);
      (fiber.material as THREE.MeshBasicMaterial).opacity = 0.5 * (1 - 0.7 * mix);

      const extent = flameExtent(flameD, d, airflow);
      const fdDraw = extent.diameter;
      flameGroup.scale.set(extent.stretch, 1, 1);
      flameGroup.position.x = extent.cx;
      flame.scale.setScalar(fdDraw);
      flameGlow.scale.setScalar(fdDraw * GLOW_SPAN);
      flameGlowMat.uniforms.uIntensity.value = (0.55 + 0.75 * mix) * intensity;
      (flameGlowMat.uniforms.uColor.value as THREE.Color).copy(optFlame).lerp(uvFlame, mix);
      flameMat.uniforms.uIntensity.value = intensity;
      flameMat.uniforms.uTime.value = wall;
      (flameMat.uniforms.uColor.value as THREE.Color).copy(optFlame).lerp(uvFlame, mix);
      (flameMat.uniforms.uCore.value as THREE.Color).copy(optCore).lerp(uvCore, mix);

      // Soot-shell incandescence is a visible-band signal only.
      const sootShell = Math.max(sootD, d * 1.2);
      const sootLoad = Math.min(sootMass / 25, 1);
      halo.scale.setScalar(sootShell * 1.04);
      haloMat.uniforms.uIntensity.value = 0.75 * optical * sootLoad * (1 - mix);
      haloMat.uniforms.uTime.value = wall * 0.6;
      (haloMat.uniforms.uColor.value as THREE.Color).copy(optSoot);
      (haloMat.uniforms.uCore.value as THREE.Color).copy(optSootCore);
      sootGlow.scale.setScalar(sootShell * 1.04 * GLOW_SPAN);
      sootGlowMat.uniforms.uIntensity.value = 0.5 * optical * sootLoad * (1 - mix);
      (sootGlowMat.uniforms.uColor.value as THREE.Color).copy(optSoot);

      soot.scale.setScalar(sootShell);
      soot.rotation.y = wall * 0.05;
      sootMat.size = 0.014 * fieldHeight;
      if (hot > 0.05) {
        sootMat.blending = THREE.AdditiveBlending;
        sootMat.color.copy(optSoot);
        sootMat.opacity = 0.75 * sootLoad * hot * (1 - mix);
      } else {
        sootMat.blending = THREE.NormalBlending;
        sootMat.color.copy(coldSoot);
        sootMat.opacity = 0.5 * sootLoad * (1 - 0.8 * mix);
      }

      const span = fieldHeight * camera.aspect * 0.62;
      const speed = airflow * 0.9;
      streakPhase += (dt * speed) / (2 * span);
      for (let i = 0; i < STREAKS; i++) {
        const s = streakSeed[i];
        const x = (((s.x + streakPhase * s.v) % 1) * 2 - 1) * span;
        const y = s.y * fieldHeight * 0.52;
        const z = s.z * fieldHeight * 0.3;
        const len = 0.012 * fieldHeight * (1 + 0.25 * airflow);
        streakPositions.set([x, y, z, x + len, y, z], 6 * i);
      }
      streakGeo.attributes.position.needsUpdate = true;
      streakMat.opacity = Math.min(airflow / 6, 1) * 0.22;

      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      host.removeEventListener("pointerdown", onPointerDown);
      host.removeEventListener("pointermove", onPointerMove);
      host.removeEventListener("pointerup", onPointerUp);
      host.removeEventListener("pointercancel", onPointerUp);
      host.removeEventListener("wheel", onWheel);
      host.removeEventListener("dblclick", onReset);
      cancelAnimationFrame(raf);
      observer.disconnect();
      shellGeo.dispose();
      glowGeo.dispose();
      sootGeo.dispose();
      sootTexture.dispose();
      streakGeo.dispose();
      droplet.geometry.dispose();
      fiber.geometry.dispose();
      [flameMat, haloMat, flameGlowMat, sootGlowMat, dropletMat, sootMat, streakMat, fiber.material as THREE.Material].forEach((m) => m.dispose());
      renderer.dispose();
      host.removeChild(renderer.domElement);
    };
  }, []);

  return <div ref={hostRef} className="absolute inset-0" data-testid="twin-canvas" role="img" aria-label="Rendered view of the burning droplet" />;
}
