# ASTA

将 Google AI Studio 网页端封装为兼容 OpenAI、Gemini、Anthropic API 的代理服务。

## 快速开始

```bash
git clone 
cd ASTA
npm run setup-auth   # 浏览器自动登录，保存认证凭据
cp .env.example .env # 按需修改配置
npm start            # 启动服务，默认 http://localhost:7860
```

部署后访问 `http://your-server:7860` 通过 VNC 添加账号，或上传本地 auth 文件。

## API 端点

| 格式 | Base URL | 主要端点 |
|------|----------|---------|
| OpenAI 兼容 | `/v1` | `GET /v1/models`, `POST /v1/chat/completions`, `POST /v1/responses` |
| Gemini 原生 | `/v1beta` | `POST /v1beta/models/{model}:generateContent`, `streamGenerateContent` |
| Anthropic 兼容 | `/v1` | `POST /v1/messages`, `POST /v1/messages/count_tokens` |

支持流式/非流式、工具调用、生图、TTS、嵌入向量。

## 主要环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `API_KEYS` | API 密钥，逗号分隔 | `123456` |
| `PORT` | 服务端口 | `7860` |
| `MAX_CONTEXTS` | 最大同时登录账号数 | `1` |
| `SWITCH_ON_USES` | 多少请求后自动切号 | `40` |
| `STREAMING_MODE` | 流式模式 `real` / `fake` | `real` |
| `SAFETY_SETTINGS_THRESHOLD` | 安全过滤等级 | `OFF` |
| `HTTP_PROXY` / `HTTPS_PROXY` | 代理地址 | 无 |

完整配置见 `.env.example`。

## 许可证

基于 [ais2api](https://github.com/Ellinav/ais2api) 分支开发，沿用 CC BY-NC 4.0 许可证。详见 [LICENSE](LICENSE)。
