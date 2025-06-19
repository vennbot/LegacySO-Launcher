// preload.js
const { contextBridge, ipcRenderer, shell } = require( 'electron' );
const { net } = require( 'electron' );

contextBridge.exposeInMainWorld( 'shared', {
  on: ( event, callback ) => {
    ipcRenderer.on( event, callback );
  },
  send: ( event, ...data ) => {
    ipcRenderer.send( event, ...data );
  },
  openExternal: url => {
    shell.openExternal( url );
  },
  // CORS-free fetch using Electron's net module
  fetchNoCors: async ( url ) => {
    return new Promise( ( resolve, reject ) => {
      const request = net.request( url );

      request.on( 'response', ( response ) => {
        let data = '';

        response.on( 'data', ( chunk ) => {
          data += chunk;
        } );

        response.on( 'end', () => {
          try {
            const jsonData = JSON.parse( data );
            resolve( {
              ok: response.statusCode >= 200 && response.statusCode < 300,
              status: response.statusCode,
              json: () => Promise.resolve( jsonData )
            } );
          } catch ( error ) {
            reject( new Error( 'Failed to parse JSON: ' + error.message ) );
          }
        } );
      } );

      request.on( 'error', ( error ) => {
        reject( error );
      } );

      request.end();
    } );
  }
} );