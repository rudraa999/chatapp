package com.chat.chatapp.repository;

import com.chat.chatapp.model.ChatMessage;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;

public interface ChatMessageRepository extends JpaRepository<ChatMessage, Long> {

    @Query("SELECT cm FROM ChatMessage cm WHERE " +
           "(cm.recipient IS NULL OR cm.recipient = 'public') " +
           "ORDER BY cm.timestamp ASC")
    List<ChatMessage> findPublicHistory();

    @Query("SELECT cm FROM ChatMessage cm WHERE " +
           "((cm.sender = :user1 AND cm.recipient = :user2) OR " +
           " (cm.sender = :user2 AND cm.recipient = :user1)) " +
           "AND (cm.type = 'CHAT' OR cm.type = 'FILE') " +
           "ORDER BY cm.timestamp ASC")
    List<ChatMessage> findPrivateHistory(@Param("user1") String user1, @Param("user2") String user2);
}
