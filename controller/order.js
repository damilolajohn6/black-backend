const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();
const { body, query, param, validationResult } = require("express-validator");
const ErrorHandler = require("../utils/ErrorHandler");
const catchAsyncErrors = require("../middleware/catchAsyncErrors");
const {
  isAuthenticated,
  isSeller,
  isInstructor,
  isAdmin,
} = require("../middleware/auth");
const Order = require("../model/order");
const Shop = require("../model/shop");
const Product = require("../model/product");
const Course = require("../model/course");
const Instructor = require("../model/instructor");
const Enrollment = require("../model/enrollment");
const User = require("../model/user");
const sendMail = require("../utils/sendMail");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const logger = require("../utils/logger");

// Valid status transitions
const STATUS_TRANSITIONS = {
  Pending: ["Confirmed", "Cancelled", "Refund Requested"],
  Confirmed: ["Shipped", "Cancelled", "Refund Requested"],
  Shipped: ["Delivered"],
  Delivered: ["Refund Requested"],
  "Refund Requested": ["Refund Success", "Cancelled"],
  "Refund Success": [],
  Cancelled: [],
};

// Validation middleware for order creation
const validateCreateOrder = [
  body("cart")
    .isArray({ min: 1 })
    .withMessage("Cart must be a non-empty array"),
  body("cart.*.itemType")
    .isIn(["Product", "Course"])
    .withMessage("Invalid itemType, must be Product or Course"),
  body("cart.*.itemId").isMongoId().withMessage("Invalid itemId"),
  body("cart.*.quantity")
    .isInt({ min: 1 })
    .withMessage("Quantity must be at least 1"),
  body("cart.*.shopId").optional().isMongoId().withMessage("Invalid shopId"),
  body("cart.*.instructorId")
    .optional()
    .isMongoId()
    .withMessage("Invalid instructorId"),
  body("totalAmount")
    .isFloat({ min: 0 })
    .withMessage("Valid total amount is required"),
  body("taxAmount")
    .optional()
    .isFloat({ min: 0 })
    .withMessage("Tax amount must be non-negative"),
  body("discountAmount")
    .optional()
    .isFloat({ min: 0 })
    .withMessage("Discount amount must be non-negative"),
  body("paymentStatus")
    .optional()
    .isIn(["Pending", "Paid"])
    .withMessage("Invalid paymentStatus"),
  body("shippingAddress")
    .optional()
    .custom((value, { req }) => {
      if (
        req.body.cart.some((item) => item.itemType === "Product") &&
        (!value ||
          !value.address ||
          !value.city ||
          !value.country ||
          !value.zipCode)
      ) {
        throw new Error(
          "Complete shipping address is required for physical products"
        );
      }
      return true;
    }),
  body("currency")
    .optional()
    .isIn(["USD", "CAD", "EUR"])
    .withMessage("Unsupported currency"),
];

// Create new order
router.post(
  "/create-order",
  isAuthenticated,
  validateCreateOrder,
  catchAsyncErrors(async (req, res, next) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new ErrorHandler(errors.array()[0].msg, 400);
      }

      const {
        cart,
        shippingAddress,
        totalAmount,
        taxAmount = 0,
        discountAmount = 0,
        paymentStatus = "Pending",
        currency = shippingAddress?.country === "Canada" ? "CAD" : "USD",
      } = req.body;

      // Group items by shopId or instructorId
      const shopItemsMap = new Map();
      const instructorItemsMap = new Map();
      let calculatedTotal = 0;

      for (const item of cart) {
        if (item.itemType === "Product") {
          const product = await Product.findById(item.itemId)
            .select("name price priceDiscount stock shop status shipping")
            .session(session);
          if (!product) {
            throw new ErrorHandler(`Product not found: ${item.itemId}`, 404);
          }
          if (!product.shop) {
            throw new ErrorHandler(
              `Product ${item.itemId} has no associated shop`,
              400
            );
          }
          if (item.shopId && product.shop._id.toString() !== item.shopId) {
            throw new ErrorHandler(
              `Product ${item.itemId} does not belong to shop ${item.shopId}`,
              400
            );
          }
          if (product.stock < item.quantity) {
            throw new ErrorHandler(
              `Insufficient stock for product: ${product.name}`,
              400
            );
          }
          if (!["active", "publish"].includes(product.status)) {
            throw new ErrorHandler(
              `Product is not active: ${product.name}`,
              400
            );
          }

          const shopId = product.shop._id.toString();
          if (!shopItemsMap.has(shopId)) {
            shopItemsMap.set(shopId, []);
          }
          const price = product.priceDiscount || product.price;
          const discountApplied = product.priceDiscount
            ? product.price - product.priceDiscount
            : 0;
          shopItemsMap.get(shopId).push({
            itemType: "Product",
            itemId: item.itemId,
            name: product.name,
            quantity: item.quantity,
            price,
            discountApplied,
          });
          calculatedTotal +=
            price * item.quantity + (product.shipping?.cost || 0);

          // Update product stock and sold_out
          product.stock -= item.quantity;
          product.sold_out = (product.sold_out || 0) + item.quantity;
          await product.save({ session, validateBeforeSave: false });
          logger.debug("create-order: Product stock updated", {
            productId: item.itemId,
            name: product.name,
            quantity: item.quantity,
            newStock: product.stock,
            newSoldOut: product.sold_out,
          });
        } else if (item.itemType === "Course") {
          const course = await Course.findById(item.itemId)
            .select("title price discountPrice instructor status")
            .session(session);
          if (!course) {
            throw new ErrorHandler(`Course not found: ${item.itemId}`, 404);
          }
          if (!course.instructor) {
            throw new ErrorHandler(
              `Course ${item.itemId} has no associated instructor`,
              400
            );
          }
          if (
            item.instructorId &&
            course.instructor.toString() !== item.instructorId
          ) {
            throw new ErrorHandler(
              `Course ${item.itemId} does not belong to instructor ${item.instructorId}`,
              400
            );
          }
          if (course.status !== "Published") {
            throw new ErrorHandler(
              `Course is not published: ${course.title}`,
              400
            );
          }

          const instructorId = course.instructor.toString();
          if (!instructorItemsMap.has(instructorId)) {
            instructorItemsMap.set(instructorId, []);
          }
          const price = course.discountPrice || course.price;
          const discountApplied = course.discountPrice
            ? course.price - course.discountPrice
            : 0;
          instructorItemsMap.get(instructorId).push({
            itemType: "Course",
            itemId: item.itemId,
            name: course.title,
            quantity: item.quantity,
            price,
            discountApplied,
          });
          calculatedTotal += price * item.quantity;
        }
      }

      // Validate totalAmount
      const expectedTotal = calculatedTotal + taxAmount - discountAmount;
      if (Math.abs(expectedTotal - totalAmount) > 0.01) {
        throw new ErrorHandler(
          `Total amount mismatch. Expected: ${expectedTotal}, Received: ${totalAmount}`,
          400
        );
      }

      const orders = [];
      let paymentIntent = null;
      let ephemeralKey = null;

      // Create payment intent if paymentStatus is Pending
      if (paymentStatus === "Pending") {
        const user = await User.findById(req.user._id).session(session);
        if (!user) {
          throw new ErrorHandler("User not found", 404);
        }

        let customerId = user.stripeCustomerId;
        if (!customerId) {
          const customer = await stripe.customers.create({
            email: user.email,
            name: user.name,
            metadata: { userId: user._id.toString() },
          });
          customerId = customer.id;
          await User.findByIdAndUpdate(
            user._id,
            { stripeCustomerId: customerId },
            { session, new: true }
          );
        }

        // Create ephemeral key for client-side payment
        ephemeralKey = await stripe.ephemeralKeys.create(
          { customer: customerId },
          { apiVersion: "2023-10-16" }
        );

        paymentIntent = await stripe.paymentIntents.create({
          amount: Math.round(totalAmount * 100),
          currency,
          customer: customerId,
          automatic_payment_methods: { enabled: true },
          metadata: {
            company: "BlackandSell",
            userId: user._id.toString(),
          },
          description: `Payment for order creation`,
          receipt_email: user.email,
        });

        logger.info("create-order: Payment intent created", {
          paymentIntentId: paymentIntent.id,
          userId: user._id,
          customerId,
          currency,
        });
      }

      // Shop orders
      for (const [shopId, items] of shopItemsMap) {
        const shop = await Shop.findById(shopId).session(session);
        if (!shop) {
          throw new ErrorHandler(`Shop not found: ${shopId}`, 404);
        }
        if (!shop.isVerified) {
          throw new ErrorHandler(`Shop is not verified: ${shopId}`, 403);
        }

        const orderTotal = items.reduce(
          (sum, item) => sum + item.price * item.quantity,
          0
        );
        const orderTax = (orderTotal / calculatedTotal) * taxAmount;
        const orderDiscount = (orderTotal / calculatedTotal) * discountAmount;

        const order = new Order({
          shop: shopId,
          customer: req.user._id,
          items,
          totalAmount: orderTotal,
          taxAmount: orderTax,
          discountAmount: orderDiscount,
          paymentInfo: paymentIntent
            ? {
                id: paymentIntent.id,
                status:
                  paymentIntent.status === "requires_payment_method"
                    ? "Pending"
                    : paymentIntent.status,
                type: "card",
              }
            : {
                status: paymentStatus,
              },
          shippingAddress,
          status: "Pending",
          statusHistory: [
            {
              status: "Pending",
              updatedBy: req.user._id.toString(),
              updatedByModel: "User",
              reason: "Order created",
            },
          ],
        });

        await order.save({ session });
        orders.push(order);

        // Update shop balance if Paid
        if (paymentStatus === "Paid") {
          const serviceCharge = order.totalAmount * 0.1;
          const shopAmount = order.totalAmount - serviceCharge;
          shop.availableBalance = (shop.availableBalance || 0) + shopAmount;
          shop.transactions.push({
            amount: shopAmount,
            type: "Deposit",
            status: "Succeeded",
            createdAt: new Date(),
            metadata: { orderId: order._id, source: "Order Payment" },
          });
          await shop.save({ session });
          logger.debug("create-order: Shop balance updated", {
            shopId,
            orderId: order._id,
            added: shopAmount,
          });
        }

        // Send email to seller
        try {
          await sendMail({
            email: shop.email,
            subject: `New Order #${order._id}`,
            message: `Dear ${
              shop.name
            },\n\nA new order has been placed.\nOrder ID: ${
              order._id
            }\nTotal: $${order.totalAmount.toFixed(
              2
            )} (${currency})\nItems:\n${items
              .map(
                (item) =>
                  `- ${item.name} (Qty: ${
                    item.quantity
                  }, Price: $${item.price.toFixed(2)})`
              )
              .join(
                "\n"
              )}\n\nProcess the order in your dashboard.\n\nBest regards,\nBlackandSell`,
          });
          logger.info("create-order: Email sent to seller", {
            shopId,
            orderId: order._id,
            email: shop.email,
          });
        } catch (emailError) {
          logger.error("create-order: Failed to send seller email", {
            shopId,
            orderId: order._id,
            error: emailError.message,
          });
        }

        logger.info("create-order: Shop order created", {
          orderId: order._id,
          shopId,
          totalAmount: orderTotal,
          currency,
        });
      }

      // Instructor orders
      for (const [instructorId, items] of instructorItemsMap) {
        const instructor = await Instructor.findById(instructorId).session(
          session
        );
        if (!instructor) {
          throw new ErrorHandler(`Instructor not found: ${instructorId}`, 404);
        }
        if (
          !instructor.isVerified ||
          !instructor.approvalStatus.isInstructorApproved
        ) {
          throw new ErrorHandler(
            `Instructor not verified: ${instructorId}`,
            403
          );
        }

        const orderTotal = items.reduce(
          (sum, item) => sum + item.price * item.quantity,
          0
        );
        const orderTax = (orderTotal / calculatedTotal) * taxAmount;
        const orderDiscount = (orderTotal / calculatedTotal) * discountAmount;

        const order = new Order({
          instructor: instructorId,
          customer: req.user._id,
          items,
          totalAmount: orderTotal,
          taxAmount: orderTax,
          discountAmount: orderDiscount,
          paymentInfo: paymentIntent
            ? {
                id: paymentIntent.id,
                status:
                  paymentIntent.status === "requires_payment_method"
                    ? "Pending"
                    : paymentIntent.status,
                type: "card",
              }
            : {
                status: paymentStatus,
              },
          status: "Confirmed",
          statusHistory: [
            {
              status: "Confirmed",
              updatedBy: req.user._id.toString(),
              updatedByModel: "User",
              reason: "Course order created",
            },
          ],
        });

        await order.save({ session });
        orders.push(order);

        // Create enrollments
        for (const item of items) {
          const course = await Course.findById(item.itemId).session(session);
          if (!course) {
            throw new ErrorHandler(`Course not found: ${item.itemId}`, 404);
          }
          const existingEnrollment = await Enrollment.findOne({
            user: req.user._id,
            course: item.itemId,
          }).session(session);
          if (!existingEnrollment) {
            const enrollment = new Enrollment({
              user: req.user._id,
              course: item.itemId,
              instructor: instructorId,
              progress: course.content.flatMap((section) =>
                section.lectures.map((lecture) => ({
                  lectureId: lecture._id,
                  completed: false,
                }))
              ),
            });
            await enrollment.save({ session });
            course.enrollmentCount += item.quantity;
            await course.save({ session });
          }
        }

        // Update instructor balance if Paid
        if (paymentStatus === "Paid") {
          const serviceCharge = order.totalAmount * 0.1;
          const instructorAmount = order.totalAmount - serviceCharge;
          instructor.availableBalance =
            (instructor.availableBalance || 0) + instructorAmount;
          instructor.transactions.push({
            amount: instructorAmount,
            type: "Deposit",
            status: "Succeeded",
            createdAt: new Date(),
            metadata: { orderId: order._id, source: "Order Payment" },
          });
          await instructor.save({ session });
        }

        // Send email to instructor
        try {
          await sendMail({
            email: instructor.email,
            subject: `New Course Order #${order._id}`,
            message: `Dear ${
              instructor.fullname.firstName
            },\n\nA new course order has been placed.\nOrder ID: ${
              order._id
            }\nTotal: $${order.totalAmount.toFixed(
              2
            )} (${currency})\nItems:\n${items
              .map(
                (item) =>
                  `- ${item.name} (Qty: ${
                    item.quantity
                  }, Price: $${item.price.toFixed(2)})`
              )
              .join(
                "\n"
              )}\n\nReview details in your dashboard.\n\nBest regards,\nBlackandSell`,
          });
          logger.info("create-order: Email sent to instructor", {
            instructorId,
            orderId: order._id,
            email: instructor.email,
          });
        } catch (emailError) {
          logger.error("create-order: Failed to send instructor email", {
            instructorId,
            orderId: order._id,
            error: emailError.message,
          });
        }

        logger.info("create-order: Course order created", {
          orderId: order._id,
          instructorId,
          totalAmount: orderTotal,
          currency,
        });
      }

      await session.commitTransaction();

      res.status(201).json({
        success: true,
        orders,
        paymentIntent: paymentIntent
          ? {
              clientSecret: paymentIntent.client_secret,
              paymentIntentId: paymentIntent.id,
              ephemeralKey: ephemeralKey.secret,
              customerId: paymentIntent.customer,
            }
          : null,
      });
    } catch (error) {
      await session.abortTransaction();
      logger.error("create-order error", {
        message: error.message,
        stack: error.stack,
        userId: req.user?._id,
      });
      return next(new ErrorHandler(error.message, error.statusCode || 500));
    } finally {
      session.endSession();
    }
  })
);

// Get single order (seller or instructor)
router.get(
  "/get-single-order/:id",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const order = await Order.findById(req.params.id)
        .populate("shop", "name email")
        .populate("instructor", "fullname email")
        .populate(
          "customer",
          "username fullname.firstName fullname.lastName email"
        );

      if (!order) {
        return next(new ErrorHandler("Order not found", 404));
      }
      if (
        order.customer._id.toString() !== req.user._id.toString() &&
        (!req.seller ||
          order.shop?._id.toString() !== req.seller._id.toString()) &&
        (!req.instructor ||
          order.instructor?._id.toString() !== req.instructor._id.toString())
      ) {
        return next(new ErrorHandler("Unauthorized to access this order", 403));
      }

      logger.info("get-single-order: Order retrieved", {
        orderId: req.params.id,
        userId: req.user._id,
        shopId: req.seller?._id,
        instructorId: req.instructor?._id,
      });

      res.status(200).json({
        success: true,
        order,
      });
    } catch (error) {
      logger.error("get-single-order error", {
        message: error.message,
        stack: error.stack,
        orderId: req.params.id,
      });
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Get all orders of user
router.get(
  "/get-all-orders/:userId",
  isAuthenticated,
  [
    param("userId").isMongoId().withMessage("Invalid user ID"),
    query("status")
      .optional()
      .isIn([
        "Pending",
        "Confirmed",
        "Shipped",
        "Delivered",
        "Cancelled",
        "Refund Requested",
        "Refund Success",
      ])
      .withMessage("Invalid status"),
    query("page")
      .optional()
      .isInt({ min: 1 })
      .withMessage("Invalid page number"),
    query("limit").optional().isInt({ min: 1 }).withMessage("Invalid limit"),
    query("sortBy")
      .optional()
      .isIn(["createdAt", "totalAmount", "status"])
      .withMessage("Invalid sortBy field"),
    query("sortOrder")
      .optional()
      .isIn(["asc", "desc"])
      .withMessage("Invalid sortOrder"),
  ],
  catchAsyncErrors(async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return next(new ErrorHandler(errors.array()[0].msg, 400));
      }

      if (
        req.user._id.toString() !== req.params.userId &&
        req.user.role !== "admin"
      ) {
        return next(
          new ErrorHandler("Unauthorized to access these orders", 403)
        );
      }

      const {
        status,
        page = 1,
        limit = 10,
        sortBy = "createdAt",
        sortOrder = "desc",
      } = req.query;
      const query = { customer: req.params.userId };
      if (status) query.status = status;

      const sort = {};
      sort[sortBy] = sortOrder === "asc" ? 1 : -1;

      const orders = await Order.find(query)
        .sort(sort)
        .skip((page - 1) * limit)
        .limit(Number(limit))
        .populate("shop", "name email")
        .populate("instructor", "fullname email")
        .populate(
          "customer",
          "username fullname.firstName fullname.lastName email"
        );

      const total = await Order.countDocuments(query);

      logger.info("get-all-orders: Orders retrieved", {
        userId: req.params.userId,
        orderCount: orders.length,
        page,
        limit,
        status,
      });

      res.status(200).json({
        success: true,
        orders,
        total,
        page: Number(page),
        pages: Math.ceil(total / limit),
      });
    } catch (error) {
      logger.error("get-all-orders error", {
        message: error.message,
        stack: error.stack,
        userId: req.params.userId,
      });
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Get all orders of seller
router.get(
  "/get-seller-all-orders/:shopId",
  isSeller,
  [
    param("shopId").isMongoId().withMessage("Invalid shop ID"),
    query("status")
      .optional()
      .isIn([
        "Pending",
        "Confirmed",
        "Shipped",
        "Delivered",
        "Cancelled",
        "Refund Requested",
        "Refund Success",
      ])
      .withMessage("Invalid status"),
    query("page")
      .optional()
      .isInt({ min: 1 })
      .withMessage("Invalid page number"),
    query("limit").optional().isInt({ min: 1 }).withMessage("Invalid limit"),
    query("startDate").optional().isISO8601().withMessage("Invalid startDate"),
    query("endDate").optional().isISO8601().withMessage("Invalid endDate"),
    query("sortBy")
      .optional()
      .isIn(["createdAt", "totalAmount", "status"])
      .withMessage("Invalid sortBy field"),
    query("sortOrder")
      .optional()
      .isIn(["asc", "desc"])
      .withMessage("Invalid sortOrder"),
  ],
  catchAsyncErrors(async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return next(new ErrorHandler(errors.array()[0].msg, 400));
      }

      if (req.seller._id.toString() !== req.params.shopId) {
        return next(
          new ErrorHandler("Unauthorized to access these orders", 403)
        );
      }

      const {
        status,
        page = 1,
        limit = 10,
        startDate,
        endDate,
        sortBy = "createdAt",
        sortOrder = "desc",
      } = req.query;
      const query = { shop: req.params.shopId };
      if (status) query.status = status;
      if (startDate || endDate) {
        query.createdAt = {};
        if (startDate) query.createdAt.$gte = new Date(startDate);
        if (endDate) query.createdAt.$lte = new Date(endDate);
      }

      const sort = {};
      sort[sortBy] = sortOrder === "asc" ? 1 : -1;

      const orders = await Order.find(query)
        .sort(sort)
        .skip((page - 1) * limit)
        .limit(Number(limit))
        .populate("shop", "name email")
        .populate(
          "customer",
          "username fullname.firstName fullname.lastName email"
        );

      const total = await Order.countDocuments(query);

      logger.info("get-seller-all-orders: Orders retrieved", {
        shopId: req.params.shopId,
        orderCount: orders.length,
        page,
        limit,
        status,
        startDate,
        endDate,
      });

      res.status(200).json({
        success: true,
        orders,
        total,
        page: Number(page),
        pages: Math.ceil(total / limit),
      });
    } catch (error) {
      logger.error("get-seller-all-orders error", {
        message: error.message,
        stack: error.stack,
        shopId: req.params.shopId,
      });
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Get all orders of instructor
router.get(
  "/get-instructor-all-orders/:instructorId",
  isInstructor,
  [
    param("instructorId").isMongoId().withMessage("Invalid instructor ID"),
    query("status")
      .optional()
      .isIn([
        "Pending",
        "Confirmed",
        "Shipped",
        "Delivered",
        "Cancelled",
        "Refund Requested",
        "Refund Success",
      ])
      .withMessage("Invalid status"),
    query("page")
      .optional()
      .isInt({ min: 1 })
      .withMessage("Invalid page number"),
    query("limit").optional().isInt({ min: 1 }).withMessage("Invalid limit"),
    query("startDate").optional().isISO8601().withMessage("Invalid startDate"),
    query("endDate").optional().isISO8601().withMessage("Invalid endDate"),
    query("sortBy")
      .optional()
      .isIn(["createdAt", "totalAmount", "status"])
      .withMessage("Invalid sortBy field"),
    query("sortOrder")
      .optional()
      .isIn(["asc", "desc"])
      .withMessage("Invalid sortOrder"),
  ],
  catchAsyncErrors(async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return next(new ErrorHandler(errors.array()[0].msg, 400));
      }

      if (req.instructor._id.toString() !== req.params.instructorId) {
        return next(
          new ErrorHandler("Unauthorized to access these orders", 403)
        );
      }

      const {
        status,
        page = 1,
        limit = 10,
        startDate,
        endDate,
        sortBy = "createdAt",
        sortOrder = "desc",
      } = req.query;
      const query = { instructor: req.params.instructorId };
      if (status) query.status = status;
      if (startDate || endDate) {
        query.createdAt = {};
        if (startDate) query.createdAt.$gte = new Date(startDate);
        if (endDate) query.createdAt.$lte = new Date(endDate);
      }

      const sort = {};
      sort[sortBy] = sortOrder === "asc" ? 1 : -1;

      const orders = await Order.find(query)
        .sort(sort)
        .skip((page - 1) * limit)
        .limit(Number(limit))
        .populate("instructor", "fullname email")
        .populate(
          "customer",
          "username fullname.firstName fullname.lastName email"
        );

      const total = await Order.countDocuments(query);

      logger.info("get-instructor-all-orders: Orders retrieved", {
        instructorId: req.params.instructorId,
        orderCount: orders.length,
        page,
        limit,
        status,
        startDate,
        endDate,
      });

      res.status(200).json({
        success: true,
        orders,
        total,
        page: Number(page),
        pages: Math.ceil(total / limit),
      });
    } catch (error) {
      logger.error("get-instructor-all-orders error", {
        message: error.message,
        stack: error.stack,
        instructorId: req.params.instructorId,
      });
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Update order status for seller
router.put(
  "/update-order-status/:id",
  isSeller,
  [
    param("id").isMongoId().withMessage("Invalid order ID"),
    body("status")
      .isIn([
        "Confirmed",
        "Shipped",
        "Delivered",
        "Cancelled",
        "Refund Requested",
        "Refund Success",
      ])
      .withMessage("Invalid status"),
    body("reason")
      .optional()
      .isString()
      .trim()
      .withMessage("Reason must be a string"),
  ],
  catchAsyncErrors(async (req, res, next) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return next(new ErrorHandler(errors.array()[0].msg, 400));
      }

      const { status, reason } = req.body;
      const order = await Order.findById(req.params.id)
        .populate("shop customer")
        .session(session);

      if (!order) {
        throw new ErrorHandler("Order not found", 404);
      }
      if (
        !order.shop ||
        order.shop._id.toString() !== req.seller._id.toString()
      ) {
        throw new ErrorHandler(
          "Unauthorized: Order does not belong to your shop",
          403
        );
      }
      if (!STATUS_TRANSITIONS[order.status].includes(status)) {
        throw new ErrorHandler(
          `Invalid status transition from ${order.status} to ${status}`,
          400
        );
      }

      if (status === "Cancelled") {
        for (const item of order.items) {
          if (item.itemType === "Product") {
            const product = await Product.findById(item.itemId).session(
              session
            );
            if (product) {
              product.stock += item.quantity;
              product.sold_out = Math.max(
                0,
                (product.sold_out || 0) - item.quantity
              );
              await product.save({ session });
              logger.debug("update-order-status: Product stock restored", {
                productId: item.itemId,
                quantity: item.quantity,
                newStock: product.stock,
              });
            }
          }
        }
      }

      order.status = status;
      order.statusHistory.push({
        status,
        updatedBy: req.seller._id.toString(),
        updatedByModel: "Seller",
        reason: reason || `Status updated to ${status}`,
      });

      await order.save({ session });

      // Send email to customer
      try {
        await sendMail({
          email: order.customer.email,
          subject: `Order Update #${order._id}`,
          message: `Dear ${
            order.customer.username || "Customer"
          },\n\nYour order has been updated.\nOrder ID: ${
            order._id
          }\nStatus: ${status}\nTotal: $${order.totalAmount.toFixed(2)}\n${
            reason ? `Reason: ${reason}\n` : ""
          }Items:\n${order.items
            .map(
              (item) =>
                `- ${item.name} (Qty: ${
                  item.quantity
                }, Price: $${item.price.toFixed(2)})`
            )
            .join(
              "\n"
            )}\n\nView details in your account.\n\nBest regards,\nBlackandSell`,
        });
        logger.info("update-order-status: Email sent to customer", {
          orderId: order._id,
          customerId: order.customer._id,
          status,
        });
      } catch (emailError) {
        logger.error("update-order-status: Failed to send customer email", {
          orderId: order._id,
          error: emailError.message,
        });
      }

      await session.commitTransaction();
      logger.info("update-order-status: Order updated", {
        orderId: order._id,
        shopId: req.seller._id,
        newStatus: status,
      });

      res.status(200).json({
        success: true,
        order,
      });
    } catch (error) {
      await session.abortTransaction();
      logger.error("update-order-status error", {
        message: error.message,
        stack: error.stack,
        orderId: req.params.id,
        shopId: req.seller?._id,
      });
      return next(new ErrorHandler(error.message, error.statusCode || 500));
    } finally {
      session.endSession();
    }
  })
);

// Update order status for instructor
router.put(
  "/update-course-order-status/:id",
  isInstructor,
  [
    param("id").isMongoId().withMessage("Invalid order ID"),
    body("status")
      .isIn(["Confirmed", "Cancelled", "Refund Requested", "Refund Success"])
      .withMessage("Invalid status for course order"),
    body("reason")
      .optional()
      .isString()
      .trim()
      .withMessage("Reason must be a string"),
  ],
  catchAsyncErrors(async (req, res, next) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return next(new ErrorHandler(errors.array()[0].msg, 400));
      }

      const { status, reason } = req.body;
      const order = await Order.findById(req.params.id)
        .populate("instructor customer")
        .session(session);

      if (!order) {
        throw new ErrorHandler("Order not found", 404);
      }
      if (
        !order.instructor ||
        order.instructor._id.toString() !== req.instructor._id.toString()
      ) {
        throw new ErrorHandler(
          "Unauthorized: Order does not belong to your courses",
          403
        );
      }
      if (!STATUS_TRANSITIONS[order.status].includes(status)) {
        throw new ErrorHandler(
          `Invalid status transition from ${order.status} to ${status}`,
          400
        );
      }

      if (status === "Cancelled" || status === "Refund Requested") {
        for (const item of order.items) {
          if (item.itemType === "Course") {
            const enrollment = await Enrollment.findOne({
              user: order.customer._id,
              course: item.itemId,
            }).session(session);
            if (enrollment) {
              enrollment.status = "Dropped";
              await enrollment.save({ session });
            }
            const course = await Course.findById(item.itemId).session(session);
            if (course) {
              course.enrollmentCount = Math.max(
                0,
                course.enrollmentCount - item.quantity
              );
              await course.save({ session });
            }
          }
        }
      }

      order.status = status;
      order.statusHistory.push({
        status,
        updatedBy: req.instructor._id.toString(),
        updatedByModel: "Instructor",
        reason: reason || `Status updated to ${status}`,
      });

      await order.save({ session });

      // Send email to customer
      try {
        await sendMail({
          email: order.customer.email,
          subject: `Course Order Update #${order._id}`,
          message: `Dear ${
            order.customer.username || "Customer"
          },\n\nYour course order has been updated.\nOrder ID: ${
            order._id
          }\nStatus: ${status}\nTotal: $${order.totalAmount.toFixed(2)}\n${
            reason ? `Reason: ${reason}\n` : ""
          }Items:\n${order.items
            .map(
              (item) =>
                `- ${item.name} (Qty: ${
                  item.quantity
                }, Price: $${item.price.toFixed(2)})`
            )
            .join(
              "\n"
            )}\n\nView details in your account.\n\nBest regards,\nBlackandSell`,
        });
        logger.info("update-course-order-status: Email sent to customer", {
          orderId: order._id,
          customerId: order.customer._id,
          status,
        });
      } catch (emailError) {
        logger.error(
          "update-course-order-status: Failed to send customer email",
          {
            orderId: order._id,
            error: emailError.message,
          }
        );
      }

      await session.commitTransaction();
      logger.info("update-course-order-status: Order updated", {
        orderId: order._id,
        instructorId: req.instructor._id,
        newStatus: status,
      });

      res.status(200).json({
        success: true,
        order,
      });
    } catch (error) {
      await session.abortTransaction();
      logger.error("update-course-order-status error", {
        message: error.message,
        stack: error.stack,
        orderId: req.params.id,
        instructorId: req.instructor?._id,
      });
      return next(new ErrorHandler(error.message, error.statusCode || 500));
    } finally {
      session.endSession();
    }
  })
);

// Request refund (user)
router.post(
  "/order-refund/:id",
  isAuthenticated,
  [
    param("id").isMongoId().withMessage("Invalid order ID"),
    body("reason").notEmpty().withMessage("Refund reason is required"),
    body("amount")
      .optional()
      .isFloat({ min: 0 })
      .withMessage("Refund amount must be non-negative"),
  ],
  catchAsyncErrors(async (req, res, next) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return next(new ErrorHandler(errors.array()[0].msg, 400));
      }

      const { reason, amount } = req.body;
      const order = await Order.findById(req.params.id)
        .populate("shop instructor customer")
        .session(session);

      if (!order) {
        throw new ErrorHandler("Order not found", 404);
      }
      if (order.customer._id.toString() !== req.user._id.toString()) {
        throw new ErrorHandler(
          "Unauthorized to request refund for this order",
          403
        );
      }
      if (!["Delivered", "Confirmed"].includes(order.status)) {
        throw new ErrorHandler(
          "Refunds can only be requested for delivered or confirmed orders",
          400
        );
      }
      if (!order.paymentInfo?.id) {
        throw new ErrorHandler("No payment information found", 400);
      }

      const refundAmount = amount
        ? Math.min(amount, order.totalAmount)
        : order.totalAmount;
      if (refundAmount <= 0) {
        throw new ErrorHandler("Refund amount must be greater than 0", 400);
      }

      const refund = await stripe.refunds.create({
        payment_intent: order.paymentInfo.id,
        amount: Math.round(refundAmount * 100),
        reason: "requested_by_customer",
        metadata: {
          orderId: order._id.toString(),
          userId: req.user._id.toString(),
          refundReason: reason,
        },
      });

      order.status = "Refund Requested";
      order.refundHistory.push({
        refundId: refund.id,
        amount: refundAmount,
        reason,
        status: "Requested",
      });
      order.statusHistory.push({
        status: "Refund Requested",
        updatedBy: req.user._id.toString(),
        updatedByModel: "User",
        reason,
      });

      await order.save({ session });

      // Send email to customer
      try {
        await sendMail({
          email: order.customer.email,
          subject: `Refund Request Submitted #${order._id}`,
          message: `Dear ${
            order.customer.username || "Customer"
          },\n\nYour refund request has been submitted.\nOrder ID: ${
            order._id
          }\nRefund Amount: $${refundAmount.toFixed(
            2
          )}\nReason: ${reason}\n\nWe will review your request soon.\n\nBest regards,\nBlackandSell`,
        });
        logger.info("order-refund: Email sent to customer", {
          orderId: order._id,
          customerId: order.customer._id,
        });
      } catch (emailError) {
        logger.error("order-refund: Failed to send customer email", {
          orderId: order._id,
          error: emailError.message,
        });
      }

      // Notify seller or instructor
      try {
        const recipient = order.shop || order.instructor;
        const recipientName = order.shop
          ? order.shop.name
          : `${order.instructor.fullname.firstName} ${order.instructor.fullname.lastName}`;
        await sendMail({
          email: recipient.email,
          subject: `Refund Request Received #${order._id}`,
          message: `Dear ${recipientName},\n\nA refund request has been submitted.\nOrder ID: ${
            order._id
          }\nRefund Amount: $${refundAmount.toFixed(
            2
          )}\nReason: ${reason}\nItems:\n${order.items
            .map(
              (item) =>
                `- ${item.name} (Qty: ${
                  item.quantity
                }, Price: $${item.price.toFixed(2)})`
            )
            .join(
              "\n"
            )}\n\nPlease review in your dashboard.\n\nBest regards,\nBlackandSell`,
        });
        logger.info("order-refund: Email sent to recipient", {
          orderId: order._id,
          recipientId: recipient._id,
        });
      } catch (emailError) {
        logger.error("order-refund: Failed to send recipient email", {
          orderId: order._id,
          error: emailError.message,
        });
      }

      await session.commitTransaction();
      logger.info("order-refund: Refund requested", {
        orderId: order._id,
        refundId: refund.id,
        amount: refundAmount,
      });

      res.status(200).json({
        success: true,
        message: "Refund request processed successfully",
        refundId: refund.id,
        order,
      });
    } catch (error) {
      await session.abortTransaction();
      logger.error("order-refund error", {
        message: error.message,
        stack: error.stack,
        orderId: req.params.id,
      });
      return next(new ErrorHandler(error.message, error.statusCode || 500));
    } finally {
      session.endSession();
    }
  })
);

// Approve or reject refund (seller or instructor)
router.put(
  "/order-refund-success/:id",
  catchAsyncErrors(async (req, res, next) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const { status, reason, refundId } = req.body;
      const order = await Order.findById(req.params.id)
        .populate("shop instructor customer")
        .session(session);

      if (!order) {
        throw new ErrorHandler("Order not found", 404);
      }
      if (!["Approved", "Rejected"].includes(status)) {
        throw new ErrorHandler("Invalid refund status", 400);
      }
      if (order.status !== "Refund Requested") {
        throw new ErrorHandler(
          "Order must be in 'Refund Requested' status",
          400
        );
      }
      if (
        order.shop &&
        (!req.seller || order.shop._id.toString() !== req.seller._id.toString())
      ) {
        throw new ErrorHandler(
          "Unauthorized: Order does not belong to your shop",
          403
        );
      }
      if (
        order.instructor &&
        (!req.instructor ||
          order.instructor._id.toString() !== req.instructor._id.toString())
      ) {
        throw new ErrorHandler(
          "Unauthorized: Order does not belong to your courses",
          403
        );
      }

      const refundRecord = order.refundHistory.find(
        (r) => r.refundId === refundId
      );
      if (!refundRecord) {
        throw new ErrorHandler("Refund request not found", 404);
      }

      refundRecord.status = status;
      refundRecord.processedAt = new Date();
      refundRecord.reason = reason || refundRecord.reason;

      if (status === "Approved") {
        order.status = "Refund Success";
        order.paymentInfo.status = "Refunded";
        for (const item of order.items) {
          if (item.itemType === "Product") {
            const product = await Product.findById(item.itemId).session(
              session
            );
            if (product) {
              product.stock += item.quantity;
              product.sold_out = Math.max(
                0,
                (product.sold_out || 0) - item.quantity
              );
              await product.save({ session });
              logger.debug("order-refund-success: Product stock restored", {
                productId: item.itemId,
                quantity: item.quantity,
                newStock: product.stock,
              });
            }
          } else if (item.itemType === "Course") {
            const enrollment = await Enrollment.findOne({
              user: order.customer._id,
              course: item.itemId,
            }).session(session);
            if (enrollment) {
              enrollment.status = "Dropped";
              await enrollment.save({ session });
            }
            const course = await Course.findById(item.itemId).session(session);
            if (course) {
              course.enrollmentCount = Math.max(
                0,
                course.enrollmentCount - item.quantity
              );
              await course.save({ session });
            }
          }
        }

        // Update balance
        if (order.shop) {
          const shop = await Shop.findById(order.shop._id).session(session);
          const serviceCharge = refundRecord.amount * 0.1;
          const shopAmount = refundRecord.amount - serviceCharge;
          shop.availableBalance = Math.max(
            0,
            (shop.availableBalance || 0) - shopAmount
          );
          shop.transactions.push({
            amount: -shopAmount,
            type: "Refund",
            status: "Succeeded",
            createdAt: new Date(),
            metadata: { orderId: order._id, source: "Refund Processed" },
          });
          await shop.save({ session });
        } else if (order.instructor) {
          const instructor = await Instructor.findById(
            order.instructor._id
          ).session(session);
          const serviceCharge = refundRecord.amount * 0.1;
          const instructorAmount = refundRecord.amount - serviceCharge;
          instructor.availableBalance = Math.max(
            0,
            (instructor.availableBalance || 0) - instructorAmount
          );
          instructor.transactions.push({
            amount: -instructorAmount,
            type: "Refund",
            status: "Succeeded",
            createdAt: new Date(),
            metadata: { orderId: order._id, source: "Refund Processed" },
          });
          await instructor.save({ session });
        }
      } else {
        order.status = "Delivered"; // Revert to Delivered if rejected
      }

      order.statusHistory.push({
        status: order.status,
        updatedBy: (req.seller || req.instructor)._id.toString(),
        updatedByModel: req.seller ? "Seller" : "Instructor",
        reason: reason || `Refund ${status.toLowerCase()}`,
      });

      await order.save({ session });

      // Send email to customer
      try {
        await sendMail({
          email: order.customer.email,
          subject: `Refund ${status} #${order._id}`,
          message: `Dear ${
            order.customer.username || "Customer"
          },\n\nYour refund request has been ${status.toLowerCase()}.\nOrder ID: ${
            order._id
          }\nRefund Amount: $${refundRecord.amount.toFixed(2)}\nReason: ${
            reason || "No reason provided"
          }\n\n${
            status === "Approved"
              ? "The amount will be processed soon."
              : "Contact support for more details."
          }\n\nBest regards,\nBlackandSell`,
        });
        logger.info("order-refund-success: Email sent to customer", {
          orderId: order._id,
          customerId: order.customer._id,
          refundStatus: status,
        });
      } catch (emailError) {
        logger.error("order-refund-success: Failed to send customer email", {
          orderId: order._id,
          error: emailError.message,
        });
      }

      await session.commitTransaction();
      logger.info("order-refund-success: Refund processed", {
        orderId: order._id,
        refundId,
        status,
      });

      res.status(200).json({
        success: true,
        message: `Refund request ${status.toLowerCase()} successfully`,
        order,
      });
    } catch (error) {
      await session.abortTransaction();
      logger.error("order-refund-success error", {
        message: error.message,
        stack: error.stack,
        orderId: req.params.id,
      });
      return next(new ErrorHandler(error.message, error.statusCode || 500));
    } finally {
      session.endSession();
    }
  })
);

// Delete order (seller)
router.delete(
  "/delete-order/:id",
  isSeller,
  [param("id").isMongoId().withMessage("Invalid order ID")],
  catchAsyncErrors(async (req, res, next) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return next(new ErrorHandler(errors.array()[0].msg, 400));
      }

      const order = await Order.findById(req.params.id)
        .populate("shop")
        .session(session);

      if (!order) {
        throw new ErrorHandler("Order not found", 404);
      }
      if (
        !order.shop ||
        order.shop._id.toString() !== req.seller._id.toString()
      ) {
        throw new ErrorHandler(
          "Unauthorized: Order does not belong to your shop",
          403
        );
      }
      if (!["Pending", "Cancelled"].includes(order.status)) {
        throw new ErrorHandler(
          "Only Pending or Cancelled orders can be deleted",
          400
        );
      }

      await Order.deleteOne({ _id: req.params.id }, { session });

      logger.info("delete-order: Order deleted", {
        orderId: req.params.id,
        shopId: req.seller._id,
        status: order.status,
      });

      await session.commitTransaction();

      res.status(200).json({
        success: true,
        message: "Order deleted successfully",
      });
    } catch (error) {
      await session.abortTransaction();
      logger.error("delete-order error", {
        message: error.message,
        stack: error.stack,
        orderId: req.params.id,
      });
      return next(new ErrorHandler(error.message, error.statusCode || 500));
    } finally {
      session.endSession();
    }
  })
);

// Get all orders (admin)
router.get(
  "/admin-all-orders",
  isAuthenticated,
  isAdmin("admin"),
  [
    query("status")
      .optional()
      .isIn([
        "Pending",
        "Confirmed",
        "Shipped",
        "Delivered",
        "Cancelled",
        "Refund Requested",
        "Refund Success",
      ])
      .withMessage("Invalid status"),
    query("page")
      .optional()
      .isInt({ min: 1 })
      .withMessage("Invalid page number"),
    query("limit").optional().isInt({ min: 1 }).withMessage("Invalid limit"),
    query("sortBy")
      .optional()
      .isIn(["createdAt", "totalAmount", "status"])
      .withMessage("Invalid sortBy field"),
    query("sortOrder")
      .optional()
      .isIn(["asc", "desc"])
      .withMessage("Invalid sortOrder"),
  ],
  catchAsyncErrors(async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return next(new ErrorHandler(errors.array()[0].msg, 400));
      }

      const {
        status,
        page = 1,
        limit = 10,
        sortBy = "createdAt",
        sortOrder = "desc",
      } = req.query;
      const query = status ? { status } : {};

      const sort = {};
      sort[sortBy] = sortOrder === "asc" ? 1 : -1;

      const orders = await Order.find(query)
        .sort(sort)
        .skip((page - 1) * limit)
        .limit(Number(limit))
        .populate("shop", "name email")
        .populate("instructor", "fullname email")
        .populate(
          "customer",
          "username fullname.firstName fullname.lastName email"
        );

      const total = await Order.countDocuments(query);

      logger.info("admin-all-orders: Orders retrieved", {
        orderCount: orders.length,
        page,
        limit,
        status,
      });

      res.status(200).json({
        success: true,
        orders,
        total,
        page: Number(page),
        pages: Math.ceil(total / limit),
      });
    } catch (error) {
      logger.error("admin-all-orders error", {
        message: error.message,
        stack: error.stack,
      });
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Get shop statistics
router.get(
  "/shop/stats/:shopId",
  isSeller,
  [param("shopId").isMongoId().withMessage("Invalid shop ID")],
  catchAsyncErrors(async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return next(new ErrorHandler(errors.array()[0].msg, 400));
      }

      if (req.seller._id.toString() !== req.params.shopId) {
        return next(
          new ErrorHandler("Unauthorized to access shop statistics", 403)
        );
      }

      const stats = await Order.aggregate([
        { $match: { shop: new mongoose.Types.ObjectId(req.params.shopId) } },
        {
          $facet: {
            totalSales: [
              { $match: { status: { $in: ["Delivered", "Refund Success"] } } },
              { $group: { _id: null, total: { $sum: "$totalAmount" } } },
            ],
            pendingOrders: [
              {
                $match: {
                  status: { $in: ["Pending", "Confirmed", "Shipped"] },
                },
              },
              { $count: "count" },
            ],
            refundRequests: [
              { $match: { status: "Refund Requested" } },
              { $count: "count" },
            ],
            totalOrders: [{ $count: "count" }],
            recentOrders: [
              {
                $match: {
                  createdAt: {
                    $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
                  },
                },
              },
              { $count: "count" },
            ],
          },
        },
      ]);

      const result = {
        totalSales: stats[0].totalSales[0]?.total || 0,
        pendingOrders: stats[0].pendingOrders[0]?.count || 0,
        refundRequests: stats[0].refundRequests[0]?.count || 0,
        totalOrders: stats[0].totalOrders[0]?.count || 0,
        recentOrders: stats[0].recentOrders[0]?.count || 0,
      };

      logger.info("shop-stats: Statistics retrieved", {
        shopId: req.params.shopId,
        stats: result,
      });

      res.status(200).json({
        success: true,
        stats: result,
      });
    } catch (error) {
      logger.error("shop-stats error", {
        message: error.message,
        stack: error.stack,
        shopId: req.params.shopId,
      });
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Get instructor statistics
router.get(
  "/instructor/stats/:instructorId",
  isInstructor,
  [param("instructorId").isMongoId().withMessage("Invalid instructor ID")],
  catchAsyncErrors(async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return next(new ErrorHandler(errors.array()[0].msg, 400));
      }

      if (req.instructor._id.toString() !== req.params.instructorId) {
        return next(
          new ErrorHandler("Unauthorized to access instructor statistics", 403)
        );
      }

      const stats = await Promise.all([
        Order.aggregate([
          {
            $match: {
              instructor: new mongoose.Types.ObjectId(req.params.instructorId),
            },
          },
          {
            $facet: {
              totalSales: [
                {
                  $match: { status: { $in: ["Confirmed", "Refund Success"] } },
                },
                { $group: { _id: null, total: { $sum: "$totalAmount" } } },
              ],
              refundRequests: [
                { $match: { status: "Refund Requested" } },
                { $count: "count" },
              ],
              totalOrders: [{ $count: "count" }],
              recentOrders: [
                {
                  $match: {
                    createdAt: {
                      $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
                    },
                  },
                },
                { $count: "count" },
              ],
            },
          },
        ]),
        Enrollment.aggregate([
          {
            $match: {
              instructor: new mongoose.Types.ObjectId(req.params.instructorId),
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
      ]);

      const result = {
        totalSales: stats[0][0].totalSales[0]?.total || 0,
        refundRequests: stats[0][0].refundRequests[0]?.count || 0,
        totalOrders: stats[0][0].totalOrders[0]?.count || 0,
        recentOrders: stats[0][0].recentOrders[0]?.count || 0,
        totalEnrollments: stats[1][0]?.totalEnrollments || 0,
        completedEnrollments: stats[1][0]?.completed || 0,
      };

      logger.info("instructor-stats: Statistics retrieved", {
        instructorId: req.params.instructorId,
        stats: result,
      });

      res.status(200).json({
        success: true,
        stats: result,
      });
    } catch (error) {
      logger.error("instructor-stats error", {
        message: error.message,
        stack: error.stack,
        instructorId: req.params.instructorId,
      });
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

module.exports = router;
