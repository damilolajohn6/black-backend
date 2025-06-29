const mongoose = require("mongoose");

const orderSchema = new mongoose.Schema({
  shop: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Shop",
  },
  instructor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Instructor",
  },
  customer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  items: [
    {
      itemType: {
        type: String,
        enum: ["Product", "Event", "Course"],
        required: true,
      },
      itemId: {
        type: mongoose.Schema.Types.ObjectId,
        refPath: "items.itemType",
        required: true,
      },
      name: {
        type: String,
        required: true,
      },
      quantity: {
        type: Number,
        required: true,
        min: 1,
      },
      price: {
        type: Number,
        required: true,
        min: 0,
      },
      discountApplied: {
        type: Number,
        default: 0,
        min: 0,
      },
    },
  ],
  totalAmount: {
    type: Number,
    required: true,
    min: 0,
  },
  taxAmount: {
    type: Number,
    default: 0,
    min: 0,
  },
  discountAmount: {
    type: Number,
    default: 0,
    min: 0,
  },
  paymentInfo: {
    id: { type: String },
    status: {
      type: String,
      enum: [
        "Pending",
        "Succeeded",
        "Failed",
        "Refunded",
        "requires_payment_method",
      ],
      default: "Pending",
    },
    type: { type: String },
  },
  status: {
    type: String,
    enum: [
      "Pending",
      "Confirmed",
      "Shipped",
      "Delivered",
      "Cancelled",
      "Refund Requested",
      "Refund Success",
    ],
    default: "Pending",
  },
  statusHistory: [
    {
      status: {
        type: String,
        enum: [
          "Pending",
          "Confirmed",
          "Shipped",
          "Delivered",
          "Cancelled",
          "Refund Requested",
          "Refund Success",
        ],
        required: true,
      },
      updatedBy: {
        type: String,
        required: true,
      },
      updatedByModel: {
        type: String,
        enum: ["User", "Seller", "Instructor", "System", "Admin"],
        required: true,
      },
      reason: {
        type: String,
        default: "",
      },
      updatedAt: {
        type: Date,
        default: Date.now,
      },
    },
  ],
  shippingAddress: {
    address: { type: String },
    city: { type: String },
    zipCode: { type: String },
    country: { type: String },
  },
  refundHistory: [
    {
      refundId: { type: String },
      amount: { type: Number, min: 0 },
      reason: { type: String },
      status: {
        type: String,
        enum: ["Requested", "Approved", "Rejected"],
        default: "Requested",
      },
      requestedAt: { type: Date, default: Date.now },
      processedAt: { type: Date },
    },
  ],
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
  },
});

// Update statusHistory and updatedAt
orderSchema.pre("save", function (next) {
  if (this.isModified("status")) {
    this.statusHistory.push({
      status: this.status,
      updatedBy: this.updatedBy || "System",
      updatedByModel: this.updatedByModel || "System",
      reason:
        this.status === "Cancelled" || this.status === "Refund Requested"
          ? this.statusHistory[this.statusHistory.length - 1]?.reason ||
            "Status updated"
          : "Status updated",
      updatedAt: new Date(),
    });
    this.updatedAt = new Date();
  }
  next();
});

// Indexes
orderSchema.index({ shop: 1, createdAt: -1 });
orderSchema.index({ instructor: 1, createdAt: -1 });
orderSchema.index({ customer: 1 });
orderSchema.index({ status: 1 });
orderSchema.index({ "paymentInfo.status": 1 });

module.exports = mongoose.model("Order", orderSchema);
