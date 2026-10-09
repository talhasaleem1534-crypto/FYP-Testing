// A tiny REAL SSH server for tests (ssh2's Server): key login + running commands, like a Linux server.
// Commands run with HOME=<home> and the fake docker/git (shim/) first on PATH, and are logged.
// usage: node fake-sshd.cjs <host> <port> <authorized public key line> <home> <log file>
const { Server, utils } = require('ssh2');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const [host, port, pubLine, home, logFile] = process.argv.slice(2);

const allowed = utils.parseKey(pubLine);
const hostKey = utils.generateKeyPairSync('ed25519').private;
fs.mkdirSync(home, { recursive: true });
const shim = path.join(__dirname, 'shim');

new Server({ hostKeys: [hostKey] }, client => {
  client.on('authentication', ctx => {
    const ok = ctx.method === 'publickey'
      && ctx.key.algo === allowed.type
      && Buffer.compare(ctx.key.data, allowed.getPublicSSH()) === 0
      && (!ctx.signature || allowed.verify(ctx.blob, ctx.signature, ctx.hashAlgo) === true);
    if (ok) ctx.accept(); else ctx.reject(['publickey']);
  });
  client.on('ready', () => {
    client.on('session', accept => {
      const session = accept();
      session.on('exec', (acceptExec, _reject, info) => {
        const stream = acceptExec();
        fs.appendFileSync(logFile, `$ ${info.command}\n`);
        const child = spawn('bash', ['-c', info.command], {
          cwd: home, env: { ...process.env, HOME: home, PATH: `${shim}:${process.env.PATH}` },
        });
        stream.pipe(child.stdin);
        child.stdout.pipe(stream, { end: false });
        child.stderr.pipe(stream.stderr);
        child.on('close', code => { stream.exit(code ?? 1); stream.end(); });
      });
    });
  });
  client.on('error', () => {});
}).listen(Number(port), host, () => console.log(`fake sshd on ${host}:${port}`));

