const dotenv = await import('dotenv');
const { createClient } = await import('@supabase/supabase-js');
dotenv.config();
// Initialize Supabase client
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
  throw new Error('Missing Supabase environment variables');
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

/**
 * Save macro data to the database
 * @param {string} userId - Telegram user ID
 * @param {string} date - Date in YYYY-MM-DD format
 * @param {string} mealTime - ISO timestamp
 * @param {string} foodItem - Description of the food item
 * @param {number} protein - Protein in grams
 * @param {number} carbs - Carbohydrates in grams
 * @param {number} fats - Fats in grams
 * @param {number} calories - Calories
 */
async function saveMacrosToDb(userId, date, mealTime, foodItem, protein, carbs, fats, calories) {
    try {
      const { data, error } = await supabase
        .from('macro_logs')
        .insert([
          {
            user_id: userId.toString(),
            log_date: date,
            meal_time: mealTime,
            food_item: foodItem,
            protein_g: parseFloat(protein.toFixed(1)),
            carbs_g: parseFloat(carbs.toFixed(1)),
            fats_g: parseFloat(fats.toFixed(1)),
            calories: parseFloat(calories.toFixed(1))
          }
        ])
        .select();

      if (error) {
        console.error('Supabase insert error:', error);
        throw new Error(`Failed to save macro data: ${error.message}`);
      }

      return data[0];
    } catch (error) {
      console.error('Error saving macros to DB:', error);
      throw error;
    }
  }

  /**
   * Get all macro entries for a specific user and date
   * @param {string} userId - Telegram user ID
   * @param {string} date - Date in YYYY-MM-DD format
   */
  async function getDailyMacros(userId, date) {
    try {
      const { data, error } = await supabase
        .from('macro_logs')
        .select('*')
        .eq('user_id', userId.toString())
        .eq('log_date', date)
        .order('meal_time', { ascending: true });

      if (error) {
        console.error('Supabase select error:', error);
        throw new Error(`Failed to retrieve daily macros: ${error.message}`);
      }

      return data || [];
    } catch (error) {
      console.error('Error getting daily macros:', error);
      throw error;
    }
  }

  /**
   * Get macro summaries for previous days
   * @param {string} userId - Telegram user ID
   * @param {number} numberOfDays - Number of past days to retrieve
   */
  async function getPreviousDaysMacros(userId, numberOfDays = 3) {
    try {
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(endDate.getDate() - numberOfDays);

      const { data, error } = await supabase
        .from('macro_logs')
        .select('log_date, protein_g, carbs_g, fats_g, calories')
        .eq('user_id', userId.toString())
        .gte('log_date', startDate.toISOString().split('T')[0])
        .lt('log_date', endDate.toISOString().split('T')[0])
        .order('log_date', { ascending: false });

      if (error) {
        console.error('Supabase select error:', error);
        throw new Error(`Failed to retrieve previous days macros: ${error.message}`);
      }

      // Group by date and sum macros
      const dailySummaries = {};
      data.forEach(entry => {
        const date = entry.log_date;
        if (!dailySummaries[date]) {
          dailySummaries[date] = {
            date,
            total_protein: 0,
            total_carbs: 0,
            total_fats: 0,
            total_calories: 0
          };
        }
        dailySummaries[date].total_protein += parseFloat(entry.protein_g || 0);
        dailySummaries[date].total_carbs += parseFloat(entry.carbs_g || 0);
        dailySummaries[date].total_fats += parseFloat(entry.fats_g || 0);
        dailySummaries[date].total_calories += parseFloat(entry.calories || 0);
      });

      // Convert to array and sort by date descending
      return Object.values(dailySummaries)
        .sort((a, b) => new Date(b.date) - new Date(a.date));
    } catch (error) {
      console.error('Error getting previous days macros:', error);
      throw error;
    }
  }

  /**
   * Delete a macro log entry from the database
   * @param {string} logId - The UUID of the log entry to delete
   * @param {string} userId - The Telegram user ID to ensure ownership
   * @returns {Object} The deleted data
   */
  async function deleteMacroLog(logId, userId) {
    try {
      const { data, error } = await supabase
        .from('macro_logs')
        .delete()
        .match({ id: logId, user_id: userId.toString() })
        .select();

      if (error) {
        console.error('Supabase delete error:', error);
        throw new Error(`Failed to delete macro log: ${error.message}`);
      }
      if (data.length === 0) {
        throw new Error('Log entry not found or user does not have permission to delete.');
      }

      return data[0];
    } catch (error) {
      console.error('Error deleting macro log from DB:', error);
      throw error;
    }
  }

export { saveMacrosToDb, getDailyMacros, getPreviousDaysMacros, deleteMacroLog };
