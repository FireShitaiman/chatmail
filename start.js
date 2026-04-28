// ELECTRON_RUN_AS_NODE=1 が Claude Code 環境でセットされているため、
// このスクリプト経由で起動することで環境変数をクリアしてから Electron を起動する。
delete process.env.ELECTRON_RUN_AS_NODE;

const { spawnSync } = require('child_process');
const electronPath = require('electron');
const result = spawnSync(electronPath, ['.'], { stdio: 'inherit', env: process.env });
process.exit(result.status ?? 0);
