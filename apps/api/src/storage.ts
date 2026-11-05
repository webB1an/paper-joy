import { Injectable, Inject, OnModuleInit, OnModuleDestroy, ServiceUnavailableException, BadRequestException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { resolve, join } from 'node:path';
import { mkdir, unlink, copyFile, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { allSucceeded, driveUrl } from './security';
export const storageRoot = () => resolve(process.env.STORAGE_ROOT || 'storage');
export function authorizationUrl(output: string, provider?: string): string | undefined {
    const texts: string[] = [];
    for (const line of output.split('\n')) {
        try {
            const parsed = JSON.parse(line.slice(line.indexOf('{'), line.lastIndexOf('}') + 1));
            for (const object of [parsed, parsed.data])
                if (object && typeof object === 'object')
                    for (const key of ['url', 'authUrl', 'auth_url', 'authorize_url', 'authorizationUrl'])
                        if (typeof object[key] === 'string')
                            texts.push(object[key]);
            if (typeof parsed.msg === 'string')
                texts.push(parsed.msg);
        }
        catch { }
    }
    texts.push(output);
    for (const text of texts)
        for (const match of text.matchAll(/https:\/\/[^\s"'<>\\]+/g)) {
            const candidate = match[0].replace(/[)\]},.;]+$/, '');
            try {
                const url = new URL(candidate), host = url.hostname;
                const actual = host === 'openapi.baidu.com' || host === 'pan.baidu.com' ? 'baidu' : host === 'pan.quark.cn' ? 'quark' : undefined;
                if (actual && (!provider || provider === actual) && url.protocol === 'https:' && !url.username && !url.password && !url.port && url.pathname !== '/')
                    return url.href;
            }
            catch { }
        }
    return undefined;
}
@Injectable()
export class Database extends PrismaClient implements OnModuleInit, OnModuleDestroy {
    async onModuleInit() { await this.$connect(); }
    async onModuleDestroy() { await this.$disconnect(); }
}
export function cli(command: string, args: string[], profile: string, stdin?: string, authorization = false, cwd?: string): Promise<string> {
    return new Promise((yes, no) => {
        const child = spawn(command, args, { shell: false, cwd, env: { ...process.env, HOME: profile, USERPROFILE: profile, XDG_CONFIG_HOME: join(profile, '.config'), CODEX_ENV: '1', AI_AGENT: 'codex' }, windowsHide: true });
        let out = '';
        let err = '';
        const timer = setTimeout(() => { child.kill('SIGKILL'); no(new ServiceUnavailableException('Provider command timed out')); }, authorization ? 30000 : 15 * 60 * 1000);
        child.stdout.on('data', d => {
            out += d;
            if (out.length > 2000000)
                child.kill();
        });
        child.stderr.on('data', d => { if (err.length < 2000000)
            err += d; });
        child.on('error', () => { clearTimeout(timer); no(new ServiceUnavailableException('Provider CLI unavailable; configure BDPAN_PATH / QUARK_SKILL_DIR')); });
        child.on('close', code => { clearTimeout(timer); const output = authorization ? out + '\n' + err : out; code === 0 || (authorization && !!authorizationUrl(output)) ? yes(output) : no(new ServiceUnavailableException('Provider command failed; check account authorization and CLI configuration')); });
        child.stdin.end(stdin);
    });
}
export function result(text: string): any {
    for (const line of text.trim().split('\n').reverse()) {
        try {
            const r = JSON.parse(line.slice(line.indexOf('{'), line.lastIndexOf('}') + 1));
            if (r.type === 'result' || r.data || r.url || r.share_url || r.link)
                return r;
        }
        catch { }
    }
    try {
        return JSON.parse(text);
    }
    catch {
        throw new ServiceUnavailableException('Provider returned unsupported output');
    }
}
@Injectable()
export class Storage implements OnModuleInit, OnModuleDestroy {
    constructor(
    @Inject(Database)
    private db: Database) { }
    timer?: NodeJS.Timeout;
    busy = false;
    async onModuleInit() { await mkdir(join(storageRoot(), 'private'), { recursive: true }); if (process.env.NODE_ENV === 'test' && process.env.DISABLE_STORAGE_WORKER === 'true')
        return; await this.db.task.updateMany({ where: { status: 'RUNNING' }, data: { status: 'PENDING', error: 'Recovered after process restart' } }); this.timer = setInterval(() => void this.tick().catch(() => undefined), 3000); this.timer.unref(); }
    onModuleDestroy() {
        if (this.timer)
            clearInterval(this.timer);
    }
    accountView(a: any) { return { id: a.id, name: a.name, provider: a.provider, status: a.status, ...(a.lastError ? { lastError: a.lastError } : {}) }; }
    async run(a: any, args: string[], stdin?: string, authorization = false) {
        const profile = join(storageRoot(), 'private', 'profiles', a.id);
        await mkdir(profile, { recursive: true, mode: 0o700 });
        if (a.provider === 'baidu')
            return cli(process.env.BDPAN_PATH || 'bdpan', ['--config-path', join(profile, 'bdpan.json'), '--no-check-update', ...args], profile, stdin, authorization, profile);
        if (a.provider !== 'quark')
            throw new ServiceUnavailableException('Unsupported storage provider');
        const source = join(process.env.QUARK_SKILL_DIR || '', 'scripts', 'quark-drive.cjs');
        if (!process.env.QUARK_SKILL_DIR || !existsSync(source))
            throw new ServiceUnavailableException('QUARK_SKILL_DIR is missing or unsupported');
        // This CLI resolves its primary credentials relative to __dirname, not HOME.
        // Execute only a code copy inside each account profile, so its script-base,
        // cwd and home credential fallbacks can never read another account profile.
        const scripts = join(profile, 'cli', 'scripts');
        await mkdir(scripts, { recursive: true, mode: 0o700 });
        const target = join(scripts, 'quark-drive.cjs'), temporary = join(scripts, randomUUID() + '.cjs.tmp');
        try {
            await copyFile(source, temporary);
            await rename(temporary, target);
        }
        catch {
            await unlink(temporary).catch(() => undefined);
            throw new ServiceUnavailableException('Unable to prepare isolated Quark CLI code');
        }
        return cli(process.execPath, [target, ...args], profile, stdin, authorization, profile);
    }
    async authorize(id: string) {
        const a = await this.db.storageAccount.findUniqueOrThrow({ where: { id } });
        const out = await this.run(a, a.provider === 'baidu' ? ['login', '--accept-disclaimer', '--get-auth-url'] : ['login'], undefined, true);
        const url = authorizationUrl(out, a.provider);
        if (!url)
            return { ...await this.check(id), message: '已检查授权状态；就绪账号可直接用于分发任务。' };
        return { url, status: 'AUTHORIZING', message: 'Complete provider authorization, then submit its code.' };
    }
    async complete(id: string, code: string) {
        if (!code || code.length > 4096)
            throw new BadRequestException('Invalid authorization code');
        const a = await this.db.storageAccount.findUniqueOrThrow({ where: { id } });
        let value = code;
        try {
            value = new URL(code).searchParams.get('code') || code;
        }
        catch { }
        await this.run(a, a.provider === 'baidu' ? ['login', '--accept-disclaimer', '--set-code-stdin'] : ['login', '--token', value], a.provider === 'baidu' ? value : undefined);
        return this.check(id);
    }
    async check(id: string) {
        const a = await this.db.storageAccount.findUniqueOrThrow({ where: { id } });
        try {
            const out = await this.run(a, a.provider === 'baidu' ? ['whoami'] : ['get-user-info']);
            if (a.provider === 'baidu' && !out.includes('已登录'))
                throw Error();
            if (a.provider === 'quark') {
                const r = result(out);
                if (Number(r.code ?? -1) !== 0)
                    throw Error();
            }
            return this.accountView(await this.db.storageAccount.update({ where: { id }, data: { status: 'READY', lastError: null } }));
        }
        catch (error: any) {
            return this.accountView(await this.db.storageAccount.update({ where: { id }, data: { status: 'ERROR', lastError: error?.getStatus ? error.message : 'Account check failed; verify provider CLI and authorization' } }));
        }
    }
    async tick() {
        if (this.busy)
            return;
        this.busy = true;
        try {
            const task = await this.db.task.findFirst({ where: { status: 'PENDING' }, orderBy: { createdAt: 'asc' } });
            if (!task)
                return;
            const locked = await this.db.task.updateMany({ where: { id: task.id, status: 'PENDING' }, data: { status: 'RUNNING', attempts: { increment: 1 } } });
            if (!locked.count)
                return;
            const cp: any = task.checkpoints;
            try {
                const resource = await this.db.resource.findUniqueOrThrow({ where: { id: task.resourceId } });
                if (resource.sourcePath && resource.sourcePath !== join(storageRoot(), 'private', 'sources', `${resource.sourceHash}.pdf`))
                    throw Error('Invalid staged source path');
                if (!allSucceeded(cp) && (!resource.sourcePath || !existsSync(resource.sourcePath)))
                    throw new Error('Staged source unavailable');
                for (const provider of ['baidu', 'quark'] as const) {
                    if (cp[provider]?.status === 'SUCCEEDED')
                        continue;
                    const a = await this.db.storageAccount.findUniqueOrThrow({ where: { id: provider === 'baidu' ? task.baiduAccountId : task.quarkAccountId } });
                    if (a.provider !== provider || a.status !== 'READY')
                        throw new Error('Provider account is not ready');
                    cp[provider] ||= { status: 'PENDING' };
                    cp[provider].status = 'RUNNING';
                    // Persist upload receipt before attempting share so retries do not upload twice.
                    if (!cp[provider].receipt) {
                        if (provider === 'baidu') {
                            const remote = `/apps/bdpan/paperjoy/${resource.id}.pdf`;
                            await this.run(a, ['upload', resource.sourcePath!, remote]);
                            cp[provider].receipt = { remote };
                        }
                        else {
                            const r = result(await this.run(a, ['upload', resource.sourcePath!, '--session-input', 'paperjoy upload', '--session-id', task.id]));
                            if (Number(r.code ?? -1) !== 0 || !r.data?.fids?.length)
                                throw Error('Upload response unsupported');
                            cp[provider].receipt = { fids: r.data.fids };
                        }
                        await this.db.task.update({ where: { id: task.id }, data: { checkpoints: cp } });
                    }
                    const receipt = cp[provider].receipt;
                    const r = result(await this.run(a, provider === 'baidu' ? ['share', receipt.remote, '--period', '0', '--json'] : ['share', ...receipt.fids, '--title', resource.title, '--url-type', '1', '--expired-type', '1', '--session-input', 'paperjoy share', '--session-id', task.id]));
                    if (Number(r.code ?? (provider === 'quark' ? -1 : 0)) !== 0)
                        throw Error('Share response unsupported');
                    const d = r.data || r;
                    const url = d.share_url || d.url || d.link;
                    driveUrl(url, provider);
                    await this.db.driveLink.upsert({ where: { resourceId_provider: { resourceId: resource.id, provider } }, create: { resourceId: resource.id, provider, url, extractionCode: d.passcode || d.pwd || d.password || '', enabled: true }, update: { url, extractionCode: d.passcode || d.pwd || d.password || '', enabled: true } });
                    cp[provider] = { ...cp[provider], status: 'SUCCEEDED' };
                    await this.db.task.update({ where: { id: task.id }, data: { checkpoints: cp } });
                }
                if (allSucceeded(cp)) {
                    if (resource.sourcePath)
                        await unlink(resource.sourcePath).catch((e: any) => {
                            if (e.code !== 'ENOENT')
                                throw e;
                        });
                    await this.db.resource.update({ where: { id: resource.id }, data: { sourcePath: null, sourceBytes: 0 } });
                    await this.db.task.update({ where: { id: task.id }, data: { status: 'SUCCEEDED', activeResourceId: null, error: null } });
                }
            }
            catch {
                for (const provider of ['baidu', 'quark'])
                    if (cp[provider]?.status === 'RUNNING')
                        cp[provider].status = 'FAILED';
                await this.db.task.update({ where: { id: task.id }, data: { status: 'FAILED', activeResourceId: null, checkpoints: cp, error: 'Provider task failed; verify account, CLI configuration and staged PDF, then retry' } });
            }
        }
        finally {
            this.busy = false;
        }
    }
}
