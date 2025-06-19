const packager = require( '@electron/packager' ).packager;
const createDebianInstaller = require( 'electron-installer-debian' );

// Function to package and create a Debian installer for a given architecture
async function packageAndCreateDebian( arch ) {
  try {
    // Package your Electron app for a specific architecture
    const appPaths = await packager( {
      dir: '.',
      name: 'LegacySO Launcher',
      out: '../release',
      platform: 'linux',
      arch,
      icon: './beta.png',
      asar: {
        unpackDir: '{fsolauncher-ui/images,fsolauncher-ui/sounds,fsolauncher-ui/fonts}',
      },
      overwrite: true,
      appCopyright: 'Copyright (C) LegacySO. All rights reserved.',
      derefSymlinks: true,
    } );

    const appPath = appPaths[ 0 ];

    // Create a Debian installer
    await createDebianInstaller( {
      src: appPath,
      dest: '../release',
      arch: arch === 'x64' ? 'amd64' : 'arm64',
      icon: './beta.png',
      categories: [ 'Games' ],
      bin: 'LegacySO Launcher',
      productName: 'LegacySO Launcher',
      section: 'games',
      homepage: 'https://legacyso.org',
      genericName: 'Launcher',
      description: 'LegacySO Launcher',
      productDescription: 'Install, configure, and launch LegacySO with ease'
    } );

    const version = require( '../package.json' ).version;
    const originalDebName = `../release/fsolauncher_${version}_${arch === 'x64' ? 'amd64' : 'arm64'}.deb`;
    const newDebName = '../release/LegacySO Launcher.deb';

    // Rename the Debian package
    await require( 'fs-extra' ).rename( originalDebName, newDebName );

    console.log( `Successfully created package for ${arch} at ../release` );
  } catch ( err ) {
    console.error( `Error creating Debian package for ${arch}:`, err );
    // Do not exit the process here; let all promises resolve
  }
}

// Function to run packaging and installer creation for all architectures in parallel
async function packageForAllArchitectures() {
  // Use Promise.all to run both tasks in parallel
  await Promise.all( [
    packageAndCreateDebian( 'x64' ),
    //packageAndCreateDebian( 'arm64' )
  ] );
}

packageForAllArchitectures().then( () => {
  console.log( 'Packaging for all architectures completed.' );
} ).catch( ( error ) => {
  console.error( 'An error occurred during packaging:', error );
  process.exit( 1 ); // Exit with error code if any of the packaging operations failed
} );
