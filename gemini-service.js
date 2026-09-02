const { GoogleGenerativeAI } = require("@google/generative-ai");

class GeminiService {
    constructor() {
        this.genAI = null;
        this.modelName = "gemini-2.5-flash-lite";
        this.basePrompt = "";
        this.llmProvider = "gemini";
        this.ollamaUrl = "http://localhost:11434";
    }

    initialize(apiKey, modelName, basePrompt, llmProvider = "gemini", ollamaUrl = "http://localhost:11434") {
        this.llmProvider = llmProvider || "gemini";
        this.ollamaUrl = ollamaUrl || "http://localhost:11434";
        this.modelName = modelName || "gemini-2.5-flash-lite";
        this.basePrompt = basePrompt || "";

        if (!apiKey || apiKey === "YOUR_GEMINI_API_KEY_HERE") {
            this.genAI = null;
        } else {
            try {
                this.genAI = new GoogleGenerativeAI(apiKey);
            } catch (error) {
                console.error("Failed to initialize Gemini AI in whatisx:", error);
                this.genAI = null;
            }
        }
        return true;
    }

    updateConfig(modelName, basePrompt, llmProvider, ollamaUrl) {
        this.modelName = modelName;
        this.basePrompt = basePrompt;
        if (llmProvider !== undefined) this.llmProvider = llmProvider;
        if (ollamaUrl !== undefined) this.ollamaUrl = ollamaUrl;
        console.log(`whatisx AI model updated. Provider: ${this.llmProvider}, Model: ${modelName}`);
    }

    async evaluateTrendAndGenerateReply(tweetText) {
        const prompt = `Analyze this trending tweet or news event:
"${tweetText}"

1. Understand the trend and make a short future prediction or smart insight.
2. Formulate a reply that is under 280 characters. It must feel natural, casual, and witty. Do NOT sound like an AI assistant.

Respond ONLY with a JSON object in this format:
{
  "prediction": "your short prediction or insight about this event/topic",
  "reply": "your witty Twitter/X reply to the post"
}`;

        if (this.llmProvider === "ollama") {
            try {
                console.log(`whatisx calling Ollama API (${this.ollamaUrl}) with model ${this.modelName}...`);
                const response = await fetch(`${this.ollamaUrl}/api/generate`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model: this.modelName,
                        system: this.basePrompt,
                        prompt: prompt,
                        format: "json",
                        stream: false
                    })
                });

                if (!response.ok) {
                    const errText = await response.text();
                    throw new Error(`Ollama response error: ${response.status} ${response.statusText} - ${errText}`);
                }

                const data = await response.json();
                const responseText = data.response.trim();
                const parsed = this.tryParseJSON(responseText);

                return {
                    replyText: parsed.reply || parsed.replyText || "",
                    prediction: parsed.prediction || ""
                };
            } catch (error) {
                console.error("Ollama API Error in whatisx:", error);
                return {
                    replyText: "That's an interesting trend. Let's see how this develops.",
                    prediction: "Unable to analyze trend details."
                };
            }
        } else {
            // Gemini
            if (!this.genAI) {
                throw new Error("Gemini AI is not initialized in whatisx. Please configure a valid API key or switch to Ollama.");
            }

            try {
                const model = this.genAI.getGenerativeModel({ 
                    model: this.modelName,
                    systemInstruction: this.basePrompt
                });

                const result = await model.generateContent({
                    contents: [{ role: 'user', parts: [{ text: prompt }] }],
                    generationConfig: {
                        responseMimeType: "application/json"
                    }
                });

                const responseText = result.response.text().trim();
                const parsed = this.tryParseJSON(responseText);
                
                return {
                    replyText: parsed.reply || parsed.replyText || "",
                    prediction: parsed.prediction || ""
                };
            } catch (error) {
                console.error("Gemini API Error in whatisx:", error);
                return {
                    replyText: "That's an interesting trend. Let's see how this develops.",
                    prediction: "Unable to analyze trend details."
                };
            }
        }
    }

    tryParseJSON(text) {
        try {
            return JSON.parse(text);
        } catch (e) {
            // Attempt to extract JSON from surrounding text using regex
            const match = text.match(/\{[\s\S]*\}/);
            if (match) {
                try {
                    return JSON.parse(match[0]);
                } catch (innerErr) {
                    console.error("Failed to parse extracted JSON block:", innerErr);
                }
            }
            throw e;
        }
    }
}

module.exports = new GeminiService();
