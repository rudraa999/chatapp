package com.chat.chatapp.controller;

import com.chat.chatapp.model.ChatMessage;
import com.chat.chatapp.repository.ChatMessageRepository;
import com.chat.chatapp.repository.FriendRequestRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.messaging.handler.annotation.SendTo;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.*;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

@RestController
@CrossOrigin(origins = "*", maxAge = 3600)
public class ChatController {

    @Autowired
    private ChatMessageRepository chatMessageRepository;

    @Autowired
    private FriendRequestRepository friendRequestRepository;

    @Autowired
    private SimpMessagingTemplate messagingTemplate;

    private String getCurrentUsername() {
        return SecurityContextHolder.getContext().getAuthentication().getName();
    }

    // Public messages (Broadcast to all)
    @MessageMapping("/chat.sendMessage")
    @SendTo("/topic/public")
    public ChatMessage sendMessage(@Payload ChatMessage chatMessage) {
        chatMessage.setRecipient(null); // Ensure it's public
        chatMessage.setTimestamp(LocalDateTime.now());
        chatMessageRepository.save(chatMessage);
        return chatMessage;
    }

    // User joining public chat
    @MessageMapping("/chat.addUser")
    @SendTo("/topic/public")
    public ChatMessage addUser(@Payload ChatMessage chatMessage, SimpMessageHeaderAccessor headerAccessor) {
        if (headerAccessor.getSessionAttributes() != null) {
            headerAccessor.getSessionAttributes().put("username", chatMessage.getSender());
        }
        chatMessage.setRecipient(null);
        chatMessage.setTimestamp(LocalDateTime.now());
        chatMessageRepository.save(chatMessage);
        return chatMessage;
    }

    // Private Direct Messages
    @MessageMapping("/chat.privateMessage")
    public void sendPrivateMessage(@Payload ChatMessage chatMessage) {
        String sender = chatMessage.getSender();
        String recipient = chatMessage.getRecipient();

        if (sender == null || recipient == null) {
            return;
        }

        // Verify that they are friends before allowing the message
        boolean areFriends = friendRequestRepository.areFriends(sender, recipient);
        if (!areFriends) {
            // Drop message or could send an error message to sender
            return;
        }

        chatMessage.setTimestamp(LocalDateTime.now());
        chatMessageRepository.save(chatMessage);

        // Route to recipient and back to sender's session
        messagingTemplate.convertAndSendToUser(recipient, "/queue/messages", chatMessage);
        messagingTemplate.convertAndSendToUser(sender, "/queue/messages", chatMessage);
    }

    // Fetch public chat history
    @GetMapping("/api/chat/history")
    public ResponseEntity<List<ChatMessage>> getPublicHistory() {
        List<ChatMessage> history = chatMessageRepository.findPublicHistory();
        return ResponseEntity.ok(history);
    }

    // Fetch private DM history between current user and a friend
    @GetMapping("/api/chat/history/{friendUsername}")
    public ResponseEntity<?> getPrivateHistory(@PathVariable String friendUsername) {
        String currentUsername = getCurrentUsername();
        
        // Verify friendship exists before loading private history
        boolean areFriends = friendRequestRepository.areFriends(currentUsername, friendUsername);
        if (!areFriends) {
            return ResponseEntity.status(403).body(Map.of("message", "You must be friends to access this chat history."));
        }

        List<ChatMessage> history = chatMessageRepository.findPrivateHistory(currentUsername, friendUsername);
        return ResponseEntity.ok(history);
    }

    // Delete individual message
    @DeleteMapping("/api/chat/messages/{messageId}")
    public ResponseEntity<?> deleteMessage(@PathVariable Long messageId) {
        String currentUsername = getCurrentUsername();
        return chatMessageRepository.findById(messageId)
                .map(msg -> {
                    // Security check: Only sender or recipient can delete
                    if (!msg.getSender().equals(currentUsername) && !currentUsername.equals(msg.getRecipient())) {
                        return ResponseEntity.status(403).body(Map.of("message", "Unauthorized to delete this message."));
                    }

                    // Delete file from disk if present
                    if (msg.getFileId() != null) {
                        deleteFileOnDisk(msg.getFileId());
                    }

                    chatMessageRepository.delete(msg);

                    // Broadcast DELETE event via WebSocket to both users
                    ChatMessage deleteEvent = new ChatMessage();
                    deleteEvent.setId(messageId);
                    deleteEvent.setSender(msg.getSender());
                    deleteEvent.setRecipient(msg.getRecipient());
                    deleteEvent.setType("DELETE");
                    deleteEvent.setContent("");

                    if (msg.getRecipient() != null) {
                        messagingTemplate.convertAndSendToUser(msg.getRecipient(), "/queue/messages", deleteEvent);
                    }
                    messagingTemplate.convertAndSendToUser(msg.getSender(), "/queue/messages", deleteEvent);

                    return ResponseEntity.ok(Map.of("message", "Message deleted successfully."));
                })
                .orElse(ResponseEntity.notFound().build());
    }

    // Clear whole chat history
    @DeleteMapping("/api/chat/history/{friendUsername}")
    public ResponseEntity<?> clearChatHistory(@PathVariable String friendUsername) {
        String currentUsername = getCurrentUsername();

        // Verify friendship exists before clearing history
        boolean areFriends = friendRequestRepository.areFriends(currentUsername, friendUsername);
        if (!areFriends) {
            return ResponseEntity.status(403).body(Map.of("message", "You must be friends to modify this chat history."));
        }

        List<ChatMessage> history = chatMessageRepository.findPrivateHistory(currentUsername, friendUsername);
        for (ChatMessage msg : history) {
            if (msg.getFileId() != null) {
                deleteFileOnDisk(msg.getFileId());
            }
        }
        chatMessageRepository.deleteAll(history);

        // Broadcast CLEAR_CHAT event via WebSocket
        ChatMessage clearEvent = new ChatMessage();
        clearEvent.setSender(currentUsername);
        clearEvent.setRecipient(friendUsername);
        clearEvent.setType("CLEAR_CHAT");
        clearEvent.setContent(currentUsername); // Tell friend which chat was cleared

        messagingTemplate.convertAndSendToUser(friendUsername, "/queue/messages", clearEvent);
        
        // Tell self which chat was cleared
        ChatMessage clearSelfEvent = new ChatMessage();
        clearSelfEvent.setSender(currentUsername);
        clearSelfEvent.setRecipient(friendUsername);
        clearSelfEvent.setType("CLEAR_CHAT");
        clearSelfEvent.setContent(friendUsername);
        messagingTemplate.convertAndSendToUser(currentUsername, "/queue/messages", clearSelfEvent);

        return ResponseEntity.ok(Map.of("message", "Chat history cleared successfully."));
    }

    private void deleteFileOnDisk(String fileId) {
        try {
            Path root = Paths.get("uploads").toAbsolutePath().normalize();
            Path file = root.resolve(fileId).normalize().toAbsolutePath();
            if (file.getParent().equals(root)) {
                Files.deleteIfExists(file);
            }
        } catch (IOException e) {
            System.err.println("Warning: Failed to delete E2EE file: " + fileId + ", error: " + e.getMessage());
        }
    }
}
