import dotenv from 'dotenv';
dotenv.config();

import TelegramBot from 'node-telegram-bot-api';
import { saveMacrosToDb, getDailyMacros, getPreviousDaysMacros, deleteMacroLog } from './supabaseClient.js';
import { calculateMacros, testService } from './geminiService.js';

// Validate required environment variables
if (!process.env.TELEGRAM_BOT_TOKEN) {
  throw new Error('Missing TELEGRAM_BOT_TOKEN environment variable');
}

// Initialize the bot
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });

// Commands
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const welcomeMessage = `
🥗 *Welcome to MacroMate Bot!* 🥗

I'll help you track your daily nutrition macros using AI-powered food analysis.

*How to use me:*
• Simply send me what you ate (e.g., "100g chicken breast, 50g rice")
• I'll calculate the macros and save them for you

*Commands:*
/todaymacros - View today's macro summary and meals
/pastmacros [days] - View past daily macros (default: 3 days)
/start - Show this welcome message

*Example:*
Just type: "2 eggs, 1 slice whole wheat toast, 1 tbsp butter"
I'll analyze it and track your macros! 📊

⚠️ *Note:* Macro calculations are estimates based on AI analysis and should not replace professional nutritional advice.
  `;
  bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown' });
});

bot.onText(/\/t/, async (msg) => {
  const chatId = msg.chat.id;
  try {
    await handleTodayMacros(chatId);
  } catch (error) {
    console.error('Error in todaymacros command:', error);
    bot.sendMessage(chatId, '❌ Sorry, I encountered an error retrieving your daily macros. Please try again later.');
  }
});

bot.onText(/\/pastmacros(?: (\d+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const numDays = match[1] ? parseInt(match[1], 10) : 3; // Default to 3 days if not specified

    try {
        await handlePastMacros(chatId, numDays);
    } catch (error) {
        console.error('Error in pastmacros command:', error);
        bot.sendMessage(chatId, '❌ Sorry, I encountered an error retrieving your past macros. Please try again later.');
    }
});

bot.onText(/\/r/, async (msg) => {
    const chatId = msg.chat.id;
    try {
        await handleRemove(chatId);
    } catch (error) {
        console.error('Error in remove command:', error);
        bot.sendMessage(chatId, '❌ Sorry, I encountered an error. Please try again later.');
    }
});

// Handle all non-command text messages as food entries
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const messageText = msg.text;

    // Ignore commands
    if (messageText.startsWith('/')) {
        return;
    }

    try {
        await handleFoodEntry(chatId, messageText);
    } catch (error) {
        console.error('Error handling food entry:', error);
        bot.sendMessage(chatId, '❌ Sorry, I encountered an error processing your food entry. Please try again.');
    }
});

bot.on('callback_query', async (callbackQuery) => {
    const msg = callbackQuery.message;
    const data = callbackQuery.data;
    const chatId = msg.chat.id;
    const userId = callbackQuery.from.id;

    if (data.startsWith('remove_')) {
        const logId = data.split('_')[1];
        try {
            await deleteMacroLog(logId, userId);
            bot.answerCallbackQuery(callbackQuery.id, { text: 'Meal removed successfully!' });
            bot.editMessageText('✅ Meal has been removed.', {
                chat_id: chatId,
                message_id: msg.message_id,
            });
        } catch (error) {
            console.error('Error removing log:', error);
            bot.answerCallbackQuery(callbackQuery.id, { text: 'Error removing meal.' });
            bot.sendMessage(chatId, '❌ Failed to remove the meal. It might have been already deleted.');
        }
    }
});

  // Handle food entry
async function handleFoodEntry(chatId, foodDescription) {
    bot.sendChatAction(chatId, 'typing');

    try {
        // Calculate macros using Gemini
        const macroData = await calculateMacros(foodDescription);

        // Check if macros were successfully calculated
        if (macroData.protein_g === 0 && macroData.carbs_g === 0 && macroData.fats_g === 0) {
            bot.sendMessage(chatId, `❓ I couldn't calculate macros for "${foodDescription}". Please try being more specific about the food items and quantities.\n\n*Example:* "100g chicken breast" or "1 medium apple"`, { parse_mode: 'Markdown' });
            return;
        }

        // Save to database
        const now = new Date();
        const date = now.toISOString().split('T')[0]; // YYYY-MM-DD
        const mealTime = now.toISOString();

        await saveMacrosToDb(
            chatId,
            date,
            mealTime,
            macroData.parsed_food_item,
            macroData.protein_g,
            macroData.carbs_g,
            macroData.fats_g,
            macroData.calories
        );

        // Send confirmation message
        const confirmationMessage = `✅ *Logged successfully!*

📝 *Food:* ${macroData.parsed_food_item}
📊 *Macros:* P: ${macroData.protein_g}g | C: ${macroData.carbs_g}g | F: ${macroData.fats_g}g | Cal: ${macroData.calories}

Use /todaymacros to see your daily summary!`;

        bot.sendMessage(chatId, confirmationMessage, { parse_mode: 'Markdown' });

    } catch (error) {
        console.error('Error processing food entry:', error);
        bot.sendMessage(chatId, '❌ Sorry, I couldn\'t process that food entry. Please try again or be more specific about the food items.');
    }
}

  // Handle today's macros command
async function handleTodayMacros(chatId) {
    const today = new Date().toISOString().split('T')[0];

    bot.sendChatAction(chatId, 'typing');

    try {
        const dailyMacros = await getDailyMacros(chatId, today);

        if (dailyMacros.length === 0) {
            bot.sendMessage(chatId, '📊 No food entries logged for today yet!\n\nStart by sending me what you\'ve eaten, for example:\n"100g oatmeal with banana"');
            return;
        }

        // Calculate totals
        let totalProtein = 0;
        let totalCarbs = 0;
        let totalFats = 0;
        let totalCalories = 0;

        dailyMacros.forEach(entry => {
            totalProtein += parseFloat(entry.protein_g || 0);
            totalCarbs += parseFloat(entry.carbs_g || 0);
            totalFats += parseFloat(entry.fats_g || 0);
            totalCalories += parseFloat(entry.calories || 0);
        });

        // Format meals list
        let mealsText = '';
        dailyMacros.forEach(entry => {
            const mealTime = new Date(entry.meal_time);
            const timeString = mealTime.toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: true
            });

            mealsText += `${timeString} - ${entry.food_item} (P: ${entry.protein_g}g, C: ${entry.carbs_g}g, F: ${entry.fats_g}g, Cal: ${entry.calories})\n`;
        });

        const summaryMessage = `📊 *Your macros for ${today}:*

🎯 *TOTALS:* P: ${totalProtein.toFixed(1)}g | C: ${totalCarbs.toFixed(1)}g | F: ${totalFats.toFixed(1)}g | Cal: ${totalCalories.toFixed(1)}

🍽 *MEALS:*
${mealsText}

Keep it up! 💪`;

        bot.sendMessage(chatId, summaryMessage, { parse_mode: 'Markdown' });

    } catch (error) {
        console.error('Error getting daily macros:', error);
        throw error;
    }
}

  // Handle past macros command
async function handlePastMacros(chatId, numberOfDays) {
    if (numberOfDays > 30) {
        bot.sendMessage(chatId, '📅 Please choose a number between 1 and 30 days.');
        return;
    }

    bot.sendChatAction(chatId, 'typing');

    try {
        const pastMacros = await getPreviousDaysMacros(chatId, numberOfDays);

        if (pastMacros.length === 0) {
            bot.sendMessage(chatId, `📊 No macro data found for the past ${numberOfDays} days.\n\nStart logging your meals to build your history!`);
            return;
        }

        let summaryText = `📈 *Your past daily macros (${numberOfDays} days):*\n\n`;

        pastMacros.forEach(day => {
            const date = new Date(day.date).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric'
            });

            summaryText += `${date}: P: ${day.total_protein.toFixed(1)}g | C: ${day.total_carbs.toFixed(1)}g | F: ${day.total_fats.toFixed(1)}g | Cal: ${day.total_calories.toFixed(1)}\n`;
        });

        summaryText += `\nUse /todaymacros to see today's detailed breakdown! 📊`;

        bot.sendMessage(chatId, summaryText, { parse_mode: 'Markdown' });

    } catch (error) {
        console.error('Error getting past macros:', error);
        throw error;
    }
}

  // Handle remove command
async function handleRemove(chatId) {
    const today = new Date().toISOString().split('T')[0];
    bot.sendChatAction(chatId, 'typing');

    try {
        const dailyMacros = await getDailyMacros(chatId, today);

        if (dailyMacros.length === 0) {
            bot.sendMessage(chatId, '🤔 No meals logged today to remove.');
            return;
        }

        const keyboard = {
            inline_keyboard: dailyMacros.map(entry => {
                const mealTime = new Date(entry.meal_time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
                return [{
                    text: `${mealTime} - ${entry.food_item}`,
                    callback_data: `remove_${entry.id}`
                }];
            })
        };

        bot.sendMessage(chatId, '👇 Please select a meal to remove for today:', {
            reply_markup: keyboard
        });

    } catch (error) {
        console.error('Error in handleRemove:', error);
        bot.sendMessage(chatId, '❌ An error occurred while fetching your meals.');
    }
}

  // Start the bot
async function start() {
    try {
        console.log('🤖 Starting MacroMate Bot...');

        // Test connections
        console.log('🧪 Testing Gemini service...');
        await testService();
        console.log('✅ Gemini service working');

        console.log('🚀 MacroMate Bot is running!');

    } catch (error) {
        console.error('❌ Failed to start bot:', error);
        process.exit(1);
    }
}

// Start the bot
start();
