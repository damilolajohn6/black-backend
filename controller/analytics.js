const express = require("express");
const router = express.Router();
const Course = require("../model/course");
const Enrollment = require("../model/enrollment");
const Review = require("../model/review");
const Quiz = require("../model/quiz");
const Question = require("../model/question");
const CouponCode = require("../model/coupounCode");
const catchAsyncErrors = require("../middleware/catchAsyncErrors");
const ErrorHandler = require("../utils/ErrorHandler");
const { isInstructor, isAdmin } = require("../middleware/auth");
const mongoose = require("mongoose");

// Get instructor dashboard analytics
router.get(
  "/instructor-dashboard/:instructorId",
  isInstructor,
  catchAsyncErrors(async (req, res, next) => {
    try {
      if (req.instructor._id.toString() !== req.params.instructorId) {
        return next(
          new ErrorHandler("Unauthorized to access this dashboard", 403)
        );
      }

      const [courses, enrollments, coupons, reviews, questions] =
        await Promise.all([
          Course.aggregate([
            {
              $match: {
                instructor: new mongoose.Types.ObjectId(req.instructor._id),
              },
            },
            {
              $group: {
                _id: null,
                totalCourses: { $sum: 1 },
                publishedCourses: {
                  $sum: { $cond: [{ $eq: ["$status", "Published"] }, 1, 0] },
                },
              },
            },
          ]),
          Enrollment.aggregate([
            {
              $match: {
                instructor: new mongoose.Types.ObjectId(req.instructor._id),
              },
            },
            {
              $group: {
                _id: null,
                totalEnrollments: { $sum: 1 },
                completedEnrollments: {
                  $sum: { $cond: [{ $eq: ["$status", "Completed"] }, 1, 0] },
                },
              },
            },
          ]),
          CouponCode.aggregate([
            { $match: { instructorId: req.instructor._id.toString() } },
            {
              $group: {
                _id: null,
                totalCoupons: { $sum: 1 },
              },
            },
          ]),
          Review.aggregate([
            {
              $match: {
                instructor: new mongoose.Types.ObjectId(req.instructor._id),
              },
            },
            {
              $group: {
                _id: null,
                averageRating: { $avg: "$rating" },
                totalReviews: { $sum: 1 },
              },
            },
          ]),
          Question.aggregate([
            {
              $match: {
                instructor: new mongoose.Types.ObjectId(req.instructor._id),
              },
            },
            {
              $group: {
                _id: null,
                totalQuestions: { $sum: 1 },
                unansweredQuestions: {
                  $sum: { $cond: [{ $eq: ["$answer", null] }, 1, 0] },
                },
              },
            },
          ]),
        ]);

      const stats = {
        totalCourses: courses[0]?.totalCourses || 0,
        publishedCourses: courses[0]?.publishedCourses || 0,
        totalEnrollments: enrollments[0]?.totalEnrollments || 0,
        completedEnrollments: enrollments[0]?.completedEnrollments || 0,
        totalCoupons: coupons[0]?.totalCoupons || 0,
        averageRating: reviews[0]?.averageRating || 0,
        totalReviews: reviews[0]?.totalReviews || 0,
        totalQuestions: questions[0]?.totalQuestions || 0,
        unansweredQuestions: questions[0]?.unansweredQuestions || 0,
      };

      console.info("instructor-dashboard: Analytics retrieved", {
        instructorId: req.instructor._id,
        stats,
      });

      res.status(200).json({
        success: true,
        stats,
      });
    } catch (error) {
      console.error("INSTRUCTOR DASHBOARD ERROR:", error);
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Get course analytics
router.get(
  "/course-analytics/:courseId",
  isInstructor,
  isAdmin,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const course = await Course.findById(req.params.courseId);
      if (!course) {
        return next(new ErrorHandler("Course not found", 404));
      }
      if (course.instructor.toString() !== req.instructor._id.toString()) {
        return next(new ErrorHandler("Unauthorized: Not your course", 403));
      }

      const [enrollments, reviews, quizzes, questions, coupons] =
        await Promise.all([
          Enrollment.aggregate([
            {
              $match: {
                course: new mongoose.Types.ObjectId(req.params.courseId),
              },
            },
            {
              $group: {
                _id: null,
                totalEnrollments: { $sum: 1 },
                completed: {
                  $sum: { $cond: [{ $eq: ["$status", "Completed"] }, 1, 0] },
                },
              },
            },
          ]),
          Review.aggregate([
            {
              $match: {
                course: new mongoose.Types.ObjectId(req.params.courseId),
              },
            },
            {
              $group: {
                _id: null,
                averageRating: { $avg: "$rating" },
                totalReviews: { $sum: 1 },
              },
            },
          ]),
          Quiz.aggregate([
            {
              $match: {
                course: new mongoose.Types.ObjectId(req.params.courseId),
                isActive: true,
              },
            },
            {
              $group: {
                _id: null,
                totalQuizzes: { $sum: 1 },
              },
            },
          ]),
          Question.aggregate([
            {
              $match: {
                course: new mongoose.Types.ObjectId(req.params.courseId),
              },
            },
            {
              $group: {
                _id: null,
                totalQuestions: { $sum: 1 },
                unansweredQuestions: {
                  $sum: { $cond: [{ $eq: ["$answer", null] }, 1, 0] },
                },
              },
            },
          ]),
          CouponCode.aggregate([
            {
              $match: {
                instructorId: req.instructor._id.toString(),
                selectedCourse: req.params.courseId,
              },
            },
            {
              $group: {
                _id: null,
                totalCoupons: { $sum: 1 },
              },
            },
          ]),
        ]);

      const stats = {
        totalEnrollments: enrollments[0]?.totalEnrollments || 0,
        completedEnrollments: enrollments[0]?.completed || 0,
        averageRating: reviews[0]?.averageRating || 0,
        totalReviews: reviews[0]?.totalReviews || 0,
        totalQuizzes: quizzes[0]?.totalQuizzes || 0,
        totalQuestions: questions[0]?.totalQuestions || 0,
        unansweredQuestions: questions[0]?.unansweredQuestions || 0,
        totalCoupons: coupons[0]?.totalCoupons || 0,
      };

      console.info("course-analytics: Analytics retrieved", {
        courseId: req.params.courseId,
        instructorId: req.instructor._id,
      });

      res.status(200).json({
        success: true,
        stats,
      });
    } catch (error) {
      console.error("COURSE ANALYTICS ERROR:", error);
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Get enrollment analytics
router.get(
  "/enrollment-analytics/:instructorId",
  isInstructor,
  isAdmin,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { instructorId } = req.params;

      if (req.instructor._id.toString() !== instructorId) {
        return next(
          new ErrorHandler("Unauthorized to access this analytics", 403)
        );
      }

      const [enrollments, couponUsage] = await Promise.all([
        Enrollment.aggregate([
          { $match: { instructor: new mongoose.Types.ObjectId(instructorId) } },
          {
            $lookup: {
              from: "courses",
              localField: "course",
              foreignField: "_id",
              as: "course",
            },
          },
          { $unwind: "$course" },
          {
            $group: {
              _id: "$course._id",
              courseTitle: { $first: "$course.title" },
              totalEnrollments: { $sum: 1 },
              completedEnrollments: {
                $sum: { $cond: [{ $eq: ["$status", "Completed"] }, 1, 0] },
              },
              totalRevenue: {
                $sum: {
                  $cond: [
                    { $eq: ["$status", "Enrolled"] },
                    { $ifNull: ["$course.discountPrice", "$course.price"] },
                    0,
                  ],
                },
              },
            },
          },
          {
            $project: {
              courseTitle: 1,
              totalEnrollments: 1,
              completedEnrollments: 1,
              totalRevenue: 1,
            },
          },
          { $sort: { totalEnrollments: -1 } },
        ]),
        CouponCode.aggregate([
          { $match: { instructorId } },
          {
            $lookup: {
              from: "enrollments",
              let: { couponId: "$_id" },
              pipeline: [
                {
                  $match: {
                    $expr: { $eq: ["$couponId", "$$couponId"] },
                  },
                },
                {
                  $lookup: {
                    from: "courses",
                    localField: "course",
                    foreignField: "_id",
                    as: "course",
                  },
                },
                { $unwind: "$course" },
              ],
              as: "enrollments",
            },
          },
          {
            $project: {
              name: 1,
              value: 1,
              usageCount: { $size: "$enrollments" },
              totalDiscount: {
                $sum: {
                  $map: {
                    input: "$enrollments",
                    as: "enrollment",
                    in: {
                      $multiply: [
                        {
                          $ifNull: [
                            "$$enrollment.course.discountPrice",
                            "$$enrollment.course.price",
                          ],
                        },
                        { $divide: ["$value", 100] },
                      ],
                    },
                  },
                },
              },
            },
          },
          { $sort: { usageCount: -1 } },
        ]),
      ]);

      const stats = {
        enrollmentsByCourse: enrollments,
        couponUsage,
        totalEnrollments: enrollments.reduce(
          (sum, item) => sum + item.totalEnrollments,
          0
        ),
        totalRevenue: enrollments.reduce(
          (sum, item) => sum + item.totalRevenue,
          0
        ),
        totalCouponsUsed: couponUsage.reduce(
          (sum, item) => sum + item.usageCount,
          0
        ),
        totalDiscount: couponUsage.reduce(
          (sum, item) => sum + item.totalDiscount,
          0
        ),
      };

      console.info("enrollment-analytics: Analytics retrieved", {
        instructorId,
        totalEnrollments: stats.totalEnrollments,
        totalRevenue: stats.totalRevenue,
      });

      res.status(200).json({
        success: true,
        stats,
      });
    } catch (error) {
      console.error("ENROLLMENT ANALYTICS ERROR:", error);
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Get progress analytics
router.get(
  "/progress-analytics/:courseId",
  isInstructor,
  isAdmin,
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
      if (course.instructor.toString() !== req.instructor._id.toString()) {
        return next(new ErrorHandler("Unauthorized: Not your course", 403));
      }

      const enrollments = await Enrollment.find({ course: courseId })
        .populate("user", "fullname email")
        .select("completionPercentage status progress enrolledAt")
        .sort({ completionPercentage: -1 })
        .skip((page - 1) * limit)
        .limit(Number(limit));

      const [aggregateStats] = await Enrollment.aggregate([
        { $match: { course: new mongoose.Types.ObjectId(courseId) } },
        {
          $group: {
            _id: null,
            averageCompletion: { $avg: "$completionPercentage" },
            totalEnrollments: { $sum: 1 },
            completedEnrollments: {
              $sum: { $cond: [{ $eq: ["$status", "Completed"] }, 1, 0] },
            },
          },
        },
      ]);

      const stats = {
        averageCompletion: aggregateStats?.averageCompletion || 0,
        totalEnrollments: aggregateStats?.totalEnrollments || 0,
        completedEnrollments: aggregateStats?.completedEnrollments || 0,
        enrollments,
      };

      console.info("progress-analytics: Analytics retrieved", {
        courseId,
        instructorId: req.instructor._id,
        totalEnrollments: stats.totalEnrollments,
      });

      res.status(200).json({
        success: true,
        stats,
        total: stats.totalEnrollments,
        page: Number(page),
        pages: Math.ceil(stats.totalEnrollments / limit),
      });
    } catch (error) {
      console.error("PROGRESS ANALYTICS ERROR:", error);
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

module.exports = router;
