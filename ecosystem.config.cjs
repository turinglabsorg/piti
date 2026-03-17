module.exports = {
  apps: [
    {
      name: "piti-gateway",
      script: "pnpm",
      args: "dev:gateway",
      watch: false,
      max_restarts: 10,
      restart_delay: 5000,
      log_date_format: "YYYY-MM-DD HH:mm:ss",
    },
  ],
};
