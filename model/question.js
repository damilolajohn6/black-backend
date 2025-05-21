const mongoose = require("mongoose");

const questionSchema = new mongoose.Schema({
  course: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Course",
    required: true,
  },
  enrollment: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Enrollment",
    required: true,
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  questionText: {
    type: String,
    required: [true, "Question text is required"],
    trim: true,
    maxlength: [1000, "Question cannot exceed 1000 characters"],
  },
  answer: {
    instructor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Instructor",
    },
    answerText: {
      type: String,
      trim: true,
      maxlength: [2000, "Answer cannot exceed 2000 characters"],
    },
    answeredAt: {
      type: Date,
    },
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
  },
});

questionSchema.index({ course: 1, createdAt: -1 });
questionSchema.index({ enrollment: 1 });

module.exports = mongoose.model("Question", questionSchema);
