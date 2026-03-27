import { useState, useRef, useEffect, useCallback } from "react";
import * as THREE from "three";

// ─── Audio Analysis ───
class AudioAnalyser {
  constructor() {
    this.ctx = null;
    this.analyser = null;
    this.dataArray = null;
    this.timeData = null;
    this.bands = { sub: 0, bass: 0, mid: 0, high: 0, treble: 0, energy: 0 };
    this.smoothBands = { sub: 0, bass: 0, mid: 0, high: 0, treble: 0, energy: 0 };
    this.source = null;
  }

  async initMic() {
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.analyser.smoothingTimeConstant = 0.75;
    this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
    this.timeData = new Uint8Array(this.analyser.frequencyBinCount);
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.source = this.ctx.createMediaStreamSource(stream);
    this.source.connect(this.analyser);
  }

  initElement(audioEl) {
    if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.analyser.smoothingTimeConstant = 0.75;
    this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
    this.timeData = new Uint8Array(this.analyser.frequencyBinCount);
    if (this.source) this.source.disconnect();
    this.source = this.ctx.createMediaElementSource(audioEl);
    this.source.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);
  }

  update() {
    if (!this.analyser) return this.smoothBands;
    this.analyser.getByteFrequencyData(this.dataArray);
    this.analyser.getByteTimeDomainData(this.timeData);
    const n = this.dataArray.length;
    const avg = (from, to) => {
      let s = 0, c = 0;
      for (let i = Math.floor(from); i < Math.min(Math.floor(to), n); i++) { s += this.dataArray[i]; c++; }
      return c > 0 ? s / c / 255 : 0;
    };
    this.bands.sub = avg(0, n*0.03);
    this.bands.bass = avg(n*0.03, n*0.08);
    this.bands.mid = avg(n*0.08, n*0.3);
    this.bands.high = avg(n*0.3, n*0.6);
    this.bands.treble = avg(n*0.6, n);
    this.bands.energy = avg(0, n);
    for (const k of Object.keys(this.smoothBands)) {
      const attack = this.bands[k] > this.smoothBands[k] ? 0.4 : 0.08;
      this.smoothBands[k] += (this.bands[k] - this.smoothBands[k]) * attack;
    }
    return this.smoothBands;
  }

  resume() { if (this.ctx && this.ctx.state === "suspended") this.ctx.resume(); }
}

// ─── Particle Sound Wave ───
const PARTICLE_COUNT = 18000;

function createParticleSystem() {
  const positions = new Float32Array(PARTICLE_COUNT * 3);
  const basePositions = new Float32Array(PARTICLE_COUNT * 3);
  const sizes = new Float32Array(PARTICLE_COUNT);
  const alphas = new Float32Array(PARTICLE_COUNT);
  const dists = new Float32Array(PARTICLE_COUNT);

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const x = (Math.random() - 0.5) * 16; // -8 to 8

    // Bimodal: 65% core (tight to wave line), 35% dust (wider scatter)
    const isCore = Math.random() < 0.65;
    const scatterY = isCore
      ? (Math.random() - 0.5) * 1.2
      : (Math.random() - 0.5) * 5.0;
    const scatterZ = isCore
      ? (Math.random() - 0.5) * 2.5
      : (Math.random() - 0.5) * 6.0;

    const dist = Math.sqrt(scatterY * scatterY + scatterZ * scatterZ * 0.3);
    const normDist = Math.min(dist / 2.0, 1.0);

    basePositions[i*3]   = x;
    basePositions[i*3+1] = scatterY;
    basePositions[i*3+2] = scatterZ;
    positions[i*3]   = x;
    positions[i*3+1] = scatterY;
    positions[i*3+2] = scatterZ;

    sizes[i] = isCore
      ? (Math.random() * 1.2 + 0.8)
      : (Math.random() * 1.0 + 0.4) * (0.3 + 0.7 * (1.0 - normDist));
    alphas[i] = isCore
      ? (Math.random() * 0.2 + 0.4)
      : (Math.random() * 0.15 + 0.1) * (1.0 - normDist * 0.6);
    dists[i] = normDist;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("aBase", new THREE.BufferAttribute(basePositions, 3));
  geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute("aAlpha", new THREE.BufferAttribute(alphas, 1));
  geometry.setAttribute("aDist", new THREE.BufferAttribute(dists, 1));

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uBass: { value: 0 },
      uMid: { value: 0 },
      uHigh: { value: 0 },
      uEnergy: { value: 0 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
      uColorDark:   { value: new THREE.Color("#222228") },
      uColorMid:    { value: new THREE.Color("#555560") },
      uColorLight:  { value: new THREE.Color("#999da5") },
      uColorBright: { value: new THREE.Color("#c8ccd4") },
    },
    vertexShader: `
      attribute float aSize;
      attribute float aAlpha;
      attribute float aDist;

      uniform float uTime;
      uniform float uBass;
      uniform float uEnergy;
      uniform float uPixelRatio;

      varying float vAlpha;
      varying float vDist;
      varying vec3 vPos;

      void main() {
        vAlpha = aAlpha;
        vDist = aDist;
        vPos = position;

        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPos;

        float sizeBoost = 1.0 + uBass * 1.5 + uEnergy * 0.8;
        float centerBoost = 1.0 + (1.0 - aDist) * 0.4;
        gl_PointSize = aSize * sizeBoost * centerBoost * uPixelRatio * (80.0 / -mvPos.z);
      }
    `,
    fragmentShader: `
      uniform vec3 uColorDark;
      uniform vec3 uColorMid;
      uniform vec3 uColorLight;
      uniform vec3 uColorBright;
      uniform float uBass;
      uniform float uEnergy;
      uniform float uTime;

      varying float vAlpha;
      varying float vDist;
      varying vec3 vPos;

      void main() {
        vec2 center = gl_PointCoord - 0.5;
        float dist = length(center);
        if (dist > 0.5) discard;

        float alpha = smoothstep(0.5, 0.1, dist);

        // Grey gradient: bright core → mid grey → dark edges
        vec3 col = mix(uColorBright, uColorLight, smoothstep(0.0, 0.3, vDist));
        col = mix(col, uColorMid, smoothstep(0.2, 0.6, vDist));
        col = mix(col, uColorDark, smoothstep(0.5, 1.0, vDist));

        // Subtle glow at core
        col += uColorBright * 0.15 * (1.0 - smoothstep(0.0, 0.2, vDist));

        // Bass energy brightens core
        col += uColorLight * uBass * 0.2 * (1.0 - vDist);

        float brightness = vAlpha * alpha * (0.45 + uEnergy * 0.6);

        gl_FragColor = vec4(col * brightness, brightness);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  return new THREE.Points(geometry, material);
}

// ─── Bloom Post-Processing (simple 2-pass) ───
function createBloom(renderer, scene, camera) {
  const size = renderer.getSize(new THREE.Vector2());

  const renderTarget = new THREE.WebGLRenderTarget(size.x, size.y, {
    format: THREE.RGBAFormat,
    type: THREE.HalfFloatType,
  });

  const blurTarget1 = new THREE.WebGLRenderTarget(size.x / 4, size.y / 4, {
    format: THREE.RGBAFormat,
  });
  const blurTarget2 = new THREE.WebGLRenderTarget(size.x / 4, size.y / 4, {
    format: THREE.RGBAFormat,
  });

  const blurMaterial = new THREE.ShaderMaterial({
    uniforms: {
      tDiffuse: { value: null },
      uDirection: { value: new THREE.Vector2(1, 0) },
      uResolution: { value: new THREE.Vector2(size.x / 4, size.y / 4) },
    },
    vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position,1.0); }`,
    fragmentShader: `
      uniform sampler2D tDiffuse;
      uniform vec2 uDirection;
      uniform vec2 uResolution;
      varying vec2 vUv;
      void main(){
        vec2 px = uDirection / uResolution;
        vec4 c = vec4(0.0);
        c += texture2D(tDiffuse, vUv - 4.0*px) * 0.051;
        c += texture2D(tDiffuse, vUv - 3.0*px) * 0.0918;
        c += texture2D(tDiffuse, vUv - 2.0*px) * 0.12245;
        c += texture2D(tDiffuse, vUv - 1.0*px) * 0.1531;
        c += texture2D(tDiffuse, vUv)           * 0.1633;
        c += texture2D(tDiffuse, vUv + 1.0*px) * 0.1531;
        c += texture2D(tDiffuse, vUv + 2.0*px) * 0.12245;
        c += texture2D(tDiffuse, vUv + 3.0*px) * 0.0918;
        c += texture2D(tDiffuse, vUv + 4.0*px) * 0.051;
        gl_FragColor = c;
      }
    `,
  });

  const compositeMaterial = new THREE.ShaderMaterial({
    uniforms: {
      tScene: { value: null },
      tBloom: { value: null },
      uBloomStrength: { value: 1.5 },
    },
    vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position,1.0); }`,
    fragmentShader: `
      uniform sampler2D tScene;
      uniform sampler2D tBloom;
      uniform float uBloomStrength;
      varying vec2 vUv;
      void main(){
        vec4 scene = texture2D(tScene, vUv);
        vec4 bloom = texture2D(tBloom, vUv);
        gl_FragColor = scene + bloom * uBloomStrength;
      }
    `,
  });

  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), blurMaterial);
  const quadScene = new THREE.Scene();
  const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  quadScene.add(quad);

  return {
    render(bloomStrength) {
      renderer.setRenderTarget(renderTarget);
      renderer.render(scene, camera);

      quad.material = blurMaterial;
      blurMaterial.uniforms.tDiffuse.value = renderTarget.texture;
      blurMaterial.uniforms.uDirection.value.set(1, 0);
      renderer.setRenderTarget(blurTarget1);
      renderer.render(quadScene, quadCamera);

      blurMaterial.uniforms.tDiffuse.value = blurTarget1.texture;
      blurMaterial.uniforms.uDirection.value.set(0, 1);
      renderer.setRenderTarget(blurTarget2);
      renderer.render(quadScene, quadCamera);

      quad.material = compositeMaterial;
      compositeMaterial.uniforms.tScene.value = renderTarget.texture;
      compositeMaterial.uniforms.tBloom.value = blurTarget2.texture;
      compositeMaterial.uniforms.uBloomStrength.value = bloomStrength;
      renderer.setRenderTarget(null);
      renderer.render(quadScene, quadCamera);
    },
    resize(w, h) {
      renderTarget.setSize(w, h);
      blurTarget1.setSize(w / 4, h / 4);
      blurTarget2.setSize(w / 4, h / 4);
      blurMaterial.uniforms.uResolution.value.set(w / 4, h / 4);
    },
  };
}

// ─── CPU-side wave update ───
function updateParticlesWave(particles, time, bands, timeData) {
  const pos = particles.geometry.attributes.position.array;
  const base = particles.geometry.attributes.aBase.array;

  const hasAudio = timeData && bands.energy > 0.01;
  const dataLen = timeData ? timeData.length : 0;

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const i3 = i * 3;
    const bx = base[i3];
    const offsetY = base[i3+1];
    const bz = base[i3+2];

    const xNorm = (bx + 8) / 16;

    let waveY;

    if (hasAudio) {
      const rawIdx = xNorm * (dataLen - 1);
      const idx = Math.floor(rawIdx);
      const frac = rawIdx - idx;
      const idx2 = Math.min(idx + 1, dataLen - 1);
      const s1 = (timeData[idx] - 128) / 128;
      const s2 = (timeData[idx2] - 128) / 128;
      const waveVal = s1 + (s2 - s1) * frac;

      const amp = 2.5 + bands.energy * 4.0 + bands.bass * 2.0;
      waveY = waveVal * amp;
    } else {
      // Idle: clear wave shape — 3-4 smooth oscillations
      waveY = Math.sin(bx * 0.7 + time * 0.4) * 1.5
            + Math.sin(bx * 1.3 - time * 0.25) * 0.7
            + Math.sin(bx * 0.35 + time * 0.15) * 0.5;
    }

    // Soft edge taper at ends
    const edgeDist = Math.abs(xNorm - 0.5) * 2;
    const edgeFade = 1.0 - edgeDist * edgeDist * edgeDist * edgeDist;
    waveY *= Math.max(0, edgeFade);

    // Tiny organic drift
    const driftY = Math.sin(time * 0.25 + bx * 0.3 + bz * 0.15) * 0.04;
    const driftX = Math.sin(time * 0.04 + bz * 0.2) * 0.02;
    const driftZ = Math.cos(time * 0.03 + bx * 0.15) * 0.02;

    pos[i3]     = bx + driftX;
    pos[i3 + 1] = waveY + offsetY + driftY;
    pos[i3 + 2] = bz + driftZ;
  }

  particles.geometry.attributes.position.needsUpdate = true;
}

// ─── React Component ───
export default function AudioDustWave() {
  const containerRef = useRef(null);
  const audioRef = useRef(null);
  const analyserRef = useRef(new AudioAnalyser());
  const [mode, setMode] = useState(null);
  const [fileName, setFileName] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);
  const fileInputRef = useRef(null);
  const sceneDataRef = useRef(null);
  const audioInitRef = useRef(false);

  const initScene = useCallback(() => {
    if (sceneDataRef.current || !containerRef.current) return;
    const el = containerRef.current;
    const w = el.clientWidth, h = el.clientHeight;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x101016, 1);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x101016, 0.025);

    const camera = new THREE.PerspectiveCamera(60, w / h, 0.1, 100);
    camera.position.set(0, 1.0, 9);
    camera.lookAt(0, 0, 0);

    const particles = createParticleSystem();
    scene.add(particles);

    const bloom = createBloom(renderer, scene, camera);

    sceneDataRef.current = { renderer, scene, camera, particles, bloom };

    const onResize = () => {
      const nw = el.clientWidth, nh = el.clientHeight;
      camera.aspect = nw / nh;
      camera.updateProjectionMatrix();
      renderer.setSize(nw, nh);
      bloom.resize(nw, nh);
    };
    window.addEventListener("resize", onResize);

    let animId;
    const clock = new THREE.Clock();

    const animate = () => {
      animId = requestAnimationFrame(animate);
      const t = clock.getElapsedTime();
      const aa = analyserRef.current;
      const bands = aa.update();

      particles.material.uniforms.uTime.value = t;
      particles.material.uniforms.uBass.value = bands.sub * 0.5 + bands.bass * 0.5;
      particles.material.uniforms.uMid.value = bands.mid;
      particles.material.uniforms.uHigh.value = bands.high * 0.5 + bands.treble * 0.5;
      particles.material.uniforms.uEnergy.value = bands.energy;

      updateParticlesWave(particles, t, bands, aa.timeData);

      // Subtle camera sway
      camera.position.x = Math.sin(t * 0.025) * 0.6;
      camera.position.y = 1.0 + Math.sin(t * 0.035) * 0.25;
      camera.position.z = 9;
      camera.lookAt(0, 0, 0);

      const bloomStr = 0.7 + bands.energy * 1.2 + bands.bass * 0.8;
      bloom.render(bloomStr);
    };
    animate();

    return () => {
      window.removeEventListener("resize", onResize);
      cancelAnimationFrame(animId);
      renderer.dispose();
    };
  }, []);

  useEffect(() => { initScene(); }, [initScene]);

  const startMic = async () => {
    try {
      await analyserRef.current.initMic();
      setMode("mic");
    } catch (e) {
      alert("Не удалось получить доступ к микрофону: " + e.message);
    }
  };

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const url = URL.createObjectURL(file);
    if (!audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.crossOrigin = "anonymous";
    }
    audioRef.current.src = url;
    if (!audioInitRef.current) {
      analyserRef.current.initElement(audioRef.current);
      audioInitRef.current = true;
    }
    audioRef.current.play();
    analyserRef.current.resume();
    setIsPlaying(true);
    setMode("file");
  };

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (audioRef.current.paused) {
      audioRef.current.play();
      analyserRef.current.resume();
      setIsPlaying(true);
    } else {
      audioRef.current.pause();
      setIsPlaying(false);
    }
  };

  return (
    <div style={{ width: "100vw", height: "100vh", background: "#101016", position: "relative", overflow: "hidden" }}>
      <div ref={containerRef} style={{ width: "100%", height: "100%", position: "absolute", top: 0, left: 0 }} />

      {/* Overlay UI */}
      <div style={{
        position: "absolute", bottom: 0, left: 0, right: 0,
        padding: "24px",
        background: "linear-gradient(transparent, rgba(16,16,22,0.9))",
        display: "flex", alignItems: "center", justifyContent: "center", gap: "16px",
        fontFamily: "'JetBrains Mono', 'SF Mono', monospace",
        zIndex: 10,
      }}>
        {!mode && (
          <>
            <button onClick={startMic} style={btnStyle}>
              🎤 Микрофон
            </button>
            <button onClick={() => fileInputRef.current?.click()} style={btnStyle}>
              🎵 Загрузить файл
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*"
              onChange={handleFile}
              style={{ display: "none" }}
            />
          </>
        )}
        {mode === "mic" && (
          <div style={{ color: "#999da5", fontSize: 13, letterSpacing: 1 }}>
            ● МИКРОФОН АКТИВЕН — говори, включи музыку рядом
          </div>
        )}
        {mode === "file" && (
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button onClick={togglePlay} style={btnStyle}>
              {isPlaying ? "⏸" : "▶"}
            </button>
            <span style={{ color: "#999da5", fontSize: 13, letterSpacing: 0.5, maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {fileName}
            </span>
            <button onClick={() => fileInputRef.current?.click()} style={{ ...btnStyle, fontSize: 11, padding: "6px 12px" }}>
              другой файл
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*"
              onChange={handleFile}
              style={{ display: "none" }}
            />
          </div>
        )}
      </div>

      {/* Title */}
      <div style={{
        position: "absolute", top: 24, left: 24,
        color: "rgba(150,150,165,0.2)", fontSize: 11,
        fontFamily: "'JetBrains Mono', monospace",
        letterSpacing: 2, textTransform: "uppercase",
      }}>
        sound wave
      </div>
    </div>
  );
}

const btnStyle = {
  background: "rgba(150, 150, 165, 0.1)",
  border: "1px solid rgba(150, 150, 165, 0.25)",
  color: "#777780",
  padding: "10px 20px",
  borderRadius: 8,
  cursor: "pointer",
  fontSize: 13,
  fontFamily: "'JetBrains Mono', monospace",
  letterSpacing: 0.5,
  transition: "all 0.2s",
  backdropFilter: "blur(8px)",
};
