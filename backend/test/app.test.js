import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedDemo } from '../src/seed.js';

test('health endpoint is public', async () => {
    const response = await request(app).get('/api/health').expect(200);
    assert.equal(response.body.status, 'ok');
});

test('asset API rejects requests without authentication', async () => {
    await request(app).get('/api/assets').expect(401);
});

test('demo seeding is blocked in production', async () => {
    const previousEnvironment = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
        await assert.rejects(seedDemo(), /Demo seeding is disabled in production/);
    } finally {
        if (previousEnvironment === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = previousEnvironment;
    }
});

test('production rejects the example JWT secret', () => {
    const authModule = new URL('../src/auth.js', import.meta.url).href;
    const probe = `import(${JSON.stringify(authModule)}).catch((error) => { console.error(error.message); process.exitCode = 1; });`;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', probe], {
        encoding: 'utf8',
        env: {
            ...process.env,
            NODE_ENV: 'production',
            JWT_SECRET: 'replace-with-a-random-secret-at-least-32-characters'
        }
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /JWT_SECRET must be a unique value/);
});

test('production public demo requires synthetic-data confirmation', () => {
    const serverModule = new URL('../src/server.js', import.meta.url).href;
    const probe = `import(${JSON.stringify(serverModule)}).catch((error) => { console.error(error.message); process.exitCode = 1; });`;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', probe], {
        encoding: 'utf8',
        env: {
            ...process.env,
            NODE_ENV: 'production',
            JWT_SECRET: 'test-production-jwt-secret-value-with-more-than-32-characters',
            DEMO_SEED: 'false',
            PUBLIC_DEMO: 'true',
            PUBLIC_DEMO_DATA_CONFIRMATION: '',
            MONGODB_URI: ''
        }
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Public demo requires confirmation/);
});