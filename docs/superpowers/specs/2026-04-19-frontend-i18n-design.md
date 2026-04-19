# Frontend I18n Design

## Goal

为 `fzfetch` 前端增加双语界面能力，首批支持 `zh-CN` 和 `en`，默认跟随浏览器语言，并允许用户手动切换覆盖自动选择结果。

## Scope

- 只改前端展示层，不改后端接口和 websocket 协议值
- 首批支持 `zh-CN` 和 `en`
- 新增浏览器语言识别、本地持久化和显式语言切换入口
- 抽离现有界面文案、状态文案和下载 toast 文案
- 更新前端测试，覆盖语言选择和关键文案渲染

## Non-Goals

- 不引入多语言路由或按语言拆分 URL
- 不改后端返回数据结构
- 不处理复杂国际化能力，例如复数规则、日期格式化、数字本地化
- 本次不支持两种语言之外的区域化变体

## Language Resolution

语言解析优先级固定为：

1. 用户手动选择并保存到 `localStorage` 的语言
2. 浏览器语言 `navigator.language`
3. 默认回退 `zh-CN`

规则：

- 浏览器语言以 `zh` 开头时落到 `zh-CN`
- 其他语言统一落到 `en`
- 用户手动切换后立即生效，并覆盖后续自动检测结果

## Architecture

前端新增一个轻量自研 i18n 层，不引入第三方国际化库。

建议文件结构：

- `frontend/src/i18n/messages.ts`
- `frontend/src/i18n/types.ts`
- `frontend/src/i18n/I18nProvider.tsx`
- `frontend/src/i18n/useI18n.ts`

职责划分：

- `messages.ts` 保存两套词典
- `types.ts` 约束 `Locale`、词典结构和翻译 key
- `I18nProvider.tsx` 负责初始语言解析、状态管理、持久化和上下文注入
- `useI18n.ts` 暴露 `locale`、`setLocale` 和 `t`

在 `frontend/src/main.tsx` 中由 `I18nProvider` 包裹 `App`，使所有组件通过上下文取文案，不再直接硬编码用户可见字符串。

## Message Organization

词典使用带前缀的扁平 key，避免早期就引入过深的嵌套结构。

示例 key：

- `search.placeholder`
- `empty.waiting`
- `empty.searching`
- `empty.noMatches`
- `status.connecting`
- `status.disconnected`
- `status.indexReady`
- `work.idle`
- `work.searching`
- `work.scanning`
- `hint.selectItem`
- `hint.download`
- `hint.clear`
- `toast.downloadStarted`
- `toast.downloadFailed`
- `toast.fileGone`

少量动态文案使用简单参数插值，例如：

- `toast.downloadStarted` 接收文件名

## UI Changes

语言切换入口放在右上角状态区附近，保持轻量，不抢占搜索输入框的视觉焦点。

交互要求：

- 显示为显式的 `ZH / EN` 切换控件
- 当前语言有明显高亮
- 切换后页面文案即时更新，无需刷新
- 切换行为写入 `localStorage`

本次需要完成国际化改造的前端区域：

- `App.tsx` 中的搜索框 placeholder、空态文案、底部快捷键提示
- `StatusIndicator.tsx` 中的连接状态、索引状态和工作状态标签
- `useDownload.ts` 中的下载开始、下载失败、文件已不存在等 toast 文案

## Testing

测试需要覆盖以下行为：

- 浏览器语言为中文时默认使用 `zh-CN`
- 浏览器语言为非中文时默认使用 `en`
- `localStorage` 中已保存语言时优先使用保存值
- 手动切换语言后，关键界面文案即时更新
- `App` 中空态、快捷键提示在两种语言下都正确渲染
- `StatusIndicator` 在两种语言下都显示正确标签
- `useDownload` 的 toast 文案在两种语言下都正确生成

测试策略：

- 保留当前 Vitest 和 Testing Library 结构
- 为测试增加受控语言上下文，避免继续把单一中文或英文文案硬编码到所有断言中
- 涉及浏览器语言和 `localStorage` 的测试通过 mock `navigator.language` 与存储层完成

## Implementation Notes

- `t` 可以先支持最小能力集：按 key 取值和简单模板变量替换
- 后端协议中的状态值继续保持当前英文枚举，不做任何变更
- 组件内部的判断逻辑继续基于现有状态枚举，国际化只负责把这些状态映射为显示文案

## Risks

- 若测试仍直接依赖具体自然语言字符串，后续新增语言会继续产生脆弱断言
- 若词典 key 命名不稳定，后续维护会再次把文案散回组件
- 若语言切换控件侵入状态区过重，可能破坏现有终端风格界面的视觉平衡
