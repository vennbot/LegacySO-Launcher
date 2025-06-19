const cp = require( 'child_process' );
const path = require( 'path' );

const runWithUTF8 = ( args = [] ) => {
  return new Promise( ( resolve, reject ) => {
    const registryPath = path.join( process.env.windir, 'system32', 'reg.exe' );
    const chcpPath = path.join( process.env.windir, 'system32', 'chcp.com' );
    const command = `${chcpPath} 65001 >nul && ${registryPath}`;
    
    const child = cp.spawn( command, args, { shell: true } );

    let stdout = '', stderr = '';
    child.stdout.on( 'data', ( data ) => {
      stdout += data;
    });
    child.stderr.on( 'data', ( data ) => {
      stderr += data;
    });

    child.on( 'exit', ( code ) => {
      // Don't treat missing registry keys as errors
      if (code === 1 && stderr.includes('ERROR: The system was unable to find the specified registry key or value')) {
        resolve('');
        return;
      }
      
      if ( code !== 0 ) {
        resolve(''); // Return empty string instead of rejecting
      } else {
        resolve( stdout );
      }
    } );
    child.on( 'error', () => {
      resolve(''); // Return empty string on errors
    });
  } );
};

const readFromRegistry = async ( keyPath, valueName ) => {
  try {
    const stdout = await runWithUTF8( [ 'QUERY', `"${keyPath}"`, '/v', `"${valueName}"` ] );
    if (!stdout) return null;
    
    const match = stdout.match( /REG_[^ ]+\s+([^\r\n]+)/ );
    return match ? match[1] : null;
  } catch (err) {
    return null;
  }
};

module.exports = {
  createKey: async ( keyPath ) => {
    return await runWithUTF8( [ 'ADD', `"${keyPath}"` ] );
  },
  readValue: async ( keyPath, valueName ) => {
    try {
      // Try reading from the 64-bit registry first.
      return await readFromRegistry( keyPath, valueName );
    } catch ( err ) {
      // If that fails, try reading from the 32-bit registry.
      return await readFromRegistry( keyPath.replace( 'SOFTWARE\\', 'SOFTWARE\\WOW6432Node\\' ), valueName );
    }
  },
  updateValue: async ( keyPath, valueName, data, type = 'REG_SZ' ) => {
    return await runWithUTF8( [ 'ADD', `"${keyPath}"`, '/v', `"${valueName}"`, '/t', type, '/d', `"${data}"`, '/f' ] );
  },
  deleteKey: async ( keyPath ) => {
    return await runWithUTF8( [ 'DELETE', `"${keyPath}"`, '/f' ] );
  },
  keyExists: async ( keyPath ) => {
    try {
      console.log('Checking registry key:', keyPath);
      // Try checking the 64-bit registry first.
      await runWithUTF8( [ 'QUERY', `"${keyPath}"` ] );
      console.log('Found key in 64-bit registry:', keyPath);
      return true;
    } catch ( err ) {
      console.log('64-bit registry check failed:', err.message);
      // If that fails, try checking the 32-bit registry.
      try {
        const wow32Path = keyPath.replace('SOFTWARE\\', 'SOFTWARE\\WOW6432Node\\');
        console.log('Checking 32-bit registry:', wow32Path);
        await runWithUTF8( [ 'QUERY', `"${wow32Path}"` ] );
        console.log('Found key in 32-bit registry:', wow32Path);
        return true;
      } catch ( err ) {
        console.log('32-bit registry check failed:', err.message);
        return false;
      }
    }
  }
};



