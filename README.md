# Phaser4 in 微信小游戏 —— 最小验证

验证目的：Phaser 主项目用的是 Phaser 4.0.0，考虑上微信小游戏之前，先搞清楚
"Phaser4 能不能在小游戏运行时里直接跑起来"这个前提成不成立，不预设一定要降级到
Phaser3。这个仓库就是这个验证过程的最小可复现例子。


本验证本身基于一个大型手游项目进行，已剔除需保密部分内容

这是一个小游戏接入的示例，已经在微信开发工具中正常跑通
https://github.com/shilover/CuteLandFarm/tree/phaser4-wechat-minigame
![alt text](images/Phaser4-wechat-minigame.png)

## 现状

- **CANVAS 渲染模式：验证通过。**
- **WEBGL 渲染模式：验证通过。**（Phaser 正式场景要用的是这个模式，CANVAS性能撑不住
  Tween/Graphics圆角面板/程序化图标这个量级）

两种模式下都确认：渲染正常、触摸输入（点击变色/拖动跟随）正常、
`wx.setStorageSync` 计数跨编译、跨切换渲染模式持久化正常、真实图片贴图加载正常、
`Graphics.generateTexture` 烘焙纹理正常（`ProceduralIcons.ts` 重度依赖的技术）、
JSON配置文件加载正常（`this.load.json()`，Phaser的hero.json/item.json等都走这条路）、
**音频加载+解码+播放全部正常**（`this.load.audio()` + `this.sound.play()`，真实听到了
点击音效）——这个环境原生自带真实的 `AudioContext`，Phaser自动选中了真正的
`WebAudioSoundManager`，不是降级出来的空实现，是这次验证里最意外的好消息（历史上
公认音频是小游戏适配最容易翻车的部分）、**Tween动画驱动Container、场景切换
（`scene.start`）配合相机 `fadeOut`/`fadeIn`** 全部正常——后者是Phaser
`SceneTransition.ts` 里 `goToScene` 辅助函数的核心技术，前者是全项目按钮悬停/
面板弹出/结算数字滚动这些UI动效的基础。

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

8. **图片加载报 `XMLHttpRequest is not defined`** —— 翻了Phaser源码才发现，默认的
   `ImageFile` 走的是 `XHR + responseType:'blob'`，加载完再用
   `File.createObjectURL(img, xhr.response, 'image/png')` 把Blob转成`img.src`——
   这正是我们最早查资料时"新版Phaser大量用Blob，weapp-adapter模拟不了"说的那个坑，
   小游戏环境压根没有Blob/XHR。**没有硬写一个Blob兼容层去填这个坑**，而是翻源码发现
   Phaser自己就留了个开关：Game配置里加 `loader: { imageLoadType: 'HTMLImageElement' }`，
   会切换成完全不同的加载路径（`ImageFile.loadImage`），直接 `new Image()` + 设置
   `.src` + `.onload`，完全不碰XHR/Blob，跟我们适配层里 `Image` 的实现严丝合缝。
   **JSON/文本类资源大概率还是走XHR，这个坑目前只解决了图片这一类。**
9. **JSON加载同样报 `XMLHttpRequest is not defined`，但这次没有类似 `imageLoadType`
   的开关可以绕**——`JSONFile` 走的是 `responseType:'text'`，不涉及Blob，翻源码确认
   `XHRLoader` 实际只用到 `open/setRequestHeader/overrideMimeType/send/onload/onerror/
   status/readyState/response/responseText` 这几个方法和属性，照着写了一个最小可用的
   `XMLHttpRequest` 类：本地相对路径（不带`http(s)://`）用
   `wx.getFileSystemManager().readFile()` 读包内文件，远程URL用 `wx.request()`。
   验证通过——Phaser 的配置文件加载这条路线也走得通。
10. **音频反而没怎么踩坑**——`this.load.audio()` 走的是 `responseType:'arraybuffer'`，
    复用JSON那套 `XMLHttpRequest` 垫层就直接能用（本地文件走
    `wx.getFileSystemManager().readFile()` 不指定 `encoding`，默认就是ArrayBuffer）。
    更意外的是这个版本的小游戏运行时**原生自带真实的 `AudioContext`**
    （`typeof AudioContext === 'function'`），Phaser自动选中了真正的
    `WebAudioSoundManager` 去解码播放，不需要额外写任何音频兼容代码。
11. **Tween/Container/多Scene切换/相机fadeOut+fadeIn——一个坑都没有**，前面几轮
    踩坑把浏览器全局对象这层地基垫平之后，Phaser自己的对象模型（Tween/Container/
    SceneManager/相机后处理）完全是按标准方式在工作，不需要额外适配。

一路踩坑下来的经验：这个版本的小游戏运行时（`GameGlobal`）本身已经预置了不少
"看起来像浏览器"的半成品全局对象（`window`/`document`等），跟"完全空白，什么都要自己垫"
的旧式weapp-adapter思路不一样——遇到报错先判断"是不是原来就有、只是不够用"，
而不是上来就整体替换。

## FAQ：为什么 `phaser3spectorjs`（带"3"）会出现在 Phaser4 项目里

这是 Phaser 4.0.0 官方包自己的历史遗留依赖，原因分三层：

1. **名字带"3"是历史遗留** —— 它是 `node_modules/phaser/package.json` 的
   `devDependencies` 之一。这个 WebGL 调试工具库最早是 Phaser3 时代做的，Phaser
   官方升级到 4.0 后继续沿用同一个包名，没有改名成 `phaser4spectorjs`。
2. **为什么本项目自己的 `package.json` 也要显式声明它** —— 跟"踩过的坑"第3条同源：
   Phaser4 `package.json` 用了新版 `exports` 字段，微信"构建npm"工具不认，会退回去
   读 `main` 字段。没打 `patch-phaser.js` 那个补丁的话，`main` 指向未编译源码目录
   `./src/phaser.js`，里面散落着真实的 `require('phaser3spectorjs')` 调用（WebGL
   调试渲染器用的）。"构建npm"顺着这些 require 遍历依赖图，若 `phaser3spectorjs`
   不在 `node_modules` 里会直接报错"找不到模块"。所以显式把它加进本项目
   `dependencies`，保证不管构建流程有没有踩中这个坑，这个包都在。
3. **但运行时其实用不到它** —— 真正被引用的是 `node_modules/phaser/dist/phaser.js`
   （生产构建版，也就是 `patch-phaser.js` 把 `main` 改指向的那个文件），第
   185967-185969 行可以看到：

   ```js
   if (false)
   // removed by dead control flow
   { var SPECTOR; }
   ```

   Phaser 官方打包 dist 时用了 `DEBUG=false` 开关，webpack 把这段
   `require('phaser3spectorjs')` 当死代码删掉了。构建出来的 `miniprogram_npm` 下那份
   `phaser3spectorjs` 文件夹，实际运行时从来不会被真正调用——它出现只是为了让
   "构建npm"这一步顺利跑完，属于陪跑的无用依赖，不是坑，是历史包袱。