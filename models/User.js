const mongoose = require('mongoose');

const withdrawalSchema = new mongoose.Schema({
  txId: { type: String, required: true },
  amount: { type: Number, required: true },
  currency: { type: String, enum: ['INR', 'USD'], default: 'INR' },
  method: { type: String, enum: ['UPI', 'PAYPAL'], required: true },
  status: { type: String, enum: ['Pending', 'Successful', 'Rejected'], default: 'Pending' },
  reason: { type: String, default: '' },
  timestamp: { type: Date, default: Date.now }
}, { _id: true });

const userSchema = new mongoose.Schema({
  telegramId: { type: String, unique: true, required: true, index: true },
  username: { type: String, default: '' },
  fullName: { type: String, default: '' },
  coins: { type: Number, default: 0 },
  rupeeBalance: { type: Number, default: 0 },
  referralsCount: { type: Number, default: 0 },
  referredBy: { type: String, default: '' },
  claimedMilestones: { type: [String], default: [] },
  paymentMethod: { type: String, enum: ['NONE', 'UPI', 'PAYPAL'], default: 'NONE' },
  paymentId: { type: String, default: '' },
  dailyAdsViewed: { type: Number, default: 0 },
  dailyMathTasksDone: { type: Number, default: 0 },
  currentMathAnswer: { type: Number, default: null },
  lastInteractionTimestamp: { type: Date, default: Date.now },
  lastSpinTimestamp: { type: Date, default: null },
  spinStreak: { type: Number, default: 0 },
  sundayAdsCount: { type: Number, default: 0 },
  hasUnlockedUnlimitedSunday: { type: Boolean, default: false },
  isVerified: { type: Boolean, default: false },
  isBanned: { type: Boolean, default: false },
  withdrawalHistory: { type: [withdrawalSchema], default: [] }
}, { timestamps: true });

// Pre-save hook: auto-reset daily counters if day changed
userSchema.pre('save', function (next) {
  const now = new Date();
  const last = this.lastInteractionTimestamp || this.createdAt || new Date(0);
  if (last.toDateString() !== now.toDateString()) {
    this.dailyAdsViewed = 0;
    this.dailyMathTasksDone = 0;
    this.lastInteractionTimestamp = now;
  }
  // Reset sundayAdsCount if not Sunday
  if (now.getDay() !== 0 && this.sundayAdsCount > 0) {
    this.sundayAdsCount = 0;
    this.hasUnlockedUnlimitedSunday = false;
  }
  next();
});

module.exports = mongoose.model('User', userSchema);
