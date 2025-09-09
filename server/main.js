console.log('🚀 METEOR SERVER STARTING...');

WebApp.rawConnectHandlers.use((req, res, next) => {
    console.log('🌐 INCOMING REQUEST:', req.method, req.url);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
      console.log('🌐 OPTIONS request handled');
      res.writeHead(200);
      res.end();
      return;
    }
    next();
});