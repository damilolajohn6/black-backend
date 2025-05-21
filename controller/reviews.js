const express = require("express");
const router = express.Router();
const Enrollment = require("../model/enrollment");
const Review = require("../model/review");
const Course = require("../model/course");
const sendMail = require("../utils/sendMail");
const catchAsyncErrors = require("../middleware/catchAsyncErrors");
const ErrorHandler = require("../utils/ErrorHandler");
const { isAuthenticated } = require("../middleware/auth");
const mongoose = require("mongoose");

// Create review
router.post(
  "/create-review/:enrollmentId",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { enrollmentId } = req.params;
      const { rating, comment } = req.body;

      if (!rating) {
        return next(new ErrorHandler("Rating is required", 400));
      }

      const enrollment = await Enrollment.findById(enrollmentId)
        .populate("course")
        .populate("instructor");

      if (!enrollment) {
        return next(new ErrorHandler("Enrollment not found", 404));
      }
      if (enrollment.user.toString() !== req.user._id.toString()) {
        return next(
          new ErrorHandler(
            "Unauthorized to submit review for this enrollment",
            403
          )
        );
      }
      if (enrollment.completionPercentage < 100) {
        return next(
          new ErrorHandler(
            "Course must be fully completed to submit a review",
            400
          )
        );
      }

      const existingReview = await Review.findOne({
        user: req.user._id,
        course: enrollment.course._id,
      });
      if (existingReview) {
        return next(
          new ErrorHandler("You have already reviewed this course", 400)
        );
      }

      const review = await Review.create({
        user: req.user._id,
        course: enrollment.course._id,
        instructor: enrollment.instructor._id,
        rating: Number(rating),
        comment,
      });

      try {
        await sendMail({
          email: enrollment.instructor.email,
          subject: "New Review for Your Course",
          message: `Hello ${
            enrollment.instructor.fullname.firstName
          }, a student has submitted a review for your course "${
            enrollment.course.title
          }". Rating: ${rating}. ${comment ? `Comment: ${comment}` : ""}`,
        });
      } catch (error) {
        console.error("EMAIL SEND ERROR:", error);
      }

      console.info("create-review: Review created", {
        reviewId: review._id,
        courseId: enrollment.course._id,
        userId: req.user._id,
        rating,
      });

      res.status(201).json({
        success: true,
        review,
      });
    } catch (error) {
      console.error("CREATE REVIEW ERROR:", error);
      return next(new ErrorHandler(error.message, 400));
    }
  })
);

// Get reviews for a course (public)
router.get(
  "/get-reviews/:courseId",
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { courseId } = req.params;
      const { page = 1, limit = 10 } = req.query;

      if (!mongoose.Types.ObjectId.isValid(courseId)) {
        return next(new ErrorHandler("Invalid course ID", 400));
      }

      const course = await Course.findById(courseId);
      if (!course) {
        return next(new ErrorHandler("Course not found", 404));
      }

      const reviews = await Review.find({ course: courseId })
        .populate("user", "fullname avatar")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(Number(limit));

      const total = await Review.countDocuments({ course: courseId });

      console.info("get-reviews: Reviews retrieved", {
        courseId,
        reviewCount: reviews.length,
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
      console.error("GET REVIEWS ERROR:", error);
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

module.exports = router;
