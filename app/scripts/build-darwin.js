const packager = require('@electron/packager').packager;
const { execSync } = require('child_process');
const path = require('path');

(async () => {
  try {
    // Rebuild native modules before packaging
    console.log('Rebuilding native modules...');
    execSync('npm rebuild macos-alias', { stdio: 'inherit' });

    console.log('Packaging application...');
    await packager({
      dir: '.',
      name: 'LegacySO Launcher',
      out: '../release',
      platform: 'darwin',
      arch: 'universal',
      icon: './beta.icns',
      asar: {
        unpackDir: '{fsolauncher-ui/images,fsolauncher-ui/sounds,fsolauncher-ui/fonts}',
      },
      overwrite: true,
      appCopyright: 'Copyright (C) LegacySO. All rights reserved.',
      derefSymlinks: true
    });

    console.log('Creating DMG...');
    // Properly escape paths with quotes and spaces
    const appPath = path.resolve('../release/LegacySO Launcher-darwin-universal/LegacySO Launcher.app');
    const outPath = path.resolve('../release');
    const iconPath = path.resolve('./beta.icns');
    const bgPath = path.resolve('./osx_dmg.png');

    console.log('Creating DMG using electron-builder...');

    // Use electron-builder to create the DMG
    const command = `npx electron-builder --mac dmg --universal`;
    console.log('Executing command:', command);

    execSync(command, {
      stdio: 'inherit',
      shell: '/bin/bash'
    });

    console.log('DMG created successfully!');
  } catch (err) {
    console.error('Build error:', err);
    process.exitCode = 1;
  }
})();
