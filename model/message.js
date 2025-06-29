const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema(
  {
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      refPath: "senderModel",
      required: true,
    },
    senderModel: {
      type: String,
      enum: ["User", "Shop", "Instructor"],
      required: true,
    },
    receiverId: {
      type: mongoose.Schema.Types.ObjectId,
      refPath: "receiverModel",
    },
    receiverModel: {
      type: String,
      enum: ["User", "Shop", "Instructor"],
      required: function () {
        return !this.groupId;
      },
    },
    groupId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "GroupChat",
    },
    content: {
      type: String,
      maxLength: [5000, "Message cannot exceed 5000 characters"],
      trim: true,
    },
    media: [
      {
        type: {
          type: String,
          enum: ["image", "video"],
        },
        public_id: {
          type: String,
        },
        url: {
          type: String,
        },
      },
    ],
    isRead: {
      type: Boolean,
      default: false,
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
    deletedBy: [
      {
        id: { type: mongoose.Schema.Types.ObjectId },
        model: { type: String, enum: ["User", "Shop", "Instructor"] },
      },
    ],
  },
  { timestamps: true }
);

// Updated validation hook
messageSchema.pre("validate", function (next) {
  if (!this.content && (!this.media || this.media.length === 0)) {
    return next(new Error("Message must contain either content or media"));
  }
  // Ensure either receiverId or groupId is provided, but not both
  if (!this.receiverId && !this.groupId) {
    return next(new Error("Message must specify either a receiver or a group"));
  }
  if (this.receiverId && this.groupId) {
    return next(
      new Error("Message cannot specify both a receiver and a group")
    );
  }
  // Allow same model types for User-to-User messaging
  if (
    this.receiverId &&
    this.senderModel === this.receiverModel &&
    this.senderModel !== "User"
  ) {
    return next(
      new Error(
        "Sender and receiver must be of different types for non-User models"
      )
    );
  }
  next();
});

messageSchema.index({ senderId: 1, receiverId: 1, createdAt: -1 });
messageSchema.index({ groupId: 1, createdAt: -1 });

module.exports = mongoose.model("Message", messageSchema);
