const { registry, temp, appData, resourceCentral } = require('../../constants');
const path = require('path');
const fs = require('fs-extra');
const unzip = require('../unzip');
const download = require('../download');
const { locale } = require('../locale');

// Add safe require for sudo-prompt
let sudo;
try {
  sudo = require('sudo-prompt');
} catch (err) {
  console.warn('sudo-prompt not available, falling back to regular permissions');
  sudo = {
    exec: (cmd, options, callback) => {
      require('child_process').exec(cmd, callback);
    }
  };
}

class TSOInstaller {
  constructor(fsolauncher, installPath) {
    this.fsolauncher = fsolauncher;
    this.id = Math.floor(Date.now() / 1000);
    
    // Set default install directory for Windows
    if (process.platform === 'win32') {
      // If a specific path is provided (from registry or user selection), use it
      if (installPath) {
        this.installDir = installPath;
      } else {
        // Default to LegacySO Game directory structure
        this.installDir = 'C:/Program Files/LegacySO Game/The Sims Online';
      }
    } else {
      this.installDir = installPath || path.join(appData, 'GameComponents', 'The Sims Online');
    }
    
    this.haltProgress = false;
    this.tempPath = path.join(temp.TSO.path, temp.TSO.file);
    this.tempExtractPath = path.join(path.dirname(this.tempPath), `tso-extract-${this.id}`);
    
    // Ensure temp directory exists
    fs.ensureDirSync(path.dirname(this.tempPath));
    
    // Initialize download
    this.dl = download({
      from: resourceCentral.TheSimsOnline,
      to: this.tempPath,
      immediate: false
    });

    console.log('TSO Installation Directory:', this.installDir);
  }

  /**
   * Checks if TSO is already installed in the specified path
   * @returns {Promise<boolean>} True if installed, false otherwise
   */
  async isInstalledInPath() {
    try {
      // TSO uses TSOClient.exe, not Sims.exe
      const exePath = path.join(this.installDir, 'TSOClient', 'TSOClient.exe');
      const exists = await fs.pathExists(exePath);
      console.log('Checking TSO installation:', { 
        path: exePath, 
        exists,
        installDir: this.installDir 
      });
      return exists;
    } catch (err) {
      console.error('Error checking TSO installation:', err);
      return false;
    }
  }

  /**
   * Runs the complete installation process
   * @returns {Promise<boolean>} True if installation successful
   */
  async install() {
    try {
      console.log('Starting TSO installation process');
      
      // Download the TSO client
      await this.download();
      
      // Extract to temporary location
      await this.extractToTemp();
      
      // Move to final installation directory
      await this.moveToFinal();
      
      // Set appropriate permissions
      await this.setPermissions();
      
      console.log('TSO installation completed successfully');
      return true;
    } catch (error) {
      console.error('TSO installation failed:', error);
      throw error;
    } finally {
      // Cleanup temporary files
      await this.cleanup();
    }
  }

  /**
   * Creates or updates a progress item
   * @param {string} message The progress message to display
   * @param {number} percentage The progress percentage (0-100)
   */
  createProgressItem(message, percentage) {
    // Replace undefined or any string containing "undefined" with a friendly message
    const displayMessage = (!message || message.includes('undefined')) 
        ? 'Installing TSO...' 
        : message;

    this.fsolauncher.IPC.addProgressItem(
        'TSOProgressItem' + this.id,
        'TSO Client',
        `${locale.current.INS_IN} ${this.installDir}`,
        displayMessage,
        percentage
    );
    this.fsolauncher.setProgressBar(percentage === 100 ? -1 : percentage / 100);
  }

  /**
   * Downloads the TSO client
   */
  async download() {
    return new Promise((resolve, reject) => {
      let downloadComplete = false;
      
      this.dl.run();
      this.updateDownloadProgress();
      
      this.dl.events.on('error', (error) => {
        console.error('Download error:', error);
        reject(new Error(locale.current.FSO_NETWORK_ERROR));
      });
      
      this.dl.events.on('end', async (fileName) => {
        this.haltProgress = true;
        
        if (this.dl.hasFailed()) {
          return reject(new Error(locale.current.FSO_NETWORK_ERROR));
        }
        
        // Verify file exists and has content
        try {
          const stats = await fs.stat(this.tempPath);
          if (stats.size === 0) {
            return reject(new Error('Downloaded file is empty'));
          }
          
          // Basic ZIP validation - check for ZIP magic number
          const buffer = Buffer.alloc(4);
          const fd = await fs.open(this.tempPath, 'r');
          await fs.read(fd, buffer, 0, 4, 0);
          await fs.close(fd);
          
          if (buffer.toString('hex') !== '504b0304') {
            await fs.unlink(this.tempPath).catch(console.warn);
            return reject(new Error('Downloaded file is not a valid ZIP archive'));
          }
          
          downloadComplete = true;
          resolve();
        } catch (error) {
          console.error('File validation error:', error);
          await fs.unlink(this.tempPath).catch(console.warn);
          reject(new Error('Failed to validate downloaded file'));
        }
      });
      
      // Add timeout
      setTimeout(() => {
        if (!downloadComplete) {
          this.dl.abort();
          reject(new Error('Download timed out'));
        }
      }, 300000); // 5 minute timeout
    });
  }

  /**
   * Updates the download progress
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
   * Extracts downloaded files to temporary location
   */
  async extractToTemp() {
    try {
      this.createProgressItem(
        locale.current.INS_TSO_EXTRACTING || 'Extracting TSO files...',
        50
      );

      // Ensure temp directory exists and is empty
      await fs.emptyDir(this.tempExtractPath);
      
      // Verify the downloaded file before extraction
      if (!await fs.pathExists(this.tempPath)) {
        throw new Error('Download file not found');
      }
      
      const stats = await fs.stat(this.tempPath);
      if (stats.size === 0) {
        throw new Error('Downloaded file is empty');
      }
      
      console.log('Starting extraction from:', this.tempPath, 'to:', this.tempExtractPath);
      
      try {
        await unzip(this.tempPath, this.tempExtractPath);
      } catch (error) {
        console.error('Unzip error:', error);
        // If extraction fails, try to clean up and re-download
        await fs.unlink(this.tempPath).catch(console.warn);
        throw new Error('Archive extraction failed - attempting to re-download');
      }
      
      // Verify extraction succeeded
      const contents = await fs.readdir(this.tempExtractPath);
      console.log('Extracted contents:', contents);
      
      if (!contents.length) {
        throw new Error('No files found after extraction');
      }
      
      // Find the TSO directory
      const tsoDir = contents.find(dir => 
        dir.toLowerCase().includes('tso') || 
        dir.toLowerCase().includes('the sims online')
      );
      
      if (!tsoDir) {
        throw new Error('Could not find TSO directory in extracted contents');
      }
      
      this.sourceDir = path.join(this.tempExtractPath, tsoDir);
      
      console.log('Extraction completed successfully:', {
        tempPath: this.tempPath,
        extractPath: this.tempExtractPath,
        sourceDir: this.sourceDir
      });
      
      return true;
    } catch (error) {
      console.error('Extraction error:', error);
      // Clean up any partial extractions
      await fs.remove(this.tempExtractPath).catch(console.warn);
      throw new Error(`Failed to extract TSO files: ${error.message}`);
    }
  }

  /**
   * Strips duplicate folders from the installation path
   * @private
   * @returns {string} Normalized installation path
   */
  _stripDuplicateFolders() {
    // Normalize the install directory path
    let normalizedPath = path.normalize(this.installDir);
    
    // Remove any duplicate TSO/TSOClient segments
    const segments = normalizedPath.split(path.sep);
    const uniqueSegments = segments.filter((segment, index, array) => {
      const lowerSegment = segment.toLowerCase();
      return !(
        (lowerSegment === 'tso' && array[index + 1]?.toLowerCase() === 'tso') ||
        (lowerSegment === 'tsoclient' && array[index + 1]?.toLowerCase() === 'tsoclient')
      );
    });
    
    return uniqueSegments.join(path.sep);
  }

  /**
   * Moves files to final installation directory
   */
  async moveToFinal() {
    console.log('Moving files to final location:', this.installDir);
    
    try {
      const normalizedInstallDir = this._stripDuplicateFolders();
      this.createProgressItem(locale.current.INS_MOVING || 'Moving files...', 85);

      if (!this.sourceDir || !(await fs.pathExists(this.sourceDir))) {
        throw new Error('Source directory not found after extraction');
      }

      // Ensure target directory exists and is empty
      await fs.ensureDir(normalizedInstallDir);
      await fs.emptyDir(normalizedInstallDir).catch(console.warn);

      // On Windows, use elevated privileges if needed
      if (process.platform === 'win32') {
        const batchPath = path.join(path.dirname(this.sourceDir), `install-tso-${this.id}.bat`);
        const batchCommands = [
          '@echo off',
          'setlocal',
          `mkdir "${normalizedInstallDir}" 2>nul`,
          `xcopy "${this.sourceDir}" "${normalizedInstallDir}" /E /H /C /I /Y`,
          'if errorlevel 1 exit /b %errorlevel%',
          `icacls "${normalizedInstallDir}" /grant Users:(OI)(CI)F /T`,
          'exit /b 0'
        ].join('\r\n');

        await fs.writeFile(batchPath, batchCommands);
        
        await new Promise((resolve, reject) => {
          const sudo = require('sudo-prompt');
          sudo.exec(`cmd.exe /c "${batchPath}"`, {
            name: 'TSO Launcher'
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
        await fs.copy(this.sourceDir, normalizedInstallDir, {
          overwrite: true,
          preserveTimestamps: true
        });

        // Set permissions
        await fs.chmod(normalizedInstallDir, '755').catch(console.warn);
      }

      this.createProgressItem(locale.current.INS_MOVING_COMPLETE || 'Move complete', 95);
      console.log('Files successfully moved to:', normalizedInstallDir);
      
      return true;
    } catch (error) {
      console.error('Move to final location failed:', error);
      if (error.message.includes('Administrator permissions required')) {
        throw error;
      }
      throw new Error(`Installation failed - Unable to copy game files: ${error.message}`);
    } finally {
      // Clean up source directory
      if (this.sourceDir) {
        await fs.remove(this.sourceDir).catch(console.warn);
      }
    }
  }

  /**
   * Sets appropriate permissions on installed files
   */
  async setPermissions() {
    if (process.platform === 'win32') {
      await new Promise((resolve) => {
        const command = `icacls "${this.installDir}" /grant:r Users:(OI)(CI)F /T`;
        sudo.exec(command, (error) => {
          if (error) {
            console.warn('Permission setting warning:', error);
          }
          resolve();
        });
      });
    } else {
      await fs.chmod(this.installDir, '755').catch(console.warn);
    }
  }

  /**
   * Cleans up temporary files
   */
  async cleanup() {
    try {
      if (this.tempExtractPath) {
        await fs.remove(this.tempExtractPath);
      }
      if (this.tempPath) {
        await fs.remove(this.tempPath);
      }
    } catch (error) {
      console.warn('Cleanup warning:', error);
    }
  }
}

module.exports = TSOInstaller;



















