const express = require("express");
const catchAsyncErrors = require("../middleware/catchAsyncErrors");
const Shop = require("../model/shop");
const Event = require("../model/event");
const ErrorHandler = require("../utils/ErrorHandler");
const { isSeller, isAdmin, isAuthenticated } = require("../middleware/auth");
const router = express.Router();
const cloudinary = require("cloudinary");

// Create event
router.post(
  "/create-event",
  isSeller,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { shopId, images, start_Date, Finish_Date, ...eventData } =
        req.body;

      // Validate shop
      if (shopId !== req.seller._id.toString()) {
        return next(new ErrorHandler("Unauthorized: Invalid shop ID", 403));
      }
      const shop = await Shop.findById(shopId);
      if (!shop) {
        return next(new ErrorHandler("Shop not found", 404));
      }
      if (!shop.isVerified) {
        return next(new ErrorHandler("Shop is not verified", 403));
      }

      // Validate images
      if (!images || !Array.isArray(images) || images.length === 0) {
        return next(new ErrorHandler("At least one image is required", 400));
      }

      // Upload images to Cloudinary
      const imagesLinks = [];
      for (const image of images) {
        const result = await cloudinary.v2.uploader.upload(image, {
          folder: "events",
          transformation: [{ width: 800, height: 800, crop: "limit" }],
        });
        imagesLinks.push({
          public_id: result.public_id,
          url: result.secure_url,
        });
      }

      // Prepare event data
      const eventPayload = {
        ...eventData,
        shopId,
        shop: shop._id,
        images: imagesLinks,
        start_Date: new Date(start_Date),
        Finish_Date: new Date(Finish_Date),
        statusHistory: [
          {
            status: "Running",
            updatedAt: new Date(),
            reason: "Event created",
          },
        ],
      };

      const event = await Event.create(eventPayload);

      console.info("create-event: Event created", {
        eventId: event._id,
        shopId,
        name: event.name,
      });

      res.status(201).json({
        success: true,
        event,
      });
    } catch (error) {
      console.error("create-event error:", {
        message: error.message,
        shopId: req.body.shopId,
        sellerId: req.seller?._id,
      });
      return next(new ErrorHandler(error.message, 400));
    }
  })
);

// Update event
router.put(
  "/update-event/:id",
  isSeller,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const event = await Event.findById(req.params.id);
      if (!event) {
        return next(new ErrorHandler("Event not found", 404));
      }
      if (event.shopId.toString() !== req.seller._id.toString()) {
        return next(
          new ErrorHandler(
            "Unauthorized: Event does not belong to your shop",
            403
          )
        );
      }

      const { images, start_Date, Finish_Date, status, ...updateData } =
        req.body;

      // Prevent manual status updates
      if (status) {
        return next(
          new ErrorHandler("Status updates are managed automatically", 400)
        );
      }

      // Update images if provided
      if (images && Array.isArray(images) && images.length > 0) {
        // Delete old images
        for (const img of event.images) {
          await cloudinary.v2.uploader.destroy(img.public_id);
        }
        // Upload new images
        const imagesLinks = [];
        for (const image of images) {
          const result = await cloudinary.v2.uploader.upload(image, {
            folder: "events",
            transformation: [{ width: 800, height: 800, crop: "limit" }],
          });
          imagesLinks.push({
            public_id: result.public_id,
            url: result.secure_url,
          });
        }
        updateData.images = imagesLinks;
      }

      // Update dates if provided
      if (start_Date) updateData.start_Date = new Date(start_Date);
      if (Finish_Date) updateData.Finish_Date = new Date(Finish_Date);

      // Update event
      Object.assign(event, updateData);
      await event.save();

      console.info("update-event: Event updated", {
        eventId: event._id,
        shopId: event.shopId,
        name: event.name,
      });

      res.status(200).json({
        success: true,
        event,
      });
    } catch (error) {
      console.error("update-event error:", {
        message: error.message,
        eventId: req.params.id,
        sellerId: req.seller?._id,
      });
      return next(new ErrorHandler(error.message, 400));
    }
  })
);

// Get all events
router.get(
  "/get-all-events",
  catchAsyncErrors(async (req, res, next) => {
    try {
      const {
        category,
        status,
        sortBy = "createdAt",
        order = "desc",
      } = req.query;
      const query = {};
      if (category) query.category = category;
      if (status) query.status = status;

      const sort = {};
      sort[sortBy] = order === "desc" ? -1 : 1;

      const events = await Event.find(query)
        .sort(sort)
        .populate("shop", "name email");

      console.info("get-all-events: Events retrieved", {
        eventCount: events.length,
        query: req.query,
      });

      res.status(200).json({
        success: true,
        events,
      });
    } catch (error) {
      console.error("get-all-events error:", {
        message: error.message,
        query: req.query,
      });
      return next(new ErrorHandler(error.message, 400));
    }
  })
);

// Get all events of a shop
router.get(
  "/get-all-events/:id",
  isSeller,
  catchAsyncErrors(async (req, res, next) => {
    try {
      if (req.params.id !== req.seller._id.toString()) {
        return next(new ErrorHandler("Unauthorized: Invalid shop ID", 403));
      }

      const {
        page = 1,
        limit = 10,
        status,
        category,
        sortBy = "createdAt",
        order = "desc",
      } = req.query;
      const query = { shopId: req.params.id };
      if (status) query.status = status;
      if (category) query.category = category;

      const sort = {};
      sort[sortBy] = order === "desc" ? -1 : 1;

      const events = await Event.find(query)
        .sort(sort)
        .skip((page - 1) * limit)
        .limit(Number(limit))
        .populate("shop", "name email");

      const total = await Event.countDocuments(query);

      console.info("get-all-shop-events: Events retrieved", {
        shopId: req.params.id,
        eventCount: events.length,
        page,
        limit,
        query,
      });

      res.status(200).json({
        success: true,
        events,
        total,
        page: Number(page),
        pages: Math.ceil(total / limit),
      });
    } catch (error) {
      console.error("get-all-shop-events error:", {
        message: error.message,
        shopId: req.params.id,
        query: req.query,
      });
      return next(new ErrorHandler(error.message, 400));
    }
  })
);

// Get single event by ID
router.get(
  "/get-event/:id",
  isSeller,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const event = await Event.findById(req.params.id).populate(
        "shop",
        "name email"
      );
      if (!event) {
        return next(new ErrorHandler("Event not found", 404));
      }
      if (event.shopId.toString() !== req.seller._id.toString()) {
        return next(
          new ErrorHandler(
            "Unauthorized: Event does not belong to your shop",
            403
          )
        );
      }

      console.info("get-event: Event retrieved", {
        eventId: event._id,
        shopId: event.shopId,
        name: event.name,
      });

      res.status(200).json({
        success: true,
        event,
      });
    } catch (error) {
      console.error("get-event error:", {
        message: error.message,
        eventId: req.params.id,
        sellerId: req.seller?._id,
      });
      return next(new ErrorHandler(error.message, 400));
    }
  })
);

// Delete event of a shop
router.delete(
  "/delete-shop-event/:id",
  isSeller,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const event = await Event.findById(req.params.id);
      if (!event) {
        return next(new ErrorHandler("Event not found", 404));
      }
      if (event.shopId.toString() !== req.seller._id.toString()) {
        return next(
          new ErrorHandler(
            "Unauthorized: Event does not belong to your shop",
            403
          )
        );
      }

      // Delete images from Cloudinary
      for (const image of event.images) {
        await cloudinary.v2.uploader.destroy(image.public_id);
      }

      await event.deleteOne();

      console.info("delete-shop-event: Event deleted", {
        eventId: req.params.id,
        shopId: req.seller._id,
      });

      res.status(200).json({
        success: true,
        message: "Event deleted successfully",
      });
    } catch (error) {
      console.error("delete-shop-event error:", {
        message: error.message,
        eventId: req.params.id,
        sellerId: req.seller?._id,
      });
      return next(new ErrorHandler(error.message, 400));
    }
  })
);

// Get all events (admin)
router.get(
  "/admin-all-events",
  isAuthenticated,
  isAdmin("Admin"),
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { page = 1, limit = 10, status, category } = req.query;
      const query = {};
      if (status) query.status = status;
      if (category) query.category = category;

      const events = await Event.find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(Number(limit))
        .populate("shop", "name email");

      const total = await Event.countDocuments(query);

      console.info("admin-all-events: Events retrieved", {
        eventCount: events.length,
        page,
        limit,
        query,
      });

      res.status(200).json({
        success: true,
        events,
        total,
        page: Number(page),
        pages: Math.ceil(total / limit),
      });
    } catch (error) {
      console.error("admin-all-events error:", {
        message: error.message,
        query: req.query,
      });
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

module.exports = router;
