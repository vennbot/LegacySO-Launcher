/**
 * Test script to verify proxy configuration setup
 * Run with: node test-proxy-config.js
 */

const fs = require('fs-extra');
const ini = require('ini');
const path = require('path');

async function testProxyConfig() {
  console.log('Testing proxy configuration setup...');
  
  const gamePath = 'D:\\LegacySO Game\\LegacySO';
  const configPath = path.join(gamePath, 'Content', 'config.ini');
  
  try {
    // Check if config file exists
    if (!await fs.pathExists(configPath)) {
      console.error('Game config.ini not found at:', configPath);
      return;
    }
    
    // Read existing config
    const configContent = await fs.readFile(configPath, 'utf8');
    const config = ini.parse(configContent);
    
    console.log('Current configuration:');
    console.log('UseCustomServer:', config.UseCustomServer);
    console.log('GameEntryUrl:', config.GameEntryUrl);
    console.log('CitySelectorUrl:', config.CitySelectorUrl);
    console.log('BlogUrl:', config.BlogUrl);
    console.log('TrendingLotsUrl:', config.TrendingLotsUrl);
    console.log('UseProxy:', config.UseProxy);
    console.log('ProxyPort:', config.ProxyPort);
    
    // Update proxy settings
    let configChanged = false;
    
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
      config.ProxyPort = '30632
    }
    
    if (configChanged) {
      await fs.writeFile(configPath, ini.stringify(config));
      console.log('\n✅ Updated game configuration with proxy settings');
    } else {
      console.log('\n✅ Game configuration already has correct proxy settings');
    }
    
    // Test proxy connectivity
    console.log('\nTesting proxy connectivity...');
    const http = require('http');
    
    const testEndpoint = (url, name) => {
      return new Promise((resolve) => {
        const req = http.get(url, (res) => {
          console.log(`✅ ${name} endpoint accessible: ${res.statusCode}`);
          resolve(true);
        });
        
        req.on('error', (error) => {
          console.log(`❌ ${name} endpoint not accessible: ${error.message}`);
          resolve(false);
        });
        
        req.setTimeout(2000, () => {
          console.log(`❌ ${name} endpoint timeout`);
          req.destroy();
          resolve(false);
        });
      });
    };
    
    await testEndpoint('http://localhost:30632/blog', 'Blog');
    await testEndpoint('http://localhost:30632/trending-lots', 'Trending Lots');
    
  } catch (error) {
    console.error('Error testing proxy config:', error);
  }
}

testProxyConfig();
