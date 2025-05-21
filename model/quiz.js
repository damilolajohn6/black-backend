const mongoose = require("mongoose");

const quizSchema = new mongoose.Schema({
  course: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Course",
    required: true,
  },
  sectionId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
  },
  title: {
    type: String,
    required: [true, "Quiz title is required"],
    trim: true,
    maxlength: [100, "Quiz title cannot exceed 100 characters"],
  },
  description: {
    type: String,
    trim: true,
    maxlength: [1000, "Quiz description cannot exceed 1000 characters"],
  },
  timeLimit: {
    type: Number,
    min: [0, "Time limit cannot be negative"],
    default: 0, // 0 means no time limit
  },
  passingScore: {
    type: Number,
    min: [0, "Passing score cannot be negative"],
    max: [100, "Passing score cannot exceed 100"],
    default: 70,
  },
  questions: [
    {
      questionType: {
        type: String,
        enum: ["MultipleChoice", "TrueFalse", "OpenEnded"],
        required: true,
      },
      questionText: {
        type: String,
        required: true,
        trim: true,
        maxlength: [500, "Question text cannot exceed 500 characters"],
      },
      options: [
        {
          text: { type: String, required: true },
          isCorrect: { type: Boolean }, // Only for MultipleChoice and TrueFalse
        },
      ],
      correctAnswer: {
        type: String, // For OpenEnded questions
      },
      points: {
        type: Number,
        default: 1,
        min: [0, "Points cannot be negative"],
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

// Validate questions based on type
quizSchema.pre("save", function (next) {
  for (const question of this.questions) {
    if (question.questionType === "MultipleChoice") {
      if (!question.options || question.options.length < 2) {
        return next(
          new Error("MultipleChoice questions must have at least 2 options")
        );
      }
      if (!question.options.some((opt) => opt.isCorrect)) {
        return next(
          new Error(
            "MultipleChoice questions must have at least one correct option"
          )
        );
      }
    } else if (question.questionType === "TrueFalse") {
      if (question.options.length !== 2) {
        return next(
          new Error("TrueFalse questions must have exactly 2 options")
        );
      }
      if (question.options.filter((opt) => opt.isCorrect).length !== 1) {
        return next(
          new Error("TrueFalse questions must have exactly one correct option")
        );
      }
    } else if (question.questionType === "OpenEnded") {
      if (!question.correctAnswer) {
        return next(
          new Error("OpenEnded questions must have a correct answer")
        );
      }
    }
  }
  next();
});

quizSchema.index({ course: 1, sectionId: 1 });

module.exports = mongoose.model("Quiz", quizSchema);
