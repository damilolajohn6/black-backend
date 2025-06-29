const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const Message = require("../model/message");
const User = require("../model/user");
const Shop = require("../model/shop");
const cloudinary = require("cloudinary").v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const socketUsers = new Map();

const initializeSocket = (server) => {
  const io = new Server(server, {
    cors: {
      origin: ["http://localhost:3000", "https://your-production-url.com"],
      methods: ["GET", "POST"],
      credentials: true,
    },
    path: "/socket.io",
  });

  // Authentication middleware
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) {
      return next(new Error("Authentication error: No token provided"));
    }
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET_KEY);
      if (decoded.role === "Seller") {
        socket.shopId = decoded.id;
        socket.userId = null;
      } else {
        socket.userId = decoded.id;
        socket.shopId = null;
      }
      next();
    } catch (error) {
      next(new Error("Authentication error: Invalid token"));
    }
  });

  // Connection handling
  io.on("connection", (socket) => {
    if (socket.userId) {
      console.info("socket: User connected", { userId: socket.userId });
      socketUsers.set(socket.userId, socket.id);
      socket.join(socket.userId);
    } else if (socket.shopId) {
      console.info("socket: Shop connected", { shopId: socket.shopId });
      socketUsers.set(`shop_${socket.shopId}`, socket.id);
      socket.join(`shop_${socket.shopId}`);
    }

    socket.on(
      "sendMessage",
      async ({ recipientId, recipientType, content, media }) => {
        console.log("Received sendMessage event:", {
          recipientId,
          recipientType,
          content,
        });
        try {
          if (
            !recipientId ||
            !recipientType ||
            (!content && (!media || media.length === 0))
          ) {
            socket.emit("error", "Invalid message data");
            return;
          }
          if (content && content.length > 5000) {
            socket.emit("error", "Message content exceeds 5000 characters");
            return;
          }

          let recipient;
          if (recipientType === "User") {
            recipient = await User.findById(recipientId);
          } else if (recipientType === "Shop") {
            recipient = await Shop.findById(recipientId);
          } else {
            socket.emit("error", "Invalid recipient type");
            return;
          }

          if (!recipient) {
            socket.emit("error", `${recipientType} not found`);
            return;
          }

          // Check block status
          const senderId = socket.userId || socket.shopId;
          const senderModel = socket.userId ? "User" : "Shop";
          if (senderId === recipientId && senderModel === recipientType) {
            socket.emit("error", "Cannot send message to yourself");
            return;
          }
          if (senderModel === "User" && recipientType === "Shop") {
            const user = await User.findById(senderId).select("blockedShops");
            const shop = await Shop.findById(recipientId).select(
              "blockedUsers"
            );
            if (user.blockedShops && user.blockedShops.includes(recipientId)) {
              socket.emit("error", "You have blocked this shop");
              return;
            }
            if (shop.blockedUsers && shop.blockedUsers.includes(senderId)) {
              socket.emit("error", "You are blocked by this shop");
              return;
            }
          } else if (senderModel === "Shop" && recipientType === "User") {
            const shop = await Shop.findById(senderId).select("blockedUsers");
            const user = await User.findById(recipientId).select(
              "blockedShops"
            );
            if (shop.blockedUsers && shop.blockedUsers.includes(recipientId)) {
              socket.emit("error", "You have blocked this user");
              return;
            }
            if (user.blockedShops && user.blockedShops.includes(senderId)) {
              socket.emit("error", "You are blocked by this user");
              return;
            }
          }

          const messageMedia = [];
          if (media && Array.isArray(media) && media.length > 0) {
            for (const item of media.slice(0, 4)) {
              if (!item.data || !["image", "video"].includes(item.type)) {
                socket.emit("error", "Invalid media format");
                return;
              }
              const myCloud = await cloudinary.uploader.upload(item.data, {
                folder: "messages",
                resource_type: item.type === "video" ? "video" : "image",
              });
              messageMedia.push({
                type: item.type,
                public_id: myCloud.public_id,
                url: myCloud.secure_url,
              });
            }
          }

          const message = await Message.create({
            senderId,
            senderModel,
            receiverId: recipientId,
            receiverModel: recipientType,
            content: content || "",
            media: messageMedia,
          });

          const populatedMessage = await Message.findById(message._id)
            .populate(
              "senderId",
              senderModel === "User" ? "username avatar" : "name avatar"
            )
            .populate(
              "receiverId",
              recipientType === "User" ? "username avatar" : "name avatar"
            );

          // Emit to recipient's room
          const recipientRoom =
            recipientType === "Shop" ? `shop_${recipientId}` : recipientId;
          io.to(recipientRoom).emit("newMessage", populatedMessage);
          // Emit to sender to confirm message was sent
          socket.emit("messageSent", populatedMessage);

          console.info("send-message: Message sent", {
            senderId,
            senderModel,
            recipientId,
            recipientType,
            content: content ? content.substring(0, 50) : "",
            mediaCount: messageMedia.length,
          });
        } catch (error) {
          console.error("SEND MESSAGE ERROR:", error);
          socket.emit("error", "Failed to send message");
        }
      }
    );

    socket.on("markMessageRead", async ({ messageId }) => {
      try {
        if (!mongoose.isValidObjectId(messageId)) {
          socket.emit("error", "Invalid message ID");
          return;
        }

        const message = await Message.findById(messageId);
        if (!message) {
          socket.emit("error", "Message not found");
          return;
        }

        const receiverId = socket.userId || socket.shopId;
        const receiverModel = socket.userId ? "User" : "Shop";
        if (
          message.receiverId.toString() !== receiverId ||
          message.receiverModel !== receiverModel
        ) {
          socket.emit("error", "Unauthorized to mark this message as read");
          return;
        }

        if (message.isRead) {
          socket.emit("error", "Message already marked as read");
          return;
        }

        message.isRead = true;
        await message.save();

        const senderRoom =
          message.senderModel === "Shop"
            ? `shop_${message.senderId}`
            : message.senderId;
        io.to(senderRoom).emit("messageRead", { messageId: message._id });

        console.info("mark-message-read: Message marked as read", {
          messageId,
          receiverId,
          receiverModel,
        });
      } catch (error) {
        console.error("MARK MESSAGE READ ERROR:", error);
        socket.emit("error", "Failed to mark message as read");
      }
    });

    socket.on("deleteMessage", async ({ messageId }) => {
      try {
        if (!mongoose.isValidObjectId(messageId)) {
          socket.emit("error", "Invalid message ID");
          return;
        }

        const message = await Message.findById(messageId);
        if (!message) {
          socket.emit("error", "Message not found");
          return;
        }

        const actorId = socket.userId || socket.shopId;
        const actorModel = socket.userId ? "User" : "Shop";
        if (
          (message.senderId.toString() !== actorId ||
            message.senderModel !== actorModel) &&
          (message.receiverId.toString() !== actorId ||
            message.receiverModel !== actorModel)
        ) {
          socket.emit("error", "Unauthorized to delete this message");
          return;
        }

        if (message.isDeleted) {
          socket.emit("error", "Message already deleted");
          return;
        }

        message.isDeleted = true;
        message.deletedBy.push({ id: actorId, model: actorModel });
        await message.save();

        const otherPartyId =
          message.senderId.toString() === actorId
            ? message.receiverId
            : message.senderId;
        const otherPartyModel =
          message.senderId.toString() === actorId
            ? message.receiverModel
            : message.senderModel;
        const otherPartySocketId = socketUsers.get(
          otherPartyModel === "Shop" ? `shop_${otherPartyId}` : otherPartyId
        );
        if (otherPartySocketId) {
          io.to(otherPartySocketId).emit("messageDeleted", { messageId });
        }

        console.info("delete-message: Message deleted", {
          messageId,
          actorId,
          actorModel,
        });
      } catch (error) {
        console.error("DELETE MESSAGE ERROR:", error);
        socket.emit("error", "Failed to delete message");
      }
    });

    socket.on("archiveConversation", async ({ conversationId }) => {
      try {
        if (!mongoose.isValidObjectId(conversationId)) {
          socket.emit("error", "Invalid conversation ID");
          return;
        }

        const conversation = await Conversation.findById(conversationId);
        if (!conversation) {
          socket.emit("error", "Conversation not found");
          return;
        }

        const actorId = socket.userId || socket.shopId;
        if (
          !conversation.members
            .map((id) => id.toString())
            .includes(actorId.toString())
        ) {
          socket.emit("error", "Unauthorized to archive this conversation");
          return;
        }

        conversation.isArchived = conversation.isArchived || {};
        conversation.isArchived.set(actorId.toString(), true);
        await conversation.save();

        const otherMemberId = conversation.members.find(
          (id) => id.toString() !== actorId.toString()
        );
        const otherMemberSocketId = socketUsers.get(
          conversation.memberModel === "Shop" &&
            otherMemberId.toString() !== actorId.toString()
            ? `shop_${otherMemberId}`
            : otherMemberId
        );
        if (otherMemberSocketId) {
          io.to(otherMemberSocketId).emit("conversationArchived", {
            conversationId,
          });
        }

        console.info("archive-conversation: Conversation archived", {
          conversationId,
          actorId,
        });
      } catch (error) {
        console.error("ARCHIVE CONVERSATION ERROR:", error);
        socket.emit("error", "Failed to archive conversation");
      }
    });

    socket.on("unarchiveConversation", async ({ conversationId }) => {
      try {
        if (!mongoose.isValidObjectId(conversationId)) {
          socket.emit("error", "Invalid conversation ID");
          return;
        }

        const conversation = await Conversation.findById(conversationId);
        if (!conversation) {
          socket.emit("error", "Conversation not found");
          return;
        }

        const actorId = socket.userId || socket.shopId;
        if (
          !conversation.members
            .map((id) => id.toString())
            .includes(actorId.toString())
        ) {
          socket.emit("error", "Unauthorized to unarchive this conversation");
          return;
        }

        conversation.isArchived = conversation.isArchived || {};
        conversation.isArchived.set(actorId.toString(), false);
        await conversation.save();

        const otherMemberId = conversation.members.find(
          (id) => id.toString() !== actorId.toString()
        );
        const otherMemberSocketId = socketUsers.get(
          conversation.memberModel === "Shop" &&
            otherMemberId.toString() !== actorId.toString()
            ? `shop_${otherMemberId}`
            : otherMemberId
        );
        if (otherMemberSocketId) {
          io.to(otherMemberSocketId).emit("conversationUnarchived", {
            conversationId,
          });
        }

        console.info("unarchive-conversation: Conversation unarchived", {
          conversationId,
          actorId,
        });
      } catch (error) {
        console.error("UNARCHIVE CONVERSATION ERROR:", error);
        socket.emit("error", "Failed to unarchive conversation");
      }
    });

    socket.on("blockEntity", async ({ entityId, entityType }) => {
      try {
        if (!mongoose.isValidObjectId(entityId)) {
          socket.emit("error", "Invalid entity ID");
          return;
        }
        if (!["User", "Shop"].includes(entityType)) {
          socket.emit("error", "Invalid entity type");
          return;
        }

        const actorId = socket.userId || socket.shopId;
        const actorModel = socket.userId ? "User" : "Shop";
        if (actorId === entityId && actorModel === entityType) {
          socket.emit("error", "Cannot block yourself");
          return;
        }

        let actor, entity;
        if (actorModel === "User") {
          actor = await User.findById(actorId);
          if (entityType === "Shop") {
            entity = await Shop.findById(entityId);
            if (!entity) {
              socket.emit("error", "Shop not found");
              return;
            }
            if (!actor.blockedShops) actor.blockedShops = [];
            if (actor.blockedShops.includes(entityId)) {
              socket.emit("error", "Shop already blocked");
              return;
            }
            actor.blockedShops.push(entityId);
            await actor.save();
          } else {
            socket.emit(
              "error",
              "Users cannot block other users in this context"
            );
            return;
          }
        } else {
          actor = await Shop.findById(actorId);
          if (entityType === "User") {
            entity = await User.findById(entityId);
            if (!entity) {
              socket.emit("error", "User not found");
              return;
            }
            if (!actor.blockedUsers) actor.blockedUsers = [];
            if (actor.blockedUsers.includes(entityId)) {
              socket.emit("error", "User already blocked");
              return;
            }
            actor.blockedUsers.push(entityId);
            await actor.save();
          } else {
            socket.emit(
              "error",
              "Shops cannot block other shops in this context"
            );
            return;
          }
        }

        const entitySocketId = socketUsers.get(
          entityType === "Shop" ? `shop_${entityId}` : entityId
        );
        if (entitySocketId) {
          io.to(entitySocketId).emit(`blockedBy${actorModel}`, {
            entityId: actorId,
          });
        }

        console.info("block-entity: Entity blocked", {
          actorId,
          actorModel,
          entityId,
          entityType,
        });
      } catch (error) {
        console.error("BLOCK ENTITY ERROR:", error);
        socket.emit("error", "Failed to block entity");
      }
    });

    socket.on("unblockEntity", async ({ entityId, entityType }) => {
      try {
        if (!mongoose.isValidObjectId(entityId)) {
          socket.emit("error", "Invalid entity ID");
          return;
        }
        if (!["User", "Shop"].includes(entityType)) {
          socket.emit("error", "Invalid entity type");
          return;
        }

        const actorId = socket.userId || socket.shopId;
        const actorModel = socket.userId ? "User" : "Shop";

        let actor, entity;
        if (actorModel === "User") {
          actor = await User.findById(actorId);
          if (entityType === "Shop") {
            entity = await Shop.findById(entityId);
            if (!entity) {
              socket.emit("error", "Shop not found");
              return;
            }
            if (!actor.blockedShops || !actor.blockedShops.includes(entityId)) {
              socket.emit("error", "Shop not blocked");
              return;
            }
            actor.blockedShops = actor.blockedShops.filter(
              (id) => id.toString() !== entityId.toString()
            );
            await actor.save();
          } else {
            socket.emit(
              "error",
              "Users cannot unblock other users in this context"
            );
            return;
          }
        } else {
          actor = await Shop.findById(actorId);
          if (entityType === "User") {
            entity = await User.findById(entityId);
            if (!entity) {
              socket.emit("error", "User not found");
              return;
            }
            if (!actor.blockedUsers || !actor.blockedUsers.includes(entityId)) {
              socket.emit("error", "User not blocked");
              return;
            }
            actor.blockedUsers = actor.blockedUsers.filter(
              (id) => id.toString() !== entityId.toString()
            );
            await actor.save();
          } else {
            socket.emit(
              "error",
              "Shops cannot unblock other shops in this context"
            );
            return;
          }
        }

        const entitySocketId = socketUsers.get(
          entityType === "Shop" ? `shop_${entityId}` : entityId
        );
        if (entitySocketId) {
          io.to(entitySocketId).emit(`unblockedBy${actorModel}`, {
            entityId: actorId,
          });
        }

        console.info("unblock-entity: Entity unblocked", {
          actorId,
          actorModel,
          entityId,
          entityType,
        });
      } catch (error) {
        console.error("UNBLOCK ENTITY ERROR:", error);
        socket.emit("error", "Failed to unblock entity");
      }
    });

    socket.on("disconnect", () => {
      if (socket.userId) {
        console.info("socket: User disconnected", { userId: socket.userId });
        socketUsers.delete(socket.userId);
      } else if (socket.shopId) {
        console.info("socket: Shop disconnected", { shopId: socket.shopId });
        socketUsers.delete(`shop_${socket.shopId}`);
      }
    });
  });

  return io;
};

const getReceiverSocketId = (receiverId) => socketUsers.get(receiverId);

module.exports = { initializeSocket, getReceiverSocketId };
