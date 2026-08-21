"""
Telegram Bot — runs as a separate process.
Stores files in PostgreSQL (Neon) database.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'backend', 'flask_backend'))

from app import app, db, Subject, File
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import Application, MessageHandler, CallbackQueryHandler, CommandHandler, filters, ContextTypes

TELEGRAM_BOT_TOKEN = os.environ.get('TG_BOT_TOKEN', '8626034663:AAGjKhjCiiiZzE4UwzW6UXeKiHh-ixwGsLs')

user_sessions = {}


def get_subjects_from_db():
    with app.app_context():
        return [(s.id, s.name) for s in Subject.query.all()]


def build_subject_keyboard():
    subjects = get_subjects_from_db()
    keyboard = []
    row = []
    for i, (sid, name) in enumerate(subjects):
        row.append(InlineKeyboardButton(name, callback_data=f'pick_subject_{sid}'))
        if len(row) == 2 or i == len(subjects) - 1:
            keyboard.append(row)
            row = []
    return InlineKeyboardMarkup(keyboard)


async def send_subject_list(update, context):
    text = 'اختر المادة:'
    if update.callback_query:
        await update.callback_query.edit_message_text(text, reply_markup=build_subject_keyboard())
    else:
        await update.message.reply_text(text, reply_markup=build_subject_keyboard())


async def cmd_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    chat_id = update.effective_chat.id
    user_sessions.pop(chat_id, None)
    await send_subject_list(update, context)


async def cmd_help(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        'الهدف: رفع ملفات الدروس للموقع\n\n'
        '1. ابدأ بـ /start\n'
        '2. اختر المادة\n'
        '3. اختر نوع الملف\n'
        '4. أرسل الملف\n\n'
        'الملفات المدعومة: PDF, DOC, DOCX, PPT, ZIP\n'
        'إلغاء: /cancel'
    )


async def cmd_cancel(update: Update, context: ContextTypes.DEFAULT_TYPE):
    chat_id = update.effective_chat.id
    user_sessions.pop(chat_id, None)
    await update.message.reply_text('تم الإلغاء. ابدأ من جديد بـ /start')


async def on_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    chat_id = query.message.chat.id
    data = query.data

    if data.startswith('pick_subject_'):
        subject_id = int(data.split('_')[-1])
        subjects = get_subjects_from_db()
        subject_name = next((n for sid, n in subjects if sid == subject_id), None)
        if not subject_name:
            await query.answer('مادة غير موجودة')
            return
        user_sessions[chat_id] = {'step': 'choose_type', 'subject_id': subject_id}
        keyboard = InlineKeyboardMarkup([
            [InlineKeyboardButton('محاضرة', callback_data='pick_type_lecture')],
            [InlineKeyboardButton('عمل تطبيقي (TD/TP)', callback_data='pick_type_tdtp')],
            [InlineKeyboardButton('رجوع للقائمة', callback_data='back_to_list')],
        ])
        await query.answer()
        await query.edit_message_text(f'المادة: {subject_name}\n\nالآن اختر نوع الملف:', reply_markup=keyboard)

    elif data.startswith('pick_type_'):
        file_type = data.replace('pick_type_', '')
        session = user_sessions.get(chat_id)
        if not session:
            await query.answer('انتهت الجلسة، ابدأ بـ /start')
            return
        session['step'] = 'wait_file'
        session['file_type'] = file_type
        subjects = get_subjects_from_db()
        subject_name = next((n for sid, n in subjects if sid == session['subject_id']), '')
        type_label = 'محاضرة' if file_type == 'lecture' else 'عمل تطبيقي (TD/TP)'
        await query.answer()
        await query.edit_message_text(
            f'المادة: {subject_name}\nالنوع: {type_label}\n\n'
            f'الآن أرسل الملف مباشرة هنا.\n'
            f'(PDF, DOC, DOCX, PPT, ZIP)'
        )

    elif data == 'back_to_list':
        user_sessions.pop(chat_id, None)
        await query.answer()
        await query.edit_message_text('اختر المادة:', reply_markup=build_subject_keyboard())

    elif data == 'upload_more':
        await query.answer()
        await send_subject_list(update, context)


async def on_document(update: Update, context: ContextTypes.DEFAULT_TYPE):
    chat_id = update.effective_chat.id
    doc = update.message.document
    if not doc:
        return

    session = user_sessions.get(chat_id)
    if not session or session.get('step') != 'wait_file':
        await update.message.reply_text(
            'لم تختر المادة بعد.\nابدأ بـ /start ثم اختر المادة والنوع أولاً.'
        )
        return

    await update.message.reply_text('جاري رفع الملف...')

    try:
        tg_file = await context.bot.get_file(doc.file_id)
        filename = doc.file_name

        # Download to memory
        import io
        file_bytes = await tg_file.download_as_bytearray()

        size_bytes = len(file_bytes)
        size_str = (f"{size_bytes / (1024*1024):.1f} MB"
                    if size_bytes > 1024 * 1024
                    else f"{size_bytes / 1024:.0f} KB")
        lesson_name = os.path.splitext(filename)[0]

        # Detect MIME type
        ext = os.path.splitext(filename)[1].lower()
        mime_map = {
            '.pdf': 'application/pdf',
            '.doc': 'application/msword',
            '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            '.ppt': 'application/vnd.ms-powerpoint',
            '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            '.zip': 'application/zip',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.png': 'image/png',
        }
        mime_type = mime_map.get(ext, 'application/octet-stream')

        with app.app_context():
            new_file = File(
                name=lesson_name,
                filename=filename,
                file_type=session['file_type'],
                size=size_str,
                content=bytes(file_bytes),
                mime_type=mime_type,
                subject_id=session['subject_id'],
                telegram_file_id=doc.file_id,
            )
            db.session.add(new_file)
            db.session.commit()
            subject_name = Subject.query.get(session['subject_id']).name

        type_label = 'محاضرة' if session['file_type'] == 'lecture' else 'عمل تطبيقي'
        user_sessions.pop(chat_id, None)

        keyboard = InlineKeyboardMarkup([
            [InlineKeyboardButton('رفع ملف آخر', callback_data='upload_more')],
            [InlineKeyboardButton('القائمة الرئيسية', callback_data='back_to_list')],
        ])
        await update.message.reply_text(
            f'تم الرفع بنجاح\n\n'
            f'الملف: {filename}\n'
            f'المادة: {subject_name}\n'
            f'النوع: {type_label}\n'
            f'الحجم: {size_str}',
            reply_markup=keyboard
        )
    except Exception as e:
        print(f'Error handling document: {e}', flush=True)
        user_sessions.pop(chat_id, None)
        await update.message.reply_text('حدث خطأ أثناء رفع الملف. حاول بـ /start')


def main():
    print(f"[BOT] Starting with token: {TELEGRAM_BOT_TOKEN[:10]}...", flush=True)
    app_client = Application.builder().token(TELEGRAM_BOT_TOKEN).build()
    app_client.add_handler(CommandHandler('start', cmd_start))
    app_client.add_handler(CommandHandler('help', cmd_help))
    app_client.add_handler(CommandHandler('cancel', cmd_cancel))
    app_client.add_handler(CommandHandler('subjects', cmd_start))
    app_client.add_handler(CallbackQueryHandler(on_callback))
    app_client.add_handler(MessageHandler(filters.Document.ALL, on_document))
    print("[BOT] Polling started", flush=True)
    app_client.run_polling(drop_pending_updates=True)


if __name__ == '__main__':
    main()
