/**
 * 打开下单浏览器（「打开下单浏览器.bat」调用）：不用启动监控，
 * 直接用设置里的浏览器和专用配置打开 Apple 购物袋，方便提前登录、加购、装扩展。
 */
import { loadSettings } from './settings.js';
import { BAG_URL, openInBrowser, profileDirOf } from './handoff.js';

const s = loadSettings();
const profileDir = profileDirOf(s);
try {
  await openInBrowser(BAG_URL, s.checkoutBrowser, { profileDir });
  console.log(profileDir ? `已打开下单浏览器（专用配置：${profileDir}）` : '已打开下单浏览器（日常浏览器）');
} catch (e) {
  console.error('打开失败：' + e.message);
  process.exit(1);
}
