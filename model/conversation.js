const mongoose = require("mongoose");

const conversationSchema = new mongoose.Schema({
  members: [
    {
      type: mongoose.Schema.Types.ObjectId,
      refPath: "memberModel",
      required: true,
    },
  ],
  memberModel: {
    type: String,
    enum: ["User", "Shop"],
    required: true,
  },
  isGroup: {
    type: Boolean,
    default: false,
  },
  groupId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "GroupChat",
  },
  lastMessage: {
    type: String,
  },
  lastMessageId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Message",
  },
  isArchived: {
    type: Map,
    of: Boolean,
    default: {},
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// Ensure groupId is provided for group conversations
conversationSchema.pre("validate", function (next) {
  if (this.isGroup && !this.groupId) {
    next(new Error("Group conversations must specify a groupId"));
  }
  if (!this.isGroup && this.groupId) {
    next(new Error("Non-group conversations cannot specify a groupId"));
  }
  if (!this.isGroup && this.members.length !== 2) {
    next(new Error("Non-group conversations must have exactly two members"));
  }
  next();
});

conversationSchema.index({ members: 1 });
conversationSchema.index({ groupId: 1 });

module.exports = mongoose.model("Conversation", conversationSchema);
