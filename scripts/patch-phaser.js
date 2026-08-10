/**
 * npm install 之后自动执行：把 node_modules/phaser 的 package.json 里 main 字段从
 * "./src/phaser.js"（未编译源码目录，含SpectorJS等调试期依赖）改成 "./dist/phaser.js"
 * （编译好的运行时文件）。
 *
 * 起因：微信小游戏"构建npm"工具不认新版 package.json 的 exports 字段，会退回去用 main
 * 字段解析，如果不patch这一下，require('phaser') 会把整个未编译源码树（包括根本用不到的
 * WebGL调试工具 phaser3spectorjs）都打包进来，导致一堆本不该出现的报错。
 * 详细过程见同目录 weapp-adapter.js 的注释。
 *
 * 只在这个一次性验证项目里用，不需要通用性——patch失败就直接报错退出，方便发现问题
 * （比如以后 phaser 升级了，main 字段本身就是对的，那时候这个脚本可能需要跟着调整或删掉）。
 */
const fs = require('fs');
const path = require('path');

const pkgPath = path.join(__dirname, '..', 'node_modules', 'phaser', 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

if (pkg.main !== './dist/phaser.js') {
    pkg.main = './dist/phaser.js';
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
    console.log('[patch-phaser] 已把 phaser 的 main 字段改成 ./dist/phaser.js');
} else {
    console.log('[patch-phaser] main 字段已经是 ./dist/phaser.js，跳过');
}
