require("dotenv").config({ path: "config/.env" });
const app = require("./app");
const connectDatabase = require("./db/Database");
const cloudinary = require("cloudinary");
const { scheduleEventStatusUpdates } = require("./jobs/eventStatusJob");
const { initializeSocket, getReceiverSocketId } = require("./socket/socket");
const http = require("http");

// Handle uncaught exceptions
process.on("uncaughtException", (err) => {
  console.error(`Uncaught Exception: ${err.message}`);
  process.exit(1);
});

// Connect to MongoDB
connectDatabase();

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Create HTTP server
const server = http.createServer(app);
const io = initializeSocket(server);

// Store io in app for use in routes
app.set("io", io);

// Start server
const PORT = process.env.PORT || 8000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  scheduleEventStatusUpdates();
  console.log("Event status update job scheduled");
});

// Handle unhandled promise rejections
process.on("unhandledRejection", (err) => {
  console.error(`Unhandled Rejection: ${err.message}`);
  server.close(() => {
    process.exit(1);
  });
});

// Export io and getReceiverSocketId for use in other modules
module.exports = { io, getReceiverSocketId };
