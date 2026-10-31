/* eslint-disable @typescript-eslint/no-require-imports -- Execute the real TS renderer in an isolated browser VM. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../components/spools/spool-webgl.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function events() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
    emit(type, event = {}) { for (const listener of [...(listeners.get(type) || [])]) listener(event); },
    listenerCount() { return [...listeners.values()].reduce((sum, set) => sum + set.size, 0); },
  };
}

function mockGL() {
  const calls = [], uniforms = {}, draws = [], uploads = [];
  let serial = 0, bound;
  const gl = { calls, uniforms, draws, uploads };
  for (const [i, key] of ['VERTEX_SHADER', 'FRAGMENT_SHADER', 'COMPILE_STATUS', 'LINK_STATUS', 'ARRAY_BUFFER', 'STATIC_DRAW', 'DEPTH_TEST', 'LEQUAL', 'CULL_FACE', 'COLOR_BUFFER_BIT', 'DEPTH_BUFFER_BIT', 'FLOAT', 'TRIANGLES'].entries()) gl[key] = 2 ** i;
  const record = (name, fn = () => undefined) => {
    gl[name] = (...args) => { calls.push({ name, args }); return fn(...args); };
  };
  for (const name of ['createShader', 'createProgram', 'createBuffer']) record(name, () => ({ id: ++serial }));
  for (const name of ['getShaderParameter', 'getProgramParameter']) record(name, () => true);
  record('getAttribLocation', (_, name) => ['aPosition', 'aNormal', 'aColor', 'aDeform'].indexOf(name));
  record('getUniformLocation', (_, name) => name);
  record('bindBuffer', (_, buffer) => { bound = buffer; });
  record('bufferData', (target, data, usage) => { uploads.push({ target, usage, buffer: bound, data: Array.from(data) }); });
  for (const name of ['uniform1f', 'uniform1i']) record(name, (key, value) => { uniforms[key] = value; });
  record('uniform3fv', (key, value) => { uniforms[key] = Array.from(value); });
  record('uniformMatrix4fv', (key, transpose, value) => { uniforms[key] = Array.from(value); });
  record('drawArrays', (mode, first, count) => {
    draws.push({ mode, first, count, buffer: bound, filament: uniforms.uFilament, radius: uniforms.uRadius, color: [...uniforms.uColor] });
  });
  for (const name of ['shaderSource', 'compileShader', 'attachShader', 'linkProgram', 'enable', 'depthFunc', 'disable', 'clearColor', 'viewport', 'clear', 'useProgram', 'enableVertexAttribArray', 'vertexAttribPointer', 'deleteBuffer', 'deleteProgram', 'deleteShader']) record(name);
  record('loseContext');
  record('getExtension', name => name === 'WEBGL_lose_context' ? { loseContext: gl.loseContext } : null);
  return gl;
}

function harness({ reduced = false, noGL = false } = {}) {
  const contexts = [], canvases = [], frames = new Map(), observers = [];
  let now = 0, frameId = 0, requested = 0, failures = 0;
  const motion = Object.assign(events(), { matches: reduced });
  const window = Object.assign(events(), { devicePixelRatio: 2, matchMedia: () => motion });
  function canvas(kind = 'webgl') {
    const gl = kind === 'webgl' && !noGL ? mockGL() : null;
    const copies = [], clears = [], captures = new Set(), requests = [];
    const result = Object.assign(events(), {
      width: 300, height: 150, gl, copies, clears, requests,
      getBoundingClientRect: () => ({ width: 120, height: 80 }),
      getContext(type, options) {
        requests.push({ type, options });
        if (type === '2d') return kind === '2d' ? {
          clearRect: (...args) => clears.push(args), drawImage: (...args) => copies.push(args),
        } : null;
        if (type === 'webgl2' && gl) { contexts.push(gl); return gl; }
        return null;
      },
      hasPointerCapture: id => captures.has(id),
      setPointerCapture: id => captures.add(id),
      releasePointerCapture: id => captures.delete(id),
    });
    canvases.push(result);
    return result;
  }
  const loadedModule = { exports: {} };
  vm.runInNewContext(compiled, {
    module: loadedModule, exports: loadedModule.exports, window,
    document: { createElement: tag => { assert.equal(tag, 'canvas'); return canvas(); } },
    performance: { now: () => now },
    requestAnimationFrame(callback) { requested++; frames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame(id) { frames.delete(id); },
    ResizeObserver: class {
      constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this); }
      observe(target) { this.target = target; }
      disconnect() { this.disconnected = true; }
    },
  }, { filename: 'spool-webgl.js' });
  return {
    ...loadedModule.exports, canvas, contexts, canvases, frames, observers, window, motion,
    get requested() { return requested; }, get failures() { return failures; },
    renderer(target, options = {}) {
      return loadedModule.exports.createSpoolRenderer(target, { interactive: true, onFailure: () => failures++, ...options });
    },
    step(ms = 100) {
      now += ms;
      const pending = [...frames.values()]; frames.clear();
      for (const callback of pending) callback(now);
    },
    settle() {
      let ticks = 0;
      while (frames.size && ticks++ < 20) this.step();
      assert.equal(frames.size, 0, 'animation must stop scheduling frames');
      return ticks;
    },
  };
}
const calls = (gl, name) => gl.calls.filter(call => call.name === name);
const radius = level => Math.sqrt(.43 ** 2 + level * (1.17 ** 2 - .43 ** 2));
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);

test('fixed GPU buffers survive level/color changes; separate structure and filament draw uniforms', () => {
  const h = harness({ reduced: true }), canvas = h.canvas(), gl = canvas.gl;
  const renderer = h.renderer(canvas);
  assert.ok(renderer);
  assert.equal(gl.uploads.length, 2);
  const original = gl.uploads.map(upload => ({ buffer: upload.buffer, data: [...upload.data] }));
  assert.ok(original.every(upload => upload.data.length > 0 && upload.data.length % 11 === 0 && upload.data.every(Number.isFinite)));
  for (const [level, color, expected] of [[1, '#ff0000', [1, 0, 0]], [.5, '#0f0', [0, 1, 0]], [.25, '#0000ff', [0, 0, 1]]]) {
    const start = gl.draws.length;
    renderer.update(level, color); h.settle();
    const draws = gl.draws.slice(start);
    assert.equal(draws.length, 2);
    assert.deepEqual(draws.map(draw => draw.filament), [0, 1]);
    draws.forEach((draw, i) => {
      assert.equal(draw.buffer, original[i].buffer);
      assert.equal(draw.count, original[i].data.length / 11);
      assert.equal(draw.first, 0);
      assert.equal(draw.mode, gl.TRIANGLES);
      close(draw.radius, radius(level));
      assert.deepEqual(draw.color, expected);
    });
  }
  assert.equal(calls(gl, 'createBuffer').length, 2);
  assert.equal(gl.uploads.length, 2);
  gl.uploads.forEach((upload, i) => assert.deepEqual(upload.data, original[i].data));
  assert.equal(h.frames.size, 0, 'detail rendering has no idle animation');
  renderer.dispose();
});

test('zero/null/nonfinite levels draw only structure, clamp valid levels, and use area-based radii', () => {
  const h = harness({ reduced: true }), canvas = h.canvas(), gl = canvas.gl;
  const renderer = h.renderer(canvas);
  for (const [level, expected] of [[0, 0], [null, 0], [NaN, 0], [Infinity, 0], [-1, 0], [.25, .25], [.5, .5], [1, 1], [2, 1]]) {
    const start = gl.draws.length;
    renderer.update(level, '#abc'); h.settle();
    const draws = gl.draws.slice(start);
    assert.equal(draws.length, expected === 0 ? 1 : 2);
    assert.equal(draws[0].filament, 0);
    close(draws[0].radius, radius(expected));
    assert.ok(draws.every(draw => draw.count > 0), 'empty filament is skipped, not drawn with zero vertices');
  }
  renderer.dispose();
});

test('demand frames coalesce, finish the tween, and never run an idle loop; null cancels an active tween', () => {
  const h = harness(), canvas = h.canvas(), renderer = h.renderer(canvas), gl = canvas.gl;
  assert.equal(h.frames.size, 0);
  renderer.update(1, '#fff'); renderer.rotate(.1); renderer.rotate(.2);
  assert.equal(h.frames.size, 1);
  h.settle();
  renderer.update(.25, '#fff');
  h.step(100);
  assert.ok(gl.uniforms.uRadius > radius(.25) && gl.uniforms.uRadius < radius(1));
  assert.ok(h.settle() <= 5);
  close(gl.uniforms.uRadius, radius(.25));
  const requested = h.requested;
  h.step(10000);
  assert.equal(h.requested, requested);
  renderer.update(1, '#fff'); h.step(100);
  renderer.update(null, '#fff');
  const start = gl.draws.length;
  h.step();
  assert.equal(h.frames.size, 0);
  assert.deepEqual(gl.draws.slice(start).map(draw => draw.filament), [0]);
  close(gl.uniforms.uRadius, radius(0));
  renderer.dispose();
});

test('reduced motion applies immediately and switching preference ends an in-flight animation', () => {
  const h = harness({ reduced: true }), canvas = h.canvas(), renderer = h.renderer(canvas);
  renderer.update(1, '#fff'); h.settle();
  renderer.update(.25, '#fff');
  assert.equal(h.settle(), 1);
  close(canvas.gl.uniforms.uRadius, radius(.25));
  h.motion.emit('change', { matches: false }); h.settle();
  renderer.update(1, '#fff'); h.step(100);
  assert.equal(h.frames.size, 1);
  h.motion.emit('change', { matches: true });
  assert.equal(h.settle(), 1);
  close(canvas.gl.uniforms.uRadius, radius(1));
  renderer.dispose();
});

test('context loss fails once, cancels frames, releases GPU resources/listeners and makes disposal idempotent', () => {
  const h = harness(), canvas = h.canvas(), gl = canvas.gl, renderer = h.renderer(canvas);
  renderer.update(1, '#fff');
  canvas.emit('pointerdown', { isPrimary: true, button: 0, pointerType: 'mouse', pointerId: 7, clientX: 0, clientY: 0 });
  assert.equal(canvas.hasPointerCapture(7), true);
  let prevented = 0;
  canvas.emit('webglcontextlost', { preventDefault() { prevented++; } });
  assert.equal(prevented, 1);
  assert.equal(h.failures, 1);
  assert.equal(h.frames.size, 0);
  assert.equal(canvas.listenerCount(), 0);
  assert.equal(canvas.hasPointerCapture(7), false);
  assert.equal(h.window.listenerCount(), 0);
  assert.equal(h.motion.listenerCount(), 0);
  assert.equal(h.observers[0].disconnected, true);
  assert.equal(calls(gl, 'deleteBuffer').length, 2);
  assert.equal(calls(gl, 'deleteShader').length, 2);
  assert.equal(calls(gl, 'deleteProgram').length, 1);
  assert.equal(calls(gl, 'loseContext').length, 1);
  const count = gl.calls.length;
  renderer.dispose(); renderer.update(.5, '#f00'); renderer.rotate(1); h.step();
  assert.equal(gl.calls.length, count);
  assert.equal(h.failures, 1);
});

test('missing WebGL returns null, reports failure and creates no animation or observers', () => {
  const h = harness({ noGL: true }), canvas = h.canvas();
  assert.equal(h.renderer(canvas), null);
  assert.equal(h.failures, 1);
  assert.equal(h.contexts.length, 0);
  assert.equal(h.requested, 0);
  assert.equal(h.observers.length, 0);
  assert.equal(canvas.listenerCount(), 0);
});

test('initialization failure releases previously allocated buffers, shaders and program', () => {
  const h = harness(), canvas = h.canvas(), gl = canvas.gl;
  const allocate = gl.createBuffer;
  let allocations = 0;
  gl.createBuffer = (...args) => ++allocations === 2 ? null : allocate(...args);
  assert.equal(h.renderer(canvas), null);
  assert.equal(h.failures, 1);
  assert.equal(calls(gl, 'deleteBuffer').length, 1);
  assert.equal(calls(gl, 'deleteShader').length, 2);
  assert.equal(calls(gl, 'deleteProgram').length, 1);
  assert.equal(calls(gl, 'loseContext').length, 1);
  assert.equal(canvas.listenerCount(), 0);
  assert.equal(h.frames.size, 0);
  assert.equal(h.observers.length, 0);
});
