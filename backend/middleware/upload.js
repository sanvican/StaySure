const multer = require('multer');
const { getConfig } = require('../config');

function createUploadMiddleware() {
  const cfg = getConfig();
  return multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: cfg.maxUploadMb * 1024 * 1024,
      files: 10,
    },
  });
}

module.exports = {
  createUploadMiddleware,
};
