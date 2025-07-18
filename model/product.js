const mongoose = require("mongoose");
const slugify = require("slugify");

const productSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "A product must have a name"],
      trim: true,
      maxlength: [
        100,
        "A product name must have less or equal than 100 characters",
      ],
      minlength: [
        5,
        "A product name must have more or equal than 5 characters",
      ],
    },
    slug: String,
    description: {
      type: String,
      required: [true, "A product must have a description"],
      trim: true,
    },
    summary: {
      type: String,
      trim: true,
    },
    price: {
      type: Number,
      required: [true, "A product must have a price"],
      min: [0, "Price must be above 0"],
    },
    priceDiscount: {
      type: Number,
      validate: {
        validator: function (val) {
          return val === undefined || val < this.price;
        },
        message: "Discount price ({VALUE}) should be below regular price",
      },
    },
    flashSale: {
      isActive: { type: Boolean, default: false },
      discountPrice: {
        type: Number,
        validate: {
          validator: function (val) {
            return val === undefined || val < this.price;
          },
          message: "Flash sale price ({VALUE}) should be below regular price",
        },
      },
      startDate: { type: Date },
      endDate: { type: Date },
      stockLimit: {
        type: Number,
        min: [0, "Stock limit must be non-negative"],
      },
    },
    isMadeInCanada: {
      type: Boolean,
      default: false,
    },
    canadianCertification: {
      type: String,
      trim: true,
    },
    images: [
      {
        public_id: { type: String, required: false },
        url: { type: String, required: true },
      },
    ],
    imageCover: {
      public_id: String,
      url: String,
    },
    category: {
      type: String,
      required: [true, "A product must belong to a category"],
      enum: {
        values: [
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
        ],
        message:
          "Category must be one of: electronics, clothing, home, books, toys, food, digital, beauty, sports, jewelry, automotive, health, baby, pet, office, garden, furniture, appliances, tools, luggage, other",
      },
    },
    subCategory: String,
    tags: [String],
    ratingsAverage: {
      type: Number,
      default: 0,
      min: [0, "Rating must be above 0"],
      max: [5, "Rating must be below 5.0"],
      set: (val) => Math.round(val * 10) / 10,
    },
    ratingsQuantity: {
      type: Number,
      default: 0,
    },
    reviews: [
      {
        user: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          required: true,
        },
        name: { type: String, required: true },
        rating: { type: Number, required: true },
        comment: { type: String },
        images: [
          {
            public_id: { type: String },
            url: { type: String },
          },
        ],
        createdAt: { type: Date, default: Date.now },
      },
    ],
    ratings: { type: Number, default: 0 },
    numOfReviews: { type: Number, default: 0 },
    shop: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Shop",
      required: [true, "Product must belong to a shop"],
    },
    seller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Shop",
      required: [true, "Product must belong to a shop"],
    },
    status: {
      type: String,
      enum: ["draft", "active", "publish", "archived", "sold"],
      default: "active",
    },
    stock: {
      type: Number,
      required: [true, "A product must have stock quantity"],
      min: [0, "Stock must be above or equal to 0"],
    },
    sold_out: {
      type: Number,
      default: 0,
      min: [0, "Sold out quantity must be non-negative"],
    },
    variations: [
      {
        name: String,
        options: [String],
        price: Number,
        stock: Number,
        images: [{ public_id: String, url: String }],
      },
    ],
    shipping: {
      weight: Number,
      dimensions: {
        length: Number,
        width: Number,
        height: Number,
      },
      isFreeShipping: { type: Boolean, default: false },
      cost: { type: Number, default: 0 },
    },
    approved: {
      type: Boolean,
      default: false,
    },
    approvedBy: {
      type: mongoose.Schema.ObjectId,
      ref: "User",
    },
    approvedAt: Date,
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Indexes
productSchema.index({ price: 1, ratingsAverage: -1 });
productSchema.index({ slug: 1 });
productSchema.index({ shop: 1 });
productSchema.index({ seller: 1 });
productSchema.index({ isMadeInCanada: 1 });
productSchema.index({ category: 1 });
productSchema.index({ sold_out: -1 });
productSchema.index({ ratingsAverage: -1 });
productSchema.index({ createdAt: -1 });
productSchema.index({ priceDiscount: -1 });
productSchema.index({ "flashSale.isActive": 1, "flashSale.endDate": 1 });

// Document middleware: runs before .save() and .create()
productSchema.pre("save", function (next) {
  this.slug = slugify(this.name, { lower: true });
  next();
});

// Query middleware to populate shop and seller
productSchema.pre(/^find/, function (next) {
  this.populate([
    { path: "shop", select: "name email" },
    { path: "seller", select: "name email avatar" },
  ]);
  next();
});

module.exports = mongoose.model("Product", productSchema);
