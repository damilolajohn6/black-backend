const express = require("express");
const catchAsyncErrors = require("../middleware/catchAsyncErrors");
const Shop = require("../model/shop");
const ErrorHandler = require("../utils/ErrorHandler");
const { isSeller } = require("../middleware/auth");
const CouponCode = require("../model/coupounCode");
const router = express.Router();

// Create coupon code
router.post(
  "/create-coupon-code",
  isSeller,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { name, value, minAmount, maxAmount, selectedProduct } = req.body;

      // Validate required fields
      if (!name || !value) {
        return next(
          new ErrorHandler("Coupon name and value are required", 400)
        );
      }

      // Ensure the shopId matches the seller's shop
      if (req.body.shopId !== req.seller.shopId) {
        return next(new ErrorHandler("Unauthorized: Invalid shop ID", 403));
      }

      // Check if coupon code already exists
      const existingCoupon = await CouponCode.findOne({ name });
      if (existingCoupon) {
        return next(new ErrorHandler("Coupon code already exists", 400));
      }

      // Create coupon
      const couponCode = await CouponCode.create({
        name,
        value,
        minAmount,
        maxAmount,
        shopId: req.seller.shopId,
        selectedProduct,
      });

      console.info("Coupon created:", {
        couponId: couponCode._id,
        name: couponCode.name,
        shopId: req.seller._id,
      });

      res.status(201).json({
        success: true,
        couponCode,
      });
    } catch (error) {
      console.error("CREATE COUPON ERROR:", error.message, error.stack);
      return next(new ErrorHandler(error.message, 400));
    }
  })
);

// Get all coupons of a shop
router.get(
  "/get-coupon/:id",
  isSeller,
  catchAsyncErrors(async (req, res, next) => {
    try {
      if (req.params.id !== req.seller._id.toString()) {
        return next(
          new ErrorHandler("Cannot access another shop's coupons", 403)
        );
      }
      const couponCodes = await CouponCode.find({ shopId: req.seller._id });
      console.info("Coupons fetched:", {
        shopId: req.seller._id,
        count: couponCodes.length,
      });
      res.status(200).json({
        success: true,
        couponCodes,
      });
    } catch (error) {
      console.error("Get coupons error:", error.message, error);
      return next(new ErrorHandler(error.message, 400));
    }
  })
);

// Update coupon code
router.put(
  "/update-coupon/:id",
  isSeller,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { name, value, minAmount, maxAmount, selectedProduct } = req.body;
      const couponId = req.params.id;

      // Find the coupon and verify it belongs to the seller's shop
      const coupon = await CouponCode.findById(couponId);
      if (!coupon) {
        return next(new ErrorHandler("Coupon code not found", 404));
      }
      if (coupon.shopId !== req.seller.shopId) {
        return next(
          new ErrorHandler(
            "Unauthorized: Coupon does not belong to your shop",
            403
          )
        );
      }

      // If updating the name, check for conflicts
      if (name && name !== coupon.name) {
        const existingCoupon = await CouponCode.findOne({ name });
        if (existingCoupon) {
          return next(new ErrorHandler("Coupon code name already exists", 400));
        }
      }

      // Update fields
      coupon.name = name || coupon.name;
      coupon.value = value !== undefined ? value : coupon.value;
      coupon.minAmount = minAmount !== undefined ? minAmount : coupon.minAmount;
      coupon.maxAmount = maxAmount !== undefined ? maxAmount : coupon.maxAmount;
      coupon.selectedProduct =
        selectedProduct !== undefined
          ? selectedProduct
          : coupon.selectedProduct;

      await coupon.save();

      console.info("Coupon updated", {
        couponId,
        shopId: req.seller.shopId,
        name: coupon.name,
      });

      res.status(200).json({
        success: true,
        couponCode: coupon,
      });
    } catch (error) {
      console.error("UPDATE COUPON ERROR:", error.message, error.stack);
      return next(new ErrorHandler(error.message, 400));
    }
  })
);

// Delete coupon code
router.delete(
  "/delete-coupon/:id",
  isSeller,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const couponId = req.params.id;

      // Find the coupon and verify it belongs to the seller's shop
      const coupon = await CouponCode.findById(couponId);
      if (!coupon) {
        return next(new ErrorHandler("Coupon code not found", 404));
      }
      if (coupon.shopId !== req.seller.shopId) {
        return next(
          new ErrorHandler(
            "Unauthorized: Coupon does not belong to your shop",
            403
          )
        );
      }

      await CouponCode.findByIdAndDelete(couponId);

      console.info("Coupon deleted", {
        couponId,
        shopId: req.seller.shopId,
        name: coupon.name,
      });

      res.status(200).json({
        success: true,
        message: "Coupon code deleted successfully",
      });
    } catch (error) {
      console.error("DELETE COUPON ERROR:", error.message, error.stack);
      return next(new ErrorHandler(error.message, 400));
    }
  })
);

// Get coupon code by name (for customers)
router.get(
  "/get-coupon-value/:name",
  catchAsyncErrors(async (req, res, next) => {
    try {
      const couponCode = await CouponCode.findOne({ name: req.params.name });

      if (!couponCode) {
        return next(new ErrorHandler("Coupon code not found", 404));
      }

      console.info("Coupon fetched by name", { name: req.params.name });

      res.status(200).json({
        success: true,
        couponCode,
      });
    } catch (error) {
      console.error("GET COUPON VALUE ERROR:", error.message, error.stack);
      return next(new ErrorHandler(error.message, 400));
    }
  })
);

module.exports = router;
