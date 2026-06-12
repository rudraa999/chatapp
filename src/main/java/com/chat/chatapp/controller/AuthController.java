package com.chat.chatapp.controller;

import com.chat.chatapp.dto.AuthRequest;
import com.chat.chatapp.dto.AuthResponse;
import com.chat.chatapp.model.User;
import com.chat.chatapp.repository.UserRepository;
import com.chat.chatapp.security.JwtUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/auth")
@CrossOrigin(origins = "*", maxAge = 3600)
public class AuthController {

    @Autowired
    private AuthenticationManager authenticationManager;

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private PasswordEncoder encoder;

    @Autowired
    private JwtUtils jwtUtils;

    @PostMapping("/login")
    public ResponseEntity<?> authenticateUser(@RequestBody AuthRequest loginRequest) {

        Authentication authentication = authenticationManager.authenticate(
                new UsernamePasswordAuthenticationToken(loginRequest.getUsername(), loginRequest.getPassword()));

        SecurityContextHolder.getContext().setAuthentication(authentication);
        String jwt = jwtUtils.generateJwtToken(loginRequest.getUsername());

        User user = userRepository.findByUsername(loginRequest.getUsername()).orElseThrow();

        return ResponseEntity.ok(new AuthResponse(jwt, loginRequest.getUsername(), "Login successful", user.getPublicKey(), user.getEncryptedPrivateKey()));
    }

    @PostMapping("/register")
    public ResponseEntity<?> registerUser(@RequestBody AuthRequest signUpRequest) {
        String username = signUpRequest.getUsername();
        if (username == null || username.trim().isEmpty() || username.length() < 3 || username.contains(" ")) {
            return ResponseEntity
                    .badRequest()
                    .body(new AuthResponse(null, username, "Error: Username must be at least 3 characters and contain no spaces!"));
        }

        if (userRepository.existsByUsername(username)) {
            return ResponseEntity
                    .badRequest()
                    .body(new AuthResponse(null, username, "Error: Username is already taken!"));
        }

        String password = signUpRequest.getPassword();
        if (password == null || password.length() < 8 || !password.matches(".*\\d.*") || !password.matches(".*[A-Z].*")) {
            return ResponseEntity
                    .badRequest()
                    .body(new AuthResponse(null, username, "Error: Password must be at least 8 characters long, contain at least one digit and one uppercase letter!"));
        }

        // Create new user's account
        User user = new User(username,
                encoder.encode(password),
                signUpRequest.getPublicKey(),
                signUpRequest.getEncryptedPrivateKey());

        userRepository.save(user);

        return ResponseEntity.ok(new AuthResponse(null, signUpRequest.getUsername(), "User registered successfully!"));
    }
}
