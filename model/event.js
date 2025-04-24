const mongoose = require("mongoose");
const ErrorHandler = require("../utils/ErrorHandler");

const eventSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, "Please enter your event name"],
    trim: true,
    minlength: [3, "Event name must be at least 3 characters"],
    maxlength: [100, "Event name cannot exceed 100 characters"],
  },
  description: {
    type: String,
    required: [true, "Please enter your event description"],
    trim: true,
    minlength: [10, "Description must be at least 10 characters"],
    maxlength: [1000, "Description cannot exceed 1000 characters"],
  },
  category: {
    type: String,
    required: [true, "Please select an event category"],
    enum: {
      values: ["Concert", "Workshop", "Festival", "Seminar", "Sale", "Other"],
      message: "Invalid event category",
    },
  },
  start_Date: {
    type: Date,
    required: [true, "Please provide the event start date"],
  },
  Finish_Date: {
    type: Date,
    required: [true, "Please provide the event end date"],
  },
  status: {
    type: String,
    enum: ["Running", "Completed", "Cancelled"],
    default: "Running",
  },
  statusHistory: [
    {
      status: {
        type: String,
        enum: ["Running", "Completed", "Cancelled"],
        required: true,
      },
      updatedAt: {
        type: Date,
        default: Date.now,
      },
      reason: {
        type: String,
        default: "Status updated automatically",
      },
    },
  ],
  tags: {
    type: [String],
    default: [],
    validate: {
      validator: (tags) => tags.every((tag) => tag.length <= 50),
      message: "Each tag must be 50 characters or less",
    },
  },
  originalPrice: {
    type: Number,
    min: [0, "Original price cannot be negative"],
    default: null,
  },
  discountPrice: {
    type: Number,
    required: [true, "Please enter the event price"],
    min: [0, "Discount price cannot be negative"],
  },
  stock: {
    type: Number,
    required: [true, "Please enter the event stock"],
    min: [0, "Stock cannot be negative"],
  },
  images: [
    {
      public_id: {
        type: String,
        required: true,
      },
      url: {
        type: String,
        required: true,
      },
    },
  ],
  shopId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Shop",
    required: [true, "Shop ID is required"],
  },
  shop: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Shop",
    required: [true, "Shop reference is required"],
  },
  sold_out: {
    type: Number,
    default: 0,
    min: [0, "Sold out cannot be negative"],
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// Validate dates
eventSchema.pre("save", function (next) {
  if (this.start_Date >= this.Finish_Date) {
    return next(new ErrorHandler("End date must be after start date", 400));
  }
  if (this.start_Date < Date.now()) {
    return next(new ErrorHandler("Start date cannot be in the past", 400));
  }
  if (this.originalPrice && this.discountPrice > this.originalPrice) {
    return next(
      new ErrorHandler("Discount price cannot exceed original price", 400)
    );
  }
  if (this.images.length > 5) {
    return next(new ErrorHandler("Maximum 5 images allowed", 400));
  }
  next();
});

// Indexes for faster queries
eventSchema.index({ shopId: 1, createdAt: -1 });
eventSchema.index({ category: 1 });
eventSchema.index({ status: 1 });
eventSchema.index({ Finish_Date: 1 });

module.exports = mongoose.model("Event", eventSchema);
