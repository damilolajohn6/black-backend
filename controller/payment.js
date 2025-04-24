require("dotenv").config();
const express = require("express");
const router = express.Router();
const catchAsyncErrors = require("../middleware/catchAsyncErrors");
const ErrorHandler = require("../utils/ErrorHandler");
const { isAuthenticated } = require("../middleware/auth");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const { body, validationResult } = require("express-validator");
const crypto = require("crypto");
const logger = require("../utils/logger"); // Assuming a logger utility is set up
const Order = require("../model/order");

// Validation middleware for payment processing
const validatePayment = [
  body("amount")
    .isFloat({ min: 0.5 })
    .withMessage("Amount must be a number greater than 0.5"),
  body("currency")
    .isIn(["USD", "CAD", "EUR"])
    .withMessage("Unsupported currency"),
  body("orderId")
    .isMongoId()
    .withMessage("Invalid order ID"),
];

// Create payment intent
router.post(
  "/create-payment-intent",
  isAuthenticated,
  validatePayment,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return next(new ErrorHandler(errors.array()[0].msg, 400));
      }

      const { amount, currency, orderId, paymentMethodType = "card" } = req.body;

      // Verify order exists and belongs to user
      const order = await Order.findById(orderId);
      if (!order) {
        return next(new ErrorHandler("Order not found", 404));
      }
      if (order.user._id.toString() !== req.user._id.toString()) {
        return next(new ErrorHandler("Unauthorized to pay for this order", 403));
      }
      if (order.paymentInfo?.status === "Succeeded") {
        return next(new ErrorHandler("Order already paid", 400));
      }

      // Calculate expected amount
      const expectedAmount = Math.round(order.totalPrice * 100); // Convert to cents
      if (Math.abs(expectedAmount - amount) > 1) {
        logger.warn("Payment amount mismatch", {
          orderId,
          expected: expectedAmount,
          received: amount,
        });
        return next(new ErrorHandler("Payment amount does not match order total", 400));
      }

      const paymentIntent = await stripe.paymentIntents.create({
        amount,
        currency,
        payment_method_types: [paymentMethodType],
        metadata: {
          company: "BlackandSell",
          orderId,
          userId: req.user._id.toString(),
        },
        automatic_payment_methods: {
          enabled: true,
        },
        description: `Payment for order ${orderId}`,
        receipt_email: req.user.email,
      });

      logger.info("Payment intent created", {
        paymentIntentId: paymentIntent.id,
        orderId,
        userId: req.user._id,
      });

      // Update order with payment intent ID
      order.paymentInfo = {
        id: paymentIntent.id,
        status: paymentIntent.status,
        type: paymentMethodType,
      };
      await order.save();

      res.status(200).json({
        success: true,
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
      });
    } catch (error) {
      logger.error("Payment intent creation failed", {
        error: error.message,
        orderId: req.body.orderId,
        userId: req.user._id,
      });
      return next(new ErrorHandler(error.message, 500));
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
    body("orderId")
      .isMongoId()
      .withMessage("Invalid order ID"),
  ],
  catchAsyncErrors(async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return next(new ErrorHandler(errors.array()[0].msg, 400));
      }

      const { paymentIntentId, orderId } = req.body;

      // Verify order
      const order = await Order.findById(orderId);
      if (!order) {
        return next(new ErrorHandler("Order not found", 404));
      }
      if (order.user._id.toString() !== req.user._id.toString()) {
        return next(new ErrorHandler("Unauthorized to confirm this payment", 403));
      }

      // Retrieve payment intent
      const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
      if (paymentIntent.status !== "succeeded") {
        return next(new ErrorHandler("Payment not successful", 400));
      }

      // Update order payment status
      order.paymentInfo.status = "Succeeded";
      order.status = "Processing";
      order.statusHistory.push({
        status: "Processing",
        updatedBy: req.user._id,
        updatedByModel: "User",
        reason: "Payment confirmed",
      });
      await order.save();

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
      logger.error("Payment confirmation failed", {
        error: error.message,
        paymentIntentId: req.body.paymentIntentId,
        orderId,
      });
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Process refund
router.post(
  "/process-refund",
  isAuthenticated,
  [
    body("orderId")
      .isMongoId()
      .withMessage("Invalid order ID"),
    body("reason")
      .notEmpty()
      .withMessage("Refund reason is required"),
  ],
  catchAsyncErrors(async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return next(new ErrorHandler(errors.array()[0].msg, 400));
      }

      const { orderId, reason } = req.body;

      const order = await Order.findById(orderId);
      if (!order) {
        return next(new ErrorHandler("Order not found", 404));
      }
      if (order.user._id.toString() !== req.user._id.toString()) {
        return next(new ErrorHandler("Unauthorized to refund this order", 403));
      }
      if (order.status !== "Delivered") {
        return next(new ErrorHandler("Order must be delivered to be refunded", 400));
      }
      if (!order.paymentInfo?.id) {
        return next(new ErrorHandler("No payment information found", 400));
      }

      const refund = await stripe.refunds.create({
        payment_intent: order.paymentInfo.id,
        amount: Math.round(order.totalPrice * 100),
        reason: "requested_by_customer",
        metadata: {
          orderId,
          userId: req.user._id.toString(),
          refundReason: reason,
        },
      });

      // Update order status
      order.status = "Refund Requested";
      order.refundReason = reason;
      order.statusHistory.push({
        status: "Refund Requested",
        updatedBy: req.user._id,
        updatedByModel: "User",
        reason,
      });
      await order.save();

      logger.info("Refund requested", {
        refundId: refund.id,
        orderId,
        userId: req.user._id,
      });

      res.status(200).json({
        success: true,
        message: "Refund request processed successfully",
        refundId: refund.id,
      });
    } catch (error) {
      logger.error("Refund processing failed", {
        error: error.message,
        orderId: req.body.orderId,
      });
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Stripe webhook handler
router.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  catchAsyncErrors(async (req, res, next) => {
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

      switch (event.type) {
        case "payment_intent.succeeded":
          const orderSuccess = await Order.findById(orderId);
          if (orderSuccess) {
            orderSuccess.paymentInfo.status = "Succeeded";
            orderSuccess.status = "Processing";
            orderSuccess.statusHistory.push({
              status: "Processing",
              updatedBy: "System",
              updatedByModel: "Webhook",
              reason: "Payment succeeded via webhook",
            });
            await orderSuccess.save();
            logger.info("Webhook: Payment succeeded", {
              paymentIntentId: event.data.object.id,
              orderId,
            });
          }
          break;

        case "payment_intent.payment_failed":
          const orderFailed = await Order.findById(orderId);
          if (orderFailed) {
            orderFailed.paymentInfo.status = "Failed";
            orderFailed.statusHistory.push({
              status: orderFailed.status,
              updatedBy: "System",
              updatedByModel: "Webhook",
              reason: "Payment failed via webhook",
            });
            await orderFailed.save();
            logger.warn("Webhook: Payment failed", {
              paymentIntentId: event.data.object.id,
              orderId,
            });
          }
          break;

        case "refund.created":
          const orderRefund = await Order.findById(orderId);
          if (orderRefund) {
            orderRefund.status = "Refund Success";
            orderRefund.statusHistory.push({
              status: "Refund Success",
              updatedBy: "System",
              updatedByModel: "Webhook",
              reason: "Refund processed via webhook",
            });
            await orderRefund.save();
            logger.info("Webhook: Refund processed", {
              refundId: event.data.object.id,
              orderId,
            });
          }
          break;

        default:
          logger.info("Webhook: Unhandled event type", {
            eventType: event.type,
            orderId,
          });
      }

      res.status(200).json({ received: true });
    } catch (error) {
      logger.error("Webhook processing failed", {
        error: error.message,
        eventType: event?.type,
      });
      return next(new ErrorHandler("Webhook processing failed", 500));
    }
  })
);

// Get Stripe API key (only for authenticated users)
router.get(
  "/stripe-apikey",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      // Generate a temporary token for added security
      const token = crypto.randomBytes(16).toString("hex");
      // You could store this token temporarily in Redis with a short expiry
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