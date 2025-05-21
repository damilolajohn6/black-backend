const mongoose = require("mongoose");

const announcementSchema = new mongoose.Schema({
  course: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Course",
    required: true,
  },
  instructor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Instructor",
    required: true,
  },
  title: {
    type: String,
    required: [true, "Announcement title is required"],
    trim: true,
    maxlength: [200, "Title cannot exceed 200 characters"],
  },
  content: {
    type: String,
    required: [true, "Announcement content is required"],
    trim: true,
    maxlength: [2000, "Content cannot exceed 2000 characters"],
  },
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

announcementSchema.index({ course: 1, createdAt: -1 });

module.exports = mongoose.model("Announcement", announcementSchema);
