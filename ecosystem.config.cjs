module.exports = {
  apps: [{
    name: 'rollerball',
    script: 'server/static-server.mjs',
    cwd: __dirname,
    instances: 1,
    exec_mode: 'fork',
    env: { NODE_ENV: 'production', HOST: '127.0.0.1', PORT: '4006' }
  }]
};
