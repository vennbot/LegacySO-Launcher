const yauzl = require('yauzl');
const fs = require('fs-extra');
const path = require('path');

module.exports = function unzip(from, to, progressCallback) {
  // Normalize parameters to handle both object and direct parameters
  const fromPath = typeof from === 'object' ? from.from : from;
  const toPath = typeof from === 'object' ? from.to : to;
  const callback = typeof to === 'function' ? to : progressCallback;

  return new Promise((resolve, reject) => {
    // Validate input
    if (!fromPath || !toPath) {
      return reject(new Error('Invalid parameters: source and destination paths are required'));
    }

    // Check if source exists and is a file
    try {
      const stats = fs.statSync(fromPath);
      if (!stats.isFile()) {
        return reject(new Error(`Not a file: ${fromPath}`));
      }
    } catch (err) {
      return reject(new Error(`Cannot access source file: ${fromPath}`));
    }

    // Ensure target directory exists
    fs.ensureDirSync(toPath);

    yauzl.open(fromPath, { lazyEntries: true }, (err, zipfile) => {
      if (err) return reject(err);
      
      zipfile.readEntry();
      zipfile.on('entry', (entry) => {
        if (callback) {
          callback(entry.fileName);
        }

        const targetPath = path.join(toPath, entry.fileName);
        
        if (/\/$/.test(entry.fileName)) {
          fs.ensureDirSync(targetPath);
          zipfile.readEntry();
        } else {
          fs.ensureDirSync(path.dirname(targetPath));
          
          zipfile.openReadStream(entry, (err, readStream) => {
            if (err) return reject(err);
            
            const writeStream = fs.createWriteStream(targetPath);
            readStream.pipe(writeStream);
            
            writeStream.on('finish', () => {
              if (from.cpperm) {
                fs.chmodSync(targetPath, 0o755);
              }
              zipfile.readEntry();
            });
          });
        }
      });

      zipfile.on('end', resolve);
      zipfile.on('error', reject);
    });
  });
};
