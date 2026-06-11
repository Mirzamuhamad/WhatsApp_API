module.exports = {
  apps: [
    {
      name: 'wa-gateway',
      script: 'src/server.js',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
