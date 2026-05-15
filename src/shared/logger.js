// STABILISATION FINALE v2 16/05/2026 — logger pino partagé backend
const pino = require('pino');
const config = require('./config');

const isDev = !config.isProduction && !config.isRailway;

const log = pino({
    level: process.env.LOG_LEVEL || (isDev ? 'debug' : 'info'),
    transport: isDev ? {
        target: 'pino-pretty',
        options: {
            colorize: true,
            translateTime: 'HH:MM:ss',
            ignore: 'pid,hostname,service',
        },
    } : undefined,
    base: { service: '21bs' },
});

module.exports = log;
