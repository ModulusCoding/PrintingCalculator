/* eslint-disable @typescript-eslint/no-require-imports -- Isolated local TS/JSX harness; no browser or WebGL dependencies. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function loadTS(path, dependencies = {}, globals = {}) {
  const loaded = { exports: {} };
  const source = fs.readFileSync(path, 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  vm.runInNewContext(output, {
    module: loaded, exports: loaded.exports,
    require: name => {
      if (Object.hasOwn(dependencies, name)) return dependencies[name];
      throw new Error(`Unexpected dependency ${name} in ${path}`);
    }, ...globals,
  }, { filename: path });
  return loaded.exports;
}
const { spoolVisual } = loadTS('lib/spools/visual.ts');
// Use the real pure resolver when available; the renderer is always a boundary mock.
const color = fs.existsSync('lib/spools/color.ts') ? loadTS('lib/spools/color.ts') : {
  resolveSpoolHex: value => /^#[\da-f]{6}$/i.test(value || '') ? value.toUpperCase() : null,
};
const css = fs.readFileSync('components/spools/Spool3D.module.css', 'utf8');
const jsx = (type, props) => ({ type, props });
function all(node, predicate) {
  if (!node || typeof node !== 'object') return [];
  return [...(predicate(node) ? [node] : []), ...[node.props?.children].flat(Infinity).flatMap(child => all(child, predicate))];
}
const text = tree => JSON.stringify(tree, (key, value) => key === 'ref' ? undefined : value);
const defaults = { remainingGrams: 500, referenceGrams: 1000, lowThresholdPercent: 20, colorHex: '#123ABC', label: 'PLA 01' };

function harness({ noGL = false, shared = {} } = {}) {
  const slots = [];
  const pending = [];
  const frames = new Map();
  const calls = { create: [], update: [], dispose: [], rotate: [], cancel: [], observers: [] };
  let cursor = 0;
  let nextFrame = 0;
  let tree;
  let props;
  let dirty = false;
  const fakeCanvas = { kind: 'fake-canvas' };
  const renderer = {
    update: (...args) => calls.update.push(args),
    dispose: () => { calls.dispose.push(true); shared.live?.delete(renderer); },
    rotate: angle => calls.rotate.push(angle),
  };
  const hooks = {
    useRef(initial) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { current: initial };
      return slots[index];
    },
    useState(initial) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { value: initial };
      return [slots[index].value, value => {
        slots[index].value = typeof value === 'function' ? value(slots[index].value) : value;
        dirty = true;
      }];
    },
    useEffect(effect, deps) {
      const index = cursor++;
      const previous = slots[index];
      if (!previous || deps.some((dep, i) => !Object.is(dep, previous.deps[i]))) {
        slots[index] = { deps, cleanup: previous?.cleanup };
        pending.push(() => {
          slots[index].cleanup?.();
          slots[index].cleanup = effect();
        });
      }
    },
  };
  class Observer {
    constructor(callback) { this.callback = callback; this.disconnected = false; calls.observers.push(this); }
    observe(target) { this.target = target; }
    disconnect() { this.disconnected = true; }
  }
  shared.hooks = hooks;
  shared.live ??= new Set();
  const create = (...args) => {
    assert.equal(shared.live.size, 0, 'previous renderer must be released before a context is allocated');
    calls.create.push(args);
    if (noGL) return null;
    shared.live.add(renderer);
    return renderer;
  };
  shared.create = create;
  const { Spool3D } = shared.module ??= loadTS('components/spools/Spool3D.tsx', {
    react: new Proxy({}, { get: (_, name) => (...args) => shared.hooks[name](...args) }),
    'react/jsx-runtime': { jsx, jsxs: jsx },
    '@/lib/spools/visual': { spoolVisual },
    '@/lib/spools/color': color,
    './Spool3D.module.css': { default: new Proxy({}, { get: (_, key) => key }) },
    './spool-webgl': {
      createSpoolRenderer: (...args) => shared.create(...args),
    },
  }, {
    window: { matchMedia: () => ({ matches: false }) },
    performance: { now: () => 0 },
    requestAnimationFrame: callback => { frames.set(++nextFrame, callback); return nextFrame; },
    cancelAnimationFrame: id => { frames.delete(id); calls.cancel.push(id); },
    IntersectionObserver: Observer,
  });
  function render(overrides = {}) {
    shared.hooks = hooks;
    shared.create = create;
    props = { ...defaults, ...props, ...overrides };
    cursor = 0;
    dirty = false;
    tree = Spool3D(props);
    for (const node of all(tree, node => node.type === 'canvas')) node.props.ref.current = fakeCanvas;
    return tree;
  }
  function flush() {
    while (pending.length) pending.shift()();
    if (dirty) { render(); while (pending.length) pending.shift()(); }
    return tree;
  }
  return {
    calls, fakeCanvas, render, flush,
    frame(now = 650) {
      const queued = [...frames.values()]; frames.clear();
      queued.forEach(callback => callback(now));
      return flush();
    },
    unmount() { for (const slot of slots) slot?.cleanup?.(); },
  };
}

for (const percentage of [100, 75, 50, 25, 0]) {
  test(`pure visual and renderer represent ${percentage}% of the actual reference`, () => {
    const remainingGrams = percentage * 20;
    const visual = spoolVisual(remainingGrams, 2000, 20);
    assert.equal(visual.percentage, percentage);
    assert.equal(visual.level, percentage / 100);
    assert.equal(visual.empty, percentage === 0);
    const h = harness();
    h.render({ remainingGrams, referenceGrams: 2000, interactive: true });
    const tree = h.flush();
    assert.match(text(tree), new RegExp(`${percentage}%`));
    assert.equal(h.calls.update.at(-1)[0], percentage / 100);
    assert.equal(h.calls.update.at(-1)[1], '#123ABC');
    h.unmount();
  });
}

for (const reference of [null, undefined, 0, -1, NaN, Infinity]) {
  test(`invalid reference ${reference} stays indeterminate without inventing 1kg`, () => {
    const visual = spoolVisual(500, reference, 20);
    assert.equal(visual.level, null);
    assert.equal(visual.percentage, null);
    assert.equal(visual.status, 'Percentual indisponível');
    const h = harness();
    h.render({ referenceGrams: reference, interactive: true });
    const tree = h.flush();
    assert.match(text(tree), /500 g/);
    assert.match(text(tree), /Volume indeterminado/);
    assert.equal(h.calls.update.at(-1)[0], null);
    h.unmount();
  });
}
for (const balance of [null, undefined, -1, NaN, Infinity]) {
  test(`invalid balance ${balance} is unavailable, not an empty spool`, () => {
    const visual = spoolVisual(balance, 1000, 20);
    assert.equal(visual.level, null);
    assert.equal(visual.validBalance, false);
    assert.equal(visual.empty, false);
    const h = harness();
    h.render({ remainingGrams: balance, interactive: true });
    const tree = h.flush();
    assert.match(text(tree), /Saldo indisponível/);
    assert.doesNotMatch(text(tree), /Esgotado/);
    assert.equal(h.calls.update.at(-1)[0], null);
    h.unmount();
  });
}
test('overcapacity clamps geometry only and preserves actual weight and percentage', () => {
  const visual = spoolVisual(1500, 1000, 20);
  assert.equal(visual.level, 1);
  assert.equal(visual.percentage, 150);
  const h = harness();
  h.render({ remainingGrams: 1500, interactive: true });
  const tree = h.flush();
  assert.match(text(tree), /1\.500 g/);
  assert.match(text(tree), /150%/);
  assert.match(text(tree), /peso real preservado/);
  assert.equal(h.calls.update.at(-1)[0], 1);
  h.unmount();
});
test('low equality, threshold endpoints and empty status never recolor the filament orange', () => {
  for (const [remainingGrams, lowThresholdPercent, status] of [
    [200, 20, 'Estoque baixo'], [1, 0, 'Saldo disponível'],
    [1000, 100, 'Estoque baixo'], [0, 0, 'Esgotado'], [0, 100, 'Esgotado'],
    [500, null, 'Alerta indisponível'],
  ]) {
    const h = harness();
    h.render({ remainingGrams, lowThresholdPercent, interactive: true });
    assert.ok(text(h.flush()).includes(status));
    assert.equal(h.calls.update.at(-1)[1], '#123ABC');
    h.unmount();
  }
});
test('interactive updates reuse the renderer; buttons rotate and unmount disposes once', () => {
  const h = harness();
  h.render({ interactive: true });
  let tree = h.flush();
  assert.equal(h.calls.create.length, 1);
  assert.equal(h.calls.create[0][0], h.fakeCanvas);
  assert.equal(h.calls.create[0][1].interactive, true);
  for (const button of all(tree, node => node.type === 'button')) button.props.onClick();
  assert.deepEqual(h.calls.rotate, [-0.3, 0.3]);
  h.render({ remainingGrams: 250, colorHex: '#654321' });
  tree = h.flush();
  assert.equal(h.calls.create.length, 1);
  assert.equal(h.calls.dispose.length, 0);
  assert.deepEqual(h.calls.update.at(-1), [0.25, '#654321']);
  assert.match(tree.props['aria-label'], /PLA 01: 250 g; 25%/);
  h.unmount();
  assert.equal(h.calls.dispose.length, 1);
});
test('no WebGL preserves readable data, shows fallback, and hides unusable controls', () => {
  for (const interactive of [true, false]) {
    const h = harness({ noGL: true });
    h.render({ interactive });
    const tree = h.flush();
    assert.match(text(tree), /Visualização 3D indisponível/);
    assert.match(text(tree), /500 g/);
    assert.match(text(tree), /50%/);
    assert.equal(all(tree, node => node.props?.role === 'status').length, 1);
    assert.equal(all(tree, node => node.type === 'canvas')[0].props.hidden, true);
    assert.equal(all(tree, node => node.type === 'button').length, 0);
    h.unmount();
  }
});
test('asynchronous renderer failure exposes fallback; late callbacks after disposal do nothing', () => {
  const h = harness();
  h.render({ interactive: true }); h.flush();
  const fail = h.calls.create[0][1].onFailure;
  fail();
  assert.match(text(h.flush()), /Visualização 3D indisponível/);
  h.unmount();
  assert.doesNotThrow(fail);
  assert.equal(h.calls.dispose.length, 1);
});
test('two simultaneous detail mounts transfer single-active ownership', () => {
  const shared = {};
  const first = harness({ shared });
  first.render(); first.flush();
  const second = harness({ shared });
  second.render(); second.flush();
  assert.equal(first.calls.create.length, 1);
  assert.equal(second.calls.create.length, 1);
  assert.equal(first.calls.dispose.length, 1);
  assert.equal(second.calls.dispose.length, 0);
  assert.equal(all(first.flush(), node => node.type === 'canvas')[0].props.hidden, true);
  first.unmount();
  const third = harness({ shared });
  third.render(); third.flush();
  assert.equal(second.calls.dispose.length, 1, 'stale cleanup must not clear current ownership');
  second.unmount(); third.unmount();
});
test('switching details disposes the old renderer and initializes the selected spool', () => {
  const shared = {};
  const first = harness({ shared });
  first.render(); first.flush(); first.unmount();
  assert.equal(first.calls.dispose.length, 1);
  const next = harness({ shared });
  next.render({ remainingGrams: 250, colorHex: '#FFFFFF', label: 'PLA 02' });
  assert.match(text(next.flush()), /PLA 02: 250 g; 25%/);
  assert.deepEqual(next.calls.update.at(-1), [0.25, '#FFFFFF']);
  assert.equal(first.calls.dispose.length, 1);
  next.unmount();
  assert.equal(next.calls.dispose.length, 1);
});
test('responsive surface, touch scrolling and keyboard rotation remain available without browser dependencies', () => {
  assert.match(css, /\.root\s*\{[^}]*width:\s*100%[^}]*min-width:\s*0/);
  assert.match(css, /\.stage\s*\{[^}]*aspect-ratio:[^}]*background:\s*radial-gradient/);
  assert.match(css, /\.interactive\s*\{[^}]*touch-action:\s*pan-y/);
  assert.match(css, /@media\s*\(max-width:\s*430px\)/);
  assert.match(css, /\.rotation button\s*\{[^}]*min-height:\s*44px/);
  assert.match(css, /:focus-visible\s*\{[^}]*outline:/);
  const h = harness();
  const tree = h.render({ interactive: true });
  const canvas = all(tree, node => node.type === 'canvas')[0];
  assert.equal(canvas.props['aria-hidden'], 'true');
  for (const button of all(tree, node => node.type === 'button')) {
    assert.equal(button.props.type, 'button');
    assert.match(button.props['aria-label'], /Girar carretel/);
  }
});

test('detail model uses a client-only dynamic boundary without eager renderer imports', () => {
  let config, loader;
  const { SpoolDetail3D } = loadTS('components/spools/SpoolDetail3D.tsx', {
    'next/dynamic': { default: (load, options) => { loader = load; config = options; return 'LazyDetail'; } },
    'react/jsx-runtime': { jsx, jsxs: jsx },
  });
  assert.equal(typeof loader, 'function');
  assert.equal(config.ssr, false);
  assert.equal(config.loading().props.role, 'status');
  const tree = SpoolDetail3D(defaults);
  assert.equal(tree.type, 'LazyDetail');
  assert.equal(tree.props.interactive, true);
  assert.equal(tree.props.colorHex, defaults.colorHex);
});
test('list and form local import graphs never reach WebGL or the detail model', () => {
  const path = require('node:path');
  const visited = new Set();
  function walk(file) {
    file = path.resolve(file);
    if (visited.has(file)) return;
    visited.add(file);
    assert.doesNotMatch(file, /(?:spool-webgl|Spool3D|SpoolDetail3D)\.[jt]sx?$/);
    const source = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /getContext\(\s*["']webgl|renderSpoolPreview|createSpoolRenderer/);
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    for (const statement of ast.statements) {
      if ((!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) || !statement.moduleSpecifier || statement.importClause?.isTypeOnly) continue;
      const name = statement.moduleSpecifier.text;
      if (!name.startsWith('.') && !name.startsWith('@/')) continue;
      const base = name.startsWith('@/') ? path.resolve(name.slice(2)) : path.resolve(path.dirname(file), name);
      const target = [base, base + '.tsx', base + '.ts', path.join(base, 'index.ts')].find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
      if (target && /\.[jt]sx?$/.test(target)) walk(target);
    }
  }
  for (const file of ['app/(authenticated)/estoque/carreteis/page.tsx', 'components/spools/SpoolForms.tsx', 'components/spools/SpoolColorField.tsx']) walk(file);
  assert.ok([...visited].some(file => file.endsWith('SpoolLevel.tsx')), 'lightweight 2D indicator is reachable');
});
