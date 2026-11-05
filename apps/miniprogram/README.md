# PaperJoy 微信小程序

原生 TypeScript + WXML/WXSS。根目录安装依赖后执行 `npm run typecheck --workspace @paperjoy/miniprogram`、`npm run test --workspace @paperjoy/miniprogram`、`npm run build --workspace @paperjoy/miniprogram`。构建只生成 `apps/miniprogram/dist`，不会在源码旁混入 JS。

根微信工程配置：`appid: wx28e18cf4675ffa9a`，`miniprogramRoot: apps/miniprogram/dist/`，`compileType: miniprogram`。导入仓库根目录；在微信后台配置 HTTPS request/downloadFile 合法域名 `paper-joy.wdbzk.com`，以及实际预览图片域名。生产 API 位于 `src/lib/config.ts`。广告与登录能力由服务端 `/config` 控制，不需要在客户端设置 AppSecret。

`DEMO_ENABLED` 默认 false，且只有 develop 环境允许模拟 GET 资源；`demo.ts` 默认为空，不包含任何伪造网盘链接。需要预览真实内容时先通过管理端发布有真实图片和有效链接的资源。

匿名收藏保存在本机；主动微信登录后按资源 ID 合并云端收藏并上传本机收藏。登录后展示账号领取记录，网络失败回退本机记录。退出只移除 JWT。广告只在关闭回调明确 `isEnded: true` 时提交完成；监听器在成功、取消和错误时移除。会话与 claim requestId 在本次领取页生命周期中保持稳定用于重试。

真机验收仍需配置服务器、微信 AppID 权限、合法域名和激励视频单元，检查真实视频完成/取消、登录同步、图片预览与安全区。微信隐私后台声明应与实际上线服务和隐私说明一致。
