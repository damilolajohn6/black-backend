require("dotenv").config();
const express = require("express");
const { isSeller, isAuthenticated, isAdmin } = require("../middleware/auth");
const catchAsyncErrors = require("../middleware/catchAsyncErrors");
const router = express.Router();
const Product = require("../model/product");
const Order = require("../model/order");
const Shop = require("../model/shop");
const ErrorHandler = require("../utils/ErrorHandler");
const cloudinary = require("cloudinary").v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Create product
router.post(
  "/create-product",
  isSeller,
  catchAsyncErrors(async (req, res, next) => {
    try {
      if (!req.seller || !req.seller._id) {
        console.error("create-product: Seller not authenticated", {
          cookies: req.cookies,
          headers: req.headers.authorization,
        });
        return next(new ErrorHandler("Seller not authenticated", 401));
      }

      const shopId = req.body.shopId;
      if (!shopId) {
        return next(new ErrorHandler("Shop ID is required", 400));
      }

      const shop = await Shop.findById(shopId);
      if (!shop) {
        return next(new ErrorHandler("Invalid Shop ID", 400));
      }

      if (shop._id.toString() !== req.seller._id.toString()) {
        return next(
          new ErrorHandler("Unauthorized: Shop does not belong to seller", 403)
        );
      }

      const {
        name,
        description,
        category,
        price,
        stock,
        images,
        priceDiscount,
        subCategory,
        tags,
        shipping,
        variations,
        isMadeInCanada,
        canadianCertification,
        flashSale,
      } = req.body;

      if (!name || !description || !category || !price || stock === undefined) {
        return next(
          new ErrorHandler(
            "Missing required fields: name, description, category, price, stock",
            400
          )
        );
      }

      if (!Array.isArray(images) || images.length === 0) {
        return next(new ErrorHandler("At least one image is required", 400));
      }

      const imagesLinks = images.map((image) => ({
        public_id: image.public_id || "",
        url: image.url,
      }));

      for (const image of imagesLinks) {
        if (!image.url) {
          return next(
            new ErrorHandler("Each image must have a valid URL", 400)
          );
        }
      }

      const productData = {
        name,
        description,
        category,
        price: Number(price),
        stock: Number(stock),
        images: imagesLinks,
        shop: shop._id,
        seller: req.seller._id,
        priceDiscount: priceDiscount ? Number(priceDiscount) : undefined,
        subCategory,
        tags: tags || [],
        shipping: shipping || {},
        variations: variations || [],
        isMadeInCanada: isMadeInCanada || false,
        canadianCertification: canadianCertification || "",
        flashSale: flashSale || {},
      };

      const product = await Product.create(productData);
      console.info("create-product: Product created successfully", {
        productId: product._id,
        sellerId: req.seller._id,
      });
      res.status(201).json({
        success: true,
        product,
      });
    } catch (error) {
      console.error("create-product error:", {
        message: error.message,
        body: req.body,
        seller: req.seller?._id || "missing",
      });
      return next(new ErrorHandler(error.message, 400));
    }
  })
);

// Update product
router.put(
  "/update-product/:id",
  isSeller,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const productId = req.params.id;
      if (!productId.match(/^[0-9a-fA-F]{24}$/)) {
        console.error("update-product: Invalid product ID format", {
          productId,
        });
        return next(new ErrorHandler("Invalid product ID format", 400));
      }

      const product = await Product.findById(productId).populate(
        "seller",
        "_id"
      );
      if (!product) {
        console.error("update-product: Product not found", { productId });
        return next(new ErrorHandler("Product not found", 404));
      }
      console.debug("update-product: Product fetched", {
        productId,
        sellerField: product.seller,
        reqSellerId: req.seller?._id,
      });
      if (
        !product.seller ||
        !req.seller?._id ||
        product.seller._id.toString() !== req.seller._id.toString()
      ) {
        console.error("update-product: Unauthorized access", {
          productId,
          sellerId: req.seller?._id,
          productSellerId: product.seller?._id,
        });
        return next(
          new ErrorHandler(
            "Unauthorized: Product does not belong to seller",
            403
          )
        );
      }

      const {
        name,
        description,
        category,
        price,
        stock,
        images,
        priceDiscount,
        subCategory,
        tags,
        shipping,
        variations,
        isMadeInCanada,
        canadianCertification,
        flashSale,
      } = req.body;

      if (!name || !description || !category || !price || stock === undefined) {
        return next(
          new ErrorHandler(
            "Missing required fields: name, description, category, price, stock",
            400
          )
        );
      }

      if (!Array.isArray(images) || images.length === 0) {
        return next(new ErrorHandler("At least one image is required", 400));
      }

      const imagesLinks = images.map((image) => ({
        public_id: image.public_id || "",
        url: image.url,
      }));

      for (const image of imagesLinks) {
        if (!image.url) {
          return next(
            new ErrorHandler("Each image must have a valid URL", 400)
          );
        }
      }

      product.name = name;
      product.description = description;
      product.category = category;
      product.price = Number(price);
      product.stock = Number(stock);
      product.images = imagesLinks;
      product.priceDiscount = priceDiscount ? Number(priceDiscount) : undefined;
      product.subCategory = subCategory;
      product.tags = tags || [];
      product.shipping = shipping || {};
      product.variations = variations || [];
      product.isMadeInCanada = isMadeInCanada || false;
      product.canadianCertification = canadianCertification || "";
      product.flashSale = flashSale || {};

      await product.save();
      console.info("update-product: Product updated successfully", {
        productId,
      });

      res.status(200).json({
        success: true,
        product,
      });
    } catch (error) {
      console.error("update-product error:", {
        message: error.message,
        body: req.body,
        sellerId: req.seller?._id || "missing",
        productId,
      });
      return next(new ErrorHandler(error.message, 400));
    }
  })
);

// Delete image from Cloudinary
router.post(
  "/delete-image",
  isSeller,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { public_id } = req.body;
      if (!public_id) {
        return next(new ErrorHandler("Public ID is required", 400));
      }
      const result = await cloudinary.v2.uploader.destroy(public_id);
      if (result.result !== "ok" && result.result !== "not found") {
        console.error("delete-image: Cloudinary deletion failed", {
          public_id,
          result,
        });
        return next(
          new ErrorHandler("Failed to delete image from Cloudinary", 500)
        );
      }
      console.info("delete-image: Image deleted successfully", { public_id });
      res.status(200).json({
        success: true,
        message: "Image deleted successfully",
      });
    } catch (error) {
      console.error("delete-image error:", {
        message: error.message,
        public_id: req.body.public_id,
      });
      return next(new ErrorHandler("Failed to delete image", 500));
    }
  })
);

// Delete product of a shop
router.delete(
  "/delete-shop-product/:id",
  isSeller,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const productId = req.params.id;
      if (!productId.match(/^[0-9a-fA-F]{24}$/)) {
        console.error("delete-shop-product: Invalid product ID format", {
          productId,
        });
        return next(new ErrorHandler("Invalid product ID format", 400));
      }

      const product = await Product.findById(productId).populate(
        "seller",
        "_id"
      );
      if (!product) {
        console.error("delete-shop-product: Product not found", { productId });
        return next(new ErrorHandler("Product not found", 404));
      }
      console.debug("delete-shop-product: Product fetched", {
        productId,
        sellerField: product.seller,
        reqSellerId: req.seller?._id,
      });
      if (
        !product.seller ||
        !req.seller?._id ||
        product.seller._id.toString() !== req.seller._id.toString()
      ) {
        console.error("delete-shop-product: Unauthorized access", {
          productId,
          sellerId: req.seller?._id,
          productSellerId: product.seller?._id,
        });
        return next(
          new ErrorHandler(
            "Unauthorized: Product does not belong to seller",
            403
          )
        );
      }

      // Delete images from Cloudinary with error handling
      for (const image of product.images) {
        if (image.public_id) {
          try {
            const result = await cloudinary.v2.uploader.destroy(
              image.public_id
            );
            if (result.result !== "ok" && result.result !== "not found") {
              console.warn("delete-shop-product: Cloudinary deletion failed", {
                public_id: image.public_id,
                result,
              });
            } else {
              console.info("delete-shop-product: Image deleted", {
                public_id: image.public_id,
              });
            }
          } catch (error) {
            console.warn("delete-shop-product: Cloudinary deletion error", {
              public_id: image.public_id,
              message: error.message,
            });
            // Continue deletion even if Cloudinary fails
          }
        }
      }

      await Product.deleteOne({ _id: productId });
      console.info("delete-shop-product: Product deleted successfully", {
        productId,
      });

      res.status(200).json({
        success: true,
        message: "Product deleted successfully",
      });
    } catch (error) {
      console.error("delete-shop-product error:", {
        message: error.message,
        productId: req.params.id,
        sellerId: req.seller?._id || "missing",
      });
      return next(new ErrorHandler(error.message, 400));
    }
  })
);

// Get all products of a shop
router.get(
  "/get-all-products-shop/:id",
  isSeller,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const shopId = req.params.id;
      const { page = 1, limit = 10 } = req.query;

      if (!shopId.match(/^[0-9a-fA-F]{24}$/)) {
        console.error("get-all-products-shop: Invalid shop ID format", {
          shopId,
        });
        return next(new ErrorHandler("Invalid shop ID format", 400));
      }

      const pageNum = parseInt(page);
      const limitNum = parseInt(limit);
      const skip = (pageNum - 1) * limitNum;

      const query = { shop: shopId };
      const total = await Product.countDocuments(query);
      const products = await Product.find(query)
        .populate("shop", "name")
        .populate("seller", "_id name")
        .skip(skip)
        .limit(limitNum)
        .sort({ createdAt: -1 });

      console.info("get-all-products-shop: Products retrieved successfully", {
        shopId,
        productCount: products.length,
        total,
        page: pageNum,
        limit: limitNum,
        productIds: products.map((p) => p._id.toString()),
        userId: req.user?._id,
      });

      res.status(200).json({
        success: true,
        products,
        pagination: {
          total,
          page: pageNum,
          pages: Math.ceil(total / limitNum),
          limit: limitNum,
        },
      });
    } catch (error) {
      console.error("get-all-products-shop error:", {
        message: error.message,
        shopId: req.params.id,
        userId: req.user?._id || "missing",
      });
      return next(new ErrorHandler(error.message, 400));
    }
  })
);

// Add product to flash sale
router.post(
  "/add-flash-sale/:id",
  isSeller,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const productId = req.params.id;
      const { discountPrice, startDate, endDate, stockLimit } = req.body;

      if (!productId.match(/^[0-9a-fA-F]{24}$/)) {
        console.error("add-flash-sale: Invalid product ID format", {
          productId,
        });
        return next(new ErrorHandler("Invalid product ID format", 400));
      }

      const product = await Product.findById(productId).populate(
        "seller",
        "_id"
      );
      if (!product) {
        console.error("add-flash-sale: Product not found", { productId });
        return next(new ErrorHandler("Product not found", 404));
      }

      if (
        !product.seller ||
        !req.seller?._id ||
        product.seller._id.toString() !== req.seller._id.toString()
      ) {
        console.error("add-flash-sale: Unauthorized access", {
          productId,
          sellerId: req.seller?._id,
          productSellerId: product.seller?._id,
        });
        return next(
          new ErrorHandler(
            "Unauthorized: Product does not belong to seller",
            403
          )
        );
      }

      if (
        !discountPrice ||
        !startDate ||
        !endDate ||
        stockLimit === undefined
      ) {
        return next(
          new ErrorHandler(
            "Missing required fields: discountPrice, startDate, endDate, stockLimit",
            400
          )
        );
      }

      if (discountPrice >= product.price) {
        return next(
          new ErrorHandler(
            "Flash sale price must be less than regular price",
            400
          )
        );
      }

      if (new Date(startDate) >= new Date(endDate)) {
        return next(new ErrorHandler("End date must be after start date", 400));
      }

      product.flashSale = {
        isActive: true,
        discountPrice: Number(discountPrice),
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        stockLimit: Number(stockLimit),
      };

      await product.save();
      console.info("add-flash-sale: Product added to flash sale", {
        productId,
      });
      res.status(200).json({
        success: true,
        product,
      });
    } catch (error) {
      console.error("add-flash-sale error:", {
        message: error.message,
        productId: req.params.id,
        sellerId: req.seller?._id || "missing",
      });
      return next(new ErrorHandler(error.message, 400));
    }
  })
);

// Remove product from flash sale
router.post(
  "/remove-flash-sale/:id",
  isSeller,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const productId = req.params.id;
      if (!productId.match(/^[0-9a-fA-F]{24}$/)) {
        console.error("remove-flash-sale: Invalid product ID format", {
          productId,
        });
        return next(new ErrorHandler("Invalid product ID format", 400));
      }

      const product = await Product.findById(productId).populate(
        "seller",
        "_id"
      );
      if (!product) {
        console.error("remove-flash-sale: Product not found", { productId });
        return next(new ErrorHandler("Product not found", 404));
      }

      if (
        !product.seller ||
        !req.seller?._id ||
        product.seller._id.toString() !== req.seller._id.toString()
      ) {
        console.error("remove-flash-sale: Unauthorized access", {
          productId,
          sellerId: req.seller?._id,
          productSellerId: product.seller?._id,
        });
        return next(
          new ErrorHandler(
            "Unauthorized: Product does not belong to seller",
            403
          )
        );
      }

      product.flashSale = {
        isActive: false,
        discountPrice: undefined,
        startDate: undefined,
        endDate: undefined,
        stockLimit: undefined,
      };

      await product.save();
      console.info("remove-flash-sale: Product removed from flash sale", {
        productId,
      });
      res.status(200).json({
        success: true,
        product,
      });
    } catch (error) {
      console.error("remove-flash-sale error:", {
        message: error.message,
        productId: req.params.id,
        sellerId: req.seller?._id || "missing",
      });
      return next(new ErrorHandler(error.message, 400));
    }
  })
);

// Get single product
router.get(
  "/get-product/:id",
  isSeller,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const productId = req.params.id;
      if (!productId.match(/^[0-9a-fA-F]{24}$/)) {
        console.error("get-product: Invalid product ID format", { productId });
        return next(new ErrorHandler("Invalid product ID format", 400));
      }

      const product = await Product.findById(productId)
        .populate("shop", "name")
        .populate("seller", "_id");
      if (!product) {
        console.error("get-product: Product not found", { productId });
        return next(new ErrorHandler("Product not found", 404));
      }
      console.debug("get-product: Product fetched", {
        productId,
        sellerField: product.seller,
        reqSellerId: req.seller?._id,
      });
      if (
        !product.seller ||
        !req.seller?._id ||
        product.seller._id.toString() !== req.seller._id.toString()
      ) {
        console.error("get-product: Unauthorized access", {
          productId,
          sellerId: req.seller?._id,
          productSellerId: product.seller?._id,
        });
        return next(
          new ErrorHandler(
            "Unauthorized: Product does not belong to seller",
            403
          )
        );
      }

      console.info("get-product: Product retrieved successfully", {
        productId,
      });
      res.status(200).json({
        success: true,
        product,
      });
    } catch (error) {
      console.error("get-product error:", {
        message: error.message,
        productId: req.params.id,
        sellerId: req.seller?._id || "missing",
      });
      return next(new ErrorHandler(error.message, 400));
    }
  })
);

// Get shop products by category
router.get(
  "/get-shop-products-by-category/:shopId/:category",
  isSeller,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { shopId, category } = req.params;
      const { page = 1, limit = 10 } = req.query;

      // Validate shop ID format
      if (!shopId.match(/^[0-9a-fA-F]{24}$/)) {
        console.error("get-shop-products-by-category: Invalid shop ID format", {
          shopId,
        });
        return next(new ErrorHandler("Invalid shop ID format", 400));
      }

      // Validate category
      const validCategories = [
        "electronics",
        "clothing",
        "home",
        "books",
        "toys",
        "food",
        "digital",
        "beauty",
        "sports",
        "jewelry",
        "automotive",
        "health",
        "baby",
        "pet",
        "office",
        "garden",
        "furniture",
        "appliances",
        "tools",
        "hair care",
        "skin care",
        "bags",
        "luggage",
        "shoes",
        "other",
      ];
      if (!validCategories.includes(category)) {
        return next(new ErrorHandler("Invalid category", 400));
      }

      // Check if the shop exists and belongs to the requesting seller
      const shop = await Shop.findById(shopId);
      if (!shop) {
        console.error("get-shop-products-by-category: Shop not found", {
          shopId,
        });
        return next(new ErrorHandler("Shop not found", 404));
      }

      if (shop._id.toString() !== req.seller._id.toString()) {
        console.error("get-shop-products-by-category: Unauthorized access", {
          shopId,
          sellerId: req.seller._id,
          shopOwnerId: shop._id,
        });
        return next(
          new ErrorHandler("Unauthorized: You don't own this shop", 403)
        );
      }

      const pageNum = parseInt(page);
      const limitNum = parseInt(limit);
      const skip = (pageNum - 1) * limitNum;

      const query = { shop: shopId, category };
      const total = await Product.countDocuments(query);
      const products = await Product.find(query)
        .populate("shop", "name")
        .populate("seller", "_id name")
        .skip(skip)
        .limit(limitNum)
        .sort({ createdAt: -1 });

      console.info(
 "get-shop-products-by-category: Products retrieved successfully",
        {
          shopId,
          category,
          productCount: products.length,
          total,
          page: pageNum,
          limit: limitNum,
          sellerId: req.seller._id,
        }
      );

      res.status(200).json({
        success: true,
        products,
        pagination: {
          total,
          page: pageNum,
          pages: Math.ceil(total / limitNum),
          limit: limitNum,
        },
      });
    } catch (error) {
      console.error("get-shop-products-by-category error:", {
        message: error.message,
        shopId: req.params.shopId,
        category: req.params.category,
        sellerId: req.seller?._id || "missing",
      });
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Get all categories
router.get(
  "/get-categories",
  catchAsyncErrors(async (req, res, next) => {
    try {
      const categories = [
        "electronics",
        "clothing",
        "home",
        "books",
        "toys",
        "food",
        "digital",
        "beauty",
        "sports",
        "jewelry",
        "automotive",
        "health",
        "baby",
        "pet",
        "office",
        "garden",
        "furniture",
        "appliances",
        "tools",
        "hair care",
        "skin care",
        "bags",
        "luggage",
        "shoes",
        "other",
      ];
      console.info("get-categories: Categories retrieved successfully", {
        categoryCount: categories.length,
      });
      res.status(200).json({
        success: true,
        categories,
      });
    } catch (error) {
      console.error("get-categories error:", { message: error.message });
      return next(new ErrorHandler(error.message, 400));
    }
  })
);

// Get products by category
router.get(
  "/get-products-by-category/:category",
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { category } = req.params;
      const { page = 1, limit = 10 } = req.query;

      const validCategories = [
        "electronics",
        "clothing",
        "home",
        "books",
        "toys",
        "food",
        "digital",
        "beauty",
        "sports",
        "jewelry",
        "automotive",
        "health",
        "baby",
        "pet",
        "office",
        "garden",
        "furniture",
        "appliances",
        "tools",
        "hair care",
        "skin care",
        "bags",
        "luggage",
        "shoes",
        "other",
      ];
      if (!validCategories.includes(category)) {
        return next(new ErrorHandler("Invalid category", 400));
      }

      const pageNum = parseInt(page);
      const limitNum = parseInt(limit);
      const skip = (pageNum - 1) * limitNum;

      const query = { category };
      const total = await Product.countDocuments(query);
      const products = await Product.find(query)
        .populate("shop", "name")
        .populate("seller", "_id name")
        .skip(skip)
        .limit(limitNum)
        .sort({ createdAt: -1 });

      console.info(
        "get-products-by-category: Products retrieved successfully",
        {
          category,
          productCount: products.length,
          total,
          page: pageNum,
          limit: limitNum,
          userId: req.user?._id,
        }
      );

      res.status(200).json({
        success: true,
        products,
        pagination: {
          total,
          page: pageNum,
          pages: Math.ceil(total / limitNum),
          limit: limitNum,
        },
      });
    } catch (error) {
      console.error("get-products-by-category error:", {
        message: error.message,
        category: req.params.category,
        userId: req.user?._id || "missing",
      });
      return next(new ErrorHandler(error.message, 400));
    }
  })
);

// Get most popular products
router.get(
  "/get-popular-products",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { page = 1, limit = 10 } = req.query;

      const pageNum = parseInt(page);
      const limitNum = parseInt(limit);
      const skip = (pageNum - 1) * limitNum;

      const total = await Product.countDocuments();
      const products = await Product.find()
        .sort({ sold_out: -1 })
        .skip(skip)
        .limit(limitNum)
        .populate("shop", "name")
        .populate("seller", "_id name");

      console.info("get-popular-products: Products retrieved successfully", {
        productCount: products.length,
        total,
        page: pageNum,
        limit: limitNum,
        userId: req.user?._id,
      });

      res.status(200).json({
        success: true,
        products,
        pagination: {
          total,
          page: pageNum,
          pages: Math.ceil(total / limitNum),
          limit: limitNum,
        },
      });
    } catch (error) {
      console.error("get-popular-products error:", {
        message: error.message,
        userId: req.user?._id || "missing",
      });
      return next(new ErrorHandler(error.message, 400));
    }
  })
);

// Get all products authenticated users
router.get(
  "/get-all-products",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { page = 1, limit = 10 } = req.query;

      const pageNum = parseInt(page);
      const limitNum = parseInt(limit);
      const skip = (pageNum - 1) * limitNum;

      const total = await Product.countDocuments();
      const products = await Product.find()
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .populate("shop", "name")
        .populate("seller", "_id name");

      console.info("get-all-products: Products retrieved successfully", {
        productCount: products.length,
        total,
        page: pageNum,
        limit: limitNum,
        userId: req.user?._id,
      });

      res.status(200).json({
        success: true,
        products,
        pagination: {
          total,
          page: pageNum,
          pages: Math.ceil(total / limitNum),
          limit: limitNum,
        },
      });
    } catch (error) {
      console.error("get-all-products error:", {
        message: error.message,
        userId: req.user?._id || "missing",
      });
      return next(new ErrorHandler(error.message, 400));
    }
  })
);

// Get all products of a shop (authenticated users)
router.get(
  "/get-all-public-products-shop/:id",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const shopId = req.params.id;
      const { page = 1, limit = 10 } = req.query;

      if (!shopId.match(/^[0-9a-fA-F]{24}$/)) {
        console.error("get-all-public-products-shop: Invalid shop ID format", {
          shopId,
        });
        return next(new ErrorHandler("Invalid shop ID format", 400));
      }

      const pageNum = parseInt(page);
      const limitNum = parseInt(limit);
      const skip = (pageNum - 1) * limitNum;

      const query = { shop: shopId };
      const total = await Product.countDocuments(query);
      const products = await Product.find(query)
        .populate("shop", "name")
        .populate("seller", "_id name")
        .skip(skip)
        .limit(limitNum)
        .sort({ createdAt: -1 });

      console.info(
        "get-all-public-products-shop: Products retrieved successfully",
        {
          shopId,
          productCount: products.length,
          total,
          page: pageNum,
          limit: limitNum,
          productIds: products.map((p) => p._id.toString()),
          userId: req.user?._id,
        }
      );

      res.status(200).json({
        success: true,
        products,
        pagination: {
          total,
          page: pageNum,
          pages: Math.ceil(total / limitNum),
          limit: limitNum,
        },
      });
    } catch (error) {
      console.error("get-all-products-shop error:", {
        message: error.message,
        shopId: req.params.id,
        userId: req.user?._id || "missing",
      });
      return next(new ErrorHandler(error.message, 400));
    }
  })
);

// Get single product (public, authenticated users)
router.get(
  "/get-product-public/:id",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const productId = req.params.id;
      if (!productId.match(/^[0-9a-fA-F]{24}$/)) {
        console.error("get-product-public: Invalid product ID format", {
          productId,
        });
        return next(new ErrorHandler("Invalid product ID format", 400));
      }

      const product = await Product.findById(productId)
        .populate("shop", "name")
        .populate("seller", "_id name");
      if (!product) {
        console.error("get-product-public: Product not found", { productId });
        return next(new ErrorHandler("Product not found", 404));
      }

      console.info("get-product-public: Product retrieved successfully", {
        productId,
        userId: req.user?._id,
      });
      res.status(200).json({
        success: true,
        product,
      });
    } catch (error) {
      console.error("get-product-public error:", {
        message: error.message,
        productId: req.params.id,
        userId: req.user?._id || "missing",
      });
      return next(new ErrorHandler(error.message, 400));
    }
  })
);

// Get new products
router.get(
  "/get-new-products",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { page = 1, limit = 10 } = req.query;

      const pageNum = parseInt(page);
      const limitNum = parseInt(limit);
      const skip = (pageNum - 1) * limitNum;

      const total = await Product.countDocuments();
      const products = await Product.find()
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .populate("shop", "name")
        .populate("seller", "_id name");

      console.info("get-new-products: Products retrieved successfully", {
        productCount: products.length,
        total,
        page: pageNum,
        limit: limitNum,
        userId: req.user?._id,
      });

      res.status(200).json({
        success: true,
        products,
        pagination: {
          total,
          page: pageNum,
          pages: Math.ceil(total / limitNum),
          limit: limitNum,
        },
      });
    } catch (error) {
      console.error("get-new-products error:", {
        message: error.message,
        userId: req.user?._id || "missing",
      });
      return next(new ErrorHandler(error.message, 400));
    }
  })
);

// Get top-rated products
router.get(
  "/get-top-rated-products",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { page = 1, limit = 10 } = req.query;

      const pageNum = parseInt(page);
      const limitNum = parseInt(limit);
      const skip = (pageNum - 1) * limitNum;

      const query = { ratingsAverage: { $gte: 4 } };
      const total = await Product.countDocuments(query);
      const products = await Product.find(query)
        .sort({ ratingsAverage: -1, ratingsQuantity: -1 })
        .skip(skip)
        .limit(limitNum)
        .populate("shop", "name")
        .populate("seller", "_id name");

      console.info("get-top-rated-products: Products retrieved successfully", {
        productCount: products.length,
        total,
        page: pageNum,
        limit: limitNum,
        userId: req.user?._id,
      });

      res.status(200).json({
        success: true,
        products,
        pagination: {
          total,
          page: pageNum,
          pages: Math.ceil(total / limitNum),
          limit: limitNum,
        },
      });
    } catch (error) {
      console.error("get-top-rated-products error:", {
        message: error.message,
        userId: req.user?._id || "missing",
      });
      return next(new ErrorHandler(error.message, 400));
    }
  })
);

// Get flash sale products
router.get(
  "/get-flash-sale-products",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { page = 1, limit = 10 } = req.query;

      const pageNum = parseInt(page);
      const limitNum = parseInt(limit);
      const skip = (pageNum - 1) * limitNum;

      const query = {
        "flashSale.isActive": true,
        "flashSale.endDate": { $gte: new Date() },
      };
      const total = await Product.countDocuments(query);
      const products = await Product.find(query)
        .sort({ "flashSale.endDate": 1 })
        .skip(skip)
        .limit(limitNum)
        .populate("shop", "name")
        .populate("seller", "_id name");

      console.info("get-flash-sale-products: Products retrieved successfully", {
        productCount: products.length,
        total,
        page: pageNum,
        limit: limitNum,
        userId: req.user?._id,
      });

      res.status(200).json({
        success: true,
        products,
        pagination: {
          total,
          page: pageNum,
          pages: Math.ceil(total / limitNum),
          limit: limitNum,
        },
      });
    } catch (error) {
      console.error("get-flash-sale-products error:", {
        message: error.message,
        userId: req.user?._id || "missing",
      });
      return next(new ErrorHandler(error.message, 400));
    }
  })
);

// Create product review
router.post(
  "/create-product-review/:productId",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { productId } = req.params;
      const { rating, comment, images } = req.body;

      if (!rating || rating < 1 || rating > 5) {
        return next(
          new ErrorHandler("Please provide a rating between 1-5", 400)
        );
      }

      const product = await Product.findById(productId);
      if (!product) {
        return next(new ErrorHandler("Product not found", 404));
      }

      const hasPurchased = await Order.exists({
        customer: req.user._id,
        "items.itemId": productId,
        status: "Delivered",
      });

      if (!hasPurchased && req.user.role !== "admin") {
        return next(
          new ErrorHandler(
            "You must purchase this product before leaving a review",
            403
          )
        );
      }

      const imagesLinks = [];
      if (images && Array.isArray(images)) {
        for (const image of images) {
          const result = await cloudinary.v2.uploader.upload(image, {
            folder: "reviews",
          });
          imagesLinks.push({
            public_id: result.public_id,
            url: result.secure_url,
          });
        }
      }

      const review = {
        user: req.user._id,
        name: req.user.fullname?.firstName || req.user.username,
        rating: Number(rating),
        comment,
        images: imagesLinks,
      };

      product.reviews.push(review);
      product.ratingsAverage =
        product.reviews.reduce((acc, item) => item.rating + acc, 0) /
        product.reviews.length;
      product.numOfReviews = product.reviews.length;

      await product.save();

      res.status(201).json({
        success: true,
        review,
        shareLink: `${process.env.FRONTEND_URL}/product/${productId}/reviews/${
          product.reviews[product.reviews.length - 1]._id
        }`,
      });
    } catch (error) {
      console.error("create-product-review error:", {
        message: error.message,
        productId: req.params.productId,
        userId: req.user?._id || "missing",
      });
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Get product review by ID (publicly accessible)
router.get(
  "/get-product-review/:productId/:reviewId",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { productId, reviewId } = req.params;

      const product = await Product.findById(productId);
      if (!product) {
        return next(new ErrorHandler("Product not found", 404));
      }

      const review = product.reviews.id(reviewId);
      if (!review) {
        return next(new ErrorHandler("Review not found", 404));
      }

      const user = await User.findById(review.user).select("username avatar");

      res.status(200).json({
        success: true,
        review: {
          ...review.toObject(),
          user: {
            username: user.username,
            avatar: user.avatar,
          },
        },
        product: {
          name: product.name,
          images: product.images,
          _id: product._id,
        },
      });
    } catch (error) {
      console.error("get-product-review error:", {
        message: error.message,
        productId: req.params.productId,
        reviewId: req.params.reviewId,
        userId: req.user?._id || "missing",
      });
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Get all products (admin)
router.get(
  "/admin-all-products",
  isAuthenticated,
  isAdmin("Admin"),
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { page = 1, limit = 10 } = req.query;

      const pageNum = parseInt(page);
      const limitNum = parseInt(limit);
      const skip = (pageNum - 1) * limitNum;

      const total = await Product.countDocuments();
      const products = await Product.find()
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .populate("shop", "name")
        .populate("seller", "_id name");

      console.info("admin-all-products: Products retrieved successfully", {
        productCount: products.length,
        total,
        page: pageNum,
        limit: limitNum,
        userId: req.user?._id,
      });

      res.status(200).json({
        success: true,
        products,
        pagination: {
          total,
          page: pageNum,
          pages: Math.ceil(total / limitNum),
          limit: limitNum,
        },
      });
    } catch (error) {
      console.error("admin-all-products error:", {
        message: error.message,
        userId: req.user?._id || "missing",
      });
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

module.exports = router;
