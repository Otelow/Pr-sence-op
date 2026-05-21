const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const test = require('node:test');

const { registerAuthRoutes } = require('../src/web/routes/auth');

function createMockMember() {
    const roles = new Map([['role-user', { id: 'role-user' }]]);
    return {
        nickname: 'Dashboard User',
        roles: { cache: roles },
    };
}

async function requestWithSession(session, path, axiosMock = {}) {
    const app = express();
    app.use((req, res, next) => {
        req.session = session;
        next();
    });

    const guild = {
        members: {
            fetch: async () => createMockMember(),
        },
    };

    registerAuthRoutes(app, {
        authLimiter: (_req, _res, next) => next(),
        axios: {
            post: axiosMock.post || (async () => ({ data: { access_token: 'token' } })),
            get: axiosMock.get || (async () => ({ data: { id: 'u1', username: 'DiscordUser', avatar: null } })),
        },
        DISCORD_CLIENT_ID: 'client-id',
        DISCORD_CLIENT_SECRET: 'client-secret',
        DISCORD_REDIRECT_URI: 'http://localhost/auth/callback',
        getBotClient: () => ({ guilds: { cache: new Map([['guild-id', guild]]) } }),
        getBotState: () => ({ CONFIG: { GUILD_ID: 'guild-id', ROLES: { VIP_ROLE: 'vip-role' } } }),
    });

    const server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    try {
        const response = await fetch(`http://127.0.0.1:${port}${path}`, { redirect: 'manual' });
        const text = await response.text();
        return { response, text };
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
}

test('callback OAuth avec code mais sans state est refuse et ne contacte pas Discord', async () => {
    let postCalled = false;
    const session = { oauthState: 'expected' };
    const { response } = await requestWithSession(session, '/auth/callback?code=abc', {
        post: async () => { postCalled = true; },
    });

    assert.equal(response.status, 400);
    assert.equal(session.oauthState, undefined);
    assert.equal(postCalled, false);
});

test('callback OAuth avec state invalide est refuse', async () => {
    const session = { oauthState: 'expected' };
    const { response } = await requestWithSession(session, '/auth/callback?code=abc&state=wrong');

    assert.equal(response.status, 400);
    assert.equal(session.oauthState, undefined);
});

test('callback OAuth avec state valide regenere la session et connecte user', async () => {
    const session = {
        oauthState: 'expected',
        regenerate(callback) {
            this.regenerated = true;
            callback();
        },
    };
    const { response } = await requestWithSession(session, '/auth/callback?code=abc&state=expected');

    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/dashboard#presence');
    assert.equal(session.oauthState, undefined);
    assert.equal(session.regenerated, true);
    assert.equal(session.user.id, 'u1');
    assert.deepEqual(session.user.roles, ['role-user']);
});
