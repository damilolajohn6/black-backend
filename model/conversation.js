const mongoose = require("mongoose");

const conversationSchema = new mongoose.Schema(
  {
    groupTitle: {
      type: String,
      default: "",
    },
    members: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
      },
    ],
    lastMessage: {
      type: String,
    },
    lastMessageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
    },
  },
  { timestamps: true }
);

conversationSchema.index({ members: 1, updatedAt: -1 });

module.exports = mongoose.model("Conversation", conversationSchema);