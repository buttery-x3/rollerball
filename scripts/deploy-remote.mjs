import { spawnSync } from 'node:child_process';

const result = spawnSync('ssh', [
  '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', 'hetzner-server',
  "sudo -u flamehorn -H bash -c 'cd /home/flamehorn/rollerball && bash scripts/deploy.sh'"
], { stdio: 'inherit', shell: false });
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
