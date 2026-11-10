# v3.6.9 样式残留专项清理

## 已清除的残留
- 主页公告关键首屏 CSS 重复注入（两份相同 `style` 合并为一份）。
- 早期 `.container/.navbar/.login-card/.login-prompt/.app-header` 的 `contentEnter` 入场动画，避免与当前整页动画重复叠加。
- 旧版 `.page-view > :first-child` 的 `creditStageReveal` 动画及对应无效关键帧，避免与 `creditPageEnter` 多重淡入。
- 清理相应的 reduced-motion 旧选择器，同时保留当前 reduced-motion 实现。

## 保留并核查
- 原版「正在打开页面…」居中图标、流动进度条和加载状态；不替换布局。
- 首页公告预加载及音乐盒 iframe 隐藏策略。
- v3.6.5 路由离场、进场动画；v3.6.4 消息卡片悬停阴影隔离。
- 深浅色、PC/手机端规则及原有业务页面 CSS。

此次采用保守去重策略，不删除可能由 JS 动态切换的 class，也不批量移除 `!important`；
这类规则如未经运行时覆盖检查就移除，可能导致深浅色、公告或音乐盒回归。
