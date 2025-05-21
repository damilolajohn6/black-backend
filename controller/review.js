const express = require("express");
const router = express.Router();
const ErrorHandler = require("../utils/ErrorHandler");
const catchAsyncErrors = require("../middleware/catchAsyncErrors");
const { isAuthenticated, isInstructor, isAdmin } = require("../middleware/auth");
const Review = require("../model/review");
const Enrollment = require("../model/enrollment");


router.post(
  "/create-review",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { courseId, rating, comment } = req.body;

      if (!courseId || !rating || rating < 1 || rating > 5) {
        return next(
          new ErrorHandler("Course ID and valid rating (1-5) are required", 400)
        );
      }

      const enrollment = await Enrollment.findOne({
        user: req.user._id,
        course: courseId,
      });
      if (!enrollment) {
        return next(
          new ErrorHandler(
            "You must be enrolled in the course to review it",
            403
          )
        );
      }

      const existingReview = await Review.findOne({
        user: req.user._id,
        course: courseId,
      });

      let review;
      if (existingReview) {
        existingReview.rating = rating;
        existingReview.comment = comment;
        await existingReview.save();
        review = existingReview;
      } else {
        review = await Review.create({
          user: req.user._id,
          course: courseId,
          instructor: enrollment.instructor,
          rating,
          comment,
        });
      }

      console.info("create-review: Review created/updated", {
        reviewId: review._id,
        userId: req.user._id,
        courseId,
      });

      res.status(201).json({
        success: true,
        review,
      });
    } catch (error) {
      console.error("create-review error:", {
        message: error.message,
        userId: req.user._id,
        courseId: req.body.courseId,
      });
      return next(new ErrorHandler(error.message, 400));
    }
  })
);

// Get course reviews
router.get(
  "/get-course-reviews/:courseId",
  catchAsyncErrors(async (req, res, next) => {
    try {
      const reviews = await Review.find({ course: req.params.courseId })
        .populate("user", "fullname avatar")
        .sort({ createdAt: -1 });

      console.info("get-course-reviews: Reviews retrieved", {
        courseId: req.params.courseId,
        count: reviews.length,
      });

      res.status(200).json({
        success: true,
        reviews,
      });
    } catch (error) {
      console.error("get-course-reviews error:", {
        message: error.message,
        courseId: req.params.courseId,
      });
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Get instructor reviews
router.get(
  "/get-instructor-reviews/:instructorId",
  isInstructor,
  catchAsyncErrors(async (req, res, next) => {
    try {
      if (req.instructor._id.toString() !== req.params.instructorId) {
        return next(
          new ErrorHandler("Unauthorized to access these reviews", 403)
        );
      }

      const { page = 1, limit = 10 } = req.query;
      const reviews = await Review.find({ instructor: req.params.instructorId })
        .populate("course", "title")
        .populate("user", "fullname")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(Number(limit));

      const total = await Review.countDocuments({
        instructor: req.params.instructorId,
      });

      console.info("get-instructor-reviews: Reviews retrieved", {
        instructorId: req.params.instructorId,
        count: reviews.length,
        page,
        limit,
      });

      res.status(200).json({
        success: true,
        reviews,
        total,
        page: Number(page),
        pages: Math.ceil(total / limit),
      });
    } catch (error) {
      console.error("get-instructor-reviews error:", {
        message: error.message,
        instructorId: req.params.instructorId,
      });
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Delete review (admin only)
router.delete(
  "/delete-review/:id",
  isAuthenticated,
  isAdmin("Admin"),
  catchAsyncErrors(async (req, res, next) => {
    try {
      const review = await Review.findById(req.params.id);
      if (!review) {
        return next(new ErrorHandler("Review not found", 404));
      }

      await Review.findByIdAndDelete(req.params.id);

      console.info("delete-review: Review deleted", {
        reviewId: req.params.id,
      });

      res.status(200).json({
        success: true,
        message: "Review deleted successfully",
      });
    } catch (error) {
      console.error("delete-review error:", {
        message: error.message,
        reviewId: req.params.id,
      });
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

module.exports = router;
