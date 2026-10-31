/* eslint-disable @typescript-eslint/no-require-imports -- Isolated SSR/hooks and source contracts; no database or network. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const postcss = require('postcss');

const root = path.resolve(__dirname, '..');
const source = file => fs.readFileSync(path.join(root, file), 'utf8');
const original = 'sites/Modulus-Hub-Landing-Codigo/';
const landing = 'components/landing/';
const files = fs.readdirSync(path.join(root, landing));
function load(file, imports = {}, globals = {}) {
  const loadedModule = { exports: {} };
  const code = ts.transpileModule(source(file), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(code, {
    module: loadedModule, exports: loadedModule.exports, URL, ...globals,
    require(name) {
      if (Object.hasOwn(imports, name)) return imports[name];
      if (name === 'react/jsx-runtime') return require(name);
      throw new Error(`Unmocked import in ${file}: ${name}`);
    },
  }, { filename: file });
  return loadedModule.exports;
}
const link = { default: ({ children, ...props }) => React.createElement('a', props, children) };
function ssr(enabled) {
  const cache = new Map();
  function component(file) {
    if (cache.has(file)) return cache.get(file);
    const imports = {
      react: React, 'next/link': link,
      './Landing.module.css': { default: { landing: 'isolated-landing' } },
      './useLandingEffects': { useLandingEffects() {} },
      '@/lib/auth/config': { isPublicOnboardingEnabled: () => enabled },
    };
    const text = source(file);
    for (const match of text.matchAll(/from\s+["']([^"']+)["']/g)) {
      const name = match[1];
      if (name.startsWith('@/components/landing/')) imports[name] = component(name.slice(2) + '.tsx');
      else if (name.startsWith('./') && !name.endsWith('.css') && name !== './useLandingEffects') {
        imports[name] = component(path.posix.join(path.posix.dirname(file), name) + '.tsx');
      }
    }
    const exports = load(file, imports);
    cache.set(file, exports);
    return exports;
  }
  const page = component('app/page.tsx');
  return { html: renderToStaticMarkup(React.createElement(page.default)), metadata: page.metadata };
}
function nodes(tree, predicate) {
  if (Array.isArray(tree)) return tree.flatMap(node => nodes(node, predicate));
  if (!tree || typeof tree !== 'object') return [];
  return [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)];
}
function one(tree, predicate) {
  const matches = nodes(tree, predicate);
  assert.equal(matches.length, 1, 'Expected one matching element');
  return matches[0];
}
const byId = (tree, id) => one(tree, node => node.props?.id === id);
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join(' ');
  if (tree && typeof tree === 'object') return text(tree.props?.children);
  return tree == null || typeof tree === 'boolean' ? '' : String(tree);
}
function hooks(file) {
  const slots = [], refs = [], effects = [], frames = new Map(), timers = new Map();
  let cursor = 0, refCursor = 0, nextId = 1;
  const jsx = (type, props) => ({ type, props: props ?? {} });
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
    },
    useRef(initial) {
      const index = refCursor++;
      return refs[index] ?? (refs[index] = { current: initial });
    },
    useEffect(callback) { effects.push(callback); },
  };
  const component = load(landing + file, {
    react, 'next/link': { default: props => jsx('a', props) },
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'fragment' },
  }, {
    performance: { now: () => 0 },
    window: { matchMedia: () => ({ matches: true }) },
    requestAnimationFrame(callback) { const id = nextId++; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
    setTimeout(callback) { const id = nextId++; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  return {
    refs, effects, frames, timers,
    render(props = {}) { cursor = 0; refCursor = 0; return (component.default ?? component.LandingFAQItem)(props); },
    flushFrames() { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(180)); },
    flushTimers() { const pending = [...timers.values()]; timers.clear(); pending.forEach(callback => callback()); },
  };
}

test('root is a synchronous public marketing composition, not an operational/authenticated page', () => {
  const page = source('app/page.tsx');
  assert.match(page, /export default function Page\(/);
  assert.doesNotMatch(page, /["']use client["']|cookies\(|headers\(|createClient|supabase|resolveMinimalIdentity|getMyPlanAccess|requirePlanBusinessAccess|redirect\(/);
  assert.doesNotMatch(page, /export const (?:dynamic|revalidate|fetchCache)/);
  for (const file of files.filter(file => /\.(tsx|ts)$/.test(file))) {
    assert.doesNotMatch(source(landing + file), /fetch\(|supabase|localStorage|sessionStorage|["']use server["']/, file);
  }
});

test('SSR preserves all original source sections, landmarks, anchor targets, and native no-JS FAQ', () => {
  const { html } = ssr(false);
  const originalHtml = source(original + 'index.html');
  const sectionIds = [...originalHtml.matchAll(/<section[^>]*\bid="([^"]+)"/g)].map(match => match[1]);
  assert.ok(sectionIds.length >= 7);
  for (const id of sectionIds) assert.match(html, new RegExp(`id="${id}"`), `Missing original section ${id}`);
  assert.equal((html.match(/<h1[ >]/g) ?? []).length, 1);
  assert.equal((html.match(/<main[ >]/g) ?? []).length, 1);
  assert.match(html, /href="#conteudo"/);
  assert.match(html, /<main id="conteudo"/);
  assert.equal((html.match(/<details[ >]/g) ?? []).length, 6);
  assert.equal((html.match(/<summary[ >]/g) ?? []).length, 6);
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(ids.length, new Set(ids).size, 'No duplicate DOM IDs');
  for (const [, id] of html.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.includes(id), `Broken anchor #${id}`);
  assert.doesNotMatch(html, /<script|preview-dialog|data-open="login"|fonts\.googleapis/);
  assert.match(html, /Nenhum dado real é alterado/);
});

for (const enabled of [false, true]) {
  test(`SSR signup policy enabled=${enabled}: real routes replace preview-only dialogs`, () => {
    const { html } = ssr(enabled);
    assert.match(html, /href="\/admin\/login"/);
    assert.match(html, /href="\/meu-plano"/);
    assert.equal(html.includes('href="/cadastro"'), enabled);
    assert.equal(html.includes('cadastro público ainda não está disponível'), !enabled);
    assert.doesNotMatch(html, /href="(?:#|javascript:[^"]*)"|checkout|stripe|mercadopago/i);
  });
}

test('SEO replaces former calculator marketing title without inheriting the root title template', () => {
  const { metadata, html } = ssr(false);
  assert.match(metadata.title.absolute, /^Modulus Hub/);
  assert.match(metadata.description, /precificação, produtos, materiais e pedidos/);
  assert.equal(metadata.alternates.canonical, 'https://www.modulus3d.com.br/');
  assert.equal(metadata.openGraph.url, metadata.alternates.canonical);
  assert.equal(metadata.openGraph.title, metadata.title.absolute);
  assert.equal(metadata.twitter.title, metadata.title.absolute);
  assert.equal(metadata.robots.index, true);
  assert.equal(metadata.robots.follow, true);
  assert.match(source('app/layout.tsx'), /<html lang="pt-BR"/);
  assert.match(html, /Sua próxima/);
  assert.ok(fs.existsSync(path.join(root, 'public', metadata.icons.icon)));
});

test('source favicon copied byte-for-byte; sculpture geometry remains code-native and server rendered', () => {
  assert.equal(source('public/landing/favicon.svg'), source(original + 'assets/favicon.svg'));
  const html = ssr(false).html;
  assert.match(html, /id="vaseLayers"/);
  assert.equal((html.match(/<polygon /g) ?? []).length, 92 * 12 + 1);
  for (const match of html.matchAll(/(?:src|href)="(\/landing\/[^"?#]+)"/g)) {
    assert.ok(fs.existsSync(path.join(root, 'public', match[1])), `Missing public asset ${match[1]}`);
  }
});

test('SOURCE CONTRACT: calculator and business routes survive the marketing root replacement', () => {
  for (const file of [
    'app/(authenticated)/precificadora/page.tsx', 'app/(authenticated)/home/page.tsx',
    'app/(authenticated)/admin/products/page.tsx', 'app/(authenticated)/admin/orders/page.tsx',
    'app/(plans)/planos/page.tsx', 'app/(public)/admin/login/page.tsx', 'app/cadastro/page.tsx',
  ]) assert.ok(fs.existsSync(path.join(root, file)), `Missing underlying route ${file}`);
  assert.match(source('app/(authenticated)/layout.tsx'), /await getMyPlanAccess\(\)/);
  assert.match(source('app/(authenticated)/layout.tsx'), /redirect\("\/planos"\)/);
  assert.match(source('app/(plans)/layout.tsx'), /resolveMinimalIdentity/);
  assert.match(source('lib/supabase/middleware.ts'), /isAdminRoute && !isAuthRoute && !user/);
  assert.match(source('lib/supabase/middleware.ts'), /redirectWithSessionCookies\("\/admin\/login"\)/);
});

test('CSS isolation: every non-keyframe selector is rooted in the local module class', () => {
  const css = postcss.parse(source(landing + 'Landing.module.css'));
  let count = 0;
  css.walkRules(rule => {
    if (rule.parent.type === 'atrule' && /keyframes$/.test(rule.parent.name)) return;
    for (const selector of rule.selectors) {
      assert.match(selector, /^\.landing(?=\s|:|$)/, `Leaking selector ${selector}`);
      count++;
    }
  });
  assert.ok(count > 400);
  assert.match(source(landing + 'LandingShell.tsx'), /className=\{styles\.landing\}/);
  assert.doesNotMatch(source('app/layout.tsx') + source('app/globals.css'), /Landing\.module|sites\/|landing\/.*\.css/);
  assert.match(source(landing + 'Landing.module.css'), /prefers-reduced-motion:reduce|prefers-reduced-motion: reduce/);
});

test('effects query inside their own root and restore classes/styles/listeners on cleanup', () => {
  const effects = source(landing + 'useLandingEffects.ts');
  assert.match(effects, /root\.querySelector<T>/);
  assert.match(effects, /root\.querySelectorAll<T>/);
  assert.doesNotMatch(effects, /document\.(?:querySelector|querySelectorAll)|document\.(?:body|documentElement)\.(?:style|classList)/);
  assert.match(effects, /revealObserver\.disconnect\(\)/);
  assert.match(effects, /flowObserver\.disconnect\(\)/);
  assert.match(effects, /navObserver\.disconnect\(\)/);
  assert.match(effects, /styles\.forEach/);
  assert.match(effects, /classes\.forEach/);
  assert.match(effects, /motion\.removeEventListener\("change", reinitialize\)/);
  assert.match(effects, /pointer\.removeEventListener\("change", reinitialize\)/);
});

test('commercial cards preserve real prices, shared capacity, historical free caps, and disabled future purchase', () => {
  const html = ssr(true).html;
  assert.match(html, /39<span>,90<\/span>/);
  assert.match(html, /79<span>,90<\/span>/);
  assert.match(html, /Até 3 produtos históricos/);
  assert.match(html, /Até 3 pedidos históricos/);
  assert.match(html, /15 materiais: carretéis \+ materiais gerais/);
  assert.match(html, /15 cadastros somados/);
  assert.match(html, /<button[^>]*disabled=""[^>]*>Em construção/);
  assert.match(html, /ainda não contratável/);
  assert.match(html, /Não há telemetria, monitoramento de camadas ou controle remoto/);
  assert.match(html, /Não exige cartão/);
  assert.match(source('lib/plans.ts'), /3990/);
  assert.match(source('lib/plans.ts'), /7990/);
});

test('demo tabs switch panels and preserve local pricing/order state', () => {
  const h = hooks('LandingDemo.tsx');
  let tree = h.render();
  assert.equal(byId(tree, 'panel-pricing').props.hidden, false);
  for (const tab of ['stock', 'orders', 'pricing']) {
    one(tree, node => node.props?.['data-tab'] === tab).props.onClick();
    tree = h.render();
    for (const key of ['pricing', 'stock', 'orders']) assert.equal(byId(tree, `panel-${key}`).props.hidden, tab !== key);
    assert.equal(one(tree, node => node.props?.['data-tab'] === tab).props['aria-pressed'], true);
  }
});

for (const weight of [20, 100, 300]) {
  test(`demo slider ${weight}g uses original reference math, 5% loss and 100% markup`, () => {
    const h = hooks('LandingDemo.tsx');
    byId(h.render(), 'weight').props.onChange({ target: { value: String(weight) } });
    h.flushFrames();
    const tree = h.render();
    const brl = value => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    assert.equal(text(byId(tree, 'weight-value')), String(weight));
    assert.equal(byId(tree, 'weight').props['aria-valuetext'], `${weight} gramas`);
    assert.equal(text(byId(tree, 'filament-cost')), brl(weight * 1.05 * .1));
    assert.equal(text(byId(tree, 'cost-total')), brl(weight * 1.05 * .1 + 9));
    assert.equal(text(byId(tree, 'suggested')), brl((weight * 1.05 * .1 + 9) * 2));
  });
}

test('demo order advances exactly twice, updates counters, disables delivery, and resets', () => {
  const h = hooks('LandingDemo.tsx');
  let tree = h.render();
  for (const stage of [0, 1, 2]) {
    assert.equal(text(byId(tree, 'count-quoted')), stage === 0 ? '1' : '0');
    assert.equal(text(byId(tree, 'count-paid')), stage === 1 ? '1' : '0');
    assert.equal(text(byId(tree, 'count-delivered')), stage === 2 ? '2' : '1');
    assert.equal(byId(tree, 'advance-order').props.disabled, stage === 2);
    byId(tree, 'advance-order').props.onClick();
    tree = h.render();
  }
  assert.match(text(one(tree, node => node.props?.role === 'status')), /simulação/);
  byId(tree, 'reset-order').props.onClick();
  tree = h.render();
  assert.match(text(byId(tree, 'advance-order')), /Marcar como pago/);
  h.flushTimers();
  assert.equal(text(one(h.render(), node => node.props?.role === 'status')).trim(), '✓');
});

test('comparison modes and pricing disclosure expose state and correctly labelled content', () => {
  const mode = hooks('LandingComparison.tsx');
  let tree = mode.render();
  assert.equal(byId(tree, 'mode-demo').props['aria-labelledby'], 'mode-integrated');
  byId(tree, 'mode-manual').props.onClick();
  tree = mode.render();
  assert.equal(byId(tree, 'mode-manual').props['aria-selected'], true);
  assert.equal(byId(tree, 'mode-demo').props['aria-labelledby'], 'mode-manual');
  assert.match(text(byId(tree, 'mode-printer')), /Informe os parâmetros/);
  byId(tree, 'mode-integrated').props.onClick();
  assert.match(text(byId(mode.render(), 'mode-printer')), /Creality K1/);
  const comparison = hooks('PricingComparison.tsx');
  tree = comparison.render({ children: 'table content' });
  assert.equal(byId(tree, 'detailed-comparison').props.hidden, true);
  one(tree, node => node.type === 'button').props.onClick();
  tree = comparison.render({ children: 'table content' });
  assert.equal(byId(tree, 'detailed-comparison').props.hidden, false);
  assert.equal(one(tree, node => node.type === 'button').props['aria-expanded'], true);
});

test('mobile menu exposes controls, toggles open, and closes after choosing a link', () => {
  const h = hooks('LandingHeader.tsx');
  let tree = h.render();
  const toggle = value => one(value, node => node.type === 'button' && node.props?.['aria-controls'] === 'mobile-nav');
  assert.equal(byId(tree, 'mobile-nav').props.hidden, true);
  assert.equal(toggle(tree).props['aria-expanded'], false);
  toggle(tree).props.onClick();
  tree = h.render();
  assert.equal(toggle(tree).props['aria-expanded'], true);
  assert.equal(byId(tree, 'mobile-nav').props.hidden, false);
  byId(tree, 'mobile-nav').props.onClick();
  assert.equal(byId(h.render(), 'mobile-nav').props.hidden, true);
});

test('FAQ native details enhancement opens immediately, closes after animation, and cancels on cleanup', () => {
  const h = hooks('LandingFAQItem.tsx');
  let tree = h.render({ title: 'Question', children: 'Answer' });
  const detail = { open: false }, animations = [];
  h.refs[0].current = detail;
  h.refs[1].current = { scrollHeight: 120, animate(keyframes, options) {
    const animation = { keyframes, options, cancelled: false, cancel() { this.cancelled = true; } };
    animations.push(animation);
    return animation;
  } };
  let prevented = 0;
  one(tree, node => node.type === 'summary').props.onClick({ preventDefault() { prevented++; } });
  assert.equal(detail.open, true);
  tree = h.render({ title: 'Question', children: 'Answer' });
  const cleanup = h.effects.at(-1)();
  assert.equal(animations.at(-1).options.duration, 0, 'Reduced motion does not animate');
  animations.at(-1).onfinish();
  assert.equal(detail.open, true);
  cleanup();
  assert.equal(animations.at(-1).cancelled, true);
  one(tree, node => node.type === 'summary').props.onClick({ preventDefault() { prevented++; } });
  h.render({ title: 'Question', children: 'Answer' });
  h.effects.at(-1)();
  assert.equal(detail.open, true, 'Native detail stays open until measured close finishes');
  animations.at(-1).onfinish();
  assert.equal(detail.open, false);
  assert.equal(prevented, 2);
});

// Browser checks additionally cover the six target widths and local-only anonymous redirects.
test('second-review fixes retain tablet navigation, anchor offsets, field labels and no speculative operators', () => {
  const css = fs.readFileSync(path.join(root, 'components/landing/Landing.module.css'), 'utf8');
  assert.match(css, /@media\(min-width:881px\)/);
  assert.match(css, /scroll-margin-top:100px/);
  assert.match(css, /ml-compare-label/);
  const comparison = fs.readFileSync(path.join(root, 'components/landing/LandingComparison.tsx'), 'utf8');
  assert.match(comparison, /onKeyDown/);
  assert.match(comparison, /tabIndex=/);
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'components/landing/LandingPricing.tsx'), 'utf8'), /3 operadores/);
});
