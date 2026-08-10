# Phaser4 in 微信小游戏 —— 最小验证

验证目的：Phaser 主项目用的是 Phaser 4.0.0，考虑上微信小游戏之前，先搞清楚
"Phaser4 能不能在小游戏运行时里直接跑起来"这个前提成不成立，不预设一定要降级到
Phaser3。这个仓库就是这个验证过程的最小可复现例子。

## 现状

- **CANVAS 渲染模式：验证通过。**
- **WEBGL 渲染模式：验证通过。**（Phaser 正式场景要用的是这个模式，CANVAS性能撑不住
  Tween/Graphics圆角面板/程序化图标这个量级）

两种模式下都确认：渲染正常、触摸输入（点击变色/拖动跟随）正常、
`wx.setStorageSync` 计数跨编译、跨切换渲染模式持久化正常。

结论：Phaser 4.0.0（跟 Phaser 主项目 `design` 分支同版本）在微信小游戏环境里
两种渲染模式都能跑，"要不要降级到 Phaser3" 这个前提被推翻——目前看不需要降级。
`game.js` 里改 `type: Phaser.WEBGL`/`Phaser.CANVAS` 这一行即可切换验证哪个模式。

## 怎么跑

```
npm install
```

然后用微信开发者工具打开这个目录，**先点"工具"→"构建npm"，再点"编译"**
（改过依赖之后都要重新构建npm；只改代码不用）。

## 关键文件

- `game.js`：入口，起一个最小Phaser Scene（画方块+文字，触摸变色/跟随，点击计数存本地）
- `weapp-adapter.js`：**核心** —— 让 Phaser 以为自己活在浏览器里的最小适配层，
  纯自己写的，没有依赖任何社区weapp-adapter
- `scripts/patch-phaser.js`：`npm install` 后自动执行，patch `node_modules/phaser`
  的 `package.json`（原因见下）

## 踩过的坑（照时间顺序）

1. **`window` 是 getter-only** —— GameGlobal本身是这个版本运行时预置的"类Window"
   宿主对象，直接 `GameGlobal.window = xxx` 赋值会在严格模式下报错。改成先读
   `Object.getOwnPropertyDescriptor` 判断能不能覆盖，不能覆盖就跳过用运行时自带的。
2. **`document` 存在但 `documentElement` 是 undefined** —— 同样是运行时预置的半成品
   对象，不能整体替换（会被判定不可覆盖），只能在原对象上打补丁补齐缺的字段。
3. **Phaser4 的 `package.json` `main` 字段指向未编译源码目录**
   （`./src/phaser.js`），微信"构建npm"工具不认新版 `exports` 字段，会退回去用 `main`，
   把整棵未编译源码树（含用不到的WebGL调试工具 `phaser3spectorjs`）都打包进来。
   Fix：`scripts/patch-phaser.js` 把 `main` 改成 `./dist/phaser.js`。
4. **SpectorJS（打包烘焙进Phaser dist里的WebGL调试工具）会在Game初始化时无条件跑一遍
   DOM操作**——不管选没选WEBGL渲染模式都会执行，要垫 `document.head`、
   `document.querySelector('html')`（不是`'head'`，翻源码才发现）、
   `getElementsByTagName` 等一堆查询类方法的空实现。
5. **`requestAnimationFrame` 这个版本运行时其实原生自带**——一开始想当然地写成委托给
   `canvas.requestAnimationFrame`，结果canvas实例上根本没这个方法，反而把能用的原生实现
   顶替掉了。教训：这类"看起来该有"的全局对象，先检测存不存在，不要无脑覆盖。
6. **`document.elementFromPoint` 没有** —— Phaser处理触摸移动要用它判断触摸点下是哪个
   元素，只有一块canvas，直接返回它自己。
7. **（切到WEBGL模式后）`gl.bindVertexArray is not a function`** —— 根因不是运行时缺
   能力，是我们自己的坑：之前把 `WebGLRenderingContext` 垫成了一个空函数（为了防止
   `instanceof` 探测摸到undefined标识符报错），结果 Phaser 内部一段关键代码用
   `gl instanceof WebGLRenderingContext` 判断要不要把 `bindVertexArray` 等WebGL2方法
   从 `OES_vertex_array_object` 扩展里补到WebGL1的 `gl` 对象上——假构造器让这个判断
   永远为false，反而把Phaser自己的WebGL1兼容补丁跳过了。Fix：探测一个真实的
   `canvas.getContext('webgl')`，用它实际的构造器（`Object.getPrototypeOf(gl).constructor`）
   而不是随手垫个空函数。**教训：给"类型标识符"占位时，只有用真实来源的构造器才安全，
   假构造器可能悄悄改变 `instanceof` 的结果，反而引入新问题。**

一路踩坑下来的经验：这个版本的小游戏运行时（`GameGlobal`）本身已经预置了不少
"看起来像浏览器"的半成品全局对象（`window`/`document`等），跟"完全空白，什么都要自己垫"
的旧式weapp-adapter思路不一样——遇到报错先判断"是不是原来就有、只是不够用"，
而不是上来就整体替换。
