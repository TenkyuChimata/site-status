English | [简体中文](./README.zh-CN.md)

<div align="center">
  <h1>site-status</h1>
  <p>A multilingual UptimeRobot status page built with Nuxt 4.</p>
  <p>
    <img src="https://img.shields.io/github/last-commit/TenkyuChimata/site-status" alt="last commit" />
    <img src="https://img.shields.io/github/languages/code-size/TenkyuChimata/site-status" alt="code size" />
    <img src="https://img.shields.io/github/stars/TenkyuChimata/site-status?style=flat" alt="GitHub stars" />
    <img src="https://img.shields.io/github/forks/TenkyuChimata/site-status?style=flat&color=orange" alt="GitHub forks" />
  </p>
</div>

## Demo

- [Wolfx Status](https://status.wolfx.jp/)

## Features

- Current status, incident history, and uptime summaries from UptimeRobot
- Configurable history window, including the production site's 90-day view
- Automatic five-minute client refresh
- Simplified Chinese, English, Japanese, and Korean interfaces
- Browser-language selection on first visit and a persistent preference after manual selection
- Light and dark themes, responsive layout, and PWA support
- Optional password protection
- Split UptimeRobot requests, stale-while-revalidate caching, request coalescing, and a shared last-known-good snapshot on Cloudflare KV

## Requirements

- A recent Node.js release and [pnpm](https://pnpm.io/)
- UptimeRobot monitors and a **Read-Only API Key** from [API Management](https://dashboard.uptimerobot.com/integrations)

Do not use the UptimeRobot Main API Key. A monitor-specific key can be used when only one monitor should be exposed.

## Local development

```bash
pnpm install
cp .env.example .env
pnpm dev
```

Set at least `API_KEY` in `.env`. Local development works without `STATUS_CACHE`; in that case the server uses only its in-memory cache.

## Configuration

| Variable              |         Required          | Description                                                                                       |
| --------------------- | :-----------------------: | ------------------------------------------------------------------------------------------------- |
| `API_URL`             |            No             | UptimeRobot API base URL; defaults to the official v2 endpoint.                                   |
| `API_KEY`             |            Yes            | UptimeRobot Read-Only or monitor-specific API key.                                                |
| `DEPLOYMENT_PLATFORM` |            No             | `cloudflare` (default) selects the Pages preset; use `auto` to let Nitro detect another platform. |
| `SITE_TITLE`          |            No             | Page title.                                                                                       |
| `SITE_DESCRIPTION`    |            No             | Page description.                                                                                 |
| `SITE_KEYWORDS`       |            No             | Page keywords.                                                                                    |
| `SITE_LOGO`           |            No             | Logo path or URL.                                                                                 |
| `SITE_ICP`            |            No             | Optional ICP filing number.                                                                       |
| `COUNT_DAYS`          |            No             | Number of history days requested and displayed; 30–90 is recommended and 90 is supported.         |
| `SHOW_LINK`           |            No             | Set to `false` to hide monitor links.                                                             |
| `SITE_PASSWORD`       |            No             | Enables password protection when set.                                                             |
| `SITE_SECRET_KEY`     | Recommended with password | Secret used to sign and verify login tokens.                                                      |

See [.env.example](./.env.example) for a ready-to-copy template.

## Language behavior

The supported locales are `zh-CN`, `en`, `ja-JP`, and `ko-KR`. An explicit locale-prefixed URL takes priority. Otherwise, the first visit follows the first supported entry in the browser's preferred-language list, falling back to Japanese. Browser detection is not stored. A language selected from the navigation menu is stored as an explicit preference and remains active until the site's browser data is cleared or another language is selected.

## Deployment

### Cloudflare Pages

The default build targets Cloudflare Pages.

1. Fork the repository and create a Pages project connected to it.
2. Use `pnpm build` as the build command and `dist` as the output directory.
3. Add the environment variables above to both Production and Preview as appropriate.
4. Create a Workers KV namespace and add a Pages KV binding named `STATUS_CACHE` to Production and Preview.
5. Redeploy after adding or changing the binding.

[wrangler.jsonc.example](./wrangler.jsonc.example) shows the equivalent Pages output and KV binding configuration without a real namespace ID. The shared cache stores only formatted public status data, never the API key or raw UptimeRobot response. Fresh data is served for 10 minutes; the last-known-good snapshot can be retained for up to 24 hours for stale fallback.

### Vercel and other Nitro platforms

Set `DEPLOYMENT_PLATFORM=auto` so Nitro can select the deployment preset, then configure the same environment variables. Validate the generated output and runtime on the target platform. Without a compatible `STATUS_CACHE` binding, the application still works but has only per-instance in-memory caching and no shared last-known-good snapshot.

For platform-specific configuration, see the [Nuxt deployment documentation](https://nuxt.com/deploy).

## Password protection

Set `SITE_PASSWORD` and a strong, private `SITE_SECRET_KEY` together in production. The code has a development fallback for the signing secret, but it must not be relied on for a protected deployment. If `SITE_PASSWORD` is empty, the status page remains public.

## Acknowledgements

- [imsyy/site-status](https://github.com/imsyy/site-status), the upstream project
- [uptime-status](https://github.com/yb/uptime-status), an earlier inspiration
