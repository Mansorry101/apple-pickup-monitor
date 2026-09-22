/**
 * 状态持久化：避免重启后重复发邮件，并支持"库存消失"通知。
 */
import fs from 'node:fs';
import path from 'node:path';

export function loadState(file) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw);
    return { parts: {}, ...parsed };
  } catch {
    return { parts: {} };
  }
}

export function saveState(file, state) {
  const tmp = `${file}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
    fs.renameSync(tmp, file);
    return true;
  } catch (e) {
    console.error(`[状态] 写入失败: ${e.message}`);
    return false;
  }
}
