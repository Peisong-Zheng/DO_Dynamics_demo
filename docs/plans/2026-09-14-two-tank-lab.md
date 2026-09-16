# 两只水桶的突变实验台 Implementation Plan

**Goal:** 在当前目录完成可构建、可静态部署且数值机制经验证的中文交互教学网站。

**Architecture:** 独立 TypeScript 物理引擎是唯一状态来源；Three.js 装置、DOM 状态、Canvas 历史曲线读取同一输出。固定物理步驱动 OU 噪声与参数渐变；显示刷新与采样独立。

**Tech Stack:** Vite、TypeScript、Three.js、原生 HTML/CSS、Vitest。

## 设计选择

采用安静的纸面实验手册风格：暖白背景、墨色标题、蓝绿色水体、橙色虚线门槛。固定镜头下直接展示进水、慢漏和自动快排，避免用户学习相机操作。单个 WebGLRenderer 响应桌面并排与手机上下布局，无法使用 WebGL 时降级为可操作的 2D 装置。

## 执行步骤

1. 创建构建配置和共享类型，安装当前稳定依赖并记录实际 engines 与 lockfile。
2. 实现 `src/simulation/{engine,random,presets,runner}.ts`：精确分段积分、阈值转换、守恒账目、共享 OU、seed 重放、加水队列、渐变取消与冻结。
3. 实现 `src/scene/createScene.ts` 与相关文件：程序化剖面水箱、阀门、水流、标尺、响应式场景和 2D 后备。
4. 实现 `src/main.ts`、`src/styles.css`、`src/ui/`：公共控制、四实验、独立参数、状态解释、固定容量历史缓冲及曲线。
5. 编写 `tests/simulation.test.ts`，验证解析周期、可激发/边界行为、守恒、重放、帧率无关性及暂停等语义。
6. 运行 `npm ci`、`npm test`、`npm run build`，在生产预览验证所有控制、移动端布局、降级、减少动态效果和资源加载。
7. 完成中文 README，记录实际验证结果与 GitHub + Cloudflare Pages Git 集成配置；发布由用户执行。

## 验收重点

严格遵循原始 `threejs-dynamics-agent-prompt.md`。不硬编码事件时刻、不重置实时参数操作、不用显示截断掩盖积分错误。以解析解和水量守恒检验机制，以浏览器实际交互检验装置和曲线的一致性。
