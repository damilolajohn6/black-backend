const mongoose = require("mongoose");
const validator = require("validator");

const lectureSchema = new mongoose.Schema({
  course: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Course",
    required: true,
  },
  title: {
    type: String,
    required: [true, "Lecture title is required"],
    trim: true,
    maxlength: [100, "Lecture title cannot exceed 100 characters"],
  },
  videoUrl: {
    type: String,
    required: [true, "Video URL is required"],
    validate: [validator.isURL, "Invalid video URL"],
  },
  duration: {
    type: Number,
    required: [true, "Lecture duration is required"],
    min: [0, "Duration cannot be negative"],
  },
  resources: [
    {
      title: { type: String, required: true, trim: true },
      url: {
        type: String,
        required: true,
        validate: [validator.isURL, "Invalid resource URL"],
      },
      fileType: {
        type: String,
        enum: ["PDF", "Image", "Document", "Other"],
        default: "Other",
      },
    },
  ],
  isPreview: {
    type: Boolean,
    default: false,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

lectureSchema.index({ course: 1 });

module.exports = mongoose.model("Lecture", lectureSchema);
