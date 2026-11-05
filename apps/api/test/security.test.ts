import test from 'node:test';
import assert from 'node:assert/strict';
import { scryptSync } from 'node:crypto';
import { signToken, verifyToken, passwordMatches, driveUrl, publication, allSucceeded } from '../src/security';
import { Api } from '../src/api';
process.env.ADMIN_JWT_SECRET = 'admin-secret-testing-000000000000000000000';
process.env.USER_JWT_SECRET = 'user-secret-testing-1111111111111111111111';
test('JWT signatures reject tampering and cross-role access', () => { const token = signToken('u1', 'user'); assert.equal(verifyToken(token, 'user'), 'u1'); assert.throws(() => verifyToken(token, 'admin')); assert.throws(() => verifyToken(token.slice(0, -4) + 'xxxx', 'user')); });
test('scrypt password verification uses exact hash', () => { process.env.ADMIN_PASSWORD_HASH = `scrypt$salt123$${scryptSync('correct-password', 'salt123', 64).toString('hex')}`; assert.equal(passwordMatches('correct-password'), true); assert.equal(passwordMatches('incorrect'), false); delete process.env.ADMIN_PASSWORD_HASH; });
test('drive redirects reject spoofed host, credentials, HTTP and provider mismatch', () => {
    assert.equal(driveUrl('https://pan.baidu.com/s/abc', 'baidu'), 'https://pan.baidu.com/s/abc');
    for (const url of ['https://pan.baidu.com.evil.test/s/abc', 'http://pan.baidu.com/s/abc', 'https://evil@pan.baidu.com/s/abc', 'https://pan.baidu.com:8443/s/abc', 'javascript:alert(1)'])
        assert.throws(() => driveUrl(url));
    assert.throws(() => driveUrl('https://pan.quark.cn/s/abc', 'baidu'));
});
const data = { slug: 'test', title: 'Test', summary: '', categoryId: 'c', topicIds: [], tags: [], ageMin: 4, ageMax: 7, difficulty: 'EASY', pageCount: 2, paperSize: 'A4', colorMode: 'BW', hasAnswers: false, materials: [], instructions: 'Print A4', coverUrl: '/assets/previews/a.jpg', previewUrls: ['/assets/previews/a.jpg'], accessMode: 'FREE', status: 'REVIEW', sources: [{ title: 'Original', author: 'Artist', url: 'https://example.org', license: 'CC0' }] };
test('publication requires attribution, print metadata, previews and valid enabled links', () => { const links = [{ enabled: true, provider: 'baidu', url: 'https://pan.baidu.com/s/abc' }]; assert.doesNotThrow(() => publication(data, links)); assert.throws(() => publication({ ...data, sources: [] }, links)); assert.throws(() => publication({ ...data, ageMin: 8 }, links)); assert.throws(() => publication(data, [])); assert.throws(() => publication({ ...data, previewUrls: [] }, links)); });
test('cleanup requires two successful checkpoints', () => { assert.equal(allSucceeded({ baidu: { status: 'SUCCEEDED' }, quark: { status: 'FAILED' } }), false); assert.equal(allSucceeded({ baidu: { status: 'SUCCEEDED' } }), false); assert.equal(allSucceeded({ baidu: { status: 'SUCCEEDED' }, quark: { status: 'SUCCEEDED' } }), true); });
test('users can remove their favorite after the resource is archived', async () => {
    let removed: any;
    const api = new Api({ favorite: { deleteMany: async (query: any) => { removed = query; } } } as any, {} as any);
    api.user = () => 'user-own';
    api.resource = async () => { throw Error('Archived resource must not need public lookup'); };
    assert.deepEqual(await api.route({ path: '/api/user/favorites/archived-id', method: 'DELETE' } as any, {} as any), { ok: true });
    assert.deepEqual(removed, { where: { userId: 'user-own', resourceId: 'archived-id' } });
});
test('claim replay returns original response without consuming another reward or rate limit', async () => { const original = { claimId: 'claim-1', links: [], claimedAt: '2026-01-01T00:00:00Z' }; const db = { claim: { findUnique: async () => ({ response: original }) }, $transaction: () => { throw Error('must not consume reward again'); } }; const api = new Api(db as any, {} as any); api.identity = () => 'v:visitor'; api.limit = async () => { throw Error('must not rate limit successful replay'); }; assert.deepEqual(await api.claim({} as any, { id: 'resource' }, { requestId: 'same-request-id' }), original); });
import { Storage, storageRoot } from '../src/storage';
import { mkdtemp, mkdir, writeFile, access, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
test('dual provider task retains PDF after Quark failure and retry skips successful Baidu upload', async () => {
    const root = await mkdtemp(join(tmpdir(), 'paperjoy-test-'));
    const originalRoot = process.env.STORAGE_ROOT;
    process.env.STORAGE_ROOT = root;
    try {
        const hash = 'a'.repeat(64), path = join(storageRoot(), 'private', 'sources', `${hash}.pdf`);
        await mkdir(join(root, 'private', 'sources'), { recursive: true });
        await writeFile(path, '%PDF-test');
        const cp: any = { baidu: { status: 'PENDING' }, quark: { status: 'PENDING' } };
        let taskStatus = 'PENDING', resourceCleared = false, quarkFail = true, baiduUploads = 0;
        const db: any = { task: { findFirst: async () => ({ id: 't', resourceId: 'r', baiduAccountId: 'b', quarkAccountId: 'q', checkpoints: cp }), updateMany: async () => ({ count: 1 }), update: async ({ data }: any) => {
                    if (data.status)
                        taskStatus = data.status;
                    return data;
                } }, resource: { findUniqueOrThrow: async () => ({ id: 'r', title: 'Resource', sourcePath: path, sourceHash: hash }), update: async () => { resourceCleared = true; } }, storageAccount: { findUniqueOrThrow: async ({ where }: any) => ({ id: where.id, provider: where.id === 'b' ? 'baidu' : 'quark', status: 'READY' }) }, driveLink: { upsert: async () => ({}) } };
        const service = new Storage(db);
        service.run = async (a: any, args: string[]) => {
            if (a.provider === 'baidu') {
                if (args[0] === 'upload') {
                    baiduUploads++;
                    return '{}';
                }
                return JSON.stringify({ url: 'https://pan.baidu.com/s/abc' });
            }
            if (quarkFail)
                throw Error('Provider outage');
            if (args[0] === 'upload')
                return JSON.stringify({ code: 0, data: { fids: ['fid-1'] } });
            return JSON.stringify({ code: 0, data: { share_url: 'https://pan.quark.cn/s/abc' } });
        };
        await service.tick();
        assert.equal(taskStatus, 'FAILED');
        assert.equal(cp.baidu.status, 'SUCCEEDED');
        assert.equal(cp.quark.status, 'FAILED');
        await access(path);
        assert.equal(resourceCleared, false);
        quarkFail = false;
        await service.tick();
        assert.equal(taskStatus, 'SUCCEEDED');
        assert.equal(baiduUploads, 1);
        assert.equal(resourceCleared, true);
        await assert.rejects(access(path));
    }
    finally {
        if (originalRoot === undefined)
            delete process.env.STORAGE_ROOT;
        else
            process.env.STORAGE_ROOT = originalRoot;
        await rm(root, { recursive: true, force: true });
    }
});
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Database } from '../src/storage';
test('Nest routing serves health outside API and rejects spoofed admin identity', async () => {
    let available = true;
    const fakeDb = { $queryRaw: async () => { if (!available)
            throw Error('DB down'); return [{ one: 1 }]; } };
    @Module({ controllers: [Api], providers: [{ provide: Database, useValue: fakeDb }, { provide: Storage, useValue: {} }] })
    class TestApp {
    }
    const app = await NestFactory.create(TestApp, { logger: false });
    try {
        await app.listen(0, '127.0.0.1');
        const base = await app.getUrl();
        const health = await fetch(base + '/health');
        assert.equal(health.status, 200);
        assert.deepEqual(await health.json(), { status: 'ok', database: 'ok' });
        available = false;
        assert.equal((await fetch(base + '/health')).status, 503);
        const config = await (await fetch(base + '/api/config')).json() as any;
        assert.equal(config.appId, 'wx28e18cf4675ffa9a');
        assert.equal(config.adsEnabled, false);
        assert.equal(config.secret, undefined);
        const admin = await fetch(base + '/api/admin/resources', { headers: { 'X-Openid': 'admin', Authorization: `Bearer ${signToken('u', 'user')}` } });
        assert.equal(admin.status, 401);
        assert.equal((await fetch(base + '/private/sources/test.pdf')).status, 404);
    }
    finally {
        await app.close();
    }
});
import express from 'express';
import { multipartUploads } from '../src/upload';
import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
test('multipart PDF imports stage on disk, hash-check, deduplicate and clean temporary files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'paperjoy-import-')), oldRoot = process.env.STORAGE_ROOT;
    process.env.STORAGE_ROOT = root;
    const pdf = Buffer.from('%PDF-1.7\nTest printable document\n%%EOF\n'), hash = createHash('sha256').update(pdf).digest('hex');
    let inserted = 0, stored: any;
    const fake: any = { resource: { findUnique: async () => stored, aggregate: async () => ({ _sum: { sourceBytes: 0 } }), create: async ({ data }: any) => { inserted++; stored = { id: 'resource-id', ...data }; return stored; } }, taxonomy: { count: async () => 1 }, importBatch: { create: async () => ({ id: 'batch-id', resourceId: 'resource-id' }), findUniqueOrThrow: async () => ({ id: 'batch-id', resourceId: 'resource-id' }) } };
    fake.$transaction = async (fn: any) => fn(fake);
    const api = new Api(fake, {} as any), serverApp = express();
    serverApp.use(multipartUploads());
    let diskOnly = false;
    serverApp.post('/api/admin/imports', async (req, res) => { diskOnly = !!(req.files as any)?.source?.[0]?.path && !(req.files as any)?.source?.[0]?.buffer; try {
        res.json(await api.import(req as any));
    }
    catch (e: any) {
        res.status(e.getStatus?.() || 500).json({ message: e.message });
    } });
    const server = await new Promise<any>(resolve => { const s = serverApp.listen(0, '127.0.0.1', () => resolve(s)); }), base = `http://127.0.0.1:${server.address().port}`;
    const body = (sourceHash = hash) => { const form = new FormData(); form.append('manifest', JSON.stringify({ sourceHash, resource: data })); form.append('source', new Blob([pdf], { type: 'application/pdf' }), 'source.pdf'); return form; };
    try {
        const denied = await fetch(base + '/api/admin/imports', { method: 'POST', body: body() });
        assert.equal(denied.status, 401);
        const headers = { Authorization: `Bearer ${signToken('admin', 'admin')}` };
        const first = await fetch(base + '/api/admin/imports', { method: 'POST', headers, body: body() });
        assert.equal(first.status, 200);
        assert.equal((await first.json() as any).duplicate, false);
        assert.equal(diskOnly, true);
        assert.equal(stored.status, 'REVIEW');
        await access(stored.sourcePath);
        const repeated = await fetch(base + '/api/admin/imports', { method: 'POST', headers, body: body() });
        assert.equal((await repeated.json() as any).duplicate, true);
        assert.equal(inserted, 1);
        const bad = await fetch(base + '/api/admin/imports', { method: 'POST', headers, body: body('0'.repeat(64)) });
        assert.equal(bad.status, 400);
        await new Promise(resolve => setTimeout(resolve, 50));
        assert.deepEqual(await readdir(join(root, 'private', 'incoming')), []);
    }
    finally {
        await new Promise<void>(resolve => server.close(() => resolve()));
        if (oldRoot === undefined)
            delete process.env.STORAGE_ROOT;
        else
            process.env.STORAGE_ROOT = oldRoot;
        await rm(root, { recursive: true, force: true });
    }
});
import { configureProxy } from '../src/http';
test('loopback proxy derives distinct client IPs and ignores forged earlier forwarding hops',async()=>{
 const app=express();configureProxy(app);app.get('/ip',(req,res)=>res.json({ip:req.ip}));
 const server=await new Promise<any>(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));}),url=`http://127.0.0.1:${server.address().port}/ip`;
 try{
  const one=await (await fetch(url,{headers:{'X-Forwarded-For':'198.51.100.10'}})).json() as any;
  const two=await (await fetch(url,{headers:{'X-Forwarded-For':'198.51.100.11'}})).json() as any;
  const forged=await (await fetch(url,{headers:{'X-Forwarded-For':'203.0.113.123, 198.51.100.10'}})).json() as any;
  assert.equal(one.ip,'198.51.100.10');assert.equal(two.ip,'198.51.100.11');assert.equal(forged.ip,one.ip);
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
test('concurrent task retries use compare-and-set and acquire the resource unique lock',async()=>{
 let acquired=false;
 const db:any={task:{findUniqueOrThrow:async()=>({id:'task',resourceId:'resource',status:'FAILED'}),updateMany:async({where,data}:any)=>{assert.equal(where.status,'FAILED');assert.equal(where.activeResourceId,null);assert.equal(data.activeResourceId,'resource');if(acquired)return {count:0};acquired=true;return {count:1};}}};
 const api=new Api(db,{} as any),path='/api/admin/tasks/task/retry';
 const result=await Promise.allSettled([api.admin({} as any,path,'POST',{},{}),api.admin({} as any,path,'POST',{}, {})]);
 assert.equal(result.filter(v=>v.status==='fulfilled').length,1);assert.equal(result.filter(v=>v.status==='rejected').length,1);
});
