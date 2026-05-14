// MODIFIÉ CHANTIER 6 — 14/05/2026 — Socket.IO dashboard isolé
const { Server: SocketIOServer } = require('socket.io');
const { realtimeEvents } = require('../shared/realtime');

function attachRealtimeSocket(httpServer, sessionMiddleware) {
    const io = new SocketIOServer(httpServer, {
        path: '/socket.io',
        serveClient: true,
    });

    io.engine.use(sessionMiddleware);
    io.use((socket, next) => {
        if (socket.request.session?.user) return next();
        next(new Error('Non connecté'));
    });
    io.on('connection', socket => {
        socket.emit('dashboard:ready', { ts: Date.now() });
    });
    realtimeEvents.on('event', ({ type, payload }) => {
        io.emit(type, payload);
    });

    return io;
}

module.exports = { attachRealtimeSocket };
