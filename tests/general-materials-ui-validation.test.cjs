/* eslint-disable @typescript-eslint/no-require-imports -- Isolated local TypeScript harness. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const moduleObject = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/general-materials/validation.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: moduleObject.exports, module: moduleObject, require });
const v = moduleObject.exports;
const formatModule = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/general-materials/format.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: formatModule.exports, module: formatModule });
test('BRL presentation preserves six-place cost and fractional control units', () => {
  assert.match(formatModule.exports.formatCurrency(12.123456), /12,123456/);
  assert.match(formatModule.exports.formatCurrency(12.5), /12,50/);
  assert.equal(formatModule.exports.formatQuantity(0.000001, 'metro'), '0,000001 metro');
});
const id = '11111111-1111-4111-8111-111111111111';
const base = { name: '  Embalagem  ', control_unit: 'unidade', reference_quantity: '1', reference_price: '12,123456', opening_quantity: '0', attempt_id: id };
test('creation keeps all five units, fractional quantities and six-place BRL precision', () => {
  for (const unit of ['unidade', 'metro', 'centimetro', 'grama', 'quilograma']) {
    const result = v.createMaterialSchema.parse({ ...base, control_unit: unit, opening_quantity: '0,000001' });
    assert.equal(result.name, 'Embalagem');
    assert.equal(result.reference_price, '12.123456');
    assert.equal(result.opening_quantity, '0.000001');
  }
});
test('invalid pasted amounts never become zero or rounded numbers', () => {
  for (const amount of ['', '-1', 'abc', '1.000,50', 'R$ 12,50', '1e3', '1,1234567', '1000000,000001', 'Infinity', '12,', '1 000']) {
    assert.equal(v.createMaterialSchema.safeParse({ ...base, reference_price: amount }).success, false, amount);
  }
  assert.equal(v.createMaterialSchema.safeParse({ ...base, reference_quantity: '0' }).success, false);
  assert.equal(v.createMaterialSchema.safeParse({ ...base, reference_price: '0' }).success, true);
});
test('adjustment uses absolute counted balance, including zero; consumption must be positive', () => {
  const movement = { material_id: id, expected_version: '0', supplied_unit: 'metro', reason: 'Contagem', attempt_id: id };
  assert.equal(v.createMovementSchema.safeParse({ ...movement, movement_type: 'adjustment', counted_balance: '0' }).success, true);
  assert.equal(v.createMovementSchema.safeParse({ ...movement, movement_type: 'adjustment', quantity: '1' }).success, false);
  assert.equal(v.createMovementSchema.safeParse({ ...movement, movement_type: 'consumption', quantity: '0' }).success, false);
});
test('name, reason and immutable profile contract remain bounded', () => {
  assert.equal(v.createMaterialSchema.safeParse({ ...base, name: 'x'.repeat(121) }).success, false);
  assert.equal(v.createMaterialSchema.safeParse({ ...base, control_unit: 'litro' }).success, false);
  assert.equal(v.updateProfileSchema.safeParse({ material_id: id, expected_version: 0, attempt_id: id, name: 'Nome', control_unit: 'metro' }).success, false);
});
