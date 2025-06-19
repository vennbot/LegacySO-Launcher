/**
 * Test script for drive detection and game finding functionality
 * Run with: node test-drive-detection.js
 */

const { getAvailableDrives, checkDiskSpace, findGameInstallations, validateGameInstallation } = require('./fsolauncher/lib/utils');

async function testDriveDetection() {
  console.log('Testing drive detection...\n');

  try {
    const drives = await getAvailableDrives();

    if (drives.length === 0) {
      console.log('No drives detected.');
      return;
    }

    console.log(`Found ${drives.length} drive(s):\n`);

    for (const drive of drives) {
      console.log(`Drive: ${drive.letter}`);
      console.log(`  Label: ${drive.label}`);
      console.log(`  Path: ${drive.path}`);
      console.log(`  Free Space: ${drive.freeSpaceGB}GB`);
      console.log(`  Total Space: ${drive.totalSpaceGB}GB`);
      console.log('');

      // Test disk space checking
      try {
        const spaceInfo = await checkDiskSpace(drive.path);
        console.log(`  Disk space check: ${spaceInfo.freeGB}GB free`);
      } catch (error) {
        console.log(`  Disk space check failed: ${error.message}`);
      }
      console.log('---');
    }

    // Find best drive for installation
    let bestDrive = drives.find(d => d.letter === 'C:');
    for (const drive of drives) {
      if (drive.letter !== 'C:' && drive.freeSpaceGB > (bestDrive?.freeSpaceGB || 0)) {
        bestDrive = drive;
      }
    }

    if (bestDrive) {
      console.log(`\nRecommended installation drive: ${bestDrive.letter} (${bestDrive.label})`);
      console.log(`Available space: ${bestDrive.freeSpaceGB}GB`);
    }

  } catch (error) {
    console.error('Error testing drive detection:', error);
  }
}

async function testGameDetection() {
  console.log('\n=== Testing Game Detection ===\n');

  const gameTypes = ['LSO', 'TSO', 'Simitone'];

  for (const gameType of gameTypes) {
    console.log(`Searching for ${gameType} installations...`);

    try {
      const installations = await findGameInstallations(gameType);

      if (installations.length === 0) {
        console.log(`  No ${gameType} installations found.`);
      } else {
        console.log(`  Found ${installations.length} ${gameType} installation(s):`);

        for (let i = 0; i < installations.length; i++) {
          const installation = installations[i];
          console.log(`    Installation ${i + 1}:`);
          console.log(`      Path: ${installation.path}`);
          console.log(`      Executable: ${installation.executable}`);
          console.log(`      Drive: ${installation.drive}`);

          // Validate the installation
          const isValid = await validateGameInstallation(installation.path, gameType);
          console.log(`      Valid: ${isValid ? 'Yes' : 'No'}`);
          console.log('');
        }
      }
    } catch (error) {
      console.error(`  Error searching for ${gameType}:`, error.message);
    }

    console.log('---');
  }
}

// Run the tests
async function runAllTests() {
  await testDriveDetection();
  await testGameDetection();
}

runAllTests();
