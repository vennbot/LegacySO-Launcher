const { captureWithSentry, getJSON, strFormat, getDisplayRefreshRate } = require( './lib/utils' );
const { shell, nativeTheme } = require( 'electron' );
const { locale } = require( './lib/locale' );
const {
  versionChecks,
  version,
  appData,
  darkThemes,
  defaultRefreshRate,
  releases: { simitoneUrl },
  links: { updateWizardUrl },
  defaultGameLanguage
} = require( './constants' );

const Modal = require( './lib/modal' );
const Events = require( './events' );
const IPCBridge = require( './lib/ipc-bridge' );
const Toast = require( './lib/toast' );
const path = require('path');
const LSOInstaller = require('./lib/installers/lso');
const TSOInstaller = require('./lib/installers/tso');

/**
 * Main launcher class.
 */
class LSOLauncher {
  /**
   * @param {object} params An object containing all parameters.
   * @param {Electron.BrowserWindow} params.window The main Electron browser window instance.
   * @param {UserSettings} params.userSettings User configuration settings loaded from an external source.
   * @param {function(UserSettings): void} params.onReload Callback function that should be called to handle the reload logic.
   */
  constructor( { window, userSettings, onReload } ) {
    this.userSettings = userSettings;
    this.window = window;
    this.minimizeReminder = false;
    this.lastUpdateNotification = false;
    this.isSearchingForUpdates = false;
    this.hasInternet = false;
    this.updateLocation = false;
    this.reloadCallback = onReload;
    this.remeshInfo = {
      location: false,
      version: false,
    };
    this.ociFolder = null;
    this.activeTasks = [];
    this.isInstalled = {
      OpenAL: false,
      LSO: false,
      TSO: false,
      NET: false,
      Simitone: false,
      TS1: false,
      Mono: false,
      SDL: false
    };
    if ( process.platform === 'win32' ) {
      this.window.on( 'minimize', () => {
        if ( ! this.minimizeReminder ) {
          Modal.sendNotification(
            'LegacySO Launcher',
            locale.current.MINIMIZE_REMINDER,
            null, null, this.isDarkMode()
          );
          this.minimizeReminder = true;
        }
        this.window.setSkipTaskbar( true );
        this.window.hide();
      } );
    }
    this.IPC = Toast.IPC = Modal.IPC = new IPCBridge( window );
    this.events = new Events( this );
    this.checkUpdatesRecursive();
    this.updateTipRecursive();
    this.updateInternetStatusRecursive();
    this.events.listen();
  }

  /**
   * Produces a soft launcher reload.
   * Only the renderer process gets reloaded.
   */
  reload() {
    if ( this.reloadCallback ) {
      this.reloadCallback( this.userSettings );
    }
  }

  /**
   * Reads the registry and updates the programs list.
   * Now includes enhanced multi-drive detection for external installations.
   *
   * @returns {Promise<void>} A promise that resolves when the programs
   *                          list and paths have been updated.
   */
  async updateInstalledPrograms() {
    const registry = require( './lib/registry' ),
      programs = await registry.getInstalled();

    for ( let i = 0; i < programs.length; i++ ) {
      this.isInstalled[ programs[ i ].key ] = programs[ i ].isInstalled;
    }
    console.info( 'updateInstalledPrograms (before enhanced detection)', this.isInstalled );

    // Always run enhanced detection to find external drive installations
    console.log('Running enhanced multi-drive detection...');
    await this.checkInstallations();

    console.info( 'updateInstalledPrograms (after enhanced detection)', this.isInstalled );
    this.IPC.sendInstalledPrograms( this.isInstalled );
  }

  /**
   * Update installer tips recursively, every 10 seconds.
   */
  updateTipRecursive() {
    const tips = [
      locale.current.TIP1,
      locale.current.TIP2,
      locale.current.TIP3,
      locale.current.TIP4,
      locale.current.TIP5,
      locale.current.TIP6,
      locale.current.TIP7,
      locale.current.TIP8,
      locale.current.TIP9,
      locale.current.TIP10,
      // locale.current.TIP11,
      locale.current.TIP12,
      locale.current.TIP13
    ];
    const randomTip = tips[ Math.floor( Math.random() * tips.length ) ];

    this.IPC.setTip( randomTip );
    setTimeout( () => this.updateTipRecursive(), 10000 );
  }

  /**
   * Returns the current internet status, and updates the global
   * this.hasInternet variable.
   *
   * @returns {Promise<boolean>} A promise that resolves to the current
   *                             internet status.
   */
  getInternetStatus() {
    const sites = [ 'google.com', 'bing.com', 'yahoo.com' ];
    return new Promise( ( resolve, _reject ) => {
      const doCheck = ( index ) => {
        if ( index >= sites.length ) {
          return resolve( false );
        }
        require( 'dns' ).lookup( sites[ index ], err => {
          if ( err && err.code === 'ENOTFOUND' ) {
            doCheck( index + 1 );
          } else {
            return resolve( true );
          }
        } );
      };
      doCheck( 0 );
    } );
  }

  /**
   * Obtains Simitone release information from GitHub.
   *
   * @returns {Promise<Object>} A promise that resolves to the Simitone
   *                          release data.
   */
  getSimitoneReleaseInfo() {
    return getJSON( simitoneUrl );
  }

  /**
   * Hides all view elements that need internet connection.
   */
  async updateInternetStatus() {
    this.hasInternet = await this.getInternetStatus();
    if ( ! this.hasInternet ) {
      return this.IPC.hasNoInternet();
    }
    return this.IPC.hasInternet();
  }

  /**
   * Recursively updates the current internet status.
   */
  updateInternetStatusRecursive() {
    setTimeout( () => {
      this.updateInternetStatus();
      this.updateInternetStatusRecursive();
    }, 5000 );
  }

  /**
   * Installs the game using the complete installer which installs FreeSO,
   * OpenAL, .NET, Mono, SDL, Mac-extras and The Sims Online.
   *
   * @param {string} folder Folder to install the game to.
   */
  async runFullInstall( folder ) {
    const fullInstaller = new ( require( './lib/installers/complete' ) )( this );
    try {
      this.addActiveTask( 'FULL' );
      await fullInstaller.install( folder );
      Modal.showFullInstalled();
    } catch ( err ) {
      console.error( 'runFullInstall', err );
    } finally {
      setTimeout( () => {
        this.removeActiveTask( 'FULL' );
        this.IPC.fullInstallProgressItem();
      }, 5000 );
    }
  }

  /**
   * Adds a task in progress.
   *
   * @param {string} name Name of the task in progress.
   */
  addActiveTask( name ) {
    if ( ! this.isActiveTask( name ) ) {
      console.info( 'addActiveTask', name );
      this.activeTasks.push( name );
    }
  }

  /**
   * Removes a task by name.
   *
   * @param {string} name Name of the task to remove.
   */
  removeActiveTask( name ) {
    if ( name ) {
      console.info( 'removeActiveTask', name );
      return this.activeTasks.splice( this.activeTasks.indexOf( name ), 1 );
    }
  }

  /**
   * Checks if task is active.
   *
   * @param {string} name Name of the task.
   */
  isActiveTask( name ) {
    return this.activeTasks.indexOf( name ) > -1;
  }

  /**
   * Returns a component's hard-coded pretty name.
   *
   * @param {string} componentCode The component's name.
   *
   * @returns {string} The component's pretty name.
   */
  getPrettyName( componentCode ) {
    const components = require('./constants').components;
    return components[componentCode] || componentCode;
  }

  /**
   * Obtains remesh package information.
   *
   * @returns {Promise<Object>} A promise that resolves to the response.
   */
  async getRemeshData() {
    const data = await getJSON( versionChecks.remeshPackageUrl );
    this.remeshInfo = {
      location: data.Location,
      version: data.Version
    };
    return data;
  }

  /**
   * Returns the launcher's update endpoint response.
   *
   * @returns {Promise<Object>} A promise that resolves to the response.
   */
  async getLauncherData() {
    const data = await getJSON(
      `${versionChecks.updatesUrl}?os=${require( 'os' ).release()}` +
      `&version=${version}` +
      `&lso=${( this.isInstalled && this.isInstalled.lSO ) ? '1' : '0'}`
    );
    this.updateLocation = data.Location;
    return data;
  }

  /**
   * Obtains remesh info and updates the renderer process.
   *
   * @returns {Promise<void>} A promise that resolves when the remesh info is obtained.
   */
  async checkRemeshInfo() {
    try {
      await this.getRemeshData();
    } catch ( err ) {
      captureWithSentry( err );
      console.error( err );
    }
    if ( this.remeshInfo?.version ) {
      this.IPC.setRemeshInfo( this.remeshInfo.version );
    }
  }

  /**
   * Checks Simitone requirements:
   * 1. If Simitone is installed
   * 2. If TS Complete Collection is installed.
   * 3. If Simitone needs an update.
   *
   * @returns {Promise<void>} A promise that resolves when the check is complete.
   */
  async checkSimitoneRequirements() {
    new Toast( locale.current.TOAST_CHECKING_UPDATES, 1500 );

    await this.updateInstalledPrograms();

    if ( ! this.isInstalled.Simitone ) {
      this.IPC.setSimitoneVersion( null );
      return this.IPC.sendSimitoneShouldUpdate( false );
    }

    this.IPC.setSimitoneVersion( this.userSettings.Game?.SimitoneVersion || null );

    let releaseInfo;
    try {
      releaseInfo = await this.getSimitoneReleaseInfo();
    } catch ( err ) {
      captureWithSentry( err );
      console.error( err );
    }
    const shouldUpdate = releaseInfo &&
      ( this.userSettings.Game.SimitoneVersion != releaseInfo.tag_name );
    this.IPC.sendSimitoneShouldUpdate( shouldUpdate ? releaseInfo.tag_name : false );
  }

  /**
   * Checks if any updates are available.
   *
   * @param {boolean} wasAutomatic Indicates if it has been requested by the recursive loop
   *                               to not spam the user with possible request error modals.
   *
   * @returns {Promise<void>} A promise that resolves when the update check is complete.
   */
  async checkLauncherUpdates( wasAutomatic ) {
    if (
      this.isSearchingForUpdates || ! this.hasInternet ||
      this.activeTasks.length !== 0
    ) return;

    const toast = new Toast( locale.current.TOAST_CHECKING_UPDATES );
    this.isSearchingForUpdates = true;

    try {
      const data = await this.getLauncherData();
      const isNewVersion = data?.Version && data.Version !== version;
      if ( isNewVersion ) {
        console.info( 'new launcher version available', data );
      }

      if ( isNewVersion && ( this.lastUpdateNotification !== data.Version || ! wasAutomatic ) ) {
        Modal.showInstallUpdate( data.Version );
        this.lastUpdateNotification = data.Version;
      }
    } catch ( err ) {
      captureWithSentry( err, { wasAutomatic } );
      console.error( err );
      if ( ! wasAutomatic ) Modal.showFailedUpdateCheck();
    } finally {
      toast.destroy();
      this.isSearchingForUpdates = false;
    }
  }

  /**
   * Opens a new window with the launcher's update page.
   *
   * @returns {Promise<void>} A promise that resolves when the window is opened.
   */
  async installLauncherUpdate() {
    return require( 'electron' ).shell.openExternal( updateWizardUrl );
  }

  /**
   * Changes the game path in the registry.
   *
   * @param {Object}         options           The options object.
   * @param {string}         options.component The component to change the path for.
   * @param {string|boolean} options.override  The path to change to.
   *
   * @returns {Promise<void>} A promise that resolves when the path is changed.
   */
  async changeGamePath( options ) {
    const toast = new Toast( locale.current.TOAST_CHPATH );
    try {
      await this.install( options.component, {
        fullInstall: false,
        override: options.override
      } );
      Modal.showChangedGamePath();
    } catch ( err ) {
      captureWithSentry( err, { options } );
      console.error( err );
      Modal.showFailedInstall( this.getPrettyName( options.component ), err );
    } finally {
      this.removeActiveTask( options.component );
      toast.destroy();
    }
  }

  /**
   * Displays the appropriate installation confirmation Modal.
   *
   * @param {string} componentCode The Component to be installed.
   */
  async fireInstallModal( componentCode ) {
    const missing = this.getMissingDependencies( componentCode );

    if ( this.requiresInternet( componentCode ) && ! this.hasInternet ) {
      console.info( `no internet to install ${componentCode}` );
      return Modal.showNoInternet();
    }
    if ( this.isActiveTask( componentCode ) ) {
      console.info( `already installing ${componentCode}` );
      return Modal.showAlreadyInstalling();
    }
    if ( missing.length > 0 ) {
      console.info( `missing requirements for ${componentCode}`, missing );
      return Modal.showRequirementsNotMet( missing );
    }
    await this.handleInstallationModal( componentCode );
  }

  /**
   * Returns an array of missing dependencies for a given component.
   *
   * @param {string} componentCode The Component for which dependencies
   *                               should be checked.
   *
   * @returns {Array<string>} An array of missing dependencies' pretty names.
   */
  getMissingDependencies( componentCode ) {
    const { dependencies } = require( './constants' );
    return ( dependencies[ componentCode ] || [] )
      .filter( dependency => ! this.isInstalled[ dependency ] )
      .map( dependency => this.getPrettyName( dependency ) );
  }

  /**
   * Checks if a component requires an internet connection for installation.
   *
   * @param {string} componentCode The Component to be checked.
   *
   * @returns {boolean} True if the component requires internet access,
   *                    false otherwise.
   */
  requiresInternet( componentCode ) {
    return require( './constants' ).needInternet.includes( componentCode );
  }

  /**
   * Handles the installation Modal display based on the component's
   * current installation status.
   *
   * @param {string} componentCode The Component to be installed.
   */
  async handleInstallationModal( componentCode ) {
    const prettyName = this.getPrettyName( componentCode );

    if ( componentCode === 'RMS' ) {
      if ( ! this.remeshInfo?.version ) {
        try {
          await this.getRemeshData();
        } catch ( err ) {
          captureWithSentry( err );
          console.error( err );
        }
        if ( ! this.remeshInfo?.version ) {
          console.info( 'no remesh pkg available', this.remeshInfo );
          return Modal.showNoRemesh();
        }
      }
    }
    if ( ! this.isInstalled[ componentCode ] ) {
      Modal.showFirstInstall( prettyName, componentCode );
    } else {
      Modal.showReInstall( prettyName, componentCode );
    }
  }

  /**
   * Installs a single Component.
   *
   * Each switch case instantiates and runs a different installer.
   * Any errors that are thrown should be handled by the caller.
   *
   * @param {string}         componentCode       The Component to install.
   * @param {Object}         options             The options object.
   * @param {boolean}        options.fullInstall Whether to do a full install.
   * @param {string|boolean} options.override    The path to change to.
   * @param {string}         options.dir         A predefined directory to install to.
   *
   * @returns {Promise<void>} A promise that resolves when the Component is installed.
   */
  async install( componentCode, options = { fullInstall: false, override: false, dir: false } ) {
    this.addActiveTask( componentCode );
    console.info( 'install', { componentCode, options } );
    try {
      let display = false;
      switch ( componentCode ) {
      case 'Mono':
      case 'MacExtras':
      case 'SDL':
      case 'RMS':
        display = await this.handleSimpleInstall( componentCode, options );
        break;
      case 'TSO':
      case 'LSO':
      case 'Simitone':
        display = await this.handleStandardInstall( componentCode, options );
        break;
      case 'OpenAL':
      case 'NET':
        display = await this.handleExecutableInstall( componentCode, options );
        break;
      default:
        console.error( 'invalid componentCode', componentCode );
        this.removeActiveTask( componentCode );
        throw new Error( strFormat( 'Component %s not found', componentCode ) );
      }
      if ( ! options.fullInstall && display ) {
        Modal.showInstalled( this.getPrettyName( componentCode ) );
      }
    } catch ( err ) {
      Modal.showFailedInstall( this.getPrettyName( componentCode ), err );
      this.setProgressBar( 1, { mode: 'error' } );
      captureWithSentry( err,
        { component: componentCode, options, isInstalled: this.isInstalled } );
      throw err;
    } finally {
      setTimeout( () => this.setProgressBar( -1 ), 5000 );
      this.removeActiveTask( componentCode );
      this.updateInstalledPrograms();
    }
  }

  /**
   * Runs an installer that does not need to ask the user for any input.
   *
   * @param {string}         componentCode       The Component to install.
   * @param {Object}         options             The options object.
   * @param {boolean}        options.fullInstall Whether to do a full install.
   * @param {string|boolean} options.override    The path to change to.
   * @param {string}         options.dir         A predefined directory to install to.
   *
   * @returns {Promise<boolean>}
   */
  async handleSimpleInstall( componentCode, options ) {
    const runner = require( './lib/installers' )[ componentCode ];
    const subfolder = componentCode === 'RMS' ? '/Content/MeshReplace' : '';
    const installer = new runner( this, this.isInstalled.LSO + subfolder );
    if ( ! options.fullInstall ) {
      this.IPC.changePage( 'downloads' );
    }
    await installer.install();

    if ( [ 'MacExtras', 'RMS' ].includes( componentCode )
      && this.isInstalled.Simitone ) {
      // Do an install for Simitone as well.
      const simitoneInstaller = new runner( this, this.isInstalled.Simitone + subfolder, 'Simitone' );
      await simitoneInstaller.install();
    }
    return true;
  }

  /**
   * Handles the standard installation process for a given component.
   *
   * @param {string}         componentCode       The code for the component being installed.
   * @param {Object}         options             The options object.
   * @param {boolean}        options.fullInstall Whether to do a full install.
   * @param {string|boolean} options.override    The path to change to.
   * @param {string}         options.dir         A predefined directory to install to.
   *
   * @returns {Promise<boolean>}
   */
  async handleStandardInstall( componentCode, options ) {
    const runner = require( './lib/installers' )[ componentCode ];

    if ( options.override ) {
      const {
        createMaxisEntry,
        createGameEntry,
        createSimitoneEntry
      } = require( './lib/registry' );

      // Modify registry to point to the override path.
      if ( componentCode === 'TSO' ) {
        await createMaxisEntry(
          this.setConfiguration.bind( this ), options.override
        );
      }
      if ( componentCode === 'LSO' ) {
        await createGameEntry(
          this.setConfiguration.bind( this ), options.override
        );
      }
      if ( componentCode === 'Simitone' ) {
        await createSimitoneEntry(
          this.setConfiguration.bind( this ), options.override
        );
      }
      return false;
    }

    // No override, so we need to get the install path.
    let installDir = options.dir; // Start with a predefined base directory.
    if ( ! installDir ) {
      installDir = await this.obtainInstallDirectory( componentCode );
    }
    console.info( 'installDir chosen', { installDir } );
    if ( ! installDir ) {
      return false;
    }
    const installer = new runner( this, installDir );
    const isInstalled = await installer.isInstalledInPath();

    if ( isInstalled && ! options.fullInstall && ! options.dir &&
      await ( require( './lib/registry' ).hasRegistryAccess() ) ) {
      // Already installed in the given path, let the user know.
      Modal.showAlreadyInstalled( this.getPrettyName( componentCode ),
        componentCode, installDir );
      console.info( 'already installed', { componentCode } );
      return false;
    }
    if ( ! options.fullInstall ) {
      this.IPC.changePage( 'downloads' );
    }
    console.info( 'starting the installation', { componentCode } );
    await installer.install();

    return true;
  }

  /**
   * Handles the installation process for an executable component.
   *
   * @param {string}         componentCode       The code for the component being installed.
   * @param {Object}         options             The options object.
   * @param {boolean}        options.fullInstall Whether to do a full install.
   * @param {string|boolean} options.override    The path to change to.
   * @param {string}         options.dir         A predefined directory to install to.
   *
   * @returns {Promise<boolean>}
   */
  async handleExecutableInstall( componentCode, options ) {
    const runner = require( './lib/installers/executable' );
    const installer = new runner();
    const file = componentCode === 'NET' ? 'NDP46-KB3045560-Web.exe' : 'oalinst.exe';
    let cmdOptions;
    if ( options.fullInstall ) {
      cmdOptions = componentCode === 'NET' ? [ '/q', '/norestart' ]  : [ '/SILENT' ];
    }
    await installer.run( file, cmdOptions );

    return false;
  }

  /**
   * Manually scans all drives for existing game installations
   * @param {string} gameType - Optional game type to search for ('LSO', 'TSO', 'Simitone')
   * @returns {Promise<void>}
   */
  async scanForExistingInstallations(gameType = null) {
    const { findGameInstallations, validateGameInstallation } = require('./lib/utils');
    const Modal = require('./lib/modal');
    const Toast = require('./lib/toast');

    const toast = new Toast('Scanning all drives for game installations...');

    try {
      const gamesToScan = gameType ? [gameType] : ['LSO', 'TSO', 'Simitone'];
      const allFoundInstallations = {};

      for (const game of gamesToScan) {
        console.log(`Scanning for ${game} installations...`);
        const installations = await findGameInstallations(game);

        const validInstallations = [];
        for (const installation of installations) {
          const isValid = await validateGameInstallation(installation.path, game);
          if (isValid) {
            validInstallations.push(installation);
          }
        }

        if (validInstallations.length > 0) {
          allFoundInstallations[game] = validInstallations;
        }
      }

      toast.destroy();

      if (Object.keys(allFoundInstallations).length === 0) {
        Modal.getIPC().sendInfoModal(
          'No Installations Found',
          'No game installations were found on any connected drives.',
          'OK'
        );
        return;
      }

      // Show found installations to user
      let message = 'Found the following game installations:\n\n';
      for (const [game, installations] of Object.entries(allFoundInstallations)) {
        message += `${game}:\n`;
        for (const installation of installations) {
          message += `  • ${installation.path} (${installation.drive})\n`;
        }
        message += '\n';
      }
      message += 'Would you like to register these installations with the launcher?';

      const response = await Modal.getIPC().sendQuestionModal(
        'Game Installations Found',
        message,
        ['Register All', 'Select Manually', 'Cancel']
      );

      if (response === 0) { // Register All
        await this.registerFoundInstallations(allFoundInstallations);
      } else if (response === 1) { // Select Manually
        await this.selectInstallationsToRegister(allFoundInstallations);
      }

    } catch (error) {
      toast.destroy();
      console.error('Error scanning for installations:', error);
      Modal.getIPC().sendErrorModal(
        'Scan Error',
        'An error occurred while scanning for game installations.',
        'OK'
      );
    }
  }

  /**
   * Registers found installations with the launcher
   * @param {Object} foundInstallations - Object containing found installations by game type
   */
  async registerFoundInstallations(foundInstallations) {
    const registry = require('./lib/registry');
    const path = require('path');

    try {
      for (const [game, installations] of Object.entries(foundInstallations)) {
        if (installations.length > 0) {
          const installation = installations[0]; // Use the first valid installation

          console.log(`Registering ${game} installation: ${installation.path}`);

          if (game === 'LSO') {
            await registry.saveToLocalRegistry(
              this.setConfiguration.bind(this),
              'LSO',
              installation.executable
            );
            this.isInstalled.LSO = installation.path;
          } else if (game === 'TSO') {
            await registry.saveToLocalRegistry(
              this.setConfiguration.bind(this),
              'TSO',
              installation.executable
            );
            this.isInstalled.TSO = installation.path;
          }
        }
      }

      // Update UI
      this.IPC.updateInstallationProgress(this.isInstalled);

      const Toast = require('./lib/toast');
      new Toast('Game installations registered successfully!');

    } catch (error) {
      console.error('Error registering installations:', error);
    }
  }

  /**
   * Allows user to select which installations to register
   * @param {Object} foundInstallations - Object containing found installations by game type
   */
  async selectInstallationsToRegister(foundInstallations) {
    // For now, just register all - could be enhanced with a proper selection UI
    await this.registerFoundInstallations(foundInstallations);
  }

  /**
   * Prompts the user to choose an installation folder for a given component.
   *
   * @param {string} componentCode The code for the component being installed.
   *
   * @returns {Promise<string|null>} The selected installation folder or
   *                                 null if the user cancels.
   */
  async askForInstallFolder( componentCode ) {
    const toast = new Toast(
      `${locale.current.INSTALLER_CHOOSE_WHERE_X} ${this.getPrettyName( componentCode )}`
    );

    // Use enhanced directory picker for better drive selection
    const folders = await Modal.showEnhancedDirectoryPicker(
      this.getPrettyName( componentCode ), this.window
    );

    toast.destroy();
    if ( folders && folders.length > 0 ) {
      const selectedPath = folders[ 0 ];
      const componentPath = selectedPath + '/' + this.getPrettyName( componentCode );

      // Validate the selected path
      try {
        const { checkDiskSpace } = require('./lib/utils');
        const spaceInfo = await checkDiskSpace(selectedPath);

        // Check if there's enough space (assuming 5GB minimum requirement)
        const requiredSpaceGB = 5;
        if (spaceInfo.freeGB !== 'Unknown' && spaceInfo.freeGB < requiredSpaceGB) {
          Modal.getIPC().sendErrorModal(
            'Insufficient Space',
            `The selected drive has only ${spaceInfo.freeGB}GB free space. At least ${requiredSpaceGB}GB is recommended for installation.`,
            'OK'
          );
          return null;
        }

        console.log(`Selected installation path: ${componentPath}`);
        console.log(`Available space: ${spaceInfo.freeGB}GB`);

      } catch (error) {
        console.warn('Could not check disk space:', error);
      }

      return componentPath;
    }
    return null;
  }

  /**
   * Obtains the installation directory for a given component.
   *
   * @param {string} componentCode The code for the component being installed.
   *
   * @returns {Promise<string>} The installation directory for the component.
   */
  async obtainInstallDirectory( componentCode ) {
    if ( await ( require( './lib/registry' ).hasRegistryAccess() ) ) {
      // Check user's default installation drive preference
      const defaultDrive = this.userSettings?.Launcher?.DefaultInstallDrive || 'auto';

      if (defaultDrive === 'custom') {
        // Always ask the user
        return this.askForInstallFolder( componentCode );
      }

      if (defaultDrive !== 'auto' && process.platform === 'win32') {
        // Use the specified drive
        const drivePath = defaultDrive.endsWith(':') ? defaultDrive + '\\' : defaultDrive;
        try {
          const fs = require('fs-extra');
          await fs.access(drivePath);

          // For TSO, maintain directory structure
          if ( componentCode === 'TSO' ) {
            return `${drivePath}LegacySO Game/The Sims Online`.replace(/\\/g, '/');
          }
          return `${drivePath}LegacySO Game/${this.getPrettyName( componentCode )}`.replace(/\\/g, '/');
        } catch (error) {
          console.warn(`Specified drive ${defaultDrive} not accessible, falling back to user selection`);
          return this.askForInstallFolder( componentCode );
        }
      }

      // Auto-detect best drive or fall back to default behavior
      if (defaultDrive === 'auto' && process.platform === 'win32') {
        try {
          const { getAvailableDrives } = require('./lib/utils');
          const drives = await getAvailableDrives();

          // Find the drive with the most free space (excluding C: if possible)
          let bestDrive = drives.find(d => d.letter === 'C:');
          for (const drive of drives) {
            if (drive.letter !== 'C:' && drive.freeSpaceGB > (bestDrive?.freeSpaceGB || 0)) {
              bestDrive = drive;
            }
          }

          if (bestDrive && bestDrive.freeSpaceGB > 10) { // At least 10GB free
            const drivePath = bestDrive.path;
            if ( componentCode === 'TSO' ) {
              return `${drivePath}LegacySO Game/The Sims Online`.replace(/\\/g, '/');
            }
            return `${drivePath}LegacySO Game/${this.getPrettyName( componentCode )}`.replace(/\\/g, '/');
          }
        } catch (error) {
          console.warn('Auto-detection failed, falling back to user selection:', error);
        }
      }

      // For TSO, we should always use the LegacySO Game directory structure
      if ( componentCode === 'TSO' ) {
        return process.platform === 'win32'
          ? 'C:/Program Files/LegacySO Game/The Sims Online'
          : `${appData}/GameComponents/The Sims Online`;
      }
      return this.askForInstallFolder( componentCode );
    } else {
      // Use well-known paths
      if ( ['darwin', 'linux'].includes( process.platform ) ) {
        return appData + '/GameComponents/' + this.getPrettyName( componentCode );
      }
      // For Windows, maintain LegacySO Game directory structure
      return 'C:/Program Files/LegacySO Game/' + this.getPrettyName( componentCode );
    }
  }

  /**
   * Checks for all types of updates recursively.
   */
  checkUpdatesRecursive() {
    setTimeout( () => {
      this.checkLauncherUpdates( true );
      this.checkRemeshInfo();
      this.checkUpdatesRecursive();
    }, versionChecks.interval );
  }

  /**
   * Switches the game language.
   * Copies the translation files and changes the current language in FreeSO.ini.
   *
   * @param {string} langString The language to change to. Example: 'English', 'Spanish'.
   *
   * @returns {Promise<void>} A promise that resolves when the language is changed.
   */
  async switchLanguage( langString ) {
    langString = this.validateLangString( langString );

    if ( ! this.isInstalled.TSO || ! this.isInstalled.LSO ) {
      return Modal.showNeedLSOTSO();
    }

    this.addActiveTask( 'CHLANG' );

    const toast = new Toast( locale.current.TOAST_LANGUAGE );

    let data;
    try {
      data = await this.getLSOConfig();
    } catch ( err ) {
      captureWithSentry( err, { langString } );
      console.error( err );
      this.removeActiveTask( 'CHLANG' );
      toast.destroy();
      return Modal.showFirstRun();
    }

    data.CurrentLang = langString;

    try {
      const configIniPath = this.isInstalled.LSO + '/Content/config.ini';
      await require( 'fs-extra' ).writeFile( configIniPath, require( 'ini' ).stringify( data ) );
    } catch ( err ) {
      captureWithSentry( err, { langString } );
      this.removeActiveTask( 'CHLANG' );
      toast.destroy();
      return Modal.showIniFail();
    }

    this.removeActiveTask( 'CHLANG' );
    toast.destroy();

    return this.updateAndPersistConfig( 'Game', 'Language', langString );
  }

  /**
   * Updates a configuration variable based on user input.
   *
   * @param {Object} newConfig The new configuration object.
   *
   * @returns {Promise<void>} A promise that resolves when the configuration is updated.
   */
  async setConfiguration( newConfig ) {
    const [ category, key, value ] = newConfig;

    if ( category === 'Game' && key === 'Language' ) {
      return this.switchLanguage( value );
    } else if ( key === 'GraphicsMode' ) {
      return this.handleGraphicsModeChange( value );
    } else if ( category === 'Launcher' && key === 'Language' ) {
      return this.setLauncherLanguage( value );
    } else {
      return this.updateAndPersistConfig( category, key, value );
    }
  }

  /**
   * Handles changes to the graphics mode setting.
   *
   * @param {string} newValue The new graphics mode value.
   *
   * @returns {Promise<void>} A promise that resolves when the graphics mode is changed.
   */
  handleGraphicsModeChange( newValue ) {
    const oldGraphicsMode = this.userSettings.Game.GraphicsMode;

    if ( newValue === 'sw' && oldGraphicsMode !== 'sw' ) {
      if ( ! this.isInstalled.LSO ) {
        Modal.showNeedLSOTSO();
      } else {
        return this.toggleSoftwareMode( true );
      }
    } else if ( newValue !== 'sw' && oldGraphicsMode === 'sw' ) {
      return this.toggleSoftwareMode( false, newValue );
    } else {
      return this.updateAndPersistConfig( 'Game', 'GraphicsMode', newValue );
    }
  }

  /**
   * Toggles software mode on or off.
   *
   * @param {boolean} enable   If true, enable software mode, otherwise
   *                           disable it.
   * @param {string}  newValue The new graphics mode value.
   *
   * @returns {Promise<void>} A promise that resolves when the graphics mode is changed.
   */
  async toggleSoftwareMode( enable, newValue ) {
    try {
      if ( enable ) {
        await this.enableSoftwareMode();
        Modal.showSoftwareModeEnabled();
      } else {
        await this.disableSoftwareMode();
      }
      return this.updateAndPersistConfig( 'Game', 'GraphicsMode', enable ? 'sw' : newValue );
    } catch ( err ) {
      captureWithSentry( err );
      console.error( err );
      Modal.showGenericError( err.message );
    }
  }

  /**
   * Sets the launcher language and shows a language change modal.
   *
   * @param {string} value The new language value.
   *
   * @returns {Promise<void>} A promise that resolves when the language is changed.
   */
  async setLauncherLanguage( value ) {
    await this.updateAndPersistConfig( 'Launcher', 'Language', value );

    // Do not allow hot reload if something's going on, as it can break
    // any ongoing progress UI
    if ( this.activeTasks.length ) {
      return Modal.showLanguageOnRestart();
    }

    this.reload();
  }

  /**
   * Updates a configuration variable and persists it if necessary.
   *
   * @param {string} category The configuration category.
   * @param {string} key      The configuration key.
   * @param {*}      value    The new configuration value.
   *
   * @returns {Promise<void>} A promise that resolves when the configuration
   *                          has been updated and persisted.
   */
  updateAndPersistConfig( category, key, value ) {
    this.userSettings[ category ] = this.userSettings[ category ] || {};
    this.userSettings[ category ][ key ] = value;

    return this.persist();
  }

  /**
   * Disables Software Mode and removes dxtn.dll and opengl32.dll.
   */
  async disableSoftwareMode() {
    const toast = new Toast( locale.current.TOAST_DISABLING_SWM );
    this.addActiveTask( 'CHSWM' );
    try {
      await require( 'fs-extra' ).remove( this.isInstalled.LSO + '/dxtn.dll' );
      await require( 'fs-extra' ).remove( this.isInstalled.LSO + '/opengl32.dll' );
    } finally {
      toast.destroy();
      this.removeActiveTask( 'CHSWM' );
    }
  }

  /**
   * Enables Software Mode and adds the needed files.
   *
   * @returns {Promise<void>} A promise that resolves when the operation is complete.
   */
  async enableSoftwareMode() {
    const toast = new Toast( locale.current.TOAST_ENABLING_SWM );
    this.addActiveTask( 'CHSWM' );
    try {
      await require( 'fs-extra' ).copy( 'bin/dxtn.dll', this.isInstalled.LSO + '/dxtn.dll' );
      await require( 'fs-extra' ).copy( 'bin/opengl32.dll', this.isInstalled.LSO + '/opengl32.dll' );
    } finally {
      toast.destroy();
      this.removeActiveTask( 'CHSWM' );
    }
  }

  /**
   * Runs FreeSO or Simitone's executable.
   *
   * @param {boolean} useVolcanic If Volcanic.exe should be launched.
   */
  play(useVolcanic, isSimitone = false) {
    if (['darwin', 'linux'].includes(process.platform)) {
        useVolcanic = false;
    }

    if (!this.isInstalled.LSO && !isSimitone) {
        return Modal.showNeedToPlay();
    }

    if (this.isActiveTask('CHLANG')) {
        return Modal.showFailPlay();
    }

    if (useVolcanic) {
        if (isSimitone) {
            return Modal.showVolcanicPromptSimitone();
        }
        return Modal.showVolcanicPrompt();
    }

    // Fix the path construction - don't append executable name if it's already in the path
    const exeLocation = isSimitone
        ? path.join(this.isInstalled.Simitone, 'Simitone.Windows.exe')
        : (this.isInstalled.LSO.endsWith('LegacySO.exe')
            ? this.isInstalled.LSO
            : path.join(this.isInstalled.LSO, 'LegacySO.exe'));

    require('fs-extra').stat(exeLocation, (err, _stat) => {
        if (err) {
            captureWithSentry(err, {
                exeLocation, useVolcanic, isSimitone, userSettings: this.userSettings,
                isInstalled: this.isInstalled
            });
            console.error('could not find exe', {
                exeLocation, useVolcanic, isSimitone, userSettings: this.userSettings,
                isInstalled: this.isInstalled
            });
            return Modal.showCouldNotRecover(exeLocation, isSimitone);
        }
        this.launchGame(false, isSimitone);
    });
  }

  /**
   * Ensures the game configuration is properly set up for proxy connectivity
   * @param {string} gamePath - Path to the game installation
   * @returns {Promise<void>}
   */
  async ensureGameProxyConfig(gamePath) {
    try {
      const fs = require('fs-extra');
      const ini = require('ini');
      const path = require('path');

      const configPath = path.join(gamePath, 'Content', 'config.ini');

      // Check if config file exists
      if (!await fs.pathExists(configPath)) {
        console.warn('Game config.ini not found, creating default configuration');
        // Create a basic config if it doesn't exist
        const defaultConfig = {
          CurrentLang: 'english',
          UseCustomServer: 'True',
          GameEntryUrl: 'https://api.legacyso.org',
          CitySelectorUrl: 'https://api.legacyso.org',
          LanguageCode: '1',
          Windowed: 'True',
          SkipIntro: 'True'
        };
        await fs.writeFile(configPath, ini.stringify(defaultConfig));
        console.log('Created default game configuration');
        return;
      }

      // Read existing config
      const configContent = await fs.readFile(configPath, 'utf8');
      const config = ini.parse(configContent);

      // Ensure proxy-related settings are correct
      let configChanged = false;

      // Ensure the game uses the custom server
      if (config.UseCustomServer !== 'True') {
        config.UseCustomServer = 'True';
        configChanged = true;
      }

      // Ensure correct server URLs
      if (config.GameEntryUrl !== 'https://api.legacyso.org') {
        config.GameEntryUrl = 'https://api.legacyso.org';
        configChanged = true;
      }

      if (config.CitySelectorUrl !== 'https://api.legacyso.org') {
        config.CitySelectorUrl = 'https://api.legacyso.org';
        configChanged = true;
      }

      // Add proxy settings for blog and lots data
      if (config.BlogUrl !== 'http://localhost:30632/blog') {
        config.BlogUrl = 'http://localhost:30632/blog';
        configChanged = true;
      }

      if (config.TrendingLotsUrl !== 'http://localhost:30632/trending-lots') {
        config.TrendingLotsUrl = 'http://localhost:30632/trending-lots';
        configChanged = true;
      }

      // Ensure proxy is enabled
      if (config.UseProxy !== 'True') {
        config.UseProxy = 'True';
        configChanged = true;
      }

      if (config.ProxyPort !== '30632') {
        config.ProxyPort = '30632';
        configChanged = true;
      }

      // Save config if changed
      if (configChanged) {
        await fs.writeFile(configPath, ini.stringify(config));
        console.log('Updated game configuration for proxy connectivity');
      }

    } catch (error) {
      console.error('Error ensuring game proxy config:', error);
    }
  }

  /**
   * Verifies that the proxy server is running and accessible
   * @returns {Promise<boolean>}
   */
  async verifyProxyServer() {
    try {
      const http = require('http');

      return new Promise((resolve) => {
        const req = http.get('http://localhost:30632/blog', (res) => {
          console.log('Proxy server is running and accessible');
          resolve(true);
        });

        req.on('error', (error) => {
          console.warn('Proxy server not accessible:', error.message);
          console.warn('Blog and lots data may not load in game');
          resolve(false);
        });

        req.setTimeout(2000, () => {
          console.warn('Proxy server connection timeout');
          req.destroy();
          resolve(false);
        });
      });
    } catch (error) {
      console.error('Error verifying proxy server:', error);
      return false;
    }
  }

  /**
   * Launches the game with the user's configuration.
   *
   * @param {boolean} useVolcanic If Volcanic.exe should be launched.
   * @param {boolean} isSimitone  If Simitone should be launched.
   * @param {string}  subfolder   Subfolder if game is in subfolder.
   */
  async launchGame( useVolcanic, isSimitone = false, subfolder ) {
    const gameFilename = isSimitone ? 'Simitone.Windows.exe' : 'LegacySO.exe';
    let file = useVolcanic ? 'Volcanic.exe' : gameFilename;
    let cwd = isSimitone
      ? this.isInstalled.Simitone
      : this.isInstalled.LSO;

    // Ensure game configuration is set up for proxy connectivity
    if (!isSimitone && this.isInstalled.LSO) {
      console.log('Ensuring game proxy configuration...');
      await this.ensureGameProxyConfig(this.isInstalled.LSO);

      // Verify proxy server is running
      await this.verifyProxyServer();
    }

    if ( ! cwd ) {
      captureWithSentry( new Error( 'Entered launchGame without cwd' ), {
        cwd, file, useVolcanic, isSimitone,
        userSettings: this.userSettings, isInstalled: this.isInstalled, subfolder
      } );
      console.error( 'launchGame with no cwd', {
        cwd, file, useVolcanic, isSimitone,
        userSettings: this.userSettings, isInstalled: this.isInstalled, subfolder
      } );
      return Modal.showNeedToPlay();
    }

    const toastText = isSimitone
      ? locale.current.TOAST_LAUNCHING.replace( 'FreeSO', 'Simitone' )
      : locale.current.TOAST_LAUNCHING;
    const toast = new Toast( toastText );
    const args = [];

    // windowed by default
    args.push( 'w' );
    // game language, by default english
    if ( ! isSimitone ) {
      // for now disable this for Simitone
      args.push( `-lang${this.getEffectiveLangCode()}` );
    }
    // SW only allows ogl
    let graphicsMode = this.userSettings.Game.GraphicsMode != 'sw'
      ? this.userSettings.Game.GraphicsMode : 'ogl';
    if ( [ 'darwin', 'linux' ].includes( process.platform ) ) graphicsMode = 'ogl';
    args.push( `-${graphicsMode}` );
    // 3d is forced off when in SW
    if ( this.userSettings.Game[ '3DMode' ] === '1' && ( this.userSettings.Game.GraphicsMode != 'sw' || isSimitone ) ) {
      args.push( '-3d' );
    }
    if ( isSimitone && useVolcanic ) {
      // w Simitone you need to launch Simitone.Windows.exe with the -ide flag
      args.push( '-ide' );
      file = 'Simitone.Windows.exe';
    }
    if ( isSimitone && this.userSettings.Game.SimitoneAA === '1' ) {
      args.push( '-aa' );
    }
    // hz option
    args.push( `-hz${this.getEffectiveRefreshRate()}` );

    if ( subfolder ) {
      cwd += subfolder;
    }

    if ( [ 'darwin', 'linux' ].includes( process.platform ) ) {
      if ( isSimitone ) {
        file = '/Library/Frameworks/Mono.framework/Commands/mono';
        if ( process.platform === 'linux' ) {
          file = '/usr/bin/mono';
        }
        args.unshift( 'Simitone.Windows.exe' );
      } else {
        file = process.platform === 'darwin' ? './legacyso.command' : './legacyso-linux.command';
      }
    }
    const spawnOptions = {
      cwd, detached: true, stdio: 'ignore'
    };
    if ( [ 'darwin', 'linux' ].includes( process.platform ) ) {
      spawnOptions.shell = true;
    }
    console.info( 'run', file + ' ' + args.join( ' ' ), cwd );

    /**
     * @type {import("child_process").ChildProcess}
     */
    const launchedProcess = require( 'child_process' ).spawn( file, args, spawnOptions );

    // Detach the child process from the parent.
    launchedProcess.unref();

    launchedProcess.on( 'error', err =>
      console.error( `${file} child process emitted error`, err )
    );

    if ( launchedProcess?.pid ) {
      console.info( `${file} executed successfully`, {
        pid: launchedProcess.pid
      } );
    } else {
      console.error( `${file} did not execute!` );
    }

    setTimeout( () => toast.destroy(), 5000 );
  }

  /**
   * Promise that returns FreeSO configuration variables.
   *
   * @returns {Promise<Object>} A promise that returns FreeSO configuration variables.
   */
  getLSOConfig() {
    return new Promise( ( resolve, reject ) => {
      const ini = require( 'ini' );
      const fs  = require( 'fs-extra' );

      fs.readFile(
        this.isInstalled.LSO + '/Content/config.ini',
        'utf8',
        ( err, data ) => {
          if ( err ) return reject( err );
          return resolve( ini.parse( data ) );
        }
      );
    } );
  }

  /**
   * Returns hardcoded language integers from the language string.
   *
   * @param {string} langString The language string. Example: 'English', 'Spanish'.
   *
   * @returns {number|undefined} The language code.
   */
  getLangCode( langString ) {
    return require( './constants' ).gameLanguages[ langString ];
  }

  /**
   * Save the current state of the configuration.
   *
   * @returns {Promise<void>} A promise that resolves when the configuration is saved.
   */
  async persist() {
    const toast = new Toast( locale.current.TOAST_SETTINGS );
    const fs = require( 'fs-extra' );
    const ini = require( 'ini' );
    try {
      await fs.writeFile(
        appData + '/LSOLauncher.ini',
        ini.stringify( this.userSettings )
      );
      console.info( 'persist', this.userSettings );
    } catch ( err ) {
      captureWithSentry( err );
      console.error( 'error persisting', { err, userSettings: this.userSettings } );
    } finally {
      setTimeout( () => toast.destroy(), 1500 );
      this.IPC.restoreConfiguration( this.userSettings );
    }
  }

  /**
   * Sets the native progress bar to the given value.
   *
   * @param {number} val The value to set.
   * @param {Electron.ProgressBarOptions} options The options to use.
   */
  setProgressBar( val, options ) {
    if ( ! this.window || this.window.isDestroyed() ) return;
    try {
      this.window.setProgressBar( val, options );
    } catch ( err ) {
      captureWithSentry( err );
      console.error( err );
    }
  }

  /**
   * Returns if the current theme is considerd dark.
   *
   * @returns {boolean} If the theme is dark.
   */
  isDarkMode() {
    return darkThemes.includes( this.userSettings.Launcher.Theme );
  }

  /**
   * Picks a folder for the OCI (one-click installer) flow.
   */
  async ociPickFolder() {
    const { ociName } = require( './constants' ).registry;
    const folders = await Modal.showChooseDirectory( ociName, this.window );
    if ( folders && folders.length > 0 ) {
      this.ociFolder = folders[ 0 ] + '/' + ociName;
      this.IPC.ociPickedFolder( this.ociFolder );
    }
  }

  /**
   * Once the DOM is ready, this method is called.
   */
  initDOM() {
    this.IPC.setTheme( this.userSettings.Launcher.Theme === 'auto' ? nativeTheme.shouldUseDarkColors ? 'dark' : 'open_beta' : this.userSettings.Launcher.Theme );
    this.IPC.setMaxRefreshRate( getDisplayRefreshRate() );
    this.IPC.restoreConfiguration( this.userSettings );
    this.checkRemeshInfo();
    this.updateInternetStatus();
    this.window.focus();
  }

  /**
   * Returns the refresh rate to use.
   *
   * @returns {number} The refresh rate to use.
   */
  getEffectiveRefreshRate() {
    const savedRefreshRate = this.userSettings?.Game?.RefreshRate;
    if ( ! savedRefreshRate ) {
      return defaultRefreshRate;
    }
    return parseInt( savedRefreshRate );
  }

  /**
   * Returns the language string to use.
   *
   * @param {string} langString The language string. Example: 'English', 'Spanish'.
   *
   * @returns {string} The language string to use.
   */
  validateLangString( langString ) {
    if ( ! langString ) {
      return defaultGameLanguage;
    }
    if ( undefined === this.getLangCode( langString ) ) {
      return defaultGameLanguage;
    }
    return langString;
  }

  /**
   * Returns the current game language code to use.
   *
   * @returns {number} The language code to use.
   */
  getEffectiveLangCode() {
    const langString = this.validateLangString( this.userSettings?.Game?.Language );

    return this.getLangCode( langString );
  }

  /**
   * Opens a folder in file explorer.
   *
   * @param {string} componentCode The component code to open its location.
   */
  openFolder( componentCode ) {
    return new Promise( ( resolve, reject ) => {
      let path = this.isInstalled[ componentCode ];

      if ( process.platform === 'win32' ) {
        path = path.replace( /\//g, '\\' );
      }

      shell.openPath( path ).then( ( response ) => {
        if ( response === '' ) {
          return resolve();
        }
        reject( response );
      } );
    } );
  }

  changeToAppropriateTheme() {
    if ( this.userSettings.Launcher.Theme === 'auto' ) {
      this.IPC.setTheme( nativeTheme.shouldUseDarkColors ? 'dark' : 'open_beta' );
    }
  }

  titleBarMinimize() {
    this.window.minimize();
  }

  titleBarClose() {
    this.window.close();
  }

  /**
   * Checks installation status of LSO and TSO components and validates their paths.
   * Ensures proper path resolution to avoid duplicate path segments.
   * Uses enhanced multi-drive detection to find custom installations.
   * @returns {Promise<void>}
   */
  async checkInstallations() {
    const path = require('path');
    const { findGameInstallations, validateGameInstallation } = require('./lib/utils');
    const LSOInstaller = require('./lib/installers/lso');
    const TSOInstaller = require('./lib/installers/tso');

    try {
      console.log('Starting enhanced installation detection...');

      // First, check if we already have valid installations
      let lsoInstalled = this.isInstalled.LSO;
      let tsoInstalled = this.isInstalled.TSO;

      console.log('Current installation status:', { LSO: lsoInstalled, TSO: tsoInstalled });

      // If standard detection failed, use enhanced multi-drive search
      if (!lsoInstalled) {
        console.log('Standard LSO detection failed, searching all drives...');
        const lsoInstallations = await findGameInstallations('LSO');

        if (lsoInstallations.length > 0) {
          // Use the first valid installation found
          for (const installation of lsoInstallations) {
            const isValid = await validateGameInstallation(installation.path, 'LSO');
            if (isValid) {
              lsoInstalled = installation.path;
              console.log(`Found valid LSO installation: ${installation.path}`);

              // Update the local registry with the found installation
              const registry = require('./lib/registry');
              await registry.saveToLocalRegistry(
                this.setConfiguration.bind(this),
                'LSO',
                installation.executable
              );
              break;
            }
          }
        }
      }

      if (!tsoInstalled) {
        console.log('Standard TSO detection failed, searching all drives...');
        const tsoInstallations = await findGameInstallations('TSO');

        if (tsoInstallations.length > 0) {
          // Use the first valid installation found
          for (const installation of tsoInstallations) {
            const isValid = await validateGameInstallation(installation.path, 'TSO');
            if (isValid) {
              tsoInstalled = installation.path;
              console.log(`Found valid TSO installation: ${installation.path}`);

              // Update the local registry with the found installation
              const registry = require('./lib/registry');
              await registry.saveToLocalRegistry(
                this.setConfiguration.bind(this),
                'TSO',
                path.join(installation.path, 'TSOClient', 'TSOClient.exe')
              );
              break;
            }
          }
        }
      }

      // Normalize paths to prevent double path segments
      this.isInstalled.LSO = lsoInstalled ? path.normalize(lsoInstalled) : false;
      this.isInstalled.TSO = tsoInstalled ? path.normalize(tsoInstalled) : false;

      // Update UI with installation status
      this.IPC.sendInstalledPrograms(this.isInstalled);

      console.log('Enhanced installation detection complete:', {
        LSO: this.isInstalled.LSO,
        TSO: this.isInstalled.TSO
      });

      // If we found installations on external drives, notify the user
      if (this.isInstalled.LSO || this.isInstalled.TSO) {
        const foundOnExternalDrive =
          (this.isInstalled.LSO && !this.isInstalled.LSO.startsWith('C:')) ||
          (this.isInstalled.TSO && !this.isInstalled.TSO.startsWith('C:'));

        if (foundOnExternalDrive) {
          console.log('Game installations detected on external/secondary drives');
          // Could show a toast notification here if desired
        }
      }

    } catch (error) {
      console.error('Error checking installations:', error);
    }
  }
}

module.exports = LSOLauncher;













