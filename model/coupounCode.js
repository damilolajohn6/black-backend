const mongoose = require("mongoose");

const couponCodeSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, "Please enter your coupon code name!"],
    unique: true,
    trim: true,
    uppercase: true,
    minlength: [3, "Coupon code name must be at least 3 characters"],
    maxlength: [20, "Coupon code name cannot exceed 20 characters"],
  },
  value: {
    type: Number,
    required: [true, "Please enter the discount value"],
    min: [1, "Discount value must be at least 1"],
    max: [100, "Discount value cannot exceed 100"],
  },
  minAmount: {
    type: Number,
    min: [0, "Minimum amount cannot be negative"],
  },
  maxAmount: {
    type: Number,
    min: [0, "Maximum amount cannot be negative"],
    validate: {
      validator: function (value) {
        return !this.minAmount || !value || value >= this.minAmount;
      },
      message: "Maximum amount must be greater than or equal to minimum amount",
    },
  },
  shopId: {
    type: String,
    required: [true, "Shop ID is required"],
  },
  selectedProduct: {
    type: String,
    default: null,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model("CouponCode", couponCodeSchema);
