# v3.9.5 Vue compiler-30 空白页根因修复

## 根因及修复
指定申请证明图片组件在 HTML 内使用了 <credit-assigned-proof .../> 自闭合写法。页面通过 template.innerHTML 交给 Vue 编译之前，浏览器已按 HTML 规则解析标签：非 void 自定义元素不会自动闭合，导致后面的 img/v-else-if 和 div/v-else 嵌套关系改变，触发 compiler-30，整个页面挂载失败。

此前源码字符串编译与自定义渲染器测试没有经过浏览器 HTML 解析，因此未能发现这个问题。v3.9.4 对跳转的修复没有覆盖此根因。

本次将 detail.html、dashboard.html、admin.html 中全部证明图片组件改为显式成对闭合，并更新资源版本到 v3.9.5。保留此前的跳转和缓存修复。

## 实际浏览器验证
本地 Edge 无头浏览器对修复前 detail.html 经过真实 HTML 解析后编译，成功复现与日志完全一致的 https://vuejs.org/error-reference/#compiler-30。
修复后同一浏览器验证通过：16 页面真实 DOM 模板编译，以及待审核、已通过、需要修改、普通申请四种详情页真实 DOM 挂载。检查文字内容、证明图片节点及修改表单均存在。

新增 tests/build-browser-test.cjs 可重新生成 tests/browser-templates.html。可在 Edge/Chrome 直接打开该 HTML 查看 20 项检查结果。测试使用模拟数据及图片组件占位，未连接线上 Gitee；真实图片下载权限由 API/组件行为测试覆盖，线上环境仍需部署确认。

其余通过：Vue 编译、API 权限与状态、缓存、共用详情、跳转时序和 Vue 运行时回归测试。

## 部署
请完整部署本压缩包根目录内容到原 Cloudflare Pages 项目，保留原 Gitee 配置及数据，不需要迁移数据。
