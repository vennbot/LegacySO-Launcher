const { appData } = require( '../constants' );
const { captureWithSentry, normalizePathSlashes } = require( './utils' );
const { createKey, keyExists, deleteKey, readValue, updateValue } = require( './winreg' );
const { paths, fallbacks: fb } = require( '../constants' ).registry;
const fs = require( 'fs-extra' );

async function hasRegistryAccess() {
  if ( process.platform != 'win32' ) {
    return false;
  }
  try {
    const regKey = 'HKLM\\SOFTWARE\\AAA_' + new Date().toISOString();
    await createKey( regKey );
    if ( ! await keyExists( regKey ) ) {
      throw new Error( 'was not able to create the key' );
    }
    await deleteKey( regKey );
    return true;
  } catch ( err ) {
    console.error( 'no registry access', err );
    return false;
  }
}

async function checkFallbacks( code ) {
  const fallbacks = fb[ code ] || [];
  const localPaths = await getLocalRegistry();
  if ( localPaths[ code ] ) {
    fallbacks.push( localPaths[ code ] );
  }
  for ( const fallback of fallbacks ) {
    if ( await fs.pathExists( fallback ) ) {
      return normalizeLocalPath( fallback );
    }
  }
  return false;
}

function normalizeLocalPath( path ) {
  if ( path ) {
    path = normalizePathSlashes( path );
    path = path.replace( '/LegacySO.exe', '' );
    path = path.replace( '/TSOClient/TSOClient.exe', '' );
    path = path.replace( '/Simitone.Windows.exe', '' );
  }

  return path;
}

/**
 * Gets the installation status for a given software component.
 *
 * @param {string} code - The code name of the software component.
 *
 * @returns {Promise<Object>}
 */
async function getInstallStatus( code ) {
  const regPath = paths[ code ];
  if ( process.platform !== 'win32' ) {
    return {
      key: code,
      isInstalled: ( await fs.pathExists( regPath ) ) ?
        normalizeLocalPath( regPath ) : await checkFallbacks( code )
    };
  }

  try {
    let isInstalled = false;

    switch ( code ) {
    case 'OpenAL':
      try {
        // Check for RefCount in both registry paths
        const paths = [
          'HKLM\\SOFTWARE\\OpenAL',
          'HKLM\\SOFTWARE\\WOW6432Node\\OpenAL'
        ];

        for (const regPath of paths) {
          try {
            console.log(`Checking OpenAL registry path: ${regPath}`);
            const refCount = await readValue(regPath, 'RefCount');
            // Convert hex string to number if needed
            const refCountNum = typeof refCount === 'string' ?
              parseInt(refCount.replace('0x', ''), 16) : refCount;
            console.log(`OpenAL RefCount at ${regPath}:`, refCountNum);
            if (refCountNum >= 0) {
              console.log(`OpenAL found at: ${regPath} with RefCount: ${refCountNum}`);
              isInstalled = true;
              break;
            }
          } catch (pathErr) {
            console.log(`Failed to check ${regPath}:`, pathErr.message);
          }
        }

        // DLL fallback check if registry check failed
        if (!isInstalled) {
          const dllPaths = [
            'C:\\Windows\\System32\\OpenAL32.dll',
            'C:\\Windows\\SysWOW64\\OpenAL32.dll',
            'C:\\Windows\\System32\\soft_oal.dll',
            'C:\\Windows\\SysWOW64\\soft_oal.dll'
          ];

          for (const dllPath of dllPaths) {
            try {
              const exists = await fs.pathExists(dllPath);
              console.log(`Checking OpenAL DLL: ${dllPath} - exists: ${exists}`);
              if (exists) {
                console.log(`OpenAL DLL found at: ${dllPath}`);
                isInstalled = true;
                break;
              }
            } catch (err) {
              console.log(`Error checking DLL ${dllPath}:`, err);
            }
          }
        }
      } catch (err) {
        console.error('OpenAL check error:', err);
        isInstalled = false;
      }
      break;

    case 'NET':
      try {
        const netKey = 'HKLM\\SOFTWARE\\Microsoft\\NET Framework Setup\\NDP\\v4\\Full';
        const releaseValue = await readValue(netKey, 'Release');
        // Convert hex or string to number if needed
        const releaseNum = typeof releaseValue === 'string' ?
          parseInt(releaseValue.replace('0x', ''), 16) : releaseValue;
        console.log('.NET Framework Release value:', releaseNum);
        // Release number 393295 or higher indicates .NET Framework 4.6+
        isInstalled = releaseNum >= 393295;
        console.log('.NET Framework check:', { netKey, releaseValue: releaseNum, isInstalled });
      } catch (err) {
        console.error('.NET Framework registry check failed:', err);
        // Try alternative .NET detection method
        try {
          const netKey = 'HKLM\\SOFTWARE\\Microsoft\\NET Framework Setup\\NDP\\v4\\Client';
          const version = await readValue(netKey, 'Version');
          console.log('.NET Framework Client Version:', version);
          if (version) {
            const [major, minor] = version.split('.');
            isInstalled = parseInt(major) >= 4 && parseInt(minor) >= 6;
          }
        } catch (clientErr) {
          console.error('.NET Framework client check failed:', clientErr);
          isInstalled = false;
        }
      }
      break;
    case 'LSO':
    case 'TSO':
    case 'Simitone':
      isInstalled = await readValue( regPath, 'InstallDir' );
      // Silently fall back to checking fallbacks if registry read fails
      if (!isInstalled) {
        isInstalled = await checkFallbacks( code );
      }
      break;
    case 'TS1': {
      const installPath = await readValue( regPath, 'InstallPath' );
      const gameEdition = await readValue( regPath, 'SIMS_GAME_EDITION' );
      isInstalled = gameEdition == 255 ? installPath : false;
      break;
    }
    default:
      isInstalled = false;
    }
    if ( typeof isInstalled === 'string' ) {
      const exists = await fs.pathExists( isInstalled );
      if ( isInstalled && ! exists ) {
        isInstalled = await checkFallbacks( code );
      }
    }

    if ( typeof isInstalled === 'string' ) {
      isInstalled = normalizeLocalPath( isInstalled );
    }
    return { key: code, isInstalled };
  } catch ( err ) {
    // Silently fall back to checking fallbacks
    return { key: code, isInstalled: await checkFallbacks( code ) };
  }
}

/**
 * @param {(a: Object) => Promise<void>} updateConfig
 * @param {string} installDir
 */
async function createMaxisEntry( updateConfig, installDir ) {
  // Save to backup registry first
  await saveToLocalRegistry( updateConfig, 'TSO', installDir + '/TSOClient/TSOClient.exe' );

  if ( ! await hasRegistryAccess() ) {
    return;
  }
  try {
    await updateValue( 'HKLM\\SOFTWARE\\Maxis\\The Sims Online', 'InstallDir', installDir );
  } catch ( err ) {
    console.error( err );
  }
}

/**
 * @param {(a: Object) => Promise<void>} updateConfig
 * @param {string} installDir
 */
async function createGameEntry( updateConfig, installDir ) {
  // Save to backup registry first
  await saveToLocalRegistry( updateConfig, 'LSO', installDir + '/LegacySO.exe' );

  if ( ! await hasRegistryAccess() ) {
    return;
  }
  try {
    await updateValue( 'HKLM\\SOFTWARE\\Rhys Simpson\\LegacySO', 'InstallDir', installDir );
  } catch ( err ) {
    console.error( err );
  }
}

/**
 * @param {(a: Object) => Promise<void>} updateConfig
 * @param {string} installDir
 */
async function createSimitoneEntry( updateConfig, installDir ) {
  // Save to backup registry first
  await saveToLocalRegistry( updateConfig, 'Simitone', installDir + '/Simitone.Windows.exe' );

  if ( ! await hasRegistryAccess() ) {
    return;
  }
  try {
    await updateValue( 'HKLM\\SOFTWARE\\Rhys Simpson\\Simitone', 'InstallDir', installDir );
  } catch ( err ) {
    console.error( err );
  }
}

async function getLocalRegistry() {
  try {
    /**
     * @type {UserSettings}
     */
    const userSettings = require( 'ini' ).parse( await require( 'fs-extra' )
      .readFile( appData + '/FSOLauncher.ini', 'utf-8' ) );

    return userSettings.LocalRegistry || {};
  } catch ( err ) {
    captureWithSentry( err );
    console.error( err );
  }
  return {};
}

async function saveToLocalRegistry( updateConfig, key, value ) {
  try {
    await updateConfig( [ 'LocalRegistry', key, value ] );
  } catch ( err ) {
    captureWithSentry( err );
    console.error( err );
  }
}

module.exports = {
  hasRegistryAccess,
  createMaxisEntry,
  createGameEntry,
  createSimitoneEntry,
  saveToLocalRegistry,
  getLocalRegistry,
  getInstalled: () => Promise.all(
    Object.keys( paths )
      .filter( code => ! (
        process.platform === 'win32' && [ 'Mono', 'SDL' ].includes( code )
      ) )
      .map( getInstallStatus )
  ),
};




