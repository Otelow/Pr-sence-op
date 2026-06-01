const assert = require('node:assert/strict');
const test = require('node:test');

const { isFiniteNumber, normalizeIdArray } = require('../src/web/routes/map');
const { canSeeMapLabs, canViewMap } = require('../src/shared/permissions');

test('map validation refuse NaN et Infinity', () => {
    assert.equal(isFiniteNumber(1), true);
    assert.equal(isFiniteNumber(0), true);
    assert.equal(isFiniteNumber(Number.NaN), false);
    assert.equal(isFiniteNumber(Number.POSITIVE_INFINITY), false);
    assert.equal(isFiniteNumber('1'), false);
});

test('map normalizeIdArray garde uniquement les IDs Discord propres', () => {
    assert.deepEqual(
        normalizeIdArray([' 123456789012345678 ', 'bad', '../x', 123456789012345670]),
        ['123456789012345678']
    );
});

test('map viewer role voit la carte sans voir les laboratoires armes', () => {
    const user = { id: '111111111111111111', roles: ['1485270431291277383'] };
    assert.equal(canViewMap(user), true);
    assert.equal(canSeeMapLabs(user), false);
});
