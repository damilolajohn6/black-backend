const express = require("express");
const router = express.Router();
const Course = require("../model/course");
const Quiz = require("../model/quiz");
const Discussion = require("../model/discussion");
const Question = require("../model/question");
const User = require("../model/user");
const Enrollment = require("../model/enrollment");
const sendMail = require("../utils/sendMail");
const catchAsyncErrors = require("../middleware/catchAsyncErrors");
const ErrorHandler = require("../utils/ErrorHandler");
const {
  isAuthenticated,
  isInstructor,
  isAdmin,
} = require("../middleware/auth");
const cloudinary = require("cloudinary").v2;
const mongoose = require("mongoose");

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Create course
router.post(
  "/create-course",
  isInstructor,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const {
        title,
        description,
        learningObjectives,
        prerequisites,
        targetAudience,
        price,
        discountPrice,
        categories,
        tags,
        level,
        language,
        thumbnail,
        previewVideo,
        content,
      } = req.body;

      // Validate required fields
      if (!title) {
        return next(new ErrorHandler("Course title is required", 400));
      }
      if (!description || description.trim() === "") {
        return next(
          new ErrorHandler(
            "Course description is required and cannot be empty",
            400
          )
        );
      }
      if (!learningObjectives || !learningObjectives.length) {
        return next(
          new ErrorHandler("At least one learning objective is required", 400)
        );
      }
      if (!price && price !== 0) {
        return next(new ErrorHandler("Course price is required", 400));
      }
      if (!categories || !categories.length) {
        return next(new ErrorHandler("At least one category is required", 400));
      }
      if (!thumbnail?.url) {
        return next(new ErrorHandler("Course thumbnail is required", 400));
      }

      const course = {
        title,
        description,
        learningObjectives,
        prerequisites: prerequisites || [],
        targetAudience: targetAudience || [],
        price,
        discountPrice,
        categories,
        tags: tags || [],
        level: level || "All Levels",
        language: language || "English",
        instructor: req.instructor._id,
        content: content || [],
      };

      // Upload thumbnail
      const thumbnailResult = await cloudinary.uploader.upload(thumbnail.url, {
        folder: "course_thumbnails",
        width: 720,
        crop: "scale",
        resource_type: "image",
      });
      course.thumbnail = {
        public_id: thumbnailResult.public_id,
        url: thumbnailResult.secure_url,
      };

      // Upload preview video if provided
      if (previewVideo?.url) {
        const previewResult = await cloudinary.uploader.upload(
          previewVideo.url,
          {
            folder: "course_preview_videos",
            resource_type: "video",
            transformation: [{ quality: "auto", fetch_format: "mp4" }],
          }
        );
        course.previewVideo = {
          public_id: previewResult.public_id,
          url: previewResult.secure_url,
          duration: previewResult.duration || 0,
        };
      }

      const newCourse = await Course.create(course);
      console.info("create-course: Course created", {
        courseId: newCourse._id,
        instructorId: req.instructor._id,
        title,
      });

      try {
        await sendMail({
          email: req.instructor.email,
          subject: "New Course Created",
          message: `Hello ${req.instructor.fullname.firstName}, your course "${title}" has been created successfully and is in Draft status. Add content and submit for review to publish.`,
        });
      } catch (error) {
        console.error("EMAIL SEND ERROR:", error);
      }

      res.status(201).json({
        success: true,
        course: newCourse,
      });
    } catch (error) {
      console.error("CREATE COURSE ERROR:", error);
      return next(new ErrorHandler(error.message, 400));
    }
  })
);

// Update course
router.put(
  "/update-course/:id",
  isInstructor,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const course = await Course.findById(req.params.id);
      if (!course) {
        return next(new ErrorHandler("Course not found", 404));
      }
      if (course.instructor.toString() !== req.instructor._id.toString()) {
        return next(new ErrorHandler("Unauthorized: Not your course", 403));
      }

      const {
        title,
        description,
        learningObjectives,
        prerequisites,
        targetAudience,
        price,
        discountPrice,
        categories,
        tags,
        level,
        language,
        thumbnail,
        previewVideo,
        content,
        status,
      } = req.body;

      if (title) course.title = title;
      if (description) course.description = description;
      if (learningObjectives) course.learningObjectives = learningObjectives;
      if (prerequisites) course.prerequisites = prerequisites;
      if (targetAudience) course.targetAudience = targetAudience;
      if (price !== undefined) course.price = price;
      if (discountPrice !== undefined) course.discountPrice = discountPrice;
      if (categories) course.categories = categories;
      if (tags) course.tags = tags;
      if (level) course.level = level;
      if (language) course.language = language;
      if (content) course.content = content;
      if (status) course.status = status;

      // Update thumbnail
      if (thumbnail?.url) {
        if (course.thumbnail.public_id) {
          await cloudinary.uploader.destroy(course.thumbnail.public_id, {
            resource_type: "image",
          });
        }
        const thumbnailResult = await cloudinary.uploader.upload(
          thumbnail.url,
          {
            folder: "course_thumbnails",
            width: 720,
            crop: "scale",
            resource_type: "image",
          }
        );
        course.thumbnail = {
          public_id: thumbnailResult.public_id,
          url: thumbnailResult.secure_url,
        };
      }

      // Update preview video
      if (previewVideo?.url) {
        if (course.previewVideo?.public_id) {
          await cloudinary.uploader.destroy(course.previewVideo.public_id, {
            resource_type: "video",
          });
        }
        const previewResult = await cloudinary.uploader.upload(
          previewVideo.url,
          {
            folder: "course_preview_videos",
            resource_type: "video",
            transformation: [{ quality: "auto", fetch_format: "mp4" }],
          }
        );
        course.previewVideo = {
          public_id: previewResult.public_id,
          url: previewResult.secure_url,
          duration: previewResult.duration || 0,
        };
      }

      await course.save();
      console.info("update-course: Course updated", {
        courseId: course._id,
        instructorId: req.instructor._id,
      });

      res.status(200).json({
        success: true,
        course,
      });
    } catch (error) {
      console.error("UPDATE COURSE ERROR:", error);
      return next(new ErrorHandler(error.message, 400));
    }
  })
);

// Upload lecture video
router.post(
  "/upload-lecture-video/:courseId/:sectionId",
  isInstructor,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { courseId, sectionId } = req.params;
      const { lectureTitle, videoUrl, duration, description } = req.body;

      if (!lectureTitle || !videoUrl || !duration) {
        return next(
          new ErrorHandler(
            "Lecture title, video URL, and duration are required",
            400
          )
        );
      }

      const course = await Course.findById(courseId);
      if (!course) {
        return next(new ErrorHandler("Course not found", 404));
      }
      if (course.instructor.toString() !== req.instructor._id.toString()) {
        return next(new ErrorHandler("Unauthorized: Not your course", 403));
      }

      const section = course.content.id(sectionId);
      if (!section) {
        return next(new ErrorHandler("Section not found", 404));
      }

      const videoResult = await cloudinary.uploader.upload(videoUrl, {
        folder: `courses/${courseId}/lectures`,
        resource_type: "video",
        transformation: [{ quality: "auto", fetch_format: "mp4" }],
      });

      section.lectures.push({
        title: lectureTitle,
        video: {
          public_id: videoResult.public_id,
          url: videoResult.secure_url,
          duration: duration || videoResult.duration,
        },
        description,
      });

      await course.save();
      console.info("upload-lecture-video: Lecture video uploaded", {
        courseId,
        sectionId,
        lectureTitle,
        instructorId: req.instructor._id,
      });

      res.status(200).json({
        success: true,
        course,
      });
    } catch (error) {
      console.error("UPLOAD LECTURE VIDEO ERROR:", error);
      return next(new ErrorHandler(error.message, 400));
    }
  })
);

// Add lecture resource
router.post(
  "/add-lecture-resource/:courseId/:sectionId/:lectureId",
  isInstructor,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { courseId, sectionId, lectureId } = req.params;
      const { title, type, url } = req.body;

      if (!title || !type || !url) {
        return next(
          new ErrorHandler("Resource title, type, and URL are required", 400)
        );
      }

      const course = await Course.findById(courseId);
      if (!course) {
        return next(new ErrorHandler("Course not found", 404));
      }
      if (course.instructor.toString() !== req.instructor._id.toString()) {
        return next(new ErrorHandler("Unauthorized: Not your course", 403));
      }

      const section = course.content.id(sectionId);
      if (!section) {
        return next(new ErrorHandler("Section not found", 404));
      }

      const lecture = section.lectures.id(lectureId);
      if (!lecture) {
        return next(new ErrorHandler("Lecture not found", 404));
      }

      let resource = { title, type, url };
      if (type !== "Link") {
        const resourceResult = await cloudinary.uploader.upload(url, {
          folder: `courses/${courseId}/resources`,
          resource_type: type === "PDF" ? "raw" : "image",
        });
        resource.public_id = resourceResult.public_id;
        resource.url = resourceResult.secure_url;
      }

      lecture.resources.push(resource);
      await course.save();
      console.info("add-lecture-resource: Resource added", {
        courseId,
        sectionId,
        lectureId,
        resourceTitle: title,
        instructorId: req.instructor._id,
      });

      res.status(200).json({
        success: true,
        course,
      });
    } catch (error) {
      console.error("ADD LECTURE RESOURCE ERROR:", error);
      return next(new ErrorHandler(error.message, 400));
    }
  })
);

// Publish course
router.post(
  "/publish-course/:id",
  isInstructor,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const course = await Course.findById(req.params.id);
      if (!course) {
        return next(new ErrorHandler("Course not found", 404));
      }
      if (course.instructor.toString() !== req.instructor._id.toString()) {
        return next(new ErrorHandler("Unauthorized: Not your course", 403));
      }

      course.status = "PendingReview";
      await course.save();
      console.info("publish-course: Course submitted for review", {
        courseId: course._id,
        instructorId: req.instructor._id,
      });

      try {
        await sendMail({
          email: req.instructor.email,
          subject: "Course Submitted for Review",
          message: `Hello ${req.instructor.fullname.firstName}, your course "${course.title}" has been submitted for review. You'll be notified once it's approved or requires changes.`,
        });
      } catch (error) {
        console.error("EMAIL SEND ERROR:", error);
      }

      res.status(200).json({
        success: true,
        message: "Course submitted for review",
      });
    } catch (error) {
      console.error("PUBLISH COURSE ERROR:", error);
      return next(new ErrorHandler(error.message, 400));
    }
  })
);

// Preview course (public)
router.get(
  "/preview-course/:id",
  catchAsyncErrors(async (req, res, next) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
        return next(new ErrorHandler("Invalid course ID", 400));
      }

      const course = await Course.findById(req.params.id)
        .populate("instructor", "fullname avatar bio expertise")
        .lean();

      if (!course) {
        return next(new ErrorHandler("Course not found", 404));
      }

      // Limit content for preview
      const previewCourse = {
        _id: course._id,
        title: course.title,
        description: course.description,
        learningObjectives: course.learningObjectives,
        prerequisites: course.prerequisites,
        targetAudience: course.targetAudience,
        thumbnail: course.thumbnail,
        previewVideo: course.previewVideo,
        instructor: course.instructor,
        price: course.price,
        discountPrice: course.discountPrice,
        categories: course.categories,
        tags: course.tags,
        level: course.level,
        language: course.language,
        totalDuration: course.totalDuration,
        content: course.content.map((section) => ({
          sectionTitle: section.sectionTitle,
          lectures: section.lectures.slice(0, 1).map((lecture) => ({
            title: lecture.title,
            duration: lecture.duration,
            isPreview: true,
          })),
        })),
      };

      console.info("preview-course: Course preview retrieved", {
        courseId: req.params.id,
      });

      res.status(200).json({
        success: true,
        course: previewCourse,
      });
    } catch (error) {
      console.error("PREVIEW COURSE ERROR:", error);
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Existing routes (unchanged for brevity, but included for completeness)
router.put(
  "/update-course/:id",
  isInstructor,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const course = await Course.findById(req.params.id);
      if (!course) {
        return next(new ErrorHandler("Course not found", 404));
      }
      if (course.instructor.toString() !== req.instructor._id.toString()) {
        return next(new ErrorHandler("Unauthorized: Not your course", 403));
      }

      const {
        title,
        description,
        learningObjectives,
        prerequisites,
        targetAudience,
        price,
        discountPrice,
        categories,
        tags,
        level,
        language,
        thumbnail,
        previewVideo,
        content,
        status,
      } = req.body;

      if (title) course.title = title;
      if (description) course.description = description;
      if (learningObjectives) course.learningObjectives = learningObjectives;
      if (prerequisites) course.prerequisites = prerequisites;
      if (targetAudience) course.targetAudience = targetAudience;
      if (price !== undefined) course.price = price;
      if (discountPrice !== undefined) course.discountPrice = discountPrice;
      if (categories) course.categories = categories;
      if (tags) course.tags = tags;
      if (level) course.level = level;
      if (language) course.language = language;
      if (content) course.content = content;
      if (status) course.status = status;

      if (thumbnail?.url) {
        if (course.thumbnail.public_id) {
          await cloudinary.uploader.destroy(course.thumbnail.public_id, {
            resource_type: "image",
          });
        }
        const thumbnailResult = await cloudinary.uploader.upload(
          thumbnail.url,
          {
            folder: "course_thumbnails",
            width: 720,
            crop: "scale",
            resource_type: "image",
          }
        );
        course.thumbnail = {
          public_id: thumbnailResult.public_id,
          url: thumbnailResult.secure_url,
        };
      }

      if (previewVideo?.url) {
        if (course.previewVideo?.public_id) {
          await cloudinary.uploader.destroy(course.previewVideo.public_id, {
            resource_type: "video",
          });
        }
        const previewResult = await cloudinary.uploader.upload(
          previewVideo.url,
          {
            folder: "course_preview_videos",
            resource_type: "video",
            transformation: [{ quality: "auto", fetch_format: "mp4" }],
          }
        );
        course.previewVideo = {
          public_id: previewResult.public_id,
          url: previewResult.secure_url,
          duration: previewResult.duration || 0,
        };
      }

      await course.save();
      console.info("update-course: Course updated", {
        courseId: course._id,
        instructorId: req.instructor._id,
      });

      res.status(200).json({
        success: true,
        course,
      });
    } catch (error) {
      console.error("UPDATE COURSE ERROR:", error);
      return next(new ErrorHandler(error.message, 400));
    }
  })
);

router.delete(
  "/delete-course/:id",
  isInstructor,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const course = await Course.findById(req.params.id);
      if (!course) {
        return next(new ErrorHandler("Course not found", 404));
      }
      if (course.instructor.toString() !== req.instructor._id.toString()) {
        return next(new ErrorHandler("Unauthorized: Not your course", 403));
      }

      course.status = "Archived";
      await course.save();
      console.info("delete-course: Course archived", {
        courseId: course._id,
        instructorId: req.instructor._id,
      });

      res.status(200).json({
        success: true,
        message: "Course archived successfully",
      });
    } catch (error) {
      console.error("DELETE COURSE ERROR:", error);
      return next(new ErrorHandler(error.message, 400));
    }
  })
);

router.get(
  "/get-instructor-courses",
  isInstructor,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { status, page = 1, limit = 10 } = req.query;
      const query = { instructor: req.instructor._id };
      if (status) query.status = status;

      const courses = await Course.find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(Number(limit));

      const total = await Course.countDocuments(query);

      console.info("get-instructor-courses: Courses retrieved", {
        instructorId: req.instructor._id,
        courseCount: courses.length,
        page,
        limit,
        status,
      });

      res.status(200).json({
        success: true,
        courses,
        total,
        page: Number(page),
        pages: Math.ceil(total / limit),
      });
    } catch (error) {
      console.error("GET INSTRUCTOR COURSES ERROR:", error);
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

router.get(
  "/get-course/:id",
  catchAsyncErrors(async (req, res, next) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
        return next(new ErrorHandler("Invalid course ID", 400));
      }

      const course = await Course.findById(req.params.id)
        .populate("instructor", "fullname avatar bio expertise")
        .lean();

      if (!course) {
        return next(new ErrorHandler("Course not found", 404));
      }

      console.info("get-course: Course details retrieved", {
        courseId: req.params.id,
      });

      res.status(200).json({
        success: true,
        course,
      });
    } catch (error) {
      console.error("GET COURSE ERROR:", error);
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

router.get(
  "/search-courses",
  catchAsyncErrors(async (req, res, next) => {
    try {
      const {
        query: searchQuery,
        category,
        level,
        language,
        page = 1,
        limit = 10,
        sortBy = "createdAt",
        order = "desc",
      } = req.query;

      const filter = { status: "Published" };
      if (searchQuery) {
        filter.$or = [
          { title: { $regex: searchQuery, $options: "i" } },
          { tags: { $regex: searchQuery, $options: "i" } },
        ];
      }
      if (category) {
        filter.categories = { $in: [category] };
      }
      if (level) {
        filter.level = level;
      }
      if (language) {
        filter.language = language;
      }

      const sort = {};
      sort[sortBy] = order === "desc" ? -1 : 1;

      const courses = await Course.find(filter)
        .populate("instructor", "fullname avatar")
        .sort(sort)
        .skip((page - 1) * limit)
        .limit(Number(limit))
        .select(
          "title thumbnail price discountPrice categories level enrollmentCount tags"
        );

      const total = await Course.countDocuments(filter);

      console.info("search-courses: Courses retrieved", {
        searchQuery,
        category,
        level,
        language,
        courseCount: courses.length,
        page,
        limit,
      });

      res.status(200).json({
        success: true,
        courses,
        total,
        page: Number(page),
        pages: Math.ceil(total / limit),
      });
    } catch (error) {
      console.error("SEARCH COURSES ERROR:", error);
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

router.post(
  "/create-quiz/:courseId",
  isInstructor,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { courseId } = req.params;
      const {
        title,
        description,
        sectionId,
        timeLimit,
        passingScore,
        questions,
      } = req.body;

      if (!title || !sectionId || !questions || !Array.isArray(questions)) {
        return next(new ErrorHandler("Required fields are missing", 400));
      }

      const course = await Course.findById(courseId);
      if (!course) {
        return next(new ErrorHandler("Course not found", 404));
      }
      if (course.instructor.toString() !== req.instructor._id.toString()) {
        return next(new ErrorHandler("Unauthorized: Not your course", 403));
      }

      const sectionExists = course.content.some(
        (section) => section._id.toString() === sectionId
      );
      if (!sectionExists) {
        return next(new ErrorHandler("Section not found in course", 404));
      }

      const quiz = await Quiz.create({
        course: courseId,
        sectionId,
        title,
        description,
        timeLimit: timeLimit || 0,
        passingScore: passingScore || 70,
        questions,
      });

      console.info("create-quiz: Quiz created", {
        quizId: quiz._id,
        courseId,
        instructorId: req.instructor._id,
      });

      res.status(201).json({
        success: true,
        quiz,
      });
    } catch (error) {
      console.error("CREATE QUIZ ERROR:", error);
      return next(new ErrorHandler(error.message, 400));
    }
  })
);

router.put(
  "/update-quiz/:quizId",
  isInstructor,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { quizId } = req.params;
      const { title, description, timeLimit, passingScore, questions } =
        req.body;

      const quiz = await Quiz.findById(quizId).populate("course");
      if (!quiz) {
        return next(new ErrorHandler("Quiz not found", 404));
      }
      if (quiz.course.instructor.toString() !== req.instructor._id.toString()) {
        return next(new ErrorHandler("Unauthorized: Not your course", 403));
      }

      if (title) quiz.title = title;
      if (description) quiz.description = description;
      if (timeLimit !== undefined) quiz.timeLimit = timeLimit;
      if (passingScore !== undefined) quiz.passingScore = passingScore;
      if (questions) quiz.questions = questions;
      quiz.updatedAt = new Date();

      await quiz.save();

      console.info("update-quiz: Quiz updated", {
        quizId,
        courseId: quiz.course._id,
        instructorId: req.instructor._id,
      });

      res.status(200).json({
        success: true,
        quiz,
      });
    } catch (error) {
      console.error("UPDATE QUIZ ERROR:", error);
      return next(new ErrorHandler(error.message, 400));
    }
  })
);

router.delete(
  "/delete-quiz/:quizId",
  isInstructor,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { quizId } = req.params;

      const quiz = await Quiz.findById(quizId).populate("course");
      if (!quiz) {
        return next(new ErrorHandler("Quiz not found", 404));
      }
      if (quiz.course.instructor.toString() !== req.instructor._id.toString()) {
        return next(new ErrorHandler("Unauthorized: Not your course", 403));
      }

      quiz.isActive = false;
      quiz.updatedAt = new Date();
      await quiz.save();

      console.info("delete-quiz: Quiz deactivated", {
        quizId,
        courseId: quiz.course._id,
        instructorId: req.instructor._id,
      });

      res.status(200).json({
        success: true,
        message: "Quiz deactivated successfully",
      });
    } catch (error) {
      console.error("DELETE QUIZ ERROR:", error);
      return next(new ErrorHandler(error.message, 400));
    }
  })
);

router.post(
  "/create-discussion/:courseId",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { courseId } = req.params;
      const { title, content } = req.body;

      if (!title || !content) {
        return next(new ErrorHandler("Title and content are required", 400));
      }

      const course = await Course.findById(courseId);
      if (!course) {
        return next(new ErrorHandler("Course not found", 404));
      }

      const discussion = await Discussion.create({
        course: courseId,
        user: req.user._id,
        title,
        content,
      });

      console.info("create-discussion: Discussion created", {
        discussionId: discussion._id,
        courseId,
        userId: req.user._id,
      });

      res.status(201).json({
        success: true,
        discussion,
      });
    } catch (error) {
      console.error("CREATE DISCUSSION ERROR:", error);
      return next(new ErrorHandler(error.message, 400));
    }
  })
);

router.post(
  "/reply-discussion/:discussionId",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { discussionId } = req.params;
      const { content } = req.body;

      if (!content) {
        return next(new ErrorHandler("Reply content is required", 400));
      }

      const discussion = await Discussion.findById(discussionId).populate(
        "course"
      );
      if (!discussion || !discussion.isActive) {
        return next(new ErrorHandler("Discussion not found or inactive", 404));
      }

      discussion.replies.push({
        user: req.user._id,
        content,
      });
      discussion.updatedAt = new Date();
      await discussion.save();

      console.info("reply-discussion: Reply added", {
        discussionId,
        courseId: discussion.course._id,
        userId: req.user._id,
      });

      res.status(200).json({
        success: true,
        discussion,
      });
    } catch (error) {
      console.error("REPLY DISCUSSION ERROR:", error);
      return next(new ErrorHandler(error.message, 400));
    }
  })
);

router.get(
  "/get-discussions/:courseId",
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

      const discussions = await Discussion.find({
        course: courseId,
        isActive: true,
      })
        .populate("user", "fullname avatar")
        .populate("replies.user", "fullname avatar")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(Number(limit));

      const total = await Discussion.countDocuments({
        course: courseId,
        isActive: true,
      });

      console.info("get-discussions: Discussions retrieved", {
        courseId,
        discussionCount: discussions.length,
        page,
        limit,
      });

      res.status(200).json({
        success: true,
        discussions,
        total,
        page: Number(page),
        pages: Math.ceil(total / limit),
      });
    } catch (error) {
      console.error("GET DISCUSSIONS ERROR:", error);
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

router.post(
  "/create-question/:courseId",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { courseId } = req.params;
      const { questionText } = req.body;

      if (!questionText) {
        return next(new ErrorHandler("Question text is required", 400));
      }

      const course = await Course.findById(courseId).populate("instructor");
      if (!course) {
        return next(new ErrorHandler("Course not found", 404));
      }

      const enrollment = await Enrollment.findOne({
        user: req.user._id,
        course: courseId,
      });
      if (!enrollment) {
        return next(
          new ErrorHandler("You are not enrolled in this course", 403)
        );
      }

      const question = await Question.create({
        course: courseId,
        enrollment: enrollment._id,
        user: req.user._id,
        questionText,
      });

      try {
        if (course.instructor) {
          await sendMail({
            email: course.instructor.email,
            subject: "New Question in Your Course",
            message: `Hello ${course.instructor.fullname.firstName}, a student has asked a question in your course "${course.title}": "${questionText}".`,
          });
        }
      } catch (error) {
        console.error("EMAIL SEND ERROR:", error);
      }

      console.info("create-question: Question created", {
        questionId: question._id,
        courseId,
        userId: req.user._id,
      });

      res.status(201).json({
        success: true,
        question,
      });
    } catch (error) {
      console.error("CREATE QUESTION ERROR:", error);
      return next(new ErrorHandler(error.message, 400));
    }
  })
);

router.post(
  "/answer-question/:questionId",
  isInstructor,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { questionId } = req.params;
      const { answerText } = req.body;

      if (!answerText) {
        return next(new ErrorHandler("Answer text is required", 400));
      }

      const question = await Question.findById(questionId).populate(
        "course user"
      );
      if (!question) {
        return next(new ErrorHandler("Question not found", 404));
      }
      if (
        question.course.instructor.toString() !== req.instructor._id.toString()
      ) {
        return next(
          new ErrorHandler("Unauthorized to answer this question", 403)
        );
      }

      question.answer = {
        instructor: req.instructor._id,
        answerText,
        answeredAt: new Date(),
      };
      question.updatedAt = new Date();
      await question.save();

      try {
        await sendMail({
          email: question.user.email,
          subject: "Your Question Has Been Answered",
          message: `Hello ${question.user.fullname.firstName}, your question in the course "${question.course.title}" has been answered: "${answerText}".`,
        });
      } catch (error) {
        console.error("EMAIL SEND ERROR:", error);
      }

      console.info("answer-question: Question answered", {
        questionId,
        courseId: question.course._id,
        instructorId: req.instructor._id,
      });

      res.status(200).json({
        success: true,
        question,
      });
    } catch (error) {
      console.error("ANSWER QUESTION ERROR:", error);
      return next(new ErrorHandler(error.message, 400));
    }
  })
);

router.get(
  "/get-questions/:courseId",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { courseId } = req.params;
      const { page = 1, limit = 10 } = req.query;

      const course = await Course.findById(courseId);
      if (!course) {
        return next(new ErrorHandler("Course not found", 404));
      }

      const isInstructor =
        req.user.role === "instructor" &&
        course.instructor.toString() === req.instructor?._id.toString();
      const isAdmin = req.user.role === "admin";

      const query = { course: courseId };
      if (!isInstructor && !isAdmin) {
        query.user = req.user._id;
      }

      const questions = await Question.find(query)
        .populate("user", "fullname avatar")
        .populate("answer.instructor", "fullname")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(Number(limit));

      const total = await Question.countDocuments(query);

      console.info("get-questions: Questions retrieved", {
        courseId,
        questionCount: questions.length,
        page,
        limit,
      });

      res.status(200).json({
        success: true,
        questions,
        total,
        page: Number(page),
        pages: Math.ceil(total / limit),
      });
    } catch (error) {
      console.error("GET QUESTIONS ERROR:", error);
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

router.post(
  "/add-to-wishlist/:courseId",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { courseId } = req.params;

      const course = await Course.findById(courseId);
      if (!course || course.status !== "Published") {
        return next(new ErrorHandler("Course not found or not published", 404));
      }

      const user = await User.findById(req.user._id);
      if (user.wishlist.includes(courseId)) {
        return next(new ErrorHandler("Course already in wishlist", 400));
      }

      user.wishlist.push(courseId);
      await user.save();

      console.info("add-to-wishlist: Course added to wishlist", {
        courseId,
        userId: req.user._id,
      });

      res.status(200).json({
        success: true,
        message: "Course added to wishlist",
      });
    } catch (error) {
      console.error("ADD TO WISHLIST ERROR:", error);
      return next(new ErrorHandler(error.message, 400));
    }
  })
);

router.delete(
  "/remove-from-wishlist/:courseId",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { courseId } = req.params;

      const user = await User.findById(req.user._id);
      if (!user.wishlist.includes(courseId)) {
        return next(new ErrorHandler("Course not in wishlist", 400));
      }

      user.wishlist = user.wishlist.filter((id) => id.toString() !== courseId);
      await user.save();

      console.info("remove-from-wishlist: Course removed from wishlist", {
        courseId,
        userId: req.user._id,
      });

      res.status(200).json({
        success: true,
        message: "Course removed from wishlist",
      });
    } catch (error) {
      console.error("REMOVE FROM WISHLIST ERROR:", error);
      return next(new ErrorHandler(error.message, 400));
    }
  })
);

router.get(
  "/get-wishlist/:userId",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { userId } = req.params;

      if (req.user._id.toString() !== userId && req.user.role !== "admin") {
        return next(
          new ErrorHandler("Unauthorized to access this wishlist", 403)
        );
      }

      const user = await User.findById(userId).populate(
        "wishlist",
        "title thumbnail price discountPrice"
      );

      if (!user) {
        return next(new ErrorHandler("User not found", 404));
      }

      console.info("get-wishlist: Wishlist retrieved", {
        userId,
        wishlistCount: user.wishlist.length,
      });

      res.status(200).json({
        success: true,
        wishlist: user.wishlist,
      });
    } catch (error) {
      console.error("GET WISHLIST ERROR:", error);
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

router.put(
  "/bulk-update-course-status",
  isInstructor,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { courseIds, status } = req.body;
      if (!courseIds || !Array.isArray(courseIds) || !status) {
        return next(
          new ErrorHandler("Course IDs and status are required", 400)
        );
      }
      if (
        !["Draft", "Published", "Archived", "PendingReview"].includes(status)
      ) {
        return next(new ErrorHandler("Invalid status", 400));
      }

      const courses = await Course.find({
        _id: { $in: courseIds },
        instructor: req.instructor._id,
      });

      if (courses.length !== courseIds.length) {
        return next(
          new ErrorHandler("Some courses not found or unauthorized", 404)
        );
      }

      const updatedCourses = await Course.updateMany(
        { _id: { $in: courseIds }, instructor: req.instructor._id },
        { status, updatedAt: new Date() },
        { new: true }
      );

      console.info("bulk-update-course-status: Courses updated", {
        instructorId: req.instructor._id,
        courseCount: updatedCourses.modifiedCount,
        status,
      });

      res.status(200).json({
        success: true,
        message: `${updatedCourses.modifiedCount} courses updated to ${status}`,
      });
    } catch (error) {
      console.error("BULK UPDATE COURSE STATUS ERROR:", error);
      return next(new ErrorHandler(error.message, 400));
    }
  })
);

router.get(
  "/recommended-courses/:userId",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      if (
        req.user._id.toString() !== req.params.userId &&
        req.user.role !== "admin"
      ) {
        return next(
          new ErrorHandler("Unauthorized to access recommendations", 403)
        );
      }

      const enrollments = await Enrollment.find({
        user: req.params.userId,
      }).populate("course", "categories tags");

      const userCategories = [
        ...new Set(enrollments.flatMap((e) => e.course?.categories || [])),
      ];
      const userTags = [
        ...new Set(enrollments.flatMap((e) => e.course?.tags || [])),
      ];

      const recommendedCourses = await Course.find({
        status: "Published",
        _id: { $nin: enrollments.map((e) => e.course._id) },
        $or: [
          {
            categories: {
              $in: userCategories.length > 0 ? userCategories : ["General"],
            },
          },
          { tags: { $in: userTags.length > 0 ? userTags : [] } },
        ],
      })
        .populate("instructor", "fullname")
        .sort({ enrollmentCount: -1 })
        .limit(5)
        .select("title thumbnail price discountPrice categories tags");

      console.info("recommended-courses: Recommendations retrieved", {
        userId: req.params.userId,
        courseCount: recommendedCourses.length,
      });

      res.status(200).json({
        success: true,
        courses: recommendedCourses,
      });
    } catch (error) {
      console.error("RECOMMENDED COURSES ERROR:", error);
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

module.exports = router;
