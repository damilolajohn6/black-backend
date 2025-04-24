const mongoose = require("mongoose");
//import mongoose from "mongoose";



const messageSchema = new mongoose.Schema(
  {
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    receiverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    content: {
      type: String,
      required: true,
      maxLength: [5000, "Message cannot exceed 5000 characters"],
    },
    image: {
      public_id: { type: String },
      url: { type: String },
    },
    isRead: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

messageSchema.index({ senderId: 1, receiverId: 1, createdAt: -1 });

module.exports = mongoose.model("Message", messageSchema);
