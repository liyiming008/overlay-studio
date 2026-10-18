# 项目协作说明

## 项目目标
- Overlay Studio 是口播视频动效编辑台：导入 SRT / overlay JSON、编辑卡片、预览并导出透明视频层。
- 只维护应用功能、动效模板、素材配置和必要的开发 / 使用文档。
- 不添加作者介绍、社交二维码、推广入口、版本营销或授权弹窗等无关内容。

## 目录
- `motion-playground/`：React 19 + TypeScript + Vite 应用；所有 npm 命令在此执行。
- `src/App.tsx`、`src/components/`：编辑台状态、画布、时间轴、参数面板和顶栏。
- `src/effects/registry.ts`：卡片注册与用途分组；`src/effects/hud/`：主要动效模板。
- `src/overlay/`：overlay JSON 类型、解析、SRT 和编排检查。
- `src/ExportView.tsx`、`scripts/export-frames.mjs`：逐帧渲染与透明层导出。
- `vite.config.ts`：本地上传、音效回退和导出 API。
- `public/demo/`、`public/sfx-default/`：内置示例和默认音效。
- `.agents/skills/overlay-fx-generator/`：唯一的编排 Skill 入口。

## 开发命令
```sh
cd motion-playground
npm ci
npm run dev                 # http://localhost:5177
npm run build               # TypeScript 检查与生产构建
npm run lint                # oxlint
npm run check:cards         # 默认参数、动效及 Skill 一致性
npm run lint:overlay -- path/to/overlay.json --duration 261
```
- Node.js 要求 ≥ 22.12；透明视频导出还需要 ffmpeg 和 Puppeteer 使用的 Chrome。
- `npm run preview` 只预览静态构建；上传和导出 API 由开发服务器提供。

## 修改约定
- 保持现有代码风格，使用函数组件、Hooks 和现有 CSS 变量；界面和文档以中文为主。
- 新增动效的展示名称（`EffectDef.name`）必须使用英文 PascalCase，并与组件源码文件名（不含 `.tsx` 扩展名）完全一致，包括大小写，例如 `HostCardGlassBoard.tsx` → `HostCardGlassBoard`。中文用途说明放在 `description`，不拼接进展示名称；既有 `id` / overlay JSON `kind` 不因改名而变更。
- 修改前检查工作区状态，保留用户已有改动，避免顺手重构无关模块。
- 保持 overlay JSON `version: 1` 及既有 `kind`、参数兼容；新增参数提供默认值。
- 调整模板时同步检查 `EffectDef` 的 `defaults`、`controls` 和注册信息。
- 预览与导出使用同一套模板；保持动画可按时间定位和重复导出一致。
- 新增或修改卡片定义后运行 `npm run sync:cards`，检查生成差异。
- Skill 只维护 `.agents/` 这一份；卡片表通过 `npm run sync:cards` 同步。
- 不提交 `node_modules/`、`dist/`、`exports/`、上传素材、个人字体、偏好文件或工作状态。
- 保留示例、默认音效以及模板使用的署名字段；不要将业务数据误当成作者宣传删除。

## 验证与交付
- 应用代码修改后运行 `npm run build`、`npm run lint`；模板修改再运行 `npm run check:cards`。
- 界面改动检查编辑台、效果库、示例载入及相关交互；导出改动检查 `?export=1` 路径。
- 不为纯文案、样式删除等低影响改动添加重复测试。
- 提交前检查 `git diff --check`，并确认没有失效导入、链接或资源引用。
- 交付说明改了什么、验证结果及尚未解决的问题；验证受阻时明确说明原因。
