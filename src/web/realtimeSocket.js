// MODIFIÉ CHANTIER 6 — 14/05/2026 — Socket.IO dashboard isolé
const { Server: SocketIOServer } = require('socket.io');
const { realtimeEvents } = require('../shared/realtime');
const {
    isUserAdmin,
    hasFullSiteAccess,
    canAccessCrafts,
    canEditMapUser,
    canViewMap,
} = require('./middlewares/auth');

function roomsForUser(user) {
    const rooms = ['authenticated'];
    if (isUserAdmin(user)) rooms.push('admin');
    if (hasFullSiteAccess(user)) rooms.push('full');
    if (canAccessCrafts(user)) rooms.push('craft');
    if (canViewMap(user)) rooms.push('map');
    if (canEditMapUser(user)) rooms.push('map:edit');
    return rooms;
}

function roomForRealtimeEvent(type) {
    if (!type) return null;
    if (type.startsWith('audit:')) return 'admin';
    if (type.startsWith('admin:') || type.startsWith('sanction:')) return 'admin';
    if (type.startsWith('craft:') || type.startsWith('weapon:') || type.startsWith('order:')) return 'craft';
    if (type.startsWith('map:')) return 'map';
    if (type.startsWith('presence:') || type.startsWith('weekly:')) return 'full';
    return null;
}

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
        const user = socket.request.session.user;
        for (const room of roomsForUser(user)) socket.join(room);
        socket.emit('dashboard:ready', { ts: Date.now() });
    });
    realtimeEvents.on('event', ({ type, payload }) => {
        const room = roomForRealtimeEvent(type);
        if (room) io.to(room).emit(type, payload);
        else io.emit(type, payload);
    });

    return io;
}

module.exports = { attachRealtimeSocket };
