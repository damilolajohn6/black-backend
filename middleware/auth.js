const jwt = require("jsonwebtoken");
const ErrorHandler = require("../utils/ErrorHandler");
const catchAsyncErrors = require("./catchAsyncErrors");
const User = require("../model/user");
const Shop = require("../model/shop");
const Admin = require("../model/admin");
const Instructor = require("../model/instructor");
const logger = require("../utils/logger"); // Import logger

exports.isAuthenticated = catchAsyncErrors(async (req, res, next) => {
  const { token } = req.cookies;
  if (!token) {
    logger.error("isAuthenticated: No token provided", {
      cookies: Object.keys(req.cookies),
    });
    return next(new ErrorHandler("Please login to continue", 401));
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET_KEY);
    req.user = await User.findById(decoded.id);
    if (!req.user) {
      logger.error("isAuthenticated: User not found", { userId: decoded.id });
      return next(new ErrorHandler("User not found", 404));
    }
    logger.debug("isAuthenticated: User authenticated", {
      userId: req.user._id,
    });
    next();
  } catch (error) {
    logger.error("isAuthenticated: Token verification failed", {
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
    logger.error("isSeller: No seller token provided", {
      cookies: Object.keys(req.cookies),
      authorization: !!req.headers.authorization,
    });
    return next(new ErrorHandler("Please login as a seller to continue", 401));
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET_KEY);
    req.seller = await Shop.findById(decoded.id);
    if (!req.seller) {
      logger.error("isSeller: Shop not found", { shopId: decoded.id });
      return next(new ErrorHandler("Seller not found", 404));
    }
    if (!req.seller.isVerified) {
      logger.error("isSeller: Shop not verified", { shopId: decoded.id });
      return next(new ErrorHandler("Please verify your shop account", 403));
    }
    logger.debug("isSeller: Seller authenticated", {
      sellerId: req.seller._id,
      shopName: req.seller.name,
    });
    next();
  } catch (error) {
    logger.error("isSeller: Token verification failed", {
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
    logger.error("isInstructor: No instructor token provided", {
      cookies: Object.keys(req.cookies),
      authorization: !!req.headers.authorization,
    });
    return next(
      new ErrorHandler("Please login as an instructor to continue", 401)
    );
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET_KEY);
    if (decoded.model !== "Instructor") {
      logger.error("isInstructor: Token model mismatch", {
        model: decoded.model,
      });
      return next(new ErrorHandler("Invalid instructor token", 401));
    }
    req.instructor = await Instructor.findById(decoded.id);
    if (!req.instructor) {
      logger.error("isInstructor: Instructor not found", {
        instructorId: decoded.id,
      });
      return next(new ErrorHandler("Instructor not found", 404));
    }
    if (!req.instructor.isVerified) {
      logger.error("isInstructor: Instructor not verified", {
        instructorId: decoded.id,
      });
      return next(
        new ErrorHandler("Please verify your instructor account", 403)
      );
    }
    logger.debug("isInstructor: Instructor authenticated", {
      instructorId: req.instructor._id,
      email: req.instructor.email,
    });
    next();
  } catch (error) {
    logger.error("isInstructor: Token verification failed", {
      message: error.message,
      token: token ? "present" : "missing",
    });
    return next(new ErrorHandler("Invalid or expired instructor token", 401));
  }
});

exports.isAdmin = (...roles) => {
  return catchAsyncErrors(async (req, res, next) => {
    if (!req.admin && !req.user) {
      logger.error("isAdmin: No admin or user provided", {
        cookies: Object.keys(req.cookies),
        authorization: !!req.headers.authorization,
      });
      return next(
        new ErrorHandler("Please login as an admin to continue", 401)
      );
    }
    const entity = req.admin || req.user;
    if (!roles.includes(entity.role)) {
      logger.error("isAdmin: Role not authorized", {
        role: entity.role,
        userId: entity._id,
      });
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
    logger.debug("isAdmin: Admin authenticated", {
      adminId: entity._id,
      role: entity.role,
    });
    next();
  });
};

exports.isSuperAdmin = catchAsyncErrors(async (req, res, next) => {
  if (!req.admin) {
    logger.error("isSuperAdmin: No admin provided", {
      cookies: Object.keys(req.cookies),
      authorization: !!req.headers.authorization,
    });
    return next(new ErrorHandler("Please login as an admin to continue", 401));
  }
  if (req.admin.role !== "superAdmin") {
    logger.error("isSuperAdmin: Not a super admin", {
      adminId: req.admin._id,
      role: req.admin.role,
    });
    return next(
      new ErrorHandler("You are not authorized to access this resource", 403)
    );
  }
  logger.debug("isSuperAdmin: Super admin authenticated", {
    adminId: req.admin._id,
    email: req.admin.email,
  });
  next();
});
