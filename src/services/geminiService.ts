import { GoogleGenAI } from "@google/genai";

const MODEL_NAME = "gemini-3-flash-preview"; 

export interface OCRResult {
  text: string;
  language: string;
  confidence: number;
  summary: string;
  subjectName: string;
}

export async function performOCR(base64Image: string, mimeType: string): Promise<OCRResult> {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });
  
  const prompt = `
    You are an expert OCR system specializing in handwritten police documents.
    Analyze the provided image and:
    1. Transcribe the handwritten text exactly as it appears, maintaining structure.
    2. Identify the primary language(s) used.
    3. Provide a brief 1-2 sentence summary of the document's content.
    4. Extract the name of the subject (e.g., the suspect, victim, or officer) mentioned in the document.
    5. Estimate your confidence level in the transcription (0.0 to 1.0).

    Return the result in the following JSON format:
    {
      "text": "transcribed text here",
      "language": "identified language",
      "summary": "brief summary",
      "subjectName": "extracted name",
      "confidence": 0.95
    }
  `;

  const imagePart = {
    inlineData: {
      data: base64Image.split(',')[1] || base64Image,
      mimeType: mimeType,
    },
  };

  try {
    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: [{ parts: [imagePart, { text: prompt }] }],
      config: {
        responseMimeType: "application/json",
      },
    });

    const result = JSON.parse(response.text || "{}");
    return {
      text: result.text || "",
      language: result.language || "Unknown",
      summary: result.summary || "",
      subjectName: result.subjectName || "Unknown",
      confidence: result.confidence || 0,
    };
  } catch (error) {
    console.error("OCR Error:", error);
    throw new Error("Failed to process document. Please try again.");
  }
}

export async function translateText(text: string, targetLanguage: string): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });
  
  const prompt = `
    Translate the following text into ${targetLanguage}. 
    Maintain the original meaning and professional tone appropriate for police documents.
    Return ONLY the translated text.

    Text:
    ${text}
  `;

  try {
    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: [{ parts: [{ text: prompt }] }],
    });

    const translatedText = response.text || "";
    if (!translatedText) {
      console.warn("Translation returned empty text for prompt:", prompt);
    }
    return translatedText;
  } catch (error) {
    console.error("Translation Error:", error);
    throw new Error("Failed to translate text. Please try again.");
  }
}
