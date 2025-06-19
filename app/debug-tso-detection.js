/**
 * Debug script for TSO detection
 * Run with: node debug-tso-detection.js
 */

const { findGameInstallations } = require('./fsolauncher/lib/utils');

async function debugTSODetection() {
  console.log('=== Debug TSO Detection ===\n');
  
  try {
    console.log('Searching for TSO installations with detailed logging...');
    const installations = await findGameInstallations('TSO');
    
    console.log(`\nFound ${installations.length} TSO installation(s):`);
    
    for (let i = 0; i < installations.length; i++) {
      const installation = installations[i];
      console.log(`\nInstallation ${i + 1}:`);
      console.log(`  Path: ${installation.path}`);
      console.log(`  Executable: ${installation.executable}`);
      console.log(`  Drive: ${installation.drive}`);
      console.log(`  Game File: ${installation.gameFile}`);
    }
    
    // Also manually check our test installation
    console.log('\n=== Manual Check of Test Installation ===');
    const fs = require('fs-extra');
    const testPath = 'D:\\Test TSO Installation\\The Sims Online\\TSOClient';
    const testExe = 'D:\\Test TSO Installation\\The Sims Online\\TSOClient\\TSOClient.exe';
    
    const pathExists = await fs.pathExists(testPath);
    const exeExists = await fs.pathExists(testExe);
    
    console.log(`Test path exists: ${pathExists}`);
    console.log(`Test executable exists: ${exeExists}`);
    
    if (pathExists) {
      const contents = await fs.readdir(testPath);
      console.log(`Contents of test directory:`, contents);
    }
    
  } catch (error) {
    console.error('Error in debug detection:', error);
  }
}

debugTSODetection();
