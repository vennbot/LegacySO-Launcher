/**
 * Returns the path with backslashes converted to forward slashes.
 *
 * @param {string} dir The path to convert.
 *
 * @returns {string} The converted path.
 */
function normalizePathSlashes( dir ) {
  return dir ? dir.replace( /\\/g, '/' ) : dir;
}

/**
 * Formats a string with unlimited arguments.
 *
 * @param {string} str The string to format.
 * @param {...any} args Values to replace.
 *
 * @returns {string} The formatted string.
 */
function strFormat( str, ...args ) {
  if (!str) return '';
  return args.reduce( ( s, v ) => s.replace( '%s', v ?? '' ), str );
}

function initSentry() {
  const { dsn } = require( '../../sentry.config' );
  if ( dsn !== 'SENTRY_CI_DSN' ) {
    require( '@sentry/electron' ).init( {
      dsn,
      integrations: defaultIntegrations => defaultIntegrations.filter(
        integration => integration.name !== 'Net'
      ),
      beforeSend( event ) {
        return sanitizeEvent( event );
      },
    } );
  }
}

function sanitizeEvent( event ) {
  event = sanitizeExceptions( event );

  return event;
}

function sanitizeExceptions( event ) {
  if ( event.exceptions && event.exceptions.values ) {
    event.exceptions.values.forEach( ( exception ) => {
      if ( exception.stacktrace && exception.stacktrace.frames ) {
        exception.stacktrace.frames.forEach( ( frame ) => {
          frame.filename = obfuscatePath( frame.filename ); // Obfuscate local file paths
        } );
      }
    } );
  }
  return event;
}

function obfuscatePath( filePath ) {
  if ( typeof filePath !== 'string' ) {
    return filePath;
  }
  // Replace user directory with a placeholder
  const userDirectory = process.env.HOME || process.env.USERPROFILE;
  return filePath.replace( userDirectory, '[USER_DIR]' );
}

const SENTRY_MAX_ERROR_COUNT = 25; // Maximum number of same errors to capture per hour
const SENTRY_RESET_MINUTES = 60; // Reset error count after this many minutes

const sentryErrorCounts = {};

/**
 * Captures an error with Sentry.
 *
 * @param {Error} err The error to capture.
 * @param {Object} extra Extra data to send with the error.
 */
function captureWithSentry( err, extra ) {
  const { captureException } = require( '@sentry/electron' );

  const errorName = err.name + err.message;
  const currentError = sentryErrorCounts[ errorName ] || {
    count: 0,
    timestamp: new Date().getTime()
  };
  const expired = currentError.timestamp <= Date.now() - SENTRY_RESET_MINUTES * 60 * 1000;

  if ( currentError.count < SENTRY_MAX_ERROR_COUNT || expired ) {
    captureException( err, { extra } );

    // If it's been more than SENTRY_RESET_MINUTES since the last error,
    // reset the count.
    // Otherwise, increment it.
    sentryErrorCounts[ errorName ] = {
      count: expired ? 1 : ( currentError.count + 1 ),
      timestamp: new Date().getTime()
    };
  }
}

/**
 * Get JSON from a specified URL.
 *
 * @param {string} url The URL to get the JSON from.
 * @param {number} timeout Duration to wait for a response before rejecting the promise (in milliseconds).
 *
 * @returns {Promise<any>} A promise that resolves with the JSON data from the response.
 */
function getJSON( url, timeout = 30000 ) {
  const { net } = require( 'electron' );
  const { http, https } = require( 'follow-redirects' ).wrap( {
    http: net,
    https: net
  } );

  return new Promise( ( resolve, reject ) => {
    const httpModule = url.startsWith( 'https' ) ? https : http;
    const req = httpModule.get( url, { headers: githubApiHeaders( url ) }, ( response ) => {
      // Check if this is a ZIP file based on content-type or url
      const contentType = response.headers[ 'content-type' ];
      if ( contentType?.includes( 'application/zip' ) ||
           contentType?.includes( 'application/x-zip-compressed' ) ||
           url.endsWith( '.zip' ) ) {
        // Silently ignore ZIP files instead of throwing an error
        resolve( {} );
        return;
      }

      let data = '';
      if ( response.statusCode >= 200 && response.statusCode <= 299 ) {
        response.on( 'data', chunk => data += chunk );
        response.on( 'end', () => {
          clearTimeout( requestTimeout );
          try {
            // Only try to parse if we have data and it's not a ZIP file
            if ( data && !data.startsWith( 'PK' ) ) {
              resolve( JSON.parse( data ) );
            } else {
              // If it's empty or appears to be a ZIP file, return empty object
              resolve( {} );
            }
          } catch ( err ) {
            // Silently return empty object on parse errors
            resolve( {} );
          }
        } );
        response.on( 'error', () => resolve( {} ) );
      } else {
        resolve( {} );
      }
    } );

    const requestTimeout = setTimeout( () => {
      req.abort();
      resolve( {} ); // Return empty object instead of rejecting
    }, timeout );

    req.on( 'error', () => {
      clearTimeout( requestTimeout );
      resolve( {} ); // Return empty object on request errors
    } );
  } );
}

function getDisplayRefreshRate() {
  const { screen } = require( 'electron' );

  const primaryDisplay = screen.getPrimaryDisplay();
  const refreshRate = Math.round( primaryDisplay.displayFrequency );
  if ( refreshRate < 30 ) return 30;
  return refreshRate;
}

function githubApiHeaders( url, headers = {} ) {
  if ( url.startsWith( 'https://api.github.com' ) ) {
    const rateLimitToken = process.env.GITHUB_RATELIMIT_TOKEN;
    if ( rateLimitToken ) {
      headers[ 'Authorization' ] = `token ${rateLimitToken}`;
    }
  }
  return headers;
}

function loadDependency( dependencyName ) {
  const { isTestMode } = require( '../constants' );
  if ( isTestMode ) {
    // Attempt to load a stub version if in test mode
    try {
      return require( `../../tests/e2e/stubs/${dependencyName}` );
    } catch ( error ) {
      console.warn( `Stub for ${dependencyName} not found, using real implementation.` );
    }
  }
  // Fallback to real implementation
  return require( dependencyName );
}

function enableFileLogger() {
  const { appData } = require( '../constants' );
  const fs = require( 'fs-extra' );
  const os = require( 'os' );

  const sessionDate = new Date().getTime();
  const logFilePath = appData + `/logs/session-${sessionDate}.log`;
  fs.ensureDirSync( require( 'path' ).dirname( logFilePath ) );

  // Function to append messages to the log file.
  function logToFile( message ) {
    // Ensure message ends with a newline for readability.
    fs.appendFileSync( logFilePath, message + '\n', 'utf8' );
  }

  // Function to format the arguments for logging.
  function formatArgs( args ) {
    return args.map( arg => typeof arg === 'object' ? JSON.stringify( arg, null, 2 ) : arg ).join( ' ' );
  }

  // Store references to the original console methods.
  const originalLog   = console.log;
  const originalInfo  = console.info;
  const originalError = console.error;
  const originalDebug = console.debug;

  console.log = ( ...args ) => {
    logToFile( '[LOG] ' + formatArgs( args ) );
    originalLog.apply( console, args );
  };

  console.info = ( ...args ) => {
    logToFile( '[INFO] ' + formatArgs( args ) );
    originalInfo.apply( console, args );
  };

  console.error = ( ...args ) => {
    logToFile( '[ERROR] ' + formatArgs( args ) );
    originalError.apply( console, args );
  };

  console.debug = ( ...args ) => {
    logToFile( '[DEBUG] ' + formatArgs( args ) );
    originalDebug.apply( console, args );
  };

  console.info( `os: ${os.type()} (${os.platform()}) ${os.release()}` );
  console.info( `arch: ${os.arch()}` );
  console.info( `totalmen: ${( os.totalmem() / 1024 / 1024 ).toFixed( 2 )} MB` );
  console.info( `freemem: ${( os.freemem() / 1024 / 1024 ).toFixed( 2 )} MB` );
  console.info( `uptime: ${( os.uptime() / 60 ).toFixed( 2 )} minutes` );
}

/**
 * Detects available drives on the system
 * @returns {Promise<Array>} Array of drive objects with letter, label, and free space
 */
async function getAvailableDrives() {
  const drives = [];

  if (process.platform === 'win32') {
    // Windows drive detection
    const { exec } = require('child_process');
    const util = require('util');
    const execAsync = util.promisify(exec);

    try {
      // Use wmic to get drive information
      const { stdout } = await execAsync('wmic logicaldisk get size,freespace,caption,volumename /format:csv');
      const lines = stdout.split('\n').filter(line => line.trim() && !line.startsWith('Node'));

      for (const line of lines) {
        const parts = line.split(',');
        if (parts.length >= 5) {
          const caption = parts[1]?.trim();
          const freeSpace = parseInt(parts[2]) || 0;
          const size = parseInt(parts[3]) || 0;
          const volumeName = parts[4]?.trim() || '';

          if (caption && caption.match(/^[A-Z]:$/)) {
            drives.push({
              letter: caption,
              label: volumeName || `Local Disk (${caption})`,
              freeSpace: freeSpace,
              totalSpace: size,
              freeSpaceGB: Math.round(freeSpace / (1024 * 1024 * 1024) * 100) / 100,
              totalSpaceGB: Math.round(size / (1024 * 1024 * 1024) * 100) / 100,
              path: caption + '\\'
            });
          }
        }
      }
    } catch (error) {
      console.error('Error detecting Windows drives:', error);
      // Fallback to common drive letters
      const commonDrives = ['C:', 'D:', 'E:', 'F:', 'G:'];
      for (const drive of commonDrives) {
        try {
          const fs = require('fs-extra');
          await fs.access(drive + '\\');
          drives.push({
            letter: drive,
            label: `Drive (${drive})`,
            freeSpace: 0,
            totalSpace: 0,
            freeSpaceGB: 'Unknown',
            totalSpaceGB: 'Unknown',
            path: drive + '\\'
          });
        } catch (err) {
          // Drive not accessible, skip
        }
      }
    }
  } else if (process.platform === 'darwin') {
    // macOS drive detection
    const fs = require('fs-extra');
    try {
      const volumes = await fs.readdir('/Volumes');
      for (const volume of volumes) {
        const volumePath = `/Volumes/${volume}`;
        try {
          const stats = await fs.stat(volumePath);
          if (stats.isDirectory()) {
            drives.push({
              letter: volume,
              label: volume,
              freeSpace: 0,
              totalSpace: 0,
              freeSpaceGB: 'Unknown',
              totalSpaceGB: 'Unknown',
              path: volumePath
            });
          }
        } catch (err) {
          // Volume not accessible, skip
        }
      }
    } catch (error) {
      console.error('Error detecting macOS drives:', error);
    }
  } else {
    // Linux drive detection
    const fs = require('fs-extra');
    try {
      const mounts = await fs.readFile('/proc/mounts', 'utf8');
      const lines = mounts.split('\n');
      const mountPoints = new Set();

      for (const line of lines) {
        const parts = line.split(' ');
        if (parts.length >= 2) {
          const mountPoint = parts[1];
          if (mountPoint.startsWith('/media/') || mountPoint.startsWith('/mnt/') || mountPoint === '/') {
            mountPoints.add(mountPoint);
          }
        }
      }

      for (const mountPoint of mountPoints) {
        try {
          const stats = await fs.stat(mountPoint);
          if (stats.isDirectory()) {
            drives.push({
              letter: mountPoint.split('/').pop() || 'root',
              label: mountPoint,
              freeSpace: 0,
              totalSpace: 0,
              freeSpaceGB: 'Unknown',
              totalSpaceGB: 'Unknown',
              path: mountPoint
            });
          }
        } catch (err) {
          // Mount point not accessible, skip
        }
      }
    } catch (error) {
      console.error('Error detecting Linux drives:', error);
    }
  }

  return drives;
}

/**
 * Checks available disk space for a given path
 * @param {string} path - Path to check
 * @returns {Promise<Object>} Object with free and total space in bytes
 */
async function checkDiskSpace(path) {
  try {
    const fs = require('fs-extra');
    const stats = await fs.stat(path);

    if (process.platform === 'win32') {
      const { exec } = require('child_process');
      const util = require('util');
      const execAsync = util.promisify(exec);

      try {
        const driveLetter = path.substring(0, 2);
        const { stdout } = await execAsync(`dir "${driveLetter}\\" /-c | find "bytes free"`);
        const match = stdout.match(/(\d+) bytes free/);
        if (match) {
          return {
            free: parseInt(match[1]),
            freeGB: Math.round(parseInt(match[1]) / (1024 * 1024 * 1024) * 100) / 100
          };
        }
      } catch (error) {
        console.error('Error checking Windows disk space:', error);
      }
    }

    // Fallback for all platforms
    return {
      free: 0,
      freeGB: 'Unknown'
    };
  } catch (error) {
    console.error('Error checking disk space:', error);
    return {
      free: 0,
      freeGB: 'Unknown'
    };
  }
}

/**
 * Searches for game installations across all available drives
 * @param {string} gameType - 'LSO', 'TSO', or 'Simitone'
 * @returns {Promise<Array>} Array of found installation paths
 */
async function findGameInstallations(gameType) {
  const fs = require('fs-extra');
  const path = require('path');
  const foundInstallations = [];

  // Define what files to look for based on game type
  const gameFiles = {
    'LSO': ['LegacySO.exe', 'FreeSO.exe'], // Support both names
    'TSO': ['TSOClient.exe', 'TSO.exe', 'TSO Client.exe'], // Multiple possible TSO executables
    'Simitone': ['Simitone.Windows.exe', 'Simitone.exe']
  };

  // Define common installation directory patterns
  const commonPaths = [
    'LegacySO Game',
    'FreeSO',
    'The Sims Online',
    'TSO',
    'Maxis',
    'EA Games',
    'Electronic Arts',
    'Simitone',
    'Games',
    'Program Files',
    'Program Files (x86)',
    'GameComponents'
  ];

  try {
    const drives = await getAvailableDrives();

    for (const drive of drives) {
      console.log(`Scanning drive ${drive.letter} for ${gameType} installations...`);

      // Search in common installation directories
      for (const commonPath of commonPaths) {
        const searchPaths = [
          path.join(drive.path, commonPath),
          path.join(drive.path, commonPath, gameType),
          path.join(drive.path, commonPath, gameType === 'LSO' ? 'LegacySO' : gameType),
          path.join(drive.path, commonPath, gameType === 'TSO' ? 'The Sims Online' : gameType)
        ];

        // Add TSO-specific search paths
        if (gameType === 'TSO') {
          searchPaths.push(
            path.join(drive.path, commonPath, 'TSOClient'),
            path.join(drive.path, commonPath, 'TSO', 'TSOClient'),
            path.join(drive.path, commonPath, 'The Sims Online', 'TSOClient'),
            path.join(drive.path, commonPath, 'Maxis', 'The Sims Online'),
            path.join(drive.path, commonPath, 'EA Games', 'The Sims Online'),
            path.join(drive.path, commonPath, 'Electronic Arts', 'The Sims Online')
          );
        }

        for (const searchPath of searchPaths) {
          try {
            const exists = await fs.pathExists(searchPath);
            if (!exists) continue;

            // Check if any of the game files exist in this directory
            for (const gameFile of gameFiles[gameType] || []) {
              const gameFilePath = path.join(searchPath, gameFile);
              const gameFileExists = await fs.pathExists(gameFilePath);

              if (gameFileExists) {
                const installPath = path.normalize(searchPath);
                if (!foundInstallations.some(inst => inst.path === installPath)) {
                  foundInstallations.push({
                    path: installPath,
                    executable: gameFilePath,
                    drive: drive.letter,
                    gameFile: gameFile
                  });
                  console.log(`Found ${gameType} installation: ${installPath}`);
                }
                break; // Found one, no need to check other files in this directory
              }
            }
          } catch (error) {
            // Directory not accessible, continue searching
            continue;
          }
        }
      }

      // Also do a broader search in the root of each drive
      try {
        const rootContents = await fs.readdir(drive.path);
        for (const item of rootContents) {
          const itemPath = path.join(drive.path, item);
          try {
            const stats = await fs.stat(itemPath);
            if (stats.isDirectory()) {
              // Check if this directory contains game files
              for (const gameFile of gameFiles[gameType] || []) {
                const gameFilePath = path.join(itemPath, gameFile);
                const gameFileExists = await fs.pathExists(gameFilePath);

                if (gameFileExists) {
                  const installPath = path.normalize(itemPath);
                  if (!foundInstallations.some(inst => inst.path === installPath)) {
                    foundInstallations.push({
                      path: installPath,
                      executable: gameFilePath,
                      drive: drive.letter,
                      gameFile: gameFile
                    });
                    console.log(`Found ${gameType} installation in root: ${installPath}`);
                  }
                  break;
                }
              }
            }
          } catch (error) {
            // Skip inaccessible items
            continue;
          }
        }
      } catch (error) {
        console.warn(`Could not scan root of drive ${drive.letter}:`, error.message);
      }
    }
  } catch (error) {
    console.error('Error during game installation search:', error);
  }

  return foundInstallations;
}

/**
 * Validates that a game installation is working
 * @param {string} installPath - Path to the installation
 * @param {string} gameType - Type of game (LSO, TSO, Simitone)
 * @returns {Promise<boolean>} True if installation is valid
 */
async function validateGameInstallation(installPath, gameType) {
  const fs = require('fs-extra');
  const path = require('path');

  try {
    // Check if the directory exists
    const dirExists = await fs.pathExists(installPath);
    if (!dirExists) return false;

    // Define required files for each game type
    const requiredFiles = {
      'LSO': ['LegacySO.exe'],
      'TSO': ['TSOClient.exe', 'TSO.exe', 'TSO Client.exe'],
      'Simitone': ['Simitone.Windows.exe']
    };

    // Check if required files exist (for TSO, we need ANY of the files, not ALL)
    const files = requiredFiles[gameType] || [];

    if (gameType === 'TSO') {
      // For TSO, check if ANY of the executable files exist
      let foundTSOExecutable = false;
      for (const file of files) {
        const filePath = path.join(installPath, file);
        const fileExists = await fs.pathExists(filePath);
        if (fileExists) {
          foundTSOExecutable = true;
          break;
        }
      }
      if (!foundTSOExecutable) return false;
    } else {
      // For other games, check each required file
      for (const file of files) {
        const filePath = path.join(installPath, file);
        const fileExists = await fs.pathExists(filePath);
        if (!fileExists) {
          // Try alternative names
          if (gameType === 'LSO' && file === 'LegacySO.exe') {
            const altPath = path.join(installPath, 'FreeSO.exe');
            const altExists = await fs.pathExists(altPath);
            if (!altExists) return false;
          } else if (gameType === 'Simitone' && file === 'Simitone.Windows.exe') {
            const altPath = path.join(installPath, 'Simitone.exe');
            const altExists = await fs.pathExists(altPath);
            if (!altExists) return false;
          } else {
            return false;
          }
        }
      }
    }

    return true;
  } catch (error) {
    console.error('Error validating game installation:', error);
    return false;
  }
}

module.exports = {
  normalizePathSlashes,
  strFormat,
  initSentry,
  captureWithSentry,
  getJSON,
  getDisplayRefreshRate,
  githubApiHeaders,
  loadDependency,
  enableFileLogger,
  getAvailableDrives,
  checkDiskSpace,
  findGameInstallations,
  validateGameInstallation
};



