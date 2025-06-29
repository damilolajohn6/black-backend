const mongoose = require("mongoose");

const reportSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true, // Reporter
    },
    reportedUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    post: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Post",
    },
    reason: {
      type: String,
      required: true,
      maxlength: [500, "Reason cannot exceed 500 characters"],
    },
    isResolved: {
      type: Boolean,
      default: false,
    },
    resolutionNote: {
      type: String,
      maxlength: [1000, "Resolution note cannot exceed 1000 characters"],
    },
  },
  { timestamps: true }
);

// Ensure either reportedUser or post is provided, but not both
reportSchema.pre("validate", function (next) {
  if (!this.reportedUser && !this.post) {
    next(new Error("Report must specify either a user or a post"));
  }
  if (this.reportedUser && this.post) {
    next(new Error("Report cannot specify both a user and a post"));
  }
  next();
});

module.exports = mongoose.model("Report", reportSchema);
