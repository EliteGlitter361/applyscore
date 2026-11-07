# v3.9.46 Cloudflare Pages 调整

- 仅公开图标和 vendor 资源走 Pages 静态路由，跳过 Functions；API 及其他路径继续经过原中间件。
- 保留静态资源缓存和安全头。经 Functions 返回的资源失败响应不会误用长期缓存。
- Gitee JSON 读取使用统一的8秒请求期限，包含缺失文件时的仓库与分支核查。
- 与上一版逐字节对比，HTML、CSS 和前端 assets 一致。站点内版本标记沿用上一版。
- 缓存和账户接口回归通过，尚未部署或实测线上延迟。
