#!/usr/bin/env node
// STABILISATION FINALE 15/05/2026 — smoke test post-déploiement

const url = process.argv[2] || 'http://localhost:3000';

const checks = [
    {
        name: '/healthz returns ready',
        test: async () => {
            const r = await fetch(`${url}/healthz`);
            const d = await r.json();
            if (!r.ok || !d.ready) throw new Error('not ready');
        },
    },
    {
        name: '/ returns 200',
        test: async () => {
            const r = await fetch(url);
            if (!r.ok) throw new Error(`status ${r.status}`);
        },
    },
    {
        name: '/auth/login returns redirect to discord',
        test: async () => {
            const r = await fetch(`${url}/auth/login`, { redirect: 'manual' });
            if (r.status !== 302) throw new Error(`status ${r.status}`);
            const loc = r.headers.get('location') || '';
            if (!loc.includes('discord.com')) throw new Error(`bad location: ${loc}`);
        },
    },
    {
        name: '/api/me without cookie returns 401',
        test: async () => {
            const r = await fetch(`${url}/api/me`);
            if (r.status !== 401) throw new Error(`status ${r.status} (expected 401)`);
        },
    },
    {
        name: '/style.css has utf-8 charset',
        test: async () => {
            const r = await fetch(`${url}/style.css`);
            const ct = r.headers.get('content-type') || '';
            if (!ct.toLowerCase().includes('utf-8')) throw new Error(`bad content-type: ${ct}`);
        },
    },
];

(async () => {
    let ok = 0;
    const fails = [];
    for (const c of checks) {
        try {
            await c.test();
            ok += 1;
            console.log(`✅ ${c.name}`);
        } catch (e) {
            fails.push({ name: c.name, error: e.message });
            console.log(`❌ ${c.name}: ${e.message}`);
        }
    }
    console.log(`\n${ok}/${checks.length} OK`);
    if (fails.length) process.exit(1);
})();
