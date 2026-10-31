/** Native, demand-rendered spool. Browser APIs are only accessed when called. */
export type SpoolRenderer = {
  /** Level is a fraction [0, 1]; null draws only the empty spool structure. */
  update: (level: number | null, color: string) => void;
  dispose: () => void;
  /** Rotation delta in radians (also suitable for keyboard controls). */
  rotate: (delta: number) => void;
};

type Options = {
  interactive: boolean;
  onFailure: () => void;
};
type V3 = [number, number, number];
type Deform = [number, number];
type Mesh = { buffer: WebGLBuffer; count: number };
const TAU = Math.PI * 2;
const INNER = 0.43;
const OUTER = 1.17;
const SEGMENTS = 64;

const vertexSource = `#version 300 es
precision highp float;
in vec3 aPosition; in vec3 aNormal; in vec3 aColor;
in vec2 aDeform;
uniform mat4 uMVP; uniform mat4 uModel;
uniform float uRadius; uniform bool uFilament;
uniform vec3 uColor;
out vec3 vColor; out vec3 vNormal; out vec3 vWorld;
void main(){
  vec3 p=aPosition;
  if(uFilament){
    float r=min(uRadius,aDeform.x*uRadius+aDeform.y);
    // Surface waves may extend slightly beyond the nominal radius.
    if(aDeform.x>0.5) r=aDeform.x*uRadius+aDeform.y;
    p.yz*=r;
  }
  vec4 wp=uModel*vec4(p,1.);
  vWorld=wp.xyz; vNormal=mat3(uModel)*aNormal;
  vColor=aColor*(uFilament?uColor:vec3(1.));
  gl_Position=uMVP*vec4(p,1.);
}`;
const fragmentSource = `#version 300 es
precision highp float;
in vec3 vColor,vNormal,vWorld;
out vec4 fragColor;
void main(){
  vec3 n=normalize(vNormal);vec3 light=normalize(vec3(-.35,.85,1.));
  float dif=max(dot(n,light),0.);float fill=.36+.68*dif;
  float rim=pow(1.-abs(dot(n,normalize(vec3(0.,0.,1.)))),2.)*.1;
  // Neutral surface highlight keeps pure black readable without tinting the structure.
  vec3 col=vColor*(fill+rim)+vec3(.035*pow(dif,12.));
  fragColor=vec4(pow(clamp(col,0.,1.),vec3(.90)),1.);
}`;

function geometry() {
  const data: number[] = [];
  function quad(points: V3[], normals: V3[], color: V3, deform?: Deform[]) {
    for (const i of [0, 1, 2, 0, 2, 3]) {
      data.push(...points[i], ...normals[i], ...color, ...(deform?.[i] ?? [0, 0]));
    }
  }
  function ring(x: number, inner: number, outer: number, color: V3, front: boolean,
    deformation?: [Deform, Deform]) {
    const normal: V3 = [front ? 1 : -1, 0, 0];
    for (let i = 0; i < SEGMENTS; i++) {
      const a = TAU * i / SEGMENTS, b = TAU * (i + 1) / SEGMENTS;
      const p = (r: number, t: number): V3 => [x, r * Math.cos(t), r * Math.sin(t)];
      quad([p(inner, a), p(outer, a), p(outer, b), p(inner, b)],
        [normal, normal, normal, normal], color,
        deformation && [deformation[0], deformation[1], deformation[1], deformation[0]]);
    }
  }
  function shell(r: number, x1: number, x2: number, color: V3, waves?: [number, number]) {
    for (let i = 0; i < SEGMENTS; i++) {
      const a = TAU * i / SEGMENTS, b = TAU * (i + 1) / SEGMENTS;
      const p = (x: number, t: number): V3 => [x, r * Math.cos(t), r * Math.sin(t)];
      const n = (t: number): V3 => [0, Math.cos(t), Math.sin(t)];
      quad([p(x1, a), p(x2, a), p(x2, b), p(x1, b)], [n(a), n(a), n(b), n(b)], color,
        waves && [[1, waves[0]], [1, waves[1]], [1, waves[1]], [1, waves[0]]]);
    }
  }
  function flange(x: number, front: boolean) {
    const black: V3 = [.11, .135, .175], rim: V3 = [.19, .225, .275];
    ring(x, 1.09, 1.34, black, front);
    ring(x + (front ? .012 : -.012), 1.285, 1.35, rim, front);
    ring(x, .13, .38, [.15, .18, .23], front);
    const normal: V3 = [front ? 1 : -1, 0, 0];
    for (let i = 0; i < 7; i++) {
      const a = i * TAU / 7;
      const p = (r: number, t: number): V3 => [x, r * Math.cos(t), r * Math.sin(t)];
      quad([p(.30, a - .115), p(1.17, a - .115), p(1.17, a + .115), p(.30, a + .115)],
        [normal, normal, normal, normal], black);
    }
    shell(1.34, x - .063, x + .063, rim);
    shell(1.285, x - .064, x + .064, [.29, .33, .37]);
  }
  flange(-.68, false);
  shell(.39, -.66, .66, [.145, .17, .21]);
  flange(.68, true);
  const structure = new Float32Array(data);
  data.length = 0;
  // Fixed topology: all level/color changes are uniforms, never buffer uploads.
  const steps = 72;
  for (let j = 0; j < steps; j++) {
    const x1 = -.575 + 1.15 * j / steps, x2 = -.575 + 1.15 * (j + 1) / steps;
    const shade = j % 3 === 0 ? .89 : 1;
    shell(1, x1, x2, [shade, shade, shade],
      [.006 * Math.cos(j * 95 / steps * 2.4), .006 * Math.cos((j + 1) * 95 / steps * 2.4)]);
  }
  ring(.577, 1, 1, [.89, .89, .89], true, [[0, INNER], [1, 0]]);
  ring(-.577, 1, 1, [.89, .89, .89], false, [[0, INNER], [1, 0]]);
  // Rings beyond the current radius collapse to zero area in the vertex shader.
  for (let r = INNER + .022; r < OUTER; r += .035) {
    ring(.58, 1, 1, [.76, .76, .76], true, [[0, r], [0, r + .008]]);
  }
  return [structure, new Float32Array(data)];
}

function multiply(a: number[], b: number[]) {
  const out = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  }
  return out;
}
function rotateY(a: number) {
  const c = Math.cos(a), s = Math.sin(a);
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
}
function rotateX(a: number) {
  const c = Math.cos(a), s = Math.sin(a);
  return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1];
}
function rotateZ(a: number) {
  const c = Math.cos(a), s = Math.sin(a);
  return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}
function rgb(color: string): V3 {
  let value = color.trim().replace(/^#/, "");
  if (/^[\da-f]{3}$/i.test(value)) value = value.split("").map(c => c + c).join("");
  const n = /^[\da-f]{6}$/i.test(value) ? parseInt(value, 16) : 0x2b00ff;
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
}

/** CSS must set touch-action: pan-y. No idle animation or external dependencies. */
export function createSpoolRenderer(canvas: HTMLCanvasElement, options: Options): SpoolRenderer | null {
  let gl: WebGL2RenderingContext | null = null;
  let program: WebGLProgram | null = null;
  const shaders: WebGLShader[] = [], buffers: WebGLBuffer[] = [];
  const cleanups: (() => void)[] = [];
  let disposed = false, failed = false, frame = 0;
  let observer: ResizeObserver | undefined;
  function dispose() {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(frame);
    observer?.disconnect();
    cleanups.forEach(cleanup => cleanup());
    if (gl) {
      buffers.forEach(buffer => gl!.deleteBuffer(buffer));
      if (program) gl.deleteProgram(program);
      shaders.forEach(shader => gl!.deleteShader(shader));
      // Explicitly release contexts when an interactive instance is unmounted.
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
  }
  function fail() {
    if (failed || disposed) return;
    failed = true;
    dispose();
    options.onFailure();
  }
  try {
    gl = canvas.getContext("webgl2", { antialias: true, alpha: true, premultipliedAlpha: true });
    if (!gl) { fail(); return null; }
    const context = gl;
    function listen<K extends keyof HTMLElementEventMap>(type: K, listener: (event: HTMLElementEventMap[K]) => void) {
      canvas.addEventListener(type, listener);
      cleanups.push(() => canvas.removeEventListener(type, listener));
    }
    const onContextLost = (event: Event) => { event.preventDefault(); fail(); };
    canvas.addEventListener("webglcontextlost", onContextLost);
    cleanups.push(() => canvas.removeEventListener("webglcontextlost", onContextLost));
    function compile(type: number, source: string) {
      const shader = context.createShader(type);
      if (!shader) throw new Error("Cannot allocate spool shader");
      shaders.push(shader);
      context.shaderSource(shader, source);
      context.compileShader(shader);
      if (!context.getShaderParameter(shader, context.COMPILE_STATUS)) throw new Error("Cannot compile spool shader");
      return shader;
    }
    program = context.createProgram();
    if (!program) throw new Error("Cannot allocate spool program");
    context.attachShader(program, compile(context.VERTEX_SHADER, vertexSource));
    context.attachShader(program, compile(context.FRAGMENT_SHADER, fragmentSource));
    context.linkProgram(program);
    if (!context.getProgramParameter(program, context.LINK_STATUS)) throw new Error("Cannot link spool program");
    const loc = {
      pos: context.getAttribLocation(program, "aPosition"), normal: context.getAttribLocation(program, "aNormal"),
      color: context.getAttribLocation(program, "aColor"), deform: context.getAttribLocation(program, "aDeform"),
      model: context.getUniformLocation(program, "uModel"), mvp: context.getUniformLocation(program, "uMVP"),
      radius: context.getUniformLocation(program, "uRadius"), filament: context.getUniformLocation(program, "uFilament"),
      material: context.getUniformLocation(program, "uColor"),
    };
    const meshes: Mesh[] = geometry().map(data => {
      const buffer = context.createBuffer();
      if (!buffer) throw new Error("Cannot allocate spool buffer");
      buffers.push(buffer);
      context.bindBuffer(context.ARRAY_BUFFER, buffer);
      context.bufferData(context.ARRAY_BUFFER, data, context.STATIC_DRAW);
      return { buffer, count: data.length / 11 };
    });
    context.enable(context.DEPTH_TEST);
    context.depthFunc(context.LEQUAL);
    context.disable(context.CULL_FACE);
    context.clearColor(0, 0, 0, 0);
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reduced = motion.matches;
    let current = 0, target = 0, from = 0, started = 0, animating = false, initialized = false;
    let material: V3 = rgb("#2B00FF"), rotation = -.94, tilt = .16;
    let pointer: { id: number; x: number; y: number; lastX: number; lastY: number; active: boolean; touch: boolean } | null = null;
    function draw() {
      if (disposed) return;
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const width = Math.max(1, Math.round(rect.width * dpr));
      const height = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      context.viewport(0, 0, width, height);
      context.clear(context.COLOR_BUFFER_BIT | context.DEPTH_BUFFER_BIT);
      const model = multiply(rotateY(rotation), multiply(rotateX(tilt), rotateZ(-.085)));
      const view = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -5.8, 1];
      const q = 1 / Math.tan(Math.PI / 8), near = .1, far = 30;
      const projection = [q / (width / height), 0, 0, 0, 0, q, 0, 0, 0, 0,
        (far + near) / (near - far), -1, 0, 0, 2 * far * near / (near - far), 0];
      context.useProgram(program);
      context.uniformMatrix4fv(loc.model, false, new Float32Array(model));
      context.uniformMatrix4fv(loc.mvp, false, new Float32Array(multiply(projection, multiply(view, model))));
      context.uniform1f(loc.radius, Math.sqrt(INNER * INNER + current * (OUTER * OUTER - INNER * INNER)));
      context.uniform3fv(loc.material, material);
      meshes.forEach((mesh, index) => {
        if (index === 1 && current <= 0) return;
        context.uniform1i(loc.filament, index);
        context.bindBuffer(context.ARRAY_BUFFER, mesh.buffer);
        for (const [attribute, size, offset] of [[loc.pos, 3, 0], [loc.normal, 3, 3], [loc.color, 3, 6], [loc.deform, 2, 9]]) {
          context.enableVertexAttribArray(attribute);
          context.vertexAttribPointer(attribute, size, context.FLOAT, false, 44, offset * 4);
        }
        context.drawArrays(context.TRIANGLES, 0, mesh.count);
      });
    }
    function tick(now: number) {
      frame = 0;
      if (disposed) return;
      if (animating) {
        const progress = Math.min(1, (now - started) / 500);
        current = from + (target - from) * (1 - Math.pow(1 - progress, 3));
        if (progress === 1) { animating = false; current = target; }
      }
      try { draw(); } catch { fail(); return; }
      if (animating) requestDraw();
    }
    function requestDraw() {
      if (disposed) return;
      if (!frame) frame = requestAnimationFrame(tick);
    }
    const onMotion = (event: MediaQueryListEvent) => {
      reduced = event.matches;
      if (reduced) { current = target; animating = false; }
      requestDraw();
    };
    motion.addEventListener("change", onMotion);
    cleanups.push(() => motion.removeEventListener("change", onMotion));
    observer = new ResizeObserver(requestDraw);
    observer.observe(canvas);
    window.addEventListener("resize", requestDraw);
    cleanups.push(() => window.removeEventListener("resize", requestDraw));
    function releasePointer() {
      const id = pointer?.id;
      pointer = null;
      if (id !== undefined && canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
    }
    cleanups.push(releasePointer);
    if (options.interactive) {
      listen("pointerdown", event => {
        if (!event.isPrimary || event.button !== 0 || pointer) return;
        const touch = event.pointerType !== "mouse";
        pointer = { id: event.pointerId, x: event.clientX, y: event.clientY,
          lastX: event.clientX, lastY: event.clientY, active: !touch, touch };
        if (!touch) canvas.setPointerCapture(event.pointerId);
      });
      listen("pointermove", event => {
        if (!pointer || pointer.id !== event.pointerId) return;
        if (!pointer.active) {
          const dx = event.clientX - pointer.x, dy = event.clientY - pointer.y;
          if (Math.max(Math.abs(dx), Math.abs(dy)) < 8) return;
          if (Math.abs(dy) >= Math.abs(dx)) { releasePointer(); return; }
          pointer.active = true;
          canvas.setPointerCapture(event.pointerId);
        }
        rotation += (event.clientX - pointer.lastX) * .009;
        if (!pointer.touch) tilt = Math.max(-.8, Math.min(.8, tilt + (event.clientY - pointer.lastY) * .009));
        pointer.lastX = event.clientX; pointer.lastY = event.clientY;
        requestDraw();
      });
      const end = (event: PointerEvent) => { if (event.pointerId === pointer?.id) releasePointer(); };
      listen("pointerup", end);
      listen("pointercancel", end);
      listen("lostpointercapture", end);
    }
    return {
      update(level, color) {
        if (disposed) return;
        const next = level === null || !Number.isFinite(level) ? 0 : Math.max(0, Math.min(1, level));
        material = rgb(color);
        if (next !== target || !initialized) {
          from = current; target = next; started = performance.now();
          animating = initialized && !reduced && level !== null;
          if (!animating) current = target;
        }
        // Indeterminate must hide filament immediately, even mid-emptying tween.
        if (level === null) { current = 0; animating = false; }
        initialized = true;
        try { requestDraw(); } catch { fail(); }
      },
      rotate(delta) {
        if (disposed || !Number.isFinite(delta)) return;
        rotation += delta;
        try { requestDraw(); } catch { fail(); }
      },
      dispose,
    };
  } catch {
    fail();
    return null;
  }
}
