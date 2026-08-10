/**
 * 验证：让 Phaser4（跟Phaser主项目同版本）在微信小游戏环境里真的跑起来。
 * 跟最初纯手写canvas那版画一样的东西（方块+文字+触摸变色/跟随+存储计数），但这次
 * 全部通过 Phaser 自己的 Graphics/Text/Input/Scene 生命周期完成——能跑通才说明引擎
 * 本身没问题，不是我们手写代码凑出来的假象。
 *
 * 用 CANVAS 渲染模式（不用 AUTO/WEBGL），把"WebGL要不要额外适配"这个变量隔离出去，
 * 已验证通过：渲染正常、触摸变色/跟随正常、wx.setStorageSync 计数跨编译持久化正常。
 * WebGL模式的验证见后续提交。
 */
require('./weapp-adapter');
// node_modules/phaser/package.json 的 main 字段已经手动patch成 ./dist/phaser.js
// （原本指向未编译源码目录，含SpectorJS等调试期依赖，微信npm构建工具不认 exports 字段，
// 会退回去用 main，把一堆用不到的调试代码也带进来）。这里恢复成普通的包名require。
const Phaser = require('phaser');

const STORAGE_KEY = 'tf_wxapp_spike_touch_count';
const mainCanvas = GameGlobal.__WXAPP_MAIN_CANVAS__;
const sys = GameGlobal.__WXAPP_SYSTEM_INFO__;

class SpikeScene extends Phaser.Scene {
    create() {
        this.touchCount = wx.getStorageSync(STORAGE_KEY) || 0;

        this.box = this.add.rectangle(140, 140, 80, 80, 0x4d6fd6);
        this.box.setInteractive();

        this.info = this.add.text(20, 20,
            `canvas: ${mainCanvas.width}x${mainCanvas.height}\n点击方块次数（含历史累计）: ${this.touchCount}\nPhaser渲染模式: CANVAS`,
            { fontSize: '20px', color: '#eef0fa' });

        this.box.on('pointerdown', () => {
            this.touchCount++;
            wx.setStorageSync(STORAGE_KEY, this.touchCount);
            this.box.setFillStyle(this.box.fillColor === 0x4d6fd6 ? 0x3f9d5f : 0x4d6fd6);
            this.refreshInfo();
        });

        this.input.on('pointerdown', (pointer) => {
            if (this.box.getBounds().contains(pointer.x, pointer.y)) return;
            this.box.setPosition(pointer.x, pointer.y);
        });
    }

    refreshInfo() {
        this.info.setText(
            `canvas: ${mainCanvas.width}x${mainCanvas.height}\n点击方块次数（含历史累计）: ${this.touchCount}\nPhaser渲染模式: CANVAS`,
        );
    }
}

new Phaser.Game({
    type: Phaser.CANVAS,
    canvas: mainCanvas,
    width: mainCanvas.width,
    height: mainCanvas.height,
    backgroundColor: '#1c1e2a',
    scene: SpikeScene,
    banner: false,
    audio: { noAudio: true },
});
