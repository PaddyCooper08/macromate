# MacroMate Telegram Bot

A Node.js Telegram bot that helps users track their daily nutrition macros by analyzing food descriptions using Google's Gemini AI and storing data in Supabase.

## Features

- 🤖 **AI-Powered Macro Calculation**: Uses Gemini Flash 1.5 to analyze food descriptions and calculate protein, carbs, and fats
- 💾 **Data Persistence**: Stores all macro data in Supabase database
- ⭐ **Favorites System**: Save frequently eaten foods and quickly log them again
- 📊 **Daily Summaries**: View today's macro totals and individual meals
- 📈 **Historical Data**: Access past daily macro summaries
- 🕐 **Meal Timing**: Tracks when each meal/snack was logged
- 📱 **Simple Interface**: Just text your food to the bot - no complex commands needed
- 📷 **Image Recognition**: Scan nutrition labels from food packages

## Prerequisites

- Node.js 18+
- Telegram Bot Token (from [@BotFather](https://t.me/BotFather))
- Google Gemini API Key (from [Google AI Studio](https://makersuite.google.com/app/apikey))
- Supabase Project (from [Supabase](https://supabase.com))

## Database Setup

Create a Supabase table called `macro_logs` with the following schema:

```sql
CREATE TABLE macro_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id TEXT NOT NULL,
    log_date DATE NOT NULL,
    meal_time TIMESTAMP WITH TIME ZONE NOT NULL,
    food_item TEXT NOT NULL,
    protein_g NUMERIC NOT NULL,
    carbs_g NUMERIC NOT NULL,
    fats_g NUMERIC NOT NULL,
    calories NUMERIC NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create indexes for better performance
CREATE INDEX idx_macro_logs_user_date ON macro_logs(user_id, log_date);
CREATE INDEX idx_macro_logs_meal_time ON macro_logs(meal_time);
```

Also create a `favorite_foods` table for the favorites functionality:

```sql
CREATE TABLE favorite_foods (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id TEXT NOT NULL,
    food_item TEXT NOT NULL,
    protein_g NUMERIC NOT NULL,
    carbs_g NUMERIC NOT NULL,
    fats_g NUMERIC NOT NULL,
    calories NUMERIC NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create indexes for better performance
CREATE INDEX idx_favorite_foods_user_id ON favorite_foods(user_id);
CREATE INDEX idx_favorite_foods_created_at ON favorite_foods(created_at);

-- Create a unique constraint to prevent duplicate favorites for the same user
CREATE UNIQUE INDEX idx_favorite_foods_user_food ON favorite_foods(user_id, food_item);
```

## Installation

1. **Clone and install dependencies:**

```bash
cd macromate
npm install
```

2. **Configure environment variables:**

```bash
cp .env.example .env
```

Edit `.env` with your actual credentials:

```env
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
GEMINI_API_KEY=your_gemini_api_key
SUPABASE_URL=your_supabase_project_url
SUPABASE_ANON_KEY=your_supabase_anon_key
```

3. **Test the bot locally:**

```bash
npm run dev
```

## Usage

### Bot Commands

- **Start logging food**: Just send any text message describing what you ate
  - Example: `"100g chicken breast with 150g rice and 1 tbsp olive oil"`
- **`/start`**: Show welcome message and instructions

- **`/todaymacros`**: View today's macro summary and all meals

  ```
  Your macros for 2025-07-21:
  Total: P: 120g | C: 180g | F: 60g

  Meals:
  08:00 AM - Oatmeal (P: 5g, C: 30g, F: 3g)
  12:30 PM - Chicken Salad (P: 40g, C: 10g, F: 20g)
  ```

- **`/pastmacros [days]`**: View daily macro summaries for past days

  - `/pastmacros` - Shows last 3 days (default)
  - `/pastmacros 7` - Shows last 7 days
  - Maximum 30 days allowed

- **`/favorites`**: View and log from your favorite foods

  - Shows a list of your saved favorite foods
  - Tap any favorite to instantly log it for today

- **`/managefavorites`**: Remove items from your favorites list
  - View all favorites with delete buttons
  - Remove favorites you no longer need

### Favorites System

After logging any food item, you'll see an "⭐ Add to Favorites" button. This allows you to:

- Save frequently eaten foods for quick access
- Build a personalized database of your common meals
- Instantly log favorite foods without re-typing or re-scanning

### Image Recognition

Send photos of nutrition labels with a weight caption:

- Example: Send a photo of a cereal box nutrition label with caption "40g"
- The bot will analyze the label and calculate macros for your specified portion

### Food Entry Examples

The bot is flexible with food descriptions:

- `"2 eggs and 1 slice whole wheat toast"`
- `"Large apple"`
- `"100g grilled salmon, steamed vegetables"`
- `"Protein shake with banana"`
- `"McDonald's Big Mac meal"`

## Deployment with PM2

1. **Install PM2 globally:**

```bash
npm install -g pm2
```

2. **Start the bot:**

```bash
npm run pm2:start
```

3. **Other PM2 commands:**

```bash
npm run pm2:stop      # Stop the bot
npm run pm2:restart   # Restart the bot
npm run pm2:logs      # View logs
```

4. **Setup PM2 startup (Linux/Mac):**

```bash
pm2 startup
pm2 save
```

## Project Structure

```
macromate/
├── src/
│   ├── bot.js                 # Main bot logic and command handlers
│   ├── geminiService.js       # Gemini AI integration for macro calculation
│   └── supabaseClient.js      # Supabase database operations
├── logs/                      # PM2 logs (created automatically)
├── .env.example               # Environment variables template
├── .env                       # Your actual environment variables (create this)
├── ecosystem.config.js        # PM2 configuration
├── package.json              # Dependencies and scripts
└── README.md                 # This file
```

## API Rate Limits & Considerations

- **Gemini API**: Has rate limits - monitor usage in high-traffic scenarios
- **Telegram Bot API**: Has rate limits for sending messages
- **Macro Accuracy**: AI calculations are estimates, not medical advice
- **Data Privacy**: User data is stored in your Supabase instance

## Error Handling

The bot includes comprehensive error handling:

- Invalid food descriptions return helpful suggestions
- API failures provide user-friendly error messages
- Database errors are logged and handled gracefully
- Malformed data is validated and sanitized

## Development

**Run in development mode:**

```bash
npm run dev
```

**Test Gemini service:**
The bot automatically tests the Gemini connection on startup.

**Logs:**

- Development: Console output
- Production: PM2 logs in `./logs/` directory

## Troubleshooting

**Bot not responding:**

- Check your `TELEGRAM_BOT_TOKEN` is correct
- Verify bot is running: `pm2 status`
- Check logs: `npm run pm2:logs`

**Macro calculations returning zeros:**

- Verify `GEMINI_API_KEY` is valid and has quota
- Check Gemini API status and rate limits
- Try more specific food descriptions

**Database errors:**

- Confirm Supabase credentials in `.env`
- Verify the `macro_logs` table exists with correct schema
- Check Supabase project is active

## Security

- Keep your `.env` file secure and never commit it
- Use Supabase Row Level Security (RLS) for additional data protection
- Monitor API usage to prevent quota exhaustion
- Consider implementing user rate limiting for production use

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

MIT License - see LICENSE file for details

## Support

For issues or questions:

1. Check the troubleshooting section
2. Review logs for error messages
3. Open a GitHub issue with details

---

**⚠️ Disclaimer**: Macro calculations are AI-generated estimates and should not replace professional nutritional advice or medical guidance.
