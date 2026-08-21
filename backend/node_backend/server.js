/**
 * Backend Structure - Node.js + Express + Telegram Bot
 * =====================================================
 * Handles file uploads via Telegram bot and serves them to frontend
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { Telegraf } = require('telegraf');

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================
// MIDDLEWARE
// ============================================
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../..')));

// Serve uploaded files
app.use('/files', express.static(path.join(__dirname, '../../files')));

// ============================================
// IN-MEMORY DATABASE (replace with MongoDB/PostgreSQL in production)
// ============================================
let db = {
    subjects: [
        { id: 1, name: 'المحاسبة المالية', icon: 'fa-calculator', files: [] },
        { id: 2, name: 'التمويل الخارجي', icon: 'fa-money-bill-trend-up', files: [] },
        { id: 3, name: 'القانون التجاري', icon: 'fa-scale-balanced', files: [] },
        { id: 4, name: 'الاقتصاد القياسي', icon: 'fa-chart-line', files: [] },
        { id: 5, name: 'اللغة الإنجزية', icon: 'fa-language', files: [] },
        { id: 6, name: 'أساسيات التسويق', icon: 'fa-bullseye', files: [] },
        { id: 7, name: 'المحاسبة التحليلية', icon: 'fa-chart-pie', files: [] },
        { id: 8, name: 'النظام الضريبي', icon: 'fa-file-invoice-dollar', files: [] },
        { id: 9, name: 'نظم المعلومات المحاسبية', icon: 'fa-database', files: [] },
    ],
    config: {
        botToken: process.env.TG_BOT_TOKEN || '8626034663:AAGjKhjCiiiZzE4UwzW6UXeKiHh-ixwGsLs',
        chatId: process.env.TG_CHAT_ID || '6586489447'
    },
    stats: { visits: 0, files: 0 }
};

// Load/save to JSON file for persistence
const DB_PATH = path.join(__dirname, 'db.json');
function loadDb() {
    if (fs.existsSync(DB_PATH)) {
        db = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
    }
}
function saveDb() {
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}
loadDb();

// ============================================
// API ROUTES
// ============================================

// Get all subjects
app.get('/api/subjects', (req, res) => {
    db.stats.visits++;
    saveDb();
    res.json(db.subjects.map(s => ({
        id: s.id,
        name: s.name,
        icon: s.icon,
        lectures: s.files.filter(f => f.type === 'lecture'),
        tdtp: s.files.filter(f => f.type === 'tdtp'),
    })));
});

// Add a subject
app.post('/api/subjects', (req, res) => {
    const { name, icon } = req.body;
    const newId = db.subjects.length > 0
        ? Math.max(...db.subjects.map(s => s.id)) + 1 : 1;
    const subject = { id: newId, name, icon: icon || 'fa-book', files: [] };
    db.subjects.push(subject);
    saveDb();
    res.status(201).json(subject);
});

// Delete a subject
app.delete('/api/subjects/:id', (req, res) => {
    const id = parseInt(req.params.id);
    db.subjects = db.subjects.filter(s => s.id !== id);
    saveDb();
    res.json({ message: 'deleted' });
});

// Get stats
app.get('/api/stats', (req, res) => {
    res.json({
        visits: db.stats.visits,
        files: db.stats.files,
        subjects: db.subjects.length,
    });
});

// Telegram config
app.get('/api/telegram/config', (req, res) => {
    res.json({
        ...db.config,
        botToken: db.config.botToken ? db.config.botToken.substring(0, 10) + '...' : '',
    });
});

app.post('/api/telegram/config', (req, res) => {
    db.config.botToken = req.body.bot_token || '';
    db.config.chatId = req.body.chat_id || '';
    saveDb();
    res.json({ message: 'saved' });
});

// ============================================
// TELEGRAM BOT - Interactive Flow
// ============================================
let bot = null;

// Track user conversation state: { chatId: { step, subjectId, fileType } }
const userSessions = new Map();

function initBot() {
    if (!db.config.botToken) return;

    bot = new Telegraf(db.config.botToken);

    // ─── /start ───
    bot.command('start', (ctx) => {
        const chatId = ctx.chat.id;
        userSessions.delete(chatId);
        sendSubjectList(ctx);
    });

    // ─── /help ───
    bot.command('help', (ctx) => {
        ctx.reply(
            'الهدف: رفع ملفات الدروس للموقع\n\n' +
            '1. ابدأ بـ /start\n' +
            '2. اختر المادة\n' +
            '3. اختر نوع الملف\n' +
            '4. أرسل الملف\n\n' +
            'الملفات المدعومة: PDF, DOC, DOCX, PPT, PPTX, ZIP'
        );
    });

    // ─── /subjects ───
    bot.command('subjects', (ctx) => {
        sendSubjectList(ctx);
    });

    // ─── /cancel ───
    bot.command('cancel', (ctx) => {
        userSessions.delete(ctx.chat.id);
        ctx.reply('تم الإلغاء. ابدأ من جديد بـ /start');
    });

    // ─── Handle inline button clicks ───
    bot.action(/^pick_subject_(\d+)$/, async (ctx) => {
        const chatId = ctx.chat.id;
        const subjectId = parseInt(ctx.match[1]);
        const subject = db.subjects.find(s => s.id === subjectId);
        if (!subject) return ctx.answerCbQuery('مادة غير موجودة');

        userSessions.set(chatId, { step: 'choose_type', subjectId });

        await ctx.answerCbQuery();
        await ctx.editMessageText(
            `المادة: ${subject.name}\n\nالآن اختر نوع الملف:`,
            {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: 'محاضرة', callback_data: 'pick_type_lecture' }],
                        [{ text: 'عمل تطبيقي (TD/TP)', callback_data: 'pick_type_tdtp' }],
                        [{ text: 'رجوع للقائمة', callback_data: 'back_to_list' }],
                    ]
                }
            }
        );
    });

    bot.action(/^pick_type_(lecture|tdtp)$/, async (ctx) => {
        const chatId = ctx.chat.id;
        const fileType = ctx.match[1];
        const session = userSessions.get(chatId);
        if (!session) return ctx.answerCbQuery('انتهت الجلسة، ابدأ بـ /start');

        session.step = 'wait_file';
        session.fileType = fileType;

        const subject = db.subjects.find(s => s.id === session.subjectId);
        const typeLabel = fileType === 'lecture' ? 'محاضرة' : 'عمل تطبيقي (TD/TP)';

        await ctx.answerCbQuery();
        await ctx.editMessageText(
            `المادة: ${subject.name}\nالنوع: ${typeLabel}\n\n` +
            `الآن أرسل الملف مباشرة هنا.\n` +
            `(PDF, DOC, DOCX, PPT, ZIP)`,
        );
    });

    bot.action('back_to_list', async (ctx) => {
        const chatId = ctx.chat.id;
        userSessions.delete(chatId);
        await ctx.answerCbQuery();
        await ctx.editMessageText('اختر المادة:');
        // Re-send subject list as inline keyboard
        const keyboard = buildSubjectKeyboard();
        await ctx.editMessageText('اختر المادة:', {
            reply_markup: { inline_keyboard: keyboard }
        });
    });

    // ─── Handle uploaded file ───
    bot.on('document', async (ctx) => {
        const chatId = ctx.chat.id;
        const doc = ctx.message.document;
        if (!doc) return;

        const session = userSessions.get(chatId);

        // If no session, prompt to use /start
        if (!session || session.step !== 'wait_file') {
            return ctx.reply(
                'لم تختر المادة بعد.\n' +
                'ابدأ بـ /start ثم اختر المادة والنوع أولاً.'
            );
        }

        try {
            await ctx.reply('جاري رفع الملف...');

            // Download file
            const fileLink = await ctx.telegram.getFileLink(doc.file_id);
            const filename = doc.file_name;
            const uploadDir = path.join(__dirname, '../../files');
            if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

            const response = await fetch(fileLink.href);
            const buffer = Buffer.from(await response.arrayBuffer());
            fs.writeFileSync(path.join(uploadDir, filename), buffer);

            // File size
            const sizeBytes = buffer.length;
            const sizeStr = sizeBytes > 1024 * 1024
                ? `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`
                : `${(sizeBytes / 1024).toFixed(0)} KB`;

            // Lesson name from filename (remove extension)
            const lessonName = path.parse(filename).name;

            // Save to database
            const subject = db.subjects.find(s => s.id === session.subjectId);
            subject.files.push({
                name: lessonName,
                file: filename,
                type: session.fileType,
                size: sizeStr,
                telegramFileId: doc.file_id,
            });
            db.stats.files++;
            saveDb();

            const typeLabel = session.fileType === 'lecture' ? 'محاضرة' : 'عمل تطبيقي';

            // Clear session
            userSessions.delete(chatId);

            // Confirm with buttons to continue
            await ctx.reply(
                `تم الرفع بنجاح\n\n` +
                `الملف: ${filename}\n` +
                `المادة: ${subject.name}\n` +
                `النوع: ${typeLabel}\n` +
                `الحجم: ${sizeStr}`,
                {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: 'رفع ملف آخر', callback_data: 'upload_more' }],
                            [{ text: 'القائمة الرئيسية', callback_data: 'back_to_list' }],
                        ]
                    }
                }
            );

        } catch (err) {
            console.error('Error handling document:', err);
            userSessions.delete(chatId);
            await ctx.reply('حدث خطأ أثناء رفع الملف. حاول مرة أخرى بـ /start');
        }
    });

    bot.action('upload_more', async (ctx) => {
        await ctx.answerCbQuery();
        sendSubjectList(ctx);
    });

    bot.launch();
    console.log('Telegram bot started successfully');
}

function buildSubjectKeyboard() {
    const keyboard = [];
    for (let i = 0; i < db.subjects.length; i += 2) {
        const row = [];
        row.push({ text: db.subjects[i].name, callback_data: `pick_subject_${db.subjects[i].id}` });
        if (db.subjects[i + 1]) {
            row.push({ text: db.subjects[i + 1].name, callback_data: `pick_subject_${db.subjects[i + 1].id}` });
        }
        keyboard.push(row);
    }
    return keyboard;
}

function sendSubjectList(ctx) {
    const keyboard = buildSubjectKeyboard();
    ctx.reply('اختر المادة:', {
        reply_markup: { inline_keyboard: keyboard }
    });
}

// Initialize bot if config exists
if (db.config.botToken) {
    initBot();
}

// ============================================
// START SERVER
// ============================================
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    if (bot) bot.stop();
    process.exit(0);
});
