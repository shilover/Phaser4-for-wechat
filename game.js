/**
 * 验证：让 Phaser4（跟Phaser主项目同版本）在微信小游戏环境里真的跑起来。
 * 跟最初纯手写canvas那版画一样的东西（方块+文字+触摸变色/跟随+存储计数），但这次
 * 全部通过 Phaser 自己的 Graphics/Text/Input/Scene 生命周期完成——能跑通才说明引擎
 * 本身没问题，不是我们手写代码凑出来的假象。
 *
 * CANVAS 和 WEBGL 两种渲染模式都已验证通过：渲染正常、触摸变色/跟随正常、
 * wx.setStorageSync 计数跨编译持久化正常。当前文件是 WEBGL 版本，改 type 那行的
 * Phaser.WEBGL/Phaser.CANVAS 即可切换。
 */
require('./weapp-adapter');
// node_modules/phaser/package.json 的 main 字段已经手动patch成 ./dist/phaser.js
// （原本指向未编译源码目录，含SpectorJS等调试期依赖，微信npm构建工具不认 exports 字段，
// 会退回去用 main，把一堆用不到的调试代码也带进来）。这里恢复成普通的包名require。
const Phaser = require('phaser');

console.log('[game.js] AudioContext存在:', typeof AudioContext, typeof GameGlobal.webkitAudioContext,
    'game.sound最终类型见下方Game创建后');

const STORAGE_KEY = 'tf_wxapp_spike_touch_count';
const mainCanvas = GameGlobal.__WXAPP_MAIN_CANVAS__;
const sys = GameGlobal.__WXAPP_SYSTEM_INFO__;

class SpikeScene extends Phaser.Scene {
    preload() {
        // 真实图片贴图加载：走 Phaser LoaderPlugin -> new Image()（我们适配层里指到
        // wx.createImage()）-> 设置 src -> onload 上传纹理，这条路径Phaser全项目
        // 一百多张图都要走，跟"纯代码画矩形"完全不是一回事，必须单独验证。
        this.load.image('realTexture', 'images/test-texture.png');

        // JSON配置文件加载：Phaser的hero.json/item.json这些都是走这条路——
        // responseType:'text'，不碰Blob，走我们刚写的 XMLHttpRequest 垫层
        // （本地相对路径用 wx.getFileSystemManager().readFile 读包内文件）。
        this.load.json('testConfig', 'test-config.json');

        // 音频加载：走 responseType:'arraybuffer'（要decodeAudioData解码），跟JSON同一套
        // XMLHttpRequest垫层，本地文件走 wx.getFileSystemManager().readFile 不指定encoding
        // 默认就是ArrayBuffer，理论上不用再额外加开关。这是最没底的一项，之前所有资料
        // 都说音频最容易翻车，得真测一下点方块时能不能听到声音。
        this.load.audio('beep', 'audio/test-beep.wav');
    }

    create() {
        this.touchCount = wx.getStorageSync(STORAGE_KEY) || 0;

        this.box = this.add.rectangle(140, 140, 80, 80, 0x4d6fd6);
        this.box.setInteractive();

        // 真实贴图加载结果：预期在方块右边显示出这张小图
        this.realImage = this.add.image(260, 140, 'realTexture').setDisplaySize(80, 80);

        // Graphics.generateTexture：ProceduralIcons.ts 重度依赖的技术——画一次，烘焙进
        // 纹理缓存，之后当普通图片复用。这里画一个圆角矩形验证同样的技术路径。
        const g = this.add.graphics();
        g.fillStyle(0xd9a441, 1);
        g.fillRoundedRect(0, 0, 64, 64, 12);
        g.lineStyle(3, 0x8a6a1e, 1);
        g.strokeRoundedRect(0, 0, 64, 64, 12);
        g.generateTexture('bakedIcon', 64, 64);
        g.destroy();
        this.bakedIcon = this.add.image(380, 140, 'bakedIcon').setDisplaySize(80, 80);

        const jsonData = this.cache.json.get('testConfig');

        this.info = this.add.text(20, 20,
            `canvas: ${mainCanvas.width}x${mainCanvas.height}\n点击方块次数（含历史累计）: ${this.touchCount}\nPhaser渲染模式: WEBGL\n真实贴图/烘焙纹理见右侧两张图\nJSON加载结果: ${jsonData ? jsonData.message + ' / ' + jsonData.sampleNumber : '(加载失败)'}`,
            { fontSize: '20px', color: '#eef0fa' });

        this.box.on('pointerdown', () => {
            this.touchCount++;
            wx.setStorageSync(STORAGE_KEY, this.touchCount);
            this.box.setFillStyle(this.box.fillColor === 0x4d6fd6 ? 0x3f9d5f : 0x4d6fd6);
            this.refreshInfo();
            this.sound.play('beep');
        });

        this.input.on('pointerdown', (pointer) => {
            if (this.box.getBounds().contains(pointer.x, pointer.y)) return;
            this.box.setPosition(pointer.x, pointer.y);
        });
    }

    refreshInfo() {
        this.info.setText(
            `canvas: ${mainCanvas.width}x${mainCanvas.height}\n点击方块次数（含历史累计）: ${this.touchCount}\nPhaser渲染模式: WEBGL`,
        );
    }
}

const game = new Phaser.Game({
    type: Phaser.WEBGL,
    canvas: mainCanvas,
    width: mainCanvas.width,
    height: mainCanvas.height,
    backgroundColor: '#1c1e2a',
    scene: SpikeScene,
    banner: false,
    // 音频这块目前完全没验证过——先去掉 noAudio，看Phaser默认的音频管理器
    // （WebAudioSoundManager/HTML5AudioSoundManager）初始化时炸不炸，这是音频这条路
    // 能不能走通的第一道门槛（还没到"真的播放一个音效"那一步）。
    // 默认图片加载走 XHR + responseType:'blob'（createObjectURL），小游戏环境完全没有
    // Blob——这正是我们最早查资料时"新版Phaser大量用Blob，weapp-adapter模拟不了"说的
    // 那个坑。改成 HTMLImageElement 模式后，Phaser内部会直接 new Image() + 设置src，
    // 完全不碰XHR/Blob，跟我们适配层里 Image 的实现严丝合缝。
    loader: { imageLoadType: 'HTMLImageElement' },
});

setTimeout(() => {
    if (!game.sound) return;
    console.log('[game.js] SoundManager类型:', game.sound.constructor.name,
        '是否noAudio:', game.sound.noAudio);
}, 500);
