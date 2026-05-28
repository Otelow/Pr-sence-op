const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('routes export admin temporaires supprimées de server.js', () => {
    const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    assert.equal(serverSource.includes('/admin/export-db'), false);
    assert.equal(serverSource.includes('/admin/list-data'), false);
    assert.equal(serverSource.includes('/admin/export-crafts-images'), false);
});
