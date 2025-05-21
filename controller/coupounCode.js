const express = require("express");
const router = express.Router();
const CouponCode = require("../model/coupounCode");
const Course = require("../model/course");
const sendMail = require("../utils/sendMail");
const catchAsyncErrors = require("../middleware/catchAsyncErrors");
const ErrorHandler = require("../utils/ErrorHandler");
const { isAuthenticated, isInstructor, isSeller } = require("../middleware/auth");

// Create coupon
router.post(
  "/create-coupon",
  isInstructor,
  isSeller,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { name, value, minAmount, maxAmount, selectedCourse } = req.body;

      if (!name || !value) {
        return next(new ErrorHandler("Coupon name and value are required", 400));
      }

      if (selectedCourse) {
        const course = await Course.findById(selectedCourse);
        if (!course) {
          return next(new ErrorHandler("Course not found", 404));
        }
        if (course.instructor.toString() !== req.instructor._id.toString()) {
          return next(new ErrorHandler("Unauthorized: Not your course", 403));
        }
      }

      const coupon = await CouponCode.create({
        name,
        value,
        minAmount,
        maxAmount,
        instructorId: req.instructor._id.toString(),
        selectedCourse,
      });

      console.info("create-coupon: Coupon created", {
        couponId: coupon._id,
        name,
        instructorId: req.instructor._id,
      });

      try {
        await sendMail({
          email: req.instructor.email,
          subject: "New Coupon Created",
          message: `Hello ${req.instructor.fullname.firstName}, your coupon "${name}" has been created successfully.`,
        });
      } catch (error) {
        console.error("EMAIL SEND ERROR:", error);
      }

      res.status(201).json({
        success: true,
        coupon,
      });
    } catch (error) {
      console.error("CREATE COUPON ERROR:", error);
      return next(new ErrorHandler(error.message, 400));
    }
  })
);

// Update coupon
router.put(
  "/update-coupon/:couponId",
  isInstructor,
  isSeller,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { couponId } = req.params;
      const { name, value, minAmount, maxAmount, selectedCourse } = req.body;

      const coupon = await CouponCode.findById(couponId);
      if (!coupon) {
        return next(new ErrorHandler("Coupon not found", 404));
      }
      if (coupon.instructorId !== req.instructor._id.toString()) {
        return next(new ErrorHandler("Unauthorized: Not your coupon", 403));
      }

      if (selectedCourse) {
        const course = await Course.findById(selectedCourse);
        if (!course) {
          return next(new ErrorHandler("Course not found", 404));
        }
        if (course.instructor.toString() !== req.instructor._id.toString()) {
          return next(new ErrorHandler("Unauthorized: Not your course", 403));
        }
      }

      if (name) coupon.name = name;
      if (value) coupon.value = value;
      if (minAmount !== undefined) coupon.minAmount = minAmount;
      if (maxAmount !== undefined) coupon.maxAmount = maxAmount;
      if (selectedCourse !== undefined) coupon.selectedCourse = selectedCourse;

      await coupon.save();

      console.info("update-coupon: Coupon updated", {
        couponId,
        instructorId: req.instructor._id,
      });

      res.status(200).json({
        success: true,
        coupon,
      });
    } catch (error) {
      console.error("UPDATE COUPON ERROR:", error);
      return next(new ErrorHandler(error.message, 400));
    }
  })
);

// Delete coupon
router.delete(
  "/delete-coupon/:couponId",
  isInstructor,
  isSeller,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { couponId } = req.params;

      const coupon = await CouponCode.findById(couponId);
      if (!coupon) {
        return next(new ErrorHandler("Coupon not found", 404));
      }
      if (coupon.instructorId !== req.instructor._id.toString()) {
        return next(new ErrorHandler("Unauthorized: Not your coupon", 403));
      }

      await coupon.deleteOne();

      console.info("delete-coupon: Coupon deleted", {
        couponId,
        instructorId: req.instructor._id,
      });

      res.status(200).json({
        success: true,
        message: "Coupon deleted successfully",
      });
    } catch (error) {
      console.error("DELETE COUPON ERROR:", error);
      return next(new ErrorHandler(error.message, 400));
    }
  })
);

// Get instructor coupons
router.get(
  "/get-coupons/:instructorId",
  isInstructor,
  isSeller,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { instructorId } = req.params;
      const { page = 1, limit = 10 } = req.query;

      if (req.instructor._id.toString() !== instructorId) {
        return next(
          new ErrorHandler("Unauthorized to access these coupons", 403)
        );
      }

      const coupons = await CouponCode.find({ instructorId })
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(Number(limit));

      const total = await CouponCode.countDocuments({ instructorId });

      console.info("get-coupons: Coupons retrieved", {
        instructorId,
        couponCount: coupons.length,
        page,
        limit,
      });

      res.status(200).json({
        success: true,
        coupons,
        total,
        page: Number(page),
        pages: Math.ceil(total / limit),
      });
    } catch (error) {
      console.error("GET COUPONS ERROR:", error);
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Apply coupon
router.post(
  "/apply-coupon",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { couponCode, courseId } = req.body;

      if (!couponCode || !courseId) {
        return next(new ErrorHandler("Coupon code and course ID are required", 400));
      }

      const course = await Course.findById(courseId);
      if (!course || course.status !== "Published") {
        return next(new ErrorHandler("Course not found or not published", 404));
      }

      const coupon = await CouponCode.findOne({ name: couponCode.toUpperCase() });
      if (!coupon) {
        return next(new ErrorHandler("Invalid coupon code", 400));
      }

      if (coupon.instructorId && coupon.instructorId !== course.instructor.toString()) {
        return next(new ErrorHandler("Coupon not valid for this course", 400));
      }

      if (coupon.selectedCourse && coupon.selectedCourse !== courseId) {
        return next(new ErrorHandler("Coupon not valid for this course", 400));
      }

      const price = course.discountPrice || course.price;
      if (coupon.minAmount && price < coupon.minAmount) {
        return next(
          new ErrorHandler(
            `Course price must be at least ${coupon.minAmount} to use this coupon`,
            400
          )
        );
      }
      if (coupon.maxAmount && price > coupon.maxAmount) {
        return next(
          new ErrorHandler(
            `Course price must not exceed ${coupon.maxAmount} to use this coupon`,
            400
          )
        );
      }

      const discountedPrice = price * (1 - coupon.value / 100);

      console.info("apply-coupon: Coupon applied", {
        couponCode,
        courseId,
        userId: req.user._id,
        discountedPrice,
      });

      res.status(200).json({
        success: true,
        discountedPrice,
        coupon,
      });
    } catch (error) {
      console.error("APPLY COUPON ERROR:", error);
      return next(new ErrorHandler(error.message, 400));
    }
  })
);

module.exports = router;