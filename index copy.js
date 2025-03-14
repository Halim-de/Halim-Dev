const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const { execSync } = require('child_process');
let KNOWLEDGE_BASE = require('./knowledgeBase');

// حفظ وقت بدء تشغيل البوت لتجاهل الرسائل القديمة
const botStartTime = Date.now();

// علم لمنع بدء تهيئة العميل عدة مرات
let isInitializing = false;

// دالة تهيئة العميل مع العلم
function initializeClient() {
  if (isInitializing) return;
  isInitializing = true;
  whatsappClient.initialize()
    .then(() => { isInitializing = false; })
    .catch(error => {
      isInitializing = false;
      console.error('❌ خطأ في بدء تشغيل البوت:', error);
      if (error.message && error.message.includes('Execution context was destroyed')) {
        removeSessionData();
        console.error('🔄 إعادة محاولة بدء تشغيل البوت بعد حذف بيانات الجلسة...');
        setTimeout(() => { initializeClient(); }, 1000);
      }
    });
}

// دالة لحذف بيانات الجلسة مع تخطي ملف chrome_debug.log
function removeSessionData(retries = 3) {
  const sessionPath = './sessions';
  if (fs.existsSync(sessionPath)) {
    try {
      function deleteFolderContents(folder) {
        const files = fs.readdirSync(folder);
        for (const file of files) {
          const fullPath = `${folder}/${file}`;
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) {
            deleteFolderContents(fullPath);
            fs.rmdirSync(fullPath);
          } else {
            if (!file.includes('chrome_debug.log')) {
              fs.unlinkSync(fullPath);
            }
          }
        }
      }
      deleteFolderContents(sessionPath);
      fs.rmdirSync(sessionPath);
      console.error('🗑️ بيانات الجلسة حُذفت (باستثناء chrome_debug.log).');
    } catch (err) {
      console.error(`❌ محاولة حذف بيانات الجلسة فشلت (${3 - retries + 1}/3):`, err);
      if (retries > 0) {
        setTimeout(() => removeSessionData(retries - 1), 1000);
      } else {
        try {
          execSync(`rd /s /q "${sessionPath}"`);
          console.error('🗑️ تم حذف بيانات الجلسة باستخدام أمر ويندوز.');
        } catch (err2) {
          console.error('❌ فشل حذف بيانات الجلسة باستخدام أمر ويندوز:', err2);
        }
      }
    }
  }
}

// تهيئة العميل مع حفظ الجلسة في مجلد sessions
const whatsappClient = new Client({
  puppeteer: {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-extensions'
    ]
  },
  authStrategy: new LocalAuth({ dataPath: './sessions' }),
  clientName: "Halim dev"
});

// رقم المسؤول (لأوامر التحكم)
const ADMIN_NUMBER = '201003337897@c.us';

// كائن لتخزين الأسئلة المعلقة
const pendingQuestions = {};

// تحميل سجل المحادثات
const CHAT_HISTORY_FILE = './chatHistory.json';
let chatHistory = {};
try {
  if (fs.existsSync(CHAT_HISTORY_FILE)) {
    chatHistory = JSON.parse(fs.readFileSync(CHAT_HISTORY_FILE, 'utf8'));
  } else {
    fs.writeFileSync(CHAT_HISTORY_FILE, JSON.stringify({}));
  }
} catch (error) {
  console.error('❌ خطأ في تحميل سجل المحادثات:', error);
  chatHistory = {};
}
setInterval(() => {
  try {
    fs.writeFileSync(CHAT_HISTORY_FILE, JSON.stringify(chatHistory, null, 2));
  } catch (error) {
    console.error('❌ خطأ في حفظ سجل المحادثات:', error);
  }
}, 60000);

// الحد الأدنى من رسائل السجل أثناء الأحداث المهمة
whatsappClient.on('qr', qr => {
  qrcode.generate(qr, { small: true });
});
whatsappClient.on('authenticated', () => {
  console.error('[✓] تم تسجيل الدخول بنجاح!');
});
whatsappClient.on('ready', () => {
  console.error('[✓] البوت يعمل بنجاح!');
});
whatsappClient.on('disconnected', (reason) => {
  console.error(`[✗] تم تسجيل الخروج. السبب: ${reason}`);
  setTimeout(() => { initializeClient(); }, 1000);
});
whatsappClient.on('error', (error) => {
  console.error('[✗] خطأ غير متوقع:', error);
  if (error.message && error.message.includes('Execution context was destroyed')) {
    whatsappClient.destroy().then(() => {
      removeSessionData();
      setTimeout(() => { initializeClient(); }, 1000);
    });
  }
});

// دالة البحث في قاعدة المعرفة
function getResponseFromKnowledgeBase(userInput) {
  const cleanInput = userInput.trim().toLowerCase();
  for (const question of Object.keys(KNOWLEDGE_BASE)) {
    if (question.toLowerCase() === cleanInput) return KNOWLEDGE_BASE[question];
  }
  for (const question of Object.keys(KNOWLEDGE_BASE)) {
    if (cleanInput.includes(question.toLowerCase()) || question.toLowerCase().includes(cleanInput))
      return KNOWLEDGE_BASE[question];
  }
  for (const [key, value] of Object.entries(KNOWLEDGE_BASE)) {
    const keyWords = key.toLowerCase().split(/\s+/);
    const userWords = cleanInput.split(/\s+/);
    let commonWords = 0;
    for (const word of userWords) {
      if (word.length > 2 && keyWords.includes(word)) commonWords++;
    }
    if (commonWords >= 2) return value;
  }
  return null;
}

// دالة تحديث سجل المحادثات (يقتصر السجل على آخر 20 رسالة لكل جهة)
function updateChatHistory(userId, message, isUserMessage = true) {
  if (!chatHistory[userId]) chatHistory[userId] = [];
  chatHistory[userId].push({
    role: isUserMessage ? 'user' : 'assistant',
    content: message,
    timestamp: new Date().toISOString()
  });
  if (chatHistory[userId].length > 20)
    chatHistory[userId] = chatHistory[userId].slice(-20);
  return chatHistory[userId];
}

// دالة حفظ المعرفة دون تعديل النص
function addToKnowledgeBase(question, answer) {
  if (question && answer) {
    KNOWLEDGE_BASE[question] = answer;
    try {
      fs.writeFileSync('./knowledgeBase.js', `module.exports = ${JSON.stringify(KNOWLEDGE_BASE, null, 2)};`);
      return true;
    } catch (error) {
      console.error('❌ خطأ في حفظ قاعدة المعرفة:', error);
      return false;
    }
  }
  return false;
}

// معالجة الرسائل الواردة (مع تجاهل الرسائل القديمة)
whatsappClient.on('message', async (message) => {
  if (message.body && message.body.trim() !== "") {
    // تجاهل الرسائل التي مر وقتها قبل بدء تشغيل البوت
    if (message.timestamp && (message.timestamp * 1000) < botStartTime) return;
    const userInput = message.body.trim();
    const userId = message.from;

    // أوامر تسجيل الدخول/الخروج (للمسؤول فقط)
    if (userInput === "تسجيل خروج") {
      if (userId !== ADMIN_NUMBER) {
        await message.reply("❌ ليس لديك صلاحية تنفيذ هذا الأمر.");
        return;
      }
      await message.reply("⏳ جاري تسجيل الخروج...");
      await whatsappClient.logout();
      return;
    }
    if (userInput === "تسجيل دخول") {
      if (userId !== ADMIN_NUMBER) {
        await message.reply("❌ ليس لديك صلاحية تنفيذ هذا الأمر.");
        return;
      }
      if (whatsappClient.info) {
        await message.reply("✅ البوت مسجل الدخول بالفعل.");
        return;
      }
      await message.reply("⏳ جاري إعادة تسجيل الدخول...");
      initializeClient();
      return;
    }

    updateChatHistory(userId, userInput);

    // إذا كانت الرسالة رد على سؤال معلق
    if (message._data.quotedMsgId && pendingQuestions[message._data.quotedMsgId]) {
      const { question } = pendingQuestions[message._data.quotedMsgId];
      const userAnswer = userInput;
      if (addToKnowledgeBase(question, userAnswer)) {
        await message.reply(`✅ تم حفظ السؤال والإجابة:\nس: ${question}\nج: ${userAnswer}`);
      } else {
        await message.reply('❌ حدث خطأ أثناء حفظ المعرفة.');
      }
      delete pendingQuestions[message._data.quotedMsgId];
      return;
    }

    // أمر "تعلم:"
    if (userInput.startsWith("تعلم:")) {
      if (message._data.quotedMsgId && userId !== ADMIN_NUMBER) {
        const quotedMessage = await message.getQuotedMessage();
        if (quotedMessage && quotedMessage.body === "شكراً لسؤالك! سيتم الرد عليك في أقرب وقت ممكن.") {
          await message.reply("لا يمكن استخدام أمر التعلم على هذه الرسالة.");
          return;
        }
      }
      const parts = userInput.substring("تعلم:".length).split('|');
      if (parts.length >= 2) {
        const question = parts[0];
        const answer = parts[1];
        if (addToKnowledgeBase(question, answer)) {
          await message.reply(`✅ تم تعلم معرفة جديدة:\nس: ${question}\nج: ${answer}`);
        } else {
          await message.reply('❌ حدث خطأ أثناء حفظ المعرفة الجديدة.');
        }
        return;
      } else {
        await message.reply('❌ صيغة خاطئة. استخدم: تعلم: السؤال | الإجابة');
        return;
      }
    }

    // البحث في قاعدة المعرفة
    const knowledgeBaseResponse = getResponseFromKnowledgeBase(userInput);
    if (knowledgeBaseResponse) {
      updateChatHistory(userId, knowledgeBaseResponse, false);
      await message.reply(knowledgeBaseResponse);
      return;
    }

    // في حال عدم وجود إجابة، يتم إعلام المستخدم وإرسال السؤال للمسؤول
    try {
      await message.reply("شكراً لسؤالك! سيتم الرد عليك لاحقاً.");
      if (userId !== ADMIN_NUMBER) {
        const adminChat = await whatsappClient.getChatById(ADMIN_NUMBER);
        const adminMsg = await adminChat.sendMessage(
          `📢 سؤال جديد من ${userId}:\n\n${userInput}\n\n(يمكنك الرد باستخدام أمر "تعلم: السؤال | الإجابة")`
        );
        pendingQuestions[adminMsg.id._serialized] = {
          question: userInput,
          userId,
          timestamp: new Date().toISOString()
        };
      }
    } catch (error) {
      console.error('❌ خطأ أثناء إرسال السؤال:', error);
      await message.reply("عذراً، حدث خطأ أثناء معالجة سؤالك.");
    }
  }
});

// تجاهل معالجة رسائل الوسائط غير النصية
whatsappClient.on('message_create', async (msg) => {
  if (msg.hasMedia && msg.type !== 'chat' && !msg.fromMe) {
    try {
      await msg.reply('تم استلام الوسائط، لكن حالياً لا يمكنني معالجة هذا النوع من المحتوى.');
    } catch (error) {
      console.error('❌ خطأ في الرد على رسالة الوسائط:', error);
    }
  }
});

// عند إغلاق البرنامج
process.on('SIGINT', async () => {
  try {
    fs.writeFileSync(CHAT_HISTORY_FILE, JSON.stringify(chatHistory, null, 2));
  } catch (error) {
    console.error('❌ خطأ في حفظ سجل المحادثات:', error);
  }
  try {
    await whatsappClient.destroy();
  } catch (error) {
    console.error('❌ خطأ في إغلاق الاتصال:', error);
  }
  process.exit(0);
});

// بدء تشغيل البوت
initializeClient();
