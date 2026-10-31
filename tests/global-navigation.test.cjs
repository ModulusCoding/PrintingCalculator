/* eslint-disable @typescript-eslint/no-require-imports -- Local isolated TypeScript harness. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const moduleOutput = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync('components/layout/navigation.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: moduleOutput.exports, module: moduleOutput });
const { getNavigation, getPageNavigation, isItemActive, matchesRoute } = moduleOutput.exports;
const owner = { canManageEnterprise: true, canManageMembers: true, canReadPrinters: true, canReadMaterials: true, canReadGeneralMaterials: true, canReadSpools: true, canReadInventory: true, canReadPricing: true, paidModulesLocked: false };

test('approved primary items have exact order and real destinations; settings is separate', () => {
  const nav = getNavigation(owner);
  assert.deepEqual(Array.from(nav, item => item.label), ['Home', 'Precificadora', 'Produtos', 'Pedidos', 'Impressoras', 'Materiais gerais', 'Carretéis', 'Dados empresa', 'Equipe']);
  for (const item of nav) assert.ok(fs.existsSync(`app/(authenticated)${item.href}/page.tsx`), item.href);
});
test('Aprendiz does not hide paid modules or redirect them to checkout', () => {
  const nav = getNavigation({ ...owner, paidModulesLocked: true });
  assert.deepEqual(Array.from(nav.filter(x => x.paid), x => [x.label, x.href, x.visible]), [['Impressoras', '/impressoras', true], ['Materiais gerais', '/estoque/materiais-gerais', true], ['Carretéis', '/estoque/carreteis', true]]);
  for (const label of ['Produtos', 'Pedidos', 'Precificadora']) assert.ok(!nav.find(x => x.label === label).paid);
});
test('admin/operator presentation does not expose enterprise administration', () => {
  const admin = getNavigation({ ...owner, canManageEnterprise: false });
  assert.equal(admin.find(x => x.label === 'Dados empresa').visible, false);
  assert.equal(admin.find(x => x.label === 'Equipe').visible, true);
  const operator = getNavigation({ ...owner, canManageEnterprise: false, canManageMembers: false });
  assert.equal(operator.find(x => x.label === 'Equipe').visible, false);
});
test('inventory, legacy materials and spool settings remain reachable contextually', () => {
  for (const [path, target] of [['/admin/products', '/estoque/produtos'], ['/estoque/materiais-gerais', '/materiais'], ['/estoque/carreteis', '/estoque/carreteis/configuracao']]) {
    assert.ok(getPageNavigation(path, owner).related.some(x => x.href === target));
    assert.ok(fs.existsSync(`app/(authenticated)${target}/page.tsx`));
  }
});
test('active matching is segment-safe and maps inventory/team to the correct parent', () => {
  assert.equal(matchesRoute('/impressoras-outras', '/impressoras'), false);
  for (const [path, label] of [['/estoque/produtos/123', 'Produtos'], ['/empresa/equipe/novo', 'Equipe'], ['/estoque/carreteis/configuracao', 'Carretéis']]) {
    const active = getNavigation(owner).filter(x => isItemActive(path, x));
    assert.equal(active.length, 1);
    assert.equal(active[0].label, label);
  }
});
test('settings routes have correct header context', () => {
  assert.equal(getPageNavigation('/conta', owner).title, 'Minha conta');
  assert.equal(getPageNavigation('/meu-plano', owner).title, 'Meu plano');
  assert.equal(getPageNavigation('/planos', owner).section, 'Configurações');
});
test('drawer uses native modal semantics, focus restoration and scroll cleanup', () => {
  const shell = fs.readFileSync('app/(authenticated)/AuthenticatedShell.tsx', 'utf8');
  assert.match(shell, /<dialog/);
  assert.match(shell, /showModal\(/);
  assert.match(shell, /onClose=.*restoreScroll/);
  assert.match(shell, /menuButton\.current\?\.focus\(/);
  assert.match(shell, /\[pathname\]/);
  assert.match(shell, /aria-expanded=\{settingsOpen\}/);
});
