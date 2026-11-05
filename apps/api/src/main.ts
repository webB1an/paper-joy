import 'reflect-metadata';
import { config } from 'dotenv';
import { resolve } from 'node:path';
config({ path: process.env.ENV_FILE || resolve(__dirname, '../../../.env') });
import { configureProxy } from './http';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import express from 'express';
import { Api } from './api';
import { Database, Storage, storageRoot } from './storage';
import { signToken } from './security';
import { multipartUploads, prepareIncoming } from './upload';
@Module({ controllers: [Api], providers: [Database, Storage] })
class App {
}
async function main() {
    signToken('configuration-check', 'admin');
    signToken('configuration-check', 'user');
    if (process.env.NODE_ENV === 'production' && process.env.DEV_WECHAT_MOCK === 'true')
        throw Error('Development mock must be disabled in production');
    await prepareIncoming();
    const app = await NestFactory.create(App, { bodyParser: false });
    configureProxy(app.getHttpAdapter().getInstance());
    app.use(express.json({ limit: '256kb' }));
    app.use('/assets', express.static(resolve(storageRoot(), 'public'), { dotfiles: 'deny', index: false, fallthrough: false, maxAge: '1d' }));
    app.use(multipartUploads());
    app.enableShutdownHooks();
    await app.listen(Number(process.env.PORT || 4001), process.env.HOST || '127.0.0.1');
    if (process.send) process.send({ type: 'ready', port: app.getHttpServer().address().port });
}
main().catch(error => { console.error('API startup failed:', error.message); process.exitCode = 1; });
