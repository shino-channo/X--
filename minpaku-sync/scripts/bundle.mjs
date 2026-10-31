// wrangler の出力を、管理画面に貼り付ける worker.js として保存する
import { readFileSync, writeFileSync, rmSync } from 'node:fs';

const header = '// このファイルは自動生成です（npm run build）。Cloudflare の管理画面に貼り付けて使います。編集は src/ で行ってください。\n';
writeFileSync('worker.js', header + readFileSync('dist/index.js', 'utf8').replace(/\n\/\/# sourceMappingURL=.*\n?$/, '\n'));
rmSync('dist', { recursive: true, force: true });
