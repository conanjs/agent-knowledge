const http2 = require('node:http2');
const server = http2.createServer();
let sockets = 0;
server.on('connection', () => { sockets++; });
server.on('stream', (stream) => {
  stream.respond({ ':status': 200 });
  stream.end('ok');
});
server.listen(0, '127.0.0.1', () => {
  const client = http2.connect(`http://127.0.0.1:${server.address().port}`);
  const ids = [];
  for (const path of ['/a', '/b', '/c']) {
    const req = client.request({ ':path': path });
    req.resume();
    req.on('end', () => {
      ids.push(req.id);
      if (ids.length === 3) {
        console.log(`ids=${ids.sort((x, y) => x - y).join(',')} sockets=${sockets}`);
        client.close();
        server.close();
      }
    });
    req.end();
  }
});
