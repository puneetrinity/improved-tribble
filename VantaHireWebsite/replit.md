# VantaHire Recruitment Website

## Overview

This repository contains a full-stack web application for VantaHire, a recruitment company. The project uses a modern tech stack with React on the frontend and Express on the backend. It's set up with a PostgreSQL database (via Drizzle ORM) for data persistence and features a clean, dark-themed UI using ShadCN UI components.

The application is structured as a single-page application with a responsive design, featuring various sections like Home, About, Services, Industries, Testimonials, and Contact. The design uses a purple/blue color scheme with accent colors to create a modern, professional look.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture

The frontend is built with React, using modern hooks and practices. It uses:
- **React** for the UI components
- **Tailwind CSS** for styling with a custom theme
- **ShadCN UI** for pre-built UI components
- **Wouter** for lightweight routing
- **React Query** for data fetching
- **Vite** as the build tool and development server

The frontend is organized around a component-based architecture, with clear separation between UI components, page components, and business logic. SVG illustrations are used for visual elements, and the site is responsive with mobile considerations.

### Backend Architecture

The backend is built with:
- **Express.js** for the API server
- **Drizzle ORM** for database interactions
- **Zod** for schema validation

The backend follows a simple RESTful API design with routes prefixed with `/api`. The server is set up to serve the built frontend in production environments.

### Database Architecture

The database is managed through Drizzle ORM with a PostgreSQL adapter. Currently, the schema includes:
- A `users` table with basic authentication fields

In development, a memory storage solution is used as a fallback, which simulates database operations without requiring an actual database connection.

## Key Components

### Frontend Components

1. **Page Components**: 
   - `Home.tsx`: Main landing page that includes all sections
   - `NotFound.tsx`: 404 error page

2. **Section Components**:
   - `Header.tsx`: Navigation bar
   - `Hero.tsx`: Main call-to-action area
   - `About.tsx`: Company information
   - `Services.tsx`: Service offerings
   - `Industries.tsx`: Industry specializations
   - `Testimonials.tsx`: Client testimonials
   - `Contact.tsx`: Contact information
   - `Footer.tsx`: Site footer with links

3. **UI Components**:
   - Various ShadCN UI components (Button, Card, Toast, etc.)
   - Custom illustration components (Rocket, Planet, Star, etc.)

4. **Utility Components**:
   - Hooks for mobile detection, toast notifications, etc.

### Backend Components

1. **Server Setup**:
   - `index.ts`: Main server entry point with Express configuration
   - `routes.ts`: API route definitions
   - `vite.ts`: Vite configuration for development mode

2. **Data Layer**:
   - `storage.ts`: Storage interface with in-memory implementation
   - `schema.ts`: Database schema definitions using Drizzle

## Data Flow

1. **Frontend to Backend**:
   - The frontend makes API requests to the backend routes prefixed with `/api`
   - React Query is used to manage these requests and cache responses
   - The application uses JSON for data exchange

2. **Backend to Database**:
   - The backend uses the storage interface to interact with the database
   - Drizzle ORM translates these operations to SQL queries
   - Data validation is performed using Zod schemas

3. **Authentication Flow**:
   - The schema includes users with username/password, suggesting a traditional authentication system
   - Express session middleware is configured for session management

## External Dependencies

### Frontend Dependencies
- React and React DOM
- Tailwind CSS for styling
- Radix UI components (via ShadCN UI)
- TanStack React Query for data fetching
- Wouter for routing
- Lucide React for icons
- React Hook Form + Zod for form validation

### Backend Dependencies
- Express.js for the server
- Drizzle ORM for database operations
- Zod for validation
- PostgreSQL (via Neon serverless) for the database in production

## Deployment Strategy

The deployment is configured for Replit's hosting:

1. **Build Process**:
   - Run `npm run build` to:
     - Build the frontend with Vite
     - Bundle the server with esbuild

2. **Runtime Environment**:
   - The application runs in production mode with `npm run start`
   - Environment variables control database connections and other configuration

3. **Database Considerations**:
   - The application is set up to use Neon's serverless PostgreSQL in production
   - A memory storage fallback ensures development can proceed without a database

4. **Port Configuration**:
   - The application listens on port 5000 locally
   - Replit maps this to port 80 externally

## Getting Started

1. **Development**:
   ```
   npm run dev
   ```
   This starts both the frontend and backend in development mode.

2. **Database Setup**:
   ```
   npm run db:push
   ```
   This command synchronizes the database schema with your Drizzle definitions.

3. **Building for Production**:
   ```
   npm run build
   npm run start
   ```
   This builds and starts the application in production mode.

## Future Enhancements

The current implementation is a static showcase website. Potential enhancements could include:

1. Implementing the full user authentication system
2. Adding a job listings database and search functionality
3. Creating a candidate application system
4. Building an employer dashboard for posting jobs
5. Integrating with external job platforms