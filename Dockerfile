# =========================================================================
# Stage 1: Build the Angular frontend
# =========================================================================
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend

# Install dependencies
COPY frontend/package*.json ./
RUN npm config set fetch-retry-mintimeout 20000 \
    && npm config set fetch-retry-maxtimeout 120000 \
    && npm config set fetch-retries 5 \
    && npm ci

# Copy source and compile SPA static files
COPY frontend/ ./
RUN npm run build

# =========================================================================
# Stage 2: Build the Spring Boot backend
# =========================================================================
FROM maven:3.9-eclipse-temurin-17-alpine AS backend-builder
WORKDIR /app

# Copy Maven descriptor
COPY pom.xml ./
COPY src ./src

# Create resources/static directory if not exists, and copy Angular production assets
RUN mkdir -p src/main/resources/static
COPY --from=frontend-builder /app/frontend/dist/frontend/browser/ src/main/resources/static/

# Build Spring Boot jar
RUN mvn clean package -DskipTests

# =========================================================================
# Stage 3: Package and run on a lightweight JRE
# =========================================================================
FROM eclipse-temurin:17-jre-alpine
WORKDIR /app

# Copy runnable jar
COPY --from=backend-builder /app/target/*.jar app.jar

# Create directory for E2EE file uploads
RUN mkdir -p uploads

# Expose port (default port for Spring Boot is 8080)
EXPOSE 8080

# Run application
ENTRYPOINT ["java", "-jar", "app.jar"]
