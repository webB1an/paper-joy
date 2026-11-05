import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { mkdir, mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { cli, Storage, authorizationUrl, result } from '../src/storage';
test('authorization accepts login-required exit with provider URL; ordinary failures stay sanitized', async () => {
    const args = ['-e', "process.stderr.write('https://pan.quark.cn/auth/test');process.exitCode=1"];
    assert.match(await cli(process.execPath, args, tmpdir(), undefined, true), /https:\/\/pan\.quark\.cn/);
    await assert.rejects(cli(process.execPath, args, tmpdir()), /Provider command failed/);
    await assert.rejects(cli(process.execPath, ['-e', "process.stderr.write('private-token');process.exitCode=1"], tmpdir(), undefined, true), error => String(error).includes('Provider command failed') && !String(error).includes('private-token'));
    await assert.rejects(cli(process.execPath, ['-e', "process.stderr.write('https://malicious.example/auth');process.exitCode=1"], tmpdir(), undefined, true), /Provider command failed/);
});
test('Quark JSON Markdown authorization URL is decoded without trailing syntax or marketing links', () => {
    const url = 'https://pan.quark.cn/a/authorize?code=test-code&state=test-state';
    const output = JSON.stringify({ code: -106, msg: `请完成授权：[前往授权](${url})\n官网下载：https://pan.quark.cn\n其他说明`, action: 'login', type: 'result', data: {} });
    assert.equal(authorizationUrl(output, 'quark'), url);
    assert.equal(authorizationUrl(output, 'baidu'), undefined);
    assert.equal(authorizationUrl(JSON.stringify({ msg: '官网 https://pan.quark.cn' }), 'quark'), undefined);
    assert.equal(authorizationUrl('https://user:pass@pan.quark.cn/a/auth', 'quark'), undefined);
    assert.equal(authorizationUrl('https://pan.quark.cn.evil.example/auth', 'quark'), undefined);
    assert.equal(authorizationUrl('https://openapi.baidu.com/oauth/2.0/authorize?state=test', 'baidu'), 'https://openapi.baidu.com/oauth/2.0/authorize?state=test');
});
test('provider result parser supports Baidu link fields and prefixed JSON', () => {
    assert.equal(result('progress\nprefix {"link":"https://pan.baidu.com/s/test","pwd":"1234"}').pwd, '1234');
    assert.equal(result('progress\n{"type":"result","code":0,"data":{"fids":["fid"]}}').data.fids[0], 'fid');
    assert.throws(() => result('unrecognized output'), /unsupported output/);
});
test('fresh and existing authorization states never fabricate a ready account', async () => {
    const account = { id: 'account', name: 'Quark', provider: 'quark', status: 'UNAUTHORIZED' };
    const db: any = { storageAccount: { findUniqueOrThrow: async () => account, update: async ({ data }: any) => ({ ...account, ...data }) } };
    const service = new Storage(db);
    service.run = async () => JSON.stringify({ code: -106, msg: '[前往授权](https://pan.quark.cn/a/authorize?code=test)', type: 'result' });
    assert.deepEqual(await service.authorize('account'), { url: 'https://pan.quark.cn/a/authorize?code=test', status: 'AUTHORIZING', message: 'Complete provider authorization, then submit its code.' });
    service.run = async () => JSON.stringify({ type: 'result', data: { userInfo: {} } });
    assert.equal((await service.check('account')).status, 'ERROR');
    service.run = async () => JSON.stringify({ type: 'result', code: -103, data: {} });
    assert.equal((await service.check('account')).status, 'ERROR');
    service.run = async () => JSON.stringify({ type: 'result', code: 0, data: { userInfo: {} } });
    assert.equal((await service.authorize('account')).status, 'READY');
    account.provider = 'baidu';
    service.run = async () => '\n⚠ 未登录\n请执行以下命令进行授权:\nℹ bdpan login\n';
    assert.equal((await service.check('account')).status, 'ERROR');
});
test('Quark executes a code-only copy per account with isolated script base, cwd and HOME', async () => {
    const root = await mkdtemp(join(tmpdir(), 'paperjoy-cli-isolation-'));
    const previous = { root: process.env.STORAGE_ROOT, skill: process.env.QUARK_SKILL_DIR };
    const vendor = join(root, 'vendor', 'quark');
    process.env.STORAGE_ROOT = join(root, 'storage');
    process.env.QUARK_SKILL_DIR = vendor;
    try {
        await mkdir(join(vendor, 'scripts'), { recursive: true });
        await mkdir(join(vendor, 'codex'), { recursive: true });
        const source = join(vendor, 'scripts', 'quark-drive.cjs');
        await writeFile(source, `const fs=require('fs'),path=require('path');const base=path.dirname(__dirname),config=path.join(base,'codex','config.json');console.log(JSON.stringify({code:0,type:'result',data:{base,cwd:process.cwd(),home:process.env.HOME,xdg:process.env.XDG_CONFIG_HOME,user:fs.existsSync(config)?JSON.parse(fs.readFileSync(config,'utf8')).user:null}}));`);
        await writeFile(join(vendor, 'codex', 'config.json'), JSON.stringify({ user: 'shared-must-not-read' }));
        const service = new Storage({} as any), a = { id: 'account-a', provider: 'quark' }, b = { id: 'account-b', provider: 'quark' };
        const profile = join(process.env.STORAGE_ROOT!, 'private', 'profiles', a.id);
        const first = result(await service.run(a, ['probe'])).data;
        assert.equal(first.user, null);
        assert.equal(first.base, join(profile, 'cli'));
        assert.equal(first.cwd, profile);
        assert.equal(first.home, profile);
        assert.equal(first.xdg, join(profile, '.config'));
        await mkdir(join(profile, 'cli', 'codex'), { recursive: true });
        await writeFile(join(profile, 'cli', 'codex', 'config.json'), JSON.stringify({ user: 'account-a' }));
        assert.equal(result(await service.run(a, ['probe'])).data.user, 'account-a');
        assert.equal(result(await service.run(b, ['probe'])).data.user, null);
        assert.equal(createHash('sha256').update(await readFile(source)).digest('hex'), createHash('sha256').update(await readFile(join(profile, 'cli', 'scripts', 'quark-drive.cjs'))).digest('hex'));
        assert.equal(JSON.parse(await readFile(join(vendor, 'codex', 'config.json'), 'utf8')).user, 'shared-must-not-read');
    }
    finally {
        if (previous.root === undefined)
            delete process.env.STORAGE_ROOT;
        else
            process.env.STORAGE_ROOT = previous.root;
        if (previous.skill === undefined)
            delete process.env.QUARK_SKILL_DIR;
        else
            process.env.QUARK_SKILL_DIR = previous.skill;
        await rm(root, { recursive: true, force: true });
    }
});
