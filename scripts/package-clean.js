// SECURITY HARDENING 28/05/2026 - clean release archive from git tree
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'releases');
const pkg = require('../package.json');
const outFile = path.join(outDir, `${pkg.name}-${pkg.version}.zip`);

fs.mkdirSync(outDir, { recursive: true });

const result = spawnSync('git', ['archive', '--format=zip', '--output', outFile, 'HEAD'], {
    cwd: root,
    stdio: 'inherit',
});

if (result.status !== 0) {
    process.exit(result.status || 1);
}

console.log(`Archive propre creee: ${outFile}`);
