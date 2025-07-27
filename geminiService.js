import dotenv from 'dotenv';
import {GoogleGenAI} from '@google/genai';
dotenv.config();
console.log('GeminiService initialized with API key:', process.env.GEMINI_API_KEY);
// Initialize Gemini AI client
if (!process.env.GEMINI_API_KEY) {
  throw new Error('Missing GEMINI_API_KEY environment variable');
}

const genAI = new GoogleGenAI({apiKey: process.env.GEMINI_API_KEY});

/**
 * Calculate macros from food description using Gemini
 * @param {string} foodDescription - Description of the food consumed
 * @returns {Object} Object containing protein_g, carbs_g, fats_g, and parsed_food_item
 */
async function calculateImageMacros(contents) {
  const response = await genAI.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: contents,
  });
  const text = response.text;
  
  // Try to parse the JSON response
  let macroData;
  try {
    // Clean the response text to extract JSON
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON object found in response');
    }
    
    macroData = JSON.parse(jsonMatch[0]);
    
    // Validate required fields
    if (typeof macroData.protein_g !== 'number' || 
        typeof macroData.carbs_g !== 'number' || 
        typeof macroData.fats_g !== 'number' ||
        typeof macroData.calories !== 'number' ||
        typeof macroData.parsed_food_item !== 'string') {
      throw new Error('Invalid JSON structure');
    }

    // Ensure non-negative values
    macroData.protein_g = Math.max(0, parseFloat(macroData.protein_g) || 0);
    macroData.carbs_g = Math.max(0, parseFloat(macroData.carbs_g) || 0);
    macroData.fats_g = Math.max(0, parseFloat(macroData.fats_g) || 0);

  } catch (parseError) {
    console.error('Failed to parse Gemini response:', text);
    console.error('Parse error:', parseError);
    
    // Fallback response
    macroData = {
      protein_g: 0,
      carbs_g: 0,
      fats_g: 0,
      calories: 0,
      parsed_food_item: contents // Note: using 'contents' parameter instead of undefined 'foodDescription'
    };
  }

  return macroData;
}
async function calculateMacros(foodDescription) {
    try {
      const prompt = `You are a nutrition expert. Analyze the following food description and calculate the approximate macronutrients.

IMPORTANT: Respond ONLY with a valid JSON object in the exact format specified below. Do not include any additional text, markdown formatting, or explanations.

Food description: "${foodDescription}"

Analyze this food description and provide the macronutrient breakdown. If quantities are not specified, assume reasonable serving sizes. If you cannot identify the food or calculate macros, return zeros.

Required JSON format (respond with this format only):
{
  "protein_g": <number>,
  "carbs_g": <number>,
  "fats_g": <number>,
  "calories": <number>,
  "parsed_food_item": "<string describing the food as you understood it>"
}

Examples:
Input: "1 slice whole wheat bread, 20g peanut butter"
Output: {"protein_g": 10.5, "carbs_g": 25.1, "fats_g": 18.2, "parsed_food_item": "1 slice whole wheat bread, 20g peanut butter"}

Input: "100g chicken breast"
Output: {"protein_g": 31.0, "carbs_g": 0.0, "fats_g": 3.6, "parsed_food_item": "100g chicken breast"}

Now analyze: "${foodDescription}"`;

    const response = await genAI.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
  });
  const text = response.text;
      // Try to parse the JSON response
      let macroData;
      try {
        // Clean the response text to extract JSON
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          throw new Error('No JSON object found in response');
        }
        
        macroData = JSON.parse(jsonMatch[0]);
        
        // Validate required fields
        if (typeof macroData.protein_g !== 'number' || 
            typeof macroData.carbs_g !== 'number' || 
            typeof macroData.fats_g !== 'number' ||
            typeof macroData.calories !== 'number' ||
            typeof macroData.parsed_food_item !== 'string') {
          throw new Error('Invalid JSON structure');
        }

        // Ensure non-negative values
        macroData.protein_g = Math.max(0, parseFloat(macroData.protein_g) || 0);
        macroData.carbs_g = Math.max(0, parseFloat(macroData.carbs_g) || 0);
        macroData.fats_g = Math.max(0, parseFloat(macroData.fats_g) || 0);

      } catch (parseError) {
        console.error('Failed to parse Gemini response:', text);
        console.error('Parse error:', parseError);
        
        // Fallback response
        macroData = {
          protein_g: 0,
          carbs_g: 0,
          fats_g: 0,
          calories: 0,
          parsed_food_item: foodDescription
        };
      }

      return macroData;

    } catch (error) {
      console.error('Gemini API error:', error);
      
      // Return fallback response on API error
      return {
        protein_g: 0,
        carbs_g: 0,
        fats_g: 0,
        calories: 0,
        parsed_food_item: foodDescription
      };
    }
  }

/**
 * Test the Gemini service with a sample food description
 */
async function testService() {
  try {
    const testResult = await calculateMacros("100g grilled chicken breast with 150g steamed broccoli");
    console.log('Gemini test result:', testResult);
    return testResult;
  } catch (error) {
    console.error('Gemini test failed:', error);
    throw error;
  }
}

export { calculateMacros, testService, calculateImageMacros };
