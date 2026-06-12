package com.chat.chatapp.controller;

import org.springframework.core.io.Resource;
import org.springframework.core.io.UrlResource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.net.MalformedURLException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/chat")
@CrossOrigin(origins = "*", maxAge = 3600)
public class FileController {

    private final Path rootLocation = Paths.get("uploads").toAbsolutePath().normalize();

    public FileController() {
        try {
            Files.createDirectories(rootLocation);
        } catch (IOException e) {
            throw new RuntimeException("Could not initialize storage folder!", e);
        }
    }

    @PostMapping("/upload")
    public ResponseEntity<?> uploadFile(@RequestParam("file") MultipartFile file) {
        try {
            if (file.isEmpty()) {
                return ResponseEntity.badRequest().body(Map.of("message", "Failed to store empty file."));
            }

            // Generate secure unique filename
            String originalFilename = file.getOriginalFilename();
            String extension = "";
            if (originalFilename != null && originalFilename.contains(".")) {
                extension = originalFilename.substring(originalFilename.lastIndexOf("."));
            }
            String fileId = UUID.randomUUID().toString() + extension;

            // Resolve and normalize path
            Path destinationFile = this.rootLocation.resolve(Paths.get(fileId)).normalize().toAbsolutePath();
            if (!destinationFile.getParent().equals(this.rootLocation)) {
                // Security check: cannot store file outside current directory
                return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of("message", "Cannot store file outside current directory."));
            }

            Files.copy(file.getInputStream(), destinationFile, StandardCopyOption.REPLACE_EXISTING);

            return ResponseEntity.ok(Map.of("fileId", fileId));
        } catch (IOException e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Map.of("message", "Failed to store file: " + e.getMessage()));
        }
    }

    @GetMapping("/download/{fileId:.+}")
    @ResponseBody
    public ResponseEntity<?> downloadFile(@PathVariable String fileId) {
        try {
            Path file = rootLocation.resolve(fileId).normalize().toAbsolutePath();
            if (!file.getParent().equals(this.rootLocation)) {
                // Security check
                return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of("message", "Access denied."));
            }

            Resource resource = new UrlResource(file.toUri());

            if (resource.exists() || resource.isReadable()) {
                return ResponseEntity.ok()
                        .contentType(MediaType.APPLICATION_OCTET_STREAM)
                        .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + resource.getFilename() + "\"")
                        .body(resource);
            } else {
                return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("message", "Could not read file: " + fileId));
            }
        } catch (MalformedURLException e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Map.of("message", "Error: " + e.getMessage()));
        }
    }
}
