const mongoose = require("mongoose");

const discussionSchema = new mongoose.Schema({
  course: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Course",
    required: true,
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  title: {
    type: String,
    required: [true, "Discussion title is required"],
    trim: true,
    maxlength: [200, "Title cannot exceed 200 characters"],
  },
  content: {
    type: String,
    required: [true, "Discussion content is required"],
    trim: true,
    maxlength: [2000, "Content cannot exceed 2000 characters"],
  },
  replies: [
    {
      user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
      },
      content: {
        type: String,
        required: true,
        trim: true,
        maxlength: [1000, "Reply cannot exceed 1000 characters"],
      },
      createdAt: {
        type: Date,
        default: Date.now,
      },
    },
  ],
  isActive: {
    type: Boolean,
    default: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
  },
});

discussionSchema.index({ course: 1, createdAt: -1 });

module.exports = mongoose.model("Discussion", discussionSchema);
