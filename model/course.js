const mongoose = require("mongoose");
const validator = require("validator");

const courseSchema = new mongoose.Schema({
  title: {
    type: Map,
    of: String,
    required: [true, "Please enter the course title"],
    validate: {
      validator: function (map) {
        return (
          map.has("en") &&
          map.get("en").length >= 5 &&
          map.get("en").length <= 200
        );
      },
      message: "English title is required, must be 5-200 characters",
    },
  },
  description: {
    type: Map,
    of: String,
    required: [true, "Please enter the course description"],
    validate: {
      validator: function (map) {
        return (
          map.has("en") &&
          map.get("en").length >= 50 &&
          map.get("en").length <= 5000
        );
      },
      message: "English description is required, must be 50-5000 characters",
    },
  },
  learningObjectives: {
    type: [String],
    required: [true, "Please provide at least one learning objective"],
    validate: {
      validator: function (arr) {
        return arr.length >= 1 && arr.every((item) => item.length <= 200);
      },
      message:
        "At least one learning objective is required, each max 200 characters",
    },
  },
  prerequisites: {
    type: [String],
    default: [],
    validate: {
      validator: function (arr) {
        return arr.every((item) => item.length <= 200);
      },
      message: "Prerequisites cannot exceed 200 characters each",
    },
  },
  targetAudience: {
    type: [String],
    default: [],
    validate: {
      validator: function (arr) {
        return arr.every((item) => item.length <= 200);
      },
      message: "Target audience items cannot exceed 200 characters each",
    },
  },
  instructor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Instructor",
    required: true,
  },
  price: {
    type: Number,
    required: [true, "Please enter the course price"],
    min: [0, "Price cannot be negative"],
    validate: {
      validator: function (value) {
        return this.isFree ? value === 0 : value >= 0;
      },
      message: "Price must be 0 for free courses",
    },
  },
  isFree: {
    type: Boolean,
    default: false,
  },
  categories: {
    type: [String],
    required: [true, "Please provide at least one category"],
    validate: {
      validator: function (arr) {
        return arr.length > 0 && arr.every((item) => item.length <= 50);
      },
      message: "Categories must be non-empty and items max 50 characters",
    },
  },
  tags: {
    type: [String],
    default: [],
    validate: {
      validator: function (arr) {
        return arr.every((item) => item.length <= 50);
      },
      message: "Tags cannot exceed 50 characters each",
    },
  },
  level: {
    type: String,
    enum: ["Beginner", "Intermediate", "Advanced", "All Levels"],
    default: "All Levels",
  },
  language: {
    type: String,
    default: "English",
  },
  thumbnail: {
    public_id: { type: String },
    url: { type: String, required: true },
  },
  previewVideo: {
    public_id: { type: String },
    url: { type: String },
    duration: {
      type: Number,
      min: [0, "Preview video duration cannot be negative"],
      max: [300, "Preview video cannot exceed 5 minutes"],
    },
  },
  content: [
    {
      sectionTitle: {
        type: String,
        required: [true, "Section title is required"],
        trim: true,
        maxlength: [100, "Section title cannot exceed 100 characters"],
      },
      lectures: [
        {
          title: {
            type: String,
            required: [true, "Lecture title is required"],
            trim: true,
            maxlength: [100, "Lecture title cannot exceed 100 characters"],
          },
          video: {
            public_id: { type: String },
            url: {
              type: String,
              required: [true, "Video URL is required"],
              validate: [validator.isURL, "Invalid video URL"],
            },
            duration: {
              type: Number,
              required: [true, "Lecture duration is required"],
              min: [0, "Duration cannot be negative"],
            },
          },
          description: {
            type: String,
            trim: true,
            maxlength: [
              1000,
              "Lecture description cannot exceed 1000 characters",
            ],
          },
          resources: [
            {
              title: {
                type: String,
                required: true,
                maxlength: [100, "Resource title cannot exceed 100 characters"],
              },
              type: {
                type: String,
                enum: ["PDF", "Image", "Link", "Other"],
                required: true,
              },
              public_id: { type: String },
              url: {
                type: String,
                required: true,
                validate: [validator.isURL, "Invalid resource URL"],
              },
            },
          ],
        },
      ],
    },
  ],
  totalDuration: {
    type: Number,
    default: 0,
    min: [0, "Total duration cannot be negative"],
  },
  enrollmentCount: {
    type: Number,
    default: 0,
    min: [0, "Enrollment count cannot be negative"],
  },
  status: {
    type: String,
    enum: ["Draft", "Published", "Archived", "PendingReview"],
    default: "Draft",
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
  },
  draftVersions: [
    {
      data: mongoose.Schema.Types.Mixed,
      savedAt: { type: Date, default: Date.now },
      version: { type: Number, required: true },
    },
  ],
});

// Update totalDuration and updatedAt
courseSchema.pre("save", function (next) {
  if (this.isModified("content")) {
    this.totalDuration = this.content.reduce((total, section) => {
      return (
        total +
        section.lectures.reduce(
          (sum, lecture) => sum + (lecture.video?.duration || 0),
          0
        )
      );
    }, 0);
    this.updatedAt = new Date();
  }
  next();
});

// Validate course before publishing
courseSchema.pre("save", async function (next) {
  if (this.status === "Published" && this.isModified("status")) {
    if (this.content.length < 1) {
      return next(new Error("Course must have at least one section"));
    }
    if (this.content.some((section) => section.lectures.length === 0)) {
      return next(new Error("All sections must have at least one lecture"));
    }
    if (this.totalDuration < 60) {
      return next(new Error("Course must be at least 1 minute long"));
    }
    if (!this.thumbnail?.url) {
      return next(new Error("Course must have a thumbnail"));
    }
    if (!this.learningObjectives?.length) {
      return next(
        new Error("Course must have at least one learning objective")
      );
    }
  }
  next();
});

// Indexes
courseSchema.index({ instructor: 1, createdAt: -1 });
courseSchema.index({ status: 1 });
courseSchema.index({ categories: 1 });
courseSchema.index({ tags: 1 });

module.exports = mongoose.model("Course", courseSchema);
