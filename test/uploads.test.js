const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
    CRAFT_UPLOAD_MAX_BYTES,
    safeDeleteUploadedFile,
    validateUploadedImages,
    validateImageFileSignature,
} = require('../src/web/services/crafts/uploads');

const PNG_1X1 = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

test('upload magic bytes : PNG valide accepte', () => {
    const type = validateImageFileSignature({
        originalname: 'image.png',
        mimetype: 'image/png',
        size: PNG_1X1.length,
        buffer: PNG_1X1,
    });
    assert.equal(type, 'png');
});

test('upload magic bytes : faux PNG et MIME incoherent refuses', () => {
    assert.throws(() => validateImageFileSignature({
        originalname: 'image.png',
        mimetype: 'image/png',
        size: 12,
        buffer: Buffer.from('not a png file'),
    }), /Signature image invalide/);

    assert.throws(() => validateImageFileSignature({
        originalname: 'image.png',
        mimetype: 'image/jpeg',
        size: PNG_1X1.length,
        buffer: PNG_1X1,
    }), /Type MIME incoherent/);
});

test('upload magic bytes : fichier trop gros refuse', () => {
    assert.throws(() => validateImageFileSignature({
        originalname: 'image.png',
        mimetype: 'image/png',
        size: CRAFT_UPLOAD_MAX_BYTES + 1,
        buffer: PNG_1X1,
    }), /Fichier trop lourd/);
});

test('safeDeleteUploadedFile ne supprime pas hors dossier upload', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), '21bs-upload-'));
    const outside = path.join(os.tmpdir(), `outside-${Date.now()}.txt`);
    const inside = path.join(root, 'inside.png');
    fs.writeFileSync(outside, 'outside');
    fs.writeFileSync(inside, 'inside');
    try {
        assert.equal(safeDeleteUploadedFile(root, outside), false);
        assert.equal(fs.existsSync(outside), true);
        assert.equal(safeDeleteUploadedFile(root, 'inside.png'), true);
        assert.equal(fs.existsSync(inside), false);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
        fs.rmSync(outside, { force: true });
    }
});

test('middleware magic bytes supprime le fichier temporaire rejete', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), '21bs-upload-reject-'));
    const invalidPath = path.join(root, 'fake.png');
    fs.writeFileSync(invalidPath, 'fake');
    try {
        await new Promise(resolve => {
            validateUploadedImages({
                file: {
                    originalname: 'fake.png',
                    mimetype: 'image/png',
                    size: 4,
                    path: invalidPath,
                },
            }, {}, error => {
                assert.match(error.message, /Signature image invalide/);
                resolve();
            });
        });
        assert.equal(fs.existsSync(invalidPath), false);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
