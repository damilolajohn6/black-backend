// post.js
const mongoose = require("mongoose");

const commentSchema = new mongoose.Schema({
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
  likes: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: [],
    },
  ],
  replies: [this],
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

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
      maxLength: [2800, "Post cannot exceed 2800 characters"],
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
    comments: [commentSchema],
  },
  { timestamps: true }
);

postSchema.pre("save", function (next) {
  if (!Array.isArray(this.comments)) {
    this.comments = [];
  }
  if (!Array.isArray(this.likes)) {
    this.likes = [];
  }
  if (!Array.isArray(this.images)) {
    this.images = [];
  }
  this.comments.forEach((comment) => {
    if (!Array.isArray(comment.likes)) comment.likes = [];
    if (!Array.isArray(comment.replies)) comment.replies = [];
    comment.replies.forEach((reply) => {
      if (!Array.isArray(reply.likes)) reply.likes = [];
      if (!Array.isArray(reply.replies)) reply.replies = [];
    });
  });
  next();
});

postSchema.index({ user: 1, createdAt: -1 });
postSchema.index({ "comments.user": 1 });
postSchema.index({ "comments.replies.user": 1 });

module.exports = mongoose.model("Post", postSchema);
