const download = require( '../download' );
const unzip = require( '../unzip' );
const { strFormat } = require( '../utils' );
const { resourceCentral, temp, appData, linuxLibPath } = require( '../../constants' );
const { locale } = require( '../locale' );
const fs = require ( 'fs-extra' );
const path = require('path');

/**
 * Installs macOS Extras on macOS systems.
 */
class MacExtrasInstaller {
  /**
   * @param {import('../../fsolauncher')} fsolauncher The FSOLauncher instance.
   * @param {string} path The path to the installation directory.
   * @param {string} parentComponent The name of the parent component.
   */
  constructor( fsolauncher, path, parentComponent = 'FreeSO' ) {
    this.fsolauncher = fsolauncher;
    this.id = Math.floor( Date.now() / 1000 );
    this.path = path;
    this.haltProgress = false;
    this.parentComponent = parentComponent;
    this.tempPath = strFormat( temp.MacExtras, this.id );
    this.tempExtractPath = this.tempPath + '_extracted';
    // Fix: Ensure download parameters are strings
    this.dl = download({
      from: String(resourceCentral.MacExtras),
      to: String(this.tempPath)
    });
  }

  /**
   * Create/Update the download progress item.
   *
   * @param {string} message    The message to display.
   * @param {number} percentage The percentage to display.
   */
  createProgressItem( message, percentage ) {
    const textPath = process.platform === 'win32' ? this.path : this.path.replace( appData + '/', '' );
    this.fsolauncher.IPC.addProgressItem(
      'FSOProgressItem' + this.id,
      `${this.parentComponent} MacExtras`,
      `${locale.current.INS_IN} ${textPath}`,
      message,
      percentage
    );
    this.fsolauncher.setProgressBar(
      percentage == 100 ? 2 : percentage / 100
    );
  }

  /**
   * Executes all installation steps in order and captures any errors.
   *
   * @returns {Promise<void>} A promise that resolves when the installation ends.
   */
  async install() {
    try {
      await this.download();
      await this.setupDir();
      await this.extract();
      await this.moveFiles();
      this.armPatch();
      this.end();
    } catch ( err ) {
      this.error( err );
      throw err; // Send it back to the caller.
    } finally {
      await this.cleanup();
    }
  }

  /**
   *  Replace MonoGame.Framework.dll.config on Arm Linux
   */
  armPatch() {
    if ( process.platform == 'linux' && process.arch.startsWith( 'arm' ) ) {
      // This file is relatively small so it's not really worth creating a new file just for it
      fs.writeFileSync( `${this.path}/MonoGame.Framework.dll.config`,
        '<?xml version="1.0" encoding="utf-8"?>\n' +
        '<configuration>\n' +
        `  <dllmap dll="SDL2.dll" os="linux" target="${linuxLibPath}/libSDL2-2.0.so.0"/>\n` +
        `  <dllmap dll="soft_oal.dll" os="linux" target="${linuxLibPath}/libopenal.so.1"/>\n` +
        '</configuration>'
      );
    }
  }

  /**
   * When the installation errors out.
   *
   * @param {Error} _err The error object.
   */
  error( _err ) {
    this.dl.cleanup();
    this.haltProgress = true;
    this.createProgressItem( strFormat( locale.current.FSO_FAILED_INSTALLATION, 'macOS Extras' ), 100 );
    this.fsolauncher.IPC.stopProgressItem( 'FSOProgressItem' + this.id );
  }

  /**
   * When the installation ends.
   */
  end() {
    this.dl.cleanup();
    this.createProgressItem( locale.current.INSTALLATION_FINISHED, 100 );
    this.fsolauncher.IPC.stopProgressItem( 'FSOProgressItem' + this.id );
  }

  /**
   * Downloads the distribution file.
   *
   * @returns {Promise<void>} A promise that resolves when the download is complete.
   */
  download() {
    return new Promise( ( resolve, reject ) => {
      this.dl.run();
      this.dl.events.on( 'error', () => {} );
      this.dl.events.on( 'end', _fileName => {
        if ( this.dl.hasFailed() ) {
          return reject( locale.current.FSO_NETWORK_ERROR );
        }
        resolve();
      } );
      this.updateDownloadProgress();
    } );
  }

  /**
   * Creates all the directories and subfolders in a path.
   *
   * @returns {Promise<void>} A promise that resolves when the directory is created.
   */
  setupDir() {
    return new Promise( ( resolve, reject ) => {
      require( 'fs-extra' ).ensureDir( this.path, err => {
        if ( err ) return reject( err );
        resolve();
      } );
    } );
  }

  /**
   * Updates the progress item with the download progress.
   */
  updateDownloadProgress() {
    setTimeout( () => {
      let p = this.dl.getProgress();
      const mb = this.dl.getProgressMB(),
        size = this.dl.getSizeMB();

      if ( isNaN( p ) ) p = 0;
      if ( p < 100 ) {
        if ( ! this.haltProgress ) {
          this.createProgressItem(
            `${locale.current.DL_CLIENT_FILES} ${mb} MB ${locale.current.X_OUT_OF_X} ${size} MB (${p}%)`,
            p
          );
        }
        return this.updateDownloadProgress();
      }
    }, 250 );
  }

  /**
   * Extracts the zipped artifacts.
   *
   * @returns {Promise<void>} A promise that resolves when the extraction is complete.
   */
  async extract() {
    try {
      await fs.ensureDir(this.tempExtractPath);
      await unzip({
        from: String(this.tempPath),
        to: String(this.tempExtractPath),
        cpperm: true
      }, filename => {
        console.log('Extracting:', filename);
        this.createProgressItem(
          locale.current.EXTRACTING_CLIENT_FILES + ' ' + filename,
          100
        );
      });
    } catch (error) {
      console.error('Extraction error:', error);
      throw error;
    }
  }

  async moveFiles() {
    try {
      // First, let's log the contents of the extraction directory
      const contents = await fs.readdir(this.tempExtractPath);
      console.log('Extracted contents:', contents);

      // Try to find the files we need
      let sourceDir = this.tempExtractPath;
      
      // Check if we need to go one level deeper (in case of a containing folder)
      if (contents.length === 1 && (await fs.stat(path.join(this.tempExtractPath, contents[0]))).isDirectory()) {
        sourceDir = path.join(this.tempExtractPath, contents[0]);
        console.log('Using subdirectory:', sourceDir);
      }

      // Get all files from the source directory
      const files = await fs.readdir(sourceDir);
      console.log('Files to move:', files);

      // Move each file to the LSO directory
      for (const file of files) {
        const sourcePath = path.join(sourceDir, file);
        const destPath = path.join(this.path, file);
        
        // Skip if it's a directory named 'files' or other unwanted directories
        const stats = await fs.stat(sourcePath);
        if (stats.isDirectory() && ['files', 'PatchFiles'].includes(file)) {
          continue;
        }

        // Remove existing file if it exists
        await fs.remove(destPath).catch(() => {});
        
        // Move the file
        await fs.move(sourcePath, destPath, { overwrite: true });
        console.log('Moved:', file);
      }

      // Set executable permissions for command files
      const commandFiles = ['freeso.command', 'freeso-linux.command', 'legacyso.command'];
      for (const file of commandFiles) {
        const filePath = path.join(this.path, file);
        if (await fs.pathExists(filePath)) {
          await fs.chmod(filePath, '755').catch(console.warn);
          console.log('Set permissions for:', file);
        }
      }

      console.log('Mac extras files moved successfully to:', this.path);
    } catch (error) {
      console.error('Error details:', {
        tempExtractPath: this.tempExtractPath,
        destinationPath: this.path,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  async cleanup() {
    try {
      await fs.remove(this.tempPath).catch(() => {});
      await fs.remove(this.tempExtractPath).catch(() => {});
    } catch (error) {
      console.warn('Cleanup warning:', error);
    }
  }
}

module.exports = MacExtrasInstaller;
