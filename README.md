# onedark-zcode-theme

把 Atom 的传奇 **One Dark Pro** 配色（[Binaryify/OneDark-Pro](https://github.com/Binaryify/OneDark-Pro)，MIT）移植到 **ZCode Desktop** 的主题包。

参考 [onedark-dsh-theme](../onedark-dsh-theme)（同一配色在 DeepSeek Harness 上的移植）制作。ZCode Desktop 没有主题插件 API，因此本包采用**样式表覆盖层**方案：

- 内置深色主题（设置里的"深色"）的全部语义 CSS 变量（约 180 个：背景、侧栏、页签、菜单、终端 ANSI、git/diff、对话轨迹、图表等）被重映射为 One Dark 规范色；
- 原生浅色主题与内置规则零改动，选择"浅色"仍为原版外观；
- 主题层以标记注释包裹追加在内置样式表末尾，重复应用幂等，可一键还原。

## 配色

| 用途 | 颜色 |
| --- | --- |
| 主背景 | `#282c34` |
| 侧栏 / 标题栏 / 页签 | `#21252b` |
| 卡片 / 浮层 / 菜单 | `#2c313a` |
| 输入框 | `#1d1f23` |
| 正文 | `#abb2bf` |
| 品牌蓝 | `#61afef` |
| 语法/状态 | red `#e06c75` · green `#98c379` · yellow `#e5c07b` · purple `#c678dd` · cyan `#56b6c2` · orange `#d19a66` |

背景阶梯与 onedark-dsh-theme 的 One Dark Pro 变体一致；终端使用 One Dark ANSI 16 色。

## 安装

前置条件：已安装 Node.js（仅打包/还原脚本需要）。

```sh
cd onedark-zcode-theme
npm install
npm run apply
```

`npm run apply` 会自动：备份当前 `app.asar` 到 `backup\` → 解包 → 在内置样式表末尾追加 `onedark.css` 主题层 → 重新打包并替换。写 `C:\Program Files\ZCode` 需要管理员权限：请**完全退出 ZCode（包括系统托盘图标）**后，在**管理员终端**中执行。

装完重启 ZCode，进入 **设置 → 主题**，选择 **深色** 即为 One Dark Pro 外观。

只想先验证不安装：`npm run dry-run`（解包打补丁并暂存到 `build\app.asar.patched`，不写入安装目录）。

## 还原 / 卸载

```sh
npm run restore
```

从 `backup\` 恢复最新的**官方原版备份**（`.orig`，脚本会按内容校验备份不含主题层，补丁版本间的 `.prev` 存档不会被误选），重启 ZCode 即可。删除本目录即完全移除主题包本体。

## 更新后重新应用

**ZCode 自动升级会还原官方 `app.asar`，主题随之失效。** 升级后重新执行 `npm run apply` 即可（脚本按内容定位样式表，不依赖带版本号的文件名）。脚本对已打过补丁的包同样幂等：先剥掉旧主题层再追加最新版本。

## 限制

- 代码块内的语法高亮配色由 shiki 在运行时注入，静态 CSS 无法逐 token 覆盖，故聊天中的代码块仍为内置深色高亮；UI 外壳（会话列表、输入框、菜单、终端、git/diff 徽标、图表等）为完整的 One Dark 配色。
- 本方案修改应用安装目录内的资源，属于非官方定制；请配合备份与还原脚本使用。

## 目录结构

```
onedark-zcode-theme/
  onedark.css            主题覆盖层（One Dark Pro 语义变量映射）
  scripts/apply-theme.mjs 应用 / 暂存（--dry-run）/ 还原（--restore）
  backup/                官方原版备份（.orig）与上一版存档（.prev），应用时自动生成
  build/                 解包与暂存产物（可随时删除）
```

## 致谢

- [Binaryify/OneDark-Pro](https://github.com/Binaryify/OneDark-Pro) — One Dark Pro 主题（MIT）
- [songwenhao/onedark-dsh-theme](https://github.com/songwenhao/onedark-dsh-theme) — 同配色在 DeepSeek Harness 上的移植，本包所参照的背景阶梯与映射思路

## License

[MIT](LICENSE)
