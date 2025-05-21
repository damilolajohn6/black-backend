const express = require("express");
const router = express.Router();
const Enrollment = require("../model/enrollment");
const Course = require("../model/course");
const Quiz = require("../model/quiz");
const Certificate = require("../model/certificate");
const CouponCode = require("../model/coupounCode");
const sendMail = require("../utils/sendMail");
const catchAsyncErrors = require("../middleware/catchAsyncErrors");
const ErrorHandler = require("../utils/ErrorHandler");
const { isAuthenticated } = require("../middleware/auth");
const { v4: uuidv4 } = require("uuid");

// Enroll in course
router.post(
  "/enroll-course/:courseId",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { courseId } = req.params;
      const { couponCode } = req.body;

      const course = await Course.findById(courseId).populate("instructor");
      if (!course || course.status !== "Published") {
        return next(new ErrorHandler("Course not found or not published", 404));
      }

      const existingEnrollment = await Enrollment.findOne({
        user: req.user._id,
        course: courseId,
      });
      if (existingEnrollment) {
        return next(
          new ErrorHandler("You are already enrolled in this course", 400)
        );
      }

      let finalPrice = course.discountPrice || course.price;
      let appliedCoupon = null;

      if (couponCode) {
        const coupon = await CouponCode.findOne({
          name: couponCode.toUpperCase(),
        });
        if (!coupon) {
          return next(new ErrorHandler("Invalid coupon code", 400));
        }
        if (coupon.instructorId !== course.instructor._id.toString()) {
          return next(
            new ErrorHandler("Coupon not valid for this course", 400)
          );
        }
        if (coupon.selectedCourse && coupon.selectedCourse !== courseId) {
          return next(
            new ErrorHandler("Coupon not valid for this course", 400)
          );
        }
        if (coupon.minAmount && finalPrice < coupon.minAmount) {
          return next(
            new ErrorHandler(
              `Course price must be at least ${coupon.minAmount} to use this coupon`,
              400
            )
          );
        }
        if (coupon.maxAmount && finalPrice > coupon.maxAmount) {
          return next(
            new ErrorHandler(
              `Course price must not exceed ${coupon.maxAmount} to use this coupon`,
              400
            )
          );
        }
        finalPrice = finalPrice * (1 - coupon.value / 100);
        appliedCoupon = coupon;
      }

      const progress = course.content.flatMap((section) =>
        section.lectures.map((lecture) => ({
          lectureId: lecture._id,
          completed: false,
        }))
      );

      const enrollment = await Enrollment.create({
        user: req.user._id,
        course: courseId,
        instructor: course.instructor._id,
        progress,
        couponId: appliedCoupon ? appliedCoupon._id : null,
      });

      course.enrollmentCount += 1;
      await course.save();

      try {
        await sendMail({
          email: req.user.email,
          subject: "Course Enrollment Confirmation",
          message: `Hello ${
            req.user.fullname.firstName
          }, you have successfully enrolled in the course "${course.title}". ${
            appliedCoupon
              ? `You used coupon "${appliedCoupon.name}" for a ${appliedCoupon.value}% discount.`
              : ""
          }`,
        });
      } catch (error) {
        console.error("EMAIL SEND ERROR:", error);
      }

      console.info("enroll-course: User enrolled", {
        enrollmentId: enrollment._id,
        courseId,
        userId: req.user._id,
        finalPrice,
        coupon: appliedCoupon ? appliedCoupon.name : null,
      });

      res.status(201).json({
        success: true,
        enrollment,
        finalPrice,
        appliedCoupon,
      });
    } catch (error) {
      console.error("ENROLL COURSE ERROR:", error);
      return next(new ErrorHandler(error.message, 400));
    }
  })
);

// Get user enrolled courses
router.get(
  "/get-user-courses/:userId",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      if (
        req.user._id.toString() !== req.params.userId &&
        req.user.role !== "admin"
      ) {
        return next(
          new ErrorHandler("Unauthorized to access these courses", 403)
        );
      }

      const { status, page = 1, limit = 10 } = req.query;
      const query = { user: req.params.userId };
      if (status) query.status = status;

      const enrollments = await Enrollment.find(query)
        .populate("course", "title thumbnail price discountPrice")
        .populate("instructor", "fullname")
        .sort({ enrolledAt: -1 })
        .skip((page - 1) * limit)
        .limit(Number(limit));

      const total = await Enrollment.countDocuments(query);

      console.info("get-user-courses: Enrolled courses retrieved", {
        userId: req.params.userId,
        courseCount: enrollments.length,
        page,
        limit,
        status,
      });

      res.status(200).json({
        success: true,
        courses: enrollments,
        total,
        page: Number(page),
        pages: Math.ceil(total / limit),
      });
    } catch (error) {
      console.error("GET USER COURSES ERROR:", error);
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Update course progress
router.put(
  "/update-course-progress/:enrollmentId",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { lectureId, completed } = req.body;
      if (!lectureId || completed === undefined) {
        return next(
          new ErrorHandler("Lecture ID and completion status are required", 400)
        );
      }

      const enrollment = await Enrollment.findById(req.params.enrollmentId)
        .populate("course")
        .populate("instructor", "fullname email");

      if (!enrollment) {
        return next(new ErrorHandler("Enrollment not found", 404));
      }
      if (enrollment.user.toString() !== req.user._id.toString()) {
        return next(
          new ErrorHandler("Unauthorized to update this enrollment", 403)
        );
      }
      if (enrollment.status === "Dropped") {
        return next(
          new ErrorHandler("Cannot update progress for dropped enrollment", 400)
        );
      }

      const progressItem = enrollment.progress.find(
        (p) => p.lectureId.toString() === lectureId
      );
      if (!progressItem) {
        return next(new ErrorHandler("Lecture not found in enrollment", 404));
      }

      progressItem.completed = completed;
      progressItem.completedAt = completed ? new Date() : undefined;

      const totalLectures = enrollment.progress.length;
      const completedLectures = enrollment.progress.filter(
        (p) => p.completed
      ).length;
      enrollment.completionPercentage =
        (completedLectures / totalLectures) * 100;

      if (enrollment.completionPercentage === 100) {
        enrollment.status = "Completed";
      }

      await enrollment.save();
      console.info("update-course-progress: Progress updated", {
        enrollmentId: req.params.enrollmentId,
        userId: req.user._id,
        lectureId,
        completed,
        completionPercentage: enrollment.completionPercentage,
      });

      res.status(200).json({
        success: true,
        enrollment,
      });
    } catch (error) {
      console.error("UPDATE COURSE PROGRESS ERROR:", error);
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Get course progress
router.get(
  "/get-course-progress/:enrollmentId",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const enrollment = await Enrollment.findById(req.params.enrollmentId)
        .populate("course", "title content")
        .populate("instructor", "fullname");

      if (!enrollment) {
        return next(new ErrorHandler("Enrollment not found", 404));
      }
      if (
        enrollment.user.toString() !== req.user._id.toString() &&
        req.user.role !== "admin"
      ) {
        return next(
          new ErrorHandler("Unauthorized to access this progress", 403)
        );
      }

      const progressDetails = enrollment.progress.map((progressItem) => {
        let lectureTitle = "";
        for (const section of enrollment.course.content) {
          const lecture = section.lectures.find(
            (lec) => lec._id.toString() === progressItem.lectureId.toString()
          );
          if (lecture) {
            lectureTitle = lecture.title;
            break;
          }
        }
        return {
          lectureId: progressItem.lectureId,
          lectureTitle,
          completed: progressItem.completed,
          completedAt: progressItem.completedAt,
        };
      });

      console.info("get-course-progress: Progress retrieved", {
        enrollmentId: req.params.enrollmentId,
        userId: req.user._id,
      });

      res.status(200).json({
        success: true,
        progress: {
          courseTitle: enrollment.course.title,
          completionPercentage: enrollment.completionPercentage,
          status: enrollment.status,
          progressDetails,
        },
      });
    } catch (error) {
      console.error("GET COURSE PROGRESS ERROR:", error);
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Submit quiz
router.post(
  "/submit-quiz/:enrollmentId",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { enrollmentId } = req.params;
      const { quizId, answers } = req.body;

      if (!quizId || !answers || !Array.isArray(answers)) {
        return next(new ErrorHandler("Quiz ID and answers are required", 400));
      }

      const enrollment = await Enrollment.findById(enrollmentId).populate(
        "course"
      );
      if (!enrollment) {
        return next(new ErrorHandler("Enrollment not found", 404));
      }
      if (enrollment.user.toString() !== req.user._id.toString()) {
        return next(
          new ErrorHandler(
            "Unauthorized to submit quiz for this enrollment",
            403
          )
        );
      }

      const quiz = await Quiz.findById(quizId);
      if (!quiz || !quiz.isActive) {
        return next(new ErrorHandler("Quiz not found or inactive", 404));
      }
      if (quiz.course.toString() !== enrollment.course._id.toString()) {
        return next(
          new ErrorHandler("Quiz does not belong to this course", 400)
        );
      }

      let score = 0;
      let totalPoints = 0;
      const results = quiz.questions.map((question, index) => {
        const userAnswer = answers[index];
        const correctOptions = question.options
          .filter((opt) => opt.isCorrect)
          .map((opt) => opt.text);
        const isCorrect =
          userAnswer &&
          correctOptions.length === userAnswer.length &&
          correctOptions.every((opt) => userAnswer.includes(opt));
        if (isCorrect) score += question.points;
        totalPoints += question.points;
        return {
          question: question.questionText,
          userAnswer,
          isCorrect,
          correctOptions,
        };
      });

      console.info("submit-quiz: Quiz submitted", {
        enrollmentId,
        quizId,
        userId: req.user._id,
        score,
        totalPoints,
      });

      res.status(200).json({
        success: true,
        results,
        score,
        totalPoints,
        percentage: (score / totalPoints) * 100,
      });
    } catch (error) {
      console.error("SUBMIT QUIZ ERROR:", error);
      return next(new ErrorHandler(error.message, 400));
    }
  })
);

// Generate certificate
router.post(
  "/generate-certificate/:enrollmentId",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { enrollmentId } = req.params;

      const enrollment = await Enrollment.findById(enrollmentId)
        .populate("course")
        .populate("user")
        .populate("instructor", "fullname");

      if (!enrollment) {
        return next(new ErrorHandler("Enrollment not found", 404));
      }
      if (enrollment.user.toString() !== req.user._id.toString()) {
        return next(
          new ErrorHandler("Unauthorized to generate certificate", 403)
        );
      }
      if (enrollment.completionPercentage < 100) {
        return next(new ErrorHandler("Course not fully completed", 400));
      }

      const existingCertificate = await Certificate.findOne({
        enrollment: enrollmentId,
      });
      if (existingCertificate) {
        return next(new ErrorHandler("Certificate already generated", 400));
      }

      const certificateId = `CERT-${uuidv4().slice(0, 8).toUpperCase()}`;
      const certificate = await Certificate.create({
        user: req.user._id,
        course: enrollment.course._id,
        enrollment: enrollmentId,
        certificateId,
      });

      try {
        await sendMail({
          email: req.user.email,
          subject: "Course Completion Certificate",
          message: `Congratulations ${req.user.fullname.firstName}, you have successfully completed the course "${enrollment.course.title}". Your certificate ID is ${certificateId}.`,
        });
      } catch (error) {
        console.error("EMAIL SEND ERROR:", error);
      }

      console.info("generate-certificate: Certificate created", {
        certificateId,
        enrollmentId,
        userId: req.user._id,
        courseId: enrollment.course._id,
      });

      res.status(201).json({
        success: true,
        certificate,
      });
    } catch (error) {
      console.error("GENERATE CERTIFICATE ERROR:", error);
      return next(new ErrorHandler(error.message, 400));
    }
  })
);

// Get certificate
router.get(
  "/get-certificate/:enrollmentId",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { enrollmentId } = req.params;

      const enrollment = await Enrollment.findById(enrollmentId).populate(
        "course user"
      );
      if (!enrollment) {
        return next(new ErrorHandler("Enrollment not found", 404));
      }
      if (
        enrollment.user._id.toString() !== req.user._id.toString() &&
        req.user.role !== "admin"
      ) {
        return next(
          new ErrorHandler("Unauthorized to access this certificate", 403)
        );
      }

      const certificate = await Certificate.findOne({
        enrollment: enrollmentId,
      })
        .populate("user", "fullname")
        .populate("course", "title");

      if (!certificate) {
        return next(new ErrorHandler("Certificate not found", 404));
      }

      console.info("get-certificate: Certificate retrieved", {
        certificateId: certificate.certificateId,
        enrollmentId,
        userId: req.user._id,
      });

      res.status(200).json({
        success: true,
        certificate,
      });
    } catch (error) {
      console.error("GET CERTIFICATE ERROR:", error);
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

module.exports = router;
