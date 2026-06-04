const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

test('dashboard/admin ne contiennent plus de handlers inline', () => {
    const files = [
        'private/dashboard.html',
        'private/admin.html',
        'public/app.js',
        'public/admin.js',
    ];

    for (const file of files) {
        const content = read(file);
        assert.equal(
            /\son(click|change|input|blur|submit|error)\s*=/i.test(content),
            false,
            `${file} contient encore un handler inline`,
        );
    }
});

test('CSP interdit les scripts inline et attributs script inline', () => {
    const server = read('server.js');
    assert.match(server, /scriptSrc:\s*\[\s*["']'self'["']\s*\]/);
    assert.match(server, /scriptSrcAttr:\s*\[\s*["']'none'["']\s*\]/);
    assert.doesNotMatch(server, /scriptSrc:\s*\[[^\]]*unsafe-inline/);
    assert.doesNotMatch(server, /scriptSrcAttr:\s*\[[^\]]*unsafe-inline/);
});
