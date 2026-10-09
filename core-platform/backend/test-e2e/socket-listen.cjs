// Connects to the backend's live-log socket as one user and counts the deploy log lines it receives.
// usage: node socket-listen.cjs <url> <token|-> <seconds>
const { io } = require(process.env.SOCKET_IO_CLIENT || 'socket.io-client');
const [url, token, secs] = process.argv.slice(2);
const socket = io(url, { auth: token && token !== '-' ? { token } : {}, transports: ['websocket'], reconnection: false });
let lines = 0, connected = false;
socket.on('connect', () => { connected = true; });
socket.on('global_deploy_log', () => { lines++; });
setTimeout(() => { console.log(JSON.stringify({ connected: connected && socket.connected, lines })); process.exit(0); }, Number(secs) * 1000);
