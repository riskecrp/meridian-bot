// utils/googleClient.js
import { google } from "googleapis";
import dotenv from "dotenv";
dotenv.config();

// Load Env Variables
const GOOGLE_CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;

// Initialize Auth
const auth = new google.auth.JWT(
    GOOGLE_CLIENT_EMAIL,
    null,
    GOOGLE_PRIVATE_KEY,
    ["https://www.googleapis.com/auth/spreadsheets"]
);

// Create Sheets Instance
const sheets = google.sheets({ version: "v4", auth });

// Helper: Convert Column Number to Letter (1 -> A, 2 -> B)
function numberToColumnLetter(num) {
    let letter = '';
    while (num > 0) {
        const remainder = (num - 1) % 26;
        letter = String.fromCharCode(65 + remainder) + letter;
        num = Math.floor((num - 1) / 26);
    }
    return letter;
}

// Export everything we need
export { sheets, GOOGLE_SHEET_ID, numberToColumnLetter };
