import dotenv from "dotenv";
dotenv.config();

import TelegramBot from "node-telegram-bot-api";
import {
  saveMacrosToDb,
  getDailyMacros,
  getPreviousDaysMacros,
  deleteMacroLog,
  saveFavoriteItem,
  getFavoriteItems,
  deleteFavoriteItem,
} from "./supabaseClient.js";
import { calculateMacros, testService, calculateImageMacros } from "./geminiService.js";

// Validate required environment variables
if (!process.env.TELEGRAM_BOT_TOKEN) {
  throw new Error("Missing TELEGRAM_BOT_TOKEN environment variable");
}

// Initialize the bot
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });

// Helper function to create safe callback data for Telegram (max 64 bytes)
function createSafeCallbackData(prefix, data) {
  let callbackData = `${prefix}_${JSON.stringify(data)}`;
  
  // If too long, use a hash or truncate
  if (callbackData.length > 64) {
    // Create a shorter identifier using timestamp and random number
    const shortId = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
    callbackData = `${prefix}_${shortId}`;
    
    // Store the full data in memory with the short ID as key
    if (!global.callbackDataStore) {
      global.callbackDataStore = new Map();
    }
    global.callbackDataStore.set(shortId, data);
    
    // Clean up old entries (keep only last 100 entries)
    if (global.callbackDataStore.size > 100) {
      const entries = Array.from(global.callbackDataStore.entries());
      const toDelete = entries.slice(0, entries.length - 100);
      toDelete.forEach(([key]) => global.callbackDataStore.delete(key));
    }
  }
  
  return callbackData;
}

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
/favourites - View and add from your favourite foods
/managefavourites - Remove items from your favourites
/start - Show this welcome message

*Example:*
Just type: "2 eggs, 1 slice whole wheat toast, 1 tbsp butter"
I'll analyze it and track your macros! 📊

⚠️ *Note:* Macro calculations are estimates based on AI analysis and should not replace professional nutritional advice.
  `;
  bot.sendMessage(chatId, welcomeMessage, { parse_mode: "Markdown" });
});

bot.onText(/\/t/, async (msg) => {
  const chatId = msg.chat.id;
  try {
    await handleTodayMacros(chatId);
  } catch (error) {
    console.error("Error in todaymacros command:", error);
    bot.sendMessage(
      chatId,
      "❌ Sorry, I encountered an error retrieving your daily macros. Please try again later."
    );
  }
});

bot.onText(/\/pastmacros(?: (\d+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const numDays = match[1] ? parseInt(match[1], 10) : 3; // Default to 3 days if not specified

  try {
    await handlePastMacros(chatId, numDays);
  } catch (error) {
    console.error("Error in pastmacros command:", error);
    bot.sendMessage(
      chatId,
      "❌ Sorry, I encountered an error retrieving your past macros. Please try again later."
    );
  }
});

bot.onText(/\/r/, async (msg) => {
    const chatId = msg.chat.id;
  try {
    await handleRemove(chatId);
  } catch (error) {
    console.error("Error in remove command:", error);
    bot.sendMessage(
      chatId,
      "❌ Sorry, I encountered an error. Please try again later."
    );
  }
});

bot.onText(/\/f/, async (msg) => {
  const chatId = msg.chat.id;
  try {
    await handleFavorites(chatId);
  } catch (error) {
    console.error("Error in favorites command:", error);
    bot.sendMessage(
      chatId,
      "❌ Sorry, I encountered an error retrieving your favorites. Please try again later."
    );
  }
});

bot.onText(/\/mf/, async (msg) => {
  const chatId = msg.chat.id;
  try {
    await handleManageFavorites(chatId);
  } catch (error) {
    console.error("Error in manage favourites command:", error);
    bot.sendMessage(
      chatId,
      "❌ Sorry, I encountered an error. Please try again later."
    );
  }
});

// Handle all non-command text messages as food entries
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const messageText = msg.text || msg.caption || ""; // Handle text, caption, or empty string

  // Ignore commands
  if (messageText.startsWith("/")) {
    return;
  }

  if (msg.photo) {
    const photoId = msg.photo[msg.photo.length - 1].file_id;
    
    try {
      const fileStream = bot.getFileStream(photoId);
      const weight = messageText; // This will be the caption or empty string

      const chunks = [];
      fileStream.on("data", (chunk) => {
        chunks.push(chunk);
      });

      fileStream.on("end", async () => {
        try {
          const imageBuffer = Buffer.concat(chunks);
          const prompt = `You are a nutrition expert. Analyze the following image of a food nutrition label and then calculate the macronutrients for the weight specified in the prompt.

IMPORTANT: Respond ONLY with a valid JSON object in the exact format specified below. Do not include any additional text, markdown formatting, or explanations.

Weight : "${weight}"

Analyze this nutrition label and the weight provided and provide the macronutrient breakdown. If quantities are not specified, assume reasonable serving sizes. If you cannot identify the food or calculate macros, return zeros.
All food is from the uk and when a brand is mentioned you need to use google search to locate the nutritional information online if possible. If exact information is not avaialble, use reasonable estimates based on common nutritional values, use the lower bound of protein content ensuring you do not overshoot protein values.

Required JSON format (respond with this format only):
{
  "protein_g": <number>,
  "carbs_g": <number>,
  "fats_g": <number>,
  "calories": <number>,
  "parsed_food_item": "<string describing the food as you understood it>"
}

Examples:
Input: "An image of a frozen pizza food nutrition label stating that 100g has 20g protein, 30g carbs, 10g fats, 500kcal and the weight provided is 50g"
Output: {"protein_g": 10, "carbs_g": 15, "fats_g": 5, "calories": 250, "parsed_food_item": "A frozen pizza"}

Now analyze the image with weight: "${weight}"`;

          const contents = [
            {
              inlineData: {
                mimeType: "image/jpeg",
                data: imageBuffer.toString("base64"),
              },
            },
            { text: prompt },
          ];

          // Calculate macros using Gemini
          const macroData = await calculateImageMacros(contents);

          // Check if macros were successfully calculated
          if (
            macroData.protein_g === 0 &&
            macroData.carbs_g === 0 &&
            macroData.fats_g === 0
          ) {
            bot.sendMessage(
              chatId,
              `❓ I couldn't calculate macros from this image. Please try again with a clearer nutrition label or include the weight in the caption.\n\n*Example:* Send a photo with caption "100g"`,
              { parse_mode: "Markdown" }
            );
            return;
          }

          // Save to database
          const now = new Date();
          const date = now.toISOString().split("T")[0]; // YYYY-MM-DD
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

          const favoriteData = {
            protein: macroData.protein_g,
            carbs: macroData.carbs_g,
            fats: macroData.fats_g,
            calories: macroData.calories,
            foodItem: macroData.parsed_food_item
          };

          const keyboard = {
            inline_keyboard: [[
              {
                text: "⭐ Add to Favourites",
                callback_data: createSafeCallbackData("save_favorite", favoriteData)
              }
            ]]
          };

          bot.sendMessage(chatId, confirmationMessage, { 
            parse_mode: "Markdown",
            reply_markup: keyboard 
          });
        } catch (error) {
          console.error("Error processing nutrition label:", error);
          bot.sendMessage(
            chatId,
            "❌ Sorry, I couldn't process that nutrition label. Please try again with a clearer image."
          );
        }
      });

      fileStream.on("error", (error) => {
        console.error("Error reading file stream:", error);
        bot.sendMessage(
          chatId,
          "❌ Sorry, I encountered an error reading the image. Please try again."
        );
      });

    } catch (error) {
      console.error("Error processing image:", error);
      bot.sendMessage(
        chatId,
        "❌ Sorry, I couldn't process that image. Please try again."
      );
    }

  } else if (messageText.trim()) { // Only process if there's actual text content
    try {
      await handleFoodEntry(chatId, messageText);
    } catch (error) {
      console.error("Error handling food entry:", error);
      bot.sendMessage(
        chatId,
        "❌ Sorry, I encountered an error processing your food entry. Please try again."
      );
    }
  }
});

bot.on("callback_query", async (callbackQuery) => {
  const msg = callbackQuery.message;
  const data = callbackQuery.data;
  const chatId = msg.chat.id;
  const userId = callbackQuery.from.id;

  if (data.startsWith("remove_")) {
    const logId = data.split("_")[1];
    try {
      await deleteMacroLog(logId, userId);
      bot.answerCallbackQuery(callbackQuery.id, {
        text: "Meal removed successfully!",
      });
      bot.editMessageText("✅ Meal has been removed.", {
        chat_id: chatId,
        message_id: msg.message_id,
      });
    } catch (error) {
      console.error("Error removing log:", error);
      bot.answerCallbackQuery(callbackQuery.id, {
        text: "Error removing meal.",
      });
      bot.sendMessage(
        chatId,
        "❌ Failed to remove the meal. It might have been already deleted."
      );
    }
  } else if (data.startsWith("add_favorite_")) {
    const favoriteId = data.split("_")[2];
    try {
      const favorites = await getFavoriteItems(userId);
      const favorite = favorites.find(f => f.id === favoriteId);
      
      if (!favorite) {
        bot.answerCallbackQuery(callbackQuery.id, {
          text: "Favourite item not found.",
        });
        return;
      }

      // Save to macro log
      const now = new Date();
      const date = now.toISOString().split("T")[0];
      const mealTime = now.toISOString();

      await saveMacrosToDb(
        userId,
        date,
        mealTime,
        favorite.food_item,
        favorite.protein_g,
        favorite.carbs_g,
        favorite.fats_g,
        favorite.calories
      );

      bot.answerCallbackQuery(callbackQuery.id, {
        text: "Added to today's meals!",
      });

      const confirmationMessage = `✅ *Added from favourites!*

📝 *Food:* ${favorite.food_item}
📊 *Macros:* P: ${favorite.protein_g}g | C: ${favorite.carbs_g}g | F: ${favorite.fats_g}g | Cal: ${favorite.calories}

Use /todaymacros to see your daily summary!`;

      bot.sendMessage(chatId, confirmationMessage, { parse_mode: "Markdown" });
    } catch (error) {
      console.error("Error adding favourite to meals:", error);
      bot.answerCallbackQuery(callbackQuery.id, {
        text: "Error adding to meals.",
      });
    }
  } else if (data.startsWith("save_favorite_")) {
    try {
      let favoriteData;
      const dataAfterPrefix = data.substring("save_favorite_".length);
      
      // Try to get data from store first (new format)
      if (global.callbackDataStore?.has(dataAfterPrefix)) {
        favoriteData = global.callbackDataStore.get(dataAfterPrefix);
      } else {
        // Try to parse as JSON (direct JSON format)
        try {
          favoriteData = JSON.parse(dataAfterPrefix);
        } catch (jsonError) {
          // Try old underscore-separated format as last resort
          const parts = data.split("_");
          if (parts.length >= 6) {
            favoriteData = {
              protein: parseFloat(parts[2]) || 0,
              carbs: parseFloat(parts[3]) || 0,
              fats: parseFloat(parts[4]) || 0,
              calories: parseFloat(parts[5]) || 0,
              foodItem: parts.slice(6).join("_").replace(/SPACE/g, " ") || "Unknown food"
            };
          } else {
            // If all parsing fails, create a fallback
            console.warn("Could not parse callback data:", data);
            bot.answerCallbackQuery(callbackQuery.id, {
              text: "Error: Could not process this request. Please try adding to favourites again.",
            });
            return;
          }
        }
      }

      if (!favoriteData || typeof favoriteData !== 'object') {
        throw new Error("Could not retrieve valid favourite data");
      }

      // Ensure all required fields exist with fallbacks
      favoriteData = {
        protein: favoriteData.protein || 0,
        carbs: favoriteData.carbs || 0,
        fats: favoriteData.fats || 0,
        calories: favoriteData.calories || 0,
        foodItem: favoriteData.foodItem || "Unknown food"
      };

      await saveFavoriteItem(
        userId, 
        favoriteData.foodItem, 
        favoriteData.protein, 
        favoriteData.carbs, 
        favoriteData.fats, 
        favoriteData.calories
      );
      
      bot.answerCallbackQuery(callbackQuery.id, {
        text: "Added to favourites! ⭐",
      });
      bot.editMessageReplyMarkup(
        { inline_keyboard: [] },
        {
          chat_id: chatId,
          message_id: msg.message_id,
        }
      );
      
      // Clean up stored data if it exists
      if (global.callbackDataStore?.has(dataAfterPrefix)) {
        global.callbackDataStore.delete(dataAfterPrefix);
      }
    } catch (error) {
      console.error("Error saving to favourites:", error);
      bot.answerCallbackQuery(callbackQuery.id, {
        text: error.message.includes("already in") ? "Already in favourites!" : "Error saving to favourites.",
      });
    }
  } else if (data.startsWith("delete_favorite_")) {
    const favoriteId = data.split("_")[2];
    try {
      await deleteFavoriteItem(favoriteId, userId);
      bot.answerCallbackQuery(callbackQuery.id, {
        text: "Removed from favourites!",
      });
      bot.editMessageText("✅ Item has been removed from favourites.", {
        chat_id: chatId,
        message_id: msg.message_id,
      });
    } catch (error) {
      console.error("Error removing favourite:", error);
      bot.answerCallbackQuery(callbackQuery.id, {
        text: "Error removing from favourites.",
      });
    }
  } else if (data.startsWith("show_meals_")) {
    const parts = data.split("_");
    const targetChatId = parts[2];
    const date = parts[3];
    
    try {
      const dailyMacros = await getDailyMacros(targetChatId, date);
      
      if (dailyMacros.length === 0) {
        bot.answerCallbackQuery(callbackQuery.id, {
          text: "No meals found for this date.",
        });
        return;
      }

      // Calculate totals for the summary
      let totalProtein = 0;
      let totalCarbs = 0;
      let totalFats = 0;
      let totalCalories = 0;

      dailyMacros.forEach((entry) => {
        totalProtein += parseFloat(entry.protein_g || 0);
        totalCarbs += parseFloat(entry.carbs_g || 0);
        totalFats += parseFloat(entry.fats_g || 0);
        totalCalories += parseFloat(entry.calories || 0);
      });

      // Create message with totals and individual meals
      let mealsText = `*Daily Summary - ${date}*

*TOTALS*
🥩 Protein: ${totalProtein.toFixed(1)}g
🍞 Carbs: ${totalCarbs.toFixed(1)}g  
🥑 Fats: ${totalFats.toFixed(1)}g
🔥 Calories: ${totalCalories.toFixed(1)}

*Individual Meals*

`;
      
      dailyMacros.forEach((entry) => {
        const mealTime = new Date(entry.meal_time);
        const timeString = mealTime.toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        });

        mealsText += `${timeString} - ${entry.food_item}\n${entry.calories} cal, ${entry.protein_g}g protein\n\n`;
      });

      bot.answerCallbackQuery(callbackQuery.id);
      bot.editMessageText(mealsText, {
        chat_id: chatId,
        message_id: msg.message_id,
        parse_mode: "Markdown"
      });
    } catch (error) {
      console.error("Error showing individual meals:", error);
      bot.answerCallbackQuery(callbackQuery.id, {
        text: "Error loading meals.",
      });
    }
  }
});

// Handle food entry
async function handleFoodEntry(chatId, foodDescription) {
  bot.sendChatAction(chatId, "typing");

  try {
    // Calculate macros using Gemini
    const macroData = await calculateMacros(foodDescription);

    // Check if macros were successfully calculated
    if (
      macroData.protein_g === 0 &&
      macroData.carbs_g === 0 &&
      macroData.fats_g === 0
    ) {
      bot.sendMessage(
        chatId,
        `❓ I couldn't calculate macros for "${foodDescription}". Please try being more specific about the food items and quantities.\n\n*Example:* "100g chicken breast" or "1 medium apple"`,
        { parse_mode: "Markdown" }
      );
      return;
    }

    // Save to database
    const now = new Date();
    const date = now.toISOString().split("T")[0]; // YYYY-MM-DD
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

    // Send confirmation message with add to favorites option
    const confirmationMessage = `✅ *Logged successfully!*

📝 *Food:* ${macroData.parsed_food_item}
📊 *Macros:* P: ${macroData.protein_g}g | C: ${macroData.carbs_g}g | F: ${macroData.fats_g}g | Cal: ${macroData.calories}

Use /todaymacros to see your daily summary!`;

    const favoriteData = {
      protein: macroData.protein_g,
      carbs: macroData.carbs_g,
      fats: macroData.fats_g,
      calories: macroData.calories,
      foodItem: macroData.parsed_food_item
    };

    const keyboard = {
      inline_keyboard: [[
        {
          text: "⭐ Add to Favourites",
          callback_data: createSafeCallbackData("save_favorite", favoriteData)
        }
      ]]
    };

    bot.sendMessage(chatId, confirmationMessage, { 
      parse_mode: "Markdown",
      reply_markup: keyboard 
    });
  } catch (error) {
    console.error("Error processing food entry:", error);
    bot.sendMessage(
      chatId,
      "❌ Sorry, I couldn't process that food entry. Please try again or be more specific about the food items."
    );
  }
}

// Handle today's macros command
async function handleTodayMacros(chatId) {
  const today = new Date().toISOString().split("T")[0];

  bot.sendChatAction(chatId, "typing");

  try {
    const dailyMacros = await getDailyMacros(chatId, today);

    if (dailyMacros.length === 0) {
      bot.sendMessage(
        chatId,
        'No food entries logged for today yet!\n\nStart by sending me what you\'ve eaten, for example:\n"100g oatmeal with banana"'
      );
      return;
    }

    // Calculate totals
    let totalProtein = 0;
    let totalCarbs = 0;
    let totalFats = 0;
    let totalCalories = 0;

    dailyMacros.forEach((entry) => {
      totalProtein += parseFloat(entry.protein_g || 0);
      totalCarbs += parseFloat(entry.carbs_g || 0);
      totalFats += parseFloat(entry.fats_g || 0);
      totalCalories += parseFloat(entry.calories || 0);
    });

    const summaryMessage = `*Daily Summary - ${today}*

*TOTALS*
🥩 Protein: ${totalProtein.toFixed(1)}g
🍞 Carbs: ${totalCarbs.toFixed(1)}g  
🥑 Fats: ${totalFats.toFixed(1)}g
🔥 Calories: ${totalCalories.toFixed(1)}`;

    const keyboard = {
      inline_keyboard: [[
        {
          text: "Show Individual Meals",
          callback_data: `show_meals_${chatId}_${today}`
        }
      ]]
    };

    bot.sendMessage(chatId, summaryMessage, { 
      parse_mode: "Markdown",
      reply_markup: keyboard 
    });
  } catch (error) {
    console.error("Error getting daily macros:", error);
    throw error;
  }
}

// Handle past macros command
async function handlePastMacros(chatId, numberOfDays) {
  if (numberOfDays > 30) {
    bot.sendMessage(chatId, "📅 Please choose a number between 1 and 30 days.");
    return;
  }

  bot.sendChatAction(chatId, "typing");

  try {
    const pastMacros = await getPreviousDaysMacros(chatId, numberOfDays);

    if (pastMacros.length === 0) {
      bot.sendMessage(
        chatId,
        `📊 No macro data found for the past ${numberOfDays} days.\n\nStart logging your meals to build your history!`
      );
      return;
    }

    let summaryText = `📈 *Your past daily macros (${numberOfDays} days):*\n\n`;

    pastMacros.forEach((day) => {
      const date = new Date(day.date).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });

      summaryText += `${date}: P: ${day.total_protein.toFixed(
        1
      )}g | C: ${day.total_carbs.toFixed(1)}g | F: ${day.total_fats.toFixed(
        1
      )}g | Cal: ${day.total_calories.toFixed(1)}\n`;
    });

    summaryText += `\nUse /todaymacros to see today's detailed breakdown! 📊`;

    bot.sendMessage(chatId, summaryText, { parse_mode: "Markdown" });
  } catch (error) {
    console.error("Error getting past macros:", error);
    throw error;
  }
}

// Handle remove command
async function handleRemove(chatId) {
  const today = new Date().toISOString().split("T")[0];
  bot.sendChatAction(chatId, "typing");

  try {
    const dailyMacros = await getDailyMacros(chatId, today);

    if (dailyMacros.length === 0) {
      bot.sendMessage(chatId, "🤔 No meals logged today to remove.");
      return;
    }

    const keyboard = {
      inline_keyboard: dailyMacros.map((entry) => {
        const mealTime = new Date(entry.meal_time).toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
        });
        return [
          {
            text: `${mealTime} - ${entry.food_item}`,
            callback_data: `remove_${entry.id}`,
          },
        ];
      }),
    };

    bot.sendMessage(chatId, "👇 Please select a meal to remove for today:", {
      reply_markup: keyboard,
    });
  } catch (error) {
    console.error("Error in handleRemove:", error);
    bot.sendMessage(chatId, "❌ An error occurred while fetching your meals.");
  }
}

// Handle favorites command
async function handleFavorites(chatId) {
  bot.sendChatAction(chatId, "typing");

  try {
    const favorites = await getFavoriteItems(chatId);

    if (favorites.length === 0) {
      bot.sendMessage(
        chatId,
        "⭐ You don't have any favourite foods yet!\n\nLog some food items and use the ⭐ Add to Favourites button to build your favourites list."
      );
      return;
    }

    const keyboard = {
      inline_keyboard: favorites.map((favorite) => [
        {
          text: `${favorite.food_item} (${favorite.calories} cal, ${favorite.protein_g}g protein)`,
          callback_data: `add_favorite_${favorite.id}`,
        }
      ])
    };

    bot.sendMessage(chatId, "⭐ *Your Favourite Foods*\n\nTap any item to add it to today's meals:", {
      parse_mode: "Markdown",
      reply_markup: keyboard
    });
  } catch (error) {
    console.error("Error in handleFavorites:", error);
    throw error;
  }
}

// Handle manage favorites command
async function handleManageFavorites(chatId) {
  bot.sendChatAction(chatId, "typing");

  try {
    const favorites = await getFavoriteItems(chatId);

    if (favorites.length === 0) {
      bot.sendMessage(
        chatId,
        "⭐ You don't have any favourite foods to manage yet!\n\nLog some food items and use the ⭐ Add to Favourites button to build your favourites list."
      );
      return;
    }

    const keyboard = {
      inline_keyboard: favorites.map((favorite) => [
        {
          text: `🗑️ ${favorite.food_item}`,
          callback_data: `delete_favorite_${favorite.id}`,
        }
      ])
    };

    bot.sendMessage(chatId, "🗑️ *Manage Favourites*\n\nTap any item to remove it from your favourites:", {
      parse_mode: "Markdown",
      reply_markup: keyboard
    });
  } catch (error) {
    console.error("Error in handleManageFavorites:", error);
    throw error;
  }
}

// Start the bot
async function start() {
  try {
    console.log("🤖 Starting MacroMate Bot...");

    // Test connections
    console.log("🧪 Testing Gemini service...");
    await testService();
    console.log("✅ Gemini service working");

    console.log("🚀 MacroMate Bot is running!");
  } catch (error) {
    console.error("❌ Failed to start bot:", error);
    process.exit(1);
  }
}

// Start the bot
start();
