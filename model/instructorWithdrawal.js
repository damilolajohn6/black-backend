const mongoose = require("mongoose");

const instructorWithdrawSchema = new mongoose.Schema({
  instructor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Instructor",
    required: true,
  },
  amount: {
    type: Number,
    required: [true, "Amount is required"],
    min: [0.01, "Amount must be at least $0.01"],
  },
  status: {
    type: String,
    enum: ["Processing", "Approved", "Rejected", "Succeeded", "Failed"],
    default: "Processing",
  },
  statusHistory: [
    {
      status: {
        type: String,
        enum: ["Processing", "Approved", "Rejected", "Succeeded", "Failed"],
        required: true,
      },
      updatedAt: {
        type: Date,
        default: Date.now,
      },
      reason: {
        type: String,
        default: "",
      },
    },
  ],
  withdrawMethod: {
    type: {
      type: String,
      enum: ["BankTransfer", "PayPal", "Other"],
      required: [true, "Withdrawal method type is required"],
    },
    details: {
      type: Object,
      required: [true, "Withdrawal method details are required"],
    },
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
  },
  processedAt: {
    type: Date,
  },
});

// Update statusHistory and updatedAt on status change
instructorWithdrawSchema.pre("save", function (next) {
  if (this.isModified("status")) {
    this.statusHistory.push({
      status: this.status,
      updatedAt: new Date(),
      reason:
        this.status === "Rejected" || this.status === "Failed"
          ? this.statusHistory[this.statusHistory.length - 1]?.reason ||
            "Status updated"
          : "Status updated",
    });
    this.updatedAt = new Date();
    if (["Succeeded", "Failed"].includes(this.status)) {
      this.processedAt = new Date();
    }
  }
  next();
});

// Indexes for faster queries
instructorWithdrawSchema.index({ instructor: 1, createdAt: -1 });
instructorWithdrawSchema.index({ status: 1 });

module.exports = mongoose.model("InstructorWithdraw", instructorWithdrawSchema);
