const winston = require("winston");
const path = require("path");

// Ensure logs directory exists
const logsDir = path.join(__dirname, "../logs");
require("fs").mkdirSync(logsDir, { recursive: true });

// Define custom log format
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  winston.format.json(),
  winston.format.metadata(),
  winston.format.printf(({ timestamp, level, message, metadata }) => {
    return JSON.stringify({
      timestamp,
      level: level.toUpperCase(),
      message,
      ...metadata,
    });
  })
);

// Create logger instance
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info", // Configurable via .env (e.g., 'debug', 'info', 'error')
  format: logFormat,
  transports: [
    // Console output for development
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple(),
        winston.format.printf(({ timestamp, level, message, metadata }) => {
          return `${timestamp} ${level}: ${message} ${
            Object.keys(metadata).length
              ? JSON.stringify(metadata, null, 2)
              : ""
          }`;
        })
      ),
    }),
    // File output for all logs
    new winston.transports.File({
      filename: path.join(logsDir, "combined.log"),
      maxsize: 5242880, // 5MB
      maxFiles: 5, // Keep 5 rotated files
    }),
    // File output for error logs only
    new winston.transports.File({
      filename: path.join(logsDir, "error.log"),
      level: "error",
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
  ],
  exceptionHandlers: [
    new winston.transports.File({
      filename: path.join(logsDir, "exceptions.log"),
    }),
  ],
});

// Add method to log with context (e.g., userId, orderId)
logger.logWithContext = (level, message, context = {}) => {
  logger.log({
    level,
    message,
    metadata: context,
  });
};

// Convenience methods for specific log levels
logger.info = (message, context = {}) =>
  logger.logWithContext("info", message, context);
logger.warn = (message, context = {}) =>
  logger.logWithContext("warn", message, context);
logger.error = (message, context = {}) =>
  logger.logWithContext("error", message, context);
logger.debug = (message, context = {}) =>
  logger.logWithContext("debug", message, context);

module.exports = logger;
