# v3.7.0 去除重复页面过渡

- 外层音乐盒壳和内层 iframe 不再各自显示“正在打开页面…”。
- iframe 仅在 Vue 发送 `credit-embedded-ready`（首页公告则 `credit-announcement-ready`）后显示。
- 普通页面仅保留独立路由加载页；去掉已由其替代的 first-paint 加载页。
- 16 秒异常兜底，减少卡死风险；保留 v3.6.9 视觉、动画和主题。
