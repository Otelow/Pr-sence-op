const assert = require('node:assert/strict');
const test = require('node:test');

const { attachCsrfToken, requireCsrf } = require('../src/web/middlewares/csrf');

function runMiddleware(middleware, req) {
    return new Promise(resolve => {
        const res = {
            statusCode: 200,
            body: null,
            status(code) {
                this.statusCode = code;
                return this;
            },
            json(payload) {
                this.body = payload;
                resolve({ nextCalled: false, res: this });
            },
        };
        middleware(req, res, () => resolve({ nextCalled: true, res }));
    });
}

test('CSRF crée un token en session', async () => {
    const req = { session: {} };
    const result = await runMiddleware(attachCsrfToken, req);
    assert.equal(result.nextCalled, true);
    assert.match(req.session.csrfToken, /^[a-f0-9]{64}$/);
});

test('CSRF refuse une mutation sans header et accepte avec header', async () => {
    const req = {
        method: 'POST',
        session: { csrfToken: 'token-ok' },
        get: name => undefined,
    };
    const refused = await runMiddleware(requireCsrf, req);
    assert.equal(refused.res.statusCode, 403);
    assert.deepEqual(refused.res.body, { error: 'CSRF token invalide' });

    const accepted = await runMiddleware(requireCsrf, {
        ...req,
        get: name => name.toLowerCase() === 'x-csrf-token' ? 'token-ok' : undefined,
    });
    assert.equal(accepted.nextCalled, true);
});

test('CSRF laisse passer les méthodes sûres', async () => {
    const accepted = await runMiddleware(requireCsrf, {
        method: 'GET',
        session: {},
        get: () => undefined,
    });
    assert.equal(accepted.nextCalled, true);
});
