module.exports = {
  apps: [
    {
      name: "piti-gateway",
      cwd: "./packages/gateway",
      script: "node_modules/.bin/tsx",
      args: "src/index.ts",
      watch: false,
      env: {
        NODE_ENV: "production",
        PATH: `/usr/local/bin:${process.env.PATH}`,
      },
      max_restarts: 10,
      restart_delay: 5000,
      log_date_format: "YYYY-MM-DD HH:mm:ss",
    },
  ],
};
