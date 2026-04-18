# Exclude Dirs Design

## Goal

为 `fzfetch` 增加通过环境变量排除指定目录的能力，被排除目录及其所有子目录下的文件都不进入索引。

## Scope

- 新增环境变量 `FZFETCH_EXCLUDE_DIRS`
- 支持配置多个目录
- 配置项以 `FZFETCH_ROOT` 为基准解析
- 只影响扫描建索引，不改变下载接口和其他路径安全逻辑

## Configuration

`FZFETCH_EXCLUDE_DIRS` 使用逗号分隔多个目录，例如：

```bash
FZFETCH_EXCLUDE_DIRS=tmp,cache/private,archive
```

约束：

- 每一项都按相对 `FZFETCH_ROOT` 的目录路径处理
- 允许带前后空白，解析时会去掉
- 空项会被忽略
- 不要求目录在启动时必须存在
- 不支持根目录外的绝对路径配置

## Architecture

在 `AppConfig` 中新增两层信息：

- 原始相对目录列表，用于表达配置输入
- 规范化后的绝对目录列表，用于扫描阶段快速判断是否跳过目录树

启动时在根目录完成 canonicalize 后，把排除目录解析到 `canonical_root_dir` 下。如果某个排除项试图越出根目录，则忽略该项。

扫描阶段继续使用 `walkdir` 递归遍历，但在遇到目录项时，若该目录本身位于排除集合中，则调用 `skip_current_dir()` 直接跳过整个子树。这样不会继续遍历该目录下的任何文件或子目录。

## Data Flow

1. `from_env()` 读取 `FZFETCH_EXCLUDE_DIRS`
2. `AppConfig` 规范化根目录后，构建可用于扫描的排除目录绝对路径集合
3. `state` 在后台刷新时把排除目录集合传给 `scan_root_files`
4. `scanner` 跳过命中的目录树，只返回未排除目录中的文件记录

## Error Handling

- `FZFETCH_EXCLUDE_DIRS` 为空或只包含空白时，行为等同未配置
- 不存在的目录不会报错；如果将来目录出现，会自动被跳过
- 越出根目录的相对路径会被忽略，避免破坏扫描边界
- 读取文件元信息或遍历目录时，仍保持当前“出错即跳过并继续”的策略

## Testing

需要覆盖：

- 环境变量解析支持逗号分隔、多项、空格和空项过滤
- 排除目录会连同子目录一起被跳过
- 多个排除目录同时生效
- 未排除的兄弟目录和顶层文件仍会被收录
- 越出根目录的排除项不会影响根目录内正常扫描
