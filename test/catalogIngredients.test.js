const test = require('node:test');
const assert = require('node:assert/strict');

const { _test } = require('../src/web/routes/crafts/catalog');

test('catalog ingredients accept amount payloads from admin editor', () => {
    const result = _test.normalizeIngredientsPayload(JSON.stringify([
        { ingredient_id: 12, name: 'Acier', amount: 4 },
    ]));

    assert.equal(result.length, 1);
    assert.equal(result[0].ingredient_id, 12);
    assert.equal(result[0].quantity, 4);
    assert.equal(result[0].amount, 4);
});

test('catalog ingredients ignore fully empty draft rows', () => {
    const result = _test.normalizeIngredientsPayload(JSON.stringify([
        { ingredient_id: null, name: '', amount: 0 },
        { ingredient_id: '', name: '  ', quantity: '' },
        { ingredient_id: 7, name: 'Cuivre', quantity: 2 },
    ]));

    assert.deepEqual(result.map(item => item.name), ['Cuivre']);
});

test('catalog ingredients reject partially filled invalid rows', () => {
    assert.throws(
        () => _test.normalizeIngredientsPayload([{ ingredient_id: 7, name: 'Cuivre', amount: 0 }]),
        /Ingr/
    );
});
