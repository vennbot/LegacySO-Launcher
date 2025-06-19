const packager = require('@electron/packager').packager;
const { execSync } = require('child_process');
const fs = require('fs-extra');
const path = require('path');

(async () => {
  try {
    console.log('Starting Windows build...');

    // Create a unique output directory with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outputDir = `../release-build-${timestamp}`;
    console.log(`Building to: ${outputDir}`);

    await packager({
      dir: '.',
      name: 'lsolauncher',
      out: outputDir,
      platform: 'win32',
      arch: 'ia32',
      icon: './beta.ico',
      extraResource: [
        './cache',
        '../extras/fsolauncher-proxy'
      ],
      asar: {
        unpackDir: '{fsolauncher-ui/images,fsolauncher-ui/sounds,fsolauncher-ui/fonts,cache}',
      },
      overwrite: true,
      appCopyright: 'Copyright (C) LegacySO. All rights reserved.',
      win32metadata: {
        CompanyName: 'legacyso.org',
        'requested-execution-level': 'requireAdministrator',
        FileDescription: 'LegacySO Launcher',
      },
      derefSymlinks: true
    });

    console.log('Packaging completed, copying ISS file...');
    // Copy the ISS file to the build directory
    const issSourcePath = path.join(__dirname, '../win32-ia32.iss');
    const issDestPath = path.join(__dirname, `../../release-build-${timestamp}/win32-ia32.iss`);
    await fs.copy(issSourcePath, issDestPath);

    // Copy build extras
    console.log('Copying build extras...');
    const extrasSource = path.join(__dirname, '../../extras/fsolauncher-build-extras');
    const extrasDestination = path.join(__dirname, `../../release-build-${timestamp}/lsolauncher-win32-ia32`);
    await fs.copy(extrasSource, extrasDestination, { overwrite: true });

    // Ensure proxy src files are copied (in case they were missed by packager)
    console.log('Ensuring proxy src files are present...');
    const proxySrcSource = path.join(__dirname, '../../extras/fsolauncher-proxy/src');
    const proxySrcDestination = path.join(__dirname, `../../release-build-${timestamp}/lsolauncher-win32-ia32/resources/fsolauncher-proxy/src`);
    await fs.copy(proxySrcSource, proxySrcDestination, { overwrite: true });

    // Update ISS version and compile
    console.log('Updating ISS version and compiling installer...');
    const issContent = await fs.readFile(issDestPath, 'utf8');
    const version = require('../package.json').version;
    const newString = `#define MyAppVersion "${version}"`;
    const matches = issContent.match(/#define MyAppVersion "\d+.\d+.\d+"/gm);

    if (matches && matches[0]) {
      const updatedIss = issContent.replace(matches[0], newString);
      await fs.writeFile(issDestPath, updatedIss);
      console.log(`ISS version updated to ${version}`);
    }

    // Compile the installer
    execSync(`npx innosetup-compiler --verbose "${issDestPath}"`, { stdio: 'inherit' });

    console.log(`\n✅ Build completed successfully!`);
    console.log(`📁 Output directory: ${outputDir}`);
    console.log(`🎯 Installer: ${outputDir}/LegacySO Launcher Setup.exe`);
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  }
})();
