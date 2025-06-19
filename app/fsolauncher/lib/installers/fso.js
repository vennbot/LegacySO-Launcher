const download = require('../download');
const unzip = require('../unzip');
const { resourceCentral, temp, appData } = require('../../constants');
const { locale } = require('../locale');
const { strFormat } = require('../utils');
const fs = require('fs-extra');
const { exec } = require('child_process');
const path = require('path');

class LSOInstaller {
  constructor(fsolauncher, installDir) {
    this.fsolauncher = fsolauncher;
    this.id = Math.floor(Date.now() / 1000);
    
    // Set default install directory for Windows, ensuring we don't include the exe in the base path
    if (process.platform === 'win32') {
      // Remove any existing LegacySO.exe from the path if it exists
      const basePath = installDir ? path.dirname(installDir.endsWith('LegacySO.exe') ? installDir : installDir) 
        : path.join('C:', 'Program Files', 'LegacySO Game', 'LegacySO');
      this.installDir = path.normalize(basePath);
    } else {
      const basePath = installDir ? path.dirname(installDir.endsWith('LegacySO.exe') ? installDir : installDir)
        : path.join(appData, 'GameComponents', 'LegacySO');
      this.installDir = path.normalize(basePath);
    }
    
    console.log('LSO Installer initialized with base path:', this.installDir);
    
    this.haltProgress = false;
    this.tempPath = strFormat(temp.LSO, this.fsolauncher.version || 'latest');
    this.tempExtractPath = path.join(path.dirname(this.tempPath), `lso-extract-${this.id}`);
    
    fs.ensureDirSync(path.dirname(this.tempPath));
    
    this.dl = download({
      from: resourceCentral.LegacySO,
      to: this.tempPath,
      immediate: false
    });
  }

  createProgressItem(message, percentage) {
    // Replace undefined or any string containing "undefined" with a friendly message
    const displayMessage = (!message || message.includes('undefined')) 
        ? 'Reticulating Splines...' 
        : message;

    this.fsolauncher.IPC.addProgressItem(
        'LSOProgressItem' + this.id,
        'LegacySO Client',
        `${locale.current.INS_IN} ${this.installDir}`,
        displayMessage,
        percentage
    );
    this.fsolauncher.setProgressBar(percentage === 100 ? -1 : percentage / 100);
  }

  async install() {
    try {
      console.log('Starting LSO installation process');
      await this.download();
      await this.extractToTemp();
      await this.moveToFinal();
      
      // Set final permissions
      if (process.platform === 'win32') {
        await new Promise((resolve) => {
          exec(`icacls "${this.installDir}" /grant:r Users:(OI)(CI)F /T`, (error) => {
            if (error) {
              console.warn('Permission setting warning:', error);
            }
            resolve();
          });
        });
      } else {
        await fs.chmod(this.installDir, '755').catch(console.warn);
      }

      console.log('LSO installation completed successfully');
      return true;
    } catch (error) {
      console.error('Installation failed:', error);
      throw error;
    } finally {
      // Cleanup temp files
      if (this.tempExtractPath) {
        await fs.remove(this.tempExtractPath).catch(console.warn);
      }
      if (this.tempPath) {
        await fs.remove(this.tempPath).catch(console.warn);
      }
    }
  }

  async extractToTemp() {
    console.log('Extracting to temp directory:', this.tempExtractPath);
    
    try {
      // Ensure both source and destination paths exist
      await fs.ensureDir(this.tempExtractPath);
      
      // Verify the downloaded zip file exists
      if (!await fs.pathExists(this.tempPath)) {
        throw new Error(`Download file not found at: ${this.tempPath}`);
      }

      console.log('Extracting file:', this.tempPath);
      
      // Update progress to show extraction started
      this.createProgressItem(locale.current.INS_EXTRACTING || 'Extracting files...', 50);
      
      // Use the unzip utility to extract files
      await unzip(this.tempPath, this.tempExtractPath);
      
      // Update progress to show extraction completed
      this.createProgressItem(locale.current.INS_EXTRACTING_COMPLETE || 'Extraction complete', 75);
      
      // Verify critical files exist
      const exePath = path.join(this.tempExtractPath, 'LegacySO Client/LegacySO.exe');
      console.log('Checking for LegacySO.exe at:', exePath);
      
      const exeExists = await fs.pathExists(exePath);
      if (!exeExists) {
        throw new Error(`Critical game files missing after extraction. Expected: ${exePath}`);
      }
      
      return true;
    } catch (error) {
      console.error('Extraction failed:', error);
      // Include more details in the error message
      throw new Error(`Failed to extract game files - ${error.message}`);
    }
  }

  async moveToFinal() {
    console.log('Moving files to final location:', this.installDir);
    
    try {
      if (process.platform === 'win32') {
        // Create a batch file to perform the copy operation with elevated privileges
        const batchPath = path.join(path.dirname(this.tempPath), `install-lso-${this.id}.bat`);
        const batchCommands = [
          '@echo off',
          'setlocal',
          `mkdir "${this.installDir}" 2>nul`,
          `rmdir /s /q "${this.installDir}" 2>nul`,
          `mkdir "${this.installDir}" 2>nul`,
          `xcopy "${this.tempExtractPath}" "${this.installDir}" /E /H /C /I /Y`,
          'if errorlevel 1 exit /b %errorlevel%',
          `icacls "${this.installDir}" /grant Users:(OI)(CI)F /T`,
          'exit /b 0'
        ].join('\r\n');

        await fs.writeFile(batchPath, batchCommands);
        
        await new Promise((resolve, reject) => {
          const sudo = require('sudo-prompt');
          sudo.exec(`cmd.exe /c "${batchPath}"`, {
            name: 'LegacySO Launcher'
          }, (error) => {
            if (error) {
              console.error('Elevated copy failed:', error);
              reject(new Error('Installation failed - Administrator permissions required'));
              return;
            }
            resolve();
          });
        });

        // Clean up batch file
        await fs.unlink(batchPath).catch(console.warn);
      } else {
        // For non-Windows platforms
        await fs.ensureDir(path.dirname(this.installDir));
        await fs.remove(this.installDir).catch(() => {});
        await fs.ensureDir(this.installDir);
        await fs.copy(this.tempExtractPath, this.installDir, {
          overwrite: true,
          preserveTimestamps: true
        });
      }

      return true;
    } catch (error) {
      console.error('Move to final location failed:', error);
      if (error.message.includes('Administrator permissions required')) {
        throw error;
      }
      throw new Error('Installation failed - Unable to copy game files');
    }
  }

  async download() {
    return new Promise((resolve, reject) => {
      this.dl.run();
      this.updateDownloadProgress(); // Add this line to start progress monitoring
      this.dl.events.on('error', () => {});
      this.dl.events.on('end', _fileName => {
        this.haltProgress = true;
        if (this.dl.hasFailed()) {
          return reject(new Error(locale.current.FSO_NETWORK_ERROR));
        }
        resolve();
      });
    });
  }

  /**
   * Updates the download progress.
   */
  updateDownloadProgress() {
    setTimeout(() => {
      if (!this.haltProgress) {
        let p = this.dl.getProgress();
        const mb = this.dl.getProgressMB(),
          size = this.dl.getSizeMB();

        if (isNaN(p)) p = 0;
        if (p < 100) {
          this.createProgressItem(
            `${locale.current.DL_CLIENT_FILES} ${mb} MB ${locale.current.X_OUT_OF_X} ${size} MB (${p}%)`,
            p
          );
          return this.updateDownloadProgress();
        }
      }
    }, 250);
  }

  /**
   * Checks if LSO is already installed in the specified path.
   * 
   * @returns {Promise<boolean>} True if installed, false otherwise.
   */
  async isInstalledInPath() {
    try {
      // Always construct the exe path by joining the base path with the exe name
      const exePath = path.join(this.installDir, 'LegacySO.exe');
      console.log('Checking for LSO installation at:', exePath);
      const exists = await fs.access(exePath).then(() => true).catch(() => false);
      // Return the base directory path if installed, not the exe path
      return exists ? this.installDir : false;
    } catch (err) {
      console.error('Error checking LSO installation:', err);
      return false;
    }
  }
}

module.exports = LSOInstaller;




















































