# Page Title I18n Design

## Goal

让浏览器页面标题跟随当前前端语言切换，在 `zh-CN` 和 `en` 之间即时更新。

## Scope

- 只改前端页面标题逻辑
- 使用现有 i18n 层，不新增第三方依赖
- 首批支持两种标题文案：
  - `zh-CN`: `Fzfetch - 本地文件极速模糊搜索`
  - `en`: `Fzfetch - Ultra High Performance Search`

## Architecture

- 在现有词典中新增页面标题 key，例如 `page.title`
- 在前端运行时根据当前 `locale` 同步设置 `document.title`
- `frontend/index.html` 中保留一个静态默认标题，运行后由 React 侧覆盖

## Behavior

- 初次进入页面时，标题按当前解析出的语言显示
- 用户手动切换 `ZH / EN` 后，标题立即更新
- 标题更新只依赖当前 `locale`，不耦合搜索状态或其他界面状态

## Testing

需要覆盖：

- `en` 语言下标题为 `Fzfetch - Ultra High Performance Search`
- `zh-CN` 语言下标题为 `Fzfetch - 本地文件极速模糊搜索`
- 语言切换后 `document.title` 跟随更新
