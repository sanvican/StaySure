const app = require('./app');
const { getConfig } = require('./config');

const cfg = getConfig();

app.listen(cfg.port, () => {
  console.log(`StaySure API listening on http://localhost:${cfg.port}`);
});
