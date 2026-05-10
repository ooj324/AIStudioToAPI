# SYNC.md

## 远程仓库

- `origin` = https://github.com/ooj324/AIStudioToAPI.git (本仓库)
- `upstream` = https://github.com/iBUHub/AIStudioToAPI.git (上游)

```bash
git remote add upstream https://github.com/iBUHub/AIStudioToAPI.git  # 首次配置
```

## 同步规则

1. 只追踪 `main` 分支，不关注上游其他分支
2. 合并时忽略 `README*.md`、`CLAUDE.md`、`docs/`、`.github/`
3. 冲突时保留本地功能基底，采纳上游不冲突的增量改进
4. 本地核心功能如果未提及，在处理时候同步发现并更新本文档

## 本地核心功能

Auth 后端插件化：`AUTH_BACKEND` 环境变量切换 file/pg 存储，`src/auth/sources/` 目录，`pg` 依赖。

Resin 粘性代理池：`RESIN_URL`、`RESIN_PLATFORM_NAME` 环境变量，`src/utils/ResinClient.js`，登录/VNC/浏览器上下文按账号绑定代理身份。

ASTA 本地仓库身份与发布脚本：保留 `package.json` 中 `name=asta`、`author=xjc`、`pg` 依赖，以及 `scripts/release.sh`。

关联文件：`AuthSource.js`、`CreateAuth.js`、`ProxyServerSystem.js`、`StatusRoutes.js`、`ConfigLoader.js`、`BrowserManager.js`、`saveAuth.js`、`setupAuth.js`、`ResinClient.js`、`.env.example`、`package.json`、`scripts/release.sh`。

合并冲突时先保证上述功能完整，再合入上游对同文件的其他改进。

## 同步方法

```bash
git fetch upstream
git merge upstream/main --no-ff
```

冲突文件逐文件对比，保留双方有意义的变更。

## 同步记录

- 2026-05-10: 已同步至 upstream/main `459df7a` (v1.2.4)，以上游 `545d33b` 为人工三方合并基线；保留本地 Auth backend、Resin、ASTA 发布脚本与忽略范围。
- 2026-04-30: 已同步至 upstream/main `545d33b` (v1.2.3)
