const { _electron: electron } = require( 'playwright' );
const { test } = require( '@playwright/test' );
const { findLatestBuild, parseElectronApp } = require( 'electron-playwright-helpers' );
const fs = require( 'fs-extra' );
const path = require( 'path' );
const { spawn } = require( 'child_process' );

module.exports = () => {
  /** @type {import('playwright').Page} */
  let page;

  /** @type {import('playwright').ElectronApplication} */
  let electronApp;

  /** @type {string} */
  let latestBuild;

  /** @type {import('electron-playwright-helpers').ElectronAppInfo} */
  let appInfo;

  /** @type {string} */
  let exeDir;

  /** @type {string} */
  let appData;

  /** @type {string} */
  let installDir;

  /** @type {string[]} */
  let logs = [];

  test.beforeAll( async () => {
    latestBuild = findLatestBuild( '../release' );
    console.log( '[beforeAll] latestBuild', latestBuild );
    appInfo = parseElectronApp( latestBuild );
    exeDir = path.dirname( appInfo.executable );
    appData = exeDir;
    if ( process.platform === 'darwin' ) {
      appData = require( 'os' ).homedir() + '/Library/Application Support/LegacySO Launcher';
    }
    if ( process.platform === 'linux' ) {
      appData = require( 'os' ).homedir() + '/.fsolauncher';
    }
    installDir = process.platform === 'win32' ? 'C:\\Users\\Public\\TéstFõldér' :
      appData + '/GameComponents';

    fs.existsSync( `${appData}/FSOLauncher.ini` ) && fs.unlinkSync( `${appData}/FSOLauncher.ini` );
    console.info( '[beforeAll] exeDir', exeDir );
    console.info( '[beforeAll] appInfo', appInfo );
    console.info( '[beforeAll] appData', appData );
    console.info( '[beforeAll] installDir', installDir );

    // Wrap the Electron launch in a promise
    await new Promise( ( resolve, reject ) => {
      const electronProcess = spawn( appInfo.executable, [ appInfo.main, '--disable-http-cache', '--fl-test-mode' ], {
        cwd: exeDir,
        stdio: [ 'ignore', 'pipe', 'pipe' ]
      } );

      let isReady = false;

      electronProcess.stdout.on( 'data', ( data ) => {
        console.info( `[electron stdout] ${data}` );
        // Check for a specific output to confirm readiness
        if ( data.toString().includes( 'loaded userSettings' ) ) {
          console.info( '[beforeAll] Electron app runs correctly' );
          isReady = true;
          electronProcess.kill();
          resolve();
        }
      } );

      electronProcess.stderr.on( 'data', ( data ) => {
        console.error( `[electron stderr] ${data}` );
      } );

      electronProcess.on( 'error', ( err ) => {
        console.error( '[electron error]', err );
        reject( err );
      } );

      electronProcess.on( 'close', ( code ) => {
        if ( isReady ) {
          console.info( `[electron process exited with code ${code}]` );
        } else {
          console.warn( '[electron process did not signal readiness]' );
          reject( new Error( 'Electron process did not signal readiness' ) );
        }
      } );

      setTimeout( () => {
        if ( ! isReady ) {
          electronProcess.kill();
          console.info( '[beforeAll] Electron process killed due to timeout.' );
          reject( new Error( 'Electron process did not become ready in time' ) );
        }
      }, 30000 );
    } );
  } );

  test.beforeEach( async () => {
    console.info( '[beforeEach] starting beforeEach' );
    // Reset console errors at the start of each test
    logs = [];

    // Pass in --test-mode for headless testing
    electronApp = await electron.launch( {
      timeout: 30000,
      cwd: exeDir,
      args: [ appInfo.main, '--disable-http-cache', '--fl-test-mode' ],
      executablePath: appInfo.executable // Path to the Electron executable
    } );
    console.info( '[beforeEach] launched electronApp' );

    await electronApp.evaluate( async ( { session } ) => await session.defaultSession.clearCache() );

    // Log main process
    electronApp.process().stdout.on( 'data', data => console.info( `[main] ${data}` ) );
    electronApp.process().stderr.on( 'data', error => console.info( `[main] ${error}` ) );
    electronApp.process().stderr.on( 'data', error => logs.push( `[main] ${error}` ) );

    page = await electronApp.firstWindow();
    console.info( '[beforeEach] waited for firstWindow' );

    // Log renderer process
    page.on( 'console', log => console.info( `[renderer] ${log.text()}` ) );
    page.on( 'console', log => {
      if ( log.type() === 'error' ) {
        logs.push( `[renderer] ${log.text()}` );
      }
    } );
  } );

  test.afterEach( async () => {
    try {
      console.info( '[afterEach] setting global.willQuit to true...' );
      if ( electronApp ) {
        await electronApp.evaluate( async () => global.willQuit = true );
        console.info( '[afterEach] global.willQuit has been set to true - attempting to close the app...' );
        await electronApp.close();
        console.info( '[afterEach] the app has been closed.' );
      } else {
        console.warn( '[afterEach] electronApp is not defined, skipping close operation.' );
      }
    } catch ( error ) {
      console.error( '[afterEach] an error occurred:', error );
    }
  } );

  return {
    getPage: () => page,
    getElectronApp: () => electronApp,
    getLatestBuild: () => latestBuild,
    getAppInfo: () => appInfo,
    getExeDir: () => exeDir,
    getAppData: () => appData,
    getInstallDir: () => installDir,
    getLogs: () => ( {
      main: logs.filter( log => log.includes( '[main]' ) ),
      renderer: logs.filter( log => log.includes( '[renderer]' ) ),
      all: logs,
    } ),
    /**
     * @param {string[]} excludes
     */
    restartLogs: () => ( logs = [] )
  };
};
