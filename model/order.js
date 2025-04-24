const mongoose = require("mongoose");

const orderSchema = new mongoose.Schema({
  shop: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Shop",
    required: true,
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
        enum: ["Product", "Event"],
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
    },
  ],
  totalAmount: {
    type: Number,
    required: true,
    min: 0,
  },
  status: {
    type: String,
    enum: [
      "Pending",
      "Confirmed",
      "Shipped",
      "Delivered",
      "Cancelled",
      "Refunded",
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
          "Refunded",
        ],
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
  paymentStatus: {
    type: String,
    enum: ["Pending", "Paid", "Failed", "Refunded"],
    default: "Pending",
  },
  shippingAddress: {
    address: { type: String, required: true },
    city: { type: String, required: true },
    zipCode: { type: String, required: true },
    country: { type: String, required: true },
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
  },
});

// Update statusHistory and updatedAt on status change
orderSchema.pre("save", function (next) {
  if (this.isModified("status")) {
    this.statusHistory.push({
      status: this.status,
      updatedAt: new Date(),
      reason:
        this.status === "Cancelled" || this.status === "Refunded"
          ? this.statusHistory[this.statusHistory.length - 1]?.reason ||
            "Status updated"
          : "Status updated",
    });
    this.updatedAt = new Date();
  }
  next();
});

// Indexes for faster queries
orderSchema.index({ shop: 1, createdAt: -1 });
orderSchema.index({ customer: 1 });
orderSchema.index({ status: 1 });

module.exports = mongoose.model("Order", orderSchema);
