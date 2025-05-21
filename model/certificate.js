const mongoose = require("mongoose");

const certificateSchema = new mongoose.Schema({
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
  enrollment: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Enrollment",
    required: true,
  },
  certificateId: {
    type: String,
    unique: true,
    required: true,
  },
  issueDate: {
    type: Date,
    default: Date.now,
  },
  image: {
    public_id: { type: String },
    url: { type: String },
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

certificateSchema.index({ user: 1, course: 1 });
certificateSchema.index({ certificateId: 1 });

module.exports = mongoose.model("Certificate", certificateSchema);
