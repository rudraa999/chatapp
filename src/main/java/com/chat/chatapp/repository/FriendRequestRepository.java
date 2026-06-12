package com.chat.chatapp.repository;

import com.chat.chatapp.model.FriendRequest;
import com.chat.chatapp.model.User;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface FriendRequestRepository extends JpaRepository<FriendRequest, Long> {

    List<FriendRequest> findByReceiverAndStatus(User receiver, String status);

    @Query("SELECT fr FROM FriendRequest fr WHERE " +
           "((fr.sender = :user1 AND fr.receiver = :user2) OR " +
           " (fr.sender = :user2 AND fr.receiver = :user1))")
    Optional<FriendRequest> findRelation(@Param("user1") User user1, @Param("user2") User user2);

    @Query("SELECT COUNT(fr) > 0 FROM FriendRequest fr WHERE " +
           "((fr.sender.username = :user1 AND fr.receiver.username = :user2) OR " +
           " (fr.sender.username = :user2 AND fr.receiver.username = :user1)) " +
           "AND fr.status = 'ACCEPTED'")
    boolean areFriends(@Param("user1") String user1, @Param("user2") String user2);

    @Query("SELECT fr FROM FriendRequest fr WHERE " +
           "(fr.sender = :user OR fr.receiver = :user) " +
           "AND fr.status = 'ACCEPTED'")
    List<FriendRequest> findAllFriends(@Param("user") User user);
}
