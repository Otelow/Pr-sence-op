const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('dashboard/admin HTML ne sont plus servis depuis public', () => {
    assert.equal(fs.existsSync(path.join(root, 'public', 'dashboard.html')), false);
    assert.equal(fs.existsSync(path.join(root, 'public', 'admin.html')), false);
});

test('dashboard/admin HTML existent dans private', () => {
    assert.equal(fs.existsSync(path.join(root, 'private', 'dashboard.html')), true);
    assert.equal(fs.existsSync(path.join(root, 'private', 'admin.html')), true);
});
