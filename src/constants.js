import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');

/** 程序版本。改了这里请同步 package.json，界面上会显示，方便确认跑的是新版。 */
export const VERSION = '2.2.1';
