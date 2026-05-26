// models/User.js
const mongoose = require('mongoose');

const withdrawalSchema = new mongoose.Schema({
  txId: String,
  amount: Number,
  currency: String,
  method: String,
  status: { type: String, enum: ['Pending', 'Successful', 'Rejected'] },
  reason: String,
  timestamp: { type: Date, default: Date.now }
}, { _id: false });

const userSchema = new mongoose.Schema({
  telegramId: { type: String, unique: true, required: true, index: true },
  username: String,
  fullName: String,
  coins: { type: Number, default: 0 },
  rupeeBalance: { type: Number, default: 0 },
  referralsCount: { type: Number, default: 0 },
  referredBy: String,
  claimedMilestones: [String],
  paymentMethod: { type: String, enum: ['NONE', 'UPI', 'PAYPAL'], default: 'NONE' },
  paymentId: { type: String, default: '' },
  dailyAdsViewed: { type: Number, default: 0 },
  dailyMathTasksDone: { type: Number, default: 0 },
  currentMathAnswer: { type: Number, default: null },
  mathTaskActive: { type: Boolean, default: false },
  lastInteractionTimestamp: { type: Date, default: Date.now },
  sundayAdsCount: { type: Number, default: 0 },
  hasUnlockedUnlimitedSunday: { type: Boolean, default: false },
  isVerified: { type: Boolean, default: false },
  isBanned: { type: Boolean, default: false },
  withdrawalHistory: [withdrawalSchema],
  spinStreak: { type: Number, default: 0 },
  lastSpinDate: Date
});

module.exports = mongoose.model('User', userSchema);
