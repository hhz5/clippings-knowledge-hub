import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 项目根目录（仓库内相对路径，绝不写死本机绝对路径）
export const projectRoot = path.resolve(__dirname, '..');

// 读取「剪藏源目录」（用户本机 Markdown 库）的配置优先级：
//   1) 环境变量 CLIPPINGS_SRC
//   2) scripts/config.local.json（已被 .gitignore 忽略，不会进仓库）
//   3) scripts/config.example.json（占位，提示用户替换）
// 这样仓库内不含任何本机路径，避免泄露本地电脑信息。
export function loadSrc() {
  if (process.env.CLIPPINGS_SRC) return process.env.CLIPPINGS_SRC;

  const localCfg = path.join(__dirname, 'config.local.json');
  if (fs.existsSync(localCfg)) {
    try {
      const c = JSON.parse(fs.readFileSync(localCfg, 'utf8'));
      if (c && c.src) return c.src;
    } catch {}
  }

  const exCfg = path.join(__dirname, 'config.example.json');
  if (fs.existsSync(exCfg)) {
    try {
      const c = JSON.parse(fs.readFileSync(exCfg, 'utf8'));
      if (c && c.src && c.src !== '<PATH_TO_YOUR_CLIPPINGS_FOLDER>') return c.src;
    } catch {}
  }

  throw new Error(
    '未配置剪藏源目录。请二选一：\n' +
    '  1) 设置环境变量：export CLIPPINGS_SRC="/path/to/剪藏文件"\n' +
    '  2) 创建 scripts/config.local.json，内容 {"src":"/path/to/剪藏文件"}（已 gitignore，不会进仓库）'
  );
}
