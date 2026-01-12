import { sheets, GOOGLE_SHEET_ID, numberToColumnLetter } from "./googleClient.js";

// Ensure a sheet tab exists with specified headers
export async function ensureSheetTab(tabName, headers) {
    try {
        // Get all sheets
        const sheetInfo = await sheets.spreadsheets.get({
            spreadsheetId: GOOGLE_SHEET_ID
        });
        
        const existingSheet = sheetInfo.data.sheets.find(s => s.properties.title === tabName);
        
        if (!existingSheet) {
            // Create the sheet
            await sheets.spreadsheets.batchUpdate({
                spreadsheetId: GOOGLE_SHEET_ID,
                requestBody: {
                    requests: [{
                        addSheet: {
                            properties: { title: tabName }
                        }
                    }]
                }
            });
        }
        
        // Check if headers exist
        const lastCol = numberToColumnLetter(headers.length);
        const headerRes = await sheets.spreadsheets.values.get({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: `${tabName}!A1:${lastCol}1`
        });
        
        const existingHeaders = headerRes.data.values?.[0] || [];
        
        // Only write headers if they don't exist
        if (existingHeaders.length === 0) {
            await sheets.spreadsheets.values.update({
                spreadsheetId: GOOGLE_SHEET_ID,
                range: `${tabName}!A1:${lastCol}1`,
                valueInputOption: "USER_ENTERED",
                requestBody: {
                    values: [headers]
                }
            });
        }
    } catch (err) {
        console.error(`Error ensuring sheet tab ${tabName}:`, err);
        throw err;
    }
}

// Find next available row in a tab (based on a specific column)
export async function findNextRowInTab(tabName, column = "A") {
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: GOOGLE_SHEET_ID,
        range: `${tabName}!${column}:${column}`
    });
    return (res.data.values || []).length + 1;
}
