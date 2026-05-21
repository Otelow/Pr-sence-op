#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const ignoredDirs = new Set(['.git', 'node_modules', 'data', 'uploads']);
const files = [];

function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            if (!ignoredDirs.has(entry.name)) walk(path.join(dir, entry.name));
        } else if (entry.isFile() && entry.name.endsWith('.js')) {
            files.push(path.join(dir, entry.name));
        }
    }
}

walk(root);

let failed = 0;
for (const file of files) {
    const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
    if (result.status !== 0) failed += 1;
}

console.log(`Syntax check: ${files.length - failed}/${files.length} OK`);
if (failed) process.exit(1);
