# v3.7.2 修复侧边栏随页面滚动消失

## 问题原因
v3.6.5 起整页过渡动画把 `transform: translateY(...)` 应用在 `.app-frame` 上。CSS transform 会为后代 `position: fixed` 元素建立新的包含块，导致原本固定在视口左侧的 `.app-sidebar` 实际相对长页面定位，页面向下滚动后侧边栏也随之移出视口。音乐盒等固定定位后代也可能受影响。

## 修复
- 保留页面淡入/淡出过渡，但改为 opacity-only，不再对 `.app-frame` 使用 transform 或 `will-change: transform`。
- 保持侧边栏 `position: fixed`、顶部栏 sticky、音乐盒悬浮球等原定位机制。
- 更新所有页面的 core.css、app.js、route-guard.js 缓存版本，防止 immutable 缓存继续使用旧 CSS。
- 保留原版“正在打开页面…”过渡页、单次加载逻辑、主题和业务功能。

## 验证
- 浏览器中滚动长页面，侧边栏 top/bottom 固定在视口。
- 页面进入/离开动画仍正常触发。
- PC 与移动端布局回归。
