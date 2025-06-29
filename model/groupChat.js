const mongoose = require("mongoose");

const groupChatSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, "Group name is required"],
    trim: true,
    maxlength: [100, "Group name cannot exceed 100 characters"],
  },
  members: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  ],
  admins: [
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
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// Validate admins are members only when admins or members are modified
groupChatSchema.pre("validate", function (next) {
  // Only run validation if members or admins are modified
  if (this.isModified("members") || this.isModified("admins")) {
    if (!this.admins || this.admins.length === 0) {
      return next(new Error("Group must have at least one admin"));
    }

    const memberIds = this.members.map((id) => id.toString());
    const adminIds = this.admins.map((id) => id.toString());

    if (!adminIds.every((adminId) => memberIds.includes(adminId))) {
      return next(new Error("All admins must be members of the group"));
    }
  }
  next();
});

groupChatSchema.index({ members: 1 });
groupChatSchema.index({ createdBy: 1 });

module.exports = mongoose.model("GroupChat", groupChatSchema);
