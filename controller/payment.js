require("dotenv").config();
const express = require("express");
const router = express.Router();
const { body, validationResult } = require("express-validator");
const catchAsyncErrors = require("../middleware/catchAsyncErrors");
const ErrorHandler = require("../utils/ErrorHandler");
const { isAuthenticated } = require("../middleware/auth");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const crypto = require("crypto");
const mongoose = require("mongoose");
const logger = require("../utils/logger");
const Order = require("../model/order");
const User = require("../model/user");

// Validation middleware for payment processing
const validatePayment = [
  body("amount")
    .isFloat({ min: 0.5 })
    .withMessage("Amount must be a number greater than 0.5"),
  body("currency")
    .isIn(["USD", "CAD", "EUR"])
    .withMessage("Unsupported currency"),
  body("orderId").isMongoId().withMessage("Invalid order ID"),
];

// Validation middleware for refund processing
const validateRefund = [
  body("orderId").isMongoId().withMessage("Invalid order ID"),
  body("reason").notEmpty().withMessage("Refund reason is required"),
  body("amount")
    .optional()
    .isFloat({ min: 0 })
    .withMessage("Refund amount must be non-negative"),
];

// Create payment intent
router.post(
  "/create-payment-intent",
  isAuthenticated,
  validatePayment,
  catchAsyncErrors(async (req, res, next) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new ErrorHandler(errors.array()[0].msg, 400);
      }

      const {
        amount,
        currency,
        orderId,
        paymentMethodType = "card",
      } = req.body;

      const order = await Order.findById(orderId).session(session);
      if (!order) {
        throw new ErrorHandler("Order not found", 404);
      }
      if (order.customer.toString() !== req.user._id.toString()) {
        throw new ErrorHandler("Unauthorized to pay for this order", 403);
      }
      if (order.paymentInfo?.status === "Succeeded") {
        throw new ErrorHandler("Order already paid", 400);
      }

      const expectedAmount = Math.round(order.totalAmount * 100);
      if (Math.abs(expectedAmount - amount) > 1) {
        logger.warn("Payment amount mismatch", {
          orderId,
          expected: expectedAmount,
          received: amount,
        });
        throw new ErrorHandler(
          "Payment amount does not match order total",
          400
        );
      }

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

      const ephemeralKey = await stripe.ephemeralKeys.create(
        { customer: customerId },
        { apiVersion: "2023-10-16" }
      );

      // Choose one approach - either automatic payment methods or specific payment method types
      const paymentIntentParams = {
        amount,
        currency,
        customer: customerId,
        metadata: {
          company: "BlackandSell",
          orderId,
          userId: user._id.toString(),
        },
        description: `Payment for order ${orderId}`,
        receipt_email: user.email,
      };

      // Option 1: Use automatic payment methods (recommended for simplicity)
      paymentIntentParams.automatic_payment_methods = { enabled: true };
      
      // OR Option 2: Specify payment method types explicitly
      // paymentIntentParams.payment_method_types = [paymentMethodType];

      const paymentIntent = await stripe.paymentIntents.create(paymentIntentParams);

      order.paymentInfo = {
        id: paymentIntent.id,
        status: paymentIntent.status,
        type: paymentMethodType,
      };
      order.statusHistory.push({
        status: order.status,
        updatedBy: user._id.toString(),
        updatedByModel: "User",
        reason: "Payment intent created",
      });
      await order.save({ session });

      await session.commitTransaction();
      logger.info("Payment intent created", {
        paymentIntentId: paymentIntent.id,
        orderId,
        userId: user._id,
        customerId,
      });

      res.status(200).json({
        success: true,
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
        ephemeralKey: ephemeralKey.secret,
        customerId: customerId,
      });
    } catch (error) {
      await session.abortTransaction();
      logger.error("Payment intent creation failed", {
        error: error.message,
        orderId: req.body.orderId,
        userId: req.user._id,
      });
      return next(new ErrorHandler(error.message, error.statusCode || 500));
    } finally {
      session.endSession();
    }
  })
);

// Confirm payment
router.post(
  "/confirm-payment",
  isAuthenticated,
  [
    body("paymentIntentId")
      .notEmpty()
      .withMessage("Payment Intent ID is required"),
    body("orderId").isMongoId().withMessage("Invalid order ID"),
  ],
  catchAsyncErrors(async (req, res, next) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new ErrorHandler(errors.array()[0].msg, 400);
      }

      const { paymentIntentId, orderId } = req.body;
      const order = await Order.findById(orderId)
        .populate("shop instructor customer")
        .session(session);

      if (!order) {
        throw new ErrorHandler("Order not found", 404);
      }
      if (order.customer._id.toString() !== req.user._id.toString()) {
        throw new ErrorHandler("Unauthorized to confirm this payment", 403);
      }

      const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
      if (paymentIntent.status !== "succeeded") {
        throw new ErrorHandler("Payment not successful", 400);
      }

      order.paymentInfo.status = "Succeeded";
      order.status = order.instructor ? "Confirmed" : "Confirmed"; // Courses go to Confirmed, products to Confirmed
      order.statusHistory.push({
        status: order.status,
        updatedBy: req.user._id.toString(),
        updatedByModel: "User",
        reason: "Payment confirmed",
      });

      // Update shop or instructor balance
      if (order.shop) {
        const shop = await Shop.findById(order.shop._id).session(session);
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
      } else if (order.instructor) {
        const instructor = await Instructor.findById(
          order.instructor._id
        ).session(session);
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

      await order.save({ session });

      // Send confirmation email
      try {
        await sendMail({
          email: order.customer.email,
          subject: `Payment Confirmed #${order._id}`,
          message: `Dear ${
            order.customer.username || "Customer"
          },\n\nYour payment has been confirmed.\nOrder ID: ${
            order._id
          }\nTotal: $${order.totalAmount.toFixed(2)}\nItems:\n${order.items
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
        logger.info("confirm-payment: Email sent to customer", {
          orderId: order._id,
          customerId: order.customer._id,
        });
      } catch (emailError) {
        logger.error("confirm-payment: Failed to send customer email", {
          orderId: order._id,
          error: emailError.message,
        });
      }

      await session.commitTransaction();
      logger.info("Payment confirmed", {
        paymentIntentId,
        orderId,
        userId: req.user._id,
      });

      res.status(200).json({
        success: true,
        message: "Payment confirmed successfully",
        order,
      });
    } catch (error) {
      await session.abortTransaction();
      logger.error("Payment confirmation failed", {
        error: error.message,
        paymentIntentId: req.body.paymentIntentId || "unknown",
        orderId: req.body.orderId || "unknown",
        userId: req.user?._id || "unknown",
      });
      return next(new ErrorHandler(error.message, error.statusCode || 500));
    } finally {
      session.endSession();
    }
  })
);

// Retry payment
router.post(
  "/retry-payment",
  isAuthenticated,
  [
    body("orderId").isMongoId().withMessage("Invalid order ID"),
    body("paymentMethodId")
      .notEmpty()
      .withMessage("Payment Method ID is required"),
  ],
  catchAsyncErrors(async (req, res, next) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return next(new ErrorHandler(errors.array()[0].msg, 400));
      }

      const { orderId, paymentMethodId } = req.body;
      const order = await Order.findById(orderId).session(session);
      if (!order) {
        throw new ErrorHandler("Order not found", 404);
      }
      if (order.customer.toString() !== req.user._id.toString()) {
        throw new ErrorHandler(
          "Unauthorized to retry payment for this order",
          403
        );
      }
      if (order.paymentInfo?.status !== "Failed") {
        throw new ErrorHandler("Can only retry failed payments", 400);
      }
      if (!order.paymentInfo?.id) {
        throw new ErrorHandler("No payment intent found", 400);
      }

      const paymentIntent = await stripe.paymentIntents.confirm(
        order.paymentInfo.id,
        {
          payment_method: paymentMethodId,
        }
      );

      if (paymentIntent.status === "succeeded") {
        order.paymentInfo.status = "Succeeded";
        order.status = order.instructor ? "Confirmed" : "Confirmed";
        order.statusHistory.push({
          status: order.status,
          updatedBy: req.user._id.toString(),
          updatedByModel: "User",
          reason: "Payment retry successful",
        });

        // Update shop or instructor balance
        if (order.shop) {
          const shop = await Shop.findById(order.shop).session(session);
          const serviceCharge = order.totalAmount * 0.1;
          const shopAmount = order.totalAmount - serviceCharge;
          shop.availableBalance = (shop.availableBalance || 0) + shopAmount;
          shop.transactions.push({
            amount: shopAmount,
            type: "Deposit",
            status: "Succeeded",
            createdAt: new Date(),
            metadata: { orderId: order._id, source: "Order Payment Retry" },
          });
          await shop.save({ session });
        } else if (order.instructor) {
          const instructor = await Instructor.findById(
            order.instructor
          ).session(session);
          const serviceCharge = order.totalAmount * 0.1;
          const instructorAmount = order.totalAmount - serviceCharge;
          instructor.availableBalance =
            (instructor.availableBalance || 0) + instructorAmount;
          instructor.transactions.push({
            amount: instructorAmount,
            type: "Deposit",
            status: "Succeeded",
            createdAt: new Date(),
            metadata: { orderId: order._id, source: "Order Payment Retry" },
          });
          await instructor.save({ session });
        }

        await order.save({ session });

        // Send confirmation email
        try {
          await sendMail({
            email: order.customer.email,
            subject: `Payment Retry Successful #${order._id}`,
            message: `Dear ${
              order.customer.username || "Customer"
            },\n\nYour payment retry was successful.\nOrder ID: ${
              order._id
            }\nTotal: $${order.totalAmount.toFixed(2)}\nItems:\n${order.items
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
          logger.info("retry-payment: Email sent to customer", {
            orderId: order._id,
            customerId: order.customer._id,
          });
        } catch (emailError) {
          logger.error("retry-payment: Failed to send customer email", {
            orderId: order._id,
            error: emailError.message,
          });
        }
      } else {
        order.paymentInfo.status = "Failed";
        order.statusHistory.push({
          status: order.status,
          updatedBy: req.user._id.toString(),
          updatedByModel: "User",
          reason: "Payment retry failed",
        });
        await order.save({ session });
        throw new ErrorHandler("Payment retry failed", 400);
      }

      await session.commitTransaction();
      logger.info("Payment retry successful", {
        paymentIntentId,
        orderId,
        userId: req.user._id,
      });

      res.status(200).json({
        success: true,
        message: "Payment retry successful",
        order,
      });
    } catch (error) {
      await session.abortTransaction();
      logger.error("Payment retry failed", {
        error: error.message,
        orderId: req.body.orderId,
        userId: req.user._id,
      });
      return next(new ErrorHandler(error.message, error.statusCode || 500));
    } finally {
      session.endSession();
    }
  })
);

// Process refund (aligned with /order-refund)
router.post(
  "/process-refund",
  isAuthenticated,
  validateRefund,
  catchAsyncErrors(async (req, res, next) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return next(new ErrorHandler(errors.array()[0].msg, 400));
      }

      const { orderId, reason, amount } = req.body;
      const order = await Order.findById(orderId)
        .populate("customer")
        .session(session);

      if (!order) {
        throw new ErrorHandler("Order not found", 404);
      }
      if (order.customer._id.toString() !== req.user._id.toString()) {
        throw new ErrorHandler("Unauthorized to refund this order", 403);
      }
      if (!["Delivered", "Confirmed"].includes(order.status)) {
        throw new ErrorHandler(
          "Order must be delivered or confirmed to be refunded",
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
          orderId,
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
        requestedAt: new Date(),
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
        logger.info("process-refund: Email sent to customer", {
          orderId,
          customerId: order.customer._id,
          refundId: refund.id,
        });
      } catch (emailError) {
        logger.error("process-refund: Failed to send customer email", {
          orderId,
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
        logger.info("process-refund: Email sent to recipient", {
          orderId,
          recipientId: recipient._id,
          refundId: refund.id,
        });
      } catch (emailError) {
        logger.error("process-refund: Failed to send recipient email", {
          orderId,
          error: emailError.message,
        });
      }

      await session.commitTransaction();
      logger.info("Refund requested", {
        refundId: refund.id,
        orderId,
        userId: req.user._id,
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
      logger.error("Refund processing failed", {
        error: error.message,
        orderId: req.body.orderId,
        userId: req.user._id,
      });
      return next(new ErrorHandler(error.message, error.statusCode || 500));
    } finally {
      session.endSession();
    }
  })
);

// Stripe webhook handler
router.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  catchAsyncErrors(async (req, res, next) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const sig = req.headers["stripe-signature"];
      let event;

      try {
        event = stripe.webhooks.constructEvent(
          req.body,
          sig,
          process.env.STRIPE_WEBHOOK_SECRET
        );
      } catch (err) {
        logger.error("Webhook signature verification failed", {
          error: err.message,
        });
        return next(new ErrorHandler("Webhook verification failed", 400));
      }

      const { metadata } = event.data.object;
      const orderId = metadata?.orderId;

      if (!orderId || !mongoose.Types.ObjectId.isValid(orderId)) {
        logger.warn("Invalid or missing orderId in webhook", {
          eventType: event.type,
          metadata,
        });
        return res.status(200).json({ received: true });
      }

      const order = await Order.findById(orderId)
        .populate("customer")
        .session(session);

      if (!order) {
        logger.warn("Order not found in webhook", {
          orderId,
          eventType: event.type,
        });
        return res.status(200).json({ received: true });
      }

      switch (event.type) {
        case "payment_intent.succeeded":
          order.paymentInfo.status = "Succeeded";
          order.status = order.instructor ? "Confirmed" : "Confirmed";
          order.statusHistory.push({
            status: order.status,
            updatedBy: "System",
            updatedByModel: "Webhook",
            reason: "Payment succeeded via webhook",
          });

          // Update shop or instructor balance
          if (order.shop) {
            const shop = await Shop.findById(order.shop).session(session);
            const serviceCharge = order.totalAmount * 0.1;
            const shopAmount = order.totalAmount - serviceCharge;
            shop.availableBalance = (shop.availableBalance || 0) + shopAmount;
            shop.transactions.push({
              amount: shopAmount,
              type: "Deposit",
              status: "Succeeded",
              createdAt: new Date(),
              metadata: { orderId: order._id, source: "Webhook Payment" },
            });
            await shop.save({ session });
          } else if (order.instructor) {
            const instructor = await Instructor.findById(
              order.instructor
            ).session(session);
            const serviceCharge = order.totalAmount * 0.1;
            const instructorAmount = order.totalAmount - serviceCharge;
            instructor.availableBalance =
              (instructor.availableBalance || 0) + instructorAmount;
            instructor.transactions.push({
              amount: instructorAmount,
              type: "Deposit",
              status: "Succeeded",
              createdAt: new Date(),
              metadata: { orderId: order._id, source: "Webhook Payment" },
            });
            await instructor.save({ session });
          }

          await order.save({ session });
          logger.info("Webhook: Payment succeeded", {
            paymentIntentId: event.data.object.id,
            orderId,
          });
          break;

        case "payment_intent.payment_failed":
          order.paymentInfo.status = "Failed";
          order.statusHistory.push({
            status: order.status,
            updatedBy: "System",
            updatedByModel: "Webhook",
            reason: "Payment failed via webhook",
          });
          await order.save({ session });
          logger.warn("Webhook: Payment failed", {
            paymentIntentId: event.data.object.id,
            orderId,
          });
          break;

        case "charge.refunded":
          const refundId = event.data.object.id;
          const refundRecord = order.refundHistory.find(
            (r) => r.refundId === refundId
          );
          if (refundRecord) {
            refundRecord.status = "Approved";
            refundRecord.processedAt = new Date();
            order.status = "Refund Success";
            order.paymentInfo.status = "Refunded";
            order.statusHistory.push({
              status: "Refund Success",
              updatedBy: "System",
              updatedByModel: "Webhook",
              reason: "Refund processed via webhook",
            });

            // Restore stock or update enrollments
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
                const course = await Course.findById(item.itemId).session(
                  session
                );
                if (course) {
                  course.enrollmentCount = Math.max(
                    0,
                    course.enrollmentCount - item.quantity
                  );
                  await course.save({ session });
                }
              }
            }

            // Update shop or instructor balance
            if (order.shop) {
              const shop = await Shop.findById(order.shop).session(session);
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
                metadata: { orderId: order._id, source: "Webhook Refund" },
              });
              await shop.save({ session });
            } else if (order.instructor) {
              const instructor = await Instructor.findById(
                order.instructor
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
                metadata: { orderId: order._id, source: "Webhook Refund" },
              });
              await instructor.save({ session });
            }

            await order.save({ session });
            logger.info("Webhook: Refund processed", {
              refundId,
              orderId,
            });

            // Send email to customer
            try {
              await sendMail({
                email: order.customer.email,
                subject: `Refund Processed #${order._id}`,
                message: `Dear ${
                  order.customer.username || "Customer"
                },\n\nYour refund has been processed.\nOrder ID: ${
                  order._id
                }\nRefund Amount: $${refundRecord.amount.toFixed(2)}\nReason: ${
                  refundRecord.reason
                }\n\nThe amount will be credited soon.\n\nBest regards,\nBlackandSell`,
              });
              logger.info("Webhook: Refund email sent to customer", {
                orderId,
                customerId: order.customer._id,
                refundId,
              });
            } catch (emailError) {
              logger.error("Webhook: Failed to send refund email", {
                orderId,
                error: emailError.message,
              });
            }
          }
          break;

        default:
          logger.info("Webhook: Unhandled event type", {
            eventType: event.type,
            orderId,
          });
      }

      await session.commitTransaction();
      res.status(200).json({ received: true });
    } catch (error) {
      await session.abortTransaction();
      logger.error("Webhook processing failed", {
        error: error.message,
        eventType: event?.type,
        orderId,
      });
      return next(new ErrorHandler("Webhook processing failed", 500));
    } finally {
      session.endSession();
    }
  })
);

// Get Stripe API key
router.get(
  "/stripe-apikey",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const token = crypto.randomBytes(16).toString("hex");
      logger.info("Stripe API key requested", {
        userId: req.user._id,
        token,
      });

      res.status(200).json({
        success: true,
        stripeApiKey: process.env.STRIPE_PUBLISHABLE_KEY,
        token,
      });
    } catch (error) {
      logger.error("Stripe API key retrieval failed", {
        error: error.message,
        userId: req.user._id,
      });
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

module.exports = router;
