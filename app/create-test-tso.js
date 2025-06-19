/**
 * Script to create a test TSO installation for testing detection
 * Run with: node create-test-tso.js
 */

const fs = require('fs-extra');
const path = require('path');

async function createTestTSOInstallation() {
  console.log('Creating test TSO installation...');
  
  // Create test TSO installation on D: drive
  const testTSOPath = 'D:\\Test TSO Installation\\The Sims Online';
  const tsoClientPath = path.join(testTSOPath, 'TSOClient');
  
  try {
    // Create directories
    await fs.ensureDir(tsoClientPath);
    console.log(`Created directory: ${tsoClientPath}`);
    
    // Create a dummy TSOClient.exe file
    const tsoClientExe = path.join(tsoClientPath, 'TSOClient.exe');
    await fs.writeFile(tsoClientExe, 'dummy TSO client executable');
    console.log(`Created dummy executable: ${tsoClientExe}`);
    
    // Also create some other common TSO files
    const commonFiles = [
      'TSOClient.exe.config',
      'UIGraphics.uig',
      'GameData.dat'
    ];
    
    for (const file of commonFiles) {
      const filePath = path.join(tsoClientPath, file);
      await fs.writeFile(filePath, `dummy ${file} content`);
      console.log(`Created: ${filePath}`);
    }
    
    console.log('\nTest TSO installation created successfully!');
    console.log(`Location: ${testTSOPath}`);
    console.log(`Executable: ${tsoClientExe}`);
    
  } catch (error) {
    console.error('Error creating test TSO installation:', error);
  }
}

// Run the script
createTestTSOInstallation();
