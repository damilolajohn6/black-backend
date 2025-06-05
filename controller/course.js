const express = require("express");
const router = express.Router();
const Course = require("../model/course");
const Discussion = require("../model/discussion");
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
        isFree,
        categories,
        tags,
        level,
        language,
        thumbnail,
        previewVideo,
        content,
      } = req.body;

      // Validate required fields
      if (!title || !title.en) return next(new ErrorHandler("English course title is required", 400));
      if (!description || !description.en) return next(new ErrorHandler("English course description is required", 400));
      if (!learningObjectives || !Array.isArray(learningObjectives) || learningObjectives.length === 0)
        return next(new ErrorHandler("At least one learning objective is required", 400));
      if (price === undefined || price === null) return next(new ErrorHandler("Course price is required", 400));
      if (isFree && price !== 0) return next(new ErrorHandler("Price must be 0 for free courses", 400));
      if (!isFree && price <= 0) return next(new ErrorHandler("Price must be greater than 0 for paid courses", 400));
      if (!categories || !Array.isArray(categories) || categories.length === 0)
        return next(new ErrorHandler("At least one category is required", 400));
      if (!thumbnail?.url) return next(new ErrorHandler("Course thumbnail URL is required", 400));
      if (!content || !Array.isArray(content) || content.length === 0)
        return next(new ErrorHandler("At least one content section is required", 400));

      const course = {
        title,
        description,
        learningObjectives,
        prerequisites: prerequisites || [],
        targetAudience: targetAudience || [],
        price,
        isFree: isFree || false,
        categories,
        tags: tags || [],
        level: level || "All Levels",
        language: language || "English",
        instructor: req.instructor._id,
        content: content.map((section) => ({
          sectionTitle: section.sectionTitle || "Untitled Section",
          lectures: section.lectures?.map((lecture) => ({
            title: lecture.title || "Untitled Lecture",
            description: lecture.description || "",
            video: lecture.videoUrl ? {
              url: lecture.videoUrl,
              public_id: lecture.public_id || "",
              duration: lecture.duration || 0,
            } : null,
            resources: [],
          })) || [],
        })),
      };

      // Handle thumbnail
      if (!thumbnail.url.includes("cloudinary.com")) {
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
      } else {
        course.thumbnail = { url: thumbnail.url, public_id: thumbnail.public_id || "" };
      }

      // Handle preview video
      if (previewVideo?.url) {
        let previewResult;
        if (!previewVideo.url.includes("cloudinary.com")) {
          previewResult = await cloudinary.uploader.upload(previewVideo.url, {
            folder: "course_preview_videos",
            resource_type: "video",
            transformation: [{ quality: "auto", fetch_format: "mp4", duration: 300 }],
          });
        } else {
          previewResult = { secure_url: previewVideo.url, public_id: previewVideo.public_id || "", duration: previewVideo.duration || 0 };
        }
        course.previewVideo = {
          public_id: previewResult.public_id,
          url: previewResult.secure_url,
          duration: previewResult.duration || 0,
        };
      }

      // Validate lecture videos
      for (const section of course.content) {
        for (const lecture of section.lectures) {
          if (lecture.video && !lecture.video.url.includes("cloudinary.com") && !lecture.video.public_id) {
            const videoResult = await cloudinary.uploader.upload(lecture.video.url, {
              folder: `courses/temp/lectures`,
              resource_type: "video",
              transformation: [{ quality: "auto", fetch_format: "mp4" }],
            });
            lecture.video = {
              public_id: videoResult.public_id,
              url: videoResult.secure_url,
              duration: videoResult.duration || 0,
            };
          }
        }
      }

      const newCourse = await Course.create(course);
      console.info("create-course: Course created", {
        courseId: newCourse._id,
        instructorId: req.instructor._id,
        title: title.en,
      });

      try {
        await sendMail({
          email: req.instructor.email,
          subject: "New Course Created",
          message: `Hello ${req.instructor.fullname.firstName}, your course "${title.en}" has been created successfully and is in Draft status.`,
        });
      } catch (emailError) {
        console.error("EMAIL SEND ERROR:", emailError.message);
      }

      res.status(201).json({
        success: true,
        course: newCourse,
      });
    } catch (error) {
      console.error("CREATE COURSE ERROR:", error.message, error.stack);
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
      if (!course) return next(new ErrorHandler("Course not found", 404));
      if (course.instructor.toString() !== req.instructor._id.toString())
        return next(new ErrorHandler("Unauthorized: Not your course", 403));

      const {
        title,
        description,
        learningObjectives,
        prerequisites,
        targetAudience,
        price,
        isFree,
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
      if (isFree !== undefined) course.isFree = isFree;
      if (isFree && price !== 0)
        return next(new ErrorHandler("Price must be 0 for free courses", 400));
      if (!isFree && price <= 0)
        return next(
          new ErrorHandler("Price must be greater than 0 for paid courses", 400)
        );
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
            transformation: [
              { quality: "auto", fetch_format: "mp4", duration: 300 },
            ],
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

      if (!lectureTitle || !videoUrl || !duration)
        return next(
          new ErrorHandler(
            "Lecture title, video URL, and duration are required",
            400
          )
        );

      const course = await Course.findById(courseId);
      if (!course) return next(new ErrorHandler("Course not found", 404));
      if (course.instructor.toString() !== req.instructor._id.toString())
        return next(new ErrorHandler("Unauthorized: Not your course", 403));

      const section = course.content.id(sectionId);
      if (!section) return next(new ErrorHandler("Section not found", 404));

      let videoResult;
      if (!videoUrl.includes("cloudinary.com")) {
        videoResult = await cloudinary.uploader.upload(videoUrl, {
          folder: `courses/${courseId}/lectures`,
          resource_type: "video",
          transformation: [{ quality: "auto:low", fetch_format: "mp4" }],
        });
      } else {
        videoResult = {
          secure_url: videoUrl,
          public_id: "",
          duration: duration,
        };
      }

      section.lectures.push({
        title: lectureTitle,
        video: {
          public_id: videoResult.public_id,
          url: videoResult.secure_url,
          duration: videoResult.duration || duration,
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

      if (!title || !type || !url)
        return next(
          new ErrorHandler("Resource title, type, and URL are required", 400)
        );

      const course = await Course.findById(courseId);
      if (!course) return next(new ErrorHandler("Course not found", 404));
      if (course.instructor.toString() !== req.instructor._id.toString())
        return next(new ErrorHandler("Unauthorized: Not your course", 403));

      const section = course.content.id(sectionId);
      if (!section) return next(new ErrorHandler("Section not found", 404));

      const lecture = section.lectures.id(lectureId);
      if (!lecture) return next(new ErrorHandler("Lecture not found", 404));

      let resource = { title, type, url };
      if (type !== "Link" && !url.includes("cloudinary.com")) {
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
      if (!course) return next(new ErrorHandler("Course not found", 404));
      if (course.instructor.toString() !== req.instructor._id.toString())
        return next(new ErrorHandler("Unauthorized: Not your course", 403));

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
          message: `Hello ${req.instructor.fullname.firstName}, your course "${course.title.en}" has been submitted for review.`,
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
      if (!mongoose.Types.ObjectId.isValid(req.params.id))
        return next(new ErrorHandler("Invalid course ID", 400));

      const course = await Course.findById(req.params.id)
        .populate("instructor", "fullname avatar bio expertise")
        .lean();

      if (!course) return next(new ErrorHandler("Course not found", 404));

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
        isFree: course.isFree,
        categories: course.categories,
        tags: course.tags,
        level: course.level,
        language: course.language,
        totalDuration: course.totalDuration,
        content: course.content.map((section) => ({
          sectionTitle: section.sectionTitle,
          lectures: section.lectures.slice(0, 1).map((lecture) => ({
            title: lecture.title,
            duration: lecture.video?.duration,
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

// Delete course
router.delete(
  "/delete-course/:id",
  isInstructor,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const course = await Course.findById(req.params.id);
      if (!course) return next(new ErrorHandler("Course not found", 404));
      if (course.instructor.toString() !== req.instructor._id.toString())
        return next(
          new ErrorHandler("Unauthorized to delete this course", 403)
        );

      if (course.thumbnail?.public_id) {
        await cloudinary.uploader.destroy(course.thumbnail.public_id, {
          resource_type: "image",
        });
      }
      if (course.previewVideo?.public_id) {
        await cloudinary.uploader.destroy(course.previewVideo.public_id, {
          resource_type: "video",
        });
      }
      for (const section of course.content) {
        for (const lecture of section.lectures) {
          if (lecture.video?.public_id) {
            await cloudinary.uploader.destroy(lecture.video.public_id, {
              resource_type: "video",
            });
          }
        }
      }

      await Course.findByIdAndDelete(req.params.id);

      res.status(200).json({
        success: true,
        message: "Course deleted successfully",
      });
    } catch (error) {
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Get instructor courses
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

// Get course by ID
router.get(
  "/get-course/:id",
  isInstructor,
  catchAsyncErrors(async (req, res, next) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id))
        return next(new ErrorHandler("Invalid course ID", 400));

      const course = await Course.findById(req.params.id)
        .populate("instructor", "fullname avatar bio expertise")
        .lean();

      if (!course) return next(new ErrorHandler("Course not found", 404));
      if (course.instructor._id.toString() !== req.instructor._id.toString())
        return next(new ErrorHandler("Unauthorized: Not your course", 403));

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

// Search courses
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
          "title thumbnail price isFree categories level enrollmentCount tags"
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

// Create discussion
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

// Reply to discussion
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

// Get discussions
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

// Add to wishlist
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

// Remove from wishlist
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

// Get wishlist
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
        "title thumbnail price isFree"
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

// Bulk update course status
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

// Recommended courses
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
        .select("title thumbnail price isFree categories tags");

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

// Get suggested categories and tags
router.get(
  "/suggested-categories-tags",
  isInstructor,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const courses = await Course.find({ status: "Published" }).select("categories tags");
      const categories = [...new Set(courses.flatMap((course) => course.categories))];
      const tags = [...new Set(courses.flatMap((course) => course.tags))];

      res.status(200).json({
        success: true,
        categories,
        tags,
      });
    } catch (error) {
      console.error("GET SUGGESTED CATEGORIES TAGS ERROR:", error);
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Save draft version
router.post(
  "/save-draft/:id",
  isInstructor,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const course = await Course.findById(req.params.id);
      if (!course) return next(new ErrorHandler("Course not found", 404));
      if (course.instructor.toString() !== req.instructor._id.toString())
        return next(new ErrorHandler("Unauthorized: Not your course", 403));

      const draftData = req.body;
      const latestVersion = course.draftVersions.length > 0
        ? Math.max(...course.draftVersions.map((v) => v.version))
        : 0;

      course.draftVersions.push({
        data: draftData,
        version: latestVersion + 1,
      });

      if (course.draftVersions.length > 5) {
        course.draftVersions.shift();
      }

      await course.save();
      res.status(200).json({
        success: true,
        message: "Draft saved successfully",
      });
    } catch (error) {
      console.error("SAVE DRAFT ERROR:", error);
      return next(new ErrorHandler(error.message, 400));
    }
  })
);

module.exports = router;
