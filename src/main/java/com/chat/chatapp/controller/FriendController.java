package com.chat.chatapp.controller;

import com.chat.chatapp.model.FriendRequest;
import com.chat.chatapp.model.User;
import com.chat.chatapp.repository.FriendRequestRepository;
import com.chat.chatapp.repository.UserRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.*;

import java.util.*;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api")
@CrossOrigin(origins = "*", maxAge = 3600)
public class FriendController {

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private FriendRequestRepository friendRequestRepository;

    private String getCurrentUsername() {
        return SecurityContextHolder.getContext().getAuthentication().getName();
    }

    // Search users by username (excluding self)
    @GetMapping("/users/search")
    public ResponseEntity<?> searchUsers(@RequestParam String username) {
        String currentUsername = getCurrentUsername();
        
        List<User> matches = userRepository.findByUsernameContainingIgnoreCase(username);
        
        List<Map<String, Object>> results = matches.stream()
                .filter(u -> !u.getUsername().equals(currentUsername))
                .map(u -> {
                    Map<String, Object> map = new HashMap<>();
                    map.put("username", u.getUsername());
                    map.put("publicKey", u.getPublicKey());
                    
                    User me = userRepository.findByUsername(currentUsername).orElseThrow();
                    Optional<FriendRequest> rel = friendRequestRepository.findRelation(me, u);
                    if (rel.isPresent()) {
                        map.put("relationStatus", rel.get().getStatus());
                        map.put("relationSender", rel.get().getSender().getUsername());
                        map.put("requestId", rel.get().getId());
                    } else {
                        map.put("relationStatus", "NONE");
                    }
                    return map;
                })
                .collect(Collectors.toList());

        return ResponseEntity.ok(results);
    }

    // Send a friend request
    @PostMapping("/friends/request")
    public ResponseEntity<?> sendFriendRequest(@RequestParam String receiver) {
        String currentUsername = getCurrentUsername();
        if (currentUsername.equals(receiver)) {
            return ResponseEntity.badRequest().body(Map.of("message", "You cannot add yourself as a friend."));
        }

        User senderUser = userRepository.findByUsername(currentUsername)
                .orElseThrow(() -> new RuntimeException("Sender user not found"));
        User receiverUser = userRepository.findByUsername(receiver)
                .orElse(null);

        if (receiverUser == null) {
            return ResponseEntity.badRequest().body(Map.of("message", "User " + receiver + " does not exist."));
        }

        Optional<FriendRequest> existing = friendRequestRepository.findRelation(senderUser, receiverUser);
        if (existing.isPresent()) {
            return ResponseEntity.badRequest().body(Map.of("message", "Friend request or friendship already exists."));
        }

        FriendRequest friendRequest = new FriendRequest(senderUser, receiverUser, "PENDING");
        friendRequestRepository.save(friendRequest);

        return ResponseEntity.ok(Map.of("message", "Friend request sent successfully!"));
    }

    // Get pending incoming requests
    @GetMapping("/friends/pending")
    public ResponseEntity<?> getPendingRequests() {
        String currentUsername = getCurrentUsername();
        User me = userRepository.findByUsername(currentUsername)
                .orElseThrow(() -> new RuntimeException("Current user not found"));

        List<FriendRequest> requests = friendRequestRepository.findByReceiverAndStatus(me, "PENDING");
        List<Map<String, Object>> dtos = requests.stream().map(r -> {
            Map<String, Object> m = new HashMap<>();
            m.put("id", r.getId());
            m.put("sender", r.getSender().getUsername());
            m.put("timestamp", r.getTimestamp());
            return m;
        }).collect(Collectors.toList());

        return ResponseEntity.ok(dtos);
    }

    // Accept friend request
    @PostMapping("/friends/accept/{requestId}")
    public ResponseEntity<?> acceptFriendRequest(@PathVariable Long requestId) {
        String currentUsername = getCurrentUsername();
        Optional<FriendRequest> reqOpt = friendRequestRepository.findById(requestId);

        if (reqOpt.isEmpty()) {
            return ResponseEntity.notFound().build();
        }

        FriendRequest request = reqOpt.get();
        if (!request.getReceiver().getUsername().equals(currentUsername)) {
            return ResponseEntity.status(403).body(Map.of("message", "You cannot accept a request sent to someone else."));
        }

        request.setStatus("ACCEPTED");
        friendRequestRepository.save(request);

        return ResponseEntity.ok(Map.of("message", "Friend request accepted!"));
    }

    // Decline / cancel / delete request or friendship
    @PostMapping("/friends/decline/{requestId}")
    public ResponseEntity<?> declineFriendRequest(@PathVariable Long requestId) {
        String currentUsername = getCurrentUsername();
        Optional<FriendRequest> reqOpt = friendRequestRepository.findById(requestId);

        if (reqOpt.isEmpty()) {
            return ResponseEntity.notFound().build();
        }

        FriendRequest request = reqOpt.get();
        if (!request.getReceiver().getUsername().equals(currentUsername) && 
            !request.getSender().getUsername().equals(currentUsername)) {
            return ResponseEntity.status(403).body(Map.of("message", "Unauthorized action."));
        }

        friendRequestRepository.delete(request);
        return ResponseEntity.ok(Map.of("message", "Request declined/deleted successfully."));
    }

    // Get list of friends (accepted relationships)
    @GetMapping("/friends/list")
    public ResponseEntity<?> getFriendsList() {
        String currentUsername = getCurrentUsername();
        User me = userRepository.findByUsername(currentUsername)
                .orElseThrow(() -> new RuntimeException("Current user not found"));

        List<FriendRequest> friendships = friendRequestRepository.findAllFriends(me);
        List<Map<String, String>> friends = friendships.stream()
                .map(f -> {
                    User friend = f.getSender().getUsername().equals(currentUsername) ? 
                            f.getReceiver() : f.getSender();
                    Map<String, String> m = new HashMap<>();
                    m.put("username", friend.getUsername());
                    m.put("publicKey", friend.getPublicKey());
                    return m;
                })
                .collect(Collectors.toList());

        return ResponseEntity.ok(friends);
    }
}
