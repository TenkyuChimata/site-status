简体中文 | [English](./README.md)

<div align="center">
  <h1>site-status</h1>
  <p>使用 Nuxt 4 构建的多语言 UptimeRobot 状态页。</p>
  <p>
    <img src="https://img.shields.io/github/last-commit/TenkyuChimata/site-status" alt="最后提交" />
    <img src="https://img.shields.io/github/languages/code-size/TenkyuChimata/site-status" alt="代码大小" />
    <img src="https://img.shields.io/github/stars/TenkyuChimata/site-status?style=flat" alt="GitHub stars" />
    <img src="https://img.shields.io/github/forks/TenkyuChimata/site-status?style=flat&color=orange" alt="GitHub forks" />
  </p>
</div>

## 演示

- [Wolfx 状态页](https://status.wolfx.jp/)

## 功能

- 展示 UptimeRobot 的当前状态、故障历史和可用率汇总
- 可配置历史时间范围，包括生产站点使用的 90 天视图
- 客户端每五分钟自动刷新
- 简体中文、英语、日语和韩语界面
- 首次访问跟随浏览器语言，手动选择后永久尊重用户偏好
- 明暗主题、响应式布局和 PWA 支持
- 可选的密码保护
- 拆分 UptimeRobot 请求、stale-while-revalidate 缓存、请求合并，以及 Cloudflare KV 共享的 last-known-good 快照

## 环境要求

- 较新的 Node.js 版本和 [pnpm](https://pnpm.io/)
- 已配置 UptimeRobot 监控，并从 [API 管理](https://dashboard.uptimerobot.com/integrations) 获取 **Read-Only API Key**

不要使用 UptimeRobot Main API Key。若只希望公开单个监控，也可以使用 monitor-specific key。

## 本地开发

```bash
pnpm install
cp .env.example .env
pnpm dev
```

请至少在 `.env` 中设置 `API_KEY`。本地开发不要求配置 `STATUS_CACHE`；缺少该 binding 时，服务端只使用内存缓存。

## 配置

| 变量                  |        必需        | 说明                                                                           |
| --------------------- | :----------------: | ------------------------------------------------------------------------------ |
| `API_URL`             |         否         | UptimeRobot API 基础地址；默认使用官方 v2 endpoint。                           |
| `API_KEY`             |         是         | UptimeRobot Read-Only 或 monitor-specific API key。                            |
| `DEPLOYMENT_PLATFORM` |         否         | `cloudflare`（默认）选择 Pages preset；其他平台使用 `auto` 让 Nitro 自动判断。 |
| `SITE_TITLE`          |         否         | 页面标题。                                                                     |
| `SITE_DESCRIPTION`    |         否         | 页面描述。                                                                     |
| `SITE_KEYWORDS`       |         否         | 页面关键词。                                                                   |
| `SITE_LOGO`           |         否         | Logo 路径或 URL。                                                              |
| `SITE_ICP`            |         否         | 可选的 ICP 备案号。                                                            |
| `COUNT_DAYS`          |         否         | 请求并展示的历史天数；建议 30–90，支持 90 天。                                 |
| `SHOW_LINK`           |         否         | 设置为 `false` 时隐藏监控链接。                                                |
| `SITE_PASSWORD`       |         否         | 设置后启用密码保护。                                                           |
| `SITE_SECRET_KEY`     | 使用密码时建议设置 | 用于签发和验证登录令牌的密钥。                                                 |

可直接复制的模板见 [.env.example](./.env.example)。

## 语言行为

支持 `zh-CN`、`en`、`ja-JP` 和 `ko-KR`。显式带语言前缀的 URL 优先；否则首次访问按浏览器首选语言列表中第一个受支持的语言选择，无法匹配时回退到日语。浏览器自动检测结果不会被保存。从导航菜单手动选择语言后，系统会将其保存为明确偏好，直到用户清除本站浏览器数据或再次选择其他语言。

## 部署

### Cloudflare Pages

项目默认构建目标是 Cloudflare Pages。

1. Fork 本仓库，并创建与仓库连接的 Pages 项目。
2. 构建命令使用 `pnpm build`，输出目录使用 `dist`。
3. 按需在 Production 和 Preview 中配置上述环境变量。
4. 创建 Workers KV namespace，并在 Production 和 Preview 中添加名为 `STATUS_CACHE` 的 Pages KV binding。
5. 添加或修改 binding 后重新部署。

[wrangler.jsonc.example](./wrangler.jsonc.example) 给出了不含真实 namespace ID 的 Pages 输出和 KV binding 配置示例。共享缓存只保存格式化后的公开状态数据，不保存 API key 或 UptimeRobot 原始响应。新鲜数据缓存 10 分钟；last-known-good 快照最长可保留 24 小时，以便在上游异常时返回旧数据。

### Vercel 与其他 Nitro 平台

设置 `DEPLOYMENT_PLATFORM=auto`，让 Nitro 选择部署 preset，然后配置相同的环境变量。请在目标平台验证生成产物和运行时。缺少兼容的 `STATUS_CACHE` binding 时应用仍可运行，但只有实例内内存缓存，也没有共享的 last-known-good 快照。

平台专用配置请参阅 [Nuxt 部署文档](https://nuxt.com/deploy)。

## 密码保护

生产环境中请同时设置 `SITE_PASSWORD` 和一个足够强、保持私密的 `SITE_SECRET_KEY`。代码为签名密钥保留了开发 fallback，但受保护的部署不应依赖它。`SITE_PASSWORD` 为空时，状态页保持公开。

## 鸣谢

- [imsyy/site-status](https://github.com/imsyy/site-status)，本项目的上游
- [uptime-status](https://github.com/yb/uptime-status)，早期灵感来源
