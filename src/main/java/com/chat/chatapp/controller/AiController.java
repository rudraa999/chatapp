package com.chat.chatapp.controller;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/ai")
@CrossOrigin(origins = "*", maxAge = 3600)
public class AiController {

    @Value("${app.gemini.api-key:}")
    private String geminiApiKey;

    private final ObjectMapper objectMapper = new ObjectMapper();
    private final HttpClient httpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .build();

    @PostMapping("/summarize")
    public ResponseEntity<?> summarize(@RequestBody Map<String, String> request) {
        String text = request.get("text");
        if (text == null || text.trim().isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("message", "Text content is required."));
        }

        // If API key is missing, return fallback summary
        if (geminiApiKey == null || geminiApiKey.trim().isEmpty()) {
            System.out.println("Warning: Gemini API key is not configured. Using fallback summary.");
            return ResponseEntity.ok(Map.of("summary", generateFallbackSummary(text)));
        }

        try {
            // Prepare prompt instructions
            String prompt = "Summarize the following text in a single, concise paragraph. Keep it brief and focused on the key points:\n\n" + text;

            // Structure expected by Gemini:
            // { "contents": [{ "parts": [{"text": "..."}] }] }
            Map<String, Object> textPart = Map.of("text", prompt);
            Map<String, Object> partContainer = Map.of("parts", List.of(textPart));
            Map<String, Object> requestBodyMap = Map.of("contents", List.of(partContainer));

            String requestBody = objectMapper.writeValueAsString(requestBodyMap);
            String url = "https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=" + geminiApiKey;

            HttpRequest httpRequest = HttpRequest.newBuilder()
                    .uri(URI.create(url))
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(requestBody))
                    .timeout(Duration.ofSeconds(10))
                    .build();

            HttpResponse<String> response = httpClient.send(httpRequest, HttpResponse.BodyHandlers.ofString());

            if (response.statusCode() == 200) {
                JsonNode rootNode = objectMapper.readTree(response.body());
                JsonNode textNode = rootNode.path("candidates")
                        .path(0)
                        .path("content")
                        .path("parts")
                        .path(0)
                        .path("text");
                
                if (!textNode.isMissingNode()) {
                    String summary = textNode.asText().trim();
                    return ResponseEntity.ok(Map.of("summary", summary));
                }
            }

            // Fallback if status code is not 200 or unexpected structure
            System.err.println("Error: Gemini API returned status " + response.statusCode() + " or unexpected format: " + response.body());
            return ResponseEntity.ok(Map.of("summary", generateFallbackSummary(text)));

        } catch (Exception e) {
            System.err.println("Exception while calling Gemini API: " + e.getMessage());
            return ResponseEntity.ok(Map.of("summary", generateFallbackSummary(text)));
        }
    }

    private String generateFallbackSummary(String text) {
        String trimmed = text.trim();
        String[] words = trimmed.split("\\s+");
        if (words.length <= 15) {
            return trimmed + " [Fallback Summary]";
        }
        
        StringBuilder fallback = new StringBuilder();
        for (int i = 0; i < 15; i++) {
            fallback.append(words[i]).append(" ");
        }
        return fallback.toString().trim() + "... [Fallback Summary]";
    }
}
