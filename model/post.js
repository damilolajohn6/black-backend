const mongoose = require("mongoose");
//import mongoose from "mongoose";

const postSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    content: {
      type: String,
      required: true,
      maxLength: [280, "Post cannot exceed 280 characters"],
    },
    images: [
      {
        public_id: { type: String },
        url: { type: String },
      },
    ],
    likes: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: [],
      },
    ],
    comments: [
      {
        user: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          required: true,
        },
        content: {
          type: String,
          required: true,
          maxLength: [280, "Comment cannot exceed 280 characters"],
        },
        default: [],
        createdAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
  },
  { timestamps: true }
);

postSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model("Post", postSchema);

