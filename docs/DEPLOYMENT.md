# 部署与运维

## 拓扑

Node 22 + MySQL 8 + Nginx + PM2，沿用已有服务，不新增 Redis/Docker。

- 目标域名：`paper-joy.wdbzk.com`，后台 `/admin/`，接口 `/api/`，健康检查 `/health`。
- API：`127.0.0.1:4001`，单进程 `paper-joy-api`，堆上限 192 MiB，PM2 内存重启阈值 300 MiB。
- 根目录：`/www/wwwroot/paper-joy`；版本 `releases/<时间戳>-<提交号>`，`current` 软链接。
- 数据库：`paper_joy`；测试库 `paper_joy_test`，仅本机/SSH 隧道访问。
- 私有配置：`shared/.env`、`shared/backup.cnf`，权限 600；不提交 Git。
- 公开文件：`shared/storage/public/previews`；原件和账号：`shared/storage/private`。
- 网盘凭据按账号 ID 放 `private/profiles/<id>`；不读取、刷新或复用 Templio 登录文件。

现有 Templio 继续使用 4000 端口，部署只重载 PaperJoy PM2 进程。Nginx 每次修改先 `nginx -t`，再平滑重载。

## 发布

在本机/CI 用 Node 22 执行 `npm ci`、类型检查、测试和构建。版本包包含根 package/lock、各 workspace package、API dist/prisma/scripts、后台 dist 和 deploy；不包含 `.env`、node_modules、源码 PDF、账号或备份。

执行 `node scripts/package-release.mjs` 生成不含密钥的发行包。上传解包至新 `releases/<时间戳>-<提交号>` 后运行：

```sh
bash /www/wwwroot/paper-joy/releases/<版本>/deploy/activate.sh <版本>
```

脚本只安装锁定的生产依赖、生成 Prisma 客户端、先备份、再迁移和 seed；最后切换 `current` 并检查数据库健康。PM2 启动失败或健康失败回退应用软链接。数据库迁移为前向迁移，应用回退不等于数据库回退。新版本必须兼容已应用的数据库结构。

Node 和 sharp/Prisma 必须在目标 Linux 上完成安装/生成验证，不能上传 Windows 的 node_modules。生产不编译前端或 TypeScript。

## 证书与 Nginx

模板在 `deploy/nginx.conf`，站点在 `/www/server/panel/vhost/nginx/paper-joy.wdbzk.com.conf`。证书目标目录 `shared/cert/`，ACME webroot 为 `shared/acme/`；续期后先校验配置再 reload。2026-11-06 外部 HTTP 被阿里云备案页面拦截，证书尚未签发，不使用 Templio 证书替代。独立站点公网暂未上线。

临时体验站点只监听 `127.0.0.1:8081`，模板 `deploy/nginx-preview.conf`；使用 `ssh -N -L 18081:127.0.0.1:8081 root@47.111.99.7`，然后访问 `http://127.0.0.1:18081/admin/`。账号见本地私有访问说明。只允许预览图读取；原件、配置文件和备份不可访问，管理 API 必须 JWT。单 PDF 80 MiB、源文件总配额 1 GiB，超限拒绝，不删除未完成任务。

## 备份与恢复

```sh
bash /www/wwwroot/paper-joy/current/deploy/backup.sh
```

备份 `shared/backups/paper_joy-*.sql.gz`，每天执行，保留14天；日志轮转模板 `deploy/logrotate.conf`。SQL 备份包含账号相关业务记录，必须私有保存。应定期将数据库、`shared/storage` 和私有配置加密备份到独立位置；当前同机备份不能防整机损坏。云盘成功后删除的 PDF 仍可由本地输出重建。

恢复演练必须新建独立临时数据库，恢复后比较表/资源数量，清理时验证精确数据库名称。不清空生产库、不用测试库覆盖生产。正式恢复前停止 PaperJoy 写入并另存现场备份；数据库恢复后再切换兼容版本。

## 检查

```sh
curl -f http://127.0.0.1:4001/health
pm2 status paper-joy-api
pm2 logs paper-joy-api --lines 30 --nostream
nginx -t
# 解除备案拦截并完成证书后
curl -f https://paper-joy.wdbzk.com/health
```

同时核对 Templio 健康、证书域名/到期时间、后台静态资源、预览、原件不可访问、未授权管理接口 401。没有真实分享链接时公开资源列表为空属于预期，不通过造链接填充。
