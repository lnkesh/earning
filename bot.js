// ============================================================
// COMPLETE TELEGRAM BOT BACKEND - PRODUCTION READY
// Framework: Telegraf v4 + Mongoose + Express
// ============================================================

const { Telegraf, Markup, Scenes, session } = require('telegraf');
const mongoose = require('mongoose');
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const User = require('./models/User');

// ==================== CONFIGURATION ====================
const CONFIG = {
  TELEGRAM_TOKEN: '8794330876:AAHOf4D6RPDyzn34ZqEajutnc2hxM4hIa1c',
  MONGO_URI: 'mongodb+srv://lnkesh68:ankesh123@cluster0.gcabqgl.mongodb.net/telegramBot?retryWrites=true&w=majority',
  ADMIN_ID: '8949758794',
  GITHUB_PAGES_URL: 'https://lnkesh.github.io/earning',
  MONETAG_SCRIPT_ID: '11055841',
  REDEEM_CPAGRIP_URL: 'https://installyourfiles.com/1894012',
  SUNDAY_UNLOCK_CPAGRIP_URL: 'https://installyourfiles.com/1894012',
  CHANNEL_ID: '@earningbuddyoffcial',
  BACKEND_URL: 'https://earning-n0t3.onrender.com',
  BOT_TOKEN_HASH: ''
};

// Compute HMAC secret from bot token (for initData validation)
CONFIG.BOT_TOKEN_HASH = crypto.createHmac('sha256', 'WebAppData').update(CONFIG.TELEGRAM_TOKEN).digest();

// ==================== MONGODB CONNECTION ====================
mongoose.connect(CONFIG.MONGO_URI)
  .then(() => console.log('✅ MongoDB connected successfully'))
  .catch(err => { console.error('❌ MongoDB connection error:', err); process.exit(1); });

// ==================== BOT INITIALIZATION ====================
const bot = new Telegraf(CONFIG.TELEGRAM_TOKEN);

// State management for multi-step flows
const userStates = new Map(); // telegramId -> { state, data }

// ==================== HELPER FUNCTIONS ====================

async function getOrCreateUser(ctx) {
  const tg = ctx.from || ctx.update?.callback_query?.from || ctx.update?.message?.from;
  if (!tg) return null;
  let user = await User.findOne({ telegramId: String(tg.id) });
  if (!user) {
    user = new User({
      telegramId: String(tg.id),
      username: tg.username || '',
      fullName: [tg.first_name, tg.last_name].filter(Boolean).join(' ') || 'Unknown',
      lastInteractionTimestamp: new Date()
    });
    await user.save();
  }
  // Daily reset check
  const now = new Date();
  const last = user.lastInteractionTimestamp || new Date(0);
  if (last.toDateString() !== now.toDateString()) {
    user.dailyAdsViewed = 0;
    user.dailyMathTasksDone = 0;
    user.lastInteractionTimestamp = now;
    await user.save();
  }
  return user;
}

function isSunday() { return new Date().getDay() === 0; }
function isMonday() { return new Date().getDay() === 1; }

function validateInitData(initData) {
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    params.delete('hash');
    const dataCheckArr = [];
    for (const [key, val] of params.entries()) {
      dataCheckArr.push(key + '=' + val);
    }
    dataCheckArr.sort();
    const dataCheckString = dataCheckArr.join('\n');
    const computedHash = crypto.createHmac('sha256', CONFIG.BOT_TOKEN_HASH)
      .update(dataCheckString).digest('hex');
    if (computedHash !== hash) return null;
    const userData = JSON.parse(params.get('user') || '{}');
    return { userId: String(userData.id), username: userData.username || '', fullName: [userData.first_name, userData.last_name].filter(Boolean).join(' ') };
  } catch (e) {
    return null;
  }
}

function generateTxId() {
  return 'TX' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(3).toString('hex').toUpperCase();
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function checkChannelMembership(ctx, userId) {
  try {
    const member = await ctx.telegram.getChatMember(CONFIG.CHANNEL_ID, userId);
    return ['member', 'administrator', 'creator'].includes(member.status);
  } catch (e) {
    return false;
  }
}

async function processReferralBoom(user, ctx) {
  const milestones = [
    { count: 10, tag: 'BOOM_10', bonus: 500, label: '🔥 BOOM! 10 Referrals' },
    { count: 50, tag: 'BOOM_50', bonus: 3000, label: '💥 MEGA BOOM! 50 Referrals' },
    { count: 100, tag: 'BOOM_100', bonus: 10000, label: '🚀 ULTRA BOOM! 100 Referrals' }
  ];
  for (const m of milestones) {
    if (user.referralsCount >= m.count && !user.claimedMilestones.includes(m.tag)) {
      user.coins += m.bonus;
      user.claimedMilestones.push(m.tag);
      await user.save();
      try {
        await ctx.telegram.sendMessage(user.telegramId,
          `🎉 *${m.label} Achieved!*\n\n` +
          `You've referred *${m.count}* users!\n` +
          `💰 Bonus Reward: *+${m.bonus} Coins*\n` +
          `🏦 Total Balance: *${user.coins} Coins*\n\n` +
          `Keep sharing your referral link to earn more! 🚀`,
          { parse_mode: 'Markdown' }
        );
      } catch (e) { /* user may have blocked bot */ }
    }
  }
}

// ==================== MIDDLEWARE ====================

bot.use(async (ctx, next) => {
  if (ctx.from) {
    await getOrCreateUser(ctx);
  }
  return next();
});

// ==================== MAIN MENU KEYBOARD ====================

function getMainMenuKeyboard() {
  return Markup.keyboard([
    ['👤 Account & Profile', '📺 Daily Ads'],
    ['🧠 Math Tasks', '💰 Withdraw Money'],
    ['👥 Refer & Earn', '🎡 Daily Bonus'],
    ['🏆 Sunday Tournament', '💬 Contact Support'],
    ['ℹ️ Help & FAQ']
  ]).resize().persistent();
}

// ==================== VERIFICATION GATE ====================

async function verifyGate(ctx) {
  const user = await getOrCreateUser(ctx);
  if (!user) return false;
  if (user.isBanned) {
    await ctx.reply('🚫 *Your account has been banned.* Contact support for assistance.', { parse_mode: 'Markdown' });
    return false;
  }
  if (!user.isVerified) {
    const isMember = await checkChannelMembership(ctx, user.telegramId);
    if (isMember) {
      user.isVerified = true;
      await user.save();
      return true;
    }
    await ctx.reply(
      '🔒 *ACCESS RESTRICTED*\n\n' +
      'You must join our official channel to use this bot.\n\n' +
      '👇 Click below to join and verify:',
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.url('📢 Join Official Channel', `https://t.me/${CONFIG.CHANNEL_ID.replace('@', '')}`)],
          [Markup.button.callback('🔒 Verify Join', 'verify_join')]
        ])
      }
    );
    return false;
  }
  return true;
}

// ==================== /START COMMAND ====================

bot.start(async (ctx) => {
  const user = await getOrCreateUser(ctx);
  if (!user) return ctx.reply('❌ Error accessing your account. Please try again.');

  // Handle referral
  const startPayload = ctx.startPayload || ctx.message?.text?.split(' ')[1] || '';
  if (startPayload && startPayload !== String(user.telegramId) && !user.referredBy) {
    const inviter = await User.findOne({ telegramId: startPayload });
    if (inviter && inviter.telegramId !== user.telegramId) {
      user.referredBy = startPayload;
      await user.save();
      inviter.referralsCount += 1;
      inviter.coins += 100;
      await inviter.save();
      await processReferralBoom(inviter, ctx);
      try {
        await ctx.telegram.sendMessage(inviter.telegramId,
          `🎉 *New Referral!*\n\n👤 ${user.fullName} (@${user.username || 'N/A'}) joined using your link!\n💰 You earned *+100 Coins*!\n👥 Total Referrals: *${inviter.referralsCount}*`,
          { parse_mode: 'Markdown' }
        );
      } catch (e) { /* ignore */ }
    }
  }

  // Verification check
  const isMember = await checkChannelMembership(ctx, user.telegramId);
  if (!isMember) {
    user.isVerified = false;
    await user.save();
    return ctx.reply(
      '🔒 *WELCOME! ACCESS RESTRICTED*\n\n' +
      '👋 Hello ' + user.fullName + '!\n\n' +
      'To use this earning bot, you must first join our official channel.\n\n' +
      '👇 Click below:',
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.url('📢 Join Official Channel', `https://t.me/${CONFIG.CHANNEL_ID.replace('@', '')}`)],
          [Markup.button.callback('🔒 Verify Join', 'verify_join')]
        ])
      }
    );
  }

  user.isVerified = true;
  await user.save();
  return ctx.reply(
    `✅ *Welcome, ${user.fullName}!*\n\n` +
    `🎮 You now have full access to the earning dashboard!\n` +
    `💰 Balance: *${user.coins} Coins* | 💵 ₹${user.rupeeBalance}\n\n` +
    `📌 Use the menu below to start earning:`,
    { parse_mode: 'Markdown', ...getMainMenuKeyboard() }
  );
});

// ==================== VERIFY JOIN CALLBACK ====================

bot.action('verify_join', async (ctx) => {
  await ctx.answerCbQuery();
  const user = await getOrCreateUser(ctx);
  if (!user) return;
  const isMember = await checkChannelMembership(ctx, user.telegramId);
  if (isMember) {
    user.isVerified = true;
    await user.save();
    await ctx.editMessageText('✅ *Verified!*\n\nYou now have full access to the bot. Use the menu below:', { parse_mode: 'Markdown' });
    await ctx.reply('🎮 *Main Menu Activated!*', { parse_mode: 'Markdown', ...getMainMenuKeyboard() });
  } else {
    await ctx.editMessageText(
      '❌ *Not Yet Joined!*\n\nPlease join the channel first, then click verify again.',
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.url('📢 Join Official Channel', `https://t.me/${CONFIG.CHANNEL_ID.replace('@', '')}`)],
          [Markup.button.callback('🔒 Verify Join', 'verify_join')]
        ])
      }
    );
  }
});

// ==================== 1. ACCOUNT & PROFILE ====================

bot.hears('👤 Account & Profile', async (ctx) => {
  if (!(await verifyGate(ctx))) return;
  const user = await getOrCreateUser(ctx);
  if (!user) return;

  let usdEquivalent = '';
  if (user.paymentMethod === 'PAYPAL') {
    usdEquivalent = `\n💵 USD Equivalent: *$${(user.rupeeBalance / 83).toFixed(2)}* (1 USD = ₹83)`;
  }

  const last5Withdrawals = user.withdrawalHistory.slice(-5).reverse();
  let withdrawalText = '';
  if (last5Withdrawals.length === 0) {
    withdrawalText = '📭 No withdrawals yet.';
  } else {
    withdrawalText = last5Withdrawals.map(w =>
      `▸ ${w.txId.slice(-8)} | ₹${w.amount} | ${w.status}${w.reason ? ' - ' + w.reason : ''} | ${new Date(w.timestamp).toLocaleDateString()}`
    ).join('\n');
  }

  const msg = 
    `👤 *ACCOUNT & PROFILE*\n\n` +
    `📛 Name: *${user.fullName}*\n` +
    `🆔 ID: \`${user.telegramId}\`\n` +
    `👤 Username: @${user.username || 'N/A'}\n\n` +
    `💰 *Wallet Balance*\n` +
    `🪙 Coins: *${user.coins}*\n` +
    `💵 Rupee Balance: *₹${user.rupeeBalance}*${usdEquivalent}\n\n` +
    `💳 *Payment Method:* ${user.paymentMethod}\n` +
    `📧 Payment ID: \`${user.paymentId || 'Not Set'}\`\n\n` +
    `📜 *Last 5 Withdrawals:*\n${withdrawalText}\n\n` +
    `👥 Referrals: *${user.referralsCount}* (Min 5 for withdrawal)`;

  await ctx.reply(msg, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('✏️ Edit Payment Details', 'edit_payment')],
      [Markup.button.callback('🪙 Redeem Coins (1000 = ₹10)', 'redeem_coins')],
      [Markup.button.callback('💬 Contact Support', 'support_ticket')]
    ])
  });
});

// Edit Payment Details Flow
bot.action('edit_payment', async (ctx) => {
  await ctx.answerCbQuery();
  const user = await getOrCreateUser(ctx);
  if (!user) return;
  await ctx.editMessageText(
    '💳 *Edit Payment Details*\n\nChoose your payment method:',
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🏦 UPI / BHIM', 'set_method_UPI')],
        [Markup.button.callback('💳 PayPal', 'set_method_PAYPAL')],
        [Markup.button.callback('❌ Cancel', 'cancel_edit')]
      ])
    }
  );
});

bot.action('set_method_UPI', async (ctx) => {
  await ctx.answerCbQuery();
  userStates.set(String(ctx.from.id), { state: 'awaiting_upi_id' });
  await ctx.editMessageText('📝 *Please send your UPI ID now:*\n\nExample: `yourname@upi`', { parse_mode: 'Markdown' });
});

bot.action('set_method_PAYPAL', async (ctx) => {
  await ctx.answerCbQuery();
  userStates.set(String(ctx.from.id), { state: 'awaiting_paypal_email' });
  await ctx.editMessageText('📝 *Please send your PayPal Email now:*\n\nExample: `yourname@gmail.com`', { parse_mode: 'Markdown' });
});

bot.action('cancel_edit', async (ctx) => {
  await ctx.answerCbQuery();
  userStates.delete(String(ctx.from.id));
  await ctx.editMessageText('❌ Edit cancelled.');
});

// Handle payment ID text input
bot.on('text', async (ctx, next) => {
  const tgId = String(ctx.from?.id || '');
  const stateData = userStates.get(tgId);
  if (!stateData) return next();

  if (stateData.state === 'awaiting_upi_id') {
    const upiId = ctx.message.text.trim();
    if (!upiId.includes('@')) {
      return ctx.reply('⚠️ Invalid UPI ID format. Please send a valid UPI ID (e.g., name@upi):');
    }
    await User.findOneAndUpdate({ telegramId: tgId }, { paymentMethod: 'UPI', paymentId: upiId });
    userStates.delete(tgId);
    return ctx.reply('✅ *Payment method updated!*\n\n💳 UPI ID: `' + upiId + '`', { parse_mode: 'Markdown', ...getMainMenuKeyboard() });
  }

  if (stateData.state === 'awaiting_paypal_email') {
    const email = ctx.message.text.trim();
    if (!email.includes('@') || !email.includes('.')) {
      return ctx.reply('⚠️ Invalid email format. Please send a valid PayPal email:');
    }
    await User.findOneAndUpdate({ telegramId: tgId }, { paymentMethod: 'PAYPAL', paymentId: email });
    userStates.delete(tgId);
    return ctx.reply('✅ *Payment method updated!*\n\n💳 PayPal: `' + email + '`', { parse_mode: 'Markdown', ...getMainMenuKeyboard() });
  }

  if (stateData.state === 'awaiting_support_msg') {
    const user = await User.findOne({ telegramId: tgId });
    const msgText = ctx.message.text || '[Media/Attachment]';
    userStates.delete(tgId);
    try {
      await ctx.telegram.sendMessage(CONFIG.ADMIN_ID,
        `📬 *SUPPORT TICKET*\n👤 @${user?.username || 'N/A'} (ID: \`${tgId}\`)\n📝 Message:\n${msgText}`,
        { parse_mode: 'Markdown' }
      );
      await ctx.reply('✅ *Support ticket sent!*\n\nAdmin will reply here directly. Please be patient.', { parse_mode: 'Markdown', ...getMainMenuKeyboard() });
    } catch (e) {
      await ctx.reply('❌ Failed to send ticket. Please try again later.', { ...getMainMenuKeyboard() });
    }
    return;
  }

  if (stateData.state === 'awaiting_admin_reject_reason') {
    const reason = ctx.message.text.trim();
    const { targetUserId, txId, amount } = stateData.data || {};
    userStates.delete(tgId);
    const targetUser = await User.findOne({ telegramId: targetUserId });
    if (targetUser) {
      targetUser.rupeeBalance += amount;
      const withdrawal = targetUser.withdrawalHistory.find(w => w.txId === txId);
      if (withdrawal) {
        withdrawal.status = 'Rejected';
        withdrawal.reason = reason;
      }
      await targetUser.save();
      try {
        await ctx.telegram.sendMessage(targetUserId,
          `❌ *Your Withdrawal Request Is Rejected!*\n\n` +
          `💰 Amount: ₹${amount}\n⚠️ *Reason:* ${reason}\n\n` +
          `The amount has been refunded to your balance.`,
          { parse_mode: 'Markdown' }
        );
      } catch (e) { /* ignore */ }
      await ctx.reply(`✅ Withdrawal rejected. ₹${amount} refunded to user. Reason: ${reason}`, { ...getMainMenuKeyboard() });
    }
    return;
  }

  if (stateData.state === 'awaiting_math_answer') {
    return next(); // let math handler deal with it
  }

  return next();
});

// Redeem Coins
bot.action('redeem_coins', async (ctx) => {
  await ctx.answerCbQuery();
  const user = await getOrCreateUser(ctx);
  if (!user) return;
  if (user.coins < 1000) {
    return ctx.reply(`❌ *Insufficient Coins!*\n\nYou need at least *1000 coins* to redeem.\nCurrent balance: *${user.coins} coins*`, { parse_mode: 'Markdown' });
  }
  await ctx.reply(
    `🪙 *REDEEM 1000 COINS = ₹10*\n\n` +
    `Your Balance: *${user.coins} Coins*\n\n` +
    `⚠️ Complete the content locker to verify and receive ₹10.\n\n` +
    `👇 Click below to open the content locker:`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.url('🔓 Open Content Locker', CONFIG.REDEEM_CPAGRIP_URL)],
        [Markup.button.callback('✅ I\'ve Completed the Offer', 'confirm_redeem')]
      ])
    }
  );
});

bot.action('confirm_redeem', async (ctx) => {
  await ctx.answerCbQuery();
  const user = await getOrCreateUser(ctx);
  if (!user) return;
  if (user.coins < 1000) {
    return ctx.reply('❌ You no longer have enough coins. Redemption cancelled.');
  }
  user.coins -= 1000;
  user.rupeeBalance += 10;
  await user.save();
  await ctx.editMessageText(
    `✅ *Redemption Successful!*\n\n` +
    `🪙 -1000 Coins deducted\n💵 +₹10 added to wallet\n` +
    `💰 New Coin Balance: *${user.coins}*\n💵 New Rupee Balance: *₹${user.rupeeBalance}*`,
    { parse_mode: 'Markdown' }
  );
});

// Support ticket trigger
bot.action('support_ticket', async (ctx) => {
  await ctx.answerCbQuery();
  userStates.set(String(ctx.from.id), { state: 'awaiting_support_msg' });
  await ctx.reply('📬 *Send your issue description or attachment directly in a message below.*\n\nAdmin will reply here directly.', { parse_mode: 'Markdown' });
});

// ==================== 2. DAILY ADS ====================

bot.hears('📺 Daily Ads', async (ctx) => {
  if (!(await verifyGate(ctx))) return;
  const user = await getOrCreateUser(ctx);
  if (!user) return;

  if (isSunday()) {
    return ctx.reply('📺 On Sundays, please use the *🏆 Sunday Tournament* section for ads!', { parse_mode: 'Markdown' });
  }

  if (user.dailyAdsViewed >= 10) {
    return ctx.reply('🛑 *Daily Limit Reached!*\n\nYou have viewed 10/10 ads today.\nCome back tomorrow for more ads! 🔄', { parse_mode: 'Markdown' });
  }

  const remaining = 10 - user.dailyAdsViewed;
  await ctx.reply(
    `📺 *DAILY ADS*\n\n` +
    `📊 Viewed Today: *${user.dailyAdsViewed}/10*\n` +
    `🔄 Remaining: *${remaining}*\n\n` +
    `💰 Earn *30-50 Coins* per ad!\n\n` +
    `👇 Open the ad viewer below:`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.webApp('🎬 Watch Ads & Earn', `${CONFIG.GITHUB_PAGES_URL}?mode=ads&userId=${user.telegramId}`)],
        [Markup.button.callback('🔄 Refresh Status', 'refresh_ads')]
      ])
    }
  );
});

bot.action('refresh_ads', async (ctx) => {
  await ctx.answerCbQuery();
  const user = await getOrCreateUser(ctx);
  if (!user) return;
  await ctx.editMessageText(
    `📺 *DAILY ADS STATUS*\n\n📊 Viewed: *${user.dailyAdsViewed}/10*\n🔄 Remaining: *${10 - user.dailyAdsViewed}*\n💰 Balance: *${user.coins} Coins*`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.webApp('🎬 Watch Ads', `${CONFIG.GITHUB_PAGES_URL}?mode=ads&userId=${user.telegramId}`)],
        [Markup.button.callback('🔄 Refresh', 'refresh_ads')]
      ])
    }
  );
});

// ==================== 3. MATH TASKS ====================

bot.hears('🧠 Math Tasks', async (ctx) => {
  if (!(await verifyGate(ctx))) return;
  const user = await getOrCreateUser(ctx);
  if (!user) return;

  if (user.dailyMathTasksDone >= 5) {
    return ctx.reply('🛑 *Daily Math Limit Reached!*\n\nYou have completed 5/5 math tasks today.\nCome back tomorrow! 🔄', { parse_mode: 'Markdown' });
  }

  const a = randomInt(10, 99);
  const b = randomInt(10, 50);
  const ops = ['+', '-', '*'];
  const op = ops[randomInt(0, 2)];
  let answer;
  let question;
  switch (op) {
    case '+': answer = a + b; question = `${a} + ${b}`; break;
    case '-': answer = Math.max(a, b) - Math.min(a, b); question = `${Math.max(a, b)} - ${Math.min(a, b)}`; break;
    case '*': answer = a * b; question = `${a} × ${b}`; break;
    default: answer = a + b; question = `${a} + ${b}`;
  }

  user.currentMathAnswer = answer;
  await user.save();
  userStates.set(String(ctx.from.id), { state: 'awaiting_math_answer' });

  await ctx.reply(
    `🧠 *MATH TASK #${user.dailyMathTasksDone + 1}/5*\n\n` +
    `📐 Solve: *What is ${question}?*\n\n` +
    `💰 Reward: *20-30 Coins*\n` +
    `📝 Reply with your answer below:`,
    { parse_mode: 'Markdown' }
  );
});

// Handle math answer
bot.on('text', async (ctx, next) => {
  const tgId = String(ctx.from?.id || '');
  const stateData = userStates.get(tgId);
  if (!stateData || stateData.state !== 'awaiting_math_answer') return next();

  const user = await User.findOne({ telegramId: tgId });
  if (!user) return next();

  const userAnswer = parseInt(ctx.message.text.trim(), 10);
  if (isNaN(userAnswer)) {
    return ctx.reply('⚠️ Please send a valid number as your answer. Try again:');
  }

  if (userAnswer === user.currentMathAnswer) {
    const reward = randomInt(20, 30);
    user.dailyMathTasksDone += 1;
    user.coins += reward;
    user.currentMathAnswer = null;
    await user.save();
    userStates.delete(tgId);
    await ctx.reply(
      `✅ *CORRECT!*\n\n` +
      `🎉 You earned *+${reward} Coins*!\n` +
      `📊 Tasks Done Today: *${user.dailyMathTasksDone}/5*\n` +
      `💰 Total Coins: *${user.coins}*`,
      { parse_mode: 'Markdown', ...getMainMenuKeyboard() }
    );
  } else {
    await ctx.reply('❌ *Wrong Answer!*\n\nTry again. The question is still the same. Reply with your answer:', { parse_mode: 'Markdown' });
  }
});

// ==================== 4. WITHDRAW MONEY ====================

bot.hears('💰 Withdraw Money', async (ctx) => {
  if (!(await verifyGate(ctx))) return;
  const user = await getOrCreateUser(ctx);
  if (!user) return;

  if (user.paymentMethod === 'NONE' || !user.paymentId) {
    return ctx.reply(
      '⚠️ *Payment Method Not Set!*\n\nPlease set up your payment method first in *👤 Account & Profile* → *✏️ Edit Payment Details*.',
      { parse_mode: 'Markdown' }
    );
  }

  await ctx.reply(
    `💰 *WITHDRAW MONEY*\n\n` +
    `💵 Available Balance: *₹${user.rupeeBalance}*\n` +
    `💳 Method: *${user.paymentMethod}* (${user.paymentId})\n` +
    `👥 Referrals: *${user.referralsCount}/5*\n\n` +
    `⚠️ *Requirements:*\n` +
    `• Min 5 referrals\n` +
    `• Payment method set\n\n` +
    `👇 Select withdrawal amount:`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('₹100', 'withdraw_100'), Markup.button.callback('₹200', 'withdraw_200')],
        [Markup.button.callback('₹250', 'withdraw_250'), Markup.button.callback('₹500', 'withdraw_500')],
        [Markup.button.callback('₹1000', 'withdraw_1000')]
      ])
    }
  );
});

async function handleWithdraw(ctx, amount) {
  await ctx.answerCbQuery();
  const user = await getOrCreateUser(ctx);
  if (!user) return;

  if (user.paymentMethod === 'NONE' || !user.paymentId) {
    return ctx.reply('❌ Please set payment method first.');
  }
  if (user.referralsCount < 5) {
    return ctx.reply(`🛑 *Insufficient Referrals!*\n\nYou need at least *5 referrals* to withdraw.\nCurrent: *${user.referralsCount}* referrals.\n\nShare your referral link to earn more!`, { parse_mode: 'Markdown' });
  }
  if (user.rupeeBalance < amount) {
    return ctx.reply(`🛑 *Insufficient Balance!*\n\nYou need ₹${amount} but only have *₹${user.rupeeBalance}*.\nCurrent Balance: ₹${user.rupeeBalance}`, { parse_mode: 'Markdown' });
  }

  // Check for pending withdrawal
  const hasPending = user.withdrawalHistory.some(w => w.status === 'Pending');
  if (hasPending) {
    return ctx.reply('⚠️ *You already have a pending withdrawal!*\nPlease wait for admin to process it before requesting another.', { parse_mode: 'Markdown' });
  }

  const txId = generateTxId();
  user.rupeeBalance -= amount;
  user.withdrawalHistory.push({
    txId, amount, currency: 'INR',
    method: user.paymentMethod, status: 'Pending',
    reason: '', timestamp: new Date()
  });
  await user.save();

  await ctx.editMessageText(
    `✅ *Withdrawal Request Submitted!*\n\n` +
    `🔖 TX ID: \`${txId}\`\n💰 Amount: *₹${amount}*\n💳 Method: ${user.paymentMethod}\n` +
    `📌 Status: *Pending*\n\n` +
    `Admin will process your request shortly.`,
    { parse_mode: 'Markdown' }
  );

  // Notify admin
  try {
    await ctx.telegram.sendMessage(CONFIG.ADMIN_ID,
      `🚨 *NEW WITHDRAWAL REQUEST*\n\n` +
      `👤 User: @${user.username || 'N/A'} (ID: \`${user.telegramId}\`)\n` +
      `💰 Amount: *₹${amount}*\n💳 Method: *${user.paymentMethod}* (${user.paymentId})\n` +
      `👥 Referrals: *${user.referralsCount}/5*\n` +
      `🔖 TX ID: \`${txId}\``,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback(`🟢 Approve ${txId}`, `approve_${txId}`)],
          [Markup.button.callback(`🔴 Reject ${txId}`, `reject_${txId}`)]
        ])
      }
    );
  } catch (e) {
    console.error('Failed to notify admin:', e);
  }
}

bot.action(/^withdraw_(\d+)$/, async (ctx) => {
  const amount = parseInt(ctx.match[1], 10);
  await handleWithdraw(ctx, amount);
});

// ==================== 5. REFER & EARN ====================

bot.hears('👥 Refer & Earn', async (ctx) => {
  if (!(await verifyGate(ctx))) return;
  const user = await getOrCreateUser(ctx);
  if (!user) return;

  const refLink = `https://t.me/${ctx.botInfo?.username || 'your_bot'}?start=${user.telegramId}`;

  await ctx.reply(
    `👥 *REFER & EARN*\n\n` +
    `🔗 *Your Referral Link:*\n\`${refLink}\`\n\n` +
    `💰 *Rewards:*\n` +
    `• +100 Coins per referral\n` +
    `• Referral must join channel & verify\n\n` +
    `🎯 *REFERRAL BOOM MILESTONES:*\n` +
    `🔥 *10 Refs:* +500 Bonus Coins\n` +
    `💥 *50 Refs:* +3,000 Bonus Coins\n` +
    `🚀 *100 Refs:* +10,000 Mega Bonus Coins\n\n` +
    `📊 *Your Stats:*\n` +
    `👥 Total Referrals: *${user.referralsCount}*\n` +
    `🏆 Milestones Claimed: *${user.claimedMilestones.length > 0 ? user.claimedMilestones.join(', ') : 'None'}*\n\n` +
    `⚠️ *Minimum 5 active referrals required for any withdrawal.*`,
    { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.switchToChat('📤 Share Link', refLink)]]) }
  );
});

// ==================== 6. SPIN WHEEL (DAILY BONUS) ====================

bot.hears('🎡 Daily Bonus', async (ctx) => {
  if (!(await verifyGate(ctx))) return;
  const user = await getOrCreateUser(ctx);
  if (!user) return;

  const now = new Date();
  const lastSpin = user.lastSpinTimestamp ? new Date(user.lastSpinTimestamp) : null;

  // Check 24h cooldown
  if (lastSpin && (now.getTime() - lastSpin.getTime()) < 24 * 60 * 60 * 1000) {
    const hoursLeft = 24 - Math.floor((now.getTime() - lastSpin.getTime()) / (60 * 60 * 1000));
    const minsLeft = 60 - Math.floor(((now.getTime() - lastSpin.getTime()) % (60 * 60 * 1000)) / (60 * 1000));
    return ctx.reply(
      `⏳ *Spin Cooldown Active!*\n\n` +
      `You can spin again in approximately *${hoursLeft}h ${minsLeft}m*.\n\n` +
      `🔄 Come back after the cooldown for your next bonus!`,
      { parse_mode: 'Markdown' }
    );
  }

  // Determine if mega spin (7th day streak)
  const isMegaSpin = (user.spinStreak >= 6);
  const spinMode = isMegaSpin ? 'mega' : 'normal';

  await ctx.reply(
    `🎡 *DAILY BONUS SPIN*\n\n` +
    `🔥 Streak: *${user.spinStreak + 1} Day${user.spinStreak >= 1 ? 's' : ''}*\n` +
    `${isMegaSpin ? '🌟 *MEGA SPIN UNLOCKED!* Higher rewards await!\n\n' : ''}` +
    `👇 Open the spin wheel below:`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.webApp('🎡 Spin the Wheel!', `${CONFIG.GITHUB_PAGES_URL}?mode=spin&userId=${user.telegramId}&spinMode=${spinMode}`)]
      ])
    }
  );
});

// ==================== 7. SUNDAY TOURNAMENT ====================

bot.hears('🏆 Sunday Tournament', async (ctx) => {
  if (!(await verifyGate(ctx))) return;
  const user = await getOrCreateUser(ctx);
  if (!user) return;

  if (!isSunday()) {
    return ctx.reply('🏆 *Tournament is active only on Sundays!*\n\nCome back on Sunday to participate in the mega tournament and win the 1,000 Coins Grand Bonus! 🚀', { parse_mode: 'Markdown' });
  }

  // Fetch leaderboard
  const leaderboard = await User.find({ sundayAdsCount: { $gt: 0 } })
    .sort({ sundayAdsCount: -1 }).limit(10).select('username fullName sundayAdsCount telegramId');

  let lbText = '🏆 *SUNDAY MEGA TOURNAMENT*\n\n📊 *LIVE LEADERBOARD (Top 10):*\n\n';
  if (leaderboard.length === 0) {
    lbText += '📭 No participants yet! Be the first!\n\n';
  } else {
    leaderboard.forEach((u, i) => {
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
      lbText += `${medal} @${u.username || u.fullName}: *${u.sundayAdsCount} ads*\n`;
    });
  }

  const limitStatus = user.hasUnlockedUnlimitedSunday
    ? '🔓 *UNLIMITED MODE ACTIVE!*'
    : `📊 Viewed: *${user.sundayAdsCount}/20*`;

  const keyboard = [];
  if (!user.hasUnlockedUnlimitedSunday && user.sundayAdsCount < 20) {
    keyboard.push([Markup.button.webApp('📺 Watch Sunday Ads', `${CONFIG.GITHUB_PAGES_URL}?mode=tournament&userId=${user.telegramId}`)]);
  }
  if (user.sundayAdsCount >= 20 && !user.hasUnlockedUnlimitedSunday) {
    keyboard.push([Markup.button.url('🔥 Unlock Unlimited Ads', CONFIG.SUNDAY_UNLOCK_CPAGRIP_URL)]);
    keyboard.push([Markup.button.callback('✅ I\'ve Unlocked (Verify)', 'unlock_sunday')]);
  }
  if (user.hasUnlockedUnlimitedSunday) {
    keyboard.push([Markup.button.webapp('📺 Watch Unlimited Ads', `${CONFIG.GITHUB_PAGES_URL}?mode=tournament&userId=${user.telegramId}`)]);
  }

  await ctx.reply(
    lbText + `\n${limitStatus}\n💰 Your Coins: *${user.coins}*\n\n` +
    `🏅 *Grand Prize:* 1,000 Coins for the winner (min 30 ads)!\n⏰ Ends at 11:59 PM Sunday`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(keyboard.length > 0 ? keyboard : [[Markup.button.callback('🔄 Refresh', 'refresh_tournament')]])
    }
  );
});

bot.action('unlock_sunday', async (ctx) => {
  await ctx.answerCbQuery();
  const user = await getOrCreateUser(ctx);
  if (!user) return;
  user.hasUnlockedUnlimitedSunday = true;
  await user.save();
  await ctx.editMessageText(
    '🔓 *UNLIMITED ADS UNLOCKED!*\n\n' +
    'You can now watch unlimited ads for the rest of Sunday!\n' +
    'Keep climbing the leaderboard! 🚀',
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.webapp('📺 Watch Unlimited Ads', `${CONFIG.GITHUB_PAGES_URL}?mode=tournament&userId=${user.telegramId}`)],
        [Markup.button.callback('🔄 Refresh Leaderboard', 'refresh_tournament')]
      ])
    }
  );
});

bot.action('refresh_tournament', async (ctx) => {
  await ctx.answerCbQuery();
  const user = await getOrCreateUser(ctx);
  const leaderboard = await User.find({ sundayAdsCount: { $gt: 0 } })
    .sort({ sundayAdsCount: -1 }).limit(10).select('username fullName sundayAdsCount');

  let lbText = '📊 *LIVE LEADERBOARD:*\n\n';
  leaderboard.forEach((u, i) => {
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
    lbText += `${medal} @${u.username || u.fullName}: *${u.sundayAdsCount} ads*\n`;
  });
  lbText += `\n👤 You: *${user.sundayAdsCount} ads*`;

  await ctx.editMessageText(lbText, { parse_mode: 'Markdown' });
});

// ==================== 8. CONTACT SUPPORT ====================

bot.hears('💬 Contact Support', async (ctx) => {
  if (!(await verifyGate(ctx))) return;
  userStates.set(String(ctx.from.id), { state: 'awaiting_support_msg' });
  await ctx.reply('📬 *CONTACT SUPPORT*\n\nSend your issue description or attachment directly in a message below.\n\nAdmin will reply here directly. Please be patient. 🙏', { parse_mode: 'Markdown' });
});

// ==================== 9. HELP & FAQ ====================

bot.hears('ℹ️ Help & FAQ', async (ctx) => {
  if (!(await verifyGate(ctx))) return;
  await ctx.reply(
    `ℹ️ *HELP & FAQ*\n\n` +
    `📋 *TABLE OF CONTENTS*\n\n` +
    `*📺 Daily Ads (Mon-Sat):*\n` +
    `• Watch up to 10 ads/day\n` +
    `• Earn 30-50 Coins per ad\n` +
    `• Opens via Telegram Mini App\n\n` +
    `*🧠 Math Tasks (Daily):*\n` +
    `• Solve up to 5 math problems/day\n` +
    `• Earn 20-30 Coins per correct answer\n` +
    `• Wrong answers don\'t count against you\n\n` +
    `*💰 Withdrawals:*\n` +
    `• Min 5 referrals required\n` +
    `• Payment method must be set (UPI/PayPal)\n` +
    `• Amounts: ₹100, ₹200, ₹250, ₹500, ₹1000\n` +
    `• Processed by admin within 24-48 hours\n\n` +
    `*👥 Referral System:*\n` +
    `• +100 Coins per verified referral\n` +
    `• BOOM Bonuses: 10 refs (+500), 50 refs (+3000), 100 refs (+10000)\n\n` +
    `*🪙 Coin Redemption:*\n` +
    `• 1000 Coins = ₹10\n` +
    `• Requires content locker verification\n\n` +
    `*🎡 Daily Spin:*\n` +
    `• Spin once every 24 hours\n` +
    `• 7-day streak = Mega Spin with bigger prizes!\n\n` +
    `*🏆 Sunday Tournament:*\n` +
    `• Active Sundays only\n` +
    `• 20 free ads, then unlock unlimited\n` +
    `• Winner (min 30 ads): +1000 Coins Grand Bonus!\n\n` +
    `*💬 Support:* Use the Contact Support button.\n\n` +
    `⚙️ *Bot Version:* 2.0.0 | Made with ❤️`,
    { parse_mode: 'Markdown' }
  );
});

// ==================== ADMIN COMMANDS ====================

// Admin panel
bot.command('adminpanel', async (ctx) => {
  if (String(ctx.from.id) !== CONFIG.ADMIN_ID) return ctx.reply('🚫 Unauthorized.');
  const totalUsers = await User.countDocuments();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayActive = await User.countDocuments({ lastInteractionTimestamp: { $gte: today } });
  const pendingWithdrawals = await User.countDocuments({ 'withdrawalHistory.status': 'Pending' });

  await ctx.reply(
    `🛡️ *ADMIN CONTROL PANEL*\n\n` +
    `👥 Total Users: *${totalUsers}*\n` +
    `📊 Active Today: *${todayActive}*\n` +
    `💰 Pending Withdrawals: *${pendingWithdrawals}*\n\n` +
    `Commands:\n` +
    `📋 /users - Last 20 registered users\n` +
    `🔍 /search <username/id> - Search user\n` +
    `👤 /check <user_id> - Full user profile\n` +
    `📣 /broadcast - Send message to all users\n`,
    { parse_mode: 'Markdown' }
  );
});

bot.command('users', async (ctx) => {
  if (String(ctx.from.id) !== CONFIG.ADMIN_ID) return;
  const users = await User.find().sort({ createdAt: -1 }).limit(20).select('username telegramId coins rupeeBalance');
  let msg = '📋 *LAST 20 REGISTERED USERS:*\n\n';
  users.forEach((u, i) => {
    msg += `${i + 1}. 👤 @${u.username || 'N/A'} (ID: \`${u.telegramId}\`) - 🪙 ${u.coins} - 💵 ₹${u.rupeeBalance}\n`;
  });
  await ctx.reply(msg, { parse_mode: 'Markdown' });
});

bot.command('search', async (ctx) => {
  if (String(ctx.from.id) !== CONFIG.ADMIN_ID) return;
  const query = ctx.message.text.split(' ').slice(1).join(' ').trim();
  if (!query) return ctx.reply('Usage: /search <username or telegram ID>');

  let user = await User.findOne({ telegramId: query });
  if (!user) {
    user = await User.findOne({ username: { $regex: new RegExp('^' + query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i') } });
  }
  if (!user) return ctx.reply('❌ User not found.');

  await ctx.reply(formatUserProfile(user), { parse_mode: 'Markdown' });
});

bot.command('check', async (ctx) => {
  if (String(ctx.from.id) !== CONFIG.ADMIN_ID) return;
  const userId = ctx.message.text.split(' ')[1]?.trim();
  if (!userId) return ctx.reply('Usage: /check <telegram_id>');
  const user = await User.findOne({ telegramId: userId });
  if (!user) return ctx.reply('❌ User not found.');
  await ctx.reply(formatUserProfile(user), { parse_mode: 'Markdown' });
});

function formatUserProfile(user) {
  const wHistory = user.withdrawalHistory.slice(-10).reverse()
    .map(w => `▸ \`${w.txId.slice(-8)}\` | ₹${w.amount} | ${w.status}${w.reason ? ' (' + w.reason + ')' : ''} | ${new Date(w.timestamp).toLocaleDateString()}`)
    .join('\n') || 'None';

  return (
    `🔍 *USER PROFILE*\n\n` +
    `📛 Name: *${user.fullName}*\n` +
    `🆔 ID: \`${user.telegramId}\`\n` +
    `👤 Username: @${user.username || 'N/A'}\n` +
    `✅ Verified: ${user.isVerified ? 'Yes' : 'No'}\n` +
    `🚫 Banned: ${user.isBanned ? 'Yes' : 'No'}\n\n` +
    `💰 Coins: *${user.coins}*\n` +
    `💵 Rupee Balance: *₹${user.rupeeBalance}*\n` +
    `👥 Referrals: *${user.referralsCount}*\n` +
    `🏅 Milestones: ${user.claimedMilestones.join(', ') || 'None'}\n` +
    `💳 Payment: ${user.paymentMethod} | ${user.paymentId || 'N/A'}\n\n` +
    `📺 Ads Today: ${user.dailyAdsViewed}/10\n` +
    `🧠 Math Today: ${user.dailyMathTasksDone}/5\n` +
    `🎡 Spin Streak: ${user.spinStreak}\n` +
    `📅 Sunday Ads: ${user.sundayAdsCount} | Unlimited: ${user.hasUnlockedUnlimitedSunday ? 'Yes' : 'No'}\n\n` +
    `📜 *Withdrawal History (Last 10):*\n${wHistory}`
  );
}

// Broadcast
bot.command('broadcast', async (ctx) => {
  if (String(ctx.from.id) !== CONFIG.ADMIN_ID) return;
  userStates.set(String(ctx.from.id), { state: 'awaiting_broadcast' });
  await ctx.reply('📣 *BROADCAST MODE*\n\nSend the message you want to broadcast to all users (text/image/video).\n\nType /cancel to abort.', { parse_mode: 'Markdown' });
});

bot.command('cancel', async (ctx) => {
  if (String(ctx.from.id) !== CONFIG.ADMIN_ID) return;
  userStates.delete(String(ctx.from.id));
  await ctx.reply('❌ Operation cancelled.');
});

bot.on('message', async (ctx, next) => {
  const tgId = String(ctx.from?.id || '');
  const stateData = userStates.get(tgId);
  if (!stateData || stateData.state !== 'awaiting_broadcast') return next();

  if (tgId !== CONFIG.ADMIN_ID) return next();
  userStates.delete(tgId);

  const users = await User.find({ isVerified: true }).select('telegramId');
  let success = 0, fail = 0;

  await ctx.reply(`📣 Broadcasting to *${users.length}* users...`, { parse_mode: 'Markdown' });

  for (const u of users) {
    try {
      if (ctx.message.photo) {
        const photo = ctx.message.photo[ctx.message.photo.length - 1].file_id;
        await ctx.telegram.sendPhoto(u.telegramId, photo, {
          caption: ctx.message.caption || ''
        });
      } else if (ctx.message.video) {
        await ctx.telegram.sendVideo(u.telegramId, ctx.message.video.file_id, {
          caption: ctx.message.caption || ''
        });
      } else if (ctx.message.text) {
        await ctx.telegram.sendMessage(u.telegramId, ctx.message.text, { parse_mode: 'Markdown' });
      }
      success++;
    } catch (e) {
      fail++;
    }
  }

  await ctx.reply(`✅ *Broadcast Complete!*\n\n📊 Sent: ${success}\n❌ Failed: ${fail}`, { parse_mode: 'Markdown' });
});

// ==================== ADMIN APPROVE/REJECT ACTIONS ====================

bot.action(/^approve_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  if (String(ctx.from.id) !== CONFIG.ADMIN_ID) return;
  const txId = ctx.match[1];

  const user = await User.findOne({ 'withdrawalHistory.txId': txId });
  if (!user) return ctx.reply('❌ Transaction not found.');

  const withdrawal = user.withdrawalHistory.find(w => w.txId === txId);
  if (!withdrawal || withdrawal.status !== 'Pending') return ctx.reply('❌ This transaction is no longer pending.');

  await ctx.editMessageReplyMarkup({
    inline_keyboard: [[
      { text: '💸 Confirm: Withdrawal Success', callback_data: `confirm_success_${txId}` }
    ]]
  });
  await ctx.reply('⚠️ Click the button above to confirm after completing the manual bank transfer.');
});

bot.action(/^confirm_success_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  if (String(ctx.from.id) !== CONFIG.ADMIN_ID) return;
  const txId = ctx.match[1];

  const user = await User.findOne({ 'withdrawalHistory.txId': txId });
  if (!user) return ctx.reply('❌ Transaction not found.');

  const withdrawal = user.withdrawalHistory.find(w => w.txId === txId);
  if (!withdrawal) return ctx.reply('❌ Transaction not found.');

  withdrawal.status = 'Successful';
  await user.save();

  await ctx.editMessageText(
    `✅ *WITHDRAWAL APPROVED & CONFIRMED*\n\n👤 User: @${user.username} (ID: \`${user.telegramId}\`)\n💰 Amount: ₹${withdrawal.amount}\n🔖 TX: \`${txId}\`\n📌 Status: *Successful*`,
    { parse_mode: 'Markdown' }
  );

  try {
    await ctx.telegram.sendMessage(user.telegramId,
      `🎉 *Your Withdrawal Request Is Successful!*\n\n` +
      `💰 Amount: *₹${withdrawal.amount}*\n💳 Method: ${withdrawal.method}\n` +
      `🔖 TX ID: \`${txId}\`\n\n` +
      `Thank you for using our platform! 🙏`,
      { parse_mode: 'Markdown' }
    );
  } catch (e) { /* ignore */ }
});

bot.action(/^reject_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  if (String(ctx.from.id) !== CONFIG.ADMIN_ID) return;
  const txId = ctx.match[1];

  const user = await User.findOne({ 'withdrawalHistory.txId': txId });
  if (!user) return ctx.reply('❌ Transaction not found.');

  const withdrawal = user.withdrawalHistory.find(w => w.txId === txId);
  if (!withdrawal || withdrawal.status !== 'Pending') return ctx.reply('❌ This transaction is no longer pending.');

  userStates.set(String(ctx.from.id), {
    state: 'awaiting_admin_reject_reason',
    data: { targetUserId: user.telegramId, txId, amount: withdrawal.amount }
  });

  await ctx.editMessageText(
    `🔴 *REJECT WITHDRAWAL*\n\n👤 @${user.username} | ₹${withdrawal.amount}\n\n📝 *Type the rejection reason below:*`,
    { parse_mode: 'Markdown' }
  );
});

// ==================== ADMIN REPLY TO SUPPORT ====================

bot.on('message', async (ctx, next) => {
  if (String(ctx.from?.id) !== CONFIG.ADMIN_ID) return next();
  const replyTo = ctx.message?.reply_to_message;
  if (!replyTo) return next();

  // Check if the replied message is a support ticket
  const text = replyTo.text || replyTo.caption || '';
  const match = text.match(/ID:\s*`?(\d+)`?/);
  if (!match) return next();

  const targetUserId = match[1];
  const adminReply = ctx.message.text || ctx.message.caption || '';

  try {
    if (ctx.message.photo) {
      const photo = ctx.message.photo[ctx.message.photo.length - 1].file_id;
      await ctx.telegram.sendPhoto(targetUserId, photo, { caption: `📬 *Admin Reply:*\n${adminReply}`, parse_mode: 'Markdown' });
    } else {
      await ctx.telegram.sendMessage(targetUserId, `📬 *Admin Reply:*\n\n${adminReply}`, { parse_mode: 'Markdown' });
    }
    await ctx.reply('✅ Reply sent to user.');
  } catch (e) {
    await ctx.reply('❌ Failed to send reply. User may have blocked the bot.');
  }
});

// ==================== API ENDPOINTS (EXPRESS) ====================

const app = express();
app.use(cors());
app.use(express.json());

// POST /api/spin - Handle spin wheel result
app.post('/api/spin', async (req, res) => {
  try {
    const { initData, prize, spinMode } = req.body;
    const validated = validateInitData(initData);
    if (!validated) return res.status(401).json({ error: 'Invalid initData' });

    const user = await User.findOne({ telegramId: validated.userId });
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Check 24h cooldown
    const now = new Date();
    const lastSpin = user.lastSpinTimestamp ? new Date(user.lastSpinTimestamp) : null;
    if (lastSpin && (now.getTime() - lastSpin.getTime()) < 23 * 60 * 60 * 1000) {
      return res.status(429).json({ error: 'Cooldown active', nextSpin: new Date(lastSpin.getTime() + 24 * 60 * 60 * 1000).toISOString() });
    }

    let coinReward = parseInt(prize, 10) || 10;

    // If mega spin, ensure reward is from mega range
    if (spinMode === 'mega') {
      const megaPrizes = [100, 150, 200, 300, 500, 750, 1000];
      if (!megaPrizes.includes(coinReward)) {
        coinReward = megaPrizes[Math.floor(Math.random() * megaPrizes.length)];
      }
    }

    user.coins += coinReward;
    user.lastSpinTimestamp = now;

    // Streak logic
    if (lastSpin) {
      const daysSinceLastSpin = Math.floor((now.getTime() - lastSpin.getTime()) / (24 * 60 * 60 * 1000));
      if (daysSinceLastSpin <= 2) {
        user.spinStreak = (user.spinStreak % 7) + 1;
      } else {
        user.spinStreak = 1; // reset streak
      }
    } else {
      user.spinStreak = 1;
    }

    await user.save();

    return res.json({
      success: true,
      coinReward,
      totalCoins: user.coins,
      spinStreak: user.spinStreak,
      isMegaSpin: user.spinStreak >= 7,
      nextSpin: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString()
    });
  } catch (e) {
    console.error('Spin API error:', e);
    return res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/ads-callback - Handle ad completion
app.post('/api/ads-callback', async (req, res) => {
  try {
    const { initData, adsCount = 1 } = req.body;
    const validated = validateInitData(initData);
    if (!validated) return res.status(401).json({ error: 'Invalid initData' });

    const user = await User.findOne({ telegramId: validated.userId });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const now = new Date();
    const isSundayNow = now.getDay() === 0;

    let totalReward = 0;

    if (isSundayNow) {
      // Sunday tournament mode
      if (!user.hasUnlockedUnlimitedSunday && user.sundayAdsCount + adsCount > 20) {
        return res.status(400).json({ error: 'Sunday free limit reached. Unlock unlimited first.' });
      }
      user.sundayAdsCount += adsCount;
      totalReward = randomInt(30, 50) * adsCount;
    } else {
      // Normal daily ads
      if (user.dailyAdsViewed + adsCount > 10) {
        return res.status(400).json({ error: 'Daily limit reached' });
      }
      user.dailyAdsViewed += adsCount;
      totalReward = randomInt(30, 50) * adsCount;
    }

    user.coins += totalReward;
    await user.save();

    return res.json({
      success: true,
      reward: totalReward,
      totalCoins: user.coins,
      dailyAdsViewed: user.dailyAdsViewed,
      sundayAdsCount: user.sundayAdsCount,
      remaining: isSundayNow
        ? (user.hasUnlockedUnlimitedSunday ? 'Unlimited' : 20 - user.sundayAdsCount)
        : 10 - user.dailyAdsViewed
    });
  } catch (e) {
    console.error('Ads callback error:', e);
    return res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/leaderboard - Tournament leaderboard
app.get('/api/leaderboard', async (req, res) => {
  try {
    const leaderboard = await User.find({ sundayAdsCount: { $gt: 0 } })
      .sort({ sundayAdsCount: -1 })
      .limit(10)
      .select('username fullName sundayAdsCount telegramId');
    return res.json({ leaderboard });
  } catch (e) {
    return res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/user/:id - Get user stats (for webapp)
app.get('/api/user/:id', async (req, res) => {
  try {
    const user = await User.findOne({ telegramId: req.params.id })
      .select('coins rupeeBalance dailyAdsViewed dailyMathTasksDone sundayAdsCount hasUnlockedUnlimitedSunday spinStreak lastSpinTimestamp referralsCount');
    if (!user) return res.status(404).json({ error: 'User not found' });
    return res.json({ user });
  } catch (e) {
    return res.status(500).json({ error: 'Server error' });
  }
});

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// ==================== SUNDAY MIDNIGHT TOURNAMENT CHECK ====================

setInterval(async () => {
  try {
    const now = new Date();
    // Check at Monday 00:00-00:05
    if (now.getDay() === 1 && now.getHours() === 0 && now.getMinutes() < 5) {
      const winner = await User.findOne({ sundayAdsCount: { $gte: 30 } })
        .sort({ sundayAdsCount: -1 });

      if (winner) {
        winner.coins += 1000;
        await winner.save();

        // Broadcast to all users
        const allUsers = await User.find({ isVerified: true }).select('telegramId');
        for (const u of allUsers) {
          try {
            await bot.telegram.sendMessage(u.telegramId,
              `🏆 *SUNDAY TOURNAMENT WINNER!*\n\n` +
              `🎉 Congratulations to @${winner.username || winner.fullName}!\n` +
              `📊 Total Ads Watched: *${winner.sundayAdsCount}*\n` +
              `💰 Grand Prize: *+1,000 Coins!*\n\n` +
              `🚀 Next tournament this Sunday! Be ready!`,
              { parse_mode: 'Markdown' }
            );
          } catch (e) { /* ignore */ }
        }

        // Notify winner
        try {
          await bot.telegram.sendMessage(winner.telegramId,
            `🏆 *YOU WON THE SUNDAY TOURNAMENT!*\n\n` +
            `🎉 Congratulations! You are the champion!\n` +
            `📊 Ads Watched: *${winner.sundayAdsCount}*\n` +
            `💰 Prize: *+1,000 Coins* credited to your wallet!\n` +
            `🏦 New Balance: *${winner.coins} Coins*\n\n` +
            `See you next Sunday! 🚀`,
            { parse_mode: 'Markdown' }
          );
        } catch (e) { /* ignore */ }
      }

      // Reset all sunday counts
      await User.updateMany({}, { sundayAdsCount: 0, hasUnlockedUnlimitedSunday: false });
      console.log('🏆 Sunday tournament ended. Winner:', winner?.username || 'None (min 30 ads not met)');
    }
  } catch (e) {
    console.error('Tournament check error:', e);
  }
}, 60 * 1000); // Check every minute

// ==================== START SERVER ====================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🌐 Express API server running on port ${PORT}`);
});

// Start Telegram bot with polling
bot.launch()
  .then(() => console.log('🤖 Telegram Bot started successfully!'))
  .catch(err => {
    console.error('❌ Bot launch error:', err);
    process.exit(1);
  });

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

console.log('========================================');
console.log('🚀 CYBERPUNK EARNING BOT - FULLY OPERATIONAL');
console.log('========================================');
