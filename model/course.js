const mongoose = require("mongoose");

const lectureSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, maxlength: 100, trim: true },
    description: { type: String, maxlength: 1000, trim: true },
    video: {
      url: { type: String, required: true },
      public_id: { type: String },
      duration: { type: Number, required: true },
    },
    resources: [
      {
        title: { type: String, required: true, maxlength: 100, trim: true },
        type: { type: String, enum: ["PDF", "Image", "Link"], required: true },
        url: { type: String, required: true },
        public_id: { type: String },
      },
    ],
    order: { type: Number, required: true },
  },
  { _id: true }
);

const sectionSchema = new mongoose.Schema(
  {
    sectionTitle: { type: String, required: true, maxlength: 100, trim: true },
    lectures: [lectureSchema],
    order: { type: Number, required: true },
  },
  { _id: true }
);

const courseSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, maxlength: 200, trim: true },
    description: { type: String, required: true, maxlength: 5000, trim: true },
    learningObjectives: [
      { type: String, required: true, maxlength: 200, trim: true },
    ],
    prerequisites: [{ type: String, maxlength: 200, trim: true }],
    targetAudience: [{ type: String, maxlength: 200, trim: true }],
    isFree: { type: Boolean, default: false },
    price: {
      type: Number,
      required: function () {
        return !this.isFree;
      },
      min: [0, "Price cannot be negative"],
    },
    categories: [{ type: String, required: true, maxlength: 50, trim: true }],
    tags: [{ type: String, maxlength: 50, trim: true }],
    level: {
      type: String,
      enum: ["Beginner", "Intermediate", "Advanced", "All Levels"],
      default: "All Levels",
    },
    language: {
      type: String,
      required: true,
      enum: [
        "English",
        "Spanish",
        "French",
        "German",
        "Chinese",
        "Japanese",
        "Other",
      ],
      default: "English",
    },
    thumbnail: {
      url: { type: String, required: true },
      public_id: { type: String },
    },
    previewVideo: {
      url: { type: String },
      public_id: { type: String },
      duration: { type: Number },
    },
    content: [sectionSchema],
    instructor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Instructor",
      required: true,
    },
    status: {
      type: String,
      enum: ["Pending", "Published", "Rejected"],
      default: "Pending",
    },
    rejectionReason: { type: String, maxlength: 1000, trim: true },
    totalDuration: { type: Number, default: 0 },
    totalLectures: { type: Number, default: 0 },
    totalEnrollments: { type: Number, default: 0 },
    averageRating: { type: Number, default: 0 },
    totalReviews: { type: Number, default: 0 },
    lastUpdated: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

courseSchema.pre("save", function (next) {
  this.totalLectures = this.content.reduce(
    (total, section) => total + section.lectures.length,
    0
  );
  this.totalDuration = this.content.reduce(
    (total, section) =>
      total +
      section.lectures.reduce(
        (sum, lecture) => sum + (lecture.video?.duration || 0),
        0
      ),
    0
  );
  this.lastUpdated = Date.now();
  next();
});

courseSchema.index({ instructor: 1, status: 1 });
courseSchema.index({ categories: 1 });
courseSchema.index({ tags: 1 });

module.exports = mongoose.model("Course", courseSchema);
