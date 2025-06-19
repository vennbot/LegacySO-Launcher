const directives = {
  'default-src': [ "'self'" ],
  'script-src': [ "'self'", 'https://*.sentry-cdn.com' ],
  'worker-src': [ "'self'", 'blob:' ],
  'style-src': [ "'self'", "'unsafe-inline'" ],
  'connect-src': [
    "'self'",
    'http://localhost:30632',
    'https://legacyso.org',
    'https://api.legacyso.org',
    'wss://*.freeso.org',
    'wss://freeso.org',
    'https://*.freeso.org',
    'https://freeso.org',
    'https://*.sentry.io',
    'https://sentry.io',
  ],
  'img-src': [ "'self'", 'data:', 'https://*.sentry-cdn.com', 'https://*.freeso.org', 'https://freeso.org', 'https://i0.wp.com', 'https://legacyso.org', 'https://*.legacyso.org' ],
  'font-src': [ "'self'", 'data:' ],
};

module.exports = Object.entries( directives )
  .map( ( [ directive, sources ] ) => `${directive} ${sources.join( ' ' )}` )
  .join( '; ' );