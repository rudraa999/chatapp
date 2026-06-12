package com.chat.chatapp.model;

import jakarta.persistence.*;
import java.time.LocalDateTime;

@Entity
@Table(name = "chat_messages")
public class ChatMessage {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private String sender;

    @Column(nullable = true)
    private String recipient;

    @Column(columnDefinition = "TEXT")
    private String content;

    @Column(nullable = true)
    private String iv;

    @Column(nullable = true)
    private String fileId;

    @Column(nullable = false)
    private LocalDateTime timestamp;

    @Column(nullable = false)
    private String type; // e.g. CHAT, JOIN, LEAVE, FILE

    public ChatMessage() {
        this.timestamp = LocalDateTime.now();
    }

    public ChatMessage(String sender, String content, String type) {
        this.sender = sender;
        this.type = type;
        this.content = content;
        this.timestamp = LocalDateTime.now();
    }

    public ChatMessage(String sender, String recipient, String content, String type) {
        this.sender = sender;
        this.recipient = recipient;
        this.content = content;
        this.type = type;
        this.timestamp = LocalDateTime.now();
    }

    public ChatMessage(String sender, String recipient, String content, String iv, String type) {
        this.sender = sender;
        this.recipient = recipient;
        this.content = content;
        this.iv = iv;
        this.type = type;
        this.timestamp = LocalDateTime.now();
    }

    public ChatMessage(String sender, String recipient, String content, String iv, String fileId, String type) {
        this.sender = sender;
        this.recipient = recipient;
        this.content = content;
        this.iv = iv;
        this.fileId = fileId;
        this.type = type;
        this.timestamp = LocalDateTime.now();
    }


    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public String getSender() {
        return sender;
    }

    public void setSender(String sender) {
        this.sender = sender;
    }

    public String getRecipient() {
        return recipient;
    }

    public void setRecipient(String recipient) {
        this.recipient = recipient;
    }

    public String getContent() {
        return content;
    }

    public void setContent(String content) {
        this.content = content;
    }

    public LocalDateTime getTimestamp() {
        return timestamp;
    }

    public void setTimestamp(LocalDateTime timestamp) {
        this.timestamp = timestamp;
    }

    public String getType() {
        return type;
    }

    public void setType(String type) {
        this.type = type;
    }

    public String getIv() {
        return iv;
    }

    public void setIv(String iv) {
        this.iv = iv;
    }

    public String getFileId() {
        return fileId;
    }

    public void setFileId(String fileId) {
        this.fileId = fileId;
    }
}
