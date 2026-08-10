/**
 * 验证：让 Phaser4（跟Phaser主项目同版本）在微信小游戏环境里真的跑起来。
 * 已验证：CANVAS/WEBGL渲染、触摸、wx.setStorageSync持久化、真实图片贴图加载、
 * Graphics.generateTexture烘焙纹理、JSON配置加载、音频加载解码播放。
 *
 * 这一版新增：Tween动画（配合Container）、场景切换 + 相机淡入淡出——
 * 后者是Phaser SceneTransition.ts里 goToScene 辅助函数的核心技术，
 * 前者是Phaser全项目UI动效（按钮悬停/面板弹出/结算数字滚动）的基础。
 */
require('./weapp-adapter');
// node_modules/phaser/package.json 的 main 字段已经手动patch成 ./dist/phaser.js
// （原本指向未编译源码目录，含SpectorJS等调试期依赖，微信npm构建工具不认 exports 字段，
// 会退回去用 main，把一堆用不到的调试代码也带进来）。这里恢复成普通的包名require。
const Phaser = require('phaser');

const STORAGE_KEY = 'tf_wxapp_spike_touch_count';
const mainCanvas = GameGlobal.__WXAPP_MAIN_CANVAS__;

class SpikeScene extends Phaser.Scene {
    constructor() {
        super('SpikeScene');
    }

    preload() {
        this.load.image('realTexture', 'images/test-texture.png');
        this.load.json('testConfig', 'test-config.json');
        this.load.audio('beep', 'audio/test-beep.wav');
    }

    create() {
        this.touchCount = wx.getStorageSync(STORAGE_KEY) || 0;

        this.box = this.add.rectangle(140, 140, 80, 80, 0x4d6fd6);
        this.box.setInteractive();

        // Container + Tween：把两张图装进一个Container里，让Container整体上下浮动——
        // Phaser的createPanel返回的就是Container，卡片hover上浮/结算面板弹出这些
        // 动效全靠Tween驱动GameObject属性，这里验证同一条技术路径。
        const realImage = this.add.image(0, 0, 'realTexture').setDisplaySize(80, 80);

        const g = this.add.graphics();
        g.fillStyle(0xd9a441, 1);
        g.fillRoundedRect(0, 0, 64, 64, 12);
        g.lineStyle(3, 0x8a6a1e, 1);
        g.strokeRoundedRect(0, 0, 64, 64, 12);
        g.generateTexture('bakedIcon', 64, 64);
        g.destroy();
        const bakedIcon = this.add.image(120, 0, 'bakedIcon').setDisplaySize(80, 80);

        this.iconContainer = this.add.container(260, 140, [realImage, bakedIcon]);
        this.tweens.add({
            targets: this.iconContainer,
            y: 160,
            duration: 700,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut',
        });

        const jsonData = this.cache.json.get('testConfig');

        this.info = this.add.text(20, 20,
            `canvas: ${mainCanvas.width}x${mainCanvas.height}\n点击方块次数（含历史累计）: ${this.touchCount}\nPhaser渲染模式: WEBGL\nJSON: ${jsonData ? jsonData.message : '(加载失败)'}\n右侧两图应持续上下浮动（Tween+Container）`,
            { fontSize: '18px', color: '#eef0fa' });
        this.info.setAlpha(0);
        this.tweens.add({ targets: this.info, alpha: 1, duration: 500 });

        this.box.on('pointerdown', () => {
            this.touchCount++;
            wx.setStorageSync(STORAGE_KEY, this.touchCount);
            this.box.setFillStyle(this.box.fillColor === 0x4d6fd6 ? 0x3f9d5f : 0x4d6fd6);
            this.refreshInfo();
            this.sound.play('beep');
        });

        this.input.on('pointerdown', (pointer) => {
            if (this.box.getBounds().contains(pointer.x, pointer.y)) return;
            if (this.switchBtn.getBounds().contains(pointer.x, pointer.y)) return;
            this.box.setPosition(pointer.x, pointer.y);
        });

        // 场景切换 + 相机淡出：跟 Phaser SceneTransition.ts 的 goToScene 完全同一套
        // 手法——cam.fadeOut 播完之后监听 FADE_OUT_COMPLETE 事件再真正切场景。
        this.switchBtn = this.add.rectangle(this.scale.width - 90, 40, 140, 50, 0x5a4a8a).setInteractive();
        this.add.text(this.scale.width - 90, 40, '切换场景', { fontSize: '16px', color: '#ffffff' }).setOrigin(0.5);
        this.switchBtn.on('pointerdown', () => {
            const cam = this.cameras.main;
            cam.fadeOut(300, 0, 0, 0);
            cam.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
                this.scene.start('SecondScene');
            });
        });
    }

    refreshInfo() {
        this.info.setText(
            `canvas: ${mainCanvas.width}x${mainCanvas.height}\n点击方块次数（含历史累计）: ${this.touchCount}\nPhaser渲染模式: WEBGL\n右侧两图应持续上下浮动（Tween+Container）`,
        );
    }
}

class SecondScene extends Phaser.Scene {
    constructor() {
        super('SecondScene');
    }

    create() {
        this.cameras.main.fadeIn(300, 0, 0, 0);

        this.add.text(this.scale.width / 2, this.scale.height / 2 - 40,
            '这是第二个场景\n场景切换 + 相机淡入淡出验证通过',
            { fontSize: '20px', color: '#8fe0a8', align: 'center' }).setOrigin(0.5);

        const backBtn = this.add.rectangle(this.scale.width / 2, this.scale.height / 2 + 60, 140, 50, 0x3f9d5f).setInteractive();
        this.add.text(this.scale.width / 2, this.scale.height / 2 + 60, '返回', { fontSize: '16px', color: '#ffffff' }).setOrigin(0.5);
        backBtn.on('pointerdown', () => {
            const cam = this.cameras.main;
            cam.fadeOut(300, 0, 0, 0);
            cam.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
                this.scene.start('SpikeScene');
            });
        });
    }
}

new Phaser.Game({
    type: Phaser.WEBGL,
    canvas: mainCanvas,
    width: mainCanvas.width,
    height: mainCanvas.height,
    backgroundColor: '#1c1e2a',
    scene: [SpikeScene, SecondScene],
    banner: false,
    // 默认图片加载走 XHR + responseType:'blob'（createObjectURL），小游戏环境完全没有
    // Blob。改成 HTMLImageElement 模式后，Phaser内部直接 new Image() + 设置src，
    // 完全不碰XHR/Blob，跟适配层里 Image 的实现严丝合缝。
    loader: { imageLoadType: 'HTMLImageElement' },
});
