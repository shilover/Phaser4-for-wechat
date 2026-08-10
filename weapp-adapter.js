/**
 * 最小自制适配层：让 Phaser 以为自己活在浏览器里。
 *
 * 微信小游戏运行时没有完整的 window/document/Image/XMLHttpRequest，但从这次实测看
 * （lib 3.16.2），GameGlobal 上已经预置了部分只读的浏览器同名属性（比如 window 本身，
 * 是个 getter-only、指向 GameGlobal 自己）——直接 `g.window = g` 赋值会因为"给只有getter
 * 的属性赋值"在严格模式下直接抛错，中断整个模块加载。
 *
 * 所以这里统一走 safeAssign：能覆盖就用 defineProperty 强制覆盖成可写的，覆盖不了
 * （比如整个属性本身就不可配置）就跳过、直接用运行时自带的值，不再让适配层自己成为
 * 崩溃点。这是本次验证里风险最高、最没有先例可抄的一块——垫得够不够全就看 Phaser
 * 实际还会报什么错，缺什么再往这个文件里补。
 */
function safeAssign(obj, key, value) {
    try {
        const desc = Object.getOwnPropertyDescriptor(obj, key);
        if (desc && desc.configurable === false) {
            if (desc.writable === false && !desc.set) {
                console.warn(`[weapp-adapter] ${key} 不可覆盖也不可写，跳过，沿用运行时自带的值`);
                return;
            }
            obj[key] = value;
            return;
        }
        Object.defineProperty(obj, key, { value, writable: true, configurable: true, enumerable: true });
    } catch (e) {
        console.warn(`[weapp-adapter] 设置 ${key} 失败：${e.message}，跳过`);
    }
}

const systemInfo = wx.getSystemInfoSync();
const mainCanvas = wx.createCanvas();

const g = GameGlobal;

safeAssign(g, 'window', g);
safeAssign(g, 'self', g);
safeAssign(g, 'top', g);
safeAssign(g, 'parent', g);
// webpack打包产物里常见的Node.js环境探测代码会直接摸 global 这个标识符（Node的全局对象），
// 小游戏环境根本没有这东西，垫成跟 window 一样指向 GameGlobal。
safeAssign(g, 'global', g);

safeAssign(g, 'navigator', {
    userAgent: 'wechat-minigame',
    language: 'zh-CN',
    onLine: true,
});

safeAssign(g, 'devicePixelRatio', systemInfo.pixelRatio || 1);

if (typeof g.performance === 'undefined') {
    safeAssign(g, 'performance', { now: () => Date.now() });
}

// 这个版本的运行时全局本来就带 requestAnimationFrame/cancelAnimationFrame（跟前面
// window/document 一样是预置好的），实测 canvas 实例上反而没有这个方法——原生有就不要
// 自己瞎垫，只有原生真的没有时才退回到 canvas.requestAnimationFrame 兜底。
if (typeof g.requestAnimationFrame !== 'function') {
    safeAssign(g, 'requestAnimationFrame', (cb) => mainCanvas.requestAnimationFrame(cb));
}
if (typeof g.cancelAnimationFrame !== 'function') {
    safeAssign(g, 'cancelAnimationFrame', (id) => mainCanvas.cancelAnimationFrame(id));
}

safeAssign(g, 'localStorage', {
    getItem: (k) => { const v = wx.getStorageSync(k); return v === '' ? null : v; },
    setItem: (k, v) => wx.setStorageSync(k, v),
    removeItem: (k) => wx.removeStorageSync(k),
});

// Image 全局构造器：Phaser加载图片资源时 new Image()，小游戏对应的是 wx.createImage()。
safeAssign(g, 'Image', function () {
    return wx.createImage();
});

// Phaser 的输入/设备探测代码里大量用 `'ontouchstart' in xxx` 这种特性检测写法，
// `in` 操作符只要右边不是"对象"（比如是 undefined）就直接抛TypeError——不是"属性存不存在"
// 的问题，是"这个东西存不存在"的问题。所以下面每个DOM形态的桩对象都显式给个 ontouchstart
// 字段（哪怕值是null），保证它们至少是"存在的对象"，`in`不会炸。
function fakeElement(extra) {
    return Object.assign({
        style: {},
        ontouchstart: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        setAttribute: () => {},
        getAttribute: () => null,
        getContext: () => null,
        getBoundingClientRect: () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 }),
        appendChild: () => {},
        removeChild: () => {},
        insertBefore: () => {},
        firstChild: null,
        clientWidth: 0,
        clientHeight: 0,
    }, extra);
}

const fakeBody = fakeElement({});
const fakeDocumentElement = fakeElement({});
const fakeHead = fakeElement({});
const fakeCreateElement = (tag) => {
    if (tag === 'canvas') return wx.createCanvas();
    if (tag === 'img' || tag === 'image') return wx.createImage();
    return fakeElement({});
};

// document 跟 window 一样，很可能是这个版本运行时（GameGlobal 本身是个"类Window"宿主对象）
// 预置的只读getter，整个替换大概率会被 safeAssign 判定"不可覆盖"直接跳过——所以这里改成
// "读到什么就在原对象上打补丁"，缺什么补什么，而不是赌能不能整体换掉。
console.log('[weapp-adapter] document存在:', typeof g.document,
    'documentElement存在:', typeof (g.document && g.document.documentElement));

if (typeof g.document !== 'object' || g.document === null) {
    safeAssign(g, 'document', Object.assign(fakeElement({}), {
        createElement: fakeCreateElement,
        documentElement: fakeDocumentElement,
        body: fakeBody,
        createElementNS: () => fakeElement({}),
        fonts: { ready: Promise.resolve(), add: () => {} },
    }));
} else {
    const doc = g.document;
    if (typeof doc.documentElement !== 'object' || doc.documentElement === null) {
        safeAssign(doc, 'documentElement', fakeDocumentElement);
    } else if (typeof doc.documentElement.ontouchstart === 'undefined') {
        safeAssign(doc.documentElement, 'ontouchstart', null);
    }
    if (typeof doc.body !== 'object' || doc.body === null) {
        safeAssign(doc, 'body', fakeBody);
    }
    // Phaser InputManager 处理触摸移动时会调用 document.elementFromPoint(x, y) 判断触摸点
    // 下面是哪个元素——我们只有一块canvas，不管点哪都直接说"是这块canvas"就够用了。
    if (typeof doc.elementFromPoint !== 'function') {
        safeAssign(doc, 'elementFromPoint', () => mainCanvas);
    }
    // Phaser dist 包里打包烘焙了 SpectorJS（WebGL调试工具），Game初始化时不管选没选WebGL
    // 渲染模式都会跑一遍它的DOM探测逻辑，会摸这几个查询类方法。这几个不管运行时原来有没有
    // 自带实现都强制覆盖——之前吃过亏：运行时可能自带一个"真的能跑但查不到东西"的原生实现
    // （比如 querySelector('head') 因为这个精简DOM树里根本没有head节点而返回null），
    // 光判断"函数存不存在"拦不住这种情况，干脆全部换成我们自己认识的假实现。
    safeAssign(doc, 'getElementsByTagName', () => []);
    safeAssign(doc, 'querySelectorAll', () => []);
    safeAssign(doc, 'querySelector', (selector) => {
        if (selector === 'head') return fakeHead;
        if (selector === 'body') return fakeBody;
        if (selector === 'html') return fakeDocumentElement;
        return null;
    });
    safeAssign(doc, 'getElementById', () => null);
    // document.head 如果是运行时自带的真实原生对象，它的 insertBefore 会对参数做原生类型
    // 校验，我们自己 createElement 出来的假元素永远通不过——所以这里不管原来有没有，
    // 直接强制换成自己的假对象，绕开原生校验这条路（反正我们不需要真的插入任何样式）。
    safeAssign(doc, 'head', fakeHead);
    if (typeof doc.createElement !== 'function') {
        safeAssign(doc, 'createElement', fakeCreateElement);
    }
    if (typeof doc.createElementNS !== 'function') {
        safeAssign(doc, 'createElementNS', () => fakeElement({}));
    }
    if (typeof doc.fonts !== 'object' || doc.fonts === null) {
        safeAssign(doc, 'fonts', { ready: Promise.resolve(), add: () => {} });
    }
}

// 常见"是不是浏览器原生类型"的 instanceof/typeof 探测点，给个能被认出来的构造器桩，
// 避免 Phaser 摸到这些全局标识符本身就 ReferenceError。
safeAssign(g, 'HTMLElement', function () {});
safeAssign(g, 'HTMLCanvasElement', function () {});
safeAssign(g, 'HTMLImageElement', g.Image);
safeAssign(g, 'HTMLVideoElement', function () {});
safeAssign(g, 'WebGLRenderingContext', function () {});
safeAssign(g, 'WebGL2RenderingContext', function () {});
safeAssign(g, 'screen', { width: systemInfo.windowWidth, height: systemInfo.windowHeight });

// mainCanvas 本身就是 wx 提供的真实 canvas，Phaser Game 配置里会显式传进去用（见 game.js）。
// 补几个真实canvas对象上不存在、但 Phaser 的 ScaleManager/InputManager 会去摸的DOM属性，
// 同样是为了不让 `'ontouchstart' in canvas.parentNode` 这类写法因为 parentNode 是
// undefined 而抛错。
if (!mainCanvas.style) mainCanvas.style = {};
if (!mainCanvas.parentNode) mainCanvas.parentNode = fakeBody;
if (!mainCanvas.ownerDocument) mainCanvas.ownerDocument = g.document;
if (typeof mainCanvas.ontouchstart === 'undefined') mainCanvas.ontouchstart = null;
if (typeof mainCanvas.getBoundingClientRect !== 'function') {
    mainCanvas.getBoundingClientRect = () => ({
        left: 0, top: 0, right: mainCanvas.width, bottom: mainCanvas.height,
        width: mainCanvas.width, height: mainCanvas.height, x: 0, y: 0,
    });
}

g.__WXAPP_MAIN_CANVAS__ = mainCanvas;
g.__WXAPP_SYSTEM_INFO__ = systemInfo;

module.exports = { mainCanvas, systemInfo };
