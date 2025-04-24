// socket.js
const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const Message = require("../model/message");
const User = require("../model/user");

const socketUsers = new Map();

const initializeSocket = (server) => {
  const io = new Server(server, {
    cors: {
      origin: "http://localhost:3000",
      methods: ["GET", "POST"],
      credentials: true,
    },
    path: "/socket.io", // Explicitly set the path for clarity
  });

  // Authentication middleware
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) {
      return next(new Error("Authentication error: No token provided"));
    }
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET_KEY);
      socket.userId = decoded.id;
      next();
    } catch (error) {
      next(new Error("Authentication error: Invalid token"));
    }
  });

  // Connection handling
  io.on("connection", (socket) => {
    console.info("socket: User connected", { userId: socket.userId });
    console.info("Connected users:", socketUsers.size);
    socketUsers.set(socket.userId, socket.id);

    // Join a room based on userId for direct messaging
    socket.join(socket.userId);

    socket.on("sendMessage", async ({ recipientId, content }) => {
      console.log("Received sendMessage event:", { recipientId, content });
      try {
        if (!recipientId || !content || content.length > 5000) {
          socket.emit("error", "Invalid message data");
          return;
        }

        const recipient = await User.findById(recipientId);
        if (!recipient) {
          socket.emit("error", "Recipient not found");
          return;
        }

        if (socket.userId === recipientId) {
          socket.emit("error", "Cannot send message to yourself");
          return;
        }

        const message = await Message.create({
          senderId: socket.userId,
          receiverId: recipientId,
          content,
        });

        const populatedMessage = await Message.findById(message._id)
          .populate("senderId", "name avatar")
          .populate("receiverId", "name avatar");

        // Emit to recipient's room
        io.to(recipientId).emit("receiveMessage", populatedMessage);
        // Emit to sender to confirm message was sent
        socket.emit("messageSent", populatedMessage);

        console.info("send-message: Message sent", {
          senderId: socket.userId,
          recipientId,
          content: content.substring(0, 50),
        });
      } catch (error) {
        console.error("SEND MESSAGE ERROR:", error);
        socket.emit("error", "Failed to send message");
      }
    });

    socket.on("disconnect", () => {
      console.info("socket: User disconnected", { userId: socket.userId });
      socketUsers.delete(socket.userId);
    });
  });

  return io;
};

const getReceiverSocketId = (receiverId) => socketUsers.get(receiverId);

module.exports = { initializeSocket, getReceiverSocketId };
