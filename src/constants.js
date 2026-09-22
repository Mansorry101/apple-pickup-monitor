/**
 * 共享常量 —— 不含任何依赖，避免循环引用。
 *
 * 门店目录 / 地区定义已移到 stores.js（自动生成，57 家门店）。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');

/** 程序版本。改了这里请同步 package.json，界面上会显示，方便确认跑的是新版。 */
export const VERSION = '2.1.0';
