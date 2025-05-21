// middleware/auth.js
const jwt = require("jsonwebtoken");
const ErrorHandler = require("../utils/ErrorHandler");
const catchAsyncErrors = require("./catchAsyncErrors");
const User = require("../model/user");
const Shop = require("../model/shop");
const Admin = require("../model/admin");
const Instructor = require("../model/instructor");

exports.isAuthenticated = catchAsyncErrors(async (req, res, next) => {
  const { token } = req.cookies;
  if (!token) {
    return next(new ErrorHandler("Please login to continue", 401));
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET_KEY);
    req.user = await User.findById(decoded.id);
    if (!req.user) {
      return next(new ErrorHandler("User not found", 404));
    }
    console.debug("isAuthenticated: User authenticated", {
      userId: req.user._id,
    });
    next();
  } catch (error) {
    console.error("isAuthenticated error:", {
      message: error.message,
      token: token ? "present" : "missing",
    });
    return next(new ErrorHandler("Invalid or expired token", 401));
  }
});

exports.isSeller = catchAsyncErrors(async (req, res, next) => {
  let token =
    req.cookies.seller_token || req.headers.authorization?.split(" ")[1];
  if (!token) {
    console.error("isSeller: No seller token provided");
    return next(new ErrorHandler("Please login as a seller to continue", 401));
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET_KEY);
    req.seller = await Shop.findById(decoded.id);
    if (!req.seller) {
      console.error("isSeller: Shop not found for ID:", decoded.id);
      return next(new ErrorHandler("Seller not found", 404));
    }
    if (!req.seller.isVerified) {
      console.error("isSeller: Shop not verified for ID:", decoded.id);
      return next(new ErrorHandler("Please verify your shop account", 403));
    }
    console.debug("isSeller: Seller authenticated", {
      sellerId: req.seller._id,
      shopName: req.seller.name,
    });
    next();
  } catch (error) {
    console.error("isSeller error:", {
      message: error.message,
      token: token ? "present" : "missing",
    });
    return next(new ErrorHandler("Invalid or expired seller token", 401));
  }
});

exports.isInstructor = catchAsyncErrors(async (req, res, next) => {
  let token =
    req.cookies.instructor_token || req.headers.authorization?.split(" ")[1];
  if (!token) {
    console.error("isInstructor: No instructor token provided");
    return next(
      new ErrorHandler("Please login as an instructor to continue", 401)
    );
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET_KEY);
    if (decoded.model !== "Instructor") {
      console.error("isInstructor: Token model mismatch:", {
        model: decoded.model,
      });
      return next(new ErrorHandler("Invalid instructor token", 401));
    }
    req.instructor = await Instructor.findById(decoded.id);
    if (!req.instructor) {
      console.error("isInstructor: Instructor not found for ID:", decoded.id);
      return next(new ErrorHandler("Instructor not found", 404));
    }
    if (!req.instructor.isVerified) {
      console.error(
        "isInstructor: Instructor not verified for ID:",
        decoded.id
      );
      return next(
        new ErrorHandler("Please verify your instructor account", 403)
      );
    }
    console.debug("isInstructor: Instructor authenticated", {
      instructorId: req.instructor._id,
      email: req.instructor.email,
    });
    next();
  } catch (error) {
    console.error("isInstructor error:", {
      message: error.message,
      token: token ? "present" : "missing",
    });
    return next(new ErrorHandler("Invalid or expired instructor token", 401));
  }
});

exports.isAdmin = (...roles) => {
  return catchAsyncErrors(async (req, res, next) => {
    if (!req.admin && !req.user) {
      return next(
        new ErrorHandler("Please login as an admin to continue", 401)
      );
    }
    const entity = req.admin || req.user;
    if (!roles.includes(entity.role)) {
      return next(
        new ErrorHandler(
          `${entity.role} is not allowed to access this resource`,
          403
        )
      );
    }
    if (req.admin) {
      req.admin = entity;
    }
    next();
  });
};

exports.isSuperAdmin = catchAsyncErrors(async (req, res, next) => {
  if (!req.admin) {
    return next(new ErrorHandler("Please login as an admin to continue", 401));
  }
  if (req.admin.role !== "superAdmin") {
    return next(
      new ErrorHandler("You are not authorized to access this resource", 403)
    );
  }
  console.debug("isSuperAdmin: Super admin authenticated", {
    adminId: req.admin._id,
    email: req.admin.email,
  });
  next();
});