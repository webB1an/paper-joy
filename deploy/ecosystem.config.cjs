module.exports = {
  apps: [{
    name: 'paper-joy-api',
    cwd: '/www/wwwroot/paper-joy/current/apps/api',
    script: 'dist/main.js',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    max_restarts: 10,
    min_uptime: '10s',
    restart_delay: 3000,
    max_memory_restart: '300M',
    env: {
      NODE_ENV: 'production', HOST: '127.0.0.1', PORT: '4001',
      ENV_FILE: '/www/wwwroot/paper-joy/shared/.env',
      NODE_OPTIONS: '--max-old-space-size=192'
    },
    out_file: '/www/wwwroot/paper-joy/shared/logs/api.out.log',
    error_file: '/www/wwwroot/paper-joy/shared/logs/api.err.log',
    time: true
  }]
};
