# Skill Atlas · 智能应用雷达

自托管的 AI 资源发现站：Agent Skills、DSH 候选插件、Hugging Face 模型 / Spaces 热榜与开源 AI 应用。中文界面、搜索 / 分类 / 收藏、维护活跃度、真实浏览器在线心跳、站点探测与数据来源说明。

## 本地运行

Node.js 22.21+，无第三方运行依赖。

```powershell
npm run collect
npm start
```

访问 http://127.0.0.1:3210 。可通过环境变量设置 `PORT`、`HOST`、`DATA_DIR`、`REFRESH_HOURS`、`GITHUB_TOKEN`。`.env.example` 仅为参考，本地请用 `node --env-file=.env server.mjs` 加载。无 token 也能采集，但受到 GitHub 公共 API 限流。token 仅用于服务端，不发送到浏览器。数据保存在忽略版本控制的 `data/`。

```powershell
npm run check
npm test
```

## 数据口径

- 每 6 小时从 GitHub REST API 的主题 / 关键词搜索滚动分页采集，每轮向后推进（每查询至多 1,000 项后循环），保留发现记录和失败来源的上次数据。搜索候选仓库**不是 GitHub 全量技能索引**，也不代表通过插件规范或安全验证。轮转意味着各条目更新时间可能不同。
- 解析 anthropics/skills、openai/skills、huggingface/skills 的公开目录树，单独收录含 SKILL.md 的技能。清单发现仅验证路径存在，不执行代码；Stars 属于整个仓库。
- HF 模型和 Spaces 各取 trendingScore 排名前 80 项；显示模型月下载、Space 点赞。不同平台的指标不混合相加。“全部发现”按分类最大热度归一化探索，非质量排名。
- GitHub 最近 30 天提交定义为活跃。每日保存一份指标，最多 30 天；两天后出现真实历史趋势。不伪造增长曲线。
- DSH 分类通过 deepseek-harness / dsh-plugin 关键词生成，标注候选。应用分类包含公开 AI agent 主题仓库及精选产品，不推断营收、实际用户量或商业成功。
- 每 5 分钟从服务器 HEAD 探测固定白名单。HTTP 非 2xx 为访问受限，超时为未连通，不能直接解释为全球宕机。保留最多 288 次探测。
- 可见页面每 30 秒心跳，90 秒窗口统计本站匿名浏览器在线数。同一浏览器共享 localStorage 标识，多标签页去重；访客统计按 UTC 自然日去重。哈希去重记录保留 30 天，统计每 15 秒和退出时落盘。重启后在线数重新积累。不统计第三方应用在线人数。
- 收藏仅保存在当前浏览器；无需登录。IP 仅用于内存限流与计算带随机浏览器 ID 的哈希，不写入应用数据；Nginx 默认访问日志可能独立记录 IP，生产环境可按需要关闭或配置保留。

## Ubuntu 部署

使用独立 `skill-atlas` 用户、systemd 自动启动和 Nginx 反向代理，不开放 Node 内网端口。仓库包含 `deploy/skill-atlas.service`、`deploy/nginx.conf` 配置。将工程放到 `/opt/skill-atlas`，保证 `data/` 对服务用户可写，代码归 root 所有。启动前将一次成功采集的 `data/catalog.json` 作为初始快照。可选环境配置放 `/etc/skill-atlas.env`，权限 `0600`，不要提交 token。

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now skill-atlas
sudo nginx -t
sudo systemctl reload nginx
curl http://127.0.0.1:3210/api/health
```

部署前检查配置文件名、3210 端口和服务名是否冲突。维护时先 `npm run check && npm test`，上传新代码后 `systemctl restart skill-atlas`，验证 API 后再切换 Nginx；回退时恢复前一版代码并重启服务，保留 `data/`。

有域名后配置 DNS、HTTPS 证书并修改 server_name。当前支持 IP 的 HTTP 访问；正式域名与证书需要 DNS 控制权。浏览器支持普通 HTTP 的随机标识降级。

## 设计

借鉴 deepseek1024.com 的目录、来源指标和活跃度观察思路；界面与代码为独立实现。参考接口：[GitHub Search](https://docs.github.com/en/rest/search/search)、[Hugging Face Hub API](https://huggingface.co/docs/hub/api)。
