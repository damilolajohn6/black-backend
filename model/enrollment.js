const mongoose = require("mongoose");

const enrollmentSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
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
  progress: [
    {
      lectureId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
      },
      completed: {
        type: Boolean,
        default: false,
      },
      completedAt: {
        type: Date,
      },
    },
  ],
  completionPercentage: {
    type: Number,
    default: 0,
    min: [0, "Completion percentage cannot be negative"],
    max: [100, "Completion percentage cannot exceed 100"],
  },
  status: {
    type: String,
    enum: ["Enrolled", "Completed", "Dropped"],
    default: "Enrolled",
  },
  enrolledAt: {
    type: Date,
    default: Date.now,
  },
  completedAt: {
    type: Date,
  },
});

// Update completionPercentage
enrollmentSchema.pre("save", function (next) {
  if (this.isModified("progress")) {
    const totalLectures = this.progress.length;
    const completedLectures = this.progress.filter((p) => p.completed).length;
    this.completionPercentage =
      totalLectures > 0 ? (completedLectures / totalLectures) * 100 : 0;
    if (this.completionPercentage === 100) {
      this.status = "Completed";
      this.completedAt = new Date();
    }
  }
  next();
});

// Indexes
enrollmentSchema.index({ user: 1, course: 1 }, { unique: true });
enrollmentSchema.index({ instructor: 1 });
enrollmentSchema.index({ status: 1 });

module.exports = mongoose.model("Enrollment", enrollmentSchema);
