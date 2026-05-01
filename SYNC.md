# SYNC.md

## 远程仓库

- `origin` = https://github.com/ooj324/ASTA.git (本仓库)
- `upstream` = https://github.com/iBUHub/ASTA.git (上游)

```bash
git remote add upstream https://github.com/iBUHub/ASTA.git  # 首次配置
```

## 同步规则

1. 只追踪 `main` 分支，不关注上游其他分支
2. 合并时忽略 `README*.md`、`CLAUDE.md`、`docs/`、`.github/`
3. 冲突时保留本地功能基底，采纳上游不冲突的增量改进
4. 本地核心功能如果未提及，在处理时候同步发现并更新本文档

## 本地核心功能

Auth 后端插件化：`AUTH_BACKEND` 环境变量切换 file/pg 存储，`src/auth/sources/` 目录，`pg` 依赖。

关联文件：`AuthSource.js`、`CreateAuth.js`、`ProxyServerSystem.js`、`StatusRoutes.js`、`ConfigLoader.js`、`.env.example`、`package.json`。

合并冲突时先保证上述功能完整，再合入上游对同文件的其他改进。

## 同步方法

```bash
git fetch upstream
git merge upstream/main --no-ff
```

冲突文件逐文件对比，保留双方有意义的变更。

## 同步记录

- 2026-04-30: 已同步至 upstream/main `545d33b` (v1.2.3)
