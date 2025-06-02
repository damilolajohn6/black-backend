const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();
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
const sendMail = require("../utils/sendMail");

// Valid status transitions aligned with Order schema
const STATUS_TRANSITIONS = {
  Pending: ["Confirmed", "Cancelled"],
  Confirmed: ["Shipped", "Cancelled"],
  Shipped: ["Delivered"],
  Delivered: ["Refunded"],
  Cancelled: [],
  Refunded: [],
};

// Create new order
router.post(
  "/create-order",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const {
        cart,
        shippingAddress,
        totalAmount,
        paymentStatus = "Paid",
      } = req.body;

      // Validate input
      if (!cart || !Array.isArray(cart) || cart.length === 0) {
        throw new ErrorHandler("Cart is required and cannot be empty", 400);
      }
      if (!totalAmount || totalAmount <= 0) {
        throw new ErrorHandler("Valid total amount is required", 400);
      }

      // Validate shippingAddress for physical products
      let hasPhysicalProducts = false;
      for (const item of cart) {
        if (item.itemType === "Product") {
          hasPhysicalProducts = true;
          break;
        }
      }
      if (
        hasPhysicalProducts &&
        (!shippingAddress ||
          !shippingAddress.address ||
          !shippingAddress.city ||
          !shippingAddress.country ||
          !shippingAddress.zipCode)
      ) {
        throw new ErrorHandler(
          "Complete shipping address is required for physical products",
          400
        );
      }

      // Group items by shopId or instructorId
      const shopItemsMap = new Map();
      const instructorItemsMap = new Map();
      let calculatedTotal = 0;

      for (const item of cart) {
        if (
          !item.itemType ||
          !item.itemId ||
          !item.quantity ||
          item.quantity < 1 ||
          !["Product", "Course"].includes(item.itemType)
        ) {
          throw new ErrorHandler(
            "Invalid cart item: itemType (Product or Course), itemId, and quantity are required",
            400
          );
        }
        if (!mongoose.Types.ObjectId.isValid(item.itemId)) {
          throw new ErrorHandler(`Invalid itemId: ${item.itemId}`, 400);
        }
        if (item.shopId && !mongoose.Types.ObjectId.isValid(item.shopId)) {
          throw new ErrorHandler(`Invalid shopId: ${item.shopId}`, 400);
        }
        if (
          item.instructorId &&
          !mongoose.Types.ObjectId.isValid(item.instructorId)
        ) {
          throw new ErrorHandler(
            `Invalid instructorId: ${item.instructorId}`,
            400
          );
        }

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
          shopItemsMap.get(shopId).push({
            itemType: "Product",
            itemId: item.itemId,
            name: product.name,
            quantity: item.quantity,
            price,
          });
          calculatedTotal +=
            price * item.quantity + (product.shipping?.cost || 0);

          // Update product stock and sold_out
          product.stock -= item.quantity;
          product.sold_out = (product.sold_out || 0) + item.quantity;
          await product.save({ session, validateBeforeSave: false });
          console.debug("create-order: Product stock updated", {
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
          instructorItemsMap.get(instructorId).push({
            itemType: "Course",
            itemId: item.itemId,
            name: course.title,
            quantity: item.quantity,
            price,
          });
          calculatedTotal += price * item.quantity;
        }
      }

      // Validate totalAmount
      if (Math.abs(calculatedTotal - totalAmount) > 0.01) {
        throw new ErrorHandler("Total amount does not match cart items", 400);
      }

      // Validate paymentStatus
      if (!["Pending", "Paid"].includes(paymentStatus)) {
        throw new ErrorHandler("Invalid paymentStatus", 400);
      }

      // Create orders
      const orders = [];

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

        const order = new Order({
          shop: shopId,
          customer: req.user._id,
          items,
          totalAmount: orderTotal,
          paymentStatus,
          shippingAddress,
          status: "Pending",
          statusHistory: [
            {
              status: "Pending",
              reason: "Order created",
              updatedAt: new Date(),
            },
          ],
        });

        await order.save({ session });

        // Update shop balance and transactions if paid
        if (paymentStatus === "Paid") {
          const serviceCharge = order.totalAmount * 0.1; // 10% platform fee
          const shopAmount = order.totalAmount - serviceCharge;

          // Normalize withdrawMethod.type if invalid
          if (shop.withdrawMethod && shop.withdrawMethod.type) {
            if (shop.withdrawMethod.type.toLowerCase() === "paypal") {
              shop.withdrawMethod.type = "PayPal";
              console.warn("create-order: Normalized withdrawMethod.type", {
                shopId,
                oldType: "paypal",
                newType: "PayPal",
              });
            }
            if (
              !["BankTransfer", "PayPal", "Other"].includes(
                shop.withdrawMethod.type
              )
            ) {
              console.warn(
                "create-order: Invalid withdrawMethod.type, unsetting",
                {
                  shopId,
                  invalidType: shop.withdrawMethod.type,
                }
              );
              shop.withdrawMethod = null;
            }
          }

          shop.availableBalance = (shop.availableBalance || 0) + shopAmount;
          shop.transactions.push({
            amount: shopAmount,
            type: "Deposit",
            status: "Succeeded",
            createdAt: new Date(),
            metadata: { orderId: order._id, source: "Order Payment" },
          });

          try {
            await shop.save({ session, validateBeforeSave: true });
            console.debug("create-order: Shop balance updated", {
              shopId,
              availableBalance: shop.availableBalance,
              added: shopAmount,
            });
          } catch (saveError) {
            console.error("create-order: Failed to save shop balance", {
              shopId,
              error: saveError.message,
            });
            console.warn(
              "create-order: Proceeding without balance update due to validation error",
              {
                shopId,
                orderId: order._id,
              }
            );
          }
        }

        // Send email to seller
        try {
          await sendMail({
            email: shop.email,
            subject: `New Order Received - Order #${order._id}`,
            message: `Dear ${
              shop.name
            },\n\nA new order has been placed.\n\nOrder ID: ${
              order._id
            }\nTotal: $${order.totalAmount.toFixed(2)}\nItems:\n${items
              .map(
                (item) =>
                  `- ${item.name} (Qty: ${
                    item.quantity
                  }, Price: $${item.price.toFixed(2)})`
              )
              .join(
                "\n"
              )}\n\nPlease process the order in your dashboard.\n\nBest regards,\nE-commerce Platform`,
          });
          console.info("create-order: Email sent to seller", {
            shopId,
            orderId: order._id,
            email: shop.email,
          });
        } catch (emailError) {
          console.error("create-order: Failed to send seller email", {
            shopId,
            orderId: order._id,
            error: emailError.message,
          });
        }

        orders.push(order);
        console.info("create-order: Shop order created", {
          orderId: order._id,
          shopId,
          customerId: req.user._id,
          totalAmount: orderTotal,
          paymentStatus,
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
            `Instructor is not verified or approved: ${instructorId}`,
            403
          );
        }

        const orderTotal = items.reduce(
          (sum, item) => sum + item.price * item.quantity,
          0
        );

        const order = new Order({
          instructor: instructorId,
          customer: req.user._id,
          items,
          totalAmount: orderTotal,
          paymentStatus,
          status: "Confirmed",
          statusHistory: [
            {
              status: "Confirmed",
              reason: "Course order created",
              updatedAt: new Date(),
            },
          ],
        });

        await order.save({ session });

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

        // Update instructor balance and transactions if paid
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
            subject: `New Course Order - Order #${order._id}`,
            message: `Dear ${
              instructor.fullname.firstName
            },\n\nA new course order has been placed.\n\nOrder ID: ${
              order._id
            }\nTotal: $${order.totalAmount.toFixed(2)}\nItems:\n${items
              .map(
                (item) =>
                  `- ${item.name} (Qty: ${
                    item.quantity
                  }, Price: $${item.price.toFixed(2)})`
              )
              .join(
                "\n"
              )}\n\nReview details in your dashboard.\n\nBest regards,\nE-commerce Platform`,
          });
          console.info("create-order: Email sent to instructor", {
            instructorId,
            orderId: order._id,
            email: instructor.email,
          });
        } catch (emailError) {
          console.error("create-order: Failed to send instructor email", {
            instructorId,
            orderId: order._id,
            error: emailError.message,
          });
        }

        orders.push(order);
        console.info("create-order: Course order created", {
          orderId: order._id,
          instructorId,
          customerId: req.user._id,
          totalAmount: orderTotal,
          paymentStatus,
        });
      }

      await session.commitTransaction();
      res.status(201).json({
        success: true,
        orders,
      });
    } catch (error) {
      await session.abortTransaction();
      console.error("create-order error:", {
        message: error.message,
        stack: error.stack,
        body: req.body,
        userId: req.user?._id,
      });
      return next(new ErrorHandler(error.message, error.statusCode || 500));
    } finally {
      session.endSession();
    }
  })
);

// Get single order (seller)
router.get(
  "/get-single-order/:id",
  isSeller,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const order = await Order.findById(req.params.id)
        .populate("shop", "name email")
        .populate(
          "customer",
          "username fullname.firstName fullname.lastName email"
        );

      if (!order) {
        return next(new ErrorHandler("Order not found", 404));
      }
      if (
        order.shop &&
        order.shop._id.toString() !== req.seller._id.toString()
      ) {
        return next(
          new ErrorHandler(
            "Unauthorized: Order does not belong to your shop",
            403
          )
        );
      }

      console.info("get-single-order: Order retrieved", {
        orderId: req.params.id,
        shopId: req.seller._id,
      });

      res.status(200).json({
        success: true,
        order,
      });
    } catch (error) {
      console.error("get-single-order error:", {
        message: error.message,
        stack: error.stack,
        orderId: req.params.id,
        shopId: req.seller?._id,
      });
      return next(new ErrorHandler(error.message, error.statusCode || 500));
    }
  })
);

// Get all orders of user
router.get(
  "/get-all-orders/:userId",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      if (
        req.user._id.toString() !== req.params.userId &&
        req.user.role !== "admin"
      ) {
        return next(
          new ErrorHandler("Unauthorized to access these orders", 403)
        );
      }

      const orders = await Order.find({ customer: req.params.userId })
        .sort({ createdAt: -1 })
        .populate("shop", "name email")
        .populate("instructor", "fullname email")
        .populate(
          "customer",
          "username fullname.firstName fullname.lastName email"
        );

      console.info("get-all-orders: Orders retrieved", {
        userId: req.params.userId,
        orderCount: orders.length,
      });

      res.status(200).json({
        success: true,
        orders,
      });
    } catch (error) {
      console.error("get-all-orders error:", {
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
  catchAsyncErrors(async (req, res, next) => {
    try {
      if (req.seller._id.toString() !== req.params.shopId) {
        return next(
          new ErrorHandler("Unauthorized to access these orders", 403)
        );
      }

      const { status, page = 1, limit = 10, startDate, endDate } = req.query;
      const query = { shop: req.params.shopId };
      if (status) query.status = status;
      if (startDate || endDate) {
        query.createdAt = {};
        if (startDate) query.createdAt.$gte = new Date(startDate);
        if (endDate) query.createdAt.$lte = new Date(endDate);
      }

      const orders = await Order.find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(Number(limit))
        .populate("shop", "name email")
        .populate(
          "customer",
          "username fullname.firstName fullname.lastName email"
        );

      const total = await Order.countDocuments(query);

      console.info("get-seller-all-orders: Orders retrieved", {
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
      console.error("get-seller-all-orders error:", {
        message: error.message,
        stack: error.stack,
        shopId: req.params.shopId,
        query: req.query,
      });
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Get all orders of instructor
router.get(
  "/get-instructor-all-orders/:instructorId",
  isInstructor,
  catchAsyncErrors(async (req, res, next) => {
    try {
      if (req.instructor._id.toString() !== req.params.instructorId) {
        return next(
          new ErrorHandler("Unauthorized to access these orders", 403)
        );
      }

      const { status, page = 1, limit = 10, startDate, endDate } = req.query;
      const query = { instructor: req.params.instructorId };
      if (status) query.status = status;
      if (startDate || endDate) {
        query.createdAt = {};
        if (startDate) query.createdAt.$gte = new Date(startDate);
        if (endDate) query.createdAt.$lte = new Date(endDate);
      }

      const orders = await Order.find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(Number(limit))
        .populate("instructor", "fullname email")
        .populate(
          "customer",
          "username fullname.firstName fullname.lastName email"
        );

      const total = await Order.countDocuments(query);

      console.info("get-instructor-all-orders: Orders retrieved", {
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
      console.error("get-instructor-all-orders error:", {
        message: error.message,
        stack: error.stack,
        instructorId: req.params.instructorId,
        query: req.query,
      });
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Update order status for seller
router.put(
  "/update-order-status/:id",
  isSeller,
  catchAsyncErrors(async (req, res, next) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
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
      if (!status || !STATUS_TRANSITIONS[order.status].includes(status)) {
        throw new ErrorHandler(
          `Invalid status transition from ${order.status} to ${status}`,
          400
        );
      }

      // Update payment status to Paid if not already (for legacy orders)
      if (status === "Delivered" && order.paymentStatus !== "Paid") {
        order.paymentStatus = "Paid";
      }

      order.status = status;
      order.statusHistory.push({
        status,
        updatedAt: new Date(),
        reason: reason || `Status updated to ${status}`,
      });

      await order.save({ session, validateBeforeSave: false });

      // Send email to customer
      try {
        const customerName = order.customer?.username || "Customer";
        await sendMail({
          email: order.customer.email,
          subject: `Order Update - Order #${order._id}`,
          message: `Dear ${customerName},\n\nYour order has been updated.\n\nOrder ID: ${
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
            )}\n\nView details in your account.\n\nBest regards,\nE-commerce Platform`,
        });
        console.info("update-order-status: Email sent to customer", {
          orderId: order._id,
          customerId: order.customer._id,
          email: order.customer.email,
          status,
        });
      } catch (emailError) {
        console.error("update-order-status: Failed to send customer email", {
          orderId: order._id,
          customerId: order.customer._id,
          error: emailError.message,
        });
      }

      await session.commitTransaction();
      console.info("update-order-status: Order updated", {
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
      console.error("update-order-status error:", {
        message: error.message,
        stack: error.stack,
        orderId: req.params.id,
        shopId: req.seller?._id,
        status: req.body.status,
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
  catchAsyncErrors(async (req, res, next) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
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
      if (!status || !["Confirmed", "Refunded", "Cancelled"].includes(status)) {
        throw new ErrorHandler(
          `Invalid status for course order: ${status}`,
          400
        );
      }
      if (order.status === "Refunded" || order.status === "Cancelled") {
        throw new ErrorHandler(`Order is already ${order.status}`, 400);
      }

      if (status === "Refunded" || status === "Cancelled") {
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

      // Update payment status to Paid if not already (for legacy orders)
      if (status === "Confirmed" && order.paymentStatus !== "Paid") {
        order.paymentStatus = "Paid";
      }

      order.status = status;
      order.statusHistory.push({
        status,
        updatedAt: new Date(),
        reason: reason || `Status updated to ${status}`,
      });

      await order.save({ session, validateBeforeSave: false });

      // Send email to customer
      try {
        const customerName = order.customer?.username || "Customer";
        await sendMail({
          email: order.customer.email,
          subject: `Course Order Update - Order #${order._id}`,
          message: `Dear ${customerName},\n\nYour course order has been updated.\n\nOrder ID: ${
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
            )}\n\nView details in your account.\n\nBest regards,\nE-commerce Platform`,
        });
        console.info("update-course-order-status: Email sent to customer", {
          orderId: order._id,
          customerId: order.customer._id,
          email: order.customer.email,
          status,
        });
      } catch (emailError) {
        console.error(
          "update-course-order-status: Failed to send customer email",
          {
            orderId: order._id,
            customerId: order.customer._id,
            error: emailError.message,
          }
        );
      }

      await session.commitTransaction();
      console.info("update-course-order-status: Order updated", {
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
      console.error("update-course-order-status error:", {
        message: error.message,
        stack: error.stack,
        orderId: req.params.id,
        instructorId: req.instructor?._id,
        status: req.body.status,
      });
      return next(new ErrorHandler(error.message, error.statusCode || 500));
    } finally {
      session.endSession();
    }
  })
);

// Request refund (user)
router.put(
  "/order-refund/:id",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const { status, reason } = req.body;
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
      if (status !== "Refunded") {
        throw new ErrorHandler("Invalid status for refund request", 400);
      }
      if (!["Delivered", "Confirmed"].includes(order.status)) {
        throw new ErrorHandler(
          "Refunds can only be requested for delivered or confirmed orders",
          400
        );
      }
      if (!reason) {
        throw new ErrorHandler("Refund reason is required", 400);
      }

      order.status = status;
      order.statusHistory.push({
        status,
        updatedAt: new Date(),
        reason,
      });

      await order.save({ session, validateBeforeSave: false });

      // Send email to customer
      try {
        const customerName = order.customer?.username || "Customer";
        await sendMail({
          email: order.customer.email,
          subject: `Refund Request Submitted - Order #${order._id}`,
          message: `Dear ${customerName},\n\nYour refund request has been submitted.\n\nOrder ID: ${
            order._id
          }\nStatus: ${status}\nReason: ${reason}\nTotal: $${order.totalAmount.toFixed(
            2
          )}\n\nWe will review your request soon.\n\nBest regards,\nE-commerce Platform`,
        });
        console.info("order-refund: Email sent to customer", {
          orderId: order._id,
          customerId: order.customer._id,
          email: order.customer.email,
        });
      } catch (emailError) {
        console.error("order-refund: Failed to send customer email", {
          orderId: order._id,
          customerId: order.customer._id,
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
          subject: `Refund Request Received - Order #${order._id}`,
          message: `Dear ${recipientName},\n\nA refund request has been submitted for an order.\n\nOrder ID: ${
            order._id
          }\nReason: ${reason}\nTotal: $${order.totalAmount.toFixed(
            2
          )}\nItems:\n${order.items
            .map(
              (item) =>
                `- ${item.name} (Qty: ${
                  item.quantity
                }, Price: $${item.price.toFixed(2)})`
            )
            .join(
              "\n"
            )}\n\nPlease review and process the refund in your dashboard.\n\nBest regards,\nE-commerce Platform`,
        });
        console.info("order-refund: Email sent to recipient", {
          orderId: order._id,
          recipientId: recipient._id,
          email: recipient.email,
        });
      } catch (emailError) {
        console.error("order-refund: Failed to send recipient email", {
          orderId: order._id,
          recipientId: order.shop?._id || order.instructor?._id,
          error: emailError.message,
        });
      }

      await session.commitTransaction();
      console.info("order-refund: Refund requested", {
        orderId: order._id,
        customerId: req.user._id,
        reason,
      });

      res.status(200).json({
        success: true,
        order,
        message: "Order refund request submitted successfully",
      });
    } catch (error) {
      await session.abortTransaction();
      console.error("order-refund error:", {
        message: error.message,
        stack: error.stack,
        orderId: req.params.id,
        customerId: req.user?._id,
      });
      return next(new ErrorHandler(error.message, error.statusCode || 500));
    } finally {
      session.endSession();
    }
  })
);

// Approve refund (seller or instructor)
router.put(
  "/order-refund-success/:id",
  catchAsyncErrors(async (req, res, next) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const { status, reason } = req.body;
      const order = await Order.findById(req.params.id)
        .populate("shop instructor customer")
        .session(session);

      if (!order) {
        throw new ErrorHandler("Order not found", 404);
      }
      if (status !== "Refunded") {
        throw new ErrorHandler("Invalid status for refund approval", 400);
      }
      if (order.status !== "Refunded") {
        throw new ErrorHandler("Order must be in 'Refunded' status", 400);
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

      // Update stock or enrollments
      for (const item of order.items) {
        if (item.itemType === "Product") {
          const product = await Product.findById(item.itemId).session(session);
          if (!product) {
            throw new ErrorHandler(`Product not found: ${item.itemId}`, 404);
          }
          product.stock += item.quantity;
          product.sold_out = Math.max(
            0,
            (product.sold_out || 0) - item.quantity
          );
          await product.save({ session, validateBeforeSave: false });
          console.debug("order-refund-success: Product stock restored", {
            productId: item.itemId,
            name: item.name,
            quantity: item.quantity,
            newStock: product.stock,
            newSoldOut: product.sold_out,
          });
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
        if (!shop) {
          throw new ErrorHandler("Shop not found", 404);
        }
        const serviceCharge = order.totalAmount * 0.1;
        const shopAmount = order.totalAmount - serviceCharge;
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
        await shop.save({ session, validateBeforeSave: false });
      } else if (order.instructor) {
        const instructor = await Instructor.findById(
          order.instructor._id
        ).session(session);
        if (!instructor) {
          throw new ErrorHandler("Instructor not found", 404);
        }
        const serviceCharge = order.totalAmount * 0.1;
        const instructorAmount = order.totalAmount - serviceCharge;
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
        await instructor.save({ session, validateBeforeSave: false });
      }

      order.status = status;
      order.paymentStatus = "Refunded";
      order.statusHistory.push({
        status,
        updatedAt: new Date(),
        reason: reason || "Refund approved",
      });

      await order.save({ session, validateBeforeSave: false });

      // Send email to customer
      try {
        const customerName = order.customer?.username || "Customer";
        await sendMail({
          email: order.customer.email,
          subject: `Refund Approved - Order #${order._id}`,
          message: `Dear ${customerName},\n\nYour refund has been approved.\n\nOrder ID: ${
            order._id
          }\nTotal: $${order.totalAmount.toFixed(2)}\nReason: ${
            reason || "Refund approved"
          }\n\nThe amount will be processed soon.\n\nBest regards,\nE-commerce Platform`,
        });
        console.info("order-refund-success: Email sent to customer", {
          orderId: order._id,
          customerId: order.customer._id,
          email: order.customer.email,
        });
      } catch (emailError) {
        console.error("order-refund-success: Failed to send customer email", {
          orderId: order._id,
          customerId: order.customer._id,
          error: emailError.message,
        });
      }

      await session.commitTransaction();
      console.info("order-refund-success: Refund approved", {
        orderId: order._id,
        shopId: order.shop?._id,
        instructorId: order.instructor?._id,
        reason,
      });

      res.status(200).json({
        success: true,
        message: "Order refund processed successfully",
      });
    } catch (error) {
      await session.abortTransaction();
      console.error("order-refund-success error:", {
        message: error.message,
        stack: error.stack,
        orderId: req.params.id,
        shopId: req.seller?._id,
        instructorId: req.instructor?._id,
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
  catchAsyncErrors(async (req, res, next) => {
    try {
      const order = await Order.findById(req.params.id).populate("shop");

      if (!order) {
        return next(new ErrorHandler("Order not found", 404));
      }
      if (
        !order.shop ||
        order.shop._id.toString() !== req.seller._id.toString()
      ) {
        return next(
          new ErrorHandler(
            "Unauthorized: Order does not belong to your shop",
            403
          )
        );
      }
      if (!["Pending", "Cancelled"].includes(order.status)) {
        return next(
          new ErrorHandler(
            "Only Pending or Cancelled orders can be deleted",
            400
          )
        );
      }

      await Order.deleteOne({ _id: req.params.id });

      console.info("delete-order: Order deleted", {
        orderId: req.params.id,
        shopId: req.seller._id,
        status: order.status,
      });

      res.status(200).json({
        success: true,
        message: "Order deleted successfully",
      });
    } catch (error) {
      console.error("delete-order error:", {
        message: error.message,
        stack: error.stack,
        orderId: req.params.id,
        shopId: req.seller?._id,
      });
      return next(new ErrorHandler(error.message, error.statusCode || 500));
    }
  })
);

// Get all orders (admin)
router.get(
  "/admin-all-orders",
  isAuthenticated,
  isAdmin("admin"),
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { page = 1, limit = 10, status } = req.query;
      const query = status ? { status } : {};

      const orders = await Order.find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(Number(limit))
        .populate("shop", "name email")
        .populate("instructor", "fullname email")
        .populate(
          "customer",
          "username fullname.firstName fullname.lastName email"
        );

      const total = await Order.countDocuments(query);

      console.info("admin-all-orders: Orders retrieved", {
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
      console.error("admin-all-orders error:", {
        message: error.message,
        stack: error.stack,
        query: req.query,
      });
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Get shop statistics
router.get(
  "/shop/stats/:shopId",
  isSeller,
  catchAsyncErrors(async (req, res, next) => {
    try {
      if (req.seller._id.toString() !== req.params.shopId) {
        return next(
          new ErrorHandler("Unauthorized to access shop statistics", 403)
        );
      }
      if (!mongoose.Types.ObjectId.isValid(req.params.shopId)) {
        return next(new ErrorHandler("Invalid shop ID", 400));
      }

      const stats = await Order.aggregate([
        { $match: { shop: new mongoose.Types.ObjectId(req.params.shopId) } },
        {
          $facet: {
            totalSales: [
              { $match: { status: { $in: ["Delivered", "Refunded"] } } },
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
        totalOrders: stats[0].totalOrders[0]?.count || 0,
        recentOrders: stats[0].recentOrders[0]?.count || 0,
      };

      console.info("shop-stats: Statistics retrieved", {
        shopId: req.params.shopId,
        stats: result,
      });

      res.status(200).json({
        success: true,
        stats: result,
      });
    } catch (error) {
      console.error("shop-stats error:", {
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
  catchAsyncErrors(async (req, res, next) => {
    try {
      if (req.instructor._id.toString() !== req.params.instructorId) {
        return next(
          new ErrorHandler("Unauthorized to access instructor statistics", 403)
        );
      }
      if (!mongoose.Types.ObjectId.isValid(req.params.instructorId)) {
        return next(new ErrorHandler("Invalid instructor ID", 400));
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
                { $match: { status: { $in: ["Confirmed", "Refunded"] } } },
                { $group: { _id: null, total: { $sum: "$totalAmount" } } },
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
        totalOrders: stats[0][0].totalOrders[0]?.count || 0,
        recentOrders: stats[0][0].recentOrders[0]?.count || 0,
        totalEnrollments: stats[1][0]?.totalEnrollments || 0,
        completedEnrollments: stats[1][0]?.completed || 0,
      };

      console.info("instructor-stats: Statistics retrieved", {
        instructorId: req.params.instructorId,
        stats: result,
      });

      res.status(200).json({
        success: true,
        stats: result,
      });
    } catch (error) {
      console.error("instructor-stats error:", {
        message: error.message,
        stack: error.stack,
        instructorId: req.params.instructorId,
      });
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

module.exports = router;
