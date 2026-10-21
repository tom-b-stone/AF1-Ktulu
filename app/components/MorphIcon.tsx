"use client";

// 3D morphing icon: a sphere displaced by animated noise, shaded with an
// iridescent thin-film look (the "Rainbow Blend Glass" / "Simple
// Iridescent" materials in the reference .blend). One shape per tool,
// told apart by seed (noise phase), frequency (how lumpy) and a hue
// offset into the AF1 palette (lava → pink → lilac → blue → teal).
// Lightweight: one small WebGL canvas per icon, paused when off-screen.
import { useEffect, useRef } from "react";
import * as THREE from "three";

export type Shape = "sphere" | "torus" | "box" | "knot" | "capsule" | "octa";

export type MorphProps = {
  size?: number;
  shape?: Shape;
  seed?: number;
  freq?: number;
  amp?: number;
  hue?: number; // 0..1 offset in the palette
  speed?: number;
  className?: string;
  style?: React.CSSProperties;
  paused?: boolean;
  // optional cursor influence (-1..1 each), read every frame, set by the tile
  pointer?: React.MutableRefObject<{ x: number; y: number }>;
};

const VERT = /* glsl */ `
uniform float uTime;
uniform float uSeed;
uniform float uFreq;
uniform float uAmp;
varying vec3 vNormalW;
varying vec3 vViewDir;
varying float vNoise;

// Simplex noise (Ashima / Ian McEwan), MIT
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857; vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z); vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}

float field(vec3 p){
  // two octaves, slow drift; the seed moves the whole field so icons differ
  vec3 q = p * uFreq + vec3(uSeed);
  float n = snoise(q + uTime * 0.3);
  n += 0.25 * snoise(q * 1.9 - uTime * 0.18);
  return n;
}

// Displace along the surface normal so any base shape (torus, box, knot)
// keeps its silhouette and only breathes.
vec3 displace(vec3 p, vec3 n){
  return p + n * uAmp * field(p);
}

void main(){
  vec3 n0 = normalize(normal);
  vec3 p = displace(position, n0);
  // normal by neighbours along the tangent frame
  vec3 t = normalize(cross(n0, abs(n0.y) < 0.99 ? vec3(0.0,1.0,0.0) : vec3(1.0,0.0,0.0)));
  vec3 b = cross(n0, t);
  float e = 0.03;
  vec3 pt = displace(position + t * e, n0);
  vec3 pb = displace(position + b * e, n0);
  vec3 nrm = normalize(cross(pt - p, pb - p));
  vNoise = field(position);
  vNormalW = normalize(normalMatrix * nrm);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vViewDir = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
precision highp float;
uniform float uHue;
uniform float uTime;
varying vec3 vNormalW;
varying vec3 vViewDir;
varying float vNoise;

// AF1 palette as a loop: lava → pink → lilac → blue → teal → lava
vec3 palette(float t){
  t = fract(t);
  vec3 c0 = vec3(1.00, 0.18, 0.00); // lava
  vec3 c1 = vec3(1.00, 0.25, 0.64); // pink
  vec3 c2 = vec3(0.63, 0.56, 0.84); // lilac
  vec3 c3 = vec3(0.11, 0.41, 0.98); // blue
  vec3 c4 = vec3(0.24, 0.95, 0.95); // teal
  float s = t * 5.0;
  if (s < 1.0) return mix(c0, c1, s);
  if (s < 2.0) return mix(c1, c2, s - 1.0);
  if (s < 3.0) return mix(c2, c3, s - 2.0);
  if (s < 4.0) return mix(c3, c4, s - 3.0);
  return mix(c4, c0, s - 4.0);
}

void main(){
  vec3 n = normalize(vNormalW);
  vec3 v = normalize(vViewDir);
  float ndv = clamp(dot(n, v), 0.0, 1.0);
  float fres = pow(1.0 - ndv, 2.2);
  // thin-film: hue shifts with view angle and surface noise
  float t = uHue + fres * 0.55 + vNoise * 0.12 + uTime * 0.02;
  vec3 base = palette(t);
  vec3 deep = palette(t + 0.45) * 0.35;
  vec3 col = mix(deep, base, 0.35 + 0.65 * fres);
  // key light + rim
  vec3 l = normalize(vec3(0.6, 0.8, 0.9));
  float diff = max(dot(n, l), 0.0);
  vec3 h = normalize(l + v);
  float spec = pow(max(dot(n, h), 0.0), 48.0);
  // specular tinted (never pure white), rim in the palette colour, and the
  // outermost silhouette fades toward black so the shape sits on a dark page
  vec3 specCol = mix(vec3(1.0), base, 0.35);
  float edge = smoothstep(0.0, 0.18, ndv);
  col = col * (0.7 + 0.6 * diff) + specCol * spec * 0.8 + base * fres * 0.5;
  col = pow(col, vec3(0.9));
  col = mix(base * 0.25, col, edge);
  col = min(col, vec3(1.0));
  gl_FragColor = vec4(col, 1.0);
}
`;

function makeGeometry(shape: Shape, hi: boolean): THREE.BufferGeometry {
  const d = hi ? 2 : 1;
  switch (shape) {
    case "torus":
      return new THREE.TorusGeometry(0.78, 0.36, 48 * d, 96 * d);
    case "box":
      return new THREE.BoxGeometry(1.5, 1.5, 1.5, 24 * d, 24 * d, 24 * d);
    case "knot":
      return new THREE.TorusKnotGeometry(0.62, 0.26, 160 * d, 24 * d, 2, 3);
    case "capsule":
      return new THREE.CapsuleGeometry(0.55, 1.1, 16 * d, 32 * d);
    case "octa":
      return new THREE.OctahedronGeometry(1.15, 5 + d);
    default:
      return new THREE.IcosahedronGeometry(1, hi ? 48 : 24);
  }
}

export default function MorphIcon({ size = 48, shape = "sphere", seed = 0, freq = 1.6, amp = 0.22, hue = 0, speed = 1, className, style, paused, pointer }: MorphProps) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const prefersReduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "low-power" });
    } catch {
      return;
    }
    // supersample: render at up to 3x and let CSS scale down, so the
    // silhouette is smooth even where MSAA on an alpha canvas isn't
    const dpr = Math.min(3, (window.devicePixelRatio || 1) * 1.5);
    renderer.setPixelRatio(dpr);
    renderer.setSize(size, size, false);
    renderer.setClearColor(0x000000, 0);
    renderer.setClearAlpha(0);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 10);
    camera.position.set(0, 0, 5.4); // room for the knot/torus to turn without clipping

    const geo = makeGeometry(shape, size > 64);
    // the box ships flat normals per face; smooth them so the displacement
    // reads as one surface instead of six plates
    if (shape === "box") geo.deleteAttribute("normal");
    if (shape === "box") geo.computeVertexNormals();
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uTime: { value: 0 },
        uSeed: { value: seed },
        uFreq: { value: freq },
        uAmp: { value: amp },
        uHue: { value: hue },
      },
    });
    const mesh = new THREE.Mesh(geo, mat);
    scene.add(mesh);

    let raf = 0;
    let visible = true;
    const io = new IntersectionObserver((entries) => {
      visible = entries[0]?.isIntersecting ?? true;
    });
    io.observe(canvas);

    const start = performance.now() + seed * 1000;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (!visible || paused) return;
      const t = ((performance.now() - start) / 1000) * speed;
      mat.uniforms.uTime.value = prefersReduced ? 0 : t;
      const px = pointer?.current.x ?? 0;
      const py = pointer?.current.y ?? 0;
      mesh.rotation.y = (prefersReduced ? 0.6 : t * 0.5) + px * 0.9;
      mesh.rotation.x = (prefersReduced ? 0.3 : Math.sin(t * 0.3) * 0.35) + py * 0.7;
      const sc = 1 + (Math.abs(px) + Math.abs(py)) * 0.12;
      mesh.scale.setScalar(sc);
      renderer.render(scene, camera);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      geo.dispose();
      mat.dispose();
      renderer.dispose();
      // dispose() keeps the GL context alive; browsers allow ~16 of them, so
      // every home visit would leak four until the icons stop rendering.
      renderer.forceContextLoss();
    };
  }, [size, shape, seed, freq, amp, hue, speed, paused, pointer]);

  return <canvas ref={ref} width={size} height={size} className={className} style={{ width: size, height: size, display: "block", ...style }} aria-hidden />;
}

// One shape per tool. Same component, different field.
// One shape per tool: SEO = torus (a ring of text), Assets = box (a crate of
// files), CRM Images = octahedron (a gem / picture), UTM = capsule (a pill,
// the link), Connector = torus knot (the loop between Claude and the tools).
export const MORPH_PRESETS: Record<string, Omit<MorphProps, "size">> = {
  "/seo": { shape: "torus", seed: 1.3, freq: 1.2, amp: 0.12, hue: 0.02 },
  "/assets": { shape: "box", seed: 4.1, freq: 1.0, amp: 0.14, hue: 0.22 },
  "/photobook": { shape: "sphere", seed: 5.3, freq: 2.1, amp: 0.2, hue: 0.9 },
  "/teamcards": { shape: "box", seed: 3.4, freq: 1.7, amp: 0.18, hue: 0.55 },
  "/images": { shape: "octa", seed: 7.7, freq: 0.9, amp: 0.16, hue: 0.42 },
  "/coverage": { shape: "sphere", seed: 6.4, freq: 1.3, amp: 0.15, hue: 0.12 },
  "/utm": { shape: "capsule", seed: 2.6, freq: 1.4, amp: 0.1, hue: 0.62 },
  "/connector": { shape: "knot", seed: 9.2, freq: 1.6, amp: 0.08, hue: 0.8 },
};
