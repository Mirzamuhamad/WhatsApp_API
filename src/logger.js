import pino from 'pino';
import { config } from './config.js';

export const logger = pino({
  level: process.env.LOG_LEVEL || (config.app.env === 'production' ? 'info' : 'debug'),
  transport:
    config.app.env === 'production'
      ? undefined
      : {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard'
          }
        }
});
