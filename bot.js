// bot.js
const { Telegraf, Markup } = require('telegraf');
const mongoose = require('mongoose');
const cron = require('node-cron');
const express = require('express');
const crypto = require('crypto');
const User = require('./models/User');

// ==================== CONFIGURATION ====================
const CONFIG = {
  TELEGRAM_TOKEN: "8794330876:AAHOf4D6RPDyzn34ZqEajutnc2hxM4hIa1c",
  MONGO_URI: "mongodb+srv://lnkesh68:ankesh123@cluster0.gcabqgl.mongodb.net",
  ADMIN_ID: "8949758794",
  GITHUB_PAGES_URL: "https://lnkesh.github.io/earning",
  MONETAG_SCRIPT_ID: "11055841",
  REDEEM_CPAGRIP_URL: "https://installyourfiles.com/1894012",
  SUNDAY_UNLOCK_CPAGRIP_URL: "https://installyourfiles.com/1894012",
  CHANNEL_ID: "@earningbuddyoffcial",   // 🔁 REPLACE with your channel username (e.g., "@myofficialchannel")
  BACKEND_URL:"https://earning-n0t3.onrender.com" // 🔁 REPLACE with your deployed backend URL
};

// ==================== DATABASE ====================
mongoose.connect(CONFIG.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('MongoDB error:', err));

// ==================== EXPRESS SERVER ====================
const app = express();
app.use(express.json());

app.get('/', (_, res) => res.send('Bot is running'));

// ==================== TELEGRAF BOT ====================
const bot = new Telegraf(CONFIG.TELEGRAM_TOKEN);

// Temporary states
const adminSessions = new Map();   // adminId -> { action, txId, userId }
const supportState = new Map();    // userId -> true

// ==================== HELPERS ====================

function verifyTelegramWebAppData(initData) {
  const urlParams = new URLSearchParams(initData);
  const hash = urlParams.get('hash');
  urlParams.delete('hash');
  const dataCheckArr = [];
  const keys = Array.from(urlParams.keys()).sort();
  for (const key of keys) {
    dataCheckArr.push(`${key}=${urlParams.get(key)}`);
  }
  const dataCheckString = dataCheckArr.join('\n');
  const secretKey = crypto.createHmac('sha256', 'WebAppData')
    .update(CONFIG.TELEGRAM_TOKEN)
    .digest();
  const computedHash = crypto.createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');
  return computedHash === hash;
}

async function requireVerified(ctx, next) {
  const user = await User.findOne({ telegramId: ctx.from.id.toString() });
  if (!user || !user.isVerified) {
    return sendVerificationMessage(ctx);
  }
  return next();
}

function sendVerificationMessage(ctx) {
  const joinButton = Markup.button.url('📢 Join Official Channel', `https://t.me/${CONFIG.CHANNEL_ID.replace('@','')}`);
  const verifyButton = Markup.button.callback('🔒 Verify Join', 'verify_join');
  return ctx.reply(
    '⚠️ *Access Restricted*\n\nYou must join our official channel to use this bot.\n\nClick below to join, then press "Verify Join".',
    { parse_mode: 'Markdown', ...Markup.inlineKeyboard([ [joinButton], [verifyButton] ]) }
  );
}

const userMainKeyboard = Markup.keyboard([
  ['👤 Account & Profile', '📺 Daily Ads'],
  ['🧠 Math Tasks', '💰 Withdraw Money'],
  ['👥 Refer & Earn', '🎡 Daily Bonus'],
  ['🏆 Sunday Tournament', '💬 Contact Support'],
  ['ℹ️ Help & FAQ']
]).resize().persistent();

const adminMainKeyboard = Markup.keyboard([
  ['👤 Account & Profile', '📺 Daily Ads'],
  ['🧠 Math Tasks', '💰 Withdraw Money'],
  ['👥 Refer & Earn', '🎡 Daily Bonus'],
  ['🏆 Sunday Tournament', '💬 Contact Support'],
  ['ℹ️ Help & FAQ', '📢 Broadcast'],
  ['📊 Admin Panel']
]).resize().persistent();

// ==================== START ====================
bot.start(async (ctx) => {
  const telegramId = ctx.from.id.toString();
  let user = await User.findOne({ telegramId });

  if (!user) {
    const ref = ctx.startPayload;
    const newUser = new User({
      telegramId,
      username: ctx.from.username || '',
      fullName: ctx.from.first_name + (ctx.from.last_name ? ' ' + ctx.from.last_name : ''),
      referredBy: ref || undefined
    });
    user = await newUser.save();

    if (ref) {
      const inviter = await User.findOne({ telegramId: ref });
      if (inviter) {
        inviter.referralsCount += 1;
        await inviter.save();
      }
    }
  }

  if (user.isVerified) {
    const keyboard = ctx.from.id.toString() === CONFIG.ADMIN_ID ? adminMainKeyboard : userMainKeyboard;
    await ctx.reply('👋 Welcome back! Choose an option below:', keyboard);
  } else {
    await sendVerificationMessage(ctx);
  }
});

// ==================== VERIFY JOIN ====================
bot.action('verify_join', async (ctx) => {
  const userId = ctx.from.id.toString();
  try {
    const chatMember = await ctx.telegram.getChatMember(CONFIG.CHANNEL_ID, userId);
    if (['member', 'administrator', 'creator'].includes(chatMember.status)) {
      await User.findOneAndUpdate({ telegramId: userId }, { isVerified: true });
      const user = await User.findOne({ telegramId: userId });
      if (user.referredBy) {
        const inviter = await User.findOne({ telegramId: user.referredBy });
        if (inviter) {
          inviter.coins += 100;
          await inviter.save();
          await checkReferralBoom(inviter, ctx);
        }
      }
      const keyboard = ctx.from.id.toString() === CONFIG.ADMIN_ID ? adminMainKeyboard : userMainKeyboard;
      await ctx.editMessageText('✅ Verification successful! You can now use the bot.');
      await ctx.reply('👇 Choose an option:', keyboard);
      return ctx.answerCbQuery('Verified!');
    } else {
      return ctx.answerCbQuery('❌ You have not joined the channel yet!');
    }
  } catch (err) {
    console.error(err);
    return ctx.answerCbQuery('Error checking membership. Try again later.');
  }
});

// ==================== ACCOUNT & PROFILE ====================
bot.hears('👤 Account & Profile', async (ctx) => {
  await requireVerified(ctx, async () => {
    const user = await User.findOne({ telegramId: ctx.from.id.toString() });
    if (!user) return ctx.reply('User not found.');

    let payMethodStr = 'Not set';
    if (user.paymentMethod !== 'NONE') {
      payMethodStr = `${user.paymentMethod}: ${user.paymentId}`;
    }

    let usdEquivalent = '';
    if (user.paymentMethod === 'PAYPAL' && user.rupeeBalance > 0) {
      usdEquivalent = ` (≈ $${(user.rupeeBalance / 83).toFixed(2)} USD)`;
    }

    const msg = `
👤 *Account & Profile*
—————————————
📛 Name: ${user.fullName}
🆔 ID: \`${user.telegramId}\`
💎 Coins: ${user.coins}
💰 Rupee Balance: ₹${user.rupeeBalance}${usdEquivalent}
💳 Payment: ${payMethodStr}
—————————————
    `;

    const inline = Markup.inlineKeyboard([
      [Markup.button.callback('✏️ Edit Payment Details', 'edit_payment')],
      [Markup.button.callback('📜 Withdrawal History', 'withdrawal_history')],
      [Markup.button.callback('🪙 Redeem Coins (1000 → ₹10)', 'redeem_coins')],
      [Markup.button.callback('💬 Contact Support', 'support_inline')]
    ]);

    await ctx.replyWithMarkdown(msg, inline);
  });
});

bot.action('edit_payment', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply('💳 Choose your payment method:', Markup.inlineKeyboard([
    [Markup.button.callback('UPI / BHIM', 'set_payment_upi')],
    [Markup.button.callback('PayPal', 'set_payment_paypal')]
  ]));
});

bot.action('set_payment_upi', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply('📲 Send your UPI ID (e.g., example@upi):');
  bot.once('text', async (ctx) => {
    const upiId = ctx.message.text.trim();
    await User.findOneAndUpdate({ telegramId: ctx.from.id.toString() }, {
      paymentMethod: 'UPI',
      paymentId: upiId
    });
    await ctx.reply('✅ UPI ID saved successfully!');
  });
});

bot.action('set_payment_paypal', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply('📧 Send your PayPal email address:');
  bot.once('text', async (ctx) => {
    const email = ctx.message.text.trim();
    await User.findOneAndUpdate({ telegramId: ctx.from.id.toString() }, {
      paymentMethod: 'PAYPAL',
      paymentId: email
    });
    await ctx.reply('✅ PayPal email saved successfully!');
  });
});

bot.action('withdrawal_history', async (ctx) => {
  await ctx.answerCbQuery();
  const user = await User.findOne({ telegramId: ctx.from.id.toString() });
  if (!user || user.withdrawalHistory.length === 0) {
    return ctx.reply('📭 No withdrawal history.');
  }
  const history = user.withdrawalHistory.slice(-5).reverse().map((tx, i) =>
    `📌 ${i+1}. ₹${tx.amount} (${tx.method}) – ${tx.status} ${tx.reason ? `\n   Reason: ${tx.reason}` : ''}\n   ${new Date(tx.timestamp).toLocaleString()}`
  ).join('\n\n');
  await ctx.reply(`📜 *Last 5 Transactions:*\n\n${history}`, { parse_mode: 'Markdown' });
});

bot.action('redeem_coins', async (ctx) => {
  await ctx.answerCbQuery();
  const user = await User.findOne({ telegramId: ctx.from.id.toString() });
  if (user.coins < 1000) {
    return ctx.reply('🛑 You need at least 1000 coins to redeem (1000 coins = ₹10).');
  }
  await ctx.reply('🔗 Open the link below to unlock your redemption. After completing, click "Done".',
    Markup.inlineKeyboard([
      [Markup.button.url('🔓 Complete Locker', CONFIG.REDEEM_CPAGRIP_URL)],
      [Markup.button.callback('✅ I completed the locker', 'confirm_redeem')]
    ])
  );
});

bot.action('confirm_redeem', async (ctx) => {
  const user = await User.findOne({ telegramId: ctx.from.id.toString() });
  if (user.coins < 1000) return ctx.reply('❌ Not enough coins.');
  user.coins -= 1000;
  user.rupeeBalance += 10;
  await user.save();
  await ctx.reply('✅ Redemption successful! 1000 coins → ₹10 added to your balance.');
  return ctx.answerCbQuery();
});

// ==================== DAILY ADS (Mon-Sat) ====================
bot.hears('📺 Daily Ads', async (ctx) => {
  await requireVerified(ctx, async () => {
    const now = new Date();
    const day = now.getDay(); // 0 = Sunday
    if (day === 0) {
      return ctx.reply('📺 Daily Ads are available Monday to Saturday only. Try Sunday Tournament!');
    }
    const user = await User.findOne({ telegramId: ctx.from.id.toString() });
    if (user.dailyAdsViewed >= 10) {
      return ctx.reply('🛑 Daily Limit Reached! Come back tomorrow for more ads.');
    }
    const url = `${CONFIG.GITHUB_PAGES_URL}?mode=ads&userId=${user.telegramId}`;
    await ctx.reply('📺 Click below to watch an ad and earn coins!', Markup.inlineKeyboard([
      [Markup.button.webApp('▶️ Watch Ad', url)]
    ]));
  });
});

// ==================== MATH TASKS ====================
bot.hears('🧠 Math Tasks', async (ctx) => {
  await requireVerified(ctx, async () => {
    const user = await User.findOne({ telegramId: ctx.from.id.toString() });
    if (user.dailyMathTasksDone >= 5) {
      return ctx.reply('🛑 Daily Limit Reached! Come back tomorrow for more Math Tasks.');
    }
    const a = Math.floor(Math.random() * 50) + 10;
    const b = Math.floor(Math.random() * 30) + 5;
    const ops = ['+', '-', '*'];
    const op = ops[Math.floor(Math.random() * ops.length)];
    let answer;
    switch (op) {
      case '+': answer = a + b; break;
      case '-': answer = a - b; break;
      case '*': answer = a * b; break;
    }
    user.currentMathAnswer = answer;
    user.mathTaskActive = true;
    await user.save();
    await ctx.reply(`🧮 Solve: ${a} ${op} ${b} = ?\nReply with your answer.`);
  });
});

// Global text handler for math answers
bot.on('text', async (ctx, next) => {
  const userId = ctx.from.id.toString();
  const user = await User.findOne({ telegramId: userId });
  if (user && user.mathTaskActive && user.currentMathAnswer !== null) {
    const input = parseInt(ctx.message.text.trim(), 10);
    if (isNaN(input)) {
      return ctx.reply('❌ Please send a valid number.');
    }
    if (input === user.currentMathAnswer) {
      user.mathTaskActive = false;
      user.currentMathAnswer = null;
      user.dailyMathTasksDone += 1;
      const reward = Math.floor(Math.random() * 11) + 20; // 20-30
      user.coins += reward;
      await user.save();
      await ctx.reply(`✅ Correct! +${reward} coins. (${user.dailyMathTasksDone}/5 tasks done today)`);
    } else {
      await ctx.reply('❌ Wrong answer. Try again!');
    }
  } else {
    return next();
  }
});

// ==================== WITHDRAW ====================
bot.hears('💰 Withdraw Money', async (ctx) => {
  await requireVerified(ctx, async () => {
    const user = await User.findOne({ telegramId: ctx.from.id.toString() });
    if (user.paymentMethod === 'NONE') {
      return ctx.reply('⚠️ Please set your payment details first. Go to Account & Profile.');
    }
    if (user.referralsCount < 5) {
      return ctx.reply('🛑 Minimum 5 active referrals required for any withdrawal.');
    }
    const amounts = [100, 200, 250, 500, 1000];
    const buttons = amounts.map(amt => Markup.button.callback(`₹${amt}`, `withdraw_${amt}`));
    await ctx.reply('💰 Select withdrawal amount:', Markup.inlineKeyboard([
      buttons.slice(0,3),
      buttons.slice(3)
    ]));
  });
});

bot.action(/^withdraw_(\d+)$/, async (ctx) => {
  const amount = parseInt(ctx.match[1]);
  const user = await User.findOne({ telegramId: ctx.from.id.toString() });
  if (user.rupeeBalance < amount) {
    return ctx.answerCbQuery('🛑 Insufficient Balance!');
  }
  const txId = 'TX' + Date.now() + Math.random().toString(36).substr(2, 5);
  user.rupeeBalance -= amount;
  user.withdrawalHistory.push({
    txId,
    amount,
    currency: 'INR',
    method: user.paymentMethod,
    status: 'Pending',
    reason: '',
    timestamp: new Date()
  });
  await user.save();

  // Notify admin
  const adminMsg = `
🚨 **NEW WITHDRAWAL REQUEST**
👤 User: @${user.username} (ID: ${user.telegramId})
💰 Amount: ₹${amount}
💳 Method: ${user.paymentMethod} (${user.paymentId})
👥 Referrals: ${user.referralsCount}/5
  `;
  await bot.telegram.sendMessage(CONFIG.ADMIN_ID, adminMsg, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('🟢 Approve', `approve_${txId}`),
       Markup.button.callback('🔴 Reject', `reject_${txId}`)]
    ])
  });

  await ctx.reply('✅ Withdrawal request submitted! Admin will process it shortly.');
  return ctx.answerCbQuery();
});

// Admin approve/reject
bot.action(/^approve_(.+)$/, async (ctx) => {
  if (ctx.from.id.toString() !== CONFIG.ADMIN_ID) return ctx.answerCbQuery('Unauthorized');
  const txId = ctx.match[1];
  const user = await User.findOne({ 'withdrawalHistory.txId': txId });
  if (!user) return ctx.answerCbQuery('Transaction not found');
  await ctx.editMessageText(ctx.callbackQuery.message.text + '\n\n✅ *Approve – click confirm after manual transfer*',
    { parse_mode: 'Markdown', ...Markup.inlineKeyboard([
      [Markup.button.callback('💸 Confirm: Withdrawal Success', `confirm_${txId}`)],
    ]) });
  return ctx.answerCbQuery();
});

bot.action(/^confirm_(.+)$/, async (ctx) => {
  if (ctx.from.id.toString() !== CONFIG.ADMIN_ID) return ctx.answerCbQuery('Unauthorized');
  const txId = ctx.match[1];
  const user = await User.findOne({ 'withdrawalHistory.txId': txId });
  if (!user) return ctx.answerCbQuery('Transaction not found');
  const tx = user.withdrawalHistory.find(t => t.txId === txId);
  tx.status = 'Successful';
  await user.save();
  await bot.telegram.sendMessage(user.telegramId, '🎉 **Your Withdrawal Request Is Successful!**\nAmount has been transferred.', { parse_mode: 'Markdown' });
  await ctx.editMessageText(ctx.callbackQuery.message.text + '\n\n✅ *Status: Successful*');
  return ctx.answerCbQuery();
});

bot.action(/^reject_(.+)$/, async (ctx) => {
  if (ctx.from.id.toString() !== CONFIG.ADMIN_ID) return ctx.answerCbQuery('Unauthorized');
  const txId = ctx.match[1];
  const user = await User.findOne({ 'withdrawalHistory.txId': txId });
  if (!user) return ctx.answerCbQuery('Transaction not found');
  adminSessions.set(ctx.from.id.toString(), { action: 'reject_reason', txId, userId: user.telegramId });
  await ctx.reply('📝 Please type the rejection reason for the user:');
  return ctx.answerCbQuery();
});

// Admin text handler for reject reason
bot.on('text', async (ctx, next) => {
  const adminId = ctx.from.id.toString();
  if (adminSessions.has(adminId)) {
    const session = adminSessions.get(adminId);
    if (session.action === 'reject_reason') {
      const reason = ctx.message.text;
      const { txId, userId } = session;
      const user = await User.findOne({ 'withdrawalHistory.txId': txId });
      if (user) {
        const tx = user.withdrawalHistory.find(t => t.txId === txId);
        tx.status = 'Rejected';
        tx.reason = reason;
        user.rupeeBalance += tx.amount; // refund
        await user.save();
        await bot.telegram.sendMessage(userId, `❌ **Your Withdrawal Request Is Rejected!**\n⚠️ Reason: ${reason}`, { parse_mode: 'Markdown' });
        await ctx.reply('✅ Rejected and user refunded.');
      }
      adminSessions.delete(adminId);
      return;
    }
  }
  return next();
});

// ==================== REFER & EARN ====================
bot.hears('👥 Refer & Earn', async (ctx) => {
  await requireVerified(ctx, async () => {
    const user = await User.findOne({ telegramId: ctx.from.id.toString() });
    const refLink = `https://t.me/${ctx.botInfo.username}?start=${user.telegramId}`;
    let boomMsg = '';
    if (!user.claimedMilestones.includes('BOOM_10') && user.referralsCount >= 10) boomMsg += '🔥 BOOM 10 reached! +500 coins already credited.\n';
    if (!user.claimedMilestones.includes('BOOM_50') && user.referralsCount >= 50) boomMsg += '🔥 BOOM 50 reached! +3000 coins already credited.\n';
    if (!user.claimedMilestones.includes('BOOM_100') && user.referralsCount >= 100) boomMsg += '🔥 BOOM 100 reached! +10000 mega coins already credited.\n';
    await ctx.reply(
      `👥 *Refer & Earn*\n\nYour referral link:\n\`${refLink}\`\n\n• Invite friends and earn 100 coins when they verify.\n• Referral Booms:\n  - 10 refers: +500 coins\n  - 50 refers: +3000 coins\n  - 100 refers: +10000 coins\n\nYour referrals: ${user.referralsCount}\n${boomMsg}`,
      { parse_mode: 'Markdown', disable_web_page_preview: true }
    );
  });
});

async function checkReferralBoom(user, ctx) {
  const count = user.referralsCount;
  const milestones = user.claimedMilestones;
  let reward = 0;
  let boomMessage = '';

  if (count >= 100 && !milestones.includes('BOOM_100')) {
    reward += 10000;
    milestones.push('BOOM_100');
    boomMessage = '🎉 Mega BOOM! You hit 100 referrals! +10,000 coins credited!';
  } else if (count >= 50 && !milestones.includes('BOOM_50')) {
    reward += 3000;
    milestones.push('BOOM_50');
    boomMessage = '🔥 BOOM! You hit 50 referrals! +3,000 coins credited!';
  } else if (count >= 10 && !milestones.includes('BOOM_10')) {
    reward += 500;
    milestones.push('BOOM_10');
    boomMessage = '🎈 BOOM! You hit 10 referrals! +500 coins credited!';
  }

  if (reward > 0) {
    user.coins += reward;
    user.claimedMilestones = milestones;
    await user.save();
    try {
      await bot.telegram.sendMessage(user.telegramId, boomMessage);
    } catch (e) {}
  }
}

// ==================== DAILY SPIN ====================
bot.hears('🎡 Daily Bonus', async (ctx) => {
  await requireVerified(ctx, async () => {
    const url = `${CONFIG.GITHUB_PAGES_URL}?mode=spin`;
    await ctx.reply('🎡 Tap below to open the Spin Wheel!', Markup.inlineKeyboard([
      [Markup.button.webApp('🎰 Spin Now', url)]
    ]));
  });
});

// ==================== SUNDAY TOURNAMENT ====================
bot.hears('🏆 Sunday Tournament', async (ctx) => {
  await requireVerified(ctx, async () => {
    const today = new Date().getDay();
    if (today !== 0) {
      return ctx.reply('🏆 Tournament is active only on Sundays!');
    }
    const user = await User.findOne({ telegramId: ctx.from.id.toString() });
    if (!user.hasUnlockedUnlimitedSunday && user.sundayAdsCount >= 20) {
      return ctx.reply('🛑 Free limit reached (20 ads). Unlock unlimited ads:',
        Markup.inlineKeyboard([
          [Markup.button.url('🔥 Unlock Unlimited Ads', CONFIG.SUNDAY_UNLOCK_CPAGRIP_URL)],
          [Markup.button.callback('✅ I completed the locker', 'unlock_sunday_done')]
        ])
      );
    }
    const url = `${CONFIG.GITHUB_PAGES_URL}?mode=tournament&userId=${user.telegramId}`;
    await ctx.reply('🏆 Sunday Tournament – Watch ads to climb the leaderboard!',
      Markup.inlineKeyboard([
        [Markup.button.webApp('📊 Open Tournament', url)]
      ])
    );
  });
});

bot.action('unlock_sunday_done', async (ctx) => {
  await User.findOneAndUpdate({ telegramId: ctx.from.id.toString() }, { hasUnlockedUnlimitedSunday: true });
  await ctx.reply('✅ Unlimited Sunday ads unlocked! Enjoy.');
  return ctx.answerCbQuery();
});

// ==================== SUPPORT ====================
bot.hears('💬 Contact Support', async (ctx) => {
  await requireVerified(ctx, async () => {
    supportState.set(ctx.from.id.toString(), true);
    await ctx.reply('📬 Send your issue description or attachment directly below. Admin will reply here.');
  });
});

bot.on('text', async (ctx, next) => {
  const userId = ctx.from.id.toString();
  if (supportState.has(userId)) {
    const user = await User.findOne({ telegramId: userId });
    const adminMsg = `📬 *SUPPORT TICKET* from @${user.username} (ID: ${userId})\nMessage: ${ctx.message.text}`;
    await bot.telegram.sendMessage(CONFIG.ADMIN_ID, adminMsg, { parse_mode: 'Markdown' });
    await ctx.reply('✅ Your message has been forwarded to the admin.');
    supportState.delete(userId);
    return;
  }
  return next();
});

// Admin reply to ticket
bot.on('message', async (ctx, next) => {
  if (ctx.from.id.toString() === CONFIG.ADMIN_ID && ctx.message.reply_to_message) {
    const replied = ctx.message.reply_to_message;
    if (replied.text && replied.text.includes('SUPPORT TICKET from @')) {
      const match = replied.text.match(/ID: (\d+)/);
      if (match) {
        const targetId = match[1];
        await ctx.telegram.sendMessage(targetId, `📬 *Admin reply:*\n${ctx.message.text}`, { parse_mode: 'Markdown' });
        await ctx.reply('✅ Reply sent.');
      }
    }
  }
  return next();
});

// ==================== HELP & FAQ ====================
bot.hears('ℹ️ Help & FAQ', async (ctx) => {
  await requireVerified(ctx, async () => {
    const helpText = `
ℹ️ *Help & FAQ*
—————————————
• *Daily Ads* – Watch up to 10 ads (Mon-Sat) and earn 30-50 coins each.
• *Math Tasks* – Solve up to 5 math problems daily for 20-30 coins.
• *Referral Boom* – Earn 100 coins per verified invite. Milestones: 10 (500), 50 (3000), 100 (10000).
• *Redeem* – 1000 coins = ₹10 (requires CPAGrip locker).
• *Withdraw* – Minimum 5 referrals required. Choose ₹100-₹1000 amounts.
• *Sunday Tournament* – Top ad‑watcher on Sunday wins 1000 coins.
• *Support* – Use the contact button to reach an admin.
    `;
    await ctx.replyWithMarkdown(helpText);
  });
});

// ==================== ADMIN COMMANDS ====================
bot.command('adminpanel', async (ctx) => {
  if (ctx.from.id.toString() !== CONFIG.ADMIN_ID) return ctx.reply('⛔ Unauthorized');
  await ctx.reply('📊 *Admin Panel*', {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('👥 Total Users', 'admin_total')],
      [Markup.button.callback('📋 Recent 20 Users', 'admin_recent')],
      [Markup.button.callback('🔍 Search User', 'admin_search_prompt')],
    ])
  });
});

bot.action('admin_total', async (ctx) => {
  if (ctx.from.id.toString() !== CONFIG.ADMIN_ID) return ctx.answerCbQuery('Unauthorized');
  const count = await User.countDocuments();
  await ctx.editMessageText(`👥 Total registered users: ${count}`);
  return ctx.answerCbQuery();
});

bot.action('admin_recent', async (ctx) => {
  if (ctx.from.id.toString() !== CONFIG.ADMIN_ID) return ctx.answerCbQuery('Unauthorized');
  const users = await User.find().sort({ _id: -1 }).limit(20);
  const list = users.map(u => `👤 @${u.username} (ID: ${u.telegramId}) - Coins: ${u.coins} - Bal: ₹${u.rupeeBalance}`).join('\n');
  await ctx.editMessageText(`📋 *Last 20 Users:*\n\n${list}`, { parse_mode: 'Markdown' });
  return ctx.answerCbQuery();
});

bot.action('admin_search_prompt', async (ctx) => {
  if (ctx.from.id.toString() !== CONFIG.ADMIN_ID) return ctx.answerCbQuery('Unauthorized');
  await ctx.reply('🔍 Send /search <username or telegramId>');
  return ctx.answerCbQuery();
});

bot.command('search', async (ctx) => {
  if (ctx.from.id.toString() !== CONFIG.ADMIN_ID) return;
  const query = ctx.message.text.split(' ').slice(1).join(' ');
  if (!query) return ctx.reply('Usage: /search <username or ID>');
  const user = await User.findOne({
    $or: [
      { username: query.replace('@','') },
      { telegramId: query }
    ]
  });
  if (!user) return ctx.reply('User not found.');
  const profile = `
👤 *User Profile*
🆔 ID: \`${user.telegramId}\`
📛 Name: ${user.fullName}
💎 Coins: ${user.coins}
💰 Balance: ₹${user.rupeeBalance}
👥 Referrals: ${user.referralsCount}
🚫 Banned: ${user.isBanned ? 'Yes' : 'No'}
📅 Daily Ads: ${user.dailyAdsViewed}/10
🧮 Math Tasks: ${user.dailyMathTasksDone}/5
🎡 Streak: ${user.spinStreak}
💳 Payment: ${user.paymentMethod} (${user.paymentId})
📜 Withdrawals: ${user.withdrawalHistory.length}
  `;
  await ctx.replyWithMarkdown(profile);
});

bot.command('check', async (ctx) => {
  if (ctx.from.id.toString() !== CONFIG.ADMIN_ID) return;
  const id = ctx.message.text.split(' ')[1];
  if (!id) return ctx.reply('/check <telegramId>');
  const user = await User.findOne({ telegramId: id });
  if (!user) return ctx.reply('User not found.');
  await ctx.replyWithMarkdown(JSON.stringify(user.toObject(), null, 2).substring(0, 3500));
});

// ==================== BROADCAST ====================
bot.hears('📢 Broadcast', async (ctx) => {
  if (ctx.from.id.toString() !== CONFIG.ADMIN_ID) return ctx.reply('⛔ Unauthorized');
  adminSessions.set(ctx.from.id.toString(), { action: 'broadcast' });
  await ctx.reply('📢 Send the message you want to broadcast to all users:');
});

bot.on('text', async (ctx, next) => {
  const adminId = ctx.from.id.toString();
  if (adminSessions.has(adminId) && adminSessions.get(adminId).action === 'broadcast') {
    const msg = ctx.message;
    const users = await User.find({});
    let success = 0;
    for (const user of users) {
      try {
        await ctx.telegram.copyMessage(user.telegramId, msg.chat.id, msg.message_id);
        success++;
      } catch (e) {}
    }
    await ctx.reply(`✅ Broadcast sent to ${success}/${users.length} users.`);
    adminSessions.delete(adminId);
    return;
  }
  return next();
});

// ==================== MINI APP API ENDPOINTS ====================
app.post('/api/spin', async (req, res) => {
  const { initData } = req.body;
  if (!verifyTelegramWebAppData(initData)) return res.status(403).json({ error: 'Invalid data' });
  const urlParams = new URLSearchParams(initData);
  const userId = urlParams.get('user').id;
  const user = await User.findOne({ telegramId: userId.toString() });
  if (!user) return res.status(404).json({ error: 'User not found' });

  const today = new Date();
  today.setHours(0,0,0,0);
  const last = user.lastSpinDate ? new Date(user.lastSpinDate) : null;
  if (last) {
    const lastDay = new Date(last);
    lastDay.setHours(0,0,0,0);
    const diffDays = Math.floor((today - lastDay) / (1000*60*60*24));
    if (diffDays === 0) {
      return res.json({ error: 'Already spun today!', coins: user.coins });
    } else if (diffDays === 1) {
      user.spinStreak += 1;
    } else {
      user.spinStreak = 1;
    }
  } else {
    user.spinStreak = 1;
  }
  user.lastSpinDate = new Date();

  let reward = 0;
  let isMega = false;
  if (user.spinStreak === 7) {
    isMega = true;
    reward = 200; // mega spin
    user.spinStreak = 0;
  } else {
    reward = [10, 20, 30, 40, 50][Math.floor(Math.random() * 5)];
  }
  user.coins += reward;
  await user.save();
  res.json({ success: true, reward, isMega, streak: user.spinStreak });
});

app.post('/api/completeAds', async (req, res) => {
  const { initData } = req.body;
  if (!verifyTelegramWebAppData(initData)) return res.status(403).json({ error: 'Invalid data' });
  const urlParams = new URLSearchParams(initData);
  const userId = urlParams.get('user').id;
  const user = await User.findOne({ telegramId: userId.toString() });
  if (!user) return res.status(404).json({ error: 'User not found' });

  const now = new Date();
  const day = now.getDay();
  if (day === 0) {
    if (!user.hasUnlockedUnlimitedSunday && user.sundayAdsCount >= 20) {
      return res.json({ error: 'Free limit reached. Unlock unlimited ads first.' });
    }
    user.sundayAdsCount += 1;
  } else {
    if (user.dailyAdsViewed >= 10) {
      return res.json({ error: 'Daily limit reached' });
    }
    user.dailyAdsViewed += 1;
  }
  const reward = Math.floor(Math.random() * 21) + 30; // 30-50
  user.coins += reward;
  await user.save();
  res.json({ success: true, reward, adsViewed: day === 0 ? user.sundayAdsCount : user.dailyAdsViewed });
});

app.get('/api/tournament', async (req, res) => {
  const today = new Date().getDay();
  if (today !== 0) return res.json({ active: false });
  const top = await User.find({ sundayAdsCount: { $gt: 0 } })
    .sort({ sundayAdsCount: -1 })
    .limit(10)
    .select('username sundayAdsCount -_id');
  res.json({ active: true, leaderboard: top });
});

// ==================== CRON JOBS ====================
// Reset daily counters at midnight IST (18:30 UTC)
cron.schedule('30 18 * * *', async () => {
  await User.updateMany({}, { dailyAdsViewed: 0, dailyMathTasksDone: 0 });
});

// Sunday tournament winner calculation & reset (Monday 00:00 IST = Sunday 18:30 UTC)
cron.schedule('30 18 * * 0', async () => {
  const winner = await User.findOne({ sundayAdsCount: { $gte: 30 } })
    .sort({ sundayAdsCount: -1 });
  if (winner) {
    winner.coins += 1000;
    await winner.save();
    const msg = `🏆 *Sunday Tournament Winner!*\n👤 @${winner.username} (ID: ${winner.telegramId}) watched ${winner.sundayAdsCount} ads and won 1000 coins!`;
    const allUsers = await User.find({});
    for (const u of allUsers) {
      try { await bot.telegram.sendMessage(u.telegramId, msg, { parse_mode: 'Markdown' }); } catch (e) {}
    }
  }
  await User.updateMany({}, { sundayAdsCount: 0, hasUnlockedUnlimitedSunday: false });
});

// ==================== SERVER START ====================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Express server listening on port ${PORT}`);
  bot.launch();
  console.log('🤖 Bot is running...');
});

// Graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
